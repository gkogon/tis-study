// End-to-end: the signal-timing resolver wired into generateTisReport.
//
//  1. DEFAULT ON. Every study intersection carries a `signalTiming` stamp;
//     capacity is re-derived from that timing (implied capacity = volume / v/c
//     ≈ 1,800 × g/C × weather); the methodology names the resolver.
//  2. FIXED ACROSS SCENARIOS. Tripling the project does not move any
//     intersection's timing — the model must not retime the signal to absorb
//     the project's own trips.
//  3. LEGACY REACHABLE. signalTiming: "screening" reproduces the pre-change
//     basis: no stamp, the flat methodology clause, every approach on the flat
//     810 vph × weather capacity. (Byte-identity with the pinned pre-flip
//     baseline is asserted by verify-conserved-assignment.mjs, whose legacy
//     run now carries signalTiming: "screening" alongside
//     conservedAssignment: false.)
//  4. MEASURED TIER. A Synchro record with a phase→movement map and splits
//     resolves to "measured" with the record's cycle; cycle-only resolves to
//     "measured-cycle".
//  5. STRIP TRAP. The stamp and the request flag survive the generated zod —
//     and so do the exact re-solve inputs the report prints for the browser
//     solver (designHourVolumeVph, loadWeight, the unrounded g/C ratios,
//     movementsExact / pathTurns, the OSM lane fields, utdfRecordIndex, the
//     period and report-level exact fields).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "..");
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const near = (a, b, tolPct) => Math.abs(a - b) <= Math.abs(b) * tolPct;

