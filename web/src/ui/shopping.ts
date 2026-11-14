/**
 * Elements of the shopping list tab: offer tiles to pick from, the editable list, and the sheet
 * that is printed. Rendering only; the state lives in `shopping-tab.ts`.
 */

import type { IsoDate } from "../data";
import { berlinToday, formatDate, formatDay, weekdayShort } from "../dates";
import { discountPercent } from "../deals";
import { h, type Child } from "../dom";
import { icon, type IconName } from "../icons";
import { departmentOf, NO_DEPARTMENT, type Offer } from "../offers";
import {
  groupItems,
  MAX_NOTE,
  MAX_QUANTITY,
  OWN_ENTRIES,
  type ItemStatus,
  type Layout,
  type ListItem,
  type ListStore,
} from "../shopping";
import { formatPrice } from "./cards";
import { sectionIcon } from "./deals";

/** Brand line and product name; Kaufland leaves some titles empty. */
export function offerNames(offer: Offer): { brand: string; name: string } {
  return { brand: offer.subtitle ? offer.title : "", name: offer.subtitle || offer.title };
}

/** "Mo, 09.11. – Sa, 14.11." */
export function salesText(offer: Pick<Offer, "salesFrom" | "salesTo">): string {
  const day = (iso: IsoDate) => `${weekdayShort(iso)}, ${formatDay(iso)}`;
  return offer.salesFrom === offer.salesTo
    ? `nur ${day(offer.salesFrom)}`
    : `${day(offer.salesFrom)} – ${day(offer.salesTo)}`;
}

/** Kaufland writes "(1 kg = 10.38)" and "entspr. pro Beutel 1.34": German decimal commas. */
export function germanDecimals(text: string): string {
  return text.replace(/(\d)\.(\d{2})(?!\d)/g, "$1,$2");
}

/** "Preis für 3 Stück (entspr. pro Beutel 1,34)" */
export function multiBuyText(multiBuy: readonly string[]): string | null {
  const [quantity, ...rest] = multiBuy;
  if (!quantity) return null;
  const detail = rest.length ? ` (${germanDecimals(rest.join(", "))})` : "";
  return `Preis für ${quantity}${detail}`;
}

export function departmentIcon(department: string): IconName {
  if (department === OWN_ENTRIES) return "format_list_bulleted";
  return department === NO_DEPARTMENT ? "sell" : sectionIcon(department);
}

function picture(
  offer: Offer,
  size: number,
  className: string,
  eager = false,
  sizes?: string,
): Element {
  const { thumbnail, thumbnail2x } = offer;
  if (!thumbnail) {
    return h("span", { class: `${className} ${className}--empty` }, icon("grocery"));
  }
  return h("img", {
    class: className,
    // The sheet is printed larger than the tiles on screen: always the 322 px picture there.
    src: eager ? (thumbnail2x ?? thumbnail) : thumbnail,
    ...(!eager &&
      thumbnail2x &&
      (sizes
        ? { srcset: `${thumbnail} 150w, ${thumbnail2x} 322w`, sizes }
        : { srcset: `${thumbnail} 1x, ${thumbnail2x} 2x` })),
    alt: "",
    width: String(size),
    height: String(size),
    loading: eager ? "eager" : "lazy",
    decoding: "async",
    referrerpolicy: "no-referrer",
  });
}

/**
 * Price with its comparison price, then the Kaufland Card price as a tag of its own, then the
 * discount. Offers that are only sold with the card have no regular price.
 */
