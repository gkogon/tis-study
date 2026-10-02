/**
 * Guard for the deterministic proofread clauses
 * (docs/superpowers/plans/2026-09-30-datum-proofread-phase-1.md).
 *
 * The clauses are pure functions over a saved study record, so they test under
 * plain `node` with no env and no db — the posture of verify-screening-clamp.mjs.
 * Run: `pnpm run check:proofread`
 *
 * Every assertion here has been mutation-checked: for each one there is a
 * one-line break of the clause code that turns it red. An assertion that passes
 * against a broken clause is worse than none, so keep that property when editing.
 * The exceptions are the `precondition [<fixture>.json]` assertions, which test no clause: they pin
 * the premise of a real-payload test (the fixture still holds the sentence, the
 * rounding-edge row, the boilerplate) and go red, naming the fixture, if it stops holding it. They are never skips.
 * Two helper pitfalls this file has already paid for: a helper that silently ignores
 * an argument (an assertion then passes against input nobody edited), and a clause
 * that throws (runClauses reports it as not-run, which satisfies every not-run
 * assertion) — hence the throw guard on the last line.
 *
 * Three kinds of record are used. Hand-built ones isolate one behaviour. `wake-*` are trimmed samples. And
 * `scenario-*.json` are REAL generateTisReport payloads (artifacts/atlanta-tis/scripts/fixtures): a clause
 * is only believed once it is quiet on a correct engine payload and still fires when that payload is broken
 * on exactly the field the clause reads. Four clauses gate on "does the deliverable say this?"; each is
 * tested against the engine's real sentences, because a gate that the engine's own boilerplate satisfies
 * never fires, and one that it can never satisfy always does.
 *
 * Two assertions are the contract every later clause inherits:
 *   - `resolves(...)`: every readPath a clause emits must, resolved against the
 *     record, give back exactly the value recorded beside it. Findings cite
 *     payload paths, and downstream (chat, the model phase) trusts them.
 *   - the contract loop: a finding has a source, what it read, and no field a
 *     machine could apply.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { runClauses: runClausesRaw, ALL_CLAUSES, findingFingerprint, engineStamp, RULES_VERSION } = await import(
  path.resolve(here, "../src/lib/proofread/index.ts")
);
/**
 * runClauses reports a clause that THROWS as not-run ("clause threw: …"), so a clause that crashes on a record
 * satisfies every `status === "not-run"` assertion below. Every run in this file goes through this wrapper, and
 * the last assertion fails if any clause threw on any record (the deliberate `boom` clause excepted).
 * It also collects findings of type UNVERIFIED: no registered clause may emit one, because an unverifiable that is true
 * of every study belongs in a coverage note, not the findings list.
 */
const threw = [];
const unverified = [];
const runClauses = (rec, clauses) => {
  const res = runClausesRaw(rec, clauses);
  if (!clauses) {
    for (const c of res.coverage) if (/clause threw/.test(c.reason ?? "")) threw.push(`${c.clauseId}: ${c.reason}`);
    for (const f of res.findings) if (f.type === "UNVERIFIED") unverified.push(f.clauseId);
  }
  return res;
};
const { delayToLos, LAND_USES } = await import("@workspace/tis-engine-core");
const fixture = (name) =>
  JSON.parse(readFileSync(path.resolve(here, `./fixtures/proofread/${name}.json`), "utf8"));

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const byClause = (res, id) => res.findings.filter((f) => f.clauseId === id);
const cover = (res, id) => res.coverage.find((c) => c.clauseId === id);
const clone = (x) => structuredClone(x);

/**
 * The ONE path shape a clause may emit: `result` or `request`, then `.field` / `[index]` segments. Checked
 * before resolving, because a tolerant resolver would read `result.a.[0].b` or `result.a..b` as if they were
 * well-formed — a malformed path must fail on its own, not only when an exact-path pin happens to cover it.
 */
const PATH_GRAMMAR = /^(result|request)(\.[A-Za-z_]\w*|\[\d+\])+$/;
/** Resolve `result.periodReports[1].affectedIntersections[0].existingVc` against a record. */
const resolve = (obj, p) => {
  if (!PATH_GRAMMAR.test(p)) return undefined;
  let cur = obj;
  for (const m of p.matchAll(/^(\w+)|\.(\w+)|\[(\d+)\]/g)) {
    if (cur === null || cur === undefined) return undefined;
    const key = m[1] ?? m[2];
    cur = key !== undefined ? cur[key] : cur[Number(m[3])];
  }
  return cur;
};
/** Every path a set of findings cites that is malformed, or does not resolve in the record to the value recorded beside it. */
const pathProblems = (findings, r) =>
  findings.flatMap((f) =>
    f.readPaths.flatMap((p) =>
      !PATH_GRAMMAR.test(p.path)
        ? [`${f.clauseId}:${p.path} (malformed path)`]
        : resolve(r, p.path) !== p.value
          ? [`${f.clauseId}:${p.path} (resolves to ${JSON.stringify(resolve(r, p.path))}, recorded ${JSON.stringify(p.value)})`]
          : [],
    ),
  );
/** Every readPath of every finding must be well-formed and resolve, in the record, to the value recorded beside it. */
const resolves = (name, r) => {
  const res = runClauses(r);
  const bad = pathProblems(res.findings, r);
  ok(res.findings.length > 0 && bad.length === 0, `${name}: every readPath resolves to its recorded value (${res.findings.reduce((n, f) => n + f.readPaths.length, 0)} paths${bad.length ? `; ${bad.join("; ")}` : ""})`);
};

/** A minimal record around some intersection rows (and optionally per-period reports). */
const rec = (rows, periodReports = []) => ({
  request: {},
  result: { affectedIntersections: rows, periodReports },
});
const row = (over) => ({ signalId: "s", name: "N", approaches: [], ...over });

const pre230 = fixture("wake-pre-230");
const current = fixture("wake-current");
// The current Wake sample plus a third row whose design No-Build ALSO breaches the ceiling (Build 2.75 sits on top of it).
const withNoBuildBreach = clone(current);
withNoBuildBreach.result.affectedIntersections.push({
  signalId: "raleigh-durham-195473090",
  name: "Sumner Boulevard & Capital Boulevard",
  currentVc: 1.6, existingVc: 1.66, futureVc: 1.7,
  futureDelaySec: 300, futureLos: "F", queue95thFt: 1800,
  designBuildVc: 2.75, designNoBuildVc: 2.61,
  approaches: [],
});

// REAL generateTisReport payloads (artifacts/atlanta-tis/scripts/fixtures/README.md), as study records.
const REAL_DIR = path.resolve(here, "../../atlanta-tis/scripts/fixtures");
const REAL = ["scenario-base", "scenario-overrides", "scenario-network-utdf"];
/**
 * An assertion about the FIXTURE, not about a clause. Red means the fixture no longer holds what a real-payload test
 * needs, so the test would be vacuous; it is never softened into a skip (a check that quietly skips when its input
 * changes is a check that stopped looking). The message names the fixture and the likely cause so nobody reads it as a
 * clause regression.
 */
const FIXTURE_HINT =
  "artifacts/atlanta-tis/scripts/fixtures was probably regenerated (make-scenario-fixtures.mjs) and no longer exercises this clause — a fixture change, not evidence that a clause broke";
const pre = (file, cond, what) => ok(cond, `precondition [${file}.json]: ${what} — ${FIXTURE_HINT}`);
const realRec = (name) => {
  const r = JSON.parse(readFileSync(path.resolve(REAL_DIR, `${name}.json`), "utf8"));
  return { request: r.request, result: r };
};
/** Apply fn to every row array the record carries: the top-level PM block and each period report. */
const eachRows = (r, fn) => {
  fn(r.result.affectedIntersections);
  for (const p of r.result.periodReports ?? []) fn(p.affectedIntersections);
};
// The real base payload, broken once for each of the twelve clauses, so the contract loop sees every clause fire.
const everyClause = realRec("scenario-base");
{
  const r = everyClause.result;
  r.growthSource = "Per-metro historical AADT layer"; // request.growthRatePct is an override; this is not tagged as one
  r.growthMultiplierExact = 1.5;
  r.tripGeneration.pmPeakTrips = 999;
  r.tripGeneration.landUseCode = "820";
  r.passByPctApplied = 30; // and no finding mentions pass-by
  r.findings = r.findings.filter((f) => !/TIS guidance/.test(f)); // the one sentence that names the DOT
  r.periodReports = r.periodReports.filter((p) => p.period !== "daily"); // requested, never reported
  eachRows(everyClause, (rows) => {
    rows[0].futureLos = "A"; // 300 s is not LOS A
    rows[1].designNoBuildVc = 2.6;
    rows[1].approaches[0].existingVc = 3.3;
    rows[2].designBuildVc = 2.9;
    rows[2].designNoBuildVc = 1.0;
  });
}

/** The twelve clauses Phase 1 ships, by id. Named here so a clause that was never registered fails an assertion instead of being skipped by one. */
const TWELVE = [
  "growthOverrideDisclosed", "growthMultiplierReproduces", "rateReproducesTotal", "passByBasisNamed",
  "vcPlausibilityIntersection", "vcPlausibilityApproach", "vcPlausibilityDesignYear",
  "losMatchesDelay", "screeningClampDisclosed", "criteriaNamed", "periodScopeDisclosed", "scopeNoteConsistent",
];

const SRC_INTERSECTION = "lib/tis-engine-core/src/signal-delay.ts — PLAUSIBLE_MAX_INTERSECTION_VC = 2.5";
const SRC_APPROACH =
  "lib/tis-engine-core/src/signal-delay.ts — PLAUSIBLE_MAX_INTERSECTION_VC (2.5), authored for intersection v/c; applied here to per-approach v/c on the approach's own lane capacity as a screen";
const SRC_DESIGN =
  "lib/tis-engine-core/src/signal-delay.ts — PLAUSIBLE_MAX_INTERSECTION_VC (2.5), authored for current and opening-year no-project intersection v/c; applied here to design-year scenarios as a screen";

// --- every clause obeys the finding contract -------------------------------
// The loop runs over the findings of four records so that every clause and both design-year
// outcomes (BLOCKER and DISCLOSE) are contract-checked, and a final assertion fails if any registered
// clause never reached the loop. The fourth is a real payload broken once per clause (`everyClause`).
{
  const res = runClauses(pre230);
  const all = [...res.findings, ...runClauses(current).findings, ...runClauses(withNoBuildBreach).findings, ...runClauses(everyClause).findings];
  ok(res.findings.length > 0, `pre-#230 Wake produces findings (${res.findings.length})`);
  const seen = new Set(all.map((f) => f.clauseId));
  ok(ALL_CLAUSES.every((c) => seen.has(c.id)), `contract loop reaches every registered clause (${[...seen].join(", ")})`);
  const ALLOWED = ["clauseId", "section", "type", "title", "detail", "sourceLabel", "readPaths", "remedy", "audience"];
  for (const f of all) {
    const tag = `${f.clauseId}/${f.type}`;
    ok(typeof f.sourceLabel === "string" && f.sourceLabel.length > 0, `${tag}: names a source`);
    ok(
      Array.isArray(f.readPaths) &&
        f.readPaths.length > 0 &&
        f.readPaths.every((p) => typeof p.path === "string" && p.path.length > 0 && (p.value === null || ["string", "number", "boolean"].includes(typeof p.value))),
      `${tag}: records what it read (path + scalar value)`,
    );
    ok(!("patch" in f) && !("replacement" in f), `${tag}: advisor only — no patch field`);
    ok(Object.keys(f).every((k) => ALLOWED.includes(k)), `${tag}: no field outside the finding contract (no suggested value of any name)`);
    ok(["BLOCKER", "DEFECT", "DISCLOSE", "NOTE", "UNVERIFIED", "CONTESTED"].includes(f.type), `${tag}: known type`);
  }
  ok(res.coverage.length === ALL_CLAUSES.length, `coverage has one entry per clause (${res.coverage.length})`);
  ok(res.coverage.map((c) => c.clauseId).join() === ALL_CLAUSES.map((c) => c.id).join(), "coverage names the registered clauses, in order");
  for (const c of res.coverage) {
    ok(c.status === "ran" || (c.status === "not-run" && !!c.reason), `${c.clauseId}: not-run carries a reason`);
  }
}

// --- every readPath is literal: it resolves in the record to the value recorded ----
{
  resolves("pre-#230 Wake", pre230);
  resolves("current Wake", current);
  resolves("current Wake + a No-Build breach row", withNoBuildBreach);
}

// --- coverage is honest: absent input is not-run, never "ran clean" ---------
{
  const res = runClauses(pre230); // rows carry no approach detail and no design-year scenario
  ok(cover(res, "vcPlausibilityIntersection")?.status === "ran", "pre-#230: intersection clause ran");
  ok(cover(res, "vcPlausibilityApproach")?.status === "not-run", "pre-#230: no approach detail → approach clause is not-run, not ran-clean");
  ok(cover(res, "vcPlausibilityDesignYear")?.status === "not-run", "pre-#230: no design-year scenario → design-year clause is not-run, not ran-clean");
  const res2 = runClauses(current);
  const VC = ["vcPlausibilityIntersection", "vcPlausibilityApproach", "vcPlausibilityDesignYear"];
  ok(VC.every((id) => cover(res2, id)?.status === "ran"), "current Wake: all three v/c clauses ran");
  const empty = runClauses({ request: {}, result: {} });
  ok(empty.findings.length === 0 && empty.coverage.every((c) => c.status === "not-run" && c.reason), "a record with no rows: every clause not-run with a reason");
  ok(empty.coverage.every((c) => !/threw/.test(c.reason)), "on a record with nothing in it no clause crashes — each declines with its own reason");
  const REASON = { growthOverrideDisclosed: /override/, growthMultiplierReproduces: /growthMultiplierExact/, rateReproducesTotal: /tripGeneration/, passByBasisNamed: /registry/, losMatchesDelay: /affectedIntersections/, screeningClampDisclosed: /affectedIntersections/, criteriaNamed: /agenc/, periodScopeDisclosed: /periodReports/, scopeNoteConsistent: /intersectionsInStudyArea/ };
  ok(Object.entries(REASON).every(([id, re]) => re.test(cover(empty, id)?.reason ?? "")), "…and the reason each new clause gives for an empty record names the input it needed");
  const boom = runClauses(pre230, [{ id: "boom", section: 4, title: "t", run: () => { throw new Error("kaput"); } }]);
  ok(
    boom.findings.length === 0 && boom.coverage[0].status === "not-run" && /kaput/.test(boom.coverage[0].reason),
    "a clause that throws becomes not-run with the reason — never a finding, never a crash",
  );
}

