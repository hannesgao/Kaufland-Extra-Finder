/**
 * Every offer of every store (`data/offers/`, schema v1): loading, runtime validation, and the
 * filters of the shopping list's offer browser. Pure apart from the `load…` functions.
 *
 * `catalog.json` has each offer once, as most stores have it, and the keys of the offers most
 * stores have (`common`). A store's file only says how the store differs: offers `added` to and
 * `missing` from the common ones, and `overrides` for fields that differ (mostly prices).
 */

import { optStr, optUrl } from "./cards";
import {
  arr,
  DataError,
  fetchJson,
  httpsUrl,
  isObject,
  isoDate,
  num,
  str,
  type IsoDate,
  type Json,
  type LatLng,
} from "./data";
import { brandDepartments, groupOf, groupsOf, guessDepartment } from "./classify";
import { mondayOf } from "./dates";
import { discountPercent } from "./deals";
import { distanceKm } from "./geo";
import { normalize } from "./text";

export { normalize };

export interface Offer {
  /** "<article number>|<first day shown>" */
  key: string;
  klNr: string;
  /** Brand, e.g. "KINDER"; empty for some fresh products. */
  title: string;
  subtitle: string;
  description?: string;
  price?: string;
  /** Kaufland's comparison price. */
  oldPrice?: string;
  unit?: string;
  /** "(1 kg = 10.38)" */
  basePrice?: string;
  /** Price with the Kaufland Card. */
  cardPrice?: string;
  cardBasePrice?: string;
  /** ["3 Stück", "entspr. pro Packg. 1.34"]: the price applies from this quantity. */
  multiBuy: string[];
  /** Days the price applies. */
  salesFrom: IsoDate;
  salesTo: IsoDate;
  thumbnail?: string;
  thumbnail2x?: string;
  /**
   * Kaufland's assortment category. Offers that are only in promotion categories get a guessed
   * one from `storeOffers`; those nothing can be said about have none.
   */
  department?: string;
  sections: string[];
}

export interface OfferStore {
  id: string;
  name: string;
  plz: string;
  city: string;
  street: string;
  lat: number;
  lng: number;
  url?: string;
  /** Number of offers in the store's file. */
  offers: number;
}

export interface OfferIndex {
  generatedAt: Date;
  stores: OfferStore[];
}

export interface OfferCatalog {
  generatedAt: Date;
  common: string[];
  /** Raw records: an offer is validated when a store's overrides have been applied. */
  products: ReadonlyMap<string, Json>;
}

export interface StoreFile {
  id: string;
  generatedAt: Date;
  added: string[];
  missing: ReadonlySet<string>;
  overrides: ReadonlyMap<string, Json>;
}

function header(raw: unknown, name: string): { obj: Json; generatedAt: Date } {
  if (!isObject(raw)) throw new DataError(`${name} must be an object`);
  if (raw.schema_version !== 1) {
    throw new DataError(`${name}: unsupported schema_version ${String(raw.schema_version)}`);
  }
  const generatedAt = new Date(str(raw, "generated_at", name));
  if (Number.isNaN(generatedAt.getTime())) throw new DataError(`${name}: bad generated_at`);
  return { obj: raw, generatedAt };
}

function strings(obj: Json, key: string, where: string): string[] {
  return arr(obj, key, where).filter((value): value is string => typeof value === "string");
}

function records(obj: Json, key: string, where: string): Map<string, Json> {
  const value = obj[key];
  if (value === undefined) return new Map();
  if (!isObject(value)) throw new DataError(`${where}: "${key}" must be an object`);
  const out = new Map<string, Json>();
  for (const [name, record] of Object.entries(value)) {
    if (!isObject(record)) throw new DataError(`${where}: ${key}["${name}"] must be an object`);
    out.set(name, record);
  }
  return out;
}

export function parseOfferIndex(raw: unknown): OfferIndex {
  const { obj, generatedAt } = header(raw, "offers/index.json");
  const stores = arr(obj, "stores", "offers/index.json").map((s, i): OfferStore => {
    const where = `offers/index.json stores[${String(i)}]`;
    if (!isObject(s)) throw new DataError(`${where} must be an object`);
    const url = s.url === undefined ? undefined : httpsUrl(s, "url", where);
    return {
      id: str(s, "id", where),
      name: str(s, "name", where),
      plz: str(s, "plz", where),
      city: str(s, "city", where),
      street: str(s, "street", where),
      lat: num(s, "lat", where),
      lng: num(s, "lng", where),
      ...(url !== undefined && { url }),
      offers: num(s, "offers", where),
    };
  });
  return { generatedAt, stores };
}