function prices(offer: Offer, className: string, withDiscount = true): HTMLDivElement {
  const discount = withDiscount ? discountPercent(offer.price, offer.oldPrice) : null;
  const { price, oldPrice, cardPrice } = offer;
  return h(
    "div",
    { class: `${className}__prices` },
    price !== undefined &&
      h(
        "span",
        { class: `${className}__regular` },
        h("span", { class: `${className}__price` }, formatPrice(price)),
        oldPrice !== undefined &&
          h(
            "s",
            { class: `${className}__old` },
            h("span", { class: "visually-hidden" }, "statt "),
            formatPrice(oldPrice),
          ),
      ),
    cardPrice !== undefined &&
      h(
        "span",
        {
          class: `${className}__cardprice${price === undefined ? ` ${className}__cardprice--only` : ""}`,
          title: price === undefined ? "Preis nur mit Kaufland Card" : "Preis mit Kaufland Card",
        },
        icon("credit_card"),
        h(
          "span",
          { class: `${className}__cardlabel` },
          price === undefined ? "nur mit Kaufland Card" : "mit Kaufland Card",
        ),
        " ",
        formatPrice(cardPrice),
      ),
    discount !== null &&
      h("span", { class: `chip ${className}__discount` }, `−${String(discount)}\u00a0%`),
  );
}

/** Unit and base prices and the multi-buy condition: the small print. */
function conditions(offer: Offer, className: string): Child[] {
  const unit = [
    offer.unit,
    offer.basePrice && germanDecimals(offer.basePrice),
    offer.cardBasePrice && `mit Kaufland Card ${germanDecimals(offer.cardBasePrice)}`,
  ]
    .filter(Boolean)
    .join(" ");
  const multiBuy = multiBuyText(offer.multiBuy);
  return [
    unit && h("p", { class: `${className}__unit` }, unit),
    multiBuy && h("p", { class: `${className}__extra` }, multiBuy),
  ];
}

function head(offer: Offer, className: string): Child[] {
  const { brand, name } = offerNames(offer);
  return [
    brand && h("p", { class: `${className}__brand` }, brand),
    h("p", { class: `${className}__name` }, name),
    offer.description && h("p", { class: `${className}__description` }, offer.description),
  ];
}

// ---------- Offers to pick from ----------

/** Two to five tiles per row; see `.zoffers`. */
const TILE_SIZES =
  "(min-width: 1100px) 220px, (min-width: 840px) 25vw, (min-width: 600px) 33vw, 50vw";

export function renderOfferTile(
  offer: Offer,
  onList: boolean,
  full: boolean,
  onToggle: (offer: Offer) => void,
): HTMLLIElement {
  const { name } = offerNames(offer);
  const discount = discountPercent(offer.price, offer.oldPrice);
  const label = onList ? `${name} vom Zettel nehmen` : `${name} auf den Zettel setzen`;
  const [from, to] = salesText(offer).split(" – ");
  return h(
    "li",
    { class: `zoffer${onList ? " zoffer--picked" : ""}`, "data-key": offer.key },
    h("div", { class: "zoffer__media" }, picture(offer, 322, "zoffer__thumb", false, TILE_SIZES)),
    discount !== null && h("span", { class: "zoffer__discount" }, `−${String(discount)}\u00a0%`),
    h("div", { class: "zoffer__text" }, ...head(offer, "zoffer"), ...conditions(offer, "zoffer")),
    h(
      "div",
      { class: "zoffer__foot" },
      prices(offer, "zoffer", false),
      h(
        "p",
        { class: "zoffer__when" },
        h("span", {}, to === undefined ? from : `${from ?? ""} –`),
        to !== undefined && h("span", {}, to),
      ),
    ),
    // Last in the source, in the picture's corner on screen: the name is read before the button.
    h(
      "button",
      {
        type: "button",
        class: "zoffer__add",
        "aria-pressed": String(onList),
        "aria-label": label,
        title:
          full && !onList
            ? "Der Zettel ist voll."
            : onList
              ? "Vom Zettel nehmen"
              : "Auf den Zettel",
        ...(full && !onList && { disabled: true }),
        on: {
          click: () => {
            onToggle(offer);
          },
        },
      },
      icon(onList ? "check" : "add"),
    ),
  );
}

// ---------- The editable list ----------

export interface ItemHandlers {
  onQuantity(id: string, quantity: number): void;
  onNote(id: string, note: string): void;
  onRemove(id: string): void;
  onRefresh(id: string, offer: Offer): void;
}

