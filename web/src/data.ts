/** Loading and runtime validation of extra.json (schema v1) and plz.json. */

export type IsoDate = string; // YYYY-MM-DD

export type SpecialDay =
  { date: IsoDate; closed: true } | { date: IsoDate; closed: false; open: string; close: string };

export interface Leaflet {
  validFrom: IsoDate;
  validTo: IsoDate;
  cluster: string;
  viewer: string;
  pdf: string;
  /** The PDF's own "NUR IN …" block, if the scraper could read it. */
  pdfStore?: string;
  /** Whether that block names this store; undefined when unknown. */
  pdfStoreMatch?: boolean;
}

export interface Store {
  id: string;
  name: string;
  plz: string;
  city: string;
  street: string;
  lat: number;
  lng: number;
  /** Store page on filiale.kaufland.de (optional in the data). */
  url?: string;
  leaflets: Leaflet[];
  specialDays: SpecialDay[];
}

export interface ExtraData {
  generatedAt: Date;
  storeCount: number;
  stores: Store[];
  storesById: ReadonlyMap<string, Store>;
  clusters: ReadonlyMap<string, readonly string[]>;
}

export type LatLng = readonly [lat: number, lng: number];
export type PlzIndex = ReadonlyMap<string, LatLng>;

export class DataError extends Error {
  override name = "DataError";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const PLZ = /^\d{5}$/;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(obj: Json, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value === "") {
    throw new DataError(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function num(obj: Json, key: string, where: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DataError(`${where}: "${key}" must be a number`);
  }
  return value;
}

function arr(obj: Json, key: string, where: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) throw new DataError(`${where}: "${key}" must be an array`);
  return value;
}

function isoDate(obj: Json, key: string, where: string): IsoDate {
  const value = str(obj, key, where);
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new DataError(`${where}: "${key}" must be a date (YYYY-MM-DD)`);
  }
  return value;
}

/** Links end up in href attributes: only allow https URLs (no javascript:, data:, ...). */
function httpsUrl(obj: Json, key: string, where: string): string {
  const value = str(obj, key, where);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DataError(`${where}: "${key}" is not a valid URL`);
  }
  if (url.protocol !== "https:") throw new DataError(`${where}: "${key}" must use https`);
  return url.href;
}

function parseLeaflet(raw: unknown, where: string): Leaflet {
  if (!isObject(raw)) throw new DataError(`${where}: leaflet must be an object`);
  const leaflet: Leaflet = {
    validFrom: isoDate(raw, "valid_from", where),
    validTo: isoDate(raw, "valid_to", where),
    cluster: str(raw, "cluster", where),
    viewer: httpsUrl(raw, "viewer", where),
    pdf: httpsUrl(raw, "pdf", where),
  };
  if (raw.pdf_store !== undefined) leaflet.pdfStore = str(raw, "pdf_store", where);
  if (raw.pdf_store_match !== undefined) {
    if (typeof raw.pdf_store_match !== "boolean") {
      throw new DataError(`${where}: "pdf_store_match" must be a boolean`);
    }
    leaflet.pdfStoreMatch = raw.pdf_store_match;
  }
  if (leaflet.validTo < leaflet.validFrom) throw new DataError(`${where}: valid_to < valid_from`);
  return leaflet;
}

function parseSpecialDay(raw: unknown, where: string): SpecialDay {
  if (!isObject(raw)) throw new DataError(`${where}: special day must be an object`);
  const date = isoDate(raw, "date", where);
  if (raw.closed === true) return { date, closed: true };
  const open = str(raw, "open", where);
  const close = str(raw, "close", where);
  if (!TIME.test(open) || !TIME.test(close)) {
    throw new DataError(`${where}: opening hours must be HH:MM`);
  }
  return { date, closed: false, open, close };
}

function parseStore(raw: unknown, index: number): Store {
  if (!isObject(raw)) throw new DataError(`stores[${index}] must be an object`);
  const where = `store ${typeof raw.id === "string" ? raw.id : `#${index}`}`;
  const plz = str(raw, "plz", where);
  if (!PLZ.test(plz)) throw new DataError(`${where}: invalid PLZ`);
  const lat = num(raw, "lat", where);
  const lng = num(raw, "lng", where);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new DataError(`${where}: invalid coordinates`);
  const special = raw.special_days === undefined ? [] : arr(raw, "special_days", where);
  const url = raw.url === undefined ? undefined : httpsUrl(raw, "url", where);
  return {
    id: str(raw, "id", where),
    name: str(raw, "name", where),
    plz,
    city: str(raw, "city", where),
    street: str(raw, "street", where),
    lat,
    lng,
    ...(url && { url }),
    leaflets: arr(raw, "leaflets", where).map((l) => parseLeaflet(l, where)),
    specialDays: special.map((d) => parseSpecialDay(d, where)),
  };
}

export function parseExtra(raw: unknown): ExtraData {
  if (!isObject(raw)) throw new DataError("extra.json must be an object");
  if (raw.schema_version !== 1) {
    throw new DataError(`unsupported schema_version ${String(raw.schema_version)}`);
  }
  const generatedAt = new Date(str(raw, "generated_at", "extra.json"));
  if (Number.isNaN(generatedAt.getTime())) throw new DataError("invalid generated_at");
  const stores = arr(raw, "stores", "extra.json").map(parseStore);
  const storesById = new Map(stores.map((s) => [s.id, s]));
  if (storesById.size !== stores.length) throw new DataError("duplicate store ids");

  const rawClusters = raw.clusters;
  if (!isObject(rawClusters)) throw new DataError('"clusters" must be an object');
  const clusters = new Map<string, readonly string[]>();
  for (const [id, members] of Object.entries(rawClusters)) {
    if (!Array.isArray(members) || !members.every((m): m is string => typeof m === "string")) {
      throw new DataError(`cluster ${id}: members must be store ids`);
    }
    clusters.set(id, members);
  }
  return {
    generatedAt,
    storeCount: num(raw, "store_count", "extra.json"),
    stores,
    storesById,
    clusters,
  };
}

export function parsePlz(raw: unknown): PlzIndex {
  if (!isObject(raw)) throw new DataError("plz.json must be an object");
  const index = new Map<string, LatLng>();
  for (const [plz, value] of Object.entries(raw)) {
    if (
      !PLZ.test(plz) ||
      !Array.isArray(value) ||
      value.length !== 2 ||
      typeof value[0] !== "number" ||
      typeof value[1] !== "number"
    ) {
      throw new DataError(`plz.json: invalid entry for ${plz}`);
    }
    index.set(plz, [value[0], value[1]]);
  }
  return index;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new DataError(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadData(base: string): Promise<{ extra: ExtraData; plz: PlzIndex }> {
  const [extra, plz] = await Promise.all([
    fetchJson(`${base}data/extra.json`).then(parseExtra),
    fetchJson(`${base}plz.json`).then(parsePlz),
  ]);
  return { extra, plz };
}
