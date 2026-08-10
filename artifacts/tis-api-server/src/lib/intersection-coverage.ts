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
 * Furthest an `additionalStudyPoints` coordinate may sit from an inventory
 * signal and still snap to it. A pasted/clicked point beyond this from every
 * signal is treated as "no match" (skipped) rather than snapping to an
 * unrelated junction far away. ~0.35 mi comfortably covers a coordinate typed
 * to 4 decimals or clicked near — but not on — a junction, while staying well
 * under typical adjacent-signal spacing on an arterial.
 */
export const SNAP_MAX_MI = 0.35;

/** Inputs that force specific study intersections into scope regardless of the
 *  study radius (a reviewer's agreed corridor list). Purely additive. */
export type ForceIncludeInput = {
  /** Analyzer signal IDs to include, matched exactly against inventory `id`. */
  ids?: string[];
  /** Free coordinates snapped to the nearest inventory signal within `snapMaxMi`. */
  points?: Array<{ latitude: number; longitude: number }>;
};

export type ForceIncludeResult<T> = {
  /** Resolved signals, tagged with distance from the SITE, sorted nearest-first.
   *  De-duplicated by signal id (an id and a point that resolve to the same
   *  signal yield one entry). */
  included: Array<{ sig: T; distanceMi: number }>;
  /** Requested ids with no matching signal in the inventory. */
  unmatchedIds: string[];
  /** Points with no inventory signal within `snapMaxMi` (nothing to snap to). */
  unsnappedPoints: Array<{ latitude: number; longitude: number }>;
};

/**
 * Resolve force-include inputs (explicit signal ids + free coordinates) against
 * an intersection inventory, tagging each with its distance from the study site.
 *
 * Pure + deterministic, no fetch/logging — so it can be node-checked and shares
 * the engine's exact haversine. The engine (`findAffectedIntersections`) unions
 * the result with the radius set; this function neither filters by radius nor
 * removes anything, so an empty input yields an empty result and the radius
 * behavior is untouched. Points snap to the single nearest signal within
 * `snapMaxMi`; ids match exactly (analyzer ids are strings). Same-junction
 * collapse against the radius set is left to the engine's `dedupCloseSignals`.
 */
