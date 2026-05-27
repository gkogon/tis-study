/**
 * MoDOT live-incidents fetcher (WZDx feed).
 *
 * Source: https://traveler.modot.org/timconfig/feed/desktop/mo_wzdx.json
 * Refresh: 180s upstream. Public, no auth, CC0 license.
 *
 * The WZDx format is FeatureCollection-ish but it's actually a 'features' array
 * of work zone / incident events. We treat each feature as one incident and
 * filter by metro bbox client-side.
 */

import { logger } from "./logger";
import type { IncidentListItem } from "./regional-live";

const URL = "https://traveler.modot.org/timconfig/feed/desktop/mo_wzdx.json";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

const REGION_BBOX: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  st_louis_metro: { latMin: 38.4, latMax: 38.9, lonMin: -90.7, lonMax: -89.9 },
  kansas_city_metro: { latMin: 38.8, latMax: 39.5, lonMin: -94.9, lonMax: -94.3 },
  springfield_mo_metro: { latMin: 37.0, latMax: 37.3, lonMin: -93.4, lonMax: -93.1 },
  columbia_mo_metro: { latMin: 38.8, latMax: 39.1, lonMin: -92.5, lonMax: -92.1 },
};

type WzdxFeature = {
  id?: string;
  properties?: {
    core_details?: {
      event_type?: string;
      road_names?: string[];
      direction?: string;
      description?: string;
      name?: string;
      data_source_id?: string;
    };
    start_date?: string;
    vehicle_impact?: string;
    location_method?: string;
    types_of_work?: Array<{ type_name?: string }>;
    work_zone_type?: string;
  };
  geometry?: {
    type?: string;
    coordinates?: number[] | number[][] | number[][][];
  };
};

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

async function fetchAll(): Promise<WzdxFeature[]> {
  const key = "modot-wzdx";
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value as WzdxFeature[];

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      signal: ac.signal,
      headers: { "User-Agent": "tis-study/1.0", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`MoDOT WZDx ${res.status}`);
    const data = (await res.json()) as { features?: WzdxFeature[] };
    const list = data.features ?? [];
    cache.set(key, { value: list, expiresAt: Date.now() + CACHE_TTL_MS });
    return list;
  } catch (e) {
    logger.warn?.({ err: e }, "modot-live: fetch failed");
    return [];
  } finally {
    clearTimeout(t);
  }
}

/** Extract first-vertex lat/lon from any WZDx geometry shape. */
function firstPoint(geom: WzdxFeature["geometry"]): { lat: number; lon: number } | null {
  if (!geom?.coordinates) return null;
  const c = geom.coordinates as unknown;
  if (geom.type === "Point" && Array.isArray(c) && typeof c[0] === "number") {
    return { lon: c[0] as number, lat: c[1] as number };
  }
  if (geom.type === "LineString" && Array.isArray(c) && Array.isArray(c[0])) {
    const first = (c as number[][])[0];
    if (first) return { lon: first[0]!, lat: first[1]! };
  }
  if (geom.type === "MultiLineString" && Array.isArray(c) && Array.isArray((c as number[][][])[0]?.[0])) {
    const first = (c as number[][][])[0]?.[0];
    if (first) return { lon: first[0]!, lat: first[1]! };
  }
  return null;
}

export async function getIncidentsForRegion(regionCode: string): Promise<IncidentListItem[]> {
  const b = REGION_BBOX[regionCode];
  if (!b) return [];
  const all = await fetchAll();
  const out: IncidentListItem[] = [];
  for (const f of all) {
    const pt = firstPoint(f.geometry);
    if (!pt) continue;
    if (pt.lat < b.latMin || pt.lat > b.latMax || pt.lon < b.lonMin || pt.lon > b.lonMax) continue;
    const core = f.properties?.core_details;
    out.push({
      id: f.id ?? "",
      road: core?.road_names?.join("/") ?? core?.name ?? "Unknown road",
      county: "",
      condition: f.properties?.vehicle_impact ?? "",
      incidentType: core?.event_type ?? f.properties?.types_of_work?.[0]?.type_name ?? "",
      latitude: pt.lat,
      longitude: pt.lon,
      start: f.properties?.start_date ?? "",
    });
  }
  return out;
}

export function isModotLiveRegion(regionCode: string): boolean {
  return regionCode in REGION_BBOX;
}
