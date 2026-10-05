// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
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

describe("listAll with the PDF switch", () => {
  it("hides stores whose leaflets all name a different store", () => {
    const all = listAll(fixture(), MONDAY, "plz-asc");
    const confirmed = listAll(fixture(), MONDAY, "plz-asc", { pdfOnly: true });
    expect(all).toHaveLength(6);
    expect(confirmed.map((v) => v.store.id)).toEqual(["DE4453", "DE4313", "DE4443", "DE4733"]);
  });

  it("keeps a store with one own and one foreign leaflet, showing only the own one", () => {
    const data = edgeCases();
    const kassel = nth(data.stores.filter((s) => s.id === "DE4453"));
    const [current, next] = kassel.leaflets;
    if (!current || !next) throw new Error("fixture changed");
    current.pdfStoreMatch = false;
    const view = listAll(data, MONDAY, "plz-asc", { pdfOnly: true }).find(
      (v) => v.store.id === "DE4453",
    );
    expect(view?.leaflets.map((l) => l.leaflet.validFrom)).toEqual(["2026-10-08"]);
    expect(view?.foreignOnly).toBe(false);
  });
});

describe("renderRow (list tab card)", () => {
  it("is a store card led by the PLZ, with one calendar and two store buttons", () => {
    const view = nth(listAll(edgeCases(), MONDAY, "plz-asc"));
    const onShow = vi.fn();
    const card = renderRow(view, onShow);
    expect(card.classList.contains("store")).toBe(true);
    expect(card.dataset.id).toBe("DE4453");
    expect(card.querySelector(".store__plz")?.textContent).toBe("34125");
    expect(card.querySelector(".store__avatar, .chip--distance")).toBeNull();
    expect(card.querySelector(".store__title")?.textContent).toBe("Kassel-Wesertor");
    expect(card.querySelector(".store__address")?.textContent).toBe(
      "Franzgraben 40-42, 34125 Kassel",
    );
    const titles = [...card.querySelectorAll(".lp-head__title")].map((t) => t.textContent);
    expect(titles).toEqual(["Laufender Extra-Prospekt", "Aktuellster Extra-Prospekt"]);
    expect(card.querySelectorAll(".cal")).toHaveLength(1);
    const links = [...card.querySelectorAll("a")].map((a) => a.textContent);
    expect(links).toEqual([
      "Extra-Prospekt ansehen",
      "PDF",
      "Extra-Prospekt ansehen",
      "PDF",
      "Filialseite",
    ]);
    const button = card.querySelector<HTMLButtonElement>(".store__actions button");
    expect(button?.textContent).toBe("In Umkreissuche zeigen");
    button?.click();
    expect(onShow).toHaveBeenCalledWith("DE4453");
  });

  it("flags leaflets whose PDF names a different store", () => {
    const view = listAll(fixture(), MONDAY, "plz-asc").find((v) => v.store.id === "DE8530");
    const card = renderRow(nth(view ? [view] : []), vi.fn());
    expect(card.classList.contains("store--foreign")).toBe(true);
    expect(card.querySelector(".chip--foreign")?.textContent).toBe(
      "Extra-Prospekt einer anderen Filiale",
    );
    expect(card.querySelector(".pdf-warning__text")?.textContent).toBe(
      "Im PDF steht: „NUR IN KARLSRUHE-OSTSTADT, IM DURLACH CENTER“",
    );
    const own = listAll(fixture(), MONDAY, "plz-asc").find((v) => v.store.id === "DE4443");
    expect(renderRow(nth(own ? [own] : []), vi.fn()).querySelector(".pdf-warning")).toBeNull();
  });

  it("flags closure days", () => {
    const view = listAll(edgeCases(), MONDAY, "plz-asc").find((v) => v.store.id === "DE8530");
    expect(renderRow(nth(view ? [view] : []), vi.fn()).textContent).toContain(
      "Geschlossen am 09.10.",
    );
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
      const card = renderRow(view, vi.fn());
      expect(card.querySelector("img, script")).toBeNull();
      expect(card.textContent).toContain(payload);
    }
  });
});
