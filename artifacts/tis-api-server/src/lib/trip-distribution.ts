// Region-agnostic trip-distribution layer.
// PR1: fully implements the "gravity" strategy (wrapping four-step for most
// regions and Caltran mass/distance for Florida). PR2 implements "analogy"
// (curated ComparableSource reference library). "surrogate" remains a stub
// (PR3).
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
  CARDINALS,
  CALTRAN_GRAVITY_BETA,
  type CardinalDir,
  type GravityShare,
} from "./caltran-gravity";
import {
  REFERENCE_LIBRARY,
  landUseFamily,
  areaTypeFromDensity,
} from "./analogy-reference";

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
  /** ITE-style land-use code string (e.g. "820", "710"). Used by analogyCore. */
  landUseCode: string;
  /** Density index 0–1 (medianVol / 30 k). Used by analogyCore. */
  densityIndex: number;
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

// ---------------------------------------------------------------------------
// Analogy core — curated ComparableSource reference library
// ---------------------------------------------------------------------------

/**
 * Distribute trips using the analogous-site method.
 *
 * Orientation logic:
 *   1. Find the "dominant" candidate zone — the one with the largest mass
 *      (ties broken by smallest distanceMi; all-zero-mass → nearest by
 *      distanceMi).
 *   2. Look up the dominant zone's compass octant in CARDINALS (index 0–7,
 *      clockwise from NNE).
 *   3. For every candidate, compute its octant offset relative to the dominant
 *      octant: offset = (candidateOctant − dominantOctant + 8) % 8.
 *   4. raw_i = profile[offset] × exp(−decayPerMile × distanceMi_i).
 *   5. Normalize to weights Σ = 1 (uniform 1/n fallback if Σ ≤ 0).
 *
 * The curated AnalogyPattern captures the planning rationale: denser settings
 * produce a flatter distribution (trips arrive from all directions) while
 * sparser settings concentrate trips along the primary access corridor.
 * The distance-decay term further penalizes attraction from far-flung zones,
 * mimicking observed trip-length distributions by land-use type.
 *
 * Returns gravityCore-compatible fields PLUS provenance (source + matched).
 */
function analogyCore(ctx: TripDistributionCtx): {
  weights: number[];
  loadMultipliers: number[];
  terms: number[];
  masses: number[];
  betaExponent: number;
  massBasis: string;
  provenance: { source: string; matched: string };
  basisFromPattern: string;
} {
  const n = ctx.meta.length;
  const masses = ctx.meta.map((c) => c.mass);

  // Resolve land-use family and area type from context.
  const family = landUseFamily(ctx.landUseCode);
  const areaType = areaTypeFromDensity(ctx.densityIndex);
  const match = REFERENCE_LIBRARY.find(family, areaType)!; // never null for valid inputs

  if (n === 0) {
    return {
      weights: [],
      loadMultipliers: [],
      terms: [],
      masses,
      betaExponent: 1,
      massBasis: "analogous-site directional concentration (screening-grade), oriented to the site's primary access corridor",
      provenance: {
        source: "curated reference library (land-use family × area-type); library-now/DB-later",
        matched: match.matched,
      },
      basisFromPattern: match.pattern.basis,
    };
  }

  const { profile, decayPerMile } = match.pattern;

  // ---- Identify dominant octant ----
  // Primary sort: largest mass. Tie-break: smallest distanceMi.
  // All-zero-mass fallback: nearest by distanceMi.
  let domIdx = 0;
  const allZeroMass = masses.every((m) => !(m > 0));
  if (allZeroMass) {
    // Nearest by distanceMi.
    for (let i = 1; i < n; i++) {
      if (ctx.meta[i]!.distanceMi < ctx.meta[domIdx]!.distanceMi) domIdx = i;
    }
  } else {
    for (let i = 1; i < n; i++) {
      const mi = masses[i] ?? 0;
      const md = ctx.meta[i]!.distanceMi;
      const mdom = masses[domIdx] ?? 0;
      const ddom = ctx.meta[domIdx]!.distanceMi;
      if (mi > mdom || (mi === mdom && md < ddom)) domIdx = i;
    }
  }

  // Dominant candidate's octant index in CARDINALS (0–7).
  const domOctant = CARDINALS.indexOf(bearingToCardinal(ctx.meta[domIdx]!.bearingDeg));

  // ---- Compute raw pulls ----
  const raw: number[] = ctx.meta.map((c) => {
    const candOctant = CARDINALS.indexOf(bearingToCardinal(c.bearingDeg));
    const offset = ((candOctant - domOctant) + 8) % 8;
    const profileWeight = profile[offset] ?? 1;
    const decay = Math.exp(-decayPerMile * c.distanceMi);
    const r = profileWeight * decay;
    return Number.isFinite(r) ? r : 0;
  });

  // ---- Normalize to Σ = 1 ----
  const rawSum = raw.reduce((s, v) => s + v, 0);
  const weights = rawSum > 0
    ? raw.map((r) => r / rawSum)
    : new Array<number>(n).fill(1 / n);

  return {
    weights,
    loadMultipliers: new Array<number>(n).fill(1),
    terms: raw,
    masses,
    betaExponent: 1,
    massBasis: "analogous-site directional concentration (screening-grade), oriented to the site's primary access corridor",
    provenance: {
      source: "curated reference library (land-use family × area-type); library-now/DB-later",
      matched: match.matched,
    },
    basisFromPattern: match.pattern.basis,
  };
}

export function computeTripDistribution(
  method: DistributionMethod | undefined,
  ctx: TripDistributionCtx,
): TripDistributionSummary {
  const requested: DistributionMethod = method ?? "gravity";

  // ---- Analogy path (PR2) ----
  if (requested === "analogy") {
    const core = analogyCore(ctx);
    const { zones, byDirection, sectors } = buildZones(
      ctx,
      core.weights,
      core.terms,
      core.masses,
    );
    return {
      method: requested,
      methodLabel: METHOD_LABEL[requested],
      basis: core.basisFromPattern,
      betaExponent: core.betaExponent,
      massBasis: core.massBasis,
      weights: core.weights,
      loadMultipliers: core.loadMultipliers,
      zones,
      byDirection,
      sectors,
      provenance: core.provenance,
    };
  }

  // ---- Gravity path (PR1) — UNCHANGED; byte-identity preserved ----
  // "surrogate" stub also falls through here (PR3).
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
    // "surrogate" stub (PR3)
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
