import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseExtra, type ExtraData, type LatLng } from "../src/data";

export const FIXTURE_PATH = resolve(import.meta.dirname, "../fixtures/extra.json");

export function fixtureJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as Record<string, unknown>;
}

export function fixture(): ExtraData {
  return parseExtra(fixtureJson());
}

/** Fixture is generated on Tuesday 2026-10-06; the next Extra leaflets start Thursday 10-08. */
export const TUESDAY = "2026-10-06";
export const PLZ_KARLSRUHE: LatLng = [49.0019, 8.4287]; // 76137
export const PLZ_KASSEL: LatLng = [51.3195, 9.5163]; // 34125
export const PLZ_HAMBURG: LatLng = [53.5503, 10.0006]; // 20095

/** Element `i` of `items`, failing the test if it does not exist. */
export function nth<T>(items: readonly T[], i = 0): T {
  const item = items[i];
  if (item === undefined) throw new Error(`no element at index ${String(i)}`);
  return item;
}
