/**
 * Verify that jurisdictional decisions key off the site's ACTUAL state, not
 * the metro's nominal stateCode.
 *
 * Several metro bboxes deliberately straddle state lines, so before this fix
 * a Bergen County NJ site rendered as an NYSDOT HDM Chapter 5 submittal, a
 * Camden County NJ site got PennDOT framing, and a Fairfax County VA site
 * cited DDOT and 24 DCMR. Those are legal claims on a document a PE stamps.
 *
 * Run:  pnpm run check:state-dispatch
 */
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
// Register the shared ts-loader like every sibling harness: Node's native
// type-stripping does no extension searching, so the extensionless relative
// imports inside the TS modules (regions.ts -> "./state-boundaries") fail
// with ERR_MODULE_NOT_FOUND without it.
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
const { stateForCoordinate, stateBoundariesLoaded } =
  await import(path.resolve(here, "../src/lib/state-boundaries.ts"));
const { regionForCoordinate } = await import(path.resolve(here, "../src/lib/regions.ts"));

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };

ok(stateBoundariesLoaded(), "us-state-boundaries.json asset is present and parseable");

// --- The regression cases: metro stateCode disagrees with the real state ---
// Each of these rendered as the WRONG state's DOT document before the fix.
const CROSS_BORDER = [
  { name: "Paramus NJ (Rte 4)",        lat: 40.9176, lon: -74.0754, state: "NJ", metro: "new_york_metro" },
  { name: "Fort Lee NJ (Hudson edge)", lat: 40.8509, lon: -73.9701, state: "NJ", metro: "new_york_metro" },
  { name: "Hackensack NJ",             lat: 40.8859, lon: -74.0435, state: "NJ", metro: "new_york_metro" },
  // Scotch Plains, not Bridgewater — Bridgewater resolves to NO covered metro,
  // so it is a state-resolution case only and would tell us nothing about dispatch.
  { name: "Scotch Plains NJ",          lat: 40.6540, lon: -74.3899, state: "NJ", metro: "new_york_metro" },
  { name: "Cherry Hill NJ (Rte 70)",   lat: 39.9068, lon: -74.9860, state: "NJ", metro: "philadelphia_metro" },
  { name: "Camden NJ (Delaware edge)", lat: 39.9259, lon: -75.1196, state: "NJ", metro: "philadelphia_metro" },
  { name: "Fairfax VA",                lat: 38.8462, lon: -77.3064, state: "VA", metro: "washington_dc_metro" },
  { name: "Bethesda MD",               lat: 38.9847, lon: -77.0947, state: "MD", metro: "washington_dc_metro" },
  { name: "Stamford CT",               lat: 41.0534, lon: -73.5387, state: "CT", metro: null },
];

for (const c of CROSS_BORDER) {
  const got = stateForCoordinate(c.lat, c.lon);
  ok(got === c.state, `${c.name}: site state = ${c.state} (got ${got})`);
  if (c.metro) {
    const region = regionForCoordinate(c.lat, c.lon);
    ok(region?.code === c.metro,
      `${c.name}: metro inventory still ${c.metro} (got ${region?.code}) — data must not move`);
    ok(region?.stateCode !== c.state,
      `${c.name}: metro stateCode (${region?.stateCode}) genuinely differs — case is still live`);
  }
}

// --- Regression: single-state metros must resolve exactly as before ---
const UNCHANGED = [
  { name: "Atlanta GA",     lat: 33.7490, lon: -84.3880, state: "GA" },
  { name: "Chicago IL",     lat: 41.8781, lon: -87.6298, state: "IL" },
  { name: "Houston TX",     lat: 29.7604, lon: -95.3698, state: "TX" },
  { name: "Miami FL",       lat: 25.7617, lon: -80.1918, state: "FL" },
  { name: "Los Angeles CA", lat: 34.0522, lon: -118.2437, state: "CA" },
  { name: "Manhattan NY",   lat: 40.7580, lon: -73.9855, state: "NY" },
];
for (const c of UNCHANGED) {
  const region = regionForCoordinate(c.lat, c.lon);
  const got = stateForCoordinate(c.lat, c.lon);
  ok(got === c.state, `${c.name}: site state = ${c.state} (got ${got})`);
  ok(region?.stateCode === c.state,
    `${c.name}: metro stateCode already agreed (${region?.stateCode}) — no behaviour change`);
}

// --- Null-safety: callers must fall back to region.stateCode, never crash ---
const NULL_CASES = [
  { name: "London UK",        lat: 51.5074, lon: -0.1278 },
  { name: "Tokyo JP",         lat: 35.6762, lon: 139.6503 },
  { name: "mid-Atlantic sea", lat: 35.0000, lon: -50.0000 },
  { name: "NaN coordinates",  lat: NaN,     lon: NaN },
];
for (const c of NULL_CASES) {
  let got, threw = false;
  try { got = stateForCoordinate(c.lat, c.lon); } catch { threw = true; }
  ok(!threw && got === null, `${c.name}: returns null without throwing (got ${threw ? "THROW" : got})`);
}

console.log(fails === 0 ? "\nAll state-dispatch checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
