// Live Atlanta-metro traffic incidents fetched from the GDOT 511 v2 API.
//
// With the GDOT_511_API_KEY environment variable set, we call a single
// authenticated endpoint:
//
//   GET /api/v2/get/Event?key=...   -> full event list with polylines
//
// This replaces the old scraping approach (icon lists + per-event detail
// fetches) with one fast API call. Falls back to the old scraping method
// if the key is missing or the v2 call fails.
//
// Events are filtered to the Atlanta metro bounding box, snapped to their
// nearest signalized intersection within 500m, and cached in memory for
// 90s (the upstream data refreshes every minute or two).

import { logger } from "./logger";
import { getIntersectionSummaries } from "./atlanta-analysis";

const BBOX = { minLat: 33.0, maxLat: 34.5, minLon: -85.2, maxLon: -83.5 };
const LIVE_BASE = "https://www.511ga.org";
const SNAP_RADIUS_M = 500;
const CACHE_TTL_MS = 90_000;
const DETAIL_CONCURRENCY = 6;

export type LiveIncident = {
  id: string;
  source: string;
  description: string;
  roadway: string;
  eventType: string;
  eventSubType: string;
  severity: string;
  isFullClosure: boolean;
  laneDescription: string;
  startDate: string | null;
  endDate: string | null;
  lastUpdated: string | null;
  latitude: number;
  longitude: number;
  signalId: string | null;
  signalName: string | null;
  signalDistanceM: number | null;
  category: "Incidents" | "IncidentClosures";
};

export type LiveIncidentsBundle = {
  fetchedAt: string;
  source: string;
  cached: boolean;
  cacheAgeSeconds: number;
  totalFetched: number;
  inMetro: number;
  snappedToSignal: number;
  incidents: LiveIncident[];
};

// ---------- spatial index over signals (built lazily, cached) ----------

const CELL = 0.005; // ~500m
let signalGrid: Map<string, number[]> | null = null;
let signalList: { id: string; lat: number; lon: number; name: string }[] | null = null;

function ensureSignalIndex(): void {
  if (signalGrid && signalList) return;
  const inters = getIntersectionSummaries();
  const list: NonNullable<typeof signalList> = [];
  const grid = new Map<string, number[]>();
  for (let i = 0; i < inters.length; i++) {
    const x = inters[i]!;
    list.push({ id: x.id, lat: x.latitude, lon: x.longitude, name: x.name });
    const k = cellKey(x.latitude, x.longitude);
    let bucket = grid.get(k);
    if (!bucket) { bucket = []; grid.set(k, bucket); }
    bucket.push(i);
  }
  signalList = list;
  signalGrid = grid;
}

function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL)}|${Math.floor(lon / CELL)}`;
}

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestSignal(lat: number, lon: number): { idx: number; distM: number } | null {
  ensureSignalIndex();
  const grid = signalGrid!;
  const list = signalList!;
  const cy = Math.floor(lat / CELL);
  const cx = Math.floor(lon / CELL);
  let best = -1;
  let bestD = SNAP_RADIUS_M;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = grid.get(`${cy + dy}|${cx + dx}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const s = list[i]!;
        const d = distM(lat, lon, s.lat, s.lon);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
  }
  return best < 0 ? null : { idx: best, distM: bestD };
}

// ---------- HTTP helpers ----------

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "atlanta-traffic-analyzer/1.0 (live-conditions)",
        "Accept": "application/json,*/*",
      },
      signal: ctl.signal,
    });
    if (!r.ok) {
      const safeUrl = url.replace(/[?&]key=[^&]*/gi, "?key=***");
      throw new Error(`HTTP ${r.status} from ${safeUrl}`);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  n: number,
  worker: (item: T) => Promise<R>,
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let i = 0;
  async function pump(): Promise<void> {
    while (i < items.length) {
      const my = i++;
      try {
        results[my] = await worker(items[my]!);
      } catch {
        results[my] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: n }, pump));
  return results;
}

// ---------- v2 API types ----------

