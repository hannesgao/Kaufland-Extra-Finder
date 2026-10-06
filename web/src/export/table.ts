/**
 * The exported store list as plain data (title, columns, rows), shared by the HTML, PNG and PDF
 * exports. It mirrors what the "Alle Extra-Filialen" tab shows: same stores, same order.
 */

import type { IsoDate } from "../data";
import { formatDay, formatStamp } from "../dates";
import type { SortOrder, StoreView } from "../search";

export interface ExportColumn {
  header: string;
  /** Share of the table width. */
  width: number;
  /** PLZ: bold, in the accent colour. */
  strong?: boolean;
}

export interface ExportTable {
  title: string;
  /** "Stand der Daten: … · 50 Filialen, … · nach PLZ aufsteigend" */
  subtitle: string;
  footer: string;
  columns: ExportColumn[];
  rows: string[][];
  /** "kaufland-extra-filialen-2026-10-06" */
  filename: string;
}

export const SITE_URL = "https://hannesgao.github.io/Kaufland-Extra-Finder/";

/** "08.10.–14.10." per leaflet; two leaflets (this and next week) side by side. */
function validity(view: StoreView): string {
  return view.leaflets
    .map((l) => `${formatDay(l.leaflet.validFrom)}–${formatDay(l.leaflet.validTo)}`)
    .join(" · ");
}

/** Whether the PDF names the store: "ja" if every shown leaflet does, "nein" if one names another. */
function pdfNamed(view: StoreView): string {
  const matches = view.leaflets.map((l) => l.leaflet.pdfStoreMatch);
  if (matches.includes(false)) return "nein";
  return matches.every((m) => m === true) ? "ja" : "offen";
}

export function exportTable(
  views: readonly StoreView[],
  options: { generatedAt: Date; today: IsoDate; pdfOnly: boolean; sort: SortOrder },
): ExportTable {
  const { generatedAt, today, pdfOnly, sort } = options;
  const n = views.length;
  const filialen = `${String(n)} ${n === 1 ? "Filiale" : "Filialen"}`;
  const which = pdfOnly ? `${filialen}, für die der Extra-Prospekt laut PDF gilt` : filialen;
  const order = sort === "plz-asc" ? "nach PLZ aufsteigend" : "nach PLZ absteigend";
  const columns: ExportColumn[] = [
    { header: "PLZ", width: 9, strong: true },
    { header: "Filiale (Ort / Stadtteil)", width: 33 },
    { header: "Straße", width: 33 },
    { header: "Gültig", width: pdfOnly ? 25 : 16 },
  ];
  if (!pdfOnly) columns.push({ header: "Im PDF genannt", width: 13 });
  const rows = views.map((v) => {
    const row = [v.store.plz, v.store.name, v.store.street, validity(v)];
    if (!pdfOnly) row.push(pdfNamed(v));
    return row;
  });
  return {
    title: "Extra-Filialübersicht",
    subtitle: `Stand der Daten: ${formatStamp(generatedAt)} · ${which} · ${order}`,
    footer: `Inoffiziell, ohne Gewähr. Maßgeblich ist der Prospekt der Filiale. ${SITE_URL}`,
    columns,
    rows,
    filename: `kaufland-extra-filialen-${today}`,
  };
}

/** Offer a generated file for download (no network: a blob URL). */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
