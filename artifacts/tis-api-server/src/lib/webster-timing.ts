/**
 * Volume-responsive signal timing: Webster optimum cycle length + the Critical
 * Movement Method for green splits.
 *
 * WHY THIS EXISTS. Every study in every metro has been analyzed at a flat 90 s
 * cycle and g/C 0.45 (signal-delay.ts CYCLE_LEN / G_OVER_C), regardless of how
 * much traffic the intersection actually carries. A quiet collector and a
 * saturated arterial got identical timing. That is the single largest
 * unrealism left in the screening model, and unlike measured timing it is
 * fixable with data we already have — the approach volumes.
 *
 * WHY NOT MEASURED TIMING. A 2026-08-28 sweep of every metro this product
 * serves found NO open per-intersection timing feed. Austin publishes the
 * richest signal dataset in the country (1,343 signals, 50 columns, refreshed
 * daily) with ZERO timing fields — no cycle, no split, no offset. Chicago's
 * "Traffic Signal Timing" dataset is a program tracker. GDOT's ATSPM portal
 * does not expose cycle/split. OpenStreetMap's timing tags are unpopulated.
 * Utah DOT runs a genuinely open ATSPM API, but Utah is not a served metro.
 * Timing plans exist, but as records requests and PDF appendices — not feeds.
 *
 * SOURCE. FHWA-HOP-07-006, "Signal Timing on a Shoestring" (R.D. Henry, FHWA
 * Office of Operations, March 2005). A US Government work: public domain, no
 * copyright, no license. That matters here — it is a citation anchor with none
 * of the licensing exposure attached to other signal-timing references.
 *
 * ⚠️ DELIBERATELY NOT IMPLEMENTED: the Quick Estimation Method cycle equation
 * that appears in FHWA-HOP-08-024 §6. It is HCM-derived, and HCM was stripped
 * from this product. Only the Webster and Critical Movement content below is
 * used, and both predate and stand outside that manual.
 */

import { CYCLE_LEN, G_OVER_C, SATURATION_FLOW_VPH } from "./signal-delay";

/** Lost time per critical phase, seconds. HOP-07-006 uses 5 s. */
export const LOST_TIME_PER_PHASE_S = 5;

/**
 * Cycle bounds. HOP-07-006 gives 60 s as the practical starting cycle for a
 * two-phase signal, and FHWA guidance elsewhere prefers <= 120 s for a
 * conventional four-legged intersection (beyond ~120 s the capacity return
 * flattens to a couple of percent while every driver's delay grows).
 */
export const MIN_CYCLE_S = 60;
export const MAX_CYCLE_S = 120;

/**
 * Webster destabilizes as the intersection approaches saturation — the
 * (1 - Y) denominator sends the cycle to infinity — and HOP-07-006 says so
 * outright. Above this critical-flow-ratio sum we stop trusting the formula
 * and report the screening default instead of an absurd cycle.
 */
export const MAX_CRITICAL_FLOW_RATIO = 0.85;

export type SignalTiming = {
  cycleLenS: number;
  /** Effective green ratio for the north-south critical phase. */
  gOverCns: number;
  /** Effective green ratio for the east-west critical phase. */
  gOverCew: number;
  /** Sum of critical flow ratios (Webster's Y). */
  criticalFlowRatio: number;
  /**
   * How this timing was derived, so the report can say. "webster" = computed;
   * "measured" = a cycle length came from an imported Synchro record;
   * "screening-default" = volumes were missing or the intersection is at or beyond
   * saturation and Webster is not applicable.
   */
  basis: "webster" | "measured" | "screening-default";
};

const SCREENING_DEFAULT: SignalTiming = {
  cycleLenS: CYCLE_LEN,
  gOverCns: G_OVER_C,
  gOverCew: G_OVER_C,
  criticalFlowRatio: 0,
  basis: "screening-default",
};

/** Round up to the next 5 s, per HOP-07-006's "round to next highest 5 s". */
function roundUpTo5(x: number): number {
  return Math.ceil(x / 5) * 5;
}

/**
 * Compute cycle length and green splits from approach volumes.
 *
 * The engine models a two-phase signal (north-south, east-west), so the
 * critical lane volume for each phase is the heavier of its two approaches —
 * the movement that governs how much green that phase needs.
 *
 * @param approachVph volumes by approach, vph. Missing/zero approaches are
 *        treated as absent rather than as zero-volume legs.
 * @param measuredCycleS a cycle length from an imported Synchro record. When
 *        present it WINS — a real controller value beats a computed one — and
 *        only the splits are computed.
 * @param saturationFlowVph per-lane saturation flow. Defaults to the engine
 *        constant so this module cannot silently re-baseline capacity.
 *        (HOP-07-006 says 1,900 is typical; the engine has always used 1,800
 *        and changing that is a separate decision, not a side effect of this.)
 */
export function computeSignalTiming(args: {
  approachVph: Partial<Record<"NB" | "SB" | "EB" | "WB", number>>;
  measuredCycleS?: number;
  saturationFlowVph?: number;
}): SignalTiming {
  const s = args.saturationFlowVph ?? SATURATION_FLOW_VPH;
  const v = (d: "NB" | "SB" | "EB" | "WB"): number => {
    const x = args.approachVph[d];
    return typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0;
  };

  // Critical lane volume per phase = the heavier approach on that axis.
  const clvNs = Math.max(v("NB"), v("SB"));
  const clvEw = Math.max(v("EB"), v("WB"));
  const clvSum = clvNs + clvEw;
  if (!(clvSum > 0) || !(s > 0)) return SCREENING_DEFAULT;

  const yNs = clvNs / s;
  const yEw = clvEw / s;
  const Y = yNs + yEw;

  // Two critical phases in the engine's model.
  const nCritical = 2;
  const lostTime = LOST_TIME_PER_PHASE_S * nCritical;

  let cycle: number;
  let basis: SignalTiming["basis"];
  if (typeof args.measuredCycleS === "number" && Number.isFinite(args.measuredCycleS)
      && args.measuredCycleS >= 30 && args.measuredCycleS <= 300) {
    cycle = args.measuredCycleS;
    basis = "measured";
  } else if (Y >= MAX_CRITICAL_FLOW_RATIO) {
    // At or beyond saturation Webster is not applicable. Report the screening
    // default rather than a cycle of several hundred seconds.
    return { ...SCREENING_DEFAULT, criticalFlowRatio: round2(Y) };
  } else {
    // Webster optimum: C = (1.5 L + 5) / (1 - Y)
    const raw = (1.5 * lostTime + 5) / (1 - Y);
    cycle = Math.min(MAX_CYCLE_S, Math.max(MIN_CYCLE_S, roundUpTo5(raw)));
    basis = "webster";
  }

  // Critical Movement Method splits: the green available after lost time is
  // shared in proportion to each phase's critical lane volume.
  const effectiveGreen = Math.max(0, cycle - lostTime);
  const gNs = effectiveGreen * (clvNs / clvSum);
  const gEw = effectiveGreen * (clvEw / clvSum);

  return {
    cycleLenS: cycle,
    gOverCns: round2(gNs / cycle),
    gOverCew: round2(gEw / cycle),
    criticalFlowRatio: round2(Y),
    basis,
  };
}

/** Green ratio for a given approach under a computed timing. */
export function gOverCForApproach(t: SignalTiming, d: "NB" | "SB" | "EB" | "WB"): number {
  return d === "NB" || d === "SB" ? t.gOverCns : t.gOverCew;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
