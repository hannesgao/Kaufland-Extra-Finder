import { describe, expect, it } from "vitest";
import { shiftedFixture } from "../vite.config";

describe("dev fixture date shifting", () => {
  it("moves all dates by whole weeks so weekdays stay the same", () => {
    const shifted = JSON.parse(shiftedFixture(new Date("2026-10-21T10:00:00Z"))) as {
      generated_at: string;
      stores: {
        id: string;
        leaflets: { valid_from: string }[];
        special_days?: { date: string }[];
      }[];
    };
    expect(shifted.generated_at).toBe("2026-10-20T06:31:12+02:00");
    const kassel = shifted.stores.find((s) => s.id === "DE4453");
    expect(kassel?.leaflets.map((l) => l.valid_from)).toEqual(["2026-10-15", "2026-10-22"]);
    const grunwinkel = shifted.stores.find((s) => s.id === "DE8530");
    expect(grunwinkel?.special_days?.[0]?.date).toBe("2026-10-23");
  });

  it("leaves the fixture unchanged during its own week", () => {
    const shifted = JSON.parse(shiftedFixture(new Date("2026-10-07T10:00:00Z"))) as {
      generated_at: string;
    };
    expect(shifted.generated_at).toBe("2026-10-06T06:31:12+02:00");
  });
});
