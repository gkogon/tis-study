// End-to-end: what-if signal timing overrides (req.signalTimingOverrides)
// wired into generateTisReport, plus the exact re-solve inputs the report now
// prints for the browser scenario solver.
//
//  1. TIMING ONLY. An override snapped to a signal changes THAT row's timing
//     (basis measured, source "override", the override's cycle) and nothing
//     else: its existing volumes / approach shares / designHourVolumeVph are
//     the base study's byte for byte, and every OTHER row is byte-identical.
//  2. FIRST PROVIDER. With a Synchro record AND an override on the same
//     signal, the override's timing wins while the record still supplies the
//     volumes (volumeSource utdf_tmc, utdfRecordIndex 0).
//  3. SNAP RULES. Coordinates first (nearest-wins per signal, ~0.35 mi), then
//     an unambiguous name fallback; every fate lands in timingOverrideSummary,
//     which is present whenever the array was sent (even empty).
//  4. SCREENING. Under signalTiming: "screening" the override is ignored
//     (no stamp) but still reported in the summary.
//  5. EXACT INPUTS. Every row carries designHourVolumeVph / loadWeight /
//     movementsExact (and pathTurns on path rows), signalTiming carries the
//     unrounded ratios, periods carry periodVolumeFactor / inFraction /
//     externalTripsExact, the report carries designYear / regionCode /
//     jurisdiction / autoModeShareSource / weatherFactorExact, and calibration
//     carries delayMultiplierExact — all unrounded, all consistent with the
//     printed (rounded) fields.
//  6. STRIP TRAP. Everything above survives the generated zod (WhatIfTisBody /
//     WhatIfTisResponse), and the body schema enforces the 60-record cap.
//  7. PARITY. runSensitivity: false (what /whatif forces) changes no row.
//
// Harness mirrors verify-signal-timing-engine.mjs: esbuild-bundle tis.ts,
// mock fetch with the pinned Miami network fixture, mock signals on real
// junctions, dummy DATABASE_URL (calibration fails soft to 1.0).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFile, writeFile, unlink } from "node:fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(here, "..");
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const { WhatIfTisBody, WhatIfTisResponse, GenerateTisResponse } = await import(path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts"));
const core = await import("@workspace/tis-engine-core");

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
  ...(i === 1 ? { mainThroughLanes: 3, mainThroughLanesMeasured: true, minorThroughLanes: 1 } : {}),
}));
ok(MOCK_INTS.length === 4, `four mock signals placed on real junctions (${MOCK_INTS.length})`);

const { build: esbuild } = await import(path.resolve(SERVER, "node_modules/esbuild/lib/main.js"));
const bundlePath = path.resolve(SERVER, "src/lib/.timing-override-bundle.mjs");
const entryPath = path.resolve(SERVER, "src/lib/.timing-override-entry.ts");
await writeFile(entryPath, `export { generateTisReport } from ${JSON.stringify(path.resolve(SERVER, "src/lib/tis.ts"))};`, "utf8");
await esbuild({
  entryPoints: [entryPath], platform: "node", bundle: true, format: "esm", outfile: bundlePath, logLevel: "silent",
  external: ["*.node", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino", "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis"],
  banner: { js: `import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);` },
});
let roadsFetches = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/api/roads")) { roadsFetches++; return new Response(JSON.stringify({ available: true, segments }), { status: 200, headers: { "Content-Type": "application/json" } }); }
  if (u.includes("/api/intersections") || u.includes("/api/atlanta/intersections")) return new Response(JSON.stringify(MOCK_INTS), { status: 200, headers: { "Content-Type": "application/json" } });
  return new Response("not found", { status: 404 });
};
process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:1/unused";
const { generateTisReport } = await import(bundlePath);
const baseReq = { projectName: "Override E2E", address: "Miami, FL", latitude: SITE.lat, longitude: SITE.lon, landUseCode: "820", size: 60, openingYear: 2027, studyRadiusMi: RADIUS, analysisPeriods: ["pm_peak"] };
const rows = (r) => r.periodReports?.[0]?.affectedIntersections ?? r.affectedIntersections;
const byId = (r, id) => rows(r).find((ix) => ix.signalId === id);
const rowsSans = (r, id) => rows(r).filter((ix) => ix.signalId !== id).map((ix) => JSON.stringify(ix)).join("\n");
const round4 = (n) => Math.round(n * 1e4) / 1e4;

