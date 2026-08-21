// E2E check: an imported UTDF file's MEASURED data actually enters the
// capacity math — and every path is presence-gated so studies without UTDF
// data are untouched.
//
// CONTRACTS, in order of importance:
//
//  1. GATE OFF ⇒ UNTOUCHED. A request without `utdfIntersections` produces
//     rows with none of the new fields (volumeSource / existingStorageFt /
//     storageMovement / utdfCycleLenSec) and is deterministic. (The
//     cross-branch byte-identity proof against origin/main is run separately
//     at PR time; this in-branch check guards the field gating forever.)
//
//  2. PARSE ENDPOINT EMITS THE RECORDS. POST /utdf/parse (real router,
//     stubbed auth) returns ready-to-attach `utdfIntersections` — volumes,
//     weighted PHF/HV%, per-movement storage, cycle length, 4dp coords — and
//     the records survive the ParseUtdfFileResponse zod schema (strip trap).
//
//  3. GATE ON ⇒ MEASURED DATA REACHES THE MATH.
//       - matched signal: measured TMC total replaces the AADT-derived
//         design-hour volume (Σ approach currentVolumeVph ≈ measured total),
//         measured approach shares replace the deterministic jitter, growth
//         still applies ON TOP (grown/current ratio identical to the AADT
//         row's), PM is the anchor and the AM period scales by 0.90,
//         imported cycle length shifts Webster d1 (delay moves when the
//         cycle is removed), governing turn bay (shortest, lefts preferred)
//         lands as existingStorageFt/storageMovement.
//       - matching is nearest-wins per signal: two UTDF nodes snapping to
//         one signal keep the NEARER record, never a sum; far-away and
//         zero-volume records attach nowhere.
//       - unmatched signal: byte-for-byte the AADT-derived legacy row.
//
//  4. STRIP TRAP. The new fields survive GenerateTisResponse.parse and the
//     request field survives GenerateTisBody.parse — the exact boundary that
//     silently dropped fields in the shipped LOS-F-with-0-delay bug.
//
//  5. PDF. On a UTDF study the FL renderer prints the per-intersection
//     provenance labels (measured vs AADT-derived), the measured-hour
//     multi-period caption, and the §9.2 storage-bay table ACTIVATES
//     (no more fallback note). The generic states renderer's §9.4 table
//     activates the same way (Seattle/WA study).
//
// Harness mirrors verify-driveway-routing.mjs (esbuild-bundle tis.ts +
// pdf-export.ts, mock global fetch for signals/roads) and
// verify-utdf-vigorous.mjs (real Express router with stubbed auth).
//
// Run: node ./scripts/verify-utdf-engine.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
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
const { GenerateTisBody, GenerateTisResponse, ParseUtdfFileResponse } = zodApi;

// ---------------------------------------------------------------------------
// Geometry — Miami site (FL renderer) with three synthetic signals.
// ---------------------------------------------------------------------------
const SITE = { lat: 25.8456, lon: -80.2103 };
const SIG_A = { id: "sig-A", name: "Measured Ave & Main St", zone: "MIA", latitude: 25.8456, longitude: -80.2023, totalVolume: 12000 };
const SIG_B = { id: "sig-B", name: "Nearest-Wins Blvd", zone: "MIA", latitude: 25.8456, longitude: -80.2183, totalVolume: 10000 };
const SIG_C = { id: "sig-C", name: "Untouched Rd", zone: "MIA", latitude: 25.8536, longitude: -80.2103, totalVolume: 8000 };
const MOCK_INTS = [SIG_A, SIG_B, SIG_C];
const MOCK_ROADS = {
  available: true,
  segments: [
    [3, 25.8456, -80.2300, 25.8456, -80.1900, null, null], // E-W through site
    [3, 25.8300, -80.2103, 25.8700, -80.2103, null, null], // N-S through site
  ],
};

