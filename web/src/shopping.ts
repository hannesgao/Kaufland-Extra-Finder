/**
 * The shopping list: offers of one store plus free-text entries, kept in the browser's local
 * storage only. Pure apart from `loadList`/`saveList`, which take the storage to use.
 *
 * An offer entry keeps a copy of the offer as it was when added, so the list still prints when
 * the offer data has moved on; `itemStatus` compares the copy with the current data.
 */

import type { IsoDate } from "./data";
import { compareDepartments, departmentOf, NO_DEPARTMENT, type Offer } from "./offers";

export const STORAGE_KEY = "kef.einkaufszettel.v1";
export const MAX_ITEMS = 200;
export const MAX_QUANTITY = 99;
export const MAX_TEXT = 80;
export const MAX_NOTE = 120;

export const LAYOUTS = ["kacheln", "liste"] as const;
/** Printed as clippings with large pictures, or as compact rows. */
export type Layout = (typeof LAYOUTS)[number];

export interface ListStore {
  id: string;
  name: string;
  street: string;
  plz: string;
  city: string;
}

export interface ListItem {
  id: string;
  quantity: number;
  note: string;
  /** The offer as it was when it was added or last updated; absent for free-text entries. */
  offer?: Offer;
  /** Free-text entries only. */
  text?: string;
}

export interface ShoppingList {
  store: ListStore | null;
  items: ListItem[];
  layout: Layout;
}

export function emptyList(): ShoppingList {
  return { store: null, items: [], layout: "kacheln" };
}

// ---------- Storage ----------

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max = 300): string | undefined {
  return typeof value === "string" && value !== "" ? value.slice(0, max) : undefined;
}

/** Image URLs are rendered into `src`: https only, like the validated offer data. */
function imageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function storedOffer(raw: unknown): Offer | undefined {
  if (!isRecord(raw)) return undefined;
  const { key, klNr, salesFrom, salesTo } = raw;
  if (typeof key !== "string" || typeof klNr !== "string") return undefined;
  if (typeof salesFrom !== "string" || !ISO.test(salesFrom)) return undefined;
  if (typeof salesTo !== "string" || !ISO.test(salesTo)) return undefined;
  const optional = {
    description: text(raw.description),
    price: text(raw.price, 20),
    oldPrice: text(raw.oldPrice, 20),
    unit: text(raw.unit, 80),
    basePrice: text(raw.basePrice, 80),
    cardPrice: text(raw.cardPrice, 20),
    cardBasePrice: text(raw.cardBasePrice, 80),
    thumbnail: imageUrl(raw.thumbnail),
    thumbnail2x: imageUrl(raw.thumbnail2x),
    department: text(raw.department, 80),
  };
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return {
    key,
    klNr,
    title: typeof raw.title === "string" ? raw.title : "",
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : "",
    multiBuy: strings(raw.multiBuy),
    salesFrom,
    salesTo,
    sections: strings(raw.sections),
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
  };
}

function storedItem(raw: unknown): ListItem | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string") return undefined;
  const quantity = Number(raw.quantity);
  const base = {
    id: raw.id,
    quantity: Number.isInteger(quantity) ? Math.min(Math.max(quantity, 1), MAX_QUANTITY) : 1,
    note: typeof raw.note === "string" ? raw.note.slice(0, MAX_NOTE) : "",
  };
  const offer = storedOffer(raw.offer);
  if (offer) return { ...base, offer };
  const entry = text(raw.text, MAX_TEXT);
  return entry === undefined ? undefined : { ...base, text: entry };
}

function storedStore(raw: unknown): ListStore | null {
  if (!isRecord(raw)) return null;
  const { id, name, street, plz, city } = raw;
  if (typeof id !== "string" || !/^[A-Z]{2}\d{3,5}$/.test(id)) return null;
  if (typeof name !== "string" || typeof street !== "string") return null;
  if (typeof plz !== "string" || typeof city !== "string") return null;
  return { id, name, street, plz, city };
}

/** What is stored, or an empty list. Anything unreadable is dropped, never thrown. */
export function parseList(json: string | null): ShoppingList {
  if (!json) return emptyList();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return emptyList();
  }
  if (!isRecord(raw)) return emptyList();
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    store: storedStore(raw.store),
    items: items
      .map(storedItem)
      .filter((item): item is ListItem => item !== undefined)
      .slice(0, MAX_ITEMS),
    layout: (LAYOUTS as readonly unknown[]).includes(raw.layout)
      ? (raw.layout as Layout)
      : "kacheln",
  };
}

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

/** An empty list when the storage is unavailable (private mode, blocked site data). */
export function loadList(storage: Reader | null): ShoppingList {
  try {
    return parseList(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return emptyList();
  }
}

/** False when the list could not be stored; it then lasts until the page is closed. */
export function saveList(storage: Writer | null, list: ShoppingList): boolean {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(list));
    return storage !== null;
  } catch {
    return false;
  }
}

