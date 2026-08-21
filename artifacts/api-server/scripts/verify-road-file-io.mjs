// Byte/parse-equality check for gzip road-file IO.
//
// The residential refetch grows the road corpus past GitHub's 100MB
// per-file limit (florida-statewide ~116MB raw), so road files become
// gzip-compressed with dual-read everywhere: <slug>-roads.json.gz
// preferred, <slug>-roads.json fallback. This check proves the equality
// half of that contract through the REAL loader paths, never a private
// re-implementation:
//
//   1. A gzipped fixture loads segment-for-segment identical to its raw
//      twin through regional-roads.ts (findDataFile + readJsonMaybeGz via
//      roadSegmentsNear) AND regional-signal-naming.ts (readDataJson via
//      getSignalNamesForRegion).
//   2. The scripts/src/gzip-roads.ts converter verifies from disk before
//      deleting raw, and is idempotent (second run rewrites nothing).
//   3. .gz is preferred over .json when both exist in one directory.
//   4. verify-road-parser.mjs iterates a mixed .json/.gz data dir and does
//      NOT silently skip gz-only regions (via its ROAD_DATA_DIR override).
//
// The live src/data is never touched: fixture content is copied from the
// smallest shipped region into a temp dir that the runtime loader reaches
// through its process.cwd() candidates, under fictional slugs
// (zz-gzcheck-*) that exist nowhere in the real corpus.
//
// Run: node ./scripts/verify-road-file-io.mjs   (pnpm run check:road-file-io)
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const tsLoader = path.resolve(here, "../../tis-api-server/scripts/ts-loader.mjs");
register(pathToFileURL(tsLoader).href, import.meta.url);

