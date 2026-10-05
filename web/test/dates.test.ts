import { describe, expect, it } from "vitest";
import {
  addDays,
  berlinToday,
  dateRange,
  daysBetween,
  formatDate,
  formatRange,
  formatStamp,
  isoWeek,
  isStale,
  leafletLabel,
  mondayOf,
  relativeValidity,
  weekdayName,
  weekdayShort,
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
  it("formats dates and weekdays", () => {
    expect(formatDate("2026-10-08")).toBe("08.10.2026");
    expect(weekdayName("2026-10-08")).toBe("Donnerstag");
    expect(weekdayName("2027-01-03")).toBe("Sonntag");
  });

  it("formats ranges", () => {
    expect(formatRange("2026-10-08", "2026-10-14")).toBe("08.10.–14.10.2026");
  });

  it("formats the data timestamp in Berlin time", () => {
    expect(formatStamp(new Date("2026-10-06T04:31:12Z"))).toBe("06.10.2026, 06:31 Uhr");
  });
});

describe("calendar weeks", () => {
  it("finds the Monday of a week", () => {
    expect(mondayOf("2026-10-06")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
  });

  it("numbers ISO weeks, including the year boundary", () => {
    expect(isoWeek("2026-10-06")).toBe(41);
    expect(isoWeek("2026-01-01")).toBe(1);
    expect(isoWeek("2026-12-31")).toBe(53);
    expect(isoWeek("2027-01-03")).toBe(53);
    expect(isoWeek("2027-01-04")).toBe(1);
  });
});

describe("relativeValidity", () => {
  it.each([
    ["2026-10-06", "startet in 2 Tagen"],
    ["2026-10-07", "startet morgen"],
    ["2026-10-08", "noch 7 Tage gültig"],
    ["2026-10-13", "noch bis morgen gültig"],
    ["2026-10-14", "letzter Tag heute"],
  ])("on %s", (today, text) => {
    expect(relativeValidity("2026-10-08", "2026-10-14", today)).toBe(text);
  });

  it("abbreviates weekdays without a dot", () => {
    expect(weekdayShort("2026-10-08")).toBe("Do");
    expect(weekdayShort("2026-10-11")).toBe("So");
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
