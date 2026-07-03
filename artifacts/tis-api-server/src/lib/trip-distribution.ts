// Region-agnostic trip-distribution layer.
// PR1: fully implements the "gravity" strategy (wrapping four-step for most
// regions and Caltran mass/distance for Florida). "analogy" and "surrogate"
// are stubs that fall back to gravity (built in PR2/PR3).
//
// BYTE-IDENTITY CONTRACT: the caller (tis.ts) builds the EXACT demandZones and
// gravityZones it builds today — including refVolume and the
// clamp(mass/refVolume, 0.05, 1.0) baseVoverC. This module NEVER re-derives
// refVolume/baseVoverC; it passes the pre-built zones straight to
// distributeAndAssign / caltranGravityShares so weights are byte-identical to
// origin/main.
//
// Pure leaf module: imports ONLY other pure libs so it loads under Node's
// native TS stripping in the verify-*.mjs check-scripts.
import {
  distributeAndAssign,
  GAMMA_FRICTION,
  type DemandZone,
} from "./four-step-model";
import {
  caltranGravityShares,
  directionalMultipliers,
  rollupByCardinal,
  sectorPairs,
  bearingToCardinal,
  CALTRAN_GRAVITY_BETA,
  type CardinalDir,
  type GravityShare,
} from "./caltran-gravity";

export type DistributionMethod = "gravity" | "analogy" | "surrogate";

export type DistZone = {
  id: string;
  name: string;
  distanceMi: number;
  bearingDeg: number;
  cardinal: CardinalDir;
  mass: number; // gross attraction proxy M
  term: number; // un-normalized pull M/(d^β · d_site)
  weight: number; // Σ = 1 spatial distribution weight
  sharePct: number; // Σ = 100
};

export type TripDistributionSummary = {
  method: DistributionMethod;
  methodLabel: string;
  basis: string;
  betaExponent: number;
  massBasis: string;
  /** Candidate-ordered (aligned 1:1 to ctx.meta / demandZones). Σ ≈ 1. */
  weights: number[];
  /** Candidate-ordered; mean-1; all-1 except FL Caltran directional. */
  loadMultipliers: number[];
  /** SHARE-SORTED (descending sharePct) — matches origin/main flGravity.zones. */
  zones: DistZone[];
  byDirection: Record<CardinalDir, number>; // Σ = 100
  sectors: Record<string, number>; // 4 quadrant pairs, Σ = 100
  provenance?: {
    source: string;
    matched?: string;
    blendWeights?: Record<string, number>;
  };
};

/** Pre-built Caltran gravity zone (mirrors tis.ts gravityZones exactly). */
export type GravityZoneInput = {
  id: string;
  mass: number;
  distanceMi: number;
  bearingDeg: number;
};

/** Display metadata per candidate, candidate-ordered. */
export type DistributionCandidateMeta = {
  id: string;
  name: string;
  distanceMi: number;
  bearingDeg: number;
  mass: number;
};

export type TripDistributionCtx = {
  /** Candidate-ordered display metadata. */
  meta: DistributionCandidateMeta[];
  /** Pre-built by the caller EXACTLY as tis.ts does (with clamped baseVoverC). */
  demandZones: DemandZone[];
  /** Pre-built by the caller EXACTLY as tis.ts does. */
  gravityZones: GravityZoneInput[];
  pmExternalAutoTrips: number;
  isFlorida: boolean;
};

const METHOD_LABEL: Record<DistributionMethod, string> = {
  gravity: "Gravity Model",
  analogy: "Analogous-Site Distribution",
  surrogate: "Surrogate (Market-Area) Distribution",
};

const GRAVITY_MASS_BASIS =
  "intersection through-volume (AADT × K-factor) as the destination-activity attraction proxy";

