import { describe, expect, it } from "vitest";
import { asPdfImage, jpegInfo, loadPdfImages } from "../src/export/jpeg";
import type { PdfImage } from "../src/export/pdfdoc";
import {
  sheetLayout,
  sheetPageCount,
  sheetPictures,
  sheetSections,
  sheetSource,
  sheetTitle,
  type SheetOptions,
} from "../src/export/sheet";
import type { Offer } from "../src/offers";
import { emptyList, parseList, setSplit, type ListItem } from "../src/shopping";

const SUNDAY = "2026-11-15";
const STORE = {
  id: "DE4443",
  name: "Karlsruhe-Oststadt",
  street: "Durlacher Allee 111",
  plz: "76137",
  city: "Karlsruhe",
};

function offer(n: number, fields: Partial<Offer> = {}): Offer {
  return {
    key: `${String(n)}|2026-11-15`,
    klNr: String(n),
    title: "MÜLLER",
    subtitle: `Müllermilch ${String(n)}`,
    price: "0.59",
    oldPrice: "1.49",
    unit: "je 400-ml-Fl.",
    basePrice: "1 l = 1.48",
    description: "versch. Sorten, gekühlt (+ 0.25 Pfand)",
    multiBuy: [],
    salesFrom: "2026-11-16",
    salesTo: "2026-11-21",
    thumbnail: `https://kaufland.media.schwarz/is/image/schwarz/${String(n)}?small`,
    thumbnail2x: `https://kaufland.media.schwarz/is/image/schwarz/${String(n)}?large`,
    department: n % 2 ? "Molkereiprodukte, Fette" : "Tiefkühlkost",
    sections: [],
    ...fields,
  };
}

function item(n: number, fields: Partial<Offer> = {}): ListItem {
  return { id: `i${String(n)}`, quantity: 1, note: "", offer: offer(n, fields) };
}

const text = (n: number, entry: string): ListItem => ({
  id: `t${String(n)}`,
  quantity: 1,
  note: "",
  text: entry,
});

function options(items: ListItem[], fields: Partial<SheetOptions> = {}): SheetOptions {
  return {
    store: STORE,
    items,
    layout: "kacheln",
    split: true,
    generatedAt: new Date("2026-11-15T18:18:00+01:00"),
    today: SUNDAY,
    ...fields,
  };
}

const many = (count: number, fields: Partial<Offer> = {}) =>
  Array.from({ length: count }, (_, n) => item(n, fields));

/** The smallest header `jpegInfo` reads: SOI, an APP0 segment, then the frame header. */
function jpeg(width: number, height: number, components = 3, marker = 0xc0): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x4a,
    0x46,
    0xff,
    marker,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 255,
    width >> 8,
    width & 255,
    components,
    1,
    0x11,
    0,
  ]);
}

