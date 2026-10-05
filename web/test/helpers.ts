import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseExtra, type ExtraData, type LatLng } from "../src/data";

export const FIXTURE_PATH = resolve(import.meta.dirname, "../fixtures/extra.json");

type Json = Record<string, unknown>;

/** Real scraper output for 6 stores, generated Monday 2026-10-05; leaflets valid 08.–14.10. */
export function fixtureJson(): Json {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Json;
}

export function fixture(): ExtraData {
  return parseExtra(fixtureJson());
}

export const KARLSRUHE_CLUSTER = "01a0e6b0-a6e8-71d1-a747-5a1d3b7f8fa8";
export const CURRENT_CLUSTER = "01a0e6b0-0000-7000-8000-000000000001";

/**
 * The fixture plus edge cases that real data does not always contain:
 * - Kassel-Wesertor (and Göttingen-Grone) also have the current week's leaflet (01.–07.10.),
 * - Karlsruhe-Grünwinkel is closed on 09.10. and has shortened hours on 10.10.
 */
export function edgeCaseJson(): Json {
  const json = fixtureJson();
  const stores = json.stores as Json[];
  const byId = (id: string) => nth(stores.filter((s) => s.id === id));
  for (const id of ["DE4453", "DE4313"]) {
    const store = byId(id);
    const leaflets = store.leaflets as Json[];
    store.leaflets = [
      {
        ...nth(leaflets),
        valid_from: "2026-10-01",
        valid_to: "2026-10-07",
        cluster: CURRENT_CLUSTER,
      },
      ...leaflets,
    ];
  }
  byId("DE8530").special_days = [
    { date: "2026-10-09", closed: true },
    { date: "2026-10-10", open: "07:00", close: "14:00" },
  ];
  (json.clusters as Json)[CURRENT_CLUSTER] = ["DE4313", "DE4453"];
  return json;
}

export function edgeCases(): ExtraData {
  return parseExtra(edgeCaseJson());
}

export const MONDAY = "2026-10-05";
export const PLZ_KARLSRUHE: LatLng = [49.0019, 8.4287]; // 76137
export const PLZ_KASSEL: LatLng = [51.3195, 9.5163]; // 34125
export const PLZ_HAMBURG: LatLng = [53.5503, 10.0006]; // 20095

/** Element `i` of `items`, failing the test if it does not exist. */
export function nth<T>(items: readonly T[], i = 0): T {
  const item = items[i];
  if (item === undefined) throw new Error(`no element at index ${String(i)}`);
  return item;
}
