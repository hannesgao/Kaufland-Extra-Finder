import { describe, expect, it } from "vitest";
import { buildStamp, shiftedFixture } from "../vite.config";

interface Shifted {
  generated_at: string;
  stores: { id: string; leaflets: { valid_from: string; viewer: string }[] }[];
}

describe("dev fixture date shifting", () => {
  it("moves all dates by whole weeks so weekdays stay the same", () => {
    const shifted = JSON.parse(shiftedFixture(new Date("2026-10-21T10:00:00Z"))) as Shifted;
    expect(shifted.generated_at).toBe("2026-10-19T22:47:58+02:00");
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
    expect(shifted.generated_at).toBe("2026-10-05T22:47:58+02:00");
  });
});

describe("buildStamp", () => {
  it("formats like the author's other projects, in Berlin time", () => {
    expect(buildStamp(new Date("2026-10-05T20:50:00Z"))).toBe("05.10.2026 22:50");
  });
});
