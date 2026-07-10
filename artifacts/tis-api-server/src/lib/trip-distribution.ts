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
  /** Candidate-ordered surrounding population+employment activity mass
   *  (Census 2020 + LODES8), computed by the caller (tis.ts) via a lazy
   *  block-group lookup. Used by surrogateCore. Absent/empty ⇒ surrogate
   *  degrades to a road-through-volume-only market-area distribution.
   *  For UK studies this instead carries the WU03EW OD directional affinity. */
  activityMass?: number[];
  /** True when the study region is in the UK. Switches every method's basis /
   *  label to UK references (WebTAG M2 / DMRB gravity, TRICS-comparable analogy,
   *  Census WU03EW journey-to-work catchment) without changing the maths. */
  isUk?: boolean;
  /** Present for a UK surrogate study with Greater-London OD coverage. The
   *  candidate-ordered affinity is supplied via `activityMass`; these fields
   *  carry the provenance the renderer prints. Absent ⇒ UK surrogate degrades to
   *  the road-through-volume market-area distribution (with a UK basis). */
  ukOd?: {
    /** Resolved site MSOA, e.g. "Camden 028 (E02000186)". */
    matched: string;
    /** "outbound" (residential) | "inbound" (employment) | "workplace-mass". */
    direction: string;
    /** True when real OD flows drove the projection (vs. the mass fallback). */
    hasFlows: boolean;
    /** WU03EW attribution string (source + OGL licence). */
    source: string;
  };
};

const METHOD_LABEL: Record<DistributionMethod, string> = {
  gravity: "Gravity Model",
  analogy: "Analogous-Site Distribution",
  surrogate: "Surrogate (Market-Area) Distribution",
};

// UK-facing method labels + basis strings. Selected when ctx.isUk. The maths is
// unchanged; only the citation/framing differs so a UK reviewer reads the correct
// standard (WebTAG / DMRB / TRICS / Census WU03EW) instead of the US sources.
const METHOD_LABEL_UK: Record<DistributionMethod, string> = {
  gravity: "Gravity Model (WebTAG M2 / DMRB)",
  analogy: "Analogous-Site Distribution (TRICS-comparable)",
  surrogate: "Census Journey-to-Work Catchment (2011 WU03EW)",
};

const UK_GRAVITY_BASIS =
  "WebTAG Unit M2 gravity distribution: net car trips are assigned to the study " +
  "network in proportion to junction proximity (volume × distance⁻¹·⁵) over the " +
  "study-area attraction zones. For a submitted Transport Assessment the " +
  "distribution is agreed in the scoping note with the LPA (and TfL in London — " +
  "for schemes affecting the TLRN, TfL's strategic models MoTiON/LoHAM would be " +
  "referenced under the Model Auditing Process).";

const UK_ANALOGY_BASIS =
  "Analogous-site directional distribution: a screening-grade directional-" +
  "concentration pattern by land-use family and area type, oriented to the site's " +
  "primary access corridor. For a submitted UK TA this is replaced by the observed " +
  "distribution of a TRICS multi-modal comparable site (or agreed in the scoping " +
  "note). The pattern used here is publicly derivable by area type and is NOT " +
  "TRICS data (TRICS is licensed and is not redistributed).";

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

// ---- Surrogate (market-area) core (PR3) ----
// Allocates project trips in proportion to a blend of surrounding land-use
// activity (block-group population + employment, Census 2020 + LODES8) and road
// through-volume, distance-decayed. Pure: the caller (tis.ts) supplies the
// per-candidate activity mass via ctx.activityMass (lazy block-group lookup);
// this module never touches the 12 MB TAZ asset. When activity mass is absent
// (non-US, offshore, or the asset is unavailable in the deployment) it degrades
// gracefully to a road-through-volume-only market-area distribution.
const SURROGATE_DECAY_PER_MI = 0.6; // market-area distance decay (gentler than gravity friction)
const SURROGATE_W_ACTIVITY = 0.5;
const SURROGATE_W_VOLUME = 0.5;

