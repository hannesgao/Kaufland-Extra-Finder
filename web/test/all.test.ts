// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { ExtraData, Store } from "../src/data";
import { listAll } from "../src/search";
import { renderRow } from "../src/ui/list";
import { edgeCases, fixture, MONDAY, nth } from "./helpers";

describe("listAll", () => {
  it("lists every store with a current or upcoming leaflet, sorted by PLZ", () => {
    const plz = listAll(fixture(), MONDAY, "plz-asc").map((v) => v.store.plz);
    expect(plz).toEqual(["34125", "37079", "76135", "76137", "76185", "76437"]);
    const desc = listAll(fixture(), MONDAY, "plz-desc").map((v) => v.store.plz);
    expect(desc).toEqual([...plz].reverse());
  });

  it("breaks PLZ ties by name", () => {
    const data = fixture();
    const stores = data.stores.map((s) => (s.id === "DE8530" ? { ...s, plz: "76137" } : s));
    const patched: ExtraData = {
      ...data,
      stores,
      storesById: new Map(stores.map((s) => [s.id, s])),
    };
    const names = listAll(patched, MONDAY, "plz-desc")
      .filter((v) => v.store.plz === "76137")
      .map((v) => v.store.name);
    expect(names).toEqual(["Karlsruhe-Grünwinkel", "Karlsruhe-Oststadt"]);
  });

  it("drops stores whose leaflets have all expired", () => {
    expect(listAll(fixture(), "2026-10-15", "plz-asc")).toEqual([]);
    const kassel = listAll(edgeCases(), "2026-10-08", "plz-asc").find(
      (v) => v.store.id === "DE4453",
    );
    expect(kassel?.leaflets).toHaveLength(1);
  });
});

describe("renderRow", () => {
  it("shows PLZ, name, address, store link and per-leaflet links", () => {
    const view = nth(listAll(edgeCases(), MONDAY, "plz-asc"));
    const row = renderRow(view);
    expect(row.dataset.id).toBe("DE4453");
    expect(row.querySelector(".row__plz")?.textContent).toBe("34125");
    expect(row.querySelector(".row__title")?.textContent).toBe("Kassel-Wesertor");
    expect(row.querySelector(".row__address")?.textContent).toBe("Franzgraben 40-42, 34125 Kassel");
    const labels = [...row.querySelectorAll(".row__leaflet .chip")].map((c) => c.textContent);
    expect(labels).toEqual(["Diese Woche", "Ab Donnerstag"]);
    const links = [...row.querySelectorAll("a")].map((a) => a.textContent);
    expect(links).toEqual(["Filialseite", "Prospekt", "PDF", "Prospekt", "PDF"]);
  });

  it("flags leaflets whose PDF names a different store", () => {
    const view = listAll(fixture(), MONDAY, "plz-asc").find((v) => v.store.id === "DE8530");
    const row = renderRow(nth(view ? [view] : []));
    expect(row.classList.contains("row--foreign")).toBe(true);
    expect(row.querySelector(".row__foreign")?.textContent).toBe(
      "Laut PDF nur in KARLSRUHE-OSTSTADT, IM DURLACH CENTER",
    );
    const own = listAll(fixture(), MONDAY, "plz-asc").find((v) => v.store.id === "DE4443");
    expect(renderRow(nth(own ? [own] : [])).querySelector(".row__foreign")).toBeNull();
  });

  it("flags closure days", () => {
    const view = listAll(edgeCases(), MONDAY, "plz-asc").find((v) => v.store.id === "DE8530");
    expect(renderRow(nth(view ? [view] : [])).textContent).toContain("geschlossen 09.10.");
  });

  it("never interprets scraped data as HTML", () => {
    const payload = '<img src=x onerror="alert(1)">';
    const data = fixture();
    const stores = data.stores.map((s): Store => ({ ...s, name: payload, city: payload }));
    const patched: ExtraData = {
      ...data,
      stores,
      storesById: new Map(stores.map((s) => [s.id, s])),
    };
    for (const view of listAll(patched, MONDAY, "plz-asc")) {
      const row = renderRow(view);
      expect(row.querySelector("img, script")).toBeNull();
      expect(row.textContent).toContain(payload);
    }
  });
});