// Build the region-neutral zone rows + directional rollups.
// weights/terms/masses are CANDIDATE-ORDERED (aligned to ctx.meta). The returned
// zones[] is SHARE-SORTED.
function buildZones(
  ctx: TripDistributionCtx,
  weights: number[],
  terms: number[],
  masses: number[],
): {
  zones: DistZone[];
  byDirection: Record<CardinalDir, number>;
  sectors: Record<string, number>;
} {
  const zones: DistZone[] = ctx.meta.map((c, i) => ({
    id: c.id,
    name: c.name,
    distanceMi: c.distanceMi,
    bearingDeg: c.bearingDeg,
    cardinal: bearingToCardinal(c.bearingDeg),
    mass: masses[i] ?? 0,
    term: terms[i] ?? 0,
    weight: weights[i] ?? 0,
    sharePct: (weights[i] ?? 0) * 100,
  }));
  zones.sort((a, b) => b.sharePct - a.sharePct);

  // Reuse Caltran rollups by expressing each zone as a GravityShare-shaped row.
  const shareRows: GravityShare[] = zones.map((z) => ({
    id: z.id,
    mass: z.mass,
    distanceMi: z.distanceMi,
    bearingDeg: z.bearingDeg,
    term: z.term,
    share: z.weight,
    sharePct: z.sharePct,
  }));
  const byDirection = rollupByCardinal(shareRows);
  const sectors = sectorPairs(byDirection);
  return { zones, byDirection, sectors };
}

// Pure gravity: four-step for non-FL, Caltran mass/distance for FL.
// Consumes the caller's pre-built demandZones/gravityZones — no re-derivation.
function gravityCore(ctx: TripDistributionCtx): {
  weights: number[];
  loadMultipliers: number[];
  terms: number[];
  masses: number[];
  betaExponent: number;
  massBasis: string;
} {
  const n = ctx.meta.length;
  const masses = ctx.meta.map((c) => c.mass);

  if (ctx.isFlorida) {
    const gShares = caltranGravityShares(ctx.gravityZones);
    const gMults = directionalMultipliers(ctx.gravityZones);
    const loadMultipliers = new Array<number>(n).fill(1);
    for (let i = 0; i < gMults.length; i++) {
      loadMultipliers[i] = gMults[i]!.multiplier;
    }
    return {
      weights: gShares.map((s) => s.share),
      loadMultipliers,
      terms: gShares.map((s) => s.term),
      masses,
      betaExponent: CALTRAN_GRAVITY_BETA,
      massBasis: GRAVITY_MASS_BASIS,
    };
  }

  if (n === 0) {
    return { weights: [], loadMultipliers: [], terms: [], masses, betaExponent: 1, massBasis: GRAVITY_MASS_BASIS };
  }

  const fourStep = distributeAndAssign(ctx.demandZones, ctx.pmExternalAutoTrips, {
    gamma: GAMMA_FRICTION.hbw,
  });
  // Zero-mass guard: if four-step produced a degenerate all-zero split, fall to uniform.
  // NOTE: unreachable for n>0 — distributeAndAssign always returns a normalized split
  // (Σ=1, or its own 1/n fallback), so this never fires and never diverges from
  // origin/main's direct `weights = fourStep.weights`. Kept as a defensive net only.
  let weights = fourStep.weights;
  const sum = weights.reduce((s, w) => s + (Number.isFinite(w) ? w : 0), 0);
  if (!(sum > 0)) {
    weights = new Array<number>(n).fill(n > 0 ? 1 / n : 0);
  }
  // Terms are not surfaced by four-step; use weight as the display term proxy.
  return {
    weights,
    loadMultipliers: new Array<number>(n).fill(1),
    terms: weights.map((w) => w),
    masses,
    betaExponent: 1,
    massBasis: GRAVITY_MASS_BASIS,
  };
}

export function computeTripDistribution(
  method: DistributionMethod | undefined,
  ctx: TripDistributionCtx,
): TripDistributionSummary {
  const requested: DistributionMethod = method ?? "gravity";
  const core = gravityCore(ctx);
  const { zones, byDirection, sectors } = buildZones(
    ctx,
    core.weights,
    core.terms,
    core.masses,
  );

  let basis: string;
  if (requested === "gravity") {
    basis = ctx.isFlorida
      ? "Caltran mass/distance gravity model over study-area attraction zones."
      : "NCHRP-716 gamma-friction gravity model (production-constrained) over study-area attraction zones.";
  } else {
    basis =
      `${METHOD_LABEL[requested]} is not yet implemented (PR2/PR3); ` +
      `falling back to the gravity model for this study.`;
  }

  return {
    method: requested,
    methodLabel: METHOD_LABEL[requested],
    basis,
    betaExponent: core.betaExponent,
    massBasis: core.massBasis,
    weights: core.weights,
    loadMultipliers: core.loadMultipliers,
    zones,
    byDirection,
    sectors,
  };
}
