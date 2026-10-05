/** Search state <-> URL query (`?plz=76137&r=25`). Coordinates are never put into the URL. */

import { RADII, type Radius } from "./search";

export const DEFAULT_RADIUS: Radius = 25;
const PLZ = /^\d{5}$/;

export interface QueryState {
  plz: string | null;
  radius: Radius;
}

export function isPlz(value: string): boolean {
  return PLZ.test(value);
}

export function isRadius(value: number): value is Radius {
  return (RADII as readonly number[]).includes(value);
}

export function parseQuery(search: string): QueryState {
  const params = new URLSearchParams(search);
  const plz = params.get("plz")?.trim() ?? "";
  const radius = Number(params.get("r"));
  return {
    plz: isPlz(plz) ? plz : null,
    radius: isRadius(radius) ? radius : DEFAULT_RADIUS,
  };
}

export function buildQuery(state: QueryState): string {
  const params = new URLSearchParams();
  if (state.plz) params.set("plz", state.plz);
  if (state.radius !== DEFAULT_RADIUS) params.set("r", String(state.radius));
  const query = params.toString();
  return query ? `?${query}` : "";
}
