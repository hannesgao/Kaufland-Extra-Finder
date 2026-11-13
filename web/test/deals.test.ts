// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DataError } from "../src/data";
import {
  dealCounts,
  dealSections,
  discountPercent,
  listDeals,
  parseDeals,
  sectionCounts,
  type DealOptions,
  type DealView,
} from "../src/deals";
import { dealsButton, dealsStatus, DEALS_EMPTY } from "../src/summary";
import { DEAL_STORES_SHOWN, dealStoreCount, otherStoresNote, renderDeal } from "../src/ui/deals";
import { PLZ_KARLSRUHE } from "./helpers";

const DEALS_PATH = resolve(import.meta.dirname, "fixtures/deals-2026-11-12.json");
type Json = Record<string, unknown>;

/** Real deals.json reduced to 5 stores, generated Thursday 2026-11-12; offers 08.–14.11. */
function dealsJson(): Json {
  return JSON.parse(readFileSync(DEALS_PATH, "utf-8")) as Json;
}

const THURSDAY = "2026-11-12";
const MILK = "20683585|2026-11-08"; // MÜLLER Müllermilch 0.59 instead of 1.49, all 5 stores
const LAMB = "00010960|2026-11-08"; // Lammkrone: 3.69, but 3.99 in two of its three stores
const BEEF = "00012321|2026-11-08"; // US-Rinderentrecôte: title not found in any PDF
const DEFAULTS: DealOptions = {
  sort: "rabatt",
  section: null,
  commonOnly: true,
  unconfirmed: false,
  nearKm: null,
};

function list(options: Partial<DealOptions> = {}, today = THURSDAY) {
  return listDeals(parseDeals(dealsJson()), PLZ_KARLSRUHE, today, { ...DEFAULTS, ...options });
}

function find(views: DealView[], key: string): DealView {
  const view = views.find((v) => v.offer.product.key === key);
  if (!view) throw new Error(`no offer ${key}`);
  return view;
}

describe("parseDeals", () => {
  it("reads products and stores", () => {
    const data = parseDeals(dealsJson());
    expect(data.products.size).toBe(49);
    expect(data.stores.map((s) => s.id)).toEqual([
      "DE1480",
      "DE1600",
      "DE2560",
      "DE4443",
      "DE4453",
    ]);
    expect(data.extraStoreCount).toBe(5);
    expect(data.products.get(MILK)).toMatchObject({
      klNr: "20683585",
      title: "MÜLLER",
      subtitle: "Müllermilch",
      price: "0.59",
      oldPrice: "1.49",
      sections: ["Molkereiprodukte, Fette"],
      otherStores: 37,
    });
    const karlsruhe = data.stores.find((s) => s.id === "DE4443");
    expect(karlsruhe?.prices.get(LAMB)).toBe("3.99");
    expect(karlsruhe?.unconfirmed.has(BEEF)).toBe(true);
  });

  it("rejects broken files", () => {
    expect(() => parseDeals({ ...dealsJson(), schema_version: 2 })).toThrow(DataError);
    expect(() => parseDeals({ ...dealsJson(), generated_at: "x" })).toThrow(DataError);
    const unknown = dealsJson();
    (unknown.stores as Json[])[0] = { ...(unknown.stores as Json[])[0], products: ["nope"] };
    expect(() => parseDeals(unknown)).toThrow(/unknown product/);
    const price = dealsJson();
    (price.stores as Json[])[0] = { ...(price.stores as Json[])[0], prices: { [MILK]: 1 } };
    expect(() => parseDeals(price)).toThrow(/bad price/);
    const link = dealsJson();
    (link.products as Record<string, Json>)[MILK] = {
      ...(link.products as Record<string, Json>)[MILK],
      thumbnail: "javascript:alert(1)",
    };
    expect(() => parseDeals(link)).toThrow(DataError);
  });
});

