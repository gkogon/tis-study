// Headless smoke test for the home-page opener's traffic simulation.
// Runs the world under plain node (no canvas): traffic must appear,
// counts must accumulate at the centre signal, LOS must stay in A–F,
// nothing may go NaN, the computed retiming must take effect, and the
// camera must zoom OUT across the three acts.
import { StudySim, cameraFor, losForDelay, SIGNAL_COUNT } from "../src/lib/study-alive-sim.ts";

let failed = 0;
const ok = (cond, msg) => { if (cond) console.log("  ok  " + msg); else { failed++; console.log("  FAIL " + msg); } };

const sim = new StudySim();
for (let i = 0; i < 1400; i++) sim.step(0.12);
const warm = sim.carCount();
ok(warm.total > 40, `warm-up puts traffic on the grid (${warm.total} cars)`);
ok(warm.project === 0, "no project trips before the building exists");

sim.projMul = 1;
sim.demand = 1.35; // 5:30 PM on the demand curve
for (let i = 0; i < 5000; i++) sim.step(0.12);
const peak = sim.carCount();
const m = sim.metrics();
ok(peak.project > 0, `project trips spawn once the building is up (${peak.project} blue cars)`);
ok(m.nb + m.sb + m.eb + m.wb > 400, `centre signal counts vehicles (${m.nb}/${m.sb}/${m.eb}/${m.wb} vph)`);
ok(Number.isFinite(m.delay) && m.delay >= 0, `centre control delay is finite (${m.delay.toFixed(1)} s)`);
ok("ABCDEF".includes(m.los), `centre LOS is a grade (${m.los})`);
ok(sim.sigs.length === SIGNAL_COUNT && sim.sigs.every((s) => "ABCDEF".includes(s.los) && Number.isFinite(s.delay)), `all ${SIGNAL_COUNT} signals report a grade`);
ok(m.worstDelay >= m.delay, "worst delay is at least the centre's");
ok(m.atEF >= 1 && m.atEF <= SIGNAL_COUNT, `rush hour pushes at least one signal to LOS E/F (${m.atEF} of ${SIGNAL_COUNT}, worst ${m.worstDelay.toFixed(0)} s)`);

ok(losForDelay(10) === "A" && losForDelay(10.1) === "B" && losForDelay(35) === "C" && losForDelay(55) === "D" && losForDelay(80) === "E" && losForDelay(80.1) === "F", "LOS bands: A ≤10 · B ≤20 · C ≤35 · D ≤55 · E ≤80 · F >80");

sim.retimeCenter(true);
ok(sim.center.C === 104 && Math.abs(sim.center.gNS - 0.52) < 1e-9, "computed retiming sets cycle 104 s, NS g/C 0.52");
for (let i = 0; i < 600; i++) sim.step(0.12);
ok(Number.isFinite(sim.metrics().delay), "sim stays finite after retiming");
sim.retimeCenter(false);
ok(sim.center.C === 90, "retiming reverts to the 90 s default");

const c1 = cameraFor(0.1, 1440, 900), c2 = cameraFor(0.5, 1440, 900), c3 = cameraFor(0.9, 1440, 900);
ok(c1.s > c2.s && c2.s > c3.s, `camera zooms out across the acts (${c1.s.toFixed(2)} → ${c2.s.toFixed(2)} → ${c3.s.toFixed(2)})`);
const mob = cameraFor(0.9, 390, 800);
ok(mob.s >= 0.17, `mobile act-3 scale floors at 0.17 (${mob.s.toFixed(3)})`);
const mid = cameraFor(0.36, 1440, 900);
ok(mid.s < c1.s && mid.s > c2.s, "zoom interpolates monotonically between acts");

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:study-alive-sim passed");
process.exit(failed ? 1 : 0);
