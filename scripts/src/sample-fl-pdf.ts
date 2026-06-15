/**
 * Sample-render an FL TIS PDF for visual / readability audit
 * against what Caltran Engineering Group (FDOT D-6 Districtwide
 * Traffic Operations Studies contractor, 28 PTOEs, Calderon-
 * family ownership) would see on a real Miami-Dade submittal.
 *
 * Site: 1800 SW 27th Ave, Miami — realistic D-6 mid-block
 * mixed-use parcel that fronts a state-system arterial (SR 9 /
 * 27 Ave) so the renderer dispatches the full prose path.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/sample-fl-pdf.ts
 */
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

const fakeReport = {
  generatedAt: new Date().toISOString(),
  request: {
    projectName: "1800 SW 27th Ave Mixed-Use",
    address: "1800 SW 27th Ave, Miami, FL",
    latitude: 25.7800,
    longitude: -80.2370,
    landUseCode: "221",
    size: 180,
    openingYear: 2027,
    studyRadiusMi: 0.5,
  },
  studyRadiusMi: 0.5,
  tripGeneration: {
    landUseCode: "221",
    landUseName: "Multifamily Housing (Mid-Rise)",
    size: 180,
    unit: "dwelling units",
    dailyTrips: 952,
    amPeakTrips: 80,
    pmPeakTrips: 113,
    pmIn: 68,
    pmOut: 45,
  },
  affectedIntersections: [
    { signalId: "S-M-1", name: "SW 27 Ave & SW 17 St", zone: "central", latitude: 25.7790, longitude: -80.2363, distanceMi: 0.08, existingVc: 0.84, addedTripsPmPeak: 16, futureVc: 0.89, currentLos: "D", currentDelaySec: 41.2, existingDelaySec: 49.8, futureDelaySec: 56.7, existingLos: "D", futureLos: "E", losChanged: true, mitigation: "Re-time the 27 Ave / 17 St signal cycle; reallocate 3-5s of green to the WB-T phase to clear the build-induced WB queue spillback per HCM §19-7.", mitigationSeverity: "moderate", approaches: [], queue95thFt: 295, designNoBuildLos: "E", designNoBuildDelaySec: 70.2, designBuildLos: "F", designBuildDelaySec: 92.1 },
    { signalId: "S-M-2", name: "SW 27 Ave & SW 22 St (Coral Way)", zone: "central", latitude: 25.7488, longitude: -80.2376, distanceMi: 0.34, existingVc: 0.91, addedTripsPmPeak: 10, futureVc: 0.94, currentLos: "D", currentDelaySec: 46.5, existingDelaySec: 54.3, futureDelaySec: 59.0, existingLos: "D", futureLos: "E", losChanged: true, mitigation: "Add NB-RTOL during the AM peak window or convert NB-RTOL to channelized free-flow with a yield to SB-LT; coordinate with the FDOT D-6 Districtwide Traffic Operations contract group.", mitigationSeverity: "moderate", approaches: [], queue95thFt: 340, designNoBuildLos: "E", designNoBuildDelaySec: 73.1, designBuildLos: "F", designBuildDelaySec: 88.5 },
    { signalId: "S-M-3", name: "SW 27 Ave & SW 8 St (Calle Ocho)", zone: "central", latitude: 25.7666, longitude: -80.2368, distanceMi: 0.19, existingVc: 0.79, addedTripsPmPeak: 8, futureVc: 0.82, currentLos: "C", currentDelaySec: 32.4, existingDelaySec: 36.8, futureDelaySec: 39.2, existingLos: "C", futureLos: "D", losChanged: true, mitigation: "Adjust the 27 Ave / Calle Ocho cycle split toward the EB / WB through phase; no geometry change required at this volume.", mitigationSeverity: "minor", approaches: [], queue95thFt: 245, designNoBuildLos: "D", designNoBuildDelaySec: 51.4, designBuildLos: "D", designBuildDelaySec: 54.8 },
    { signalId: "S-M-4", name: "SW 17 St & SW 22 Ave", zone: "central", latitude: 25.7798, longitude: -80.2237, distanceMi: 0.39, existingVc: 0.72, addedTripsPmPeak: 6, futureVc: 0.74, currentLos: "C", currentDelaySec: 28.9, existingDelaySec: 31.2, futureDelaySec: 32.6, existingLos: "C", futureLos: "C", losChanged: false, mitigation: "", mitigationSeverity: "none", approaches: [], queue95thFt: 175, designNoBuildLos: "C", designNoBuildDelaySec: 39.0, designBuildLos: "C", designBuildDelaySec: 40.1 },
  ],
  intersectionsStudied: 18,
  intersectionsWithLosDrop: 3,
  intersectionsAtLosEf: 2,
  worstDelayDeltaSec: 6.9,
  mitigationSummary: ["3 intersections require formal mitigation", "2 intersections project to LOS E under build"],
  findings: [
    "Project generates 952 daily trips, with 113 during the PM peak (68 inbound / 45 outbound) at full build-out of 180 multifamily units.",
    "3 of 18 studied intersections project an LOS drop under build conditions; 2 operate at LOS E under build.",
    "Background growth derived from the FDOT TDA Annual_Average_Daily_Traffic_Historical layer (2021 → 2025 segment match by COSITE).",
  ],
  methodology: [
    "Trip generation per ITE Trip Generation Manual 11th Edition for ITE LU 221 (Multifamily Housing — Mid-Rise) at 180 DU.",
    "Pass-by and internal-capture defaults from ULI Mixed-Use Internal Capture and ITE Pass-By Trip Generation Manual (3rd Edition).",
    "Intersection-level control delay per HCM 6th Edition Chapter 19; calibration from live FDOT D-6 SunGuide signal-timing feed where available.",
  ],
  periodReports: [
    { period: "pm_peak", periodLabel: "PM Peak", tripGeneration: { period: "pm_peak", periodLabel: "PM Peak", rawTrips: 115, passByCredit: 2, internalCaptureCredit: 0, externalTrips: 113, inTrips: 68, outTrips: 45 }, affectedIntersections: [], intersectionsWithLosDrop: 3, intersectionsAtLosEf: 2, worstDelayDeltaSec: 6.9 },
  ],
  growthAppliedPct: 2.74,
  growthYears: 1,
  growthSource: "FDOT TDA Annual_Average_Daily_Traffic_Historical FeatureServer layer 0 (per-year polyline snapshots; segment match by COSITE composite site ID) — median per-segment CAGR across 1747 matched count stations within the Miami-Dade County bounding box (2021 → 2025)",
  designYear: 2047,
  designYearHorizonYears: 20,
  weather: "clear",
  weatherCapacityFactor: 1.0,
  passByPctApplied: 2,
  internalCapturePctApplied: 0,
  autoModeShareApplied: 0.84,
  citations: [
    "ITE Trip Generation Manual, 11th Edition",
    "HCM 6th Edition, Chapter 19 (Signalized Intersections)",
    "FDOT Multimodal Transportation Site Impact Handbook (MTSIH 2024)",
    "FDOT Design Manual (FDM 2026, Topic No. 625-000-002, dated January 1, 2026)",
    "Florida Statute §163.3180 (Concurrency, Mobility Fees)",
  ],
};

const fakeProject = {
  id: "sample-fl-001",
  studyType: "tis",
  projectName: "1800 SW 27th Ave Mixed-Use",
  landUseCode: "221",
  siteLat: "25.7800",
  siteLon: "-80.2370",
  version: 1,
  createdAt: new Date(),
  requestPayload: fakeReport.request,
  resultPayload: fakeReport,
};

const fakeFirm = { name: "Acme Engineering, PE", logoUrl: null };

const buf = await renderStudyPdf(fakeProject, fakeFirm);
const out = "/tmp/fl-sample.pdf";
writeFileSync(out, buf);
console.log(`✔ wrote ${buf.length} bytes → ${out}`);