// ---------------------------------------------------------------------------
// Foreign-style UTDF fixture (Synchro matrix layout, BOM + CRLF) — the same
// shape as the PR #113 foreign fixture, extended with LATITUDE/LONGITUDE
// node columns and a [Timings] section so the measured records carry
// coordinates and a cycle length.
//
//  INTID 5  @ sig-A exactly — full record: volumes (total 1695), PHF, HV%,
//            storage (lefts NBL 150 / SBL 175 / EBL 80 / WBL 90, NBR 100 —
//            governing = shortest LEFT = EBL 80), cycle 120 s.
//  INTID 7  @ 33 m north of sig-B — volumes total 2000. Listed FIRST so it
//            attaches, then is DISPLACED by the nearer INTID 6 (replace
//            branch of nearest-wins, never summed).
//  INTID 6  @ sig-B exactly — volumes total 1000 (shares .4/.3/.2/.1).
//  INTID 8  @ ~5 mi away — volumes, but matches nothing (unmatched log).
//  INTID 9  @ sig-C exactly — all-zero volumes ⇒ no record emitted at all;
//            sig-C stays a pure AADT-derived control row.
// ---------------------------------------------------------------------------
function utdfFixture() {
  return [
    "﻿[Network]",
    "RECORDNAME,DATA",
    "Metric,0",
    "",
    "[Nodes]",
    "INTID,TYPE,X,Y,LATITUDE,LONGITUDE",
    `7,0,1000,3500,25.8459,${SIG_B.longitude}`,
    `5,0,1200,3400,${SIG_A.latitude},${SIG_A.longitude}`,
    `6,0,1000,3400,${SIG_B.latitude},${SIG_B.longitude}`,
    "8,0,9000,9000,25.9200,-80.2103",
    `9,0,1100,3600,${SIG_C.latitude},${SIG_C.longitude}`,
    "",
    "[Volumes]",
    "RECORDNAME,INTID,NBL,NBT,NBR,SBL,SBT,SBR,EBL,EBT,EBR,WBL,WBT,WBR",
    "Volume,7,0,500,0,0,500,0,0,500,0,0,500,0",
    "Volume,5,45,505,50,60,610,35,25,150,20,30,140,25",
    "PHF,5,0.92,0.92,0.92,0.95,0.95,0.95,0.90,0.90,0.90,0.88,0.88,0.88",
    "HeavyVehicles,5,2,3,2,2,3,2,5,5,5,4,4,4",
    "Volume,6,0,400,0,0,300,0,0,200,0,0,100,0",
    "Volume,8,0,999,0,0,0,0,0,0,0,0,0,0",
    "Volume,9,0,0,0,0,0,0,0,0,0,0,0,0",
    "",
    "[Lanes]",
    "RECORDNAME,INTID,NBL,NBT,NBR,SBL,SBT,SBR,EBL,EBT,EBR,WBL,WBT,WBR",
    "Lanes,5,1,2,1,1,2,1,1,1,0,1,1,0",
    "Storage,5,150,0,100,175,0,0,80,0,0,90,0,0",
    "",
    "[Timings]",
    "INTID,Phase,MinInitial,MaxInitial,Yellow,AllRed,CycleLength,Offset,Coordinated",
    "5,2,5,48,3.5,1,120,0,No",
    "5,4,5,32,3.5,1,120,0,No",
    "",
  ].join("\r\n");
}
// Measured totals the fixture implies.
const A_TOTAL = 45 + 505 + 50 + 60 + 610 + 35 + 25 + 150 + 20 + 30 + 140 + 25; // 1695
const A_SHARES = { NB: 600 / A_TOTAL, SB: 705 / A_TOTAL, EB: 195 / A_TOTAL, WB: 195 / A_TOTAL };
const B_TOTAL = 1000;

// ---------------------------------------------------------------------------
// Bundle the engine + PDF renderer + real router (driveway-harness pattern).
// Mock fetch BEFORE the bundle import so module caches seed from the mock.
// ---------------------------------------------------------------------------
const SERVER = path.resolve(here, "..");
const { build: esbuild } = await import(path.resolve(SERVER, "node_modules/esbuild/lib/main.js"));
const bundlePath = path.resolve(SERVER, "src/lib/.utdf-engine-bundle.mjs");
const entryPath = path.resolve(SERVER, "src/lib/.utdf-engine-entry.ts");
await writeFile(entryPath, [
  `export { generateTisReport } from ${JSON.stringify(path.resolve(SERVER, "src/lib/tis.ts"))};`,
  `export { renderStudyPdf } from ${JSON.stringify(path.resolve(SERVER, "src/lib/pdf-export.ts"))};`,
  `export { default as tisRouter } from ${JSON.stringify(path.resolve(SERVER, "src/routes/tis.ts"))};`,
].join("\n"), "utf8");
await esbuild({
  entryPoints: [entryPath], platform: "node", bundle: true, format: "esm",
  outfile: bundlePath, logLevel: "silent",
  external: ["*.node", "express", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino",
             "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis"],
  banner: { js: "import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);" },
});

