// The generic states renderer (renderTisState — every US state without a
// dedicated renderer, Pennsylvania included) must not claim work the engine
// never did. Follow-up to verify-states-roadway-sources.mjs, which covers §4.
// Before this check the report said:
//   §3.1  "prepared in conformance with" the state's TIS guidance;
//   §3.5 / §5  pass-by and internal capture "agreed in the methodology meeting";
//   §3.6 / §4.2  a missing growthSource came from "<agency> count stations";
//   §5 / §11  "Transit/mode reduction: Not applied" — it read altModeReductionPct,
//         which the engine never sets, while the engine applies autoModeShareApplied;
//   §6  distribution "observed at the study-area count locations";
//   §7  STIP improvements "incorporated into the No-Build network";
//   §9 / §12  mitigation "required as conditions of the … access permit";
//   §9.4  queue analysis "performed at driveways", which are never screened;
//   PE block  "has been prepared and reviewed by a Professional Engineer".
//
// Renders a tx fixture relocated to Pittsburgh with fetch stubbed offline, in
// three payload shapes: measured-style defaults (no growthSource, 94% auto
// share, LOS E/F present), full auto share with no LOS deficiency, and a study
// with no tripDistribution summary.
// Run: node ./scripts/verify-states-report-claims.mjs
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pageTexts } from "./lib/pdf-text.mjs";

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };
const squash = (s) => s.replace(/\s+/g, "");
const has = (hay, needle) => squash(hay).includes(squash(needle));
const FOOTER = /Screening estimate — not for design submittal without independent verification by a licensed PE\.\s*\|\s*See \/legal\/disclaimer\./g;
const between = (text, a, b) => {
  const i = text.indexOf(a);
  if (i < 0) return "";
  const j = text.indexOf(b, i + a.length);
  return j < 0 ? text.slice(i) : text.slice(i, j);
};

const FALSE_CLAIMS = [
  "This study is prepared in conformance with",
  "agreed in the methodology meeting",
  "per methodology meeting agreement",
  "approved at the methodology meeting",
  "observed at the study-area count locations",
  "are incorporated into the No-Build network",
  "must be incorporated as permit conditions",
  "required as conditions of the",
  "performed at driveways",
  "has been prepared and reviewed by a Professional Engineer",
  "PennDOT historical AADT count stations",
  "Existing traffic directional distribution + engineering judgment",
  "Site-access-proportional; confirmed at methodology meeting",
  "Analysis follows",
  "mitigation analysis is required per",
  "require mitigation analysis in §9",
  "receive ≥10% of project traffic",
  "Primary analysis periods: weekday AM peak hour and weekday PM peak hour",
  "peak hour (net new)",
  "net new external PM peak-hour trips",
  "are reviewed per",
  "published rate or equation",
  "is proposed to improve",
  "Caltran",
  "counted design hour",
  "existing counts grown",
  "its counted volume where",
  "an imported Synchro record supplied measured",
  "imported bay storage",
  "for this metro",
];

function study(mutate) {
  const fx = JSON.parse(JSON.stringify(loadFixture("tx")));
  fx.latitude = 40.5250; fx.longitude = -80.0130;
  fx.report.request = { ...fx.report.request, latitude: 40.5250, longitude: -80.0130 };
  delete fx.report.growthSource;
  mutate(fx.report);
  return fx;
}

const CASES = [
  { label: "PA default growth, 94% auto share, LOS E/F present",
    mutate: (r) => { r.autoModeShareApplied = 0.9429594894588639; r.autoModeShareSource = "ACS 5-Year B08301"; r.intersectionsAtLosEf = 7; },
    nonAuto: 6, deficient: true, methodLabel: "Gravity Model" },
  { label: "PA full auto share, no LOS deficiency",
    mutate: (r) => { r.autoModeShareApplied = 1; r.intersectionsAtLosEf = 0; r.intersectionsWithLosDrop = 0; },
    nonAuto: 0, deficient: false, methodLabel: "Gravity Model" },
  { label: "PA no tripDistribution summary",
    mutate: (r) => { r.autoModeShareApplied = 0.9; delete r.autoModeShareSource; delete r.tripDistribution; },
    nonAuto: 10, deficient: true, methodLabel: null },
];

