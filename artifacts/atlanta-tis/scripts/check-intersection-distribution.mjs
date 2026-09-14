// Headless pass over the intersection study's §01a model
// (src/lib/intersection-study-model.ts distributionForRow /
// routeContinuationForRow, src/lib/study-map-sim.ts routesThrough) for
// EVERY row of BOTH peak periods of the real fixtures
// (scripts/fixtures/README.md — engine output, nothing hand-typed):
//
//   A  scenario-base.json       40 rows × AM / PM; 31 path rows (all with a
//                               recorded inbound ledger, 20 one-sided), 9
//                               octant rows
//   B  scenario-overrides.json  the same study at size × 1.5 with two timing
//                               overrides — the engine's own scenario
//
// For every row in every period:
//   1. cross-foot: Σ cell trips === addedTripsPmPeak (integer), Σ cell exact
//      === Σ movementsExact within 1e-6, and each approach's Σ === the
//      printed approaches[].addedTripsPeak (row-math.ts sums the same table);
//   2. the per-cell inbound + outbound re-adds to the printed exact cell
//      within 1e-6 on EVERY cell — the ledger recomputation on path rows,
//      the octant recomputation on octant rows (cellDirectionBasis says
//      which; "proportional" never occurs on these fixtures);
//   3. the split: octant rows have Σ inbound ÷ total === the period's
//      inFraction (1e-9); path rows have Σ outbound === external × (1 − in)
//      × Σ pathTurns shares and Σ inbound === external × in × Σ pathTurnsIn
//      shares (1e-6), and their ledgerBlend is the engine's ledgerWeight
//      (Σ exact ÷ external);
//   4. exits / origins: the octant shares sum to 1 (1e-9) wherever the side
//      has turns, are null where it has none, and the exit trips sum to the
//      outbound total;
//   5. share of the study: fraction × period trips === Σ exact; ranks are
//      1..n, unique, rank 1 is a row with the largest addedTripsPmPeak, and
//      every row's rank places it in the ranked list;
//   6. no NaN / Infinity anywhere (deep walk); a row with no period yields a
//      model with no split and no share, still finite;
//   7. AM ≠ PM: the same row's model differs between the periods (the
//      engine assigns each period on its own inFraction);
//   8. a scenario pair: solveScenario(A, size × 1.5) — every cross-foot and
//      recomputation above holds on the CLIENT's scenario rows against the
//      scenario report's own period trips (scenario-solve.ts now prints
//      externalTripsExact for an edited trip generation), the scenario
//      model differs from the base, and an untouched signal's scenario
//      model is null (edit elsewhere ⇒ not a scenario for this signal);
//      the same on the engine's own B rows;
//   9. through routes (gallery/fixtures/roads.json, the map's graph): every
//      junction is on its own route within 60 m, the continuation list never
//      contains the junction itself, every listed signal's route really
//      passes within 60 m (recomputed directly with distToRouteM), at least
//      one junction has routes through it, and without routes the model
//      says so rather than listing nothing as if it were true.
//
// Run: `pnpm run check:intersection-distribution` (plain node 26, no bundler).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  distributionForRow, routeContinuationForRow, periodAssignedTrips, DISTRIBUTION_REPRODUCE_TOL, ROUTE_CONTINUATION_LABEL, SECTIONS,
} from "../src/lib/intersection-study-model.ts";
import { buildRoadGraph, routesForRows, routesThrough, distToRouteM, THROUGH_ROUTE_M } from "../src/lib/study-map-sim.ts";
import { solveScenario, EMPTY_SCENARIO } from "../src/lib/scenario-solve.ts";
import { DIRECTIONS, MOVEMENTS } from "../src/lib/intersection-geometry.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (n) => JSON.parse(fs.readFileSync(path.join(here, "fixtures", n), "utf8"));
const A = load("scenario-base.json");
const B = load("scenario-overrides.json");
const roads = JSON.parse(fs.readFileSync(path.join(here, "..", "gallery", "fixtures", "roads.json"), "utf8"));

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok  " + m); else { failed++; console.log("  FAIL " + m); } };