// Keep the mock installed for the WHOLE script: the FL renderer's live FDOT
// enrichment and the cover street-view fetch must both fall back (404) so
// the PDF is deterministic and offline. The REAL fetch is kept for this
// script's own localhost call to the mounted router (the mock would 404 it).
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

const baseReq = {
  projectName: "UTDF Engine E2E", address: "Miami, FL",
  latitude: SITE.lat, longitude: SITE.lon,
  landUseCode: "820", size: 60,
  openingYear: 2027, studyRadiusMi: 1.0,
  analysisPeriods: ["am_peak", "pm_peak"],
};
const stripTime = (r) => { const c = JSON.parse(JSON.stringify(r)); delete c.generatedAt; return c; };
const NEW_FIELDS = ["volumeSource", "existingStorageFt", "storageMovement", "utdfCycleLenSec"];
const sumBy = (rows, f) => rows.reduce((s, a) => s + (a[f] ?? 0), 0);

// ---------------------------------------------------------------------------
// 1. Gate off ⇒ untouched rows, deterministic.
// ---------------------------------------------------------------------------
await generateTisReport({ ...baseReq }); // warm-up: seed module caches
const legacy = await generateTisReport({ ...baseReq });
const legacy2 = await generateTisReport({ ...baseReq });
ok(JSON.stringify(stripTime(legacy)) === JSON.stringify(stripTime(legacy2)),
  "gate off: deterministic across repeated runs");
const legacyRows = legacy.affectedIntersections ?? [];
ok(legacyRows.length === 3, `gate off: all three signals analyzed (${legacyRows.length})`);
ok(legacyRows.every((ix) => NEW_FIELDS.every((f) => !(f in ix))),
  "gate off: no UTDF field on any intersection row");
ok((legacy.periodReports ?? []).every((p) =>
  (p.affectedIntersections ?? []).every((ix) => NEW_FIELDS.every((f) => !(f in ix)))),
  "gate off: no UTDF field in any period report row");

// ---------------------------------------------------------------------------
// 2. Parse endpoint emits ready-to-attach records (real router, stubbed auth).
// ---------------------------------------------------------------------------
const express = (await import(path.resolve(SERVER, "node_modules/express/index.js"))).default;
const app = express();
app.use(express.json({ limit: "3mb" }));
app.use((req, _res, next) => { req.isAuthenticated = () => true; next(); });
app.use("/tis-api", tisRouter);
const parseResp = await new Promise((resolve) => {
  const server = app.listen(0, async () => {
    const port = server.address().port;
    const r = await realFetch(`http://127.0.0.1:${port}/tis-api/utdf/parse`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: utdfFixture() }),
    });
    const json = await r.json().catch(() => null);
    server.close();
    resolve({ status: r.status, json });
  });
});
ok(parseResp.status === 200, `parse endpoint: 200 (${parseResp.status})`);
const records = parseResp.json?.utdfIntersections ?? [];
ok(records.length === 4, `parse endpoint: 4 measured records emitted — zero-volume node dropped (${records.length})`);
ok(!records.some((r) => r.intId === 9), "parse endpoint: all-zero-volume node 9 emits NO record");
const rec5 = records.find((r) => r.intId === 5);
ok(rec5 !== undefined, "parse endpoint: node 5 record present");
ok(rec5?.latitude === SIG_A.latitude && rec5?.longitude === SIG_A.longitude,
  `parse endpoint: 4dp coordinates (${rec5?.latitude}, ${rec5?.longitude})`);
ok(rec5?.volumes?.NBT === 505 && rec5?.volumes?.SBT === 610,
  "parse endpoint: per-movement volumes carried");
ok(typeof rec5?.phf === "number" && rec5.phf > 0.88 && rec5.phf < 0.96,
  `parse endpoint: volume-weighted PHF carried (${rec5?.phf})`);
ok(typeof rec5?.hvPct === "number" && rec5.hvPct > 0 && rec5.hvPct < 10,
  `parse endpoint: volume-weighted HV% carried (${rec5?.hvPct})`);
ok(rec5?.storageFt?.NBL === 150 && rec5?.storageFt?.EBL === 80 && rec5?.storageFt?.NBR === 100,
  "parse endpoint: per-movement storage carried");
