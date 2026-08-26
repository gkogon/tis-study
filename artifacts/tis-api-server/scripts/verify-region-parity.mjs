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
const { servedRegionCodes, regionCodeToSlug, loadRegionalIntersections, _clearRegionalCache } =
  await import(path.resolve(here, "../../api-server/src/lib/regional-intersections.ts"));

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const active = Object.values(REGIONS).filter((r) => r.active).map((r) => r.code).sort();
const served = new Set(servedRegionCodes());

// 1. Registry parity.
const missing = active.filter((c) => !served.has(c));
ok(missing.length === 0,
  `every active engine region has a REGION_INFO entry (${active.length} active, missing: ${missing.length ? missing.join(", ") : "none"})`);

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
