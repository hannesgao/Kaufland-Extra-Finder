/**
 * Cards of the "Extra-Angebote" tab: one per offer with price, comparison price, discount, how
 * many Extra stores have it, and those stores nearest first. All data goes through h() into
 * text nodes.
 */

import type { DealStoreView, DealView } from "../deals";
import { h } from "../dom";
import { formatKm } from "../geo";
import { icon } from "../icons";
import { formatPrice, names, offerLink, stateChip, thumbnail } from "./cards";

export const DEAL_STORES_SHOWN = 5;

/** "in 41 von 51 Extra-Filialen" */
export function dealStoreCount(count: number, extraStores: number): string {
  return `in ${String(count)} von ${String(extraStores)} Extra-Filialen`;
}

/** "auch in 37 anderen Filialen" */
export function otherStoresNote(count: number): string {
  return `auch in ${String(count)} ${count === 1 ? "anderen Filiale" : "anderen Filialen"}`;
}

function priceBlock(view: DealView): HTMLDivElement {
  const { product } = view.offer;
  const { priceFrom, priceTo, discount } = view;
  const varies = priceFrom !== undefined && priceTo !== undefined && priceFrom !== priceTo;
  return h(
    "div",
    { class: "deal__prices" },
    priceFrom !== undefined &&
      h(
        "span",
        { class: "deal__price" },
        varies && h("span", { class: "deal__from" }, "ab "),
        formatPrice(priceFrom),
      ),
    product.oldPrice !== undefined &&
      h(
        "s",
        { class: "deal__old", "aria-label": `statt ${formatPrice(product.oldPrice)}` },
        formatPrice(product.oldPrice),
      ),
    discount !== null &&
      h(
        "span",
        {
          class: "chip deal__discount",
          title: "Rabatt gegenüber dem Vergleichspreis, den Kaufland nennt",
        },
        `−${String(discount)} %`,
      ),
    product.unit !== undefined && h("span", { class: "deal__unit" }, product.unit),
  );
}

function storeRow(view: DealView, row: DealStoreView, varies: boolean): HTMLLIElement {
  const { store } = row;
  return h(
    "li",
    { class: "article__store deal__store" },
    icon("storefront"),
    h(
      "span",
      { class: "article__store-text" },
      h("span", { class: "article__store-name" }, store.name),
      h(
        "span",
        { class: "article__store-place" },
        `${store.plz} ${store.city}`,
        row.unconfirmed && " · im Prospekt-PDF nicht gefunden",
      ),
    ),
    h(
      "span",
      { class: "article__store-distance" },
      varies && row.price !== undefined && `${formatPrice(row.price)} · `,
      formatKm(row.distanceKm),
    ),
    offerLink(view.offer, store, "Angebot"),
  );
}

/** One card per offer; `extraStores` is the number of Extra stores with offers ("von 51"). */
export function renderDeal(
  view: DealView,
  extraStores: number,
  expanded: boolean,
  onExpand: (key: string) => void,
): HTMLLIElement {
  const { offer, stores } = view;
  const { product } = offer;
  const { brand, name } = names(offer);
  const headingId = `deal-${product.key.replace(/\W/g, "-")}`;
  const shown = expanded ? stores : stores.slice(0, DEAL_STORES_SHOWN);
  const more = stores.length - shown.length;
  const varies = view.priceFrom !== view.priceTo;
  return h(
    "li",
    { class: "article deal", "data-key": product.key },
    h(
      "article",
      { class: "article__body", "aria-labelledby": headingId },
      h(
        "div",
        { class: "article__head" },
        thumbnail(offer, 72, "article__thumb", "sell"),
        h(
          "div",
          { class: "article__title" },
          brand && h("p", { class: "offer__brand" }, brand),
          h("h3", { class: "article__name", id: headingId }, name),
          priceBlock(view),
          h(
            "div",
            { class: "offer__meta" },
            stateChip(offer),
            h("span", { class: "offer__count" }, dealStoreCount(view.storeCount, extraStores)),
            product.otherStores > 0 &&
              h(
                "span",
                {
                  class: "offer__count deal__others",
                  title: "Filialen, die kein Extra-Prospekt nennt, haben dieses Angebot ebenfalls",
                },
                otherStoresNote(product.otherStores),
              ),
          ),
        ),
      ),
      h(
        "ul",
        { class: "article__stores", "aria-label": `Filialen mit ${name}` },
        ...shown.map((row) => storeRow(view, row, varies)),
      ),
      more > 0 &&
        h(
          "button",
          {
            type: "button",
            class: "btn btn--text btn--sm article__more",
            on: {
              click: () => {
                onExpand(product.key);
              },
            },
          },
          icon("expand_more"),
          `Alle ${String(stores.length)} Filialen anzeigen`,
        ),
    ),
  );
}
