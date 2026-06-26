/**
 * Activity-zone generator — global attraction surface from public OSM data.
 *
 * Given a site (lat/lon) and a radius, this module queries OpenStreetMap via
 * the public Overpass API for land-use polygons and key points of interest,
 * classifies each feature into one of four activity categories —
 *
 *    shopping  retail / consumer destinations
 *    commerce  offices, business, commercial districts
 *    working   employment generators (industrial, institutional, jobs)
 *    living    residential areas
 *
 * — weights it into a heuristic "attraction" value, and bins the features into
 * a grid of zones around the site. Each zone carries its attraction by
 * category plus its bearing/cardinal direction from the site, so the result is
 * a ready-made attraction surface and a synthetic directional rollup that
 * works for ANY city on Earth (OSM is global), not just metros with a
 * published MPO travel-demand model.
 *
 * IMPORTANT — what the attraction value is and is NOT: it is a screening proxy
 * for relative trip-attraction (more/bigger activity of a type = more pull),
 * expressed as a dimensionless relative weight. It is NOT an ITE trip rate and
 * must not be reported as one. The intended use is to shape a *directional*
 * distribution (which way do
 * trips pull), where only the relative weights between zones matter.
 *
 * This module performs NO engine wiring on its own — it just generates the
 * zones. Callers decide how to feed the directional rollup into assignment.
 *
 * OSM access mirrors the anonymous, key-less, timeout-guarded Overpass pattern
 * already used by transit-routes.ts. On any network failure it returns null so
 * a caller can fall back gracefully.
 */

import {
  type CardinalDirection,
  CARDINALS,
  bearingToCardinal,
  bearingDeg,
  zeroCardinalRecord,
} from "./cardinal-directions";

// The category taxonomy lives in a neutral module so the Census block-group
// layer can share it without depending on this OSM generator. Re-exported here
// for callers that already import it from activity-zones.
import { type ActivityCategory, ACTIVITY_CATEGORIES } from "./activity-categories";
export type { ActivityCategory };
export { ACTIVITY_CATEGORIES };

const M_PER_MI = 1609.34;
const M_PER_DEG_LAT = 111_320;

/** Default + bounding parameters. Radius is capped to keep Overpass bounded. */
const DEFAULT_RADIUS_MI = 2.0;
const MAX_RADIUS_MI = 5.0;
const DEFAULT_GRID_M = 400;
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Overpass requires a descriptive User-Agent — overpass-api.de returns HTTP
 * 406 (HTML error page) for requests without one. Override via OVERPASS_UA.
 */
const OVERPASS_UA =
  process.env["OVERPASS_UA"] ??
  "tis-study/1.0 (traffic-impact-study activity-zone generator)";

