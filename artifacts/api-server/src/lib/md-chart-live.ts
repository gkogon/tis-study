/**
 * Maryland CHART live-incidents fetcher.
 *
 * Source: https://chart.maryland.gov/DataFeeds/GetIncidentJson  (public, no auth)
 * Refresh: ~60s upstream.
 *
 * Returns a flat array of statewide incidents; we filter to Baltimore metro
 * bbox client-side.
 */

import { logger } from "./logger";
import type { IncidentListItem } from "./regional-live";

const URL = "https://chart.maryland.gov/DataFeeds/GetIncidentJson";
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

// CHART regions we cover. Currently just Baltimore.
const REGION_BBOX: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  baltimore_metro: { latMin: 39.0, latMax: 39.6, lonMin: -77.0, lonMax: -76.3 },
};

type ChartIncident = {
  id: string;
  incidentType?: string;
  description?: string;
  county?: string;
  direction?: string;
  lat: number;
  lon: number;
  createTime?: string;
  lastCachedDataUpdateTime?: string;
  lanes?: Array<{ status?: string }>;
  lanesStatus?: string;
  closed?: boolean;
  opCenter?: string;
};

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

async function fetchAll(): Promise<ChartIncident[]> {
  const key = "chart-all";
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value as ChartIncident[];

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      signal: ac.signal,
      headers: { "User-Agent": "tis-study/1.0", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CHART ${res.status}`);
    const data = (await res.json()) as ChartIncident[] | { incidents?: ChartIncident[] };
    const list = Array.isArray(data) ? data : data.incidents ?? [];
    cache.set(key, { value: list, expiresAt: Date.now() + CACHE_TTL_MS });
    return list;
  } catch (e) {
    logger.warn?.({ err: e }, "md-chart-live: fetch failed");
    return [];
  } finally {
    clearTimeout(t);
  }
}

export async function getIncidentsForRegion(regionCode: string): Promise<IncidentListItem[]> {
  const b = REGION_BBOX[regionCode];
  if (!b) return [];
  const all = await fetchAll();
  return all
    .filter((i) => i.lat >= b.latMin && i.lat <= b.latMax && i.lon >= b.lonMin && i.lon <= b.lonMax)
    .map((i) => ({
      id: i.id,
      road: i.description ?? "Unknown road",
      county: i.county ?? "",
      condition: i.lanesStatus ?? (i.closed ? "closed" : ""),
      incidentType: i.incidentType ?? "",
      latitude: i.lat,
      longitude: i.lon,
      start: i.createTime ?? "",
      isDetour: undefined,
    }));
}

export function isMdChartRegion(regionCode: string): boolean {
  return regionCode in REGION_BBOX;
}
