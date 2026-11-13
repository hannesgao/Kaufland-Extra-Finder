import "./styles.css";

import {
  loadCards,
  searchCards,
  storesFor,
  summarizeArticles,
  type ArticleSummary,
  type CardHit,
  type CardsData,
} from "./cards";
import {
  DEAL_SORTS,
  dealCounts,
  dealSections,
  listDeals,
  loadDeals,
  sectionCounts,
  type DealsData,
  type DealSort,
} from "./deals";
import { loadData, type ExtraData, type LatLng, type PlzIndex } from "./data";
import { berlinToday, formatDate, formatStamp, isStale, STALE_AFTER_DAYS } from "./dates";
import { byId, h, replaceChildren } from "./dom";
import { hydrateIcons } from "./icons";
import { formatKm } from "./geo";
import {
  latestPeriod,
  listAll,
  listDormant,
  search,
  SORT_ORDERS,
  type DormantHit,
  type DormantView,
  type Hit,
  type SortOrder,
} from "./search";
import { renderArticle, renderArticleStrip, renderCardStore } from "./ui/cards";
import { renderDeal, sectionIcon } from "./ui/deals";
import { setupSelect } from "./ui/select";
import { renderDormant, renderHit, renderRow, type StoreDeals } from "./ui/list";
import type { MapMarker, MapView } from "./ui/map";
import { setupTabs } from "./ui/tabs";
import {
  articlesStatus,
  CARDS_EMPTY,
  CARDS_MISSING,
  cardsArticleNearest,
  cardsArticleStatus,
  cardsNearestStatus,
  cardsStatus,
  countUnchecked,
  dealsButton,
  DEALS_MISSING,
  dealsStatus,
  dormantIntro,
  dormantTitle,
  emptyStatus,
  listSummary,
  noLeafletStatus,
  nearestStatus,
  radiusStatus,
} from "./summary";
import {
  buildQuery,
  DEFAULT_PLZ,
  isPlz,
  isRadius,
  parseQuery,
  type CardsView,
  type QueryState,
  type Tab,
} from "./url";

interface Origin {
  point: LatLng;
  /** "um PLZ 76137" / "um den aktuellen Standort" */
  label: string;
  /** "von PLZ 76137" / "vom aktuellen Standort" (article view: distances) */
  from: string;
  plz: string | null;
}

/** The radius search and the two offer tabs each have a search form; PLZ and radius are shared. */
interface SearchForm {
  form: HTMLFormElement;
  plz: HTMLInputElement;
  error: HTMLParagraphElement;
  locate: HTMLButtonElement;
}

/** One lazily created Leaflet map per tab, with the list items it selects. */
interface MapSlot {
  container: HTMLDivElement;
  /** Where a "map could not be loaded" message goes. */
  errorTarget: HTMLElement;
  view: Promise<MapView> | null;
  items: Map<string, HTMLLIElement>;
  last: { point: LatLng; radius: number; markers: MapMarker[] } | null;
}

/** Offers are scanned on Mondays and Thursdays (Thu -> Mon is 4 days); warn after one missed scan. */
const CARDS_STALE_AFTER_DAYS = 5;

const forms: SearchForm[] = [
  {
    form: byId("search-form", HTMLFormElement),
    plz: byId("plz", HTMLInputElement),
    error: byId("plz-error", HTMLParagraphElement),
    locate: byId("locate", HTMLButtonElement),
  },
  {
    form: byId("cards-form", HTMLFormElement),
    plz: byId("cards-plz", HTMLInputElement),
    error: byId("cards-plz-error", HTMLParagraphElement),
    locate: byId("cards-locate", HTMLButtonElement),
  },
  {
    form: byId("deals-form", HTMLFormElement),
    plz: byId("deals-plz", HTMLInputElement),
    error: byId("deals-plz-error", HTMLParagraphElement),
    locate: byId("deals-locate", HTMLButtonElement),
  },
];
const status = byId("status", HTMLParagraphElement);
const dataAge = byId("data-age", HTMLParagraphElement);
const statusBox = byId("status-box", HTMLDivElement);
const dataAgeBox = byId("data-age-box", HTMLDivElement);
const dataAgeBoxes: [HTMLParagraphElement, HTMLDivElement][] = [
  [dataAge, dataAgeBox],
  [byId("all-age", HTMLParagraphElement), byId("all-age-box", HTMLDivElement)],
];
const list = byId("list", HTMLOListElement);
const allList = byId("all-list", HTMLOListElement);

