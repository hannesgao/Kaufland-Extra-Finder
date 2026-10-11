import { describe, expect, it } from "vitest";
import { describeStore } from "../src/search";
import { monSat, nth } from "./helpers";

// Kaufland's offer week runs Monday to Saturday since 12.10.2026 (before: Thursday to Wednesday).

function kassel(keepOld: boolean, today: string) {
  const data = monSat(keepOld);
  const store = nth(data.stores.filter((s) => s.id === "DE4453"));
  return describeStore(store, today, data);
}

const tones = (days: ({ tone: string | null } | null)[]) => days.map((d) => (d ? d.tone : "-"));

describe("Monday-to-Saturday leaflets", () => {
  it("shows next week's leaflet on Sunday, when no leaflet is valid", () => {
    const view = kassel(false, "2026-10-11");
    const leaflet = nth(view?.leaflets ?? []);
    expect(leaflet.label).toBe("Ab Montag");
    expect(leaflet.heading).toBe("Aktuellster Extra-Prospekt");
    expect(leaflet.running).toBe(false);
    expect(leaflet.relative).toBe("startet morgen");
    expect(leaflet.rangeText).toBe("Gültig von Mo, 12.10. bis Sa, 17.10.2026");
    // Today's week (only Sunday is left), then the leaflet's week; Sunday is never filled.
    expect(view?.weeks.map((w) => w.kw)).toEqual([41, 42]);
    expect(tones(nth(view?.weeks ?? []).days)).toEqual(["-", "-", "-", "-", "-", "-", null]);
    expect(tones(nth(view?.weeks ?? [], 1).days)).toEqual([
      ...Array<string>(6).fill("upcoming"),
      null,
    ]);
  });

  it("shows both leaflets while the old Thursday-to-Wednesday one is still valid", () => {
    const view = kassel(true, "2026-10-13");
    expect(view?.leaflets.map((l) => [l.leaflet.validFrom, l.heading, l.label])).toEqual([
      ["2026-10-08", "Laufender Extra-Prospekt", "Diese Woche"],
      ["2026-10-12", "Aktuellster Extra-Prospekt", "Diese Woche"],
    ]);
    expect(view?.weeks).toHaveLength(1);
    expect(tones(nth(view?.weeks ?? []).days)).toEqual([
      "-",
      "now",
      "now",
      "now",
      "now",
      "now",
      null,
    ]);
  });

  it("drops the old leaflet after Wednesday", () => {
    const view = kassel(true, "2026-10-15");
    expect(view?.leaflets.map((l) => l.leaflet.validFrom)).toEqual(["2026-10-12"]);
  });

  it("ends on Saturday", () => {
    expect(nth(kassel(false, "2026-10-17")?.leaflets ?? []).relative).toBe("letzter Tag heute");
    expect(kassel(false, "2026-10-18")).toBeNull();
  });
});
