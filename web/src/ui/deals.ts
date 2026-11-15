/**
 * Elements of the "Extra-Angebote" tab: one tile per offer, like the tiles of the shopping list
 * tab (picture, discount, price, sale days), with the number of Extra stores that have it. The
 * stores themselves, nearest first, are in a panel that opens below the tile's row. All data
 * goes through h() into text nodes.
 */

import type { IsoDate } from "../data";
import type { DealStoreView, DealView } from "../deals";
import { h } from "../dom";
import { formatKm } from "../geo";
import { icon, type IconName } from "../icons";
import { formatPrice, names, offerLink, stateChip } from "./cards";
import { comparisonPrice, lateStart, packText, salesText, tilePicture } from "./tile";

export const DEAL_STORES_SHOWN = 6;

/** Icons for Kaufland's categories, matched by a word of the name; first match wins. */
const SECTION_ICONS: readonly (readonly [RegExp, IconName])[] = [
  [/bäckerei|backshop/, "bakery_dining"],
  [/\bbio\b|bio-/, "eco"],
  [/region/, "location_on"],
  [/obst|gemüse|pflanzen/, "nutrition"],
  [/fleisch|geflügel|wurst/, "kebab_dining"],
  [/fisch/, "set_meal"],
  [/molkerei|käse/, "egg"],
  [/tiefkühl/, "ac_unit"],
  [/feinkost|konserven/, "takeout_dining"],
  [/grundnahrung/, "grocery"],
  [/kaffee|tee|süßwaren|knabber/, "coffee"],
  [/getränke|spirituosen|wein|bier/, "liquor"],
  [/drogerie|tiernahrung/, "soap"],
  [/elektro|büro|medien/, "devices"],
  [/heim|haus/, "chair"],
  [/bekleidung|auto|freizeit|spiel/, "checkroom"],
];

/** The icon of a category; promotions and unknown categories get the price tag. */
export function sectionIcon(section: string): IconName {
  const name = section.toLocaleLowerCase("de");
  return SECTION_ICONS.find(([pattern]) => pattern.test(name))?.[1] ?? "sell";
}

/** "in 41 von 51 Extra-Filialen" */
export function dealStoreCount(count: number, extraStores: number): string {
  return `in ${String(count)} von ${String(extraStores)} Extra-Filialen`;
}

/** "auch in 37 anderen Filialen" */
export function otherStoresNote(count: number): string {
  return `auch in ${String(count)} ${count === 1 ? "anderen Filiale" : "anderen Filialen"}`;
}

/** "41 von 51 Filialen": the short form on a tile. */
export function dealStoreShare(count: number, extraStores: number): string {
  return `${String(count)} von ${String(extraStores)} Filialen`;
}

/** The id of the panel with an offer's stores, for `aria-controls`. */
export function dealPanelId(key: string): string {
  return `deal-stores-${key.replace(/\W/g, "-")}`;
}

function nameId(key: string): string {
  return `deal-${key.replace(/\W/g, "-")}`;
}

/** The days the price applies; Kaufland's display days for the few offers without them. */
function salesDays(view: DealView): { salesFrom: IsoDate; salesTo: IsoDate } {
  const { salesFrom, salesTo, shownFrom, shownTo } = view.offer.product;
  return salesFrom && salesTo ? { salesFrom, salesTo } : { salesFrom: shownFrom, salesTo: shownTo };
}

function priceBox(view: DealView): HTMLDivElement {
  const { oldPrice } = view.offer.product;
  const { priceFrom, priceTo } = view;
  return h(
    "div",
    { class: "zoffer__pricebox" },
    h(
      "div",
      { class: "zoffer__prices" },
      h(
        "span",
        { class: "zoffer__regular" },
        priceFrom !== undefined &&
          h(
            "span",
            { class: "zoffer__price" },
            priceFrom !== priceTo && h("span", { class: "zoffer__from" }, "ab "),
            formatPrice(priceFrom),
          ),
        oldPrice !== undefined &&
          h(
            "s",
            { class: "zoffer__old" },
            h("span", { class: "visually-hidden" }, "statt "),
            comparisonPrice(oldPrice),
          ),
      ),
    ),
  );
}

export interface DealTileOptions {
  /** Extra stores with offers ("von 51"). */
  extraStores: number;
  today: IsoDate;
  /** The panel with the stores is open. */
  open: boolean;
  /** The list shows one store's offers: the tile links to Kaufland itself, there is no panel. */
  single: boolean;
  onToggle(key: string): void;
}

