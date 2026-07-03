/**
 * National block-group TAZ layer — runtime accessor.
 *
 * Reads the committed national data asset (built by
 * scripts/src/build-national-taz.ts) covering every Census block group in the
 * United States (~240k zones). Each block group is a unique zone keyed by its
 * 12-digit Census GEOID, with a population-weighted centroid and the four
 * activity magnitudes a TAZ carries:
 *
 *   population (living) · jobsShopping · jobsCommerce · jobsWorking
 *
 * This gives every city in America its own unique zones with real Census
 * socioeconomic data, and — crucially — solves lat/lon → zone resolution
 * nationwide, which is what blocked the adopted Miami-Dade LRTP table from
 * being usable. Lookup here is nearest population-weighted centroid (a
 * screening approximation of polygon containment; exact point-in-polygon would
 * need the TIGER block-group geometry — tracked as future work).
 *
 * The directional rollup here is the national synthetic directional
 * distribution: it buckets surrounding block groups' attraction by bearing
 * from a site into the same eight cardinal wedges as the Miami-Dade LRTP and
 * the OSM activity surface, so all three are directly comparable.
 *
 * No engine wiring lives here — callers decide how to consume the zones.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import {
  type CardinalDirection,
  CARDINALS,
  bearingDeg,
  bearingToCardinal,
  zeroCardinalRecord,
} from "./cardinal-directions";
import { type ActivityCategory, ACTIVITY_CATEGORIES } from "./activity-categories";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname resolves to bundled dist/ at runtime; the asset ships in ../data.
// NATIONAL_TAZ_PATH overrides the location (tests, alternate deployments).
const ASSET_PATH =
  process.env["NATIONAL_TAZ_PATH"] ??
  path.resolve(__dirname, "../data/national-block-group-taz.json");

const M_PER_MI = 1609.34;

export type BlockGroupRecord = {
  geoid: string;
  lat: number;
  lon: number;
  population: number;
  jobsShopping: number;
  jobsCommerce: number;
  jobsWorking: number;
};

type Row = [string, number, number, number, number, number, number];

type LoadedAsset = {
  records: BlockGroupRecord[];
  /** Grid index: "iLat:iLon" → record indices. */
  grid: Map<string, number[]>;
  meta: Record<string, unknown>;
};

const GRID_DEG = 0.1; // ~7 mi cells

let cache: LoadedAsset | null | undefined;

function load(): LoadedAsset | null {
  if (cache !== undefined) return cache;
  if (!existsSync(ASSET_PATH)) { cache = null; return null; }
  try {
    const parsed = JSON.parse(readFileSync(ASSET_PATH, "utf8")) as {
      meta?: Record<string, unknown>;
      rows: Row[];
    };
    const records: BlockGroupRecord[] = parsed.rows.map((r) => ({
      geoid: r[0],
      lat: r[1],
      lon: r[2],
      population: r[3],
      jobsShopping: r[4],
      jobsCommerce: r[5],
      jobsWorking: r[6],
    }));
    const grid = new Map<string, number[]>();
    for (let i = 0; i < records.length; i++) {
      const key = cellKey(records[i]!.lat, records[i]!.lon);
      let bucket = grid.get(key);
      if (!bucket) { bucket = []; grid.set(key, bucket); }
      bucket.push(i);
    }
    cache = { records, grid, meta: parsed.meta ?? {} };
    return cache;
  } catch (err) {
    // Corrupt/unreadable asset → graceful road-only fallback for surrogate, but
    // log it so a Railway deploy shows why the Census layer went dark.
    console.error(`[national-taz] failed to load asset at ${ASSET_PATH}:`, err);
    cache = null;
    return null;
  }
}

