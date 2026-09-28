// Region parity check: every ACTIVE region in the engine's registry
// (src/lib/regions.ts) must be servable by the analyzer's regional
// intersection loader (api-server/src/lib/regional-intersections.ts).
//
// This is the invariant that broke on 2026-06-01: the Tier-11 commit added
// 12 metros to the engine registry + data files but never added their
// REGION_INFO entries, so every study request in those regions 400'd at the
// inventory fetch ("Unknown region for regional-intersections") for almost
// three months. The registries are deliberately duplicated across the two
// workspaces (no runtime cross-package import), so the sync has to be
// enforced by a check instead.
//
// Three layers, cheapest first:
//   1. registry parity — active engine code ∈ analyzer REGION_INFO
//   1b. bounds parity — REGION_INFO bounds === regions.ts bounds, except the
//      documented zone-origin overrides below (#233 widened Pittsburgh in
//      regions.ts only, and nothing noticed)
//   2. data files on disk for every served region (atlanta has its own path)
//   3. loadRegionalIntersections() smoke on the 12 once-broken codes:
//      non-empty inventory, proving registry + files + parse end to end.
//
// Run: pnpm run check:region-parity   (or: node ./scripts/verify-region-parity.mjs)
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { REGIONS } = await import(path.resolve(here, "../src/lib/regions.ts"));
const { servedRegionCodes, servedRegionBounds, regionCodeToSlug, loadRegionalIntersections, _clearRegionalCache } =
  await import(path.resolve(here, "../../api-server/src/lib/regional-intersections.ts"));

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const active = Object.values(REGIONS).filter((r) => r.active).map((r) => r.code).sort();
const served = new Set(servedRegionCodes());

// 1. Registry parity.
const missing = active.filter((c) => !served.has(c));
ok(missing.length === 0,
  `every active engine region has a REGION_INFO entry (${active.length} active, missing: ${missing.length ? missing.join(", ") : "none"})`);

// 1b. Bounds parity. REGION_INFO.bounds is computeZone's zone-label origin:
// its midpoint, with everything inside 4 mi labeled "Central <metro>". It has
// to follow regions.ts, EXCEPT where regions.ts widened a box lopsidedly and
// the widened box's midpoint would drag the origin off the city. Those keep
// their historical core box, listed here with the reason and documented on
// their REGION_INFO entries.
const ZONE_ORIGIN_OVERRIDES = {
  new_york_metro: "Suffolk coverage box: the envelope's midpoint is 40.6 mi east, in the Great South Bay",
  pittsburgh_metro: "#233's north/east ring: the envelope's midpoint is 7.8 mi NE in Fox Chapel; downtown would print SW",
};
const fmtBox = (b) => `${b.latMin}..${b.latMax}, ${b.lonMin}..${b.lonMax}`;
const sameBox = (a, b) => ["latMin", "latMax", "lonMin", "lonMax"].every((k) => a[k] === b[k]);
const drifted = [], staleOverrides = [], strayOrigins = [];
for (const code of servedRegionCodes()) {
  const canon = REGIONS[code]?.bounds;
  if (!canon) continue;
  const mine = servedRegionBounds(code);
  const override = Object.hasOwn(ZONE_ORIGIN_OVERRIDES, code);
  if (sameBox(mine, canon)) { if (override) staleOverrides.push(code); continue; }
  if (!override) { drifted.push(`${code} (REGION_INFO ${fmtBox(mine)}; regions.ts ${fmtBox(canon)})`); continue; }
  const cLat = (mine.latMin + mine.latMax) / 2, cLon = (mine.lonMin + mine.lonMax) / 2;
  if (cLat < canon.latMin || cLat > canon.latMax || cLon < canon.lonMin || cLon > canon.lonMax) strayOrigins.push(code);
}
ok(drifted.length === 0,
  drifted.length
    ? `REGION_INFO bounds differ from regions.ts: ${drifted.join("; ")}. Copy the regions.ts box, unless its midpoint no longer sits on the metro core — then keep the old box and add the region to ZONE_ORIGIN_OVERRIDES with the reason`
    : `REGION_INFO bounds match regions.ts for every served region (${Object.keys(ZONE_ORIGIN_OVERRIDES).length} documented zone-origin overrides)`);
ok(staleOverrides.length === 0,
  `every zone-origin override still differs from regions.ts (${staleOverrides.length ? "now identical, remove from ZONE_ORIGIN_OVERRIDES: " + staleOverrides.join(", ") : "none stale"})`);
ok(strayOrigins.length === 0,
  `every override's zone origin lies inside its regions.ts box (${strayOrigins.length ? "outside: " + strayOrigins.join(", ") : "all inside"})`);

// 2. Data files on disk. Atlanta is served by its own hand-curated route, not
// the regional loader, so it is exempt from the slug-file convention.
const dataDir = path.resolve(here, "../../api-server/src/data");
const noFiles = [];
for (const code of active) {
  if (code === "atlanta_metro") continue;
  const slug = regionCodeToSlug(code);
  const wants = [
    `${slug}-aadt.json`,
    `${slug}-signals.json`,
  ];
  const roads = [`${slug}-roads.json.gz`, `${slug}-roads.json`];
  const missing = wants.filter((f) => !existsSync(path.join(dataDir, f)));
  if (!roads.some((f) => existsSync(path.join(dataDir, f)))) missing.push(roads[0]);
  if (missing.length) noFiles.push(`${code} (${missing.join(", ")})`);
}
ok(noFiles.length === 0,
  `every active region has aadt+signals+roads data files (${noFiles.length ? "missing: " + noFiles.join("; ") : "all present"})`);

// 2b. Statewide regions must ship a signal-names sidecar: their live naming
// pass takes minutes (georgia ~140s post-residential-refetch) while the
// engine's inventory fetch allows 30s, so without the sidecar every
// first-touch study at a rural site fails. Regenerate with
// api-server/scripts/generate-signal-names.mjs after any roads/signals refetch.
const statewide = active.filter((c) => c.endsWith("_statewide"));
const noSidecar = statewide.filter((c) =>
  !existsSync(path.join(dataDir, `${regionCodeToSlug(c)}-signal-names.json`)));
ok(noSidecar.length === 0,
  `every statewide region has a signal-names sidecar (${noSidecar.length ? "missing: " + noSidecar.join(", ") : statewide.length + " present"})`);

// 3. End-to-end smoke on the 12 once-broken Tier-11 codes.
const TIER11 = [
  "addis_ababa_metro", "almaty_metro", "belgrade_metro", "dakar_metro",
  "dar_es_salaam_metro", "dhaka_metro", "kuwait_city_metro", "muscat_metro",
  "sofia_metro", "tunis_metro", "vilnius_metro", "zagreb_metro",
];
for (const code of TIER11) {
  let n = 0, err = "";
  try {
    n = loadRegionalIntersections(code).length;
  } catch (e) {
    err = ` — threw: ${e?.message ?? e}`;
  }
  ok(n > 0, `${code}: loader returns a non-empty inventory (${n} signals)${err}`);
}
_clearRegionalCache();

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
