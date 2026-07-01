// Signalized-intersection screening delay / LOS / queue — pure HCM math.
//
// Extracted from tis.ts so the delay model is a dependency-free leaf that can be
// unit-tested in isolation (no logger/db/region imports). tis.ts re-exports these
// for back-compat, so existing `import { vcToDelay, delayToLos, queue95Ft } from
// "./tis"` sites (turbo-lane.ts, uk-capacity.ts) are unchanged.
//
// All constants are HCM 6th-Edition thresholds or clearly-stated screening
// assumptions — no proprietary tables reproduced.

// ---------- HCM LOS thresholds (HCM 6th Ed, Ex. 19-8) ----------

export type Los = "A" | "B" | "C" | "D" | "E" | "F";

const LOS_THRESHOLDS: Array<{ los: Los; maxDelay: number }> = [
  { los: "A", maxDelay: 10 },
  { los: "B", maxDelay: 20 },
  { los: "C", maxDelay: 35 },
  { los: "D", maxDelay: 55 },
  { los: "E", maxDelay: 80 },
  { los: "F", maxDelay: Infinity },
];

export function delayToLos(delaySec: number): Los {
  for (const t of LOS_THRESHOLDS) if (delaySec <= t.maxDelay) return t.los;
  return "F";
}

export const CYCLE_LEN = 90;
export const G_OVER_C = 0.45;
export const SATURATION_FLOW_VPH = 1800;
export const CRITICAL_MOVEMENT_FRACTION = 0.45;
export const PER_INTERSECTION_CAPACITY_VPH = SATURATION_FLOW_VPH * G_OVER_C;
export const APPROACH_CAPACITY_VPH = PER_INTERSECTION_CAPACITY_VPH; // 1 critical lane per approach
export const VEH_LENGTH_FT = 25;

// Screening ceiling on REPORTED control delay. The HCM incremental-delay term
// (d2) grows without bound above capacity, so at v/c ≈ 2 it returns ~500–600 s
// (≈10 min/veh) — physically implausible and not defensible in a screening
// deliverable. Above this ceiling the intersection is simply oversaturated and
// is reported as LOS F (this cap is > the 80 s LOS-F threshold, so LOS is
// preserved). A calibrated design-level analysis (HCS/Synchro) supersedes it.
export const SCREENING_MAX_DELAY_SEC = 120;

// ---------- HCM signalized-intersection delay (Ex. 19-18) ----------

export function vcToDelay(vc: number, capacityVph: number = PER_INTERSECTION_CAPACITY_VPH): number {
  const x = Math.max(0, vc);
  const xForD1 = Math.min(0.99, x);
  const d1 = (0.5 * CYCLE_LEN * Math.pow(1 - G_OVER_C, 2)) / (1 - xForD1 * G_OVER_C);

  const T = 0.25;
  const k = 0.5;
  const d2 = x > 0
    ? 900 * T * ((x - 1) + Math.sqrt(Math.pow(x - 1, 2) + (8 * k * x) / (capacityVph * T)))
    : 0;

  // Cap the reported delay at the screening ceiling (LOS F preserved). Keeps a
  // grossly-oversaturated node from printing an implausible ~500 s delay.
  return Math.min(d1 + d2, SCREENING_MAX_DELAY_SEC);
}

// 95th-percentile back-of-queue length per HCM 6th Ed. Eq. 19-50, simplified.
//   Q1 (avg vehicles per cycle queued) = (vph/3600) * C * (1 - g/C) / (1 - x*g/C)
//   Q95 ≈ Q1 * 1.65  (Poisson incremental factor, undersaturated)
//   length_ft = Q95 * VEH_LENGTH_FT
export function queue95Ft(approachVph: number, capacityVph: number): number {
  if (approachVph <= 0) return 0;
  const x = Math.min(0.99, approachVph / capacityVph);
  const arrPerSec = approachVph / 3600;
  const q1 = (arrPerSec * CYCLE_LEN * (1 - G_OVER_C)) / Math.max(0.05, 1 - x * G_OVER_C);
  const q95 = q1 * 1.65;
  return q95 * VEH_LENGTH_FT;
}
