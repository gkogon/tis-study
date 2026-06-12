/**
 * Smoke test for the IL CDOT Tier 1 + Tier 2 PDF renderers.
 *
 * Renders two PDFs at Chicago Loop coords (41.8819, -87.6278) with
 * ITE 221 (Multifamily Housing Mid-Rise):
 *   - 30 DU → Tier 1 (CDOT site-plan + project narrative)
 *   - 100 DU → Tier 2 (CDOT TDM Memo)
 * Writes both to /tmp and prints their paths + sizes.
 *
 * Run: pnpm --filter @workspace/scripts run smoke-il-cdot
 */
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

function makeReport(sizeDu: number) {
  const dailyPerDu = 4.5; // ITE 221 ~ 4.5 daily/DU midrise
  const pmPeakPerDu = 0.39;
  const amPeakPerDu = 0.36;
  const dailyTrips = Math.round(sizeDu * dailyPerDu);
  const pmPeakTrips = Math.round(sizeDu * pmPeakPerDu);
  const pmIn = Math.round(pmPeakTrips * 0.61);
  const pmOut = pmPeakTrips - pmIn;
  const amPeakTrips = Math.round(sizeDu * amPeakPerDu);
  return {
    generatedAt: "2026-06-12T15:00:00.000Z",
    request: {
      projectName: `Chicago Loop ${sizeDu}-DU Mid-Rise`,
      address: "100 W Adams St, Chicago, IL 60603",
      latitude: 41.8819,
      longitude: -87.6278,
      landUseCode: "221",
      size: sizeDu,
      openingYear: 2028,
      studyRadiusMi: 0.5,
    },
    studyRadiusMi: 0.5,
    tripGeneration: {
      landUseCode: "221",
      landUseName: "Multifamily Housing (Mid-Rise)",
      size: sizeDu,
      unit: "dwelling units",
      dailyTrips,
      amPeakTrips,
      pmPeakTrips,
      pmIn,
      pmOut,
    },
    affectedIntersections: [],
    intersectionsStudied: 0,
    intersectionsWithLosDrop: 0,
    intersectionsAtLosEf: 0,
    worstDelayDeltaSec: 0,
    findings: [
      `Project generates ${dailyTrips} daily trips and ${pmPeakTrips} PM peak-hour trips at ${sizeDu} dwelling units.`,
    ],
    methodology: [
      "Trip generation per ITE Trip Generation Manual current edition for ITE 221 (Multifamily Housing Mid-Rise).",
    ],
    periodReports: [],
    growthAppliedPct: 1.8,
    growthYears: 2,
    weather: "clear",
    weatherCapacityFactor: 1.0,
    passByPctApplied: 0,
    internalCapturePctApplied: 0,
    citations: [
      "ITE Trip Generation Manual, current edition",
      "CDOT Guidelines for Travel Demand Study and Management (TDM) Plans v1.1 (June 2023)",
      "Connected Communities Ordinance — Chicago Municipal Code §17-3-0308 / §17-4-0301",
    ],
  };
}

function makeProject(sizeDu: number) {
  const report = makeReport(sizeDu);
  return {
    id: `smoke-cdot-${sizeDu}du`,
    studyType: "tis",
    projectName: report.request.projectName,
    landUseCode: "221",
    siteLat: "41.8819",
    siteLon: "-87.6278",
    version: 1,
    createdAt: new Date("2026-06-12T15:00:00Z"),
    requestPayload: report.request,
    resultPayload: report,
  };
}

const firm = { name: "Acme Engineering, PE", logoUrl: null };

for (const sizeDu of [30, 100] as const) {
  const buf = await renderStudyPdf(makeProject(sizeDu), firm);
  const out = `/tmp/tis-il-cdot-${sizeDu}du.pdf`;
  writeFileSync(out, buf);
  const expectedTier = sizeDu === 30 ? "Tier 1 (worksheet)" : "Tier 2 (abbreviated)";
  console.log(`✔ ${expectedTier}: ${buf.length} bytes → ${out}`);
}