export function forceIncludeIntersections<T extends { id: string; latitude: number; longitude: number }>(
  inventory: T[],
  siteLat: number,
  siteLon: number,
  input: ForceIncludeInput,
  snapMaxMi: number = SNAP_MAX_MI,
): ForceIncludeResult<T> {
  const byId = new Map<string, T>();
  for (const s of inventory) byId.set(s.id, s);

  const picked = new Set<string>();
  const included: Array<{ sig: T; distanceMi: number }> = [];
  const add = (sig: T): void => {
    if (picked.has(sig.id)) return;
    picked.add(sig.id);
    const dM = haversineMeters(siteLat, siteLon, sig.latitude, sig.longitude);
    included.push({ sig, distanceMi: dM / M_PER_MI });
  };

  const unmatchedIds: string[] = [];
  for (const id of input.ids ?? []) {
    const sig = byId.get(id);
    if (sig) add(sig);
    else unmatchedIds.push(id);
  }

  const snapMaxM = snapMaxMi * M_PER_MI;
  const unsnappedPoints: Array<{ latitude: number; longitude: number }> = [];
  for (const p of input.points ?? []) {
    let best: T | null = null;
    let bestM = Infinity;
    for (const s of inventory) {
      const dM = haversineMeters(p.latitude, p.longitude, s.latitude, s.longitude);
      if (dM < bestM) { bestM = dM; best = s; }
    }
    if (best && bestM <= snapMaxM) add(best);
    else unsnappedPoints.push(p);
  }

  included.sort((a, b) => a.distanceMi - b.distanceMi);
  return { included, unmatchedIds, unsnappedPoints };
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

/**
 * Normalize a signal name for equality: trim, collapse internal whitespace,
 * lowercase, and sort the "&"-separated cross-street parts so the label order
 * doesn't matter. The analyzer's auto-naming orders each label by whichever
 * road segment is closest to that node, so the nodes of one divided-highway
 * box junction can carry BOTH "Little Road & State Road 54" AND the flipped
 * "State Road 54 & Little Road" (SR-54 & Little Rd, Pasco County FL). The two
 * labels name the same road pair, hence the same junction.
 */
export function normalizeSignalName(name: string | null | undefined): string {
  const flat = (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!flat.includes(" & ")) return flat;
  return flat.split(" & ").sort().join(" & ");
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
 * Sparse-site fallback: when the study radius contains NO signalized
 * intersection, the engine widens to the nearest {@link NEAREST_FALLBACK_N}
 * signals within {@link NEAREST_FALLBACK_MAX_MI} instead of failing the study.
 * Rural/exurban sites between metro cores routinely sit >1 mi from the nearest
 * signal; the reviewer-meaningful screening set there is the nearest town's
 * junctions, not an empty report. The radius default (analyze EVERYTHING inside
 * the radius) is untouched — the fallback fires only on an empty radius set.
 * 15 mi comfortably reaches the nearest incorporated town's main crossroads in
 * the sparsest covered counties while still refusing genuinely-offshore
 * geocodes (which keep the hard `no_signals_in_radius` 422).
 */
export const NEAREST_FALLBACK_N = 5;
export const NEAREST_FALLBACK_MAX_MI = 15;

/**
 * The nearest `n` inventory signals within `maxMi` of the site, tagged with
 * distance and sorted nearest-first. Pure — same haversine as the radius
 * filter so distances are engine-identical.
 */
export function nearestNIntersections<T extends { latitude: number; longitude: number }>(
  inventory: T[],
  lat: number,
  lon: number,
  n: number = NEAREST_FALLBACK_N,
  maxMi: number = NEAREST_FALLBACK_MAX_MI,
): Array<{ sig: T; distanceMi: number }> {
  const maxM = maxMi * M_PER_MI;
  const all: Array<{ sig: T; distanceMi: number }> = [];
  for (const s of inventory) {
    const dM = haversineMeters(lat, lon, s.latitude, s.longitude);
    if (dM <= maxM) all.push({ sig: s, distanceMi: dM / M_PER_MI });
  }
  all.sort((a, b) => a.distanceMi - b.distanceMi);
  return all.slice(0, n);
}

/**
 * Disclosure carried on a report whose study set came from the nearest-N
 * fallback rather than the radius. Distinct from {@link CoverageWarning}: the
 * study SUCCEEDED, but every analyzed intersection sits beyond the stated
 * radius and the report must say so.
 */
export type CoverageNote = {
  code: "nearest_n_fallback";
  /** The study radius that contained no signals. */
  radiusMi: number;
  /** How many fallback intersections were analyzed. */
  usedCount: number;
  /** Distance to the nearest analyzed intersection, in miles. */
  nearestDistanceMi: number;
  /** Distance to the farthest analyzed intersection, in miles. */
  farthestDistanceMi: number;
  /** User-facing, screening-appropriate disclosure. */
  message: string;
};

/** Build the fallback disclosure from the fallback set actually analyzed. */
export function nearestFallbackNote(
  radiusMi: number,
  used: Array<{ distanceMi: number }>,
): CoverageNote {
  const nearest = used[0]?.distanceMi ?? 0;
  const farthest = used[used.length - 1]?.distanceMi ?? 0;
  return {
    code: "nearest_n_fallback",
    radiusMi,
    usedCount: used.length,
    nearestDistanceMi: Math.round(nearest * 100) / 100,
    farthestDistanceMi: Math.round(farthest * 100) / 100,
    message:
      `No signalized intersections exist within the ${radiusMi} mi study radius of this site; ` +
      `the ${used.length} nearest signalized intersection${used.length === 1 ? "" : "s"} ` +
      `(${nearest.toFixed(1)}–${farthest.toFixed(1)} mi away) are analyzed for screening context instead.`,
  };
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