function surrogateCore(ctx: TripDistributionCtx): {
  weights: number[];
  loadMultipliers: number[];
  terms: number[];
  masses: number[];
  betaExponent: number;
  massBasis: string;
  basis: string;
  provenance: { source: string; blendWeights: Record<string, number> };
} {
  const n = ctx.meta.length;
  const roadMass = ctx.meta.map((c) => (Number.isFinite(c.mass) && c.mass > 0 ? c.mass : 0));
  const activity =
    ctx.activityMass && ctx.activityMass.length === n
      ? ctx.activityMass.map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
      : null;
  const sumRoad = roadMass.reduce((s, v) => s + v, 0);
  const sumAct = activity ? activity.reduce((s, v) => s + v, 0) : 0;
  const hasActivity = activity != null && sumAct > 0;
  const wAct = hasActivity ? SURROGATE_W_ACTIVITY : 0;
  const wVol = hasActivity ? SURROGATE_W_VOLUME : 1; // road-only fallback

  const raw = ctx.meta.map((c, i) => {
    const normVol = sumRoad > 0 ? roadMass[i]! / sumRoad : (n ? 1 / n : 0);
    const normAct = hasActivity ? activity![i]! / sumAct : 0;
    const blended = wVol * normVol + wAct * normAct;
    const decay = Math.exp(-SURROGATE_DECAY_PER_MI * c.distanceMi);
    const r = blended * decay;
    return Number.isFinite(r) ? r : 0;
  });
  const rawSum = raw.reduce((s, v) => s + v, 0);
  const weights = rawSum > 0 ? raw.map((r) => r / rawSum) : new Array<number>(n).fill(n ? 1 / n : 0);

  return {
    weights,
    loadMultipliers: new Array<number>(n).fill(1),
    terms: raw,
    // Display the market-area activity mass when available, else the road mass.
    masses: activity ?? roadMass,
    betaExponent: 1,
    massBasis: hasActivity
      ? "market-area attraction: surrounding block-group population + employment (Census 2020 Centers of Population + LEHD LODES8) blended 50/50 with road through-volume, distance-decayed"
      : "market-area attraction from road through-volume (Census population/employment layer unavailable for this site), distance-decayed",
    basis: hasActivity
      ? "Surrogate market-area distribution: net project trips allocated in proportion to a 50/50 blend of surrounding population + employment (Census 2020 + LEHD LODES8) and road through-volume, with distance decay. Screening-grade; replace with a calibrated regional travel-demand model or an O-D study before formal submittal."
      : "Surrogate market-area distribution from road through-volume (the Census population/employment layer was unavailable for this site), with distance decay. Screening-grade; replace with a calibrated regional model or an O-D study before formal submittal.",
    provenance: {
      source: hasActivity
        ? "surrogate market-area (Census block-group population+employment × road through-volume)"
        : "surrogate market-area (road through-volume only; Census population/employment layer unavailable)",
      blendWeights: { population_employment: wAct, road_volume: wVol },
    },
  };
}