ok(rec5?.cycleLenSec === 120, `parse endpoint: cycle length carried (${rec5?.cycleLenSec})`);
// Strip trap on the parse result schema.
const parsedResult = ParseUtdfFileResponse.safeParse(parseResp.json);
ok(parsedResult.success === true, "strip trap: parse response passes ParseUtdfFileResponse");
ok((parsedResult.data?.utdfIntersections ?? []).length === 4,
  "strip trap: utdfIntersections SURVIVE ParseUtdfFileResponse.parse");

// ---------------------------------------------------------------------------
// 3. Gate on ⇒ measured data reaches the math.
// ---------------------------------------------------------------------------
const utdfReq = { ...baseReq, utdfIntersections: records };
// Request-side strip trap first: the body schema must carry the field.
const bodyParse = GenerateTisBody.safeParse(utdfReq);
ok(bodyParse.success === true, `strip trap: UTDF request passes GenerateTisBody (${bodyParse.error?.issues?.[0]?.message ?? "ok"})`);
ok((bodyParse.data?.utdfIntersections ?? []).length === 4,
  "strip trap: utdfIntersections SURVIVE GenerateTisBody.parse");

const report = await generateTisReport(utdfReq);
const report2 = await generateTisReport(utdfReq);
ok(JSON.stringify(stripTime(report)) === JSON.stringify(stripTime(report2)),
  "gate on: deterministic across repeated runs");

const rows = report.affectedIntersections ?? [];
const rowA = rows.find((ix) => ix.signalId === "sig-A");
const rowB = rows.find((ix) => ix.signalId === "sig-B");
const rowC = rows.find((ix) => ix.signalId === "sig-C");
ok(rowA && rowB && rowC, "gate on: all three signals analyzed");

// sig-A: full measured record.
ok(rowA?.volumeSource === "utdf_tmc", `sig-A: volumeSource=utdf_tmc (${rowA?.volumeSource})`);
ok(rowA?.utdfCycleLenSec === 120, `sig-A: imported cycle length on the row (${rowA?.utdfCycleLenSec})`);
ok(rowA?.existingStorageFt === 80 && rowA?.storageMovement === "EBL",
  `sig-A: governing turn bay = shortest LEFT (${rowA?.storageMovement} ${rowA?.existingStorageFt} ft; NBR 100 not picked)`);
const aCurrent = sumBy(rowA?.approaches ?? [], "currentVolumeVph");
ok(Math.abs(aCurrent - A_TOTAL) < 2.5,
  `sig-A: measured TMC total replaces the AADT design-hour volume (Σ current ${aCurrent.toFixed(1)} ≈ ${A_TOTAL}, AADT would be ${SIG_A.totalVolume})`);
for (const a of rowA?.approaches ?? []) {
  const got = a.currentVolumeVph / aCurrent;
  ok(Math.abs(got - A_SHARES[a.direction]) < 0.005,
    `sig-A ${a.direction}: measured approach share replaces the jitter split (${got.toFixed(3)} ≈ ${A_SHARES[a.direction].toFixed(3)})`);
}
// Growth still applies ON TOP of measured: grown/current ratio identical to
// the pure-AADT control row's ratio.
const ratioA = sumBy(rowA?.approaches ?? [], "existingVolumeVph") / aCurrent;
const cCurrent = sumBy(rowC?.approaches ?? [], "currentVolumeVph");
const ratioC = sumBy(rowC?.approaches ?? [], "existingVolumeVph") / cCurrent;
ok(ratioA > 1.0 && Math.abs(ratioA - ratioC) < 0.01,
  `sig-A: growth multiplies the measured base exactly as it does the AADT base (${ratioA.toFixed(4)} vs ${ratioC.toFixed(4)})`);

// PM anchor + AM scaling at 0.90.
const pmRep = (report.periodReports ?? []).find((p) => p.period === "pm_peak");
const amRep = (report.periodReports ?? []).find((p) => p.period === "am_peak");
const pmA = (pmRep?.affectedIntersections ?? []).find((ix) => ix.signalId === "sig-A");
const amA = (amRep?.affectedIntersections ?? []).find((ix) => ix.signalId === "sig-A");
const pmSum = sumBy(pmA?.approaches ?? [], "currentVolumeVph");
const amSum = sumBy(amA?.approaches ?? [], "currentVolumeVph");
ok(Math.abs(pmSum - A_TOTAL) < 2.5, `PM anchor: measured hour carried at 100% (${pmSum.toFixed(1)})`);
ok(Math.abs(amSum - A_TOTAL * 0.9) < 2.5, `AM scales from the measured hour at 0.90 (${amSum.toFixed(1)} ≈ ${(A_TOTAL * 0.9).toFixed(1)})`);
ok(pmA?.volumeSource === "utdf_tmc" && amA?.volumeSource === "utdf_tmc",
  "both period rows carry the utdf_tmc provenance");

