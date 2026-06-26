/**
 * Cardinal-direction primitives — the eight 45-degree compass wedges used by
 * directional trip distribution.
 *
 * Neutral, region-agnostic. Both the Miami-Dade adopted LRTP distribution
 * (fl-lrtp-directional-distribution.ts) and the global synthetic
 * activity-surface generator (activity-zones.ts) share this taxonomy so a
 * directional split means the same thing everywhere.
 *
 * The wedge naming follows the Miami-Dade TPO 2045 LRTP Directional Trip
 * Distribution Report: each direction is the 45° wedge formed by the
 * intersection of the eight major compass bearings, with boundaries at
 * 0/45/90/… degrees clockwise from North.
 */

export type CardinalDirection =
  | "NNE" | "ENE" | "ESE" | "SSE" | "SSW" | "WSW" | "WNW" | "NNW";

/** Canonical ordering of the eight wedges (matches LRTP data column order). */
export const CARDINALS: ReadonlyArray<CardinalDirection> = [
  "NNE", "ENE", "ESE", "SSE", "SSW", "WSW", "WNW", "NNW",
];

/** Wedge label + center bearing (degrees clockwise from North). */
export const CARDINAL_DEFS: Record<CardinalDirection, { label: string; centerDeg: number }> = {
  NNE: { label: "between North and Northeast", centerDeg: 22.5 },
  ENE: { label: "between East and Northeast", centerDeg: 67.5 },
  ESE: { label: "between East and Southeast", centerDeg: 112.5 },
  SSE: { label: "between South and Southeast", centerDeg: 157.5 },
  SSW: { label: "between South and Southwest", centerDeg: 202.5 },
  WSW: { label: "between West and Southwest", centerDeg: 247.5 },
  WNW: { label: "between West and Northwest", centerDeg: 292.5 },
  NNW: { label: "between North and Northwest", centerDeg: 337.5 },
};

/** A fresh zeroed record keyed by cardinal direction. */
export function zeroCardinalRecord(): Record<CardinalDirection, number> {
  const r = {} as Record<CardinalDirection, number>;
  for (const d of CARDINALS) r[d] = 0;
  return r;
}

/**
 * Map a compass bearing (degrees clockwise from North) to its cardinal wedge.
 * Boundaries sit at 0/45/90/… so bearing ∈ [0,45) → NNE, [45,90) → ENE, etc.
 */
export function bearingToCardinal(bearingDeg: number): CardinalDirection {
  const b = ((bearingDeg % 360) + 360) % 360;
  const idx = Math.floor(b / 45) % 8;
  return CARDINALS[idx]!;
}

/**
 * Initial great-circle bearing (degrees clockwise from North, 0..360) from
 * point 1 to point 2.
 */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad, φ2 = lat2 * toRad;
  const Δλ = (lon2 - lon1) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x) / toRad;
  return (θ + 360) % 360;
}
