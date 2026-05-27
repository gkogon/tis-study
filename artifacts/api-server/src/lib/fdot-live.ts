/**
 * FDOT live traffic events fetcher.
 *
 * Source: https://gis.fdot.gov/arcgis/rest/services/DIVAS_GetEvent/FeatureServer/0
 *
 * DIVAS = District Information Visualization And Sharing. The FeatureServer
 * exposes ~100–200 active statewide events at a time, pushed from SunGuide
 * (FDOT's ATMS) — congestion, crashes, lane closures, weather events.
 * Updated continuously. No auth required.
 *
 * Used by the analyzer service to power the live-monitoring SKU for FL
 * metros (currently Tampa, Orlando, Miami-Dade). Mirrors ncdot-live.ts so
 * the route layer dispatches by region without caring which DOT it is.
 *
 * Caching: 60s in-memory TTL — DIVAS refreshes every minute or two and
 * we don't want to hammer the FDOT service.
 */

import { logger } from "./logger";

const ENDPOINT =
  "https://gis.fdot.gov/arcgis/rest/services/DIVAS_GetEvent/FeatureServer/0/query";
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const PAGE_SIZE = 2000; // layer's maxRecordCount

// DIVAS uses county NAME (not ID). Map metro → set of counties that
// compose its core MSA coverage.
const REGION_COUNTIES: Record<string, string[]> = {
  // Tampa-St. Petersburg-Clearwater MSA
  tampa_metro: ["Hillsborough", "Pinellas", "Pasco", "Hernando"],
  // Orlando-Kissimmee-Sanford MSA
  orlando_metro: ["Orange", "Seminole", "Lake", "Osceola"],
  // Miami-Dade County (core)
  miami_dade_metro: ["Miami-Dade"],
  // Jacksonville-St. Marys MSA (FL portion only)
  jacksonville_metro: ["Duval", "St. Johns", "Clay", "Nassau", "Baker"],
};

// --- Public types (same shape as ncdot-live.ts IncidentListItem) ---

export type FdotEventRaw = {
  oid: number;
  id: string;
  timestamp: string;
  descriptionen: string;
  center: string;
  type: string;
  status: string;
  severity: string;
  reportedat: string;
  datalastupdatedat: string;
  eventtypedesc: string;
  affectedlanes: string;
  county: string;
  highway: string;
  direction: string;
  crossstreet: string;
  latitude: number;
  longitude: number;
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

async function fetchAllActiveEvents(): Promise<FdotEventRaw[]> {
  const cached = cacheGet<FdotEventRaw[]>("all-active");
  if (cached) return cached;

  const all: FdotEventRaw[] = [];
  let offset = 0;
  for (;;) {
    const url =
      `${ENDPOINT}` +
      `?where=${encodeURIComponent("1=1")}` +
      `&outFields=*` +
      `&outSR=4326` +
      `&resultRecordCount=${PAGE_SIZE}` +
      `&resultOffset=${offset}` +
      `&f=json`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    let json: { features?: Array<{ attributes: FdotEventRaw }>; exceededTransferLimit?: boolean };
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { "User-Agent": "tis-study/1.0", Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`FDOT DIVAS at offset ${offset} returned ${res.status} ${res.statusText}`);
      json = (await res.json()) as typeof json;
    } finally {
      clearTimeout(timer);
    }
    const features = json.features ?? [];
    for (const f of features) all.push(f.attributes);
    if (!json.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }

  cacheSet("all-active", all);
  return all;
}

/** Map DIVAS severity string → numeric scale matching NCDOT's. */
function severityToNumber(s: string): number | undefined {
  switch ((s ?? "").toLowerCase()) {
    case "minor": return 1;
    case "moderate": return 2;
    case "major": return 3;
    case "severe":
    case "critical": return 4;
    default: return undefined;
  }
}

/** Parse "1 of 3" / "2 lanes" / " " etc into {closed, total}. */
function parseAffectedLanes(s: string): { closed?: number; total?: number } {
  if (!s || !s.trim()) return {};
  const m1 = s.match(/(\d+)\s*of\s*(\d+)/i);
  if (m1) return { closed: parseInt(m1[1]!, 10), total: parseInt(m1[2]!, 10) };
  const m2 = s.match(/(\d+)/);
  if (m2) return { closed: parseInt(m2[1]!, 10) };
  return {};
}

function toListItem(e: FdotEventRaw): IncidentListItem {
  // Road label: prefer "<highway> <direction> @ <crossstreet>" when all are present.
  const parts: string[] = [];
  if (e.highway) parts.push(e.highway.trim());
  if (e.direction) parts.push(e.direction.toUpperCase());
  let road = parts.join(" ").trim();
  if (e.crossstreet && road) road = `${road} @ ${e.crossstreet.trim()}`;
  else if (e.crossstreet) road = e.crossstreet.trim();
  if (!road) road = "Unknown road";

  const lanes = parseAffectedLanes(e.affectedlanes);
  return {
    id: e.oid,
    road,
    county: e.county ?? "",
    condition: e.status ?? "",
    incidentType: e.eventtypedesc ?? e.type ?? "",
    latitude: e.latitude,
    longitude: e.longitude,
    start: e.reportedat ?? e.timestamp,
    lanesClosed: lanes.closed,
    lanesTotal: lanes.total,
    isDetour: /detour/i.test(e.eventtypedesc ?? ""),
    severity: severityToNumber(e.severity),
    description: e.descriptionen,
  };
}

// --- Public functions ---

/** All active DIVAS events statewide. */
export async function getAllActiveEvents(): Promise<IncidentListItem[]> {
  const key = "all-events-mapped";
  const cached = cacheGet<IncidentListItem[]>(key);
  if (cached) return cached;
  const raw = await fetchAllActiveEvents();
  const out = raw.map(toListItem);
  cacheSet(key, out);
  return out;
}

/** All active events in a region (resolves region code → counties). */
export async function getIncidentsForRegion(regionCode: string): Promise<IncidentListItem[]> {
  const counties = REGION_COUNTIES[regionCode];
  if (!counties) {
    logger.warn({ regionCode }, "fdot-live: unknown region code");
    return [];
  }
  const key = `region-${regionCode}`;
  const cached = cacheGet<IncidentListItem[]>(key);
  if (cached) return cached;

  const all = await getAllActiveEvents();
  const wantCounty = new Set(counties.map((c) => c.toLowerCase()));
  const filtered = all.filter((i) => wantCounty.has((i.county ?? "").toLowerCase()));
  cacheSet(key, filtered);
  return filtered;
}

/** Drop the cache — used by tests. */
export function _clearCache(): void {
  cache.clear();
}