const s1 = MOCK_INTS[0], s2 = MOCK_INTS[1];
const OVERRIDE = {
  name: s1.name, latitude: round4(s1.latitude), longitude: round4(s1.longitude), cycleLenSec: 120,
  phaseByMovement: { NBL: 5, NBT: 2, NBR: 2, SBL: 1, SBT: 6, SBR: 6, EBL: 8, EBT: 8, EBR: 8, WBL: 4, WBT: 4, WBR: 4 },
  splitSByPhase: { 1: 20, 2: 50, 4: 30, 5: 20, 6: 50, 8: 30 },
};

// Warm-up seeds the module caches, exactly as the other harnesses do.
await generateTisReport({ ...baseReq });
const base = await generateTisReport({ ...baseReq });
ok(base.timingOverrideSummary === undefined, "no overrides sent: no timingOverrideSummary on the payload");
ok(rows(base).every((ix) => ix.signalTiming && ix.signalTiming.source !== "override"), "no overrides sent: no row is stamped override");

// ---------------------------------------------------------------------------
// 1. Timing only.
// ---------------------------------------------------------------------------
const ov = await generateTisReport({ ...baseReq, signalTimingOverrides: [OVERRIDE] });
{
  const r = byId(ov, "sig-1"), b = byId(base, "sig-1");
  ok(r?.signalTiming?.source === "override" && r.signalTiming.basis === "measured" && r.signalTiming.cycleLenSec === 120,
     `sig-1: timing from the override (basis ${r?.signalTiming?.basis}, source ${r?.signalTiming?.source}, cycle ${r?.signalTiming?.cycleLenSec} s)`);
  ok(r?.signalTiming?.leftPhasingNs === "protected" && r.signalTiming.leftPhasingEw === "permissive" && r.signalTiming.leftPhasingSource === "import",
     "sig-1: phasing from the override (NS protected on phases 5/1, EW permissive)");
  ok(near(r?.signalTiming?.gOverCns ?? 0, 45 / 120, 0.002) && near(r?.signalTiming?.gOverCnsLeft ?? 0, 15 / 120, 0.002),
     `sig-1: g/C from the override splits (NS through ${r?.signalTiming?.gOverCns}, NS left ${r?.signalTiming?.gOverCnsLeft})`);
  ok(JSON.stringify(r?.signalTiming) !== JSON.stringify(b?.signalTiming), "sig-1: the timing actually changed vs the base run");
  ok(r?.designHourVolumeVph === b?.designHourVolumeVph && r?.volumeSource === undefined && r?.utdfRecordIndex === undefined,
     `sig-1: volumes untouched — designHourVolumeVph ${r?.designHourVolumeVph} === base, no volumeSource, no utdfRecordIndex`);
  const sameVols = (r?.approaches ?? []).every((ap, i) => ap.existingVolumeVph === b.approaches[i].existingVolumeVph && ap.currentVolumeVph === b.approaches[i].currentVolumeVph && ap.direction === b.approaches[i].direction);
  ok(sameVols, "sig-1: every approach's existing / current volume is the base study's, byte for byte");
  ok(r?.loadWeight === b?.loadWeight && r?.addedTripsPmPeak === b?.addedTripsPmPeak, "sig-1: project load unchanged (loadWeight, addedTripsPmPeak)");
  ok((r?.approaches ?? []).some((ap, i) => ap.futureVc !== b.approaches[i].futureVc), "sig-1: capacity (and so v/c) moved with the new g/C — the override is not a no-op");
  ok(rowsSans(ov, "sig-1") === rowsSans(base, "sig-1"), "every OTHER row is byte-identical to the base run");
  const sm = ov.timingOverrideSummary;
  ok(sm && sm.total === 1 && sm.matched === 1 && sm.matchedByCoordinates === 1 && sm.matchedByName === 0 && sm.unmatched.length === 0
     && sm.matches[0]?.index === 0 && sm.matches[0]?.signalId === "sig-1" && sm.matches[0]?.by === "coordinates",
     `timingOverrideSummary: 1/1 matched by coordinates to sig-1 (${JSON.stringify(sm)})`);
  ok(JSON.stringify(ov.tripDistribution) === JSON.stringify(base.tripDistribution) && ov.intersectionsStudied === base.intersectionsStudied,
     "distribution and study set unchanged by a timing override");
}

