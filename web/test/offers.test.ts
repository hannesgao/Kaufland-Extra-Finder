import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DataError } from "../src/data";
import {
  departmentCounts,
  filterOffers,
  groupCounts,
  findStores,
  nearestStores,
  NO_DEPARTMENT,
  offerWeeks,
  parseOffer,
  parseOfferCatalog,
  parseOfferIndex,
  parseStoreFile,
  storeOffers,
  type OfferFilter,
} from "../src/offers";
import { PLZ_KARLSRUHE } from "./helpers";

const STAMP = "2026-11-14T10:05:00+01:00";
const SATURDAY = "2026-11-14";

function record(klNr: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kl_nr: klNr,
    title: "MÜLLER",
    subtitle: "Müllermilch",
    price: "0.59",
    old_price: "1.49",
    unit: "je 400-ml-Fl.",
    shown_from: "2026-11-08",
    shown_to: "2026-11-14",
    sales_from: "2026-11-09",
    sales_to: "2026-11-14",
    department: "Molkereiprodukte, Fette",
    sections: ["Molkereiprodukte, Fette"],
    ...fields,
  };
}

const MILK = "1|2026-11-08";
// Only in a promotion category, and its texts say nothing about what it is.
const BREAD = "2|2026-11-08";
const BEER = "3|2026-11-08";
const NEXT = "4|2026-11-15";

function catalogJson(): Record<string, unknown> {
  return {
    schema_version: 1,
    generated_at: STAMP,
    common: [MILK, BREAD],
    products: {
      [MILK]: record("1"),
      [BREAD]: record("2", {
        title: "",
        subtitle: "Wochenknüller",
        description: "geschnitten",
        price: "1.11",
        old_price: undefined,
        department: undefined,
        sections: ["Unsere Knüller"],
      }),
      [BEER]: record("3", {
        title: "OETTINGER",
        subtitle: "Hefeweißbier",
        price: "7.99",
        old_price: "11.99",
        sales_from: "2026-11-12",
        department: "Getränke, Spirituosen",
      }),
      [NEXT]: record("4", {
        title: "KINDER",
        subtitle: "Pingui",
        price: "2.49",
        old_price: "3.29",
        card_price: "2.22",
        multi_buy: ["3 Stück", "entspr. pro Packg. 1.34"],
        shown_from: "2026-11-15",
        shown_to: "2026-11-21",
        sales_from: "2026-11-16",
        sales_to: "2026-11-21",
      }),
    },
  };
}

function storeJson(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    generated_at: STAMP,
    id: "DE4443",
    added: [BEER, NEXT],
    missing: [BREAD],
    overrides: { [MILK]: { price: "0.69", old_price: null } },
    ...fields,
  };
}

function offers() {
  const all = storeJson({ missing: [] });
  return storeOffers(parseOfferCatalog(catalogJson()), parseStoreFile(all));
}

const ALL: OfferFilter = { query: "", department: null, group: null, week: null, sort: "name" };

describe("storeOffers", () => {
  it("takes the common offers without the missing ones, plus the added ones", () => {
    const list = storeOffers(parseOfferCatalog(catalogJson()), parseStoreFile(storeJson()));
    expect(list.map((o) => o.key)).toEqual([MILK, BEER, NEXT]);
  });

  it("applies the store's overrides; null removes a field", () => {
    const [milk] = storeOffers(parseOfferCatalog(catalogJson()), parseStoreFile(storeJson()));
    expect(milk).toMatchObject({ price: "0.69", unit: "je 400-ml-Fl." });
    expect(milk).not.toHaveProperty("oldPrice");
  });

  it("skips keys the catalog does not know", () => {
    const file = parseStoreFile(storeJson({ added: ["9|2026-11-08", BEER] }));
    const list = storeOffers(parseOfferCatalog(catalogJson()), file);
    expect(list.map((o) => o.key)).toEqual([MILK, BEER]);
  });

  it("reads card price, multi-buy and the sale dates", () => {
    const pingui = offers().find((o) => o.key === NEXT);
    expect(pingui).toMatchObject({
      cardPrice: "2.22",
      multiBuy: ["3 Stück", "entspr. pro Packg. 1.34"],
      salesFrom: "2026-11-16",
      salesTo: "2026-11-21",
    });
  });

  it("falls back to the shown dates without sale dates", () => {
    const offer = parseOffer(MILK, record("1", { sales_from: undefined, sales_to: undefined }));
    expect([offer.salesFrom, offer.salesTo]).toEqual(["2026-11-08", "2026-11-14"]);
  });

  it("guesses the category of offers that are only in promotion categories", () => {
    const catalog = catalogJson();
    const products = catalog.products as Record<string, unknown>;
    const promotion = { department: undefined, sections: ["Unsere Knüller"] };
    products[BREAD] = record("2", { ...promotion, title: "", subtitle: "Weizenmischbrot" });
    // No pattern knows the product, but every other offer of the brand is a drink.
    products[NEXT] = record("4", { ...promotion, title: "OETTINGER", subtitle: "Export" });
    const list = storeOffers(
      parseOfferCatalog(catalog),
      parseStoreFile(storeJson({ missing: [] })),
    );
    const departments = Object.fromEntries(list.map((o) => [o.key, o.department]));
    expect(departments[BREAD]).toBe("Grundnahrungsmittel");
    expect(departments[NEXT]).toBe("Getränke, Spirituosen");
    expect(departments[MILK]).toBe("Molkereiprodukte, Fette"); // Kaufland's own stays
  });

  it("rejects a picture that is not https", () => {
    const bad = record("1", { thumbnail: "javascript:alert(1)" });
    expect(() => parseOffer(MILK, bad)).toThrow(DataError);
  });
});

