import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listDeals, parseDeals } from "../src/deals";
import { buildStamp, footerStamp, shiftedFixture } from "../vite.config";
import { FIXTURE_PATH } from "./helpers";

interface Shifted {
  generated_at: string;
  stores: { id: string; leaflets: { valid_from: string; viewer: string }[] }[];
}

describe("dev fixture date shifting", () => {
  it("moves all dates by whole weeks so weekdays stay the same", () => {
    const shifted = JSON.parse(
      shiftedFixture(new Date("2026-10-21T10:00:00Z"), FIXTURE_PATH),
    ) as Shifted;
    expect(shifted.generated_at).toBe("2026-10-19T23:46:36+02:00");
    const kassel = shifted.stores.find((s) => s.id === "DE4453");
    expect(kassel?.leaflets.map((l) => l.valid_from)).toEqual(["2026-10-22"]);
  });

  it("does not touch dates inside URLs", () => {
    const shifted = JSON.parse(
      shiftedFixture(new Date("2026-10-21T10:00:00Z"), FIXTURE_PATH),
    ) as Shifted;
    const urls = shifted.stores.flatMap((s) => s.leaflets.map((l) => l.viewer));
    expect(urls.every((u) => u.startsWith("https://leaflets.kaufland.com/"))).toBe(true);
  });

  it("leaves the fixture unchanged during its own week", () => {
    const shifted = JSON.parse(
      shiftedFixture(new Date("2026-10-07T10:00:00Z"), FIXTURE_PATH),
    ) as Shifted;
    expect(shifted.generated_at).toBe("2026-10-05T23:46:36+02:00");
  });
});

describe("dev fixtures", () => {
  // Kaufland's offer week runs Monday to Saturday since 12.10.2026; the dev server should show that.
  const dev = (name: string) =>
    JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures", name), "utf-8")) as {
      stores: { leaflets?: { valid_from: string; valid_to: string }[] }[];
    };

  it("only has Monday-to-Saturday Extra leaflets", () => {
    const leaflets = dev("extra.json").stores.flatMap((s) => s.leaflets ?? []);
    expect(leaflets.length).toBeGreaterThan(0);
    for (const l of leaflets) {
      expect(new Date(l.valid_from).getUTCDay()).toBe(1);
      expect(new Date(l.valid_to).getUTCDay()).toBe(6);
    }
  });

  it("shifts the Monday-to-Saturday week into the current week", () => {
    const shifted = JSON.parse(shiftedFixture(new Date("2026-11-25T10:00:00Z"))) as Shifted;
    const froms = new Set(shifted.stores.flatMap((s) => s.leaflets.map((l) => l.valid_from)));
    expect([...froms]).toEqual(["2026-11-23"]);
  });

  it("has Extra offers that are current after shifting", () => {
    const path = resolve(import.meta.dirname, "../fixtures/deals.json");
    const data = parseDeals(JSON.parse(shiftedFixture(new Date("2026-12-02T10:00:00Z"), path)));
    expect(data.stores).toHaveLength(51);
    const { views, extraStores } = listDeals(data, [49.0019, 8.4287], "2026-12-02", {
      sort: "rabatt",
      section: null,
      commonOnly: true,
      unconfirmed: false,
      nearKm: null,
    });
    expect(extraStores).toBe(51);
    expect(views.length).toBeGreaterThan(20);
  });
});

describe("buildStamp", () => {
  it("formats like the author's other projects, in Berlin time", () => {
    expect(buildStamp(new Date("2026-10-05T20:50:00Z"))).toBe("05.10.2026 22:50");
  });
});

describe("footerStamp", () => {
  const now = new Date("2026-10-06T10:05:00Z");

  it("shows the release date when the deploy job passes one", () => {
    expect(footerStamp("2026-10-06T12:30:15Z", now)).toEqual({
      label: "Released",
      stamp: "06.10.2026 14:30",
      iso: "2026-10-06 12:30",
    });
  });

  it("falls back to the build time for an unreleased version", () => {
    for (const value of [undefined, ""]) {
      expect(footerStamp(value, now)).toEqual({
        label: "Build",
        stamp: "06.10.2026 12:05",
        iso: "2026-10-06 10:05",
      });
    }
  });

  it("rejects a malformed date", () => {
    expect(() => footerStamp("yesterday", now)).toThrow("KEF_RELEASED_AT is not a date");
  });
});
