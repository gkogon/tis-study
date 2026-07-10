// Standalone node script (no test runner). Verifies the UK trip-distribution
// path: the Greater-London Census WU03EW OD loader (greater-london-msoa-od.ts)
// and the UK-flavoured summaries from trip-distribution.ts.
// Run: pnpm run check:uk-distribution   (or: node ./scripts/verify-uk-distribution.mjs)
//
// ts-loader.mjs is registered so the .ts modules can use extensionless relative
// imports while Node's native TS stripping resolves them to the .ts files.
// The OD loader reads the committed asset from disk, so this exercises the real
// 2011 Census journey-to-work data, not a fixture.
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const td = await import(path.resolve(here, "../src/lib/trip-distribution.ts"));
const od = await import(path.resolve(here, "../src/lib/greater-london-msoa-od.ts"));
const { computeTripDistribution } = td;
const { computeOdAffinity, ukOdAvailable, msoaAt, ukOdSource } = od;

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const close = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const sum = (a) => a.reduce((s, v) => s + v, 0);

const FALLBACK_VOLUME = 5000;

// ---------------------------------------------------------------------------
// 1. Asset + centroid lookup
// ---------------------------------------------------------------------------
ok(ukOdAvailable() === true, "OD asset present + non-empty (ukOdAvailable)");
ok(typeof ukOdSource() === "string" && /WU03EW/.test(ukOdSource()), "OD source string cites WU03EW");

// Holloway Road, Islington — inside Greater London.
const HOLLOWAY = { lat: 51.5530, lon: -0.1140 };
const site = msoaAt(HOLLOWAY.lat, HOLLOWAY.lon);
ok(site != null, "msoaAt resolves an MSOA for a Greater-London coordinate");
ok(site != null && /^E02\d{6}$/.test(site.msoa), "resolved MSOA code is an ONS MSOA11CD (E02……)");

// Manchester — well outside the Greater-London guard radius → no coverage.
ok(msoaAt(53.4808, -2.2426) === null, "msoaAt returns null outside Greater London (Manchester)");
// Mid-Atlantic — definitely null.
ok(msoaAt(40.0, -30.0) === null, "msoaAt returns null for an offshore coordinate");

// ---------------------------------------------------------------------------
// 2. OD affinity projection (the genuine UK method)
// ---------------------------------------------------------------------------
const BEARINGS = [30, 120, 210, 300];

// Residential site → OUTBOUND commuter flows.
const resAff = computeOdAffinity({ siteLat: HOLLOWAY.lat, siteLon: HOLLOWAY.lon, candidateBearings: BEARINGS, landUseCode: "220" });
ok(resAff != null, "computeOdAffinity returns a result for a London residential site");
ok(resAff.hasFlows === true, "residential site has real OD flows (hasFlows)");
ok(resAff.direction === "outbound", "residential site uses OUTBOUND flows (residents → workplaces)");
ok(resAff.affinity.length === BEARINGS.length, "affinity has one value per candidate bearing");
ok(resAff.affinity.every((v) => Number.isFinite(v) && v >= 0), "affinity values finite + non-negative");
ok(sum(resAff.affinity) > 0, "affinity sums to > 0 (flows projected onto at least one bearing)");
ok(Math.max(...resAff.affinity) > Math.min(...resAff.affinity), "affinity is directional (not uniform across bearings)");
ok(/E02\d{6}/.test(resAff.matched) && resAff.source.includes("WU03EW"), "affinity carries matched MSOA + WU03EW provenance");

// Employment site (General Office, land use 710) → INBOUND commuter flows.
const empAff = computeOdAffinity({ siteLat: HOLLOWAY.lat, siteLon: HOLLOWAY.lon, candidateBearings: BEARINGS, landUseCode: "710" });
ok(empAff != null && empAff.direction === "inbound", "employment (office) site uses INBOUND flows (workers ← homes)");
ok(empAff != null && empAff.hasFlows === true, "employment site has real OD flows");

// Outside London → null (caller degrades to gravity/road-volume).
ok(computeOdAffinity({ siteLat: 53.4808, siteLon: -2.2426, candidateBearings: BEARINGS, landUseCode: "220" }) === null,
   "computeOdAffinity null outside Greater London (caller falls back)");

