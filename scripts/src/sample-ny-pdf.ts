/**
 * Sample-render a NY TIS PDF for visual / readability audit. Mirrors
 * the test-pdf.ts payload but with a realistic NYC site and adds the
 * design-year fields so we can audit the 4-scenario table.
 * Run: pnpm --filter @workspace/scripts exec tsx src/sample-ny-pdf.ts
 */
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

// 350 W 42nd St — Manhattan mid-block residential infill, realistic
// site for a SEQR-track project that BFJ Planning et al. would scope.
const fakeReport = {
  generatedAt: new Date().toISOString(),
  request: {
    projectName: "350 W 42nd St Residential Infill",
    address: "350 W 42nd St, New York, NY",
    latitude: 40.7589,
    longitude: -73.9911,
    landUseCode: "221",
    size: 240,
    openingYear: 2027,
    studyRadiusMi: 0.5,
  },
  studyRadiusMi: 0.5,
  tripGeneration: {
    landUseCode: "221",
    landUseName: "Multifamily Housing (Mid-Rise)",
    size: 240,
    unit: "dwelling units",
    dailyTrips: 1234,
    amPeakTrips: 110,
    pmPeakTrips: 152,
    pmIn: 92,
    pmOut: 60,
  },
  affectedIntersections: [
    { signalId: "S-MID-1", name: "8th Ave & W 42nd St", zone: "midtown", latitude: 40.7569, longitude: -73.9897, distanceMi: 0.07, existingVc: 0.91, addedTripsPmPeak: 22, futureVc: 0.97, currentLos: "D", currentDelaySec: 38.4, existingDelaySec: 47.6, futureDelaySec: 58.0, existingLos: "D", futureLos: "E", losChanged: true, mitigation: "Re-time the 8 Av/W 42 St signal cycle; reallocate 4-7s of green time to the westbound left-turn phase to clear the WBL queue spillback that emerges in build conditions.", mitigationSeverity: "moderate", approaches: [], queue95thFt: 360, designNoBuildLos: "E", designNoBuildDelaySec: 64.3, designBuildLos: "F", designBuildDelaySec: 86.1 },
    { signalId: "S-MID-2", name: "9th Ave & W 42nd St", zone: "midtown", latitude: 40.7585, longitude: -73.9921, distanceMi: 0.11, existingVc: 0.74, addedTripsPmPeak: 14, futureVc: 0.79, currentLos: "C", currentDelaySec: 27.0, existingDelaySec: 32.0, futureDelaySec: 36.5, existingLos: "C", futureLos: "D", losChanged: true, mitigation: "Adjust signal split toward the WB-through phase to handle the build-induced 9 Av approach growth without affecting cross-street operations.", mitigationSeverity: "minor", approaches: [], queue95thFt: 215, designNoBuildLos: "D", designNoBuildDelaySec: 44.1, designBuildLos: "E", designBuildDelaySec: 58.7 },
    { signalId: "S-MID-3", name: "8th Ave & W 41st St", zone: "midtown", latitude: 40.7558, longitude: -73.9900, distanceMi: 0.10, existingVc: 0.82, addedTripsPmPeak: 10, futureVc: 0.85, currentLos: "C", currentDelaySec: 31.2, existingDelaySec: 35.6, futureDelaySec: 38.7, existingLos: "C", futureLos: "D", losChanged: true, mitigation: "Coordinate with the W 42 St signal; add a brief NB-leading-LT phase if WB-LT pedestrian conflicts become design-controlling.", mitigationSeverity: "minor", approaches: [], queue95thFt: 240, designNoBuildLos: "D", designNoBuildDelaySec: 51.0, designBuildLos: "D", designBuildDelaySec: 54.2 },
    { signalId: "S-MID-4", name: "8th Ave & W 43rd St", zone: "midtown", latitude: 40.7595, longitude: -73.9889, distanceMi: 0.13, existingVc: 0.69, addedTripsPmPeak: 8, futureVc: 0.72, currentLos: "C", currentDelaySec: 24.1, existingDelaySec: 27.2, futureDelaySec: 29.4, existingLos: "C", futureLos: "C", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 180, designNoBuildLos: "C", designNoBuildDelaySec: 33.9, designBuildLos: "C", designBuildDelaySec: 34.6 },
  ],
  intersectionsStudied: 24,
  intersectionsWithLosDrop: 3,
  intersectionsAtLosEf: 1,
  worstDelayDeltaSec: 10.4,
  mitigationSummary: ["3 intersections require formal mitigation", "1 intersection projected at LOS E"],
  findings: [
    "Project generates 1,234 daily trips, with 152 during the PM peak hour (92 inbound / 60 outbound) at full build-out of 240 multifamily units.",
    "3 of 24 studied intersections project an LOS drop under build conditions; 1 operates at LOS E.",
    "Mode-share applied: 32% auto (NYC default per ACS B08301 commuting data). 68% of generated trips arrive by transit, walking, or cycling and do not load the off-site roadway network.",
    "Background growth derived from per-station median CAGR at NYSDOT count stations within the New York-Newark-Jersey City MSA bounding box.",
  ],
  methodology: [
    "Trip generation uses ITE Trip Generation Manual 11th Edition average rates for ITE land use 221 (Multifamily Housing — Mid-Rise) at 240 dwelling units.",
    "Pass-by and internal-capture defaults from ULI Mixed-Use Internal Capture and ITE Pass-By Trip Generation Manual (3rd Edition).",
    "Intersection-level control delay per HCM 6th Edition Chapter 19 (signalized) with calibration from live NYCDOT/NYSDOT signal-timing feed where available.",
    "Auto-mode share 32% from NYC ACS B08301 (commuting by mode); applied multiplicatively to ITE external trips.",
  ],
  periodReports: [
    { period: "pm_peak", periodLabel: "PM Peak", tripGeneration: { period: "pm_peak", periodLabel: "PM Peak", rawTrips: 156, passByCredit: 4, internalCaptureCredit: 0, externalTrips: 152, inTrips: 92, outTrips: 60 }, affectedIntersections: [], intersectionsWithLosDrop: 3, intersectionsAtLosEf: 1, worstDelayDeltaSec: 10.4 },
  ],
  growthAppliedPct: 0.07,
  growthYears: 1,
  growthSource: "NYSDOT Traffic_Monitoring AADT FeatureServer layer 1 (rolling per-station actual counts; CAGR across oldest and newest non-null actual values) — median per-segment CAGR across 12244 matched count stations within the New York-Newark-Jersey City MSA bounding box (2000 → 2019)",
  designYear: 2047,
  designYearHorizonYears: 20,
  weather: "clear",
  weatherCapacityFactor: 1.0,
  passByPctApplied: 3,
  internalCapturePctApplied: 0,
  autoModeShareApplied: 0.32,
  citations: [
    "ITE Trip Generation Manual, 11th Edition",
    "HCM 6th Edition, Chapter 19 (Signalized Intersections)",
    "NYSDOT Highway Design Manual, Chapter 5 (TIS Shell, rev. 9/16/2014)",
    "ULI Mixed-Use Development Internal Capture defaults",
  ],
};

const fakeProject = {
  id: "sample-ny-001",
  studyType: "tis",
  projectName: "350 W 42nd St Residential Infill",
  landUseCode: "221",
  siteLat: "40.7589",
  siteLon: "-73.9911",
  version: 1,
  createdAt: new Date(),
  requestPayload: fakeReport.request,
  resultPayload: fakeReport,
};

const fakeFirm = { name: "Acme Engineering, PE", logoUrl: null };

const buf = await renderStudyPdf(fakeProject, fakeFirm);
const out = "/tmp/ny-sample.pdf";
writeFileSync(out, buf);
console.log(`✔ wrote ${buf.length} bytes → ${out}`);
