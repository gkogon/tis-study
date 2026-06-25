/**
 * OSM-cluster TAZ layer — bespoke per-city zones from the activity surface.
 *
 * This is the "generate our own zones" alternative to the national Census
 * block-group backbone (national-block-group-taz.ts). Instead of inheriting an
 * external zone geometry, it derives zones DIRECTLY from the OSM activity
 * surface (activity-zones.ts): it spatially clusters the classified activity
 * features (DBSCAN over their projected positions) into organic, irregular
 * zones that follow real activity, the way an MPO's analysts draw TAZs to
 * follow land use — rather than chopping the area into an arbitrary fixed grid
 * (which is what generateActivitySurface() already does).
 *
 * Each zone gets:
 *   • a STABLE id derived from its attraction-weighted centroid (not from OSM
 *     element ids, which churn), so the same district keeps the same id across
 *     re-fetches as long as its center of mass barely moves;
 *   • a generated name (its largest named anchor, else "<Dominant> district
 *     <cardinal>");
 *   • an attraction profile by category + a dominant category;
 *   • a convex-hull footprint polygon (GeoJSON [lon,lat] ring) and extent area;
 *   • a bearing / cardinal wedge from the site.
 *
 * The module then rolls the zones up into the same eight cardinal wedges and
 * percent split as every other directional source, so it is a drop-in,
 * Census-free directional-distribution input that works for ANY city on Earth.
 *
 * HONEST LABELING — these are SYNTHETIC / MODELED zones (source tag
 * "osm_cluster_synthetic"). They are NOT an adopted MPO Traffic Analysis Zone
 * layer and must never be reported as one; the attraction values are the same
 * relative screening proxy documented in activity-zones.ts, not ITE rates.
 *
 * No engine wiring lives here. Reuse generateActivitySurface()'s features so
 * clustering costs no extra Overpass call; directional-distribution.ts selects
 * between this and the other sources.
 */

import {
  type CardinalDirection,
  CARDINALS,
  bearingDeg,
  bearingToCardinal,
  zeroCardinalRecord,
} from "./cardinal-directions";
import {
  type ActivityCategory,
  type ActivityFeature,
  type ActivitySurface,
  type DirectionalCell,
  ACTIVITY_CATEGORIES,
  generateActivitySurface,
} from "./activity-zones";

const M_PER_MI = 1609.34;
const M_PER_DEG_LAT = 111_320;

/** DBSCAN defaults. eps is the neighbor radius in meters that fuses features
 *  into one district; minPts is the core-point threshold. A feature that is not
 *  dense enough to join a cluster is kept as its own singleton zone (so no
 *  attraction or coverage is dropped — every place lands in exactly one zone,
 *  the way a real TAZ layer tiles space).
 *
 *  eps is deliberately tight (~one city block). DBSCAN suffers from transitive
 *  "chaining": with a loose eps, continuous activity in a dense core links the
 *  whole downtown into ONE mega-cluster, which collapses the directional rollup
 *  onto a single wedge and destroys fidelity. An eps sweep across Atlanta /
 *  Miami / Chicago / LA (scripts/src/compare-zone-sources.ts) showed 80 m keeps
 *  the largest zone's share of total pull at 6–8% even in the Chicago Loop
 *  (vs 98% at 300 m) and maximizes agreement with the Census block-group layer
 *  (e.g. Chicago cosine 0.96 at 80 m vs 0.80 at 300 m). */
const DEFAULT_EPS_M = 80;
const DEFAULT_MIN_PTS = 3;

// ─── Public types ────────────────────────────────────────────────────────────

export type ClusterZone = {
  /** Stable id derived from the attraction-weighted centroid (see module doc). */
  id: string;
  /** Generated human name — largest named anchor, else "<Dominant> district <dir>". */
  name: string;
  /** True for a real multi-feature DBSCAN cluster; false for a singleton. */
  isCluster: boolean;
  centroidLat: number;
  centroidLon: number;
  distanceMi: number;
  bearingDeg: number;
  cardinal: CardinalDirection;
  byCategory: Record<ActivityCategory, number>;
  totalAttraction: number;
  dominant: ActivityCategory;
  featureCount: number;
  /** Convex-hull extent area of the cluster footprint, hectares. */
  areaHa: number;
  /** Convex-hull ring as GeoJSON [lon, lat] pairs (closed); degenerate for <3 points. */
  hull: Array<[number, number]>;
  /** OSM element ids of the member features (provenance / debugging). */
  memberOsmIds: string[];
};