function walkFinite(v, trail, bad, seen = new Set()) {
  if (typeof v === "number") { if (!Number.isFinite(v)) bad.push(trail); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => walkFinite(x, `${trail}[${i}]`, bad, seen)); return; }
  if (v && typeof v === "object") {
    if (seen.has(v)) return;
    seen.add(v);
    for (const [k, x] of Object.entries(v)) walkFinite(x, `${trail}.${k}`, bad, seen);
  }
}
const nonFinite = (m) => { const bad = []; walkFinite(m, "model", bad); return bad; };
const peaks = (R) => R.periodReports.filter((p) => p.affectedIntersections.length > 0);

ok(SECTIONS.some((s) => s.id === "distribution" && s.n === "01a") && SECTIONS.findIndex((s) => s.id === "distribution") === SECTIONS.findIndex((s) => s.id === "approaches") + 1,
  "§01a Distribution sits between §01 and §02 in the study's section list");

/** Every cross-foot and recomputation on one period's rows; returns the tallies. */
function auditPeriod(R, p, label) {
  const bad = [];
  const bases = {};
  let rows = 0, cells = 0;
  const ext = periodAssignedTrips(p);
  for (const r of p.affectedIntersections) {
    rows++;
    const m = distributionForRow(r, p, R).base;
    const k = `${m.movementSource}/${m.cellDirectionBasis}`;
    bases[k] = (bases[k] ?? 0) + 1;
    const nf = nonFinite(m);
    if (nf.length) bad.push(`${label} ${r.signalId}: non-finite at ${nf.slice(0, 3).join(", ")}`);
    if (m.cells.length !== 12) bad.push(`${label} ${r.signalId}: ${m.cells.length} cells`);
    // 1. cross-foot
    if (m.total.trips !== r.addedTripsPmPeak) bad.push(`${label} ${r.signalId}: Σ trips ${m.total.trips} ≠ addedTripsPmPeak ${r.addedTripsPmPeak}`);
    const exactSum = (r.movementsExact ?? []).reduce((s, x) => s + x.exact, 0);
    if (Math.abs(m.total.exact - exactSum) > 1e-6) bad.push(`${label} ${r.signalId}: Σ exact ${m.total.exact} ≠ ${exactSum}`);
    for (const a of r.approaches) if (m.approaches[a.direction].trips !== a.addedTripsPeak) bad.push(`${label} ${r.signalId} ${a.direction}: approach Σ ${m.approaches[a.direction].trips} ≠ printed +${a.addedTripsPeak}`);
    // 2. per-cell re-add
    const printed = new Map((r.movementsExact ?? []).map((x) => [`${x.approach}${x.movement}`, x.exact]));
    for (const c of m.cells) {
      cells++;
      const e = printed.get(`${c.approach}${c.movement}`) ?? 0;
      if (Math.abs(c.exact - e) > 1e-9) bad.push(`${label} ${r.signalId} ${c.approach}${c.movement}: exact ${c.exact} ≠ printed ${e}`);
      if (Math.abs(c.inbound + c.outbound - c.exact) > DISTRIBUTION_REPRODUCE_TOL) bad.push(`${label} ${r.signalId} ${c.approach}${c.movement}: in ${c.inbound} + out ${c.outbound} ≠ exact ${c.exact}`);
      if (c.inbound < -1e-12 || c.outbound < -1e-12) bad.push(`${label} ${r.signalId} ${c.approach}${c.movement}: negative side`);
      const ints = (r.movements ?? []).filter((x) => x.approach === c.approach && x.movement === c.movement).reduce((s, x) => s + x.trips, 0);
      if (c.trips !== ints) bad.push(`${label} ${r.signalId} ${c.approach}${c.movement}: trips ${c.trips} ≠ printed ${ints}`);
    }
    if (m.cellDirectionBasis === "proportional" || m.cellDirectionBasis === "none") bad.push(`${label} ${r.signalId}: cell basis ${m.cellDirectionBasis} (recomputation failed to reproduce)`);
    if ((r.movementSource === "path") !== (m.cellDirectionBasis === "ledger")) bad.push(`${label} ${r.signalId}: basis ${m.cellDirectionBasis} for a ${r.movementSource} row`);
    // 3. the split
    if (m.inFraction !== p.inFraction) bad.push(`${label} ${r.signalId}: inFraction ${m.inFraction}`);
    if (r.movementSource === "octant") {
      if (m.splitBasis !== "inFraction" || Math.abs(m.inboundShare - p.inFraction) > 1e-9) bad.push(`${label} ${r.signalId}: octant inbound share ${m.inboundShare} ≠ ${p.inFraction}`);
      if (m.share.ledgerBlend !== null) bad.push(`${label} ${r.signalId}: octant row carries a ledger blend`);
    } else {
      const sumOut = r.pathTurns.reduce((s, t) => s + t.share, 0);
      const sumIn = (r.pathTurnsIn ?? r.pathTurns).reduce((s, t) => s + t.share, 0);
      if (m.splitBasis !== "ledger") bad.push(`${label} ${r.signalId}: path row split basis ${m.splitBasis}`);
      if (Math.abs(m.total.outbound - ext.exact * (1 - p.inFraction) * sumOut) > 1e-6) bad.push(`${label} ${r.signalId}: Σ outbound ${m.total.outbound} ≠ ext × (1 − in) × Σout ${ext.exact * (1 - p.inFraction) * sumOut}`);
      if (Math.abs(m.total.inbound - ext.exact * p.inFraction * sumIn) > 1e-6) bad.push(`${label} ${r.signalId}: Σ inbound ${m.total.inbound} ≠ ext × in × Σin ${ext.exact * p.inFraction * sumIn}`);
      if (r.pathTurnsIn !== undefined) {
        if (m.share.ledgerBlend === null || Math.abs(m.share.ledgerBlend - m.total.exact / ext.exact) > 1e-9) bad.push(`${label} ${r.signalId}: ledgerBlend ${m.share.ledgerBlend} ≠ Σexact ÷ ext ${m.total.exact / ext.exact}`);
      } else if (Math.abs(m.inboundShare - p.inFraction) > 1e-9) bad.push(`${label} ${r.signalId}: mirrored ledger inbound share ${m.inboundShare} ≠ inFraction`);
      // 4. exits / origins
      const sum1 = (l) => l.reduce((s, e) => s + e.fraction, 0);
      if (r.pathTurns.length > 0) {
        if (!m.exits || Math.abs(sum1(m.exits) - 1) > 1e-9) bad.push(`${label} ${r.signalId}: exits Σ ${m.exits && sum1(m.exits)}`);
        else if (Math.abs(m.exits.reduce((s, e) => s + e.trips, 0) - m.total.outbound) > 1e-6) bad.push(`${label} ${r.signalId}: exit trips ≠ Σ outbound`);
      } else if (m.exits !== null) bad.push(`${label} ${r.signalId}: exits on an empty outbound ledger`);
      const inLedger = r.pathTurnsIn ?? r.pathTurns;
      if (inLedger.length > 0) {
        if (!m.origins || Math.abs(sum1(m.origins) - 1) > 1e-9) bad.push(`${label} ${r.signalId}: origins Σ`);
        else if (Math.abs(m.origins.reduce((s, e) => s + e.trips, 0) - m.total.inbound) > 1e-6) bad.push(`${label} ${r.signalId}: origin trips ≠ Σ inbound`);
        if (m.originsMirrored !== (r.pathTurnsIn === undefined)) bad.push(`${label} ${r.signalId}: originsMirrored`);
      } else if (m.origins !== null) bad.push(`${label} ${r.signalId}: origins on an empty inbound ledger`);
    }
    // 5. share of the study
    if (m.share.periodTrips === null || Math.abs(m.share.periodTrips - ext.exact) > 1e-12) bad.push(`${label} ${r.signalId}: period trips`);
    if (Math.abs(m.share.fraction * m.share.periodTrips - m.total.exact) > 1e-9) bad.push(`${label} ${r.signalId}: fraction × period trips ≠ Σ exact`);
    if (m.share.of !== p.affectedIntersections.length || m.share.rank === null || m.share.rank < 1 || m.share.rank > m.share.of) bad.push(`${label} ${r.signalId}: rank ${m.share.rank} of ${m.share.of}`);
    const mine = m.share.ranked.find((x) => x.signalId === r.signalId);
    if (!mine || mine.rank !== m.share.rank || mine.trips !== r.addedTripsPmPeak) bad.push(`${label} ${r.signalId}: ranked entry`);
    const ranks = m.share.ranked.map((x) => x.rank);
    if (new Set(ranks).size !== ranks.length || Math.min(...ranks) !== 1 || Math.max(...ranks) !== ranks.length) bad.push(`${label} ${r.signalId}: ranks not 1..n`);
    const maxTrips = Math.max(...p.affectedIntersections.map((x) => x.addedTripsPmPeak));
    if (m.share.ranked[0].trips !== maxTrips) bad.push(`${label} ${r.signalId}: rank 1 is not the busiest`);
    for (let i = 1; i < m.share.ranked.length; i++) if (m.share.ranked[i].trips > m.share.ranked[i - 1].trips) bad.push(`${label} ${r.signalId}: ranked not descending`);
    if (m.share.loadWeight !== r.loadWeight) bad.push(`${label} ${r.signalId}: loadWeight`);
    if (m.sources.length < 3) bad.push(`${label} ${r.signalId}: ${m.sources.length} source sentences`);
  }
  return { bad, bases, rows, cells };
}