// Cycle length actually shifts Webster d1: same records minus the cycle ⇒
// sig-A's delays move; the AADT control row does not.
const noCycleRecords = records.map((r) => (r.intId === 5 ? { ...r, cycleLenSec: undefined } : r));
const noCycle = await generateTisReport({ ...baseReq, utdfIntersections: noCycleRecords });
const ncA = (noCycle.affectedIntersections ?? []).find((ix) => ix.signalId === "sig-A");
const ncC = (noCycle.affectedIntersections ?? []).find((ix) => ix.signalId === "sig-C");
ok(ncA?.utdfCycleLenSec === undefined, "cycle removed: no utdfCycleLenSec on the row");
ok(ncA !== undefined && rowA !== undefined && ncA.currentDelaySec !== rowA.currentDelaySec,
  `cycle length enters the delay math (120 s: ${rowA?.currentDelaySec}s vs default 90 s: ${ncA?.currentDelaySec}s)`);
ok(ncC !== undefined && rowC !== undefined && ncC.currentDelaySec === rowC.currentDelaySec,
  "cycle removal does not perturb the unmatched control row");

// sig-B: nearest record wins — INTID 6 (exact) beats INTID 7 (33 m, listed
// first), and the volumes are 6's alone, never a sum.
ok(rowB?.volumeSource === "utdf_tmc", `sig-B: matched (${rowB?.volumeSource})`);
const bCurrent = sumBy(rowB?.approaches ?? [], "currentVolumeVph");
ok(Math.abs(bCurrent - B_TOTAL) < 2.5,
  `sig-B: NEARER record's total (${bCurrent.toFixed(1)} ≈ ${B_TOTAL}; displaced record 2000, sum 3000 — neither)`);
ok(rowB?.existingStorageFt === undefined && rowB?.utdfCycleLenSec === undefined,
  "sig-B: no storage/cycle in its record ⇒ fields absent");

// sig-C: pure AADT control — byte-identical to the legacy row.
ok(NEW_FIELDS.every((f) => !(f in (rowC ?? {}))), "sig-C: no UTDF field");
const legacyC = legacyRows.find((ix) => ix.signalId === "sig-C");
ok(JSON.stringify(rowC) === JSON.stringify(legacyC),
  "sig-C: unmatched row is byte-identical to the gate-off run's row");

// Response-side strip trap: the new fields survive GenerateTisResponse.parse.
const respParse = GenerateTisResponse.safeParse(JSON.parse(JSON.stringify(report)));
ok(respParse.success === true,
  `strip trap: UTDF report passes GenerateTisResponse (${respParse.error?.issues?.[0] ? JSON.stringify(respParse.error.issues[0]) : "ok"})`);
const survA = (respParse.data?.affectedIntersections ?? []).find((ix) => ix.signalId === "sig-A");
ok(survA?.volumeSource === "utdf_tmc" && survA?.existingStorageFt === 80
  && survA?.storageMovement === "EBL" && survA?.utdfCycleLenSec === 120,
  "strip trap: volumeSource/existingStorageFt/storageMovement/utdfCycleLenSec SURVIVE GenerateTisResponse.parse");
ok((respParse.data?.request?.utdfIntersections ?? []).length === 4,
  "strip trap: request echo keeps utdfIntersections through the response schema");

