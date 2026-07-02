// Standalone node script (no test runner). Verifies trip-distribution.ts pure logic.
// Run: pnpm run check:trip-distribution   (or: node ./scripts/verify-trip-distribution.mjs)
//
// The equivalence assertions reconstruct demandZones + refVolume EXACTLY as
// tis.ts does (refVolume = max(FALLBACK, max totalVolumes); baseVoverC =
// clamp(mass/refVolume, 0.05, 1.0)) so a green run genuinely proves the
// byte-identical-to-origin/main path, not a matching-but-wrong formula.
//
// ts-loader.mjs is registered here so that trip-distribution.ts can use
// extensionless relative imports (tsc bundler-mode convention) while Node's
// native TS stripping resolves them to the .ts files on disk.
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const m = await import(path.resolve(here, "../src/lib/trip-distribution.ts"));
const fs = await import(path.resolve(here, "../src/lib/four-step-model.ts"));
const cg = await import(path.resolve(here, "../src/lib/caltran-gravity.ts"));
const { computeTripDistribution } = m;

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const FALLBACK_VOLUME = 5000;

// Raw analyzer-shaped candidates (mirrors { sig: AnalyzerIntersection, distanceMi }).
const raw = [
  { id: "A", name: "Main & 1st", distanceMi: 0.10, totalVolume: 20000, bearingDeg: 30 },
  { id: "B", name: "Main & 2nd", distanceMi: 0.25, totalVolume: 15000, bearingDeg: 120 },
  { id: "C", name: "Main & 3rd", distanceMi: 0.40, totalVolume: 30000, bearingDeg: 210 },
  { id: "D", name: "Main & 4th", distanceMi: 0.30, totalVolume: 10000, bearingDeg: 300 },
];
const pmExternalAutoTrips = 500;

// Build refVolume + demandZones + gravityZones EXACTLY as tis.ts:1292-1335.
function buildCtx(candidates, isFlorida) {
  const refVolume = Math.max(
    FALLBACK_VOLUME,
    ...candidates.map((c) => (c.totalVolume > 0 ? c.totalVolume : 0)),
  );
  const demandZones = candidates.map((c) => ({
    id: c.id,
    attraction: c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME,
    distanceMi: c.distanceMi,
    baseVoverC: clamp((c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME) / refVolume, 0.05, 1.0),
  }));
  const gravityZones = candidates.map((c) => ({
    id: c.id,
    mass: c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME,
    distanceMi: c.distanceMi,
    bearingDeg: c.bearingDeg,
  }));
  const meta = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    distanceMi: c.distanceMi,
    bearingDeg: c.bearingDeg,
    mass: c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME,
  }));
  return { meta, demandZones, gravityZones, pmExternalAutoTrips, isFlorida };
}

const ctx = buildCtx(raw, false);

// --- gravity (non-FL, four-step) ---
const g = computeTripDistribution("gravity", ctx);
ok(g.method === "gravity", "method is gravity");
ok(g.weights.length === raw.length, "one weight per candidate");
ok(g.weights.every((w) => w >= 0), "all weights non-negative");
ok(close(g.weights.reduce((s, w) => s + w, 0), 1, 1e-6), "weights sum to 1");
ok(g.loadMultipliers.length === raw.length, "one loadMultiplier per candidate");
ok(g.loadMultipliers.every((x) => x === 1), "non-FL loadMultipliers all 1 (byte-identical loading)");
ok(close(Object.values(g.byDirection).reduce((s, v) => s + v, 0), 100, 0.5), "byDirection sums to 100");
ok(close(Object.values(g.sectors).reduce((s, v) => s + v, 0), 100, 0.5), "sectors sum to 100");
ok(g.zones.length === raw.length, "one zone per candidate");
ok(close(g.zones.reduce((s, z) => s + z.sharePct, 0), 100, 0.5), "zone sharePct sums to 100");

// --- ordering contract: weights are candidate-ordered, zones are share-sorted ---
ok(g.weights.every((w, i) => w === g.zones.find((z) => z.id === ctx.meta[i].id).weight),
   "weights[i] keyed by candidate id equals matching zone.weight (candidate-ordered)");
ok(g.zones.every((z, i) => i === 0 || g.zones[i - 1].sharePct >= z.sharePct - 1e-12),
   "zones sorted by sharePct descending");

// --- gravity equivalence to origin/main non-FL path (reconstructed as tis.ts does) ---
const refWeights = fs.distributeAndAssign(
  ctx.demandZones, pmExternalAutoTrips, { gamma: fs.GAMMA_FRICTION.hbw },
).weights;
ok(g.weights.every((w, i) => close(w, refWeights[i])), "gravity weights byte-match origin/main four-step (real demandZones)");

// --- FL gravity (Caltran) ---
const flCtx = buildCtx(raw, true);
const fl = computeTripDistribution("gravity", flCtx);
ok(fl.method === "gravity", "FL method is gravity");
ok(close(fl.weights.reduce((s, w) => s + w, 0), 1, 1e-6), "FL weights sum to 1");
ok(close(fl.loadMultipliers.reduce((s, x) => s + x, 0), flCtx.meta.length, 0.01), "FL loadMultipliers are mean-1");
const refShares = cg.caltranGravityShares(flCtx.gravityZones).map((s) => s.share);
ok(fl.weights.every((w, i) => close(w, refShares[i])), "FL gravity weights byte-match caltranGravityShares (real gravityZones)");
const refMults = cg.directionalMultipliers(flCtx.gravityZones).map((s) => s.multiplier);
ok(fl.loadMultipliers.every((x, i) => close(x, refMults[i])), "FL loadMultipliers byte-match directionalMultipliers");
// FL zones share-sorted, matching origin/main flGravity.zones sort.
ok(fl.zones.every((z, i) => i === 0 || fl.zones[i - 1].sharePct >= z.sharePct - 1e-12),
   "FL zones sorted by sharePct descending (matches origin/main flGravity.zones)");

// --- stubs fall back to gravity ---
for (const method of ["analogy", "surrogate"]) {
  const s = computeTripDistribution(method, ctx);
  ok(s.weights.every((w, i) => close(w, g.weights[i])), `${method} stub weights fall back to gravity`);
  ok(/not yet implemented/i.test(s.basis), `${method} stub basis notes not-yet-implemented`);
  ok(s.method === method, `${method} stub preserves requested method label`);
}

// --- default (undefined) resolves gravity for non-FL, Caltran for FL ---
const def = computeTripDistribution(undefined, ctx);
ok(def.weights.every((w, i) => close(w, g.weights[i])), "undefined method == gravity (non-FL)");
const defFl = computeTripDistribution(undefined, flCtx);
ok(defFl.weights.every((w, i) => close(w, fl.weights[i])), "undefined method == Caltran (FL)");

// --- zero-mass guard: uniform weights, still finite ---
const zeroRaw = raw.map((c) => ({ ...c, totalVolume: 0 }));
const zeroCtx = buildCtx(zeroRaw, false);
const z = computeTripDistribution("gravity", zeroCtx);
ok(z.weights.every((w) => Number.isFinite(w) && w >= 0), "zero-mass weights finite non-negative");
ok(close(z.weights.reduce((s, w) => s + w, 0), 1, 0.01) || z.weights.every((w) => w === 0),
   "zero-mass weights sum to 1 (or degenerate-safe)");

// --- empty candidate set: no throw, empty arrays ---
const empty = computeTripDistribution("gravity", { meta: [], demandZones: [], gravityZones: [], pmExternalAutoTrips: 0, isFlorida: false });
ok(empty.weights.length === 0 && empty.zones.length === 0, "empty ctx yields empty summary, no throw");

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
