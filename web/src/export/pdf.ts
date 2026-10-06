/**
 * The store list as a PDF, written by hand: A4 portrait, the standard fonts Helvetica and
 * Helvetica-Bold (not embedded) in WinAnsiEncoding, uncompressed content streams. Text is measured
 * with the fonts' published AFM widths, so the wrapping matches what any PDF viewer draws.
 */

import { PALETTE, rgb, wrapText, type Measure } from "./layout";
import type { ExportTable } from "./table";

/* ---------- Fonts ---------- */

// prettier-ignore
/** Helvetica widths (1/1000 em) of the characters 32–126. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// prettier-ignore
/** Helvetica-Bold widths (1/1000 em) of the characters 32–126. */
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** WinAnsi (cp1252) bytes 0x80–0x9F; 0xA0–0xFF are the same as Latin-1. */
const WIN_ANSI = new Map<string, number>([
  ["€", 0x80],
  ["‚", 0x82],
  ["„", 0x84],
  ["…", 0x85],
  ["Œ", 0x8c],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["™", 0x99],
  ["œ", 0x9c],
]);

/** [regular, bold] widths of WinAnsi characters that are neither ASCII nor accented letters. */
const SPECIAL_WIDTHS = new Map<number, readonly [number, number]>([
  [0x80, [556, 556]],
  [0x82, [222, 278]],
  [0x84, [333, 500]],
  [0x85, [1000, 1000]],
  [0x8c, [1000, 1000]],
  [0x91, [222, 278]],
  [0x92, [222, 278]],
  [0x93, [333, 500]],
  [0x94, [333, 500]],
  [0x95, [350, 350]],
  [0x96, [556, 556]],
  [0x97, [1000, 1000]],
  [0x99, [1000, 1000]],
  [0x9c, [944, 944]],
  [0xa0, [278, 278]],
  [0xa7, [556, 556]],
  [0xb0, [400, 400]],
  [0xb7, [278, 278]],
  [0xc6, [1000, 1000]],
  [0xd7, [584, 584]],
  [0xd8, [778, 778]],
  [0xdf, [611, 611]],
  [0xe6, [889, 889]],
  [0xf8, [611, 611]],
]);

/** Accents removed: "é" -> "e", "ł" stays "ł". */
function base(char: string): string {
  return char.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Unicode -> one char per WinAnsi byte (code 0–255). Unknown characters become "?". */
export function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (code >= 0x20 && code <= 0x7e) out += char;
    else if (WIN_ANSI.has(char)) out += String.fromCharCode(WIN_ANSI.get(char) ?? 0x3f);
    else if (code >= 0xa0 && code <= 0xff) out += char;
    else if (/\s/u.test(char)) out += " ";
    else {
      const plain = base(char);
      out += plain.length === 1 && plain <= "\x7e" && plain >= " " ? plain : "?";
    }
  }
  return out;
}

function byteWidth(code: number, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  if (code >= 0x20 && code <= 0x7e) return table[code - 0x20] ?? 556;
  const special = SPECIAL_WIDTHS.get(code);
  if (special) return special[bold ? 1 : 0];
  const plain = base(String.fromCharCode(code));
  const ascii = plain.length === 1 ? plain.charCodeAt(0) : 0;
  return ascii >= 0x20 && ascii <= 0x7e ? (table[ascii - 0x20] ?? 556) : 556;
}

/** Width in points of a text set in Helvetica (bold) at the given size. */
export function textWidth(text: string, size: number, bold = false): number {
  let units = 0;
  for (const char of toWinAnsi(text)) units += byteWidth(char.charCodeAt(0), bold);
  return (units * size) / 1000;
}

/** A PDF literal string: parentheses and backslashes escaped, non-ASCII bytes as octal. */
function literal(text: string): string {
  let out = "(";
  for (const char of toWinAnsi(text)) {
    const code = char.charCodeAt(0);
    if (char === "(" || char === ")" || char === "\\") out += `\\${char}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += char;
  }
  return `${out})`;
}

/** A text string for the document info: UTF-16BE with byte order mark, as hex. */
function utf16Hex(text: string): string {
  let hex = "<FEFF";
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  }
  return `${hex}>`;
}

/* ---------- Layout (points; y measured from the top, converted when drawing) ---------- */

const PAGE_W = 595.28;
const PAGE_H = 841.89;
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
/** Cap height of Helvetica (718/1000 em), to centre text vertically. */
const CAP = 0.718;
/** The table ends here; below: the page footer. */
const TABLE_BOTTOM = PAGE_H - MARGIN - 14;

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

class Page {
  readonly ops: string[] = [];

  fill(hex: string): void {
    this.ops.push(`${rgb(hex).map(num).join(" ")} rg`);
  }

  rect(x: number, top: number, w: number, h: number, hex: string): void {
    this.fill(hex);
    this.ops.push(`${num(x)} ${num(PAGE_H - top - h)} ${num(w)} ${num(h)} re f`);
  }

  /** Text with its baseline `baseline` points from the top of the page. */
  text(text: string, x: number, baseline: number, size: number, bold: boolean, hex: string): void {
    this.fill(hex);
    const font = bold ? "/F2" : "/F1";
    this.ops.push(
      `BT ${font} ${num(size)} Tf ${num(x)} ${num(PAGE_H - baseline)} Td ${literal(text)} Tj ET`,
    );
  }
}

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
    if (top + height > TABLE_BOTTOM) {
      page = new Page();
      pages.push(page);
      top = MARGIN;
      top += drawHeader(page, cols, top);
    }
    if (index % 2 === 1) page.rect(MARGIN, top, TABLE_W, height, PALETTE.zebra);
    page.rect(MARGIN, top + height - 0.5, TABLE_W, 0.5, PALETTE.rule);
    cols.forEach((col, i) => {
      (lines[i] ?? []).forEach((line, n) => {
        const baseline = top + PAD_Y + (LINE_H + BODY_SIZE * CAP) / 2 + n * LINE_H;
        const color = col.strong ? PALETTE.accent : PALETTE.text;
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

/* ---------- File ---------- */

/** The PDF file as a string of byte values 0–255 (binary marker in the header). */
export function pdfSource(table: ExportTable): string {
  const pages = layoutPages(table);
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);

  add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesIndex = add("");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title ${utf16Hex(table.title)} /Creator (Kaufland Extra Finder) >>`);
  const kids = pages.map((page) => {
    const stream = page.ops.join("\n");
    const contents = add(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
    return add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${String(contents)} 0 R >>`,
    );
  });
  objects[pagesIndex - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => `${String(k)} 0 R`).join(" ")}] ` +
    `/Count ${String(kids.length)} >>`;

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out +=
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R /Info ${String(info)} 0 R >>\n` +
    `startxref\n${String(xref)}\n%%EOF\n`;
  return out;
}

export function exportPdf(table: ExportTable): Blob {
  const source = pdfSource(table);
  const bytes = Uint8Array.from(source, (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "application/pdf" });
}
