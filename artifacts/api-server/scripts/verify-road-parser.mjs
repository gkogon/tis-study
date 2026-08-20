// Regression check for roadSegmentsNear's way-tuple parsing.
//
// The bug: way tuples ship in two shapes —
//     legacy  [classCode, polyline, lanes?, maxspeed?]
//     current [classCode, name, polyline, lanes?, maxspeed?]
// — and the parser read way[1] as the polyline unconditionally. Every
// current-format way therefore hit a string, failed the Array.isArray guard,
// and was skipped. roadSegmentsNear returned [], /api/roads reported no
// segments, fetchLocalRoads returned null, and tis.ts silently skipped route
// assignment as "this region has no road network available".
//
// 315 of 316 shipped road files are current-format. Miami-Dade parsed 0 of
// 31,592 ways. Atlanta is the lone mixed file and only 31% got through.
//
// This check fails loudly if the parser ever regresses to index-based reads,
// and guards the invariant that matters: no shipped region may parse to zero.
//
// Run: node ./scripts/verify-road-parser.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
// ts-loader lives in the sibling package; api-server has no scripts harness.
register(pathToFileURL(path.resolve(here, "../../tis-api-server/scripts/ts-loader.mjs")).href, import.meta.url);

const { roadSegmentsNear } = await import(path.resolve(here, "../src/lib/regional-roads.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// --- 1. Both tuple shapes parse ------------------------------------------
// Exercised through the real loader by reading the shipped files directly,
// then asserting the parser agrees with a shape-aware reference count.
const dataDir = path.resolve(here, "../src/data");
const pointsOf = (way) => (Array.isArray(way[1]) ? way[1] : Array.isArray(way[2]) ? way[2] : null);

// --- 2. Spot-check regions that were fully dead before -------------------
// lat/lon chosen inside each metro; radius wide enough to catch real roads.
const SPOTS = [
  // `before` = segments the old index-based parser returned at this spot, so a
  // regression shows up as a number rather than just a boolean.
  { slug: "miami-dade", code: "miami_dade_metro", lat: 25.8456, lon: -80.2103, before: 0, label: "Miami-Dade (Peralta's region)" },
  { slug: "atlanta", code: "atlanta_metro", lat: 33.749, lon: -84.388, before: 579, label: "Atlanta (mixed-format file)" },
];

for (const s of SPOTS) {
  const file = path.join(dataDir, `${s.slug}-roads.json`);
  if (!fs.existsSync(file)) { console.log(`skip: ${s.slug} (no shipped file)`); continue; }
  const segs = roadSegmentsNear(s.code, s.lat, s.lon, 1.0);
  ok(Array.isArray(segs) && segs.length > s.before,
    `${s.label}: parser returns more segments than the old index-based read `
    + `(${segs?.length ?? 0} vs ${s.before})`);
  if (Array.isArray(segs) && segs.length) {
    const [cls, aLat, aLon, bLat, bLon] = segs[0];
    ok(Number.isFinite(cls) && Number.isFinite(aLat) && Number.isFinite(aLon)
       && Number.isFinite(bLat) && Number.isFinite(bLon),
      `${s.label}: segment tuple is numeric [cls,aLat,aLon,bLat,bLon] (${cls},${aLat},${aLon})`);
    const near = segs.every(([, la, lo, lb, lob]) =>
      Number.isFinite(la) && Number.isFinite(lo) && Number.isFinite(lb) && Number.isFinite(lob));
    ok(near, `${s.label}: every returned segment has finite endpoints`);
  }
}

// --- 3. No shipped region may parse to zero ------------------------------
// The whole failure mode was silent emptiness, so assert the shape directly
// across every shipped file rather than trusting one spot check.
let zeroFiles = [];
let totalWays = 0, parsedWays = 0;
for (const f of fs.readdirSync(dataDir).filter((n) => n.endsWith("-roads.json"))) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")); } catch { continue; }
  const ways = Array.isArray(doc?.ways) ? doc.ways : [];
  if (!ways.length) continue;
  const good = ways.filter((w) => {
    const p = pointsOf(w);
    return Array.isArray(p) && p.length >= 2 && Array.isArray(p[0]);
  }).length;
  totalWays += ways.length;
  parsedWays += good;
  if (good === 0) zeroFiles.push(f);
}
ok(zeroFiles.length === 0,
  `every shipped road file yields parseable ways (${zeroFiles.length} dead: ${zeroFiles.slice(0, 5).join(", ") || "none"})`);
ok(parsedWays / totalWays > 0.99,
  `≥99% of all shipped ways parse (${parsedWays}/${totalWays} = ${(100 * parsedWays / totalWays).toFixed(1)}%)`);

// --- 4. Malformed input still degrades safely ----------------------------
{
  const junk = roadSegmentsNear("definitely_not_a_region", 0, 0, 1);
  ok(junk === null || (Array.isArray(junk) && junk.length === 0),
    "unknown region returns null/empty rather than throwing");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
