// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  parseCards,
  searchCards,
  storesFor,
  summarizeArticles,
  viewOffer,
  type CardProduct,
} from "../src/cards";
import { DataError, type LatLng } from "../src/data";
import {
  formatPrice,
  offerUrl,
  renderArticle,
  renderArticleStrip,
  renderCardStore,
  storeCount,
} from "../src/ui/cards";
import { shiftedFixture } from "../vite.config";
import { nth, PLZ_KARLSRUHE } from "./helpers";

const CARDS_PATH = resolve(import.meta.dirname, "../fixtures/cards.json");
type Json = Record<string, unknown>;

/** Real cards.json for 6 stores, generated Tuesday 2026-10-06. */
function cardsJson(): Json {
  return JSON.parse(readFileSync(CARDS_PATH, "utf-8")) as Json;
}

const BOOSTER = "20941886|2026-10-08"; // next week's offer: 08.–14.10.
const TOP_TRAINER = "20973783|2026-10-04"; // announced 04.–09.10., sold 12.–17.10.
const DOPPELPACK = "20973794|2026-10-04"; // like TOP_TRAINER, only in the Berlin stores
const BERLIN_BIESDORF: LatLng = [52.5009, 13.5584]; // 12683
const TUESDAY = "2026-10-06";

function product(key: string): CardProduct {
  const p = parseCards(cardsJson()).products.get(key);
  if (!p) throw new Error(`no product ${key}`);
  return p;
}

describe("parseCards", () => {
  it("reads the fixture", () => {
    const cards = parseCards(cardsJson());
    expect(cards.generatedAt.toISOString()).toBe("2026-10-06T18:35:10.000Z");
    expect(cards.keywords).toEqual(["pokemon"]);
    expect(cards.storeCount).toBe(788);
    expect([...cards.products.keys()].sort()).toEqual([BOOSTER, TOP_TRAINER, DOPPELPACK].sort());
    expect(cards.stores).toHaveLength(6);
    const top = product(TOP_TRAINER);
    expect(top).toMatchObject({
      klNr: "20973783",
      title: "POKÉMON",
      subtitle: "Sammelkartenspiel »Top-Trainer-Box«",
      price: "55.00",
      shownFrom: "2026-10-04",
      salesFrom: "2026-10-12",
      salesTo: "2026-10-17",
      category: "Vorwerbung",
    });
    expect(top.thumbnail).toMatch(/^https:\/\/kaufland\.media\.schwarz\/.+\?JGst/);
    expect(product(BOOSTER).salesFrom).toBeUndefined();
  });

  it("rejects another schema version", () => {
    expect(() => parseCards({ ...cardsJson(), schema_version: 2 })).toThrow(DataError);
  });

  it("rejects a store that refers to an unknown product", () => {
    const json = cardsJson();
    const stores = json.stores as Json[];
    stores[0] = { ...stores[0], products: ["nope|2026-01-01"] };
    expect(() => parseCards(json)).toThrow(/unknown product/);
  });

  it("rejects thumbnails that are not https", () => {
    const json = cardsJson();
    const products = json.products as Record<string, Json>;
    products[BOOSTER] = { ...products[BOOSTER], thumbnail: "javascript:alert(1)" };
    expect(() => parseCards(json)).toThrow(/https|URL/);
  });
});

describe("viewOffer", () => {
  it("shows when an announced offer goes on sale", () => {
    const view = viewOffer(product(TOP_TRAINER), TUESDAY);
    expect(view).toMatchObject({ state: "upcoming", from: "2026-10-12", label: "ab Mo, 12.10." });
  });

  it("shows how long a running offer lasts", () => {
    const view = viewOffer(product(TOP_TRAINER), "2026-10-14");
    expect(view).toMatchObject({ state: "now", to: "2026-10-17", label: "bis Sa, 17.10." });
  });

  it("uses the shown dates for ordinary offers", () => {
    expect(viewOffer(product(BOOSTER), TUESDAY)?.label).toBe("ab Do, 08.10.");
    expect(viewOffer(product(BOOSTER), "2026-10-08")?.label).toBe("bis Mi, 14.10.");
  });

  it("drops offers that are over", () => {
    expect(viewOffer(product(BOOSTER), "2026-10-15")).toBeNull();
    expect(viewOffer(product(TOP_TRAINER), "2026-10-17")).not.toBeNull();
    expect(viewOffer(product(TOP_TRAINER), "2026-10-18")).toBeNull();
  });
});

