import "./styles.css";

import { loadData, type ExtraData, type LatLng, type PlzIndex } from "./data";
import { berlinToday, formatStamp, isStale, STALE_AFTER_DAYS } from "./dates";
import { byId, h, replaceChildren } from "./dom";
import { hydrateIcons, icon } from "./icons";
import { formatKm } from "./geo";
import { listAll, search, SORT_ORDERS, type Hit, type SortOrder } from "./search";
import { renderHit, renderRow } from "./ui/list";
import type { MapView } from "./ui/map";
import { setupTabs } from "./ui/tabs";
import { buildQuery, isPlz, isRadius, parseQuery, type QueryState, type Tab } from "./url";

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
const mapContainer = byId("map", HTMLDivElement);
const list = byId("list", HTMLOListElement);
const allList = byId("all-list", HTMLOListElement);
const allMeta = byId("all-meta", HTMLParagraphElement);
const sortGroup = byId("sort", HTMLDivElement);
const tablist = byId("tabs", HTMLDivElement);

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let data: { extra: ExtraData; plz: PlzIndex } | null = null;
let origin: Origin | null = null;
let radius = parseQuery(location.search).radius;
let tab: Tab = parseQuery(location.search).tab;
let sort: SortOrder = parseQuery(location.search).sort;
let mapView: Promise<MapView> | null = null;
const items = new Map<string, HTMLLIElement>();

function setStatus(text: string, kind: "info" | "error" = "info"): void {
  status.textContent = text;
  status.classList.toggle("status--error", kind === "error");
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
  const state: QueryState = { plz: origin?.plz ?? null, radius, tab, sort };
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
      dataAge.append(
        " ",
        h("strong", { class: "stale" }, "Die Karte konnte nicht geladen werden."),
      );
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
  const result = search(data.extra, origin.point, radius, berlinToday(new Date()));

  const shown = result.hits.length > 0 ? result.hits : result.nearest ? [result.nearest] : [];
  const count = result.hits.length;
  if (count > 0) {
    render(shown);
    setStatus(
      `${String(count)} ${count === 1 ? "Extra-Filiale" : "Extra-Filialen"} im Umkreis von ` +
        `${String(radius)} km ${origin.label}.`,
    );
  } else if (result.nearest) {
    render(shown, "Nächste Extra-Filiale außerhalb des Umkreises");
    setStatus(
      `Keine Extra-Filiale im Umkreis von ${String(radius)} km ${origin.label}. ` +
        `Die nächste ist ${formatKm(result.nearest.distanceKm)} entfernt.`,
    );
  } else {
    render([]);
    setStatus("Derzeit ist keine Filiale mit Extra-Angeboten bekannt.");
  }
  if (import.meta.env.DEV) console.debug(`search took ${(performance.now() - t0).toFixed(1)} ms`);

  const { point } = origin;
  withMap((map) => {
    map.show(point, radius, shown);
  });
}

function renderAll(): void {
  if (!data) return;
  const views = listAll(data.extra, berlinToday(new Date()), sort);
  replaceChildren(allList, ...views.map(renderRow));
  const count = views.length;
  replaceChildren(
    allMeta,
    `${String(count)} ${count === 1 ? "Filiale" : "Filialen"} mit Extra-Prospekt · Stand der Daten: `,
    h(
      "time",
      { datetime: data.extra.generatedAt.toISOString() },
      formatStamp(data.extra.generatedAt),
    ),
  );
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
  else if (mapView) {
    withMap((map) => {
      map.refresh();
    });
  }
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
  const sortRadio = sortGroup.querySelector<HTMLInputElement>(`input[value="${sort}"]`);
  if (sortRadio) sortRadio.checked = true;
  tab = query.tab;
  tabs.select(tab);
  showTab();
  plzInput.value = query.plz ?? "";
  if (query.plz) {
    searchPlz(query.plz, false);
  } else if (origin?.plz) {
    // Navigated back to the start page.
    origin = null;
    render([]);
    setStatus("");
  }
}

function showDataAge(extra: ExtraData): void {
  const stamp = h(
    "time",
    { datetime: extra.generatedAt.toISOString() },
    formatStamp(extra.generatedAt),
  );
  replaceChildren(dataAge, icon("schedule"), "Stand der Daten: ", stamp);
  if (isStale(extra.generatedAt, new Date())) {
    dataAge.append(
      " ",
      h(
        "strong",
        { class: "stale" },
        `Die Daten sind älter als ${String(STALE_AFTER_DAYS)} Tage und möglicherweise veraltet.`,
      ),
    );
  }
}

hydrateIcons();
form.addEventListener("submit", onSubmit);
form.addEventListener("change", onRadiusChange);
sortGroup.addEventListener("change", onSortChange);
locateButton.addEventListener("click", onLocate);
plzInput.addEventListener("input", () => {
  showPlzError(null);
});
window.addEventListener("popstate", applyQuery);

const initial = parseQuery(location.search);
plzInput.value = initial.plz ?? "";
const initialRadio = radioFor(initial.radius);
if (initialRadio) initialRadio.checked = true;
tabs.select(initial.tab);

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
