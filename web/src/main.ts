import "./styles.css";

import { loadData, type ExtraData, type LatLng, type PlzIndex } from "./data";
import { berlinToday, formatStamp, isStale, STALE_AFTER_DAYS } from "./dates";
import { byId, h, replaceChildren } from "./dom";
import { hydrateIcons } from "./icons";
import { formatKm } from "./geo";
import { listAll, search, SORT_ORDERS, type Hit, type SortOrder } from "./search";
import { renderHit, renderRow } from "./ui/list";
import type { MapView } from "./ui/map";
import { setupTabs } from "./ui/tabs";
import { countUnchecked, emptyStatus, listSummary, nearestStatus, radiusStatus } from "./summary";
import {
  buildQuery,
  DEFAULT_PLZ,
  isPlz,
  isRadius,
  parseQuery,
  type QueryState,
  type Tab,
} from "./url";

interface Origin {
  point: LatLng;
  /** "um PLZ 76137" / "um den aktuellen Standort" */
  label: string;
  plz: string | null;
}

const form = byId("search-form", HTMLFormElement);
const plzInput = byId("plz", HTMLInputElement);
const plzError = byId("plz-error", HTMLParagraphElement);
const locateButton = byId("locate", HTMLButtonElement);
const status = byId("status", HTMLParagraphElement);
const dataAge = byId("data-age", HTMLParagraphElement);
const statusBox = byId("status-box", HTMLDivElement);
const dataAgeBox = byId("data-age-box", HTMLDivElement);
const mapContainer = byId("map", HTMLDivElement);
const list = byId("list", HTMLOListElement);
const allList = byId("all-list", HTMLOListElement);
const allMeta = byId("all-meta", HTMLParagraphElement);
const sortGroup = byId("sort", HTMLDivElement);
const tablist = byId("tabs", HTMLDivElement);
const pdfSwitches = [
  byId("pdf-only-search", HTMLInputElement),
  byId("pdf-only-all", HTMLInputElement),
];

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let data: { extra: ExtraData; plz: PlzIndex } | null = null;
let origin: Origin | null = null;
let radius = parseQuery(location.search).radius;
let tab: Tab = parseQuery(location.search).tab;
let sort: SortOrder = parseQuery(location.search).sort;
let pdfOnly = parseQuery(location.search).pdfOnly;
let mapView: Promise<MapView> | null = null;
let lastMap: { point: LatLng; radius: number; shown: Hit[] } | null = null;
const items = new Map<string, HTMLLIElement>();

function setStatus(text: string, kind: "info" | "error" = "info"): void {
  status.textContent = text;
  statusBox.classList.toggle("banner--error", kind === "error");
}

function showPlzError(message: string | null): void {
  plzError.hidden = message === null;
  plzError.textContent = message ?? "";
  plzInput.setAttribute("aria-invalid", String(message !== null));
}

function radioFor(value: number): HTMLInputElement | null {
  return form.querySelector<HTMLInputElement>(`input[name="radius"][value="${String(value)}"]`);
}

