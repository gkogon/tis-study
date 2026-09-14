/**
 * The car-following rule the home-page opener (`study-alive-sim.ts`) drives
 * every vehicle with, extracted so the intersection micro-simulation
 * (`intersection-sim.ts`) moves its cars by the same physics. Pure functions,
 * no state, no DOM.
 *
 * Units are unlabeled world units — roughly feet and seconds at the scale
 * the opener draws (VMAX 44 ≈ 30 mph).
 *
 * The rule, per vehicle per step:
 *   d  = gap to the constraint ahead (car, stop line) after subtracting the
 *        vehicle length, the standing gap and a reaction margin v × headwayS
 *   vt = min(VMAX, sqrt(2 · BRAKE · (d − 1)))     — brick-wall stopping speed
 *   v  → vt at ACC when speeding up, at BRAKE when slowing
 *   v  = 0 when d ≤ 1                               — parked at the constraint
 *
 * The opener passes its tunable `TUNING.headwayS` (1.8 s) as the reaction
 * margin; the intersection sim passes 0 because its discharge rate is pinned
 * by an explicit stop-line server at the engine's saturation headway, and a
 * reaction margin would make the follower — not the server — the bottleneck
 * (see intersection-sim.ts, "Saturation flow").
 */

/** Vehicle length. */
export const CAR_L = 14;
/** Vehicle width (drawing). */
export const CAR_W = 7;
/** Free-flow speed. */
export const VMAX = 44;
/** Acceleration when below the target speed. */
export const ACC = 7;
/** Deceleration when above the target speed; also the brick-wall stopping rate. */
export const BRAKE = 13;
/** Standing gap between a stopped vehicle and the constraint ahead. */
export const GAP = 7;

/**
 * Free distance to a leader whose reference point is `spacing` ahead of this
 * vehicle's reference point, after the vehicle length, the standing gap and
 * the reaction margin `v × headwayS`.
 */
export function followGap(spacing: number, v: number, headwayS: number): number {
  return spacing - CAR_L - GAP - v * headwayS;
}

/**
 * The speed a vehicle may hold given `d` of free distance: the speed it can
 * brake to a stop from within `d − 1` at BRAKE, capped at VMAX. `Infinity`
 * (no constraint) → VMAX.
 */
export function targetSpeed(d: number): number {
  if (d < Infinity) return Math.min(VMAX, Math.sqrt(Math.max(0, 2 * BRAKE * (d - 1))));
  return VMAX;
}

/** Move `v` toward `vt` over `dt`: ACC upward, BRAKE downward, never overshooting. */
export function stepSpeed(v: number, vt: number, dt: number): number {
  return vt > v ? Math.min(vt, v + ACC * dt) : Math.max(vt, v - BRAKE * dt);
}
