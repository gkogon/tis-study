/**
 * Guard for the project-trip loading model (trip-loading.ts). Project trips must
 * CONCENTRATE at the site-access intersection and decay with distance — not
 * spread ~uniformly the way the gravity distribution does within a small radius
 * (which under-loaded near intersections to ≈0 impact and floored the study
 * scope to the nearest 5 even downtown).
 *
 * Standalone node script (no test runner). Run: `pnpm run check:trip-loading`.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/trip-loading.ts"));
const { intersectionLoadFraction: f, LOAD_DECAY_MI } = m;

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const close = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;

ok(LOAD_DECAY_MI === 0.2, `LOAD_DECAY_MI is 0.2 (got ${LOAD_DECAY_MI})`);

// --- access point carries essentially the full project volume ---
ok(f(0) === 1, `site-access (d=0) loads the full volume (${f(0)})`);
ok(f(-1) === 1, `negative distance clamps to full volume (${f(-1)})`);

// --- decays with distance, always a valid fraction ---
let prev = Infinity;
for (const d of [0, 0.05, 0.1, 0.2, 0.3, 0.5, 1.0]) {
  const v = f(d);
  ok(v > 0 && v <= 1, `d=${d}mi → fraction in (0,1]: ${v.toFixed(3)}`);
  ok(v < prev, `d=${d}mi loads less than the nearer point (${v.toFixed(3)} < ${prev === Infinity ? "1" : prev.toFixed(3)})`);
  prev = v;
}

// --- exact decay shape ---
ok(close(f(0.2), Math.exp(-1)), `one decay length (0.2mi) ≈ 0.368 (got ${f(0.2).toFixed(3)})`);
ok(close(f(0.5), Math.exp(-2.5)), `0.5mi ≈ 0.082 (got ${f(0.5).toFixed(3)})`);

// --- the whole point: near concentration vs. a flat gravity share ---
// Across ~119 signals a flat share is ~1/119 ≈ 0.008. The nearest must dwarf it.
ok(f(0.02) > 20 * (1 / 119), `nearest loads >20x a flat 1/N gravity share`);
// And near intersections clear an ≥8-trip threshold for a ~115-trip project,
// where the flat share (2.3) never did.
const trips = 115;
const near8 = [0.05, 0.1, 0.2, 0.3].filter((d) => f(d) * trips >= 8).length;
ok(near8 === 4, `at 115 trips, intersections out to 0.3mi each load ≥8 project trips (got ${near8}/4)`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
