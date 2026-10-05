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
    const chips = [...li.querySelectorAll(".validity__chip")].map((c) =>
      [...c.children].map((cell) => cell.textContent),
    );
    expect(chips).toEqual([
      ["Ab", "Donnerstag", "(08.10.2026)"],
      ["Bis", "Mittwoch", "(14.10.2026)"],
    ]);
    expect(li.querySelector(".validity")?.getAttribute("aria-label")).toBe(
      "Gültig ab Donnerstag, 08.10.2026, bis Mittwoch, 14.10.2026",
    );
    expect(li.querySelector(".siblings__title")?.textContent).toBe(
      "Gleicher Extra-Prospekt auch in",
    );
    const siblings = [...li.querySelectorAll(".siblings__item")].map((item) => [
      item.querySelector(".siblings__name")?.textContent,
      item.querySelector(".siblings__place")?.textContent,
    ]);
    expect(siblings).toEqual([
      ["Karlsruhe-Beiertheim-Bulac", "76135 Karlsruhe"],
      ["Karlsruhe-Grünwinkel", "76185 Karlsruhe"],
    ]);
    expect(li.querySelector(".siblings__more")).toBeNull();
  });

  it("warns prominently when the PDF names a different store", () => {
    const hits = hitsFor(fixture(), PLZ_KARLSRUHE);
    const grunwinkel = renderHit(nth(hits.filter((h) => h.store.id === "DE8530")), vi.fn());
    expect(grunwinkel.classList.contains("store--foreign")).toBe(true);
    expect(grunwinkel.querySelector(".chip--foreign")?.textContent).toBe(
      "Extra-Prospekt einer anderen Filiale",
    );
    const warning = grunwinkel.querySelector(".pdf-warning");
    expect(warning?.getAttribute("role")).toBe("note");
    expect(warning?.textContent).toBe(
      "Achtung: Laut PDF gilt dieser Extra-Prospekt nicht für diese Filiale." +
        "Im PDF steht: „NUR IN KARLSRUHE-OSTSTADT, IM DURLACH CENTER“",
    );
    // The leaflet panel starts with the warning, before the dates.
    expect(grunwinkel.querySelector(".leaflet")?.firstElementChild?.className).toBe("pdf-warning");

    const oststadt = renderHit(nth(hits.filter((h) => h.store.id === "DE4443")), vi.fn());
    expect(oststadt.querySelector(".pdf-warning, .chip--foreign")).toBeNull();
    expect(oststadt.classList.contains("store--foreign")).toBe(false);
  });

  it("lists at most five siblings and counts the rest", () => {
    const data = fixture();
    const cluster = nth(nth(data.stores.filter((s) => s.id === "DE4443")).leaflets).cluster;
    const extra = Array.from({ length: 6 }, (_, i) => `DE900${String(i)}`);
    const template = nth(data.stores.filter((s) => s.id === "DE5443"));
    const stores = [
      ...data.stores,
      ...extra.map((id, i) => ({ ...template, id, name: `Test ${String(i)}` })),
    ];
    const clusters = new Map(data.clusters);
    clusters.set(cluster, [...(clusters.get(cluster) ?? []), ...extra]);
    const patched: ExtraData = {
      ...data,
      stores,
      storesById: new Map(stores.map((s) => [s.id, s])),
      clusters,
    };
    const hit = nth(hitsFor(patched, PLZ_KARLSRUHE).filter((h) => h.store.id === "DE4443"));
    const li = renderHit(hit, vi.fn());
    expect(li.querySelectorAll(".siblings__item")).toHaveLength(5);
    expect(li.querySelector(".siblings__more")?.textContent).toBe("und 3 weitere Filialen");
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
    const starts = [...kassel.querySelectorAll(".validity")].map((v) => [
      v.className,
      v.querySelector(".validity__chip")?.textContent,
    ]);
    expect(starts).toEqual([
      ["validity validity--now", "SeitDonnerstag(01.10.2026)"],
      ["validity validity--upcoming", "AbDonnerstag(08.10.2026)"],
    ]);

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