function syncUrl(push: boolean): void {
  const state: QueryState = { plz: origin?.plz ?? null, radius, tab, sort, pdfOnly };
  const url = `${location.pathname}${buildQuery(state)}`;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

function getMap(): Promise<MapView> {
  if (!mapView) {
    mapContainer.hidden = false;
    mapView = import("./ui/map").then(({ createMap }) => createMap(mapContainer, select));
  }
  return mapView;
}

/** Run `action` on the map; the list stays usable if the map fails. */
function withMap(action: (map: MapView) => void): void {
  getMap()
    .then(action)
    .catch((err: unknown) => {
      console.error(err);
      mapContainer.hidden = true;
      dataAge.append(" ", h("strong", null, "Die Karte konnte nicht geladen werden."));
    });
}

function select(id: string): void {
  for (const [storeId, item] of items) {
    const isSelected = storeId === id;
    item.classList.toggle("is-selected", isSelected);
    if (isSelected) {
      item.setAttribute("aria-current", "true");
      item.scrollIntoView({
        block: "nearest",
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    } else {
      item.removeAttribute("aria-current");
    }
  }
  withMap((map) => {
    map.select(id);
  });
}

function render(shown: Hit[], note?: string): void {
  items.clear();
  replaceChildren(
    list,
    ...shown.map((hit) => {
      const item = renderHit(hit, select, note);
      items.set(hit.store.id, item);
      return item;
    }),
  );
}

function runSearch(): void {
  if (!data || !origin) return;
  const t0 = performance.now();
  const today = berlinToday(new Date());
  const result = search(data.extra, origin.point, radius, today, { pdfOnly });
  // Unfiltered count, so the status can say how many stores the switch hides.
  const unfiltered = pdfOnly ? search(data.extra, origin.point, radius, today).hits.length : 0;

  const shown = result.hits.length > 0 ? result.hits : result.nearest ? [result.nearest] : [];
  const count = result.hits.length;
  if (count > 0) {
    render(shown);
    const counts = {
      shown: count,
      hidden: pdfOnly ? unfiltered - count : 0,
      unchecked: countUnchecked(result.hits),
    };
    setStatus(radiusStatus(counts, radius, origin.label, pdfOnly));
  } else if (result.nearest) {
    render(shown, "Nächste Extra-Filiale außerhalb des Umkreises");
    setStatus(nearestStatus(formatKm(result.nearest.distanceKm), radius, origin.label, pdfOnly));
  } else {
    render([]);
    setStatus(emptyStatus(pdfOnly));
  }
  if (import.meta.env.DEV) console.debug(`search took ${(performance.now() - t0).toFixed(1)} ms`);

  lastMap = { point: origin.point, radius, shown };
  if (tab === "search") drawMap();
}

/** Draw the last search on the map; only while the search tab is visible (Leaflet needs a size). */
function drawMap(): void {
  if (!lastMap) return;
  const { point, radius: r, shown } = lastMap;
  withMap((map) => {
    map.show(point, r, shown);
  });
}

function renderAll(): void {
  if (!data) return;
  const today = berlinToday(new Date());
  const views = listAll(data.extra, today, sort, { pdfOnly });
  replaceChildren(allList, ...views.map(renderRow));
  const counts = {
    shown: views.length,
    hidden: pdfOnly ? listAll(data.extra, today, sort).length - views.length : 0,
    unchecked: countUnchecked(views),
  };
  replaceChildren(
    allMeta,
    `${listSummary(counts, pdfOnly)} · Stand der Daten: `,
    h(
      "time",
      { datetime: data.extra.generatedAt.toISOString() },
      formatStamp(data.extra.generatedAt),
    ),
  );
}

/** Both tabs have a switch for the same setting; keep them in sync. */
function onPdfOnlyChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  pdfOnly = target.checked;
  for (const box of pdfSwitches) box.checked = pdfOnly;
  syncUrl(false);
  runSearch();
  if (tab === "all") renderAll();
}

function isSortOrder(value: string): value is SortOrder {
  return (SORT_ORDERS as readonly string[]).includes(value);
}

function onSortChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !isSortOrder(target.value)) return;
  sort = target.value;
  syncUrl(false);
  renderAll();
}

const tabs = setupTabs(tablist, (selected) => {
  tab = selected;
  syncUrl(true);
  showTab();
});

/** Render what the visible tab needs (the map must re-measure after being hidden). */
function showTab(): void {
  if (tab === "all") renderAll();
  else drawMap();
}

function searchPlz(plz: string, push: boolean): void {
  if (!data) return;
  const point = data.plz.get(plz);
  if (!point) {
    showPlzError(`PLZ ${plz} nicht gefunden.`);
    return;
  }
  showPlzError(null);
  origin = { point, label: `um PLZ ${plz}`, plz };
  syncUrl(push);
  runSearch();
}

