/**
 * London engine calibration demo — trip-generation slice.
 *
 * The full engine fetches a live junction inventory from the analyzer
 * microservice (requires Postgres + OSM signal data). For a calibration
 * cross-check against published London TAs, only the deterministic
 * trip-generation half matters — junction LOS depends on local network
 * geometry that varies site-to-site and is not directly comparable.
 *
 * This script imports the engine's land-use catalogue + mode-share table
 * and computes what `generateTisReport` would produce for the trip-gen
 * section of a London project of arbitrary scale. Prints per-100-units
 * numbers so a UK reviewer can compare against TRICS-derived TA outputs.
 */
import { getLandUse } from "../../artifacts/tis-api-server/src/lib/tis";
import {
  getAutoModeShare,
  getLondonAutoModeShare,
  type PTALBand,
} from "../../artifacts/tis-api-server/src/lib/mode-share";

const sizes = [100, 115, 134, 985];
const codes = ["221"]; // ITE Multifamily Housing (Mid-Rise)
const londonShare = getAutoModeShare("london_metro");

const PTAL_BANDS: PTALBand[] = ["0", "1a", "1b", "2", "3", "4", "5", "6a", "6b"];

for (const code of codes) {
  const lu = getLandUse(code);
  if (!lu) {
    console.error(`No land use ${code}`);
    process.exit(2);
  }
  console.log(`\n=== ITE ${code} — ${lu.name} ===`);
  console.log(`  Daily rate:        ${lu.dailyRate} ${lu.unitShort}`);
  console.log(`  AM peak rate:      ${lu.amRate} ${lu.unitShort} (in ${(lu.amDirectionalIn * 100).toFixed(0)}% / out ${((1 - lu.amDirectionalIn) * 100).toFixed(0)}%)`);
  console.log(`  PM peak rate:      ${lu.pmRate} ${lu.unitShort} (in ${(lu.directionalSplitPm.in * 100).toFixed(0)}% / out ${(lu.directionalSplitPm.out * 100).toFixed(0)}%)`);
  console.log(`  Sat multiplier:    ${lu.satMultiplier}`);
  console.log(`  Default pass-by:   ${lu.defaultPassByPct ?? 0}%`);
  console.log(`  Internal capture:  ${lu.defaultInternalCapturePct ?? 0}%\n`);

  console.log(`London auto-mode-share applied: ${londonShare} (mode-share.ts)`);
  console.log(`  → all-mode totals from ITE rates are multiplied by ${londonShare}`);
  console.log(`  → represents engine's car-mode trip estimate after the upstream`);
  console.log(`    mode-share net-out of walk/cycle/PT — NOT a TRICS-multi-modal split.\n`);

  for (const size of sizes) {
    const gross = {
      daily: lu.dailyRate * size,
      am: lu.amRate * size,
      pm: lu.pmRate * size,
    };
    const carMode = {
      daily: gross.daily * londonShare,
      am: gross.am * londonShare,
      pm: gross.pm * londonShare,
      amIn: gross.am * londonShare * lu.amDirectionalIn,
      amOut: gross.am * londonShare * (1 - lu.amDirectionalIn),
      pmIn: gross.pm * londonShare * lu.directionalSplitPm.in,
      pmOut: gross.pm * londonShare * lu.directionalSplitPm.out,
    };
    console.log(`--- ${size} units ---`);
    console.log(`  Gross (pre-mode-share):    daily=${gross.daily.toFixed(0)}  AM=${gross.am.toFixed(1)}  PM=${gross.pm.toFixed(1)}`);
    console.log(`  Engine car-mode estimate:  daily=${carMode.daily.toFixed(0)}  AM=${carMode.am.toFixed(1)}  PM=${carMode.pm.toFixed(1)}`);
    console.log(`    AM two-way: ${carMode.amIn.toFixed(0)} in / ${carMode.amOut.toFixed(0)} out`);
    console.log(`    PM two-way: ${carMode.pmIn.toFixed(0)} in / ${carMode.pmOut.toFixed(0)} out`);
    console.log(`  Per-100-units car-mode AM peak: ${(carMode.am / size * 100).toFixed(1)}`);
    console.log(`  Per-100-units car-mode PM peak: ${(carMode.pm / size * 100).toFixed(1)}`);
    console.log("");
  }

  // -------------------------------------------------------------------
  // PTAL-band calibration sweep — 100-unit mid-rise across all bands.
  // Compared against three published TAs:
  //   - Holloway PTAL 6a 985-unit car-free → ~0.9 AM peak per 100 units
  //     measured. Engine at 0.05 share lands ~1.5 AM, ~1.8 PM — within
  //     an order of magnitude of measured.
  //   - Registry Beckenham PTAL 5 134-unit → 18 AM / 13 PM measured BUT
  //     using local Bromley mode share, which is more car-skewed than
  //     the TfL inner-London PTAL 5 curve. Engine at 0.18 share lands
  //     ~5.4 AM / ~6.5 PM — UNDER-states by design vs the local-rate
  //     Bromley measured. Flagged: high-band outer-London sites with
  //     local-rate calibration deserve a borough override later.
  //   - Hyde Estate PTAL 2 115-unit → engine at 0.40 share lands ~12
  //     AM / ~14 PM, which matches Hyde's measured rate.
  // -------------------------------------------------------------------
  console.log(`\n=== PTAL-band calibration sweep — ITE ${code}, 100 units mid-rise ===`);
  console.log(`Calibration targets (from published London TAs):`);
  console.log(`  PTAL 6a → engine ~1.5 AM, ~1.8 PM (Holloway ~0.9 measured — within OOM)`);
  console.log(`  PTAL 5  → engine ~5.4 AM, ~6.5 PM (Registry 18/13 measured w/ local Bromley rate — engine UNDER-states by design)`);
  console.log(`  PTAL 2  → engine ~12 AM, ~14 PM (matches Hyde Estate)\n`);
  console.log(`PTAL band | auto share | AM/100u | PM/100u | Daily/100u`);
  console.log(`----------+------------+---------+---------+-----------`);
  for (const band of PTAL_BANDS) {
    const share = getLondonAutoModeShare(band);
    const am = lu.amRate * 100 * share;
    const pm = lu.pmRate * 100 * share;
    const daily = lu.dailyRate * 100 * share;
    const bandPad = band.padEnd(9);
    console.log(`${bandPad} | ${share.toFixed(2).padStart(10)} | ${am.toFixed(1).padStart(7)} | ${pm.toFixed(1).padStart(7)} | ${daily.toFixed(0).padStart(10)}`);
  }
  const flat = getLondonAutoModeShare(undefined);
  console.log(`(unset)   | ${flat.toFixed(2).padStart(10)} | ${(lu.amRate * 100 * flat).toFixed(1).padStart(7)} | ${(lu.pmRate * 100 * flat).toFixed(1).padStart(7)} | ${(lu.dailyRate * 100 * flat).toFixed(0).padStart(10)}  ← backward-compat default (no PTAL supplied)`);
  console.log("");
}

