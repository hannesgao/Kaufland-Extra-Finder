import { describe, expect, it } from "vitest";
import { buildQuery, isPlz, parseQuery } from "../src/url";

describe("parseQuery", () => {
  it("reads PLZ and radius", () => {
    expect(parseQuery("?plz=76137&r=50")).toEqual({ plz: "76137", radius: 50 });
  });

  it("falls back to defaults for invalid values", () => {
    expect(parseQuery("?plz=7613&r=30")).toEqual({ plz: null, radius: 25 });
    expect(parseQuery("?plz=<script>&r=abc")).toEqual({ plz: null, radius: 25 });
    expect(parseQuery("")).toEqual({ plz: null, radius: 25 });
  });
});

describe("buildQuery", () => {
  it("omits defaults", () => {
    expect(buildQuery({ plz: "76137", radius: 25 })).toBe("?plz=76137");
    expect(buildQuery({ plz: null, radius: 25 })).toBe("");
  });

  it("round-trips", () => {
    const state = { plz: "01814", radius: 100 } as const;
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