// ---------------------------------------------------------------------------
// 2. First provider: override outranks a Synchro record on the same signal;
//    the record still supplies the volumes.
// ---------------------------------------------------------------------------
{
  const vol = { NBL: 90, NBT: 700, NBR: 60, SBL: 80, SBT: 650, SBR: 50, EBL: 40, EBT: 300, EBR: 30, WBL: 40, WBT: 280, WBR: 30 };
  const rec = { intId: 1, latitude: round4(s1.latitude), longitude: round4(s1.longitude), volumes: vol, cycleLenSec: 100,
    phaseByMovement: OVERRIDE.phaseByMovement, splitSByPhase: { 1: 15, 2: 40, 4: 30, 5: 15, 6: 40, 8: 30 } };
  const utdfOnly = await generateTisReport({ ...baseReq, utdfIntersections: [rec] });
  const both = await generateTisReport({ ...baseReq, utdfIntersections: [rec], signalTimingOverrides: [OVERRIDE] });
  const u = byId(utdfOnly, "sig-1"), r = byId(both, "sig-1");
  ok(u?.signalTiming?.source === "synchro" && u.signalTiming.cycleLenSec === 100, `record alone: synchro timing at 100 s (${u?.signalTiming?.source}, ${u?.signalTiming?.cycleLenSec})`);
  ok(r?.signalTiming?.source === "override" && r.signalTiming.cycleLenSec === 120, `record + override: override wins at 120 s (${r?.signalTiming?.source}, ${r?.signalTiming?.cycleLenSec})`);
  ok(r?.volumeSource === "utdf_tmc" && r?.utdfRecordIndex === 0 && r?.designHourVolumeVph === u?.designHourVolumeVph,
     `record + override: volumes still from the record (volumeSource ${r?.volumeSource}, utdfRecordIndex ${r?.utdfRecordIndex}, ${r?.designHourVolumeVph} vph)`);
  ok(u?.utdfRecordIndex === 0, "utdfRecordIndex echoes the record's index in request.utdfIntersections");
  ok(rowsSans(both, "sig-1") === rowsSans(utdfOnly, "sig-1"), "record + override: other rows byte-identical to the record-only run");
}

// ---------------------------------------------------------------------------
// 3. Snap rules + summary.
// ---------------------------------------------------------------------------
{
  const far = { ...OVERRIDE, name: undefined, latitude: round4(SITE.lat + 0.2), longitude: round4(SITE.lon + 0.2) };
  delete far.name;
  const miss = await generateTisReport({ ...baseReq, signalTimingOverrides: [far] });
  const sm = miss.timingOverrideSummary;
  ok(sm && sm.total === 1 && sm.matched === 0 && sm.unmatched.length === 1 && sm.unmatched[0].reason === "no_signal_within_snap" && sm.unmatched[0].index === 0,
     `override 0.2 deg away with no name: unmatched, reason no_signal_within_snap (${JSON.stringify(sm?.unmatched)})`);
  ok(rows(miss).map((ix) => JSON.stringify(ix)).join("\n") === rows(base).map((ix) => JSON.stringify(ix)).join("\n"), "unmatched override: every row byte-identical to the base run");

  const named = { ...far, name: s2.name };
  const byName = await generateTisReport({ ...baseReq, signalTimingOverrides: [named] });
  const sm2 = byName.timingOverrideSummary;
  ok(sm2 && sm2.matched === 1 && sm2.matchedByName === 1 && sm2.matches[0]?.signalId === "sig-2" && sm2.matches[0]?.by === "name",
     `coordinates miss but name "${s2.name}" matches: attached to sig-2 by name (${JSON.stringify(sm2?.matches)})`);
  ok(byId(byName, "sig-2")?.signalTiming?.source === "override" && byId(byName, "sig-1")?.signalTiming?.source !== "override", "name fallback stamps sig-2 only");

  // A name that denotes no study intersection: unmatched, and the rows stay
  // the base study's. (The tie branch shares matchIntersectionByName with
  // attachUtdfData, whose tie handling check:synchro-pdf-engine covers.)
  const nowhere = { ...far, name: "Nowhere Rd & Nothing Ave" };
  const unnamed = await generateTisReport({ ...baseReq, signalTimingOverrides: [nowhere] });
  const smNone = unnamed.timingOverrideSummary;
  ok(smNone && smNone.matched === 0 && smNone.unmatched[0]?.reason === "name_unmatched", `unknown name: unmatched, reason name_unmatched (${smNone?.unmatched[0]?.reason})`);
  ok(rows(unnamed).map((ix) => JSON.stringify(ix)).join("\n") === rows(base).map((ix) => JSON.stringify(ix)).join("\n"), "unknown name: every row byte-identical to the base run");

  // Two overrides for the same signal: the nearer one wins, the other is reported displaced.
  const nearer = { ...OVERRIDE, latitude: s1.latitude, longitude: s1.longitude, cycleLenSec: 90 };
  const farther = { ...OVERRIDE, latitude: round4(s1.latitude + 0.001), longitude: round4(s1.longitude + 0.001), cycleLenSec: 150 };
  const dup = await generateTisReport({ ...baseReq, signalTimingOverrides: [farther, nearer] });
  const smD = dup.timingOverrideSummary;
  ok(smD && smD.matched === 1 && smD.matches[0]?.index === 1 && smD.unmatched[0]?.index === 0 && smD.unmatched[0]?.reason === "displaced_by_nearer",
     `two overrides on sig-1: the nearer (index 1) wins, index 0 displaced_by_nearer (${JSON.stringify(smD)})`);
  ok(byId(dup, "sig-1")?.signalTiming?.cycleLenSec === 90, `sig-1 carries the nearer override's cycle (${byId(dup, "sig-1")?.signalTiming?.cycleLenSec} s)`);

  const empty = await generateTisReport({ ...baseReq, signalTimingOverrides: [] });
  ok(empty.timingOverrideSummary && empty.timingOverrideSummary.total === 0 && empty.timingOverrideSummary.matched === 0, "empty array: summary present with total 0");
  ok(rows(empty).map((ix) => JSON.stringify(ix)).join("\n") === rows(base).map((ix) => JSON.stringify(ix)).join("\n"), "empty array: rows byte-identical to the base run");
}

