/**
 * Smoke test for the PDF generator. Builds a representative fake TIS
 * report payload, renders the PDF, writes to /tmp, prints the path.
 *
 * Run: pnpm --filter @workspace/scripts run test-pdf
 */
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

const fakeReport = {
  generatedAt: "2026-05-12T22:04:09.625Z",
  request: {
    projectName: "Test Project",
    address: "123 Peachtree St NE, Atlanta, GA",
    latitude: 33.7749,
    longitude: -84.3880,
    landUseCode: "221",
    size: 100,
    openingYear: 2027,
    studyRadiusMi: 0.5,
  },
  studyRadiusMi: 0.5,
  tripGeneration: {
    landUseCode: "221",
    landUseName: "Multifamily Housing (Mid-Rise)",
    size: 100,
    unit: "dwelling units",
    dailyTrips: 1271,
    amPeakTrips: 67,
    pmPeakTrips: 101,
    pmIn: 62,
    pmOut: 39,
  },
  affectedIntersections: [
    { signalId: "S001", name: "Peachtree St & 5th St", zone: "downtown", latitude: 33.78, longitude: -84.39, distanceMi: 0.12, existingVc: 0.78, addedTripsPmPeak: 12, futureVc: 0.85, existingDelaySec: 22.1, futureDelaySec: 28.9, existingLos: "C", futureLos: "C", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 145 },
    { signalId: "S002", name: "Spring St & North Ave", zone: "midtown", latitude: 33.77, longitude: -84.39, distanceMi: 0.34, existingVc: 0.92, addedTripsPmPeak: 8, futureVc: 0.97, existingDelaySec: 55.0, futureDelaySec: 78.4, existingLos: "D", futureLos: "E", losChanged: true, mitigation: "Add eastbound right-turn lane and adjust signal split toward eastbound by 8s.", mitigationSeverity: "moderate", approaches: [], queue95thFt: 320 },
    { signalId: "S003", name: "West Peachtree & 14th St", zone: "midtown", latitude: 33.79, longitude: -84.39, distanceMi: 0.41, existingVc: 1.04, addedTripsPmPeak: 5, futureVc: 1.06, existingDelaySec: 92.3, futureDelaySec: 104.1, existingLos: "F", futureLos: "F", losChanged: false, mitigation: "Significant restriping or re-timing required; consider grade-separated movement study.", mitigationSeverity: "major", approaches: [], queue95thFt: 580 },
  ],
  intersectionsStudied: 49,
  intersectionsWithLosDrop: 0,
  intersectionsAtLosEf: 9,
  worstDelayDeltaSec: 23.4,
  mitigationSummary: ["2 intersections require formal mitigation"],
  findings: [
    "Project will generate 1,271 new daily vehicle trips, with 101 during the PM peak hour (62 inbound / 39 outbound).",
    "Existing volumes were grown by 1.50%/yr over 1 year (×1.01) to the opening-year horizon.",
    "49 signalized intersections fall within the study area; 0 are projected to drop at least one LOS grade after build-out.",
    "9 intersections are projected to operate at LOS E or F under the build condition and require formal mitigation per City of Atlanta DOT TIS guidance.",
    "Monte-Carlo sensitivity (100 runs, ±10% trip-rate / ±15% existing-volume): worst-case delay change is 0.6s (median); 80% range 0.5–0.7s. Probability of ≥1 LOS drop: 14%.",
  ],
  methodology: [
    "Trip generation uses ITE Trip Generation Manual 11th-Edition average rates for the selected land-use code, computed for AM peak, PM peak, Saturday midday, and daily totals. Saturday-midday rates are estimated as a published industry multiple of the PM peak rate by land-use category.",
    "Pass-by and internal-capture credits are applied at the PM peak per ITE's Pass-By Trip Generation Manual (3rd Edition) and ULI Mixed-Use Internal Capture defaults; only the residual external trips are assigned to off-site intersections.",
    "Existing intersection volumes are grown to the opening-year horizon at the user-supplied annual growth rate (default 1.5%/yr) before the capacity analysis.",
    "Weather adjustment follows HCM 6th-Edition Ch. 11 (rain/snow capacity reduction): clear 1.00, light rain 0.95, heavy rain 0.86, light snow 0.86, heavy snow 0.70. The factor multiplies the saturation flow at every intersection.",
    "Off-site impact is screened for all signalized intersections within the study radius (default 0.5 mi). New trips are assigned by inverse-distance weighting (clamped at 100m), normalised to sum to 100% of the period's external trip total.",
    "Intersection-level control delay uses the HCM signalized-intersection model d = d1 + d2 (Webster uniform delay + Akçelik/HCM incremental-delay term) with a 90s cycle, g/C = 0.45, 1,800 vphpl saturation flow (× weather factor), 15-minute peak analysis period (T = 0.25 hr) and pretimed-signal incremental-delay factor k = 0.5.",
    "Approach-level analysis splits each signal's inflow across NB/SB/EB/WB approaches (deterministic per-signal allocation perturbed ±15% from a 30/25/25/20 base) and assigns added trips to each approach by cosine-similarity to the bearing of the project relative to the signal. Per-approach v/c, control delay, LOS, and 95th-percentile back-of-queue length (HCM Eq. 19-50, Q95 ≈ Q1 × 1.65 × 25 ft/veh) are reported.",
    "Level of Service is assigned from HCM 6th-Edition signalized-intersection control-delay thresholds (Exhibit 19-8): A ≤10s, B ≤20s, C ≤35s, D ≤55s, E ≤80s, F >80s.",
    "Optional Monte-Carlo sensitivity perturbs the project trip rate by N(1, 0.10) and the baseline existing volume by N(1, 0.15) over 100 iterations and reports the resulting distribution of worst-case delay change and probability of any LOS drop.",
    "Mitigations are screening-level recommendations sized to the projected delay change, not full Synchro/SimTraffic optimization runs. A formal TIS submittal should validate these recommendations with detailed traffic counts and signal-timing analysis.",
  ],
  periodReports: [
    { period: "am_peak", periodLabel: "AM Peak", tripGeneration: { period: "am_peak", periodLabel: "AM Peak", rawTrips: 75, passByCredit: 8, internalCaptureCredit: 0, externalTrips: 67, inTrips: 23, outTrips: 44 }, affectedIntersections: [], intersectionsWithLosDrop: 0, intersectionsAtLosEf: 0, worstDelayDeltaSec: 0 },
    { period: "pm_peak", periodLabel: "PM Peak", tripGeneration: { period: "pm_peak", periodLabel: "PM Peak", rawTrips: 113, passByCredit: 12, internalCaptureCredit: 0, externalTrips: 101, inTrips: 62, outTrips: 39 }, affectedIntersections: [], intersectionsWithLosDrop: 0, intersectionsAtLosEf: 0, worstDelayDeltaSec: 0 },
    { period: "saturday_midday", periodLabel: "Sat midday", tripGeneration: { period: "saturday_midday", periodLabel: "Sat midday", rawTrips: 124, passByCredit: 13, internalCaptureCredit: 0, externalTrips: 111, inTrips: 56, outTrips: 55 }, affectedIntersections: [], intersectionsWithLosDrop: 0, intersectionsAtLosEf: 0, worstDelayDeltaSec: 0 },
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
    worstDelayDeltaMean: 0.6,
    worstDelayDeltaP10: 0.5,
    worstDelayDeltaP50: 0.6,
    worstDelayDeltaP90: 0.7,
    probAnyLosDrop: 0.14,
    probAnyLosEf: 0.18,
    expectedLosDrops: 0.18,
  },
  citations: [
    "ITE Trip Generation Manual, 11th Edition",
    "HCM 6th Edition, Chapters 11 (Capacity) and 19 (Signalized Intersections)",
    "ULI Mixed-Use Development Internal Capture defaults",
    "City of Atlanta DOT — Traffic Impact Study Guidelines",
  ],
};

const fakeProject = {
  id: "test-001",
  studyType: "tis",
  projectName: "Test Project",
  landUseCode: "221",
  siteLat: "33.7749",
  siteLon: "-84.3880",
  version: 1,
  createdAt: new Date(),
  requestPayload: fakeReport.request,
  resultPayload: fakeReport,
};

const fakeFirm = { name: "Acme Engineering, PE", logoUrl: null };

const buf = await renderStudyPdf(fakeProject, fakeFirm);
const out = "/tmp/tis-test.pdf";
writeFileSync(out, buf);
console.log(`✔ wrote ${buf.length} bytes → ${out}`);