describe("discountPercent", () => {
  it("rounds the discount against the comparison price", () => {
    expect(discountPercent("0.59", "1.49")).toBe(60);
    expect(discountPercent("8.99", "13.99")).toBe(36);
  });

  it("is null without a lower price", () => {
    expect(discountPercent("2.99", undefined)).toBeNull();
    expect(discountPercent(undefined, "2.99")).toBeNull();
    expect(discountPercent("2.99", "2.99")).toBeNull();
    expect(discountPercent("x", "2.99")).toBeNull();
  });
});

describe("listDeals", () => {
  it("lists the common, confirmed offers with the biggest discount first", () => {
    const { views, extraStores, total } = list();
    expect(views).toHaveLength(27);
    expect(extraStores).toBe(5);
    expect(total).toBe(48); // the 49th is only listed unconfirmed
    expect(views.slice(0, 3).map((v) => [v.offer.product.subtitle, v.discount])).toEqual([
      ["Müllermilch", 60],
      ["Monte", 57],
      ["Franz. Weichkäse", 52],
    ]);
    expect(views.every((v) => v.storeCount >= 3)).toBe(true);
  });

  it("sorts stores by distance from the origin", () => {
    const milk = find(list().views, MILK);
    expect(milk.stores.map((s) => s.store.name)).toEqual([
      "Karlsruhe-Oststadt",
      "Steinheim an der Murr",
      "Kassel-Wesertor",
      "Hagen-Hohenlimburg",
      "Soest",
    ]);
    expect(milk.stores[0]?.distanceKm).toBeLessThan(5);
    expect(milk.storeCount).toBe(5);
  });

  it("shows rare offers when asked", () => {
    expect(list({ commonOnly: false }).views).toHaveLength(48);
  });

  it("keeps offers not found in the PDF out unless asked", () => {
    expect(list({ commonOnly: false }).views.some((v) => v.offer.product.key === BEEF)).toBe(false);
    const { views, total } = list({ unconfirmed: true });
    expect(total).toBe(49);
    const beef = find(views, BEEF);
    expect(beef.storeCount).toBe(3);
    expect(beef.stores.every((s) => s.unconfirmed)).toBe(true);
  });

  it("uses each store's own price", () => {
    const lamb = find(list().views, LAMB);
    expect(lamb.stores.map((s) => [s.store.id, s.price])).toEqual([
      ["DE4443", "3.99"],
      ["DE2560", "3.99"],
      ["DE4453", "3.69"],
    ]);
    expect([lamb.priceFrom, lamb.priceTo]).toEqual(["3.69", "3.99"]);
    expect(lamb.discount).toBe(12); // of the lowest price against 4.19
  });

  it("limits the listed stores to the radius, not the count of stores", () => {
    const { views } = list({ nearKm: 25 });
    const milk = find(views, MILK);
    expect(milk.stores.map((s) => s.store.id)).toEqual(["DE4443"]);
    expect(milk.storeCount).toBe(5);
    const lamb = find(views, LAMB);
    expect([lamb.priceFrom, lamb.priceTo]).toEqual(["3.99", "3.99"]);
    // An offer that only far stores have is not listed.
    expect(list({ nearKm: 25, commonOnly: false }).views.length).toBeLessThan(48);
  });

  it("filters by category", () => {
    const { views } = list({ section: "Getränke, Spirituosen" });
    expect(views).toHaveLength(4);
    expect(views.every((v) => v.offer.product.sections.includes("Getränke, Spirituosen"))).toBe(
      true,
    );
  });

  it("sorts by number of stores and by price", () => {
    const byStores = list({ sort: "filialen" }).views.map((v) => v.storeCount);
    expect(byStores).toEqual([...byStores].sort((a, b) => b - a));
    const byPrice = list({ sort: "preis" }).views;
    expect(byPrice.slice(0, 2).map((v) => v.priceFrom)).toEqual(["0.49", "0.59"]);
  });

  it("has nothing once the offers are over", () => {
    expect(list({}, "2026-11-15")).toEqual({ views: [], extraStores: 0, total: 0 });
    expect(list({}, "2026-11-14").views).toHaveLength(27);
  });
});