const { roadSegmentsNear } = await import(path.resolve(here, "../src/lib/regional-roads.ts"));
const { getSignalNamesForRegion } = await import(path.resolve(here, "../src/lib/regional-signal-naming.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const realDataDir = path.resolve(here, "../src/data");
const gzipRoadsTs = path.resolve(here, "../../../scripts/src/gzip-roads.ts");

const readRoadDoc = (p) => {
  const buf = fs.readFileSync(p);
  return JSON.parse(p.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8"));
};
const pointsOf = (way) => (Array.isArray(way[1]) ? way[1] : Array.isArray(way[2]) ? way[2] : null);

// --- 0. Pick fixture source: smallest shipped region whose signals sit
// near named ways (so the naming path produces a non-empty map). ---------
function pickFixtureRegion() {
  const entries = fs.readdirSync(realDataDir)
    .filter((n) => /-roads\.json(\.gz)?$/.test(n))
    .map((n) => ({
      slug: n.replace(/-roads\.json(\.gz)?$/, ""),
      file: path.join(realDataDir, n),
      size: fs.statSync(path.join(realDataDir, n)).size,
    }))
    .sort((a, b) => a.size - b.size);
  for (const e of entries.slice(0, 10)) {
    const sigPath = path.join(realDataDir, `${e.slug}-signals.json`);
    if (!fs.existsSync(sigPath)) continue;
    let doc, signals;
    try {
      doc = readRoadDoc(e.file);
      signals = JSON.parse(fs.readFileSync(sigPath, "utf8"));
    } catch { continue; }
    if (!Array.isArray(doc?.ways) || !doc.ways.length || !Array.isArray(signals) || !signals.length) continue;
    // Crude proximity precheck: any of the first 200 non-negative-id signals
    // within ~150m of a named-way vertex → naming map will be non-empty.
    const namedPts = [];
    for (const w of doc.ways) {
      if (typeof w[1] !== "string" || !w[1].trim()) continue;
      const pts = pointsOf(w);
      if (pts) for (const p of pts) namedPts.push(p);
      if (namedPts.length > 20000) break;
    }
    const hit = signals.slice(0, 200).some(([id, la, lo]) =>
      id >= 0 && namedPts.some(([pa, po]) => Math.abs(pa - la) < 0.0015 && Math.abs(po - lo) < 0.0015));
    if (hit) return { ...e, doc, signals };
  }
  return null;
}

const fixture = pickFixtureRegion();
ok(fixture !== null, `fixture source region found (${fixture?.slug}, ${fixture?.size?.toLocaleString()} B)`);
if (!fixture) { console.error("cannot continue without a fixture region"); process.exit(1); }

const rawBytes = Buffer.from(JSON.stringify(fixture.doc), "utf8");
const sigBytes = fs.readFileSync(path.join(realDataDir, `${fixture.slug}-signals.json`));

// Probe point: first vertex of the first way with geometry.
let probe = null;
for (const w of fixture.doc.ways) { const p = pointsOf(w); if (p && p.length) { probe = p[0]; break; } }
ok(Array.isArray(probe), `probe point derived from fixture geometry (${probe})`);

// --- Fixture layout in a temp dir reached via findData's cwd candidates --
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "road-file-io-"));
const fixDataDir = path.join(tempRoot, "artifacts/api-server/src/data");
fs.mkdirSync(fixDataDir, { recursive: true });
const prevCwd = process.cwd();

try {
  // slug A: raw-only twin. slug B: starts raw, converter makes it gz-only.
  // slug C: garbage raw + valid gz — proves .gz wins within a directory.
  fs.writeFileSync(path.join(fixDataDir, "zz-gzcheck-raw-roads.json"), rawBytes);
  fs.writeFileSync(path.join(fixDataDir, "zz-gzcheck-raw-signals.json"), sigBytes);
  fs.writeFileSync(path.join(fixDataDir, "zz-gzcheck-gz-roads.json"), rawBytes);
  fs.writeFileSync(path.join(fixDataDir, "zz-gzcheck-gz-signals.json"), sigBytes);
  fs.writeFileSync(path.join(fixDataDir, "zz-gzcheck-pref-roads.json"), "NOT JSON {{{");
  fs.writeFileSync(path.join(fixDataDir, "zz-gzcheck-pref-roads.json.gz"), gzipSync(rawBytes, { level: 9 }));

  // --- 1. Converter: verify-before-delete, then idempotency --------------
  const boot = path.join(tempRoot, "boot-gzip-roads.mjs");
  fs.writeFileSync(boot, [
    `import { register } from "node:module";`,
    `import { pathToFileURL } from "node:url";`,
    `register(pathToFileURL(${JSON.stringify(tsLoader)}).href, pathToFileURL(${JSON.stringify(gzipRoadsTs)}).href);`,
    `await import(pathToFileURL(${JSON.stringify(gzipRoadsTs)}).href);`,
  ].join("\n"));
  const runConverter = (...args) =>
    spawnSync(process.execPath, [boot, ...args], { encoding: "utf8", cwd: tempRoot });

  const conv1 = runConverter("--data-dir", fixDataDir, "--replace", "zz-gzcheck-gz");
  ok(conv1.status === 0, `converter run 1 exits 0 (stderr: ${conv1.stderr?.trim() || "none"})`);
  const gzPath = path.join(fixDataDir, "zz-gzcheck-gz-roads.json.gz");
  ok(fs.existsSync(gzPath), "converter wrote zz-gzcheck-gz-roads.json.gz");
  ok(!fs.existsSync(path.join(fixDataDir, "zz-gzcheck-gz-roads.json")),
    "--replace deleted the raw file only after disk round-trip verification");
  ok(gunzipSync(fs.readFileSync(gzPath)).equals(rawBytes),
    "on-disk .gz gunzips byte-identical to the raw source");

  const conv2 = runConverter("--data-dir", fixDataDir, "--replace", "zz-gzcheck-gz");
  ok(conv2.status === 0 && /already gz-only/.test(conv2.stdout),
    "converter run 2 is a no-op on the gz-only region (idempotent)");

  // --- 2. Loader equality through the REAL runtime paths -----------------
  // The fictional slugs exist nowhere under __dirname candidates, so
  // findData falls through to its process.cwd() candidates → tempRoot.
  process.chdir(tempRoot);
  const [lat, lon] = probe;

  const segsRaw = roadSegmentsNear("zz_gzcheck_raw", lat, lon, 10.0, 1000000);
  const segsGz = roadSegmentsNear("zz_gzcheck_gz", lat, lon, 10.0, 1000000);
  ok(Array.isArray(segsRaw) && segsRaw.length > 0,
    `raw fixture loads through roadSegmentsNear (${segsRaw?.length ?? 0} segments)`);
  ok(Array.isArray(segsGz) && segsGz.length === segsRaw?.length,
    `gz fixture returns the same segment count (${segsGz?.length ?? 0})`);
  ok(JSON.stringify(segsRaw) === JSON.stringify(segsGz),
    "roadSegmentsNear: gz twin is segment-for-segment identical to raw");

  const serializeNames = (m) => JSON.stringify([...m.entries()].sort((a, b) => a[0] - b[0]));
  const namesRaw = getSignalNamesForRegion("zz_gzcheck_raw");
  const namesGz = getSignalNamesForRegion("zz_gzcheck_gz");
  ok(namesRaw.size > 0, `raw fixture names signals (${namesRaw.size} named)`);
  ok(namesGz.size === namesRaw.size, `gz fixture names the same signal count (${namesGz.size})`);
  ok(serializeNames(namesRaw) === serializeNames(namesGz),
    "getSignalNamesForRegion: gz twin yields an identical naming map");

  // --- 3. .gz preferred over .json within a directory --------------------
  const segsPref = roadSegmentsNear("zz_gzcheck_pref", lat, lon, 10.0, 1000000);
  ok(Array.isArray(segsPref) && JSON.stringify(segsPref) === JSON.stringify(segsRaw),
    ".gz wins over a (garbage) raw sibling — loader read the compressed twin");

  // --- 4. verify-road-parser sweeps mixed and gz-only dirs ---------------
  process.chdir(prevCwd);
  const verifier = path.resolve(here, "verify-road-parser.mjs");
  const runVerifier = (dir) => spawnSync(process.execPath, [verifier], {
    encoding: "utf8",
    cwd: path.resolve(here, ".."),
    env: { ...process.env, ROAD_DATA_DIR: dir },
  });

  const mixed = runVerifier(fixDataDir);
  ok(mixed.status === 0,
    `verify-road-parser passes against a mixed .json/.gz data dir (exit ${mixed.status})`);

  const gzOnlyDir = path.join(tempRoot, "gz-only-data");
  fs.mkdirSync(gzOnlyDir, { recursive: true });
  fs.copyFileSync(gzPath, path.join(gzOnlyDir, "zz-gzcheck-gz-roads.json.gz"));
  const gzOnly = runVerifier(gzOnlyDir);
  const swept = gzOnly.stdout.match(/of all shipped ways parse \((\d+)\/(\d+)/);
  ok(gzOnly.status === 0 && swept && Number(swept[2]) > 0,
    `verify-road-parser does not silently skip gz-only regions (swept ${swept?.[2] ?? 0} ways, exit ${gzOnly.status})`);
} finally {
  process.chdir(prevCwd);
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
