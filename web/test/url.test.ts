import { describe, expect, it } from "vitest";
import { buildQuery, DEFAULT_PLZ, isPlz, parseQuery, type QueryState } from "../src/url";

const DEFAULTS: QueryState = { plz: null, radius: 25, tab: "search", sort: "plz-asc" };

describe("parseQuery", () => {
  it("reads PLZ, radius, tab and sort order", () => {
    expect(parseQuery("?plz=76137&r=50&tab=all&sort=plz-desc")).toEqual({
      plz: "76137",
      radius: 50,
      tab: "all",
      sort: "plz-desc",
    });
  });

  it("falls back to defaults for invalid values", () => {
    expect(parseQuery("?plz=7613&r=30&tab=x&sort=name")).toEqual(DEFAULTS);
    expect(parseQuery("?plz=<script>&r=abc")).toEqual(DEFAULTS);
    expect(parseQuery("")).toEqual(DEFAULTS);
  });
});

describe("buildQuery", () => {
  it("omits defaults", () => {
    expect(buildQuery({ ...DEFAULTS, plz: "76137" })).toBe("?plz=76137");
    expect(buildQuery(DEFAULTS)).toBe("");
    expect(buildQuery({ ...DEFAULTS, tab: "all", sort: "plz-desc" })).toBe(
      "?tab=all&sort=plz-desc",
    );
  });

  it("omits the default PLZ (searched on page load anyway)", () => {
    expect(buildQuery({ ...DEFAULTS, plz: DEFAULT_PLZ, radius: 50 })).toBe("?r=50");
  });

  it("round-trips", () => {
    const state: QueryState = { plz: "01814", radius: 100, tab: "all", sort: "plz-desc" };
    expect(parseQuery(buildQuery(state))).toEqual(state);
  });
});

describe("isPlz", () => {
  it("accepts exactly five digits", () => {
    expect(isPlz("01814")).toBe(true);
    expect(isPlz("1814")).toBe(false);
    expect(isPlz("018145")).toBe(false);
    expect(isPlz("0181a")).toBe(false);
  });
});
