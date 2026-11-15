/**
 * Texts and the picture of an offer tile, shared by the tiles of the shopping list tab and of the
 * "Extra-Angebote" tab. Pure apart from `tilePicture`.
 */

import type { IsoDate } from "../data";
import { formatDay, mondayOf, weekdayShort } from "../dates";
import { h } from "../dom";
import { icon, type IconName } from "../icons";
import { formatPrice } from "./cards";

interface SalesDays {
  salesFrom: IsoDate;
  salesTo: IsoDate;
}

/** "Mo, 09.11. – Sa, 14.11." */
export function salesText(offer: SalesDays): string {
  const day = (iso: IsoDate) => `${weekdayShort(iso)}, ${formatDay(iso)}`;
  return offer.salesFrom === offer.salesTo
    ? `nur ${day(offer.salesFrom)}`
    : `${day(offer.salesFrom)} – ${day(offer.salesTo)}`;
}

/**
 * "Do" for an offer that has not started and does not start with its week: most offers apply
 * from Monday, so the others are easy to miss. Null for all others.
 */
export function lateStart(offer: Pick<SalesDays, "salesFrom">, today: IsoDate): string | null {
  const { salesFrom } = offer;
  return salesFrom > today && salesFrom !== mondayOf(salesFrom) ? weekdayShort(salesFrom) : null;
}

/** Kaufland compares some prices with the list price: "UVP 47.69" becomes "UVP 47,69 €". */
export function comparisonPrice(oldPrice: string): string {
  const listPrice = /^UVP\s+(\d+(?:\.\d+)?)$/.exec(oldPrice)?.[1];
  return listPrice === undefined ? formatPrice(oldPrice) : `UVP\u00a0${formatPrice(listPrice)}`;
}

/**
 * What the price is for: "Ka. 20 x 0,5-l-Fl.". Shown right under the name, because offers of
 * one product in two pack sizes differ in nothing else.
 */
export function packText(offer: { unit?: string }): string | null {
  // "je Ka. 20 x 0,5-l-Fl." and the odd "je-1,5kg-Bund": the label needs no "je".
  const pack = offer.unit?.trim().replace(/^je(?:[\s-]+|$)/, "");
  return pack === undefined || pack === "" ? null : pack;
}

/** Two to five tiles per row; see `.zoffers`. */
const TILE_SIZES =
  "(min-width: 1100px) 220px, (min-width: 840px) 25vw, (min-width: 600px) 33vw, 50vw";

/** The square picture of a tile: 150 px or 322 px wide, whichever the tile needs. */
export function tilePicture(
  offer: { thumbnail?: string; thumbnail2x?: string },
  placeholder: IconName = "grocery",
): Element {
  const { thumbnail, thumbnail2x } = offer;
  if (!thumbnail) {
    return h("span", { class: "zoffer__thumb zoffer__thumb--empty" }, icon(placeholder));
  }
  return h("img", {
    class: "zoffer__thumb",
    src: thumbnail,
    ...(thumbnail2x && { srcset: `${thumbnail} 150w, ${thumbnail2x} 322w`, sizes: TILE_SIZES }),
    alt: "",
    width: "322",
    height: "322",
    loading: "lazy",
    decoding: "async",
    referrerpolicy: "no-referrer",
  });
}
