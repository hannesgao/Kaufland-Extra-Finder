// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { parseExtra } from "../src/data";
import { exportHtml } from "../src/export/html";
import { pdfSource } from "../src/export/pdf";
import { exportTable } from "../src/export/table";
import { describeDormant, latestPeriod, listAll, listDormant, search } from "../src/search";
import {
  dormantIntro,
  dormantTitle,
  listSummary,
  noLeafletStatus,
  pastCount,
} from "../src/summary";
import { renderDormant } from "../src/ui/list";
import { MONDAY, nth, PLZ_KASSEL, withHistory, withHistoryJson } from "./helpers";

// Extra stores stay listed when they have no current leaflet (Kaufland skips some weeks).

const ids = (views: readonly { store: { id: string } }[]) => views.map((v) => v.store.id);

describe("Extra history in extra.json", () => {
  it("reads past leaflets, newest first, and the start of the history", () => {
    const data = withHistory();
    expect(data.historySince).toBe("2026-09-10");
    const grone = nth(data.stores.filter((s) => s.id === "DE4313"));
    expect(grone.leaflets).toEqual([]);
    expect(grone.past.map((p) => p.validFrom)).toEqual(["2026-09-24", "2026-09-10"]);
    expect(nth(grone.past).pdfStore).toBe("GÖ-GRONE, IM KAUF PARK");
  });

  it("accepts data without history", () => {
    const json = withHistoryJson();
    delete json.history_since;
    expect(parseExtra(json).historySince).toBeNull();
  });

  it("rejects broken past leaflets", () => {
    const json = withHistoryJson();
    const store = (json.stores as Record<string, unknown>[])[0];
    if (!store) throw new Error("fixture changed");
    store.past = [{ valid_from: "2026-09-30", valid_to: "2026-09-24" }];
    expect(() => parseExtra(json)).toThrow("valid_to < valid_from");
  });
});

describe("Extra stores without a current leaflet", () => {
  const data = withHistory();

  it("lists them apart from the current ones, sorted by PLZ", () => {
    expect(ids(listDormant(data, MONDAY, "plz-asc"))).toEqual(["DE4313", "DE5443"]);
    expect(ids(listDormant(data, MONDAY, "plz-desc"))).toEqual(["DE5443", "DE4313"]);
    expect(ids(listAll(data, MONDAY, "plz-asc"))).not.toContain("DE4313");
  });

  it("describes the last leaflet and counts the past ones", () => {
    const view = nth(listDormant(data, MONDAY, "plz-asc"));
    expect(view.lastText).toBe("Do, 24.09. – Mi, 30.09.2026");
    expect(view.count).toBe(2);
  });

  it("follows the PDF switch: leaflets naming another store do not count", () => {
    expect(ids(listDormant(data, MONDAY, "plz-asc", { pdfOnly: true }))).toEqual(["DE4313"]);
  });

  it("does not list a store with a current leaflet", () => {
    const kassel = nth(data.stores.filter((s) => s.id === "DE4453"));
    expect(describeDormant(kassel, MONDAY)).toBeNull();
    // After its last day, its listed leaflet counts as past (until the next scan moves it).
    expect(describeDormant(kassel, "2026-10-15")?.lastText).toBe("Do, 08.10. – Mi, 14.10.2026");
  });

  it("finds the newest past week", () => {
    const latest = latestPeriod(listDormant(data, MONDAY, "plz-asc"));
    expect(latest?.text).toBe("Do, 24.09. – Mi, 30.09.2026");
    expect(latest?.stores).toBe(2);
    expect(latestPeriod([])).toBeNull();
  });

  it("are part of the radius search, nearest first", () => {
    const result = search(data, PLZ_KASSEL, 50, MONDAY);
    expect(ids(result.hits)).toEqual(["DE4453"]);
    expect(ids(result.dormant)).toEqual(["DE4313"]);
    expect(nth(result.dormant).distanceKm).toBeGreaterThan(30);
  });
});