// --- a clause's declared input is a NUMBER, not the presence of an array ------
{
  // Rows that carry no v/c at all.
  const bare = runClauses(rec([row({}), row({})]));
  ok(
    cover(bare, "vcPlausibilityIntersection")?.status === "not-run" && /numeric currentVc\/existingVc/.test(cover(bare, "vcPlausibilityIntersection").reason),
    "rows with no v/c at all → intersection clause not-run (reason names the missing numbers), not ran-clean",
  );
  const noApprVc = runClauses(rec([row({ approaches: [{ direction: "NB" }] })]));
  ok(
    cover(noApprVc, "vcPlausibilityApproach")?.status === "not-run" && /numeric currentVc\/existingVc/.test(cover(noApprVc, "vcPlausibilityApproach").reason),
    "approaches with no v/c → approach clause not-run, not ran-clean",
  );

  // Non-numeric currentVc beside a real existingVc: the NaN trap for text, not just for absence.
  const text = runClauses(rec([row({ currentVc: "n/a", existingVc: 8.68 })]));
  const th = byClause(text, "vcPlausibilityIntersection");
  ok(th.length === 1 && th[0].readPaths[0].value === 8.68 && th[0].readPaths[0].path === "result.affectedIntersections[0].existingVc", 'currentVc "n/a" beside existingVc 8.68 still fires, on the existingVc it could read');
  const textOnly = runClauses(rec([row({ currentVc: "n/a" })]));
  ok(cover(textOnly, "vcPlausibilityIntersection")?.status === "not-run" && byClause(textOnly, "vcPlausibilityIntersection").length === 0, 'currentVc "n/a" and nothing else → not-run, not ran-clean');
  const textAppr = byClause(runClauses(rec([row({ approaches: [{ direction: "EB", currentVc: "n/a", existingVc: 3.4 }] })])), "vcPlausibilityApproach");
  ok(textAppr.length === 1 && textAppr[0].readPaths[0].value === 3.4, 'an approach with currentVc "n/a" beside existingVc 3.4 still fires');

  // null design fields are absent, not scenarios at v/c 0.
  const nullDesign = runClauses(rec([row({ designNoBuildVc: null, designBuildVc: null })]));
  ok(cover(nullDesign, "vcPlausibilityDesignYear")?.status === "not-run" && /numeric designNoBuildVc\/designBuildVc/.test(cover(nullDesign, "vcPlausibilityDesignYear").reason), "null design fields → design-year clause not-run, not ran-clean");
  const mixed = byClause(runClauses(rec([row({ designNoBuildVc: null, designBuildVc: null }), row({ name: "Real", designNoBuildVc: 2.6 })])), "vcPlausibilityDesignYear");
  ok(
    mixed.length === 1 && /1 of 1 design-year No-Build scenarios/.test(mixed[0].detail) && /Not judged: 1 design-year No-Build scenarios with no numeric designNoBuildVc/.test(mixed[0].detail),
    "a null design field is not counted as a scenario at v/c 0: 1 of 1 judged, 1 reported not judged",
  );

  // One offender among 20 rows, 19 unreadable: the finding says so.
  const sparse = [row({ name: "Real", existingVc: 3.0, approaches: [{ direction: "NB", existingVc: 3.3 }] })];
  for (let i = 0; i < 19; i++) sparse.push(row({ name: `Bare${i}`, approaches: [{ direction: "NB" }] }));
  const sp = runClauses(rec(sparse));
  const sh = byClause(sp, "vcPlausibilityIntersection")[0];
  ok(sh && /1 of 1 study intersections/.test(sh.detail) && /Not judged: 19 study intersections with no numeric currentVc\/existingVc/.test(sh.detail), "intersection: 1 offender, 19 unreadable rows → '1 of 1' and 'Not judged: 19'");
  const sa = byClause(sp, "vcPlausibilityApproach")[0];
  ok(sa && /1 of 1 study approaches/.test(sa.detail) && /Not judged: 19 study approaches with no numeric currentVc\/existingVc/.test(sa.detail), "approach: 1 offender, 19 unreadable approaches → '1 of 1' and 'Not judged: 19'");
  const dsp = [row({ name: "Real", designNoBuildVc: 2.6 })];
  for (let i = 0; i < 19; i++) dsp.push(row({ name: `Bare${i}` }));
  const sd = byClause(runClauses(rec(dsp)), "vcPlausibilityDesignYear")[0];
  ok(sd && /1 of 1 design-year No-Build scenarios/.test(sd.detail) && /Not judged: 19 design-year No-Build scenarios/.test(sd.detail), "design-year: 1 offender, 19 rows without a design scenario → '1 of 1' and 'Not judged: 19'");
  ok(!/Not judged/.test(byClause(runClauses(pre230), "vcPlausibilityIntersection")[0].detail), "no 'Not judged' sentence when every row was judged");
}

// --- the denominator says what it counts -----------------------------------
{
  const ten = () => Array.from({ length: 10 }, (_, i) => row({ name: `I${i}`, existingVc: i === 0 ? 3.0 : 1.0 }));
  // 10 intersections analysed in PM and AM: 20 intersection-period rows.
  const two = byClause(runClauses(rec(ten(), [{ period: "pm_peak", affectedIntersections: ten() }, { period: "am_peak", affectedIntersections: ten() }])), "vcPlausibilityIntersection")[0];
  ok(
    two && /2 of 20 study intersections \(counted once per analysis period, across 2 periods\)/.test(two.detail),
    "two periods of 10 intersections read '2 of 20 … counted once per analysis period, across 2 periods', not '2 of 20 study intersections'",
  );
  // A period whose rows could not be read is not a period the count spans.
  const unreadable = byClause(runClauses(rec(ten(), [{ period: "am_peak", affectedIntersections: [row({}), row({})] }])), "vcPlausibilityIntersection")[0];
  ok(unreadable && /1 of 10 study intersections report/.test(unreadable.detail) && /Not judged: 2 study intersections/.test(unreadable.detail), "a period with no readable rows is not counted among the periods (no 'across 2 periods')");
  const one = byClause(runClauses(rec(ten())), "vcPlausibilityIntersection")[0];
  ok(one && /1 of 10 study intersections report/.test(one.detail) && !/counted once per analysis period/.test(one.detail), "one period of 10 reads plainly '1 of 10 study intersections'");
}

// --- §4 intersection-level v/c (the Wake failure mode) --------------------
{
  const res = runClauses(pre230);
  const hits = byClause(res, "vcPlausibilityIntersection");
  ok(hits.length === 1, `intersection v/c fires once with all offenders (${hits.length})`);
  ok(hits[0].type === "BLOCKER", "implausible background v/c is a BLOCKER");
  // The clause judges max(currentVc, existingVc) per row, as the engine guard does, so each row's
  // reported value is its existingVc here (2.9, 2.98, 3.94, 2.64, 3.3) — not the lower currentVc.
  ok(/3\.94/.test(hits[0].detail) && /2\.64/.test(hits[0].detail), "detail names the worst (3.94) and the mildest (2.64) offending value");
  ok(!/3\.93|2\.84/.test(hits[0].detail), "detail reports the judged (max of current/existing) value, not the lower currentVc");
  ok(/Fox Rd\. & Old Wake Forest \[pm_peak\] \(v\/c 3\.94\)/.test(hits[0].detail), "detail names the worst offender by intersection, period and value");
  ok(/5 of 5 study intersections/.test(hits[0].detail), "detail counts offenders against the rows examined");
  ok(hits[0].readPaths.length === 5, `readPaths cover exactly the offending rows (${hits[0].readPaths.length})`);
  ok(
    hits[0].readPaths.map((p) => p.value).join() === "3.94,3.3,2.98,2.9,2.64",
    "readPaths carry the judged values, worst first",
  );
  ok(
    hits[0].readPaths.map((p) => p.path).join() ===
      "result.affectedIntersections[2].existingVc,result.affectedIntersections[4].existingVc,result.affectedIntersections[1].existingVc,result.affectedIntersections[0].existingVc,result.affectedIntersections[3].existingVc",
    "readPaths are literal payload paths at field granularity (the existingVc that produced each max)",
  );
  // The path names the field that PRODUCED the max.
  const cur = byClause(runClauses(rec([row({ currentVc: 3.0, existingVc: 2.7 })])), "vcPlausibilityIntersection")[0];
  ok(cur && cur.readPaths[0].path === "result.affectedIntersections[0].currentVc" && cur.readPaths[0].value === 3.0, "when currentVc is the higher field the path names currentVc");
}

// --- the silent-NaN case: one of the two scenario fields absent -------------
{
  const hits = byClause(runClauses(rec([row({ existingVc: 8.68, futureVc: 8.7 })])), "vcPlausibilityIntersection");
  ok(hits.length === 1, "a row with existingVc 8.68 and no currentVc still fires (Math.max NaN trap)");
  const hits2 = byClause(runClauses(rec([row({ currentVc: 8.68 })])), "vcPlausibilityIntersection");
  ok(hits2.length === 1, "a row with currentVc 8.68 and no existingVc still fires");
}

// --- the ceiling is exclusive, and the project's own effect is not judged ---
{
  const at = runClauses(rec([row({ currentVc: 2.0, existingVc: 2.5 })]));
  ok(byClause(at, "vcPlausibilityIntersection").length === 0 && cover(at, "vcPlausibilityIntersection").status === "ran", "v/c exactly at the 2.5 ceiling is clean (the engine guard's `>`)");
  const over = runClauses(rec([row({ currentVc: 2.0, existingVc: 2.51 })]));
  ok(byClause(over, "vcPlausibilityIntersection").length === 1, "v/c 2.51 is over the ceiling");
  // futureVc is the opening-year BUILD scenario: a high value there is the project's effect, not a background defect.
  const future = runClauses({
    request: {},
    result: {
      affectedIntersections: [
        row({ currentVc: 1.0, existingVc: 1.1, futureVc: 3.5, approaches: [{ direction: "NB", currentVc: 1.0, existingVc: 1.1, futureVc: 3.6 }] }),
      ],
      periodReports: [],
    },
  });
  ok(byClause(future, "vcPlausibilityIntersection").length === 0, "futureVc (Build) above the ceiling does not fire the intersection clause");
  ok(byClause(future, "vcPlausibilityApproach").length === 0, "futureVc (Build) above the ceiling does not fire the approach clause");
  ok(cover(future, "vcPlausibilityIntersection").status === "ran" && cover(future, "vcPlausibilityApproach").status === "ran", "…and both clauses ran rather than skipping");
}

// --- §4 approach: silent today, must fire ----------------------------------
{
  const res = runClauses(current);
  ok(byClause(res, "vcPlausibilityIntersection").length === 0 && cover(res, "vcPlausibilityIntersection").status === "ran", "current Wake is clean at intersection level (max 1.87) — and the clause ran");
  const appr = byClause(res, "vcPlausibilityApproach");
  ok(appr.length === 1, "approach-level v/c fires on the current Wake sample");
  // judged value = max(currentVc, existingVc): NB 3.27 (Oak Forest) and NB 3.16 (Spring Forest). The Build
  // values on the same rows (3.34, 3.18) must not appear.
  ok(
    /Oak Forest Drive & Capital Boulevard NB \[pm_peak\] \(v\/c 3\.27\)/.test(appr[0].detail) &&
      /Spring Forest Road & Capital Boulevard NB \[pm_peak\] \(v\/c 3\.16\)/.test(appr[0].detail),
    "approach detail names both NB approaches above the ceiling, by intersection, direction and value (3.27, 3.16)",
  );
  ok(!/3\.34|3\.18/.test(appr[0].detail), "approach detail does not report the Build (futureVc) values");
  ok(!/SB/.test(appr[0].detail) && /2 of 3 study approaches/.test(appr[0].detail), "the compliant SB approach is counted but not named (2 of 3)");
  ok(
    appr[0].readPaths.map((p) => p.path).join() ===
      "result.affectedIntersections[1].approaches[0].existingVc,result.affectedIntersections[0].approaches[0].existingVc",
    "approach readPaths are literal and name the approach field that produced each max, worst first",
  );
  // An offender that is not the first approach: the index in the path is the approach's own.
  const second = rec([row({ approaches: [{ direction: "SB", existingVc: 0.8 }, { direction: "EB", currentVc: 1.0, existingVc: 3.6 }] })]);
  const sec = byClause(runClauses(second), "vcPlausibilityApproach")[0];
  ok(sec && sec.readPaths.length === 1 && sec.readPaths[0].path === "result.affectedIntersections[0].approaches[1].existingVc" && /EB/.test(sec.detail), "an offending approach at index 1 is addressed as approaches[1]");
  resolves("offender at approach index 1", second);
  const apprPartial = byClause(runClauses(rec([row({ approaches: [{ direction: "EB", existingVc: 3.4 }] })])), "vcPlausibilityApproach");
  ok(apprPartial.length === 1, "an approach with only existingVc 3.4 (no currentVc) still fires");
}