// ---------------------------------------------------------------------------
console.log("\n1–6. fixture A, every row of every peak period");
{
  let rows = 0, cells = 0; const bad = []; const bases = {};
  for (const p of peaks(A)) {
    const t = auditPeriod(A, p, p.period);
    rows += t.rows; cells += t.cells; bad.push(...t.bad);
    for (const [k, v] of Object.entries(t.bases)) bases[k] = (bases[k] ?? 0) + v;
  }
  for (const b of bad.slice(0, 8)) console.log("  " + b);
  ok(bad.length === 0, `${rows} row-periods, ${cells} cells: Σ trips = addedTripsPmPeak, Σ exact = Σ movementsExact (1e-6), approach Σ = printed +Trips, in + out = exact on every cell, split and ledger totals, exits / origins, share and rank — all hold`);
  ok(bases["path/ledger"] === 62 && bases["octant/octant-recomputed"] === 18 && Object.keys(bases).length === 2,
    `bases: ${JSON.stringify(bases)} — every path row's split came from its ledgers, every octant row's from the engine's octant model re-run, none fell back`);
  const pm = A.periodReports.find((p) => p.period === "pm_peak");
  const oneSided = pm.affectedIntersections.filter((r) => r.movementSource === "path" && (r.pathTurns.length === 0 || r.pathTurnsIn.length === 0));
  ok(oneSided.length === 20 && oneSided.every((r) => { const m = distributionForRow(r, pm, A).base; return (r.pathTurns.length === 0) === (m.exits === null) && (r.pathTurnsIn.length === 0) === (m.origins === null) && (r.pathTurns.length === 0 ? m.total.outbound === 0 : m.total.inbound === 0); }),
    `${oneSided.length} one-sided path rows: an empty ledger side yields no exits / origins and a zero side, never a mirror`);
  const recorded = pm.affectedIntersections.filter((r) => r.movementSource === "path" && r.pathTurns.length > 0 && r.pathTurnsIn.length > 0);
  const blendDiffers = recorded.filter((r) => { const m = distributionForRow(r, pm, A).base; return Math.abs(m.inboundShare - pm.inFraction) > 1e-6; });
  ok(recorded.length > 0 && blendDiffers.length > 0, `${blendDiffers.length} of ${recorded.length} two-sided path rows have an inbound share ≠ inFraction ${pm.inFraction} — the recorded inbound ledger's blend, as the engine weights it`);
}

