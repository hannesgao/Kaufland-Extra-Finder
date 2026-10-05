/** Pure search logic: which Extra stores are near a point, and what to show for each. */

import type { ExtraData, IsoDate, LatLng, Leaflet, SpecialDay, Store } from "./data";
import { dateRange, formatDate, formatRange, leafletLabel, weekdayName } from "./dates";
import { distanceKm } from "./geo";

export const RADII = [10, 25, 50, 100] as const;
export type Radius = (typeof RADII)[number];

export interface DayLabel {
  weekday: string;
  date: string;
}

export interface LeafletView {
  leaflet: Leaflet;
  label: string; // "Diese Woche" / "Ab Donnerstag"
  range: string; // "08.10.–14.10.2026"
  /** Already valid today (otherwise it starts in the future). */
  running: boolean;
  /** Start and end, e.g. { weekday: "Donnerstag", date: "08.10.2026" }. */
  from: DayLabel;
  to: DayLabel;
  /** Days within the remaining validity on which the store is closed. */
  closedDays: IsoDate[];
  /** Shortened/extended hours within the remaining validity. */
  specialHours: Extract<SpecialDay, { closed: false }>[];
  /** Closed on every remaining day of this leaflet. */
  unusable: boolean;
  /** Other stores with the identical leaflet (same PDF). */
  siblings: Store[];
}

/** A store with its non-expired Extra leaflets. */
export interface StoreView {
  store: Store;
  leaflets: LeafletView[];
  /** Closed for the whole remaining validity of all its leaflets. */
  closed: boolean;
  /** Every leaflet's PDF names a different store (see the scraper's PDF check). */
  foreignOnly: boolean;
}

export interface Hit extends StoreView {
  distanceKm: number;
}

export const SORT_ORDERS = ["plz-asc", "plz-desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export interface SearchResult {
  hits: Hit[];
  /** Nearest store outside the radius, only set when `hits` is empty. */
  nearest: Hit | null;
}

function viewLeaflet(store: Store, leaflet: Leaflet, today: IsoDate, data: ExtraData): LeafletView {
  const start = leaflet.validFrom > today ? leaflet.validFrom : today;
  const days = new Set(dateRange(start, leaflet.validTo));
  const relevant = store.specialDays.filter((d) => days.has(d.date));
  const closedDays = relevant.filter((d) => d.closed).map((d) => d.date);
  const siblings = (data.clusters.get(leaflet.cluster) ?? [])
    .filter((id) => id !== store.id)
    .map((id) => data.storesById.get(id))
    .filter((s): s is Store => s !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  return {
    leaflet,
    label: leafletLabel(leaflet.validFrom, today),
    range: formatRange(leaflet.validFrom, leaflet.validTo),
    running: leaflet.validFrom <= today,
    from: { weekday: weekdayName(leaflet.validFrom), date: formatDate(leaflet.validFrom) },
    to: { weekday: weekdayName(leaflet.validTo), date: formatDate(leaflet.validTo) },
    closedDays,
    specialHours: relevant.filter((d): d is Extract<SpecialDay, { closed: false }> => !d.closed),
    unusable: closedDays.length === days.size,
    siblings,
  };
}

/** A store with its non-expired leaflets, or null if all of them have expired. */
export function describeStore(store: Store, today: IsoDate, data: ExtraData): StoreView | null {
  const leaflets = store.leaflets
    .filter((l) => l.validTo >= today)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom))
    .map((l) => viewLeaflet(store, l, today, data));
  if (leaflets.length === 0) return null;
  return {
    store,
    leaflets,
    closed: leaflets.every((l) => l.unusable),
    foreignOnly: leaflets.every((l) => l.leaflet.pdfStoreMatch === false),
  };
}

export function toHit(store: Store, origin: LatLng, today: IsoDate, data: ExtraData): Hit | null {
  const view = describeStore(store, today, data);
  return view && { ...view, distanceKm: distanceKm(origin, [store.lat, store.lng]) };
}

/** All stores with a current or upcoming Extra leaflet, sorted by PLZ (then name). */
export function listAll(data: ExtraData, today: IsoDate, order: SortOrder): StoreView[] {
  const direction = order === "plz-asc" ? 1 : -1;
  return data.stores
    .map((s) => describeStore(s, today, data))
    .filter((v): v is StoreView => v !== null)
    .sort(
      (a, b) =>
        direction * a.store.plz.localeCompare(b.store.plz) ||
        a.store.name.localeCompare(b.store.name, "de"),
    );
}

/** Open stores first, then by distance. */
function compareHits(a: Hit, b: Hit): number {
  return Number(a.closed) - Number(b.closed) || a.distanceKm - b.distanceKm;
}

export function search(
  data: ExtraData,
  origin: LatLng,
  radiusKm: number,
  today: IsoDate,
): SearchResult {
  const all = data.stores
    .map((s) => toHit(s, origin, today, data))
    .filter((h): h is Hit => h !== null);
  const hits = all.filter((h) => h.distanceKm <= radiusKm).sort(compareHits);
  if (hits.length > 0) return { hits, nearest: null };
  const nearest = all.sort(compareHits)[0] ?? null;
  return { hits, nearest };
}
