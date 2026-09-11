/**
 * Regression guard: the engine's same-junction dedup over the REAL Atlanta
 * inventory, not a mock.
 *
 * Every engine check that runs findAffectedIntersections mocks
 * /api/atlanta/intersections, and check:name-dedup exercises dedupCloseSignals
 * on synthetic points. Neither sees what the shipped Atlanta names do to the
 * study set. Until the 6-element roads-tuple fix in
 * api-server/src/lib/atlanta-signal-naming.ts, every Atlanta signal carried a
 * unique coordinate label ("Signal 35.6mi NE of CBD (34.0097, -83.8526)"), so
 * the NAME rule (same normalized name, 45-150 m apart) could never fire in
 * Atlanta and only the 45 m co-location rule ran. With derived cross-street
 * names the name rule fires the way it already does in every region served by
 * regional-signal-naming.ts: divided-arterial twins and the ramp terminals of
 * one interchange collapse into one study intersection, and the gravity step
 * then distributes trips across the survivors. That is the documented intent
 * of NAME_DEDUP_MAX_M and the report discloses it as
 * intersectionsMergedAsDuplicates, but it is a study-set change, not a
 * names-only change, and this check pins its size on the shipped data so a
 * roads or signals regeneration cannot move it silently.
 *
 * Measured on the 2026-08-21 roads file / 7,958-signal inventory:
 *   - metro-wide dedup keeps 4,286 junctions with the derived names against
 *     4,489 with coordinate labels; 292 records are absorbed by the name rule
 *     beyond 45 m (3.7 % of the inventory), none beyond 150 m.
 *   - a 1 mi study on the Cobb Parkway / I-285 interchange (site
 *     ATL-67547828) holds 130 records, keeps 53, merges 77 -- 65 by
 *     co-location, 12 by name, among them the second ramp terminal
 *     ATL-9864763702 124 m away. With coordinate labels the same radius
 *     kept 63.
 *
 * Re-pin the numbers only after confirming the new merges are genuine
 * co-located / same-junction records (print them with DEBUG=1).
 *
 * Run: `pnpm run check:atlanta-name-dedup`.
 */
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// atlanta-analysis.ts imports its siblings without extensions; the loader
// hook resolves them (same hook api-server's check:atlanta-naming uses).
register(pathToFileURL(path.resolve(here, "./ts-loader.mjs")).href, import.meta.url);

const {
  dedupCloseSignals,
  intersectionsWithinRadius,
  sameSignalName,
  haversineMeters,
  DEDUP_DISTANCE_M,
  NAME_DEDUP_MAX_M,
} = await import(path.resolve(here, "../src/lib/intersection-coverage.ts"));
const { getIntersectionSummaries } = await import(
  path.resolve(here, "../../api-server/src/lib/atlanta-analysis.ts")
);

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const debug = process.env.DEBUG === "1";

// Pinned on the shipped data (see header). Any drift means the study set of
// every Atlanta report moved; re-pin deliberately.
const INVENTORY = 7958;
const KEPT_WITH_NAMES = 4286;
const KEPT_WITH_COORDINATE_LABELS = 4489;
const NAME_ABSORBED_BEYOND_45M = 292;
// Over-collapse ceiling: the name rule may never remove more than this share
// of the inventory. 292 / 7958 is 3.7 %; a resolver change that hands two
// distinct junctions the same generic name would push past this first.
const MAX_NAME_ABSORB_SHARE = 0.05;

const SITE = { id: "ATL-67547828", radiusMi: 1 }; // Cobb Parkway South & I-285, Smyrna
const SITE_TWIN = "ATL-9864763702"; // second ramp terminal, 124 m south-east
const SITE_EXPECT = { within: 130, kept: 53, merged: 77, nameAbsorbed: 12 };
// The same radius with coordinate labels (the pre-fix inventory). Not simply
// kept + nameAbsorbed: a record the name rule absorbs can itself be the
// co-location anchor for others, so the pre-fix set is 63, not 65.
const SITE_KEPT_WITH_COORDINATE_LABELS = 63;

// ---------------------------------------------------------------------------
// 1. Real inventory, engine-identical candidate shape.
// ---------------------------------------------------------------------------
const inventory = getIntersectionSummaries();
ok(inventory.length === INVENTORY, `shipped Atlanta inventory has ${INVENTORY} signals (got ${inventory.length})`);
ok(
  inventory.every((s) => typeof s.name === "string" && s.name.length > 0 && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)),
  "every inventory row carries a name and coordinates (the fields dedupCloseSignals reads)",
);

