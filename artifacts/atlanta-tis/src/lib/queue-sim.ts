/**
 * One signalized lane, modelled the way the queuing report models it.
 *
 * The server engine (artifacts/tis-api-server/src/lib/queuing.ts) is a
 * Webster cyclic queue:
 *   capacity per lane            c     = s × g / C                  (queuing.ts:58)
 *   average queue at end of red  Q_avg = v × (C − g) / 3600         (queuing.ts:65)
 *   per-lane split               Q / laneCount                      (queuing.ts:88-89)
 * This sim mirrors that: vehicles arrive with exponential headways at
 * the per-lane rate λ, stop on red, and discharge at the saturation
 * headway 3600 / s during effective green. Red runs first in each cycle,
 * then effective green. Sampling the queue at every red→green edge gives
 * the quantity the report calls the average queue, so
 * `scripts/check-queue-sim.mjs` can compare the two headlessly.
 *
 * Pure TypeScript — no DOM. Positions are feet upstream of the stop bar
 * (0 = nose at the bar, negative = through). Free-flow, creep and
 * acceleration are drawing constants only: a vehicle joins the queue a
 * fixed `entryFt / VMAX` after it appears, so they never touch the
 * queue statistics.
 */

export type QueueSimParams = {
  /** λ — arrivals on this lane (report volume ÷ lane count), vph */
  arrivalVph: number;
  /** s — saturation flow, the discharge rate on green, vphpl */
  satFlowVphpl: number;
  /** C — cycle length, s */
  cycleSec: number;
  /** g — effective green, s; red is C − g */
  greenSec: number;
  /** storage per queued vehicle, ft (report vehicleSpacingFt) */
  spacingFt: number;
  /** where vehicles enter the drawn lane, ft upstream of the bar */
  entryFt: number;
  seed?: number;
  /** sim clock at construction; negative pre-rolls before the first red (call resetStats() at 0) */
  startAt?: number;
};

export type VehicleState = "approach" | "queued" | "released" | "free";
export type Vehicle = { id: number; x: number; v: number; state: VehicleState; joinAt: number };

/** 30 mph free-flow approach — drawing only */
export const VMAX_FTPS = 44;
/** rolling up one slot as the queue discharges — drawing only */
export const CREEP_FTPS = 14;
/** pulling away from the bar — drawing only */
export const ACCEL_FTPS2 = 8;
const EXIT_FT = 120;

/** Q_avg = v × (C − g) / 3600 — queuing.ts:65, for one lane. */
export function analyticalAverageQueue(p: Pick<QueueSimParams, "arrivalVph" | "cycleSec" | "greenSec">): number {
  return (p.arrivalVph * (p.cycleSec - p.greenSec)) / 3600;
}

/** c = s × g / C — queuing.ts:58. */
export function laneCapacityVph(p: Pick<QueueSimParams, "satFlowVphpl" | "cycleSec" | "greenSec">): number {
  return p.satFlowVphpl * (p.greenSec / p.cycleSec);
}

export class QueueSim {
  readonly p: QueueSimParams;
  t: number;
  /** front first (smallest x); no passing, so the order never changes */
  vehicles: Vehicle[] = [];
  /** vehicles currently counted in the queue */
  queue = 0;
  /** red→green edges seen so far */
  cycles = 0;
  private nextArrival: number;
  private nextDepart = -Infinity;
  private nextId = 1;
  private seed: number;
  private readonly redEnd: number[] = [];

  constructor(p: QueueSimParams) {
    if (!(p.greenSec < p.cycleSec)) throw new Error("effective green must be less than the cycle length");
    if (!(p.spacingFt > 0)) throw new Error("vehicle spacing must be positive");
    this.p = p;
    this.seed = ((p.seed ?? 1) >>> 0) || 1;
    this.t = p.startAt ?? 0;
    this.nextArrival = this.t + this.expo();
  }

  private rnd(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return (this.seed + 0.5) / 4294967296; // (0, 1) — never 0 or 1
  }

  /** exponential headway in seconds at the arrival rate */
  private expo(): number {
    return -Math.log(1 - this.rnd()) * (3600 / Math.max(this.p.arrivalVph, 1e-6));
  }

  get redSec(): number {
    return this.p.cycleSec - this.p.greenSec;
  }

  /** seconds into the current cycle; red is [0, C − g), effective green the rest */
  phaseTime(t: number = this.t): number {
    const C = this.p.cycleSec;
    return ((t % C) + C) % C;
  }

