/**
 * Greater-London MSOA origin-destination layer — runtime accessor.
 *
 * Reads the committed 2011 Census WU03EW asset (built by
 * scripts/src/fetch-nomis-2011-wu03.ts): every Greater-London MSOA with its
 * population-weighted centroid, its workplace-employment mass (all-mode commuter
 * column sum), and the commuter flows to/from every other London MSOA by mode.
 *
 * This is the genuine UK trip-distribution spine. For a development site we
 * resolve its MSOA, then project that MSOA's Census journey-to-work flows onto
 * the study intersections' bearings from the site: intersections lying in the
 * direction of where the site's commuters travel receive a larger share of
 * project trips. Direction depends on land use —
 *   • residential  → OUTBOUND flows (residents → their workplaces)
 *   • employment   → INBOUND flows  (workers ← their home MSOAs)
 * — with a workplace-mass fallback when a flow row is unexpectedly empty, and a
 * null result outside London coverage (caller degrades to gravity/road-volume).
 *
 * Pure lookups + a directional projection; no engine policy lives here. Kept
 * separate from trip-distribution.ts so that module stays a fs-free leaf usable
 * under Node's native TS stripping in the verify-*.mjs check-scripts.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { bearingDeg } from "./cardinal-directions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve the asset from the several dir layouts this module runs under: bundled
// dist/ (../data), src/lib at tsx-time (../data + ../../data), or an env override.
const CANDIDATE_PATHS = [
  process.env["GREATER_LONDON_OD_PATH"],
  path.resolve(__dirname, "../data/greater-london-msoa-od-2011.json"),
  path.resolve(__dirname, "../../data/greater-london-msoa-od-2011.json"),
  path.resolve(__dirname, "../../../artifacts/tis-api-server/data/greater-london-msoa-od-2011.json"),
].filter((p): p is string => !!p);

const GUARD_KM = 6; // a site farther than this from any London MSOA centroid ⇒ no coverage
const KAPPA = 2; // directional lobe sharpness: kernel = max(0, cos Δbearing)^KAPPA

type Zone = { msoa: string; name: string; lat: number; lon: number; workplaceTotal: number };
type FlowRow = [number, number, number]; // [zoneIdx, allModeTrips, carTrips]

type Asset = {
  source: string;
  licence: string;
  year: number;
  zones: Zone[];
  flows: Record<string, FlowRow[]>;
  inflows: Record<string, FlowRow[]>;
};

type Loaded = { asset: Asset; byMsoa: Map<string, number> };

let cache: Loaded | null | undefined;

function load(): Loaded | null {
  if (cache !== undefined) return cache;
  const p = CANDIDATE_PATHS.find((c) => existsSync(c));
  if (!p) {
    cache = null;
    return null;
  }
  try {
    const asset = JSON.parse(readFileSync(p, "utf8")) as Asset;
    if (!Array.isArray(asset.zones) || asset.zones.length === 0) {
      cache = null;
      return null;
    }
    const byMsoa = new Map<string, number>();
    asset.zones.forEach((z, i) => byMsoa.set(z.msoa, i));
    cache = { asset, byMsoa };
    return cache;
  } catch {
    cache = null;
    return null;
  }
}

/** True when the Greater-London OD asset is present and non-empty. */
export function ukOdAvailable(): boolean {
  return load() != null;
}