export function computeTripDistribution(
  method: DistributionMethod | undefined,
  ctx: TripDistributionCtx,
): TripDistributionSummary {
  const requested: DistributionMethod = method ?? "gravity";

  // ---- Florida override ----
  // Florida uses the adopted Caltran mass/distance gravity model as its
  // distribution standard, and the FL renderer documents Caltran gravity
  // verbatim. Running analogy/surrogate weights under a FL report would make the
  // document internally contradictory (gravity narrative, non-gravity weights).
  // So for FL, a non-gravity selection is overridden back to gravity, with a
  // transparent note. (method === "gravity"/unset never enters here → byte-
  // identity preserved.)
  if (ctx.isFlorida && requested !== "gravity") {
    const core = gravityCore(ctx);
    const { zones, byDirection, sectors } = buildZones(ctx, core.weights, core.terms, core.masses);
    return {
      method: "gravity",
      methodLabel: METHOD_LABEL.gravity,
      basis:
        "Caltran mass/distance gravity model over study-area attraction zones. " +
        `(Florida uses the adopted Caltran gravity distribution standard; the selected ${METHOD_LABEL[requested]} does not apply to Florida studies.)`,
      betaExponent: core.betaExponent,
      massBasis: core.massBasis,
      weights: core.weights,
      loadMultipliers: core.loadMultipliers,
      zones,
      byDirection,
      sectors,
    };
  }

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
      methodLabel: ctx.isUk ? METHOD_LABEL_UK[requested] : METHOD_LABEL[requested],
      basis: ctx.isUk ? UK_ANALOGY_BASIS : core.basisFromPattern,
      betaExponent: core.betaExponent,
      massBasis: core.massBasis,
      weights: core.weights,
      loadMultipliers: core.loadMultipliers,
      zones,
      byDirection,
      sectors,
      provenance: ctx.isUk
        ? { source: "publicly-derivable directional pattern by land-use × area-type (NOT TRICS data); replace with a TRICS comparable site at submittal", matched: core.provenance.matched }
        : core.provenance,
    };
  }

  // ---- Surrogate (market-area) path (PR3; UK → Census journey-to-work catchment) ----
  if (requested === "surrogate") {
    const core = surrogateCore(ctx);
    const { zones, byDirection, sectors } = buildZones(
      ctx,
      core.weights,
      core.terms,
      core.masses,
    );
    // UK: the surrogate is the Census journey-to-work catchment. When Greater-
    // London OD coverage resolved (ctx.ukOd), the candidate affinity supplied via
    // ctx.activityMass is the WU03EW commuter-flow projection; otherwise UK
    // degrades to the road-through-volume market-area distribution.
    if (ctx.isUk) {
      const od = ctx.ukOd;
      const ukMassBasis = od && od.hasFlows
        ? `2011 Census WU03EW ${od.direction} commuter flows for the site MSOA (${od.matched}), car mode, projected onto each study-intersection bearing and distance-decayed`
        : "market-area attraction from road through-volume (the Census journey-to-work catchment was unavailable for this site — outside Greater London coverage), distance-decayed";
      const ukBasis = od && od.hasFlows
        ? `Census journey-to-work catchment: net car trips are allocated using the 2011 Census WU03EW commuter flows for the site MSOA (${od.matched}, ${od.direction} flows), projected onto the study intersections and distance-decayed. Screening-grade; for a submitted TA the distribution is agreed in the scoping note (and, in London, informed by TfL gateline / model data). Source: ${od.source}.`
        : "Census journey-to-work catchment unavailable for this site (outside Greater London coverage); the market-area distribution falls back to road through-volume with distance decay. Screening-grade; agree the distribution in the TA scoping note.";
      return {
        method: requested,
        methodLabel: METHOD_LABEL_UK[requested],
        basis: ukBasis,
        betaExponent: core.betaExponent,
        massBasis: ukMassBasis,
        weights: core.weights,
        loadMultipliers: core.loadMultipliers,
        zones,
        byDirection,
        sectors,
        provenance: {
          source: od && od.hasFlows
            ? "ONS 2011 Census WU03EW journey-to-work origin-destination (nomis NM_1208_1), Greater London"
            : "road through-volume market-area (Census journey-to-work catchment unavailable — outside Greater London)",
          ...(od ? { matched: od.matched } : {}),
        },
      };
    }
    return {
      method: requested,
      methodLabel: METHOD_LABEL[requested],
      basis: core.basis,
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
  const core = gravityCore(ctx);
  const { zones, byDirection, sectors } = buildZones(
    ctx,
    core.weights,
    core.terms,
    core.masses,
  );

  const basis = ctx.isUk
    ? UK_GRAVITY_BASIS
    : ctx.isFlorida
      ? "Caltran mass/distance gravity model over study-area attraction zones."
      : "NCHRP-716 gamma-friction gravity model (production-constrained) over study-area attraction zones.";

  return {
    method: requested,
    methodLabel: ctx.isUk ? METHOD_LABEL_UK[requested] : METHOD_LABEL[requested],
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
