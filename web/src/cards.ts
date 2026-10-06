/**
 * Trading-card offers (`cards.json`, schema v1): loading, runtime validation and the radius
 * search of the "Pokémon-Angebote" tab. Pure apart from `loadCards`.
 */

import {
  arr,
  DataError,
  httpsUrl,
  isObject,
  isoDate,
  num,
  str,
  type IsoDate,
  type Json,
  type LatLng,
} from "./data";
import { formatDay, weekdayShort } from "./dates";
import { distanceKm } from "./geo";

export interface CardProduct {
  /** "<article number>|<first day shown>" */
  key: string;
  klNr: string;
  title: string;
  subtitle: string;
  price?: string;
  unit?: string;
  /** Advertised on kaufland.de. */
  shownFrom: IsoDate;
  shownTo: IsoDate;
  /** Announced offers ("Vorwerbung") only: the actual sale. */
  salesFrom?: IsoDate;
  salesTo?: IsoDate;
  category: string;
  week: "current" | "next";
  thumbnail?: string;
  thumbnail2x?: string;
}

export interface CardStore {
  id: string;
  name: string;
  plz: string;
  city: string;
  street: string;
  lat: number;
  lng: number;
  url?: string;
  products: string[];
}

export interface CardsData {
  generatedAt: Date;
  keywords: string[];
  /** Stores whose offer overview was read. */
  storeCount: number;
  products: ReadonlyMap<string, CardProduct>;
  stores: CardStore[];
}

/** "upcoming": not on sale yet (blue); "now": on sale today (green). */
export type OfferState = "upcoming" | "now";

export interface OfferView {
  product: CardProduct;
  state: OfferState;
  /** First and last day it can be bought (the sale for announced offers). */
  from: IsoDate;
  to: IsoDate;
  /** "ab Mo, 12.10." / "bis Sa, 17.10." */
  label: string;
}

export interface CardHit {
  store: CardStore;
  distanceKm: number;
  offers: OfferView[];
}

/** One current article and the stores that offer it. */
export interface ArticleSummary {
  offer: OfferView;
  storeIds: readonly string[];
}

export interface StoreDistance {
  store: CardStore;
  distanceKm: number;
}

export interface CardSearchResult {
  hits: CardHit[];
  /** Nearest store with offers when none is within the radius. */
  nearest: CardHit | null;
}

const optStr = (obj: Json, key: string, where: string): string | undefined =>
  obj[key] === undefined ? undefined : str(obj, key, where);

const optUrl = (obj: Json, key: string, where: string): string | undefined =>
  obj[key] === undefined ? undefined : httpsUrl(obj, key, where);

function parseProduct(key: string, raw: unknown): CardProduct {
  const where = `products["${key}"]`;
  if (!isObject(raw)) throw new DataError(`${where} must be an object`);
  const week = str(raw, "week", where);
  if (week !== "current" && week !== "next") throw new DataError(`${where}: unknown week`);
  const salesFrom = raw.sales_from === undefined ? undefined : isoDate(raw, "sales_from", where);
  const salesTo = raw.sales_to === undefined ? undefined : isoDate(raw, "sales_to", where);
  return {
    key,
    klNr: str(raw, "kl_nr", where),
    // Kaufland leaves some titles empty; the subtitle then names the product.
    title: typeof raw.title === "string" ? raw.title : "",
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : "",
    ...(optStr(raw, "price", where) !== undefined && { price: str(raw, "price", where) }),
    ...(optStr(raw, "unit", where) !== undefined && { unit: str(raw, "unit", where) }),
    shownFrom: isoDate(raw, "shown_from", where),
    shownTo: isoDate(raw, "shown_to", where),
    ...(salesFrom && salesTo && { salesFrom, salesTo }),
    category: str(raw, "category", where),
    week,
    ...(optUrl(raw, "thumbnail", where) !== undefined && {
      thumbnail: httpsUrl(raw, "thumbnail", where),
    }),
    ...(optUrl(raw, "thumbnail_2x", where) !== undefined && {
      thumbnail2x: httpsUrl(raw, "thumbnail_2x", where),
    }),
  };
}

function parseStore(raw: unknown, index: number, products: ReadonlyMap<string, CardProduct>) {
  const where = `stores[${String(index)}]`;
  if (!isObject(raw)) throw new DataError(`${where} must be an object`);
  const keys = arr(raw, "products", where).map((k) => {
    if (typeof k !== "string" || !products.has(k)) {
      throw new DataError(`${where}: unknown product ${String(k)}`);
    }
    return k;
  });
  const store: CardStore = {
    id: str(raw, "id", where),
    name: str(raw, "name", where),
    plz: str(raw, "plz", where),
    city: str(raw, "city", where),
    street: str(raw, "street", where),
    lat: num(raw, "lat", where),
    lng: num(raw, "lng", where),
    products: keys,
  };
  const url = optUrl(raw, "url", where);
  return url ? { ...store, url } : store;
}