export type ClusterTazResult = {
  site: { lat: number; lon: number };
  radiusMi: number;
  source: "osm_cluster_synthetic";
  params: { epsM: number; minPts: number };
  zones: ClusterZone[];
  /** Total attraction summed by category across all zones. */
  byCategory: Record<ActivityCategory, number>;
  /** Attraction rolled up into the eight cardinal wedges. */
  directional: Record<CardinalDirection, DirectionalCell>;
  /** Percent of attraction by cardinal direction (sums ≈ 100). */
  percent: Record<CardinalDirection, number>;
  coverage: {
    featureCount: number;
    zoneCount: number;
    clusterCount: number;
    singletonCount: number;
    /** Share of total attraction held by real (multi-feature) clusters, 0..1. */
    clusteredAttractionShare: number;
  };
};

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

/** Local equirectangular projection to meters about an origin (good at city scale). */
function projector(originLat: number) {
  const cosLat = Math.cos((originLat * Math.PI) / 180);
  return (lat: number, lon: number): [number, number] => [
    lon * M_PER_DEG_LAT * cosLat,
    lat * M_PER_DEG_LAT,
  ];
}

/** Convex hull (Andrew's monotone chain) over projected points; returns the
 *  ordered indices of the input array forming the hull (CCW). */
function convexHullIndices(pts: Array<[number, number]>): number[] {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const order = pts.map((_, i) => i).sort((a, b) => {
    const pa = pts[a]!, pb = pts[b]!;
    return pa[0] - pb[0] || pa[1] - pb[1];
  });
  const cross = (o: number, a: number, b: number): number => {
    const po = pts[o]!, pa = pts[a]!, pb = pts[b]!;
    return (pa[0] - po[0]) * (pb[1] - po[1]) - (pa[1] - po[1]) * (pb[0] - po[0]);
  };
  const lower: number[] = [];
  for (const i of order) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, i) <= 0) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Shoelace area in hectares from projected-meter ring coords. */
function ringAreaHaProjected(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  let a2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a2 += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a2) / 2 / 10_000;
}

// ─── DBSCAN ──────────────────────────────────────────────────────────────────

const UNCLASSIFIED = 0;
const NOISE = -1;

/**
 * Density-based clustering of features by their projected positions. Returns a
 * per-feature label: a positive cluster id, or NOISE (-1). Uses a uniform grid
 * (cell = eps) for O(n) neighbor queries. Classic DBSCAN: a point is a core
 * point when its eps-neighborhood (including itself) has ≥ minPts members.
 */
function dbscan(xy: Array<[number, number]>, epsM: number, minPts: number): number[] {
  const n = xy.length;
  const labels = new Array<number>(n).fill(UNCLASSIFIED);
  if (n === 0) return labels;

  // Grid index keyed by eps-sized cells.
  const grid = new Map<string, number[]>();
  const cell = (p: [number, number]): [number, number] => [
    Math.floor(p[0] / epsM),
    Math.floor(p[1] / epsM),
  ];
  for (let i = 0; i < n; i++) {
    const [cx, cy] = cell(xy[i]!);
    const key = `${cx},${cy}`;
    let b = grid.get(key);
    if (!b) { b = []; grid.set(key, b); }
    b.push(i);
  }

  const eps2 = epsM * epsM;
  const regionQuery = (i: number): number[] => {
    const p = xy[i]!;
    const [cx, cy] = cell(p);
    const out: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const b = grid.get(`${cx + dx},${cy + dy}`);
        if (!b) continue;
        for (const j of b) {
          const q = xy[j]!;
          const ex = p[0] - q[0], ey = p[1] - q[1];
          if (ex * ex + ey * ey <= eps2) out.push(j);
        }
      }
    }
    return out;
  };

  let clusterId = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] !== UNCLASSIFIED) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minPts) {
      labels[i] = NOISE;
      continue;
    }
    clusterId++;
    labels[i] = clusterId;
    // Expand. seeds acts as a work queue; label checks keep it terminating.
    const seeds = neighbors.filter((j) => j !== i);
    for (let s = 0; s < seeds.length; s++) {
      const q = seeds[s]!;
      if (labels[q] === NOISE) labels[q] = clusterId; // border point
      if (labels[q] !== UNCLASSIFIED) continue;
      labels[q] = clusterId;
      const qn = regionQuery(q);
      if (qn.length >= minPts) for (const x of qn) seeds.push(x);
    }
  }
  return labels;
}

