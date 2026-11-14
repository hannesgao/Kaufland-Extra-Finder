import { describe, expect, it } from "vitest";
import { NO_DEPARTMENT, type Offer } from "../src/offers";
import {
  addOffer,
  addText,
  clearList,
  emptyList,
  groupItems,
  hasOffer,
  itemStatus,
  loadList,
  MAX_ITEMS,
  MAX_QUANTITY,
  OWN_ENTRIES,
  parseList,
  refreshOffer,
  removeItem,
  removeOffer,
  saveList,
  setLayout,
  setNote,
  setQuantity,
  setStore,
  STORAGE_KEY,
  type ShoppingList,
} from "../src/shopping";

const SATURDAY = "2026-11-14";

function offer(key: string, fields: Partial<Offer> = {}): Offer {
  return {
    key,
    klNr: key.split("|")[0] ?? "",
    title: "MÜLLER",
    subtitle: "Müllermilch",
    price: "0.59",
    oldPrice: "1.49",
    multiBuy: [],
    salesFrom: "2026-11-09",
    salesTo: "2026-11-14",
    thumbnail: "https://kaufland.media.schwarz/is/image/schwarz/1?a",
    department: "Molkereiprodukte, Fette",
    sections: ["Molkereiprodukte, Fette"],
    ...fields,
  };
}

const MILK = offer("1|2026-11-08");
const BEER = offer("3|2026-11-08", { department: "Getränke, Spirituosen" });
const PROMO = offer("5|2026-11-08"); // only in promotion categories
delete PROMO.department;
const STORE = {
  id: "DE4443",
  name: "Karlsruhe-Oststadt",
  street: "Durlacher Allee 111",
  plz: "76137",
  city: "Karlsruhe",
};

function sample(): ShoppingList {
  let list = setStore(emptyList(), STORE);
  list = addOffer(list, MILK, "a");
  list = addText(list, "  Brot   vom Bäcker ", "b");
  return addOffer(list, BEER, "c");
}

describe("editing", () => {
  it("adds an offer once and free text trimmed", () => {
    const list = sample();
    expect(list.items.map((i) => i.offer?.key ?? i.text)).toEqual([
      MILK.key,
      "Brot vom Bäcker",
      BEER.key,
    ]);
    expect(addOffer(list, MILK, "d")).toBe(list);
    expect(addText(list, "   ", "d")).toBe(list);
    expect(hasOffer(list, BEER.key)).toBe(true);
  });

  it("stops at the maximum", () => {
    let list = emptyList();
    for (let i = 0; i < MAX_ITEMS + 5; i++) list = addText(list, `Eintrag ${String(i)}`, String(i));
    expect(list.items).toHaveLength(MAX_ITEMS);
    expect(addOffer(list, MILK, "x")).toBe(list);
  });

  it("changes quantity within limits, note, and removes", () => {
    let list = setQuantity(sample(), "a", 3);
    expect(list.items[0]?.quantity).toBe(3);
    expect(setQuantity(list, "a", 0).items[0]?.quantity).toBe(1);
    expect(setQuantity(list, "a", 500).items[0]?.quantity).toBe(MAX_QUANTITY);
    list = setNote(list, "b", "geschnitten");
    expect(list.items[1]?.note).toBe("geschnitten");
    expect(removeItem(list, "b").items.map((i) => i.id)).toEqual(["a", "c"]);
    expect(removeOffer(list, MILK.key).items.map((i) => i.id)).toEqual(["b", "c"]);
    expect(clearList(list).items).toEqual([]);
    expect(clearList(list).store).toEqual(STORE);
  });
});