describe("parsing", () => {
  it("rejects another schema version", () => {
    expect(() => parseOfferCatalog({ ...catalogJson(), schema_version: 2 })).toThrow(DataError);
    expect(() => parseStoreFile({ ...storeJson(), schema_version: 2 })).toThrow(DataError);
    expect(() => parseOfferIndex({ schema_version: 2 })).toThrow(DataError);
  });

  it("reads the dev fixture", () => {
    const dir = resolve(import.meta.dirname, "../fixtures/offers");
    const read = (name: string) => JSON.parse(readFileSync(resolve(dir, name), "utf-8")) as unknown;
    const index = parseOfferIndex(read("index.json"));
    const catalog = parseOfferCatalog(read("catalog.json"));
    expect(index.stores.map((s) => s.id)).toEqual(["DE1643", "DE4443", "DE4453"]);
    for (const store of index.stores) {
      const list = storeOffers(catalog, parseStoreFile(read(`stores/${store.id}.json`)));
      expect(list).toHaveLength(store.offers);
    }
  });
});

describe("choosing a store", () => {
  const index = parseOfferIndex(
    JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../fixtures/offers/index.json"), "utf-8"),
    ),
  );

  it("ranks stores by distance", () => {
    const [first, second] = nearestStores(index.stores, PLZ_KARLSRUHE, 2);
    expect(first?.store.name).toBe("Karlsruhe-Oststadt");
    expect(first?.distanceKm).toBeLessThan(5);
    expect(second?.store.name).toBe("Kassel-Wesertor");
  });

  it("finds stores by name, city or the start of the PLZ, ignoring accents", () => {
    expect(findStores(index.stores, "kassel", 5).map((c) => c.store.id)).toEqual(["DE4453"]);
    expect(findStores(index.stores, "1358", 5).map((c) => c.store.id)).toEqual(["DE1643"]);
    expect(findStores(index.stores, "grunhofer", 5).map((c) => c.store.id)).toEqual(["DE1643"]);
    expect(findStores(index.stores, "  ", 5)).toEqual([]);
  });
});

describe("browsing", () => {
  it("lists the sale weeks that have not ended", () => {
    expect(offerWeeks(offers(), SATURDAY)).toEqual([
      { monday: "2026-11-09", from: "2026-11-09", to: "2026-11-14", count: 3 },
      { monday: "2026-11-16", from: "2026-11-16", to: "2026-11-21", count: 1 },
    ]);
    expect(offerWeeks(offers(), "2026-11-15").map((w) => w.monday)).toEqual(["2026-11-16"]);
  });

  it("filters by week, department and words, and hides ended offers", () => {
    const keys = (filter: Partial<OfferFilter>, today = SATURDAY) =>
      filterOffers(offers(), { ...ALL, ...filter }, today).map((o) => o.key);
    expect(keys({})).toEqual([NEXT, MILK, BEER, BREAD]); // by name; the last one has no brand
    expect(keys({ week: "2026-11-09" })).toEqual([MILK, BEER, BREAD]);
    expect(keys({ department: "Getränke, Spirituosen" })).toEqual([BEER]);
    expect(keys({ department: NO_DEPARTMENT })).toEqual([BREAD]);
    expect(keys({ query: "MULLER milch" })).toEqual([MILK]);
    expect(keys({ query: "geschnitten" })).toEqual([BREAD]); // the description counts
    expect(keys({}, "2026-11-15")).toEqual([NEXT]);
  });

  it("filters by a group of the department and counts the groups", () => {
    const drinks = { ...ALL, department: "Getränke, Spirituosen" };
    expect(groupCounts(offers(), drinks, SATURDAY)).toEqual([{ group: "Bier", count: 1 }]);
    const keys = (group: string) =>
      filterOffers(offers(), { ...drinks, group }, SATURDAY).map((o) => o.key);
    expect(keys("Bier")).toEqual([BEER]);
    expect(keys("Wasser")).toEqual([]);
    // No department chosen, or one without groups
    expect(groupCounts(offers(), ALL, SATURDAY)).toEqual([]);
    expect(
      groupCounts(offers(), { ...ALL, department: "Molkereiprodukte, Fette" }, SATURDAY),
    ).toEqual([]);
  });

  it("sorts by discount or price", () => {
    const keys = (sort: OfferFilter["sort"]) =>
      filterOffers(offers(), { ...ALL, sort }, SATURDAY).map((o) => o.key);
    // 33 %, 24 %; this store's milk has no comparison price, the bread never had one
    expect(keys("rabatt")).toEqual([BEER, NEXT, MILK, BREAD]);
    expect(keys("preis")).toEqual([MILK, BREAD, NEXT, BEER]);
  });

  it("counts departments under the other filters, promotions last", () => {
    expect(departmentCounts(offers(), { ...ALL, week: "2026-11-09" }, SATURDAY)).toEqual([
      { department: "Molkereiprodukte, Fette", count: 1 },
      { department: "Getränke, Spirituosen", count: 1 },
      { department: NO_DEPARTMENT, count: 1 },
    ]);
  });
});
