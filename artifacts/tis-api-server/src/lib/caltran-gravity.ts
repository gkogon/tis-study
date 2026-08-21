/**
 * Caltran gravity model — the Florida TIS trip-distribution standard.
 *
 * Caltran Engineering (author of the HCA Florida Westside Hospital TIS, the
 * reference format for Florida studies) distributes a proposed development's
 * trips to the surrounding zones with a single-constrained GRAVITY MODEL:
 * each zone pulls trips in proportion to its MASS and inversely with its
 * DISTANCE from the site.
 *
 *     term_i  = M_i / (d_i^β · d_site)
 *     share_i = term_i / Σ_x term_x                    (Σ shares = 100%)
 *
 * where
 *   M_i    = the zone's gross attraction (population + employment + dwelling
 *            units) × its net developable fraction  (see `zoneMass`),
 *   d_i    = straight-line distance from the site to the zone (miles),
 *            floored at MIN_ZONE_DISTANCE_MI (0.1 mi) purely as a singularity
 *            guard, so a zone coincident with the site never divides by zero.
 *            The worked worksheet only exercises d_i ≥ 1, so the guard is
 *            outside its domain and cannot move any worksheet value.
 *   d_site = the site zone's own distance normalizer (= 1 in the worksheet).
 *            It is a constant factor in every term, so it cancels out of the
 *            normalized shares; it is kept for worksheet fidelity only.
 *   β      = the distance decay exponent. Conceptually gravity is M / d²
 *            (Newtonian); the worked Caltran worksheet uses the linear product
 *            d_i · d_site, i.e. β = 1. β = 1 is the default here so the module
 *            reproduces the worksheet exactly; pass β = 2 for the M/d² form.
 *
 * The zone shares are then (a) tabulated as the gravity worksheet, (b) rolled
 * up by compass bearing into the directional distribution (NNE+ENE, ESE+SSE,
 * SSW+WSW, WNW+NNW) shown on the aerial figure, and (c) used to orient the
 * project-trip assignment onto the study intersections.
 *
 * This is a screening-grade adaptation: the "zones" are the surrounding study
 * intersections/activity areas (their attraction proxies destination activity),
 * not a calibrated regional TAZ model. It captures the gravity logic — mass
 * pull with distance decay — faithfully to the reference worksheet.
 */

// ---- Compass wedges (eight 45° sectors, matching the aerial figure) --------

export type CardinalDir = "NNE" | "ENE" | "ESE" | "SSE" | "SSW" | "WSW" | "WNW" | "NNW";

/** The eight wedges in clockwise order from due north. */
export const CARDINALS: readonly CardinalDir[] = [
  "NNE", "ENE", "ESE", "SSE", "SSW", "WSW", "WNW", "NNW",
] as const;

/**
 * The four directional-distribution sector pairs labelled on the Caltran
 * aerial figure (each spans a 90° quadrant).
 */
export const SECTOR_PAIRS: Record<string, readonly [CardinalDir, CardinalDir]> = {
  "NNE+ENE": ["NNE", "ENE"],
  "ESE+SSE": ["ESE", "SSE"],
  "SSW+WSW": ["SSW", "WSW"],
  "WNW+NNW": ["WNW", "NNW"],
};

/** Map a compass bearing (0–360°, 0 = due north, clockwise) to its wedge. */
export function bearingToCardinal(bearingDeg: number): CardinalDir {
  const b = ((bearingDeg % 360) + 360) % 360;
  return CARDINALS[Math.floor(b / 45)]!;
}

function zeroByCardinal(): Record<CardinalDir, number> {
  return { NNE: 0, ENE: 0, ESE: 0, SSE: 0, SSW: 0, WSW: 0, WNW: 0, NNW: 0 };
}

// ---- Zone mass -------------------------------------------------------------

/**
 * Gross zone mass M = (population + employment + dwelling units) × net
 * developable fraction, matching the worksheet's "Gross × %Net" column. Any
 * component omitted defaults to 0; `netFraction` defaults to 1 (fully
 * developable). Zone 9 of the reference: 1000 DU × 0.40 net = 400.
 */
export function zoneMass(input: {
  population?: number;
  employment?: number;
  dwellingUnits?: number;
  netFraction?: number;
}): number {
  const gross = (input.population ?? 0) + (input.employment ?? 0) + (input.dwellingUnits ?? 0);
  const net = input.netFraction ?? 1;
  return Math.max(0, gross) * Math.max(0, net);
}

// ---- Gravity distribution --------------------------------------------------

export type GravityZone = {
  id: string;
  /** Gross attraction × net developable fraction (see `zoneMass`). */
  mass: number;
  /** Straight-line distance from the site, miles. */
  distanceMi: number;
  /** Bearing from the site (0–360°, optional) for the cardinal rollup. */
  bearingDeg?: number;
};

export type GravityShare = GravityZone & {
  /** M / (d^β · d_site) — the un-normalized gravity pull. */
  term: number;
  /** Fraction of the development's trips assigned to this zone (Σ = 1). */
  share: number;
  /** `share` as a percentage (Σ = 100). */
  sharePct: number;
};

export type CaltranGravityOpts = {
  /** Distance decay exponent β. Default 1 (worksheet); 2 = conceptual M/d². */
  beta?: number;
  /** Site-zone distance normalizer d_site. Default 1 (matches the worksheet). */
  siteDistanceMi?: number;
};

export const CALTRAN_GRAVITY_BETA = 1;
export const SITE_ZONE_DISTANCE_MI = 1;

