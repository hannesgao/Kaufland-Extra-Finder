/**
 * The store list as a PDF: A4 portrait, a table with a header row on every page. Written with the
 * small PDF writer in `pdfdoc.ts`.
 */

import { PALETTE, wrapText, type Measure } from "./layout";
import { CAP, Page, PAGE_H, PAGE_W, pdfBlob, pdfFile, textWidth, toWinAnsi } from "./pdfdoc";
import type { ExportTable } from "./table";

export { textWidth, toWinAnsi };

/* ---------- Layout (points; y measured from the top, converted when drawing) ---------- */

const MARGIN = 40;
const TABLE_W = PAGE_W - 2 * MARGIN;
const TITLE_SIZE = 18;
const SUBTITLE_SIZE = 9;
const HEAD_SIZE = 7.5;
const BODY_SIZE = 9;
const FOOT_SIZE = 7.5;
const LINE_H = 11;
const PAD_X = 6;
const PAD_Y = 3.5;
/** Header row: 18pt for one line; long headers wrap. */
const HEAD_LINE_H = 9;
const HEAD_PAD_Y = 4.5;
/** Title row above the stores without a current leaflet. */
const SECTION_H = 22;
/** The table ends here; below: the page footer. */
const TABLE_BOTTOM = PAGE_H - MARGIN - 14;

interface Column {
  x: number;
  width: number;
  strong: boolean;
  /** Upper case, wrapped to the column. */
  header: string[];
}

function columns(table: ExportTable): Column[] {
  const total = table.columns.reduce((sum, c) => sum + c.width, 0);
  let x = MARGIN;
  return table.columns.map((c) => {
    const width = (c.width / total) * TABLE_W;
    const measure: Measure = (t) => textWidth(t, HEAD_SIZE, true);
    const header = wrapText(c.header.toUpperCase(), width - 2 * PAD_X, measure);
    const column = { x, width, strong: c.strong ?? false, header };
    x += width;
    return column;
  });
}

function cellX(column: Column, text: string, size: number, bold: boolean): number {
  if (!column.strong) return column.x + PAD_X;
  return column.x + (column.width - textWidth(text, size, bold)) / 2;
}

/** Draws the header row and returns its height. */
function drawHeader(page: Page, cols: readonly Column[], top: number): number {
  const lines = Math.max(...cols.map((c) => c.header.length));
  const height = lines * HEAD_LINE_H + 2 * HEAD_PAD_Y;
  page.rect(MARGIN, top, TABLE_W, height, PALETTE.accent);
  for (const col of cols) {
    // Shorter headers are centred vertically.
    const first = top + HEAD_PAD_Y + ((lines - col.header.length) * HEAD_LINE_H) / 2;
    col.header.forEach((line, n) => {
      const baseline = first + (HEAD_LINE_H + HEAD_SIZE * CAP) / 2 + n * HEAD_LINE_H;
      page.text(
        line,
        cellX(col, line, HEAD_SIZE, true),
        baseline,
        HEAD_SIZE,
        true,
        PALETTE.onAccent,
      );
    });
  }
  return height;
}

function layoutPages(table: ExportTable): Page[] {
  const cols = columns(table);
  const pages: Page[] = [];
  let page = new Page();
  pages.push(page);

  // Title and subtitle, first page only.
  let top = MARGIN;
  page.text(table.title, MARGIN, top + TITLE_SIZE * CAP, TITLE_SIZE, true, PALETTE.accent);
  top += TITLE_SIZE + 4;
  const measureSub: Measure = (t) => textWidth(t, SUBTITLE_SIZE);
  for (const line of wrapText(table.subtitle, TABLE_W, measureSub)) {
    page.text(line, MARGIN, top + SUBTITLE_SIZE * CAP + 2, SUBTITLE_SIZE, false, PALETTE.muted);
    top += SUBTITLE_SIZE + 3;
  }
  top += 8;
  top += drawHeader(page, cols, top);

  table.rows.forEach((row, index) => {
    const lines = cols.map((col, i) => {
      const measure: Measure = (t) => textWidth(t, BODY_SIZE, col.strong);
      return wrapText(row[i] ?? "", col.width - 2 * PAD_X, measure);
    });
    const height = Math.max(...lines.map((l) => l.length)) * LINE_H + 2 * PAD_Y;
    const { dormant } = table;
    const sectionStart = dormant?.start === index;
    // The section title never stays alone at the bottom of a page.
    if (top + height + (sectionStart ? SECTION_H : 0) > TABLE_BOTTOM) {
      page = new Page();
      pages.push(page);
      top = MARGIN;
      top += drawHeader(page, cols, top);
    }
    if (dormant && sectionStart) {
      const baseline = top + SECTION_H - 6;
      page.text(dormant.title, MARGIN + PAD_X, baseline, BODY_SIZE, true, PALETTE.accent);
      page.rect(MARGIN, top + SECTION_H - 1.5, TABLE_W, 1.5, PALETTE.accent);
      top += SECTION_H;
    }
    const muted = dormant !== undefined && index >= dormant.start;
    if (index % 2 === 1) page.rect(MARGIN, top, TABLE_W, height, PALETTE.zebra);
    page.rect(MARGIN, top + height - 0.5, TABLE_W, 0.5, PALETTE.rule);
    cols.forEach((col, i) => {
      (lines[i] ?? []).forEach((line, n) => {
        const baseline = top + PAD_Y + (LINE_H + BODY_SIZE * CAP) / 2 + n * LINE_H;
        const color = muted ? PALETTE.muted : col.strong ? PALETTE.accent : PALETTE.text;
        page.text(
          line,
          cellX(col, line, BODY_SIZE, col.strong),
          baseline,
          BODY_SIZE,
          col.strong,
          color,
        );
      });
    });
    top += height;
  });

  // Footer on every page: disclaimer and site left, page number right.
  const baseline = PAGE_H - MARGIN + FOOT_SIZE;
  pages.forEach((p, i) => {
    const number = `Seite ${String(i + 1)}/${String(pages.length)}`;
    const right = MARGIN + TABLE_W - textWidth(number, FOOT_SIZE);
    p.text(table.footer, MARGIN, baseline, FOOT_SIZE, false, PALETTE.muted);
    p.text(number, right, baseline, FOOT_SIZE, false, PALETTE.muted);
  });
  return pages;
}

/** The PDF file as a string of byte values 0–255. */
export function pdfSource(table: ExportTable): string {
  return pdfFile(layoutPages(table), table.title);
}

export function exportPdf(table: ExportTable): Blob {
  return pdfBlob(pdfSource(table));
}
