// E2E check: a Synchro REPORT PDF's measured data actually enters the
// capacity math — records that carry a NAME but NO coordinates — and every
// new path is presence-gated so legacy studies are untouched.
//
// CONTRACTS, in order of importance:
//
//  1. PARSE-PDF ENDPOINT EMITS NAME-ONLY RECORDS. POST /utdf/parse-pdf
//     (real router, stubbed auth, raw application/pdf body — the REAL
//     Caltran report fixture) returns records with `name`,
//     `source: "synchro_pdf"`, volumes and cycle length, NO lat/lon, and
//     they survive ParseSynchroPdfResponse zod (strip trap). Endpoint also
//     branches on magic bytes: UTDF TEXT posted to the pdf route parses as
//     UTDF text; a PDF posted as text to /utdf/parse is rejected with a
//     clear 400; oversize and non-PDF garbage produce 400s, never crashes.
//
//  2. NAME MATCHING AT GENERATE TIME. The record's report name
//     ("University Dr & Cleary Blvd") matches an OSM-style inventory name
//     ("University Drive & Cleary Boulevard") — measured total replaces the
//     AADT-derived volume, cycle feeds Webster, volumeSource is
//     "synchro_pdf_tmc" (NOT utdf_tmc), and the payload carries
//     utdfMatchSummary { matchedByName: 1 }. An unmatchable name and an
//     ambiguous (tie) name land in unmatchedNames — loudly, never silently.
//
//  3. GATING. No utdfIntersections ⇒ no summary, no volumeSource (legacy
//     byte-identity is proven separately vs origin/main at PR time).
//     A COORDINATE-only (UTDF text) request ⇒ summary ABSENT — the field
//     appears only when name matching was actually in play.
//
//  4. STRIP TRAPS. source/name-only records survive GenerateTisBody;
//     volumeSource: synchro_pdf_tmc and utdfMatchSummary survive
//     GenerateTisResponse — the exact boundary that shipped real bugs.
//
//  5. PDF. The rendered report prints the "measured TMC (Synchro report
//     import)" provenance line and the report-import multi-period caption
//     for the matched intersection.
//
// Harness mirrors verify-utdf-engine.mjs (esbuild bundle + mocked fetch +
// real Express router with stubbed auth).
//
// Run: node ./scripts/verify-synchro-pdf-engine.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { writeFile, rm, mkdtemp, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
process.env.DATABASE_URL ??= "postgres://localhost/tis_e2e_stub_db";
const execFileAsync = promisify(execFile);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

