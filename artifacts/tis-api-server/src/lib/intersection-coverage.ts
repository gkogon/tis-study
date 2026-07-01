/**
 * Study-area coverage primitives — kept in this small, dependency-free leaf
 * module (no local runtime imports) so they can be unit-checked with plain
 * `node` via `scripts/verify-coverage-warning.mjs`, and so the engine and the
 * HTTP routes share ONE source of truth for the "no signals in radius" case.
 *
 * The gap this closes: when a study site's coordinate has no signalized
 * intersection within the study radius (a geocode that lands in open water or
 * outside our signal coverage), the engine used to return a silently-empty
 * "0 intersections" report that reads as a broken product. These helpers let
 * the engine flag that case explicitly so the routes can answer with a clear
 * "verify the site location" message instead.
 */

// Match tis.ts exactly so `distanceMi` values are identical to the engine's.
const EARTH_R_M = 6371000;
const M_PER_MI = 1609.34;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(s));
}

/**
 * Filter an intersection inventory to the signals within `radiusMi` of the
 * site, tagged with their distance and sorted nearest-first. Pure: no fetch,
 * no dedup, no logging — the engine layers its close-signal dedup on top.
 * Dedup never turns a non-empty set empty, so a `.length === 0` result here is
 * an exact proxy for "the study area contained no signals to analyze".
 */
export function intersectionsWithinRadius<T extends { latitude: number; longitude: number }>(
  inventory: T[],
  lat: number,
  lon: number,
  radiusMi: number,
): Array<{ sig: T; distanceMi: number }> {
  const radiusM = radiusMi * M_PER_MI;
  const out: Array<{ sig: T; distanceMi: number }> = [];
  for (const s of inventory) {
    const dM = haversineMeters(lat, lon, s.latitude, s.longitude);
    if (dM <= radiusM) out.push({ sig: s, distanceMi: dM / M_PER_MI });
  }
  out.sort((a, b) => a.distanceMi - b.distanceMi);
  return out;
}

/**
 * A study whose site had no signalized intersection within the study radius —
 * almost always a bad geocode (open water or an uncovered area) rather than a
 * real finding. Carried on the report and surfaced by the routes as a 422.
 */
export type CoverageWarning = {
  code: "no_signals_in_radius";
  /** The study radius that was searched, in miles. */
  radiusMi: number;
  /** User-facing, screening-appropriate explanation + next step. */
  message: string;
};

/**
 * Build a coverage warning when the study area held no signals to analyze.
 * Returns `undefined` for any study that found at least one signal — a single
 * intersection is enough to make the report meaningful.
 */
export function coverageWarningForCandidates(
  candidateCount: number,
  radiusMi: number,
): CoverageWarning | undefined {
  if (candidateCount > 0) return undefined;
  return {
    code: "no_signals_in_radius",
    radiusMi,
    message:
      `No signalized intersections were found within ${radiusMi} mi of this location — ` +
      `the coordinate may have resolved to water or an area we don't cover; verify the site location.`,
  };
}
