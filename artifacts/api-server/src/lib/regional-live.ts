/**
 * Generic state-DOT live-incident fetcher for ArcGIS-style feeds.
 *
 * Mirrors the surface of ncdot-live.ts so the dispatcher in routes/atlanta.ts
 * can call `getIncidentsForRegion(regionCode)` and get back a normalized
 * `IncidentListItem[]` regardless of which state DOT owns the feed.
 *
 * Currently wires:
 *   - TX (TxDOT DriveTexas)         — services.arcgis.com .../TxDOT_Roadway_Status
 *   - AZ (ADOT Traffic Events)      — services6.arcgis.com .../ADOT_Traffic_Events
 *   - NM (NMDOT Public Incidents)   — services.arcgis.com .../Roadway_Incidents_Public_view
 *   - OR (ODOT-OR TripCheck)        — services.arcgis.com .../ODOT_Traffic_Incidents
 *
 * Each entry in REGION_LIVE_CONFIG below describes the per-region URL + field
 * mapping + metro bbox. Adding a new state DOT = ~10 lines of config.
 *
 * Caching: 60s in-memory TTL per (region) key, same as ncdot-live.ts. Most
 * of these feeds refresh every 1-5 minutes upstream so polling more often is
 * wasted bandwidth.
 */

import { logger } from "./logger";

const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