// ---------------------------------------------------------------------------
// 4. Screening mode ignores the override (timing resolver is off) but the
//    summary still reports the match.
// ---------------------------------------------------------------------------
{
  const scr = await generateTisReport({ ...baseReq, signalTiming: "screening", signalTimingOverrides: [OVERRIDE] });
  ok(rows(scr).every((ix) => ix.signalTiming === undefined), "screening: no signalTiming stamp on any row, override included");
  ok(scr.timingOverrideSummary?.matched === 1, "screening: the override still reports as matched in the summary");
}

// ---------------------------------------------------------------------------
// 5. Exact re-solve inputs.
// ---------------------------------------------------------------------------
{
  const bRows = rows(base);
  ok(bRows.every((ix) => typeof ix.designHourVolumeVph === "number" && typeof ix.loadWeight === "number"), "every row carries designHourVolumeVph and loadWeight");
  ok(bRows.every((ix) => ix.designHourVolumeVph === MOCK_INTS.find((m) => m.id === ix.signalId)?.totalVolume), "designHourVolumeVph is the inventory's unrounded design-hour volume");
  ok(bRows.every((ix) => typeof ix.signalTiming?.gOverCnsExact === "number" && typeof ix.signalTiming?.gOverCewExact === "number"
       && core.round3(ix.signalTiming.gOverCnsExact) === ix.signalTiming.gOverCns && core.round3(ix.signalTiming.gOverCewExact) === ix.signalTiming.gOverCew),
     "signalTiming carries unrounded g/C ratios that round to the printed 3-dp ones");
  const pm = base.periodReports[0];
  const ext = pm.externalTripsExact;
  ok(pm.periodVolumeFactor === 1 && typeof pm.inFraction === "number" && pm.inFraction > 0 && pm.inFraction < 1 && Math.round(ext) === pm.tripGeneration.externalTrips && pm.existingUseCreditExact === undefined,
     `period: periodVolumeFactor ${pm.periodVolumeFactor}, inFraction ${pm.inFraction}, externalTripsExact ${ext} (rounds to ${pm.tripGeneration.externalTrips}), no existing-use credit`);
  let exactChecked = 0, exactBad = 0;
  for (const ix of bRows) {
    if (!ix.movementsExact) continue;
    exactChecked++;
    const sum = ix.movementsExact.reduce((s, m) => s + m.exact, 0);
    const expected = ix.pathTurnsIn !== undefined
      ? ext * ((ix.pathTurns ?? []).reduce((s, t) => s + t.share, 0) * (1 - pm.inFraction) + ix.pathTurnsIn.reduce((s, t) => s + t.share, 0) * pm.inFraction)
      : ext * ix.loadWeight;
    if (!near(sum, expected, 1e-6)) exactBad++;
    // Re-integerizing the exact rows with the engine's allocator reproduces the printed table.
    const reInt = core.integerizeMovementLoads(ix.movementsExact, expected);
    if (JSON.stringify(reInt) !== JSON.stringify(ix.movements ?? [])) exactBad++;
  }
  ok(exactChecked > 0 && exactBad === 0, `movementsExact sums to externalTrips x loadWeight and re-integerizes to the printed movements (${exactChecked} rows)`);
  ok(bRows.filter((ix) => ix.movementSource === "path").every((ix) => Array.isArray(ix.pathTurns) && ix.pathTurns.length > 0 && typeof ix.pathTurns[0].enterBearingDeg === "number"),
     "path rows carry their turn ledger (pathTurns)");
  ok(bRows.filter((ix) => ix.movementSource === "octant").every((ix) => ix.pathTurns === undefined), "octant rows carry no ledger");
  const r2 = byId(base, "sig-2");
  ok(r2?.mainThroughLanes === 3 && r2?.mainThroughLanesMeasured === true && r2?.minorThroughLanes === 1, "sig-2 carries mainThroughLanes 3 (measured) and minorThroughLanes 1");
  ok(byId(base, "sig-1")?.mainThroughLanesMeasured === undefined, "sig-1 (no OSM tag) carries no lane fields");
  ok(base.designYear === 2047 && base.designYearHorizonYears === 20, `designYear ${base.designYear}, horizon ${base.designYearHorizonYears}`);
  ok(base.regionCode === "miami_dade_metro" && typeof base.jurisdiction?.dotName === "string" && typeof base.jurisdiction?.planningOfficeName === "string",
     `regionCode ${base.regionCode}; jurisdiction "${base.jurisdiction?.dotName}" / "${base.jurisdiction?.planningOfficeName}"`);
  ok(typeof base.autoModeShareSource === "string" && base.autoModeShareSource.length > 0, `autoModeShareSource: ${base.autoModeShareSource}`);
  ok(base.weatherFactorExact === 1 && base.weatherCapacityFactor === 1, "weatherFactorExact 1 (clear)");
  const wet = await generateTisReport({ ...baseReq, weather: "heavy_rain" });
  ok(wet.weatherFactorExact === core.WEATHER_FACTOR.heavy_rain && wet.weatherCapacityFactor === core.round2(core.WEATHER_FACTOR.heavy_rain), `heavy rain: weatherFactorExact ${wet.weatherFactorExact}`);

  // Exact rebuild: buildAffectedRow from the printed inputs reproduces the row.
  {
    const row = byId(base, "sig-1");
    const sig = MOCK_INTS.find((m) => m.id === "sig-1");
    const params = {
      growthMultiplier: Math.pow(1 + base.growthAppliedPct / 100, base.growthYears),
      designGrowthMultiplier: Math.pow(1 + base.growthAppliedPct / 100, base.growthYears + base.designYearHorizonYears),
      capacityVph: core.PER_INTERSECTION_CAPACITY_VPH * base.weatherFactorExact,
      approachCapacityVph: core.APPROACH_CAPACITY_VPH * base.weatherFactorExact,
      externalTrips: pm.externalTripsExact,
      inFraction: pm.inFraction,
      periodVolumeFactor: pm.periodVolumeFactor,
      distributionOctants: base.tripDistribution.byDirection,
      conservedLabeling: true,
      signalTiming: "computed",
      weatherFactor: base.weatherFactorExact,
    };
    const rebuilt = core.buildAffectedRow(
      { sig, distanceMi: row.distanceMi }, row.loadWeight, { lat: SITE.lat, lon: SITE.lon }, params, undefined, row.pathTurns, row.pathTurnsIn,
    );
    const strip = (r) => { const c = { ...r }; delete c.distanceMi; return JSON.stringify(c); };
    ok(strip(rebuilt) === strip(row), "buildAffectedRow from the printed exact inputs reproduces sig-1 byte for byte (distanceMi aside — the row prints it rounded)");
  }

  // Calibration: the unrounded multiplier rides beside the 2-dp one.
  {
    const sig = MOCK_INTS[0];
    const cal = core.buildAffectedRow(
      { sig, distanceMi: 0.2 }, 0.5, { lat: SITE.lat, lon: SITE.lon },
      { growthMultiplier: 1.03, capacityVph: 810, approachCapacityVph: 810, externalTrips: 100, inFraction: 0.5, periodVolumeFactor: 1, signalTiming: "computed", weatherFactor: 1 },
      { multiplier: 1.2345, sampleCount: 7, lastObservedDelaySec: 31.2 },
    );
    ok(cal.calibration?.delayMultiplier === 1.23 && cal.calibration?.delayMultiplierExact === 1.2345, `calibration: delayMultiplier ${cal.calibration?.delayMultiplier}, exact ${cal.calibration?.delayMultiplierExact}`);
    const parsed = GenerateTisResponse.partial().parse({ affectedIntersections: [cal] });
    ok(parsed.affectedIntersections?.[0]?.calibration?.delayMultiplierExact === 1.2345, "delayMultiplierExact survives the response zod");
  }
}

