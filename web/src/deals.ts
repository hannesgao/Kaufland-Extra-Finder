/**
 * Offers of the Extra leaflets (`deals.json`, schema v1): loading, runtime validation and the
 * list of the "Extra-Angebote" tab. Pure apart from `loadDeals`.
 */

import { optStr, optUrl, viewOffer, type OfferView } from "./cards";
import {
  arr,
  DataError,
  httpsUrl,
  isObject,
  isoDate,
  num,
  str,
  type IsoDate,
  type LatLng,
} from "./data";
import { distanceKm } from "./geo";

export interface DealProduct {
  /** "<article number>|<first day shown>" */
  key: string;
  klNr: string;
  title: string;
  subtitle: string;
  /** The price most stores have; a store with another price has it in `DealStore.prices`. */
  price?: string;
  /** Kaufland's comparison price. */
  oldPrice?: string;
  unit?: string;
  shownFrom: IsoDate;
  shownTo: IsoDate;
  salesFrom?: IsoDate;
  salesTo?: IsoDate;
  /** Kaufland's categories that list it, e.g. "Molkereiprodukte, Fette". */
  sections: string[];
  /** Stores not named by an Extra PDF that have the offer as well. */
  otherStores: number;
  thumbnail?: string;
  thumbnail2x?: string;
}

export interface DealStore {
  id: string;
  name: string;
  plz: string;
  city: string;
  street: string;
  lat: number;
  lng: number;
  url?: string;
  products: string[];
  /** Prices that differ from the product's. */
  prices: ReadonlyMap<string, string>;
  /** Offers listed although their title was not found in the store's leaflet PDF. */
  unconfirmed: ReadonlySet<string>;
}

export interface DealsData {
  generatedAt: Date;
  /** Stores whose offer overview was read, and those of them named by an Extra PDF. */
  storeCount: number;
  extraStoreCount: number;
  products: ReadonlyMap<string, DealProduct>;
  stores: DealStore[];
}

export const DEAL_SORTS = ["rabatt", "filialen", "preis"] as const;
/** Biggest discount first, most stores first, or lowest price first. */
export type DealSort = (typeof DEAL_SORTS)[number];

export interface DealOptions {
  sort: DealSort;
  /** Only this category. */
  section: string | null;
  /** Only offers that at least half of the Extra stores have. */
  commonOnly: boolean;
  /** Also offers whose title was not found in the store's leaflet PDF. */
  unconfirmed: boolean;
  /** Only stores within this radius of the origin. */
  nearKm: number | null;
}

export interface DealStoreView {
  store: DealStore;
  distanceKm: number;
  /** The store's price, when the offer has one. */
  price?: string;
  unconfirmed: boolean;
}

/** One offer and the stores that have it, nearest first. */
export interface DealView {
  offer: OfferView<DealProduct>;
  stores: DealStoreView[];
  /** Stores with the offer nationwide (not only the listed ones). */
  storeCount: number;
  /** Lowest and highest price among the listed stores. */
  priceFrom?: string;
  priceTo?: string;
  /** Discount of `priceFrom` against Kaufland's comparison price, in percent. */
  discount: number | null;
}

export interface DealList {
  views: DealView[];
  /** Extra stores with at least one current offer. */
  extraStores: number;
  /** Current offers before the filters. */
  total: number;
}

function parseProduct(key: string, raw: unknown): DealProduct {
  const where = `products["${key}"]`;
  if (!isObject(raw)) throw new DataError(`${where} must be an object`);
  const salesFrom = raw.sales_from === undefined ? undefined : isoDate(raw, "sales_from", where);
  const salesTo = raw.sales_to === undefined ? undefined : isoDate(raw, "sales_to", where);
  const price = optStr(raw, "price", where);
  const oldPrice = optStr(raw, "old_price", where);
  const unit = optStr(raw, "unit", where);
  const thumbnail = optUrl(raw, "thumbnail", where);
  const thumbnail2x = optUrl(raw, "thumbnail_2x", where);
  return {
    key,
    klNr: str(raw, "kl_nr", where),
    title: typeof raw.title === "string" ? raw.title : "",
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : "",
    ...(price !== undefined && { price }),
    ...(oldPrice !== undefined && { oldPrice }),
    ...(unit !== undefined && { unit }),
    shownFrom: isoDate(raw, "shown_from", where),
    shownTo: isoDate(raw, "shown_to", where),
    ...(salesFrom && salesTo && { salesFrom, salesTo }),
    sections: arr(raw, "sections", where).filter((s) => typeof s === "string"),
    otherStores: num(raw, "other_stores", where),
    ...(thumbnail !== undefined && { thumbnail }),
    ...(thumbnail2x !== undefined && { thumbnail2x }),
  };
}

function parseStore(
  raw: unknown,
  index: number,
  products: ReadonlyMap<string, DealProduct>,
): DealStore {
  const where = `stores[${String(index)}]`;
  if (!isObject(raw)) throw new DataError(`${where} must be an object`);
  const known = (key: unknown): string => {
    if (typeof key !== "string" || !products.has(key)) {
      throw new DataError(`${where}: unknown product ${String(key)}`);
    }
    return key;
  };
  const prices = new Map<string, string>();
  if (raw.prices !== undefined) {
    if (!isObject(raw.prices)) throw new DataError(`${where}: "prices" must be an object`);
    for (const [key, price] of Object.entries(raw.prices)) {
      if (typeof price !== "string") throw new DataError(`${where}: bad price for ${key}`);
      prices.set(known(key), price);
    }
  }
  const unconfirmed = raw.unconfirmed === undefined ? [] : arr(raw, "unconfirmed", where);
  const url = raw.url === undefined ? undefined : httpsUrl(raw, "url", where);
  return {
    id: str(raw, "id", where),
    name: str(raw, "name", where),
    plz: str(raw, "plz", where),
    city: str(raw, "city", where),
    street: str(raw, "street", where),
    lat: num(raw, "lat", where),
    lng: num(raw, "lng", where),
    ...(url !== undefined && { url }),
    products: arr(raw, "products", where).map(known),
    prices,
    unconfirmed: new Set(unconfirmed.map(known)),
  };
}