function onSubmit(event: SubmitEvent): void {
  event.preventDefault();
  const plz = plzInput.value.trim();
  if (!isPlz(plz)) {
    showPlzError("Bitte eine 5-stellige Postleitzahl eingeben.");
    plzInput.focus();
    return;
  }
  if (!data) {
    setStatus("Daten werden noch geladen …");
    return;
  }
  searchPlz(plz, true);
}

const GEO_ERRORS: Record<number, string> = {
  1: "Der Zugriff auf den Standort wurde verweigert.",
  2: "Der Standort konnte nicht ermittelt werden.",
  3: "Die Standortbestimmung hat zu lange gedauert.",
};

function onLocate(): void {
  if (!("geolocation" in navigator)) {
    setStatus("Dieser Browser unterstützt keine Standortbestimmung.", "error");
    return;
  }
  locateButton.disabled = true;
  setStatus("Standort wird ermittelt …");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      locateButton.disabled = false;
      if (!data) return;
      showPlzError(null);
      plzInput.value = "";
      origin = {
        point: [pos.coords.latitude, pos.coords.longitude],
        label: "um den aktuellen Standort",
        plz: null, // never put coordinates into the URL
      };
      syncUrl(true);
      runSearch();
    },
    (err) => {
      locateButton.disabled = false;
      setStatus(GEO_ERRORS[err.code] ?? "Der Standort konnte nicht ermittelt werden.", "error");
    },
    { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
  );
}

function onRadiusChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.name !== "radius") return;
  const value = Number(target.value);
  if (!isRadius(value)) return;
  radius = value;
  if (origin) {
    syncUrl(false);
    runSearch();
  }
}

function applyQuery(): void {
  const query = parseQuery(location.search);
  radius = query.radius;
  const radio = radioFor(radius);
  if (radio) radio.checked = true;
  sort = query.sort;
  pdfOnly = query.pdfOnly;
  for (const box of pdfSwitches) box.checked = pdfOnly;
  const sortRadio = sortGroup.querySelector<HTMLInputElement>(`input[value="${sort}"]`);
  if (sortRadio) sortRadio.checked = true;
  tab = query.tab;
  tabs.select(tab);
  showTab();
  // Without a PLZ in the URL the default PLZ is searched, so the map and cards show right away.
  const plz = query.plz ?? DEFAULT_PLZ;
  plzInput.value = plz;
  searchPlz(plz, false);
}

function showDataAge(extra: ExtraData): void {
  const stamp = h(
    "time",
    { datetime: extra.generatedAt.toISOString() },
    formatStamp(extra.generatedAt),
  );
  replaceChildren(dataAge, "Stand der Daten: ", stamp);
  const stale = isStale(extra.generatedAt, new Date());
  dataAgeBox.classList.toggle("banner--error", stale);
  if (stale) {
    dataAge.append(
      " ",
      h("strong", null, `Älter als ${String(STALE_AFTER_DAYS)} Tage, möglicherweise veraltet.`),
    );
  }
}

hydrateIcons();
form.addEventListener("submit", onSubmit);
form.addEventListener("change", onRadiusChange);
sortGroup.addEventListener("change", onSortChange);
for (const box of pdfSwitches) box.addEventListener("change", onPdfOnlyChange);
locateButton.addEventListener("click", onLocate);
plzInput.addEventListener("input", () => {
  showPlzError(null);
});
window.addEventListener("popstate", applyQuery);

const initial = parseQuery(location.search);
plzInput.value = initial.plz ?? DEFAULT_PLZ;
const initialRadio = radioFor(initial.radius);
if (initialRadio) initialRadio.checked = true;
tabs.select(initial.tab);
for (const box of pdfSwitches) box.checked = initial.pdfOnly;

loadData(import.meta.env.BASE_URL)
  .then((loaded) => {
    data = loaded;
    showDataAge(loaded.extra);
    setStatus("");
    applyQuery();
  })
  .catch((err: unknown) => {
    console.error(err);
    setStatus("Die Daten konnten nicht geladen werden. Bitte später erneut versuchen.", "error");
    allMeta.textContent = "Die Daten konnten nicht geladen werden.";
  });