function statusNote(item: ListItem, status: ItemStatus, handlers: ItemHandlers): Element | null {
  if (status.kind === "ok" || !item.offer) return null;
  if (status.kind === "expired") {
    return h(
      "p",
      { class: "zitem__status zitem__status--expired" },
      icon("event_busy"),
      `Angebot abgelaufen (bis ${weekdayShort(item.offer.salesTo)}, ${formatDay(item.offer.salesTo)})`,
    );
  }
  if (status.kind === "gone") {
    return h(
      "p",
      { class: "zitem__status zitem__status--gone" },
      icon("warning"),
      "Nicht mehr unter den Angeboten dieser Filiale",
    );
  }
  const { current } = status;
  const now =
    current.price !== undefined && current.price !== item.offer.price
      ? `Preis geändert: jetzt ${formatPrice(current.price)}`
      : `Angebot geändert: ${salesText(current)}`;
  return h(
    "p",
    { class: "zitem__status zitem__status--changed" },
    icon("info"),
    now,
    h(
      "button",
      {
        type: "button",
        class: "btn btn--xs btn--text",
        on: {
          click: () => {
            handlers.onRefresh(item.id, current);
          },
        },
      },
      "Übernehmen",
    ),
  );
}

function quantityControl(item: ListItem, name: string, handlers: ItemHandlers): HTMLDivElement {
  const step = (delta: number, label: string, symbol: IconName, disabled: boolean) =>
    h(
      "button",
      {
        type: "button",
        class: "zqty__step",
        "aria-label": `${label}: ${name}`,
        "data-focus": `${item.id}:${symbol}`,
        ...(disabled && { disabled: true }),
        on: {
          click: () => {
            handlers.onQuantity(item.id, item.quantity + delta);
          },
        },
      },
      icon(symbol),
    );
  return h(
    "div",
    { class: "zqty" },
    step(-1, "Weniger", "remove", item.quantity <= 1),
    h(
      "span",
      { class: "zqty__value", "aria-label": `Anzahl ${String(item.quantity)}` },
      `${String(item.quantity)}×`,
    ),
    step(1, "Mehr", "add", item.quantity >= MAX_QUANTITY),
  );
}

export function renderItem(
  item: ListItem,
  status: ItemStatus,
  handlers: ItemHandlers,
): HTMLLIElement {
  const { offer } = item;
  const name = offer ? offerNames(offer).name : (item.text ?? "");
  const noteId = `znote-${item.id}`;
  return h(
    "li",
    { class: `zitem zitem--${status.kind}${offer ? "" : " zitem--text"}`, "data-id": item.id },
    offer
      ? picture(offer, 72, "zitem__thumb")
      : h("span", { class: "zitem__thumb zitem__thumb--empty" }, icon("format_list_bulleted")),
    h(
      "div",
      { class: "zitem__body" },
      ...(offer
        ? [
            ...head(offer, "zitem"),
            prices(offer, "zitem"),
            ...conditions(offer, "zitem"),
            h("p", { class: "zitem__when" }, icon("schedule"), salesText(offer)),
          ]
        : [h("p", { class: "zitem__name" }, name)]),
      statusNote(item, status, handlers),
    ),
    h(
      "div",
      { class: "zitem__edit" },
      quantityControl(item, name, handlers),
      h(
        "label",
        { class: "zitem__note", for: noteId },
        h("span", { class: "visually-hidden" }, `Notiz zu ${name}`),
        h("input", {
          id: noteId,
          type: "text",
          maxlength: String(MAX_NOTE),
          placeholder: "Notiz",
          value: item.note,
          autocomplete: "off",
          on: {
            change: (event) => {
              handlers.onNote(item.id, (event.target as HTMLInputElement).value);
            },
          },
        }),
      ),
      h(
        "button",
        {
          type: "button",
          class: "zitem__remove",
          "aria-label": `${name} vom Zettel nehmen`,
          "data-focus": `${item.id}:delete`,
          on: {
            click: () => {
              handlers.onRemove(item.id);
            },
          },
        },
        icon("delete"),
      ),
    ),
  );
}