describe("one store", () => {
  it("lists all offers of the store, common or not, with its prices", () => {
    const { views } = list({ storeId: "DE2560" }); // Steinheim an der Murr: 46 offers, 1 unconfirmed
    expect(views).toHaveLength(45);
    expect(views.every((v) => v.stores.length === 1 && v.stores[0]?.store.id === "DE2560")).toBe(
      true,
    );
    const lamb = find(views, LAMB);
    expect([lamb.priceFrom, lamb.priceTo]).toEqual(["3.99", "3.99"]);
    expect(lamb.storeCount).toBe(3);
    expect(list({ storeId: "DE2560", unconfirmed: true }).views).toHaveLength(46);
    expect(list({ storeId: "DE2560", nearKm: 1 }).views).toHaveLength(45); // radius does not apply
    expect(list({ storeId: "DE0000" }).views).toEqual([]);
  });

  it("counts the offers per store for the store cards", () => {
    const data = parseDeals(dealsJson());
    const counts = dealCounts(data, THURSDAY);
    expect(counts.get("DE2560")).toBe(45);
    expect(counts.get("DE4443")).toBe(27); // 28 without the unconfirmed one
    expect(counts.size).toBe(5);
    expect(dealCounts(data, "2026-11-15").size).toBe(0);
    expect(dealsButton(27)).toBe("27 Extra-Angebote");
    expect(dealsButton(1)).toBe("1 Extra-Angebot");
  });

  it("names the store in the status", () => {
    expect(dealsStatus(45, 48, 5, null, "von PLZ 76131", "Steinheim an der Murr")).toBe(
      "45 Extra-Angebote in der Filiale Steinheim an der Murr.",
    );
    expect(dealsStatus(0, 48, 5, null, "von PLZ 76131", "Soest")).toBe(
      "Keine Extra-Angebote in der Filiale Soest.",
    );
  });
});

describe("dealSections", () => {
  it("lists the categories of the current offers", () => {
    const data = parseDeals(dealsJson());
    const sections = dealSections(data, THURSDAY);
    expect(sections).toHaveLength(10);
    expect(sections[0]).toBe("Drogerie, Tiernahrung");
    expect(dealSections(data, "2026-11-15")).toEqual([]);
  });
});

describe("sectionCounts", () => {
  it("counts the listed offers per category", () => {
    const counts = sectionCounts(list().views);
    expect(counts.get("Getränke, Spirituosen")).toBe(4);
    expect([...counts.keys()][0]).toBe("Drogerie, Tiernahrung");
    expect(sectionCounts(list({ nearKm: 0 }).views).size).toBe(0);
  });
});

describe("dealsStatus", () => {
  it("counts offers, stores and hidden offers", () => {
    expect(dealsStatus(27, 48, 5, null, "von PLZ 76131")).toBe(
      "27 Extra-Angebote aus 5 Extra-Filialen, 21 weitere ausgeblendet. " +
        "Filialen nach Entfernung von PLZ 76131.",
    );
    expect(dealsStatus(1, 1, 1, { radiusKm: 25, label: "um PLZ 76131" }, "von PLZ 76131")).toBe(
      "1 Extra-Angebot aus 1 Extra-Filiale. Nur Filialen im Umkreis von 25 km um PLZ 76131.",
    );
  });

  it("says when there is nothing", () => {
    expect(dealsStatus(0, 0, 0, null, "von PLZ 76131")).toBe(DEALS_EMPTY);
    expect(dealsStatus(0, 48, 5, { radiusKm: 10, label: "um PLZ 18055" }, "von PLZ 18055")).toBe(
      "Keine Extra-Filiale mit Angeboten im Umkreis von 10 km um PLZ 18055.",
    );
  });
});