/** "Derzeit ohne Extra-Prospekt": Extra stores without a current leaflet, below the others. */
interface DormantSlot {
  section: HTMLElement;
  title: HTMLHeadingElement;
  intro: HTMLParagraphElement;
  list: HTMLOListElement;
}

function dormantSlot(prefix: string): DormantSlot {
  return {
    section: byId(prefix, HTMLElement),
    title: byId(`${prefix}-title`, HTMLHeadingElement),
    intro: byId(`${prefix}-intro`, HTMLParagraphElement),
    list: byId(`${prefix}-list`, HTMLOListElement),
  };
}

const searchDormant = dormantSlot("dormant");
const allDormant = dormantSlot("all-dormant");
const allMeta = byId("all-meta", HTMLParagraphElement);
const allStatusBox = byId("all-status-box", HTMLDivElement);
const sortGroup = byId("sort", HTMLDivElement);
const exportGroup = byId("export", HTMLDivElement);
const tablist = byId("tabs", HTMLDivElement);
const pdfSwitches = [
  byId("pdf-only-search", HTMLInputElement),
  byId("pdf-only-all", HTMLInputElement),
];
const cardsStatusText = byId("cards-status", HTMLParagraphElement);
const cardsStatusBox = byId("cards-status-box", HTMLDivElement);
const cardsAge = byId("cards-age", HTMLParagraphElement);
const cardsAgeBox = byId("cards-age-box", HTMLDivElement);
const cardsList = byId("cards-list", HTMLOListElement);
const cardsViewGroup = byId("cards-view", HTMLFieldSetElement);
const cardsStrip = byId("cards-strip", HTMLElement);
const cardsStripList = byId("cards-strip-list", HTMLUListElement);
const cardsArticles = byId("cards-articles", HTMLOListElement);
const cardsResults = byId("cards-results", HTMLElement);
const dealsStatusText = byId("deals-status", HTMLParagraphElement);
const dealsStatusBox = byId("deals-status-box", HTMLDivElement);
const dealsAge = byId("deals-age", HTMLParagraphElement);
const dealsAgeBox = byId("deals-age-box", HTMLDivElement);
const dealsList = byId("deals-list", HTMLOListElement);
const dealsSortGroup = byId("deals-sort", HTMLFieldSetElement);
const dealsSectionSelect = setupSelect(
  byId("deals-section", HTMLDivElement),
  "Kategorie",
  (value) => {
    dealSection = value === "" ? null : value;
    syncUrl(false);
    runDeals();
  },
);
const dealsCommonSwitch = byId("deals-common", HTMLInputElement);
const dealsNearSwitch = byId("deals-near", HTMLInputElement);
const dealsUnconfirmedSwitch = byId("deals-unconfirmed", HTMLInputElement);
const dealsStoreBox = byId("deals-store", HTMLDivElement);
const dealsStoreText = byId("deals-store-text", HTMLParagraphElement);
const dealsFilters = byId("deals-filters", HTMLDetailsElement);
const dealsFilterCount = byId("deals-filter-count", HTMLSpanElement);
/** Phones: the filters of the Extra offers tab are folded away under a summary. */
const narrowScreen = window.matchMedia("(max-width: 599px)");

