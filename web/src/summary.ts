/** Status texts for both tabs; they change with the "laut PDF" switch. */

import type { StoreView } from "./search";

export interface Counts {
  /** Stores shown. */
  shown: number;
  /** Stores hidden by the switch (all their leaflets name a different store). */
  hidden: number;
  /** Shown stores with at least one leaflet whose PDF check is still open. */
  unchecked: number;
}

const filialen = (n: number) => `${String(n)} ${n === 1 ? "Filiale" : "Filialen"}`;
const GILT = "für die der Extra-Prospekt laut PDF gilt";

export function countUnchecked(views: readonly StoreView[]): number {
  return views.filter((v) => v.leaflets.some((l) => l.leaflet.pdfStoreMatch === undefined)).length;
}

function hiddenNote({ hidden, unchecked }: Counts): string {
  const parts = [];
  if (hidden > 0) parts.push(`${filialen(hidden)} ausgeblendet`);
  if (unchecked > 0) parts.push(`bei ${filialen(unchecked)} ist die PDF-Prüfung noch offen`);
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

/** "4 Extra-Filialen im Umkreis von 25 km um PLZ 76131." */
export function radiusStatus(counts: Counts, radius: number, where: string, pdfOnly: boolean) {
  const area = `im Umkreis von ${String(radius)} km ${where}`;
  if (!pdfOnly) {
    const n = counts.shown;
    return `${String(n)} ${n === 1 ? "Extra-Filiale" : "Extra-Filialen"} ${area}.`;
  }
  return `${filialen(counts.shown)}, ${GILT}, ${area}${hiddenNote(counts)}.`;
}

export function nearestStatus(distance: string, radius: number, where: string, pdfOnly: boolean) {
  const none = pdfOnly ? `Keine Filiale, ${GILT},` : "Keine Extra-Filiale";
  return (
    `${none} im Umkreis von ${String(radius)} km ${where}. ` +
    `Die nächste ist ${distance} entfernt.`
  );
}

export function emptyStatus(pdfOnly: boolean): string {
  return pdfOnly
    ? `Derzeit ist keine Filiale bekannt, ${GILT}.`
    : "Derzeit ist keine Filiale mit Extra-Angeboten bekannt.";
}

/** "102 Filialen mit Extra-Prospekt" / "55 Filialen, für die … gilt (47 Filialen ausgeblendet, …)" */
export function listSummary(counts: Counts, pdfOnly: boolean): string {
  if (!pdfOnly) return `${filialen(counts.shown)} mit Extra-Prospekt`;
  return `${filialen(counts.shown)}, ${GILT}${hiddenNote(counts)}`;
}

/* ---------- Pokémon-Angebot-Finder ---------- */

const mitAngeboten = (n: number) =>
  `${String(n)} ${n === 1 ? "Filiale" : "Filialen"} mit Pokémon-Angeboten`;

/** "3 Filialen mit Pokémon-Angeboten im Umkreis von 25 km um PLZ 76131." */
export function cardsStatus(count: number, radius: number, where: string): string {
  return `${mitAngeboten(count)} im Umkreis von ${String(radius)} km ${where}.`;
}

export function cardsNearestStatus(distance: string, radius: number, where: string): string {
  return (
    `Keine Filiale mit Pokémon-Angeboten im Umkreis von ${String(radius)} km ${where}. ` +
    `Die nächste ist ${distance} entfernt.`
  );
}

export const CARDS_EMPTY = "Derzeit sind keine Pokémon-Angebote bekannt.";
export const CARDS_MISSING =
  "Noch keine Pokémon-Angebote verfügbar. Sie werden montags und donnerstags aktualisiert.";