// ---------------------------------------------------------------------------
// 3. UK-flavoured computeTripDistribution summaries
// ---------------------------------------------------------------------------
// A candidate set with the same bearings, roughly around the site.
const raw = [
  { id: "A", name: "Holloway Rd / Camden Rd", distanceMi: 0.12, totalVolume: 22000, bearingDeg: BEARINGS[0] },
  { id: "B", name: "Holloway Rd / Seven Sisters Rd", distanceMi: 0.28, totalVolume: 18000, bearingDeg: BEARINGS[1] },
  { id: "C", name: "Nag's Head junction", distanceMi: 0.44, totalVolume: 27000, bearingDeg: BEARINGS[2] },
  { id: "D", name: "Highbury Corner", distanceMi: 0.33, totalVolume: 15000, bearingDeg: BEARINGS[3] },
];
const pmExternalAutoTrips = 420;

function buildUkCtx({ activityMass, ukOd } = {}) {
  const refVolume = Math.max(FALLBACK_VOLUME, ...raw.map((c) => (c.totalVolume > 0 ? c.totalVolume : 0)));
  const demandZones = raw.map((c) => ({
    id: c.id,
    attraction: c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME,
    distanceMi: c.distanceMi,
    baseVoverC: clamp((c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME) / refVolume, 0.05, 1.0),
  }));
  const gravityZones = raw.map((c) => ({ id: c.id, mass: c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME, distanceMi: c.distanceMi, bearingDeg: c.bearingDeg }));
  const meta = raw.map((c) => ({ id: c.id, name: c.name, distanceMi: c.distanceMi, bearingDeg: c.bearingDeg, mass: c.totalVolume }));
  return {
    meta, demandZones, gravityZones, pmExternalAutoTrips,
    isFlorida: false, isUk: true, landUseCode: "220", densityIndex: 0.8,
    ...(activityMass ? { activityMass } : {}),
    ...(ukOd ? { ukOd } : {}),
  };
}

const invariants = (r, label) => {
  ok(r.weights.length === raw.length, `${label}: one weight per candidate`);
  ok(r.weights.every((w) => Number.isFinite(w) && w >= 0), `${label}: weights finite + non-negative`);
  ok(close(sum(r.weights), 1, 1e-6), `${label}: weights sum to 1`);
  ok(close(sum(Object.values(r.byDirection)), 100, 0.5), `${label}: byDirection sums to 100`);
  ok(close(sum(Object.values(r.sectors)), 100, 0.5), `${label}: sectors sum to 100`);
  ok(r.loadMultipliers.every((x) => x === 1), `${label}: non-FL loadMultipliers all 1 (byte-identical loading)`);
};

// Gravity (UK) — labels/basis reframed, maths unchanged.
{
  const g = computeTripDistribution("gravity", buildUkCtx());
  invariants(g, "UK gravity");
  ok(g.methodLabel === "Gravity Model (WebTAG M2 / DMRB)", "UK gravity label is WebTAG M2 / DMRB");
  ok(/WebTAG/.test(g.basis), "UK gravity basis cites WebTAG");
}

// Surrogate (UK) with real OD affinity → Census journey-to-work catchment.
{
  const affinity = resAff.affinity.slice();
  const ukOd = { matched: resAff.matched, direction: resAff.direction, hasFlows: true, source: resAff.source };
  const s = computeTripDistribution("surrogate", buildUkCtx({ activityMass: affinity, ukOd }));
  invariants(s, "UK surrogate (OD)");
  ok(s.methodLabel === "Census Journey-to-Work Catchment (2011 WU03EW)", "UK surrogate label is the Census journey-to-work catchment");
  ok(/WU03EW/.test(s.basis) && /journey-to-work/i.test(s.basis), "UK surrogate basis cites WU03EW journey-to-work");
  ok(s.basis.includes(resAff.matched), "UK surrogate basis names the resolved site MSOA");
}

// Surrogate (UK) with NO OD (outside coverage) → honest road-volume fallback.
{
  const s = computeTripDistribution("surrogate", buildUkCtx()); // no activityMass, no ukOd
  ok(s.method === "surrogate", "UK surrogate fallback preserves method");
  ok(/outside Greater London coverage/i.test(s.basis) || /road through-volume/i.test(s.basis),
     "UK surrogate fallback basis states the road-volume / no-coverage fallback honestly");
  ok(s.weights.every((w) => Number.isFinite(w) && w >= 0) && close(sum(s.weights), 1, 1e-6),
     "UK surrogate fallback weights still valid (sum 1, non-negative)");
}

// Analogy (UK) — cite-not-copy basis, explicitly NOT TRICS data.
{
  const a = computeTripDistribution("analogy", buildUkCtx());
  invariants(a, "UK analogy");
  ok(a.methodLabel === "Analogous-Site Distribution (TRICS-comparable)", "UK analogy label is TRICS-comparable");
  ok(/NOT TRICS/i.test(a.basis) || /not TRICS/i.test(a.basis), "UK analogy basis states it is NOT TRICS data (cite-not-copy)");
}

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
