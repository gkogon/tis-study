/**
 * Smoke test — confirm the live PTAL lookup wires through to the
 * rendered London TIS PDF.
 *
 * Two-step:
 *   1. lookupLondonPtal(51.5550, -0.1144) hits the TfL FeatureServer
 *      and returns PTAL 6a + AI.
 *   2. Render a TisReport payload that carries `resolvedPtalBand` from
 *      that lookup. Verify the PDF text mentions "PTAL 6a", "5%",
 *      "WebCAT 3.0", and the AI value.
 *
 * Engine integration (generateTisReport calling the lookup) lives in
 * the engine code path and is exercised when the API server runs end
 * to end; this script covers the deterministic half without requiring
 * the analyzer microservice to be running.
 */
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { renderStudyPdf } from "../../artifacts/tis-api-server/src/lib/pdf-export";
import { lookupLondonPtal } from "../../artifacts/tis-api-server/src/lib/tfl-ptal";
import { getLondonAutoModeShare } from "../../artifacts/tis-api-server/src/lib/mode-share";

const lat = 51.5550;
const lon = -0.1144;

console.log("Looking up PTAL via TfL FeatureServer…");
const looked = await lookupLondonPtal(lat, lon);
if (!looked) {
  console.error("Lookup returned null — failing");
  process.exit(2);
}
console.log(`  → PTAL ${looked.band}, AI ${looked.ai.toFixed(2)}`);
const share = getLondonAutoModeShare(looked.band);
console.log(`  → auto-mode share at this band = ${share}`);

const fakeReport = {
  generatedAt: "2026-06-12T00:00:00.000Z",
  request: {
    projectName: "Holloway auto-PTAL reference",
    address: "Holloway Road, London N7",
    latitude: lat,
    longitude: lon,
    landUseCode: "221",
    size: 100,
    openingYear: 2027,
    studyRadiusMi: 0.5,
    // NB: ptalBand intentionally NOT supplied — surfaces engine resolution
  },
  studyRadiusMi: 0.5,
  tripGeneration: {
    landUseCode: "221",
    landUseName: "Multifamily Housing (Mid-Rise)",
    size: 100,
    unit: "dwelling units",
    dailyTrips: Math.round(454 * share),
    amPeakTrips: Math.round(30 * share),
    pmPeakTrips: Math.round(36 * share),
    pmIn: Math.round(36 * share * 0.61),
    pmOut: Math.round(36 * share * 0.39),
  },
  affectedIntersections: [],
  intersectionsStudied: 0,
  intersectionsWithLosDrop: 0,
  intersectionsAtLosEf: 0,
  worstDelayDeltaSec: 0,
  mitigationSummary: [],
  findings: [],
  methodology: [],
  periodReports: [],
  growthAppliedPct: 1.5,
  growthYears: 1,
  weather: "clear",
  weatherCapacityFactor: 1.0,
  passByPctApplied: 0,
  internalCapturePctApplied: 0,
  autoModeShareApplied: share,
  resolvedPtalBand: { band: looked.band, source: "tfl-webcat-2023" as const, ai: looked.ai },
  junctionImpactSignificant: false,
};

const fakeProject = {
  id: "test-london-auto-001",
  studyType: "tis",
  projectName: fakeReport.request.projectName,
  landUseCode: fakeReport.request.landUseCode,
  siteLat: String(lat),
  siteLon: String(lon),
  version: 1,
  createdAt: new Date(),
  requestPayload: fakeReport.request,
  resultPayload: fakeReport,
};
const fakeFirm = { name: "Acme UK Ltd", logoUrl: null };

const buf = await renderStudyPdf(fakeProject as any, fakeFirm as any);
const out = "/tmp/tis-london-auto-ptal.pdf";
writeFileSync(out, buf);
console.log(`✔ wrote ${buf.length} bytes → ${out}`);

const text = spawnSync("pdftotext", [out, "-"], { encoding: "utf8" });
if (text.status !== 0) {
  console.error("pdftotext failed — install poppler to verify");
  process.exit(2);
}
const aiTwoDp = looked.ai.toFixed(2);
const checks: Array<[string, RegExp]> = [
  [`PTAL ${looked.band} appears`,    new RegExp(`PTAL ${looked.band}`)],
  [`${Math.round(share * 100)}% applied`, new RegExp(`${Math.round(share * 100)}%`)],
  ["Accessibility Index label",      /Accessibility Index/],
  [`AI value ${aiTwoDp}`,            new RegExp(aiTwoDp.replace(".", "\\."))],
  ["WebCAT 3.0 attribution",         /WebCAT 3\.0/],
  ["TfL GIS Open Data attribution",  /gis-tfl\.opendata\.arcgis\.com/i],
  ["Engine-resolved phrasing",       /Engine-resolved/i],
  // UK-convention furniture (London-gated): the document is a Transport
  // Assessment, not a "Traffic Impact Study", and the executive-summary
  // headline metrics use UK capacity convention (DoS / over-capacity),
  // not HCM Level-of-Service cards. The metric-card labels are drawn with
  // PDFKit characterSpacing, so pdftotext can serialise them with extra
  // inter-glyph spaces ("O V E R C A PA C I T Y"); match against a
  // whitespace-stripped copy of the text so the assertion is robust.
  ["UK document label 'Transport Assessment'", /Transport Assessment/],
];
// Card labels checked against a despaced copy (see note above).
const cardChecks: Array<[string, string]> = [
  ["UK exec-summary card 'Junctions assessed'", "JUNCTIONSASSESSED"],
  ["UK exec-summary card 'Over capacity'",      "OVERCAPACITY"],
  ["UK exec-summary card 'Worst DoS'",          "WORSTDOS"],
];
const despaced = text.stdout.replace(/\s+/g, "").toUpperCase();
// Negative checks — these US-convention strings must NOT appear in the
// London output (the §1.2 methodology disclosure deliberately explains
// the HCM/ITE/LOS mismatch, so we scope the ban to the running-header
// document title and the executive-summary metric-card labels only).
// The document-title ban is on the raw text (the header/H1 are not
// character-spaced); the metric-card bans are on the despaced copy so a
// character-spaced "L O S D R O P S" would still be caught.
const negChecks: Array<[string, boolean]> = [
  ["No 'Traffic Impact Study' document title", /Traffic Impact Study/i.test(text.stdout)],
  ["No 'LOS DROPS' metric card",               despaced.includes("LOSDROPS")],
  ["No 'AT LOS E/F' metric card",              despaced.includes("ATLOSE/F")],
];
let fail = false;
for (const [name, re] of checks) {
  const ok = re.test(text.stdout);
  console.log(`${ok ? "✔" : "✘"} ${name}`);
  if (!ok) fail = true;
}
for (const [name, needle] of cardChecks) {
  const ok = despaced.includes(needle);
  console.log(`${ok ? "✔" : "✘"} ${name}`);
  if (!ok) fail = true;
}
for (const [name, present] of negChecks) {
  console.log(`${present ? "✘" : "✔"} ${name}`);
  if (present) fail = true;
}
process.exit(fail ? 1 : 0);