export function renderGroupTitle(title: string, count: number): HTMLHeadingElement {
  return h(
    "h4",
    { class: "zgroup__title" },
    icon(departmentIcon(title)),
    title,
    h("span", { class: "zgroup__count" }, String(count)),
  );
}

// ---------- The printed sheet ----------

function sheetItem(item: ListItem, today: IsoDate): HTMLLIElement {
  const { offer } = item;
  const quantity =
    item.quantity > 1 && h("span", { class: "sheet-item__qty" }, `${String(item.quantity)}×`);
  const note = item.note && h("p", { class: "sheet-item__note" }, item.note);
  const box = h("span", { class: "sheet-item__box", "aria-hidden": "true" });
  if (!offer) {
    return h(
      "li",
      { class: "sheet-item sheet-item--text" },
      box,
      h(
        "div",
        { class: "sheet-item__body" },
        h("p", { class: "sheet-item__name" }, quantity, item.text ?? ""),
        note,
      ),
    );
  }
  const expired = offer.salesTo < today;
  return h(
    "li",
    { class: "sheet-item" },
    h(
      "div",
      { class: "sheet-item__top" },
      box,
      quantity,
      h("span", { class: "sheet-item__department" }, departmentOf(offer)),
    ),
    picture(offer, 322, "sheet-item__img", true),
    h(
      "div",
      { class: "sheet-item__body" },
      ...head(offer, "sheet-item"),
      prices(offer, "sheet-item"),
      ...conditions(offer, "sheet-item"),
      h(
        "p",
        { class: "sheet-item__when" },
        expired ? `Abgelaufen: ${salesText(offer)}` : `Gültig ${salesText(offer)}`,
      ),
      note,
    ),
  );
}

/**
 * Rows are printed under a heading per department. Clippings fill one grid in the same order
 * (a heading per department would leave most rows half empty) and name the department on each.
 */
function sheetGroups(
  items: readonly ListItem[],
  layout: Layout,
): { title: string | null; items: ListItem[] }[] {
  const groups = groupItems(items);
  if (layout === "liste") return groups;
  const offers = groups.filter((g) => g.title !== OWN_ENTRIES).flatMap((g) => g.items);
  const own = groups.filter((g) => g.title === OWN_ENTRIES);
  return [...(offers.length ? [{ title: null, items: offers }] : []), ...own];
}

/** The page that is printed: store and date on top, then the items by department. */
export function renderSheet(
  store: ListStore | null,
  items: readonly ListItem[],
  layout: Layout,
  generatedAt: Date | null,
  today: IsoDate,
): HTMLElement {
  const where = store
    ? `Kaufland ${store.name}, ${store.street}, ${store.plz} ${store.city}`
    : "Ohne Filiale";
  const stand = generatedAt
    ? `Angebote laut kaufland.de, Stand ${formatDate(berlinToday(generatedAt))}. `
    : "";
  return h(
    "article",
    { class: `sheet sheet--${layout}` },
    h(
      "header",
      { class: "sheet__head" },
      h("h1", { class: "sheet__title" }, "Einkaufszettel"),
      h("p", { class: "sheet__store" }, where),
      h("p", { class: "sheet__meta" }, `${stand}Preise und Verfügbarkeit ohne Gewähr.`),
    ),
    ...sheetGroups(items, layout).map((group) =>
      h(
        "section",
        { class: "sheet__group" },
        group.title && h("h2", { class: "sheet__group-title" }, group.title),
        h(
          "ul",
          { class: `sheet__items${group.title === OWN_ENTRIES ? " sheet__items--text" : ""}` },
          ...group.items.map((item) => sheetItem(item, today)),
        ),
      ),
    ),
  );
}
