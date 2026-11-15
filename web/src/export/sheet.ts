/**
 * The shopping list as a PDF: A4 pages laid out here, so that what is printed does not depend on
 * the browser's print dialog. Two layouts: clippings (three cards per row with large pictures)
 * and rows (two columns under a heading per department, all rows of a page equally tall and on
 * lines shared by both columns). Pages that are followed by another one are filled to the
 * bottom: cards get taller pictures, rows get more room.
 *
 * Pure: pictures are passed in (see `jpeg.ts`); without them the boxes stay empty and the layout
 * is the same, which is how the page count is known before anything is loaded.
 */

import type { IsoDate } from "../data";
import { berlinToday, formatDate, formatDay, weekdayShort } from "../dates";
import { discountPercent } from "../deals";
import { departmentOf } from "../offers";
import { groupItems, OWN_ENTRIES, type Layout, type ListItem, type ListStore } from "../shopping";
import { formatPrice } from "../ui/cards";
import { multiBuyText, offerNames, splitDeposit, unitFacts } from "../ui/shopping";
import { comparisonPrice, lateStart, packText, salesText } from "../ui/tile";
import { wrapText } from "./layout";
import { CAP, Page, PAGE_H, PAGE_W, pdfBlob, pdfFile, textWidth, type PdfImage } from "./pdfdoc";

export interface SheetOptions {
  store: ListStore | null;
  items: readonly ListItem[];
  layout: Layout;
  /** A page (or more) of its own for every day on which offers start. */
  split: boolean;
  /** When the offer data was read; null when it is not loaded. */
  generatedAt: Date | null;
  today: IsoDate;
}

/* ---------- Sections ---------- */

export interface SheetSection {
  /** "Gültig ab Do, 19.11."; null for a list that is not split. */
  heading: string | null;
  items: ListItem[];
}

/**
 * With `split`, one section per day on which offers of the list start; offers that already
 * apply share one. Free-text entries and ended offers belong to no day: they go first.
 */
export function sheetSections(
  items: readonly ListItem[],
  split: boolean,
  today: IsoDate,
): SheetSection[] {
  if (!split) return [{ heading: null, items: [...items] }];
  const byStart = new Map<string, ListItem[]>();
  const other: ListItem[] = [];
  for (const item of items) {
    const { offer } = item;
    if (!offer || offer.salesTo < today) {
      other.push(item);
      continue;
    }
    // Everything that has started is one group, whatever day it started on.
    const start = offer.salesFrom <= today ? "" : offer.salesFrom;
    byStart.set(start, [...(byStart.get(start) ?? []), item]);
  }
  const sections = [...byStart]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, list]) => ({
      heading:
        start === "" ? "Jetzt gültig" : `Gültig ab ${weekdayShort(start)}, ${formatDay(start)}`,
      items: list,
    }));
  const [first] = sections;
  if (!first) return [{ heading: null, items: other }];
  first.items = [...first.items, ...other];
  return sections;
}

/* ---------- What is printed of an item ---------- */

interface Facts {
  /** "2×" */
  quantity: string;
  brand: string;
  name: string;
  pack: string;
  description: string;
  price: string;
  deposit: string;
  oldPrice: string;
  /** "-57 %" */
  discount: string;
  cardPrice: string;
  /** The offer has no regular price. */
  cardOnly: boolean;
  units: { label: string; value: string }[];
  multiBuy: string;
  when: string;
  /** "erst ab Do." */
  late: string;
  note: string;
  department: string;
}