// Metro-wide, distance order is irrelevant to the counts (every record is a
// candidate); use file order with a zero distance the way the engine would if
// the whole metro sat inside one radius.
const all = inventory.map((sig) => ({ sig, distanceMi: 0 }));
const named = dedupCloseSignals(all);
const coordinateLabelled = dedupCloseSignals(
  inventory.map((sig) => ({ sig: { ...sig, name: `Signal (${sig.latitude}, ${sig.longitude})` }, distanceMi: 0 })),
);
console.log(
  `info: metro-wide dedup keeps ${named.kept.length} / ${inventory.length} with derived names ` +
    `(${named.nameAbsorbedBeyond45m} absorbed by name beyond ${DEDUP_DISTANCE_M} m); ` +
    `${coordinateLabelled.kept.length} with coordinate labels (${coordinateLabelled.nameAbsorbedBeyond45m} by name)`,
);

// ---------------------------------------------------------------------------
// 2. The name rule now fires in Atlanta, and only within its ceiling.
// ---------------------------------------------------------------------------
ok(
  coordinateLabelled.nameAbsorbedBeyond45m === 0 && coordinateLabelled.kept.length === KEPT_WITH_COORDINATE_LABELS,
  `coordinate labels never trigger the name rule (kept ${coordinateLabelled.kept.length}, expected ${KEPT_WITH_COORDINATE_LABELS}) -- the pre-fix study set`,
);
ok(named.nameAbsorbedBeyond45m > 0, `derived names light up the name rule (${named.nameAbsorbedBeyond45m} absorbs beyond ${DEDUP_DISTANCE_M} m)`);
ok(
  named.nameAbsorbedBeyond45m === NAME_ABSORBED_BEYOND_45M,
  `name-rule absorbs beyond ${DEDUP_DISTANCE_M} m are pinned at ${NAME_ABSORBED_BEYOND_45M} (got ${named.nameAbsorbedBeyond45m})`,
);
ok(
  named.kept.length === KEPT_WITH_NAMES,
  `metro-wide kept count is pinned at ${KEPT_WITH_NAMES} (got ${named.kept.length}; ${KEPT_WITH_COORDINATE_LABELS - named.kept.length} fewer than with coordinate labels)`,
);
ok(
  named.nameAbsorbedBeyond45m / inventory.length <= MAX_NAME_ABSORB_SHARE,
  `name-rule absorbs stay under ${MAX_NAME_ABSORB_SHARE * 100} % of the inventory (${((named.nameAbsorbedBeyond45m / inventory.length) * 100).toFixed(1)} %)`,
);

// Structural: every merged record is explained by a kept record either within
// DEDUP_DISTANCE_M or sharing its normalized name within NAME_DEDUP_MAX_M.
// Nothing merges on name alone beyond the ceiling.
const keptById = named.kept;
let byDistance = 0;
let byName = 0;
let unexplained = 0;
let farthestNameM = 0;
const nameMerges = [];
for (const m of named.merged) {
  let explained = false;
  for (const k of keptById) {
    const dM = haversineMeters(m.sig.latitude, m.sig.longitude, k.sig.latitude, k.sig.longitude);
    if (dM <= DEDUP_DISTANCE_M) {
      byDistance++;
      explained = true;
      break;
    }
    if (dM <= NAME_DEDUP_MAX_M && sameSignalName(m.sig.name, k.sig.name)) {
      byName++;
      explained = true;
      if (dM > farthestNameM) farthestNameM = dM;
      nameMerges.push({ id: m.sig.id, into: k.sig.id, meters: Math.round(dM), name: m.sig.name });
      break;
    }
  }
  if (!explained) unexplained++;
}
ok(unexplained === 0, `every merged record has a kept record within ${DEDUP_DISTANCE_M} m or a same-name kept record within ${NAME_DEDUP_MAX_M} m (${unexplained} unexplained)`);
ok(
  byName === named.nameAbsorbedBeyond45m,
  `the telemetry counter matches the name-rule merges found by re-derivation (${byName} vs ${named.nameAbsorbedBeyond45m})`,
);
ok(farthestNameM <= NAME_DEDUP_MAX_M, `no name-rule merge beyond ${NAME_DEDUP_MAX_M} m (farthest ${farthestNameM.toFixed(1)} m)`);
console.log(`info: metro-wide merges -- ${byDistance} by co-location, ${byName} by name`);
if (debug) for (const nm of nameMerges) console.log(`   ${nm.id} -> ${nm.into} (${nm.meters} m) ${nm.name}`);