const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error("states-report-claims check: network disabled"));
const { mod, cleanup } = await loadRendererBundle();
try {
  for (const c of CASES) {
    const fx = study(c.mutate);
    const text = (await pageTexts(await mod.renderStudyPdf(projectFromFixture(fx), { name: "Report Claims Check", logoUrl: null }))).join(" ").replace(FOOTER, " ");
    ok(text.includes("Pennsylvania Department of Transportation (PennDOT)"), `${c.label}: rendered by the generic states renderer as PennDOT`);

    for (const phrase of FALSE_CLAIMS) ok(!has(text, phrase), `${c.label}: no "${phrase}"`);

    // §3.1: follows the structure, does not claim conformance.
    ok(has(between(text, "3.1 Governing Documents", "3.2 "), "It is not a submittal prepared in conformance with that guidance"),
      `${c.label}: §3.1 says the screening is not a conforming submittal`);

    // §3.6 / §4.2: an absent growthSource is the engine default, not count stations.
    const s36 = between(text, "3.6 Background Growth Rate", "3.7 ");
    ok(has(s36, "Source: Engine default of 1.50%/yr") && has(s36, "not derived from PennDOT count stations"),
      `${c.label}: §3.6 names the engine default as the growth source`);
    ok(has(between(text, "4.2 Traffic Volumes", "4.3 "), "Growth source Engine default of 1.50%/yr"),
      `${c.label}: §4.2 Growth source row names the engine default`);

    // §5 / §11: the mode reduction matches autoModeShareApplied.
    const s5 = between(text, "5.0 TRIP GENERATION", "6.0 TRIP DISTRIBUTION");
    const s11 = between(text, "11.0 TRANSIT", "12.0 ");
    if (c.nonAuto > 0) {
      ok(has(s5, `Transit/mode reduction ${c.nonAuto}% non-auto, removed before assignment`), `${c.label}: §5 reports the ${c.nonAuto}% non-auto share the engine applied`);
      ok(has(s11, `A ${c.nonAuto}% non-auto share`) && has(s11, `Transit reduction applied ${c.nonAuto}% non-auto`), `${c.label}: §11 reports the ${c.nonAuto}% non-auto share`);
      ok(!has(s5, "Transit/mode reduction Not applied"), `${c.label}: §5 does not say the reduction was not applied`);
    } else {
      ok(has(s5, "Transit/mode reduction Not applied") && has(s11, "No transit-mode reduction is applied."), `${c.label}: §5 / §11 say no reduction at full auto share`);
    }

    // §6: the engine's method, no counts, no MPO model.
    const s6 = between(text, "6.0 TRIP DISTRIBUTION", "6.1 ");
    ok(has(s6, "No directional counts and no regional travel-demand-model run are used."), `${c.label}: §6 disclaims counts and MPO model`);
    ok(c.methodLabel ? has(s6, `by the engine's ${c.methodLabel} method`) && has(s6, `Distribution method ${c.methodLabel}`)
      : has(s6, "Distribution method Not reported for this study"), `${c.label}: §6 distribution method matches the payload`);

    // §7: nothing programmed is modeled.
    ok(has(between(text, "7.0 FUTURE CONDITIONS", "8.0 "), "No programmed improvements are modeled"), `${c.label}: §7 says no STIP projects are modeled`);

    // §9 / §12: candidates, not permit conditions.
    const s9 = between(text, "9.0 MITIGATION", "9.4 ");
    const s12 = between(text, "12.0 CONCLUSIONS", "Professional Engineer Certification");
    if (c.deficient) {
      ok(has(s9, "screening-level candidates") && has(s9, "determined by the engineer of record and the reviewing agency"), `${c.label}: §9 frames mitigation as candidates`);
      ok(has(s12, "These are screening results"), `${c.label}: §12 frames conclusions as screening results`);
    } else {
      ok(has(s9, "No study-area intersections operate below"), `${c.label}: §9 no-deficiency branch renders`);
    }
    ok(has(between(text, "9.4 Storage Bay Adequacy", "10.0 "), "Site driveways are not screened (§3.3)"), `${c.label}: §9.4 says driveways are not screened`);

    // §5 / §12: gross is labelled gross; the headline uses the PM net external trips.
    const pmExt = fx.report.periodReports.find((p) => p.period === "pm_peak").tripGeneration.externalTrips;
    const fmtN = (n) => Math.round(n).toLocaleString();
    ok(has(s5, `PM peak hour (gross) ${fmtN(fx.report.tripGeneration.pmPeakTrips)} trips`) && has(s5, `PM peak hour (net external, assigned) ${fmtN(pmExt)} trips`),
      `${c.label}: §5 labels gross and net external PM trips`);
    ok(has(s12, `generate ${fmtN(pmExt)} net new external PM peak-hour vehicle trips (${fmtN(fx.report.tripGeneration.pmPeakTrips)} gross)`) || !c.deficient,
      `${c.label}: §12 headline uses the net external PM trips`);
    ok(has(between(text, "3.3 Study Area", "3.4 "), "reported for the weekday PM peak hour only"), `${c.label}: §3.3 says only the PM peak is graded`);

    // PE block: a form to be completed, not a certification.
    ok(has(text, "To be completed by the Professional Engineer of record.") && has(text, "Unsigned, this document is a screening estimate and carries no engineering certification."),
      `${c.label}: PE block is a form to be completed`);
  }
} finally {
  globalThis.fetch = realFetch;
  await cleanup();
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
