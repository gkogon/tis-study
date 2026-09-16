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
//      says so rather than listing nothing as if it were true;
//  10. review fixes (#220): (A1) the routes survive a new report object —
//      routeContinuationForRow reused across two report objects with the
//      same ids yields the same, available continuation; the map's cache
//      key (routesKeyFor) is blind to report identity and trip values and
//      changes only with the row set or the graph; and the map SOURCE
//      re-announces the routes from its rows effect and neither page clears
//      them on the report (the emit path — components cannot be mounted
//      here); (A2) the rose's dims are classes with a print:opacity-100
//      override, no opacity attribute is driven by the hover / pin, and the
//      per-frame particles are print:hidden; (m2) the continuation carries
//      the trips of the rows it is given (AM ≠ PM, scenario ≠ base); (m3)
//      the printed share is of its own two integers; (m4) the rank sentence
//      names its tie-break; (m7) a scenario row with browser-synthesised
//      ledgers is labelled approximated, reads no exits / origins, still
//      cross-foots, and the base row is never so labelled.
//
// Run: `pnpm run check:intersection-distribution` (plain node 26, no bundler).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  distributionForRow, routeContinuationForRow, periodAssignedTrips, printedPeriodTrips, printedShareFraction,
  DISTRIBUTION_REPRODUCE_TOL, ROUTE_CONTINUATION_LABEL, SECTIONS,
} from "../src/lib/intersection-study-model.ts";
import { buildRoadGraph, routesForRows, routesKeyFor, routesThrough, distToRouteM, THROUGH_ROUTE_M } from "../src/lib/study-map-sim.ts";
import { solveScenario, solveScenarioDetailed, EMPTY_SCENARIO } from "../src/lib/scenario-solve.ts";
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