export function parseOfferCatalog(raw: unknown): OfferCatalog {
  const { obj, generatedAt } = header(raw, "offers/catalog.json");
  return {
    generatedAt,
    common: strings(obj, "common", "offers/catalog.json"),
    products: records(obj, "products", "offers/catalog.json"),
  };
}

export function parseStoreFile(raw: unknown): StoreFile {
  const { obj, generatedAt } = header(raw, "offers store file");
  return {
    id: str(obj, "id", "offers store file"),
    generatedAt,
    added: strings(obj, "added", "offers store file"),
    missing: new Set(strings(obj, "missing", "offers store file")),
    overrides: records(obj, "overrides", "offers store file"),
  };
}

/** One offer from a catalog record, with a store's overrides applied (null removes a field). */
export function parseOffer(key: string, record: Json, override?: Json): Offer {
  // A null override means that the store's offer does not have the field.
  const raw: Json = Object.fromEntries(
    Object.entries({ ...record, ...override }).filter(([, value]) => value !== null),
  );
  const where = `offer ${key}`;
  const description = optStr(raw, "description", where);
  const price = optStr(raw, "price", where);
  const oldPrice = optStr(raw, "old_price", where);
  const unit = optStr(raw, "unit", where);
  const basePrice = optStr(raw, "base_price", where);
  const cardPrice = optStr(raw, "card_price", where);
  const cardBasePrice = optStr(raw, "card_base_price", where);
  const thumbnail = optUrl(raw, "thumbnail", where);
  const thumbnail2x = optUrl(raw, "thumbnail_2x", where);
  const department = optStr(raw, "department", where);
  const sales = raw.sales_from !== undefined && raw.sales_to !== undefined;
  return {
    key,
    klNr: str(raw, "kl_nr", where),
    title: typeof raw.title === "string" ? raw.title : "",
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : "",
    ...(description !== undefined && { description }),
    ...(price !== undefined && { price }),
    ...(oldPrice !== undefined && { oldPrice }),
    ...(unit !== undefined && { unit }),
    ...(basePrice !== undefined && { basePrice }),
    ...(cardPrice !== undefined && { cardPrice }),
    ...(cardBasePrice !== undefined && { cardBasePrice }),
    multiBuy: raw.multi_buy === undefined ? [] : strings(raw, "multi_buy", where),
    salesFrom: isoDate(raw, sales ? "sales_from" : "shown_from", where),
    salesTo: isoDate(raw, sales ? "sales_to" : "shown_to", where),
    ...(thumbnail !== undefined && { thumbnail }),
    ...(thumbnail2x !== undefined && { thumbnail2x }),
    ...(department !== undefined && { department }),
    sections: raw.sections === undefined ? [] : strings(raw, "sections", where),
  };
}

const brandCache = new WeakMap<OfferCatalog, Map<string, string>>();

/** The categories of the brands whose offers Kaufland puts in one category only. */
function catalogBrands(catalog: OfferCatalog): Map<string, string> {
  let brands = brandCache.get(catalog);
  if (!brands) {
    const labelled: { title: string; department: string }[] = [];
    for (const { title, department } of catalog.products.values()) {
      if (typeof title === "string" && typeof department === "string") {
        labelled.push({ title, department });
      }
    }
    brands = brandDepartments(labelled);
    brandCache.set(catalog, brands);
  }
  return brands;
}

/**
 * The store's offers: the common ones without its missing ones, plus its added ones. Keys the
 * catalog does not know (catalog and store file from different scans) are skipped. Offers
 * without a category get a guessed one where their texts or brand allow it.
 */