// ---------------------------------------------------------------------------
console.log("\n7. AM ≠ PM, and a row without a period");
{
  const am = A.periodReports.find((p) => p.period === "am_peak"), pm = A.periodReports.find((p) => p.period === "pm_peak");
  let differ = 0;
  for (const r of pm.affectedIntersections) {
    const ra = am.affectedIntersections.find((x) => x.signalId === r.signalId);
    const ma = distributionForRow(ra, am, A).base, mp = distributionForRow(r, pm, A).base;
    if (ma.total.trips !== mp.total.trips || Math.abs(ma.inboundShare - mp.inboundShare) > 1e-9 || ma.period !== "am_peak" || mp.period !== "pm_peak") differ++;
  }
  ok(differ === pm.affectedIntersections.length, `all ${differ} rows differ between AM (inFraction ${am.inFraction}) and PM (${pm.inFraction})`);
  const r0 = pm.affectedIntersections[0];
  const none = distributionForRow(r0, undefined, A).base;
  ok(none.splitBasis === "none" && none.cellDirectionBasis === "none" && none.inFraction === null && none.share.periodTrips === null && none.share.rank === null && none.share.of === 0 && none.total.trips === r0.addedTripsPmPeak && none.cells.every((c) => c.inbound === 0 && c.outbound === 0) && nonFinite(none).length === 0,
    "no period: the cells still cross-foot, no split and no share are claimed, everything finite");
  ok(none.exits !== null && Math.abs(none.exits.reduce((s, e) => s + e.fraction, 0) - 1) < 1e-9 && none.exits.every((e) => e.trips === null),
    "no period: exit octant fractions still come off the ledger, with no trip counts");
  const bare = distributionForRow({ ...r0, movements: undefined, movementsExact: undefined, movementSource: undefined, pathTurns: undefined, pathTurnsIn: undefined }, pm, A).base;
  ok(bare.hasMovements === false && bare.total.trips === 0 && bare.cellDirectionBasis === "none" && bare.splitBasis === "inFraction" && bare.exits === null && nonFinite(bare).length === 0,
    "no movements table: an empty, finite model that says so");
  const noExact = distributionForRow({ ...r0, movementsExact: undefined }, pm, A).base;
  ok(noExact.total.exact === r0.addedTripsPmPeak && noExact.cells.every((c) => c.exact === c.trips) && noExact.sources.some((s) => /integers stand in/.test(s)),
    "no movementsExact (older payload): the integers stand in and the source sentence says so");
}