// ---------------------------------------------------------------------------
// 3. A representative study: the engine's radius filter + dedup on one site.
// ---------------------------------------------------------------------------
const site = inventory.find((s) => s.id === SITE.id);
ok(site !== undefined, `site signal ${SITE.id} exists`);
if (site) {
  const twin = inventory.find((s) => s.id === SITE_TWIN);
  const twinM = twin ? haversineMeters(site.latitude, site.longitude, twin.latitude, twin.longitude) : NaN;
  ok(
    twin !== undefined && sameSignalName(site.name, twin.name) && twinM > DEDUP_DISTANCE_M && twinM <= NAME_DEDUP_MAX_M,
    `${SITE.id} and ${SITE_TWIN} share a derived name ${DEDUP_DISTANCE_M}-${NAME_DEDUP_MAX_M} m apart (${twinM.toFixed(0)} m, "${site.name}")`,
  );
  const within = intersectionsWithinRadius(inventory, site.latitude, site.longitude, SITE.radiusMi);
  const study = dedupCloseSignals(within);
  console.log(
    `info: ${SITE.radiusMi} mi study at ${SITE.id} -- ${within.length} in radius, ${study.kept.length} kept, ` +
      `${study.merged.length} merged (${study.nameAbsorbedBeyond45m} by name beyond ${DEDUP_DISTANCE_M} m)`,
  );
  ok(within.length === SITE_EXPECT.within, `in-radius count pinned at ${SITE_EXPECT.within} (got ${within.length})`);
  ok(study.kept.length === SITE_EXPECT.kept, `kept count pinned at ${SITE_EXPECT.kept} (got ${study.kept.length})`);
  ok(study.merged.length === SITE_EXPECT.merged, `merged count pinned at ${SITE_EXPECT.merged} (got ${study.merged.length})`);
  ok(
    study.nameAbsorbedBeyond45m === SITE_EXPECT.nameAbsorbed,
    `name-rule absorbs pinned at ${SITE_EXPECT.nameAbsorbed} (got ${study.nameAbsorbedBeyond45m})`,
  );
  ok(study.kept.some((k) => k.sig.id === SITE.id), `the site signal itself survives (nearest-first wins)`);
  ok(study.merged.some((m) => m.sig.id === SITE_TWIN), `${SITE_TWIN} is absorbed into ${SITE.id} by the name rule`);
  // The same study with coordinate labels keeps the twin: this is the delta the
  // naming fix introduces to Atlanta reports.
  const studyCoord = dedupCloseSignals(
    within.map((c) => ({ sig: { ...c.sig, name: `Signal (${c.sig.latitude}, ${c.sig.longitude})` }, distanceMi: c.distanceMi })),
  );
  // The twin is one node of a three-node ramp-terminal cluster; with
  // coordinate labels the two cluster nodes more than 45 m apart
  // (ATL-9864763700, ATL-9864763701) each survive as their own junction, i.e.
  // two more "Cobb Parkway South & I-285" rows 45-150 m from the site. With
  // derived names those rows are gone.
  const nameById = new Map(inventory.map((s) => [s.id, s.name]));
  const secondTerminal = (kept) =>
    kept.filter((k) => {
      const dM = haversineMeters(site.latitude, site.longitude, k.sig.latitude, k.sig.longitude);
      return dM > DEDUP_DISTANCE_M && dM <= NAME_DEDUP_MAX_M && sameSignalName(nameById.get(k.sig.id), site.name);
    });
  const coordSecond = secondTerminal(studyCoord.kept);
  ok(
    coordSecond.length === 2,
    `with coordinate labels the second ramp terminal survives as its own junction(s) (${coordSecond.map((k) => k.sig.id).join(", ") || "none"}; expected 2)`,
  );
  ok(secondTerminal(study.kept).length === 0, `with derived names no second same-name junction survives within ${NAME_DEDUP_MAX_M} m of the site`);
  ok(
    studyCoord.nameAbsorbedBeyond45m === 0 && studyCoord.kept.length === SITE_KEPT_WITH_COORDINATE_LABELS,
    `with coordinate labels the study keeps ${SITE_KEPT_WITH_COORDINATE_LABELS} junctions (got ${studyCoord.kept.length}; ` +
      `${studyCoord.kept.length - study.kept.length} more than the ${study.kept.length} the derived names keep)`,
  );
}

if (fails > 0) {
  console.error(`\n${fails} check(s) failed`);
  process.exit(1);
}
console.log("\nverify-atlanta-name-dedup: all checks passed");
