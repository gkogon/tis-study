/**
 * Study-area coverage + close-signal dedup primitives — kept in this small,
 * dependency-free leaf module (no local runtime imports) so they can be
 * unit-checked with plain `node` (`scripts/verify-coverage-warning.mjs`,
 * `scripts/verify-name-dedup.mjs`), and so the engine and the HTTP routes
 * share ONE source of truth for the "no signals in radius" case.
 *
 * The gap this closes: when a study site's coordinate has no signalized
 * intersection within the study radius (a geocode that lands in open water or
 * outside our signal coverage), the engine used to return a silently-empty
 * "0 intersections" report that reads as a broken product. These helpers let
 * the engine flag that case explicitly so the routes can answer with a clear
 * "verify the site location" message instead.
 *
 * `dedupCloseSignals` collapses records for the SAME physical junction; the
 * engine (`tis.ts`) wraps it to attach telemetry. Pure here so its distance
 * ceilings can be regression-tested without a running analyzer.
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
 * no logging — the engine layers `dedupCloseSignals` (below) on top.
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
 * Signals this close are treated as the SAME physical junction regardless of
 * name (divided-arterial carriageway crossings, OSM way-splits, big-junction
 * node boxes typically sit 5–45 m apart).
 */
export const DEDUP_DISTANCE_M = 45;

/**
 * Identical-name signals merge only when they're also within this ceiling.
 *
 * The name rule exists to catch same-junction records that sit just BEYOND the
 * 45 m distance threshold: a divided arterial crossing a divided arterial is
 * modeled by OSM as a box of nodes with one identical cross-street name that
 * can span up to ~150 m (measured in the Miami-Dade inventory: e.g. "Federal
 * Highway & Pembroke Road" spans 148 m as a single junction). Without a ceiling
 * the name rule fired at ANY distance, which over-collapsed physically DISTINCT
 * junctions that merely share a generic OSM block name ("Near SW 24th Street"
 * repeats on 40+ nodes; two real "SW 62nd Ave & S Dixie Hwy" junctions ~200 m
 * apart). 150 m is the empirical boundary between the divided-arterial regime
 * (≤150 m, same junction) and the distinct-junction regime (>150 m): ~69% of
 * same-name pairs county-wide are >150 m apart and are genuinely separate.
 */
export const NAME_DEDUP_MAX_M = 150;

/** Normalize a signal name for equality: trim, collapse internal whitespace, lowercase. */
export function normalizeSignalName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Two signals share the "same" name when both carry an identical, non-empty normalized name. */
export function sameSignalName(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeSignalName(a);
  return na.length > 0 && na === normalizeSignalName(b);
}

export type DedupResult<T> = {
  /** Surviving signals, one per physical junction, in the input's distance order. */
  kept: Array<{ sig: T; distanceMi: number }>;
  /** Records absorbed into a kept signal (the duplicates that were removed). */
  merged: Array<{ sig: T; distanceMi: number }>;
  /**
   * How many merges fired on the NAME rule beyond {@link DEDUP_DISTANCE_M}
   * (i.e. same-name signals 45–{@link NAME_DEDUP_MAX_M} apart). Telemetry so the
   * effect of the name-based absorb — and the ceiling that now bounds it — is
   * observable in production logs.
   */
  nameAbsorbedBeyond45m: number;
};

/**
 * Collapse signal records that represent the SAME physical junction into one
 * row, so a single intersection doesn't double-count in the report. Two common
 * causes of duplication:
 *
 *   1. **Divided arterials** — OSM models one intersection where the two halves
 *      of a divided arterial cross a side street as TWO signal records, one per
 *      carriageway, 15–45 m apart with identical street names.
 *   2. **OSM way-splits / big-junction boxes** — an intersection on a road
 *      tagged as multiple OSM `way` records (lanes, frontage road, ramps) can
 *      register as several "signals" spanning up to ~150 m with one name.
 *
 * Strategy: walk candidates nearest-to-site first so the closest record in each
 * cluster wins. Absorb a candidate into an already-kept signal when it is either
 * physically co-located (≤{@link DEDUP_DISTANCE_M}) OR shares an identical name
 * AND is within {@link NAME_DEDUP_MAX_M}. The distance ceiling on the name rule
 * is what keeps distinct junctions that merely share a generic block name apart.
 *
 * Pure + deterministic: no fetch, no logging. Caltran flagged the dupe-road
 * behavior in their meeting feedback; the ≤45 m + bounded-name rule is the fix.
 */
export function dedupCloseSignals<T extends { name: string; latitude: number; longitude: number }>(
  candidates: Array<{ sig: T; distanceMi: number }>,
): DedupResult<T> {
  const kept: Array<{ sig: T; distanceMi: number }> = [];
  const merged: Array<{ sig: T; distanceMi: number }> = [];
  let nameAbsorbedBeyond45m = 0;
  for (const c of candidates) {
    let absorbed = false;
    for (const k of kept) {
      const dM = haversineMeters(c.sig.latitude, c.sig.longitude, k.sig.latitude, k.sig.longitude);
      const byDistance = dM <= DEDUP_DISTANCE_M;
      // Name rule fires only for genuinely co-located same-name records now.
      const byName = !byDistance && dM <= NAME_DEDUP_MAX_M && sameSignalName(c.sig.name, k.sig.name);
      if (byDistance || byName) {
        absorbed = true;
        if (byName) nameAbsorbedBeyond45m += 1;
        break;
      }
    }
    if (absorbed) merged.push(c);
    else kept.push(c);
  }
  return { kept, merged, nameAbsorbedBeyond45m };
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