const { GenerateTisBody, GenerateTisResponse } = await import(path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts"));
const { SATURATION_FLOW_VPH } = await import(path.resolve(here, "../src/lib/signal-delay.ts"));

// Real pinned Miami network (the conserved-assignment fixture) so the routed
// path assignment behaves exactly as in that check; five mock signals sit on
// it. Same site, same radius, same construction as verify-conserved-assignment.
const segments = JSON.parse(await readFile(path.resolve(here, "fixtures/conserved-road-segments.json"), "utf8"));
const { buildGraph } = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
const { snapSignalsToJunctions } = await import(path.resolve(here, "../src/lib/cordon-gateways.ts"));
const SITE = { lat: 25.8456, lon: -80.2103 }, RADIUS = 0.5;
const g = buildGraph(segments);
const dist = (a, b, c, d) => { const R = 3958.8, p = Math.PI / 180; const s = Math.sin((c - a) * p / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin((d - b) * p / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
const probeSnaps = snapSignalsToJunctions(g, g.nodeLat.map((la, i) => ({ lat: la, lon: g.nodeLon[i] })), { maxMeters: 1 });
const junctionNodes = probeSnaps.flatMap((s, i) => (s.node === i ? [i] : []));
const ring = junctionNodes.filter((i) => { const d = dist(SITE.lat, SITE.lon, g.nodeLat[i], g.nodeLon[i]); return d > 0.08 && d < 0.4; });
const step = Math.max(1, Math.floor(ring.length / 4));
const onNet = [0, 1, 2, 3].map((k) => ring[k * step]).filter((v) => v !== undefined);
const MOCK_INTS = onNet.map((n, i) => ({
  id: `sig-${i + 1}`, name: `Junction ${i + 1}`, zone: "MIA", latitude: g.nodeLat[n], longitude: g.nodeLon[n], totalVolume: 2400 + i * 300,
  // sig-2 carries OSM lane geometry the way #195's analyzer emits it: three
  // through lanes per direction on the main street, one on the minor.
  ...(i === 1 ? { mainThroughLanes: 3, mainThroughLanesMeasured: true, minorThroughLanes: 1 } : {}),
}));
ok(MOCK_INTS.length === 4, `four mock signals placed on real junctions (${MOCK_INTS.length})`);

const { build: esbuild } = await import(path.resolve(SERVER, "node_modules/esbuild/lib/main.js"));
const bundlePath = path.resolve(SERVER, "src/lib/.timing-bundle.mjs");
const entryPath = path.resolve(SERVER, "src/lib/.timing-entry.ts");
await writeFile(entryPath, `export { generateTisReport } from ${JSON.stringify(path.resolve(SERVER, "src/lib/tis.ts"))};`, "utf8");
await esbuild({
  entryPoints: [entryPath], platform: "node", bundle: true, format: "esm", outfile: bundlePath, logLevel: "silent",
  external: ["*.node", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino", "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis"],
  banner: { js: `import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);` },
});
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/api/roads")) return new Response(JSON.stringify({ available: true, segments }), { status: 200, headers: { "Content-Type": "application/json" } });
  if (u.includes("/api/intersections") || u.includes("/api/atlanta/intersections")) return new Response(JSON.stringify(MOCK_INTS), { status: 200, headers: { "Content-Type": "application/json" } });
  return new Response("not found", { status: 404 });
};
// The engine module reads DATABASE_URL at import (calibration table); the
// query itself fails soft to multiplier 1.0, exactly as in the conserved check.
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
const { generateTisReport } = await import(bundlePath);
const baseReq = { projectName: "Timing E2E", address: "Miami, FL", latitude: SITE.lat, longitude: SITE.lon, landUseCode: "820", size: 60, openingYear: 2027, studyRadiusMi: RADIUS, analysisPeriods: ["pm_peak"] };
const rows = (r) => r.periodReports?.[0]?.affectedIntersections ?? r.affectedIntersections;

// 1. default on
const a = await generateTisReport({ ...baseReq });
const aRows = rows(a);
ok(aRows.length >= 4, `default run analyzed ${aRows.length} intersections`);
ok(aRows.every((ix) => ix.signalTiming && ["webster", "screening-default", "measured", "measured-cycle"].includes(ix.signalTiming.basis)),
   `every intersection carries a signalTiming stamp (${aRows.map((ix) => ix.signalTiming?.basis).join(", ")})`);
ok(aRows.some((ix) => ix.signalTiming?.basis === "webster"), "at least one intersection resolved to Webster from volumes");
{
  const wx = a.weatherCapacityFactor ?? 1;
  let checked = 0, bad = 0;
  for (const ix of aRows) {
    const t = ix.signalTiming; if (!t || t.basis === "screening-default") continue;
    for (const ap of ix.approaches ?? []) {
      if (!(ap.futureVc > 0)) continue;
      const implied = ap.futureVolumeVph / ap.futureVc;
      const gc = ap.direction === "NB" || ap.direction === "SB" ? t.gOverCns : t.gOverCew;
      const lanes = ap.throughLanes ?? 1;
      checked++;
      if (!near(implied, SATURATION_FLOW_VPH * gc * lanes * wx, 0.03)) { bad++; if (bad <= 2) console.log("   capacity mismatch:", ix.name, ap.direction, implied.toFixed(0), "vs", (SATURATION_FLOW_VPH * gc * lanes * wx).toFixed(0)); }
    }
  }
  ok(checked > 0 && bad === 0, `per-approach capacity re-derived as 1,800 × g/C × through lanes × weather on every Webster/measured approach (${checked} checked, ${bad} off by >3%)`);
  // OSM lane geometry (sig-2): main-street count lands on the volume-major axis, minor count on the other.
  const s2 = aRows.find((ix) => ix.signalId === "sig-2");
  const byDir = Object.fromEntries((s2?.approaches ?? []).map((ap) => [ap.direction, ap]));
  const nsVol = (byDir.NB?.existingVolumeVph ?? 0) + (byDir.SB?.existingVolumeVph ?? 0), ewVol = (byDir.EB?.existingVolumeVph ?? 0) + (byDir.WB?.existingVolumeVph ?? 0);
  const major = nsVol >= ewVol ? ["NB", "SB"] : ["EB", "WB"], minor = nsVol >= ewVol ? ["EB", "WB"] : ["NB", "SB"];
  ok(major.every((d) => byDir[d]?.throughLanes === 3 && byDir[d]?.lanesSource === "osm") && minor.every((d) => byDir[d]?.throughLanes === 1 && byDir[d]?.lanesSource === "osm"),
     `sig-2: OSM 3 through lanes on the volume-major axis (${major.join("/")}), 1 on the minor (${minor.join("/")}), both stamped osm`);
  const s1 = aRows.find((ix) => ix.signalId === "sig-1");
  ok((s1?.approaches ?? []).every((ap) => ap.throughLanes === undefined && ap.lanesSource === undefined), "sig-1 (no OSM tag, no record): no lane stamp — one-lane basis, legacy-identical fields");
  const noGeo = await generateTisReport({ ...baseReq, realLaneGeometry: false });
  const s2n = rows(noGeo).find((ix) => ix.signalId === "sig-2");
  ok((s2n?.approaches ?? []).every((ap) => ap.throughLanes === undefined) && (s2n?.approaches ?? []).every((ap) => near(ap.futureVolumeVph / ap.futureVc, SATURATION_FLOW_VPH * (ap.direction === "NB" || ap.direction === "SB" ? s2n.signalTiming.gOverCns : s2n.signalTiming.gOverCew) * wx, 0.03)),
     "realLaneGeometry: false pins sig-2 back to one lane per approach with no stamp");
  const cycles = aRows.map((ix) => ix.signalTiming?.cycleLenSec);
  ok(cycles.every((c) => c >= 60 && c <= 300), `cycles within [60, 300] s (${cycles.join(", ")})`);
  ok(!aRows.some((ix) => ix.signalTiming?.basis === "webster" && ix.signalTiming.cycleLenSec === 90 && ix.signalTiming.gOverCns === 0.45 && ix.signalTiming.gOverCew === 0.45),
     "no Webster row is silently the old 90 s / 0.45 / 0.45");
}
ok(a.methodology.some((m) => m.includes("signal-timing resolver")) && !a.methodology.some((m) => m.includes("with a 90s cycle, g/C = 0.45")),
   "methodology names the resolver and drops the flat-signal clause");

// 2. fixed across scenarios: triple the project
const big = await generateTisReport({ ...baseReq, size: 180 });
const bigRows = rows(big);
{
  const key = (ix) => JSON.stringify(ix.signalTiming);
  const same = aRows.every((ix) => key(ix) === key(bigRows.find((b) => b.signalId === ix.signalId)));
  ok(same, "tripling the project moves no intersection's timing (resolved from no-build volumes, held fixed)");
  ok(bigRows.some((ix, i) => ix.futureVc > aRows[i].futureVc), "…while the Build v/c does move with the project (the fixed timing is not a no-op)");
}

// 3. legacy reachable, byte for byte
const legacy = await generateTisReport({ ...baseReq, conservedAssignment: false, signalTiming: "screening" });
{
  const lRows = rows(legacy);
  ok(lRows.every((ix) => ix.signalTiming === undefined), "signalTiming: screening → no stamp on any row");
  ok(legacy.methodology.some((m) => m.includes("with a 90s cycle, g/C = 0.45")) && !legacy.methodology.some((m) => m.includes("signal-timing resolver")),
     "screening mode keeps the flat-signal methodology clause");
  const wx = legacy.weatherCapacityFactor ?? 1;
  let checked = 0, off = 0;
  for (const ix of lRows) for (const ap of ix.approaches ?? []) {
    if (!(ap.futureVc > 0)) continue;
    checked++;
    // signalTiming pins the TIMING; lane geometry is its own hatch
    // (realLaneGeometry), so sig-2's OSM lanes still scale the flat basis here.
    if (!near(ap.futureVolumeVph / ap.futureVc, 810 * wx * (ap.throughLanes ?? 1), 0.02)) off++;
  }
  ok(checked > 0 && off === 0, `screening mode: every approach sits on the flat 810 vph × through lanes × weather capacity (${checked} checked, ${off} off)`);
}

// 4. measured tier via a Synchro record on sig-1 (coordinates match the mock)
{
  const s1 = MOCK_INTS[0];
  const vol = { NBL: 90, NBT: 700, NBR: 60, SBL: 80, SBT: 650, SBR: 50, EBL: 40, EBT: 300, EBR: 30, WBL: 40, WBT: 280, WBR: 30 };
  const full = { intId: 1, latitude: Math.round(s1.latitude * 1e4) / 1e4, longitude: Math.round(s1.longitude * 1e4) / 1e4, volumes: vol,
    lanes: { NBT: 2, SBT: 2, EBT: 1, WBT: 1, NBL: 1, SBL: 1 }, cycleLenSec: 100,
    phaseByMovement: { NBL: 5, NBT: 2, NBR: 2, SBL: 1, SBT: 6, SBR: 6, EBL: 8, EBT: 8, EBR: 8, WBL: 4, WBT: 4, WBR: 4 },
    splitSByPhase: { 1: 15, 2: 40, 4: 30, 5: 15, 6: 40, 8: 30 } };
  const m = await generateTisReport({ ...baseReq, utdfIntersections: [full] });
  const ix = rows(m).find((r) => r.signalId === "sig-1");
  ok(ix?.signalTiming?.basis === "measured" && ix.signalTiming.cycleLenSec === 100 && ix.signalTiming.source === "synchro",
     `Synchro phases + splits → basis measured, cycle 100 s, source synchro (got ${ix?.signalTiming?.basis}, ${ix?.signalTiming?.cycleLenSec})`);
  ok(ix?.signalTiming?.leftPhasingNs === "protected" && ix.signalTiming.leftPhasingEw === "permissive" && ix.signalTiming.leftPhasingSource === "import",
     `phasing from the import: NS protected (lefts on phases 5/1), EW permissive (lefts share 8/4)`);
  ok(ix?.signalTiming && Math.abs(ix.signalTiming.gOverCns - 0.35) < 0.011 && Math.abs(ix.signalTiming.gOverCnsLeft - 0.10) < 0.011,
     `measured g/C: NS through ${ix?.signalTiming?.gOverCns}, NS left ${ix?.signalTiming?.gOverCnsLeft}`);
  const lg = ix?.approaches?.find((ap) => ap.direction === "NB")?.laneGroups;
  const L = lg?.find((x) => x.movement === "L"), T = lg?.find((x) => x.movement === "T");
  ok(L && T && L.capacityVph < T.capacityVph / 2, `NB lane groups: protected left capacity (${L?.capacityVph}) sits well below the two-lane through (${T?.capacityVph})`);
  const cycleOnly = { ...full, phaseByMovement: undefined, splitSByPhase: undefined };
  const m2 = await generateTisReport({ ...baseReq, utdfIntersections: [cycleOnly] });
  const ix2 = rows(m2).find((r) => r.signalId === "sig-1");
  ok(ix2?.signalTiming?.basis === "measured-cycle" && ix2.signalTiming.cycleLenSec === 100, `cycle-only record → measured-cycle at 100 s (got ${ix2?.signalTiming?.basis})`);
  ok(ix2?.signalTiming?.leftPhasingSource === "inferred", "…with left phasing inferred from the measured turning counts");
}

// 5. strip trap
{
  const parsed = GenerateTisResponse.parse(a);
  ok(rows(parsed).every((ix) => ix.signalTiming?.basis), "signalTiming survives GenerateTisResponse (not stripped by zod)");
  ok(rows(parsed).find((ix) => ix.signalId === "sig-2")?.approaches?.some((ap) => ap.throughLanes === 3 && ap.lanesSource === "osm"), "throughLanes / lanesSource survive GenerateTisResponse");
  ok(GenerateTisBody.safeParse({ ...baseReq, signalTiming: "screening" }).success && !GenerateTisBody.safeParse({ ...baseReq, signalTiming: "bogus" }).success,
     "GenerateTisBody accepts signalTiming: screening and rejects an unknown basis");
  const body = GenerateTisBody.parse({ ...baseReq });
  ok(body.signalTiming === "computed", `zod injects the computed default into the request echo (${body.signalTiming})`);

  // Exact re-solve inputs: emitted unrounded by the engine AND kept by zod.
  const pRows = rows(parsed);
  ok(pRows.every((ix) => typeof ix.designHourVolumeVph === "number" && typeof ix.loadWeight === "number"),
     "designHourVolumeVph / loadWeight survive GenerateTisResponse on every row");
  ok(pRows.every((ix) => ix.designHourVolumeVph === MOCK_INTS.find((m) => m.id === ix.signalId)?.totalVolume),
     "designHourVolumeVph is the inventory's unrounded design-hour volume");
  ok(pRows.every((ix) => typeof ix.signalTiming?.gOverCnsExact === "number" && typeof ix.signalTiming?.gOverCewExact === "number"
       && Math.round(ix.signalTiming.gOverCnsExact * 1000) / 1000 === ix.signalTiming.gOverCns),
     "signalTiming.gOverCnsExact / gOverCewExact survive and round to the printed 3-dp ratios");
  ok(pRows.filter((ix) => ix.movementSource === "path").every((ix) => Array.isArray(ix.pathTurns) && Array.isArray(ix.movementsExact) && ix.movementsExact.every((m) => typeof m.exact === "number")),
     "pathTurns / movementsExact survive on path rows");
  ok(pRows.filter((ix) => ix.movements?.length).every((ix) => Array.isArray(ix.movementsExact)), "movementsExact survives on every row with a movements table");
  const p2 = pRows.find((ix) => ix.signalId === "sig-2");
  ok(p2?.mainThroughLanes === 3 && p2?.mainThroughLanesMeasured === true && p2?.minorThroughLanes === 1,
     "mainThroughLanes / mainThroughLanesMeasured / minorThroughLanes survive (sig-2: 3 measured, minor 1)");
  const pp = parsed.periodReports?.[0];
  ok(pp && pp.periodVolumeFactor === 1 && typeof pp.inFraction === "number" && typeof pp.externalTripsExact === "number" && Math.round(pp.externalTripsExact) === pp.tripGeneration.externalTrips,
     `period exact fields survive (periodVolumeFactor ${pp?.periodVolumeFactor}, inFraction ${pp?.inFraction}, externalTripsExact ${pp?.externalTripsExact})`);
  ok(parsed.designYear === 2047 && parsed.designYearHorizonYears === 20, `designYear / designYearHorizonYears survive (${parsed.designYear}, ${parsed.designYearHorizonYears})`);
  ok(parsed.regionCode === "miami_dade_metro" && typeof parsed.jurisdiction?.dotName === "string" && typeof parsed.jurisdiction?.planningOfficeName === "string"
       && typeof parsed.autoModeShareSource === "string" && parsed.weatherFactorExact === 1,
     `regionCode / jurisdiction / autoModeShareSource / weatherFactorExact survive (${parsed.regionCode}, ${parsed.jurisdiction?.dotName})`);
  const measuredParsed = GenerateTisResponse.parse(await generateTisReport({ ...baseReq, utdfIntersections: [{
    intId: 1, latitude: Math.round(MOCK_INTS[0].latitude * 1e4) / 1e4, longitude: Math.round(MOCK_INTS[0].longitude * 1e4) / 1e4,
    volumes: { NBL: 90, NBT: 700, NBR: 60, SBL: 80, SBT: 650, SBR: 50, EBL: 40, EBT: 300, EBR: 30, WBL: 40, WBT: 280, WBR: 30 }, cycleLenSec: 100,
  }] }));
  const m1 = rows(measuredParsed).find((ix) => ix.signalId === "sig-1");
  ok(m1?.utdfRecordIndex === 0 && m1?.designHourVolumeVph === 2350, `utdfRecordIndex survives (sig-1 -> record 0) and designHourVolumeVph is the measured total (${m1?.designHourVolumeVph})`);
  ok(GenerateTisBody.safeParse({ ...baseReq, signalTimingOverrides: [{ latitude: 1, longitude: 1, cycleLenSec: 90, phaseByMovement: { NBT: 2 }, splitSByPhase: { 2: 40 } }] }).success,
     "GenerateTisBody accepts signalTimingOverrides (the what-if carrier)");
}

// The esbuild bundle and its entry are build artifacts, not source — remove
// them so they never land in a commit.
for (const f of [bundlePath, entryPath]) { try { await unlink(f); } catch { /* already gone */ } }
console.log(fails === 0 ? "\nsignal timing (engine) OK" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