// ---------------------------------------------------------------------------
// 6. Strip trap: the request field, the summary and the stamp survive zod.
// ---------------------------------------------------------------------------
{
  const body = WhatIfTisBody.safeParse({ ...baseReq, signalTimingOverrides: [OVERRIDE] });
  ok(body.success && body.data.signalTimingOverrides?.length === 1 && body.data.signalTimingOverrides[0].cycleLenSec === 120, "WhatIfTisBody keeps signalTimingOverrides");
  ok(!WhatIfTisBody.safeParse({ ...baseReq, signalTimingOverrides: [{ ...OVERRIDE, cycleLenSec: undefined }] }).success, "WhatIfTisBody rejects an override without a cycle");
  ok(!WhatIfTisBody.safeParse({ ...baseReq, signalTimingOverrides: Array.from({ length: 61 }, () => OVERRIDE) }).success, "WhatIfTisBody rejects 61 overrides (maxItems 60)");
  ok(WhatIfTisBody.safeParse({ ...baseReq, signalTimingOverrides: Array.from({ length: 60 }, () => OVERRIDE) }).success, "WhatIfTisBody accepts 60 overrides");
  const parsed = WhatIfTisResponse.parse(ov);
  ok(parsed.timingOverrideSummary?.matched === 1 && parsed.timingOverrideSummary.matches[0].signalId === "sig-1", "timingOverrideSummary survives WhatIfTisResponse");
  ok(rows(parsed).find((ix) => ix.signalId === "sig-1")?.signalTiming?.source === "override", "signalTiming.source override survives WhatIfTisResponse");
  ok(rows(parsed).every((ix) => typeof ix.designHourVolumeVph === "number" && typeof ix.loadWeight === "number" && typeof ix.signalTiming?.gOverCnsExact === "number"),
     "designHourVolumeVph / loadWeight / gOverCnsExact survive WhatIfTisResponse");
  ok(rows(parsed).filter((ix) => ix.movementSource === "path").every((ix) => Array.isArray(ix.pathTurns) && Array.isArray(ix.movementsExact)), "pathTurns / movementsExact survive WhatIfTisResponse");
  ok(parsed.periodReports[0].periodVolumeFactor === 1 && typeof parsed.periodReports[0].externalTripsExact === "number" && typeof parsed.periodReports[0].inFraction === "number", "period exact fields survive WhatIfTisResponse");
  ok(parsed.designYear === 2047 && parsed.regionCode === "miami_dade_metro" && parsed.jurisdiction?.dotName && parsed.autoModeShareSource && parsed.weatherFactorExact === 1, "report-level exact fields survive WhatIfTisResponse");
  ok(rows(parsed).find((ix) => ix.signalId === "sig-2")?.mainThroughLanesMeasured === true, "mainThroughLanesMeasured survives WhatIfTisResponse");
}

// ---------------------------------------------------------------------------
// 7. Parity with what /whatif forces (runSensitivity: false) + roads memo.
// ---------------------------------------------------------------------------
{
  const before = roadsFetches;
  const a = await generateTisReport({ ...baseReq, signalTimingOverrides: [OVERRIDE] });
  const b = await generateTisReport({ ...baseReq, signalTimingOverrides: [OVERRIDE], runSensitivity: false });
  ok(rows(a).map((ix) => JSON.stringify(ix)).join("\n") === rows(b).map((ix) => JSON.stringify(ix)).join("\n"), "runSensitivity: false changes no row");
  ok(roadsFetches === before, `repeat runs at the same site skip the roads fetch (memo; ${roadsFetches} fetches total)`);
}

for (const f of [bundlePath, entryPath]) { try { await unlink(f); } catch { /* already gone */ } }
console.log(fails === 0 ? "\nsignal timing overrides (engine) OK" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