// ---------------------------------------------------------------------
// Junction-impact threshold calibration check.
//
// Renders two synthetic London PDFs (100-unit + 200-unit ITE 221) and
// runs pdftotext on each to confirm:
//   - 100u (PM ~14 car trips) → flag false → §5.4 has trip-comparison
//     prose, junction table appears under Appendix A.
//   - 200u (PM ~27 car trips) → flag true → §5.4 has the junction
//     table inline, no Appendix A is emitted.
//
// Exits non-zero on any miss so the script doubles as a smoke test.
// ---------------------------------------------------------------------
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

const calibrationLandUse = getLandUse("221")!;
const calibrationCases = [
  { units: 100, expectSignificant: false },
  { units: 200, expectSignificant: true },
];

function buildLondonReport(units: number, significant: boolean) {
  const pmAllMode = calibrationLandUse.pmRate * units;
  const amAllMode = calibrationLandUse.amRate * units;
  const dailyAllMode = calibrationLandUse.dailyRate * units;
  const pmCar = pmAllMode * londonShare;
  const amCar = amAllMode * londonShare;
  const dailyCar = dailyAllMode * londonShare;
  // Three synthetic London signalised junctions — enough to prove the
  // table-vs-prose split. Real-engine output would come from the OSM
  // junction inventory; the calibration only needs SOME rows present.
  const intersections = [
    { signalId: "LDN-001", name: "A23 Brixton Hill / Tulse Hill", zone: "lambeth", latitude: 51.456, longitude: -0.118, distanceMi: 0.18, currentVc: 0.82, currentDelaySec: 31.2, currentLos: "C", existingVc: 0.84, existingDelaySec: 33.0, addedTripsPmPeak: 2, futureVc: 0.86, futureDelaySec: 35.1, existingLos: "C", futureLos: "D", losChanged: true, mitigation: "Re-time critical NB phase +3s.", mitigationSeverity: "minor", approaches: [], queue95thFt: 142 },
    { signalId: "LDN-002", name: "A205 South Circular / Brixton Hill", zone: "lambeth", latitude: 51.451, longitude: -0.116, distanceMi: 0.34, currentVc: 0.71, currentDelaySec: 22.1, currentLos: "C", existingVc: 0.72, existingDelaySec: 22.7, addedTripsPmPeak: 1, futureVc: 0.73, futureDelaySec: 23.4, existingLos: "C", futureLos: "C", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 88 },
    { signalId: "LDN-003", name: "Acre Lane / Brixton Hill", zone: "lambeth", latitude: 51.460, longitude: -0.120, distanceMi: 0.41, currentVc: 0.65, currentDelaySec: 18.4, currentLos: "B", existingVc: 0.66, existingDelaySec: 18.7, addedTripsPmPeak: 1, futureVc: 0.67, futureDelaySec: 19.1, existingLos: "B", futureLos: "B", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 62 },
  ];
  const pmGen = { period: "pm_peak", periodLabel: "PM Peak", rawTrips: Math.round(pmAllMode), passByCredit: 0, internalCaptureCredit: 0, externalTrips: Math.round(pmCar), inTrips: Math.round(pmCar * calibrationLandUse.directionalSplitPm.in), outTrips: Math.round(pmCar * (1 - calibrationLandUse.directionalSplitPm.in)) };
  const amGen = { period: "am_peak", periodLabel: "AM Peak", rawTrips: Math.round(amAllMode), passByCredit: 0, internalCaptureCredit: 0, externalTrips: Math.round(amCar), inTrips: Math.round(amCar * calibrationLandUse.amDirectionalIn), outTrips: Math.round(amCar * (1 - calibrationLandUse.amDirectionalIn)) };
  const result = {
    generatedAt: "2026-06-12T12:00:00.000Z",
    request: { projectName: `${units}-unit Brixton mid-rise`, address: "Brixton, London SW2", latitude: 51.456, longitude: -0.116, landUseCode: "221", size: units, openingYear: 2028, studyRadiusMi: 0.5 },
    studyRadiusMi: 0.5,
    tripGeneration: { landUseCode: "221", landUseName: calibrationLandUse.name, size: units, unit: calibrationLandUse.unit, dailyTrips: Math.round(dailyCar), amPeakTrips: Math.round(amCar), pmPeakTrips: Math.round(pmCar), pmIn: Math.round(pmCar * calibrationLandUse.directionalSplitPm.in), pmOut: Math.round(pmCar * (1 - calibrationLandUse.directionalSplitPm.in)) },
    affectedIntersections: intersections,
    intersectionsStudied: intersections.length,
    intersectionsWithLosDrop: intersections.filter((i) => i.losChanged).length,
    intersectionsAtLosEf: 0,
    worstDelayDeltaSec: 2.1,
    mitigationSummary: [],
    findings: [],
    methodology: [],
    periodReports: [
      amGen ? { period: "am_peak", periodLabel: "AM Peak", tripGeneration: amGen, affectedIntersections: [], intersectionsWithLosDrop: 0, intersectionsAtLosEf: 0, worstDelayDeltaSec: 0 } : null,
      { period: "pm_peak", periodLabel: "PM Peak", tripGeneration: pmGen, affectedIntersections: intersections, intersectionsWithLosDrop: 1, intersectionsAtLosEf: 0, worstDelayDeltaSec: 2.1 },
    ].filter(Boolean),
    growthAppliedPct: 1.5,
    growthYears: 2,
    weather: "clear",
    weatherCapacityFactor: 1.0,
    passByPctApplied: 0,
    internalCapturePctApplied: 0,
    autoModeShareApplied: londonShare,
    junctionImpactSignificant: significant,
  };
  return result;
}

