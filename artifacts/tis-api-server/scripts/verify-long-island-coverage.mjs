/**
 * Verify that `new_york_metro` covers Nassau AND Suffolk — the full Long
 * Island half of the New York-Newark-Jersey City MSA — and that it does NOT
 * claim the Connecticut or Rhode Island shoreline across Long Island Sound.
 *
 * The region was one 40.2-41.2 / -74.5..-73.4 box, which stopped just past
 * Nassau. Suffolk (~1.5M people, the eastern two-thirds of the island) fell
 * outside every active region, so a Hauppauge site returned "outside our 300
 * covered metros" while Nassau, one county west, worked. PR #100 shipped six
 * hosted NY county samples and had to skip Suffolk for this reason.
 *
 * The fix is a union of rectangles rather than one wider box, because a box
 * wide enough for Montauk (-71.85) at latMax 41.2 also swallows Bridgeport,
 * Milford and New Haven — each a DIFFERENT metro, and claiming those with an
 * inventory that has no CT signals is the same defect pointed the other way.
 * So this script asserts both directions.
 *
 * Run:  pnpm run check:long-island-coverage
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { register } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
// regions.ts imports ./state-boundaries without an extension (tsc bundler
// mode), which plain node won't resolve.
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { regionForCoordinate, REGIONS } =
  await import(path.resolve(here, "../src/lib/regions.ts"));

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };

const NY = REGIONS["new_york_metro"];

// ── Suffolk + Nassau must resolve to new_york_metro ───────────────────────
// Hauppauge is the coordinate reported as broken on 2026-08-18.
const COVERED = [
  ["Hauppauge (reported)", 40.8176, -73.0776],
  ["Huntington",           40.8681, -73.4257],
  ["Babylon",              40.6957, -73.3257],
  ["Islip",                40.7298, -73.2104],
  ["Smithtown",            40.8559, -73.2007],
  ["Patchogue",            40.7657, -73.0151],
  ["Stony Brook",          40.9257, -73.1409],
  ["Port Jefferson",       40.9470, -73.0698],
  ["Riverhead",            40.9170, -72.6620],
  ["Westhampton",          40.8243, -72.6432],
  ["Southampton",          40.8843, -72.3898],
  ["East Hampton",         40.9634, -72.1848],
  ["Montauk",              41.0359, -71.9445],
  ["Montauk Point",        41.0712, -71.8573],
  ["Greenport",            41.1032, -72.3620],
  ["Orient Point",         41.1631, -72.2384],
  ["Shelter Island",       41.0690, -72.3454],
  ["Mattituck",            40.9931, -72.5342],
  ["Nassau: Hempstead",    40.7062, -73.6187],
  ["Nassau: Hicksville",   40.7684, -73.5251],
];

console.log("── Long Island coverage ──");
for (const [name, lat, lon] of COVERED) {
  const r = regionForCoordinate(lat, lon);
  ok(r?.code === "new_york_metro", `${name} (${lat}, ${lon}) → new_york_metro (got ${r?.code ?? "null"})`);
}

// ── Across the Sound: must NOT be claimed by new_york_metro ───────────────
// Every one of these is in a different metro or no metro at all. Claiming
// them would put a CT/RI site on an inventory with zero CT/RI signals.
const NOT_COVERED = [
  ["Bridgeport CT",    41.1792, -73.1894],
  ["Stratford CT",     41.1845, -73.1332],
  ["Milford CT",       41.2223, -73.0565],
  ["New Haven CT",     41.3083, -72.9279],
  ["Branford CT",      41.2793, -72.8151],
  ["Guilford CT",      41.2890, -72.6817],
  ["Madison CT",       41.2793, -72.5987],
  ["Clinton CT",       41.2784, -72.5276],
  ["Old Saybrook CT",  41.2915, -72.3762],
  ["Old Lyme CT",      41.3159, -72.3395],
  ["Niantic CT",       41.3251, -72.1926],
  ["New London CT",    41.3557, -72.0995],
  ["Groton CT",        41.3501, -72.0784],
  ["Stonington CT",    41.3357, -71.9051],
  ["Watch Hill RI",    41.3098, -71.8584],
  ["Westerly RI",      41.3776, -71.8273],
  ["Block Island RI",  41.1719, -71.5781],
];

console.log("\n── Across Long Island Sound (must not be new_york_metro) ──");
for (const [name, lat, lon] of NOT_COVERED) {
  const r = regionForCoordinate(lat, lon);
  ok(r?.code !== "new_york_metro", `${name} (${lat}, ${lon}) is NOT new_york_metro (got ${r?.code ?? "null"})`);
}

// ── Deliberate exclusion: Fishers Island ──────────────────────────────────
// Legally part of Southold, Suffolk County, but it sits at 41.271 — north of
// box C's latMax. Reaching it would narrow the margin against Stonington CT
// (41.336) to 0.04 deg. ~230 residents, zero traffic signals. Excluded on
// purpose; asserted so the choice stays visible rather than accidental.
console.log("\n── Deliberate exclusions ──");
{
  const r = regionForCoordinate(41.2712, -72.0212);
  ok(r?.code !== "new_york_metro", `Fishers Island NY is deliberately excluded (got ${r?.code ?? "null"})`);
}

// ── Precedence must not move ──────────────────────────────────────────────
// Norwalk sits inside box A (unchanged) and resolves to bridgeport_metro on
// smallest-bbox-wins. Widening new_york_metro's summed area can only make it
// lose more contests, never steal one — this pins that.
console.log("\n── Precedence (unchanged behavior) ──");
{
  const r = regionForCoordinate(41.1177, -73.4082);
  ok(r?.code === "bridgeport_metro", `Norwalk CT still resolves to bridgeport_metro (got ${r?.code ?? "null"})`);
}
for (const [name, lat, lon] of [
  ["Manhattan",   40.7128, -74.0060],
  ["Newark NJ",   40.7357, -74.1724],
  ["White Plains",41.0340, -73.7629],
]) {
  const r = regionForCoordinate(lat, lon);
  ok(r?.code === "new_york_metro", `${name} still resolves to new_york_metro (got ${r?.code ?? "null"})`);
}

// ── Registry invariants ───────────────────────────────────────────────────
console.log("\n── Registry invariants ──");
const boxes = NY.coverageBoxes ?? [];
ok(boxes.length === 3, `new_york_metro declares 3 coverage boxes (got ${boxes.length})`);
const env = NY.bounds;
ok(
  boxes.every(
    (b) =>
      b.latMin >= env.latMin && b.latMax <= env.latMax &&
      b.lonMin >= env.lonMin && b.lonMax <= env.lonMax,
  ),
  "every coverage box sits inside the declared envelope bounds",
);
const boxA = boxes[0];
ok(
  boxA.latMin === 40.2 && boxA.latMax === 41.2 && boxA.lonMin === -74.5 && boxA.lonMax === -73.4,
  "box A is byte-identical to the pre-Suffolk bounds (no covered coordinate moves)",
);
const area = boxes.reduce((s, b) => s + (b.latMax - b.latMin) * (b.lonMax - b.lonMin), 0);
// Must stay ABOVE bridgeport_metro's 0.18 deg² so Stamford/Norwalk keep their
// own inventory, and the growth from 1.10 must not cross any active region
// that new_york_metro currently beats.
const bpt = REGIONS["bridgeport_metro"].bounds;
const bptArea = (bpt.latMax - bpt.latMin) * (bpt.lonMax - bpt.lonMin);
ok(area > bptArea, `summed area ${area.toFixed(4)} deg² yields to bridgeport_metro (${bptArea.toFixed(4)})`);

// No active region may sit in the gap between the OLD area (1.10) and the new
// summed area while overlapping box A — such a region would newly outrank
// new_york_metro and silently move coordinates that resolve today.
const OLD_AREA = 1.10;
const overlaps = (x, y) =>
  x.latMin < y.latMax && x.latMax > y.latMin && x.lonMin < y.lonMax && x.lonMax > y.lonMin;
const flipped = Object.values(REGIONS).filter((r) => {
  if (!r.active || r.code === "new_york_metro") return false;
  const rb = r.coverageBoxes ?? [r.bounds];
  if (!rb.some((b) => overlaps(boxA, b))) return false;
  const a = rb.reduce((s, b) => s + (b.latMax - b.latMin) * (b.lonMax - b.lonMin), 0);
  return a > OLD_AREA && a < area;
});
ok(flipped.length === 0, `no region flips precedence over box A (candidates: ${flipped.map((r) => r.code).join(", ") || "none"})`);

console.log(fails === 0 ? "\nAll Long Island coverage checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