describe("jpegInfo", () => {
  it("reads size and components from the frame header", () => {
    expect(jpegInfo(jpeg(322, 625))).toEqual({
      width: 322,
      height: 625,
      components: 3,
      precision: 8,
    });
    // Progressive JPEGs have another frame marker.
    expect(jpegInfo(jpeg(150, 150, 1, 0xc2))?.components).toBe(1);
  });

  it("rejects what is not a JPEG", () => {
    expect(jpegInfo(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegInfo(new Uint8Array(0))).toBeNull();
    expect(jpegInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });

  it("takes grey and colour pictures only", () => {
    expect(asPdfImage(jpeg(10, 20))?.height).toBe(20);
    expect(asPdfImage(jpeg(10, 20, 4))).toBeNull(); // CMYK
  });
});

describe("loadPdfImages", () => {
  it("loads every URL once and leaves out failures", async () => {
    const asked: string[] = [];
    const images = await loadPdfImages(["a", "b", "a", "c"], (url) => {
      asked.push(url);
      return Promise.resolve(url === "b" ? null : asPdfImage(jpeg(10, 10)));
    });
    expect(asked.sort()).toEqual(["a", "b", "c"]);
    expect([...images.keys()].sort()).toEqual(["a", "c"]);
  });
});

describe("sheetSections", () => {
  const items = [
    item(1),
    item(2, { salesFrom: "2026-11-19" }),
    text(1, "Brot"),
    item(3, { salesFrom: "2026-11-20" }),
    item(4, { salesFrom: "2026-11-19" }),
    item(5, { salesFrom: "2026-11-09", salesTo: "2026-11-14" }), // ended
  ];

  it("gives every start day a section, in the order of the days", () => {
    const sections = sheetSections(items, true, SUNDAY);
    expect(sections.map((s) => s.heading)).toEqual([
      "Gültig ab Mo, 16.11.",
      "Gültig ab Do, 19.11.",
      "Gültig ab Fr, 20.11.",
    ]);
    expect(sections.map((s) => s.items.map((i) => i.id))).toEqual([
      ["i1", "t1", "i5"], // own entries and ended offers go first
      ["i2", "i4"],
      ["i3"],
    ]);
  });

  it("puts everything that has started in one section", () => {
    const sections = sheetSections(items, true, "2026-11-19");
    expect(sections.map((s) => s.heading)).toEqual(["Jetzt gültig", "Gültig ab Fr, 20.11."]);
    expect(sections[0]?.items.map((i) => i.id)).toEqual(["i1", "i2", "i4", "t1", "i5"]);
  });

  it("is one section without a heading when the list is not split", () => {
    expect(sheetSections(items, false, SUNDAY)).toEqual([{ heading: null, items }]);
    expect(sheetSections([text(1, "Brot")], true, SUNDAY)).toEqual([
      { heading: null, items: [text(1, "Brot")] },
    ]);
  });
});

describe("sheet layout", () => {
  it("has no page for an empty list", () => {
    expect(sheetPageCount(options([]))).toBe(0);
  });

  it("starts a page for every start day when split", () => {
    const items = [
      item(1),
      item(2, { salesFrom: "2026-11-19" }),
      item(3, { salesFrom: "2026-11-20" }),
    ];
    expect(sheetPageCount(options(items))).toBe(3);
    expect(sheetPageCount(options(items, { split: false }))).toBe(1);
    expect(sheetPageCount(options(items, { layout: "liste" }))).toBe(3);
    expect(sheetPageCount(options(items, { layout: "liste", split: false }))).toBe(1);
  });

  it.each(["kacheln", "liste"] as const)("fills every page but the last (%s)", (layout) => {
    for (const count of layout === "kacheln" ? [10, 23, 40, 77] : [40, 77, 120]) {
      const { pages, ends, bottom } = sheetLayout(options(many(count), { layout }));
      expect(pages).toBeGreaterThan(1);
      for (const end of ends.slice(0, -1)) expect(Math.abs(end - bottom)).toBeLessThan(0.01);
      for (const end of ends) expect(end).toBeLessThanOrEqual(bottom + 0.01);
    }
  });

  it("leaves the room below a short list empty", () => {
    const { pages, ends, bottom } = sheetLayout(options(many(3)));
    expect(pages).toBe(1);
    expect(ends[0]).toBeLessThan(bottom / 2);
  });

  it("splits a short list of rows over both columns", () => {
    const { pages, ends, bottom } = sheetLayout(options(many(8), { layout: "liste" }));
    expect(pages).toBe(1);
    // Eight rows in one column would reach further down than four and four.
    const single = sheetLayout(options(many(4), { layout: "liste" }));
    expect(ends[0]).toBeLessThan(bottom / 2);
    expect(ends[0]).toBeGreaterThan(single.ends[0] ?? 0);
    const source = sheetSource(options(many(8), { layout: "liste" }), new Map());
    // Check boxes are drawn at the left edge of both columns.
    expect(
      new Set(source.match(/\d+\.?\d* \d+\.?\d* 9\.2 9\.2 re S/g)?.map((m) => m.split(" ")[0]))
        .size,
    ).toBe(2);
  });

  it("keeps long texts on the page", () => {
    const long = "Sehr langer Name ohne Ende ".repeat(12);
    const items = [
      item(1, { subtitle: long, description: long, multiBuy: ["3 Stück", long] }),
      { ...text(1, "Donaudampfschifffahrtsgesellschaftskapitänsmütze".repeat(3)), note: long },
    ];
    for (const layout of ["kacheln", "liste"] as const) {
      const { pages, ends, bottom } = sheetLayout(options(items, { layout }));
      expect(pages).toBe(1);
      expect(ends[0]).toBeLessThan(bottom);
    }
  });
});

describe("sheetSource", () => {
  const picture: PdfImage = { data: jpeg(322, 322), width: 322, height: 322, components: 3 };

  it("is a PDF with the texts and only the pictures that are drawn", () => {
    const items = [item(1), item(2, { salesFrom: "2026-11-19" }), text(1, "Brot (frisch)")];
    const [first] = sheetPictures(items, "kacheln");
    const images = new Map([
      [first ?? "", picture],
      ["https://kaufland.media.schwarz/unused", picture],
    ]);
    const source = sheetSource(options(items), images);
    expect(source.startsWith("%PDF-1.4")).toBe(true);
    expect(source.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(source.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(source.match(/\/Filter \/DCTDecode/g)).toHaveLength(1);
    expect(source).toContain("(Einkaufszettel)");
    expect(source).toContain("(G\\374ltig ab Do, 19.11.)");
    expect(source).toContain("(M\\374llermilch 1)");
    expect(source).toContain("(Brot \\(frisch\\))");
    // The page is headed with the day, so its offers are not marked again.
    expect(source).not.toContain("(erst ab Do.)");
    expect(sheetSource(options(items, { split: false }), images)).toContain("(erst ab Do.)");
    expect(source).toContain("(Seite 2/2)");
    // Every byte is a byte: nothing above 255 slipped in.
    expect(/[\u0100-\uffff]/.test(source)).toBe(false);
  });

  it("uses the large picture on cards and the small one in rows", () => {
    expect(sheetPictures([item(1), text(1, "Brot")], "kacheln")).toEqual([offer(1).thumbnail2x]);
    expect(sheetPictures([item(1), item(1)], "liste")).toEqual([offer(1).thumbnail]);
  });

  it("names the store in the title", () => {
    expect(sheetTitle(STORE)).toBe("Einkaufszettel Kaufland Karlsruhe-Oststadt");
    expect(sheetTitle(null)).toBe("Einkaufszettel");
  });
});

describe("split setting", () => {
  it("is on by default and stored with the list", () => {
    expect(emptyList().split).toBe(true);
    expect(parseList("{}").split).toBe(true);
    const off = setSplit(emptyList(), false);
    expect(parseList(JSON.stringify(off)).split).toBe(false);
  });
});