/** `late` is left out when the page already says from when its offers apply. */
function facts(item: ListItem, { today, showLate }: Context): Facts {
  const { offer } = item;
  const base = {
    quantity: item.quantity > 1 ? `${String(item.quantity)}×` : "",
    note: item.note,
  };
  if (!offer) {
    return {
      ...base,
      brand: "",
      name: item.text ?? "",
      pack: "",
      description: "",
      price: "",
      deposit: "",
      oldPrice: "",
      discount: "",
      cardPrice: "",
      cardOnly: false,
      units: [],
      multiBuy: "",
      when: "",
      late: "",
      department: OWN_ENTRIES,
    };
  }
  const { brand, name } = offerNames(offer);
  const { text, deposit } = splitDeposit(offer.description);
  const discount = discountPercent(offer.price, offer.oldPrice);
  const late = showLate ? lateStart(offer, today) : null;
  return {
    ...base,
    brand,
    name,
    pack: packText(offer) ?? "",
    description: text ?? "",
    price: offer.price === undefined ? "" : formatPrice(offer.price),
    deposit: deposit === undefined ? "" : `+ ${formatPrice(deposit)} Pfand`,
    oldPrice: offer.oldPrice === undefined ? "" : comparisonPrice(offer.oldPrice),
    discount: discount === null ? "" : `-${String(discount)} %`,
    cardPrice: offer.cardPrice === undefined ? "" : formatPrice(offer.cardPrice),
    cardOnly: offer.price === undefined,
    units: unitFacts(offer).map((fact) => ({
      label: `${fact.card ? "Mit Karte: " : ""}${fact.label ?? ""}`.trim(),
      value: fact.value,
    })),
    multiBuy: multiBuyText(offer.multiBuy) ?? "",
    when: offer.salesTo < today ? `Abgelaufen: ${salesText(offer)}` : salesText(offer),
    late: late === null ? "" : `erst ab ${late}.`,
    department: departmentOf(offer),
  };
}

/** The picture an item is printed with: the large one on cards, the small one in rows. */
function pictureUrl(item: ListItem, layout: Layout): string | undefined {
  const { thumbnail, thumbnail2x } = item.offer ?? {};
  return layout === "kacheln" ? (thumbnail2x ?? thumbnail) : (thumbnail ?? thumbnail2x);
}

/** The pictures the sheet needs, each once. */
export function sheetPictures(items: readonly ListItem[], layout: Layout): string[] {
  const urls = items.map((item) => pictureUrl(item, layout));
  return [...new Set(urls.filter((url): url is string => url !== undefined))];
}

/* ---------- Page frame ---------- */

const MARGIN = 34;
const WIDTH = PAGE_W - 2 * MARGIN;
const FOOT_SIZE = 7;
/** Content ends here; the footer line is below. */
const BOTTOM = PAGE_H - MARGIN - 13;

const INK = "#000000";
const MUTED = "#444444";
const RULE = "#9a9a9a";
const SOFT = "#ebebeb";
const RED = "#b3261e";
const BLUE = "#2b4a9b";
const WHITE = "#ffffff";

type Pictures = ReadonlyMap<string, { index: number; width: number; height: number }>;

/** What laying out an item needs to know. */
interface Context {
  today: IsoDate;
  pictures: Pictures;
  /** Mark offers that start later than Monday; not on pages that are headed with the day. */
  showLate: boolean;
}

/** Lines of a text in a width; more than `max` lines end with an ellipsis. */
function fit(text: string, width: number, size: number, bold: boolean, max: number): string[] {
  if (!text) return [];
  const measure = (t: string) => textWidth(t, size, bold);
  const all = wrapText(text, width, measure);
  if (all.length <= max) return all;
  let last = `${all[max - 1] ?? ""} ${all[max] ?? ""}`;
  while (last.length > 1 && measure(`${last}…`) > width) last = last.slice(0, -1);
  return [...all.slice(0, max - 1), `${last.trimEnd()}…`];
}

/** Text lines stacked from `top`; returns the height they take. */
function stack(
  page: Page | null,
  lines: readonly string[],
  x: number,
  top: number,
  size: number,
  lineHeight: number,
  bold: boolean,
  color: string,
): number {
  lines.forEach((line, n) => {
    page?.text(line, x, top + n * lineHeight + (lineHeight + size * CAP) / 2, size, bold, color);
  });
  return lines.length * lineHeight;
}

