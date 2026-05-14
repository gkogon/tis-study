/**
 * Generate a polished sample TIS PDF for public download. The file
 * ships as a static asset under the frontend's `public/` folder, so
 * Vite copies it into `dist/public/sample-tis-report.pdf` on every
 * build. Prospects can click "See an example report" on the marketing
 * site and download what an actual deliverable looks like — without
 * the friction of signing up.
 *
 * Re-run when:
 *   - The TIS report shape changes (new fields, renamed fields)
 *   - The PDF renderer ships meaningful visual improvements
 *   - You want to update the sample copy for seasonal accuracy
 *
 *   pnpm --filter @workspace/scripts run generate-sample-pdf
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A realistic-but-fake Peachtree-area multifamily TIS. Numbers picked
// to pass a senior PE's sniff test on first read: ITE land-use 221
// (Multifamily Mid-Rise), reasonable Atlanta intersection set, an
// honest mix of intersections that pass / drop / hit LOS E.
const sample = {
  generatedAt: "2026-05-14T18:00:00.000Z",
  request: {
    projectName: "1100 Peachtree Multifamily — 240 DU",
    address: "1100 Peachtree St NE, Atlanta GA 30309",
    latitude: 33.7858,
    longitude: -84.3848,
    landUseCode: "221",
    size: 240,
    openingYear: 2027,
    studyRadiusMi: 0.75,
    analysisPeriods: ["am_peak", "pm_peak", "saturday_midday", "daily"],
    growthRatePct: 1.5,
    weather: "clear",
    passByPct: 10,
    internalCapturePct: 0,
    runSensitivity: true,
  },
  studyRadiusMi: 0.75,
  tripGeneration: {
    landUseCode: "221",
    landUseName: "Multifamily Housing (Mid-Rise)",
    size: 240,
    unit: "dwelling units",
    dailyTrips: 1271,
    amPeakTrips: 67,
    pmPeakTrips: 101,
    pmIn: 62,
    pmOut: 39,
  },
  affectedIntersections: [
    { signalId: "ATL-001", name: "Peachtree St NE & 14th St NE", zone: "midtown", latitude: 33.789, longitude: -84.385, distanceMi: 0.18, existingVc: 0.82, addedTripsPmPeak: 14, futureVc: 0.89, existingDelaySec: 28.1, futureDelaySec: 36.4, existingLos: "C", futureLos: "D", losChanged: true, mitigation: "Re-time NB through phase +5s and add EB right-turn overlap to absorb projected southbound peak inflow.", mitigationSeverity: "moderate", approaches: [], queue95thFt: 320 },
    { signalId: "ATL-002", name: "Peachtree St NE & 10th St NE", zone: "midtown", latitude: 33.782, longitude: -84.385, distanceMi: 0.34, existingVc: 0.78, addedTripsPmPeak: 9, futureVc: 0.83, existingDelaySec: 22.5, futureDelaySec: 27.8, existingLos: "C", futureLos: "C", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 155 },
    { signalId: "ATL-003", name: "Spring St NW & 14th St NW", zone: "midtown", latitude: 33.788, longitude: -84.394, distanceMi: 0.51, existingVc: 0.92, addedTripsPmPeak: 6, futureVc: 0.96, existingDelaySec: 54.2, futureDelaySec: 76.1, existingLos: "D", futureLos: "E", losChanged: true, mitigation: "Add eastbound right-turn lane (200 ft taper + 100 ft storage) and adjust signal split 8s toward EB.", mitigationSeverity: "major", approaches: [], queue95thFt: 410 },
    { signalId: "ATL-004", name: "W Peachtree St NW & 17th St NW", zone: "midtown", latitude: 33.792, longitude: -84.388, distanceMi: 0.42, existingVc: 0.71, addedTripsPmPeak: 5, futureVc: 0.74, existingDelaySec: 18.9, futureDelaySec: 21.2, existingLos: "B", futureLos: "C", losChanged: true, mitigation: "Minor signal-timing optimization, 3-5s green-shift toward critical southbound through phase.", mitigationSeverity: "minor", approaches: [], queue95thFt: 95 },
    { signalId: "ATL-005", name: "Juniper St NE & 11th St NE", zone: "midtown", latitude: 33.783, longitude: -84.382, distanceMi: 0.29, existingVc: 0.68, addedTripsPmPeak: 7, futureVc: 0.72, existingDelaySec: 16.4, futureDelaySec: 18.2, existingLos: "B", futureLos: "B", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 78 },
    { signalId: "ATL-006", name: "Crescent Ave NE & 12th St NE", zone: "midtown", latitude: 33.785, longitude: -84.384, distanceMi: 0.22, existingVc: 0.61, addedTripsPmPeak: 8, futureVc: 0.66, existingDelaySec: 14.2, futureDelaySec: 16.1, existingLos: "B", futureLos: "B", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 62 },
    { signalId: "ATL-007", name: "W Peachtree St NW & 14th St NW", zone: "midtown", latitude: 33.789, longitude: -84.388, distanceMi: 0.31, existingVc: 1.02, addedTripsPmPeak: 4, futureVc: 1.05, existingDelaySec: 88.3, futureDelaySec: 102.8, existingLos: "F", futureLos: "F", losChanged: false, mitigation: "Already operating at LOS F under existing conditions. Project does not meaningfully degrade further; significant geometric improvements would be required to recover LOS regardless of project.", mitigationSeverity: "major", approaches: [], queue95thFt: 580 },
    { signalId: "ATL-008", name: "Peachtree St NE & 17th St NE", zone: "midtown", latitude: 33.792, longitude: -84.385, distanceMi: 0.46, existingVc: 0.74, addedTripsPmPeak: 6, futureVc: 0.78, existingDelaySec: 21.4, futureDelaySec: 24.0, existingLos: "C", futureLos: "C", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 138 },
    { signalId: "ATL-009", name: "Spring St NW & 17th St NW", zone: "midtown", latitude: 33.792, longitude: -84.394, distanceMi: 0.63, existingVc: 0.81, addedTripsPmPeak: 3, futureVc: 0.83, existingDelaySec: 26.7, futureDelaySec: 29.1, existingLos: "C", futureLos: "C", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 162 },
    { signalId: "ATL-010", name: "Peachtree St NE & 12th St NE", zone: "midtown", latitude: 33.785, longitude: -84.385, distanceMi: 0.12, existingVc: 0.86, addedTripsPmPeak: 11, futureVc: 0.92, existingDelaySec: 32.8, futureDelaySec: 41.5, existingLos: "C", futureLos: "D", losChanged: true, mitigation: "Re-time critical NB through phase +4s. Modest queue impact at 95th-percentile back-of-queue.", mitigationSeverity: "moderate", approaches: [], queue95thFt: 285 },
  ],
  intersectionsStudied: 10,
  intersectionsWithLosDrop: 4,
  intersectionsAtLosEf: 2,
  worstDelayDeltaSec: 21.9,
  mitigationSummary: [
    "1 intersection requires major mitigation (Spring St NW & 14th St NW — add EB right-turn lane).",
    "2 intersections require moderate signal re-timing.",
    "1 intersection minor signal optimization.",
    "6 intersections remain at existing LOS without mitigation.",
  ],
  findings: [
    "Project will generate 1,271 new daily vehicle trips, with 101 during the PM peak hour (62 inbound / 39 outbound) after 10% pass-by capture per ITE TGM Appendix B.",
    "Existing volumes were grown by 1.50%/yr over 1 year (×1.015) to the 2027 opening-year horizon.",
    "10 signalized intersections fall within the 0.75-mi study area; 4 are projected to drop at least one LOS grade after build-out.",
    "2 intersections are projected to operate at LOS E or F under the build condition and require formal mitigation per City of Atlanta DOT TIS guidance.",
    "1 intersection (W Peachtree St NW & 14th St NW) operates at LOS F under existing conditions; project contribution is marginal at this location.",
    "Monte-Carlo sensitivity (100 runs, ±10% trip-rate / ±15% existing-volume): worst-case delay change is 7.2s (median); 80% range 5.4–9.1s. Probability of ≥1 LOS drop: 92% (high confidence the LOS impacts shown are robust to input uncertainty).",
  ],
  methodology: [
    "Trip generation uses ITE Trip Generation Manual 11th-Edition average rates for the selected land-use code, computed for AM peak, PM peak, Saturday midday, and daily totals. Saturday-midday rates are estimated as a published industry multiple of the PM peak rate by land-use category.",
    "Pass-by and internal-capture credits are applied at the PM peak per ITE's Pass-By Trip Generation Manual (3rd Edition) and ULI Mixed-Use Internal Capture defaults; only the residual external trips are assigned to off-site intersections.",
    "Existing intersection volumes are grown to the opening-year horizon at the user-supplied annual growth rate (default 1.5%/yr) before the capacity analysis.",
    "Weather adjustment follows HCM 6th-Edition Ch. 11 (rain/snow capacity reduction): clear 1.00, light rain 0.95, heavy rain 0.86, light snow 0.86, heavy snow 0.70. The factor multiplies the saturation flow at every intersection.",
    "Off-site impact is screened for all signalized intersections within the study radius. New trips are assigned by inverse-distance weighting (clamped at 100m), normalised to sum to 100% of the period's external trip total.",
    "Intersection-level control delay uses the HCM signalized-intersection model d = d1 + d2 (Webster uniform delay + Akçelik/HCM incremental-delay term) with a 90s cycle, g/C = 0.45, 1,800 vphpl saturation flow (× weather factor), 15-minute peak analysis period (T = 0.25 hr) and pretimed-signal incremental-delay factor k = 0.5.",
    "Approach-level analysis splits each signal's inflow across NB/SB/EB/WB approaches (deterministic per-signal allocation perturbed ±15% from a 30/25/25/20 base) and assigns added trips to each approach by cosine-similarity to the bearing of the project relative to the signal. Per-approach v/c, control delay, LOS, and 95th-percentile back-of-queue length (HCM Eq. 19-50, Q95 ≈ Q1 × 1.65 × 25 ft/veh) are reported.",
    "Level of Service is assigned from HCM 6th-Edition signalized-intersection control-delay thresholds (Exhibit 19-8): A ≤10s, B ≤20s, C ≤35s, D ≤55s, E ≤80s, F >80s.",
    "Monte-Carlo sensitivity perturbs the project trip rate by N(1, 0.10) and the baseline existing volume by N(1, 0.15) over 100 iterations and reports the resulting distribution of worst-case delay change and probability of any LOS drop.",
    "Mitigations are screening-level recommendations sized to the projected delay change, not full Synchro/SimTraffic optimization runs. A formal TIS submittal should validate these recommendations with detailed traffic counts and signal-timing analysis.",
  ],
  periodReports: [
    { period: "am_peak", periodLabel: "AM Peak", tripGeneration: { period: "am_peak", periodLabel: "AM Peak", rawTrips: 75, passByCredit: 8, internalCaptureCredit: 0, externalTrips: 67, inTrips: 23, outTrips: 44 }, affectedIntersections: [], intersectionsWithLosDrop: 2, intersectionsAtLosEf: 1, worstDelayDeltaSec: 12.3 },
    { period: "pm_peak", periodLabel: "PM Peak", tripGeneration: { period: "pm_peak", periodLabel: "PM Peak", rawTrips: 113, passByCredit: 12, internalCaptureCredit: 0, externalTrips: 101, inTrips: 62, outTrips: 39 }, affectedIntersections: [], intersectionsWithLosDrop: 4, intersectionsAtLosEf: 2, worstDelayDeltaSec: 21.9 },
    { period: "saturday_midday", periodLabel: "Saturday Midday", tripGeneration: { period: "saturday_midday", periodLabel: "Sat midday", rawTrips: 124, passByCredit: 13, internalCaptureCredit: 0, externalTrips: 111, inTrips: 56, outTrips: 55 }, affectedIntersections: [], intersectionsWithLosDrop: 3, intersectionsAtLosEf: 1, worstDelayDeltaSec: 18.4 },
    { period: "daily", periodLabel: "Daily", tripGeneration: { period: "daily", periodLabel: "Daily", rawTrips: 1271, passByCredit: 0, internalCaptureCredit: 0, externalTrips: 1271, inTrips: 636, outTrips: 635 }, affectedIntersections: [], intersectionsWithLosDrop: 0, intersectionsAtLosEf: 0, worstDelayDeltaSec: 0 },
  ],
  growthAppliedPct: 1.5,
  growthYears: 1,
  weather: "clear",
  weatherCapacityFactor: 1.0,
  passByPctApplied: 10,
  internalCapturePctApplied: 0,
  sensitivity: {
    iterations: 100,
    worstDelayDeltaMean: 7.2,
    worstDelayDeltaP10: 5.4,
    worstDelayDeltaP50: 7.2,
    worstDelayDeltaP90: 9.1,
    probAnyLosDrop: 0.92,
    probAnyLosEf: 0.78,
    expectedLosDrops: 3.4,
  },
  citations: [
    "ITE Trip Generation Manual, 11th Edition — peak and daily rates by land-use code.",
    "ITE Pass-By Trip Generation Manual, 3rd Edition — pass-by capture defaults.",
    "HCM 6th Edition, Chapter 11 (Capacity and LOS) — saturation flow + weather adjustment.",
    "HCM 6th Edition, Chapter 19 (Signalized Intersections) — Eq. 19-13 control delay, Exhibit 19-8 LOS thresholds.",
    "HCM 6th Edition, Chapter 31 — 95th-percentile back-of-queue methodology.",
    "ULI Mixed-Use Development Internal Capture defaults.",
    "City of Atlanta DOT — Traffic Impact Study Guidelines.",
    "Sample report generated by Simple Impact Studies — simpleimpactstudies.com",
  ],
};

const sampleProject = {
  id: "sample-tis-2026",
  studyType: "tis",
  projectName: sample.request.projectName,
  landUseCode: sample.request.landUseCode,
  siteLat: String(sample.request.latitude),
  siteLon: String(sample.request.longitude),
  version: 1,
  // Fixed date so the sample doesn't change every build.
  createdAt: new Date("2026-05-14T18:00:00.000Z"),
  requestPayload: sample.request,
  resultPayload: sample,
};

const sampleFirm = {
  name: "Sample Engineering, PE",
  logoUrl: null,
};

const buf = await renderStudyPdf(sampleProject, sampleFirm);

const outPath = path.resolve(
  __dirname,
  "../../artifacts/atlanta-tis/public/sample-tis-report.pdf",
);
writeFileSync(outPath, buf);
console.log(`✔ wrote ${buf.length} bytes → ${outPath}`);
console.log(`  Serves at https://simpleimpactstudies.com/sample-tis-report.pdf after deploy`);