// ─── Zone assembly ───────────────────────────────────────────────────────────

const DOMINANT_LABEL: Record<ActivityCategory, string> = {
  shopping: "Shopping",
  commerce: "Commerce",
  working: "Working",
  living: "Living",
};

function zeroCategoryRecord(): Record<ActivityCategory, number> {
  return { shopping: 0, commerce: 0, working: 0, living: 0 };
}

/** Stable id from a centroid: coordinates rounded to ~11 m. Independent of OSM
 *  element ids and of which category happens to dominate, so it survives data
 *  churn as long as the center of mass barely moves. */
function stableZoneId(lat: number, lon: number): string {
  return `osmz.${lat.toFixed(4)}.${lon.toFixed(4)}`;
}

function buildZone(
  members: ActivityFeature[],
  site: { lat: number; lon: number },
  project: (lat: number, lon: number) => [number, number],
  isCluster: boolean,
): ClusterZone {
  const byCategory = zeroCategoryRecord();
  let total = 0;
  let wLat = 0, wLon = 0;
  for (const f of members) {
    byCategory[f.category] += f.attraction;
    total += f.attraction;
    wLat += f.lat * f.attraction;
    wLon += f.lon * f.attraction;
  }
  const centroidLat = total > 0 ? wLat / total : members[0]!.lat;
  const centroidLon = total > 0 ? wLon / total : members[0]!.lon;

  let dominant: ActivityCategory = "living";
  let best = -Infinity;
  for (const cat of ACTIVITY_CATEGORIES) {
    if (byCategory[cat] > best) { best = byCategory[cat]; dominant = cat; }
  }

  // Hull footprint over projected member points.
  const proj = members.map((f) => project(f.lat, f.lon));
  const hullIdx = convexHullIndices(proj);
  const hullRing = hullIdx.map((i) => proj[i]!);
  const areaHa = ringAreaHaProjected(hullRing);
  const hull: Array<[number, number]> = hullIdx.map((i) => [
    Math.round(members[i]!.lon * 1e6) / 1e6,
    Math.round(members[i]!.lat * 1e6) / 1e6,
  ]);
  if (hull.length >= 3) hull.push(hull[0]!); // close the ring

  // Name: largest named anchor, else "<Dominant> district <cardinal>".
  const bDeg = bearingDeg(site.lat, site.lon, centroidLat, centroidLon);
  const cardinal = bearingToCardinal(bDeg);
  let anchor: ActivityFeature | null = null;
  for (const f of members) {
    if (!f.name) continue;
    if (!anchor || f.attraction > anchor.attraction) anchor = f;
  }
  const name = anchor?.name
    ? `${anchor.name} area`
    : `${DOMINANT_LABEL[dominant]} district ${cardinal}`;

  return {
    id: stableZoneId(centroidLat, centroidLon),
    name,
    isCluster,
    centroidLat: Math.round(centroidLat * 1e6) / 1e6,
    centroidLon: Math.round(centroidLon * 1e6) / 1e6,
    distanceMi: Math.round(haversineMi(site.lat, site.lon, centroidLat, centroidLon) * 1000) / 1000,
    bearingDeg: Math.round(bDeg * 10) / 10,
    cardinal,
    byCategory,
    totalAttraction: Math.round(total * 100) / 100,
    dominant,
    featureCount: members.length,
    areaHa: Math.round(areaHa * 100) / 100,
    hull,
    memberOsmIds: members.map((f) => f.osmId),
  };
}

/**
 * Cluster a set of activity features into bespoke zones. Pure (no network) so
 * callers can reuse features already fetched for the grid surface. Features are
 * assumed to be in the same coordinate space as `site` (they are, when they
 * come from generateActivitySurface()).
 */
