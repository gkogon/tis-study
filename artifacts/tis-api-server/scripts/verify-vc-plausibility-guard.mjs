/**
 * Credibility guard: a study whose BACKGROUND volumes imply an impossible v/c
 * must say so in the deliverable, not print it as an ordinary LOS F.
 *
 * The incident: tacoma_metro (47.1900/-122.4600, 1.0 mi, full tier) rendered
 * 37 pages in which seven of thirteen study intersections carried v/c
 * 8.15–8.55 and 95th-percentile queues of 4,336–5,417 ft. The AADT→signal
 * join had matched I-5 mainline counts (163,000 / 171,000 AADT) onto S Hosmer
 * St and Tacoma Mall Blvd surface signals sitting 51–158 m from the freeway.
 * Nothing in the document flagged it: the engine turns any volume into a delay
 * and an LOS letter without asking whether the volume is possible.
 *
 * aadt-plausibility.ts now refuses functionally incompatible records at the
 * join. This is the second line of defence, so that ANY other route to an
 * impossible volume — a new DOT source, a wrong K-factor, an imported count —
 * is disclosed rather than silently printed.
 *
 * Run: node ./scripts/verify-vc-plausibility-guard.mjs
 */
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "./ts-loader.mjs")).href, import.meta.url);

const { PLAUSIBLE_MAX_INTERSECTION_VC, PER_INTERSECTION_CAPACITY_VPH, CRITICAL_MOVEMENT_FRACTION } =
  await import(path.resolve(here, "../src/lib/signal-delay.ts"));

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    fails++;
  } else console.log("ok:", msg);
};

// --- 1. The threshold is sane relative to genuine congestion --------------
ok(
  PLAUSIBLE_MAX_INTERSECTION_VC > 1.6,
  `threshold ${PLAUSIBLE_MAX_INTERSECTION_VC} is above genuine failure (a real failing signal prints v/c 1.1-1.6)`,
);
ok(
  PLAUSIBLE_MAX_INTERSECTION_VC < 8.15,
  `threshold ${PLAUSIBLE_MAX_INTERSECTION_VC} is below the Tacoma incident value 8.15`,
);

// --- 2. The Tacoma volumes are on the wrong side of it --------------------
// Back-solve the incident exactly: totalVolume = AADT x K/100, and the engine
// takes v/c = totalVolume x CRITICAL_MOVEMENT_FRACTION / PER_INTERSECTION_CAPACITY_VPH.
const vcFor = (aadt, kPct) =>
  ((aadt * kPct) / 100) * CRITICAL_MOVEMENT_FRACTION / PER_INTERSECTION_CAPACITY_VPH;
const vcI5 = vcFor(171_000, 9);
ok(
  Math.abs(vcI5 - 8.55) < 0.01,
  `I-5 mainline 171,000 AADT at K=9 reproduces the reported v/c 8.55 (got ${vcI5.toFixed(2)})`,
);
ok(
  vcI5 > PLAUSIBLE_MAX_INTERSECTION_VC,
  `the incident volume trips the guard (${vcI5.toFixed(2)} > ${PLAUSIBLE_MAX_INTERSECTION_VC})`,
);
// A large but legitimate arterial must NOT trip it.
const vcArterial = vcFor(19_000, 9);
ok(
  vcArterial <= PLAUSIBLE_MAX_INTERSECTION_VC,
  `a legitimate 19,000-AADT arterial does not trip the guard (v/c ${vcArterial.toFixed(2)})`,
);

// --- 3. The guard fires on the incident and stays quiet on a clean study ---
const { implausibleVolumeDisclosures } = await import(
  path.resolve(here, "../src/lib/volume-plausibility.ts")
);