// ---------------------------------------------------------------------------
console.log("\n8. scenario pairs — the client's size × 1.5 re-solve, and the engine's own B");
{
  const S = solveScenario(A, { ...EMPTY_SCENARIO, size: A.request.size * 1.5 });
  const pS = S.periodReports.find((p) => p.period === "pm_peak"), pA = A.periodReports.find((p) => p.period === "pm_peak");
  ok(pS.externalTripsExact !== undefined && pS.externalTripsExact !== pA.externalTripsExact && Math.abs(pS.externalTripsExact - 1.5 * pA.externalTripsExact) < 1e-6,
    `the scenario period prints its own externalTripsExact ${pS.externalTripsExact.toFixed(3)} (base ${pA.externalTripsExact.toFixed(3)}, × 1.5)`);
  const untouched = solveScenario(A, EMPTY_SCENARIO).periodReports.find((p) => p.period === "pm_peak");
  ok(untouched.externalTripsExact === pA.externalTripsExact && untouched.existingUseCreditExact === pA.existingUseCreditExact, "an untouched trip generation keeps the printed exact values byte-identical");
  let rows = 0; const bad = [];
  for (const p of peaks(S)) {
    const t = auditPeriod(S, p, `scenario ${p.period}`);
    rows += t.rows; bad.push(...t.bad);
  }
  for (const b of bad.slice(0, 8)) console.log("  " + b);
  ok(bad.length === 0, `${rows} scenario row-periods: every cross-foot and recomputation holds against the scenario's own period trips`);
  let paired = 0, moved = 0;
  for (const r of pA.affectedIntersections) {
    const sRow = pS.affectedIntersections.find((x) => x.signalId === r.signalId);
    const m = distributionForRow(r, pA, A, sRow, pS);
    if (m.scenario) { paired++; if (m.scenario.total.trips !== m.base.total.trips) moved++; if (m.scenario.share.periodTrips !== pS.externalTripsExact) bad.push(`${r.signalId}: scenario period trips`); }
  }
  ok(paired === pA.affectedIntersections.length && moved > pA.affectedIntersections.length / 2 && bad.length === 0, `${paired} rows paired with a scenario model, ${moved} with a different trip total, each on the scenario's period trips`);
  // An edit on ANOTHER signal is not a scenario for this one.
  const ra = pA.affectedIntersections[0], rb = pA.affectedIntersections[1];
  const E = solveScenario(A, { ...EMPTY_SCENARIO, timing: { [ra.signalId]: { cycleLenSec: ra.signalTiming.cycleLenSec + 30, nsThroughSplitS: 30, ewThroughSplitS: 30 } } });
  const pE = E.periodReports.find((p) => p.period === "pm_peak");
  const mb = distributionForRow(rb, pA, A, pE.affectedIntersections.find((x) => x.signalId === rb.signalId), pE);
  ok(mb.scenario === null, `${rb.signalId}: an identical scenario row (edit on ${ra.signalId}) yields no scenario model`);
  // The engine's own scenario fixture.
  let rowsB = 0; const badB = [];
  for (const p of peaks(B)) { const t = auditPeriod(B, p, `B ${p.period}`); rowsB += t.rows; badB.push(...t.bad); }
  for (const b of badB.slice(0, 8)) console.log("  " + b);
  ok(badB.length === 0, `fixture B: ${rowsB} row-periods hold the same invariants on the engine's own scenario`);
}

