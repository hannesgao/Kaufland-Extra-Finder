// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { ExtraData, LatLng, Store } from "../src/data";
import { search } from "../src/search";
import { renderHit } from "../src/ui/list";
import { edgeCases, fixture, MONDAY, nth, PLZ_KARLSRUHE, PLZ_KASSEL } from "./helpers";

const PAYLOAD = '<img src=x onerror="alert(1)">';

function hitsFor(data: ExtraData, origin: LatLng) {
  return search(data, origin, 10, MONDAY).hits;
}

function linkTexts(el: Element) {
  return [...el.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
}

describe("renderHit", () => {
  it("renders name, address, distance, label and siblings", () => {
    const li = renderHit(nth(hitsFor(fixture(), PLZ_KARLSRUHE)), vi.fn());
    expect(li.dataset.id).toBe("DE4443");
    expect(li.querySelector(".store__title")?.textContent).toBe("Karlsruhe-Oststadt");
    expect(li.querySelector(".store__address")?.textContent).toBe(
      "Durlacher Allee 111, 76137 Karlsruhe",
    );
    expect(li.querySelector(".chip--distance")?.textContent).toBe("1,5 km");
    expect(li.querySelector(".leaflet .chip")?.textContent).toBe("Ab Donnerstag");
    expect(li.querySelector(".leaflet .notice--muted")?.textContent).toBe(
      "Gleicher Prospekt auch in: Karlsruhe-Beiertheim-Bulac (76135), Karlsruhe-Grünwinkel (76185)",
    );
  });

  it("links the Extra leaflet, its PDF and the store page", () => {
    const li = renderHit(nth(hitsFor(fixture(), PLZ_KARLSRUHE)), vi.fn());
    expect(linkTexts(li)).toEqual([
      [
        "Extra-Prospekt ansehen",
        "https://leaflets.kaufland.com/de-DE/DE_de_Hyper1_4443_D41-H/ar/4443",
      ],
      [
        "PDF",
        "https://assets.leaflets.schwarz/leaflets/pdfs/01a0e6b0-a6e8-71d1-a747-5a1d3b7f8fa8/Extra-Angebote-08-10-2026-14-10-2026-00.pdf",
      ],
      ["Filialseite", "https://filiale.kaufland.de/service/filiale/karlsruhe-oststadt-4443.html"],
    ]);
    for (const a of li.querySelectorAll("a")) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("aria-label")).toMatch(/\(neues Fenster\)$/);
    }
  });

  it("omits the store page link when the data has none", () => {
    const store = { ...nth(fixture().stores.filter((s) => s.id === "DE4443")) };
    delete store.url;
    const data = fixture();
    const stores = data.stores.map((s) => (s.id === store.id ? store : s));
    const patched = { ...data, stores, storesById: new Map(stores.map((s) => [s.id, s])) };
    const li = renderHit(nth(hitsFor(patched, PLZ_KARLSRUHE)), vi.fn());
    expect(linkTexts(li).map(([text]) => text)).toEqual(["Extra-Prospekt ansehen", "PDF"]);
  });

  it("selects the store from its name and from the map button", () => {
    const onSelect = vi.fn();
    const li = renderHit(nth(hitsFor(fixture(), PLZ_KARLSRUHE)), onSelect);
    const buttons = [...li.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Karlsruhe-Oststadt", "Auf Karte zeigen"]);
    for (const b of buttons) b.click();
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("DE4443");
  });

  it("shows both validity periods and closure notices", () => {
    const data = edgeCases();
    const kassel = renderHit(nth(hitsFor(data, PLZ_KASSEL)), vi.fn());
    const labels = [...kassel.querySelectorAll(".leaflet .chip")].map((c) => c.textContent);
    expect(labels).toEqual(["Diese Woche", "Ab Donnerstag"]);

    const grunwinkel = hitsFor(data, PLZ_KARLSRUHE).find((h) => h.store.id === "DE8530");
    const text = renderHit(nth(grunwinkel ? [grunwinkel] : []), vi.fn()).textContent;
    expect(text).toContain("Geschlossen am 09.10.");
    expect(text).toContain("Sonderöffnungszeiten: 10.10. 07:00–14:00 Uhr");
  });

  it("uses decorative, hidden icons", () => {
    const li = renderHit(nth(hitsFor(fixture(), PLZ_KARLSRUHE)), vi.fn());
    const icons = [...li.querySelectorAll("svg")];
    expect(icons.length).toBeGreaterThan(3);
    for (const svg of icons) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("never interprets scraped data as HTML", () => {
    const data = fixture();
    const evil = (s: Store): Store => ({ ...s, name: PAYLOAD, street: PAYLOAD, city: PAYLOAD });
    const stores = data.stores.map(evil);
    const patched: ExtraData = {
      ...data,
      stores,
      storesById: new Map(stores.map((s) => [s.id, s])),
    };
    for (const hit of hitsFor(patched, PLZ_KARLSRUHE)) {
      const li = renderHit(hit, vi.fn(), PAYLOAD);
      expect(li.querySelector("img, script")).toBeNull();
      expect(li.textContent).toContain(PAYLOAD);
    }
  });
});