/** Normalized item shape (matches IncidentListItem from ncdot-live.ts). */
export type IncidentListItem = {
  id: number | string;
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

type BBox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

type RegionLiveConfig = {
  /** ArcGIS FeatureServer / MapServer layer URL. */
  url: string;
  /** Region → bbox filter applied as the spatial envelope. */
  bbox: BBox;
  /** Field name extractors — different per state DOT. */
  fields: {
    /** OBJECTID-equivalent. Skip if missing. */
    id?: string;
    /** Road name field (e.g. "RouteName", "RouteId", "Route"). */
    road: string[];
    /** County name field (optional). */
    county?: string;
    /** Free-text description / condition. */
    description: string[];
    /** Event type / category. */
    eventType?: string;
    /** Severity 1-5 (optional). */
    severity?: string;
    /** Start date — either as date field or text. Multiple candidates tried. */
    start?: string[];
    /** Lanes closed (optional). */
    lanesClosed?: string;
    /** Total lanes (optional). */
    lanesTotal?: string;
  };
  /** Optional WHERE clause to filter to active-only events. */
  activeWhere?: string;
  /** Display label (matches LiveSource enum in metro-coverage.ts). */
  sourceLabel: string;
};

// Per-metro bbox lookups for the 4 wired state DOTs. We use the same bboxes
// as the AADT configs in fetch-aadt-by-signal.ts to keep coverage consistent.
const TX_BBOXES: Record<string, BBox> = {
  houston_metro: { latMin: 29.3, latMax: 30.3, lonMin: -95.9, lonMax: -94.8 },
  dallas_fort_worth_metro: { latMin: 32.4, latMax: 33.4, lonMin: -97.6, lonMax: -96.4 },
  austin_metro: { latMin: 30.0, latMax: 30.7, lonMin: -98.1, lonMax: -97.3 },
  san_antonio_metro: { latMin: 29.2, latMax: 29.8, lonMin: -98.8, lonMax: -98.2 },
  el_paso_metro: { latMin: 31.6, latMax: 31.9, lonMin: -106.6, lonMax: -106.2 },
  corpus_christi_metro: { latMin: 27.6, latMax: 28.0, lonMin: -97.6, lonMax: -97.2 },
  lubbock_metro: { latMin: 33.4, latMax: 33.7, lonMin: -102.0, lonMax: -101.7 },
  mcallen_metro: { latMin: 26.0, latMax: 26.4, lonMin: -98.4, lonMax: -97.9 },
};

const AZ_BBOXES: Record<string, BBox> = {
  phoenix_metro: { latMin: 33.2, latMax: 33.9, lonMin: -112.6, lonMax: -111.5 },
  tucson_metro: { latMin: 31.9, latMax: 32.5, lonMin: -111.2, lonMax: -110.6 },
};

const NM_BBOXES: Record<string, BBox> = {
  albuquerque_metro: { latMin: 34.9, latMax: 35.4, lonMin: -107.0, lonMax: -106.3 },
};

const OR_BBOXES: Record<string, BBox> = {
  portland_metro: { latMin: 45.2, latMax: 45.8, lonMin: -123.1, lonMax: -122.3 },
  eugene_metro: { latMin: 43.9, latMax: 44.2, lonMin: -123.3, lonMax: -122.9 },
  salem_or_metro: { latMin: 44.8, latMax: 45.1, lonMin: -123.2, lonMax: -122.8 },
};

/** Build a config for one region. The state-level URL/fields are shared. */
function makeConfig(stateBase: Omit<RegionLiveConfig, "bbox">, bbox: BBox): RegionLiveConfig {
  return { ...stateBase, bbox };
}

// State-level config shared across that state's regions.
const TX_BASE: Omit<RegionLiveConfig, "bbox"> = {
  url: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadway_Status/FeatureServer/0",
  fields: {
    road: ["RTE_NM", "Route"],
    county: "CNTY_NM",
    description: ["EVENT_DESC", "Description"],
    eventType: "EVENT_TYPE",
    start: ["START_DATE", "EventStart"],
  },
  sourceLabel: "TxDOT DriveTexas",
};

const AZ_BASE: Omit<RegionLiveConfig, "bbox"> = {
  url: "https://services6.arcgis.com/clPWQMwZfdWn4MQZ/arcgis/rest/services/ADOT_Traffic_Events/FeatureServer/0",
  fields: {
    road: ["RouteName", "Route", "Description"],
    description: ["Description", "Reason"],
    eventType: "EventType",
    severity: "Severity",
    start: ["Reported", "Created"],
    lanesClosed: "LanesAffected",
  },
  activeWhere: "IsFullClosure IS NOT NULL OR Severity IS NOT NULL",
  sourceLabel: "ADOT Traffic Events",
};

const NM_BASE: Omit<RegionLiveConfig, "bbox"> = {
  url: "https://services.arcgis.com/hOpd7wfnKm16p9D9/arcgis/rest/services/Roadway_Incidents_Public_view/FeatureServer/0",
  fields: {
    road: ["RouteName", "RouteID", "LocationDescription"],
    description: ["Description", "Comments"],
    eventType: "EventType",
    severity: "Severity",
    start: ["StartTime", "ReportedTime"],
  },
  sourceLabel: "NMDOT Public Incidents",
};

const OR_BASE: Omit<RegionLiveConfig, "bbox"> = {
  url: "https://services.arcgis.com/uUvqNMGPm7axC2dD/arcgis/rest/services/ODOT_Traffic_Incidents/FeatureServer/0",
  fields: {
    road: ["attributes_route", "route", "attributes_odotCategoryDescript"],
    description: ["attributes_odotCategoryDescript", "description"],
    eventType: "attributes_odotCategoryDescript",
    severity: "attributes_odotSeverityID",
    start: ["attributes_lastUpdated", "attributes_startDate"],
  },
  sourceLabel: "ODOT-OR TripCheck",
};

// Build the full per-region registry by combining state-level configs + bboxes.
const REGION_LIVE_CONFIG: Record<string, RegionLiveConfig> = {
  ...Object.fromEntries(Object.entries(TX_BBOXES).map(([k, b]) => [k, makeConfig(TX_BASE, b)])),
  ...Object.fromEntries(Object.entries(AZ_BBOXES).map(([k, b]) => [k, makeConfig(AZ_BASE, b)])),
  ...Object.fromEntries(Object.entries(NM_BBOXES).map(([k, b]) => [k, makeConfig(NM_BASE, b)])),
  ...Object.fromEntries(Object.entries(OR_BBOXES).map(([k, b]) => [k, makeConfig(OR_BASE, b)])),
};

// --- Cache ---
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();
function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) { cache.delete(key); return undefined; }
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
    if (!res.ok) throw new Error(`regional-live ${url} returned ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

type ArcgisFeature = {
  attributes: Record<string, unknown>;
  geometry?: { x: number; y: number; paths?: number[][][] };
};

/** Pull first non-empty string from a field-candidate list. */
function pickStr(attrs: Record<string, unknown>, fields: string[] | undefined): string {
  if (!fields) return "";
  for (const f of fields) {
    const v = attrs[f];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function pickNum(attrs: Record<string, unknown>, field: string | undefined): number | undefined {
  if (!field) return undefined;
  const v = attrs[field];
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : undefined;
}

/** All active incidents in a region. Returns [] for unknown regions. */
export async function getIncidentsForRegion(regionCode: string): Promise<IncidentListItem[]> {
  const cfg = REGION_LIVE_CONFIG[regionCode];
  if (!cfg) {
    logger.warn?.({ regionCode }, "regional-live: unknown region code");
    return [];
  }

  const cacheKey = `regional-live:${regionCode}`;
  const cached = cacheGet<IncidentListItem[]>(cacheKey);
  if (cached) return cached;

  const b = cfg.bbox;
  const envelope = `${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}`;
  const where = cfg.activeWhere ?? "1=1";
  const url =
    `${cfg.url}/query?where=${encodeURIComponent(where)}` +
    `&outFields=*&outSR=4326&returnGeometry=true` +
    `&geometry=${encodeURIComponent(envelope)}&geometryType=esriGeometryEnvelope` +
    `&inSR=4326&spatialRel=esriSpatialRelIntersects&f=json`;

  try {
    const json = await fetchJson<{ features?: ArcgisFeature[] }>(url);
    const features = json.features ?? [];
    const out: IncidentListItem[] = [];
    for (const f of features) {
      const a = f.attributes;
      // Geometry can be point or first-point of polyline.
      const lat = f.geometry?.y ?? (f.geometry?.paths?.[0]?.[0]?.[1] as number | undefined);
      const lon = f.geometry?.x ?? (f.geometry?.paths?.[0]?.[0]?.[0] as number | undefined);
      if (lat === undefined || lon === undefined) continue;
      const startRaw = pickStr(a, cfg.fields.start);
      // ArcGIS often returns epoch ms; format as ISO if numeric.
      let start = startRaw;
      const startNum = Number(startRaw);
      if (Number.isFinite(startNum) && startNum > 1_000_000_000_000) {
        start = new Date(startNum).toISOString();
      }
      out.push({
        id: (a[cfg.fields.id ?? "OBJECTID"] as number | string) ?? "",
        road: pickStr(a, cfg.fields.road) || "Unknown road",
        county: cfg.fields.county ? pickStr(a, [cfg.fields.county]) : "",
        condition: pickStr(a, cfg.fields.description),
        incidentType: cfg.fields.eventType ? pickStr(a, [cfg.fields.eventType]) : "",
        latitude: lat,
        longitude: lon,
        start,
        lanesClosed: pickNum(a, cfg.fields.lanesClosed),
        lanesTotal: pickNum(a, cfg.fields.lanesTotal),
        severity: pickNum(a, cfg.fields.severity),
      });
    }
    cacheSet(cacheKey, out);
    return out;
  } catch (e) {
    logger.warn?.({ regionCode, err: e }, "regional-live: fetch failed");
    return [];
  }
}

/** Lookup which regions this module supports. */
export function isRegionalLiveRegion(regionCode: string): boolean {
  return regionCode in REGION_LIVE_CONFIG;
}