// ---------------------------------------------------------------------------
console.log("\n9. routes through a junction — the map's client-side graph");
{
  const g = buildRoadGraph(roads.segments);
  const site = { lat: A.request.latitude, lon: A.request.longitude };
  const rows = A.affectedIntersections;
  const routes = routesForRows(g, site, rows);
  ok(routes.size === rows.length && [...routes.values()].every((r) => r.pts.length >= 2 && r.lenMi > 0), `${routes.size} site→row routes built on ${g.links.length} links, every one a real polyline`);
  let onOwn = 0, selfListed = 0, withThrough = 0, listed = 0, wrong = 0, notAvailable = 0;
  for (const r of rows) {
    const c = routeContinuationForRow(r, rows, routes);
    if (c.onOwnRoute) onOwn++;
    if (c.through.some((t) => t.signalId === r.signalId)) selfListed++;
    if (c.through.length > 0) withThrough++;
    for (const t of c.through) {
      listed++;
      const d = distToRouteM(routes.get(t.signalId), { lat: r.latitude, lon: r.longitude });
      if (Math.abs(d - t.distanceM) > 1e-9 || d > THROUGH_ROUTE_M) wrong++;
      const src = rows.find((x) => x.signalId === t.signalId);
      if (t.trips !== src.addedTripsPmPeak || t.name !== src.name) wrong++;
    }
    if (Math.abs(c.throughTrips - c.through.reduce((s, t) => s + t.trips, 0)) > 0) wrong++;
    if (c.withinM !== THROUGH_ROUTE_M || c.label !== ROUTE_CONTINUATION_LABEL) wrong++;
    for (let i = 1; i < c.through.length; i++) if (c.through[i].distanceM < c.through[i - 1].distanceM) wrong++;
    if (!c.available) notAvailable++;
  }
  ok(onOwn === rows.length, `every one of the ${rows.length} junctions is on its own route within ${THROUGH_ROUTE_M} m`);
  ok(selfListed === 0, "the continuation list never contains the junction itself");
  ok(wrong === 0 && listed > 0, `${listed} listed continuations: each route really passes within ${THROUGH_ROUTE_M} m (distToRouteM agrees), carries its row's trips and name, nearest first`);
  ok(withThrough > 0 && withThrough < rows.length, `${withThrough} of ${rows.length} junctions have other routes through them, ${rows.length - withThrough} are route ends`);
  ok(notAvailable === 0, "with routes the model is available");
  const none = routeContinuationForRow(rows[0], rows, null);
  ok(none.available === false && none.through.length === 0 && none.onOwnRoute === false, "without routes the model says it is unavailable rather than listing nothing as fact");
  // routesThrough on a straight-line fallback graph still finds the junction on its own route.
  const straight = routesForRows(null, site, rows);
  const selfStraight = rows.filter((r) => routesThrough(straight, { lat: r.latitude, lon: r.longitude }).some((h) => h.signalId === r.signalId)).length;
  ok(selfStraight === rows.length, "straight-line fallback routes: every junction is still on its own route");
  // Point-to-polyline distance: a point 30 m east of a N–S segment reads 30 m.
  const seg = { pts: [{ lat: 33.78, lon: -84.39 }, { lat: 33.79, lon: -84.39 }], cum: [0, 0.69], lenMi: 0.69 };
  const dEast = distToRouteM(seg, { lat: 33.785, lon: -84.39 + 30 / (111195 * Math.cos((33.785 * Math.PI) / 180)) });
  ok(Math.abs(dEast - 30) < 0.05, `distToRouteM: 30 m east of a N–S segment reads ${dEast.toFixed(3)} m`);
  const dBeyond = distToRouteM(seg, { lat: 33.7905, lon: -84.39 });
  ok(Math.abs(dBeyond - 0.0005 * 111195) < 0.1, `distToRouteM: beyond the end it measures to the endpoint (${dBeyond.toFixed(1)} m)`);
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:intersection-distribution passed");
process.exit(failed ? 1 : 0);