describe("storage", () => {
  function memory(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }

  it("round-trips a list", () => {
    const store = memory();
    const list = setLayout(setQuantity(sample(), "a", 2), "liste");
    expect(saveList(store, list)).toBe(true);
    expect(loadList(store)).toEqual(list);
  });

  it("survives missing or failing storage", () => {
    expect(loadList(null)).toEqual(emptyList());
    expect(saveList(null, sample())).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadList(broken)).toEqual(emptyList());
    expect(saveList(broken, sample())).toBe(false);
  });

  it("drops what it cannot read instead of failing", () => {
    expect(parseList("not json")).toEqual(emptyList());
    expect(parseList("[1]")).toEqual(emptyList());
    const stored = {
      store: { id: "nope" },
      layout: "poster",
      items: [
        { id: "a", quantity: 2, note: "x", offer: MILK },
        { id: "b", quantity: "many", text: "Brot" },
        { id: "c", offer: { key: "x" } }, // neither a full offer nor text
        { quantity: 1, text: "ohne id" },
        "junk",
      ],
    };
    const list = parseList(JSON.stringify(stored));
    expect(list.store).toBeNull();
    expect(list.layout).toBe("kacheln");
    expect(list.items).toEqual([
      { id: "a", quantity: 2, note: "x", offer: MILK },
      { id: "b", quantity: 1, note: "", text: "Brot" },
    ]);
  });

  it("does not keep a stored picture URL that is not https", () => {
    const bad = { ...MILK, thumbnail: "javascript:alert(1)", thumbnail2x: "http://example.org/x" };
    const list = parseList(
      JSON.stringify({ items: [{ id: "a", quantity: 1, note: "", offer: bad }] }),
    );
    expect(list.items[0]?.offer).not.toHaveProperty("thumbnail");
    expect(list.items[0]?.offer).not.toHaveProperty("thumbnail2x");
  });

  it("uses one storage key", () => {
    const store = memory();
    saveList(store, sample());
    expect(store.getItem(STORAGE_KEY)).toContain("Karlsruhe-Oststadt");
  });
});

describe("itemStatus", () => {
  const [milk, bread] = sample().items;
  if (!milk || !bread) throw new Error("sample list is too short");
  const current = (...offers: Offer[]) => new Map(offers.map((o) => [o.key, o]));

  it("is ok for free text and unchanged offers", () => {
    expect(itemStatus(bread, current(), SATURDAY)).toEqual({ kind: "ok" });
    expect(itemStatus(milk, current(MILK), SATURDAY)).toEqual({ kind: "ok" });
  });

  it("only judges the dates while the offers are not loaded", () => {
    expect(itemStatus(milk, null, SATURDAY)).toEqual({ kind: "ok" });
    expect(itemStatus(milk, null, "2026-11-15")).toEqual({ kind: "expired" });
  });

  it("tells expired, gone and changed apart", () => {
    expect(itemStatus(milk, current(MILK), "2026-11-15")).toEqual({ kind: "expired" });
    expect(itemStatus(milk, current(BEER), SATURDAY)).toEqual({ kind: "gone" });
    const dearer = { ...MILK, price: "0.69" };
    expect(itemStatus(milk, current(dearer), SATURDAY)).toEqual({
      kind: "changed",
      current: dearer,
    });
  });

  it("is ok again once the change is taken over", () => {
    const dearer = { ...MILK, price: "0.69" };
    const [updated] = refreshOffer(sample(), "a", dearer).items;
    if (!updated) throw new Error("no item");
    expect(itemStatus(updated, current(dearer), SATURDAY)).toEqual({ kind: "ok" });
  });
});

describe("groupItems", () => {
  it("groups by department in Kaufland's order, promotions and own entries last", () => {
    let list = addOffer(sample(), PROMO, "d");
    list = addOffer(list, offer("7|2026-11-08", { department: "Obst, Gemüse, Pflanzen" }), "e");
    expect(groupItems(list.items).map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ["Obst, Gemüse, Pflanzen", ["e"]],
      ["Molkereiprodukte, Fette", ["a"]],
      ["Getränke, Spirituosen", ["c"]],
      [NO_DEPARTMENT, ["d"]],
      [OWN_ENTRIES, ["b"]],
    ]);
  });
});
