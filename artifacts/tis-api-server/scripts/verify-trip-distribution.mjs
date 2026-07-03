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
const ar = await import(path.resolve(here, "../src/lib/analogy-reference.ts"));
const { computeTripDistribution } = m;
const { landUseFamily, areaTypeFromDensity } = ar;

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
// landUseCode + densityIndex defaults (820/0.5) must NOT change gravity results;
// gravity ignores them — the analogy method uses them.
function buildCtx(candidates, isFlorida, landUseCode = "820", densityIndex = 0.5) {
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
  return { meta, demandZones, gravityZones, pmExternalAutoTrips, isFlorida, landUseCode, densityIndex };
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

// --- surrogate is now a real method (PR3): distinct from gravity, honest basis ---
{
  const s = computeTripDistribution("surrogate", ctx); // ctx has no activityMass → road-only market-area
  ok(s.method === "surrogate", "surrogate preserves requested method label");
  ok(/market-area/i.test(s.basis) && /screening-grade/i.test(s.basis), "surrogate basis is the real market-area screening-grade note (not a stub)");
  ok(!/not yet implemented/i.test(s.basis), "surrogate basis no longer says not-yet-implemented");
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
const empty = computeTripDistribution("gravity", { meta: [], demandZones: [], gravityZones: [], pmExternalAutoTrips: 0, isFlorida: false, landUseCode: "820", densityIndex: 0.5 });
ok(empty.weights.length === 0 && empty.zones.length === 0, "empty ctx yields empty summary, no throw");

// --- chart-input invariants (Task 8B) ---
const { CARDINALS } = cg;
const gg = computeTripDistribution("gravity", ctx);
const roseVals = CARDINALS.map((c) => gg.byDirection[c] ?? 0);
ok(roseVals.length === 8, "compass rose has 8 octant values");
ok(roseVals.every((v) => Number.isFinite(v) && v >= 0), "rose values finite non-negative");
ok(Math.abs(roseVals.reduce((s, v) => s + v, 0) - 100) <= 0.5, "rose values (byDirection) sum to ~100");
const shareVals = gg.zones.map((z) => z.sharePct);
ok(shareVals.length === gg.zones.length && shareVals.every((v) => Number.isFinite(v) && v >= 0), "zone share values finite non-negative");
const distVals = gg.zones.map((z) => z.distanceMi);
ok(distVals.every((v) => Number.isFinite(v) && v >= 0), "zone distance values finite non-negative");

// ===========================================================================
// ANALOGY METHOD ASSERTIONS (PR2)
// ===========================================================================

// --- landUseFamily mapping ---
ok(landUseFamily("820") === "retail",       "landUseFamily('820') === 'retail'");
ok(landUseFamily("710") === "office",       "landUseFamily('710') === 'office'");
ok(landUseFamily("220") === "residential",  "landUseFamily('220') === 'residential'");
ok(landUseFamily("110") === "industrial",   "landUseFamily('110') === 'industrial'");
ok(landUseFamily("931") === "restaurant",   "landUseFamily('931') === 'restaurant'");
ok(landUseFamily("610") === "medical",      "landUseFamily('610') === 'medical'");
ok(landUseFamily("310") === "hotel",        "landUseFamily('310') === 'hotel'");
ok(landUseFamily("912") === "retail",       "landUseFamily('912') === 'retail' (drive-in bank override)");
ok(landUseFamily("940") === "retail",       "landUseFamily('940') === 'retail' (convenience store)");
ok(landUseFamily("550") === "education",    "landUseFamily('550') === 'education'");
ok(landUseFamily("abc") === "other",        "landUseFamily('abc') === 'other' (non-numeric)");

// --- areaTypeFromDensity thresholds ---
ok(areaTypeFromDensity(0.7)  === "cbd",      "areaTypeFromDensity(0.7) === 'cbd'");
ok(areaTypeFromDensity(0.6)  === "cbd",      "areaTypeFromDensity(0.6) === 'cbd' (exact threshold)");
ok(areaTypeFromDensity(0.4)  === "urban",    "areaTypeFromDensity(0.4) === 'urban'");
ok(areaTypeFromDensity(0.33) === "urban",    "areaTypeFromDensity(0.33) === 'urban' (exact threshold)");
ok(areaTypeFromDensity(0.2)  === "suburban", "areaTypeFromDensity(0.2) === 'suburban'");
ok(areaTypeFromDensity(0.12) === "suburban", "areaTypeFromDensity(0.12) === 'suburban' (exact threshold)");
ok(areaTypeFromDensity(0.05) === "rural",    "areaTypeFromDensity(0.05) === 'rural'");
ok(areaTypeFromDensity(0.0)  === "rural",    "areaTypeFromDensity(0.0) === 'rural'");

// --- analogy basic invariants (standard fixture, retail/urban) ---
const anlCtx = buildCtx(raw, false, "820", 0.5); // 0.5 → urban
const anl = computeTripDistribution("analogy", anlCtx);
ok(anl.method === "analogy", "analogy: method === 'analogy'");
ok(anl.methodLabel === "Analogous-Site Distribution", "analogy: methodLabel set");
ok(anl.weights.length === raw.length, "analogy: one weight per candidate");
ok(anl.weights.every((w) => w >= 0), "analogy: all weights non-negative");
ok(close(anl.weights.reduce((s, w) => s + w, 0), 1, 1e-6), "analogy: weights sum to 1");
ok(anl.loadMultipliers.every((x) => x === 1), "analogy: loadMultipliers all 1");
ok(close(Object.values(anl.byDirection).reduce((s, v) => s + v, 0), 100, 0.5), "analogy: byDirection sums to 100");
ok(anl.provenance != null, "analogy: provenance present");
ok(typeof anl.provenance.matched === "string" && anl.provenance.matched.length > 0, "analogy: provenance.matched non-empty");
ok(/screening-grade/i.test(anl.basis) || /replace/i.test(anl.basis), "analogy: basis mentions 'screening-grade' or 'replace'");
ok(/screening-grade/i.test(anl.basis) && /replace/i.test(anl.basis), "analogy: basis mentions both 'screening-grade' AND 'replace'");

// --- analogy zone invariants ---
ok(anl.zones.length === raw.length, "analogy: one zone per candidate");
ok(close(anl.zones.reduce((s, z) => s + z.sharePct, 0), 100, 0.5), "analogy: zone sharePct sums to 100");
ok(anl.zones.every((z, i) => i === 0 || anl.zones[i - 1].sharePct >= anl.zones[i].sharePct - 1e-12),
   "analogy: zones share-sorted descending");

// --- ORIENTATION: peak weight aligns with the dominant corridor ---
// Build a fixture where candidate "DOM" has by far the largest mass in a known
// octant (NNE = bearingDeg 22.5 → octant 0 in CARDINALS), and all others have
// much smaller mass in other octants. Assert the analogy weight for DOM is the
// maximum.
const orientRaw = [
  { id: "DOM", name: "Dominant NNE", distanceMi: 0.20, totalVolume: 50000, bearingDeg: 22 },  // NNE octant (0°-45°)
  { id: "ENE", name: "ENE zone",     distanceMi: 0.30, totalVolume: 1000,  bearingDeg: 67 },  // ENE
  { id: "ESE", name: "ESE zone",     distanceMi: 0.35, totalVolume: 1000,  bearingDeg: 112 }, // ESE
  { id: "SSE", name: "SSE zone",     distanceMi: 0.40, totalVolume: 1000,  bearingDeg: 157 }, // SSE
  { id: "OPP", name: "Opposite SSW", distanceMi: 0.50, totalVolume: 500,   bearingDeg: 202 }, // SSW (opposite corridor)
];
const orientCtx = buildCtx(orientRaw, false, "710", 0.2); // office, suburban
const orAnl = computeTripDistribution("analogy", orientCtx);
// Find weight for DOM candidate (index 0 in orientRaw / orientCtx.meta).
const domWeight = orAnl.weights[0]; // DOM is index 0
const maxWeight = Math.max(...orAnl.weights);
ok(close(domWeight, maxWeight, 1e-9), "analogy ORIENTATION: dominant corridor candidate has maximum weight");
// Also verify OPP (opposite side) has the minimum weight.
const oppIdx = orientRaw.findIndex((c) => c.id === "OPP");
const oppWeight = orAnl.weights[oppIdx];
const minWeight = Math.min(...orAnl.weights);
ok(close(oppWeight, minWeight, 1e-9), "analogy ORIENTATION: opposite corridor candidate has minimum weight (most attenuated)");

// --- analogy: gravity weights UNCHANGED when method=gravity with new ctx fields ---
// Confirm that gravity results with landUseCode/densityIndex added are byte-identical
// to original gravity results (gravity ignores the new fields).
const gNew = computeTripDistribution("gravity", anlCtx);
ok(gNew.weights.every((w, i) => close(w, g.weights[i])), "gravity unaffected by landUseCode/densityIndex on ctx");

// --- analogy empty ctx: no throw ---
const emptyAnl = computeTripDistribution("analogy", { meta: [], demandZones: [], gravityZones: [], pmExternalAutoTrips: 0, isFlorida: false, landUseCode: "820", densityIndex: 0.5 });
ok(emptyAnl.weights.length === 0 && emptyAnl.zones.length === 0, "analogy empty ctx: no throw, empty arrays");
ok(emptyAnl.provenance != null && typeof emptyAnl.provenance.matched === "string", "analogy empty ctx: provenance still set");

// --- FL override: a non-gravity method on a Florida study is forced back to
//     gravity (Caltran) so the FL report stays coherent (gravity narrative +
//     gravity weights). Also confirms FL gravity weights are unchanged. ---
const flAnl = computeTripDistribution("analogy", flCtx);
ok(flAnl.method === "gravity", "FL + analogy → method forced to gravity");
ok(/Florida|Caltran/.test(flAnl.basis), "FL override basis notes the Caltran/Florida standard");
const flGrav = computeTripDistribution("gravity", flCtx);
ok(flAnl.weights.every((w, i) => close(w, flGrav.weights[i])), "FL + analogy weights == FL gravity weights (byte-identical)");
const flSur = computeTripDistribution("surrogate", flCtx);
ok(flSur.method === "gravity", "FL + surrogate → method forced to gravity");

// --- surrogate (market-area) method ---
// Road-only fallback: no activityMass on the ctx → pop/emp weight 0.
const surRoad = computeTripDistribution("surrogate", anlCtx);
ok(surRoad.method === "surrogate", "surrogate: method is surrogate");
ok(close(surRoad.weights.reduce((s, w) => s + w, 0), 1), "surrogate road-only: weights sum to 1");
ok(surRoad.weights.every((w) => Number.isFinite(w) && w >= 0), "surrogate road-only: weights finite non-negative");
ok(surRoad.provenance && surRoad.provenance.blendWeights.population_employment === 0, "surrogate road-only: pop/emp blend weight 0");
ok(surRoad.provenance.blendWeights.road_volume === 1, "surrogate road-only: road blend weight 1");
// Blended: supply per-candidate activity mass, concentrated on the LAST candidate
// (which carries little road volume) → the blend must visibly differ from road-only.
const actMass = anlCtx.meta.map((_, i) => (i === anlCtx.meta.length - 1 ? 100000 : 100));
const surBlend = computeTripDistribution("surrogate", { ...anlCtx, activityMass: actMass });
ok(close(surBlend.weights.reduce((s, w) => s + w, 0), 1), "surrogate blended: weights sum to 1");
ok(surBlend.provenance.blendWeights.population_employment === 0.5, "surrogate blended: pop/emp blend weight 0.5");
ok(!surBlend.weights.every((w, i) => close(w, surRoad.weights[i])), "surrogate blended differs from road-only when activity present");
ok(close(Object.values(surBlend.byDirection).reduce((s, v) => s + Number(v), 0), 100), "surrogate blended: byDirection sums to 100");

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