/** What is at the bottom of a tile: the stores button, or the link when there is one store. */
function storesLine(view: DealView, options: DealTileOptions): Element | null {
  const [nearest] = view.stores;
  if (!nearest) return null;
  if (options.single) {
    return h(
      "p",
      { class: "zoffer__stores zoffer__stores--single" },
      offerLink(view.offer, nearest.store, "Bei Kaufland"),
      nearest.unconfirmed &&
        h("span", { class: "zoffer__unconfirmed" }, "im Prospekt-PDF nicht gefunden"),
    );
  }
  const { key } = view.offer.product;
  return h(
    "button",
    {
      type: "button",
      class: "zoffer__stores",
      "aria-expanded": String(options.open),
      "aria-controls": dealPanelId(key),
      title: options.open ? "Filialen ausblenden" : "Filialen anzeigen",
      on: {
        click: () => {
          options.onToggle(key);
        },
      },
    },
    h(
      "span",
      { class: "zoffer__stores-text" },
      h("span", { class: "visually-hidden" }, "in "),
      h("span", {}, dealStoreShare(view.storeCount, options.extraStores)),
      h("span", { class: "zoffer__nearest" }, `nächste ${formatKm(nearest.distanceKm)}`),
    ),
    icon("expand_more"),
  );
}

/** One tile per offer. Its children sit in the rows of the list's grid, see `.zoffer`. */
export function renderDealTile(view: DealView, options: DealTileOptions): HTMLLIElement {
  const { offer } = view;
  const { product } = offer;
  const { brand, name } = names(offer);
  const days = salesDays(view);
  const late = lateStart(days, options.today);
  const pack = packText(product);
  const [from, to] = salesText(days).split(" – ");
  return h(
    "li",
    {
      class: `zoffer zoffer--deal${options.open ? " zoffer--open" : ""}`,
      "data-key": product.key,
    },
    h("div", { class: "zoffer__media" }, tilePicture(product, "sell")),
    (view.discount !== null || late !== null) &&
      h(
        "p",
        { class: "zoffer__badges" },
        view.discount !== null &&
          h(
            "span",
            {
              class: "zoffer__discount",
              title: "Rabatt gegenüber dem Vergleichspreis, den Kaufland nennt",
            },
            `−${String(view.discount)}\u00a0%`,
          ),
        late !== null && h("span", { class: "zoffer__late" }, `ab ${late}.`),
      ),
    brand && h("p", { class: "zoffer__brand" }, brand),
    h("h3", { class: "zoffer__name", id: nameId(product.key) }, name),
    pack && h("p", { class: "zoffer__pack" }, h("span", { class: "pack" }, pack)),
    priceBox(view),
    h(
      "p",
      { class: "zoffer__when" },
      h("span", {}, to === undefined ? from : `${from ?? ""} –`),
      to !== undefined && h("span", {}, to),
    ),
    storesLine(view, options),
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

export interface DealPanelOptions {
  extraStores: number;
  /** All stores instead of the nearest `DEAL_STORES_SHOWN`. */
  expanded: boolean;
  onExpand(key: string): void;
  onClose(key: string): void;
}

/**
 * The stores of one offer, nearest first, with what else is known about it. It follows its tile
 * in the list and spans the whole row below it.
 */
export function renderDealPanel(view: DealView, options: DealPanelOptions): HTMLLIElement {
  const { offer, stores } = view;
  const { product } = offer;
  const { brand, name } = names(offer);
  const shown = options.expanded ? stores : stores.slice(0, DEAL_STORES_SHOWN);
  const more = stores.length - shown.length;
  const varies = view.priceFrom !== view.priceTo;
  return h(
    "li",
    { class: "zpanel", id: dealPanelId(product.key), "data-panel": product.key },
    h(
      "section",
      { class: "zpanel__body", "aria-labelledby": `${dealPanelId(product.key)}-title` },
      h(
        "header",
        { class: "zpanel__head" },
        h(
          "h4",
          { class: "zpanel__title", id: `${dealPanelId(product.key)}-title` },
          h("span", { class: "visually-hidden" }, "Filialen mit "),
          `${brand} ${name}`.trim(),
        ),
        h(
          "button",
          {
            type: "button",
            class: "zpanel__close",
            "aria-label": "Filialen ausblenden",
            title: "Filialen ausblenden",
            on: {
              click: () => {
                options.onClose(product.key);
              },
            },
          },
          icon("close"),
        ),
      ),
      h(
        "div",
        { class: "offer__meta zpanel__meta" },
        stateChip(offer),
        h("span", { class: "offer__count" }, dealStoreCount(view.storeCount, options.extraStores)),
        product.sections[0] !== undefined &&
          h(
            "span",
            { class: "offer__count deal__section" },
            icon(sectionIcon(product.sections[0])),
            product.sections[0],
          ),
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
      h(
        "ul",
        { class: "article__stores zpanel__stores", "aria-label": `Filialen mit ${name}` },
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
                options.onExpand(product.key);
              },
            },
          },
          icon("expand_more"),
          `Alle ${String(stores.length)} Filialen anzeigen`,
        ),
    ),
  );
}
