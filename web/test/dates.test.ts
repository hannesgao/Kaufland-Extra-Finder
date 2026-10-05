import { describe, expect, it } from "vitest";
import {
  addDays,
  berlinToday,
  dateRange,
  daysBetween,
  formatLongDate,
  formatRange,
  formatStamp,
  isStale,
  leafletLabel,
} from "../src/dates";

describe("berlinToday", () => {
  it("uses the Berlin date, not UTC (summer time)", () => {
    expect(berlinToday(new Date("2026-10-07T21:59:00Z"))).toBe("2026-10-07");
    expect(berlinToday(new Date("2026-10-07T22:30:00Z"))).toBe("2026-10-08");
  });

  it("handles winter time and the year boundary", () => {
    expect(berlinToday(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  });
});

describe("date arithmetic", () => {
  it("adds days across month and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
    expect(daysBetween("2026-10-06", "2026-10-08")).toBe(2);
  });

  it("builds inclusive ranges", () => {
    expect(dateRange("2026-10-08", "2026-10-10")).toEqual([
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
    ]);
    expect(dateRange("2026-10-08", "2026-10-08")).toEqual(["2026-10-08"]);
  });
});

describe("leafletLabel", () => {
  it("labels running leaflets", () => {
    expect(leafletLabel("2026-10-01", "2026-10-06")).toBe("Diese Woche");
    expect(leafletLabel("2026-10-08", "2026-10-08")).toBe("Diese Woche");
  });

  it("names the weekday for leaflets starting within a week", () => {
    expect(leafletLabel("2026-10-08", "2026-10-05")).toBe("Ab Donnerstag");
    expect(leafletLabel("2026-10-08", "2026-10-07")).toBe("Ab Donnerstag");
  });

  it("uses the date for later leaflets", () => {
    expect(leafletLabel("2026-10-15", "2026-10-06")).toBe("Ab 15.10.");
  });
});

describe("formatting", () => {
  it("formats long dates with weekday", () => {
    expect(formatLongDate("2026-10-08")).toBe("Donnerstag, 08.10.2026");
    expect(formatLongDate("2027-01-03")).toBe("Sonntag, 03.01.2027");
  });

  it("formats ranges", () => {
    expect(formatRange("2026-10-08", "2026-10-14")).toBe("08.10.–14.10.2026");
  });

  it("formats the data timestamp in Berlin time", () => {
    expect(formatStamp(new Date("2026-10-06T04:31:12Z"))).toBe("06.10.2026, 06:31 Uhr");
  });
});

describe("isStale", () => {
  const generated = new Date("2026-10-06T06:31:00+02:00");
  it("is fresh within four days", () => {
    expect(isStale(generated, new Date("2026-10-10T06:00:00+02:00"))).toBe(false);
  });
  it("is stale afterwards", () => {
    expect(isStale(generated, new Date("2026-10-10T07:00:00+02:00"))).toBe(true);
  });
});
