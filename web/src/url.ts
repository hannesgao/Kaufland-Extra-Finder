/**
 * Search state <-> URL query (`?plz=76137&r=25&tab=all&sort=plz-desc`).
 * Defaults are omitted. Coordinates are never put into the URL.
 */

import { RADII, SORT_ORDERS, type Radius, type SortOrder } from "./search";

/** Searched on page load when the URL has no PLZ (Karlsruhe city centre). */
export const DEFAULT_PLZ = "76131";
export const DEFAULT_RADIUS: Radius = 25;
export const TABS = ["search", "all"] as const;
export type Tab = (typeof TABS)[number];
const PLZ = /^\d{5}$/;

export interface QueryState {
  plz: string | null;
  radius: Radius;
  tab: Tab;
  sort: SortOrder;
}

export function isPlz(value: string): boolean {
  return PLZ.test(value);
}

export function isRadius(value: number): value is Radius {
  return (RADII as readonly number[]).includes(value);
}

function oneOf<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return (values as readonly (string | null)[]).includes(value) ? (value as T) : fallback;
}

export function parseQuery(search: string): QueryState {
  const params = new URLSearchParams(search);
  const plz = params.get("plz")?.trim() ?? "";
  const radius = Number(params.get("r"));
  return {
    plz: isPlz(plz) ? plz : null,
    radius: isRadius(radius) ? radius : DEFAULT_RADIUS,
    tab: oneOf(TABS, params.get("tab"), "search"),
    sort: oneOf(SORT_ORDERS, params.get("sort"), "plz-asc"),
  };
}

export function buildQuery(state: QueryState): string {
  const params = new URLSearchParams();
  if (state.plz && state.plz !== DEFAULT_PLZ) params.set("plz", state.plz);
  if (state.radius !== DEFAULT_RADIUS) params.set("r", String(state.radius));
  if (state.tab !== "search") params.set("tab", state.tab);
  if (state.sort !== "plz-asc") params.set("sort", state.sort);
  const query = params.toString();
  return query ? `?${query}` : "";
}
