/**
 * Four-step travel demand model (site-impact adaptation).
 *
 * The classic urban-transportation modeling process (FHWA; NCHRP Report
 * 716 "Travel Demand Forecasting: Parameters and Techniques") runs four
 * sequential steps:
 *
 *   1. Trip Generation  — how many trips a zone produces/attracts. For a
 *      TIS the site is the production zone; productions = the period's
 *      external (post pass-by / internal-capture) trips from the
 *      public-data land-use rates (land-uses.ts).
 *   2. Trip Distribution — where the trips go, via the GRAVITY MODEL:
 *          T_ij = P_i · (A_j · F_ij · K_ij) / Σ_x (A_x · F_ix · K_ix)
 *      where A_j is zone j's attractiveness, F_ij the friction factor
 *      (impedance decay), K_ij a socioeconomic factor (=1 here). Trips
 *      grow with destination size and decay with travel time between zones.
 *   3. Mode Choice      — the share by auto vs transit/walk/bike. Applied
 *      as the metro's measured auto-mode share (ACS B08301); only auto
 *      trips load the roadway network.
 *   4. Route Assignment — which links carry the trips. A capacity-
 *      constrained assignment using the BPR volume-delay function shifts
 *      trips away from congested destinations toward less-congested
 *      alternatives (Wardrop-style equilibrium behavior).
 *
 * Friction factor — NCHRP 716 / 365 recommend the GAMMA function
 *      F(t) = a · t^b · e^(c·t)
 * with home-based-work coefficients a=28507, b=-0.02, c=-0.123 (peak-hour
 * TIS trips are work-dominated). This is a true impedance-decay friction
 * factor, not a bare inverse-power.
 *
 * BPR volume-delay (route assignment) — t = t0 · [1 + α·(v/c)^β], the
 * Bureau of Public Roads function with the standard α=0.15, β=4.
 *
 * This is a SCREENING-grade adaptation: a single production zone (the
 * site) distributed over surrounding signalized intersections used as
 * attraction zones (their through-volume proxies destination activity),
 * not a calibrated regional TAZ model. It captures the four-step logic —
 * gravity distribution + congestion-aware assignment — without a regional
 * O-D survey or network skim.
 */

/** NCHRP 365/716 gamma friction-factor coefficients by trip purpose. */
export const GAMMA_FRICTION = {
  // Home-Based Work — the default for peak-hour TIS analysis.
  hbw: { a: 28507, b: -0.02, c: -0.123 },
  // Home-Based Other.
  hbo: { a: 139173, b: -1.285, c: -0.094 },
  // Non-Home-Based.
  nhb: { a: 219113, b: -1.332, c: -0.100 },
} as const;

export type GammaCoeffs = { a: number; b: number; c: number };

/**
 * NCHRP gamma friction factor F(t) = a · t^b · e^(c·t). Higher = less
 * impedance = more attractive. `tMin` is travel time in minutes.
 */
export function gammaFriction(tMin: number, k: GammaCoeffs = GAMMA_FRICTION.hbw): number {
  const t = Math.max(0.1, tMin);
  return k.a * Math.pow(t, k.b) * Math.exp(k.c * t);
}

/** BPR volume-delay: congested time = free-flow · [1 + α·(v/c)^β]. */
export function bprTime(freeFlowMin: number, vOverC: number, alpha = 0.15, beta = 4): number {
  return freeFlowMin * (1 + alpha * Math.pow(Math.max(0, vOverC), beta));
}

// ---- Step 3: Mode choice (binary multinomial logit) --------------------

export type ModeSplit = {
  auto: number;     // auto-mode share (0..1)
  transit: number;  // transit + active share (0..1) — non-auto
  /** Density index used (0 = greenfield … 1 = dense urban core). */
  densityIndex: number;
  /** Auto utility vs the non-auto alternative (for transparency). */
  autoUtility: number;
};

/**
 * Mode choice as a binary logit between AUTO and a NON-AUTO composite
 * (transit + walk + bike), calibrated to the metro's measured auto-mode
 * share (ACS B08301) and made responsive to SITE URBANITY.
 *
 * The flat metro share treats a downtown parcel and a greenfield parcel
 * identically; in reality a denser, more walkable/transit-served site
 * shifts mode split away from auto. We capture that intra-metro variation
 * with a generalized-cost term that rises with local density (a proxy for
 * parking cost + transit/walk competitiveness):
 *
 *   P(auto) = 1 / (1 + e^-(ASC − λ·ΔGC(density)))
 *
 * ASC is calibrated so a site at the metro-median density (index 0.5)
 * reproduces the measured auto share exactly; denser sites fall below it,
 * sparser sites rise toward it. λ and the density-cost slope are tuned for
 * a bounded ±~0.12 swing and the result is clamped to a sane range. This
 * is a screening logit — parking and transit level-of-service use density
 * as a proxy rather than measured per-site LOS skims.
 */
