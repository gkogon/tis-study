/**
 * Smoke test for the Florida worksheet + abbreviated PDF renderers.
 * Uses Miami coords (25.7617, -80.1918) + ITE 221 at 30 DU (worksheet,
 * Miami-Dade Level 1) and 200 DU (abbreviated, Miami-Dade Level 2).
 */
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

type Case = {
  key: string;
  label: string;
  lat: number;
  lon: number;
  tier: "worksheet" | "abbreviated";
  sizeDu: number;
};

const cases: Case[] = [
  { key: "miami-worksheet", label: "Miami-Dade Level 1 (worksheet)", lat: 25.7617, lon: -80.1918, tier: "worksheet", sizeDu: 30 },
  { key: "miami-abbreviated", label: "Miami-Dade Level 2 (abbreviated)", lat: 25.7617, lon: -80.1918, tier: "abbreviated", sizeDu: 200 },
];

function buildReport(c: Case) {
  // ITE 221 (Multifamily Housing, Mid-Rise) rough trip rates: ~5.4
  // daily / DU, AM 0.33, PM 0.39 (≈ 60/40 in/out split).
  const dailyTrips = Math.round(c.sizeDu * 5.4);
  const amPeak = Math.round(c.sizeDu * 0.33);
  const pmPeak = Math.round(c.sizeDu * 0.39);
  const pmIn = Math.round(pmPeak * 0.6);
  const pmOut = pmPeak - pmIn;
  const small = c.tier === "worksheet";
  return {
    generatedAt: "2026-06-12T12:00:00.000Z",
    request: {
      projectName: `Miami ${c.tier} smoke`,
      address: "Downtown Miami, FL",
      latitude: c.lat,
      longitude: c.lon,
      landUseCode: "221",
      size: c.sizeDu,
      openingYear: 2028,
      studyRadiusMi: 0.5,
      studyTier: c.tier,
    },
    studyRadiusMi: 0.5,
    tripGeneration: {
      landUseCode: "221",
      landUseName: "Multifamily Housing (Mid-Rise)",
      size: c.sizeDu,
      unit: "DU",
      dailyTrips,
      amPeakTrips: amPeak,
      pmPeakTrips: pmPeak,
      pmIn,
      pmOut,
    },
    affectedIntersections: small
      ? []
      : [
          { signalId: "S001", name: "Biscayne Blvd & NE 5th St", distanceMi: 0.18, existingLos: "C", currentLos: "C", futureLos: "D", losChanged: true, existingDelaySec: 24, futureDelaySec: 39, queue95thFt: 180 },
          { signalId: "S002", name: "Biscayne Blvd & NE 8th St", distanceMi: 0.32, existingLos: "D", currentLos: "D", futureLos: "E", losChanged: true, existingDelaySec: 48, futureDelaySec: 68, queue95thFt: 290 },
        ],
    intersectionsStudied: small ? 0 : 2,
    intersectionsWithLosDrop: small ? 0 : 2,
    intersectionsAtLosEf: small ? 0 : 1,
    worstDelayDeltaSec: small ? 0 : 20,
    findings: [],
    methodology: [],
    periodReports: [],
    growthAppliedPct: 1.5,
    growthYears: 2,
    weather: "clear",
    weatherCapacityFactor: 1.0,
    passByPctApplied: small ? 0 : 10,
    internalCapturePctApplied: 0,
    citations: [],
  };
}

const fakeFirm = { name: "Acme Engineering, PE", logoUrl: null };

let pass = 0;
let fail = 0;
for (const c of cases) {
  const fakeReport = buildReport(c);
  const fakeProject = {
    id: `fl-${c.key}`,
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
    const out = `/tmp/tis-fl-${c.key}.pdf`;
    writeFileSync(out, buf);
    console.log(`✔ ${c.label} (${c.sizeDu} DU): ${buf.length} bytes → ${out}`);
    pass++;
  } catch (err) {
    console.error(`✘ ${c.label}: ${err instanceof Error ? err.message : err}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    fail++;
  }
}

console.log(`\n${pass} pass · ${fail} fail`);
if (fail > 0) process.exit(1);
