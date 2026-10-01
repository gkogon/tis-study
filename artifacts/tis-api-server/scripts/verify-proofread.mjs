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
const { runClauses, ALL_CLAUSES, findingFingerprint, engineStamp } = await import(
  path.resolve(here, "../src/lib/proofread/index.ts")
);
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

/** Resolve `result.periodReports[1].affectedIntersections[0].existingVc` against a record. */
const resolve = (obj, p) => {
  let cur = obj;
  for (const m of p.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (cur === null || cur === undefined) return undefined;
    cur = m[1] !== undefined ? cur[m[1]] : cur[Number(m[2])];
  }
  return cur;
};
/** Every readPath of every finding must resolve, in the record, to the value recorded beside it. */
const resolves = (name, r) => {
  const res = runClauses(r);
  const bad = res.findings.flatMap((f) => f.readPaths.filter((p) => resolve(r, p.path) !== p.value).map((p) => `${f.clauseId}:${p.path}`));
  ok(res.findings.length > 0 && bad.length === 0, `${name}: every readPath resolves to its recorded value (${res.findings.reduce((n, f) => n + f.readPaths.length, 0)} paths${bad.length ? `; unresolved ${bad.join(", ")}` : ""})`);
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

const SRC_INTERSECTION = "lib/tis-engine-core/src/signal-delay.ts — PLAUSIBLE_MAX_INTERSECTION_VC = 2.5";
const SRC_APPROACH =
  "lib/tis-engine-core/src/signal-delay.ts — PLAUSIBLE_MAX_INTERSECTION_VC (2.5), authored for intersection v/c; applied here to per-approach v/c on the approach's own lane capacity as a screen";
const SRC_DESIGN =
  "lib/tis-engine-core/src/signal-delay.ts — PLAUSIBLE_MAX_INTERSECTION_VC (2.5), authored for current and opening-year no-project intersection v/c; applied here to design-year scenarios as a screen";

// --- every clause obeys the finding contract -------------------------------
// The loop runs over the findings of three records so that all three clauses and both design-year
// outcomes (BLOCKER and DISCLOSE) are contract-checked, and a final assertion fails if any registered
// clause never reached the loop.
{
  const res = runClauses(pre230);
  const all = [...res.findings, ...runClauses(current).findings, ...runClauses(withNoBuildBreach).findings];
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
  ok(ALL_CLAUSES.every((c) => cover(res2, c.id)?.status === "ran"), "current Wake: all three clauses ran");
  const empty = runClauses({ request: {}, result: {} });
  ok(empty.findings.length === 0 && empty.coverage.every((c) => c.status === "not-run" && c.reason), "a record with no rows: every clause not-run with a reason");
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
  ok(cover(textOnly, "vcPlausibilityIntersection")?.status === "not-run" && textOnly.findings.length === 0, 'currentVc "n/a" and nothing else → not-run, not ran-clean');
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
  ok(a.findings.length === 2 && new Set(a.findings.map(findingFingerprint)).size === 2, "different clauses on one record have different fingerprints");
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

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