const searchMap: MapSlot = {
  container: byId("map", HTMLDivElement),
  errorTarget: dataAge,
  view: null,
  items: new Map(),
  last: null,
};
const cardsMap: MapSlot = {
  container: byId("cards-map", HTMLDivElement),
  errorTarget: cardsAge,
  view: null,
  items: new Map(),
  last: null,
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let data: { extra: ExtraData; plz: PlzIndex } | null = null;
/** undefined: not loaded yet; null: no cards.json published yet. */
let cards: CardsData | null | undefined;
let cardsLoading = false;
let origin: Origin | null = null;
let radius = parseQuery(location.search).radius;
let tab: Tab = parseQuery(location.search).tab;
let sort: SortOrder = parseQuery(location.search).sort;
let pdfOnly = parseQuery(location.search).pdfOnly;
let cardsView: CardsView = parseQuery(location.search).cardsView;
/** Store view filtered by this article (Kaufland article number). */
let article: string | null = parseQuery(location.search).article;
/** Article view: articles whose full store list is shown. */
const expandedArticles = new Set<string>();
/** undefined: not loaded yet; null: no deals.json published yet. */
let deals: DealsData | null | undefined;
let dealsLoading = false;
let dealSort: DealSort = parseQuery(location.search).dealSort;
let dealSection: string | null = parseQuery(location.search).dealSection;
let dealsAll = parseQuery(location.search).dealsAll;
let dealsNear = parseQuery(location.search).dealsNear;
let dealsUnconfirmed = parseQuery(location.search).dealsUnconfirmed;
/** Extra offers of this store only (from "N Extra-Angebote" on a store card). */
let dealStore: string | null = parseQuery(location.search).dealStore;
/** Extra offers whose full store list is shown. */
const expandedDeals = new Set<string>();

function setStatus(text: string, kind: "info" | "error" = "info"): void {
  status.textContent = text;
  statusBox.classList.toggle("banner--error", kind === "error");
}

function setCardsStatus(text: string, kind: "info" | "error" = "info"): void {
  cardsStatusText.textContent = text;
  cardsStatusBox.classList.toggle("banner--error", kind === "error");
}

function setDealsStatus(text: string, kind: "info" | "error" = "info"): void {
  dealsStatusText.textContent = text;
  dealsStatusBox.classList.toggle("banner--error", kind === "error");
}

function showPlzError(message: string | null): void {
  for (const { plz, error } of forms) {
    error.hidden = message === null;
    error.textContent = message ?? "";
    plz.setAttribute("aria-invalid", String(message !== null));
  }
}

function setPlzValue(value: string): void {
  for (const { plz } of forms) plz.value = value;
}

function checkRadius(value: number): void {
  for (const { form } of forms) {
    const radio = form.querySelector<HTMLInputElement>(
      `input[name="radius"][value="${String(value)}"]`,
    );
    if (radio) radio.checked = true;
  }
}

function syncUrl(push: boolean): void {
  const state: QueryState = {
    plz: origin?.plz ?? null,
    radius,
    tab,
    sort,
    pdfOnly,
    cardsView,
    article,
    dealSort,
    dealSection,
    dealsAll,
    dealsNear,
    dealsUnconfirmed,
    dealStore,
  };
  const url = `${location.pathname}${buildQuery(state)}`;
  if (push) history.pushState(null, "", url);
  else history.replaceState(null, "", url);
}

/* ---------- Maps ---------- */

function getMap(slot: MapSlot): Promise<MapView> {
  if (!slot.view) {
    slot.container.hidden = false;
    slot.view = import("./ui/map").then(({ createMap }) =>
      createMap(slot.container, (id) => {
        select(slot, id);
      }),
    );
  }
  return slot.view;
}

/** Run `action` on the map; the list stays usable if the map fails. */
function withMap(slot: MapSlot, action: (map: MapView) => void): void {
  getMap(slot)
    .then(action)
    .catch((err: unknown) => {
      console.error(err);
      slot.container.hidden = true;
      slot.errorTarget.append(" ", h("strong", null, "Die Karte konnte nicht geladen werden."));
    });
}

function select(slot: MapSlot, id: string): void {
  for (const [storeId, item] of slot.items) {
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
  withMap(slot, (map) => {
    map.select(id);
  });
}

/** Draw the slot's last search; only while its tab is visible (Leaflet needs a size). */
function drawMap(slot: MapSlot): void {
  if (!slot.last) return;
  const { point, radius: r, markers } = slot.last;
  withMap(slot, (map) => {
    map.show(point, r, markers);
  });
}

/** First day of the Extra history, "06.10.2026". */
function historySince(): string | null {
  const since = data?.extra.historySince;
  return since ? formatDate(since) : null;
}

function fillDormant(slot: DormantSlot, nearby: boolean, items: HTMLLIElement[]): void {
  slot.section.hidden = items.length === 0;
  slot.title.textContent = dormantTitle(items.length, nearby);
  slot.intro.textContent = dormantIntro(historySince(), pdfOnly);
  replaceChildren(slot.list, ...items);
}

/** Status when no store has a current leaflet: when the last Extra leaflets were. */
function noLeafletText(today: string): string {
  if (!data) return emptyStatus(pdfOnly);
  const dormant = listDormant(data.extra, today, sort, { pdfOnly });
  return dormant.length > 0 ? noLeafletStatus(latestPeriod(dormant)) : emptyStatus(pdfOnly);
}

function dormantMarker(view: DormantHit): MapMarker {
  const { id, name, lat, lng } = view.store;
  return { id, name, lat, lng, kind: "dormant" };
}

function hitMarker(hit: Hit): MapMarker {
  const { id, name, lat, lng } = hit.store;
  const kind = hit.closed ? "closed" : hit.foreignOnly ? "foreign" : "default";
  return { id, name, lat, lng, kind };
}

function cardMarker(hit: CardHit): MapMarker {
  const { id, name, lat, lng } = hit.store;
  return { id, name, lat, lng, kind: "default" };
}

/* ---------- Radius search (Extra leaflets) ---------- */

/** "28 Extra-Angebote" for a store card, once deals.json is there and the store has offers. */
function storeDeals(counts: ReadonlyMap<string, number>, id: string): StoreDeals | undefined {
  const count = counts.get(id);
  if (count === undefined) return undefined;
  return {
    label: dealsButton(count),
    onClick: () => {
      showStoreDeals(id);
    },
  };
}

function currentDealCounts(): ReadonlyMap<string, number> {
  return deals ? dealCounts(deals, berlinToday(new Date())) : new Map<string, number>();
}

/** Open the Extra offers tab with the offers of one store. */
function showStoreDeals(id: string): void {
  dealStore = id;
  tab = "deals";
  tabs.select(tab);
  syncUrl(true);
  showTab();
  runDeals();
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
}

function render(shown: Hit[], dormant: DormantHit[], note?: string): void {
  searchMap.items.clear();
  const onSelect = (id: string) => {
    select(searchMap, id);
  };
  const counts = currentDealCounts();
  replaceChildren(
    list,
    ...shown.map((hit) => {
      const item = renderHit(hit, onSelect, note, storeDeals(counts, hit.store.id));
      searchMap.items.set(hit.store.id, item);
      return item;
    }),
  );
  const since = historySince();
  fillDormant(
    searchDormant,
    true,
    dormant.map((view) => {
      const show = () => {
        onSelect(view.store.id);
      };
      const item = renderDormant(view, {
        distanceKm: view.distanceKm,
        since,
        action: { label: "Auf Karte zeigen", icon: "map", onClick: show },
        onTitleClick: show,
      });
      searchMap.items.set(view.store.id, item);
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
    render(shown, result.dormant);
    const counts = {
      shown: count,
      hidden: pdfOnly ? unfiltered - count : 0,
      unchecked: countUnchecked(result.hits),
    };
    setStatus(radiusStatus(counts, radius, origin.label, pdfOnly));
  } else if (result.nearest) {
    render(shown, result.dormant, "Nächste Extra-Filiale außerhalb des Umkreises");
    setStatus(nearestStatus(formatKm(result.nearest.distanceKm), radius, origin.label, pdfOnly));
  } else {
    render([], result.dormant);
    setStatus(noLeafletText(today));
  }
  if (import.meta.env.DEV) console.debug(`search took ${(performance.now() - t0).toFixed(1)} ms`);

  // Dormant stores first, so the current ones are drawn on top.
  const markers = [...result.dormant.map(dormantMarker), ...shown.map(hitMarker)];
  searchMap.last = { point: origin.point, radius, markers };
  if (tab === "search") drawMap(searchMap);
  runCards();
  runDeals();
}

/* ---------- All Extra stores ---------- */

function renderAll(): void {
  if (!data) return;
  const today = berlinToday(new Date());
  const views = listAll(data.extra, today, sort, { pdfOnly });
  const dormant = listDormant(data.extra, today, sort, { pdfOnly });
  const offerCounts = currentDealCounts();
  replaceChildren(
    allList,
    ...views.map((v) => renderRow(v, showInSearch, storeDeals(offerCounts, v.store.id))),
  );
  const since = historySince();
  fillDormant(
    allDormant,
    false,
    dormant.map((v) => dormantRow(v, since)),
  );
  const counts = {
    shown: views.length,
    hidden: pdfOnly ? listAll(data.extra, today, sort).length - views.length : 0,
    unchecked: countUnchecked(views),
  };
  allMeta.textContent =
    views.length === 0 && dormant.length > 0
      ? noLeafletStatus(latestPeriod(dormant))
      : `${listSummary(counts, pdfOnly, dormant.length)}.`;
}

function dormantRow(view: DormantView, since: string | null): HTMLLIElement {
  return renderDormant(view, {
    since,
    action: {
      label: "In Umkreissuche zeigen",
      icon: "near_me",
      onClick: () => {
        showInSearch(view.store.id);
      },
    },
  });
}

/* ---------- Export ---------- */

const EXPORT_FORMATS = ["html", "png", "pdf"] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

function isExportFormat(value: string | undefined): value is ExportFormat {
  return (EXPORT_FORMATS as readonly (string | undefined)[]).includes(value);
}

/** The list as shown (PDF switch, sort order) as a file; the renderers load on first use. */
async function exportList(format: ExportFormat): Promise<void> {
  if (!data) return;
  const [{ download, exportTable }, renderer] = await Promise.all([
    import("./export/table"),
    format === "html"
      ? import("./export/html").then((m) => m.exportHtml)
      : format === "png"
        ? import("./export/png").then((m) => m.exportPng)
        : import("./export/pdf").then((m) => m.exportPdf),
  ]);
  const today = berlinToday(new Date());
  const views = listAll(data.extra, today, sort, { pdfOnly });
  const dormant = listDormant(data.extra, today, sort, { pdfOnly });
  const options = { generatedAt: data.extra.generatedAt, today, pdfOnly, sort };
  const table = exportTable(views, dormant, options);
  download(await renderer(table), `${table.filename}.${format}`);
}

function onExportClick(event: Event): void {
  const button = event.target instanceof Element ? event.target.closest("button") : null;
  const format = button?.dataset.format;
  if (!button || !isExportFormat(format) || button.disabled) return;
  button.disabled = true;
  exportList(format)
    .catch((err: unknown) => {
      console.error(err);
      allMeta.textContent = "Der Export ist fehlgeschlagen. Bitte erneut versuchen.";
    })
    .finally(() => {
      button.disabled = false;
    });
}

/** "In Umkreissuche zeigen": search around the store's PLZ and select it on the map. */
function showInSearch(id: string): void {
  const store = data?.extra.storesById.get(id);
  if (!data || !store) return;
  tab = "search";
  tabs.select(tab);
  showPlzError(null);
  const point = data.plz.get(store.plz);
  if (point) {
    setPlzValue(store.plz);
    origin = { point, label: `um PLZ ${store.plz}`, from: `von PLZ ${store.plz}`, plz: store.plz };
  } else {
    // PLZ not in plz.json: search around the store itself (not written into the URL).
    setPlzValue("");
    origin = {
      point: [store.lat, store.lng],
      label: `um ${store.name}`,
      from: `von ${store.name}`,
      plz: null,
    };
  }
  syncUrl(true);
  runSearch();
  select(searchMap, id);
}

/* ---------- Pokémon-Angebote ---------- */

/** Load cards.json the first time the tab is shown; it is not needed for the other tabs. */
function ensureCards(): void {
  if (cardsLoading) return;
  cardsLoading = true;
  loadCards(import.meta.env.BASE_URL)
    .then((loaded) => {
      cards = loaded;
      showOffersAge(cardsAge, cardsAgeBox, loaded?.generatedAt ?? null);
      runCards();
    })
    .catch((err: unknown) => {
      console.error(err);
      setCardsStatus(
        "Die Pokémon-Angebote konnten nicht geladen werden. Bitte später erneut versuchen.",
        "error",
      );
      cardsAge.textContent = "Nicht verfügbar.";
    });
}

/* ---------- Extra-Angebote ---------- */

/**
 * Load deals.json once, after the Extra stores: the tab needs it, and the store cards of the other
 * tabs get their "N Extra-Angebote" button from it.
 */
function ensureDeals(): void {
  if (dealsLoading) return;
  dealsLoading = true;
  loadDeals(import.meta.env.BASE_URL)
    .then((loaded) => {
      deals = loaded;
      showOffersAge(dealsAge, dealsAgeBox, loaded?.generatedAt ?? null);
      runDeals();
      if (loaded) {
        runSearch(); // the store cards get their button
        if (tab === "all") renderAll();
      }
    })
    .catch((err: unknown) => {
      console.error(err);
      setDealsStatus(
        "Die Extra-Angebote konnten nicht geladen werden. Bitte später erneut versuchen.",
        "error",
      );
      dealsAge.textContent = "Nicht verfügbar.";
    });
}

/**
 * The category filter lists the categories of the offers the other filters leave, with the number
 * of offers in each. A category from the URL that no current offer has is dropped.
 */
function fillDealSections(
  known: readonly string[],
  counts: ReadonlyMap<string, number>,
  all: number,
): void {
  if (dealSection && !known.includes(dealSection)) {
    dealSection = null;
    syncUrl(false);
  }
  const sections = new Map(counts);
  if (dealSection && !sections.has(dealSection)) sections.set(dealSection, 0);
  dealsSectionSelect.setOptions(
    [
      { value: "", label: "Alle Kategorien", icon: "category", count: all },
      ...[...sections].map(([section, count]) => ({
        value: section,
        label: section,
        icon: sectionIcon(section),
        count,
      })),
    ],
    dealSection ?? "",
  );
}

function runDeals(): void {
  if (deals === undefined) return;
  if (deals === null) {
    replaceChildren(dealsList);
    setDealsStatus(DEALS_MISSING);
    return;
  }
  if (!origin) return;
  const at = origin;
  const today = berlinToday(new Date());
  // A store from the URL that has no offers (any more) is dropped.
  const store = deals.stores.find((s) => s.id === dealStore) ?? null;
  if (dealStore && !store) {
    dealStore = null;
    syncUrl(false);
  }
  dealsStoreBox.hidden = !store;
  if (store) {
    dealsStoreText.textContent = `Nur Angebote der Filiale ${store.name} (${store.plz} ${store.city}).`;
  }
  dealsCommonSwitch.disabled = dealsNearSwitch.disabled = store !== null;
  showFilterCount();
  const options = {
    sort: dealSort,
    storeId: dealStore,
    section: null,
    commonOnly: !dealsAll,
    unconfirmed: dealsUnconfirmed,
    nearKm: dealsNear ? radius : null,
  };
  // Without the category first, for the numbers in the category filter.
  const unfiltered = listDeals(deals, at.point, today, options);
  fillDealSections(
    dealSections(deals, today),
    sectionCounts(unfiltered.views),
    unfiltered.views.length,
  );
  const { extraStores, total } = unfiltered;
  const views = dealSection
    ? listDeals(deals, at.point, today, { ...options, section: dealSection }).views
    : unfiltered.views;
  replaceChildren(
    dealsList,
    ...views.map((view) =>
      renderDeal(view, extraStores, expandedDeals.has(view.offer.product.key), (key) => {
        expandedDeals.add(key);
        runDeals();
      }),
    ),
  );
  const near = dealsNear ? { radiusKm: radius, label: at.label } : null;
  setDealsStatus(dealsStatus(views.length, total, extraStores, near, at.from, store?.name ?? null));
}

/** How many settings differ from the defaults, next to "Filter und Sortierung" on phones. */
function showFilterCount(): void {
  const active = [
    dealSort !== "rabatt",
    dealSection !== null,
    dealsAll,
    dealsNear,
    dealsUnconfirmed,
  ].filter(Boolean).length;
  dealsFilterCount.hidden = active === 0;
  dealsFilterCount.textContent = String(active);
}

/** Wide screens always show the filters; phones start with them folded. */
function foldFilters(): void {
  dealsFilters.open = !narrowScreen.matches;
}

function isDealSort(value: string): value is DealSort {
  return (DEAL_SORTS as readonly string[]).includes(value);
}

function onDealsChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  } else if (target.name === "deals-sort" && isDealSort(target.value)) {
    dealSort = target.value;
  } else if (target === dealsCommonSwitch) {
    dealsAll = !target.checked;
  } else if (target === dealsNearSwitch) {
    dealsNear = target.checked;
  } else if (target === dealsUnconfirmedSwitch) {
    dealsUnconfirmed = target.checked;
  } else {
    return; // PLZ field and radius have their own handlers
  }
  syncUrl(false);
  runDeals();
}

function checkDealControls(): void {
  const radio = dealsSortGroup.querySelector<HTMLInputElement>(`input[value="${dealSort}"]`);
  if (radio) radio.checked = true;
  dealsCommonSwitch.checked = !dealsAll;
  dealsNearSwitch.checked = dealsNear;
  dealsUnconfirmedSwitch.checked = dealsUnconfirmed;
}

function renderCards(shown: CardHit[], counts: ReadonlyMap<string, number>, note?: string): void {
  cardsMap.items.clear();
  const onSelect = (id: string) => {
    select(cardsMap, id);
  };
  replaceChildren(
    cardsList,
    ...shown.map((hit) => {
      const item = renderCardStore(hit, onSelect, {
        counts,
        article,
        ...(note !== undefined && { note }),
      });
      cardsMap.items.set(hit.store.id, item);
      return item;
    }),
  );
}

function articleName(summary: ArticleSummary): string {
  const { title, subtitle } = summary.offer.product;
  return subtitle || title;
}

/** Store view or article view; the map only belongs to the store view. */
function showCardsView(): void {
  const stores = cardsView === "filialen";
  cardsStrip.hidden = !stores || cards === null;
  cardsResults.hidden = !stores;
  cardsArticles.hidden = stores;
}

function onArticleToggle(klNr: string): void {
  article = article === klNr ? null : klNr;
  syncUrl(false);
  runCards();
}

function onExpandArticle(key: string): void {
  expandedArticles.add(key);
  runCards();
}

function runCards(): void {
  if (cards === undefined) return;
  showCardsView();
  if (cards === null) {
    renderCards([], new Map());
    replaceChildren(cardsArticles);
    setCardsStatus(CARDS_MISSING);
    return;
  }
  if (!origin) return;
  const at = origin;
  const today = berlinToday(new Date());
  const summaries = summarizeArticles(cards, today);
  const counts = new Map(summaries.map((s) => [s.offer.product.key, s.storeIds.length]));
  const data = cards;

  if (cardsView === "artikel") {
    replaceChildren(
      cardsArticles,
      ...summaries.map((s) =>
        renderArticle(
          s,
          storesFor(data, s, at.point),
          expandedArticles.has(s.offer.product.key),
          onExpandArticle,
        ),
      ),
    );
    setCardsStatus(summaries.length > 0 ? articlesStatus(summaries.length, at.from) : CARDS_EMPTY);
    return;
  }

  // A filter for an article that is no longer offered is dropped.
  const selected = summaries.find((s) => s.offer.product.klNr === article) ?? null;
  if (!selected && article) {
    article = null;
    syncUrl(false);
  }
  const nearestKm = new Map(
    summaries.map((s) => [s.offer.product.key, storesFor(data, s, at.point)[0]?.distanceKm ?? 0]),
  );
  replaceChildren(
    cardsStripList,
    ...renderArticleStrip(summaries, nearestKm, article, onArticleToggle),
  );
  cardsStrip.hidden = summaries.length === 0;

  const result = searchCards(data, at.point, radius, today, article);
  const shown = result.hits.length > 0 ? result.hits : result.nearest ? [result.nearest] : [];
  const name = selected ? articleName(selected) : null;
  if (result.hits.length > 0) {
    renderCards(shown, counts);
    setCardsStatus(
      name
        ? cardsArticleStatus(name, result.hits.length, radius, at.label)
        : cardsStatus(result.hits.length, radius, at.label),
    );
  } else if (result.nearest) {
    const distance = formatKm(result.nearest.distanceKm);
    renderCards(
      shown,
      counts,
      name
        ? `Nächste Filiale mit „${name}“ außerhalb des Umkreises`
        : "Nächste Filiale mit Pokémon-Angeboten außerhalb des Umkreises",
    );
    setCardsStatus(
      name
        ? cardsArticleNearest(name, distance, radius, at.label)
        : cardsNearestStatus(distance, radius, at.label),
    );
  } else {
    renderCards([], counts);
    setCardsStatus(CARDS_EMPTY);
  }
  cardsMap.last = { point: at.point, radius, markers: shown.map(cardMarker) };
  if (tab === "cards") drawMap(cardsMap);
}

function onCardsViewChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.name !== "cards-view") return;
  cardsView = target.value === "artikel" ? "artikel" : "filialen";
  syncUrl(false);
  runCards();
}