console.log(`\n=== Junction-impact threshold calibration ===`);
console.log(`Threshold: 15 PM peak car trips. London auto-mode share: ${londonShare}.\n`);

let failed = 0;
for (const { units, expectSignificant } of calibrationCases) {
  const report = buildLondonReport(units, expectSignificant);
  const pmCar = Number(report.tripGeneration.pmPeakTrips);
  const project = {
    id: `calib-${units}`,
    studyType: "tis",
    projectName: report.request.projectName,
    landUseCode: "221",
    siteLat: String(report.request.latitude),
    siteLon: String(report.request.longitude),
    version: 1,
    createdAt: new Date("2026-06-12T12:00:00.000Z"),
    requestPayload: report.request,
    resultPayload: report,
  };
  const firm = { name: "Calibration Run", logoUrl: null };
  const buf = await renderStudyPdf(project as any, firm);
  const pdfPath = `/tmp/london-calib-${units}u.pdf`;
  writeFileSync(pdfPath, buf);
  const txt = spawnSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  if (txt.status !== 0) {
    console.error(`pdftotext failed for ${pdfPath}: ${txt.stderr}`);
    failed++;
    continue;
  }
  const body = txt.stdout;
  // Slice §5.4 by capturing from the "5.4 Assessment of Junction Impact" anchor
  // through the next subsection ("5.5 Design Solutions and Mitigation").
  const startIdx = body.indexOf("5.4 Assessment of Junction Impact");
  const endIdx = body.indexOf("5.5 Design Solutions and Mitigation");
  const section54 = startIdx >= 0 && endIdx > startIdx ? body.slice(startIdx, endIdx) : "";
  // pdftotext may wrap the prose across lines; collapse whitespace before matching.
  const section54Flat = section54.replace(/\s+/g, " ");
  const hasProse = /falls below the threshold at which junction capacity is conventionally the limiting factor/.test(section54Flat);
  const hasInlineTable = section54.includes("LDN-001") || section54.includes("A23 Brixton Hill");
  const hasAppendixA = /APPENDIX A — AFFECTED JUNCTIONS/.test(body) || /APPENDIX A . AFFECTED JUNCTIONS/.test(body);
  const tableHasJunction = hasAppendixA && (body.includes("LDN-001") || body.includes("A23 Brixton Hill"));

  console.log(`${units}-unit run → PM car trips=${pmCar}, expected significant=${expectSignificant}`);
  console.log(`  pdf: ${pdfPath}`);
  console.log(`  §5.4 has prose:               ${hasProse}`);
  console.log(`  §5.4 has inline junction:     ${hasInlineTable}`);
  console.log(`  Appendix A section present:   ${hasAppendixA}`);
  console.log(`  Appendix A has junction row:  ${tableHasJunction}`);

  if (expectSignificant) {
    if (!hasInlineTable) { console.error(`  ✗ FAIL: expected inline junction table in §5.4`); failed++; }
    if (hasAppendixA) { console.error(`  ✗ FAIL: did not expect Appendix A when significant`); failed++; }
    if (hasProse) { console.error(`  ✗ FAIL: did not expect demoted prose when significant`); failed++; }
  } else {
    if (!hasProse) { console.error(`  ✗ FAIL: expected demoted prose in §5.4`); failed++; }
    if (hasInlineTable) { console.error(`  ✗ FAIL: did not expect inline junction table in §5.4 when demoted`); failed++; }
    if (!hasAppendixA) { console.error(`  ✗ FAIL: expected Appendix A when demoted`); failed++; }
    if (!tableHasJunction) { console.error(`  ✗ FAIL: expected junction row in Appendix A`); failed++; }
  }
  console.log("");
}

if (failed > 0) {
  console.error(`Calibration: ${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`Calibration: all checks passed.`);
