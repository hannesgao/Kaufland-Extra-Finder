/** Date helpers. All calendar logic uses Europe/Berlin, the timezone of the leaflets. */

import type { IsoDate } from "./data";

const TZ = "Europe/Berlin";
const DAY_MS = 86_400_000;

const isoFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const weekdayFormat = new Intl.DateTimeFormat("de-DE", { weekday: "long", timeZone: "UTC" });
const stampFormat = new Intl.DateTimeFormat("de-DE", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Today's date in Berlin, e.g. "2026-10-08" (even when the browser is elsewhere). */
export function berlinToday(now: Date): IsoDate {
  return isoFormat.format(now);
}

function utc(iso: IsoDate): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return new Date(utc(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "08.10." */
export function formatDay(iso: IsoDate): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

/** "08.10.–14.10.2026" */
export function formatRange(from: IsoDate, to: IsoDate): string {
  return `${formatDay(from)}–${formatDay(to)}${to.slice(0, 4)}`;
}

/** "06.10.2026, 06:31 Uhr" */
export function formatStamp(date: Date): string {
  return `${stampFormat.format(date)} Uhr`;
}

/** "Diese Woche" for a running leaflet, "Ab Donnerstag" within a week, otherwise "Ab 15.10.". */
export function leafletLabel(validFrom: IsoDate, today: IsoDate): string {
  if (validFrom <= today) return "Diese Woche";
  if (daysBetween(today, validFrom) <= 6) {
    return `Ab ${weekdayFormat.format(new Date(utc(validFrom)))}`;
  }
  return `Ab ${formatDay(validFrom)}`;
}

export const STALE_AFTER_DAYS = 4;

export function isStale(generatedAt: Date, now: Date): boolean {
  return now.getTime() - generatedAt.getTime() > STALE_AFTER_DAYS * DAY_MS;
}