// --- §4 design-year: BLOCKER for No-Build, DISCLOSE for a Build-only breach --
{
  const res = runClauses(current);
  const dy = byClause(res, "vcPlausibilityDesignYear");
  ok(dy.length === 1, "design-year fires once on the current Wake sample (designBuildVc 2.54)");
  ok(dy[0].type === "DISCLOSE", "Wake: Build 2.54 over the ceiling while No-Build 2.49 is under it is a DISCLOSE, not a BLOCKER");
  ok(
    dy[0].readPaths.map((p) => `${p.path}=${p.value}`).join() ===
      "result.affectedIntersections[0].designBuildVc=2.54,result.affectedIntersections[0].designNoBuildVc=2.49",
    "the DISCLOSE reads the Build value and the No-Build value its claim rests on, by literal path",
  );
  ok(/1 of 2 design-year Build scenarios/.test(dy[0].detail), "design-year Build detail counts 1 of 2 Build scenarios");
  ok(/Spring Forest Road & Capital Boulevard Design Build \[pm_peak\] \(v\/c 2\.54; design No-Build 2\.49\)/.test(dy[0].detail), "design-year detail names the scenario (Design Build), period, value and the No-Build beside it");
  ok(!/report a no-project/.test(dy[0].detail), "design-year detail does not call a Build value 'no-project'");
  ok(/appears only once the project's trips are added/.test(dy[0].detail) && /must be disclosed as such rather than presented as estimates/.test(dy[0].detail), "DISCLOSE prose: breach appears only with the project's trips; results must be disclosed, not presented as estimates");
  ok(!/limited-access|background volume/.test(dy[0].detail), "DISCLOSE does not blame the background volume");
  ok(!/Oak Forest/.test(dy[0].detail), "Oak Forest (Build 2.41, under the ceiling) is not named");

  // No-Build ALSO over the ceiling: a BLOCKER for the No-Build, and the Build on the same row is not reported twice.
  const both = runClauses(withNoBuildBreach);
  const bdy = byClause(both, "vcPlausibilityDesignYear");
  ok(bdy.length === 2 && bdy[0].type === "BLOCKER" && bdy[1].type === "DISCLOSE", "No-Build breach + Wake Build-only breach: one BLOCKER and one DISCLOSE");
  ok(bdy[0].readPaths.length === 1 && bdy[0].readPaths[0].path === "result.affectedIntersections[2].designNoBuildVc" && bdy[0].readPaths[0].value === 2.61, "BLOCKER reads only the No-Build 2.61");
  ok(/1 of 3 design-year No-Build scenarios/.test(bdy[0].detail) && /Sumner Boulevard & Capital Boulevard Design No-Build \[pm_peak\] \(v\/c 2\.61\)/.test(bdy[0].detail), "BLOCKER names the No-Build scenario and counts it against the 3 No-Build scenarios");
  ok(!/2\.75/.test(bdy[0].detail + bdy[1].detail) && !bdy.some((f) => f.readPaths.some((p) => p.value === 2.75)), "the Build 2.75 that sits on top of the No-Build breach is not reported a second time");
  ok(!/Sumner/.test(bdy[1].detail) && /1 of 3 design-year Build scenarios/.test(bdy[1].detail), "the DISCLOSE covers only the Build-only row (Spring Forest), counted against 3 Build scenarios");
  resolves("No-Build breach record", withNoBuildBreach);

  const nb = byClause(runClauses(rec([row({ designNoBuildVc: 2.6 })])), "vcPlausibilityDesignYear");
  ok(nb.length === 1 && nb[0].type === "BLOCKER" && nb[0].readPaths[0].path === "result.affectedIntersections[0].designNoBuildVc", "designNoBuildVc alone above the ceiling is a BLOCKER");
  const bothOver = byClause(runClauses(rec([row({ designNoBuildVc: 2.6, designBuildVc: 2.7 })])), "vcPlausibilityDesignYear");
  ok(bothOver.length === 1 && bothOver[0].type === "BLOCKER" && bothOver[0].readPaths.length === 1, "No-Build and Build both over on one row: one BLOCKER, the Build not reported again");
  const atCeiling = byClause(runClauses(rec([row({ designNoBuildVc: 2.5, designBuildVc: 2.7 })])), "vcPlausibilityDesignYear");
  ok(atCeiling.length === 1 && atCeiling[0].type === "DISCLOSE", "No-Build exactly at the ceiling is not over it: Build 2.7 is a DISCLOSE");
  const buildAlone = byClause(runClauses(rec([row({ designBuildVc: 2.7 })])), "vcPlausibilityDesignYear");
  ok(
    buildAlone.length === 1 && buildAlone[0].type === "DISCLOSE" && buildAlone[0].readPaths.length === 1 && /no design No-Build reported/.test(buildAlone[0].detail) && /cannot be confirmed/.test(buildAlone[0].detail),
    "Build over with no design No-Build on record is still reported (DISCLOSE) and says the attribution cannot be confirmed",
  );
  const clean = runClauses(rec([row({ designNoBuildVc: 2.4, designBuildVc: 2.5 })]));
  ok(byClause(clean, "vcPlausibilityDesignYear").length === 0 && cover(clean, "vcPlausibilityDesignYear").status === "ran", "design-year v/c at or under the ceiling is clean, and the clause ran");
}

// --- what each finding claims, and where it says the ceiling comes from -----
{
  const i = byClause(runClauses(pre230), "vcPlausibilityIntersection")[0];
  const a = byClause(runClauses(current), "vcPlausibilityApproach")[0];
  const d = byClause(runClauses(withNoBuildBreach), "vcPlausibilityDesignYear");
  ok(i.sourceLabel === SRC_INTERSECTION, "intersection source label is exactly the engine constant at the ceiling applied");
  ok(a.sourceLabel === SRC_APPROACH, "approach source label states the ceiling is authored for intersection v/c and applied to approaches as a screen");
  ok(d.length === 2 && d.every((f) => f.sourceLabel === SRC_DESIGN), "design-year source labels state the ceiling is applied outside its authored scope as a screen");
  ok(/above 2\.5, which no at-grade signalized location can operate at/.test(i.detail), "intersection detail states the ceiling (2.5) and the engine's own claim");
  ok(/above 2\.5\. That ceiling was authored for intersection v\/c; it is applied here to per-approach v\/c/.test(a.detail), "approach detail says the ceiling was authored for intersection v/c and is a screen here");
  ok(!/no at-grade signalized location/.test(a.detail) && d.every((f) => !/no at-grade signalized location/.test(f.detail)), "approach and design-year details do not claim what no at-grade location can do");
  ok(/above 2\.5\. That ceiling was authored for current and opening-year/.test(d[0].detail) && /above 2\.5 while the same row's design No-Build v\/c does not/.test(d[1].detail), "design-year details state the ceiling (2.5) and its authored scope");
  ok(/no-project v\/c above/.test(a.detail) && /no-project v\/c above/.test(i.detail), "intersection and approach details say 'no-project' (they judge only the no-project scenarios)");
  ok(d[0].remedy !== d[1].remedy && /beyond the screening model's validity/.test(d[1].remedy), "the DISCLOSE carries its own remedy (disclose, not 'replace the counts')");
}

// --- rows live in two places; both are scanned, the PM mirror is counted once
{
  // An offender only in a non-PM period report.
  const am = rec(
    [row({ name: "PM", existingVc: 1.0 })],
    [{
      period: "am_peak",
      affectedIntersections: [row({ name: "AM-only", existingVc: 3.1, designBuildVc: 2.9, approaches: [{ direction: "EB", existingVc: 3.2 }] })],
    }],
  );
  const r = runClauses(am);
  for (const id of ["vcPlausibilityIntersection", "vcPlausibilityApproach", "vcPlausibilityDesignYear"]) {
    const h = byClause(r, id);
    ok(h.length === 1 && /^result\.periodReports\[0\]\.affectedIntersections\[0\]\./.test(h[0].readPaths[0].path) && /AM-only/.test(h[0].detail) && /\[am_peak\]/.test(h[0].detail), `${id}: an offender found only in periodReports[am_peak] fires, with a literal periodReports path`);
  }
  resolves("AM-only record", am);

  // The engine writes the PM rows to BOTH result.affectedIntersections and periodReports[pm_peak].
  const offender = row({ name: "Mirror", existingVc: 3.0, designBuildVc: 2.9, approaches: [{ direction: "NB", existingVc: 3.2 }] });
  const mirrored = rec([clone(offender)], [{ period: "pm_peak", affectedIntersections: [clone(offender)] }]);
  const m = runClauses(mirrored);
  for (const id of ["vcPlausibilityIntersection", "vcPlausibilityApproach", "vcPlausibilityDesignYear"]) {
    const h = byClause(m, id);
    ok(h.length === 1 && h[0].readPaths.length === 1 && /1 of \d+ /.test(h[0].detail) && !/2 of/.test(h[0].detail), `${id}: the mirrored PM rows are counted once, not twice`);
  }
  resolves("mirrored PM record", mirrored);
  // PM + AM both analysed: two distinct offenders, not three.
  const both = rec(
    [clone(offender)],
    [
      { period: "pm_peak", affectedIntersections: [clone(offender)] },
      { period: "am_peak", affectedIntersections: [row({ name: "AM", existingVc: 3.1 })] },
    ],
  );
  const bh = byClause(runClauses(both), "vcPlausibilityIntersection");
  ok(bh.length === 1 && bh[0].readPaths.length === 2 && /2 of 2 study intersections/.test(bh[0].detail), "PM mirror + AM report: 2 offenders of 2 rows (no phantom third)");
  resolves("PM mirror + AM record", both);

  // PM excluded from analysisPeriods: the engine synthesizes the top-level block and there is no pm_peak report.
  const synth = rec([row({ name: "Synth", existingVc: 3.0 })], [{ period: "am_peak", affectedIntersections: [row({ name: "Fine", existingVc: 1.0 })] }]);
  const sy = byClause(runClauses(synth), "vcPlausibilityIntersection");
  ok(sy.length === 1 && /Synth/.test(sy[0].detail) && /1 of 2 study intersections/.test(sy[0].detail), "with no pm_peak report, the top-level rows are still scanned");
  resolves("PM-excluded record", synth);

  // k is the entry's real index in periodReports, not its position among entries that have rows.
  const skipFirst = rec(
    [row({ name: "Top", existingVc: 1.0 })],
    [{ period: "midday" }, { period: "am_peak", affectedIntersections: [row({ name: "Late", existingVc: 3.0 })] }],
  );
  const sk = byClause(runClauses(skipFirst), "vcPlausibilityIntersection")[0];
  ok(sk && sk.readPaths[0].path === "result.periodReports[1].affectedIntersections[0].existingVc", "periodReports[k] uses the entry's real index when an earlier entry has no rows");
  resolves("periodReports with a rowless first entry", skipFirst);
}

// --- fingerprints are stable and discriminating ---------------------------
{
  const a = runClauses(current);
  const b = runClauses(current);
  ok(
    a.findings.map(findingFingerprint).join(",") === b.findings.map(findingFingerprint).join(","),
    "fingerprints are stable across runs on the same record",
  );
  ok(a.findings.length >= 2 && new Set(a.findings.map(findingFingerprint)).size === a.findings.length, `every finding on one record has its own fingerprint (${a.findings.length} findings across ${new Set(a.findings.map((f) => f.clauseId)).size} clauses)`);
  ok(a.findings.every((f) => /^[0-9a-f]{8}$/.test(findingFingerprint(f))), "a fingerprint is 8 hex digits");

  // Same clause, same rows, one value moved: the finding is no longer the same finding.
  const moved = clone(pre230);
  moved.result.affectedIntersections[2].existingVc = 4.2;
  const before = findingFingerprint(byClause(runClauses(pre230), "vcPlausibilityIntersection")[0]);
  const after = findingFingerprint(byClause(runClauses(moved), "vcPlausibilityIntersection")[0]);
  ok(before !== after, "same clause, one value changed → a different fingerprint");

  // Identity is what was read, not how it is worded: a copy edit must not reopen a WITHDRAWN item.
  const f = byClause(runClauses(pre230), "vcPlausibilityIntersection")[0];
  ok(findingFingerprint({ ...f, title: "reworded", detail: "reworded", remedy: "reworded" }) === findingFingerprint(f), "rewording title/detail/remedy keeps the fingerprint");
  ok(findingFingerprint({ ...f, readPaths: [...f.readPaths].reverse() }) === findingFingerprint(f), "fingerprint ignores readPaths order");

  // Identity is also WHERE it was read: the same v/c at a different path is a different finding, so a disposition
  // on a PM row must not silently close the identical value in an AM report.
  const pm = byClause(runClauses(rec([row({ existingVc: 3.0 })])), "vcPlausibilityIntersection")[0];
  const amOnly = byClause(runClauses(rec([], [{ period: "am_peak", affectedIntersections: [row({ existingVc: 3.0 })] }])), "vcPlausibilityIntersection")[0];
  ok(pm && amOnly && pm.readPaths[0].value === amOnly.readPaths[0].value && findingFingerprint(pm) !== findingFingerprint(amOnly), "same value at a different path → a different fingerprint");
  ok(findingFingerprint({ ...f, clauseId: "someOtherClause" }) !== findingFingerprint(f), "same readPaths under a different clause → a different fingerprint");
  ok(findingFingerprint({ ...f, section: 5 }) !== findingFingerprint(f), "same readPaths under a different section → a different fingerprint");
}

// --- the rule set is versioned --------------------------------------------
{
  // Recorded on every run, so a stored finding can be told from one the current rules would produce. This is a
  // pin on purpose: changing the clause set must also change this literal, which forces someone to decide.
  ok(RULES_VERSION === "2", `RULES_VERSION is "2" for the twelve-clause set (got ${JSON.stringify(RULES_VERSION)}); a change to the clause set or to what a clause judges must bump it, and this pin, together`);
  ok(ALL_CLAUSES.length === 12, `the registry holds twelve clauses (${ALL_CLAUSES.length}) — the set RULES_VERSION "2" names`);
}

// --- the engine stamp tracks the deploy ------------------------------------
{
  const saved = { r: process.env.RAILWAY_GIT_COMMIT_SHA, g: process.env.GIT_SHA };
  delete process.env.RAILWAY_GIT_COMMIT_SHA;
  delete process.env.GIT_SHA;
  const bare = engineStamp();
  process.env.GIT_SHA = "abcdef1234567";
  const withSha = engineStamp();
  process.env.RAILWAY_GIT_COMMIT_SHA = "1234567fedcba";
  const withBoth = engineStamp();
  delete process.env.GIT_SHA;
  const withRailway = engineStamp();
  if (saved.r === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA; else process.env.RAILWAY_GIT_COMMIT_SHA = saved.r;
  if (saved.g === undefined) delete process.env.GIT_SHA; else process.env.GIT_SHA = saved.g;
  ok(/^[0-9a-f]{8}$/.test(bare), "engineStamp without a commit is the 8-hex constants hash");
  ok(withSha === `${bare}-abcdef1`, "engineStamp appends the 7-char commit when the platform provides one");
  ok(withRailway === `${bare}-1234567`, "engineStamp reads RAILWAY_GIT_COMMIT_SHA");
  ok(withBoth === `${bare}-1234567`, "RAILWAY_GIT_COMMIT_SHA takes precedence over GIT_SHA");
}

// ===========================================================================
// The nine clauses beyond §4's v/c: §1 growth, §2 trip generation, §4 LOS and the
// screening clamp, §5 criteria, §6 limitations.
// ===========================================================================

// The engine's own sentences. Four clauses ask "does the deliverable say this?", and the answer must come
// from this study's findings, not from boilerplate the engine writes on every study. Taken from a real payload.
const baseReal = realRec("scenario-base");
const REAL_METHODOLOGY = baseReal.result.methodology;
const realSentence = (re) => baseReal.result.findings.find((f) => re.test(f));
const S_TRIPS = realSentence(/new daily vehicle trips/); // mentions "daily" and "PM peak hour"
const S_AREA = realSentence(/fall within the study area/); // mentions "study area"
const S_DOT = realSentence(/TIS guidance/); // names dotName
// Appended to the findings of EVERY study with rows. It says "pass-by" and "±0.5%/yr", so a gate on the bare word "pass-by" is always satisfied.
const S_SENS = realSentence(/pass-by credit variants/);
// All eight of the real payload's findings. Several contain "not", "no" and "do not" (the data-quality and auto-mode
// sentences), so a gate loosened to those words is satisfied by them.
const REAL_FINDINGS = baseReal.result.findings;
// Copied from plainFindings (tis.ts): written whenever a pass-by or internal-capture credit is applied.
const S_PASSBY =
  "Pass-by credit 30% and internal-capture credit 0% applied at the PM peak (25% of that credit at the AM and Saturday-midday periods, per the industry rule of thumb that off-peak shopping diverts less) before off-site assignment (standard pass-by methodology; ULI Internal Capture).";
{
  pre("scenario-base", !!S_TRIPS && !!S_AREA && !!S_DOT && !!S_SENS, "its findings carry the trip, study-area, DOT and sensitivity sentences the prose gates are tested against");
  pre(
    "scenario-base",
    REAL_METHODOLOGY.some((m) => /Pass-by and internal-capture credits are applied/.test(m)) && REAL_METHODOLOGY.some((m) => /capped at 300 s/.test(m)),
    "its methodology boilerplate already contains the pass-by and 300 s wording a naive gate would match",
  );
}

// --- real engine output: what a correct study carries is not flagged -----------
{
  for (const name of REAL) {
    const r = realRec(name);
    const res = runClauses(r);
    // "Quiet" means the clause RAN and found nothing — a clause that is not registered is not quiet.
    const quiet = (id) => cover(res, id)?.status === "ran" && byClause(res, id).length === 0;
    const complete = (id) => quiet(id) && cover(res, id).note === undefined;
    ok(TWELVE.every((id) => cover(res, id)?.status === "ran"), `${name}: all twelve clauses ran on a complete payload (nothing not-run, nothing unregistered)`);
    pre(name, r.request.growthRatePct !== undefined && /^Explicit override/.test(r.result.growthSource ?? ""), "the request carries a growth override and the engine tagged its growthSource");
    ok(quiet("growthOverrideDisclosed"), `${name}: the engine's own override tag satisfies growthOverrideDisclosed`);
    ok(quiet("growthMultiplierReproduces"), `${name}: the applied growth multiplier reproduces`);
    ok(complete("rateReproducesTotal"), `${name}: PM, AM and daily totals reproduce from their rates, none left unjudged`);
    ok(quiet("passByBasisNamed"), `${name}: no pass-by applied, none to disclose`);
    ok(complete("losMatchesDelay"), `${name}: every LOS letter matches its delay (including rows at a rounding edge), none left unjudged`);
    pre(name, r.result.findings.some((f) => f.includes(r.result.jurisdiction?.dotName ?? "\u0000")), "a finding names jurisdiction.dotName");
    ok(quiet("criteriaNamed"), `${name}: the findings name the governing DOT, so criteriaNamed is quiet`);
    ok(/criteria values/.test(cover(res, "criteriaNamed")?.note ?? "") && /published document/.test(cover(res, "criteriaNamed")?.note ?? ""), `${name}: …and it still says, in the coverage note, that the criteria values were not checked against a published document`);
    ok(complete("periodScopeDisclosed"), `${name}: every requested period is reported`);
    const clampRows = r.result.periodReports.flatMap((p) => p.affectedIntersections).filter((x) => x.futureDelaySec >= 299.95);
    const clamp = byClause(res, "screeningClampDisclosed");
    pre(name, clampRows.length > 0 && !r.result.findings.some((f) => /clamp|ceiling|capped/i.test(f)), "some row's futureDelaySec sits at the 300 s ceiling and no finding mentions a clamp");
    ok(clamp.length === 1 && clamp[0].type === "DISCLOSE", `${name}: delays at the 300 s ceiling (${clampRows.length} rows) with no finding saying so → one DISCLOSE`);
    const scope = byClause(res, "scopeNoteConsistent");
    pre(name, r.result.intersectionsMergedAsDuplicates > 0 && r.result.findings.some((f) => /study area/.test(f)), "records were merged as duplicates and a finding says \"study area\"");
    ok(scope.length === 1 && scope[0].type === "NOTE", `${name}: merged records fire the scope NOTE even though a real finding says "study area"`);
    const bad = pathProblems(res.findings, r);
    ok(bad.length === 0, `${name}: every readPath of every finding resolves (${res.findings.reduce((n, f) => n + f.readPaths.length, 0)} paths${bad.length ? `; ${bad.slice(0, 3).join("; ")}` : ""})`);
  }
  // The LOS tolerance is not hypothetical: real rows disagree with their own rounded delay at a band edge.
  const strict = (name) => {
    const r = realRec(name);
    let n = 0;
    for (const p of r.result.periodReports)
      for (const x of p.affectedIntersections)
        for (const [d, l] of [["currentDelaySec", "currentLos"], ["existingDelaySec", "existingLos"], ["futureDelaySec", "futureLos"], ["designNoBuildDelaySec", "designNoBuildLos"], ["designBuildDelaySec", "designBuildLos"]])
          if (typeof x[d] === "number" && delayToLos(x[d]) !== x[l]) n++;
    return n;
  };
  for (const name of ["scenario-overrides", "scenario-network-utdf"]) {
    pre(name, strict(name) >= 1, "a row's letter differs from delayToLos(printed delay) — the 0.1 s rounding case the LOS clause must tolerate");
  }
}

// --- §1 growth ---------------------------------------------------------------
{
  const g = (req, res) => ({ request: req, result: { findings: [], methodology: [], affectedIntersections: [], periodReports: [], ...res } });

  const noSource = g({ growthRatePct: 3 }, { growthAppliedPct: 3, growthYears: 2 });
  const h1 = byClause(runClauses(noSource), "growthOverrideDisclosed");
  ok(h1.length === 1 && h1[0].type === "BLOCKER", "an override with no growthSource is a BLOCKER");
  ok(h1[0]?.readPaths.map((p) => `${p.path}=${p.value}`).join() === "request.growthRatePct=3" && /is absent/.test(h1[0].detail), "…it cites only what exists (request.growthRatePct), and says growthSource is absent");
  resolves("override with no growthSource", noSource);

  const measured = g({ growthRatePct: 3 }, { growthSource: "GDOT Traffic Counts 2008-2017 — median per-segment CAGR across 5148 matched count stations" });
  const h2 = byClause(runClauses(measured), "growthOverrideDisclosed");
  ok(h2.length === 1 && /not tagged as an override/.test(h2[0].detail) && /GDOT Traffic Counts/.test(h2[0].detail), "an override beside a measured-rate growthSource is a BLOCKER that quotes the source");
  ok(h2[0]?.readPaths.map((p) => p.path).join() === "request.growthRatePct,result.growthSource", "…and cites both the request value and the source");
  resolves("override beside a measured-rate source", measured);

  const midString = g({ growthRatePct: 3 }, { growthSource: "The preparer noted an Explicit override was considered but not used." });
  ok(byClause(runClauses(midString), "growthOverrideDisclosed").length === 1, "the words 'Explicit override' mid-string are not the override tag (the tag is the PREFIX)");

  const tagged = g({ growthRatePct: 3 }, { growthSource: baseReal.result.growthSource });
  ok(byClause(runClauses(tagged), "growthOverrideDisclosed").length === 0 && cover(runClauses(tagged), "growthOverrideDisclosed")?.status === "ran", "a tagged override (the engine's real tag) passes, and the clause ran");

  const zero = g({ growthRatePct: 0 }, { growthAppliedPct: 0, growthYears: 2 });
  ok(byClause(runClauses(zero), "growthOverrideDisclosed").length === 1, "an override of 0%/yr is still an override (the engine tests !== undefined, not truthiness)");

  const none = runClauses(g({}, { growthAppliedPct: 1.4, growthYears: 2 }));
  ok(cover(none, "growthOverrideDisclosed")?.status === "not-run" && /override/.test(cover(none, "growthOverrideDisclosed").reason), "no growthRatePct → not-run (reason names the override)");
  const nul = runClauses(g({ growthRatePct: null }, {}));
  ok(cover(nul, "growthOverrideDisclosed")?.status === "not-run" && byClause(nul, "growthOverrideDisclosed").length === 0 && /supplied no growthRatePct override/.test(cover(nul, "growthOverrideDisclosed").reason), "growthRatePct: null is not an override → not-run, no finding");
  const txt = runClauses(g({ growthRatePct: "3%" }, {}));
  ok(cover(txt, "growthOverrideDisclosed")?.status === "not-run" && /not a number/.test(cover(txt, "growthOverrideDisclosed").reason), 'growthRatePct: "3%" is not a number → not-run, never judged');

  // growthMultiplierReproduces
  const bad = g({}, { growthAppliedPct: 1.4, growthYears: 2, growthMultiplierExact: 1.5 });
  const m1 = byClause(runClauses(bad), "growthMultiplierReproduces");
  ok(m1.length === 1 && m1[0].type === "BLOCKER", "a multiplier that does not reproduce is a BLOCKER");
  ok(/1\.028196/.test(m1[0]?.detail) && /1\.5/.test(m1[0]?.detail), "detail shows the reproduced multiplier (1.028196) and the applied one (1.5)");
  ok(m1[0]?.readPaths.map((p) => p.path).join() === "result.growthAppliedPct,result.growthYears,result.growthMultiplierExact", "readPaths are the rate, the years and the multiplier");
  resolves("non-reproducing multiplier", bad);
  const wake = runClauses(current);
  ok(byClause(wake, "growthMultiplierReproduces").length === 0 && cover(wake, "growthMultiplierReproduces")?.status === "ran", "Wake's 1.028196 reproduces from 1.4%/2yr (and the clause ran)");
  const near = (d) => runClauses(g({}, { growthAppliedPct: 1.4, growthYears: 2, growthMultiplierExact: 1.028196 + d }));
  ok(byClause(near(1e-4), "growthMultiplierReproduces").length === 1, "a multiplier 1e-4 off is a finding");
  ok(byClause(near(1e-9), "growthMultiplierReproduces").length === 0, "a multiplier 1e-9 off is floating-point noise, not a finding");
  const neg = (exact) => runClauses(g({}, { growthAppliedPct: -2, growthYears: 2, growthMultiplierExact: exact }));
  ok(byClause(neg(0.9604), "growthMultiplierReproduces").length === 0 && byClause(neg(1), "growthMultiplierReproduces").length === 1, "negative growth compounds the same way: -2%/yr over 2 years is 0.9604, not 1");
  const zeroYears = runClauses(g({}, { growthAppliedPct: 1.5, growthYears: 0, growthMultiplierExact: 1 }));
  ok(byClause(zeroYears, "growthMultiplierReproduces").length === 0 && cover(zeroYears, "growthMultiplierReproduces")?.status === "ran", "zero growth years is a multiplier of 1");
  const nullPct = runClauses(g({}, { growthAppliedPct: null, growthYears: 2, growthMultiplierExact: 1 }));
  ok(cover(nullPct, "growthMultiplierReproduces")?.status === "not-run" && /growthAppliedPct/.test(cover(nullPct, "growthMultiplierReproduces").reason), "growthAppliedPct: null → not-run (Number(null) is 0, which would 'reproduce' a multiplier of 1 and report clean)");
  const nullExact = runClauses(g({}, { growthAppliedPct: 1.4, growthYears: 2, growthMultiplierExact: null }));
  ok(cover(nullExact, "growthMultiplierReproduces")?.status === "not-run" && byClause(nullExact, "growthMultiplierReproduces").length === 0 && /not a number/.test(cover(nullExact, "growthMultiplierReproduces").reason), "growthMultiplierExact: null → not-run (it is present but not a number), not a BLOCKER against 0");
  const absent = runClauses(g({}, { growthAppliedPct: 1.4, growthYears: 2 }));
  ok(cover(absent, "growthMultiplierReproduces")?.status === "not-run" && /predates growthMultiplierExact/.test(cover(absent, "growthMultiplierReproduces").reason), "a payload that predates growthMultiplierExact → not-run");
}

// --- §2 trip generation ------------------------------------------------------
{
  const t = (over, extra = {}) => ({
    request: { size: 150 },
    result: {
      findings: [], methodology: [], affectedIntersections: [], periodReports: [],
      tripGeneration: { landUseCode: "820", landUseName: "Shopping Center / Retail", size: 150, pmRate: 8, pmPeakTrips: 1200, dailyRate: 80, dailyTrips: 12000, amRate: 3.2, amPeakTrips: 480, variableSource: "SANDAG 2002", ...over },
      ...extra,
    },
  });
  const clean = runClauses(t({}));
  ok(byClause(clean, "rateReproducesTotal").length === 0 && cover(clean, "rateReproducesTotal")?.status === "ran" && cover(clean, "rateReproducesTotal").note === undefined, "rates that reproduce their totals are clean, with nothing left unjudged");

  const mismatch = t({ pmRate: 3.4, pmPeakTrips: 999, dailyRate: 37.75, dailyTrips: 5663, amRate: 0.94, amPeakTrips: 141 });
  const hits = byClause(runClauses(mismatch), "rateReproducesTotal");
  ok(hits.length === 1 && hits[0].type === "BLOCKER", "only the PM total that does not reproduce is flagged (daily 37.75 x 150 = 5662.5 prints 5663; AM 0.94 x 150 = 141 — both fine)");
  ok(/3\.4/.test(hits[0]?.detail) && /999/.test(hits[0]?.detail) && /510\.0/.test(hits[0]?.detail), "detail shows the rate, the printed total, and the reproduced 510.0");
  ok(hits[0]?.readPaths.map((p) => p.path).join() === "result.tripGeneration.pmRate,result.tripGeneration.size,result.tripGeneration.pmPeakTrips", "readPaths are the rate, the size and the total");
  ok(/variableSource — SANDAG 2002/.test(hits[0]?.sourceLabel ?? ""), "the source label is the tagged variableSource, never ITE");
  resolves("PM total that does not reproduce", mismatch);

  const off = (key, value) => byClause(runClauses(t({ [key]: value })), "rateReproducesTotal");
  ok(off("pmPeakTrips", 1201).length === 1 && off("pmPeakTrips", 1199).length === 1 && off("pmPeakTrips", 1200).length === 0, "an off-by-one PM total is a finding (the engine rounds, so a total is exact to 0.5)");
  ok(off("amPeakTrips", 481).length === 1 && /AM peak/.test(off("amPeakTrips", 481)[0].title), "the AM pair is judged on its own");
  ok(off("dailyTrips", 12001).length === 1 && /Daily/.test(off("dailyTrips", 12001)[0].title), "the daily pair is judged on its own");
  const tie = (rate, total) => byClause(runClauses(t({ dailyRate: rate, dailyTrips: total })), "rateReproducesTotal").length;
  ok(tie(37.75, 5663) === 0 && tie(37.75, 5662) === 0 && tie(37.75, 5664) === 1, "a total exactly half a trip from rate x size (5662.5 vs 5663) is clean — the boundary is inclusive");
  const half = (rate, total) => byClause(runClauses(t({ amRate: rate, amPeakTrips: total })), "rateReproducesTotal").length;
  ok(half(0.95, 143) === 0 && half(0.95, 144) === 1, "142.5 prints as 143 and is clean; 144 is not (the rounding boundary)");

  const legacy = runClauses(fixture("legacy-minimal"));
  const lcov = cover(legacy, "rateReproducesTotal");
  ok(lcov?.status === "not-run" && /no numeric rate fields/.test(lcov.reason), "a legacy payload without rate fields is not-run, not UNVERIFIED");
  ok(lcov?.reason === "payload carries no numeric rate fields", "…its reason states what was found, not an inference about the payload's age");
  const nulls = runClauses(t({ pmRate: null, amRate: null, dailyRate: null }));
  ok(cover(nulls, "rateReproducesTotal")?.status === "not-run" && byClause(nulls, "rateReproducesTotal").length === 0 && cover(nulls, "rateReproducesTotal").reason === "payload carries no numeric rate fields", "null rates → not-run for want of a numeric rate (Number(null) is 0, which would flag every total as 0 x size)");
  const noTotals = runClauses(t({ pmPeakTrips: null, amPeakTrips: undefined, dailyTrips: "n/a" }));
  ok(cover(noTotals, "rateReproducesTotal")?.status === "not-run" && /numeric printed total/.test(cover(noTotals, "rateReproducesTotal").reason), "numeric rates but no numeric printed total anywhere → not-run, never 'ran' with nothing judged");
  const mixed = runClauses(t({ amRate: null, dailyRate: "n/a" }));
  ok(cover(mixed, "rateReproducesTotal")?.status === "ran" && byClause(mixed, "rateReproducesTotal").length === 0 && /judged 1 of 3 rate\/total pairs/.test(cover(mixed, "rateReproducesTotal").note ?? ""), "one usable rate of three → ran, clean, and the coverage note says 'judged 1 of 3'");
  const noTotal = runClauses(t({ pmPeakTrips: null }));
  ok(/judged 2 of 3 rate\/total pairs/.test(cover(noTotal, "rateReproducesTotal")?.note ?? ""), "a rate with no printed total beside it is counted as not judged (not skipped silently)");
  const part = byClause(runClauses(t({ pmRate: 3.4, pmPeakTrips: 999, amRate: null })), "rateReproducesTotal")[0];
  ok(part && /Not judged: 1 of 3 rate\/total pairs/.test(part.detail), "a finding on a partly judged record says how much was not judged");
  const strSize = runClauses(t({ size: "150" }));
  ok(cover(strSize, "rateReproducesTotal")?.status === "not-run" && /size/.test(cover(strSize, "rateReproducesTotal").reason), 'size: "150" is not a number → not-run');

  // passByBasisNamed
  const p = (over = {}, req = {}, findings = [], extra = {}) => ({
    request: { landUseCode: "820", ...req },
    result: { tripGeneration: { landUseCode: "820", size: 150 }, passByPctApplied: 30, findings, methodology: [], affectedIntersections: [], periodReports: [], ...over, ...extra },
  });
  const lu820 = LAND_USES.find((l) => l.code === "820");
  const dflt = byClause(runClauses(p()), "passByBasisNamed");
  ok(dflt.length === 1 && dflt[0].type === "DISCLOSE" && /30%/.test(dflt[0].detail) && /land-use default/.test(dflt[0].detail), "a 30% pass-by that no finding mentions is a DISCLOSE naming the land-use default");
  ok(dflt[0]?.readPaths.map((x) => `${x.path}=${x.value}`).join() === "result.passByPctApplied=30", "…it cites only what the record holds (no request.passByPct when none was supplied, no registry path)");
  ok(dflt[0]?.sourceLabel.includes(lu820.source) && /passByPctPm 30/.test(dflt[0].sourceLabel), "…and the source label carries the registry's tagged source string and default");
  resolves("pass-by default undisclosed", p());
  const req = byClause(runClauses(p({ passByPctApplied: 15 }, { passByPct: 15 })), "passByBasisNamed");
  ok(req.length === 1 && /supplied by the request/.test(req[0].detail) && req[0].readPaths.map((x) => x.path).join() === "result.passByPctApplied,request.passByPct", "a request-supplied pass-by says so and cites request.passByPct");
  resolves("pass-by supplied by the request", p({ passByPctApplied: 15 }, { passByPct: 15 }));
  ok(byClause(runClauses(p({}, {}, [S_PASSBY])), "passByBasisNamed").length === 0 && cover(runClauses(p({}, {}, [S_PASSBY])), "passByBasisNamed")?.status === "ran", "the engine's own pass-by finding satisfies the clause (and it ran)");
  ok(byClause(runClauses(p({}, {}, ["Pass by trips were removed at 30%."])), "passByBasisNamed").length === 0, '"Pass by" with a space and a percentage also states it');
  ok(byClause(runClauses(p({}, {}, ["A pass-by reduction (30%) was applied."])), "passByBasisNamed").length === 0, "a clause giving the pass-by percentage states it, in any wording");
  ok(byClause(runClauses(p({}, {}, [S_SENS])), "passByBasisNamed").length === 1, "the engine's sensitivity finding ('…internal capture and pass-by credit variants; and a ±0.5%/yr growth band…') is on EVERY study and says 'pass-by', so it must NOT satisfy the clause");
  ok(byClause(runClauses(p({}, {}, REAL_FINDINGS)), "passByBasisNamed").length === 1, "…nor do all eight of the engine's real findings");
  ok(byClause(runClauses(p({}, {}, ["A pass-by reduction was applied."])), "passByBasisNamed").length === 1, "a pass-by mention that gives no percentage does not state the basis");
  const boiler = runClauses(p({ methodology: REAL_METHODOLOGY }));
  ok(byClause(boiler, "passByBasisNamed").length === 1, "the engine's pass-by methodology boilerplate (on every study) does NOT satisfy the clause — only findings do");
  ok(byClause(runClauses(p({ passByPctApplied: 0 })), "passByBasisNamed").length === 0 && cover(runClauses(p({ passByPctApplied: 0 })), "passByBasisNamed")?.status === "ran", "no pass-by applied → nothing to disclose, clause ran");
  const pnull = runClauses(p({ passByPctApplied: null }));
  ok(cover(pnull, "passByBasisNamed")?.status === "not-run" && /passByPctApplied/.test(cover(pnull, "passByBasisNamed").reason), "passByPctApplied: null → not-run (Number(null) is 0, which would read as 'none applied' and report clean)");
  const pgone = runClauses(p({ passByPctApplied: undefined }));
  ok(cover(pgone, "passByBasisNamed")?.status === "not-run" && /passByPctApplied/.test(cover(pgone, "passByBasisNamed").reason), "a payload that predates passByPctApplied → not-run");
  const unk = runClauses(p({ tripGeneration: { landUseCode: "999", size: 1 } }, { landUseCode: "999" }));
  ok(cover(unk, "passByBasisNamed")?.status === "not-run" && /registry/.test(cover(unk, "passByBasisNamed").reason), "a land use outside the registry → not-run");
  const fromReq = runClauses(p({ tripGeneration: {} }));
  ok(byClause(fromReq, "passByBasisNamed").length === 1, "with no tripGeneration.landUseCode the request's landUseCode identifies the land use");
}

// --- §4 LOS matches delay ----------------------------------------------------
{
  const PAIRS = [
    ["currentDelaySec", "currentLos"],
    ["existingDelaySec", "existingLos"],
    ["futureDelaySec", "futureLos"],
    ["designNoBuildDelaySec", "designNoBuildLos"],
    ["designBuildDelaySec", "designBuildLos"],
  ];
  const lrow = (over) => ({ signalId: "s", name: "N", approaches: [], ...over });
  const lrec = (rows, periodReports = []) => ({ request: {}, result: { findings: [], methodology: [], affectedIntersections: rows, periodReports } });
  const los = (rows, pr) => runClauses(lrec(rows, pr));

  const losF = lrec([lrow({ currentVc: 0.9, existingVc: 0.92, futureDelaySec: 0, futureLos: "F", queue95thFt: 10 })]);
  const hits = byClause(runClauses(losF), "losMatchesDelay");
  ok(hits.length === 1 && hits[0].type === "DEFECT", "LOS F with 0 s delay is a DEFECT (engine fault)");
  ok(hits[0]?.audience === "admin", "a DEFECT routes to admin, never to the PE");
  ok(hits[0]?.readPaths.map((p) => `${p.path}=${p.value}`).join() === "result.affectedIntersections[0].futureDelaySec=0,result.affectedIntersections[0].futureLos=F", "readPaths are the delay and the letter, literal");
  ok(/futureDelaySec 0 s maps to LOS A/.test(hits[0]?.detail) && /futureLos F/.test(hits[0]?.detail) && /1 of 1 reported delay\/LOS pairs/.test(hits[0]?.detail), "detail names the delay, the letter it maps to, the letter reported, and 1 of 1");
  resolves("LOS F at 0 s", losF);

  // Every one of the five pairs is checked: delay 100 s is F, so letter "A" is wrong in each.
  for (const [dk, lk] of PAIRS) {
    const h = byClause(los([lrow({ [dk]: 100, [lk]: "A" })]), "losMatchesDelay");
    ok(h.length === 1 && h[0].readPaths.map((p) => p.path).join() === `result.affectedIntersections[0].${dk},result.affectedIntersections[0].${lk}`, `${lk} is checked against ${dk}`);
    ok(byClause(los([lrow({ [dk]: 100, [lk]: "F" })]), "losMatchesDelay").length === 0, `${lk} F beside ${dk} 100 is clean`);
  }

  // Delay is printed to 0.1 s while the letter came from the unrounded value, so a band edge is not a defect.
  const edge = (d, l) => byClause(los([lrow({ futureDelaySec: d, futureLos: l })]), "losMatchesDelay").length;
  ok(edge(35.0, "D") === 0 && edge(35.0, "C") === 0, "delay 35.0 may be LOS C or D (the unrounded value could be 34.96 or 35.04)");
  ok(edge(10.0, "A") === 0 && edge(10.0, "B") === 0 && edge(80.0, "E") === 0 && edge(80.0, "F") === 0, "…and the same at the 10 and 80 s edges");
  ok(edge(35.1, "C") === 1 && edge(34.9, "D") === 1, "but 35.1 is not C and 34.9 is not D: one tick from the edge the rounding no longer excuses a letter");
  ok(edge(20.2, "B") === 1 && edge(54.8, "E") === 1, "and a letter two ticks from an edge is a finding");
  ok(edge(10.04, "A") === 0 && edge(10.04, "B") === 0 && edge(10.06, "A") === 1, "the tolerance is the rounding interval on both sides: a delay not printed to 0.1 s (10.04) may be A or B; 10.06 may not be A");

  // Unreadable values are skipped, and Number(null) = 0 would map "F" beside a null delay to a DEFECT.
  const nullD = los([lrow({ futureDelaySec: null, futureLos: "F" })]);
  ok(byClause(nullD, "losMatchesDelay").length === 0 && cover(nullD, "losMatchesDelay")?.status === "not-run", "delay null beside LOS F → no DEFECT, and nothing was judged → not-run");
  // A blank or free-text letter is an unusable reading, not a value the engine lost: it must not become a DEFECT.
  for (const badLetter of ["", "n/a", "C/D", "f", " F", "FF", null, 5]) {
    const r = los([lrow({ futureDelaySec: 20, futureLos: badLetter })]);
    ok(byClause(r, "losMatchesDelay").length === 0 && cover(r, "losMatchesDelay")?.status === "not-run", `delay 20 beside LOS ${JSON.stringify(badLetter)} → no DEFECT, and nothing was judged → not-run`);
  }
  for (const [letter, delay] of [["A", 5], ["B", 15], ["C", 30], ["D", 50], ["E", 70], ["F", 100]]) {
    const r = los([lrow({ futureDelaySec: delay, futureLos: letter })]);
    ok(cover(r, "losMatchesDelay")?.status === "ran" && byClause(r, "losMatchesDelay").length === 0, `LOS ${letter} beside ${delay} s is a usable, matching pair (judged, clean)`);
  }
  const strD = los([lrow({ futureDelaySec: "300", futureLos: "A" })]);
  ok(byClause(strD, "losMatchesDelay").length === 0 && cover(strD, "losMatchesDelay")?.status === "not-run", 'delay "300" (a string) is not judged');
  const nothing = los([lrow({})]);
  ok(cover(nothing, "losMatchesDelay")?.status === "not-run" && /delay/.test(cover(nothing, "losMatchesDelay").reason), "rows carrying no delay or LOS at all → not-run, reason names the delay");
  const none = runClauses({ request: {}, result: {} });
  ok(cover(none, "losMatchesDelay")?.status === "not-run" && /no affectedIntersections/.test(cover(none, "losMatchesDelay").reason), "no rows at all → not-run");

  // One finding for the whole population, with every offender.
  const two = los([lrow({ name: "First", futureDelaySec: 100, futureLos: "A" }), lrow({ name: "Second", existingDelaySec: 100, existingLos: "B" })]);
  const th = byClause(two, "losMatchesDelay");
  ok(th.length === 1 && th[0].readPaths.length === 4 && /2 of 2 reported delay\/LOS pairs/.test(th[0].detail) && /First/.test(th[0].detail) && /Second/.test(th[0].detail), "two offenders are ONE finding naming both (not one DEFECT per pair)");
  const many = los(Array.from({ length: 8 }, (_, i) => lrow({ name: `R${i}`, futureDelaySec: 100, futureLos: "A" })));
  ok(byClause(many, "losMatchesDelay")[0]?.detail.includes(", and 3 more"), "more than five offenders: five are named, the rest counted");

  // Rows live in periodReports too; the PM mirror is counted once.
  const bad = lrow({ name: "AM-only", futureDelaySec: 100, futureLos: "A" });
  const good = lrow({ name: "Fine", futureDelaySec: 100, futureLos: "F" });
  const am = lrec([], [{ period: "pm_peak", affectedIntersections: [good] }, { period: "am_peak", affectedIntersections: [bad] }]);
  const ah = byClause(runClauses(am), "losMatchesDelay");
  ok(ah.length === 1 && ah[0].readPaths[0].path === "result.periodReports[1].affectedIntersections[0].futureDelaySec" && /\[am_peak\]/.test(ah[0].detail), "a mismatch in periodReports[1] is addressed with that literal index and labelled am_peak");
  resolves("LOS mismatch in periodReports[1]", am);
  const mirrored = lrec([clone(bad)], [{ period: "pm_peak", affectedIntersections: [clone(bad)] }]);
  const mh = byClause(runClauses(mirrored), "losMatchesDelay");
  ok(mh.length === 1 && mh[0].readPaths.length === 2 && /1 of 1 reported/.test(mh[0].detail), "the mirrored PM rows are counted once, not twice");

  ok(/\(unnamed\) \[pm_peak\]: futureDelaySec 100 s/.test(byClause(los([{ signalId: "s", approaches: [], futureDelaySec: 100, futureLos: "A" }]), "losMatchesDelay")[0]?.detail ?? ""), "a row with no name is labelled (unnamed), not 'undefined'");

  // Partial coverage.
  const full = lrow({ currentDelaySec: 20, currentLos: "B", existingDelaySec: 20, existingLos: "B", futureDelaySec: 20, futureLos: "B", designNoBuildDelaySec: 20, designNoBuildLos: "B", designBuildDelaySec: 20, designBuildLos: "B" });
  const sparse = los([full, lrow({ futureDelaySec: 100 }), lrow({})]);
  const sc = cover(sparse, "losMatchesDelay");
  ok(sc?.status === "ran" && byClause(sparse, "losMatchesDelay").length === 0, "a record with one readable row of three runs, and is clean on what it could read");
  ok(/judged 5 of 6 reported delay\/LOS pairs/.test(sc?.note ?? "") && /1 of 3 rows reported no delay\/LOS/.test(sc?.note ?? ""), "…and the coverage note says 5 of 6 pairs and 1 of 3 rows were not judged");
  const blankLetter = los([full, lrow({ futureDelaySec: 20, futureLos: "" })]);
  ok(cover(blankLetter, "losMatchesDelay")?.status === "ran" && byClause(blankLetter, "losMatchesDelay").length === 0 && /judged 5 of 6 reported delay\/LOS pairs; 1 carried a delay that is not a number or no A-F letter beside it/.test(cover(blankLetter, "losMatchesDelay").note ?? ""), "a blank letter beside a numeric delay is counted not judged (5 of 6), with no DEFECT");
  const blankHit = byClause(los([lrow({ futureDelaySec: 100, futureLos: "A" }), lrow({ futureDelaySec: 20, futureLos: "n/a" })]), "losMatchesDelay")[0];
  ok(blankHit && /1 of 1 reported delay\/LOS pairs/.test(blankHit.detail) && /Not judged: 1 of 2 reported delay\/LOS pairs with a delay that is not a number or no A-F letter beside it/.test(blankHit.detail), "a real mismatch beside a non-letter: the non-letter is not in the 'N of M' and is reported not judged");
  const withBad = byClause(los([lrow({ futureDelaySec: 100, futureLos: "A" }), lrow({ futureDelaySec: "n/a", futureLos: "A" })]), "losMatchesDelay")[0];
  ok(withBad && /Not judged: 1 of 2 reported delay\/LOS pairs/.test(withBad.detail), "a finding on a partly judged record carries the not-judged count");
  const withEmpty = byClause(los([lrow({ futureDelaySec: 100, futureLos: "A" }), lrow({})]), "losMatchesDelay")[0];
  ok(withEmpty && /Not judged: 1 of 2 rows reported no delay\/LOS/.test(withEmpty.detail), "…and so does a finding beside a row that reported no delay or LOS at all");
  const fullCov = cover(los([full]), "losMatchesDelay");
  ok(fullCov?.status === "ran" && !("note" in fullCov), "a fully judged record carries no note at all");
}

// --- §4 screening clamp --------------------------------------------------------
{
  const KEYS = ["currentDelaySec", "existingDelaySec", "futureDelaySec", "designNoBuildDelaySec", "designBuildDelaySec"];
  const crow = (over) => ({ signalId: "s", name: "N", approaches: [], ...over });
  const crec = (rows, findings = [], extra = {}) => ({ request: {}, result: { findings, methodology: [], affectedIntersections: rows, periodReports: [], ...extra } });
  const cal = (mul, exact) => ({ sampleCount: 5, delayMultiplier: mul, ...(exact === undefined ? {} : { delayMultiplierExact: exact }) });
  const clamp = (rows, findings = [], extra) => byClause(runClauses(crec(rows, findings, extra)), "screeningClampDisclosed");

  const capped = crec([crow({ currentVc: 1.9, existingVc: 1.95, futureDelaySec: 300, futureLos: "F", queue95thFt: 900 })]);
  const ch = byClause(runClauses(capped), "screeningClampDisclosed");
  ok(ch.length === 1 && ch[0].type === "DISCLOSE" && ch[0].audience === "engineer", "an undisclosed clamped delay is a DISCLOSE");
  ok(/1 reported delay\(s\) are at or above the 300 s screening ceiling/.test(ch[0]?.detail) && /N futureDelaySec \[pm_peak\] 300 s/.test(ch[0]?.detail), "detail counts the delays and names the row, field, period and value");
  ok(/SCREENING_MAX_DELAY_SEC = 300/.test(ch[0]?.sourceLabel ?? "") && /calibration multiplier/.test(ch[0]?.sourceLabel ?? ""), "the source label names the constant and the calibration multiplier");
  resolves("clamped delay", capped);

  for (const disclosure of ["Delays at the 300 s screening ceiling are not estimates.", "Reported delays were clamped at 300 s.", "Delay is capped at 300 s for screening."]) {
    ok(clamp([crow({ futureDelaySec: 300 })], [disclosure]).length === 0 && cover(runClauses(crec([crow({ futureDelaySec: 300 })], [disclosure])), "screeningClampDisclosed")?.status === "ran", `a finding saying it (${disclosure.split(" ").slice(2, 5).join(" ")}…) satisfies the clause, and the clause ran`);
  }
  ok(clamp([crow({ futureDelaySec: 300 })], REAL_FINDINGS).length === 1, "none of the engine's eight real findings mentions a clamp, so they do not satisfy the clause");
  ok(clamp([crow({ futureDelaySec: 300 })], [], { methodology: REAL_METHODOLOGY }).length === 1, "the engine's methodology boilerplate ('capped at 300 s', on every study) does NOT satisfy the clause — only findings do");

  const five = clamp(Array.from({ length: 5 }, (_, i) => crow({ name: `C${i}`, futureDelaySec: 300 })))[0];
  ok(five && /5 reported delay\(s\)/.test(five.detail) && /C2 futureDelaySec \[pm_peak\] 300 s/.test(five.detail) && !/C3/.test(five.detail) && /, and 2 more\)/.test(five.detail) && five.readPaths.length === 5, "five clamped delays: three are named, 'and 2 more' counts the rest, and all five are cited");

  // Each of the five delay fields is read.
  for (const k of KEYS) {
    const h = clamp([crow({ [k]: 300 })]);
    ok(h.length === 1 && h[0].readPaths.map((p) => p.path).join() === `result.affectedIntersections[0].${k}`, `${k} at 300 s is read`);
  }
  ok(clamp([crow({ futureDelaySec: 299.9 })]).length === 0 && clamp([crow({ futureDelaySec: 299.95 })]).length === 1, "299.9 is below the ceiling and 299.95 is not (the payload rounds to 0.1 s)");
  ok(clamp([crow({ futureDelaySec: 600 })]).length === 1, "a delay above the ceiling (a calibrated 600) is also flagged when no calibration is on the row");

  // The calibration multiplier is applied AFTER the clamp, so the ceiling a row can print is 300 x multiplier.
  ok(clamp([crow({ futureDelaySec: 150, calibration: cal(0.5, 0.5) })]).length === 1, "calibration x0.5: a printed 150 s IS the clamp and is flagged (a fixed `>= 300` misses it)");
  ok(clamp([crow({ futureDelaySec: 150 })]).length === 0, "…the same 150 s on an uncalibrated row is an ordinary delay");
  ok(clamp([crow({ futureDelaySec: 149.9, calibration: cal(0.5, 0.5) })]).length === 0, "calibration x0.5: 149.9 s is below its ceiling");
  ok(clamp([crow({ futureDelaySec: 300, calibration: cal(2, 2) })]).length === 0 && clamp([crow({ futureDelaySec: 600, calibration: cal(2, 2) })]).length === 1, "calibration x2: a printed 300 s is NOT the clamp (raw 150 s); 600 s is");
  ok(clamp([crow({ futureDelaySec: 149.9, calibration: cal(0.5, 0.4996) })]).length === 1, "the unrounded delayMultiplierExact (0.4996) is preferred over the 2 dp delayMultiplier (0.5)");
  ok(clamp([crow({ futureDelaySec: 150, calibration: cal(0.5) })]).length === 1, "without delayMultiplierExact the 2 dp multiplier is used");
  ok(clamp([crow({ futureDelaySec: 30, calibration: cal(0.1, 0.1) })]).length === 0 && clamp([crow({ futureDelaySec: 75, calibration: cal(0.1, 0.1) })]).length === 1, "a multiplier below 0.25 is clamped to 0.25 as the engine does (ceiling 75 s)");
  ok(clamp([crow({ futureDelaySec: 600, calibration: cal(9, 9) })]).length === 0 && clamp([crow({ futureDelaySec: 1500, calibration: cal(9, 9) })]).length === 1, "a multiplier above 5 is clamped to 5 as the engine does (ceiling 1500 s)");
  ok(clamp([crow({ futureDelaySec: 300, calibration: { sampleCount: 1, delayMultiplier: "abc" } })]).length === 1 && clamp([crow({ futureDelaySec: 300, calibration: null })]).length === 1, "an unusable multiplier is treated as 1");
  const calDetail = clamp([crow({ futureDelaySec: 150, calibration: cal(0.5, 0.5) })])[0];
  ok(/ceiling 150 s at calibration x0\.5/.test(calDetail?.detail ?? ""), "a calibrated offender states its own ceiling, so a reader does not wonder why 150 s is flagged");

  // Not a measurement unless it is a number.
  const strRec = runClauses(crec([crow({ futureDelaySec: "300" })]));
  ok(byClause(strRec, "screeningClampDisclosed").length === 0 && cover(strRec, "screeningClampDisclosed")?.status === "not-run", 'delay "300" (a string) is not judged → not-run');
  const nullRec = runClauses(crec([crow({ futureDelaySec: null })]));
  ok(cover(nullRec, "screeningClampDisclosed")?.status === "not-run", "delay null → not-run");
  ok(cover(runClauses({ request: {}, result: {} }), "screeningClampDisclosed")?.status === "not-run" && /no affectedIntersections/.test(cover(runClauses({ request: {}, result: {} }), "screeningClampDisclosed").reason), "no rows → not-run");

  // Literal paths, several offenders, two periods.
  const multi = crec(
    [],
    [],
    {
      periodReports: [
        { period: "pm_peak", affectedIntersections: [crow({ name: "A", existingDelaySec: 300, futureDelaySec: 300 })] },
        { period: "am_peak", affectedIntersections: [crow({ name: "B" }), crow({ name: "C", designBuildDelaySec: 300 })] },
      ],
    },
  );
  const mh = byClause(runClauses(multi), "screeningClampDisclosed");
  ok(mh.length === 1 && /3 reported delay\(s\)/.test(mh[0].detail), "three clamped delays across two periods are ONE finding");
  ok(
    mh[0]?.readPaths.map((p) => p.path).join() ===
      "result.periodReports[0].affectedIntersections[0].existingDelaySec,result.periodReports[0].affectedIntersections[0].futureDelaySec,result.periodReports[1].affectedIntersections[1].designBuildDelaySec",
    "readPaths are literal: periodReports[k] and the row's own index",
  );
  resolves("clamped delays in two periods", multi);
  const mirror = crec([crow({ name: "M", futureDelaySec: 300 })], [], { periodReports: [{ period: "pm_peak", affectedIntersections: [crow({ name: "M", futureDelaySec: 300 })] }] });
  ok(byClause(runClauses(mirror), "screeningClampDisclosed")[0]?.readPaths.length === 1, "the mirrored PM rows are counted once");

  // Partial coverage.
  const part = runClauses(crec([crow({ futureDelaySec: 120 }), crow({}), crow({ futureDelaySec: "n/a" })]));
  const partNote = cover(part, "screeningClampDisclosed")?.note ?? "";
  ok(cover(part, "screeningClampDisclosed")?.status === "ran" && byClause(part, "screeningClampDisclosed").length === 0 && /judged 1 of 2 reported delay fields; 1 carried a delay that is not a number/.test(partNote) && /1 of 3 rows reported no delay/.test(partNote), "one numeric delay among three rows: ran clean, and the note counts 1 of 2 reported fields judged and 1 of 3 rows with no delay");
  const partF = byClause(runClauses(crec([crow({ futureDelaySec: 300 }), crow({})])), "screeningClampDisclosed")[0];
  ok(partF && /Not judged: 1 of 2 rows reported no delay\./.test(partF.detail), "a finding beside a row that reported no delay at all carries the not-judged count");

  // A row can be partly read: one numeric delay and four that are null or text. The unread fields — futureDelaySec most
  // of all — are what a row-granular note would hide (a row "judged" because ONE field was numeric).
  const mixedRow = { currentDelaySec: 10, existingDelaySec: null, futureDelaySec: null, designBuildDelaySec: "n/a" };
  const mixed = runClauses(crec([crow(mixedRow)]));
  const mixedCov = cover(mixed, "screeningClampDisclosed");
  ok(mixedCov?.status === "ran" && byClause(mixed, "screeningClampDisclosed").length === 0, "a row with one numeric delay and three null/text: the clause ran and found nothing in the field it read");
  ok(/judged 1 of 4 reported delay fields; 3 carried a delay that is not a number/.test(mixedCov?.note ?? ""), "…but the coverage note says 1 of 4 reported delay fields was judged: futureDelaySec was never examined");
  const mixedHit = byClause(runClauses(crec([crow({ ...mixedRow, designNoBuildDelaySec: 300 })])), "screeningClampDisclosed")[0];
  ok(mixedHit && /Not judged: 3 of 5 reported delay fields with a delay that is not a number\./.test(mixedHit.detail), "a finding on a partly read row says how many of its delay fields were not judged");
  const mixedNote2 = cover(runClauses(crec([crow({ currentDelaySec: 10, existingDelaySec: 10, futureDelaySec: 10, designNoBuildDelaySec: 10, designBuildDelaySec: 10 })])), "screeningClampDisclosed");
  ok(mixedNote2?.status === "ran" && !("note" in mixedNote2), "a row whose five delay fields are all numeric carries no note");
  const wholeCov = cover(runClauses(crec([crow({ futureDelaySec: 120 })])), "screeningClampDisclosed");
  ok(wholeCov?.status === "ran" && !("note" in wholeCov), "a fully judged record carries no note");
}

// --- §5 criteria ----------------------------------------------------------------
{
  const JUR = { dotName: "Raleigh Department of Transportation", planningOfficeName: "Raleigh Department of City Planning" };
  const jr = (findings, over = {}) => ({ request: {}, result: { jurisdiction: JUR, findings, methodology: [], affectedIntersections: [], periodReports: [], ...over } });

  const cov = cover(runClauses(fixture("legacy-minimal")), "criteriaNamed");
  ok(cov?.status === "not-run" && /agenc/i.test(cov.reason), "criteria clause is not-run when the record names no agency");
  ok(cov?.reason === "record names no governing agency (result.jurisdiction.dotName absent)", "…and its reason names only the declared input that was absent — no repo-wide claim about stored agency documents (that fact lives in the coverage note)");

  const quiet = jr(["Project will generate 100 new daily vehicle trips."]);
  const hits = byClause(runClauses(quiet), "criteriaNamed");
  ok(hits.length === 1 && hits[0].type === "DISCLOSE", "a study whose findings never name the governing DOT is a DISCLOSE: the absence is verified, the deliverable must say it");
  ok(hits.length === 1 && hits[0].audience === "engineer" && hits[0].title === "The governing agency is not named in the study's findings", "…titled as the absence it is, for the engineer");
  ok(/Raleigh Department of Transportation/.test(hits[0]?.detail) && /Raleigh Department of City Planning/.test(hits[0]?.detail) && !/appears nowhere in findings or methodology/.test(hits[0]?.detail), "detail names the DOT (and the planning office as context), and states the corpus accurately (findings, not methodology)");
  ok(hits[0]?.readPaths.map((p) => `${p.path}=${p.value}`).join() === `result.jurisdiction.dotName=${JUR.dotName},result.jurisdiction.planningOfficeName=${JUR.planningOfficeName},result.findings.length=1`, "readPaths: the DOT, the planning office, and how many findings were searched");
  resolves("criteria not named", quiet);

  // The engine names the DOT only in the LOS E/F sentence, and the planning office only in mitigationSummary.
  ok(byClause(runClauses(jr([`2 intersections are projected to operate at LOS E or F and require formal mitigation per ${JUR.dotName} TIS guidance.`])), "criteriaNamed").length === 0, "naming the DOT in a finding satisfies the clause — the planning office, which the engine never prints in findings, is not required");
  ok(cover(runClauses(jr([`per ${JUR.dotName} TIS guidance`])), "criteriaNamed")?.status === "ran", "…and the clause ran");
  ok(byClause(runClauses(jr([`coordinate with ${JUR.planningOfficeName}`])), "criteriaNamed").length === 1, "naming only the planning office does not name the criteria-issuing agency");
  ok(byClause(runClauses(jr([], { methodology: [`Criteria of ${JUR.dotName}.`] })), "criteriaNamed").length === 1, "the DOT named in methodology only does not satisfy the clause — only findings do");
  const real = runClauses(realRec("scenario-base"));
  ok(byClause(real, "criteriaNamed").length === 0, "the real Atlanta payload, whose finding names 'City of Atlanta DOT TIS guidance', is quiet");
  const stripped = realRec("scenario-base");
  stripped.result.findings = stripped.result.findings.filter((f) => f !== S_DOT);
  ok(byClause(runClauses(stripped), "criteriaNamed").length === 1, "…and fires once that one sentence is removed");

  // What genuinely cannot be checked — the criteria VALUES, for want of an agency document — is a coverage note on every
  // run of the clause, never a finding (an unverifiable on every study is the padding the protocol forbids).
  const NOTE_RE = [/criteria values/, /not checked/, /published document/, /no agency document is on file/];
  const noteOf = (r) => cover(runClauses(r), "criteriaNamed")?.note ?? "";
  const fireNote = noteOf(quiet);
  const cleanRec = jr([`per ${JUR.dotName} TIS guidance`]);
  const cleanNote = noteOf(cleanRec);
  ok(NOTE_RE.every((re) => re.test(fireNote)), "a run that fires a finding carries the criteria-values note");
  ok(NOTE_RE.every((re) => re.test(cleanNote)) && byClause(runClauses(cleanRec), "criteriaNamed").length === 0, "a CLEAN run (agency named) carries the same note, with no finding");
  ok(fireNote === cleanNote && !/[.;!?]\s/.test(fireNote), "…one sentence, identical on every run");
  ok(!runClauses(quiet).findings.concat(runClauses(cleanRec).findings).some((f) => /published document|could not be checked|not checked against/i.test(f.title + " " + f.detail)), "…and the unverifiable criteria values appear in no finding's title or detail");
  const nrCov = cover(runClauses({ request: {}, result: { findings: [], methodology: [], affectedIntersections: [], periodReports: [] } }), "criteriaNamed");
  ok(nrCov?.status === "not-run" && !("note" in nrCov), "a not-run criteria entry has a reason and no note");

  const noDot = runClauses(jr([], { jurisdiction: { planningOfficeName: JUR.planningOfficeName } }));
  ok(cover(noDot, "criteriaNamed")?.status === "not-run" && /dotName/.test(cover(noDot, "criteriaNamed").reason), "a jurisdiction with no dotName → not-run (reason names dotName)");
  const emptyDot = runClauses(jr([], { jurisdiction: { dotName: "", planningOfficeName: "" } }));
  ok(cover(emptyDot, "criteriaNamed")?.status === "not-run", "an empty dotName → not-run");
  // There is no `agencies` key on TisReport; the clause must read `jurisdiction`.
  // What it cites depends on what exists: no planning office and no findings array → neither is a path.
  const bare = { request: {}, result: { jurisdiction: { dotName: JUR.dotName }, methodology: [], affectedIntersections: [], periodReports: [] } };
  const bh = byClause(runClauses(bare), "criteriaNamed");
  ok(bh.length === 1 && bh[0].readPaths.map((p) => p.path).join() === "result.jurisdiction.dotName" && !/planning office/.test(bh[0].detail), "with no planning office and no findings array, only dotName is cited and no office is mentioned");
  resolves("criteria record with only a dotName", bare);
  const messy = runClauses(jr([null, 42, { a: 1 }, `per ${JUR.dotName} TIS guidance`]));
  ok(cover(messy, "criteriaNamed")?.status === "ran" && byClause(messy, "criteriaNamed").length === 0, "non-string entries in findings are ignored, and the string among them still counts");
  const invented = runClauses({ request: {}, result: { agencies: { dotName: "Raleigh Department of Transportation" }, findings: [], methodology: [], affectedIntersections: [], periodReports: [] } });
  ok(cover(invented, "criteriaNamed")?.status === "not-run", "a record with an `agencies` key and no jurisdiction → not-run (the clause reads result.jurisdiction)");
}

// --- §6 analysis periods ----------------------------------------------------------
{
  const ALL4 = ["am_peak", "pm_peak", "saturday_midday", "daily"];
  const pr = (...periods) => periods.map((p) => ({ period: p, affectedIntersections: [] }));
  const per = (asked, periods, findings = [], extra = {}) => ({
    request: asked === undefined ? {} : { analysisPeriods: asked },
    result: { findings, methodology: [], affectedIntersections: [], periodReports: pr(...periods), ...extra },
  });
  const run = (r) => byClause(runClauses(r), "periodScopeDisclosed");

  const twoAsked = per(["am_peak", "pm_peak"], ["pm_peak"]);
  const hits = run(twoAsked);
  ok(hits.length === 1 && hits[0].type === "DISCLOSE" && /Missing and not disclosed: am_peak\./.test(hits[0].detail), "a requested period with no report must be disclosed (am_peak named, pm_peak not)");
  ok(hits[0]?.readPaths.map((p) => `${p.path}=${p.value}`).join() === "request.analysisPeriods[0]=am_peak,result.periodReports.length=1,result.periodReports[0].period=pm_peak", "readPaths: the missing request entry, how many reports exist, and each period that was reported — all literal");
  resolves("requested period never reported", twoAsked);
  const second = per(["pm_peak", "am_peak"], ["pm_peak"]);
  ok(run(second)[0]?.readPaths[0].path === "request.analysisPeriods[1]", "the missing period is addressed by its own index in request.analysisPeriods");

  // Every period reported → nothing to say.
  ok(run(per(ALL4, ALL4)).length === 0 && cover(runClauses(per(ALL4, ALL4)), "periodScopeDisclosed")?.status === "ran", "every requested period reported → clean, and the clause ran");
  ok(run(per(undefined, ALL4)).length === 0, "no analysisPeriods in the request means all four defaults, and all four are reported → clean");
  const dflt = run(per(undefined, ["am_peak", "pm_peak", "saturday_midday"]));
  ok(dflt.length === 1 && /Missing and not disclosed: daily\./.test(dflt[0].detail) && !dflt[0].readPaths.some((p) => p.path.startsWith("request.")), "defaults apply when the request names none: daily missing is a finding, and no request path is cited for a request that said nothing");
  resolves("default periods, daily missing", per(undefined, ["am_peak", "pm_peak", "saturday_midday"]));
  const emptyAsked = run(per([], ["pm_peak"]));
  ok(emptyAsked.length === 1 && /Missing and not disclosed: am_peak, saturday_midday, daily\./.test(emptyAsked[0].detail), "analysisPeriods: [] means the defaults (the engine tests length > 0), so three periods are missing");

  // The disclosure must come from this study's findings, and must actually say it.
  const say = (...f) => run(per(["am_peak", "pm_peak"], ["pm_peak"], f)).length;
  ok(say("The AM peak was not analyzed for this study.") === 0, "'The AM peak was not analyzed' discloses am_peak");
  ok(say("The am_peak period was excluded from the request.") === 0, "naming the period by its identifier also discloses it");
  ok(say("Only the PM peak was analyzed.") === 0, "'Only the PM peak was analyzed' discloses every period it left out");
  ok(say("AM peak trip generation: 102 trips.") === 1, "merely mentioning the AM peak is not a disclosure that it was not analyzed");
  ok(say(...REAL_FINDINGS) === 1, "none of the engine's eight real findings — several say 'not' and 'no' — discloses a missing period");
  const bp = run(per(["am_peak", "pm_peak"], ["pm_peak"], [], { methodology: ["The AM peak was not analyzed for this study."] }));
  ok(bp.length === 1, "a disclosure in methodology only does not count — only findings do");
  // A missing "daily" or "pm_peak" must not be satisfied by the engine's trip-generation sentence, which says both words.
  const dailyMissing = run(per(["pm_peak", "daily"], ["pm_peak"], [S_TRIPS]));
  ok(dailyMissing.length === 1 && /Missing and not disclosed: daily\./.test(dailyMissing[0].detail), "daily missing is NOT disclosed by 'new daily vehicle trips' in the trip-generation sentence");
  const pmMissing = run(per(["am_peak", "pm_peak"], ["am_peak"], [S_TRIPS]));
  ok(pmMissing.length === 1 && /Missing and not disclosed: pm_peak\./.test(pmMissing[0].detail), "pm_peak missing is NOT disclosed by 'during the PM peak hour' in the trip-generation sentence");
  const satMissing = run(per(["pm_peak", "saturday_midday"], ["pm_peak"], [S_PASSBY]));
  ok(satMissing.length === 1 && /Missing and not disclosed: saturday_midday\./.test(satMissing[0].detail), "saturday_midday missing is NOT disclosed by the pass-by sentence's 'Saturday-midday periods'");
  ok(run(per(["pm_peak", "daily"], ["pm_peak"], ["Daily volumes were not analyzed."])).length === 0, "'Daily volumes were not analyzed' discloses daily");
  ok(run(per(["pm_peak", "saturday_midday"], ["pm_peak"], ["The Saturday midday period was not studied."])).length === 0, "'The Saturday midday period was not studied' discloses saturday_midday");
  // Two missing, one disclosed: the other is still reported, and only it is named.
  const oneOf = run(per(["am_peak", "pm_peak", "daily"], ["pm_peak"], ["The AM peak was not analyzed."]));
  ok(oneOf.length === 1 && /Missing and not disclosed: daily\./.test(oneOf[0].detail) && oneOf[0].readPaths[0].path === "request.analysisPeriods[2]" && !oneOf[0].readPaths.some((p) => p.path === "request.analysisPeriods[0]"), "with am_peak disclosed and daily not, only daily is named and cited");

  for (const phrase of [
    "The AM peak was never analyzed.",
    "No AM peak analysis was performed.",
    "The study proceeded without an AM peak analysis.",
    "The AM peak was omitted.",
    "The AM peak is unanalyzed.",
    "The AM peak analysis is absent.",
    "The AM peak is outside the scope of this study.",
  ]) {
    ok(say(phrase) === 0, `"${phrase}" discloses am_peak`);
  }
  ok(say(null, 42, { a: 1 }, "The AM peak was not analyzed.") === 0, "non-string entries in findings are ignored and do not crash the clause");
  ok(say("Mitigation is recommended only where the build condition reaches LOS E or F.") === 1, "'only' in a clause that names no period is not a scope statement");
  const dup = run(per(["am_peak", "am_peak", "pm_peak"], ["pm_peak"]));
  ok(dup.length === 1 && /Missing and not disclosed: am_peak\./.test(dup[0].detail) && /Requested: am_peak, pm_peak\./.test(dup[0].detail) && dup[0].readPaths.filter((p) => p.path.startsWith("request.")).length === 1, "a period listed twice in the request is one period: named once, cited once");

  // The path index is the entry's real index, not a running count of the usable ones.
  const shifted = per(["am_peak", "pm_peak"], [], [], { periodReports: [{ affectedIntersections: [] }, { period: "pm_peak", affectedIntersections: [] }] });
  ok(run(shifted)[0]?.readPaths.map((p) => `${p.path}=${p.value}`).join() === "request.analysisPeriods[0]=am_peak,result.periodReports.length=2,result.periodReports[1].period=pm_peak", "a report entry with no period before pm_peak: pm_peak is addressed as periodReports[1]");
  resolves("periodReports with a period-less first entry", shifted);
  const rawFirst = per([5, "am_peak"], ["pm_peak"]);
  ok(run(rawFirst)[0]?.readPaths[0].path === "request.analysisPeriods[1]", "a non-string entry in request.analysisPeriods does not shift the index of the one that follows");
  resolves("analysisPeriods with a non-string first entry", rawFirst);

  // Legacy and empty records.
  const legacy = runClauses(fixture("legacy-minimal"));
  const lc = cover(legacy, "periodScopeDisclosed");
  ok(lc?.status === "ran" && /periodReports/.test(lc.note ?? ""), "a record with no periodReports but a top-level PM block runs on that block, and the coverage note says so");
  ok(/Reported: pm_peak\./.test(byClause(legacy, "periodScopeDisclosed")[0]?.detail ?? ""), "…and reports that the study carries only pm_peak");
  resolves("legacy record with only a PM block", fixture("legacy-minimal"));
  const empty = runClauses({ request: {}, result: {} });
  ok(cover(empty, "periodScopeDisclosed")?.status === "not-run" && /periodReports/.test(cover(empty, "periodScopeDisclosed").reason), "a record with neither periodReports nor affectedIntersections → not-run (which periods ran cannot be read)");
}

// --- §6 study scope ----------------------------------------------------------------
{
  const sc = (over, findings = []) => ({
    request: {},
    result: { studyRadiusMi: 1, intersectionsStudied: 20, intersectionsInStudyArea: 22, intersectionsMergedAsDuplicates: 2, findings, methodology: [], affectedIntersections: [], periodReports: [], ...over },
  });
  const run = (r) => byClause(runClauses(r), "scopeNoteConsistent");

  const hits = run(sc({}));
  ok(hits.length === 1 && hits[0].type === "NOTE", "a merged-duplicate gap with no scope disclosure is a NOTE (the clause cannot see the PDF's scope sentence)");
  ok(/22 signalized intersection\(s\) within the 1 mi radius/.test(hits[0]?.detail) && /2 were absorbed as duplicate/.test(hits[0]?.detail) && /20 were analyzed/.test(hits[0]?.detail), "detail carries the three counts and the radius");
  ok(hits[0]?.readPaths.map((p) => `${p.path}=${p.value}`).join() === "result.intersectionsInStudyArea=22,result.intersectionsMergedAsDuplicates=2,result.intersectionsStudied=20", "readPaths are the three counts");
  resolves("merged duplicates", sc({}));

  // The engine's own finding says "study area" on every study with rows, so that phrase must not count as disclosure.
  ok(run(sc({}, [S_AREA])).length === 1, "the engine's real 'N signalized intersections fall within the study area' finding does NOT satisfy the clause");
  ok(run(sc({}, REAL_FINDINGS)).length === 1, "…nor do all eight of the engine's real findings");
  ok(run(sc({}, ["Two records were merged into a junction already counted."])).length === 0, "a finding saying records were 'merged' discloses the gap");
  ok(run(sc({}, ["Duplicate inventory records were removed."])).length === 0, "a finding saying 'duplicate' discloses the gap");
  ok(run(sc({ methodology: ["Merged records are duplicates of an analyzed intersection."] }, [])).length === 1, "methodology prose does not count — only findings do");
  ok(cover(runClauses(sc({}, ["merged"])), "scopeNoteConsistent")?.status === "ran", "a disclosed gap: the clause ran");

  // What is and is not a gap.
  ok(run(sc({ intersectionsMergedAsDuplicates: 0, intersectionsStudied: 22 })).length === 0 && cover(runClauses(sc({ intersectionsMergedAsDuplicates: 0, intersectionsStudied: 22 })), "scopeNoteConsistent")?.status === "ran", "nothing merged and every in-radius junction analyzed → clean, clause ran");
  ok(run(sc({ intersectionsMergedAsDuplicates: 0, intersectionsStudied: 25 })).length === 0, "force-included signals from outside the radius (analyzed 25 > in-radius 22) are not a gap");
  ok(run(sc({ intersectionsStudied: 24 })).length === 1, "merged duplicates are a note even when force-included signals bring the analyzed count above the in-radius count (24 of 22, 2 merged)");
  const trimmed = run(sc({ intersectionsMergedAsDuplicates: 0, intersectionsStudied: 18 }));
  ok(trimmed.length === 1 && /4 distinct junction\(s\) inside the radius are not in the analyzed set/.test(trimmed[0].detail) && !/absorbed as duplicate/.test(trimmed[0].detail), "nothing merged but fewer analyzed than in the radius → NOTE naming the 4 left out, without claiming a merge");
  ok(/2 were absorbed as duplicate/.test(hits[0]?.detail) && !/not in the analyzed set/.test(hits[0]?.detail), "20 analyzed of 22 with 2 merged: the merge accounts for the whole gap, so no 'left out' claim");

  ok(/within the study radius/.test(run(sc({ studyRadiusMi: undefined }))[0]?.detail ?? "") && /absorbed as duplicate/.test(run(sc({ studyRadiusMi: undefined }))[0]?.detail ?? ""), "with no studyRadiusMi the detail says 'the study radius' rather than printing undefined");
  ok(/1 was absorbed as duplicate/.test(run(sc({ intersectionsMergedAsDuplicates: 1, intersectionsStudied: 21 }))[0]?.detail ?? "") && /1 was analyzed/.test(run(sc({ intersectionsInStudyArea: 2, intersectionsMergedAsDuplicates: 1, intersectionsStudied: 1 }))[0]?.detail ?? ""), "singular counts read 'was', not 'were'");
  const legacy = runClauses(fixture("legacy-minimal"));
  ok(cover(legacy, "scopeNoteConsistent")?.status === "not-run" && /predates intersectionsInStudyArea/.test(cover(legacy, "scopeNoteConsistent").reason), "a payload predating intersectionsInStudyArea → not-run");
  const nul = runClauses(sc({ intersectionsMergedAsDuplicates: null }));
  ok(cover(nul, "scopeNoteConsistent")?.status === "not-run" && byClause(nul, "scopeNoteConsistent").length === 0 && /not a number/.test(cover(nul, "scopeNoteConsistent").reason), "intersectionsMergedAsDuplicates: null → not-run as not a number (not '0 were absorbed' or 'null were absorbed')");
  const strM = runClauses(sc({ intersectionsMergedAsDuplicates: "2" }));
  ok(cover(strM, "scopeNoteConsistent")?.status === "not-run", 'intersectionsMergedAsDuplicates: "2" (a string) → not-run');
  const noStudied = runClauses(sc({ intersectionsStudied: undefined }));
  ok(cover(noStudied, "scopeNoteConsistent")?.status === "not-run" && /intersectionsStudied/.test(cover(noStudied, "scopeNoteConsistent").reason), "no intersectionsStudied → not-run, reason names it");
}

// --- partial coverage is stated, at the top level (the v/c clauses too) --------------
{
  const sparse = [row({ name: "Real", existingVc: 3.0, approaches: [{ direction: "NB", existingVc: 3.3 }] })];
  for (let i = 0; i < 19; i++) sparse.push(row({ name: `Bare${i}`, approaches: [{ direction: "NB" }] }));
  const sp = runClauses(rec(sparse));
  ok(/judged 1 of 20 study intersections; 19 carried no numeric currentVc\/existingVc/.test(cover(sp, "vcPlausibilityIntersection")?.note ?? ""), "intersection clause: 1 judged of 20 → coverage note says so");
  ok(/judged 1 of 20 study approaches; 19 carried no numeric currentVc\/existingVc/.test(cover(sp, "vcPlausibilityApproach")?.note ?? ""), "approach clause: 1 judged of 20 → coverage note says so");
  const dsp = [row({ name: "Real", designNoBuildVc: 2.6 })];
  for (let i = 0; i < 19; i++) dsp.push(row({ name: `Bare${i}` }));
  const dn = cover(runClauses(rec(dsp)), "vcPlausibilityDesignYear")?.note ?? "";
  ok(/judged 1 of 20 design-year No-Build scenarios; 19 carried no numeric designNoBuildVc/.test(dn) && /judged 0 of 20 design-year Build scenarios; 20 carried no numeric designBuildVc/.test(dn), "design-year clause: both the No-Build and the Build tallies are in the note");
  // Clean AND partial: the case a silent `ran` would hide.
  const cleanPartial = runClauses(rec([row({ name: "Fine", existingVc: 1.0 }), row({ name: "Bare" })]));
  ok(cover(cleanPartial, "vcPlausibilityIntersection")?.status === "ran" && byClause(cleanPartial, "vcPlausibilityIntersection").length === 0 && /judged 1 of 2 study intersections; 1 carried no numeric currentVc\/existingVc/.test(cover(cleanPartial, "vcPlausibilityIntersection").note ?? ""), "a CLEAN partial result still says what it did not judge");
  const whole = runClauses(rec([row({ existingVc: 1.0 }), row({ existingVc: 1.1 })]));
  ok(["vcPlausibilityIntersection"].every((id) => cover(whole, id)?.note === undefined && !("note" in cover(whole, id))), "a fully judged clause carries no note at all");
  const nr = cover(runClauses(rec([row({})])), "vcPlausibilityIntersection");
  ok(nr?.status === "not-run" && !("note" in nr), "a not-run entry carries a reason, never a note");
  const wake = runClauses(pre230);
  ok(cover(wake, "vcPlausibilityIntersection")?.note === undefined, "pre-#230 Wake: every row has a v/c → no note");
}

// --- the no-project clauses never fall back to futureVc ------------------------------
{
  const only = runClauses(rec([row({ futureVc: 3.5, approaches: [{ direction: "NB", futureVc: 3.6 }] })]));
  ok(cover(only, "vcPlausibilityIntersection")?.status === "not-run" && cover(only, "vcPlausibilityApproach")?.status === "not-run", "a row carrying only futureVc → both no-project clauses are not-run");
  ok(byClause(only, "vcPlausibilityIntersection").length === 0 && byClause(only, "vcPlausibilityApproach").length === 0, "…and neither reports futureVc 3.5/3.6 (the Build scenario is never a no-project fallback)");
}

// --- NaN and Infinity are not readings --------------------------------------------------
{
  // JSON cannot carry them, but a record built in memory can, and Number("n/a") is NaN.
  const nr = (r, id) => cover(runClauses(r), id)?.status === "not-run" && byClause(runClauses(r), id).length === 0;
  ok(nr(rec([row({ existingVc: NaN, currentVc: Infinity })]), "vcPlausibilityIntersection"), "v/c NaN and Infinity are neither a clean reading nor a breach → intersection not-run");
  ok(nr(rec([row({ approaches: [{ direction: "NB", existingVc: Infinity }] })]), "vcPlausibilityApproach"), "approach v/c Infinity → not-run");
  ok(nr(rec([row({ designBuildVc: NaN, designNoBuildVc: Infinity })]), "vcPlausibilityDesignYear"), "design-year v/c NaN/Infinity → not-run");
  ok(nr(rec([row({ futureDelaySec: Infinity, futureLos: "A" })]), "losMatchesDelay"), "a delay of Infinity beside a letter is not judged");
  ok(nr(rec([row({ futureDelaySec: Infinity })]), "screeningClampDisclosed"), "a delay of Infinity is not a clamped delay, and not a reading");
  const g = (res) => ({ request: {}, result: { findings: [], affectedIntersections: [], periodReports: [], ...res } });
  ok(nr(g({ growthAppliedPct: NaN, growthYears: 2, growthMultiplierExact: 1 }), "growthMultiplierReproduces"), "growthAppliedPct NaN → not-run");
  ok(nr(g({ tripGeneration: { size: 10, pmRate: NaN, pmPeakTrips: 5 } }), "rateReproducesTotal"), "a NaN rate → not-run");
  ok(nr(g({ tripGeneration: { landUseCode: "820", size: 10 }, passByPctApplied: NaN }), "passByBasisNamed"), "passByPctApplied NaN → not-run");
  ok(nr(g({ intersectionsInStudyArea: 5, intersectionsMergedAsDuplicates: NaN, intersectionsStudied: 4 }), "scopeNoteConsistent"), "intersectionsMergedAsDuplicates NaN → not-run");
}

// --- the harness itself: a malformed path fails on its own ----------------------------
{
  const rr = { request: { size: 1 }, result: { affectedIntersections: [{ existingVc: 3 }], periodReports: [{ period: "pm_peak" }] } };
  const mk = (path, value) => [{ clauseId: "x", readPaths: [{ path, value }] }];
  ok(pathProblems(mk("result.affectedIntersections[0].existingVc", 3), rr).length === 0, "grammar: a literal path to a recorded value is accepted");
  ok(pathProblems(mk("request.size", 1), rr).length === 0 && pathProblems(mk("result.periodReports[0].period", "pm_peak"), rr).length === 0 && pathProblems(mk("result.affectedIntersections.length", 1), rr).length === 0, "grammar: request paths, string values and .length are accepted");
  for (const badPath of [
    "result.affectedIntersections.[0].existingVc", // a tolerant tokenizer reads this as the good path
    "result.affectedIntersections[].existingVc",
    "result..affectedIntersections",
    "result.affectedIntersections[0]existingVc",
    "result.affectedIntersections[0].existingVc.",
    "LAND_USES[820].passByPctPm",
    "affectedIntersections[0].existingVc",
    "result.periodReports[-1].period",
    "result.affectedIntersections[ 0 ].existingVc",
  ]) {
    ok(pathProblems(mk(badPath, 3), rr).some((s) => /malformed path/.test(s)), `grammar: "${badPath}" fails as malformed`);
  }
  ok(pathProblems(mk("result.affectedIntersections[0].existingVc", 4), rr).some((s) => /resolves to 3, recorded 4/.test(s)), "a well-formed path whose value differs from the record is reported as such");
  ok(pathProblems(mk("result.affectedIntersections[7].existingVc", 3), rr).length === 1, "a well-formed path that addresses nothing is reported");
}

// --- coverage is per clause, and never claims a section passed ----------------------
{
  const res = runClauses(fixture("legacy-minimal"));
  ok(res.coverage.length === ALL_CLAUSES.length, `coverage covers all ${ALL_CLAUSES.length} clauses`);
  ok(res.coverage.some((c) => c.status === "not-run"), "a legacy record reports real not-run coverage");
  ok(!("sections" in res), "the result exposes no per-section pass/fail");
  ok(res.coverage.every((c) => c.status === "ran" || (c.reason && !("note" in c))), "a not-run entry has a reason and no note");
  ok(ALL_CLAUSES.map((c) => c.id).sort().join() === [...TWELVE].sort().join(), "exactly the twelve Phase 1 clauses are registered");
  const sections = new Set(ALL_CLAUSES.map((c) => c.section));
  ok([1, 2, 4, 5, 6].every((s) => sections.has(s)), "the clauses span §1, §2, §4, §5 and §6");
  // The sink fires every clause, so each of the twelve is contract-checked above.
  const sink = runClauses(everyClause);
  ok(TWELVE.every((id) => byClause(sink, id).length > 0), `the mutated real payload fires all ${TWELVE.length} clauses (${TWELVE.filter((id) => byClause(sink, id).length === 0).join(", ") || "none missing"})`);
  resolves("the mutated real payload", everyClause);
}

ok(unverified.length === 0, `no registered clause emitted UNVERIFIED on any record in this suite (what cannot be checked rides CoverageEntry.note, not the findings list — TIS-PROOFREAD-PROTOCOL.md:65-69)${unverified.length ? `: ${[...new Set(unverified)].join(", ")}` : ""}`);
ok(threw.length === 0, `no clause threw on any record in this suite (a throw is reported as not-run and would pass every not-run assertion)${threw.length ? `: ${[...new Set(threw)].slice(0, 5).join("; ")}` : ""}`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