describe("searchCards", () => {
  const cards = parseCards(cardsJson());

  it("finds stores within the radius, nearest first, offers by start date", () => {
    const result = searchCards(cards, BERLIN_BIESDORF, 25, TUESDAY);
    expect(result.hits.map((h) => h.store.id)).toEqual(["DE6200", "DE4400"]);
    expect(result.nearest).toBeNull();
    expect(nth(result.hits).offers.map((o) => o.product.key)).toEqual([
      BOOSTER,
      TOP_TRAINER,
      DOPPELPACK,
    ]);
  });

  it("suggests the nearest store when none is in range", () => {
    const result = searchCards(cards, PLZ_KARLSRUHE, 10, "2026-10-16");
    expect(result.hits.map((h) => h.store.id)).toEqual(["DE4443"]);
    const far = searchCards(cards, [54.32, 10.13], 25, TUESDAY); // Kiel
    expect(far.hits).toEqual([]);
    expect(far.nearest?.store.id).toBe("DE4400");
  });

  it("leaves out stores whose offers are all over", () => {
    expect(searchCards(cards, PLZ_KARLSRUHE, 100, "2026-10-18")).toEqual({
      hits: [],
      nearest: null,
    });
  });
});

describe("renderCardStore", () => {
  const cards = parseCards(cardsJson());
  const hit = nth(searchCards(cards, BERLIN_BIESDORF, 25, TUESDAY).hits);

  it("lists the offers with thumbnail, price, date and link", () => {
    const li = renderCardStore(hit, vi.fn());
    expect(li.dataset.id).toBe("DE6200");
    expect(li.querySelector(".cal-card")).toBeNull();
    const rows = [...li.querySelectorAll(".offer")].map((o) => [
      o.querySelector(".offer__brand")?.textContent,
      o.querySelector(".offer__name")?.textContent,
      o.querySelector(".offer__price")?.textContent.replace(/\s/g, " "),
      o.querySelector(".offer__state")?.textContent,
      o.querySelector(".offer__state")?.classList.contains("tone-upcoming"),
    ]);
    expect(rows).toEqual([
      [
        "POKÉMON",
        "Boosterpack »Karmesin & Purpur - Ewige Rivalen»",
        "4,99 €",
        "ab Do, 08.10.",
        true,
      ],
      ["POKÉMON", "Sammelkartenspiel »Top-Trainer-Box«", "55,00 €", "ab Mo, 12.10.", true],
      ["POKÉMON", "Sammelkartenspiel-Doppelpack", "12,99 €", "ab Mo, 12.10.", true],
    ]);
    const img = li.querySelector<HTMLImageElement>(".offer__thumb");
    expect(img?.getAttribute("srcset")).toMatch(/ 1x, https:\/\/.+ 2x$/);
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img?.getAttribute("alt")).toBe("");
    const link = li.querySelector<HTMLAnchorElement>(".offer__link");
    expect(link?.getAttribute("href")).toBe(
      "https://filiale.kaufland.de/angebote/uebersicht.html?kloffer-articleID=20941886&storeName=DE6200",
    );
    expect(link?.title).toBe(
      "Öffnet das Angebot bei Kaufland und wählt dort die Filiale Berlin-Biesdorf aus",
    );
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noopener noreferrer");
  });

  it("selects the store from its name and the map button", () => {
    const onSelect = vi.fn();
    const li = renderCardStore(hit, onSelect);
    li.querySelector<HTMLButtonElement>(".store__select")?.click();
    [...li.querySelectorAll<HTMLButtonElement>("button")].at(-1)?.click();
    expect(onSelect.mock.calls).toEqual([["DE6200"], ["DE6200"]]);
  });

  it("shows a placeholder without a thumbnail", () => {
    const plain = { ...nth(hit.offers).product };
    delete plain.thumbnail;
    delete plain.thumbnail2x;
    const li = renderCardStore(
      { ...hit, offers: [{ ...nth(hit.offers), product: plain }] },
      vi.fn(),
    );
    expect(li.querySelector("img")).toBeNull();
    expect(li.querySelector(".offer__thumb--empty")).not.toBeNull();
  });

  it("shows a note for the nearest store outside the radius", () => {
    const li = renderCardStore(hit, vi.fn(), { note: "Nächste Filiale" });
    expect(li.querySelector(".store__note")?.textContent).toBe("Nächste Filiale");
  });
});

describe("helpers", () => {
  it("formats prices the German way", () => {
    expect(formatPrice("55.00").replace(/\s/g, " ")).toBe("55,00 €");
    expect(formatPrice("4.99").replace(/\s/g, " ")).toBe("4,99 €");
    expect(formatPrice("ab 3.99")).toBe("ab 3.99");
  });

  it("links Kaufland's offer overview by article number, for the store", () => {
    expect(offerUrl("20973783", "DE4443")).toBe(
      "https://filiale.kaufland.de/angebote/uebersicht.html?kloffer-articleID=20973783&storeName=DE4443",
    );
  });
});