/** Attribution string for the PDF basis line. */
export function ukOdSource(): string | null {
  const l = load();
  return l ? `${l.asset.source} — ${l.asset.licence}` : null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Nearest MSOA (by population-weighted centroid) within the guard radius. */
export function msoaAt(lat: number, lon: number): Zone | null {
  const l = load();
  if (!l) return null;
  let best: Zone | null = null;
  let bestKm = Infinity;
  for (const z of l.asset.zones) {
    const km = haversineKm(lat, lon, z.lat, z.lon);
    if (km < bestKm) {
      bestKm = km;
      best = z;
    }
  }
  return best && bestKm <= GUARD_KM ? best : null;
}

const RESIDENTIAL_PREFIXES = ["21", "22", "23"]; // C3 dwellings (matches renderTisLondon)
function isResidential(landUseCode: string): boolean {
  const c = String(landUseCode ?? "");
  return RESIDENTIAL_PREFIXES.some((p) => c.startsWith(p));
}

export type UkOdAffinity = {
  /** Candidate-ordered directional affinity (car-commuter flow projected onto
   *  each candidate's bearing). Plays the role of surrogate "activity mass". */
  affinity: number[];
  /** "Camden 028 (E02000186)" — the resolved site MSOA. */
  matched: string;
  /** "outbound" (residential) | "inbound" (employment) | "workplace-mass". */
  direction: "outbound" | "inbound" | "workplace-mass";
  /** True when real OD flows drove the projection (vs. the mass fallback). */
  hasFlows: boolean;
  source: string;
};

/**
 * Project the site MSOA's Census journey-to-work flows onto the study
 * intersections' bearings. Returns null when the site is outside London coverage
 * (caller then degrades to the road-volume market-area / gravity path).
 *
 * @param candidateBearings bearing (deg, from the SITE) to each candidate
 *   intersection — candidate-ordered, aligned to the engine's gravityZones.
 */
export function computeOdAffinity(args: {
  siteLat: number;
  siteLon: number;
  candidateBearings: number[];
  landUseCode: string;
}): UkOdAffinity | null {
  const l = load();
  if (!l) return null;
  const site = msoaAt(args.siteLat, args.siteLon);
  if (!site) return null;

  const n = args.candidateBearings.length;
  const residential = isResidential(args.landUseCode);
  // Prefer the land-use-appropriate direction; fall back to the other if empty.
  const primary = residential ? l.asset.flows : l.asset.inflows;
  const secondary = residential ? l.asset.inflows : l.asset.flows;
  const primaryRows = primary[site.msoa] ?? [];
  const secondaryRows = secondary[site.msoa] ?? [];
  const rows = primaryRows.length > 0 ? primaryRows : secondaryRows;
  const direction: UkOdAffinity["direction"] =
    primaryRows.length > 0
      ? residential
        ? "outbound"
        : "inbound"
      : secondaryRows.length > 0
        ? residential
          ? "inbound"
          : "outbound"
        : "workplace-mass";

  const matched = `${site.name} (${site.msoa})`;
  const source = `${l.asset.source} — ${l.asset.licence}`;

  // Mass fallback: no flow row for this MSOA (should not happen for London) →
  // use each candidate's nearest-MSOA workplace mass, undirected.
  if (rows.length === 0 || n === 0) {
    const affinity = args.candidateBearings.map(() => 0);
    return { affinity, matched, direction: "workplace-mass", hasFlows: false, source };
  }

  // Bearing (from the site) to each flow endpoint MSOA centroid, weighted by car
  // commuters, projected onto each candidate bearing via a cosine lobe.
  const endpoints = rows
    .map(([zi, , car]) => {
      const z = l.asset.zones[zi];
      if (!z) return null;
      const theta = bearingDeg(args.siteLat, args.siteLon, z.lat, z.lon);
      return { theta, w: car };
    })
    .filter((e): e is { theta: number; w: number } => e !== null && e.w > 0);

  const affinity = args.candidateBearings.map((phi) => {
    let a = 0;
    for (const e of endpoints) {
      const d = (((e.theta - phi) % 360) + 360) % 360;
      const rad = (d * Math.PI) / 180;
      const c = Math.cos(rad);
      if (c > 0) a += e.w * Math.pow(c, KAPPA);
    }
    return a;
  });

  const anyPositive = affinity.some((v) => v > 0);
  return {
    affinity,
    matched,
    direction,
    hasFlows: anyPositive && endpoints.length > 0,
    source,
  };
}
