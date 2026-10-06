/**
 * Store cards of the "Pokémon-Angebote" tab: the slim store header of the other tabs, then
 * the store's card offers (thumbnail, name, price, when it can be bought, link to Kaufland).
 * No calendar or leaflet panel. All data goes through h() into text nodes.
 */

import type { ArticleSummary, CardHit, CardStore, OfferView, StoreDistance } from "../cards";
import { formatKm } from "../geo";
import { h } from "../dom";
import { icon } from "../icons";
import { externalButton, storeHeader } from "./list";

const OFFER_PAGE = "https://filiale.kaufland.de/angebote/uebersicht.html";

/**
 * Kaufland's offer overview opened on the article, for the given store: Kaufland's page reads
 * `storeName`, switches the visitor's selected store to it (its own cookie) and drops the
 * parameter; it fills in category and week itself. Without the store, the article may not exist
 * in the store the visitor happens to have selected.
 */
export function offerUrl(klNr: string, storeId: string): string {
  const params = new URLSearchParams({ "kloffer-articleID": klNr, storeName: storeId });
  return `${OFFER_PAGE}?${params.toString()}`;
}

/** "55.00" -> "55,00 €" */
export function formatPrice(price: string): string {
  const value = Number(price);
  return Number.isFinite(value)
    ? new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value)
    : price;
}

/** "in 11 Filialen" */
export function storeCount(n: number): string {
  return `in ${String(n)} ${n === 1 ? "Filiale" : "Filialen"}`;
}

/** Brand line ("POKÉMON") and product name; Kaufland leaves some titles empty. */
function names(view: OfferView): { brand: string; name: string } {
  const { title, subtitle } = view.product;
  return { brand: subtitle ? title : "", name: subtitle || title };
}

function thumbnail(view: OfferView, size = 64, className = "offer__thumb"): Element {
  const { thumbnail: src, thumbnail2x } = view.product;
  if (!src) return h("span", { class: `${className} ${className}--empty` }, icon("playing_cards"));
  return h("img", {
    class: className,
    src,
    ...(thumbnail2x && { srcset: `${src} 1x, ${thumbnail2x} 2x` }),
    alt: "",
    width: String(size),
    height: String(size),
    loading: "lazy",
    decoding: "async",
    referrerpolicy: "no-referrer",
  });
}

function stateChip(view: OfferView): HTMLSpanElement {
  const when = view.state === "upcoming" ? "Erhältlich" : "Im Angebot";
  return h(
    "span",
    { class: `chip offer__state tone-${view.state}`, "aria-label": `${when} ${view.label}` },
    view.label,
  );
}

function offerLink(view: OfferView, store: CardStore, label = "Zum Angebot"): HTMLAnchorElement {
  const { brand, name } = names(view);
  return h(
    "a",
    {
      class: "offer__link",
      href: offerUrl(view.product.klNr, store.id),
      target: "_blank",
      rel: "noopener noreferrer",
      "aria-label": `${brand} ${name} bei Kaufland ${store.name} ansehen (neues Fenster)`.trim(),
      title: `Öffnet das Angebot bei Kaufland und wählt dort die Filiale ${store.name} aus`,
    },
    label,
    icon("open_in_new"),
  );
}

function offerItem(view: OfferView, store: CardStore, options: StoreCardOptions): HTMLLIElement {
  const { product } = view;
  const { brand, name } = names(view);
  const count = options.counts?.get(product.key);
  return h(
    "li",
    { class: `offer${options.article === product.klNr ? " is-highlighted" : ""}` },
    thumbnail(view),
    h(
      "div",
      { class: "offer__body" },
      brand && h("p", { class: "offer__brand" }, brand),
      h("p", { class: "offer__name" }, name),
      h(
        "div",
        { class: "offer__meta" },
        product.price && h("span", { class: "offer__price" }, formatPrice(product.price)),
        stateChip(view),
        count !== undefined && h("span", { class: "offer__count" }, storeCount(count)),
        offerLink(view, store),
      ),
    ),
  );
}

export interface StoreCardOptions {
  note?: string;
  /** Stores per product key ("in 11 Filialen"), nationwide. */
  counts?: ReadonlyMap<string, number>;
  /** The article the list is filtered by: its row is highlighted. */
  article?: string | null;
}

