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

/**
 * "45 Filialen mit Extra-Prospekt, 57 weitere derzeit ohne" /
 * "33 Filialen, für die … gilt (12 Filialen ausgeblendet), 17 weitere derzeit ohne"
 */
export function listSummary(counts: Counts, pdfOnly: boolean, dormant = 0): string {
  const current = pdfOnly
    ? `${filialen(counts.shown)}, ${GILT}${hiddenNote(counts)}`
    : `${filialen(counts.shown)} mit Extra-Prospekt`;
  return dormant > 0 ? `${current}, ${String(dormant)} weitere derzeit ohne` : current;
}

/** When no store has a current Extra leaflet: Kaufland does not publish one every week. */
export function noLeafletStatus(latest: { text: string; stores: number } | null): string {
  const now = "Derzeit gibt es keinen Extra-Prospekt.";
  return latest ? `${now} Zuletzt: ${latest.text} (${filialen(latest.stores)}).` : now;
}

/* ---------- Extra stores without a current leaflet ---------- */

export function dormantTitle(n: number, nearby: boolean): string {
  return `${nearby ? "Im Umkreis derzeit" : "Derzeit"} ohne Extra-Prospekt (${String(n)})`;
}

export function dormantIntro(since: string | null, pdfOnly: boolean): string {
  const when = since ? ` seit dem ${since}` : "";
  const which = pdfOnly ? ", der laut PDF für sie galt" : "";
  return (
    `Diese Filialen hatten${when} mindestens einen Extra-Prospekt${which}. ` +
    "Kaufland bietet Extra-Prospekte nicht jede Woche an."
  );
}

/** "3 Extra-Prospekte seit 06.10.2026" */
export function pastCount(n: number, since: string | null): string {
  const what = `${String(n)} ${n === 1 ? "Extra-Prospekt" : "Extra-Prospekte"}`;
  return since ? `${what} seit ${since}` : what;
}

/* ---------- Pokémon-Angebote ---------- */

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

/** "2 Filialen mit „Sammelkartenspiel-Doppelpack“ im Umkreis von 25 km um PLZ 12683." */
export function cardsArticleStatus(
  name: string,
  count: number,
  radius: number,
  where: string,
): string {
  const filialen = `${String(count)} ${count === 1 ? "Filiale" : "Filialen"}`;
  return `${filialen} mit „${name}“ im Umkreis von ${String(radius)} km ${where}.`;
}

export function cardsArticleNearest(
  name: string,
  distance: string,
  radius: number,
  where: string,
): string {
  return (
    `Keine Filiale mit „${name}“ im Umkreis von ${String(radius)} km ${where}. ` +
    `Die nächste ist ${distance} entfernt.`
  );
}

/** Article view: "3 Pokémon-Artikel, die mit den wenigsten Filialen zuerst. …" */
export function articlesStatus(count: number, from: string): string {
  return (
    `${String(count)} Pokémon-Artikel, die mit den wenigsten Filialen zuerst. ` +
    `Filialen nach Entfernung ${from}.`
  );
}