function right(
  page: Page,
  text: string,
  edge: number,
  baseline: number,
  size: number,
  bold: boolean,
  color: string,
): void {
  page.text(text, edge - textWidth(text, size, bold), baseline, size, bold, color);
}

/** A price that no longer applies: grey with a line through it. Returns its width. */
function struck(page: Page, text: string, x: number, baseline: number, size: number): number {
  const width = textWidth(text, size);
  page.text(text, x, baseline, size, false, MUTED);
  page.line(x - 0.5, baseline - size * 0.28, x + width + 0.5, baseline - size * 0.28, 0.5, MUTED);
  return width;
}

function checkbox(page: Page, x: number, top: number, size: number): void {
  page.frame(x + 0.4, top + 0.4, size - 0.8, size - 0.8, 0.8, INK);
}

/** A picture scaled into its box and centred; an empty box stays white. */
function picture(
  page: Page,
  pictures: Pictures,
  url: string | undefined,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  const image = url === undefined ? undefined : pictures.get(url);
  if (!image) return;
  const scale = Math.min(w / image.width, h / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.image(image.index, x + (w - width) / 2, top + (h - height) / 2, width, height);
}

/** A filled label with white text; returns its height. */
function badge(page: Page, text: string, x: number, top: number, color: string): number {
  const size = 7.5;
  const height = 11.5;
  page.rect(x, top, textWidth(text, size, true) + 8, height, color);
  page.text(text, x + 4, top + (height + size * CAP) / 2, size, true, WHITE);
  return height;
}

/* ---------- Blocks: what is flowed onto pages ---------- */

/**
 * A piece of content with a height. `stretch` is how much taller it may be drawn to fill a
 * page and `shrink` how much shorter to make room for one more block; `draw` gets the extra
 * height it was given (negative when shrunk).
 */
interface Block {
  height: number;
  stretch: number;
  shrink?: number;
  /** Stays on the page of the block after it. */
  keepWithNext?: true;
  draw(page: Page, x: number, top: number, extra: number): void;
}

const HEADING = 19;

function heading(title: string, width: number): Block {
  return {
    height: HEADING,
    stretch: 0,
    keepWithNext: true,
    draw(page, x, top) {
      page.text(title.toUpperCase(), x, top + 13, 7.5, true, INK);
      page.line(x, top + 16.5, x + width, top + 16.5, 0.8, INK);
    },
  };
}

/* ----- Clippings ----- */

const CARD_GAP = 8;
const CARD_COLUMNS = 3;
const CARD_W = (WIDTH - (CARD_COLUMNS - 1) * CARD_GAP) / CARD_COLUMNS;
const CARD_PAD = 7;
const CARD_INNER = CARD_W - 2 * CARD_PAD;
const CARD_PICTURE = 84;
/** A picture grows by at most this much to fill a page, */
const CARD_STRETCH = 76;
/** and gives up at most this much so that one more row fits. */
const CARD_SHRINK = 28;

interface CardParts {
  /** Height of what is above the picture and below it down to the description. */
  upper: number;
  /** Height of prices, unit facts, dates and note: set at the bottom of the card. */
  lower: number;
  draw(page: Page, x: number, top: number, height: number, pictureHeight: number): void;
}

function card(item: ListItem, context: Context): CardParts {
  const f = facts(item, context);
  const w = CARD_INNER;
  const brand = fit(f.brand, w, 7, true, 1);
  const name = fit(f.name, w, 9.5, false, 3);
  const pack = fit(f.pack, w, 7.5, true, 2);
  const description = fit(f.description, w, 7.5, false, 3);
  const multi = fit(f.multiBuy, w, 7.5, true, 2);
  const note = fit(f.note && `Notiz: ${f.note}`, w, 8, false, 2);
  const priceRow = f.price || f.oldPrice ? 18 : 0;
  const cardRow = f.cardPrice ? 14 : 0;

  // Above the bottom part: check box line, picture, names.
  const texts = (page: Page | null, x: number, top: number): number => {
    let y = top;
    y += stack(page, brand, x, y, 7, 9, true, INK);
    y += stack(page, name, x, y, 9.5, 11.5, false, INK);
    y += stack(page, pack, x, y + 1, 7.5, 9.5, true, INK) + (pack.length ? 2 : 0);
    y += stack(page, description, x, y, 7.5, 9.5, false, MUTED);
    return y - top;
  };
  const bottom = (page: Page | null, x: number, top: number): number => {
    let y = top;
    if (priceRow) {
      const baseline = y + 14;
      let at = x;
      if (f.price) {
        page?.text(f.price, at, baseline, 14, true, INK);
        at += textWidth(f.price, 14, true) + 5;
      }
      if (f.oldPrice && page) at += struck(page, f.oldPrice, at, baseline, 8) + 5;
      if (f.deposit) page?.text(f.deposit, at, baseline, 7, false, MUTED);
      y += priceRow;
    }
    if (cardRow) {
      const label = f.cardOnly ? "nur mit Kaufland Card" : "mit Kaufland Card";
      page?.text(f.cardPrice, x, y + 10.5, 11, true, BLUE);
      page?.text(label, x + textWidth(f.cardPrice, 11, true) + 5, y + 10.5, 7, false, BLUE);
      y += cardRow;
    }
    if (f.units.length) {
      y += 2;
      for (const unit of f.units) {
        const value = unit.label ? unit.value : "";
        const label = fit(unit.label || unit.value, w - textWidth(value, 7.5) - 4, 7.5, false, 1);
        stack(page, label, x, y, 7.5, 9.5, false, INK);
        if (value && page) right(page, value, x + w, y + (9.5 + 7.5 * CAP) / 2, 7.5, false, INK);
        y += 9.5;
      }
    }
    y += stack(page, multi, x, y + 1, 7.5, 9.5, true, INK) + (multi.length ? 1 : 0);
    if (f.when) {
      y += 2;
      page?.line(x, y, x + w, y, 0.4, RULE);
      y += 1.5;
      y += stack(page, [f.when], x, y, 7.5, 10, false, MUTED);
    }
    y += stack(page, note, x, y + 1, 8, 10, false, INK) + (note.length ? 1 : 0);
    return y - top;
  };
  const upper = 12 + 4 + 5 + texts(null, 0, 0) + 5;
  const lower = bottom(null, 0, 0);
  return {
    upper,
    lower,
    draw(page, x, top, height, pictureHeight) {
      page.frame(x, top, CARD_W, height, 0.5, RULE);
      const left = x + CARD_PAD;
      let y = top + CARD_PAD;
      checkbox(page, left, y, 10);
      if (f.quantity) page.text(f.quantity, left + 14, y + 8.3, 10, true, INK);
      const room = w - 14 - (f.quantity ? textWidth(f.quantity, 10, true) + 6 : 0);
      const [department] = fit(f.department, room, 6.5, false, 1);
      if (department) right(page, department, left + w, y + 7.5, 6.5, false, MUTED);
      y += 12 + 4;
      picture(page, context.pictures, pictureUrl(item, "kacheln"), left, y, w, pictureHeight);
      let badgeTop = y;
      if (f.discount) badgeTop += badge(page, f.discount, left, badgeTop, RED) + 2;
      if (f.late) badge(page, f.late, left, badgeTop, BLUE);
      y += pictureHeight + 5;
      texts(page, left, y);
      bottom(page, left, top + height - CARD_PAD - lower);
    },
  };
}

function cardRow(items: readonly ListItem[], context: Context): Block {
  const cards = items.map((item) => card(item, context));
  const height =
    2 * CARD_PAD +
    CARD_PICTURE +
    Math.max(...cards.map((c) => c.upper)) +
    Math.max(...cards.map((c) => c.lower));
  return {
    height: height + CARD_GAP,
    stretch: CARD_STRETCH,
    shrink: CARD_SHRINK,
    draw(page, x, top, extra) {
      cards.forEach((c, i) => {
        c.draw(page, x + i * (CARD_W + CARD_GAP), top, height + extra, CARD_PICTURE + extra);
      });
    },
  };
}

/** Free-text entries: a check box, the text and the note, three per row. */
function textRow(items: readonly ListItem[], context: Context): Block {
  const w = CARD_W - 16;
  const cells = items.map((item) => {
    const f = facts(item, context);
    const name = fit(`${f.quantity} ${f.name}`.trim(), w, 9.5, false, 3);
    const note = fit(f.note, w, 7.5, false, 2);
    return { name, note, height: name.length * 12 + note.length * 9.5 + 6 };
  });
  return {
    height: Math.max(...cells.map((c) => c.height)),
    stretch: 0,
    draw(page, x, top) {
      cells.forEach((cell, i) => {
        const left = x + i * (CARD_W + CARD_GAP);
        checkbox(page, left, top + 1, 10);
        const y = top + stack(page, cell.name, left + 16, top, 9.5, 12, false, INK);
        stack(page, cell.note, left + 16, y, 7.5, 9.5, false, MUTED);
      });
    },
  };
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function cardBlocks(items: readonly ListItem[], context: Context): Block[] {
  // One grid for all offers, in the order of the departments; free text after it.
  const groups = groupItems(items);
  const offers = groups.filter((g) => g.title !== OWN_ENTRIES).flatMap((g) => g.items);
  const own = groups.filter((g) => g.title === OWN_ENTRIES).flatMap((g) => g.items);
  return [
    ...chunks(offers, CARD_COLUMNS).map((row) => cardRow(row, context)),
    ...(own.length
      ? [heading(OWN_ENTRIES, WIDTH), ...chunks(own, CARD_COLUMNS).map((r) => textRow(r, context))]
      : []),
  ];
}

/* ----- Rows ----- */

const ROW_GAP = 18;
const ROW_COLUMNS = 2;
const ROW_W = (WIDTH - (ROW_COLUMNS - 1) * ROW_GAP) / ROW_COLUMNS;
const ROW_PICTURE = 32;
const ROW_PRICES = 62;
const ROW_TEXT_X = 14 + ROW_PICTURE + 7;
const ROW_TEXT_W = ROW_W - ROW_TEXT_X - ROW_PRICES - 6;
/** A row of the list. Rows are set on lines shared by both columns: see `Line`. */
interface Row {
  /** The department, on the first row of its group. */
  heading: string | null;
  height: number;
  draw(page: Page, x: number, top: number): void;
}

function row(item: ListItem, heading: string | null, context: Context): Row {
  const f = facts(item, context);
  const offer = item.offer !== undefined;
  const textX = offer ? ROW_TEXT_X : 14;
  const w = offer ? ROW_TEXT_W : ROW_W - 14;
  const brand = fit(f.brand, w, 6.5, true, 1);
  const name = fit(`${f.quantity} ${f.name}`.trim(), w, 9, false, 2);
  const detail = fit([f.pack, f.description].filter(Boolean).join(" · "), w, 7.5, false, 2);
  const units = fit(
    [...f.units.map((u) => (u.label ? `${u.label} = ${u.value}` : u.value)), f.multiBuy]
      .filter(Boolean)
      .join(" · "),
    w,
    7.5,
    false,
    2,
  );
  const late = f.late ? ` (${f.late})` : "";
  const when = fit(f.when && `${f.when}${late}`, w, 7.5, false, 1);
  const note = fit(f.note && `Notiz: ${f.note}`, w, 7.5, false, 2);
  const text = (page: Page | null, x: number, top: number): number => {
    let y = top;
    y += stack(page, brand, x, y, 6.5, 8.5, true, INK);
    y += stack(page, name, x, y, 9, 11, false, INK);
    y += stack(page, detail, x, y, 7.5, 9.5, false, MUTED);
    y += stack(page, units, x, y, 7.5, 9.5, false, INK);
    y += stack(page, when, x, y, 7.5, 9.5, f.late !== "", f.late ? BLUE : MUTED);
    y += stack(page, note, x, y, 7.5, 9.5, false, INK);
    return y - top;
  };
  const prices = (page: Page | null, edge: number, top: number): number => {
    let y = top;
    if (f.price) {
      if (page) right(page, f.price, edge, y + 10, 11, true, INK);
      y += 13;
    }
    if (f.oldPrice || f.discount) {
      if (page) {
        const old = f.oldPrice ? textWidth(f.oldPrice, 7.5) : 0;
        if (f.oldPrice) struck(page, f.oldPrice, edge - old, y + 7.5, 7.5);
        if (f.discount) {
          right(page, f.discount, edge - old - (old ? 5 : 0), y + 7.5, 7.5, true, RED);
        }
      }
      y += 10;
    }
    if (f.cardPrice) {
      if (page) {
        right(page, f.cardPrice, edge, y + 9, 9.5, true, BLUE);
        right(page, "Karte", edge - textWidth(f.cardPrice, 9.5, true) - 3, y + 9, 6.5, false, BLUE);
      }
      y += 12;
    }
    if (f.deposit) {
      if (page) right(page, f.deposit, edge, y + 7, 6.5, false, MUTED);
      y += 9;
    }
    return y - top;
  };
  const inner = Math.max(text(null, 0, 0), prices(null, 0, 0), offer ? ROW_PICTURE : 12);
  const pad = 4;
  return {
    heading,
    height: inner + 2 * pad + 0.5,
    draw(page, x, top) {
      const y = top + pad;
      checkbox(page, x, y + 1, 10);
      if (offer)
        picture(
          page,
          context.pictures,
          pictureUrl(item, "liste"),
          x + 14,
          y,
          ROW_PICTURE,
          ROW_PICTURE,
        );
      text(page, x + textX, y);
      prices(page, x + ROW_W, y);
    },
  };
}

function rows(items: readonly ListItem[], context: Context): Row[] {
  return groupItems(items).flatMap((group) =>
    group.items.map((item, i) => row(item, i === 0 ? group.title : null, context)),
  );
}

/**
 * One line of the page: the n-th row of the left column beside the n-th of the right one. A
 * department heading on either side takes a band above both, so the rows stay side by side.
 */
interface Line {
  cells: (Row | undefined)[];
  head: number;
}

/** The first `count` rows down the left column, the next `count` down the right one. */
function lines(list: readonly Row[], count: number): Line[] {
  return Array.from({ length: count }, (_, n) => {
    const cells = Array.from({ length: ROW_COLUMNS }, (__, c) => list[c * count + n]);
    return { cells, head: cells.some((cell) => cell?.heading != null) ? HEADING : 0 };
  });
}

interface RowPage {
  lines: Line[];
  /** Every row of the page is this tall. */
  rowHeight: number;
}

/** No row is shorter than this: stops the search for how many lines fit. */
const ROW_MIN = 20;

/**
 * Rows onto pages. The left column is filled first, down to the bottom, then the right one.
 * All rows of a page are as tall as its tallest, and a page takes as many lines as fit that
 * way; the room that is left then goes into the rows, so that lines and headings together are
 * exactly as tall as the page. Only a list that fits into one column keeps its room below.
 */
function rowPages(list: readonly Row[], room: number): RowPage[] {
  const pages: RowPage[] = [];
  let rest = list;
  while (rest.length) {
    let best: { page: Line[]; tallest: number; heads: number } | undefined;
    for (let n = 1; n <= rest.length && (n === 1 || n * ROW_MIN <= room); n++) {
      const page = lines(rest, n);
      const shown = rest.slice(0, n * ROW_COLUMNS);
      const tallest = Math.max(...shown.map((row) => row.height));
      const heads = page.reduce((sum, line) => sum + line.head, 0);
      if (n === 1 || n * tallest + heads <= room) best = { page, tallest, heads };
    }
    if (!best) break;
    const count = best.page.length;
    // More rows than the left column holds: it is stretched to end at the bottom.
    const filled = rest.length > count ? (room - best.heads) / count : 0;
    pages.push({ lines: best.page, rowHeight: Math.max(best.tallest, filled) });
    rest = rest.slice(count * ROW_COLUMNS);
  }
  return pages;
}

function drawRows(page: Page, sheet: RowPage, top: number): number {
  let y = top;
  for (const line of sheet.lines) {
    const rule = y + line.head + sheet.rowHeight;
    line.cells.forEach((cell, c) => {
      if (!cell) return;
      const x = MARGIN + c * (ROW_W + ROW_GAP);
      if (cell.heading !== null) heading(cell.heading, ROW_W).draw(page, x, y, 0);
      cell.draw(page, x, y + line.head);
      page.line(x, rule, x + ROW_W, rule, 0.4, RULE);
    });
    y = rule;
  }
  return y;
}

/* ---------- Flowing blocks onto pages ---------- */

/** The blocks of one page, top to bottom. */
interface Column {
  blocks: Block[];
  /** More of the section follows: the page is filled to the bottom. */
  full: boolean;
}

interface SheetPage {
  section: number;
  /** Draws the content from `top` and returns where it ends. */
  draw(page: Page, top: number, room: number): number;
}

/** Fill pages in turn; a block that does not fit starts the next one. */
function flow(blocks: readonly Block[], room: number): Column[] {
  const pages: Column[] = [];
  let column: Column | undefined;
  let used = 0;
  let give = 0;
  const next = (): Column => {
    if (column) column.full = true;
    const fresh = { blocks: [], full: false };
    pages.push(fresh);
    used = 0;
    give = 0;
    return fresh;
  };
  blocks.forEach((block, i) => {
    // A heading takes its first item along.
    const after = block.keepWithNext ? blocks[i + 1] : undefined;
    const needed = block.height + (after?.height ?? 0);
    const shrink = give + (block.shrink ?? 0) + (after?.shrink ?? 0);
    if (!column || (column.blocks.length > 0 && used + needed - shrink > room)) column = next();
    column.blocks.push(block);
    used += block.height;
    give += block.shrink ?? 0;
  });
  return pages;
}

/**
 * Draw a page of blocks. A full one spreads the room that is left over its blocks: first into the
 * blocks that stretch, then between the blocks, each up to a limit. A column that holds more
 * than its room (see `flow`) takes the difference from the blocks that shrink.
 */
function drawColumn(page: Page, column: Column, top: number, room: number): number {
  const used = column.blocks.reduce((sum, block) => sum + block.height, 0);
  let spare = room - used;
  if (spare > 0 && !column.full) spare = 0;
  const elastic = column.blocks.filter((block) => (spare < 0 ? block.shrink : block.stretch));
  const limit = Math.min(...elastic.map((b) => (spare < 0 ? (b.shrink ?? 0) : b.stretch)));
  const each = elastic.length
    ? Math.sign(spare) * Math.min(Math.abs(spare) / elastic.length, limit)
    : 0;
  spare -= each * elastic.length;
  const gaps = column.blocks.length - 1;
  const gap = gaps > 0 && spare > 0 ? Math.min(spare / gaps, 10) : 0;
  let y = top;
  for (const block of column.blocks) {
    const extra = elastic.includes(block) ? each : 0;
    block.draw(page, MARGIN, y, extra);
    y += block.height + extra + gap;
  }
  return y - (column.blocks.length ? gap : 0);
}

/* ---------- The document ---------- */

function storeLine(store: ListStore | null): string {
  return store ? `Kaufland ${store.name}, ${store.street}, ${store.plz} ${store.city}` : "";
}

/** Title, store and the section's heading; returns where the content starts. */
function drawHead(page: Page, options: SheetOptions, section: SheetSection): number {
  const title = "Einkaufszettel";
  page.text(title, MARGIN, MARGIN + 15 * CAP, 15, true, INK);
  const room = WIDTH - textWidth(title, 15, true) - 16;
  const [store] = fit(storeLine(options.store), room, 8.5, false, 1);
  if (store) right(page, store, MARGIN + WIDTH, MARGIN + 15 * CAP, 8.5, false, INK);
  let top = MARGIN + 18;
  const count = `${String(section.items.length)} ${section.items.length === 1 ? "Eintrag" : "Einträge"}`;
  if (section.heading === null) {
    page.line(MARGIN, top, MARGIN + WIDTH, top, 1, INK);
    return top + 8;
  }
  page.rect(MARGIN, top, WIDTH, 18, SOFT);
  page.text(section.heading, MARGIN + 7, top + 9 + 11 * CAP * 0.5, 11, true, INK);
  right(page, count, MARGIN + WIDTH - 7, top + 9 + 8 * CAP * 0.5, 8, false, INK);
  top += 18;
  return top + 8;
}

/** Where the content starts below the head; the same on every page of a section. */
function contentTop(section: SheetSection): number {
  return MARGIN + 18 + (section.heading === null ? 8 : 26);
}

interface Laid {
  pages: Page[];
  /** For every page: where its content ends (points from the top). */
  ends: number[];
}

function lay(options: SheetOptions, pictures: Pictures): Laid {
  const sections = sheetSections(options.items, options.split, options.today);
  const context = { today: options.today, pictures, showLate: !options.split };
  const sheets: SheetPage[] = [];
  sections.forEach((section, index) => {
    const room = BOTTOM - contentTop(section);
    const draws: SheetPage["draw"][] =
      options.layout === "kacheln"
        ? flow(cardBlocks(section.items, context), room).map(
            (column) => (page, top, space) => drawColumn(page, column, top, space),
          )
        : rowPages(rows(section.items, context), room).map(
            (sheet) => (page, top) => drawRows(page, sheet, top),
          );
    // A section without anything still gets its page (an empty list is not printed at all).
    for (const draw of draws.length ? draws : [(_: Page, top: number) => top]) {
      sheets.push({ section: index, draw });
    }
  });

  const stand = options.generatedAt
    ? `Angebote laut kaufland.de, Stand ${formatDate(berlinToday(options.generatedAt))}. `
    : "";
  const footer = `${stand}Preise und Verfügbarkeit ohne Gewähr.`;
  const ends: number[] = [];
  const pages = sheets.map((sheet, i) => {
    const page = new Page();
    const section = sections[sheet.section] ?? { heading: null, items: [] };
    const top = drawHead(page, options, section);
    const room = BOTTOM - top;
    ends.push(sheet.draw(page, top, room));
    const baseline = PAGE_H - MARGIN;
    page.text(footer, MARGIN, baseline, FOOT_SIZE, false, MUTED);
    const number = `Seite ${String(i + 1)}/${String(sheets.length)}`;
    right(page, number, MARGIN + WIDTH, baseline, FOOT_SIZE, false, MUTED);
    return page;
  });
  return { pages, ends };
}

/** The pages and where their content ends, for tests. */
export function sheetLayout(options: SheetOptions): {
  pages: number;
  ends: number[];
  bottom: number;
} {
  const { pages, ends } = lay(options, new Map());
  return { pages: pages.length, ends, bottom: BOTTOM };
}

export function sheetPageCount(options: SheetOptions): number {
  return options.items.length ? lay(options, new Map()).pages.length : 0;
}

export function sheetTitle(store: ListStore | null): string {
  return store ? `Einkaufszettel Kaufland ${store.name}` : "Einkaufszettel";
}

/** The PDF file as a string of byte values 0–255. */
export function sheetSource(options: SheetOptions, images: ReadonlyMap<string, PdfImage>): string {
  const list = [...images];
  const pictures = new Map(
    list.map(([url, image], index) => [url, { index, width: image.width, height: image.height }]),
  );
  const { pages } = lay(options, pictures);
  return pdfFile(
    pages,
    sheetTitle(options.store),
    list.map(([, image]) => image),
  );
}

export function sheetPdf(options: SheetOptions, images: ReadonlyMap<string, PdfImage>): Blob {
  return pdfBlob(sheetSource(options, images));
}
