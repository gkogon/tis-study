/**
 * US state resolution from a site coordinate — runtime accessor.
 *
 * Reads the committed boundary asset (built by
 * scripts/src/fetch-state-boundaries.ts from Census TIGERweb) and answers the
 * one question `Region` cannot: which state is this coordinate actually in?
 *
 * `Region.stateCode` is a single value attached to a metro bounding box, and
 * several of those boxes deliberately straddle state lines — new_york_metro
 * covers Bergen/Hudson/Essex NJ, philadelphia_metro covers Camden/Gloucester
 * NJ, washington_dc_metro covers NoVA and suburban MD. That is correct for
 * *data inventory* (signals, AADT and growth rates are all keyed on
 * `region.code`, and a Bergen County site genuinely belongs to the New York
 * metro inventory) but wrong for *jurisdiction*: it is what caused a New
 * Jersey site to render as an NYSDOT HDM Chapter 5 submittal and a Fairfax
 * County site to cite DDOT and 24 DCMR.
 *
 * Use this for jurisdictional and legal decisions — which renderer, which
 * StateTisConfig, which PE-seal statute, which study tier. Keep using
 * `region` for anything that reads the data inventory.
 *
 * Point-in-polygon is ray casting against ~55 m-precision boundaries, with a
 * bounding-box prefilter so the common case costs a handful of comparisons.
 * Ring winding is not assumed: the first ring of each polygon is treated as
 * the outer boundary and the rest as holes, which is what the GeoJSON spec
 * guarantees and what TIGERweb returns.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// At runtime __dirname is the bundled dist/, so the asset sits at ../data.
// The check scripts import this module straight from src/lib/, where the same
// relative path would resolve to src/data/ — so try both rather than making
// every caller set an env var. STATE_BOUNDARIES_PATH still wins when set
// (alternate deployments, fixtures).
const ASSET_CANDIDATES = [
  process.env["STATE_BOUNDARIES_PATH"],
  path.resolve(__dirname, "../data/us-state-boundaries.json"),
  path.resolve(__dirname, "../../data/us-state-boundaries.json"),
].filter((p): p is string => Boolean(p));

type Ring = [number, number][];

type StateRecord = {
  code: string;
  name: string;
  fips: string;
  /** [lonMin, latMin, lonMax, latMax] */
  bbox: [number, number, number, number];
  /** Polygons; each polygon is [outerRing, ...holes]. */
  polys: Ring[][];
};

type Asset = {
  meta: Record<string, unknown>;
  states: StateRecord[];
};

let loaded: Asset | null = null;
let loadAttempted = false;

function load(): Asset | null {
  if (loadAttempted) return loaded;
  loadAttempted = true;
  try {
    const found = ASSET_CANDIDATES.find((p) => existsSync(p));
    if (!found) return (loaded = null);
    loaded = JSON.parse(readFileSync(found, "utf8")) as Asset;
  } catch {
    // A missing or corrupt asset must never take down a PDF render — callers
    // fall back to region.stateCode, i.e. today's behaviour.
    loaded = null;
  }
  return loaded;
}

/** Ray casting. `ring` is a closed or open list of [lon, lat] pairs. */
function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat) {
      const denom = yj - yi;
      if (denom !== 0 && lon < ((xj - xi) * (lat - yi)) / denom + xi) inside = !inside;
    }
  }
  return inside;
}

function pointInState(lon: number, lat: number, state: StateRecord): boolean {
  const [lonMin, latMin, lonMax, latMax] = state.bbox;
  if (lon < lonMin || lon > lonMax || lat < latMin || lat > latMax) return false;
  for (const poly of state.polys) {
    const outer = poly[0];
    if (!outer || !pointInRing(lon, lat, outer)) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) {
      if (pointInRing(lon, lat, poly[h]!)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/**
 * Two-letter USPS code for the state containing (lat, lon), or null when the
 * coordinate is outside the United States, offshore, or the asset is missing.
 *
 * Callers MUST treat null as "fall back to the metro's stateCode" rather than
 * as an error — a non-US project resolves here every time.
 */
export function stateForCoordinate(lat: number, lon: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const asset = load();
  if (!asset) return null;
  for (const state of asset.states) {
    if (pointInState(lon, lat, state)) return state.code;
  }
  return null;
}

/** Present so checks can assert the asset actually shipped. */
export function stateBoundariesLoaded(): boolean {
  return load() !== null;
}