export function storeOffers(catalog: OfferCatalog, file: StoreFile): Offer[] {
  const keys = [...catalog.common.filter((key) => !file.missing.has(key)), ...file.added];
  const brands = catalogBrands(catalog);
  const offers: Offer[] = [];
  for (const key of new Set(keys)) {
    const record = catalog.products.get(key);
    if (!record) continue;
    const offer = parseOffer(key, record, file.overrides.get(key));
    const department = offer.department ?? guessDepartment(offer, brands);
    offers.push(department === undefined ? offer : { ...offer, department });
  }
  return offers;
}

/** `null` while the scraper has not published the offer catalog yet. */
export async function loadOfferIndex(base: string): Promise<OfferIndex | null> {
  const url = `${base}data/offers/index.json`;
  const res = await fetch(url, { cache: "no-cache" });
  if (res.status === 404) return null;
  if (!res.ok) throw new DataError(`${url}: HTTP ${String(res.status)}`);
  return parseOfferIndex(await res.json());
}

export async function loadOfferCatalog(base: string): Promise<OfferCatalog> {
  return parseOfferCatalog(await fetchJson(`${base}data/offers/catalog.json`));
}

export async function loadStoreFile(base: string, id: string): Promise<StoreFile> {
  if (!/^[A-Z]{2}\d{3,5}$/.test(id)) throw new DataError(`bad store id ${id}`);
  return parseStoreFile(await fetchJson(`${base}data/offers/stores/${id}.json`));
}

// ---------- Choosing a store ----------

export interface StoreChoice {
  store: OfferStore;
  /** Set when the stores were ranked by distance. */
  distanceKm?: number;
}

