import { describe, expect, it } from "vitest";
import type { ExtraData, Store } from "../src/data";
import { dateRange } from "../src/dates";
import { search } from "../src/search";
import { edgeCases, fixture, MONDAY, nth, PLZ_HAMBURG, PLZ_KARLSRUHE, PLZ_KASSEL } from "./helpers";

const ids = (...args: Parameters<typeof search>) => search(...args).hits.map((h) => h.store.id);

function replaceStore(data: ExtraData, id: string, patch: Partial<Store>): ExtraData {
  const stores = data.stores.map((s) => (s.id === id ? { ...s, ...patch } : s));
  return { ...data, stores, storesById: new Map(stores.map((s) => [s.id, s])) };
}

describe("search", () => {
  const data = fixture();

  it("finds stores within the radius, nearest first", () => {
    expect(ids(data, PLZ_KARLSRUHE, 10, MONDAY)).toEqual(["DE4443", "DE5443", "DE8530"]);
    expect(ids(data, PLZ_KARLSRUHE, 25, MONDAY)).toEqual(["DE4443", "DE5443", "DE8530", "DE4733"]);
    expect(ids(data, PLZ_KARLSRUHE, 5, MONDAY)).toEqual(["DE4443", "DE5443"]);
  });

  it("includes the radius boundary", () => {
    const exact = nth(search(data, PLZ_KARLSRUHE, 10, MONDAY).hits).distanceKm;
    expect(ids(data, PLZ_KARLSRUHE, exact, MONDAY)).toEqual(["DE4443"]);
  });

  it("labels and groups leaflets by PDF (real Karlsruhe cluster)", () => {
    const hit = nth(search(data, PLZ_KARLSRUHE, 10, MONDAY).hits);
    expect(hit.store.id).toBe("DE4443");
    const view = nth(hit.leaflets);
    expect(view.label).toBe("Ab Donnerstag");
    expect(view.range).toBe("08.10.–14.10.2026");
    // Listed with the same PDF on kaufland.de, but the PDF names neither of them.
    expect(view.siblings.map((s) => [s.store.id, s.pdfNamed])).toEqual([
      ["DE5443", false],
      ["DE8530", false],
    ]);
  });

  it("lists siblings the PDF names first", () => {
    const hit = search(data, PLZ_KARLSRUHE, 10, MONDAY).hits.find((h) => h.store.id === "DE8530");
    const siblings = nth(hit?.leaflets ?? []).siblings;
    expect(siblings.map((s) => [s.store.id, s.pdfNamed])).toEqual([
      ["DE4443", true],
      ["DE5443", false],
    ]);
  });

  it("marks siblings whose PDF check is open", () => {
    const store = nth(data.stores.filter((s) => s.id === "DE5443"));
    const leaflets = store.leaflets.map((l) => {
      const copy = { ...l };
      delete copy.pdfStore;
      delete copy.pdfStoreMatch;
      return copy;
    });
    const patched = replaceStore(data, "DE5443", { leaflets });
    const hit = nth(search(patched, PLZ_KARLSRUHE, 10, MONDAY).hits);
    expect(nth(hit.leaflets).siblings.map((s) => [s.store.id, s.pdfNamed])).toEqual([
      ["DE5443", undefined],
      ["DE8530", false],
    ]);
  });

  it("marks stores whose leaflets all name a different store", () => {
    const hits = search(data, PLZ_KARLSRUHE, 10, MONDAY).hits;
    expect(hits.map((h) => [h.store.id, h.foreignOnly])).toEqual([
      ["DE4443", false],
      ["DE5443", true],
      ["DE8530", true],
    ]);
  });

  it("hides foreign leaflets with the PDF switch", () => {
    const ids = search(data, PLZ_KARLSRUHE, 10, MONDAY, { pdfOnly: true }).hits.map(
      (h) => h.store.id,
    );
    expect(ids).toEqual(["DE4443"]);
  });

  it("does not mark stores whose PDF check is unknown", () => {
    const store = nth(data.stores.filter((s) => s.id === "DE8530"));
    const leaflets = store.leaflets.map((l) => {
      const copy = { ...l };
      delete copy.pdfStore;
      delete copy.pdfStoreMatch;
      return copy;
    });
    const hit = search(replaceStore(data, "DE8530", { leaflets }), PLZ_KARLSRUHE, 10, MONDAY).hits;
    expect(hit.find((h) => h.store.id === "DE8530")?.foreignOnly).toBe(false);
  });

  it("builds the calendar from today's week through the end of the leaflet", () => {
    const view = nth(search(data, PLZ_KASSEL, 10, "2026-10-06").hits);
    expect(view.weeks.map((w) => w.kw)).toEqual([41, 42]);
    const first = nth(view.weeks).days;
    expect(first[0]).toBeNull(); // Monday 05.10. is before today
    expect(first[1]?.today).toBe(true);
    expect(first.map((d) => (d ? d.tone : "-"))).toEqual([
      "-",
      null,
      null,
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("shows one row when the leaflet ends this week", () => {
    const view = nth(search(data, PLZ_KASSEL, 10, "2026-10-13").hits);
    expect(view.weeks.map((w) => w.kw)).toEqual([42]);
    expect(nth(view.weeks).days.map((d) => d?.day ?? null)).toEqual([
      null,
      "13",
      "14",
      "15",
      "16",
      "17",
      "18",
    ]);
  });

  it("merges running and upcoming leaflets into one calendar", () => {
    const view = nth(search(edgeCases(), PLZ_KASSEL, 10, "2026-10-06").hits);
    expect(view.weeks.map((w) => w.kw)).toEqual([41, 42]);
    const tones = view.weeks.flatMap((w) => w.days).map((d) => (d ? d.tone : "-"));
    expect(tones).toEqual([
      "-",
      "now",
      "now",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      null,
      null,
      null,
      null,
    ]);
  });

  it("skips empty weeks between today and a later leaflet", () => {
    const store = nth(data.stores.filter((s) => s.id === "DE4453"));
    const leaflets = store.leaflets.map((l) => ({
      ...l,
      validFrom: "2026-10-22",
      validTo: "2026-10-28",
    }));
    const patched = replaceStore(data, "DE4453", { leaflets });
    const view = nth(search(patched, PLZ_KASSEL, 10, "2026-10-06").hits);
    expect(view.weeks.map((w) => w.kw)).toEqual([41, 43, 44]);
  });

  it("has no siblings for a leaflet only one store has", () => {
    const hit = nth(search(data, PLZ_KASSEL, 10, MONDAY).hits);
    expect(nth(hit.leaflets).siblings).toEqual([]);
  });

  it("shows current and next week's leaflet, current first, each with its own cluster", () => {
    const hit = nth(search(edgeCases(), PLZ_KASSEL, 10, MONDAY).hits);
    expect(hit.leaflets.map((l) => l.label)).toEqual(["Diese Woche", "Ab Donnerstag"]);
    expect(hit.leaflets.map((l) => l.siblings.map((s) => s.store.id))).toEqual([["DE4313"], []]);
  });

  it("drops expired leaflets and stores", () => {
    const thursday = "2026-10-08";
    const hit = nth(search(edgeCases(), PLZ_KASSEL, 10, thursday).hits);
    expect(hit.leaflets.map((l) => l.range)).toEqual(["08.10.–14.10.2026"]);
    expect(nth(hit.leaflets).label).toBe("Diese Woche");
    expect(search(data, PLZ_KASSEL, 100, "2026-10-15")).toEqual({ hits: [], nearest: null });
  });

  it("reports closure days and special hours within the validity", () => {
    const hit = search(edgeCases(), PLZ_KARLSRUHE, 10, MONDAY).hits.find(
      (h) => h.store.id === "DE8530",
    );
    const view = nth(hit?.leaflets ?? []);
    expect(view.closedDays).toEqual(["2026-10-09"]);
    expect(view.specialHours).toEqual([
      { date: "2026-10-10", closed: false, open: "07:00", close: "14:00" },
    ]);
    expect(view.unusable).toBe(false);
    expect(hit?.closed).toBe(false);
  });

  it("ignores closure days that have already passed", () => {
    const hit = search(edgeCases(), PLZ_KARLSRUHE, 10, "2026-10-11").hits.find(
      (h) => h.store.id === "DE8530",
    );
    expect(nth(hit?.leaflets ?? []).closedDays).toEqual([]);
  });

  it("puts stores closed for the whole validity last", () => {
    const closedAllWeek: Store["specialDays"] = dateRange("2026-10-08", "2026-10-14").map(
      (date) => ({ date, closed: true }),
    );
    const patched = replaceStore(data, "DE4443", { specialDays: closedAllWeek });
    const hits = search(patched, PLZ_KARLSRUHE, 10, MONDAY).hits;
    expect(hits.map((h) => h.store.id)).toEqual(["DE5443", "DE8530", "DE4443"]);
    expect(hits.at(-1)?.closed).toBe(true);
    expect(nth(hits.at(-1)?.leaflets ?? []).unusable).toBe(true);
  });

  it("suggests the nearest store when nothing is within the radius", () => {
    const result = search(data, PLZ_HAMBURG, 100, MONDAY);
    expect(result.hits).toEqual([]);
    expect(result.nearest?.store.id).toBe("DE4313");
    expect(result.nearest?.distanceKm).toBeGreaterThan(100);
  });

  it("is fast enough for the whole country", () => {
    const template = nth(data.stores);
    const stores = Array.from({ length: 1000 }, (_, i) => ({
      ...template,
      id: `DE${String(i)}`,
      lat: 47.5 + (i % 70) / 10,
      lng: 6 + Math.floor(i / 70) / 1.5,
    }));
    const big: ExtraData = { ...data, stores, storesById: new Map(stores.map((s) => [s.id, s])) };
    // Guards against an accidental O(n²), not a benchmark: shared CI runners are slow and noisy,
    // so warm up once and take the best of five runs.
    search(big, PLZ_KARLSRUHE, 100, MONDAY);
    const times = Array.from({ length: 5 }, () => {
      const t0 = performance.now();
      search(big, PLZ_KARLSRUHE, 100, MONDAY);
      return performance.now() - t0;
    });
    expect(Math.min(...times)).toBeLessThan(100);
  });
});