type V2Event = {
  ID: number;
  SourceId: string;
  Organization: string;
  RoadwayName: string;
  DirectionOfTravel: string;
  Description: string;
  Reported: number;
  LastUpdated: number;
  StartDate: number;
  PlannedEndDate: number;
  LanesAffected: string;
  Latitude: number;
  Longitude: number;
  LatitudeSecondary: number;
  LongitudeSecondary: number;
  EventType: string;
  IsFullClosure: boolean;
  Severity: string;
  Comment: string | null;
  EncodedPolyline: string;
  Subtype: string;
};

// ---------- legacy scraping types ----------

type IconItem = { itemId: string | number; location: [number, number] };
type IconResp = { item1?: unknown; item2?: IconItem[] };

// ---------- fetch + cache ----------

let cache: { at: number; bundle: LiveIncidentsBundle } | null = null;
let inflight: Promise<LiveIncidentsBundle> | null = null;

export async function getLiveIncidents(force = false): Promise<LiveIncidentsBundle> {
  if (!force && cache) {
    const ageMs = Date.now() - cache.at;
    if (ageMs < CACHE_TTL_MS) {
      return { ...cache.bundle, cached: true, cacheAgeSeconds: Math.round(ageMs / 1000) };
    }
  }
  if (inflight) return inflight;
  inflight = (async (): Promise<LiveIncidentsBundle> => {
    try {
      return await refreshLiveIncidents();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// ---------- v2 API refresh (preferred) ----------

function inBbox(lat: number, lon: number): boolean {
  return (
    typeof lat === "number" && typeof lon === "number" &&
    lat >= BBOX.minLat && lat <= BBOX.maxLat &&
    lon >= BBOX.minLon && lon <= BBOX.maxLon
  );
}

function epochToIso(epoch: number | null | undefined): string | null {
  if (!epoch) return null;
  try { return new Date(epoch * 1000).toISOString(); } catch { return null; }
}

function eventTypeToCategory(et: string): LiveIncident["category"] {
  const lower = et.toLowerCase();
  if (lower === "closures" || lower.includes("closure")) return "IncidentClosures";
  return "Incidents";
}

async function refreshViaV2Api(): Promise<LiveIncidentsBundle> {
  const startedAt = Date.now();
  const apiKey = process.env.GDOT_511_API_KEY;
  if (!apiKey) throw new Error("GDOT_511_API_KEY not set");

  const events = await fetchJson<V2Event[]>(
    `${LIVE_BASE}/api/v2/get/Event?key=${apiKey}`,
    15_000,
  );

  const totalFetched = events.length;
  const metroEvents = events.filter((e) => inBbox(e.Latitude, e.Longitude));
  const inMetro = metroEvents.length;

  const incidents: LiveIncident[] = [];
  let snappedCount = 0;

  for (const e of metroEvents) {
    const snap = nearestSignal(e.Latitude, e.Longitude);
    if (snap) snappedCount++;
    const sig = snap ? signalList![snap.idx]! : null;

    incidents.push({
      id: String(e.ID),
      source: e.Organization || "GA-Events",
      description: e.Description || "",
      roadway: e.RoadwayName || "",
      eventType: e.EventType || "",
      eventSubType: e.Subtype || "",
      severity: e.Severity || "unknown",
      isFullClosure: !!e.IsFullClosure,
      laneDescription: e.LanesAffected || "",
      startDate: epochToIso(e.StartDate),
      endDate: epochToIso(e.PlannedEndDate),
      lastUpdated: epochToIso(e.LastUpdated),
      latitude: e.Latitude,
      longitude: e.Longitude,
      signalId: sig?.id ?? null,
      signalName: sig?.name ?? null,
      signalDistanceM: snap ? Math.round(snap.distM) : null,
      category: eventTypeToCategory(e.EventType),
    });
  }

  const bundle: LiveIncidentsBundle = {
    fetchedAt: new Date(startedAt).toISOString(),
    source: "GDOT 511 v2 API (authenticated)",
    cached: false,
    cacheAgeSeconds: 0,
    totalFetched,
    inMetro,
    snappedToSignal: snappedCount,
    incidents,
  };
  cache = { at: startedAt, bundle };
  logger.info(
    { totalFetched, inMetro, snapped: snappedCount, ms: Date.now() - startedAt, method: "v2" },
    "live-incidents: refreshed via v2 API",
  );
  return bundle;
}

// ---------- legacy scraping refresh (fallback) ----------

async function refreshViaLegacyScrape(): Promise<LiveIncidentsBundle> {
  const startedAt = Date.now();
  const categories: Array<LiveIncident["category"]> = ["Incidents", "IncidentClosures"];

  const lists = await Promise.all(
    categories.map(async (cat) => {
      try {
        const r = await fetchJson<IconResp>(`${LIVE_BASE}/map/mapIcons/${cat}`);
        return { cat, items: r.item2 ?? [] };
      } catch (e) {
        logger.warn({ err: e, cat }, "live-incidents: icon fetch failed");
        return { cat, items: [] };
      }
    }),
  );

  type Pending = { id: string; cat: LiveIncident["category"]; lat: number; lon: number };
  const seen = new Set<string>();
  const pending: Pending[] = [];
  let totalFetched = 0;
  for (const { cat, items } of lists) {
    totalFetched += items.length;
    for (const it of items) {
      const id = String(it.itemId);
      if (seen.has(id)) continue;
      const [lat, lon] = it.location;
      if (!inBbox(lat, lon)) continue;
      seen.add(id);
      pending.push({ id, cat, lat, lon });
    }
  }
  const inMetro = pending.length;

  type RawDetail = {
    id: number; source?: string; description?: string; roadway?: string;
    eventType?: string; eventSubType?: string; severity?: string;
    isFullClosure?: boolean; laneDescription?: string;
    startDate?: string; endDate?: string; lastUpdated?: string;
    latitude?: number; longitude?: number;
  };
  const details = await runWithConcurrency(pending, DETAIL_CONCURRENCY, async (p) => {
    const d = await fetchJson<RawDetail>(`${LIVE_BASE}/map/data/Incidents/${p.id}`);
    return { p, d };
  });

  const incidents: LiveIncident[] = [];
  let snappedCount = 0;
  for (const row of details) {
    if (!row) continue;
    const { p, d } = row;
    const lat = typeof d.latitude === "number" ? d.latitude : p.lat;
    const lon = typeof d.longitude === "number" ? d.longitude : p.lon;
    const snap = nearestSignal(lat, lon);
    if (snap) snappedCount++;
    const sig = snap ? signalList![snap.idx]! : null;
    incidents.push({
      id: p.id,
      source: d.source ?? "GA-Events",
      description: d.description ?? "",
      roadway: d.roadway ?? "",
      eventType: d.eventType ?? "",
      eventSubType: d.eventSubType ?? "",
      severity: d.severity ?? "unknown",
      isFullClosure: !!d.isFullClosure,
      laneDescription: d.laneDescription ?? "",
      startDate: d.startDate ?? null,
      endDate: d.endDate ?? null,
      lastUpdated: d.lastUpdated ?? null,
      latitude: lat,
      longitude: lon,
      signalId: sig?.id ?? null,
      signalName: sig?.name ?? null,
      signalDistanceM: snap ? Math.round(snap.distM) : null,
      category: p.cat,
    });
  }

  const bundle: LiveIncidentsBundle = {
    fetchedAt: new Date(startedAt).toISOString(),
    source: "GDOT 511 NaviGAtor (public scrape)",
    cached: false,
    cacheAgeSeconds: 0,
    totalFetched,
    inMetro,
    snappedToSignal: snappedCount,
    incidents,
  };
  cache = { at: startedAt, bundle };
  logger.info(
    { totalFetched, inMetro, snapped: snappedCount, ms: Date.now() - startedAt, method: "legacy" },
    "live-incidents: refreshed via legacy scrape",
  );
  return bundle;
}

// ---------- main refresh dispatcher ----------

async function refreshLiveIncidents(): Promise<LiveIncidentsBundle> {
  if (process.env.GDOT_511_API_KEY) {
    try {
      return await refreshViaV2Api();
    } catch (e) {
      logger.warn({ err: e }, "live-incidents: v2 API failed; falling back to legacy scrape");
    }
  }
  return refreshViaLegacyScrape();
}

export function peekLiveIncidents(): LiveIncidentsBundle | null {
  if (!cache) return null;
  const ageMs = Date.now() - cache.at;
  return { ...cache.bundle, cached: true, cacheAgeSeconds: Math.round(ageMs / 1000) };
}

export const __INTERNAL = { distM, nearestSignal, BBOX, SNAP_RADIUS_M };
