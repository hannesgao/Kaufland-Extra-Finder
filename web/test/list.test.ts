// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { ExtraData, LatLng, Store } from "../src/data";
import { search } from "../src/search";
import { renderHit } from "../src/ui/list";
import { fixture, PLZ_KARLSRUHE, PLZ_KASSEL, TUESDAY } from "./helpers";

const PAYLOAD = '<img src=x onerror="alert(1)">';

function hitsFor(data: ExtraData, origin: LatLng) {
  return search(data, origin, 10, TUESDAY).hits;
}

describe("renderHit", () => {
  it("renders store, distance, address, label, links and siblings", () => {
    const [hit] = hitsFor(fixture(), PLZ_KARLSRUHE);
    if (!hit) throw new Error("no hit");
    const li = renderHit(hit, vi.fn());
    expect(li.dataset.id).toBe("DE4443");
    expect(li.querySelector("h3")?.textContent).toBe("Karlsruhe-Oststadt1,5 km");
    expect(li.querySelector(".store__address")?.textContent).toBe(
      "Durlacher Allee 111, 76137 Karlsruhe",
    );
    expect(li.querySelector(".badge")?.textContent).toBe("Ab Donnerstag");
    expect(li.querySelector(".siblings")?.textContent).toBe(
      "Gleicher Prospekt auch in: Ettlingen (76275), Karlsruhe-Beiertheim-Bulach (76135)",
    );
    const links = [...li.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(["Prospekt ansehen", "PDF"]);
    for (const a of links) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("href")).toMatch(/^https:\/\//);
    }
  });

  it("selects the store when its name is clicked", () => {
    const [hit] = hitsFor(fixture(), PLZ_KARLSRUHE);
    if (!hit) throw new Error("no hit");
    const onSelect = vi.fn();
    renderHit(hit, onSelect).querySelector("button")?.click();
    expect(onSelect).toHaveBeenCalledWith("DE4443");
  });

  it("shows both validity periods and closure notices", () => {
    const data = fixture();
    const kassel = hitsFor(data, PLZ_KASSEL)[0];
    if (!kassel) throw new Error("no hit");
    const badges = [...renderHit(kassel, vi.fn()).querySelectorAll(".leaflet .badge")];
    expect(badges.map((b) => b.textContent)).toEqual(["Diese Woche", "Ab Donnerstag"]);

    const grunwinkel = hitsFor(data, PLZ_KARLSRUHE).find((h) => h.store.id === "DE8530");
    if (!grunwinkel) throw new Error("no hit");
    const text = renderHit(grunwinkel, vi.fn()).textContent;
    expect(text).toContain("Geschlossen am 09.10.");
    expect(text).toContain("Sonderöffnungszeiten: 10.10. 07:00–14:00 Uhr");
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