function checkCardsView(): void {
  const radio = cardsViewGroup.querySelector<HTMLInputElement>(`input[value="${cardsView}"]`);
  if (radio) radio.checked = true;
}

/** "Stand der Angebote" of an offer tab; red when a scan was missed. */
function showOffersAge(text: HTMLElement, box: HTMLElement, generatedAt: Date | null): void {
  if (!generatedAt) {
    text.textContent = "Noch keine Daten.";
    return;
  }
  const stale = isStale(generatedAt, new Date(), CARDS_STALE_AFTER_DAYS);
  const stamp = h("time", { datetime: generatedAt.toISOString() }, formatStamp(generatedAt));
  replaceChildren(text, "Stand der Angebote: ", stamp);
  box.classList.toggle("banner--error", stale);
  if (stale) {
    text.append(
      " ",
      h(
        "strong",
        null,
        `Älter als ${String(CARDS_STALE_AFTER_DAYS)} Tage, möglicherweise veraltet.`,
      ),
    );
  }
}

/* ---------- Controls ---------- */

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

/** Render what the visible tab needs (a map must re-measure after being hidden). */
function showTab(): void {
  if (tab === "all") {
    renderAll();
  } else if (tab === "deals") {
    ensureDeals();
  } else if (tab === "cards") {
    ensureCards();
    if (cardsView === "filialen") drawMap(cardsMap);
  } else {
    drawMap(searchMap);
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
  setPlzValue(plz);
  origin = { point, label: `um PLZ ${plz}`, from: `von PLZ ${plz}`, plz };
  syncUrl(push);
  runSearch();
}

function onSubmit(this: HTMLFormElement, event: SubmitEvent): void {
  event.preventDefault();
  const input = forms.find((f) => f.form === this)?.plz;
  const plz = input?.value.trim() ?? "";
  if (!isPlz(plz)) {
    showPlzError("Bitte eine 5-stellige Postleitzahl eingeben.");
    input?.focus();
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

/** Location messages go to the status of the tab the button is on. */
function locateStatus(text: string, kind: "info" | "error" = "info"): void {
  if (tab === "cards") setCardsStatus(text, kind);
  else if (tab === "deals") setDealsStatus(text, kind);
  else setStatus(text, kind);
}

function setLocating(busy: boolean): void {
  for (const { locate } of forms) locate.disabled = busy;
}

function onLocate(): void {
  if (!("geolocation" in navigator)) {
    locateStatus("Dieser Browser unterstützt keine Standortbestimmung.", "error");
    return;
  }
  setLocating(true);
  locateStatus("Standort wird ermittelt …");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setLocating(false);
      if (!data) return;
      showPlzError(null);
      setPlzValue("");
      origin = {
        point: [pos.coords.latitude, pos.coords.longitude],
        label: "um den aktuellen Standort",
        from: "vom aktuellen Standort",
        plz: null, // never put coordinates into the URL
      };
      syncUrl(true);
      runSearch();
    },
    (err) => {
      setLocating(false);
      locateStatus(GEO_ERRORS[err.code] ?? "Der Standort konnte nicht ermittelt werden.", "error");
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
  checkRadius(value);
  if (origin) {
    syncUrl(false);
    runSearch();
  }
}

function applyQuery(): void {
  const query = parseQuery(location.search);
  radius = query.radius;
  checkRadius(radius);
  sort = query.sort;
  pdfOnly = query.pdfOnly;
  for (const box of pdfSwitches) box.checked = pdfOnly;
  cardsView = query.cardsView;
  article = query.article;
  checkCardsView();
  dealSort = query.dealSort;
  dealSection = query.dealSection;
  dealsAll = query.dealsAll;
  dealsNear = query.dealsNear;
  dealsUnconfirmed = query.dealsUnconfirmed;
  dealStore = query.dealStore;
  checkDealControls();
  const sortRadio = sortGroup.querySelector<HTMLInputElement>(`input[value="${sort}"]`);
  if (sortRadio) sortRadio.checked = true;
  tab = query.tab;
  tabs.select(tab);
  showTab();
  // Without a PLZ in the URL the default PLZ is searched, so the map and cards show right away.
  const plz = query.plz ?? DEFAULT_PLZ;
  setPlzValue(plz);
  searchPlz(plz, false);
}

/** Same "Stand der Daten" box in both Extra tabs; red when the data is stale. */
function showDataAge(extra: ExtraData): void {
  const stale = isStale(extra.generatedAt, new Date());
  for (const [text, box] of dataAgeBoxes) {
    const stamp = h(
      "time",
      { datetime: extra.generatedAt.toISOString() },
      formatStamp(extra.generatedAt),
    );
    replaceChildren(text, "Stand der Daten: ", stamp);
    box.classList.toggle("banner--error", stale);
    if (stale) {
      text.append(
        " ",
        h("strong", null, `Älter als ${String(STALE_AFTER_DAYS)} Tage, möglicherweise veraltet.`),
      );
    }
  }
}

hydrateIcons();
for (const { form, plz, locate } of forms) {
  form.addEventListener("submit", onSubmit);
  form.addEventListener("change", onRadiusChange);
  locate.addEventListener("click", onLocate);
  plz.addEventListener("input", () => {
    showPlzError(null);
  });
}
sortGroup.addEventListener("change", onSortChange);
exportGroup.addEventListener("click", onExportClick);
cardsViewGroup.addEventListener("change", onCardsViewChange);
byId("deals-form", HTMLFormElement).addEventListener("change", onDealsChange);
byId("deals-store-clear", HTMLButtonElement).addEventListener("click", () => {
  dealStore = null;
  syncUrl(false);
  runDeals();
});
narrowScreen.addEventListener("change", foldFilters);
foldFilters();
for (const box of pdfSwitches) box.addEventListener("change", onPdfOnlyChange);
window.addEventListener("popstate", applyQuery);

const initial = parseQuery(location.search);
setPlzValue(initial.plz ?? DEFAULT_PLZ);
checkRadius(initial.radius);
tabs.select(initial.tab);
for (const box of pdfSwitches) box.checked = initial.pdfOnly;
checkCardsView();
checkDealControls();

loadData(import.meta.env.BASE_URL)
  .then((loaded) => {
    data = loaded;
    showDataAge(loaded.extra);
    setStatus("");
    applyQuery();
    ensureDeals();
  })
  .catch((err: unknown) => {
    console.error(err);
    setStatus("Die Daten konnten nicht geladen werden. Bitte später erneut versuchen.", "error");
    allMeta.textContent = "Die Daten konnten nicht geladen werden.";
    allStatusBox.classList.add("banner--error");
    setCardsStatus("Die Daten konnten nicht geladen werden.", "error");
    setDealsStatus("Die Daten konnten nicht geladen werden.", "error");
  });
