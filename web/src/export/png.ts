/**
 * The store list as a PNG image: the table drawn on a canvas at twice the size (sharp on
 * high-density screens), with the system font. One tall image, no pagination.
 */

import { PALETTE, wrapText, type Measure } from "./layout";
import type { ExportTable } from "./table";

const WIDTH = 960;
const MARGIN = 32;
const TABLE_W = WIDTH - 2 * MARGIN;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const TITLE_SIZE = 24;
const SUBTITLE_SIZE = 13;
const HEAD_SIZE = 11;
const BODY_SIZE = 13;
const FOOT_SIZE = 11;
const LINE_H = 17;
const PAD_X = 8;
const PAD_Y = 5;
/** Header row: 28px for one line; long headers wrap. */
const HEAD_LINE_H = 14;
const HEAD_PAD_Y = 7;
/** Canvas size limit of common browsers (per side, in device pixels). */
const MAX_SIDE = 16_000;

function font(size: number, bold = false): string {
  return `${bold ? "700 " : ""}${String(size)}px ${FONT}`;
}

interface Column {
  x: number;
  width: number;
  strong: boolean;
  /** Upper case, wrapped to the column. */
  header: string[];
}

interface Row {
  lines: string[][];
  height: number;
}

export async function exportPng(table: ExportTable): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas wird nicht unterstützt");
  const measureWith =
    (size: number, bold = false): Measure =>
    (text) => {
      ctx.font = font(size, bold);
      return ctx.measureText(text).width;
    };

  const total = table.columns.reduce((sum, c) => sum + c.width, 0);
  let x = MARGIN;
  const cols: Column[] = table.columns.map((c) => {
    const width = (c.width / total) * TABLE_W;
    const header = wrapText(
      c.header.toUpperCase(),
      width - 2 * PAD_X,
      measureWith(HEAD_SIZE, true),
    );
    const col = { x, width, strong: c.strong ?? false, header };
    x += width;
    return col;
  });

  const subtitle = wrapText(table.subtitle, TABLE_W, measureWith(SUBTITLE_SIZE));
  const footer = wrapText(table.footer, TABLE_W, measureWith(FOOT_SIZE));
  const rows: Row[] = table.rows.map((row) => {
    const lines = cols.map((col, i) =>
      wrapText(row[i] ?? "", col.width - 2 * PAD_X, measureWith(BODY_SIZE, col.strong)),
    );
    return { lines, height: Math.max(...lines.map((l) => l.length)) * LINE_H + 2 * PAD_Y };
  });

  const tableTop = MARGIN + TITLE_SIZE + 8 + subtitle.length * (SUBTITLE_SIZE + 5) + 8;
  const headLines = Math.max(...cols.map((c) => c.header.length));
  const headH = headLines * HEAD_LINE_H + 2 * HEAD_PAD_Y;
  const tableBottom = tableTop + headH + rows.reduce((sum, r) => sum + r.height, 0);
  const height = tableBottom + 12 + footer.length * (FOOT_SIZE + 5) + MARGIN;
  const scale = Math.min(2, MAX_SIDE / height);
  canvas.width = Math.round(WIDTH * scale);
  canvas.height = Math.round(height * scale);
  ctx.scale(scale, scale);
  ctx.textBaseline = "middle";

  ctx.fillStyle = PALETTE.onAccent;
  ctx.fillRect(0, 0, WIDTH, height);

  const text = (value: string, left: number, middle: number, size: number, bold: boolean) => {
    ctx.font = font(size, bold);
    ctx.fillText(value, left, middle);
  };
  const cellX = (col: Column, value: string, size: number, bold: boolean): number =>
    col.strong ? col.x + (col.width - measureWith(size, bold)(value)) / 2 : col.x + PAD_X;

  let top = MARGIN;
  ctx.fillStyle = PALETTE.accent;
  text(table.title, MARGIN, top + TITLE_SIZE / 2, TITLE_SIZE, true);
  top += TITLE_SIZE + 8;
  ctx.fillStyle = PALETTE.muted;
  for (const line of subtitle) {
    text(line, MARGIN, top + SUBTITLE_SIZE / 2, SUBTITLE_SIZE, false);
    top += SUBTITLE_SIZE + 5;
  }

  top = tableTop;
  ctx.fillStyle = PALETTE.accent;
  ctx.fillRect(MARGIN, top, TABLE_W, headH);
  ctx.fillStyle = PALETTE.onAccent;
  for (const col of cols) {
    // Shorter headers are centred vertically.
    const first = top + HEAD_PAD_Y + ((headLines - col.header.length) * HEAD_LINE_H) / 2;
    col.header.forEach((line, n) => {
      const middle = first + HEAD_LINE_H / 2 + n * HEAD_LINE_H;
      text(line, cellX(col, line, HEAD_SIZE, true), middle, HEAD_SIZE, true);
    });
  }
  top += headH;

  rows.forEach((row, index) => {
    if (index % 2 === 1) {
      ctx.fillStyle = PALETTE.zebra;
      ctx.fillRect(MARGIN, top, TABLE_W, row.height);
    }
    ctx.fillStyle = PALETTE.rule;
    ctx.fillRect(MARGIN, top + row.height - 1, TABLE_W, 1);
    cols.forEach((col, i) => {
      ctx.fillStyle = col.strong ? PALETTE.accent : PALETTE.text;
      (row.lines[i] ?? []).forEach((line, n) => {
        const middle = top + PAD_Y + LINE_H / 2 + n * LINE_H;
        text(line, cellX(col, line, BODY_SIZE, col.strong), middle, BODY_SIZE, col.strong);
      });
    });
    top += row.height;
  });

  top = tableBottom + 12;
  ctx.fillStyle = PALETTE.muted;
  for (const line of footer) {
    text(line, MARGIN, top + FOOT_SIZE / 2, FOOT_SIZE, false);
    top += FOOT_SIZE + 5;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PNG konnte nicht erzeugt werden"));
    }, "image/png");
  });
}
