/**
 * NCDOT live traffic incidents fetcher.
 *
 * Source: https://eapps.ncdot.gov/services/traffic-prod/v1/  (no auth)
 * Docs: https://tims.ncdot.gov/tims/V2/webservices
 *
 * Used by the analyzer service to power the live-monitoring SKU for NC
 * metros (currently Charlotte + Raleigh-Durham). Mirrors the surface area
 * of atlanta-live.ts so the route layer can swap implementations by region
 * without changing the response shape.
 *
 * Caching: 60s in-memory TTL per query — NCDOT updates the feed every
 * minute or two and we don't want to hammer their server.
 */

import { logger } from "./logger";

const BASE = "https://eapps.ncdot.gov/services/traffic-prod/v1";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

// NCDOT county IDs (verified via /counties endpoint 2026-05-27).
// Map of metro → county IDs that compose that region's coverage.
const REGION_COUNTIES: Record<string, number[]> = {
  // Charlotte MSA: Mecklenburg, Union, Cabarrus, Iredell, Gaston, Lincoln, Rowan
  charlotte_metro: [60, 90, 13, 49, 36, 55, 80],
  // Raleigh-Durham CSA: Wake, Durham, Orange, Chatham, Franklin,
  //   Johnston, Granville, Person, Vance
  raleigh_durham_metro: [92, 32, 68, 19, 35, 51, 39, 73, 91],
};

// --- Public types ---

export type NcdotIncident = {
  id: number;
  start: string;
  end: string;
  road: { name: string; commonName?: string; suffix?: string };
  city?: string;
  direction?: string;
  location?: string;
  county: { id: number; name: string };
  coords: { latitude: number; longitude: number };
  reason?: string;
  condition?: string;
  severity?: number;
  isDetour?: boolean;
  lanesClosed?: number;
  lanesTotal?: number;
  incidentType?: string;
  crossRoad?: { commonName?: string; number?: string; prefix?: string; suffix?: string };
  polyline?: string;
  eventId?: number;
  eventName?: string;
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

// --- Fetch with timeout ---

async function fetchJson<T>(url: string): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": "tis-study/1.0", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`NCDOT API ${url} returned ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// --- Public functions ---

/** Active incident IDs across all of NC. Returns up to ~500 per call. */
export async function getActiveIncidentIds(): Promise<number[]> {
  const key = "active-ids";
  const cached = cacheGet<number[]>(key);
  if (cached) return cached;

  type Resp = { activeIncidentCount: number; activeIncidents: number[] };
  const json = await fetchJson<Resp>(`${BASE}/incidents?active=true`);
  cacheSet(key, json.activeIncidents);
  return json.activeIncidents;
}

/** Full detail for one incident. */
export async function getIncident(id: number): Promise<NcdotIncident> {
  const key = `incident-${id}`;
  const cached = cacheGet<NcdotIncident>(key);
  if (cached) return cached;

  const json = await fetchJson<NcdotIncident>(`${BASE}/incidents/${id}`);
  cacheSet(key, json);
  return json;
}

/** All active incidents in one county. NCDOT supports per-county filtering
 *  natively, but the per-county endpoint returns full records (heavier than
 *  the bulk active-ids list). For metro-scoped queries we just fetch the
 *  active IDs once and filter by county after fetching detail in parallel. */
export async function getIncidentsForCounties(
  countyIds: number[],
): Promise<IncidentListItem[]> {
  const key = `counties-${countyIds.sort().join(",")}`;
  const cached = cacheGet<IncidentListItem[]>(key);
  if (cached) return cached;

  const activeIds = await getActiveIncidentIds();
  // Fetch incident details in batches of 25 so we don't open hundreds of
  // sockets at once (NCDOT's reverse proxy is sensitive to burst load).
  const incidents: NcdotIncident[] = [];
  const BATCH = 25;
  for (let i = 0; i < activeIds.length; i += BATCH) {
    const slice = activeIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(slice.map((id) => getIncident(id)));
    for (const r of results) {
      if (r.status === "fulfilled") incidents.push(r.value);
    }
  }

  const wantCounty = new Set(countyIds);
  const filtered = incidents
    .filter((inc) => inc.county && wantCounty.has(inc.county.id))
    .map(toListItem);
  cacheSet(key, filtered);
  return filtered;
}

/** All active incidents in a region (resolves region code → counties). */
export async function getIncidentsForRegion(regionCode: string): Promise<IncidentListItem[]> {
  const counties = REGION_COUNTIES[regionCode];
  if (!counties) {
    logger.warn({ regionCode }, "ncdot-live: unknown region code");
    return [];
  }
  return getIncidentsForCounties(counties);
}

function toListItem(inc: NcdotIncident): IncidentListItem {
  // NCDOT often sets both commonName and name to nearly-identical values
  // ("i-77" / "I-77"). Prefer commonName when distinct, else fall back to
  // name; then append a non-redundant suffix.
  const cn = (inc.road?.commonName ?? "").trim();
  const nm = (inc.road?.name ?? "").trim();
  const primary = cn && cn.toLowerCase() !== nm.toLowerCase() ? cn : nm;
  const suffix = (inc.road?.suffix ?? "").trim();
  const road = [primary, suffix].filter(Boolean).join(" ").trim() || "Unknown road";
  return {
    id: inc.id,
    road,
    county: inc.county?.name ?? "",
    condition: inc.condition ?? "",
    incidentType: inc.incidentType ?? "",
    latitude: inc.coords?.latitude ?? 0,
    longitude: inc.coords?.longitude ?? 0,
    start: inc.start,
    lanesClosed: inc.lanesClosed,
    lanesTotal: inc.lanesTotal,
    isDetour: inc.isDetour,
    severity: inc.severity,
  };
}

/** Drop the cache — used by tests. */
export function _clearCache(): void {
  cache.clear();
}
