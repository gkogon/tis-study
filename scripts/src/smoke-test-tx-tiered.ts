/**
 * Smoke test for the Texas worksheet + abbreviated PDF renderers.
 * Loops over each TX-city centroid (and a TxDOT unincorporated point)
 * and renders both tiers, writing PDFs to /tmp.
 */
import { writeFileSync } from "node:fs";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";

type CityCase = { key: string; label: string; lat: number; lon: number };

// Centroids fall inside the txJurisdiction() bbox for each city.
const cities: CityCase[] = [
  { key: "houston", label: "Houston", lat: 29.76, lon: -95.37 },
  { key: "austin", label: "Austin", lat: 30.27, lon: -97.74 },
  { key: "dallas", label: "Dallas", lat: 32.78, lon: -96.80 },
  { key: "fortworth", label: "Fort Worth", lat: 32.75, lon: -97.33 },
  { key: "sanantonio", label: "San Antonio", lat: 29.50, lon: -98.50 },
  // Outside all 5 city bboxes but inside Texas — TxDOT-only.
  { key: "txdot", label: "TxDOT (rural)", lat: 31.50, lon: -100.50 },
];

const tiers = ["worksheet", "abbreviated"] as const;

function buildReport(c: CityCase, tier: typeof tiers[number]) {
  // Worksheet tier: small PHT/daily. Abbreviated tier: mid-band.
  const small = tier === "worksheet";
  const dailyTrips = small ? 600 : 2500;
  const amPeak = small ? 35 : 120;
  const pmIn = small ? 22 : 95;
  const pmOut = small ? 18 : 80;
  const pmPeak = pmIn + pmOut;
  return {
    generatedAt: "2026-06-12T12:00:00.000Z",
    request: {
      projectName: `${c.label} ${tier} smoke`,
      address: `Centroid, ${c.label}, TX`,
      latitude: c.lat,
      longitude: c.lon,
      landUseCode: "221",
      size: small ? 40 : 180,
      openingYear: 2028,
      studyRadiusMi: 0.5,
      studyTier: tier,
    },
    studyRadiusMi: 0.5,
    tripGeneration: {
      landUseCode: "221",
      landUseName: "Multifamily Housing (Mid-Rise)",
      size: small ? 40 : 180,
      unit: "dwelling units",
      dailyTrips,
      amPeakTrips: amPeak,
      pmPeakTrips: pmPeak,
      pmIn,
      pmOut,
    },
    affectedIntersections: small
      ? []
      : [
          { signalId: "S001", name: "Main St & 1st Ave", distanceMi: 0.18, existingLos: "C", currentLos: "C", futureLos: "D", losChanged: true, existingDelaySec: 24, futureDelaySec: 39, queue95thFt: 180 },
          { signalId: "S002", name: "Main St & 2nd Ave", distanceMi: 0.32, existingLos: "D", currentLos: "D", futureLos: "E", losChanged: true, existingDelaySec: 48, futureDelaySec: 68, queue95thFt: 290 },
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
for (const c of cities) {
  for (const tier of tiers) {
    const fakeReport = buildReport(c, tier);
    const fakeProject = {
      id: `tx-${c.key}-${tier}`,
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
      const out = `/tmp/tis-tx-${c.key}-${tier}.pdf`;
      writeFileSync(out, buf);
      console.log(`✔ ${c.label} ${tier}: ${buf.length} bytes → ${out}`);
      pass++;
    } catch (err) {
      console.error(`✘ ${c.label} ${tier}: ${err instanceof Error ? err.message : err}`);
      if (err instanceof Error && err.stack) console.error(err.stack);
      fail++;
    }
  }
}

console.log(`\n${pass} pass · ${fail} fail`);
if (fail > 0) process.exit(1);