describe("cards fixture date shifting", () => {
  it("shifts dates and product keys alike", () => {
    const shifted = JSON.parse(
      shiftedFixture(new Date("2026-10-21T10:00:00Z"), CARDS_PATH),
    ) as Json;
    const cards = parseCards(shifted);
    expect(cards.generatedAt.toISOString()).toBe("2026-10-20T18:35:10.000Z");
    expect(cards.products.get("20973783|2026-10-18")?.salesFrom).toBe("2026-10-26");
  });
});

describe("articles", () => {
  const cards = parseCards(cardsJson());

  it("lists current articles, fewest stores first", () => {
    const summaries = summarizeArticles(cards, TUESDAY);
    expect(summaries.map((s) => [s.offer.product.key, s.storeIds.length])).toEqual([
      [DOPPELPACK, 2],
      [BOOSTER, 6],
      [TOP_TRAINER, 6],
    ]);
    expect(summarizeArticles(cards, "2026-10-15").map((s) => s.offer.product.key)).toEqual([
      DOPPELPACK,
      TOP_TRAINER,
    ]);
  });

  it("sorts an article's stores by distance, without a radius", () => {
    const doppelpack = nth(summarizeArticles(cards, TUESDAY));
    const stores = storesFor(cards, doppelpack, PLZ_KARLSRUHE);
    expect(stores.map((s) => s.store.id)).toEqual(["DE4400", "DE6200"]);
    expect(nth(stores).distanceKm).toBeGreaterThan(400);
  });

  it("filters the store search by article", () => {
    const all = searchCards(cards, BERLIN_BIESDORF, 100, TUESDAY);
    expect(all.hits).toHaveLength(2);
    const filtered = searchCards(cards, PLZ_KARLSRUHE, 25, TUESDAY, "20973794");
    expect(filtered.hits).toEqual([]);
    expect(filtered.nearest?.store.id).toBe("DE4400");
    expect(
      searchCards(cards, PLZ_KARLSRUHE, 25, TUESDAY, "20941886").hits.map((h) => h.store.id),
    ).toEqual(["DE4443", "DE4733"]);
  });

  it("renders the article strip as toggles with store counts", () => {
    const summaries = summarizeArticles(cards, TUESDAY);
    const onToggle = vi.fn();
    const items = renderArticleStrip(summaries, new Map([[DOPPELPACK, 3.2]]), "20973794", onToggle);
    const buttons = items.map((li) => li.querySelector("button"));
    expect(buttons.map((b) => b?.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    expect(buttons[0]?.textContent).toContain("in 2 Filialen · nächste 3,2 km");
    buttons[1]?.click();
    expect(onToggle).toHaveBeenCalledWith("20941886");
  });

  it("renders an article with its nearest stores and a button for the rest", () => {
    const booster = nth(summarizeArticles(cards, TUESDAY), 1);
    const stores = storesFor(cards, booster, PLZ_KARLSRUHE);
    const onExpand = vi.fn();
    const li = renderArticle(booster, stores, false, onExpand);
    expect(li.querySelectorAll(".article__store")).toHaveLength(5);
    expect(li.querySelector(".offer__count")?.textContent).toBe("in 6 Filialen");
    const first = li.querySelector(".article__store");
    expect(first?.querySelector(".article__store-name")?.textContent).toBe("Karlsruhe-Oststadt");
    expect(first?.querySelector("a")?.getAttribute("href")).toContain("storeName=DE4443");
    li.querySelector<HTMLButtonElement>(".article__more")?.click();
    expect(onExpand).toHaveBeenCalledWith(BOOSTER);
    const all = renderArticle(booster, stores, true, onExpand);
    expect(all.querySelectorAll(".article__store")).toHaveLength(6);
    expect(all.querySelector(".article__more")).toBeNull();
  });

  it("shows store counts in store cards and highlights the filtered article", () => {
    const hit = nth(searchCards(cards, BERLIN_BIESDORF, 25, TUESDAY).hits);
    const counts = new Map(
      summarizeArticles(cards, TUESDAY).map((s) => [s.offer.product.key, s.storeIds.length]),
    );
    const li = renderCardStore(hit, vi.fn(), { counts, article: "20973794" });
    expect([...li.querySelectorAll(".offer__count")].map((e) => e.textContent)).toEqual([
      "in 6 Filialen",
      "in 6 Filialen",
      "in 2 Filialen",
    ]);
    expect(
      [...li.querySelectorAll(".offer")].map((o) => o.classList.contains("is-highlighted")),
    ).toEqual([false, false, true]);
  });

  it("says Filiale for one store", () => {
    expect(storeCount(1)).toBe("in 1 Filiale");
    expect(storeCount(11)).toBe("in 11 Filialen");
  });
});