// ---------------------------------------------------------------------------
console.log("\n10. review fixes (#220)");
const src = (rel) => fs.readFileSync(path.join(here, "..", rel), "utf8");
const clone = (v) => JSON.parse(JSON.stringify(v));
{
  // ---- A1: the §01a continuation survives a new report object with the same ids ----
  const g = buildRoadGraph(roads.segments);
  const site = { lat: A.request.latitude, lon: A.request.longitude };
  const routes = routesForRows(g, site, A.affectedIntersections);
  // A second report object: same study, same ids, new identities and new numbers
  // (an engine what-if or a same-site regenerate hands the page exactly this).
  const A2 = clone(A);
  for (const r of A2.affectedIntersections) r.addedTripsPmPeak += 1;
  const withThrough = A.affectedIntersections.filter((r) => routeContinuationForRow(r, A.affectedIntersections, routes).through.length > 0);
  let reused = 0;
  for (const r of withThrough) {
    const r2 = A2.affectedIntersections.find((x) => x.signalId === r.signalId);
    const c1 = routeContinuationForRow(r, A.affectedIntersections, routes), c2 = routeContinuationForRow(r2, A2.affectedIntersections, routes);
    if (c2.available && c2.through.length === c1.through.length && c2.through.every((t, i) => t.signalId === c1.through[i].signalId && Math.abs(t.distanceM - c1.through[i].distanceM) < 1e-12 && t.trips === c1.through[i].trips + 1)) reused++;
  }
  ok(withThrough.length > 0 && reused === withThrough.length, `A1: the same routes reused across two report objects with the same ids keep the continuation available on all ${withThrough.length} junctions that have one — same routes, the new report's trips`);
  // The map's cache key: blind to report identity and trip values, sensitive to the row set and the graph.
  const rows = A.affectedIntersections, rows2 = A2.affectedIntersections;
  const k = routesKeyFor(g, rows);
  ok(k === routesKeyFor(g, rows2) && k === routesKeyFor(g, clone(rows)), "A1: routesKeyFor is the same for a new report object with the same ids (and new trip values) — the cached routes are kept and re-announced");
  ok(k !== routesKeyFor(g, rows.slice(1)) && k !== routesKeyFor(g, [...rows.slice(1), rows[0]]) && k !== routesKeyFor(null, rows) && k !== routesKeyFor(g, []),
    "A1: routesKeyFor changes when a row is dropped, the order changes, the graph is absent, or there are no rows — those route again");
  // The emit path itself (StudyMapAlive cannot be mounted here): the rows effect re-announces
  // the routes on every report identity change while the key still matches, invalidates
  // them (null) otherwise, and the pages mirror `onRoutes` instead of clearing it on `report`.
  const map = src("src/components/study-map-alive.tsx");
  const rowsEffect = map.slice(map.indexOf("// ---- report rows keyed by signal id"), map.indexOf("// stage list re-render"));
  ok(rowsEffect.length > 0 && /if \(w\.routes && w\.routesKey === routesKeyFor\(w\.graph, \[\.\.\.shown\.values\(\)\]\)\) \{\s*onRoutesRef\.current\?\.\(new Map\(w\.routes\)\);/.test(rowsEffect),
    "A1 (emit path): the map's rows effect re-announces the cached routes when the new report's row set still matches the key");
  ok(/else if \(w\.routes && shown\.size > 0\) \{[^}]*w\.routes = null;[^}]*onRoutesRef\.current\?\.\(null\);/.test(rowsEffect) && /w\.routes = null; w\.routesKey = "";[^\n]*\n\s*onRoutesRef\.current\?\.\(null\);/.test(map),
    "A1 (emit path): the rows effect (a changed row set) and the site effect announce null when they invalidate the routes; an empty row set (pending phase) keeps the cache for the report that follows");
  ok(/onRoutes\?: \(routes: Map<string, Route> \| null\) => void;/.test(map), "A1 (emit path): onRoutes is declared to carry null on invalidation");
  ok(rowsEffect.includes("[phase, report, scenarioReport, reduced, site.latitude, site.longitude]"), "A1 (emit path): the rows effect runs on every report / scenarioReport identity change");
  for (const page of ["src/pages/tis.tsx", "src/pages/demo.tsx"]) {
    const p = src(page);
    ok(!p.includes("setMapRoutes(null)") && p.includes("onRoutes={setMapRoutes}") && p.includes("routesBySignalId={mapRoutes}"),
      `A1 (emit path): ${page} mirrors onRoutes into the study and never clears the routes itself (a clear on [report] raced the map's re-announce in the same commit)`);
  }

  // ---- A2: the rose's pinned dim is class-based with a print override ----
  const rose = src("src/components/trip-distribution-alive.tsx");
  ok(rose.includes("const hovered: Octant | null = hoveredRaw ?? pinned;"), "A2: the pinned sector still feeds the same dim path as a hover (the fix is the print override, not the pin)");
  ok(!/opacity=\{dimmed/.test(rose) && !/opacity=\{hovered/.test(rose), "A2: no SVG opacity ATTRIBUTE is driven by the hover / pin any more");
  const dimClasses = [...rose.matchAll(/dimmed \? "([^"]*)"/g)].map((m) => m[1]);
  ok(dimClasses.length >= 3 && dimClasses.every((c) => /\bopacity-\d+\b/.test(c) && c.includes("print:opacity-100")),
    `A2: every dim (${dimClasses.length}: octant labels, wedges, zone dots) is a class with print:opacity-100 — ${JSON.stringify(dimClasses)}`);
  ok(/hovered === w\.octant \? "fill-blue-500 dark:fill-blue-400 print:fill-blue-500\/60"/.test(rose), "A2: the lit wedge's fill has a print override back to the resting fill");
  ok(/hovered === w\.octant \? "fill-foreground font-semibold print:fill-muted-foreground print:font-normal"/.test(rose), "A2: the lit octant label has a print override back to the resting style");
  ok(/<g aria-hidden className="[^"]*print:hidden"[^>]*>\s*\{Array\.from\(\{ length: PARTICLE_POOL \}/.test(rose), "A2: the particles (opacity written per frame, pin dim included) are print:hidden");
  const card = src("src/components/trip-distribution-card.tsx");
  ok(!/<Card className="[^"]*print:hidden/.test(card), "A2: the distribution card still prints (which is why the dim had to be print-safe)");

  // ---- m2: the continuation carries the trips of the rows it is given ----
  const am = A.periodReports.find((p) => p.period === "am_peak"), pm = A.periodReports.find((p) => p.period === "pm_peak");
  const S = solveScenario(A, { ...EMPTY_SCENARIO, size: A.request.size * 1.5 });
  const pmS = S.periodReports.find((p) => p.period === "pm_peak");
  let amDiffers = 0, scenDiffers = 0, listed = 0;
  for (const r of withThrough) {
    const cPm = routeContinuationForRow(r, pm.affectedIntersections, routes);
    const cAm = routeContinuationForRow(r, am.affectedIntersections, routes);
    const cS = routeContinuationForRow(r, pmS.affectedIntersections, routes);
    listed += cPm.through.length;
    if (cAm.through.length === cPm.through.length && cAm.through.some((t, i) => t.trips !== cPm.through[i].trips)) amDiffers++;
    if (cS.through.length === cPm.through.length && cS.through.some((t, i) => t.trips !== cPm.through[i].trips)) scenDiffers++;
    for (const t of cAm.through) if (t.trips !== am.affectedIntersections.find((x) => x.signalId === t.signalId).addedTripsPmPeak) amDiffers = -1e9;
  }
  ok(amDiffers > 0 && scenDiffers > 0, `m2: given the AM rows the continuation lists AM trips (${amDiffers} of ${withThrough.length} junctions differ from PM), given the scenario's rows its trips (${scenDiffers} differ) — the same routes, ${listed} listings`);
  const dist = src("src/components/intersection-distribution.tsx");
  ok(/const continuationRows = useMemo/.test(dist) && /routeContinuationForRow\(row, continuationRows, routesBySignalId \?\? null\)/.test(dist) && !/routeContinuationForRow\(row, report\.affectedIntersections/.test(dist),
    "m2: the view hands the selected period's (and view's) rows to routeContinuationForRow, not the base PM rows");

  // ---- m3: the printed share is of its own two integers ----
  ok(printedShareFraction(3, 120) === 0.025 && printedShareFraction(3, 0) === null && printedShareFraction(3, null) === null, "m3: printedShareFraction(3, 120) = 2.5 %, null without a printed total");
  ok(printedPeriodTrips({ periodTrips: 119.6, periodTripsPrinted: 120 }) === 120 && printedPeriodTrips({ periodTrips: 119.6, periodTripsPrinted: null }) === 120 && printedPeriodTrips({ periodTrips: null, periodTripsPrinted: null }) === null,
    "m3: printedPeriodTrips is the report's rounded figure, else the exact one rounded, else null");
  let worstGap = 0, checked = 0;
  for (const p of peaks(A)) for (const r of p.affectedIntersections) {
    const m = distributionForRow(r, p, A).base;
    const printedTotal = printedPeriodTrips(m.share);
    const f = printedShareFraction(m.total.trips, printedTotal);
    checked++;
    worstGap = Math.max(worstGap, Math.abs(f - m.share.fraction) * printedTotal);
  }
  ok(checked === 80 && worstGap <= 1, `m3: on all ${checked} row-periods the printed-integer share differs from the exact share by at most 1 ÷ M (worst ${worstGap.toFixed(3)} ÷ M) — the two are printed side by side, each labelled`);
  ok(/pct\(printedShareFraction\(model\.total\.trips, printedPeriodTrips\(s\)\)\)/.test(dist) && /exact share \{\(100 \* s\.fraction\)\.toFixed\(2\)\} %/.test(dist),
    "m3: the sentence prints the integer share and the sources line the exact one");

  // ---- m4: the rank sentence names its tie-break, and the tie-break is real ----
  const r0 = pm.affectedIntersections[0];
  const tie = (id, exact) => ({ ...r0, signalId: id, name: id, addedTripsPmPeak: 10, movements: [{ approach: "NB", movement: "T", trips: 10 }], movementsExact: [{ approach: "NB", movement: "T", exact }] });
  const pTie = { ...pm, affectedIntersections: [tie("X-b", 9.6), tie("X-a", 9.7), tie("X-c", 9.7)] };
  const mt = distributionForRow(pTie.affectedIntersections[0], pTie, A).base;
  ok(mt.share.ranked.map((x) => x.signalId).join() === "X-a,X-c,X-b" && mt.share.rank === 3, `m4: equal addedTripsPmPeak ranks by exact load, then signal id (${mt.share.ranked.map((x) => `${x.signalId} ${x.exact}`).join(", ")})`);
  ok(mt.sources.some((s) => /rank among the 3 rows by addedTripsPmPeak, ties broken by the exact load, then signal id\./.test(s)), "m4: the provenance sentence says so");

  // ---- m5 / m6: the Σ sentence and the map's stats line say what the 60 m test is ----
  ok(/ride routes that come within \{continuation\.withinM\} m of this junction — a point-to-polyline test/.test(dist) && !dist.includes("straight-line fallback") && /ends at the road network's nearest node, more than \$\{continuation\.withinM\} m away/.test(dist),
    "m5 / m6: the Σ sentence names the point-to-polyline test and explains onOwnRoute = false correctly (no 'straight-line fallback')");
  ok(/throughStat\.own \? " \(its own included\)" : `[^`]*more than \$\{THROUGH_ROUTE_M\} m away/.test(map) && /own: set\.has\(id\)/.test(map),
    "m6: the map says '(its own included)' only when the junction's own route is in the set, and says why otherwise");
  // onOwnRoute is false exactly when the own route never comes within 60 m — a straight route never triggers it.
  const straight = routesForRows(null, site, rows);
  ok(rows.every((r) => routeContinuationForRow(r, rows, straight).onOwnRoute), "m6: on straight-line routes every junction is on its own route (distance 0) — a straight line is never the reason for onOwnRoute = false");

  // ---- m7: a scenario row with browser-synthesised ledgers is labelled approximated ----
  // Strip the printed ledgers from one path row (a pre-E2 report) and re-solve: the
  // client synthesises them (rowFallbacks "pathLedger") and §01a must not call them recorded.
  const target = pm.affectedIntersections.find((r) => r.movementSource === "path" && r.pathTurns.length > 0 && r.pathTurnsIn.length > 0);
  const P = clone(A);
  const strip = (r) => { if (r.signalId === target.signalId) { delete r.pathTurns; delete r.pathTurnsIn; } };
  P.affectedIntersections.forEach(strip);
  for (const p of P.periodReports) p.affectedIntersections.forEach(strip);
  const sol = solveScenarioDetailed(P, { ...EMPTY_SCENARIO, size: A.request.size * 1.5 });
  const flags = sol.rowFallbacks.get(target.signalId);
  ok(flags && flags.has("pathLedger"), `m7: ${target.signalId} without printed ledgers is flagged pathLedger by the client solve`);
  const pmP = P.periodReports.find((p) => p.period === "pm_peak"), pmSol = sol.report.periodReports.find((p) => p.period === "pm_peak");
  const baseP = pmP.affectedIntersections.find((r) => r.signalId === target.signalId), scenP = pmSol.affectedIntersections.find((r) => r.signalId === target.signalId);
  ok(Array.isArray(scenP.pathTurns), "m7: the scenario row carries the synthesised ledgers (which is what §01a must label)");
  const m7 = distributionForRow(baseP, pmP, P, scenP, pmSol, { scenarioLedgerSynthesised: flags.has("pathLedger") });
  ok(m7.scenario !== null && m7.scenario.ledgerRecorded === false && m7.scenario.exits === null && m7.scenario.origins === null,
    "m7: with the flag the scenario model says ledgerRecorded = false and reads no exits / origins");
  ok(m7.scenario.sources.some((s) => /^Inbound \/ outbound: approximated — no recorded ledger on this report\./.test(s)) && m7.scenario.sources.some((s) => /^Where they go next: not read — /.test(s)) && !m7.scenario.sources.some((s) => /the engine's own pathMovementLoadsExact, run once per side/.test(s)),
    "m7: the scenario's provenance says approximated, never 'the engine's own ledgers'");
  ok(m7.scenario.cellDirectionBasis === "ledger" && m7.scenario.cells.every((c) => Math.abs(c.inbound + c.outbound - c.exact) <= DISTRIBUTION_REPRODUCE_TOL) && Math.abs(m7.scenario.total.trips - scenP.addedTripsPmPeak) === 0,
    "m7: the approximated split still cross-foots to the scenario row's own cells (they were built from the same ledgers)");
  ok(m7.base.ledgerRecorded === true && m7.base.splitBasis === "inFraction" && m7.base.exits === null, "m7: the base row (no ledger printed) is never labelled synthesised — nothing was synthesised for it");
  const m7off = distributionForRow(baseP, pmP, P, scenP, pmSol);
  ok(m7off.scenario !== null && m7off.scenario.ledgerRecorded === true, "m7: the model trusts the caller's flag — without it the ledgers read as recorded (the study threads ScenarioSolution.rowFallbacks)");
  const mE2 = distributionForRow(target, pm, A, pmS.affectedIntersections.find((r) => r.signalId === target.signalId), pmS, { scenarioLedgerSynthesised: false });
  ok(mE2.base.ledgerRecorded === true && mE2.scenario !== null && mE2.scenario.ledgerRecorded === true && mE2.scenario.exits !== null, "m7: an E2 row's scenario (printed ledgers carried through) stays recorded with its exits");
  const study = src("src/components/intersection-study.tsx");
  ok(/scenarioRowFallbacks\?: ReadonlySet<RowFallback> \| null;/.test(study) && /scenarioLedgerSynthesised=\{model\.scenario && !!scenarioRowFallbacks\?\.has\("pathLedger"\)\}/.test(study),
    "m7: the study takes the solve's rowFallbacks for the signal and hands §01a the pathLedger flag");
  for (const page of ["src/pages/tis.tsx", "src/pages/demo.tsx"]) ok(/scenarioRowFallbacks=\{[^}]*solution\.rowFallbacks\.get\(studyRow\.signalId\)/.test(src(page)), `m7: ${page} threads solution.rowFallbacks into the study`);
  ok(/study-distribution-split-approximated/.test(dist) && /study-distribution-exits-approximated/.test(dist) && /!model\.ledgerRecorded/.test(dist), "m7: the view labels the approximated split and hides exits / origins behind it");

  // ---- m1: the dead code is gone ----
  const tmd = src("src/components/turning-movement-diagram.tsx");
  ok(!/bayW/.test(tmd) && !/label, b \}/.test(tmd) && !/label: Vec; b: number/.test(tmd), "m1: Frame.bayW and arrowPath's unread `b` are gone");
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\ncheck:intersection-distribution passed");
process.exit(failed ? 1 : 0);
