import { describe, expect, it } from "vitest";
import type { ExtraData, Store } from "../src/data";
import { dateRange } from "../src/dates";
import { search } from "../src/search";
import { fixture, nth, PLZ_HAMBURG, PLZ_KARLSRUHE, PLZ_KASSEL, TUESDAY } from "./helpers";

const ids = (...args: Parameters<typeof search>) => search(...args).hits.map((h) => h.store.id);

describe("search", () => {
  const data = fixture();

  it("finds stores within the radius, nearest first", () => {
    expect(ids(data, PLZ_KARLSRUHE, 10, TUESDAY)).toEqual(["DE4443", "DE5443", "DE8530", "DE4233"]);
    expect(ids(data, PLZ_KARLSRUHE, 5, TUESDAY)).toEqual(["DE4443", "DE5443"]);
  });

  it("includes the radius boundary", () => {
    const [hit] = search(data, PLZ_KARLSRUHE, 10, TUESDAY).hits;
    expect(hit).toBeDefined();
    const exact = hit?.distanceKm ?? 0;
    expect(ids(data, PLZ_KARLSRUHE, exact, TUESDAY)).toContain("DE4443");
  });

  it("describes leaflets: label, range and cluster siblings", () => {
    const hit = search(data, PLZ_KARLSRUHE, 10, TUESDAY).hits[0];
    expect(hit?.store.id).toBe("DE4443");
    const [view] = hit?.leaflets ?? [];
    expect(view?.label).toBe("Ab Donnerstag");
    expect(view?.range).toBe("08.10.–14.10.2026");
    expect(view?.siblings.map((s) => s.name)).toEqual(["Ettlingen", "Karlsruhe-Beiertheim-Bulach"]);
  });

  it("shows current and next week's leaflet, current first", () => {
    const hit = search(data, PLZ_KASSEL, 10, TUESDAY).hits[0];
    expect(hit?.leaflets.map((l) => l.label)).toEqual(["Diese Woche", "Ab Donnerstag"]);
    expect(hit?.leaflets[1]?.siblings.map((s) => s.id)).toEqual(["DE4313"]);
  });

  it("drops expired leaflets and stores", () => {
    const thursday = "2026-10-08";
    const hit = search(data, PLZ_KASSEL, 10, thursday).hits[0];
    expect(hit?.leaflets.map((l) => l.label)).toEqual(["Diese Woche"]);
    expect(search(data, PLZ_KASSEL, 100, "2026-10-15")).toEqual({ hits: [], nearest: null });
  });

  it("reports closure days and special hours within the validity", () => {
    const hit = search(data, PLZ_KARLSRUHE, 10, TUESDAY).hits.find((h) => h.store.id === "DE8530");
    const view = hit?.leaflets[0];
    expect(view?.closedDays).toEqual(["2026-10-09"]);
    expect(view?.specialHours).toEqual([
      { date: "2026-10-10", closed: false, open: "07:00", close: "14:00" },
    ]);
    expect(view?.unusable).toBe(false);
    expect(hit?.closed).toBe(false);
  });

  it("ignores closure days that have already passed", () => {
    const hit = search(data, PLZ_KARLSRUHE, 10, "2026-10-11").hits.find(
      (h) => h.store.id === "DE8530",
    );
    expect(hit?.leaflets[0]?.closedDays).toEqual([]);
  });

  it("puts stores closed for the whole validity last", () => {
    const closedAllWeek: Store["specialDays"] = dateRange("2026-10-08", "2026-10-14").map(
      (date) => ({
        date,
        closed: true,
      }),
    );
    const stores = data.stores.map((s) =>
      s.id === "DE4443" ? { ...s, specialDays: closedAllWeek } : s,
    );
    const patched: ExtraData = {
      ...data,
      stores,
      storesById: new Map(stores.map((s) => [s.id, s])),
    };
    const hits = search(patched, PLZ_KARLSRUHE, 10, TUESDAY).hits;
    expect(hits.map((h) => h.store.id)).toEqual(["DE5443", "DE8530", "DE4233", "DE4443"]);
    expect(hits.at(-1)?.closed).toBe(true);
    expect(hits.at(-1)?.leaflets[0]?.unusable).toBe(true);
  });

  it("suggests the nearest store when nothing is within the radius", () => {
    const result = search(data, PLZ_HAMBURG, 100, TUESDAY);
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
    const t0 = performance.now();
    search(big, PLZ_KARLSRUHE, 100, TUESDAY);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
