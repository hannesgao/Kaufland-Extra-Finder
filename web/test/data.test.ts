import { describe, expect, it } from "vitest";
import { DataError, parseExtra, parsePlz } from "../src/data";
import { fixtureJson, nth } from "./helpers";

type Json = Record<string, unknown>;

function withStore(patch: (store: Json) => void): Json {
  const json = fixtureJson();
  const stores = json.stores as Json[];
  patch(nth(stores));
  return json;
}

describe("parseExtra", () => {
  it("parses the fixture", () => {
    const data = parseExtra(fixtureJson());
    expect(data.stores).toHaveLength(6);
    expect(data.storeCount).toBe(788);
    expect(data.generatedAt.toISOString()).toBe("2026-10-06T04:31:12.000Z");
    const grunwinkel = data.storesById.get("DE8530");
    expect(grunwinkel?.specialDays).toEqual([
      { date: "2026-10-09", closed: true },
      { date: "2026-10-10", closed: false, open: "07:00", close: "14:00" },
    ]);
    expect(data.storesById.get("DE4443")?.specialDays).toEqual([]);
    expect(data.clusters.get("00000000-0000-4000-8000-00000000000a")).toEqual([
      "DE4233",
      "DE4443",
      "DE5443",
    ]);
  });

  it("rejects other schema versions", () => {
    expect(() => parseExtra({ ...fixtureJson(), schema_version: 2 })).toThrow(DataError);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "http://example.com/x.pdf", "not a url"])(
    "rejects unsafe leaflet link %s",
    (url) => {
      const json = withStore((s) => {
        nth(s.leaflets as Json[]).viewer = url;
      });
      expect(() => parseExtra(json)).toThrow(DataError);
    },
  );

  it.each([
    ["invalid PLZ", (s: Json) => (s.plz = "7613")],
    ["missing name", (s: Json) => delete s.name],
    ["string coordinates", (s: Json) => (s.lat = "49.0")],
    ["bad date", (s: Json) => (nth(s.leaflets as Json[]).valid_to = "14.10.2026")],
    ["reversed dates", (s: Json) => (nth(s.leaflets as Json[]).valid_to = "2026-01-01")],
    [
      "bad opening hours",
      (s: Json) => (s.special_days = [{ date: "2026-10-09", open: "7", close: "14:00" }]),
    ],
  ])("rejects %s", (_name, patch) => {
    expect(() => parseExtra(withStore(patch))).toThrow(DataError);
  });

  it("rejects duplicate store ids", () => {
    const json = fixtureJson();
    const stores = json.stores as Json[];
    json.stores = [...stores, stores[0]];
    expect(() => parseExtra(json)).toThrow(/duplicate/);
  });
});

describe("parsePlz", () => {
  it("parses entries", () => {
    const index = parsePlz({ "76137": [49.0019, 8.4287], "01814": [50.9237, 14.1486] });
    expect(index.get("01814")).toEqual([50.9237, 14.1486]);
    expect(index.size).toBe(2);
  });

  it.each([{ "7613": [1, 2] }, { "76137": [1] }, { "76137": ["49", "8"] }, []])(
    "rejects %j",
    (raw) => {
      expect(() => parsePlz(raw)).toThrow(DataError);
    },
  );
});
