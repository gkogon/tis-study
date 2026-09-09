// Headless check for the queuing report's lane animation model.
// Runs lib/queue-sim.ts under plain node: the simulated end-of-red mean
// must land within ±15% of the report engine's analytical value
// Q_avg = v × (C − g) / 3600 (tis-api-server/src/lib/queuing.ts:65),
// discharge must run at the saturation headway, an over-saturated lane
// must grow cycle over cycle, the run must be reproducible from its seed,
// and nothing may go NaN.
import { QueueSim, analyticalAverageQueue, laneCapacityVph } from "../src/lib/queue-sim.ts";

let failed = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failed++; console.log("  FAIL " + msg); } };
const pct = (a, b) => Math.abs(a - b) / b;

function run(p, cycles, dt = 0.05) {
  const sim = new QueueSim(p);
  const steps = Math.ceil((cycles * p.cycleSec) / dt);
  let finite = true, nonNegative = true, maxVehicles = 0;
  for (let i = 0; i < steps; i++) {
    sim.step(dt);
    if (!Number.isFinite(sim.t) || sim.queue < 0) nonNegative = false;
    for (const v of sim.vehicles) if (!Number.isFinite(v.x) || !Number.isFinite(v.v)) finite = false;
    if (sim.vehicles.length > maxVehicles) maxVehicles = sim.vehicles.length;
  }
  return { sim, finite, nonNegative, maxVehicles };
}

// Case A — a typical protected left: 420 vph on one lane, s 1,805, C 90, g 30 → c 602, X 0.70
const A = { arrivalVph: 420, satFlowVphpl: 1805, cycleSec: 90, greenSec: 30, spacingFt: 25, entryFt: 800, seed: 7 };
const a = run(A, 600);
const qA = analyticalAverageQueue(A);
const mA = a.sim.meanQueueAtEndOfRed(5);
ok(Math.abs(laneCapacityVph(A) - 601.67) < 0.01, `capacity c = s × g/C = ${laneCapacityVph(A).toFixed(1)} vph/ln`);
ok(Math.abs(qA - 7.0) < 1e-9, `analytical Q_avg = 420 × 60 / 3600 = ${qA.toFixed(2)} veh`);
ok(a.sim.redEndSamples().length >= 598, `one end-of-red sample per cycle (${a.sim.redEndSamples().length} of 600)`);
ok(pct(mA, qA) <= 0.15, `X 0.70: simulated end-of-red mean ${mA.toFixed(2)} within ±15% of ${qA.toFixed(2)} (${(pct(mA, qA) * 100).toFixed(1)}%)`);
ok(a.finite && a.nonNegative, "positions, speeds, clock and queue stay finite and non-negative");
ok(a.maxVehicles < 80, `world stays bounded (peak ${a.maxVehicles} vehicles on the lane)`);

// Case B — lighter: 300 vph, C 120, g 40 → X 0.50, Q_avg 6.67
const B = { arrivalVph: 300, satFlowVphpl: 1805, cycleSec: 120, greenSec: 40, spacingFt: 25, entryFt: 800, seed: 11 };
const b = run(B, 500);
const qB = analyticalAverageQueue(B);
const mB = b.sim.meanQueueAtEndOfRed(5);
ok(pct(mB, qB) <= 0.15, `X 0.50: simulated end-of-red mean ${mB.toFixed(2)} within ±15% of ${qB.toFixed(2)} (${(pct(mB, qB) * 100).toFixed(1)}%)`);
ok(b.finite && b.nonNegative, "case B stays finite");

// Case C — over-saturated: 800 vph against c 602 → X 1.33; the queue must grow cycle over cycle
const C = { arrivalVph: 800, satFlowVphpl: 1805, cycleSec: 90, greenSec: 30, spacingFt: 25, entryFt: 800, seed: 3 };
const c = run(C, 12);
const sC = c.sim.redEndSamples();
ok(sC.length >= 11 && sC[sC.length - 1] > sC[2] && sC[sC.length - 1] > analyticalAverageQueue(C), `X 1.33: end-of-red queue grows (${sC[2]} → ${sC[sC.length - 1]} veh over ${sC.length} cycles)`);
ok(c.finite && c.nonNegative, "over-saturated run stays finite");

// Discharge — a full stopped queue at the start of green leaves at the saturation headway
{
  const sim = new QueueSim(A);
  sim.setStaticQueue(40);
  const before = sim.queue;
  const g = A.greenSec, dt = 0.02;
  for (let t = 0; t < g - 0.05; t += dt) sim.step(dt); // crosses into green almost immediately
  const left = before - sim.queue;
  const expect = Math.floor(g / sim.headwaySec()) + 1; // one at the start of green, then every h
  ok(Math.abs(left - expect) <= 1, `discharges ${left} vehicles in a ${g} s green at h = ${sim.headwaySec().toFixed(2)} s (expected ≈ ${expect})`);
  ok(sim.vehicles.every((v) => Number.isFinite(v.x)), "released vehicles keep finite positions");
}

// Determinism — same seed, same world
{
  const x = run(A, 20).sim, y = run(A, 20).sim;
  ok(x.redEndSamples().join(",") === y.redEndSamples().join(","), "same seed reproduces the same end-of-red series");
  const z = run({ ...A, seed: 8 }, 20).sim;
  ok(z.redEndSamples().join(",") !== x.redEndSamples().join(","), "a different seed gives a different series");
}

// Edge — no demand: nothing arrives, nothing breaks; the server's g ≥ C rejection is mirrored
{
  const z = run({ ...A, arrivalVph: 0 }, 10).sim;
  ok(z.queue === 0 && z.vehicles.length === 0 && Number.isFinite(z.t), "zero demand keeps an empty, finite lane");
  let threw = false;
  try { new QueueSim({ ...A, greenSec: 90 }); } catch { threw = true; }
  ok(threw, "green ≥ cycle is rejected, as the server rejects it (queuing.ts:52-54)");
}

// Pre-roll — a negative start clock sits in the previous green and the first red still samples once
{
  const sim = new QueueSim({ ...A, startAt: -24 });
  ok(sim.isGreen(), "startAt −24 s begins inside the previous effective green");
  for (let t = -24; t < A.cycleSec - A.greenSec + 1; t += 0.05) sim.step(0.05);
  ok(sim.cycles === 1 && sim.redEndSamples().length === 1, `first red→green edge after the pre-roll samples exactly once (${sim.redEndSamples()[0]} veh)`);
  const n = sim.vehicles.length;
  sim.resetStats();
  ok(sim.cycles === 0 && sim.redEndSamples().length === 0 && sim.vehicles.length === n, "resetStats() forgets the cycles but keeps the vehicles");
  // a pre-roll longer than the green sits in the previous red: its edge must not survive the reset
  const long = new QueueSim({ ...A, greenSec: 18, startAt: -36 });
  while (long.t < 0) long.step(0.1);
  ok(long.cycles === 1, "a pre-roll starting in the previous red sees that red's edge");
  long.resetStats();
  for (let t = 0; t < 73; t += 0.1) long.step(0.1);
  ok(long.cycles === 1 && long.redEndSamples()[0] > 0, `after the reset the first counted red ends with a real queue (${long.redEndSamples()[0]} veh)`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:queue-sim passed");
process.exit(failed ? 1 : 0);