  isGreen(t: number = this.t): boolean {
    return this.phaseTime(t) >= this.redSec;
  }

  /** seconds until the signal next changes */
  secondsToChange(): number {
    const u = this.phaseTime();
    return u < this.redSec ? this.redSec - u : this.p.cycleSec - u;
  }

  /** saturation headway, s — the discharge interval on green */
  headwaySec(): number {
    return 3600 / Math.max(this.p.satFlowVphpl, 1e-6);
  }

  /** queue length in feet, the report's Q × spacing */
  queueFt(): number {
    return this.queue * this.p.spacingFt;
  }

  /** the queue at each red→green edge, oldest first */
  redEndSamples(): readonly number[] {
    return this.redEnd;
  }

  /** mean of the end-of-red samples, optionally skipping warm-up cycles; NaN with no samples */
  meanQueueAtEndOfRed(skip = 0): number {
    const s = this.redEnd.slice(skip);
    return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN;
  }

  /** Forget the cycles seen so far (after a pre-roll) — the world itself is untouched. */
  resetStats(): void {
    this.redEnd.length = 0;
    this.cycles = 0;
  }

  /** Replace the world with `n` stopped vehicles at the bar at the end of red (the reduced-motion frame). */
  setStaticQueue(n: number): void {
    this.vehicles = [];
    for (let i = 0; i < n; i++) {
      this.vehicles.push({ id: this.nextId++, x: i * this.p.spacingFt, v: 0, state: "queued", joinAt: 0 });
    }
    this.queue = n;
    this.t = Math.max(0, this.redSec - 1e-3);
    this.nextArrival = Infinity;
  }

  step(dt: number): void {
    if (!(dt > 0)) return;
    const p = this.p;
    const t0 = this.t;
    const t1 = t0 + dt;

    // red → green inside this step: sample the end-of-red queue, and the
    // first discharge happens at the start of effective green.
    const u0 = this.phaseTime(t0);
    if (u0 < this.redSec && u0 + dt >= this.redSec) {
      this.redEnd.push(this.queue);
      this.cycles++;
      this.nextDepart = t0 + (this.redSec - u0);
    }
    this.t = t1;

    // arrivals — Poisson at λ; a vehicle is counted at the queue a fixed
    // travel time after it appears at the entry
    while (this.nextArrival <= t1) {
      const at = this.nextArrival;
      const last = this.vehicles[this.vehicles.length - 1];
      const x = Math.max(p.entryFt, last ? last.x + p.spacingFt : -Infinity);
      this.vehicles.push({ id: this.nextId++, x, v: VMAX_FTPS, state: "approach", joinAt: at + p.entryFt / VMAX_FTPS });
      this.nextArrival = at + this.expo();
    }

    // joins — front first, which is also joinAt order
    for (const veh of this.vehicles) {
      if (veh.state !== "approach" || veh.joinAt > t1) continue;
      if (this.queue === 0 && this.isGreen(veh.joinAt)) {
        veh.state = "free";
        veh.v = VMAX_FTPS;
      } else {
        veh.state = "queued";
        veh.v = 0;
        this.queue++;
      }
    }

    // discharge — one vehicle per saturation headway while green
    if (this.isGreen(t1)) {
      const h = this.headwaySec();
      while (this.queue > 0 && Math.max(this.nextDepart, t0) <= t1) {
        const front = this.vehicles.find((v) => v.state === "queued");
        if (!front) { this.queue = 0; break; }
        front.state = "released";
        front.v = 0;
        this.queue--;
        this.nextDepart = Math.max(this.nextDepart, t0) + h;
      }
    }

    // movement — every vehicle keeps one spacing behind its leader
    let leader: Vehicle | null = null;
    for (const veh of this.vehicles) {
      const floor = leader ? leader.x + p.spacingFt : -Infinity;
      if (veh.state === "approach") {
        veh.x = Math.max(floor, 0, veh.x - VMAX_FTPS * dt);
      } else if (veh.state === "queued") {
        veh.x = Math.max(floor, 0, veh.x - CREEP_FTPS * dt);
      } else {
        veh.v = Math.min(VMAX_FTPS, veh.v + ACCEL_FTPS2 * dt);
        veh.x = Math.max(floor, veh.x - veh.v * dt);
      }
      leader = veh;
    }
    if (this.vehicles.length && this.vehicles[0].x < -EXIT_FT) {
      this.vehicles = this.vehicles.filter((v) => v.x >= -EXIT_FT);
    }
  }
}