function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / GRID_DEG)}:${Math.floor(lon / GRID_DEG)}`;
}

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return (6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / M_PER_MI;
}

/** True when the national asset is present and loaded. */
export function nationalTazAvailable(): boolean {
  return load() != null;
}

/** Asset build metadata (counts, source, vintage), or null if not present. */
export function nationalTazMeta(): Record<string, unknown> | null {
  return load()?.meta ?? null;
}

/**
 * Nearest block group to a coordinate (screening approximation of containment).
 * Searches the coordinate's grid cell plus the surrounding ring, widening once
 * if the immediate neighborhood is empty (sparse rural areas).
 */
export function blockGroupAt(lat: number, lon: number): (BlockGroupRecord & { distanceMi: number }) | null {
  const a = load();
  if (!a) return null;
  for (const span of [1, 3, 6]) {
    const iLat = Math.floor(lat / GRID_DEG);
    const iLon = Math.floor(lon / GRID_DEG);
    let best: number | null = null;
    let bestD = Infinity;
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const bucket = a.grid.get(`${iLat + dy}:${iLon + dx}`);
        if (!bucket) continue;
        for (const idx of bucket) {
          const r = a.records[idx]!;
          const d = haversineMi(lat, lon, r.lat, r.lon);
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
    }
    if (best != null) {
      const r = a.records[best]!;
      return { ...r, distanceMi: Math.round(bestD * 1000) / 1000 };
    }
  }
  return null;
}

/** All block groups whose centroid is within radiusMi of the coordinate. */
export function blockGroupsWithin(
  lat: number,
  lon: number,
  radiusMi: number,
): Array<BlockGroupRecord & { distanceMi: number }> {
  const a = load();
  if (!a) return [];
  const out: Array<BlockGroupRecord & { distanceMi: number }> = [];
  const span = Math.ceil(radiusMi / (GRID_DEG * 69) ) + 1; // ~69 mi per degree lat
  const iLat = Math.floor(lat / GRID_DEG);
  const iLon = Math.floor(lon / GRID_DEG);
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const bucket = a.grid.get(`${iLat + dy}:${iLon + dx}`);
      if (!bucket) continue;
      for (const idx of bucket) {
        const r = a.records[idx]!;
        const d = haversineMi(lat, lon, r.lat, r.lon);
        if (d <= radiusMi) out.push({ ...r, distanceMi: Math.round(d * 1000) / 1000 });
      }
    }
  }
  out.sort((x, y) => x.distanceMi - y.distanceMi);
  return out;
}

/**
 * Per-category attraction for a block group. `living` weights population down
 * relative to jobs because, at the destination end of a peak-hour trip, an
 * employment/retail site pulls more arrivals per unit than housing. Heuristic
 * screening weight — not an ITE rate.
 */
const LIVING_WEIGHT = 0.5;

export function blockGroupAttraction(r: BlockGroupRecord): Record<ActivityCategory, number> {
  return {
    shopping: r.jobsShopping,
    commerce: r.jobsCommerce,
    working: r.jobsWorking,
    living: r.population * LIVING_WEIGHT,
  };
}

export type NationalDirectional = {
  site: { lat: number; lon: number };
  radiusMi: number;
  blockGroupCount: number;
  byCategory: Record<ActivityCategory, number>;
  directional: Record<CardinalDirection, { total: number; byCategory: Record<ActivityCategory, number> }>;
  /** Percent of attraction by cardinal direction (sums ≈ 100). */
  percent: Record<CardinalDirection, number>;
  source: "census_blockgroup";
};

/**
 * National synthetic directional distribution from real Census block-group
 * socioeconomic data: aggregate surrounding block groups' attraction by their
 * bearing from the site into the eight cardinal wedges. Returns null if the
 * asset is unavailable.
 */
export function nationalDirectionalDistribution(
  lat: number,
  lon: number,
  radiusMi = 3,
): NationalDirectional | null {
  if (!nationalTazAvailable()) return null;
  const bgs = blockGroupsWithin(lat, lon, radiusMi).filter((b) => b.distanceMi > 0.01);
  const byCategory = zeroCategoryRecord();
  const directional = {} as Record<CardinalDirection, { total: number; byCategory: Record<ActivityCategory, number> }>;
  for (const d of CARDINALS) directional[d] = { total: 0, byCategory: zeroCategoryRecord() };

  for (const b of bgs) {
    const attr = blockGroupAttraction(b);
    const cardinal = bearingToCardinal(bearingDeg(lat, lon, b.lat, b.lon));
    let cellTotal = 0;
    for (const cat of ACTIVITY_CATEGORIES) {
      byCategory[cat] += attr[cat];
      directional[cardinal].byCategory[cat] += attr[cat];
      cellTotal += attr[cat];
    }
    directional[cardinal].total += cellTotal;
  }

  const percent = zeroCardinalRecord();
  let grand = 0;
  for (const d of CARDINALS) grand += directional[d].total;
  if (grand > 0) for (const d of CARDINALS) percent[d] = Math.round((directional[d].total / grand) * 1000) / 10;

  return {
    site: { lat, lon },
    radiusMi,
    blockGroupCount: bgs.length,
    byCategory,
    directional,
    percent,
    source: "census_blockgroup",
  };
}

function zeroCategoryRecord(): Record<ActivityCategory, number> {
  return { shopping: 0, commerce: 0, working: 0, living: 0 };
}