/** Public Overpass endpoints, tried in order; override with OVERPASS_API_URL. */
const OVERPASS_ENDPOINTS: ReadonlyArray<string> = [
  process.env["OVERPASS_API_URL"] ?? "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

// ─── Public types ────────────────────────────────────────────────────────────

export type ActivityFeature = {
  /** OSM element key, e.g. "way/12345". */
  osmId: string;
  category: ActivityCategory;
  /** Classifying tag, e.g. "shop=supermarket" or "landuse=residential". */
  subtype: string;
  name?: string;
  lat: number;
  lon: number;
  distanceMi: number;
  bearingDeg: number;
  cardinal: CardinalDirection;
  /** Heuristic attraction weight (relative pull only — not an ITE rate). */
  attraction: number;
  /** Polygon area in hectares where a footprint was available. */
  areaHa?: number;
};

export type ActivityZone = {
  /** Grid-cell key relative to the site, e.g. "2,-1". */
  cellId: string;
  centroidLat: number;
  centroidLon: number;
  distanceMi: number;
  bearingDeg: number;
  cardinal: CardinalDirection;
  byCategory: Record<ActivityCategory, number>;
  totalAttraction: number;
  dominant: ActivityCategory;
  featureCount: number;
};

export type DirectionalCell = {
  total: number;
  byCategory: Record<ActivityCategory, number>;
};

export type ActivitySurface = {
  site: { lat: number; lon: number };
  radiusMi: number;
  gridM: number;
  source: "osm_overpass";
  /** Endpoint that answered. */
  endpoint: string;
  features: ActivityFeature[];
  zones: ActivityZone[];
  /** Total attraction summed by category across the whole surface. */
  byCategory: Record<ActivityCategory, number>;
  /** Attraction rolled up into the eight cardinal directions (the synthetic
   *  directional-distribution input). */
  directional: Record<CardinalDirection, DirectionalCell>;
};

// ─── Classification + weighting ──────────────────────────────────────────────

type Classification = { category: ActivityCategory; subtype: string; base: number };

/** Per-hectare attraction added for a polygon footprint, by category. */
const AREA_WEIGHT_PER_HA: Record<ActivityCategory, number> = {
  shopping: 3.0,
  commerce: 2.0,
  working: 1.2,
  living: 0.8,
};

/** Cap a single polygon's area contribution so one huge zone can't dominate. */
const MAX_AREA_HA = 200;

/**
 * Classify an OSM feature's tags into one activity category with a base
 * attraction weight. Returns null for tags we do not score. Priority is most-
 * specific first (a tagged POI beats a broad landuse polygon it sits inside).
 */
function classify(tags: Record<string, string>): Classification | null {
  const shop = tags["shop"];
  const office = tags["office"];
  const amenity = tags["amenity"];
  const landuse = tags["landuse"];
  const place = tags["place"];

  // shopping ── retail / consumer destinations
  if (shop) {
    const big = /^(mall|department_store|supermarket|wholesale|hypermarket)$/.test(shop);
    return { category: "shopping", subtype: `shop=${shop}`, base: big ? 8 : 2 };
  }
  if (amenity === "marketplace") return { category: "shopping", subtype: "amenity=marketplace", base: 4 };
  if (landuse === "retail") return { category: "shopping", subtype: "landuse=retail", base: 4 };

  // working ── institutional employment (checked before generic office/commercial
  // so a hospital/university is scored as the major employer it is)
  if (amenity === "hospital") return { category: "working", subtype: "amenity=hospital", base: 15 };
  if (amenity === "university") return { category: "working", subtype: "amenity=university", base: 15 };
  if (amenity === "college") return { category: "working", subtype: "amenity=college", base: 8 };
  if (amenity === "clinic") return { category: "working", subtype: "amenity=clinic", base: 5 };
  if (amenity === "school") return { category: "working", subtype: "amenity=school", base: 4 };
  if (landuse === "industrial") return { category: "working", subtype: "landuse=industrial", base: 5 };

  // commerce ── offices / business / commercial districts
  if (office) return { category: "commerce", subtype: `office=${office}`, base: 3 };
  if (landuse === "commercial") return { category: "commerce", subtype: "landuse=commercial", base: 4 };

  // living ── residential
  if (landuse === "residential") return { category: "living", subtype: "landuse=residential", base: 3 };
  if (place && /^(suburb|neighbourhood|quarter|city_block)$/.test(place)) {
    return { category: "living", subtype: `place=${place}`, base: place === "suburb" ? 6 : 4 };
  }

  return null;
}

// ─── Overpass query + parsing ────────────────────────────────────────────────

type OverpassGeom = { lat: number; lon: number };
type OverpassBounds = { minlat: number; minlon: number; maxlat: number; maxlon: number };
type OverpassEl = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: OverpassGeom[];
  bounds?: OverpassBounds;
  tags?: Record<string, string>;
};

function buildQuery(lat: number, lon: number, radiusM: number): string {
  const a = `(around:${radiusM},${lat},${lon})`;
  // Land-use polygons + key POIs only — deliberately NOT raw buildings, which
  // would explode the response in dense areas without changing the surface.
  return `[out:json][timeout:25];
(
  nwr["shop"]${a};
  nwr["amenity"="marketplace"]${a};
  nwr["landuse"="retail"]${a};
  nwr["office"]${a};
  nwr["landuse"="commercial"]${a};
  nwr["landuse"="industrial"]${a};
  nwr["amenity"~"^(hospital|clinic|university|college|school)$"]${a};
  nwr["landuse"="residential"]${a};
  node["place"~"^(suburb|neighbourhood|quarter|city_block)$"]${a};
);
out tags geom;`;
}

