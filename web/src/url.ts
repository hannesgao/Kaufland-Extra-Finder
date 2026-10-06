/**
 * Search state <-> URL query (`?plz=76137&r=25&tab=all&sort=plz-desc&pdf=all`;
 * Pokémon tab: `tab=cards&view=artikel&p=20973794`).
 * Defaults are omitted. Coordinates are never put into the URL.
 */

import { RADII, SORT_ORDERS, type Radius, type SortOrder } from "./search";

/** Searched on page load when the URL has no PLZ (Karlsruhe city centre). */
export const DEFAULT_PLZ = "76131";
export const DEFAULT_RADIUS: Radius = 25;
export const TABS = ["search", "all", "cards"] as const;
export type Tab = (typeof TABS)[number];
export const CARDS_VIEWS = ["filialen", "artikel"] as const;
/** Pokémon tab: stores near the PLZ, or one card per article with all its stores. */
export type CardsView = (typeof CARDS_VIEWS)[number];
const PLZ = /^\d{5}$/;
const ARTICLE = /^\d{6,10}$/;

export interface QueryState {
  plz: string | null;
  radius: Radius;
  tab: Tab;
  sort: SortOrder;
  /** Only leaflets that the PDF itself confirms for the store. On by default; `?pdf=all` turns it off. */
  pdfOnly: boolean;
  cardsView: CardsView;
  /** Pokémon tab, store view: only stores offering this article (Kaufland article number). */
  article: string | null;
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
    pdfOnly: params.get("pdf") !== "all",
    cardsView: oneOf(CARDS_VIEWS, params.get("view"), "filialen"),
    article: ARTICLE.test(params.get("p") ?? "") ? params.get("p") : null,
  };
}

export function buildQuery(state: QueryState): string {
  const params = new URLSearchParams();
  if (state.plz && state.plz !== DEFAULT_PLZ) params.set("plz", state.plz);
  if (state.radius !== DEFAULT_RADIUS) params.set("r", String(state.radius));
  if (state.tab !== "search") params.set("tab", state.tab);
  if (state.sort !== "plz-asc") params.set("sort", state.sort);
  if (!state.pdfOnly) params.set("pdf", "all");
  if (state.cardsView !== "filialen") params.set("view", state.cardsView);
  if (state.article) params.set("p", state.article);
  const query = params.toString();
  return query ? `?${query}` : "";
}