export function parseDeals(raw: unknown): DealsData {
  if (!isObject(raw)) throw new DataError("deals.json must be an object");
  if (raw.schema_version !== 1) {
    throw new DataError(`deals.json: unsupported schema_version ${String(raw.schema_version)}`);
  }
  const generatedAt = new Date(str(raw, "generated_at", "deals.json"));
  if (Number.isNaN(generatedAt.getTime())) throw new DataError("deals.json: bad generated_at");
  if (!isObject(raw.products)) throw new DataError('deals.json: "products" must be an object');
  const products = new Map(
    Object.entries(raw.products).map(([key, value]) => [key, parseProduct(key, value)]),
  );
  return {
    generatedAt,
    storeCount: num(raw, "store_count", "deals.json"),
    extraStoreCount: num(raw, "extra_store_count", "deals.json"),
    products,
    stores: arr(raw, "stores", "deals.json").map((s, i) => parseStore(s, i, products)),
  };
}

/** `null` while the scraper has not published any Extra offers yet (no deals.json). */
export async function loadDeals(base: string): Promise<DealsData | null> {
  const url = `${base}data/deals.json`;
  const res = await fetch(url, { cache: "no-cache" });
  if (res.status === 404) return null;
  if (!res.ok) throw new DataError(`${url}: HTTP ${String(res.status)}`);
  return parseDeals(await res.json());
}

/** "2.99" -> 2.99; null when it is not a number. */
function amount(price: string | undefined): number | null {
  const value = Number(price);
  return price !== undefined && Number.isFinite(value) ? value : null;
}

/** Discount in percent, rounded: 0.59 instead of 1.49 is 60. Null without both prices. */
export function discountPercent(
  price: string | undefined,
  oldPrice: string | undefined,
): number | null {
  const now = amount(price);
  const before = amount(oldPrice);
  if (now === null || before === null || before <= 0 || now >= before) return null;
  return Math.round((1 - now / before) * 100);
}

function name(product: DealProduct): string {
  return `${product.title} ${product.subtitle}`.trim();
}

const ORDER: Record<DealSort, (a: DealView, b: DealView) => number> = {
  rabatt: (a, b) => (b.discount ?? -1) - (a.discount ?? -1) || b.storeCount - a.storeCount,
  filialen: (a, b) => b.storeCount - a.storeCount || (b.discount ?? -1) - (a.discount ?? -1),
  preis: (a, b) =>
    (amount(a.priceFrom) ?? Infinity) - (amount(b.priceFrom) ?? Infinity) ||
    b.storeCount - a.storeCount,
};

/** Categories of the current offers, alphabetically, for the filter. */
export function dealSections(data: DealsData, today: IsoDate): string[] {
  const sections = new Set<string>();
  for (const product of data.products.values()) {
    if (viewOffer(product, today)) for (const s of product.sections) sections.add(s);
  }
  return [...sections].sort((a, b) => a.localeCompare(b, "de"));
}

/**
 * Current and upcoming offers with their stores (nearest to `origin` first). "In N of M stores"
 * counts every Extra store, also with `nearKm`, which only limits the stores that are listed.
 */
export function listDeals(
  data: DealsData,
  origin: LatLng,
  today: IsoDate,
  options: DealOptions,
): DealList {
  const byProduct = new Map<string, DealStoreView[]>();
  const extraStores = new Set<string>();
  for (const store of data.stores) {
    const distance = distanceKm(origin, [store.lat, store.lng]);
    for (const key of store.products) {
      const product = data.products.get(key);
      if (!product || !viewOffer(product, today)) continue;
      extraStores.add(store.id);
      const unconfirmed = store.unconfirmed.has(key);
      if (unconfirmed && !options.unconfirmed) continue;
      const price = store.prices.get(key) ?? product.price;
      const view = {
        store,
        distanceKm: distance,
        unconfirmed,
        ...(price !== undefined && { price }),
      };
      byProduct.set(key, [...(byProduct.get(key) ?? []), view]);
    }
  }
  const views: DealView[] = [];
  for (const [key, all] of byProduct) {
    const product = data.products.get(key);
    const offer = product && viewOffer(product, today);
    if (!product || !offer) continue;
    if (options.section && !product.sections.includes(options.section)) continue;
    if (options.commonOnly && all.length * 2 < extraStores.size) continue;
    const stores = all
      .filter((s) => options.nearKm === null || s.distanceKm <= options.nearKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
    if (stores.length === 0) continue;
    const prices = stores
      .map((s) => s.price)
      .filter((p): p is string => amount(p) !== null)
      .sort((a, b) => Number(a) - Number(b));
    const priceFrom = prices[0];
    const priceTo = prices.at(-1);
    views.push({
      offer,
      stores,
      storeCount: all.length,
      ...(priceFrom !== undefined && { priceFrom }),
      ...(priceTo !== undefined && { priceTo }),
      discount: discountPercent(priceFrom, product.oldPrice),
    });
  }
  views.sort(
    (a, b) =>
      ORDER[options.sort](a, b) || name(a.offer.product).localeCompare(name(b.offer.product), "de"),
  );
  return { views, extraStores: extraStores.size, total: byProduct.size };
}
