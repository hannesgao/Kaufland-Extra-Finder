/**
 * Store cards of the "Pokémon-Angebot-Finder" tab: the slim store header of the other tabs, then
 * the store's card offers (thumbnail, name, price, when it can be bought, link to Kaufland).
 * No calendar or leaflet panel. All data goes through h() into text nodes.
 */

import type { CardHit, CardStore, OfferView } from "../cards";
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

function thumbnail(view: OfferView): Element {
  const { thumbnail: src, thumbnail2x } = view.product;
  if (!src) return h("span", { class: "offer__thumb offer__thumb--empty" }, icon("playing_cards"));
  return h("img", {
    class: "offer__thumb",
    src,
    ...(thumbnail2x && { srcset: `${src} 1x, ${thumbnail2x} 2x` }),
    alt: "",
    width: "64",
    height: "64",
    loading: "lazy",
    decoding: "async",
    referrerpolicy: "no-referrer",
  });
}

function offerItem(view: OfferView, store: CardStore): HTMLLIElement {
  const { product } = view;
  const name = product.subtitle || product.title;
  const brand = product.subtitle ? product.title : "";
  const when = view.state === "upcoming" ? "Erhältlich" : "Im Angebot";
  return h(
    "li",
    { class: "offer" },
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
        h(
          "span",
          {
            class: `chip offer__state tone-${view.state}`,
            "aria-label": `${when} ${view.label}`,
          },
          view.label,
        ),
        h(
          "a",
          {
            class: "offer__link",
            href: offerUrl(product.klNr, store.id),
            target: "_blank",
            rel: "noopener noreferrer",
            "aria-label":
              `${brand} ${name} bei Kaufland ${store.name} ansehen (neues Fenster)`.trim(),
            title: `Öffnet das Angebot bei Kaufland und wählt dort die Filiale ${store.name} aus`,
          },
          "Zum Angebot",
          icon("open_in_new"),
        ),
      ),
    ),
  );
}

export function renderCardStore(
  hit: CardHit,
  onSelect: (id: string) => void,
  note?: string,
): HTMLLIElement {
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
        ...hit.offers.map((offer) => offerItem(offer, store)),
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
