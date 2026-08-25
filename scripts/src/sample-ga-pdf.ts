/**
 * Sample-render a GA TIS PDF for visual / readability audit.
 * Mirrors sample-fl-pdf.ts / sample-ny-pdf.ts but with an Atlanta
 * mid-block infill site routed through renderTisGeorgia (which
 * fires for any project inside the atlanta_metro bbox).
 *
 * Site: 1280 Peachtree St NE, Midtown — realistic mixed-use
 * parcel inside the Midtown Special Public Interest District 16
 * (SPI-16). Used to validate that the §2.1 measured-growth-rate
 * branch and the §6.0 4-scenario LOS table still fire after
 * parallel-chip edits.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/sample-ga-pdf.ts
 */
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

const fakeReport = {
  generatedAt: new Date().toISOString(),
  request: {
    projectName: "1280 Peachtree Midtown Infill",
    address: "1280 Peachtree St NE, Atlanta, GA",
    latitude: 33.7900,
    longitude: -84.3850,
    landUseCode: "221",
    size: 220,
    openingYear: 2027,
    studyRadiusMi: 0.5,
  },
  studyRadiusMi: 0.5,
  tripGeneration: {
    landUseCode: "221",
    landUseName: "Mid-Rise Apartment",
    size: 220,
    unit: "dwelling units",
    dailyTrips: 1130,
    amPeakTrips: 95,
    pmPeakTrips: 134,
    pmIn: 81,
    pmOut: 53,
  },
  affectedIntersections: [
    { signalId: "GA-S1", name: "Peachtree St & 14th St", zone: "midtown", latitude: 33.7891, longitude: -84.3853, distanceMi: 0.05, existingVc: 0.88, addedTripsPmPeak: 19, futureVc: 0.94, currentLos: "D", currentDelaySec: 43.0, existingDelaySec: 51.2, futureDelaySec: 58.7, existingLos: "D", futureLos: "E", losChanged: true, mitigation: "Re-time the Peachtree / 14 St cycle; reallocate green to the dominant peak-direction phase. Coordinate with the City of Atlanta Office of Mobility Planning for the SPI-16 review.", mitigationSeverity: "moderate", approaches: [], queue95thFt: 310, designNoBuildLos: "E", designNoBuildDelaySec: 72.4, designBuildLos: "F", designBuildDelaySec: 95.2 },
    { signalId: "GA-S2", name: "Peachtree St & Spring St (15th)", zone: "midtown", latitude: 33.7903, longitude: -84.3878, distanceMi: 0.21, existingVc: 0.81, addedTripsPmPeak: 12, futureVc: 0.85, currentLos: "C", currentDelaySec: 33.2, existingDelaySec: 38.1, futureDelaySec: 40.9, existingLos: "C", futureLos: "D", losChanged: true, mitigation: "Add a brief NB-leading-LT phase if pedestrian-conflict-driven LT-stall becomes critical under build conditions; coordinate with GDOT 511 NaviGAtor signal-timing schedule.", mitigationSeverity: "minor", approaches: [], queue95thFt: 220, designNoBuildLos: "D", designNoBuildDelaySec: 53.0, designBuildLos: "E", designBuildDelaySec: 60.4 },
    { signalId: "GA-S3", name: "Peachtree St & 17th St", zone: "midtown", latitude: 33.7960, longitude: -84.3838, distanceMi: 0.43, existingVc: 0.69, addedTripsPmPeak: 7, futureVc: 0.72, currentLos: "C", currentDelaySec: 26.0, existingDelaySec: 29.5, futureDelaySec: 31.2, existingLos: "C", futureLos: "C", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 170, designNoBuildLos: "C", designNoBuildDelaySec: 37.3, designBuildLos: "C", designBuildDelaySec: 38.4 },
  ],
  intersectionsStudied: 22,
  intersectionsWithLosDrop: 2,
  intersectionsAtLosEf: 1,
  worstDelayDeltaSec: 7.5,
  mitigationSummary: ["2 intersections require formal mitigation", "1 intersection projected to LOS E under build"],
  findings: [
    "Project generates 1,130 daily trips, with 134 during the PM peak hour (81 inbound / 53 outbound) at full build-out of 220 multifamily units.",
    "2 of 22 studied intersections project an LOS drop under build conditions; 1 operates at LOS E.",
    "Background growth derived from the ARC Open Data Hub re-publication of GDOT AADT 2008-2017.",
  ],
  methodology: [
    "Trip generation per public-data screening average rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use 221 (Mid-Rise Apartment) at 220 DU; the daily rate traces to the City of San Diego LDC Trip Generation Manual (May 2003) San Diego Traffic Generators measured data (locally measured, not ITE).",
    "Pass-by credits per standard screening methodology; internal-capture defaults per ULI Mixed-Use Internal Capture.",
    "Intersection-level control delay per the openly-published Webster/Akcelik signalized method (Webster 1958 uniform delay with an Akcelik overflow term); calibration from the live GDOT 511 NaviGAtor incident + signal feed.",
  ],
  periodReports: [
    { period: "pm_peak", periodLabel: "PM Peak", tripGeneration: { period: "pm_peak", periodLabel: "PM Peak", rawTrips: 138, passByCredit: 4, internalCaptureCredit: 0, externalTrips: 134, inTrips: 81, outTrips: 53 }, affectedIntersections: [], intersectionsWithLosDrop: 2, intersectionsAtLosEf: 1, worstDelayDeltaSec: 7.5 },
  ],
  growthAppliedPct: 0.92,
  growthYears: 1,
  growthSource: "Atlanta Regional Commission Open Data Hub — GDOT Traffic Counts (AADT and Truck Percent) 2008-2017 (per-station record with AADT_2008 … AADT_2017 columns; CAGR across earliest and latest non-null AADT per Station_ID, ≥5yr span) — median per-segment CAGR across 5148 matched count stations within the Atlanta MSA bounding box (2008 → 2017)",
  designYear: 2047,
  designYearHorizonYears: 20,
  weather: "clear",
  weatherCapacityFactor: 1.0,
  passByPctApplied: 3,
  internalCapturePctApplied: 0,
  autoModeShareApplied: 0.90,
  citations: [
    "SANDAG 2002, “(Not So) Brief Guide of Vehicular Traffic Generation Rates for the San Diego Region”",
    "City of San Diego LDC Trip Generation Manual (May 2003) — San Diego Traffic Generators measured data",
    "NCHRP Report 716, Travel Demand Forecasting: Parameters and Techniques (TRB, 2012)",
    "FHWA National Household Travel Survey (NHTS), 2017",
    "F. V. Webster, Traffic Signal Settings, Road Research Technical Paper No. 39 (RRL/HMSO, 1958); Akcelik time-dependent overflow delay term (ARRB)",
    "GDOT 511 NaviGAtor live signal-timing feed",
    "City of Atlanta SPI-16 Midtown Special Public Interest District",
    "Atlanta Regional Commission (ARC) Regional Transportation Plan (RTP)",
  ],
};

const fakeProject = {
  id: "sample-ga-001",
  studyType: "tis",
  projectName: "1280 Peachtree Midtown Infill",
  landUseCode: "221",
  siteLat: "33.7900",
  siteLon: "-84.3850",
  version: 1,
  createdAt: new Date(),
  requestPayload: fakeReport.request,
  resultPayload: fakeReport,
};

const fakeFirm = { name: "Acme Engineering, PE", logoUrl: null };

const buf = await renderStudyPdf(fakeProject, fakeFirm);
const out = "/tmp/ga-sample.pdf";
writeFileSync(out, buf);
console.log(`✔ wrote ${buf.length} bytes → ${out}`);
