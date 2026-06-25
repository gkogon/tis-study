/**
 * Regression guard: the LTDS/TfL/Velocity office within-day profile must never
 * reach a US DOT submittal. Asserts the locale gating in `office-diurnal.ts`:
 *   - US locale (the default every non-London renderer uses) → ITE TGM office
 *     shape; no source string carries a TfL/LTDS/Velocity marker, including the
 *     unmatched `matched:false` fallback and the consultant-override default.
 *   - UK locale (London/Velocity renderer only) → LTDS office shape, which is
 *     the one place a TfL/LTDS provenance line is permitted.
 *
 * No test runner is configured in this package, so this is a standalone node
 * script. Run with `pnpm run check:diurnal-provenance` (Node >= 23, native TS).
 * Exits non-zero on the first failed invariant.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(path.resolve(here, "../src/lib/office-diurnal.ts"));
const {
  profileForLandUse,
  resolveProfile,
  parseProfileOverride,
  officeProfile,
  profilesForLocale,
  ITE_OFFICE_PROFILE,
  LTDS_OFFICE_PROFILE,
  PROFILES,
} = mod;

const UK_MARKERS = /TfL|LTDS|Velocity|Gracechurch|London Travel Demand/i;
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

// --- US default office = ITE TGM LU 710, no UK provenance ---
const us710 = profileForLandUse("710");
ok(us710.matched && us710.family === "office", 'US "710" matches office family');
ok(/ITE Trip Generation Manual.*710/i.test(us710.profile.source), "US office source cites ITE TGM LU 710");
ok(/NCHRP Report 765/i.test(us710.profile.source), "US office source cites NCHRP 765 roadway-diurnal fallback");
ok(!UK_MARKERS.test(us710.profile.source), "US office source carries NO TfL/LTDS/Velocity marker");

// --- UK locale office = LTDS (the only permitted UK-provenance path) ---
ok(UK_MARKERS.test(profileForLandUse("710", undefined, "uk").profile.source),
  "UK office source DOES carry a TfL/LTDS/Velocity marker (London renderer only)");

// --- residential / retail / school (US): NHTS 2022 + ITE TGM, no UK marker ---
for (const [code, fam] of [["220", "residential"], ["820", "retail"], ["520", "school"]]) {
  const sel = profileForLandUse(code);
  ok(sel.matched && sel.family === fam, `US "${code}" matches ${fam}`);
  ok(!UK_MARKERS.test(sel.profile.source) && /NHTS 2022/i.test(sel.profile.source), `US ${fam} source: NHTS 2022, no UK marker`);
}

// --- unmatched code: honest matched:false; US fallback is UK-free ---
const unmatched = profileForLandUse("000");
ok(unmatched.matched === false, 'US unmatched "000" returns matched:false (renderer prints derive-at-submittal note)');
ok(!UK_MARKERS.test(unmatched.profile.source), "US unmatched fallback source carries NO UK marker");

// --- exhaustive sweep: no US-locale source over a wide code range is UK-tainted ---
const codes = ["110", "150", "210", "220", "251", "310", "320", "420", "444", "520", "530",
  "565", "610", "620", "710", "714", "720", "770", "820", "850", "912", "934", "000", ""];
ok(!codes.map((c) => profileForLandUse(c).profile.source).some((s) => UK_MARKERS.test(s)),
  "No US-locale source across a wide ITE-code sweep carries a UK marker");

// --- registry / helper invariants ---
ok(!("office" in PROFILES), "PROFILES no longer hard-codes office (it is locale-gated)");
ok(officeProfile() === ITE_OFFICE_PROFILE && officeProfile("us") === ITE_OFFICE_PROFILE, 'officeProfile default/"us" === ITE');
ok(officeProfile("uk") === LTDS_OFFICE_PROFILE, 'officeProfile("uk") === LTDS');
ok(profilesForLocale("us").office === ITE_OFFICE_PROFILE, 'profilesForLocale("us").office === ITE');

// --- consultant-override + resolveProfile defaults are UK-free ---
const ovr = parseProfileOverride({ arrivals: Array(24).fill(1), departures: Array(24).fill(1) });
ok(ovr && !UK_MARKERS.test(ovr.source), "Consultant-override default source carries NO UK marker");
ok(!UK_MARKERS.test(resolveProfile().source), "resolveProfile() default (US) source carries NO UK marker");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
