import { describe, expect, it } from "vitest";
import { buildStamp, footerStamp, shiftedFixture } from "../vite.config";

interface Shifted {
  generated_at: string;
  stores: { id: string; leaflets: { valid_from: string; viewer: string }[] }[];
}

describe("dev fixture date shifting", () => {
  it("moves all dates by whole weeks so weekdays stay the same", () => {
    const shifted = JSON.parse(shiftedFixture(new Date("2026-10-21T10:00:00Z"))) as Shifted;
    expect(shifted.generated_at).toBe("2026-10-19T23:46:36+02:00");
    const kassel = shifted.stores.find((s) => s.id === "DE4453");
    expect(kassel?.leaflets.map((l) => l.valid_from)).toEqual(["2026-10-22"]);
  });

  it("does not touch dates inside URLs", () => {
    const shifted = JSON.parse(shiftedFixture(new Date("2026-10-21T10:00:00Z"))) as Shifted;
    const urls = shifted.stores.flatMap((s) => s.leaflets.map((l) => l.viewer));
    expect(urls.every((u) => u.startsWith("https://leaflets.kaufland.com/"))).toBe(true);
  });

  it("leaves the fixture unchanged during its own week", () => {
    const shifted = JSON.parse(shiftedFixture(new Date("2026-10-07T10:00:00Z"))) as Shifted;
    expect(shifted.generated_at).toBe("2026-10-05T23:46:36+02:00");
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