export function modeChoiceLogit(
  measuredAutoShare: number,
  densityIndex: number,
  opts: { lambda?: number; costSlope?: number; transitAccess?: number } = {},
): ModeSplit {
  const anchor = Math.min(0.98, Math.max(0.05, measuredAutoShare));
  // When measured transit accessibility is available (transit LOS from the
  // stops/routes near the site), blend it with the volume-density proxy for
  // a stronger urbanity signal; otherwise density alone.
  const d = opts.transitAccess != null
    ? Math.min(1, Math.max(0, 0.5 * densityIndex + 0.5 * Math.min(1, Math.max(0, opts.transitAccess))))
    : Math.min(1, Math.max(0, densityIndex));
  const lambda = opts.lambda ?? 1.0;
  const costSlope = opts.costSlope ?? 1.1; // utility units across density 0→1
  // ΔGC relative to the median-density reference (0.5). Denser ⇒ higher
  // auto generalized cost (parking) ⇒ lower auto utility.
  const dGcRef = (0.5 - 0.5) * costSlope;        // = 0 (reference)
  const dGcSite = (d - 0.5) * costSlope;
  // Calibrate ASC so P(auto) = anchor at the reference density.
  const asc = Math.log(anchor / (1 - anchor)) + lambda * dGcRef;
  const v = asc - lambda * dGcSite;
  let auto = 1 / (1 + Math.exp(-v));
  auto = Math.min(0.98, Math.max(0.05, auto));
  return { auto, transit: 1 - auto, densityIndex: d, autoUtility: Math.round(v * 1000) / 1000 };
}

export type DemandZone = {
  id: string;
  /** Trip attractiveness proxy (destination activity ~ through-volume). */
  attraction: number;
  /** Free-flow distance from the site, miles. */
  distanceMi: number;
  /** Existing volume-to-capacity ratio at the zone (0..1+), for BPR. */
  baseVoverC: number;
};

export type ZoneShare = {
  id: string;
  share: number;            // fraction of productions assigned (Σ = 1)
  travelTimeMin: number;    // free-flow
  congestedTimeMin: number; // after BPR
  frictionFactor: number;
  vOverC: number;           // after project trips loaded
};

export type FourStepParams = {
  /** Free-flow assignment speed (mph) used to convert distance → time. */
  speedMph?: number;
  /** Gamma coefficients (purpose). */
  gamma?: GammaCoeffs;
  /** Capacity-feedback iterations (route assignment). */
  iterations?: number;
  /** BPR parameters. */
  alpha?: number;
  beta?: number;
  /** Nominal peak-hour capacity (vph) a zone's v/c is normalized against. */
  nominalCapacityVph?: number;
};

export type FourStepDistribution = {
  weights: number[];     // aligned to the input zones order; Σ = 1
  zones: ZoneShare[];    // same order, with diagnostics
  params: Required<FourStepParams>;
};

const DEFAULTS: Required<FourStepParams> = {
  speedMph: 25,
  gamma: GAMMA_FRICTION.hbw,
  iterations: 4,
  alpha: 0.15,
  beta: 4,
  nominalCapacityVph: 1800,
};

/**
 * Steps 2 + 4: gravity-model trip distribution with a BPR capacity-
 * constrained route assignment. Returns the normalized share of the
 * site's (mode-split) productions assigned to each zone.
 *
 * Iterates: distribute by gravity using current congested travel times →
 * load project trips → recompute each zone's v/c → recompute congested
 * times → redistribute. Over iterations, trips shed from over-capacity
 * zones to less-congested alternatives, converging toward an equilibrium
 * where the assignment is congestion-consistent.
 */
export function distributeAndAssign(
  zones: DemandZone[],
  productions: number,
  params: FourStepParams = {},
): FourStepDistribution {
  const p = { ...DEFAULTS, ...params, gamma: params.gamma ?? DEFAULTS.gamma };
  const n = zones.length;
  if (n === 0) return { weights: [], zones: [], params: p };

  const freeTime = zones.map((z) => (Math.max(0.06, z.distanceMi) / p.speedMph) * 60);
  // Working v/c per zone, seeded from existing conditions; grows as project
  // trips are loaded across iterations.
  let vc = zones.map((z) => Math.max(0, z.baseVoverC));
  let shares = new Array<number>(n).fill(1 / n);

  for (let iter = 0; iter < p.iterations; iter++) {
    // Congested impedance and friction for the current v/c.
    const congTime = freeTime.map((t0, i) => bprTime(t0, vc[i]!, p.alpha, p.beta));
    const friction = congTime.map((t) => gammaFriction(t, p.gamma));
    // Gravity weights: attraction × friction.
    const raw = zones.map((z, i) => Math.max(0, z.attraction) * friction[i]!);
    const sum = raw.reduce((s, v) => s + v, 0);
    shares = sum > 0 ? raw.map((v) => v / sum) : raw.map(() => 1 / n);
    // Load this iteration's project trips and refresh v/c for the next pass.
    vc = zones.map((z, i) => {
      const projectVph = productions * shares[i]!;
      return Math.max(0, z.baseVoverC) + projectVph / p.nominalCapacityVph;
    });
  }

  const congTime = freeTime.map((t0, i) => bprTime(t0, vc[i]!, p.alpha, p.beta));
  const friction = congTime.map((t) => gammaFriction(t, p.gamma));
  const zoneShares: ZoneShare[] = zones.map((z, i) => ({
    id: z.id,
    share: shares[i]!,
    travelTimeMin: Math.round(freeTime[i]! * 100) / 100,
    congestedTimeMin: Math.round(congTime[i]! * 100) / 100,
    frictionFactor: Math.round(friction[i]! * 100) / 100,
    vOverC: Math.round(vc[i]! * 1000) / 1000,
  }));
  return { weights: shares, zones: zoneShares, params: p };
}
