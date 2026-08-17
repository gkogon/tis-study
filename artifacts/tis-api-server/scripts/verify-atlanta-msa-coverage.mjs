/**
 * Verify that `atlanta_metro` covers the 29-county Atlanta-Sandy Springs-
 * Roswell MSA — and nothing beyond it.
 *
 * The region was one 33.4–34.2 / -84.9..-83.9 box, which held only 11 of the
 * 29 counties. The other 18 fell through to `georgia_statewide`, so a Walton
 * or Newton County sample PDF read "located within Georgia (statewide),
 * Georgia" and carried a "Region: Georgia (statewide)" row — understating
 * coverage in the home market these samples are sold into.
 *
 * The fix is a union of rectangles rather than one bigger box, because one
 * box around Meriwether, Morgan and Haralson necessarily also swallows
 * Athens, Rome, Gainesville and LaGrange — each a DIFFERENT MSA, and
 * mislabeling those is the same defect pointed the other way. So this script
 * asserts both directions: every MSA county seat resolves to atlanta_metro,
 * and every neighboring non-MSA seat does not.
 *
 * It also guards the inventory, which is keyed on region code: claiming a
 * county whose signals aren't in `atlanta-signals.json` would drop the site
 * onto the 15-mile nearest-N fallback and produce a WORSE study than the
 * statewide tier it replaced.
 *
 * Run:  pnpm run check:atlanta-msa-coverage
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { register } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
// regions.ts imports ./state-boundaries without an extension (tsc bundler
// mode), which plain node won't resolve.
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { regionForCoordinate, ATLANTA_METRO } =
  await import(path.resolve(here, "../src/lib/regions.ts"));

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };

// ── The 29 counties of the Atlanta MSA, by county seat ────────────────────
const MSA_SEATS = [
  ["Barrow", "Winder", 33.9926, -83.7202],
  ["Bartow", "Cartersville", 34.1651, -84.7999],
  ["Butts", "Jackson", 33.2946, -83.9660],
  ["Carroll", "Carrollton", 33.5801, -85.0766],
  ["Cherokee", "Canton", 34.2367, -84.4908],
  ["Clayton", "Jonesboro", 33.5223, -84.3532],
  ["Cobb", "Marietta", 33.9526, -84.5499],
  ["Coweta", "Newnan", 33.3807, -84.7997],
  ["Dawson", "Dawsonville", 34.4218, -84.1191],
  ["DeKalb", "Decatur", 33.7748, -84.2963],
  ["Douglas", "Douglasville", 33.7515, -84.7477],
  ["Fayette", "Fayetteville", 33.4487, -84.4549],
  ["Forsyth", "Cumming", 34.2073, -84.1402],
  ["Fulton", "Atlanta", 33.7490, -84.3880],
  ["Gwinnett", "Lawrenceville", 33.9562, -83.9880],
  ["Haralson", "Buchanan", 33.8021, -85.1866],
  ["Heard", "Franklin", 33.2765, -85.0983],
  ["Henry", "McDonough", 33.4473, -84.1469],
  ["Jasper", "Monticello", 33.3054, -83.6843],
  ["Lamar", "Barnesville", 33.0554, -84.1558],
  ["Meriwether", "Greenville", 33.0290, -84.7130],
  ["Morgan", "Madison", 33.5957, -83.4680],
  ["Newton", "Covington", 33.5968, -83.8602],
  ["Paulding", "Dallas", 33.9237, -84.8408],
  ["Pickens", "Jasper", 34.4676, -84.4291],
  ["Pike", "Zebulon", 33.1015, -84.3427],
  ["Rockdale", "Conyers", 33.6676, -84.0177],
  ["Spalding", "Griffin", 33.2468, -84.2641],
  ["Walton", "Monroe", 33.7948, -83.7132],
];

// The two coordinates from the original bug report, which resolved to
// "Georgia (statewide)" on 2026-08-16.
const REPORTED = [
  ["Monroe, Walton County", 33.7955, -83.7135],
  ["Loganville, Walton County", 33.8360, -83.8900],
];

// ── Neighbors that must NOT be claimed ────────────────────────────────────
// Each is a distinct MSA/micropolitan area. A single rectangle wide enough
// for the MSA's outer counties captures every one of these.
const NON_MSA = [
  ["Athens (Athens-Clarke MSA)", 33.9519, -83.3576],
  ["Watkinsville, Oconee (Athens MSA)", 33.8640, -83.4090],
  ["Gainesville, Hall (Gainesville MSA)", 34.2979, -83.8241],
  ["Rome, Floyd (Rome MSA)", 34.2570, -85.1647],
  ["Macon, Bibb (Macon MSA)", 32.8407, -83.6324],
  ["Forsyth, Monroe County (Macon MSA)", 33.0343, -83.9377],
  ["LaGrange, Troup", 33.0387, -85.0313],
  ["Calhoun, Gordon", 34.5026, -84.9510],
  ["Thomaston, Upson", 32.8882, -84.3266],
  ["Cedartown, Polk", 34.0112, -85.2555],
  ["Jefferson, Jackson County", 34.1165, -83.5735],
  ["Eatonton, Putnam", 33.3264, -83.3885],
  ["Dahlonega, Lumpkin", 34.5326, -83.9846],
  ["Greensboro, Greene", 33.5760, -83.1821],
  ["Ellijay, Gilmer", 34.6948, -84.4821],
];

console.log("── 29 MSA county seats resolve to atlanta_metro ──");
for (const [county, seat, lat, lon] of MSA_SEATS) {
  const r = regionForCoordinate(lat, lon);
  ok(r?.code === "atlanta_metro", `${county} County (${seat}) → ${r?.code ?? "null"}`);
}

console.log("\n── Reported bug coordinates ──");
for (const [name, lat, lon] of REPORTED) {
  const r = regionForCoordinate(lat, lon);
  ok(r?.code === "atlanta_metro", `${name} → ${r?.displayName ?? "null"}`);
}

console.log("\n── Neighboring non-MSA areas keep their own region ──");
for (const [name, lat, lon] of NON_MSA) {
  const r = regionForCoordinate(lat, lon);
  ok(r?.code !== "atlanta_metro", `${name} → ${r?.code ?? "null"} (not atlanta_metro)`);
}

// ── Inventory guard ───────────────────────────────────────────────────────
// Signals are loaded by region code, so a claimed county with no signals in
// atlanta-signals.json is worse off than it was under georgia_statewide.
console.log("\n── atlanta-signals.json reaches the counties now claimed ──");
const DATA = path.resolve(here, "../../api-server/src/data");
const signals = JSON.parse(readFileSync(path.join(DATA, "atlanta-signals.json"), "utf8"));
const statewide = JSON.parse(readFileSync(path.join(DATA, "georgia-statewide-signals.json"), "utf8"));

const R_M = 6371000, M_PER_MI = 1609.34;
function distMi(lat1, lon1, lat2, lon2) {
  const p = Math.PI / 180;
  const dLa = (lat2 - lat1) * p, dLo = (lon2 - lon1) * p;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dLo / 2) ** 2;
  return (2 * R_M * Math.asin(Math.sqrt(s))) / M_PER_MI;
}
/**
 * Distinct physical junctions within `mi` of the site — the raw records
 * collapsed the way the engine collapses them. Counting raw tuples instead
 * would compare the two extracts' redundancy rather than their coverage: the
 * statewide extract records both carriageways of a divided arterial as
 * separate nodes, and `dedupCloseSignals` merges anything within
 * DEDUP_DISTANCE_M into one study intersection. Distance-only here (the
 * engine's name rule needs names these raw tuples don't carry), which is the
 * conservative subset — it can only over-count, never hide a gap.
 */