// ---------- Editing (all return a new list) ----------

export function itemCount(list: ShoppingList): number {
  return list.items.length;
}

export function hasOffer(list: ShoppingList, key: string): boolean {
  return list.items.some((item) => item.offer?.key === key);
}

export function isFull(list: ShoppingList): boolean {
  return list.items.length >= MAX_ITEMS;
}

function withItems(list: ShoppingList, items: ListItem[]): ShoppingList {
  return { ...list, items };
}

/** Adds the offer once; a full list or an offer that is already on it stays as it is. */
export function addOffer(list: ShoppingList, offer: Offer, id: string): ShoppingList {
  if (isFull(list) || hasOffer(list, offer.key)) return list;
  return withItems(list, [...list.items, { id, quantity: 1, note: "", offer }]);
}

export function addText(list: ShoppingList, entry: string, id: string): ShoppingList {
  const value = entry.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
  if (!value || isFull(list)) return list;
  return withItems(list, [...list.items, { id, quantity: 1, note: "", text: value }]);
}

export function removeItem(list: ShoppingList, id: string): ShoppingList {
  return withItems(
    list,
    list.items.filter((item) => item.id !== id),
  );
}

export function removeOffer(list: ShoppingList, key: string): ShoppingList {
  return withItems(
    list,
    list.items.filter((item) => item.offer?.key !== key),
  );
}

function update(
  list: ShoppingList,
  id: string,
  change: (item: ListItem) => ListItem,
): ShoppingList {
  return withItems(
    list,
    list.items.map((item) => (item.id === id ? change(item) : item)),
  );
}

export function setQuantity(list: ShoppingList, id: string, quantity: number): ShoppingList {
  const value = Math.min(Math.max(Math.round(quantity) || 1, 1), MAX_QUANTITY);
  return update(list, id, (item) => ({ ...item, quantity: value }));
}

export function setNote(list: ShoppingList, id: string, note: string): ShoppingList {
  return update(list, id, (item) => ({ ...item, note: note.slice(0, MAX_NOTE) }));
}

/** Replace the copy of an offer with the current one (after a price change). */
export function refreshOffer(list: ShoppingList, id: string, offer: Offer): ShoppingList {
  return update(list, id, (item) => ({ ...item, offer }));
}

export function clearList(list: ShoppingList): ShoppingList {
  return withItems(list, []);
}

export function setStore(list: ShoppingList, store: ListStore): ShoppingList {
  return { ...list, store };
}

export function setLayout(list: ShoppingList, layout: Layout): ShoppingList {
  return { ...list, layout };
}

// ---------- Comparing with the current offers ----------

export type ItemStatus =
  /** Free text, or an offer that is unchanged in the current data. */
  | { kind: "ok" }
  /** The sale has ended. */
  | { kind: "expired" }
  /** Not ended, but the store's current offers no longer have it. */
  | { kind: "gone" }
  /** Still offered at another price (or other dates): `current` is the offer now. */
  | { kind: "changed"; current: Offer };

const COMPARED = ["price", "oldPrice", "cardPrice", "salesFrom", "salesTo"] as const;

/**
 * `current` holds the store's offers by key, or null while they are not loaded (then only the
 * dates can be judged).
 */
export function itemStatus(
  item: ListItem,
  current: ReadonlyMap<string, Offer> | null,
  today: IsoDate,
): ItemStatus {
  const { offer } = item;
  if (!offer) return { kind: "ok" };
  if (offer.salesTo < today) return { kind: "expired" };
  if (!current) return { kind: "ok" };
  const now = current.get(offer.key);
  if (!now) return { kind: "gone" };
  return COMPARED.some((field) => now[field] !== offer[field])
    ? { kind: "changed", current: now }
    : { kind: "ok" };
}

// ---------- Printing ----------

export interface ItemGroup {
  /** Kaufland's assortment category, `NO_DEPARTMENT`, or `OWN_ENTRIES`. */
  title: string;
  items: ListItem[];
}

export const OWN_ENTRIES = "Eigene Einträge";

/** Items by department in Kaufland's order, free-text entries last; list order within a group. */
export function groupItems(items: readonly ListItem[]): ItemGroup[] {
  const groups = new Map<string, ListItem[]>();
  for (const item of items) {
    const title = item.offer ? departmentOf(item.offer) : OWN_ENTRIES;
    groups.set(title, [...(groups.get(title) ?? []), item]);
  }
  const rank = (title: string) => (title === OWN_ENTRIES ? 1 : 0);
  return [...groups]
    .map(([title, grouped]) => ({ title, items: grouped }))
    .sort((a, b) => rank(a.title) - rank(b.title) || compareDepartments(a.title, b.title));
}

export { NO_DEPARTMENT };
