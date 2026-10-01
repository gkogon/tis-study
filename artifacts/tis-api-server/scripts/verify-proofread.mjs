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

/** A minimal record around some intersection rows (and optionally per-period reports). */
const rec = (rows, periodReports = []) => ({
  request: {},
  result: { affectedIntersections: rows, periodReports },
});
const row = (over) => ({ signalId: "s", name: "N", approaches: [], ...over });

const pre230 = fixture("wake-pre-230");
const current = fixture("wake-current");

// --- every clause obeys the finding contract -------------------------------
// The loop runs over the findings of BOTH fixtures so that all three clauses are
// contract-checked (pre-#230 fires only the intersection clause), and a final
// assertion fails if any registered clause never reached the loop.
{
  const res = runClauses(pre230);
  const all = [...res.findings, ...runClauses(current).findings];
  ok(res.findings.length > 0, `pre-#230 Wake produces findings (${res.findings.length})`);
  const seen = new Set(all.map((f) => f.clauseId));
  ok(ALL_CLAUSES.every((c) => seen.has(c.id)), `contract loop reaches every registered clause (${[...seen].join(", ")})`);
  const ALLOWED = ["clauseId", "section", "type", "title", "detail", "sourceLabel", "readPaths", "remedy", "audience"];
  for (const f of all) {
    ok(typeof f.sourceLabel === "string" && f.sourceLabel.length > 0, `${f.clauseId}: names a source`);
    ok(
      Array.isArray(f.readPaths) &&
        f.readPaths.length > 0 &&
        f.readPaths.every((p) => typeof p.path === "string" && p.path.length > 0 && (p.value === null || ["string", "number", "boolean"].includes(typeof p.value))),
      `${f.clauseId}: records what it read (path + scalar value)`,
    );
    ok(!("patch" in f) && !("replacement" in f), `${f.clauseId}: advisor only — no patch field`);
    ok(Object.keys(f).every((k) => ALLOWED.includes(k)), `${f.clauseId}: no field outside the finding contract (no suggested value of any name)`);
    ok(["BLOCKER", "DEFECT", "DISCLOSE", "NOTE", "UNVERIFIED", "CONTESTED"].includes(f.type), `${f.clauseId}: known type`);
  }
  ok(res.coverage.length === ALL_CLAUSES.length, `coverage has one entry per clause (${res.coverage.length})`);
  ok(res.coverage.map((c) => c.clauseId).join() === ALL_CLAUSES.map((c) => c.id).join(), "coverage names the registered clauses, in order");
  for (const c of res.coverage) {
    ok(c.status === "ran" || (c.status === "not-run" && !!c.reason), `${c.clauseId}: not-run carries a reason`);
  }
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
  ok(new Set(hits[0].readPaths.map((p) => p.path)).size === 5, "each offending row has its own path");
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

// --- §4 approach and design-year: silent today, must fire ----------------
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
      "result.pm_peak.affectedIntersections[1].approaches[0],result.pm_peak.affectedIntersections[0].approaches[0]",
    "approach readPaths address the offending approaches, worst first",
  );
  const dy = byClause(res, "vcPlausibilityDesignYear");
  ok(dy.length === 1, "design-year v/c fires on the current Wake sample (designBuildVc 2.54)");
  ok(dy[0].readPaths.length === 1 && /\.designBuildVc$/.test(dy[0].readPaths[0].path) && dy[0].readPaths[0].value === 2.54, "only designBuildVc 2.54 is an offender (designNoBuildVc 2.49 is under the ceiling)");
  ok(/1 of 4 design-year scenarios/.test(dy[0].detail) && !/no-project/.test(dy[0].detail), "design-year detail counts 1 of 4 scenarios and does not call a Build value 'no-project'");
  ok(/Spring Forest Road & Capital Boulevard Design Build \[pm_peak\] \(v\/c 2\.54\)/.test(dy[0].detail), "design-year detail names the scenario (Design Build), period and value");
  ok(/no-project/.test(appr[0].detail) && /no-project/.test(byClause(runClauses(pre230), "vcPlausibilityIntersection")[0].detail), "intersection and approach details say 'no-project' (they judge only the no-project scenarios)");

  const nb = byClause(runClauses(rec([row({ designNoBuildVc: 2.6 })])), "vcPlausibilityDesignYear");
  ok(nb.length === 1 && /designNoBuildVc$/.test(nb[0].readPaths[0].path), "designNoBuildVc alone above the ceiling fires");
  const both = byClause(runClauses(rec([row({ designNoBuildVc: 2.6, designBuildVc: 2.7 })])), "vcPlausibilityDesignYear");
  ok(both.length === 1 && both[0].readPaths.length === 2, "both design scenarios over the ceiling are listed in one finding");
  const apprPartial = byClause(runClauses(rec([row({ approaches: [{ direction: "EB", existingVc: 3.4 }] })])), "vcPlausibilityApproach");
  ok(apprPartial.length === 1, "an approach with only existingVc 3.4 (no currentVc) still fires");
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
    ok(h.length === 1 && /am_peak/.test(h[0].readPaths[0].path) && /AM-only/.test(h[0].detail), `${id}: an offender found only in periodReports[am_peak] fires`);
  }

  // The engine writes the PM rows to BOTH result.affectedIntersections and periodReports[pm_peak].
  const offender = row({ name: "Mirror", existingVc: 3.0, designBuildVc: 2.9, approaches: [{ direction: "NB", existingVc: 3.2 }] });
  const mirrored = rec([clone(offender)], [{ period: "pm_peak", affectedIntersections: [clone(offender)] }]);
  const m = runClauses(mirrored);
  for (const id of ["vcPlausibilityIntersection", "vcPlausibilityApproach", "vcPlausibilityDesignYear"]) {
    const h = byClause(m, id);
    ok(h.length === 1 && h[0].readPaths.length === 1 && /1 of \d+ /.test(h[0].detail) && !/2 of/.test(h[0].detail), `${id}: the mirrored PM rows are counted once, not twice`);
  }
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

  // PM excluded from analysisPeriods: the engine synthesizes the top-level block and there is no pm_peak report.
  const synth = rec([row({ name: "Synth", existingVc: 3.0 })], [{ period: "am_peak", affectedIntersections: [row({ name: "Fine", existingVc: 1.0 })] }]);
  const sh = byClause(runClauses(synth), "vcPlausibilityIntersection");
  ok(sh.length === 1 && /Synth/.test(sh[0].detail) && /1 of 2 study intersections/.test(sh[0].detail), "with no pm_peak report, the top-level rows are still scanned");
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
