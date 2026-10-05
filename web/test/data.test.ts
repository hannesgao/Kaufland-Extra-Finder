import { describe, expect, it } from "vitest";
import { DataError, parseExtra, parsePlz } from "../src/data";
import { edgeCases, fixtureJson, KARLSRUHE_CLUSTER, nth } from "./helpers";

type Json = Record<string, unknown>;

function withStore(patch: (store: Json) => void): Json {
  const json = fixtureJson();
  patch(nth(json.stores as Json[]));
  return json;
}

describe("parseExtra", () => {
  it("parses the real fixture", () => {
    const data = parseExtra(fixtureJson());
    expect(data.stores.map((s) => s.id)).toEqual([
      "DE4313",
      "DE4443",
      "DE4453",
      "DE4733",
      "DE5443",
      "DE8530",
    ]);
    expect(data.generatedAt.toISOString()).toBe("2026-10-05T21:46:36.000Z");
    expect(data.storesById.get("DE4453")?.url).toBe(
      "https://filiale.kaufland.de/service/filiale/kassel-wesertor-4453.html",
    );
    expect(data.clusters.get(KARLSRUHE_CLUSTER)).toEqual(["DE4443", "DE5443", "DE8530"]);
  });

  it("parses the PDF check", () => {
    const data = parseExtra(fixtureJson());
    const own = nth(data.storesById.get("DE4443")?.leaflets ?? []);
    const foreign = nth(data.storesById.get("DE8530")?.leaflets ?? []);
    expect([own.pdfStore, own.pdfStoreMatch]).toEqual([
      "KARLSRUHE-OSTSTADT, IM DURLACH CENTER",
      true,
    ]);
    expect(foreign.pdfStoreMatch).toBe(false);
    const unknown = withStore((s) => {
      const leaflet = nth(s.leaflets as Json[]);
      delete leaflet.pdf_store;
      delete leaflet.pdf_store_match;
    });
    const first = nth(nth(parseExtra(unknown).stores).leaflets);
    expect(first.pdfStore).toBeUndefined();
    expect(first.pdfStoreMatch).toBeUndefined();
  });

  it("rejects a non-boolean pdf_store_match", () => {
    const json = withStore((s) => (nth(s.leaflets as Json[]).pdf_store_match = "no"));
    expect(() => parseExtra(json)).toThrow(DataError);
  });

  it("parses special days", () => {
    expect(edgeCases().storesById.get("DE8530")?.specialDays).toEqual([
      { date: "2026-10-09", closed: true },
      { date: "2026-10-10", closed: false, open: "07:00", close: "14:00" },
    ]);
  });

  it("treats url and special_days as optional", () => {
    const store = nth(parseExtra(withStore((s) => delete s.url)).stores);
    expect(store.url).toBeUndefined();
    expect(store.specialDays).toEqual([]);
  });

  it("rejects other schema versions", () => {
    expect(() => parseExtra({ ...fixtureJson(), schema_version: 2 })).toThrow(DataError);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "http://example.com/x.pdf", "not a url"])(
    "rejects unsafe link %s",
    (url) => {
      expect(() =>
        parseExtra(
          withStore((s) => {
            nth(s.leaflets as Json[]).viewer = url;
          }),
        ),
      ).toThrow(DataError);
      expect(() => parseExtra(withStore((s) => (s.url = url)))).toThrow(DataError);
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
    json.stores = [...stores, nth(stores)];
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
