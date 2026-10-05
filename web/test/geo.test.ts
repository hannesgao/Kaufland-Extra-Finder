import { describe, expect, it } from "vitest";
import { distanceKm, formatKm } from "../src/geo";
import { PLZ_KARLSRUHE, PLZ_KASSEL } from "./helpers";

describe("distanceKm", () => {
  it("is zero for the same point", () => {
    expect(distanceKm(PLZ_KARLSRUHE, PLZ_KARLSRUHE)).toBe(0);
  });

  it("matches the known Karlsruhe–Kassel distance", () => {
    expect(distanceKm(PLZ_KARLSRUHE, PLZ_KASSEL)).toBeCloseTo(269.1, 0);
  });

  it("is symmetric", () => {
    expect(distanceKm(PLZ_KASSEL, PLZ_KARLSRUHE)).toBeCloseTo(
      distanceKm(PLZ_KARLSRUHE, PLZ_KASSEL),
    );
  });
});

describe("formatKm", () => {
  it("uses German decimals", () => {
    expect(formatKm(3.24)).toBe("3,2 km");
    expect(formatKm(12)).toBe("12 km");
    expect(formatKm(0.04)).toBe("< 0,1 km");
  });
});
