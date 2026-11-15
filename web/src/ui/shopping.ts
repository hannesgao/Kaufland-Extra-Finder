/**
 * Elements of the shopping list tab: offer tiles to pick from, the editable list, and the sheet
 * that is printed. Rendering only; the state lives in `shopping-tab.ts`.
 */

import type { IsoDate } from "../data";
import { formatDay, isoWeek, weekdayShort } from "../dates";
import { discountPercent } from "../deals";
import { h, type Child } from "../dom";
import { icon, type IconName } from "../icons";
import { NO_DEPARTMENT, type Offer } from "../offers";
import {
  MAX_NOTE,
  MAX_QUANTITY,
  OWN_ENTRIES,
  type ItemStatus,
  type ListItem,
  type Trip,
} from "../shopping";
import { formatPrice } from "./cards";
import { sectionIcon } from "./deals";
import { comparisonPrice, lateStart, packText, salesText, tilePicture } from "./tile";

export { comparisonPrice, lateStart, packText, salesText };

/** Brand line and product name; Kaufland leaves some titles empty. */
export function offerNames(offer: Offer): { brand: string; name: string } {
  return { brand: offer.subtitle ? offer.title : "", name: offer.subtitle || offer.title };
}

/** "KW 47 · Alles gültig Do, 19.11. – Sa, 21.11.": the days on which a trip gets every price. */
export function tripText(trip: Pick<Trip, "from" | "to" | "items">): string {
  const days = salesText({ salesFrom: trip.from, salesTo: trip.to });
  const lead = trip.items.length > 1 ? "Alles gültig" : "Gültig";
  return `KW\u00a0${String(isoWeek(trip.from))} · ${lead} ${days}`;
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

function picture(offer: Offer, size: number, className: string, eager = false): Element {
  const { thumbnail, thumbnail2x } = offer;
  if (!thumbnail) {
    return h("span", { class: `${className} ${className}--empty` }, icon("grocery"));
  }
  return h("img", {
    class: className,
    // The sheet is printed larger than the tiles on screen: always the 322 px picture there.
    src: eager ? (thumbnail2x ?? thumbnail) : thumbnail,
    ...(!eager && thumbnail2x && { srcset: `${thumbnail} 1x, ${thumbnail2x} 2x` }),
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
  const { deposit } = splitDeposit(offer.description);
  return h(
    "div",
    { class: `${className}__prices` },
    price !== undefined &&
      h(
        "span",
        { class: `${className}__regular` },
        h("span", { class: `${className}__price` }, formatPrice(price)),
        deposit !== undefined &&
          h("span", { class: `${className}__deposit` }, `+\u00a0${formatPrice(deposit)} Pfand`),
        oldPrice !== undefined &&
          h(
            "s",
            { class: `${className}__old` },
            h("span", { class: "visually-hidden" }, "statt "),
            comparisonPrice(oldPrice),
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

/** One line of the unit facts: a base price as label and amount, or plain text. */
export interface UnitFact {
  /** "1 kg", "1 l", "pro Stück"; absent for plain text. */
  label?: string;
  /** "4,03 – 5,78 €", or the text. */
  value: string;
  /** The base price with the Kaufland Card. */
  card?: true;
}

const AMOUNT = /^\d+,\d{2}(?: - \d+,\d{2})?$/;

/**
 * Kaufland's base price text as separate facts: "Abtropfgewicht 250 g (1 kg = 9.90)" becomes the
 * text "Abtropfgewicht 250 g" and the price "1 kg" / "9,90 €"; several bracketed prices become
 * one fact each.
 */
export function basePriceFacts(basePrice: string | undefined): UnitFact[] {
  if (!basePrice) return [];
  return germanDecimals(basePrice)
    .split(/[()]|\s\/\s/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(" = ");
      const amount = at < 0 ? "" : part.slice(at + 3);
      return AMOUNT.test(amount)
        ? { label: part.slice(0, at), value: `${amount.replace(" - ", "\u00a0– ")}\u00a0€` }
        : { value: part };
    });
}

const DEPOSIT = /\s*\(\+\s*(\d+(?:[.,]\d{1,2})?)\s*(?:Flaschen)?pfand\)/i;

/**
 * Kaufland notes the deposit in the description: "auch alkoholfrei (+ 3.10 Pfand)". It is shown
 * with the price instead; `text` is the description without it (undefined when nothing is left).
 */
export function splitDeposit(description: string | undefined): {
  text?: string;
  deposit?: string;
} {
  const match = description === undefined ? null : DEPOSIT.exec(description);
  if (!description || !match?.[1]) return description ? { text: description } : {};
  const text = description.replace(DEPOSIT, "").trim();
  return { ...(text && { text }), deposit: match[1].replace(",", ".") };
}

/** What it costs per kilogram, litre or piece: one line per base price. */
export function unitFacts(offer: Offer): UnitFact[] {
  return [
    ...basePriceFacts(offer.basePrice),
    ...basePriceFacts(offer.cardBasePrice).map((fact) => ({ ...fact, card: true as const })),
  ];
}

function unitFact(fact: UnitFact, className: string): HTMLLIElement {
  const card = fact.card ? "mit Kaufland Card: " : "";
  if (fact.label === undefined) {
    return h(
      "li",
      { class: `${className}__unit` },
      h("span", { class: "unit-fact__text" }, card + fact.value),
    );
  }
  return h(
    "li",
    { class: `${className}__unit` },
    h(
      "span",
      { class: "unit-fact__label", ...(fact.card && { title: "mit Kaufland Card" }) },
      fact.card && icon("credit_card"),
      fact.card && h("span", { class: "visually-hidden" }, card),
      // "1 kg" and "1 l" never break; "pro Anwendung" may.
      fact.label.length <= 6 ? fact.label.replaceAll(" ", "\u00a0") : fact.label,
    ),
    h("span", { class: "unit-fact__value" }, fact.value),
  );
}

/** Unit facts and the multi-buy condition: the small print, apart from the description. */
function conditions(offer: Offer, className: string): Child[] {
  const facts = unitFacts(offer);
  const multiBuy = multiBuyText(offer.multiBuy);
  return [
    facts.length > 0 &&
      h("ul", { class: `${className}__units` }, ...facts.map((fact) => unitFact(fact, className))),
    multiBuy && h("p", { class: `${className}__extra` }, multiBuy),
  ];
}

function head(offer: Offer, className: string): Child[] {
  const { brand, name } = offerNames(offer);
  const pack = packText(offer);
  const description = splitDeposit(offer.description).text;
  return [
    brand && h("p", { class: `${className}__brand` }, brand),
    h("p", { class: `${className}__name` }, name),
    pack && h("p", { class: `${className}__pack` }, h("span", { class: "pack" }, pack)),
    description && h("p", { class: `${className}__description` }, description),
  ];
}

// ---------- Offers to pick from ----------

export function renderOfferTile(
  offer: Offer,
  onList: boolean,
  full: boolean,
  today: IsoDate,
  onToggle: (offer: Offer) => void,
): HTMLLIElement {
  const { name } = offerNames(offer);
  const discount = discountPercent(offer.price, offer.oldPrice);
  const late = lateStart(offer, today);
  const label = onList ? `${name} vom Zettel nehmen` : `${name} auf den Zettel setzen`;
  const [from, to] = salesText(offer).split(" – ");
  return h(
    "li",
    { class: `zoffer${onList ? " zoffer--picked" : ""}`, "data-key": offer.key },
    h("div", { class: "zoffer__media" }, tilePicture(offer)),
    (discount !== null || late !== null) &&
      h(
        "p",
        { class: "zoffer__badges" },
        discount !== null &&
          h("span", { class: "zoffer__discount" }, `−${String(discount)}\u00a0%`),
        late !== null && h("span", { class: "zoffer__late" }, `ab ${late}.`),
      ),
    // Direct children: each one sits in its own row of the list's grid (see `.zoffer`).
    ...head(offer, "zoffer"),
    ...conditions(offer, "zoffer"),
    h("div", { class: "zoffer__pricebox" }, prices(offer, "zoffer", false)),
    h(
      "p",
      { class: "zoffer__when" },
      h("span", {}, to === undefined ? from : `${from ?? ""} –`),
      to !== undefined && h("span", {}, to),
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

/** "erst ab Do." next to the days of an offer that starts later than its week. */
function lateMark(offer: Offer, today: IsoDate): HTMLElement | null {
  const late = lateStart(offer, today);
  return late === null ? null : h("span", { class: "late-mark" }, `erst ab ${late}.`);
}

export function renderItem(
  item: ListItem,
  status: ItemStatus,
  handlers: ItemHandlers,
  today: IsoDate,
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
            h(
              "p",
              { class: "zitem__when" },
              icon("schedule"),
              salesText(offer),
              lateMark(offer, today),
            ),
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
