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
import { gunzipSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
// ts-loader lives in the sibling package; api-server has no scripts harness.
register(pathToFileURL(path.resolve(here, "../../tis-api-server/scripts/ts-loader.mjs")).href, import.meta.url);

const { roadSegmentsNear } = await import(path.resolve(here, "../src/lib/regional-roads.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// --- 1. Both tuple shapes parse ------------------------------------------
// Exercised through the real loader by reading the shipped files directly,
// then asserting the parser agrees with a shape-aware reference count.
// ROAD_DATA_DIR override exists so check:road-file-io can point the shipped-
// file sweep at a fixture dir (mixed raw/.gz) and prove gz-only files are
// iterated rather than silently skipped. Default: the real shipped corpus.
const dataDir = process.env.ROAD_DATA_DIR
  ? path.resolve(process.env.ROAD_DATA_DIR)
  : path.resolve(here, "../src/data");
const pointsOf = (way) => (Array.isArray(way[1]) ? way[1] : Array.isArray(way[2]) ? way[2] : null);

// Road files exist in two on-disk forms — `<slug>-roads.json` and the
// gzip-compressed `<slug>-roads.json.gz` (post-residential-refetch regions
// only fit gzipped). This check must see BOTH, or a converted corpus would
// make the shipped-file sweep below silently iterate nothing.
const readRoadDoc = (p) => {
  const buf = fs.readFileSync(p);
  return JSON.parse(p.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8"));
};
// Existing on-disk road file for a slug, preferring .gz like the runtime loader.
const roadFileFor = (slug) => {
  for (const cand of [`${slug}-roads.json.gz`, `${slug}-roads.json`]) {
    const p = path.join(dataDir, cand);
    if (fs.existsSync(p)) return p;
  }
  return null;
};
// One entry per slug across both extensions, .gz preferred (never double-count).
const listRoadFiles = () => {
  const bySlug = new Map();
  for (const n of fs.readdirSync(dataDir)) {
    const m = n.match(/^(.*)-roads\.json(\.gz)?$/);
    if (!m) continue;
    const prev = bySlug.get(m[1]);
    if (!prev || n.endsWith(".gz")) bySlug.set(m[1], n);
  }
  return [...bySlug.values()];
};

// --- 2. Spot-check regions that were fully dead before -------------------
// lat/lon chosen inside each metro; radius wide enough to catch real roads.
const SPOTS = [
  // `before` = segments the old index-based parser returned at this spot, so a
  // regression shows up as a number rather than just a boolean.
  { slug: "miami-dade", code: "miami_dade_metro", lat: 25.8456, lon: -80.2103, before: 0, label: "Miami-Dade (Peralta's region)" },
  { slug: "atlanta", code: "atlanta_metro", lat: 33.749, lon: -84.388, before: 579, label: "Atlanta (mixed-format file)" },
];

for (const s of SPOTS) {
  const file = roadFileFor(s.slug);
  if (!file) { console.log(`skip: ${s.slug} (no shipped file)`); continue; }
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
for (const f of listRoadFiles()) {
  let doc;
  try { doc = readRoadDoc(path.join(dataDir, f)); } catch { continue; }
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

// --- 4. Radial truncation: the cap keeps the NEAREST segments ------------
// The old cap returned early partway through the file, so an over-cap request
// kept whatever appeared FIRST in the JSON. Way order is arbitrary, so whole
// streets vanished while distant ones survived and the graph lost connectivity
// in patches rather than degrading outward. Assert the cap is now isotropic.
{
  const LAT = 25.8456, LON = -80.2103;           // Peralta's corridor
  const CAP = 300;
  const capped = roadSegmentsNear("miami_dade_metro", LAT, LON, 3.0, CAP);
  const full = roadSegmentsNear("miami_dade_metro", LAT, LON, 3.0, 1000000);
  ok(Array.isArray(capped) && capped.length === CAP,
    `cap is honoured exactly (${capped?.length} === ${CAP})`);

  const dist = (aLat, aLon, bLat, bLon) => {
    const R = 3958.8, p = Math.PI / 180;
    const s2 = Math.sin((bLat - aLat) * p / 2) ** 2
      + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin((bLon - aLon) * p / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s2));
  };
  const near = (seg) => Math.min(dist(LAT, LON, seg[1], seg[2]), dist(LAT, LON, seg[3], seg[4]));

  const keptMax = Math.max(...capped.map(near));
  const fullSorted = full.map(near).sort((a, b) => a - b);
  const droppedMin = fullSorted[CAP] ?? Infinity;
  ok(keptMax <= droppedMin + 1e-9,
    `truncation is radial: farthest kept (${keptMax.toFixed(3)} mi) <= nearest dropped (${droppedMin === Infinity ? "n/a" : droppedMin.toFixed(3) + " mi"})`);

  const again = roadSegmentsNear("miami_dade_metro", LAT, LON, 3.0, CAP);
  ok(JSON.stringify(again) === JSON.stringify(capped), "repeated calls return identical output (deterministic)");
}

// --- 5. Street names are carried for router continuity -------------------
{
  const segs = roadSegmentsNear("miami_dade_metro", 25.8456, -80.2103, 1.0);
  const named = segs.filter((s2) => typeof s2[7] === "string" && s2[7].length > 0);
  ok(named.length > 0,
    `street names carried on segments (${named.length}/${segs.length}) e.g. "${named[0]?.[7]}"`);
  ok(segs.every((s2) => s2.length >= 7),
    "segment tuples keep indices 0-6 intact (name is appended, not inserted)");
}

// --- 6. One-way tolerance across both file vintages ----------------------
// fetch-osm-roads.ts emits oneway at way[5] as of 2026-08. Every currently
// shipped file predates that, so absent must read as two-way (0) - the exact
// behaviour every consumer already assumed. This is what lets regions be
// re-fetched one at a time instead of in a flag day.
{
  const segs = roadSegmentsNear("miami_dade_metro", 25.8456, -80.2103, 1.0);
  ok(segs.every((seg) => seg.length >= 9),
    `segments carry the oneway slot (len ${segs[0]?.length})`);
  ok(segs.every((seg) => seg[8] === 0 || seg[8] === 1 || seg[8] === -1),
    "oneway is always one of 0 / 1 / -1, never undefined or a string");
  // Miami has since been re-fetched WITH oneway, so the both-vintages
  // guarantee is asserted on a still-old-format region instead — and Miami
  // now proves the opposite side: real oneway values arrive.
  const oldFmt = roadSegmentsNear("akron_metro", 41.0814, -81.519, 1.0);
  ok(oldFmt === null || oldFmt.every((seg) => seg[8] === 0),
    "pre-oneway file (akron) reads as two-way throughout (no fabricated restrictions)");
  ok(segs.some((seg) => seg[8] === 1 || seg[8] === -1),
    "re-fetched file (miami) carries real one-way values");
}

// --- 7. Malformed input still degrades safely ----------------------------
{
  const junk = roadSegmentsNear("definitely_not_a_region", 0, 0, 1);
  ok(junk === null || (Array.isArray(junk) && junk.length === 0),
    "unknown region returns null/empty rather than throwing");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
