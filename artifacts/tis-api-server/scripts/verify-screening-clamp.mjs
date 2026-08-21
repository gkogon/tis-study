/**
 * Accuracy/credibility guard: the incremental-delay term (d2, Akçelik
 * time-dependent form) grows without bound above capacity, so at v/c ≈ 2 the
 * raw formula returns ~500–600 s of control delay — physically implausible and
 * indefensible in a screening deliverable (observed live: a Miami-Dade demo
 * showed 583 s / v/c 2.23). vcToDelay must cap reported delay at
 * SCREENING_MAX_DELAY_SEC = 300 while preserving LOS F (the cap is above the
 * 80 s LOS-F threshold).
 *
 * The 300 s ceiling (raised from 120 s) exists so oversaturated intersections
 * DIFFERENTIATE across scenarios: v/c ~1.2–1.6 now print distinct delays in
 * the 120–300 s band instead of all pinning at a flat 120 s. Raw delay crosses
 * 300 s near v/c 1.6 at the default 810 vph capacity.
 *
 * Standalone node script (no test runner configured). Import targets the pure
 * leaf module signal-delay.ts. Run: `pnpm run check:screening-clamp`.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/signal-delay.ts"));
const { vcToDelay, delayToLos, SCREENING_MAX_DELAY_SEC } = m;

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

ok(SCREENING_MAX_DELAY_SEC === 300, `SCREENING_MAX_DELAY_SEC is 300 (got ${SCREENING_MAX_DELAY_SEC})`);

// --- normal (undersaturated) range is unclamped and monotonic ---
const d050 = vcToDelay(0.5);
const d095 = vcToDelay(0.95);
const d100 = vcToDelay(1.0);
ok(d050 > 0 && d050 < SCREENING_MAX_DELAY_SEC, `v/c 0.5 → normal delay ${d050.toFixed(1)}s (uncapped)`);
ok(d095 > d050, `delay increases with v/c (0.95 ${d095.toFixed(1)}s > 0.5 ${d050.toFixed(1)}s)`);
ok(d100 < SCREENING_MAX_DELAY_SEC, `v/c 1.0 → ${d100.toFixed(1)}s still under the cap (uncapped)`);

// --- oversaturated SPREAD band: cases that pinned flat at the old 120 s cap
// must now print distinct, monotonic delays between 120 and the 300 s ceiling
const d130 = vcToDelay(1.3);
const d147 = vcToDelay(1.47);
ok(d130 > 120 && d130 < SCREENING_MAX_DELAY_SEC, `v/c 1.30 → ${d130.toFixed(1)}s (above old 120s cap, below 300s ceiling)`);
ok(d147 > 120 && d147 < SCREENING_MAX_DELAY_SEC, `v/c 1.47 (was ~243s raw, pinned at 120) → ${d147.toFixed(1)}s (unclamped)`);
ok(d147 > d130, `oversaturated delays differentiate (v/c 1.47 ${d147.toFixed(1)}s > v/c 1.30 ${d130.toFixed(1)}s — no flat pin)`);

// --- the artifact cases: grossly oversaturated → clamped to the ceiling ---
ok(vcToDelay(2.23) === SCREENING_MAX_DELAY_SEC, `v/c 2.23 (was ~583s) clamped to ${SCREENING_MAX_DELAY_SEC}s`);
ok(vcToDelay(3.0) === SCREENING_MAX_DELAY_SEC, `v/c 3.0 clamped to ${SCREENING_MAX_DELAY_SEC}s`);
// clamp must also hold when a lower approach capacity is passed
ok(vcToDelay(2.23, 810) === SCREENING_MAX_DELAY_SEC, `v/c 2.23 @ cap 810 clamped to ${SCREENING_MAX_DELAY_SEC}s`);

// --- no implausible value can ever be returned ---
for (const vc of [0, 0.25, 0.8, 1.1, 1.5, 2.0, 5.0, 20.0]) {
  ok(vcToDelay(vc) <= SCREENING_MAX_DELAY_SEC, `v/c ${vc} → ≤ ${SCREENING_MAX_DELAY_SEC}s (got ${vcToDelay(vc).toFixed(1)})`);
}

// --- LOS F is preserved at the cap (the cap must sit above the 80s LOS-F edge) ---
ok(delayToLos(SCREENING_MAX_DELAY_SEC) === "F", `clamped delay still maps to LOS F`);
ok(delayToLos(vcToDelay(2.23)) === "F", `oversaturated node reports LOS F`);
ok(delayToLos(d147) === "F", `spread-band (unclamped oversaturated) node still reports LOS F`);
ok(["A", "B", "C", "D"].includes(delayToLos(d050)), `undersaturated node reports a good LOS (${delayToLos(d050)})`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