async function runOverpass(
  query: string,
): Promise<{ elements: OverpassEl[]; endpoint: string } | null> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": OVERPASS_UA,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: ctrl.signal,
      });
      if (!resp.ok) continue;
      const json = (await resp.json()) as { elements?: OverpassEl[] };
      return { elements: json.elements ?? [], endpoint };
    } catch {
      // try the next mirror
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// ─── Geometry helpers ────────────────────────────────────────────────────────

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return (6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / M_PER_MI;
}

/** Planar (equirectangular) polygon area in hectares from a ring of lat/lons. */
function ringAreaHa(geom: OverpassGeom[]): number {
  if (geom.length < 3) return 0;
  let latSum = 0;
  for (const g of geom) latSum += g.lat;
  const cosLat = Math.cos(((latSum / geom.length) * Math.PI) / 180);
  let area2 = 0;
  for (let i = 0; i < geom.length; i++) {
    const a = geom[i]!;
    const b = geom[(i + 1) % geom.length]!;
    const ax = a.lon * M_PER_DEG_LAT * cosLat;
    const ay = a.lat * M_PER_DEG_LAT;
    const bx = b.lon * M_PER_DEG_LAT * cosLat;
    const by = b.lat * M_PER_DEG_LAT;
    area2 += ax * by - bx * ay;
  }
  return Math.abs(area2) / 2 / 10_000; // m² → hectares
}

/** Bounding-box area in hectares with a fill factor for non-rectangular shapes. */
function boundsAreaHa(b: OverpassBounds): number {
  const cosLat = Math.cos(((b.minlat + b.maxlat) / 2 * Math.PI) / 180);
  const w = (b.maxlon - b.minlon) * M_PER_DEG_LAT * cosLat;
  const h = (b.maxlat - b.minlat) * M_PER_DEG_LAT;
  return (Math.abs(w * h) * 0.6) / 10_000;
}

/** Representative point + optional area for any element. */
function elementPoint(el: OverpassEl): { lat: number; lon: number; areaHa: number } | null {
  if (el.type === "node" && el.lat != null && el.lon != null) {
    return { lat: el.lat, lon: el.lon, areaHa: 0 };
  }
  if (el.geometry && el.geometry.length >= 3) {
    let latSum = 0, lonSum = 0;
    for (const g of el.geometry) { latSum += g.lat; lonSum += g.lon; }
    const n = el.geometry.length;
    return { lat: latSum / n, lon: lonSum / n, areaHa: ringAreaHa(el.geometry) };
  }
  if (el.center) {
    const areaHa = el.bounds ? boundsAreaHa(el.bounds) : 0;
    return { lat: el.center.lat, lon: el.center.lon, areaHa };
  }
  if (el.bounds) {
    return {
      lat: (el.bounds.minlat + el.bounds.maxlat) / 2,
      lon: (el.bounds.minlon + el.bounds.maxlon) / 2,
      areaHa: boundsAreaHa(el.bounds),
    };
  }
  return null;
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Generate the activity-attraction surface around a site from public OSM data.
 * Returns null on total Overpass failure (caller should fall back).
 */
export async function generateActivitySurface(opts: {
  lat: number;
  lon: number;
  radiusMi?: number;
  gridM?: number;
}): Promise<ActivitySurface | null> {
  const { lat, lon } = opts;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const radiusMi = Math.min(MAX_RADIUS_MI, Math.max(0.25, opts.radiusMi ?? DEFAULT_RADIUS_MI));
  const gridM = Math.max(100, opts.gridM ?? DEFAULT_GRID_M);
  const radiusM = Math.round(radiusMi * M_PER_MI);

  const res = await runOverpass(buildQuery(lat, lon, radiusM));
  if (!res) return null;

  // 1. Classify + locate every scored feature, de-duping by OSM id.
  const features: ActivityFeature[] = [];
  const seen = new Set<string>();
  for (const el of res.elements) {
    const tags = el.tags;
    if (!tags) continue;
    const cls = classify(tags);
    if (!cls) continue;
    const pt = elementPoint(el);
    if (!pt) continue;
    const osmId = `${el.type}/${el.id}`;
    if (seen.has(osmId)) continue;
    seen.add(osmId);

    const distanceMi = haversineMi(lat, lon, pt.lat, pt.lon);
    if (distanceMi > radiusMi) continue;
    const areaHa = Math.min(MAX_AREA_HA, pt.areaHa);
    const attraction = cls.base + areaHa * AREA_WEIGHT_PER_HA[cls.category];
    if (attraction <= 0) continue;
    const bDeg = bearingDeg(lat, lon, pt.lat, pt.lon);

    features.push({
      osmId,
      category: cls.category,
      subtype: cls.subtype,
      name: tags["name"],
      lat: pt.lat,
      lon: pt.lon,
      distanceMi,
      bearingDeg: bDeg,
      cardinal: bearingToCardinal(bDeg),
      attraction: Math.round(attraction * 100) / 100,
      areaHa: areaHa > 0 ? Math.round(areaHa * 10) / 10 : undefined,
    });
  }

  // 2. Bin features into a grid relative to the site.
  const dLat = gridM / M_PER_DEG_LAT;
  const dLon = gridM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  type Cell = {
    iLat: number; iLon: number;
    byCategory: Record<ActivityCategory, number>;
    total: number;
    wLat: number; wLon: number; // attraction-weighted centroid accumulators
    count: number;
  };
  const cells = new Map<string, Cell>();
  for (const f of features) {
    const iLat = Math.floor((f.lat - lat) / dLat);
    const iLon = Math.floor((f.lon - lon) / dLon);
    const key = `${iLat},${iLon}`;
    let c = cells.get(key);
    if (!c) {
      c = { iLat, iLon, byCategory: zeroCategoryRecord(), total: 0, wLat: 0, wLon: 0, count: 0 };
      cells.set(key, c);
    }
    c.byCategory[f.category] += f.attraction;
    c.total += f.attraction;
    c.wLat += f.lat * f.attraction;
    c.wLon += f.lon * f.attraction;
    c.count += 1;
  }

  // 3. Materialize zones + accumulate the directional + category rollups.
  const byCategory = zeroCategoryRecord();
  const directional = {} as Record<CardinalDirection, DirectionalCell>;
  for (const d of CARDINALS) directional[d] = { total: 0, byCategory: zeroCategoryRecord() };

  const zones: ActivityZone[] = [];
  for (const c of cells.values()) {
    const centroidLat = c.total > 0 ? c.wLat / c.total : lat + (c.iLat + 0.5) * dLat;
    const centroidLon = c.total > 0 ? c.wLon / c.total : lon + (c.iLon + 0.5) * dLon;
    const bDeg = bearingDeg(lat, lon, centroidLat, centroidLon);
    const cardinal = bearingToCardinal(bDeg);
    let dominant: ActivityCategory = "living";
    let best = -1;
    for (const cat of ACTIVITY_CATEGORIES) {
      byCategory[cat] += c.byCategory[cat];
      if (c.byCategory[cat] > best) { best = c.byCategory[cat]; dominant = cat; }
    }
    directional[cardinal].total += c.total;
    for (const cat of ACTIVITY_CATEGORIES) directional[cardinal].byCategory[cat] += c.byCategory[cat];

    zones.push({
      cellId: `${c.iLat},${c.iLon}`,
      centroidLat,
      centroidLon,
      distanceMi: haversineMi(lat, lon, centroidLat, centroidLon),
      bearingDeg: bDeg,
      cardinal,
      byCategory: c.byCategory,
      totalAttraction: Math.round(c.total * 100) / 100,
      dominant,
      featureCount: c.count,
    });
  }
  zones.sort((a, b) => b.totalAttraction - a.totalAttraction);

  return {
    site: { lat, lon },
    radiusMi,
    gridM,
    source: "osm_overpass",
    endpoint: res.endpoint,
    features,
    zones,
    byCategory,
    directional,
  };
}

// ─── Directional rollup → distribution percentages ───────────────────────────

/**
 * Convert the activity surface's directional rollup into a percent split over
 * the eight cardinal directions (sums to ~100), mirroring the shape of the
 * adopted Miami-Dade LRTP distribution so the two are directly comparable. This
 * is the synthetic directional distribution, available for any city. Returns an
 * all-zero record when the surface carries no attraction.
 */
export function activityDirectionalPercent(
  surface: ActivitySurface,
): Record<CardinalDirection, number> {
  const out = zeroCardinalRecord();
  let total = 0;
  for (const d of CARDINALS) total += surface.directional[d].total;
  if (total <= 0) return out;
  for (const d of CARDINALS) out[d] = Math.round((surface.directional[d].total / total) * 1000) / 10;
  return out;
}

function zeroCategoryRecord(): Record<ActivityCategory, number> {
  return { shopping: 0, commerce: 0, working: 0, living: 0 };
}
