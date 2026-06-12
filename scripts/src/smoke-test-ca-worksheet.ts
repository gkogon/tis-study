/**
 * Smoke test for the California Screened-Out Determination Memo
 * (worksheet) PDF renderer. Renders an LA-coords + ITE 221 multifamily
 * at 50 DU site: 200 daily trips, which screens out at LA's 250-trip
 * floor under LADOT TAG.
 */
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

const LA_LAT = 34.05;
const LA_LON = -118.24;

const dailyTrips = 200;
const amPeak = 12;
const pmIn = 8;
const pmOut = 7;
const pmPeak = pmIn + pmOut;

const fakeReport = {
  generatedAt: "2026-06-12T12:00:00.000Z",
  request: {
    projectName: "LA Multifamily 50DU CEQA-VMT Screen Smoke",
    address: "Centroid, Los Angeles, CA",
    latitude: LA_LAT,
    longitude: LA_LON,
    landUseCode: "221",
    size: 50,
    openingYear: 2028,
    studyRadiusMi: 0.5,
    studyTier: "auto" as const,
  },
  studyRadiusMi: 0.5,
  tripGeneration: {
    landUseCode: "221",
    landUseName: "Multifamily Housing (Mid-Rise)",
    size: 50,
    unit: "dwelling units",
    dailyTrips,
    amPeakTrips: amPeak,
    pmPeakTrips: pmPeak,
    pmIn,
    pmOut,
  },
  affectedIntersections: [],
  intersectionsStudied: 0,
  intersectionsWithLosDrop: 0,
  intersectionsAtLosEf: 0,
  worstDelayDeltaSec: 0,
  findings: [],
  methodology: [],
  periodReports: [],
  growthAppliedPct: 1.5,
  growthYears: 2,
  weather: "clear",
  weatherCapacityFactor: 1.0,
  passByPctApplied: 0,
  internalCapturePctApplied: 0,
  citations: [],
};

const fakeFirm = { name: "Acme Engineering, PE", logoUrl: null };
const fakeProject = {
  id: "ca-la-worksheet-smoke",
  studyType: "tis",
  projectName: fakeReport.request.projectName,
  landUseCode: "221",
  siteLat: String(LA_LAT),
  siteLon: String(LA_LON),
  version: 1,
  createdAt: new Date("2026-06-12T12:00:00.000Z"),
  requestPayload: fakeReport.request,
  resultPayload: fakeReport,
};

try {
  const buf = await renderStudyPdf(fakeProject as any, fakeFirm);
  const out = "/tmp/tis-ca-la-worksheet.pdf";
  writeFileSync(out, buf);
  console.log(
    `✔ LA worksheet: ${buf.length} bytes → ${out} (200 daily < LA 250 screening floor → screened out)`,
  );
} catch (err) {
  console.error(`✘ LA worksheet: ${err instanceof Error ? err.message : err}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
}
