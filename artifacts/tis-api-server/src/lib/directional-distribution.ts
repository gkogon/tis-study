/**
 * Directional-distribution source selector — the one seam the engine picks a
 * zone layer through.
 *
 * Four directional sources now exist, all emitting the same eight-wedge percent
 * split (cardinal-directions.ts). This module unifies them behind one type so a
 * caller asks for a distribution at a site and gets back a labeled result that
 * is honest about what it is:
 *
 *   adopted_lrtp       Adopted MPO TAZ distribution (Miami-Dade LRTP).
 *                      AUTHORITATIVE, not synthetic. Keyed by TAZ id, FL only.
 *   census_blockgroup  National Census block-group model (LODES8 + Centers of
 *                      Population). Synthetic, real socioeconomic data, US only.
 *   osm_cluster        Bespoke per-city zones clustered from the OSM activity
 *                      surface (osm-cluster-taz.ts). Synthetic, global.
 *   osm_grid           OSM activity surface binned to a fixed grid
 *                      (activity-zones.ts). Synthetic, global, simplest.
 *
 * Honesty is structural: only adopted_lrtp carries authoritative=true /
 * synthetic=false; every modeled source carries synthetic=true and a note that
 * spells out it is NOT an adopted TAZ layer.
 *
 * resolveBest() encodes the project's preference order — authoritative adopted
 * first, then the Census backbone, then bespoke OSM clusters, then the OSM grid
 * — and falls through to the first source that can answer at the site.
 */

import {
  type CardinalDirection,
  CARDINALS,
} from "./cardinal-directions";
import {
  type ActivityCategory,
  type ActivitySurface,
  generateActivitySurface,
  activityDirectionalPercent,
} from "./activity-zones";
import { clusterTazFromSurface } from "./osm-cluster-taz";
import {
  nationalDirectionalDistribution,
  nationalTazAvailable,
} from "./national-block-group-taz";
import {
  type LrtpYear,
  lrtpDistributionByCountyTaz,
  LRTP_SOURCE,
} from "./fl-lrtp-directional-distribution";

export type ZoneSource =
  | "adopted_lrtp"
  | "census_blockgroup"
  | "osm_cluster"
  | "osm_grid";

/** Project preference order: authoritative first, synthetic fallbacks after. */
export const ZONE_SOURCE_PRIORITY: ReadonlyArray<ZoneSource> = [
  "adopted_lrtp",
  "census_blockgroup",
  "osm_cluster",
  "osm_grid",
];

export type DirectionalDistribution = {
  source: ZoneSource;
  /** Honest human label for reports/UI. */
  label: string;
  /** True only for an adopted MPO distribution. */
  authoritative: boolean;
  /** True for every modeled (non-adopted) source. */
  synthetic: boolean;
  /** Percent of trip pull by cardinal wedge (sums ≈ 100). */
  percent: Record<CardinalDirection, number>;
  /** Attraction by activity category; null for adopted (it carries none). */
  byCategory: Record<ActivityCategory, number> | null;
  /** Coverage proxy: number of zones/TAZs that fed this distribution. */
  zoneCount: number;
  radiusMi: number | null;
  /** Provenance + caveat string. */
  note: string;
};

export type ResolveOpts = {
  lat: number;
  lon: number;
  radiusMi?: number;
  /** adopted_lrtp: the Miami-Dade County TAZ id and (optional) network year. */
  lrtpTaz?: number;
  lrtpYear?: LrtpYear;
  /** osm_cluster: DBSCAN parameters. */
  epsM?: number;
  minPts?: number;
  /** Reuse an already-fetched OSM surface (avoids a second Overpass call). */
  surface?: ActivitySurface | null;
};

const DEFAULT_RADIUS_MI = 3;

const SYNTH_CAVEAT =
  "Modeled/synthetic — NOT an adopted MPO Traffic Analysis Zone layer; relative trip-pull screening proxy, not ITE rates.";

/** Resolve a single, explicitly chosen source. Returns null if that source
 *  cannot answer at the site (no adopted TAZ id, asset missing, Overpass down). */