/**
 * Singularity guard on zone distances (miles). Historically the floor was
 * `siteDistanceMi` (1 mi) — but at the default 0.5 mi study radius EVERY zone
 * sits below 1 mi, so the floor bound on all of them and the "gravity" shares
 * collapsed to pure mass ratios with zero distance decay. 0.1 mi keeps the
 * decay real across sub-mile study areas while capping the pull of a zone
 * pasted directly on the site coordinate at 10× a 1-mile zone (term ≤ M/0.1).
 * It also matches the API's minimum studyRadiusMi (0.1). The hand-worked
 * Caltran worksheet only uses distances ≥ 1 mi, so any floor in (0, 1] leaves
 * its printed values byte-exact — see verify-caltran-gravity.mjs.
 */
export const MIN_ZONE_DISTANCE_MI = 0.1;

/**
 * Distribute a development's trips across surrounding zones by the Caltran
 * gravity model. Returns each zone with its gravity term and normalized share.
 * Zone distances are floored at `MIN_ZONE_DISTANCE_MI` so a zone coincident
 * with the site (d = 0) never divides by zero; `siteDistanceMi` stays the
 * worksheet's constant denominator (it cancels in share normalization).
 */
export function caltranGravityShares(
  zones: GravityZone[],
  opts: CaltranGravityOpts = {},
): GravityShare[] {
  const beta = opts.beta ?? CALTRAN_GRAVITY_BETA;
  const dSite = opts.siteDistanceMi ?? SITE_ZONE_DISTANCE_MI;
  const rows = zones.map((z) => {
    const d = Math.max(MIN_ZONE_DISTANCE_MI, z.distanceMi);
    const term = Math.max(0, z.mass) / (Math.pow(d, beta) * dSite);
    return { ...z, term };
  });
  const sum = rows.reduce((s, r) => s + r.term, 0);
  return rows.map((r) => {
    const share = sum > 0 ? r.term / sum : 0;
    return { ...r, share, sharePct: share * 100 };
  });
}

// ---- Directional rollup ----------------------------------------------------

/**
 * Roll the zone shares up into the eight compass wedges (percent by wedge,
 * Σ = 100 over the zones that carry a bearing). Zones without a bearing are
 * excluded from the directional figure.
 */
export function rollupByCardinal(shares: GravityShare[]): Record<CardinalDir, number> {
  const out = zeroByCardinal();
  let total = 0;
  for (const s of shares) {
    if (s.bearingDeg == null) continue;
    out[bearingToCardinal(s.bearingDeg)] += s.sharePct;
    total += s.sharePct;
  }
  if (total > 0 && Math.abs(total - 100) > 1e-9) {
    // Re-normalize to 100% across the bearing-carrying zones.
    for (const d of CARDINALS) out[d] = (out[d] / total) * 100;
  }
  return out;
}

/**
 * Collapse the eight wedges into the four quadrant sector pairs labelled on the
 * Caltran aerial figure (NNE+ENE, ESE+SSE, SSW+WSW, WNW+NNW).
 */
export function sectorPairs(byDir: Record<CardinalDir, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [label, [a, b]] of Object.entries(SECTOR_PAIRS)) {
    out[label] = byDir[a] + byDir[b];
  }
  return out;
}

// ---- Directional loading bridge -------------------------------------------

export type DirectionalMultiplier = {
  id: string;
  /** The zone's compass wedge (null if it carries no bearing). */
  cardinal: CardinalDir | null;
  /** Percent of project trips distributed toward this zone's wedge (0–100). */
  dirShare: number;
  /** Loading re-orientation factor; averages to 1 across zones (see below). */
  multiplier: number;
};

/**
 * Per-zone loading multipliers that let the gravity DIRECTION re-orient
 * per-intersection trip loading WITHOUT changing its overall scale.
 *
 * The gravity model tells us what share of project trips heads toward each
 * compass wedge (the directional distribution). Every intersection on a given
 * corridor carries that wedge's trips, so its directional weight is the wedge
 * total. We normalize by the mean wedge-weight across the intersections:
 *
 *     multiplier_i = dirShare(wedge_i) / mean_j dirShare(wedge_j)
 *
 * so the multipliers average to exactly 1. Multiplying an intersection's
 * distance-decay load fraction (trip-loading.ts) by its multiplier concentrates
 * trips toward the high-share directions and thins them from the low-share
 * directions, while leaving the overall near-site loading intact. With uniform
 * surroundings every wedge is equal, every multiplier is 1, and loading is
 * identical to the decay-only model — so the scope-collapse regression that
 * pure-gravity loading caused is never reintroduced.
 */
export function directionalMultipliers(
  zones: GravityZone[],
  opts: CaltranGravityOpts = {},
): DirectionalMultiplier[] {
  const shares = caltranGravityShares(zones, opts);
  const byDir = rollupByCardinal(shares);
  const rows = shares.map((s) => {
    const cardinal = s.bearingDeg == null ? null : bearingToCardinal(s.bearingDeg);
    const dirShare = cardinal == null ? 0 : byDir[cardinal];
    return { id: s.id, cardinal, dirShare };
  });
  const withBearing = rows.filter((r) => r.cardinal != null);
  const meanShare =
    withBearing.length > 0
      ? withBearing.reduce((sum, r) => sum + r.dirShare, 0) / withBearing.length
      : 0;
  return rows.map((r) => ({
    ...r,
    multiplier: r.cardinal != null && meanShare > 0 ? r.dirShare / meanShare : 1,
  }));
}