export function clusterActivityFeatures(
  features: ActivityFeature[],
  site: { lat: number; lon: number },
  opts: { epsM?: number; minPts?: number } = {},
): ClusterZone[] {
  if (features.length === 0) return [];
  const epsM = Math.max(25, opts.epsM ?? DEFAULT_EPS_M);
  const minPts = Math.max(1, Math.floor(opts.minPts ?? DEFAULT_MIN_PTS));
  const project = projector(site.lat);
  const xy = features.map((f) => project(f.lat, f.lon));

  const labels = dbscan(xy, epsM, minPts);
  const clusters = new Map<number, ActivityFeature[]>();
  const zones: ClusterZone[] = [];
  for (let i = 0; i < features.length; i++) {
    const lbl = labels[i]!;
    if (lbl === NOISE) {
      // Singleton zone — keeps every feature (and its attraction) on the map.
      zones.push(buildZone([features[i]!], site, project, false));
      continue;
    }
    let g = clusters.get(lbl);
    if (!g) { g = []; clusters.set(lbl, g); }
    g.push(features[i]!);
  }
  for (const members of clusters.values()) {
    zones.push(buildZone(members, site, project, true));
  }
  zones.sort((a, b) => b.totalAttraction - a.totalAttraction);
  return zones;
}

/** Roll zones up into the cardinal wedges + a percent split, plus coverage. */
export function summarizeClusterZones(
  zones: ClusterZone[],
  site: { lat: number; lon: number },
  radiusMi: number,
  params: { epsM: number; minPts: number },
): ClusterTazResult {
  const byCategory = zeroCategoryRecord();
  const directional = {} as Record<CardinalDirection, DirectionalCell>;
  for (const d of CARDINALS) directional[d] = { total: 0, byCategory: zeroCategoryRecord() };

  let featureCount = 0;
  let clusterCount = 0;
  let clusteredAttraction = 0;
  let grandTotal = 0;
  for (const z of zones) {
    featureCount += z.featureCount;
    if (z.isCluster) { clusterCount++; clusteredAttraction += z.totalAttraction; }
    grandTotal += z.totalAttraction;
    directional[z.cardinal].total += z.totalAttraction;
    for (const cat of ACTIVITY_CATEGORIES) {
      byCategory[cat] += z.byCategory[cat];
      directional[z.cardinal].byCategory[cat] += z.byCategory[cat];
    }
  }

  const percent = zeroCardinalRecord();
  if (grandTotal > 0) {
    for (const d of CARDINALS) {
      percent[d] = Math.round((directional[d].total / grandTotal) * 1000) / 10;
    }
  }

  return {
    site,
    radiusMi,
    source: "osm_cluster_synthetic",
    params,
    zones,
    byCategory,
    directional,
    percent,
    coverage: {
      featureCount,
      zoneCount: zones.length,
      clusterCount,
      singletonCount: zones.length - clusterCount,
      clusteredAttractionShare: grandTotal > 0 ? Math.round((clusteredAttraction / grandTotal) * 1000) / 1000 : 0,
    },
  };
}

/**
 * Build the OSM-cluster zone result from an already-fetched activity surface.
 * Pure (no network) — the preferred entry when you also want the grid view, so
 * one Overpass call feeds both.
 */
export function clusterTazFromSurface(
  surface: ActivitySurface,
  opts: { epsM?: number; minPts?: number } = {},
): ClusterTazResult {
  const epsM = Math.max(25, opts.epsM ?? DEFAULT_EPS_M);
  const minPts = Math.max(1, Math.floor(opts.minPts ?? DEFAULT_MIN_PTS));
  const zones = clusterActivityFeatures(surface.features, surface.site, { epsM, minPts });
  return summarizeClusterZones(zones, surface.site, surface.radiusMi, { epsM, minPts });
}

/**
 * Convenience: fetch the activity surface and cluster it in one call. Returns
 * null on total Overpass failure (caller should fall back). Prefer
 * clusterTazFromSurface() when you already hold a surface.
 */
export async function generateClusterTaz(opts: {
  lat: number;
  lon: number;
  radiusMi?: number;
  gridM?: number;
  epsM?: number;
  minPts?: number;
}): Promise<ClusterTazResult | null> {
  const surface = await generateActivitySurface({
    lat: opts.lat,
    lon: opts.lon,
    radiusMi: opts.radiusMi,
    gridM: opts.gridM,
  });
  if (!surface) return null;
  return clusterTazFromSurface(surface, { epsM: opts.epsM, minPts: opts.minPts });
}