// ---------------------------------------------------------------------------
// 4. PDF — FL renderer: provenance labels + §9.2 storage table activates.
// ---------------------------------------------------------------------------
const pdfText = async (project) => {
  const buf = await renderStudyPdf(project, { name: "Test Firm", logoUrl: null });
  ok(Buffer.isBuffer(buf) && buf.subarray(0, 5).toString() === "%PDF-",
    `PDF renders (${buf?.length ?? 0} bytes)`);
  try {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tis-utdf-pdf-"));
    const file = path.join(dir, "out.pdf");
    await writeFile(file, buf);
    const { stdout } = await execFileAsync("pdftotext", [file, "-"], { maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    if (e && e.code === "ENOENT") return null; // poppler missing → skip text asserts
    throw e;
  }
};
const mkProject = (req, result, name) => ({
  id: name, studyType: "tis", projectName: req.projectName, landUseCode: req.landUseCode,
  siteLat: String(req.latitude), siteLon: String(req.longitude),
  version: 1, createdAt: new Date("2026-01-01T00:00:00Z"),
  requestPayload: req, resultPayload: result,
});

const flText = await pdfText(mkProject(utdfReq, report, "utdf-fl-e2e"));
if (flText === null) {
  console.log("SKIP: pdftotext not installed — PDF text assertions skipped (bytes rendered OK)");
} else {
  ok(flText.includes("measured turning-movement counts (UTDF import"),
    "FL PDF: measured-TMC provenance label printed");
  ok(flText.includes("AADT-derived design-hour estimate (no measured turning-movement record"),
    "FL PDF: unmatched intersection labeled AADT-derived");
  ok(flText.includes("120 s cycle length"),
    "FL PDF: imported cycle length named in the provenance line");
  ok(flText.includes("measured turning-movement total (UTDF import"),
    "FL PDF: multi-period caption switches to the measured-hour variant");
  ok(!flText.includes("no intersection carries a field-measured existing storage length"),
    "FL PDF: §9.2 fallback note GONE");
  ok(flText.includes("Q95 Build"), "FL PDF: §9.2 storage-bay table ACTIVATED");
  ok(flText.includes("EBL"), "FL PDF: governing movement printed in the storage table");

  // Control: a non-UTDF FL study still prints the fallback note and no label.
  const legacyText = await pdfText(mkProject(baseReq, legacy, "legacy-fl-e2e"));
  if (legacyText !== null) {
    ok(!legacyText.includes("UTDF import"), "FL PDF control: no UTDF label on a non-UTDF study");
    ok(legacyText.includes("no intersection carries a field-measured existing storage length"),
      "FL PDF control: §9.2 fallback note still prints without measured storage");
  }
}

// ---------------------------------------------------------------------------
// 5. PDF — generic states renderer (§9.4): Seattle/WA study.
// ---------------------------------------------------------------------------
{
  const W_SITE = { lat: 47.6062, lon: -122.3321 };
  const W_SIG = { id: "sig-W1", name: "Pike St & 3rd Ave", zone: "SEA", latitude: 47.6062, longitude: -122.3241, totalVolume: 9000 };
  const W_INTS = [W_SIG, { id: "sig-W2", name: "Control & 4th", zone: "SEA", latitude: 47.6142, longitude: -122.3321, totalVolume: 7000 }];
  const W_ROADS = { available: true, segments: [[3, 47.6062, -122.35, 47.6062, -122.31, null, null]] };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/api/roads")) return new Response(JSON.stringify(W_ROADS), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.includes("/api/intersections") || u.includes("/api/atlanta/intersections")) {
      return new Response(JSON.stringify(W_INTS), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
  const wRecord = {
    intId: 11, name: "Pike St & 3rd Ave", latitude: W_SIG.latitude, longitude: W_SIG.longitude,
    volumes: { NBL: 80, NBT: 400, SBT: 350, EBT: 250, WBT: 150 },
    storageFt: { NBL: 120 },
    cycleLenSec: 100,
  };
  const wReq = {
    ...baseReq, projectName: "UTDF States E2E", address: "Seattle, WA",
    latitude: W_SITE.lat, longitude: W_SITE.lon, utdfIntersections: [wRecord],
  };
  const wReport = await generateTisReport(wReq);
  const wRow = (wReport.affectedIntersections ?? []).find((ix) => ix.signalId === "sig-W1");
  ok(wRow?.volumeSource === "utdf_tmc" && wRow?.existingStorageFt === 120 && wRow?.storageMovement === "NBL",
    `states run: measured record attached (${wRow?.storageMovement} ${wRow?.existingStorageFt} ft)`);
  const wText = await pdfText(mkProject(wReq, wReport, "utdf-states-e2e"));
  if (wText !== null) {
    ok(!wText.includes("No intersection carries a field-measured `existingStorageFt` value"),
      "states PDF: §9.4 fallback note GONE");
    ok(wText.includes("Q95 Build"), "states PDF: §9.4 storage-bay table ACTIVATED");
    ok(wText.includes("measured turning-movement counts (UTDF import"),
      "states PDF: shared appendix provenance label printed");
  }
}

await rm(bundlePath, { force: true });
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