const DEDUP_M = 45;
function junctionsWithin(inv, lat, lon, mi) {
  const near = inv
    .filter((s) => distMi(lat, lon, s[1], s[2]) <= mi)
    .sort((a, b) => distMi(lat, lon, a[1], a[2]) - distMi(lat, lon, b[1], b[2]));
  const kept = [];
  for (const s of near) {
    if (kept.some((k) => distMi(k[1], k[2], s[1], s[2]) * M_PER_MI <= DEDUP_M)) continue;
    kept.push(s);
  }
  return kept.length;
}

// 1.25 mi is the radius the hosted county samples are generated at.
const RADIUS_MI = 1.25;
for (const [county, seat, lat, lon] of MSA_SEATS) {
  const atl = junctionsWithin(signals, lat, lon, RADIUS_MI);
  const ga = junctionsWithin(statewide, lat, lon, RADIUS_MI);
  // Heard and Meriwether have no signalized intersection near the seat in
  // EITHER inventory — genuinely rural, and the nearest-N fallback is the
  // right answer there. The guard is only that Atlanta is never worse than
  // the statewide tier it took the county from.
  ok(
    atl >= ga,
    `${county} County (${seat}): ${atl} junctions within ${RADIUS_MI} mi ` +
      `(georgia_statewide would give ${ga})`,
  );
}

// ── Registry invariants ───────────────────────────────────────────────────
console.log("\n── Registry invariants ──");
const boxes = ATLANTA_METRO.coverageBoxes ?? [];
ok(boxes.length > 0, "atlanta_metro declares coverageBoxes");
const env = ATLANTA_METRO.bounds;
ok(
  boxes.every(
    (b) =>
      b.latMin >= env.latMin && b.latMax <= env.latMax &&
      b.lonMin >= env.lonMin && b.lonMax <= env.lonMax,
  ),
  "every coverage box sits inside the declared envelope bounds",
);
const area = boxes.reduce((s, b) => s + (b.latMax - b.latMin) * (b.lonMax - b.lonMin), 0);
// Must stay below georgia_statewide's ~22.55 deg² to win the smallest-area
// tiebreak, and above macon_metro's 0.49 deg² so Macon keeps its own counties.
ok(area < 22.55, `summed coverage area ${area.toFixed(2)} deg² beats georgia_statewide (22.55)`);
ok(area > 0.49, `summed coverage area ${area.toFixed(2)} deg² yields to macon_metro (0.49)`);

console.log(fails === 0 ? "\nAll Atlanta MSA coverage checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