export function parseCards(raw: unknown): CardsData {
  if (!isObject(raw)) throw new DataError("cards.json must be an object");
  if (raw.schema_version !== 1) {
    throw new DataError(`cards.json: unsupported schema_version ${String(raw.schema_version)}`);
  }
  const generatedAt = new Date(str(raw, "generated_at", "cards.json"));
  if (Number.isNaN(generatedAt.getTime())) throw new DataError("cards.json: bad generated_at");
  if (!isObject(raw.products)) throw new DataError('cards.json: "products" must be an object');
  const products = new Map(
    Object.entries(raw.products).map(([key, value]) => [key, parseProduct(key, value)]),
  );
  return {
    generatedAt,
    keywords: arr(raw, "keywords", "cards.json").filter((k) => typeof k === "string"),
    storeCount: num(raw, "store_count", "cards.json"),
    products,
    stores: arr(raw, "stores", "cards.json").map((s, i) => parseStore(s, i, products)),
  };
}

/** `null` while the scraper has not published any card offers yet (no cards.json). */
export async function loadCards(base: string): Promise<CardsData | null> {
  const url = `${base}data/cards.json`;
  const res = await fetch(url, { cache: "no-cache" });
  if (res.status === 404) return null;
  if (!res.ok) throw new DataError(`${url}: HTTP ${String(res.status)}`);
  return parseCards(await res.json());
}

/** When it can be bought, relative to `today`; null once it is over. */
export function viewOffer(product: CardProduct, today: IsoDate): OfferView | null {
  const from = product.salesFrom ?? product.shownFrom;
  const to = product.salesTo ?? product.shownTo;
  if (to < today) return null;
  const state: OfferState = from > today ? "upcoming" : "now";
  const day = state === "upcoming" ? from : to;
  const label = `${state === "upcoming" ? "ab" : "bis"} ${weekdayShort(day)}, ${formatDay(day)}`;
  return { product, state, from, to, label };
}

function storeOffers(data: CardsData, store: CardStore, today: IsoDate): OfferView[] {
  return store.products
    .map((key) => data.products.get(key))
    .filter((p): p is CardProduct => p !== undefined)
    .map((p) => viewOffer(p, today))
    .filter((v): v is OfferView => v !== null)
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        `${a.product.title} ${a.product.subtitle}`.localeCompare(
          `${b.product.title} ${b.product.subtitle}`,
          "de",
        ),
    );
}

/**
 * Stores with current or upcoming card offers within `radiusKm`, nearest first. With `article`
 * (Kaufland article number), only stores that offer it.
 */
export function searchCards(
  data: CardsData,
  origin: LatLng,
  radiusKm: number,
  today: IsoDate,
  article: string | null = null,
): CardSearchResult {
  const all: CardHit[] = [];
  for (const store of data.stores) {
    const offers = storeOffers(data, store, today);
    if (offers.length === 0) continue;
    if (article && !offers.some((o) => o.product.klNr === article)) continue;
    all.push({ store, distanceKm: distanceKm(origin, [store.lat, store.lng]), offers });
  }
  all.sort((a, b) => a.distanceKm - b.distanceKm);
  const hits = all.filter((h) => h.distanceKm <= radiusKm);
  return { hits, nearest: hits.length === 0 ? (all[0] ?? null) : null };
}

/** Current and upcoming articles with their stores: fewest stores first, then by start date. */
export function summarizeArticles(data: CardsData, today: IsoDate): ArticleSummary[] {
  const stores = new Map<string, string[]>();
  for (const store of data.stores) {
    for (const key of store.products) stores.set(key, [...(stores.get(key) ?? []), store.id]);
  }
  const summaries: ArticleSummary[] = [];
  for (const [key, storeIds] of stores) {
    const product = data.products.get(key);
    const offer = product && viewOffer(product, today);
    if (offer) summaries.push({ offer, storeIds });
  }
  return summaries.sort(
    (a, b) =>
      a.storeIds.length - b.storeIds.length ||
      a.offer.from.localeCompare(b.offer.from) ||
      a.offer.product.subtitle.localeCompare(b.offer.product.subtitle, "de"),
  );
}

/** The stores offering an article, nearest to `origin` first (no radius: rare articles may be far). */
export function storesFor(
  data: CardsData,
  summary: ArticleSummary,
  origin: LatLng,
): StoreDistance[] {
  const ids = new Set(summary.storeIds);
  return data.stores
    .filter((s) => ids.has(s.id))
    .map((store) => ({ store, distanceKm: distanceKm(origin, [store.lat, store.lng]) }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}