export function renderCardStore(
  hit: CardHit,
  onSelect: (id: string) => void,
  options: StoreCardOptions = {},
): HTMLLIElement {
  const { note } = options;
  const { store } = hit;
  const headingId = `cards-store-${store.id}`;
  const select = () => {
    onSelect(store.id);
  };
  return h(
    "li",
    { class: "store store--cards", "data-id": store.id },
    h(
      "article",
      { class: "store__body", "aria-labelledby": headingId },
      note && h("p", { class: "store__note" }, icon("near_me"), note),
      storeHeader(
        store,
        headingId,
        icon("storefront", "icon store__avatar"),
        hit.distanceKm,
        select,
      ),
      h(
        "ul",
        { class: "offers", "aria-label": `Pokémon-Angebote in ${store.name}` },
        ...hit.offers.map((offer) => offerItem(offer, store, options)),
      ),
      h(
        "div",
        { class: "actions store__actions" },
        store.url &&
          externalButton(store.url, "Filialseite", store.name, "btn--outlined", "storefront"),
        h(
          "button",
          { type: "button", class: "btn btn--sm btn--outlined", on: { click: select } },
          icon("map"),
          "Auf Karte zeigen",
        ),
      ),
    ),
  );
}

/* ---------- Article strip (store view) ---------- */

/**
 * One toggle per article above the store list: name, price, date, "in 11 Filialen" and the
 * distance of the nearest store with it. Pressing one filters the stores by that article.
 */
export function renderArticleStrip(
  summaries: readonly ArticleSummary[],
  nearestKm: ReadonlyMap<string, number>,
  selected: string | null,
  onToggle: (klNr: string) => void,
): HTMLLIElement[] {
  return summaries.map((summary) => {
    const { offer } = summary;
    const { brand, name } = names(offer);
    const pressed = selected === offer.product.klNr;
    const near = nearestKm.get(offer.product.key);
    return h(
      "li",
      null,
      h(
        "button",
        {
          type: "button",
          class: "article-chip",
          "aria-pressed": String(pressed),
          title: pressed ? "Filter aufheben" : "Nur Filialen mit diesem Artikel zeigen",
          on: {
            click: () => {
              onToggle(offer.product.klNr);
            },
          },
        },
        thumbnail(offer, 48, "article-chip__thumb"),
        h(
          "span",
          { class: "article-chip__body" },
          brand && h("span", { class: "article-chip__brand" }, brand),
          h("span", { class: "article-chip__name" }, name),
          h(
            "span",
            { class: "article-chip__meta" },
            [offer.product.price && formatPrice(offer.product.price), offer.label]
              .filter(Boolean)
              .join(" · "),
          ),
          h(
            "span",
            { class: "article-chip__meta" },
            storeCount(summary.storeIds.length),
            near !== undefined && ` · nächste ${formatKm(near)}`,
          ),
        ),
        pressed && icon("check", "icon article-chip__check"),
      ),
    );
  });
}

/* ---------- Article view ---------- */

export const ARTICLE_STORES_SHOWN = 5;

/** One card per article: what, when, how many stores, and those stores nearest first. */
export function renderArticle(
  summary: ArticleSummary,
  stores: readonly StoreDistance[],
  expanded: boolean,
  onExpand: (key: string) => void,
): HTMLLIElement {
  const { offer } = summary;
  const { brand, name } = names(offer);
  const headingId = `article-${offer.product.key.replace(/\W/g, "-")}`;
  const shown = expanded ? stores : stores.slice(0, ARTICLE_STORES_SHOWN);
  const more = stores.length - shown.length;
  return h(
    "li",
    { class: "article", "data-key": offer.product.key },
    h(
      "article",
      { class: "article__body", "aria-labelledby": headingId },
      h(
        "div",
        { class: "article__head" },
        thumbnail(offer, 72, "article__thumb"),
        h(
          "div",
          { class: "article__title" },
          brand && h("p", { class: "offer__brand" }, brand),
          h("h3", { class: "article__name", id: headingId }, name),
          h(
            "div",
            { class: "offer__meta" },
            offer.product.price &&
              h("span", { class: "offer__price" }, formatPrice(offer.product.price)),
            stateChip(offer),
            h("span", { class: "offer__count" }, storeCount(summary.storeIds.length)),
          ),
        ),
      ),
      h(
        "ul",
        { class: "article__stores", "aria-label": `Filialen mit ${name}` },
        ...shown.map(({ store, distanceKm }) =>
          h(
            "li",
            { class: "article__store" },
            icon("storefront"),
            h(
              "span",
              { class: "article__store-text" },
              h("span", { class: "article__store-name" }, store.name),
              h("span", { class: "article__store-place" }, `${store.plz} ${store.city}`),
            ),
            h("span", { class: "article__store-distance" }, formatKm(distanceKm)),
            offerLink(offer, store, "Angebot"),
          ),
        ),
      ),
      more > 0 &&
        h(
          "button",
          {
            type: "button",
            class: "btn btn--text btn--sm article__more",
            on: {
              click: () => {
                onExpand(offer.product.key);
              },
            },
          },
          icon("expand_more"),
          `Alle ${String(stores.length)} Filialen anzeigen`,
        ),
    ),
  );
}
