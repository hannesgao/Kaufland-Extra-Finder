// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { escapeHtml, exportHtml } from "../src/export/html";
import { wrapText } from "../src/export/layout";
import { pdfSource, textWidth, toWinAnsi } from "../src/export/pdf";
import { exportTable, type ExportTable } from "../src/export/table";
import { listAll } from "../src/search";
import { edgeCases, fixture, MONDAY } from "./helpers";

const GENERATED = new Date("2026-10-05T04:31:00Z");

function table(pdfOnly: boolean, data = fixture()): ExportTable {
  return exportTable(listAll(data, MONDAY, "plz-asc", { pdfOnly }), {
    generatedAt: GENERATED,
    today: MONDAY,
    pdfOnly,
    sort: "plz-asc",
  });
}

describe("exportTable", () => {
  it("lists the stores of the tab with PLZ, name, street and validity", () => {
    const t = table(true);
    expect(t.columns.map((c) => c.header)).toEqual([
      "PLZ",
      "Filiale (Ort / Stadtteil)",
      "Straße",
      "Gültig",
    ]);
    expect(t.rows.map((r) => r[0])).toEqual(["34125", "37079", "76137", "76437"]);
    expect(t.rows[0]).toEqual(["34125", "Kassel-Wesertor", "Franzgraben 40-42", "08.10.–14.10."]);
    expect(t.subtitle).toBe(
      "Stand der Daten: 05.10.2026, 06:31 Uhr · 4 Filialen, für die der Extra-Prospekt laut PDF " +
        "gilt · nach PLZ aufsteigend",
    );
    expect(t.filename).toBe("kaufland-extra-filialen-2026-10-05");
  });

  it("adds whether the PDF names the store when the switch is off", () => {
    const t = table(false);
    expect(t.columns.at(-1)?.header).toBe("Im PDF genannt");
    expect(t.rows).toHaveLength(6);
    expect(t.rows.map((r) => r.at(-1))).toEqual(["ja", "ja", "nein", "ja", "nein", "ja"]);
    expect(t.subtitle).toContain("· 6 Filialen ·");
  });

  it("joins two validity periods", () => {
    const t = table(true, edgeCases());
    expect(t.rows[0]?.[3]).toBe("01.10.–07.10. · 08.10.–14.10.");
  });
});

describe("HTML export", () => {
  it("escapes markup in every value", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("writes a standalone document without scripts or external resources", async () => {
    const t = table(true);
    t.rows[0] = ["34125", "<script>alert(1)</script>", "A & B", "x"];
    const html = await exportHtml(t).text();
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).not.toMatch(/(?:src|href)=/);
    expect(html.match(/<tr>/g)).toHaveLength(5); // header + 4 stores
  });
});

describe("wrapText", () => {
  const measure = (t: string) => t.length;

  it("wraps at spaces and breaks words that do not fit", () => {
    expect(wrapText("ab cd ef", 5, measure)).toEqual(["ab cd", "ef"]);
    expect(wrapText("abcdefgh", 3, measure)).toEqual(["abc", "def", "gh"]);
    expect(wrapText("", 3, measure)).toEqual([""]);
  });
});

describe("PDF export", () => {
  it("maps text to WinAnsi and replaces what it cannot show", () => {
    expect(toWinAnsi("Grünwinkel – „Extra“ 5 €")).toBe("Gr\xfcnwinkel \x96 \x84Extra\x93 5 \x80");
    expect(toWinAnsi("Łódź →")).toBe("?\xf3dz ?");
  });

  it("measures with the Helvetica widths", () => {
    expect(textWidth("Hi", 10)).toBeCloseTo(9.44);
    expect(textWidth("Hi", 10, true)).toBeCloseTo(10);
    expect(textWidth("ü", 10)).toBe(textWidth("u", 10));
  });

  it("writes a valid cross-reference table", () => {
    const source = pdfSource(table(false));
    expect(source.startsWith("%PDF-1.4\n")).toBe(true);
    expect(source.endsWith("%%EOF\n")).toBe(true);
    const startxref = Number(/startxref\n(\d+)/.exec(source)?.[1]);
    expect(source.slice(startxref, startxref + 4)).toBe("xref");
    const entries = source.slice(startxref).match(/^(\d{10}) 00000 n $/gm) ?? [];
    expect(entries.length).toBeGreaterThan(5);
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(source.slice(offset)).toMatch(new RegExp(`^${String(i + 1)} 0 obj\\n`));
    });
    for (const [, length, stream] of source.matchAll(
      /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g,
    )) {
      expect(stream?.length).toBe(Number(length));
    }
  });

  it("escapes strings and keeps the content streams ASCII", () => {
    const t = table(true);
    t.rows[0] = ["34125", "Name (alt) \\ neu", "Straße", "x"];
    const source = pdfSource(t);
    expect(source).toContain("(Name \\(alt\\) \\\\ neu) Tj");
    expect(source).toContain("(Stra\\337e) Tj");
    const body = source.slice(source.indexOf("1 0 obj"));
    expect(body).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it("continues on further pages with the header row and page numbers", () => {
    const t = table(false);
    const rows = t.rows;
    t.rows = Array.from({ length: 120 }, (_, i) => rows[i % rows.length] ?? []);
    const source = pdfSource(t);
    const pages = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(source)?.[1]);
    expect(pages).toBeGreaterThan(1);
    expect(source).toContain(`(Seite ${String(pages)}/${String(pages)}) Tj`);
    expect(source.match(/\(GENANNT\) Tj/g)).toHaveLength(pages); // header wrapped in two lines
  });

  it("keeps every text inside the right margin", () => {
    const source = pdfSource(table(false));
    const texts = [...source.matchAll(/\/F(\d) ([\d.]+) Tf ([\d.]+) [\d.]+ Td \((.*?)\) Tj/g)];
    expect(texts.length).toBeGreaterThan(30);
    for (const [, font, size, x, text] of texts) {
      const plain = (text ?? "").replace(/\\(\d{3})/g, (_, o: string) =>
        String.fromCharCode(Number.parseInt(o, 8)),
      );
      const width = textWidth(plain.replace(/\\(.)/g, "$1"), Number(size), font === "2");
      expect(Number(x) + width).toBeLessThanOrEqual(595.28 - 40 + 0.01);
    }
  });
});
