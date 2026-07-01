// Project-trip LOADING vs. gravity DISTRIBUTION — pure, dependency-free leaf so
// it can be unit-tested in isolation (tis.ts imports it).
//
// The four-step gravity model answers "where do the project's trips go"
// (destinations), which within a small radius spreads ~uniformly — every signal
// looks equally attractive, so each gets ≈ total/N trips (e.g. ~2 of 115 across
// 119 downtown signals). That is the wrong quantity for INTERSECTION IMPACT:
// every project trip enters and exits at the SITE, so the site-access
// intersection carries essentially the full project volume, and the load decays
// with distance as trips disperse onto the wider network. Using the flat gravity
// share for impact under-loaded the near intersections (≈0 delay everywhere) and
// starved the study-scope selection (nothing cleared the trip threshold, so it
// floored to the nearest 5 even in a dense downtown).
//
// `intersectionLoadFraction` models the pass-through load as a distance decay,
// exp(-d / LOAD_DECAY_MI): ≈1.0 at the access point, ≈0.37 at one decay length,
// ≈0.08 at 0.5 mi. It is a per-intersection loading fraction (NOT a normalized
// distribution — a trip passes through several intersections en route). Used for
// the affected-intersection impact analysis, the sensitivity run, and the
// study-scope selection. The gravity distribution still drives the trip-
// distribution narrative and the network route assignment (where "destination"
// is the correct concept). Screening approximation; a submitted study
// substitutes measured turning-movement counts.

export const LOAD_DECAY_MI = 0.2;

export function intersectionLoadFraction(distanceMi: number): number {
  return Math.exp(-Math.max(0, distanceMi) / LOAD_DECAY_MI);
}
