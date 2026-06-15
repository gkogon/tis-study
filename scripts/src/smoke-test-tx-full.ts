/**
 * Smoke test for the Texas FULL TIA renderer (renderTisTexas) — exercises
 * Houston, Austin, Dallas at trip volumes that route past the worksheet
 * and abbreviated tiers into the full Appendix-Q-shape report. Used to
 * verify the IDM 07-01-2022 / Austin Guidelines / Dallas Waiver citation
 * fixes per texas-tis-spec.md §11.
 */
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

type CityCase = { key: string; label: string; lat: number; lon: number };

const cities: CityCase[] = [
  { key: "houston", label: "Houston", lat: 29.7604, lon: -95.3698 },
  { key: "austin", label: "Austin", lat: 30.2672, lon: -97.7431 },
  { key: "dallas", label: "Dallas", lat: 32.7767, lon: -96.7970 },
];

function buildReport(c: CityCase) {
  return {
    generatedAt: "2026-06-12T12:00:00.000Z",
    request: {
      projectName: `${c.label} full TIA smoke`,
      address: `Centroid, ${c.label}, TX`,
      latitude: c.lat,
      longitude: c.lon,
      landUseCode: "221",
      size: 600,
      openingYear: 2028,
      studyRadiusMi: 1.0,
      studyTier: "full",
    },
    studyRadiusMi: 1.0,
    tripGeneration: {
      landUseCode: "221",
      landUseName: "Multifamily Housing (Mid-Rise)",
      size: 600,
      unit: "dwelling units",
      dailyTrips: 9800,
      amPeakTrips: 720,
      pmPeakTrips: 820,
      pmIn: 410,
      pmOut: 410,
    },
    affectedIntersections: [
      { signalId: "S001", name: "Main St & 1st Ave", distanceMi: 0.18, existingLos: "C", currentLos: "C", futureLos: "D", losChanged: true, existingDelaySec: 24, futureDelaySec: 39, queue95thFt: 180 },
      { signalId: "S002", name: "Main St & 2nd Ave", distanceMi: 0.32, existingLos: "D", currentLos: "D", futureLos: "E", losChanged: true, existingDelaySec: 48, futureDelaySec: 68, queue95thFt: 290 },
      { signalId: "S003", name: "Main St & 3rd Ave", distanceMi: 0.55, existingLos: "C", currentLos: "C", futureLos: "C", losChanged: false, existingDelaySec: 22, futureDelaySec: 26, queue95thFt: 140 },
    ],
    intersectionsStudied: 3,
    intersectionsWithLosDrop: 2,
    intersectionsAtLosEf: 1,
    worstDelayDeltaSec: 20,
    findings: [],
    methodology: [],
    periodReports: [],
    growthAppliedPct: 1.5,
    growthYears: 5,
    weather: "clear",
    weatherCapacityFactor: 1.0,
    passByPctApplied: 5,
    internalCapturePctApplied: 0,
    citations: [],
  };
}

const fakeFirm = { name: "Acme Engineering, PE", logoUrl: null };

let pass = 0;
let fail = 0;
const cityThresholdHit: Record<string, string[]> = {};

for (const c of cities) {
  const fakeReport = buildReport(c);
  const fakeProject = {
    id: `tx-${c.key}-full`,
    studyType: "tis",
    projectName: fakeReport.request.projectName,
    landUseCode: "221",
    siteLat: String(c.lat),
    siteLon: String(c.lon),
    version: 1,
    createdAt: new Date("2026-06-12T12:00:00.000Z"),
    requestPayload: fakeReport.request,
    resultPayload: fakeReport,
  };
  try {
    const buf = await renderStudyPdf(fakeProject as any, fakeFirm);
    const out = `/tmp/tis-tx-${c.key}-full.pdf`;
    writeFileSync(out, buf);
    // Search the raw PDF bytes for marker strings to confirm the right
    // city's text rendered. PDFKit's encoding splits glyphs awkwardly, so
    // we only spot-check anchor tokens that are likely to survive.
    const txt = buf.toString("latin1");
    const markers: string[] = [];
    if (txt.includes("07-01-2022")) markers.push("IDM-rev");
    if (txt.includes("15.04.A.4.a")) markers.push("§15.04.A.4.a");
    if (txt.includes("15.04.B.6.a")) markers.push("§15.04.B.6.a");
    if (txt.includes("Austin TIA Guidelines")) markers.push("Austin-guidelines");
    if (txt.includes("Director of the Department")) markers.push("Dallas-Director");
    if (txt.includes("Access Management Data Summary Form")) markers.push("AMDS-Form");
    if (txt.includes("CPC 101")) markers.push("CPC-101");
    if (txt.includes("VLOS")) markers.push("⚠ VLOS-still-present");
    if (txt.includes("2023 IDM")) markers.push("⚠ 2023-IDM-still-present");
    cityThresholdHit[c.key] = markers;
    console.log(`✔ ${c.label} full: ${buf.length} bytes → ${out} · markers: ${markers.join(", ") || "(none)"}`);
    pass++;
  } catch (err) {
    console.error(`✘ ${c.label} full: ${err instanceof Error ? err.message : err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    fail++;
  }
}

console.log(`\n${pass} pass · ${fail} fail`);
if (fail > 0) process.exit(1);