export function nearestStores(
  stores: readonly OfferStore[],
  origin: LatLng,
  limit: number,
): StoreChoice[] {
  return stores
    .map((store) => ({ store, distanceKm: distanceKm(origin, [store.lat, store.lng]) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/** Stores whose name, city or street contains the text, or whose PLZ starts with it. */
export function findStores(
  stores: readonly OfferStore[],
  text: string,
  limit: number,
): StoreChoice[] {
  const query = normalize(text.trim());
  if (!query) return [];
  const starts = (s: OfferStore) => normalize(s.name).startsWith(query) || s.plz.startsWith(query);
  const contains = (s: OfferStore) =>
    normalize(`${s.name} ${s.city} ${s.street}`).includes(query) || s.plz.startsWith(query);
  const byName = (a: OfferStore, b: OfferStore) => a.name.localeCompare(b.name, "de");
  const first = stores.filter(starts).sort(byName);
  const rest = stores.filter((s) => contains(s) && !starts(s)).sort(byName);
  return [...first, ...rest].slice(0, limit).map((store) => ({ store }));
}

// ---------- Browsing a store's offers ----------

/** One sale week (Monday of `salesFrom`) with the days its offers cover. */
export interface OfferWeek {
  monday: IsoDate;
  from: IsoDate;
  to: IsoDate;
  count: number;
}

/** Sale weeks that have not ended, earliest first. */
export function offerWeeks(offers: readonly Offer[], today: IsoDate): OfferWeek[] {
  const weeks = new Map<IsoDate, OfferWeek>();
  for (const offer of offers) {
    if (offer.salesTo < today) continue;
    const monday = mondayOf(offer.salesFrom);
    const week = weeks.get(monday);
    if (!week) {
      weeks.set(monday, { monday, from: offer.salesFrom, to: offer.salesTo, count: 1 });
      continue;
    }
    week.count += 1;
    if (offer.salesFrom < week.from) week.from = offer.salesFrom;
    if (offer.salesTo > week.to) week.to = offer.salesTo;
  }
  return [...weeks.values()].sort((a, b) => a.monday.localeCompare(b.monday));
}

/** Kaufland's assortment categories in the order of the offer overview. */
const DEPARTMENT_ORDER = [
  "Obst, Gemüse, Pflanzen",
  "Fleisch, Geflügel, Wurst",
  "Fisch",
  "Molkereiprodukte, Fette",
  "Tiefkühlkost",
  "Feinkost, Konserven",
  "Grundnahrungsmittel",
  "Kaffee, Tee, Süßwaren, Knabberartikel",
  "Getränke, Spirituosen",
  "Drogerie, Tiernahrung",
  "Elektro, Büro, Medien",
  "Heim, Haus",
  "Bekleidung, Auto, Freizeit, Spiel",
];

/** Label for offers that are only in promotion categories. */
export const NO_DEPARTMENT = "Aktionen und Sonstiges";

export function departmentOf(offer: { department?: string }): string {
  return offer.department ?? NO_DEPARTMENT;
}

/** Sort position of a department: Kaufland's order, unknown ones after it, promotions last. */
export function departmentRank(department: string): number {
  if (department === NO_DEPARTMENT) return DEPARTMENT_ORDER.length + 1;
  const index = DEPARTMENT_ORDER.indexOf(department);
  return index === -1 ? DEPARTMENT_ORDER.length : index;
}

export function compareDepartments(a: string, b: string): number {
  return departmentRank(a) - departmentRank(b) || a.localeCompare(b, "de");
}

export const OFFER_SORTS = ["rabatt", "preis", "name"] as const;
/** Biggest discount first, lowest price first, or by name. */
export type OfferSort = (typeof OFFER_SORTS)[number];

export interface OfferFilter {
  /** Words that must all appear in brand, name or description. */
  query: string;
  /** Only this department (`NO_DEPARTMENT` for promotions); null for all. */
  department: string | null;
  /** Only this group of the department (see `groupsOf`); null for the whole department. */
  group: string | null;
  /** Only offers of the sale week starting this Monday; null for all that have not ended. */
  week: IsoDate | null;
  sort: OfferSort;
}

export function offerName(offer: { title: string; subtitle: string }): string {
  return `${offer.title} ${offer.subtitle}`.trim();
}

function amount(price: string | undefined): number {
  const value = Number(price);
  return price !== undefined && Number.isFinite(value) ? value : Infinity;
}

const ORDER: Record<OfferSort, (a: Offer, b: Offer) => number> = {
  rabatt: (a, b) =>
    (discountPercent(b.price, b.oldPrice) ?? -1) - (discountPercent(a.price, a.oldPrice) ?? -1),
  preis: (a, b) => amount(a.price) - amount(b.price),
  name: () => 0,
};

/** Offers that have not ended and pass the filter, apart from its department. */
function matching(offers: readonly Offer[], filter: OfferFilter, today: IsoDate): Offer[] {
  const words = normalize(filter.query).split(/\s+/).filter(Boolean);
  return offers.filter((offer) => {
    if (offer.salesTo < today) return false;
    if (filter.week !== null && mondayOf(offer.salesFrom) !== filter.week) return false;
    if (!words.length) return true;
    const text = normalize(`${offer.title} ${offer.subtitle} ${offer.description ?? ""}`);
    return words.every((word) => text.includes(word));
  });
}

export function filterOffers(
  offers: readonly Offer[],
  filter: OfferFilter,
  today: IsoDate,
): Offer[] {
  const byName = (a: Offer, b: Offer) => offerName(a).localeCompare(offerName(b), "de");
  const { department, group } = filter;
  return matching(offers, filter, today)
    .filter((o) => department === null || departmentOf(o) === department)
    .filter((o) => department === null || group === null || groupOf(o, department) === group)
    .sort((a, b) => ORDER[filter.sort](a, b) || byName(a, b) || a.key.localeCompare(b.key));
}

/** Departments of the offers that pass the other filters, with their number of offers. */
export function departmentCounts(
  offers: readonly Offer[],
  filter: OfferFilter,
  today: IsoDate,
): { department: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const offer of matching(offers, filter, today)) {
    const department = departmentOf(offer);
    counts.set(department, (counts.get(department) ?? 0) + 1);
  }
  return [...counts]
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => compareDepartments(a.department, b.department));
}

/**
 * The groups of the filter's department with their number of offers, in display order and
 * without empty ones. Empty when no department is chosen or it has no groups.
 */
export function groupCounts(
  offers: readonly Offer[],
  filter: OfferFilter,
  today: IsoDate,
): { group: string; count: number }[] {
  const { department } = filter;
  if (department === null) return [];
  const counts = new Map<string, number>();
  for (const offer of matching(offers, filter, today)) {
    if (departmentOf(offer) !== department) continue;
    const group = groupOf(offer, department);
    if (group !== undefined) counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return groupsOf(department)
    .map((group) => ({ group, count: counts.get(group) ?? 0 }))
    .filter(({ count }) => count > 0);
}