describe("renderDeal", () => {
  const noop = () => undefined;

  it("shows price, comparison price, discount and stores", () => {
    const item = renderDeal(find(list().views, MILK), 5, false, noop);
    expect(item.dataset.key).toBe(MILK);
    expect(item.querySelector(".offer__brand")?.textContent).toBe("MÜLLER");
    expect(item.querySelector("h3")?.textContent).toBe("Müllermilch");
    expect(item.querySelector(".deal__price")?.textContent).toBe("0,59\u00a0€");
    expect(item.querySelector(".deal__old")?.textContent).toBe("1,49\u00a0€");
    expect(item.querySelector(".deal__discount")?.textContent).toBe("−60 %");
    expect(item.textContent).toContain("in 5 von 5 Extra-Filialen");
    expect(item.textContent).toContain("auch in 37 anderen Filialen");
    expect(item.textContent).toContain("bis Sa, 14.11.");
    expect(item.querySelectorAll(".article__store")).toHaveLength(DEAL_STORES_SHOWN);
    const link = item.querySelector<HTMLAnchorElement>(".offer__link");
    expect(link?.href).toBe(
      "https://filiale.kaufland.de/angebote/uebersicht.html?kloffer-articleID=20683585&storeName=DE4443",
    );
    expect(link?.rel).toBe("noopener noreferrer");
    const image = item.querySelector("img");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("names the category with its icon", () => {
    const item = renderDeal(find(list().views, MILK), 5, false, noop);
    const section = item.querySelector(".deal__section");
    expect(section?.textContent).toBe("Molkereiprodukte, Fette");
    expect(section?.querySelector("svg")).not.toBeNull();
    const paprika = list().views.find((v) => v.offer.product.sections.length === 0);
    expect(
      paprika && renderDeal(paprika, 5, false, noop).querySelector(".deal__section"),
    ).toBeNull();
  });

  it("shows 'ab' and every store's price when prices differ", () => {
    const item = renderDeal(find(list().views, LAMB), 5, false, noop);
    expect(item.querySelector(".deal__price")?.textContent).toBe("ab 3,69\u00a0€");
    const rows = [...item.querySelectorAll(".article__store-distance")].map((e) => e.textContent);
    expect(rows[0]?.startsWith("3,99\u00a0€ · ")).toBe(true);
    expect(rows[2]?.startsWith("3,69\u00a0€ · ")).toBe(true);
  });

  it("marks stores whose PDF does not show the offer", () => {
    const item = renderDeal(find(list({ unconfirmed: true }).views, BEEF), 5, false, noop);
    expect(item.textContent).toContain("im Prospekt-PDF nicht gefunden");
    expect(item.textContent).not.toContain("anderen Filiale");
  });

  it("expands the store list", () => {
    const views = list({ commonOnly: false }).views;
    const many = { ...find(views, MILK) };
    many.stores = [...many.stores, ...many.stores]; // 10 rows
    let expanded = "";
    const item = renderDeal(many, 5, false, (key) => {
      expanded = key;
    });
    expect(item.querySelectorAll(".article__store")).toHaveLength(DEAL_STORES_SHOWN);
    const more = item.querySelector<HTMLButtonElement>(".article__more");
    expect(more?.textContent).toBe("Alle 10 Filialen anzeigen");
    more?.click();
    expect(expanded).toBe(MILK);
    expect(renderDeal(many, 5, true, noop).querySelectorAll(".article__store")).toHaveLength(10);
  });

  it("escapes names", () => {
    const view = find(list().views, MILK);
    const evil = {
      ...view,
      offer: { ...view.offer, product: { ...view.offer.product, subtitle: "<img src=x>" } },
    };
    const item = renderDeal(evil, 5, false, noop);
    expect(item.querySelector("h3")?.textContent).toBe("<img src=x>");
    expect(item.querySelectorAll("img")).toHaveLength(1);
  });
});

describe("labels", () => {
  it("counts stores", () => {
    expect(dealStoreCount(41, 51)).toBe("in 41 von 51 Extra-Filialen");
    expect(otherStoresNote(1)).toBe("auch in 1 anderen Filiale");
    expect(otherStoresNote(37)).toBe("auch in 37 anderen Filialen");
  });
});
