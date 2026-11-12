/**
 * Search state <-> URL query (`?plz=76137&r=25&tab=all&sort=plz-desc&pdf=all`;
 * Pokémon tab: `tab=cards&view=artikel&p=20973794`; Extra offers:
 * `tab=deals&dsort=filialen&cat=Fisch&dall=1&near=1&unconf=1`).
 * Defaults are omitted. Coordinates are never put into the URL.
 */

import { DEAL_SORTS, type DealSort } from "./deals";
import { RADII, SORT_ORDERS, type Radius, type SortOrder } from "./search";

/** Searched on page load when the URL has no PLZ (Karlsruhe city centre). */
export const DEFAULT_PLZ = "76131";
export const DEFAULT_RADIUS: Radius = 25;
export const TABS = ["search", "all", "deals", "cards"] as const;
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
  dealSort: DealSort;
  /** Extra offers: only this category (Kaufland's name, e.g. "Fisch"). */
  dealSection: string | null;
  /** Extra offers: also those in fewer than half of the Extra stores. */
  dealsAll: boolean;
  /** Extra offers: only stores within the radius. */
  dealsNear: boolean;
  /** Extra offers: also those whose title was not found in the leaflet PDF. */
  dealsUnconfirmed: boolean;
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
  const section = params.get("cat")?.trim();
  return {
    plz: isPlz(plz) ? plz : null,
    radius: isRadius(radius) ? radius : DEFAULT_RADIUS,
    tab: oneOf(TABS, params.get("tab"), "search"),
    sort: oneOf(SORT_ORDERS, params.get("sort"), "plz-asc"),
    pdfOnly: params.get("pdf") !== "all",
    cardsView: oneOf(CARDS_VIEWS, params.get("view"), "filialen"),
    article: ARTICLE.test(params.get("p") ?? "") ? params.get("p") : null,
    dealSort: oneOf(DEAL_SORTS, params.get("dsort"), "rabatt"),
    dealSection: section === undefined || section === "" ? null : section,
    dealsAll: params.get("dall") === "1",
    dealsNear: params.get("near") === "1",
    dealsUnconfirmed: params.get("unconf") === "1",
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
  if (state.dealSort !== "rabatt") params.set("dsort", state.dealSort);
  if (state.dealSection) params.set("cat", state.dealSection);
  if (state.dealsAll) params.set("dall", "1");
  if (state.dealsNear) params.set("near", "1");
  if (state.dealsUnconfirmed) params.set("unconf", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}
