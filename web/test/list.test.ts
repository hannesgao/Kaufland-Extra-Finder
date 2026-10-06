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
    expect(li.querySelector(".lp-head__title")?.textContent).toBe("Aktuellster Extra-Prospekt");
    expect(li.querySelector(".lp-head__range")?.textContent).toBe(
      "Gültig von Do,\u00a008.10. bis Mi,\u00a014.10.2026",
    );
    expect(li.querySelector(".lp-head__relative")?.textContent).toBe("startet in 3 Tagen");
    // Calendar from today (Monday 05.10.): this week and next week, leaflet days filled.
    const rows = [...li.querySelectorAll(".cal__row:not(.cal__row--head)")].map((row) =>
      [...row.children].map((c) =>
        c.classList.contains("cal__kw")
          ? c.textContent
          : `${c.querySelector(".cal__date")?.textContent ?? "·"}${c.classList.contains("is-valid") ? "*" : ""}`,
      ),
    );
    expect(rows).toEqual([
      ["KW 41", "05", "06", "07", "08*", "09*", "10*", "11*"],
      ["KW 42", "12*", "13*", "14*", "15", "16", "17", "18"],
    ]);
    expect(li.querySelector(".cal__day.is-today .cal__date")?.textContent).toBe("05");
    expect(li.querySelector(".siblings__title")?.textContent).toBe(
      "Dieser Extra-Prospekt ist auf kaufland.de auch bei diesen Filialen gelistet",
    );
    const siblings = [...li.querySelectorAll(".siblings__item")].map((item) => [
      item.querySelector(".siblings__name")?.textContent,
      item.querySelector(".siblings__place")?.textContent,
      item.querySelector(".siblings__pdf-label")?.textContent,
    ]);
    expect(siblings).toEqual([
      ["Karlsruhe-Beiertheim-Bulac", "76135 Karlsruhe", "Filiale fehlt im PDF"],
      ["Karlsruhe-Grünwinkel", "76185 Karlsruhe", "Filiale fehlt im PDF"],
    ]);
    expect(li.querySelector(".siblings__more")).toBeNull();
  });

  it("warns prominently when the PDF names a different store", () => {
    const hits = hitsFor(fixture(), PLZ_KARLSRUHE);
    const grunwinkel = renderHit(nth(hits.filter((h) => h.store.id === "DE8530")), vi.fn());
    expect(grunwinkel.classList.contains("store--foreign")).toBe(true);
    // One notice only: the warning in the leaflet panel (no extra label on the card).
    expect(grunwinkel.querySelector(".chip--foreign")).toBeNull();
    expect(grunwinkel.querySelectorAll(".pdf-warning")).toHaveLength(1);
    const warning = grunwinkel.querySelector(".pdf-warning");
    expect(warning?.getAttribute("role")).toBe("note");
    expect(warning?.textContent).toBe(
      "Achtung: Laut PDF gilt dieser Extra-Prospekt nicht für diese Filiale." +
        "Im PDF steht: „NUR IN KARLSRUHE-OSTSTADT, IM DURLACH CENTER“",
    );
    // The leaflet panel starts with the warning, before the dates.
    expect(grunwinkel.querySelector(".leaflet")?.firstElementChild?.className).toBe(
      "pdf-warning pdf-warning--warning",
    );

    const oststadt = renderHit(nth(hits.filter((h) => h.store.id === "DE4443")), vi.fn());
    expect(oststadt.querySelector(".pdf-warning")).toBeNull();
    expect(oststadt.classList.contains("store--foreign")).toBe(false);
  });

  it("flags leaflets whose PDF has not been checked yet", () => {
    const data = fixture();
    const stores = data.stores.map((s) =>
      s.id === "DE8530"
        ? {
            ...s,
            leaflets: s.leaflets.map((l) => {
              const copy = { ...l };
              delete copy.pdfStore;
              delete copy.pdfStoreMatch;
              return copy;
            }),
          }
        : s,
    );
    const patched = { ...data, stores, storesById: new Map(stores.map((s) => [s.id, s])) };
    const hits = hitsFor(patched, PLZ_KARLSRUHE);
    const pending = renderHit(nth(hits.filter((h) => h.store.id === "DE8530")), vi.fn());
    const notice = pending.querySelector(".pdf-warning");
    expect(notice?.className).toBe("pdf-warning pdf-warning--pending");
    expect(notice?.querySelector(".pdf-warning__title")?.textContent).toBe(
      "PDF-Prüfung ausstehend",
    );
    expect(pending.querySelector(".leaflet")?.firstElementChild).toBe(notice);
    expect(pending.classList.contains("store--foreign")).toBe(false);
    // Checked stores show no pending notice.
    const oststadt = renderHit(nth(hits.filter((h) => h.store.id === "DE4443")), vi.fn());
    expect(oststadt.querySelector(".pdf-warning")).toBeNull();
  });

  it("marks the sibling the PDF names", () => {
    const hits = hitsFor(fixture(), PLZ_KARLSRUHE);
    const li = renderHit(nth(hits.filter((h) => h.store.id === "DE8530")), vi.fn());
    const first = li.querySelector(".siblings__item");
    expect(first?.querySelector(".siblings__name")?.textContent).toBe("Karlsruhe-Oststadt");
    expect(first?.querySelector(".siblings__pdf.is-named .siblings__pdf-label")?.textContent).toBe(
      "Filiale steht im PDF",
    );
  });

  it("sizes every PDF label by the longest label text, hidden from screen readers", () => {
    const hits = hitsFor(fixture(), PLZ_KARLSRUHE);
    const li = renderHit(nth(hits.filter((h) => h.store.id === "DE8530")), vi.fn());
    const label = li.querySelector(".siblings__pdf.is-named");
    const sizers = [...(label?.querySelectorAll(".siblings__pdf-sizer") ?? [])];
    expect(sizers.map((s) => s.textContent)).toEqual(["Filiale fehlt im PDF", "PDF nicht geprüft"]);
    expect(sizers.every((s) => s.getAttribute("aria-hidden") === "true")).toBe(true);
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
    const titles = [...kassel.querySelectorAll(".lp-head__title")].map((t) => t.textContent);
    expect(titles).toEqual(["Laufender Extra-Prospekt", "Aktuellster Extra-Prospekt"]);
    const relative = [...kassel.querySelectorAll(".lp-head__relative")].map((t) => t.textContent);
    expect(relative).toEqual(["noch 3 Tage gültig", "startet in 3 Tagen"]);
    // One calendar for both leaflets: running days green, upcoming days blue.
    expect(kassel.querySelectorAll(".cal")).toHaveLength(1);
    expect(kassel.querySelectorAll(".cal__row:not(.cal__row--head)")).toHaveLength(2);
    const tone = (t: string) =>
      [...kassel.querySelectorAll(`.cal__day.tone-${t} .cal__date`)].map((d) => d.textContent);
    expect(tone("now")).toEqual(["05", "06", "07"]);
    expect(tone("upcoming")).toEqual(["08", "09", "10", "11", "12", "13", "14"]);
    expect(kassel.querySelector(".is-today .cal__note")?.textContent).toBe("heute");
    // Leaflet titles carry the same colours as their days.
    const heads = [...kassel.querySelectorAll(".lp-head")].map((h) => h.className);
    expect(heads).toEqual(["lp-head tone-now", "lp-head tone-upcoming"]);

    const grunwinkel = hitsFor(data, PLZ_KARLSRUHE).find((h) => h.store.id === "DE8530");
    const card = renderHit(nth(grunwinkel ? [grunwinkel] : []), vi.fn());
    const closed = card.querySelector(".cal__day.is-closed");
    expect(closed?.textContent).toBe("09zu");
    const special = card.querySelector(".cal__day.is-special");
    expect(special?.querySelector(".cal__note")?.textContent).toBe("7–14");
    expect(card.querySelector(".cal__day.is-sunday .cal__date")?.textContent).toBe("11");
    // The calendar is visual only; screen readers get the same facts as text.
    expect(card.querySelector(".cal")?.getAttribute("aria-hidden")).toBe("true");
    expect(card.querySelector(".cal-card > .visually-hidden")?.textContent).toBe(
      "Geschlossen am 09.10. Sonderöffnungszeiten: 10.10. 7–14 Uhr.",
    );
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