export async function resolveDirectionalDistribution(
  source: ZoneSource,
  opts: ResolveOpts,
): Promise<DirectionalDistribution | null> {
  const radiusMi = opts.radiusMi ?? DEFAULT_RADIUS_MI;

  switch (source) {
    case "adopted_lrtp": {
      if (opts.lrtpTaz == null) return null;
      const year: LrtpYear = opts.lrtpYear ?? 2015;
      const dist = lrtpDistributionByCountyTaz(opts.lrtpTaz, year);
      if (!dist) return null;
      return {
        source,
        label: `Adopted MPO directional distribution — Miami-Dade County TAZ ${dist.countyTaz} (${year})`,
        authoritative: true,
        synthetic: false,
        percent: dist.pct,
        byCategory: null,
        zoneCount: 1,
        radiusMi: null,
        note: LRTP_SOURCE,
      };
    }

    case "census_blockgroup": {
      if (!nationalTazAvailable()) return null;
      const nd = nationalDirectionalDistribution(opts.lat, opts.lon, radiusMi);
      if (!nd || nd.blockGroupCount === 0) return null;
      return {
        source,
        label: "National Census block-group model",
        authoritative: false,
        synthetic: true,
        percent: nd.percent,
        byCategory: nd.byCategory,
        zoneCount: nd.blockGroupCount,
        radiusMi: nd.radiusMi,
        note: `LEHD LODES8 jobs + Census 2020 Centers of Population, nearest-centroid screening. ${SYNTH_CAVEAT}`,
      };
    }

    case "osm_cluster": {
      const surface = opts.surface ?? (await generateActivitySurface({
        lat: opts.lat, lon: opts.lon, radiusMi,
      }));
      if (!surface) return null;
      const res = clusterTazFromSurface(surface, { epsM: opts.epsM, minPts: opts.minPts });
      if (res.coverage.zoneCount === 0) return null;
      return {
        source,
        label: "OSM activity clusters (bespoke per-city zones)",
        authoritative: false,
        synthetic: true,
        percent: res.percent,
        byCategory: res.byCategory,
        zoneCount: res.coverage.zoneCount,
        radiusMi: res.radiusMi,
        note: `DBSCAN clusters of OpenStreetMap land use/POIs (eps ${res.params.epsM} m, minPts ${res.params.minPts}). ${SYNTH_CAVEAT}`,
      };
    }

    case "osm_grid": {
      const surface = opts.surface ?? (await generateActivitySurface({
        lat: opts.lat, lon: opts.lon, radiusMi,
      }));
      if (!surface) return null;
      if (surface.zones.length === 0) return null;
      return {
        source,
        label: "OSM activity grid",
        authoritative: false,
        synthetic: true,
        percent: activityDirectionalPercent(surface),
        byCategory: surface.byCategory,
        zoneCount: surface.zones.length,
        radiusMi: surface.radiusMi,
        note: `OpenStreetMap land use/POIs binned to a ${surface.gridM} m grid. ${SYNTH_CAVEAT}`,
      };
    }
  }
}

/**
 * Resolve the best available source in priority order. Fetches the OSM surface
 * at most once and reuses it across the two OSM sources. Returns the chosen
 * distribution plus the ordered list of sources that were attempted (so a
 * caller can report "fell back from census_blockgroup").
 */
export async function resolveBestDirectionalDistribution(
  opts: ResolveOpts,
): Promise<{ chosen: DirectionalDistribution; tried: ZoneSource[] } | null> {
  const tried: ZoneSource[] = [];
  let surface: ActivitySurface | null | undefined = opts.surface;
  for (const source of ZONE_SOURCE_PRIORITY) {
    tried.push(source);
    // Lazily fetch the surface the first time an OSM source is reached, then
    // thread it through so we never hit Overpass twice.
    if ((source === "osm_cluster" || source === "osm_grid") && surface === undefined) {
      surface = await generateActivitySurface({
        lat: opts.lat, lon: opts.lon, radiusMi: opts.radiusMi ?? DEFAULT_RADIUS_MI,
      });
    }
    const chosen = await resolveDirectionalDistribution(source, { ...opts, surface });
    if (chosen) return { chosen, tried };
  }
  return null;
}

// ─── Agreement metrics ───────────────────────────────────────────────────────

export type DirectionalAgreement = {
  /** Cosine similarity of the two 8-wedge vectors, 0..1 (1 = identical shape). */
  cosine: number;
  /** Total-variation distance, 0..1 (0 = identical, 1 = disjoint). */
  totalVariation: number;
  /** Sum of absolute percentage-point differences across the 8 wedges. */
  l1: number;
};

/**
 * Compare two directional percent splits. Inputs are treated as distributions
 * (each ≈ sums to 100); both are renormalized so partial/zero vectors compare
 * sanely. Returns all-zero agreement when either side carries no signal.
 */
export function directionalAgreement(
  a: Record<CardinalDirection, number>,
  b: Record<CardinalDirection, number>,
): DirectionalAgreement {
  let sumA = 0, sumB = 0;
  for (const d of CARDINALS) { sumA += a[d]; sumB += b[d]; }
  if (sumA <= 0 || sumB <= 0) return { cosine: 0, totalVariation: 1, l1: 200 };

  let dot = 0, magA = 0, magB = 0, l1 = 0, tv = 0;
  for (const d of CARDINALS) {
    const pa = a[d] / sumA, pb = b[d] / sumB; // normalized fractions
    dot += pa * pb;
    magA += pa * pa;
    magB += pb * pb;
    const diff = Math.abs(pa - pb);
    l1 += diff;
    tv += diff;
  }
  const cosine = magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
  return {
    cosine: Math.round(cosine * 1000) / 1000,
    totalVariation: Math.round((tv / 2) * 1000) / 1000,
    l1: Math.round(l1 * 100 * 10) / 10, // back to percentage points
  };
}
