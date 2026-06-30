/**
 * Regression guard: the LTDS/TfL/Velocity office within-day profile must never
 * reach a US DOT submittal, and no reproduced ITE office time-of-day curve may
 * ship. Asserts the locale gating in `office-diurnal.ts`:
 *   - US locale (the default every non-London renderer uses) → NO office shape.
 *     Office land uses resolve `matched:false`, so the renderer OMITS the office
 *     diurnal figure rather than fabricate a curve. No US-locale source carries a
 *     TfL/LTDS/Velocity marker, including the unmatched fallback and the
 *     consultant-override default.
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
  LTDS_OFFICE_PROFILE,
  PROFILES,
} = mod;

const UK_MARKERS = /TfL|LTDS|Velocity|Gracechurch|London Travel Demand/i;
const ITE_OFFICE_MARKERS = /ITE Trip Generation Manual|ITE TGM|LU ?710 time-of-day|Land Use 710 .*time-of-day/i;
let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

// --- US default office: NO shape ships → unmatched, figure omitted ---
const us710 = profileForLandUse("710");
ok(us710.family === "office", 'US "710" maps to office family');
ok(us710.matched === false, 'US office "710" returns matched:false (renderer OMITS the office figure)');
ok(!UK_MARKERS.test(us710.profile.source), "US office fallback source carries NO TfL/LTDS/Velocity marker");
ok(!ITE_OFFICE_MARKERS.test(us710.profile.source), "US office fallback source carries NO reproduced ITE office curve");
ok(officeProfile("us") === null && officeProfile() === null, 'officeProfile default/"us" === null (no US office shape)');
ok(!("office" in profilesForLocale("us")), 'profilesForLocale("us") omits office (no US office shape)');

// --- UK locale office = LTDS (the only permitted UK-provenance path) ---
const uk710 = profileForLandUse("710", undefined, "uk");
ok(uk710.matched && UK_MARKERS.test(uk710.profile.source),
  "UK office matches and DOES carry a TfL/LTDS/Velocity marker (London renderer only)");
ok(officeProfile("uk") === LTDS_OFFICE_PROFILE, 'officeProfile("uk") === LTDS');
ok(profilesForLocale("uk").office === LTDS_OFFICE_PROFILE, 'profilesForLocale("uk").office === LTDS');

// --- residential / retail / school (US): NHTS 2022, no UK marker ---
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
  "No US-locale source across a wide code sweep carries a UK marker");

// --- registry / helper invariants ---
ok(!("office" in PROFILES), "PROFILES no longer hard-codes office (it is locale-gated)");

// --- consultant-override wins even for office under US locale ---
const ovrPayload = { arrivals: Array(24).fill(1), departures: Array(24).fill(1) };
const us710ovr = profileForLandUse("710", ovrPayload);
ok(us710ovr.matched === true, 'US office "710" WITH a consultant override matches (override supplies the curve)');

// --- consultant-override + resolveProfile defaults are UK-free ---
const ovr = parseProfileOverride(ovrPayload);
ok(ovr && !UK_MARKERS.test(ovr.source), "Consultant-override default source carries NO UK marker");
ok(resolveProfile() === null, "resolveProfile() default (US, no override) === null (no US office shape)");
ok(UK_MARKERS.test(resolveProfile(undefined, "uk").source), "resolveProfile(uk) source IS the LTDS office curve (UK-permitted)");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