// The seven Tacoma rows exactly as the incident reported them.
const tacomaRows = [
  { name: "South 72nd Street & South Hosmer Street", currentVc: 8.15, existingVc: 8.27 },
  { name: "South 74th Street & South 72nd Street", currentVc: 8.15, existingVc: 8.27 },
  { name: "Tacoma Mall Boulevard & South 74th Street", currentVc: 8.15, existingVc: 8.27 },
  { name: "Tacoma Mall Boulevard & South Hosmer Street", currentVc: 8.55, existingVc: 8.68 },
  { name: "South 84th Street & South Hosmer Street", currentVc: 8.55, existingVc: 8.68 },
  { name: "South 84th Street & Tacoma Mall Boulevard", currentVc: 8.55, existingVc: 8.68 },
  { name: "Near South Hosmer Street", currentVc: 8.55, existingVc: 8.68 },
  { name: "South 72nd Street & South Alaska Street", currentVc: 1.02, existingVc: 1.04 },
  { name: "South 72nd Street & South Sheridan Avenue", currentVc: 0.27, existingVc: 0.28 },
];
const fired = implausibleVolumeDisclosures(tacomaRows);
ok(fired.length === 1, `guard emits exactly one disclosure for the incident (got ${fired.length})`);
const msg = fired[0] ?? "";
ok(/^DATA QUALITY/.test(msg), "disclosure leads with DATA QUALITY");
ok(/7 of 9 study intersection/.test(msg), `disclosure counts only the offenders (got: ${msg.slice(0, 60)}...)`);
ok(
  /8\.68/.test(msg),
  "disclosure quotes the worst no-project v/c (max of current and opening-year no-build)",
);
ok(
  !/South Alaska|Sheridan/.test(msg),
  "disclosure does not name the plausible intersections",
);
ok(/not suitable for submittal/i.test(msg), "disclosure states it is not submittal-ready");
// Both causes must be named. The Tacoma failure mode is a freeway count on a
// surface signal; on FL/Miami-Dade the same threshold is more often tripped by
// a legitimately large arterial that the flat 0.45 g/C screening capacity
// understates. Blaming only the data would overstate a data defect on ~7% of
// Florida studies, so the disclosure has to carry both.
ok(/limited-access|freeway/i.test(msg), "disclosure names cause (a): a limited-access count on a surface signal");
ok(
  /screening capacity assumption|green ratio/i.test(msg),
  "disclosure names cause (b): the screening capacity assumption understating a real arterial",
);
ok(
  /two possible causes/i.test(msg),
  "disclosure presents them as alternatives rather than asserting the data is wrong",
);
ok(/measured turning-movement counts/i.test(msg), "disclosure states the volume remedy");
ok(
  /HCS\/Synchro|observed lane geometry/i.test(msg),
  "disclosure states the capacity remedy (calibrated analysis, not the screening capacity)",
);
ok(/not defensible/i.test(msg), "disclosure says the reported LOS/queue values are not defensible");

// A clean study must stay silent — the Sacramento reference range.
const sacRows = [
  { name: "Clean A", currentVc: 0.21, existingVc: 0.23 },
  { name: "Clean B", currentVc: 0.95, existingVc: 0.98 },
  { name: "Clean C", currentVc: 1.45, existingVc: 1.52 },
];
ok(
  implausibleVolumeDisclosures(sacRows).length === 0,
  "a clean study (v/c 0.21-1.52, incl. genuine failure) emits no disclosure",
);
ok(implausibleVolumeDisclosures([]).length === 0, "an empty study emits no disclosure");

// Truncation: many offenders must summarise, not print a wall of names.
const many = Array.from({ length: 12 }, (_, i) => ({
  name: `Sig ${i}`,
  currentVc: 6 + i / 10,
  existingVc: 6 + i / 10,
}));
const manyMsg = implausibleVolumeDisclosures(many)[0];
ok(/and 7 more/.test(manyMsg), `12 offenders summarise after the first 5 (got: ${manyMsg.slice(-40)})`);

// --- 4. The disclosure is wired into the report, and leads --------------
const src = (await import("node:fs")).readFileSync(path.resolve(here, "../src/lib/tis.ts"), "utf8");
ok(
  /const volumeDisclosures = implausibleVolumeDisclosures\(pmReport\.affectedIntersections\)/.test(src),
  "tis.ts computes the disclosure from the study's own intersection rows",
);
ok(
  /const findings = \[\s*\n\s*\.\.\.volumeDisclosures,/.test(src),
  "the disclosure is prepended to findings (a reader meets it before the LOS tables)",
);
ok(
  /methodology: \[\s*\n(?:.*\n)?\s*\.\.\.volumeDisclosures,/.test(src),
  "the disclosure also rides methodology, which every renderer prints",
);

console.log(fails === 0 ? "\nAll v/c plausibility-guard checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