describe("texts", () => {
  it("adds them to the list summary", () => {
    const counts = { shown: 4, hidden: 0, unchecked: 0 };
    expect(listSummary(counts, false, 2)).toBe(
      "4 Filialen mit Extra-Prospekt, 2 weitere derzeit ohne",
    );
    expect(listSummary(counts, false)).toBe("4 Filialen mit Extra-Prospekt");
  });

  it("says when there is no Extra leaflet at all", () => {
    expect(noLeafletStatus({ text: "Mo, 02.11. – Sa, 07.11.2026", stores: 45 })).toBe(
      "Derzeit gibt es keinen Extra-Prospekt. Zuletzt: Mo, 02.11. – Sa, 07.11.2026 (45 Filialen).",
    );
    expect(noLeafletStatus(null)).toBe("Derzeit gibt es keinen Extra-Prospekt.");
  });

  it("titles and explains the section", () => {
    expect(dormantTitle(57, false)).toBe("Derzeit ohne Extra-Prospekt (57)");
    expect(dormantTitle(2, true)).toBe("Im Umkreis derzeit ohne Extra-Prospekt (2)");
    expect(dormantIntro("06.10.2026", true)).toBe(
      "Diese Filialen hatten seit dem 06.10.2026 mindestens einen Extra-Prospekt, der laut PDF " +
        "für sie galt. Kaufland bietet Extra-Prospekte nicht jede Woche an.",
    );
    expect(pastCount(1, "06.10.2026")).toBe("1 Extra-Prospekt seit 06.10.2026");
    expect(pastCount(3, null)).toBe("3 Extra-Prospekte");
  });
});

describe("renderDormant", () => {
  const view = nth(listDormant(withHistory(), MONDAY, "plz-asc"));

  it("shows the last leaflet, the count and whether the PDF named the store", () => {
    const onClick = vi.fn();
    const li = renderDormant(view, {
      since: "10.09.2026",
      action: { label: "In Umkreissuche zeigen", icon: "near_me", onClick },
    });
    expect(li.classList.contains("store--dormant")).toBe(true);
    expect(li.querySelector(".store__title")?.textContent).toBe("Göttingen-Grone");
    expect(li.querySelector(".store__plz")?.textContent).toBe("37079");
    expect(li.querySelector(".dormant__last")?.textContent).toBe(
      "Zuletzt: Do, 24.09. – Mi, 30.09.2026",
    );
    expect(li.querySelector("time")?.getAttribute("datetime")).toBe("2026-09-24/2026-09-30");
    expect(li.querySelector(".dormant__count")?.textContent).toBe(
      "2 Extra-Prospekte seit 10.09.2026",
    );
    expect(li.querySelector(".siblings__pdf-label")?.textContent).toBe("Filiale steht im PDF");
    expect(li.querySelector(".cal-card, .leaflets")).toBeNull();
    const buttons = [...li.querySelectorAll("button")];
    nth(buttons, buttons.length - 1).click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("shows the distance in the radius search", () => {
    const li = renderDormant(view, {
      distanceKm: 3.2,
      since: null,
      action: { label: "x", icon: "map", onClick: vi.fn() },
    });
    expect(li.querySelector(".chip--distance")?.textContent).toBe("3,2 km");
    expect(li.querySelector(".store__plz")).toBeNull();
  });
});

describe("export with stores without a current leaflet", () => {
  const data = withHistory();
  const options = {
    generatedAt: new Date("2026-10-05T04:31:00Z"),
    today: MONDAY,
    sort: "plz-asc" as const,
  };

  function table(pdfOnly: boolean) {
    return exportTable(
      listAll(data, MONDAY, "plz-asc", { pdfOnly }),
      listDormant(data, MONDAY, "plz-asc", { pdfOnly }),
      { ...options, pdfOnly },
    );
  }

  it("adds them after the current stores, with their last leaflet", () => {
    const t = table(false);
    expect(t.dormant).toEqual({ start: 4, title: "Derzeit ohne Extra-Prospekt (2)" });
    expect(t.rows.slice(4)).toEqual([
      ["37079", "Göttingen-Grone", "Am Kauf Park 2", "zuletzt 24.09.–30.09.", "ja"],
      ["76135", "Karlsruhe-Beiertheim-Bulac", "Ortenbergstraße 8", "zuletzt 24.09.–30.09.", "nein"],
    ]);
    expect(t.subtitle).toContain("4 Filialen, 2 weitere derzeit ohne");
    expect(table(true).dormant?.title).toBe("Derzeit ohne Extra-Prospekt (1)");
  });

  it("has no section without them", () => {
    expect(
      exportTable(listAll(data, MONDAY, "plz-asc"), [], { ...options, pdfOnly: false }).dormant,
    ).toBeUndefined();
  });

  it("marks the section in HTML and PDF", async () => {
    const html = await exportHtml(table(false)).text();
    expect(html).toContain(
      '<tr class="section"><th colspan="5">Derzeit ohne Extra-Prospekt (2)</th></tr>',
    );
    expect(html.match(/<tr class="dormant">/g)).toHaveLength(2);
    expect(pdfSource(table(false))).toContain("(Derzeit ohne Extra-Prospekt \\(2\\)) Tj");
  });
});