const zodApi = await import(path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts"));
const { GenerateTisBody, GenerateTisResponse, ParseSynchroPdfResponse } = zodApi;

// ---------------------------------------------------------------------------
// Geometry — Miami site (FL renderer). Inventory names are OSM-style
// SPELLED-OUT versions of the report fixture's abbreviated names, so the
// match must survive suffix + directional normalization end-to-end.
// TIE-A/TIE-B share one normalized name — the ambiguity case.
// ---------------------------------------------------------------------------
const SITE = { lat: 25.8456, lon: -80.2103 };
const SIG_MATCH = { id: "sig-match", name: "University Drive & Cleary Boulevard", zone: "MIA", latitude: 25.8456, longitude: -80.2023, totalVolume: 12000 };
const SIG_CONTROL = { id: "sig-control", name: "Untouched Road & Control Street", zone: "MIA", latitude: 25.8456, longitude: -80.2183, totalVolume: 10000 };
const SIG_TIE_A = { id: "sig-tie-a", name: "Twin Avenue & Ambiguous Street", zone: "MIA", latitude: 25.8536, longitude: -80.2103, totalVolume: 8000 };
const SIG_TIE_B = { id: "sig-tie-b", name: "Ambiguous St & Twin Ave", zone: "MIA", latitude: 25.8376, longitude: -80.2103, totalVolume: 8000 };
const MOCK_INTS = [SIG_MATCH, SIG_CONTROL, SIG_TIE_A, SIG_TIE_B];
const MOCK_ROADS = {
  available: true,
  segments: [
    [3, 25.8456, -80.2300, 25.8456, -80.1900, null, null],
    [3, 25.8300, -80.2103, 25.8700, -80.2103, null, null],
  ],
};

// ---------------------------------------------------------------------------
// Bundle engine + renderer + router (verify-utdf-engine harness pattern).
// ---------------------------------------------------------------------------
const SERVER = path.resolve(here, "..");
const { build: esbuild } = await import(path.resolve(SERVER, "node_modules/esbuild/lib/main.js"));
const bundlePath = path.resolve(SERVER, "src/lib/.synchro-pdf-engine-bundle.mjs");
const entryPath = path.resolve(SERVER, "src/lib/.synchro-pdf-engine-entry.ts");
await writeFile(entryPath, [
  `export { generateTisReport } from ${JSON.stringify(path.resolve(SERVER, "src/lib/tis.ts"))};`,
  `export { renderStudyPdf } from ${JSON.stringify(path.resolve(SERVER, "src/lib/pdf-export.ts"))};`,
  `export { default as tisRouter } from ${JSON.stringify(path.resolve(SERVER, "src/routes/tis.ts"))};`,
].join("\n"), "utf8");
await esbuild({
  entryPoints: [entryPath], platform: "node", bundle: true, format: "esm",
  outfile: bundlePath, logLevel: "silent",
  external: ["*.node", "express", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino",
             "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis",
             "pdfjs-dist", "pdfjs-dist/legacy/build/pdf.mjs"],
  banner: { js: "import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);" },
});

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/api/roads")) {
    return new Response(JSON.stringify(MOCK_ROADS), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (u.includes("/api/intersections") || u.includes("/api/atlanta/intersections")) {
    return new Response(JSON.stringify(MOCK_INTS), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("not found", { status: 404 });
};

const { generateTisReport, renderStudyPdf, tisRouter } = await import(bundlePath);
await rm(entryPath, { force: true });

const FIXTURE = await readFile(path.resolve(here, "fixtures/synchro-report-hca-4pages.pdf"));

// ---------------------------------------------------------------------------
// 1. parse-pdf endpoint: real router, raw body, real Caltran fixture.
// ---------------------------------------------------------------------------
const express = (await import(path.resolve(SERVER, "node_modules/express/index.js"))).default;
const app = express();
app.use(express.json({ limit: "3mb" }));
app.use((req, _res, next) => { req.isAuthenticated = () => true; next(); });
app.use("/tis-api", tisRouter);
const withServer = (fn) => new Promise((resolve) => {
  const server = app.listen(0, async () => {
    const out = await fn(`http://127.0.0.1:${server.address().port}`);
    server.close();
    resolve(out);
  });
});

const parseResp = await withServer(async (base) => {
  const r = await realFetch(`${base}/tis-api/utdf/parse-pdf`, {
    method: "POST", headers: { "Content-Type": "application/pdf" }, body: FIXTURE,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
});
ok(parseResp.status === 200, `parse-pdf: 200 (${parseResp.status})`);
ok(parseResp.json?.sourceFormat === "synchro_pdf", `parse-pdf: sourceFormat synchro_pdf (${parseResp.json?.sourceFormat})`);
ok(parseResp.json?.scenarioUsed === "Scenario 1 - PM", `parse-pdf: scenarioUsed disclosed (${parseResp.json?.scenarioUsed})`);
ok((parseResp.json?.scenariosSkipped ?? []).includes("Scenario 1 - AM"), "parse-pdf: scenariosSkipped disclosed");
const pdfRecords = parseResp.json?.utdfIntersections ?? [];
ok(pdfRecords.length === 1, `parse-pdf: 1 measured record (diagonal-leg intersection excluded) (${pdfRecords.length})`);
const rec = pdfRecords[0];
ok(rec?.name === "University Dr & Cleary Blvd", `parse-pdf: record carries the report name ("${rec?.name}")`);
ok(rec?.source === "synchro_pdf", `parse-pdf: source discriminator present (${rec?.source})`);
ok(rec?.latitude === undefined && rec?.longitude === undefined, "parse-pdf: NO coordinates on a report record");
ok(rec?.volumes?.NBT === 1832 && rec?.volumes?.SBT === 1619, "parse-pdf: measured volumes carried");
ok(rec?.cycleLenSec === 160, `parse-pdf: cycle length carried (${rec?.cycleLenSec})`);
ok((parseResp.json?.warnings ?? []).some((w) => /not mappable to a 4-leg model/.test(w)),
  "parse-pdf: diagonal-leg warning surfaced to the client");
// Strip trap on the parse-pdf response schema.
const parsedResult = ParseSynchroPdfResponse.safeParse(parseResp.json);
ok(parsedResult.success === true, "strip trap: response passes ParseSynchroPdfResponse");
ok(parsedResult.data?.utdfIntersections?.[0]?.source === "synchro_pdf"
  && parsedResult.data?.utdfIntersections?.[0]?.name === "University Dr & Cleary Blvd"
  && parsedResult.data?.sourceFormat === "synchro_pdf"
  && parsedResult.data?.scenarioUsed === "Scenario 1 - PM",
  "strip trap: source/name/sourceFormat/scenarioUsed SURVIVE ParseSynchroPdfResponse.parse");

// Magic-byte branching + caps.
const misc = await withServer(async (base) => {
  const utdfText = "[Nodes]\nINTID,Name,LATITUDE,LONGITUDE\n5,Text Node,25.8456,-80.2023\n[Volumes]\nINTID,NBL,NBT\n5,10,500\n";
  const textToPdfRoute = await realFetch(`${base}/tis-api/utdf/parse-pdf`, {
    method: "POST", headers: { "Content-Type": "application/pdf" }, body: utdfText,
  });
  const pdfToTextRoute = await realFetch(`${base}/tis-api/utdf/parse`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "%PDF-1.7 garbage that was read as text" }),
  });
  const garbage = await realFetch(`${base}/tis-api/utdf/parse-pdf`, {
    method: "POST", headers: { "Content-Type": "application/pdf" },
    body: Buffer.from("%PDF-1.7\nnot really a pdf"),
  });
  return {
    textToPdfRoute: { status: textToPdfRoute.status, json: await textToPdfRoute.json().catch(() => null) },
    pdfToTextRoute: { status: pdfToTextRoute.status, json: await pdfToTextRoute.json().catch(() => null) },
    garbage: { status: garbage.status, json: await garbage.json().catch(() => null) },
  };
});
ok(misc.textToPdfRoute.status === 200 && misc.textToPdfRoute.json?.sourceFormat === "utdf_text"
  && (misc.textToPdfRoute.json?.utdfIntersections ?? []).length === 1,
  "magic bytes: UTDF text posted to parse-pdf parses as UTDF text (coordinates intact)");
ok(misc.pdfToTextRoute.status === 400 && /PDF/.test(misc.pdfToTextRoute.json?.error ?? ""),
  `magic bytes: PDF-as-text on /utdf/parse rejected with a clear 400 (${misc.pdfToTextRoute.json?.error})`);
ok(misc.garbage.status === 200 && (misc.garbage.json?.warnings ?? []).some((w) => /could not read the PDF|no Synchro report blocks/.test(w)),
  "corrupt PDF bytes: parse answers with a named warning, never a crash");

// ---------------------------------------------------------------------------
// 2. Name matching at generate time (+ tie and no-match land in the summary).
// ---------------------------------------------------------------------------
const baseReq = {
  projectName: "Synchro PDF E2E", address: "Miami, FL",
  latitude: SITE.lat, longitude: SITE.lon,
  landUseCode: "820", size: 60,
  openingYear: 2027, studyRadiusMi: 1.0,
  analysisPeriods: ["am_peak", "pm_peak"],
};
const noMatchRec = { name: "Nowhere Blvd & Missing Ln", source: "synchro_pdf", volumes: { NBT: 500, SBT: 500 } };
const tieRec = { name: "Twin Ave & Ambiguous St", source: "synchro_pdf", volumes: { NBT: 300, SBT: 300 } };
const pdfReq = { ...baseReq, utdfIntersections: [...pdfRecords, noMatchRec, tieRec] };

// Request-side strip trap: name-only records pass the body schema.
const bodyParse = GenerateTisBody.safeParse(pdfReq);
ok(bodyParse.success === true, `strip trap: name-only records pass GenerateTisBody (${bodyParse.error?.issues?.[0]?.message ?? "ok"})`);
ok(bodyParse.data?.utdfIntersections?.[0]?.source === "synchro_pdf"
  && bodyParse.data?.utdfIntersections?.[0]?.latitude === undefined,
  "strip trap: source survives GenerateTisBody.parse; no coordinates fabricated");

await generateTisReport({ ...baseReq }); // warm-up: seed module caches
const report = await generateTisReport(pdfReq);
const rows = report.affectedIntersections ?? [];
const rowMatch = rows.find((ix) => ix.signalId === SIG_MATCH.id);
const rowControl = rows.find((ix) => ix.signalId === SIG_CONTROL.id);
ok(rowMatch !== undefined && rowControl !== undefined, "generate: matched + control rows present");
ok(rowMatch?.volumeSource === "synchro_pdf_tmc",
  `generate: matched row provenance is synchro_pdf_tmc (${rowMatch?.volumeSource})`);
ok(rowControl?.volumeSource === undefined, "generate: control row carries NO provenance field");
ok(rows.find((ix) => ix.signalId === SIG_TIE_A.id)?.volumeSource === undefined
  && rows.find((ix) => ix.signalId === SIG_TIE_B.id)?.volumeSource === undefined,
  "generate: tie candidates BOTH stay unmeasured (ambiguity never guesses)");
// Measured total replaces the AADT-derived design-hour volume.
const MEASURED_TOTAL = 312 + 17 + 272 + 7 + 9 + 323 + 1832 + 23 + 17 + 1619 + 446; // 4877
const approachSum = (rowMatch?.approaches ?? []).reduce((s, a) => s + (Number(a.currentVolumeVph) || 0), 0);
ok(Math.abs(approachSum - MEASURED_TOTAL) <= MEASURED_TOTAL * 0.02,
  `generate: Σ approach existing volumes ≈ measured total (${approachSum} vs ${MEASURED_TOTAL})`);
ok(rowMatch?.utdfCycleLenSec === 160, `generate: imported cycle reaches the row (${rowMatch?.utdfCycleLenSec})`);
// The match summary tells the whole story.
const summary = report.utdfMatchSummary;
ok(summary !== undefined, "generate: utdfMatchSummary present when name matching in play");
ok(summary?.total === 3 && summary?.matched === 1 && summary?.matchedByName === 1 && summary?.matchedByCoordinates === 0,
  `generate: summary counts (${JSON.stringify(summary)})`);
ok((summary?.unmatchedNames ?? []).some((n) => n.includes("Nowhere Blvd"))
  && (summary?.unmatchedNames ?? []).some((n) => n.includes("Twin Ave")),
  "generate: no-match AND tie records land in unmatchedNames, never silently dropped");

// ---------------------------------------------------------------------------
// 3. Gating: legacy shapes stay clean.
// ---------------------------------------------------------------------------
const legacy = await generateTisReport({ ...baseReq });
ok(legacy.utdfMatchSummary === undefined, "gate off: no utdfMatchSummary without imported records");
ok((legacy.affectedIntersections ?? []).every((ix) => !("volumeSource" in ix)),
  "gate off: no volumeSource on any row");
// Coordinate-only records (UTDF text path) keep the summary OFF.
const coordReq = {
  ...baseReq,
  utdfIntersections: [{
    intId: 5, latitude: SIG_CONTROL.latitude, longitude: SIG_CONTROL.longitude,
    volumes: { NBT: 400, SBT: 300, EBT: 200, WBT: 100 },
  }],
};
const coordReport = await generateTisReport(coordReq);
const coordRow = (coordReport.affectedIntersections ?? []).find((ix) => ix.signalId === SIG_CONTROL.id);
ok(coordRow?.volumeSource === "utdf_tmc", `coordinate records still label utdf_tmc (${coordRow?.volumeSource})`);
ok(coordReport.utdfMatchSummary === undefined,
  "coordinate-only request: utdfMatchSummary ABSENT (legacy payload shape preserved)");

// ---------------------------------------------------------------------------
// 4. Response-side strip trap.
// ---------------------------------------------------------------------------
const respParse = GenerateTisResponse.safeParse(JSON.parse(JSON.stringify(report)));
ok(respParse.success === true,
  `strip trap: report passes GenerateTisResponse (${respParse.error?.issues?.[0] ? JSON.stringify(respParse.error.issues[0]) : "ok"})`);
const survMatch = (respParse.data?.affectedIntersections ?? []).find((ix) => ix.signalId === SIG_MATCH.id);
ok(survMatch?.volumeSource === "synchro_pdf_tmc",
  "strip trap: volumeSource synchro_pdf_tmc SURVIVES GenerateTisResponse.parse");
ok(respParse.data?.utdfMatchSummary?.matchedByName === 1
  && (respParse.data?.utdfMatchSummary?.unmatchedNames ?? []).length === 2,
  "strip trap: utdfMatchSummary SURVIVES GenerateTisResponse.parse");

// ---------------------------------------------------------------------------
// 5. Rendered PDF prints the Synchro-report provenance.
// ---------------------------------------------------------------------------
const buf = await renderStudyPdf({
  id: "synchro-pdf-e2e", studyType: "tis", projectName: pdfReq.projectName, landUseCode: pdfReq.landUseCode,
  siteLat: String(pdfReq.latitude), siteLon: String(pdfReq.longitude),
  version: 1, createdAt: new Date("2026-01-01T00:00:00Z"),
  requestPayload: pdfReq, resultPayload: report,
}, { name: "Test Firm", logoUrl: null });
ok(Buffer.isBuffer(buf) && buf.subarray(0, 5).toString() === "%PDF-", `PDF renders (${buf?.length ?? 0} bytes)`);
let pdfText = null;
try {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tis-synchro-pdf-"));
  const file = path.join(dir, "out.pdf");
  await writeFile(file, buf);
  pdfText = (await execFileAsync("pdftotext", [file, "-"], { maxBuffer: 20 * 1024 * 1024 })).stdout;
} catch (e) {
  if (!(e && e.code === "ENOENT")) throw e;
}
if (pdfText === null) {
  console.log("SKIP: pdftotext not installed — PDF text assertions skipped (bytes rendered OK)");
} else {
  ok(pdfText.includes("measured TMC (Synchro report import)"),
    "PDF: Synchro-report provenance label printed");
  ok(pdfText.includes("matched to this intersection by name"),
    "PDF: name-match disclosure printed");
  ok(pdfText.includes("measured turning-movement total (Synchro report import"),
    "PDF: multi-period caption uses the report-import variant");
  ok(pdfText.includes("160 s cycle length"),
    "PDF: imported cycle named in the provenance line");
  ok(!pdfText.includes("measured turning-movement counts (UTDF import"),
    "PDF: UTDF-text sentence NOT printed for a report-PDF study");
}

await rm(bundlePath, { force: true });
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
