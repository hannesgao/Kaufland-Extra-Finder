/**
 * A small PDF writer: A4 portrait pages with text in the standard fonts Helvetica and
 * Helvetica-Bold (not embedded, WinAnsiEncoding), filled and stroked rectangles, lines and JPEG
 * pictures (embedded as they are). Uncompressed content streams. Text is measured with the fonts'
 * published AFM widths, so wrapping matches what any PDF viewer draws.
 */

import { rgb } from "./layout";

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

/* ---------- Pages (points; y measured from the top, converted when drawing) ---------- */

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
/** Cap height of Helvetica (718/1000 em), to centre text vertically. */
export const CAP = 0.718;

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** A JPEG file and what its header says. */
export interface PdfImage {
  data: Uint8Array;
  width: number;
  height: number;
  /** 1 (grey) or 3 (colour). */
  components: number;
}

export class Page {
  readonly ops: string[] = [];
  /** Indexes of the pictures drawn on this page. */
  readonly images = new Set<number>();

  fill(hex: string): void {
    this.ops.push(`${rgb(hex).map(num).join(" ")} rg`);
  }

  rect(x: number, top: number, w: number, h: number, hex: string): void {
    this.fill(hex);
    this.ops.push(`${num(x)} ${num(PAGE_H - top - h)} ${num(w)} ${num(h)} re f`);
  }

  /** The outline of a rectangle; the line is centred on its edge. */
  frame(x: number, top: number, w: number, h: number, width: number, hex: string): void {
    this.ops.push(
      `${rgb(hex).map(num).join(" ")} RG ${num(width)} w ` +
        `${num(x)} ${num(PAGE_H - top - h)} ${num(w)} ${num(h)} re S`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, hex: string): void {
    this.ops.push(
      `${rgb(hex).map(num).join(" ")} RG ${num(width)} w ` +
        `${num(x1)} ${num(PAGE_H - y1)} m ${num(x2)} ${num(PAGE_H - y2)} l S`,
    );
  }

  /** Text with its baseline `baseline` points from the top of the page. */
  text(text: string, x: number, baseline: number, size: number, bold: boolean, hex: string): void {
    this.fill(hex);
    const font = bold ? "/F2" : "/F1";
    this.ops.push(
      `BT ${font} ${num(size)} Tf ${num(x)} ${num(PAGE_H - baseline)} Td ${literal(text)} Tj ET`,
    );
  }

  /** Picture number `index` of the document, stretched to the box. */
  image(index: number, x: number, top: number, w: number, h: number): void {
    this.images.add(index);
    this.ops.push(
      `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(PAGE_H - top - h)} cm /Im${String(index)} Do Q`,
    );
  }
}

/* ---------- File ---------- */

/** Bytes as a string of char codes 0–255, in pieces (the argument list has a limit). */
function binary(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

/** The PDF file as a string of byte values 0–255 (binary marker in the header). */
export function pdfFile(pages: readonly Page[], title: string, images: readonly PdfImage[] = []) {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);

  add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesIndex = add("");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title ${utf16Hex(title)} /Creator (Kaufland Extra Finder) >>`);
  // Only pictures that a page draws are written.
  const used = new Set(pages.flatMap((page) => [...page.images]));
  const imageObjects = new Map<number, number>();
  images.forEach((image, index) => {
    if (!used.has(index)) return;
    const space = image.components === 1 ? "/DeviceGray" : "/DeviceRGB";
    imageObjects.set(
      index,
      add(
        `<< /Type /XObject /Subtype /Image /Width ${String(image.width)} ` +
          `/Height ${String(image.height)} /ColorSpace ${space} /BitsPerComponent 8 ` +
          `/Filter /DCTDecode /Length ${String(image.data.length)} >>\nstream\n` +
          `${binary(image.data)}\nendstream`,
      ),
    );
  });
  const kids = pages.map((page) => {
    const stream = page.ops.join("\n");
    const contents = add(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
    const xobjects = [...page.images]
      .filter((index) => imageObjects.has(index))
      .map((index) => `/Im${String(index)} ${String(imageObjects.get(index))} 0 R`);
    return add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>` +
        (xobjects.length ? ` /XObject << ${xobjects.join(" ")} >>` : "") +
        ` >> /Contents ${String(contents)} 0 R >>`,
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

export function pdfBlob(source: string): Blob {
  const bytes = Uint8Array.from(source, (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "application/pdf" });
}
