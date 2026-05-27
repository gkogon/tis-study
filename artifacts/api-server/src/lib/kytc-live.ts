/**
 * Kentucky Transportation Cabinet (KYTC) live road-closures fetcher.
 *
 * Source: services2.arcgis.com/CcI36Pduqd0OR4W9 — KYTC's public ArcGIS
 *   FeatureServer (KYTC_Road_Closures layer).
 *
 * Used by the analyzer service to power the live-monitoring SKU for
 * Louisville (and any future KY metros). Mirrors the surface area of
 * ncdot-live.ts / fdot-live.ts so the route layer dispatches by region
 * code without caring which DOT it is.
 *
 * Caching: 60s in-memory TTL — KYTC updates the closures feed as conditions
 * change and we don't want to hammer their server.
 */

import { logger } from "./logger";

const ENDPOINT =
  "https://services2.arcgis.com/CcI36Pduqd0OR4W9/arcgis/rest/services/KYTC_Road_Closures/FeatureServer/0/query";
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 1000;

// KYTC closures don't carry a county/region ID, so we filter spatially
// per metro. Bounds match the region registry's Louisville bbox.
const REGION_BBOX: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  louisville_metro: { latMin: 37.9, latMax: 38.5, lonMin: -86.1, lonMax: -85.3 },
};

// --- Public types (shared shape with ncdot-live / fdot-live) ---

type KytcClosureRaw = {
  OBJECTID: number;
  id: string;
  reference: string | null;
  closure_type: string | null;
  starttime: number | null; // epoch ms
  endtime: number | null;
  street: string | null;
  direction: string | null;
  description: string | null;
};

export type IncidentListItem = {
  id: number;
  road: string;
  county: string;
  condition: string;
  incidentType: string;
  latitude: number;
  longitude: number;
  start: string;
  lanesClosed?: number;
  lanesTotal?: number;
  isDetour?: boolean;
  severity?: number;
  description?: string;
};

// --- Cache ---

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet<T>(key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// --- Fetch ---

type ArcFeature = {
  attributes: KytcClosureRaw;
  geometry?: { paths?: Array<Array<[number, number]>>; x?: number; y?: number };
};

async function fetchAllActiveClosures(
  bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number },
): Promise<ArcFeature[]> {
  const all: ArcFeature[] = [];
  let offset = 0;
  for (;;) {
    let url =
      `${ENDPOINT}` +
      `?where=${encodeURIComponent("1=1")}` +
      `&outFields=*` +
      `&outSR=4326` +
      `&returnGeometry=true` +
      `&resultRecordCount=${PAGE_SIZE}` +
      `&resultOffset=${offset}` +
      `&f=json`;
    if (bbox) {
      const env = `${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}`;
      url +=
        `&geometry=${encodeURIComponent(env)}` +
        `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    let json: { features?: ArcFeature[]; exceededTransferLimit?: boolean };
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { "User-Agent": "tis-study/1.0", Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`KYTC at offset ${offset} returned ${res.status} ${res.statusText}`);
      json = (await res.json()) as typeof json;
    } finally {
      clearTimeout(timer);
    }
    const features = json.features ?? [];
    all.push(...features);
    if (!json.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }
  return all;
}

function toListItem(f: ArcFeature): IncidentListItem {
  const a = f.attributes;
  // For polyline closures, take the first vertex as a representative point.
  const first = f.geometry?.paths?.[0]?.[0];
  const lat = first ? first[1] : f.geometry?.y ?? 0;
  const lon = first ? first[0] : f.geometry?.x ?? 0;
  const road = [a.street, a.direction].filter(Boolean).join(" ").trim() || "Unknown road";
  const startIso = a.starttime ? new Date(a.starttime).toISOString() : "";
  return {
    id: a.OBJECTID,
    road,
    county: "",
    condition: a.closure_type ?? "Closed",
    incidentType: a.closure_type ?? "Road Closure",
    latitude: lat,
    longitude: lon,
    start: startIso,
    description: a.description ?? a.reference ?? undefined,
    isDetour: /detour/i.test(a.description ?? ""),
  };
}

// --- Public functions ---

/** All active closures in a region. */
export async function getIncidentsForRegion(regionCode: string): Promise<IncidentListItem[]> {
  const bbox = REGION_BBOX[regionCode];
  if (!bbox) {
    logger.warn({ regionCode }, "kytc-live: unknown region code");
    return [];
  }
  const key = `region-${regionCode}`;
  const cached = cacheGet<IncidentListItem[]>(key);
  if (cached) return cached;

  const raw = await fetchAllActiveClosures(bbox);
  const out = raw.map(toListItem);
  cacheSet(key, out);
  return out;
}

/** Drop the cache — used by tests. */
export function _clearCache(): void {
  cache.clear();
}
