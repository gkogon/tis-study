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
//     jurisdiction / autoModeShareSource / weatherFactorExact /
//     growthMultiplierExact / designGrowthMultiplierExact, and calibration
//     carries delayMultiplierExact — all unrounded, all consistent with the
//     printed (rounded) fields. The design-year multiplier is PRINTED, not
//     rebuilt: for an opening year at or before the current year growthYears
//     clamps to 0 while the design span still runs from the current year, so
//     growthYears + horizon is the WRONG exponent and every row must be
//     reproducible from the printed value alone.
//  6. STRIP TRAP. Everything above survives the generated zod (WhatIfTisBody /
//     WhatIfTisResponse), and the body schema enforces the 60-record cap.
//  7. PARITY. runSensitivity: false (what /whatif forces) changes no row.
//     ROADS MEMO. Repeat runs at one site skip the roads fetch.
//  8. BOUNDED MEMO. The roads memo is capped (ROADS_MEMO_MAX_ENTRIES; the
//     least recently USED entry is evicted, not the oldest inserted — its key
//     is the caller's raw coordinates) and expired entries are deleted, not
//     merely skipped.
//  9. CLIENT PARITY where a shortcut would break it: an opening year BEFORE
//     the run (the design-year multiplier is PRINTED —
//     designGrowthMultiplierExact — and the client reads it, never rebuilding
//     growthYears + horizon) and a turbo-lane row (the screen's geometry is
//     printed as turboScreenInputs so the browser re-runs the same screen).
//     The browser solver (atlanta-tis scenario-solve.ts) is run against THIS
//     engine's output, byte for byte, at base and under a timing edit.
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
const { buildGraph, fetchLocalRoads, roadsMemoSize, ROADS_MEMO_MAX_ENTRIES, ROADS_MEMO_TTL_MS } = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
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
  id: `sig-${i + 1}`, name: `Junction ${i + 1}`, zone: "MIA", latitude: g.nodeLat[n], longitude: g.nodeLon[n], totalVolume: i === 2 ? 1500 : 2400 + i * 300,
  ...(i === 1 ? { mainThroughLanes: 3, mainThroughLanesMeasured: true, minorThroughLanes: 1 } : {}),
  // sig-3: a turbo-lane candidate (3-leg T on an arterial with a raised
  // median); its lane count is UNMEASURED, which the row math ignores but the
  // turbo screen sizes the approach with — so the printed screen inputs must
  // carry it even though the row prints no mainThroughLanes.
  ...(i === 2 ? { legCount: 3, roadClass: "primary", medianType: "raised", minorLegBearing: 180, mainThroughLanes: 2 } : {}),
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
  // Growth multipliers are printed. For a FUTURE opening year they also agree
  // with the recipe a client would naively rebuild from growthYears.
  const thisYear = new Date().getUTCFullYear();
  ok(base.growthYears === Math.max(0, baseReq.openingYear - thisYear) && base.growthMultiplierExact === Math.pow(1 + base.growthAppliedPct / 100, base.growthYears),
     `growthMultiplierExact ${base.growthMultiplierExact} = (1 + ${base.growthAppliedPct}/100) ^ ${base.growthYears}`);
  ok(base.designGrowthMultiplierExact === Math.pow(1 + base.growthAppliedPct / 100, Math.max(0, base.designYear - thisYear)),
     `designGrowthMultiplierExact ${base.designGrowthMultiplierExact} = (1 + pct/100) ^ (designYear ${base.designYear} - ${thisYear})`);
  ok(baseReq.openingYear > thisYear && base.designGrowthMultiplierExact === Math.pow(1 + base.growthAppliedPct / 100, base.growthYears + base.designYearHorizonYears),
     "future opening year: the printed design multiplier equals the growthYears + horizon rebuild (the only case where that recipe is right)");

  // Exact rebuild: buildAffectedRow from the printed inputs reproduces the row.
  {
    const row = byId(base, "sig-1");
    const sig = MOCK_INTS.find((m) => m.id === "sig-1");
    const params = {
      growthMultiplier: base.growthMultiplierExact,
      designGrowthMultiplier: base.designGrowthMultiplierExact,
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

  // PAST opening year (the schema floor is 2024): growthYears clamps to 0 but
  // the design span does not, so growthYears + horizon is NOT the engine's
  // exponent. The printed multiplier is, and the row rebuilds from it.
  {
    const past = await generateTisReport({ ...baseReq, openingYear: 2024 });
    const pm2 = past.periodReports[0];
    const pct = past.growthAppliedPct;
    ok(past.growthYears === 0 && past.growthMultiplierExact === 1, `openingYear 2024: growthYears ${past.growthYears}, growthMultiplierExact ${past.growthMultiplierExact}`);
    const designSpan = Math.max(0, past.designYear - thisYear);
    ok(past.designYear === 2044 && past.designGrowthMultiplierExact === Math.pow(1 + pct / 100, designSpan),
       `openingYear 2024: designGrowthMultiplierExact ${past.designGrowthMultiplierExact} = (1 + pct/100) ^ ${designSpan} (design year ${past.designYear})`);
    const naive = Math.pow(1 + pct / 100, past.growthYears + past.designYearHorizonYears);
    ok(thisYear > 2024 && pct > 0 && naive !== past.designGrowthMultiplierExact,
       `openingYear 2024: the growthYears + horizon rebuild (${naive}) is NOT the engine's design multiplier (${past.designGrowthMultiplierExact})`);
    const row = byId(past, "sig-1");
    const sig = MOCK_INTS.find((m) => m.id === "sig-1");
    const params = {
      growthMultiplier: past.growthMultiplierExact,
      designGrowthMultiplier: past.designGrowthMultiplierExact,
      capacityVph: core.PER_INTERSECTION_CAPACITY_VPH * past.weatherFactorExact,
      approachCapacityVph: core.APPROACH_CAPACITY_VPH * past.weatherFactorExact,
      externalTrips: pm2.externalTripsExact,
      inFraction: pm2.inFraction,
      periodVolumeFactor: pm2.periodVolumeFactor,
      distributionOctants: past.tripDistribution.byDirection,
      conservedLabeling: true,
      signalTiming: "computed",
      weatherFactor: past.weatherFactorExact,
    };
    const build = (p) => core.buildAffectedRow({ sig, distanceMi: row.distanceMi }, row.loadWeight, { lat: SITE.lat, lon: SITE.lon }, p, undefined, row.pathTurns, row.pathTurnsIn);
    const strip = (r) => { const c = { ...r }; delete c.distanceMi; return JSON.stringify(c); };
    ok(strip(build(params)) === strip(row), "openingYear 2024: buildAffectedRow from the printed multipliers reproduces sig-1 byte for byte");
    const wrong = build({ ...params, designGrowthMultiplier: naive });
    ok(typeof row.designNoBuildVc === "number" && wrong.designNoBuildVc !== row.designNoBuildVc,
       `openingYear 2024: the naive multiplier moves designNoBuildVc (${row.designNoBuildVc} -> ${wrong.designNoBuildVc})`);
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
  ok(typeof parsed.designGrowthMultiplierExact === "number" && parsed.growthMultiplierExact === ov.growthMultiplierExact && parsed.designGrowthMultiplierExact === ov.designGrowthMultiplierExact,
     "growthMultiplierExact / designGrowthMultiplierExact survive WhatIfTisResponse");
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

// ---------------------------------------------------------------------------
// 8. The roads memo is bounded and expiry frees memory. Its key is the
//    caller's raw lat/lon/radius — attacker-chosen on /whatif and the
//    anonymous driveway-candidates demo — so distinct sites must evict, never
//    accumulate. Driven through the module directly (same mocked fetch); each
//    distinct coordinate is a fresh key — the exact vector a caller nudging a
//    coordinate per request would use.
// ---------------------------------------------------------------------------
{
  const realNow = Date.now;
  const start = roadsFetches;
  const n = ROADS_MEMO_MAX_ENTRIES + 4;
  const at = (i) => fetchLocalRoads("miami_dade_metro", SITE.lat + i * 1e-9, SITE.lon, RADIUS);
  for (let i = 0; i < n; i++) await at(i);
  ok(roadsFetches - start === n && roadsMemoSize() === ROADS_MEMO_MAX_ENTRIES,
     `${n} distinct sites: ${roadsFetches - start} fetches, memo holds ${roadsMemoSize()} (cap ${ROADS_MEMO_MAX_ENTRIES})`);
  const mid = roadsFetches;
  await at(n - 1);
  ok(roadsFetches === mid, "the newest site is still memoised");
  await at(0);
  ok(roadsFetches === mid + 1 && roadsMemoSize() === ROADS_MEMO_MAX_ENTRIES, "the oldest site was evicted (re-fetched) and the cap still holds");
  // Eviction is LRU, not FIFO: a hit refreshes recency. The oldest survivor
  // now is site n - cap + 1 (sites 0..n-cap-1 fell out of the window and
  // site n-cap was evicted for site 0's re-fetch). Touch it, insert cap - 1
  // fresh sites — enough to evict every entry older than it — and it must
  // still be resident, while an untouched sibling is gone.
  const keep = n - ROADS_MEMO_MAX_ENTRIES + 1;
  const k0 = roadsFetches;
  await at(keep);
  ok(roadsFetches === k0, `site ${keep} (the oldest survivor) is still a hit`);
  for (let i = 1; i < ROADS_MEMO_MAX_ENTRIES; i++) await fetchLocalRoads("miami_dade_metro", SITE.lat - i * 1e-9, SITE.lon, RADIUS);
  const k1 = roadsFetches;
  await at(keep);
  ok(roadsFetches === k1 && roadsMemoSize() === ROADS_MEMO_MAX_ENTRIES,
     `a recently used entry survives ${ROADS_MEMO_MAX_ENTRIES - 1} newer inserts (LRU, not FIFO — under FIFO it was the oldest and would have gone first)`);
  await at(keep + 1);
  ok(roadsFetches === k1 + 1, `the untouched sibling (site ${keep + 1}) was evicted in its place`);
  Date.now = () => realNow() + ROADS_MEMO_TTL_MS + 1;
  try {
    ok(roadsMemoSize() === 0, "past the TTL every entry is deleted, not merely skipped");
    const t = roadsFetches;
    await at(0);
    ok(roadsFetches === t + 1 && roadsMemoSize() === 1, "after expiry a fetch re-populates exactly one entry");
  } finally {
    Date.now = realNow;
  }
}

// ---------------------------------------------------------------------------
// 9. Client parity: past opening year + turbo row, against this engine.
// ---------------------------------------------------------------------------
{
  const { solveScenarioDetailed, EMPTY_SCENARIO, toWhatIfRequest, timingEditFromRow, withCycle, withNsShare, designGrowthYears, printedDesignGrowthYears } =
    await import(path.resolve(here, "../../atlanta-tis/src/lib/scenario-solve.ts"));
  const CURRENT_YEAR = new Date().getUTCFullYear();
  const pastRaw = await generateTisReport({ ...baseReq, openingYear: CURRENT_YEAR - 1 });
  ok(pastRaw.growthYears === 0 && pastRaw.designYear === CURRENT_YEAR - 1 + 20, `opening ${CURRENT_YEAR - 1}: growthYears 0, designYear ${pastRaw.designYear}`);
  const past = WhatIfTisResponse.parse(pastRaw);
  ok(past.growthMultiplierExact === 1 && past.designGrowthMultiplierExact === Math.pow(1 + past.growthAppliedPct / 100, 19),
     `the engine printed growthMultiplierExact 1 and designGrowthMultiplierExact (1 + pct/100) ^ 19 (${past.designGrowthMultiplierExact})`);
  ok(printedDesignGrowthYears(past) === 19 && designGrowthYears(past) === 19,
     `client reads the engine's design span back off the PRINTED multiplier: ${printedDesignGrowthYears(past)} (growthYears + horizon would be 20; no generatedAt reconstruction)`);

  const r3 = byId(past, "sig-3");
  ok(r3?.turboLane?.candidate === true, "sig-3 screens as a turbo-lane candidate");
  ok(r3?.mainThroughLanes === undefined, "sig-3 prints no mainThroughLanes (unmeasured)");
  const tsi = r3?.turboScreenInputs;
  ok(tsi && tsi.legCount === 3 && tsi.roadClass === "primary" && tsi.medianType === "raised" && tsi.minorLegBearing === 180 && tsi.mainThroughLanes === 2 && tsi.mainThroughLanesMeasured === undefined,
     `sig-3 prints turboScreenInputs verbatim and it survives the response zod (${JSON.stringify(tsi)})`);
  ok(rows(past).filter((ix) => ix.turboScreenInputs).length === 1 && rows(past).filter((ix) => ix.turboLane).length === 1, "turboScreenInputs on exactly the turboLane rows");
  ok(r3?.turboLane?.approachLanes === 2, `the screen sized the approach with the unmeasured lane count (${r3?.turboLane?.approachLanes})`);

  const firstDiffs = (a, b, n = 6) => {
    const out = [];
    const walk = (p, x, y) => {
      if (out.length >= n) return;
      if (x === y) return;
      if (x && y && typeof x === "object" && typeof y === "object") {
        for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(`${p}.${k}`, x[k], y[k]);
        return;
      }
      out.push(`${p}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
    };
    walk("$", a, b);
    return out;
  };
  const sol0 = solveScenarioDetailed(past, EMPTY_SCENARIO);
  ok(sol0.rowFallbacks.size === 0 && sol0.baseOnly.size === 0 && sol0.reportFallbacks.size === 0, `client solve of the past-opening-year report fires no fallback (turbo row included; ${sol0.rowFallbacks.size} rows, report-level: ${[...sol0.reportFallbacks].join(", ") || "none"})`);
  const pmOf = (r) => r.periodReports.find((p) => p.period === "pm_peak").affectedIntersections;
  // Compared against the engine's RAW rows: the response zod strips
  // approaches[].addedByMovement (not in the OpenAPI schema — a pre-existing
  // strip, untouched here), which the client solve recomputes like the engine.
  ok(JSON.stringify(pmOf(sol0.report)) === JSON.stringify(pmOf(pastRaw)), `client solve reproduces every PM row byte for byte — design-year fields and turboLane included${JSON.stringify(pmOf(sol0.report)) === JSON.stringify(pmOf(pastRaw)) ? "" : "\n  " + firstDiffs(pmOf(pastRaw), pmOf(sol0.report)).join("\n  ")}`);
  ok(JSON.stringify(sol0.report.affectedIntersections) === JSON.stringify(pastRaw.affectedIntersections), "top-level rows byte-identical too");
  ok(JSON.stringify(sol0.report.mitigationSummary) === JSON.stringify(past.mitigationSummary), "mitigationSummary byte-identical");
  // The shortcut really is wrong here: a solve with growthYears + horizon would
  // grow the design year one year too far.
  {
    const rr = pmOf(past).find((ix) => ix.designNoBuildVc !== undefined);
    const g = past.growthAppliedPct / 100;
    ok(Math.abs(rr.designNoBuildVc / rr.existingVc - Math.pow(1 + g, 19)) < Math.abs(rr.designNoBuildVc / rr.existingVc - Math.pow(1 + g, 20)),
       `${rr.signalId}: design no-build v/c grows by growth^19 (${rr.existingVc} → ${rr.designNoBuildVc}), not growth^20`);
  }

  // A timing edit at the turbo signal plus a growth edit (a no-op on the
  // volumes here — growthYears is 0 — but it must round-trip the report
  // header the same way): the engine's what-if and the client solve agree
  // byte for byte.
  const edit = withNsShare(withCycle(timingEditFromRow(r3), 150), 0.2);
  const state = { ...EMPTY_SCENARIO, timing: { "sig-3": edit }, growthRatePct: 4 };
  const engRaw = await generateTisReport(toWhatIfRequest(past, state));
  const eng = WhatIfTisResponse.parse(engRaw);
  const cli = solveScenarioDetailed(past, state);
  ok(cli.reportFallbacks.size === 0, `the 4 %/yr edit raised the new rate to the span read off the printed multiplier — no "designGrowth" fallback (${[...cli.reportFallbacks].join(", ") || "none"})`);
  const e3 = byId(eng, "sig-3"), c3 = pmOf(cli.report).find((ix) => ix.signalId === "sig-3");
  ok(e3?.signalTiming?.source === "override" && e3.signalTiming.cycleLenSec === 150, `engine what-if: sig-3 runs the 150 s plan (${e3?.signalTiming?.source})`);
  ok(eng.growthAppliedPct === 4 && cli.report.growthAppliedPct === 4, "both sides applied 4 %/yr growth");
  ok(JSON.stringify(pmOf(cli.report)) === JSON.stringify(pmOf(engRaw)), `engine what-if vs client solve: every PM row byte-identical under the edits${JSON.stringify(pmOf(cli.report)) === JSON.stringify(pmOf(engRaw)) ? "" : "\n  " + firstDiffs(pmOf(engRaw), pmOf(cli.report)).join("\n  ")}`);
  ok(JSON.stringify(cli.report.mitigationSummary) === JSON.stringify(eng.mitigationSummary), "engine what-if vs client solve: mitigationSummary byte-identical under the edit");
  ok(JSON.stringify(c3?.turboLane) === JSON.stringify(e3?.turboLane), "sig-3 turboLane identical between engine and client under the timing edit");
  ok(/turbo-lane/.test(e3?.mitigation ?? "") === /turbo-lane/.test(c3?.mitigation ?? "") && e3?.mitigation === c3?.mitigation,
     `sig-3 mitigation prose identical (turbo sentence ${/turbo-lane/.test(e3?.mitigation ?? "") ? "present" : "absent"} on both)`);

  // The turbo screening reads the BUILD volumes, so a trip edit must move it:
  // size x40 on both sides. The engine re-runs the network here (distribution
  // feedback), so the rows are not byte-comparable — the screening block is,
  // because its inputs (rounded approach volumes) and outputs are rounded.
  const big = { ...EMPTY_SCENARIO, size: baseReq.size * 40 };
  const engBig = await generateTisReport(toWhatIfRequest(past, big));
  const cliBig = solveScenarioDetailed(past, big);
  const eb3 = byId(engBig, "sig-3"), cb3 = pmOf(cliBig.report).find((ix) => ix.signalId === "sig-3");
  ok(JSON.stringify(eb3?.turboLane) !== JSON.stringify(r3?.turboLane),
     `size x40: the engine's sig-3 turboLane moved (baseline approach v/c ${r3?.turboLane?.baselineApproachVc} → ${eb3?.turboLane?.baselineApproachVc})`);
  ok(JSON.stringify(cb3?.turboLane) === JSON.stringify(eb3?.turboLane),
     `size x40: the client RECOMPUTED sig-3's turboLane to the engine's (v/c ${cb3?.turboLane?.baselineApproachVc}), not the base's block`);
  ok(/turbo-lane \(continuous-green T/.test(eb3?.mitigation ?? "") && (eb3?.futureLos === "E" || eb3?.futureLos === "F"),
     `size x40: sig-3 fails under Build (LOS ${eb3?.futureLos}) and the engine folds the turbo option into its mitigation prose`);
  ok(eb3?.mitigation === cb3?.mitigation,
     "size x40: the client's sig-3 mitigation prose is the engine's, turbo sentence included (the screen ran in the browser, not copied from the base)");
}

for (const f of [bundlePath, entryPath]) { try { await unlink(f); } catch { /* already gone */ } }
console.log(fails === 0 ? "\nsignal timing overrides (engine) OK" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
