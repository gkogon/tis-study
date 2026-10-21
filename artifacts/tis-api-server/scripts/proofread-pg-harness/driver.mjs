/**
 * The assertions run.mjs makes against the real proofread routes, store, runner and limiters, over HTTP, with SQL
 * against the throwaway database for setup and for what the HTTP answers cannot show. Not runnable alone: run.mjs
 * hands it the server, the database and the tree's fixture and read contract.
 *
 * Tags name the fix each newer family pins: [FW-1 carry] carry-forward is gated on the rules version, not the
 * deploy; [FW-2 date] a carried decision keeps its date; [FW-3 withheld] admin-audience findings are counted,
 * never shown; [FW-5 422] the server refuses a decision the finding's type is not offered; [FW-6 409] a decision
 * on a run that is not the project's newest finished run is refused; [claim] claimAndRunOne leaves the study rows
 * alone; [append-only] no disposition row, once written, is rewritten (even to identical values) or deleted;
 * [RR-1] a run is stamped with the rules it ran under, the carry compares those, and a run re-claimed across a
 * rules change fails rather than mixing two rule sets; [m-6] GET says when the previous revision ran under other
 * rules (`rulesChanged`); [M1] an uppercase run id is the same run; [M2] a 'ready' run is finished: it takes
 * decisions and the next revision carries them; [limiter] each limiter's own budget, per-user key and draft-7
 * headers; [datum migrations] migrate.mjs's statements for the Datum chat, run on a second database in the same
 * cluster, build what drizzle builds and re-run as a no-op; [datum RF3] a re-run is saved as a new version, insert-only,
 * numbered max+1 within its lineage under concurrent saves, the original byte-identical; [datum] the chat's other DB
 * functions (firm scoping, the 24-hour reply count, the thread, the lineage, the visible findings, the delete rules).
 * Untagged assertions are the original tenancy and rules suite.
 *
 * The database is written directly in a few places, each named where it happens: users and projects (the app has
 * no route the harness can use for them), a finding of a type or audience the clause pass does not produce, a
 * run that is still running, a run recorded under another rules version, queued runs for the claim and for a run
 * queued by another deploy, a run left 'running' by a crashed attempt with a finding already written, and a run
 * moved to 'ready' (phase 1 never writes it). The [datum] block writes its own studies, backdates messages, names a
 * user, adds findings to a run, deletes a finding and two studies, and drops the chat's objects in the second database
 * only, each where it happens.
 */
import { isDeepStrictEqual } from "node:util";

const UNKNOWN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const NOT_FOUND = "Finding not found.";
const DOES_NOT_APPLY = "This decision does not apply to this finding.";
const RUN_AGAIN = "This check has been run again. Refresh to see the latest.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * An error's message with its cause chain, so the one line that summarises a failure keeps why: undici's "fetch
 * failed" says nothing until its cause ("ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:54321") is read.
 */
const withCauses = (err) => {
  const parts = [];
  for (let e = err, depth = 0; e != null && depth < 5; e = typeof e === "object" ? e.cause : undefined, depth++) {
    parts.push(e instanceof Error || (typeof e === "object" && "message" in e) ? `${e.code ? `${e.code}: ` : ""}${e.message}` : String(e));
  }
  return parts.join(" <- caused by ");
};

export async function drive({ call: rawCall, q, claimOne: rawClaimOne, restart, contract, fixture, serverLines, SHA_A, SHA_B, datum, datumContract, qm, migrateStatements }) {
  const results = [];
  const t = (name, cond, detail) => {
    results.push({ name, ok: !!cond });
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || detail === undefined ? "" : `\n        ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.slice(0, 1200)}`);
  };
  // [append-only] Every disposition row, by id, hashed with its text AND its xmin: an UPDATE that writes identical
  // values still gets a new xmin. Read before and after every POST and every claim (each may write the log, and a
  // GET's background sweep may too, between them); a row once seen must hash the same at every later read.
  const logSeen = new Map();
  const logChanges = [];
  let logReads = 0;
  const readLog = async (label) => {
    const now = new Map((await q("select d.id, md5(d::text || ':' || d.xmin::text) h from study_proofread_dispositions d")).map((r) => [r.id, r.h]));
    logReads++;
    for (const [id, h] of logSeen) {
      if (now.get(id) !== h) {
        logChanges.push(`${label}: ${now.has(id) ? "rewrote" : "deleted"} ${id}`);
        logSeen.set(id, now.get(id));
      }
    }
    for (const [id, h] of now) if (!logSeen.has(id)) logSeen.set(id, h);
  };
  const watched = async (label, act) => {
    await readLog(`before ${label}`);
    try {
      return await act();
    } finally {
      await readLog(`after ${label}`);
    }
  };
  const call = (method, p, opts) => (method === "GET" ? rawCall(method, p, opts) : watched(`${method} ${p}`, () => rawCall(method, p, opts)));
  const claimOne = () => watched("claim", rawClaimOne);
  const U = (n) => `user-${n}|${n}@example.test`;
  const count = async (sql, p = []) => Number((await q(sql, p))[0].c);
  const dispCount = () => count("select count(*) c from study_proofread_dispositions");
  const contractFailures = [];
  let contractChecked = 0;
  /** GET the panel's read, and hold every 200 answer to the tree's read contract. */
  const get = async (projectId, n) => {
    const r = await call("GET", `/projects/${projectId}/proofread`, { user: U(n) });
    if (r.status === 200) {
      contractChecked++;
      const parsed = contract.ProofreadReadResponse.safeParse(r.body);
      if (!parsed.success) contractFailures.push({ projectId, issues: parsed.error.issues.slice(0, 3) });
    }
    return r;
  };
  const dispUrl = (p, r, f) => `/projects/${p}/proofread/${r}/findings/${f}/dispositions`;

  try {
    // ---- setup ------------------------------------------------------------------------------------------
    for (const n of ["a", "b", "c", "lim", "lim2", "lim3"]) await q("insert into users (id, email) values ($1, $2)", [`user-${n}`, `${n}@example.test`]);
    // A firm is created the repo's way: on a user's first authenticated request.
    for (const n of ["a", "b", "lim", "lim2"]) await call("GET", `/projects/${UNKNOWN}/proofread`, { user: U(n) });
    const firmOf = async (n) => (await q("select firm_id from firm_members where user_id = $1", [`user-${n}`]))[0]?.firm_id;
    const [fa, fb, flim, flim2] = [await firmOf("a"), await firmOf("b"), await firmOf("lim"), await firmOf("lim2")];
    t("setup: four distinct firms were created by first requests", new Set([fa, fb, flim, flim2]).size === 4 && [fa, fb, flim, flim2].every(Boolean));
    await q("insert into firm_members (firm_id, user_id, role) values ($1, 'user-c', 'member')", [fa]); // C is a second member of A's firm

    // A real generateTisReport payload (artifacts/atlanta-tis/scripts/fixtures/scenario-base.json): its clause pass
    // raises BLOCKERs, a DISCLOSE and a NOTE. The DEFECT study is the same payload with one LOS letter that its own
    // delay does not map to, which is what losMatchesDelay exists to catch.
    const defectStudy = structuredClone(fixture);
    const flipLos = (rows) => {
      for (const r of Array.isArray(rows) ? rows : []) {
        if (typeof r?.currentDelaySec === "number" && /^[A-F]$/.test(r?.currentLos ?? "")) {
          r.currentLos = r.currentDelaySec < 30 ? "F" : "A";
          return true;
        }
      }
      return false;
    };
    let flipped = flipLos(defectStudy.affectedIntersections);
    for (const p of defectStudy.periodReports ?? []) flipped = flipLos(p?.affectedIntersections) || flipped;
    const small = (name) => [{ projectName: name, growthRatePct: 5 }, { marker: name, big: "x".repeat(2000) }];
    const mkProject = async (userN, firm, name, [request, result]) =>
      (
        await q(
          "insert into tis_projects (user_id, firm_id, project_name, land_use_code, request_payload, result_payload) values ($1,$2,$3,'220',$4,$5) returning id",
          [`user-${userN}`, firm, name, JSON.stringify(request), JSON.stringify(result)],
        )
      )[0].id;
    const PA = await mkProject("a", fa, "A-study", [fixture.request ?? {}, fixture]);
    const PA2 = await mkProject("a", fa, "A-study-2", small("A-study-2"));
    const PD = await mkProject("a", fa, "A-defect-study", [defectStudy.request ?? {}, defectStudy]);
    const PH = await mkProject("a", fa, "A-claim-study", [fixture.request ?? {}, fixture]);
    const PB = await mkProject("b", fb, "B-study", small("B-study"));
    const PL = await mkProject("lim", flim, "L-study", small("L-study"));
    const PL2 = await mkProject("lim2", flim2, "L2-study", small("L2-study"));
    const PR = await mkProject("a", fa, "A-rules-study", [fixture.request ?? {}, fixture]);
    const PM = await mkProject("a", fa, "A-ready-study", [fixture.request ?? {}, fixture]);
    // Every study row's text AND its xmin: an UPDATE that writes identical values still gets a new xmin.
    const studyHash = async () => (await q("select md5(string_agg(t::text || ':' || t.xmin::text, '|' order by id)) h from tis_projects t"))[0].h;
    const h0 = await studyHash();

    // ---- unauthenticated ----------------------------------------------------------------------------------
    const r401 = [
      await call("GET", `/projects/${PA}/proofread`),
      await call("POST", `/projects/${PA}/proofread`),
      await call("POST", dispUrl(PA, UNKNOWN, UNKNOWN), { body: { disposition: "FIXED" } }),
    ];
    t("unauthenticated: all three routes answer 401", r401.every((r) => r.status === 401), r401.map((r) => r.status));

    // ---- read: nothing yet, foreign, unknown, malformed -----------------------------------------------------
    const none = await get(PA, "a");
    t("GET own project with no run: 200 status none, empty lists", none.status === 200 && none.body.status === "none" && none.body.findings.length === 0 && none.body.dispositions.length === 0, none);
    t("[FW-3 withheld] status none answers withheld: 0", none.body?.withheld === 0, none.body);
    t("[m-6] status none answers rulesChanged: false", none.body?.rulesChanged === false, none.body);
    const foreign = await call("GET", `/projects/${PB}/proofread`, { user: U("a") });
    const unknown = await call("GET", `/projects/${UNKNOWN}/proofread`, { user: U("a") });
    const malformed = [await call("GET", `/projects/not-a-uuid/proofread`, { user: U("a") }), await call("GET", `/projects/${"-".repeat(36)}/proofread`, { user: U("a") })];
    t("GET a foreign project: 404 'Project not found.' (never 403, never 200)", foreign.status === 404 && foreign.body?.error === "Project not found.", foreign);
    t("GET foreign and unknown ids are indistinguishable (same status, same body)", foreign.status === unknown.status && JSON.stringify(foreign.body) === JSON.stringify(unknown.body), [foreign.body, unknown.body]);
    t("GET malformed ids (incl. 36 dashes) are 404, not 500", malformed.every((r) => r.status === 404), malformed.map((r) => r.status));

    // ---- request a run ------------------------------------------------------------------------------------
    const runsB0 = await count("select count(*) c from study_proofread_runs where project_id = $1", [PB]);
    const crossRun = await call("POST", `/projects/${PB}/proofread`, { user: U("a") });
    const runsB1 = await count("select count(*) c from study_proofread_runs where project_id = $1", [PB]);
    t("POST run on a foreign project: 404 and NOTHING enqueued under the other firm", crossRun.status === 404 && runsB1 === runsB0, `status=${crossRun.status} runs ${runsB0}->${runsB1}`);
    const malformedRun = await call("POST", `/projects/${"-".repeat(36)}/proofread`, { user: U("a") });
    t("POST run with 36 dashes: 404, not 500", malformedRun.status === 404, malformedRun.status);

    const run1 = await call("POST", `/projects/${PA}/proofread`, { user: U("a") });
    t("POST run on own project: 200 ok", run1.status === 200 && run1.body?.ok === true, run1);
    const runRow = (await q("select * from study_proofread_runs where project_id = $1 order by revision", [PA]))[0];
    t(
      "the run row is firm A's, revision 1, requested by user A, and finished ('rules_ready')",
      runRow && runRow.firm_id === fa && runRow.revision === 1 && runRow.requested_by_user_id === "user-a" && runRow.status === "rules_ready",
      runRow,
    );
    const view1 = await get(PA, "a");
    t(
      "GET after the run: status rules_ready with runId, revision, stamps and coverage",
      view1.status === 200 && view1.body.status === "rules_ready" && view1.body.runId === runRow.id && view1.body.revision === 1 && typeof view1.body.engineStamp === "string" && Array.isArray(view1.body.coverage),
      JSON.stringify(view1.body).slice(0, 300),
    );
    const f1 = view1.body.findings ?? [];
    const target = f1.find((f) => ["DISCLOSE", "NOTE", "UNVERIFIED"].includes(f.type));
    const blocker = f1.find((f) => f.type === "BLOCKER");
    t("the clause pass produced a BLOCKER and a DISCLOSE/NOTE/UNVERIFIED finding to triage (suite precondition)", target && blocker, f1.map((f) => `${f.clauseId}:${f.type}`));
    const KEYS = ["clauseId", "detail", "fingerprint", "id", "readPaths", "remedy", "section", "sourceLabel", "title", "type"].join();
    t("each served finding carries only the documented keys (no audience, origin, runId)", f1.every((f) => Object.keys(f).sort().join() === KEYS), Object.keys(f1[0] ?? {}));
    t(
      "the run response carries no run internals (error, claimedBy, attempts, requestedByUserId, firmId)",
      ["error", "claimedBy", "claimedAt", "attempts", "requestedByUserId", "firmId", "firm_id"].every((k) => !(k in view1.body)),
      Object.keys(view1.body),
    );
    t("[FW-3 withheld] a run whose findings are all for the engineer answers withheld: 0", view1.body.withheld === 0, view1.body.withheld);
    t("[m-6] a first revision (no previous one) answers rulesChanged: false", view1.body.rulesChanged === false, view1.body.rulesChanged);

    // ---- admin-audience findings are hidden, and so are their dispositions -----------------------------------
    // Written directly: a finding with marker text in every field, so a leak of any one of them is visible.
    const ADMIN = {
      clause: "x-admin-clause-7f3a",
      title: "admin title 91c2",
      detail: "admin detail 55d0",
      source: "admin source 0b8e",
      remedy: "admin remedy e41d",
      fingerprint: "adminfp-c7a9",
      path: "result.adminPath_3b6f",
      value: "admin value 8d21",
    };
    const adminF = (
      await q(
        "insert into study_proofread_findings (run_id, clause_id, section, type, title, detail, source_label, read_paths, remedy, audience, fingerprint) values ($1,$2,4,'DEFECT',$3,$4,$5,$6,$7,'admin',$8) returning id",
        [runRow.id, ADMIN.clause, ADMIN.title, ADMIN.detail, ADMIN.source, JSON.stringify([{ path: ADMIN.path, value: ADMIN.value }]), ADMIN.remedy, ADMIN.fingerprint],
      )
    )[0].id;
    await q("insert into study_proofread_dispositions (finding_id, disposition, note, actor_user_id) values ($1,'BUG_FILED','admin note 2e7c','user-admin')", [adminF]);
    const view1b = await get(PA, "a");
    t("an admin-audience finding is not served", !view1b.body.findings.some((f) => f.id === adminF), `served: ${view1b.body.findings.length}`);
    t("a disposition on an admin-audience finding is not served either (its finding id does not leak)", !view1b.body.dispositions.some((d) => d.findingId === adminF), view1b.body.dispositions);
    t("[FW-3 withheld] GET counts the admin-audience finding: withheld is 1", view1b.body.withheld === 1, view1b.body.withheld);
    const adminLeaks = [adminF, "DEFECT", "BUG_FILED", "admin note 2e7c", "user-admin", ...Object.values(ADMIN)].filter((s) => JSON.stringify(view1b.body).includes(s));
    t(
      "[FW-3 withheld] the count is all that leaves the server: no id, type, clause, title, detail, source, remedy, path, value, fingerprint or decision of the withheld finding",
      adminLeaks.length === 0,
      adminLeaks,
    );

    // ---- the write path refuses what the read path never shows -------------------------------------------------
    const adminUrl = dispUrl(PA, runRow.id, adminF);
    const adminBefore = await count("select count(*) c from study_proofread_dispositions where finding_id = $1", [adminF]);
    const adminOwn = await call("POST", adminUrl, { user: U("a"), body: { disposition: "FIXED", note: "an engineer rules on a DEFECT" } });
    const adminOther = await call("POST", adminUrl, { user: U("b"), body: { disposition: "FIXED" } });
    const unknownF = await call("POST", dispUrl(PA, runRow.id, UNKNOWN), { user: U("a"), body: { disposition: "FIXED" } });
    const adminAfter = await count("select count(*) c from study_proofread_dispositions where finding_id = $1", [adminF]);
    t("DEFECT (admin-audience) finding, own firm: 404 'Finding not found.' and nothing written", adminOwn.status === 404 && adminOwn.body?.error === NOT_FOUND && adminAfter === adminBefore, [adminOwn, adminBefore, adminAfter]);
    t("DEFECT finding, another firm: 404 and nothing written", adminOther.status === 404 && adminAfter === adminBefore, adminOther);
    t("a DEFECT finding is indistinguishable from an unknown finding id (same status, same body)", adminOwn.status === unknownF.status && JSON.stringify(adminOwn.body) === JSON.stringify(unknownF.body), [adminOwn, unknownF]);

    // ---- dispositions: cross-tenant -------------------------------------------------------------------------
    const base = await dispCount();
    const body = { disposition: "FIXED", note: "cross-tenant attempt" };
    const attempts = {
      "B uses A's project, run and finding ids": [PA, runRow.id, target.id],
      "B uses its OWN project id with A's run and finding": [PB, runRow.id, target.id],
      "B uses A's project with an unknown run": [PA, UNKNOWN, target.id],
      "B uses A's run with an unknown finding": [PA, runRow.id, UNKNOWN],
    };
    for (const [label, [p, r, f]] of Object.entries(attempts)) {
      const res = await call("POST", dispUrl(p, r, f), { user: U("b"), body });
      t(`disposition cross-tenant (${label}): 404 'Finding not found.'`, res.status === 404 && res.body?.error === NOT_FOUND, res);
    }
    t("none of those attempts wrote a disposition row", (await dispCount()) === base, `rows ${base} -> ${await dispCount()}`);
    const wrongChain = await call("POST", dispUrl(PA2, runRow.id, target.id), { user: U("a"), body });
    t("same firm, but the run does not belong to the project in the URL: 404, nothing written", wrongChain.status === 404 && (await dispCount()) === base, wrongChain);
    const looseIds = await call("POST", dispUrl(PA, "-".repeat(36), target.id), { user: U("a"), body });
    t("a 36-dash run id is a 404, not a 500", looseIds.status === 404, looseIds.status);

    // ---- dispositions: the rules -------------------------------------------------------------------------------
    const url = dispUrl(PA, runRow.id, target.id);
    const pe1 = await call("POST", url, { user: U("a"), body: { disposition: "ACCEPTED_RISK", note: "n" } });
    const pe2 = await call("POST", url, { user: U("a"), body: { disposition: "CONTESTED_PE" } });
    t(
      "ACCEPTED_RISK and CONTESTED_PE are refused with 403 and a clear message, nothing written",
      pe1.status === 403 && pe2.status === 403 && /sealing engineer/.test(pe1.body?.error ?? "") && (await dispCount()) === base,
      [pe1, pe2],
    );
    const w0 = await call("POST", url, { user: U("a"), body: { disposition: "WITHDRAWN" } });
    const w1 = await call("POST", url, { user: U("a"), body: { disposition: "WITHDRAWN", sourceLabel: "   " } });
    t("WITHDRAWN without a source (or with a blank one): 400 naming the source, nothing written", w0.status === 400 && w1.status === 400 && /source/i.test(w0.body?.error ?? "") && (await dispCount()) === base, [w0, w1]);
    const bad = await call("POST", url, { user: U("a"), body: { disposition: "fixed" } });
    const empty = await call("POST", url, { user: U("a") });
    t("an unknown / missing disposition is a 400", bad.status === 400 && empty.status === 400, [bad.status, empty.status]);
    const okW = await call("POST", url, { user: U("a"), body: { disposition: "WITHDRAWN", sourceLabel: "  Redline S5 table 4  ", note: "withdrawn on the table" } });
    t("WITHDRAWN with a source: 200", okW.status === 200, okW);
    const lastRow = (await q("select * from study_proofread_dispositions where finding_id = $1 order by created_at desc limit 1", [target.id]))[0];
    t("the row stores the TRIMMED source and the session user as actor", lastRow?.disposition === "WITHDRAWN" && lastRow.source_label === "Redline S5 table 4" && lastRow.actor_user_id === "user-a", lastRow);
    const forged = await call("POST", url, { user: U("a"), body: { disposition: "FIXED", actorUserId: "user-evil", findingId: UNKNOWN, firmId: fb } });
    const forgedRow = (await q("select * from study_proofread_dispositions where finding_id = $1 order by created_at desc limit 1", [target.id]))[0];
    t("a body that names an actor, finding and firm is stripped: actor is the session user, finding is the URL's", forged.status === 200 && forgedRow.actor_user_id === "user-a" && forgedRow.finding_id === target.id, forgedRow);
    const byC = await call("POST", url, { user: U("c"), body: { disposition: "DISCLOSED", note: "second member of the same firm", sourceLabel: "S6 limitations, para 2" } });
    const cRow = (await q("select * from study_proofread_dispositions where finding_id = $1 order by created_at desc limit 1", [target.id]))[0];
    t("a second member of the SAME firm can record, attributed to themselves", byC.status === 200 && cRow.actor_user_id === "user-c" && cRow.disposition === "DISCLOSED", cRow);
    const view2 = await get(PA, "a");
    const mine = view2.body.dispositions.filter((d) => d.findingId === target.id);
    t("GET serves the log newest-first and without the actor id", mine.length >= 3 && mine[0].disposition === "DISCLOSED" && mine.every((d) => !("actorUserId" in d)), mine);
    t("every accepted decision is its own row (3 so far on this finding)", (await count("select count(*) c from study_proofread_dispositions where finding_id = $1", [target.id])) === 3);
    t(
      `[append-only] so far (${logReads} reads of the log around every POST and claim): no disposition row, once written, was rewritten or deleted (row text and xmin)`,
      logReads > 0 && logSeen.size > 0 && logChanges.length === 0,
      logChanges.slice(0, 10),
    );
    const decisionAsServed = mine[0];

    // ---- [FW-5 422] which decision fits which finding ---------------------------------------------------------
    const blockerUrl = dispUrl(PA, runRow.id, blocker.id);
    const before422 = await dispCount();
    const r422 = await call("POST", blockerUrl, { user: U("a"), body: { disposition: "DISCLOSED", note: "disclosing a wrong number" } });
    t(`[FW-5 422] DISCLOSED on a BLOCKER: 422 '${DOES_NOT_APPLY}', nothing written`, r422.status === 422 && r422.body?.error === DOES_NOT_APPLY && (await dispCount()) === before422, r422);
    // Written directly: no phase-1 clause raises a CONTESTED item.
    const contestedF = (
      await q(
        "insert into study_proofread_findings (run_id, clause_id, section, type, title, detail, source_label, read_paths, remedy, audience, fingerprint) values ($1,'x-contested',5,'CONTESTED','contested','d','src','[]','r','engineer','contestedfp') returning id",
        [runRow.id],
      )
    )[0].id;
    const contestedUrl = dispUrl(PA, runRow.id, contestedF);
    const onContested = [
      await call("POST", contestedUrl, { user: U("a"), body: { disposition: "FIXED" } }),
      await call("POST", contestedUrl, { user: U("a"), body: { disposition: "DISCLOSED" } }),
      await call("POST", contestedUrl, { user: U("a"), body: { disposition: "WITHDRAWN", sourceLabel: "a source" } }),
    ];
    t(
      "[FW-5 422] no decision a firm member can send applies to a CONTESTED finding (FIXED, DISCLOSED, WITHDRAWN: all 422), nothing written",
      onContested.every((r) => r.status === 422 && r.body?.error === DOES_NOT_APPLY) && (await dispCount()) === before422,
      onContested.map((r) => r.status),
    );
    const r422foreign = await call("POST", blockerUrl, { user: U("b"), body: { disposition: "DISCLOSED" } });
    t("[FW-5 422] another firm's unfitting decision on that BLOCKER is 404, not 422 (the tenant checks come first)", r422foreign.status === 404 && r422foreign.body?.error === NOT_FOUND, r422foreign);
    const fitting = await call("POST", blockerUrl, { user: U("a"), body: { disposition: "FIXED", note: "corrected in the model" } });
    t("[FW-5 422] a decision the BLOCKER is offered (FIXED) is recorded: 200, one row", fitting.status === 200 && (await dispCount()) === before422 + 1, fitting);

    // ---- [FW-3 withheld] a real DEFECT, raised by the clause pass -------------------------------------------------
    const runD = await call("POST", `/projects/${PD}/proofread`, { user: U("a") });
    const runDRow = (await q("select * from study_proofread_runs where project_id = $1", [PD]))[0];
    const defects = await q("select * from study_proofread_findings where run_id = $1 and type = 'DEFECT'", [runDRow?.id ?? UNKNOWN]);
    const defect = defects[0];
    t(
      "[FW-3 withheld] precondition: the clause pass raised one real DEFECT (losMatchesDelay, audience admin) on the study whose LOS letter was changed",
      flipped && runD.status === 200 && runDRow?.status === "rules_ready" && defects.length === 1 && defect.clause_id === "losMatchesDelay" && defect.audience === "admin",
      { flipped, run: runD.status, status: runDRow?.status, defects: defects.map((d) => `${d.clause_id}:${d.audience}`) },
    );
    const viewD = await get(PD, "a");
    t("[FW-3 withheld] GET answers withheld: 1 for that run", viewD.status === 200 && viewD.body.withheld === 1, viewD.body?.withheld);
    // Coverage names every clause that ran, whether or not it raised anything, so it is compared to the run's
    // own column instead. A path another served finding also read is that finding's, not a leak of this one.
    const { coverage: servedCoverage, ...restD } = viewD.body ?? {};
    const servedPaths = new Set((viewD.body?.findings ?? []).flatMap((f) => f.readPaths.map((p) => p.path)));
    const defectStrings = defect
      ? [defect.id, defect.fingerprint, defect.clause_id, defect.title, defect.detail, defect.remedy, defect.source_label, "DEFECT", ...defect.read_paths.map((p) => p.path).filter((p) => !servedPaths.has(p))]
      : ["(no defect)"];
    const defectLeaks = defectStrings.filter((s) => JSON.stringify(restD).includes(String(s)));
    t(
      "[FW-3 withheld] nothing of that DEFECT leaves the server: not its id, type, clause, title, detail, remedy, source, fingerprint or the paths it read",
      defect && defectLeaks.length === 0,
      defectLeaks,
    );
    t("[FW-3 withheld] the coverage served is the run's own coverage, unchanged", JSON.stringify(servedCoverage) === JSON.stringify(runDRow?.coverage), servedCoverage);
    const defectWrite = await call("POST", dispUrl(PD, runDRow?.id ?? UNKNOWN, defect?.id ?? UNKNOWN), { user: U("a"), body: { disposition: "FIXED" } });
    t("[FW-3 withheld] a decision on the real DEFECT is refused like an unknown id (404 'Finding not found.')", defectWrite.status === 404 && defectWrite.body?.error === NOT_FOUND, defectWrite);
    // The runner's warn line is how the software team hears of it.
    let defectLog = [];
    for (let i = 0; i < 20 && defectLog.length === 0; i++) {
      defectLog = serverLines()
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter((o) => o?.msg === "proofread.defect_raised" && o.runId === runDRow?.id);
      if (defectLog.length === 0) await sleep(100);
    }
    const LOG_KEYS = new Set(["level", "time", "pid", "hostname", "runId", "projectId", "clause", "msg"]);
    t(
      "[FW-3 withheld] the runner logged that DEFECT once, at warn, with the run, the project and the clause and nothing else from the finding",
      defect &&
        defectLog.length === 1 &&
        defectLog[0].level === 40 &&
        defectLog[0].projectId === PD &&
        defectLog[0].clause === "losMatchesDelay" &&
        Object.keys(defectLog[0]).every((k) => LOG_KEYS.has(k)) &&
        ![defect.id, defect.fingerprint, defect.title, defect.detail, defect.remedy, defect.source_label].some((s) => JSON.stringify(defectLog[0]).includes(s)),
      defectLog,
    );

    // ---- [FW-1 carry] "Run again" after a deploy: another engine stamp, the same rules version ------------------------
    await restart(SHA_B);
    const run2 = await call("POST", `/projects/${PA}/proofread`, { user: U("a") });
    const view3 = await get(PA, "a");
    const revs = await q("select id, revision, status, rules_version, engine_stamp, protocol_version, created_at from study_proofread_runs where project_id = $1 order by revision", [PA]);
    const [rev1, rev2] = revs;
    t("a re-run is revision 2 under the same project", run2.status === 200 && view3.body.revision === 2 && view3.body.runId !== runRow.id && rev2?.status === "rules_ready", [run2.status, view3.body.revision]);
    t(
      "[FW-1 carry] precondition: revision 2 ran under another deploy (its engine stamp ends in another commit) and the same rules version",
      rev2 && rev1.engine_stamp.endsWith(`-${SHA_A.slice(0, 7)}`) && rev2.engine_stamp.endsWith(`-${SHA_B.slice(0, 7)}`) && rev1.rules_version === rev2.rules_version,
      revs.map((r) => [r.revision, r.rules_version, r.engine_stamp]),
    );
    const f3 = view3.body.findings.find((f) => f.fingerprint === target.fingerprint);
    const b3 = view3.body.findings.find((f) => f.fingerprint === blocker.fingerprint);
    const carried = view3.body.dispositions.filter((d) => d.findingId === f3?.id);
    const carriedB = view3.body.dispositions.filter((d) => d.findingId === b3?.id);
    t(
      "[FW-1 carry] across the deploy, the latest decision on each finding carried into revision 2 by fingerprint (DISCLOSED on the target, FIXED on the BLOCKER)",
      f3 && b3 && carried.length === 1 && carried[0].disposition === "DISCLOSED" && carriedB.length === 1 && carriedB[0].disposition === "FIXED",
      view3.body.dispositions,
    );
    const carriedRow = (await q("select * from study_proofread_dispositions where finding_id = $1", [f3?.id ?? UNKNOWN]))[0];
    t(
      "[FW-1 carry] the carried row keeps who made the decision, its note and its source",
      carriedRow && carriedRow.actor_user_id === "user-c" && carriedRow.note === cRow.note && carriedRow.source_label === cRow.source_label,
      carriedRow,
    );
    t(
      "[FW-2 date] the carried decision keeps the date it was made: the same createdAt as the decision on revision 1, earlier than revision 2 itself",
      carried[0]?.createdAt === decisionAsServed.createdAt &&
        carriedRow &&
        carriedRow.created_at.getTime() === cRow.created_at.getTime() &&
        carriedRow.created_at < rev2.created_at,
      { carried: carried[0]?.createdAt, original: decisionAsServed.createdAt, rev2: rev2?.created_at },
    );
    t("[FW-3 withheld] revision 2 does not raise the withheld item again, and answers withheld: 0", view3.body.withheld === 0, view3.body.withheld);
    t("[m-6] revision 2 ran under another deploy and the same rules: rulesChanged is false", view3.body.rulesChanged === false, view3.body.rulesChanged);

    // ---- [FW-6 409] a decision on a run that is not the project's newest finished run ----------------------------------
    const before409 = await dispCount();
    const s1 = await call("POST", dispUrl(PA, rev1.id, target.id), { user: U("a"), body: { disposition: "FIXED", note: "on the old revision" } });
    t(`[FW-6 409] a fitting decision on a superseded revision: 409 '${RUN_AGAIN}', nothing written`, s1.status === 409 && s1.body?.error === RUN_AGAIN && (await dispCount()) === before409, s1);
    const s1type = await call("POST", dispUrl(PA, rev1.id, blocker.id), { user: U("a"), body: { disposition: "DISCLOSED" } });
    t("[FW-6 409] an unfitting decision on a superseded revision is 422, not 409 (the type check comes first)", s1type.status === 422 && s1type.body?.error === DOES_NOT_APPLY, s1type);
    const s1foreign = await call("POST", dispUrl(PA, rev1.id, target.id), { user: U("b"), body: { disposition: "FIXED" } });
    t("[FW-6 409] another firm's decision on the superseded revision is 404, not 409", s1foreign.status === 404 && s1foreign.body?.error === NOT_FOUND, s1foreign);
    // Written directly: a revision 3 still running under a live lease, as a concurrent "Run again" would leave it.
    const rev3 = (
      await q(
        "insert into study_proofread_runs (project_id, firm_id, revision, status, protocol_version, rules_version, engine_stamp, input_manifest, coverage, attempts, claimed_at, claimed_by, requested_by_user_id) values ($1,$2,3,'running','harness',$3,$4,'{}','[]',1,now(),'harness-holds-this-lease','user-a') returning id",
        [PA, fa, rev2.rules_version, rev2.engine_stamp],
      )
    )[0].id;
    const rev3F = (
      await q(
        "insert into study_proofread_findings (run_id, clause_id, section, type, title, detail, source_label, read_paths, remedy, audience, fingerprint) values ($1,'x-running',6,'DISCLOSE','t','d','s','[]','r','engineer','runningfp') returning id",
        [rev3],
      )
    )[0].id;
    const s2a = await call("POST", dispUrl(PA, rev2.id, f3.id), { user: U("a"), body: { disposition: "FIXED" } });
    const s2b = await call("POST", dispUrl(PA, rev3, rev3F), { user: U("a"), body: { disposition: "FIXED" } });
    t(
      "[FW-6 409] while a newer revision is still running, a decision on the finished one is 409, and so is one on the running revision's own finding; nothing written",
      s2a.status === 409 && s2b.status === 409 && s2a.body?.error === RUN_AGAIN && s2b.body?.error === RUN_AGAIN && (await dispCount()) === before409,
      [s2a, s2b],
    );
    // Release that lease the way an exhausted run ends, so no later sweep picks it up.
    await q("update study_proofread_runs set status = 'failed', finished_at = now(), error = 'harness: released' where id = $1", [rev3]);

    // ---- [FW-1 carry] a different rules version reopens every decision ------------------------------------------------
    // Written directly: revision 2 recorded as having run under another rule set. Revision 3 failed, so it is the
    // revision a new run carries from.
    await q("update study_proofread_runs set rules_version = 'harness-older' where id = $1", [rev2.id]);
    const run4 = await call("POST", `/projects/${PA}/proofread`, { user: U("a") });
    const view4 = await get(PA, "a");
    const rev4 = (await q("select id from study_proofread_runs where project_id = $1 and revision = 4", [PA]))[0];
    const carried4 = await count(
      "select count(*) c from study_proofread_dispositions d join study_proofread_findings f on f.id = d.finding_id where f.run_id = $1",
      [rev4?.id ?? UNKNOWN],
    );
    t(
      "[FW-1 carry] a revision whose predecessor ran under another rules version carries nothing: every decision reopens",
      run4.status === 200 && view4.body.revision === 4 && view4.body.findings.some((f) => f.fingerprint === target.fingerprint) && view4.body.dispositions.length === 0 && carried4 === 0,
      { status: run4.status, revision: view4.body.revision, dispositions: view4.body.dispositions, carried4 },
    );
    t("[m-6] that revision answers rulesChanged: true (its predecessor ran under another rules version)", view4.body.rulesChanged === true, view4.body.rulesChanged);

    // ---- [claim] claimAndRunOne against the study rows ---------------------------------------------------------------
    for (let i = 0; i < 50; i++) if (!(await claimOne()).worked) break; // nothing else queued: the claim below takes OUR row
    const queuedBefore = await count("select count(*) c from study_proofread_runs where status = 'queued'");
    // Written directly: a queued run, exactly what insertQueuedRun writes, without POST run's own drain.
    const phRun = (
      await q(
        "insert into study_proofread_runs (project_id, firm_id, revision, status, protocol_version, rules_version, engine_stamp, input_manifest, coverage, requested_by_user_id) values ($1,$2,1,'queued','harness',$3,'harness','{}','[]','user-a') returning id",
        [PH, fa, rev1.rules_version],
      )
    )[0].id;
    const hBeforeClaim = await studyHash();
    const claimed = await claimOne();
    const hAfterClaim = await studyHash();
    const phAfter = (await q("select status from study_proofread_runs where id = $1", [phRun]))[0];
    const phFindings = await count("select count(*) c from study_proofread_findings where run_id = $1", [phRun]);
    t(
      "[claim] claimAndRunOne claimed the one queued run and finished it (rules_ready, findings written)",
      queuedBefore === 0 && claimed.worked === true && phAfter.status === "rules_ready" && phFindings > 0,
      { queuedBefore, claimed, status: phAfter.status, phFindings },
    );
    t("[claim] across that claimAndRunOne, every tis_projects row hashes the same, xmin included", hBeforeClaim === hAfterClaim, `${hBeforeClaim} -> ${hAfterClaim}`);

    // ---- [RR-1] a run is stamped with the rules it RAN under, and the carry compares those --------------------------
    // This server is the SHA_B deploy: revision 2 of A-study shows what a run stamped here carries.
    const RULES = rev2.rules_version;
    const settled = async (runId) => {
      let row;
      for (let i = 0; i < 50; i++) {
        row = (await q("select * from study_proofread_runs where id = $1", [runId]))[0];
        if (row && row.status !== "queued" && row.status !== "running") return row;
        await sleep(100);
      }
      return row;
    };
    const decisionsOnRun = (runId) =>
      q("select d.disposition, f.fingerprint from study_proofread_dispositions d join study_proofread_findings f on f.id = d.finding_id where f.run_id = $1", [runId]);
    const runR1 = await call("POST", `/projects/${PR}/proofread`, { user: U("a") });
    const vR1 = await get(PR, "a");
    const tR = (vR1.body?.findings ?? []).find((f) => ["DISCLOSE", "NOTE", "UNVERIFIED"].includes(f.type));
    const decR1 = await call("POST", dispUrl(PR, vR1.body?.runId, tR?.id ?? UNKNOWN), { user: U("a"), body: { disposition: "DISCLOSED", note: "rr-1 decision on revision 1" } });
    t(
      "[RR-1] precondition: revision 1 of the rules study ran on this deploy and holds one decision",
      runR1.status === 200 && vR1.body?.status === "rules_ready" && tR && decR1.status === 200,
      [runR1.status, vR1.body?.status, decR1.status],
    );
    // Written directly: revision 1 recorded as having run under an older rule set, and the next revision queued by a
    // deploy that still had that rule set (its queue-time values), then claimed by this one.
    await q("update study_proofread_runs set rules_version = 'harness-older' where id = $1", [vR1.body?.runId ?? UNKNOWN]);
    const queueUnderOlderRules = async (revision) => {
      for (let i = 0; i < 50; i++) if (!(await claimOne()).worked) break; // nothing else queued: the claim takes OUR row
      const id = (
        await q(
          "insert into study_proofread_runs (project_id, firm_id, revision, status, protocol_version, rules_version, engine_stamp, input_manifest, coverage, requested_by_user_id) values ($1,$2,$3,'queued','harness-older-protocol','harness-older','harness-older-stamp','{}','[]','user-a') returning id",
          [PR, fa, revision],
        )
      )[0].id;
      await claimOne();
      return settled(id);
    };
    const r2 = await queueUnderOlderRules(2);
    t(
      "[RR-1] a run queued under older rules and claimed by this deploy is stamped with what ran it: this deploy's rules version, engine stamp and protocol version, not the queue-time values",
      r2?.status === "rules_ready" && r2.rules_version === RULES && r2.engine_stamp === rev2.engine_stamp && r2.protocol_version === rev2.protocol_version,
      r2 && { status: r2.status, stamped: [r2.rules_version, r2.engine_stamp, r2.protocol_version], want: [RULES, rev2.engine_stamp, rev2.protocol_version] },
    );
    const r2Fingerprints = (await q("select fingerprint from study_proofread_findings where run_id = $1", [r2?.id ?? UNKNOWN])).map((f) => f.fingerprint);
    const r2Carried = await decisionsOnRun(r2?.id ?? UNKNOWN);
    t(
      "[RR-1] its predecessor ran under the older rules its queue-time value also names, and nothing carried across the change: the same finding is open again",
      tR && r2Fingerprints.includes(tR.fingerprint) && r2Carried.length === 0,
      { sameFinding: r2Fingerprints.includes(tR?.fingerprint), carried: r2Carried.map((d) => d.disposition) },
    );
    const vR2 = await get(PR, "a");
    t("[m-6] GET on that revision answers rulesChanged: true", vR2.body?.revision === 2 && vR2.body?.rulesChanged === true, [vR2.body?.revision, vR2.body?.rulesChanged]);
    // The other direction: revision 2 ran here; revision 3 is queued under the older rules and claimed here too.
    const tR2 = (vR2.body?.findings ?? []).find((f) => f.fingerprint === tR?.fingerprint);
    const decR2 = await call("POST", dispUrl(PR, vR2.body?.runId, tR2?.id ?? UNKNOWN), { user: U("a"), body: { disposition: "FIXED", note: "rr-1 decision on revision 2" } });
    const r3 = await queueUnderOlderRules(3);
    const r3Carried = await decisionsOnRun(r3?.id ?? UNKNOWN);
    t(
      "[RR-1] a run queued under older rules after a revision that ran under this deploy's rules carries that revision's decision: the carry compares run-time rules, not queue-time",
      decR2.status === 200 && r3?.status === "rules_ready" && r3.rules_version === RULES && r3Carried.length === 1 && r3Carried[0].disposition === "FIXED" && r3Carried[0].fingerprint === tR?.fingerprint,
      { decision: decR2.status, status: r3?.status, rules: r3?.rules_version, carried: r3Carried.map((d) => `${d.disposition}:${d.fingerprint}`) },
    );
    const vR3 = await get(PR, "a");
    t("[m-6] GET on that revision answers rulesChanged: false", vR3.body?.revision === 3 && vR3.body?.rulesChanged === false, [vR3.body?.revision, vR3.body?.rulesChanged]);
    // Written directly: revision 4, left 'running' by an attempt that crashed after writing its clause pass under the
    // older rules (a finding is already there). Its lease has expired, so the next claim takes it again: this deploy's.
    for (let i = 0; i < 50; i++) if (!(await claimOne()).worked) break;
    const r4 = (
      await q(
        "insert into study_proofread_runs (project_id, firm_id, revision, status, protocol_version, rules_version, engine_stamp, input_manifest, coverage, attempts, claimed_at, claimed_by, requested_by_user_id) values ($1,$2,4,'running','harness-older-protocol','harness-older','harness-older-stamp','{}','[]',1,now() - interval '1 hour','harness-crashed','user-a') returning id",
        [PR, fa],
      )
    )[0].id;
    await q(
      "insert into study_proofread_findings (run_id, clause_id, section, type, title, detail, source_label, read_paths, remedy, audience, fingerprint) values ($1,'x-older-rules',6,'DISCLOSE','t','d','s','[]','r','engineer','olderrulesfp')",
      [r4],
    );
    await claimOne();
    const r4Row = await settled(r4);
    const r4Fingerprints = (await q("select fingerprint from study_proofread_findings where run_id = $1", [r4])).map((f) => f.fingerprint);
    t(
      "[RR-1] a re-claimed run that already holds findings written under other rules fails 'rules_changed_mid_run': no finding added beside them, none deleted, its rules version left as it was",
      r4Row?.status === "failed" &&
        r4Row.error === "rules_changed_mid_run" &&
        r4Row.finished_at !== null &&
        r4Row.rules_version === "harness-older" &&
        JSON.stringify(r4Fingerprints) === JSON.stringify(["olderrulesfp"]),
      r4Row && { status: r4Row.status, error: r4Row.error, rules: r4Row.rules_version, findings: r4Fingerprints.length },
    );
    const runR5 = await call("POST", `/projects/${PR}/proofread`, { user: U("a") });
    const vR5 = await get(PR, "a");
    t(
      "[RR-1] the next 'Run again' starts a clean revision 5 that finishes and carries from revision 3, the last finished one",
      runR5.status === 200 &&
        vR5.body?.revision === 5 &&
        vR5.body?.status === "rules_ready" &&
        (vR5.body?.findings ?? []).every((f) => f.fingerprint !== "olderrulesfp") &&
        (vR5.body?.dispositions ?? []).some((d) => d.disposition === "FIXED") &&
        vR5.body?.rulesChanged === false,
      { status: runR5.status, revision: vR5.body?.revision, runStatus: vR5.body?.status, dispositions: vR5.body?.dispositions?.map((d) => d.disposition), rulesChanged: vR5.body?.rulesChanged },
    );

    // ---- [M1] [M2] the run a decision is recorded on ------------------------------------------------------------------
    const runM1 = await call("POST", `/projects/${PM}/proofread`, { user: U("a") });
    const vM1 = await get(PM, "a");
    const fitsM = (vM1.body?.findings ?? []).filter((f) => ["DISCLOSE", "NOTE", "UNVERIFIED"].includes(f.type));
    t(
      "[M1] precondition: revision 1 of the ready study finished with two findings that take DISCLOSED and FIXED",
      runM1.status === 200 && vM1.body?.status === "rules_ready" && fitsM.length >= 2,
      (vM1.body?.findings ?? []).map((f) => f.type),
    );
    const [m0, m1] = fitsM;
    const runM1Id = String(vM1.body?.runId);
    const lastOn = async (findingId) => (await q("select * from study_proofread_dispositions where finding_id = $1 order by created_at desc limit 1", [findingId]))[0];
    const beforeM = await dispCount();
    const upRun = await call("POST", dispUrl(PM, runM1Id.toUpperCase(), m0?.id), { user: U("a"), body: { disposition: "DISCLOSED", note: "m1 uppercase run id" } });
    const upRunRow = await lastOn(m0?.id ?? UNKNOWN);
    t(
      "[M1] the newest finished run's id in uppercase is that run: 200, one row, on the finding",
      upRun.status === 200 && (await dispCount()) === beforeM + 1 && upRunRow?.note === "m1 uppercase run id",
      [upRun.status, upRun.body, upRunRow?.note],
    );
    const upAll = await call("POST", dispUrl(PM.toUpperCase(), runM1Id.toUpperCase(), String(m0?.id).toUpperCase()), { user: U("a"), body: { disposition: "FIXED", note: "m1 uppercase ids" } });
    const upAllRow = await lastOn(m0?.id ?? UNKNOWN);
    t(
      "[M1] project, run and finding ids all in uppercase: 200, the row is on the finding's own (lowercase) id, by the session user",
      upAll.status === 200 && (await dispCount()) === beforeM + 2 && upAllRow?.note === "m1 uppercase ids" && upAllRow.finding_id === m0?.id && upAllRow.actor_user_id === "user-a",
      [upAll.status, upAll.body, upAllRow],
    );
    // Written directly: phase 1 never writes 'ready'; a later phase's finished run is 'ready'.
    await q("update study_proofread_runs set status = 'ready' where id = $1", [runM1Id]);
    const vMr = await get(PM, "a");
    const onReady = await call("POST", dispUrl(PM, runM1Id, m1?.id), { user: U("a"), body: { disposition: "DISCLOSED", note: "m2 on a ready run" } });
    t(
      "[M2] a decision on the project's newest run in 'ready' is accepted: 200, one row",
      vMr.body?.status === "ready" && onReady.status === 200 && (await dispCount()) === beforeM + 3,
      [vMr.body?.status, onReady.status, onReady.body],
    );
    const runM2 = await call("POST", `/projects/${PM}/proofread`, { user: U("a") });
    const vM2 = await get(PM, "a");
    const servedM2 = (vM2.body?.dispositions ?? []).map((d) => `${d.disposition}:${(vM2.body?.findings ?? []).find((f) => f.id === d.findingId)?.fingerprint}`).sort();
    const wantM2 = [`DISCLOSED:${m1?.fingerprint}`, `FIXED:${m0?.fingerprint}`].sort();
    t(
      "[M2] the next revision carries the latest decision on each finding from the 'ready' run (FIXED and DISCLOSED), and nothing else",
      runM2.status === 200 && vM2.body?.revision === 2 && JSON.stringify(servedM2) === JSON.stringify(wantM2),
      { revision: vM2.body?.revision, servedM2, wantM2 },
    );
    t("[m-6] a revision carried from a 'ready' run under the same rules answers rulesChanged: false", vM2.body?.rulesChanged === false, vM2.body?.rulesChanged);
    const beforeOld = await dispCount();
    const upOld = await call("POST", dispUrl(PM, runM1Id.toUpperCase(), m0?.id), { user: U("a"), body: { disposition: "FIXED" } });
    t(`[M1] an uppercase id of a superseded revision is still 409 '${RUN_AGAIN}', nothing written`, upOld.status === 409 && upOld.body?.error === RUN_AGAIN && (await dispCount()) === beforeOld, [upOld.status, upOld.body]);

    // ---- concurrency: quick presses of "Run again" -------------------------------------------------------------------
    const burst = await Promise.all(Array.from({ length: 12 }, () => call("POST", `/projects/${PA2}/proofread`, { user: U("a") })));
    const burstRevs = (await q("select revision from study_proofread_runs where project_id = $1 order by revision", [PA2])).map((r) => r.revision);
    const tally = {};
    for (const r of burst) tally[r.status] = (tally[r.status] ?? 0) + 1;
    console.log(`INFO  burst of 12 simultaneous "Run again" presses: statuses ${JSON.stringify(tally)}, revisions written ${JSON.stringify(burstRevs)}`);

    // ---- [limiter] each limiter: its own budget, keyed per user, draft-7 headers naming its own limit ----------------
    // The limiters keep their counts in this server process (no REDIS_URL), which started at the restart above.
    const draft7 = (r, limit, windowSec) =>
      r.headers.get("ratelimit-policy") === `${limit};w=${windowSec}` &&
      new RegExp(`^limit=${limit}, remaining=0, reset=\\d+$`).test(r.headers.get("ratelimit") ?? "") &&
      !r.headers.get("ratelimit-limit") &&
      !r.headers.get("x-ratelimit-limit");
    const headersOf = (r) =>
      `RateLimit-Policy: ${r.headers.get("ratelimit-policy")} | RateLimit: ${r.headers.get("ratelimit")} | RateLimit-Limit: ${r.headers.get("ratelimit-limit")} | X-RateLimit-Limit: ${r.headers.get("x-ratelimit-limit")} | ${JSON.stringify(r.body)}`;
    const runStatuses = [];
    let lastRun;
    for (let i = 0; i < 31; i++) {
      lastRun = await call("POST", `/projects/${PL}/proofread`, { user: U("lim") });
      runStatuses.push(lastRun.status);
    }
    t("[limiter] run limiter: 30 runs in the hour are served, the 31st is 429", runStatuses.slice(0, 30).every((s) => s === 200) && runStatuses[30] === 429, runStatuses);
    t(
      "[limiter] the run limiter's 429 uses draft-7 headers naming its own limit (RateLimit-Policy 30;w=3600, RateLimit limit=30, remaining=0; no RateLimit-Limit or X-RateLimit-*)",
      draft7(lastRun, 30, 3600) && /Too many proofread runs/.test(lastRun.body?.error ?? ""),
      headersOf(lastRun),
    );
    const limView = await get(PL, "lim");
    const limTarget = limView.body?.findings?.find((f) => f.type !== "CONTESTED");
    const dispStatuses = [];
    for (let i = 0; i < 5; i++) dispStatuses.push((await call("POST", dispUrl(PL, limView.body?.runId, limTarget?.id), { user: U("lim"), body: { disposition: "FIXED" } })).status);
    t("[limiter] with the run budget spent, the SAME user can still read and record decisions (separate budgets)", limView.status === 200 && dispStatuses.every((s) => s === 200), [limView.status, dispStatuses]);
    const readStatuses = [];
    let lastRead;
    for (let i = 0; i < 125; i++) {
      lastRead = await call("GET", `/projects/${PL2}/proofread`, { user: U("lim2") });
      readStatuses.push(lastRead.status);
    }
    t(
      "[limiter] read limiter: 120/min then 429",
      readStatuses.slice(0, 120).every((s) => s === 200) && readStatuses.slice(120).every((s) => s === 429),
      `200s=${readStatuses.filter((s) => s === 200).length} 429s=${readStatuses.filter((s) => s === 429).length}`,
    );
    t("[limiter] the read limiter's 429 uses draft-7 headers naming its own limit (RateLimit-Policy 120;w=60, RateLimit limit=120, remaining=0)", draft7(lastRead, 120, 60), headersOf(lastRead));
    const otherUser = await call("GET", `/projects/${PA}/proofread`, { user: U("a") });
    t("[limiter] the read limiter is keyed per user: another user is unaffected by the spent read budget", otherUser.status === 200, otherUser.status);
    const lim2Run = await call("POST", `/projects/${PL2}/proofread`, { user: U("lim2") });
    t(
      "[limiter] the run limiter is keyed per user and shares no budget with the read limiter: with lim's runs and lim2's reads spent, lim2's run is served",
      lim2Run.status === 200,
      lim2Run.status,
    );
    // The decision limiter, spent by one user with requests that write nothing (a body that is not a decision is a
    // 400, answered after the limiter has counted it).
    const decStatuses = [];
    let lastDec;
    for (let i = 0; i < 301; i++) {
      lastDec = await call("POST", dispUrl(UNKNOWN, UNKNOWN, UNKNOWN), { user: U("lim3"), body: { disposition: "not-a-decision" } });
      decStatuses.push(lastDec.status);
    }
    const decTally = {};
    for (const st of decStatuses) decTally[st] = (decTally[st] ?? 0) + 1;
    t(
      "[limiter] decision limiter: 300 decision requests in the hour are served (each a 400 for its body here), the 301st is 429",
      decStatuses.slice(0, 300).every((st) => st === 400) && decStatuses[300] === 429,
      { tally: decTally, firstLimited: decStatuses.indexOf(429) },
    );
    t(
      "[limiter] the decision limiter's 429 uses draft-7 headers naming its own limit (RateLimit-Policy 300;w=3600, RateLimit limit=300, remaining=0; no RateLimit-Limit or X-RateLimit-*)",
      draft7(lastDec, 300, 3600),
      headersOf(lastDec),
    );
    const limDecision = await call("POST", dispUrl(PL, limView.body?.runId, limTarget?.id), { user: U("lim"), body: { disposition: "FIXED" } });
    t("[limiter] the decision limiter is keyed per user: another user at the same address still records a decision (200)", limDecision.status === 200, [limDecision.status, limDecision.body]);
    const lim3Read = await call("GET", `/projects/${UNKNOWN}/proofread`, { user: U("lim3") });
    const lim3Run = await call("POST", `/projects/${UNKNOWN}/proofread`, { user: U("lim3") });
    t(
      "[limiter] with its decision budget spent, the same user still reaches the read and run routes (404 for an unknown project, not 429)",
      lim3Read.status === 404 && lim3Run.status === 404,
      [lim3Read.status, lim3Run.status],
    );

    // ---- [append-only], for everything above ---------------------------------------------------------------------------
    await readLog("at the end");
    t(
      `[append-only] across every POST and claim the driver made (${logReads} reads of the log, ${logSeen.size} rows): no disposition row, once written, was rewritten or deleted (row text and xmin)`,
      logReads > 0 && logChanges.length === 0,
      logChanges.slice(0, 10),
    );

    // ---- the advisor boundary, for everything above ------------------------------------------------------------------
    const hEnd = await studyHash();
    t("after every request above, tis_projects is byte-identical (xmin included) to what it was before the first call", h0 === hEnd, `${h0} -> ${hEnd}`);
    // Last, because it writes a study row: the hash is not looking at nothing.
    await q("update tis_projects set project_name = project_name where id = $1", [PA2]);
    t("[claim] the hash sees xmin: a value-identical UPDATE of one tis_projects row changes it", (await studyHash()) !== hEnd);
    t(`every GET answer (${contractChecked}) parses under the read contract (ProofreadReadResponse)`, contractChecked > 0 && contractFailures.length === 0, contractFailures);

    // ---- [datum] the Datum chat: its migrations, its versions, its thread ---------------------------------------------
    // Last, because it adds study rows (new versions) and deletes three: every hash above has been read already.
    // Its own lineages, made directly (the app has no route the harness can use for a study), in firm A; firm B is the
    // other firm. Each DB function is the real one, called inside the server (server-entry.mjs).
    const json = (v) => JSON.stringify(v);
    const val = async (name, ...args) => {
      const r = await datum(name, ...args);
      if (!r?.ok) throw new Error(`${name} failed: ${json(r?.error ?? r)}`);
      return r.value;
    };
    const datumContractFailures = [];
    let datumContractChecked = 0;
    const holds = (label, schema, v) => {
      datumContractChecked++;
      const parsed = schema.safeParse(v);
      if (!parsed.success) datumContractFailures.push({ label, issues: parsed.error.issues.slice(0, 3) });
      return parsed.success;
    };

    // -- [datum migrations] on the harness's own push --
    const chatTables = (await q("select table_name from information_schema.tables where table_schema = 'public' and table_name in ('study_revisions', 'study_datum_messages') order by 1")).map((r) => r.table_name);
    const lineageCols = await q(
      "select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'tis_projects' and column_name in ('revised_from_project_id', 'root_project_id') order by 1",
    );
    t("[datum migrations] after the harness's schema push, study_revisions and study_datum_messages exist", json(chatTables) === json(["study_datum_messages", "study_revisions"]), chatTables);
    t(
      "[datum migrations] after the harness's schema push, tis_projects has both lineage columns, as nullable uuids",
      lineageCols.length === 2 && lineageCols.every((c) => c.data_type === "uuid" && c.is_nullable === "YES"),
      lineageCols,
    );

    // -- [datum migrations] migrate.mjs's own statements for the chat, run on Postgres (the second database) --
    // What the chat's statements build, read from the catalog: the two tables' columns and the two lineage columns,
    // every foreign key on them (column, target and delete rule), and every index on them.
    const catalog = async (qx) => ({
      columns: await qx(
        `select table_name, column_name, data_type, character_maximum_length, is_nullable, column_default from information_schema.columns
         where table_schema = 'public' and (table_name in ('study_revisions', 'study_datum_messages') or (table_name = 'tis_projects' and column_name in ('revised_from_project_id', 'root_project_id')))
         order by 1, 2`,
      ),
      fks: await qx(
        `select c.conrelid::regclass::text as tbl, a.attname as col, c.confrelid::regclass::text as ref, af.attname as ref_col, c.confdeltype as on_delete
         from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
         where c.contype = 'f' and (c.conrelid::regclass::text in ('study_revisions', 'study_datum_messages') or (c.conrelid::regclass::text = 'tis_projects' and a.attname in ('revised_from_project_id', 'root_project_id')))
         order by 1, 2`,
      ),
      indexes: await qx(
        "select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and (tablename in ('study_revisions', 'study_datum_messages') or indexname = 'IDX_tis_projects_root') order by 1, 2",
      ),
    });
    const CHAT_MIGRATE_IDS = [
      "tis_projects.revised_from_project_id",
      "tis_projects.root_project_id",
      "tis_projects.idx_root",
      "study_revisions.create",
      "study_revisions.uq_project",
      "study_datum_messages.create",
      "study_datum_messages.idx_project",
      "study_datum_messages.idx_firm_created",
    ];
    const chatStatements = migrateStatements.filter((s) => CHAT_MIGRATE_IDS.includes(s.id));
    const applyChat = async () => {
      const errors = [];
      for (const s of chatStatements) {
        try {
          await qm(s.sql);
        } catch (err) {
          errors.push(`${s.id}: ${err.message}`);
        }
      }
      return errors;
    };
    const pushed = await catalog(q);
    t(
      "[datum migrations] precondition: migrate.mjs holds every chat statement, once, and the pushed schema has the chat's columns, foreign keys and indexes",
      chatStatements.length === CHAT_MIGRATE_IDS.length && new Set(chatStatements.map((s) => s.id)).size === CHAT_MIGRATE_IDS.length && pushed.columns.length === 28 && pushed.fks.length === 10 && pushed.indexes.length === 6,
      { statements: chatStatements.map((s) => s.id), columns: pushed.columns.length, fks: pushed.fks.length, indexes: pushed.indexes.map((i) => i.indexname) },
    );
    t("[datum migrations] precondition: the second database starts as the same push", json(await catalog(qm)) === json(pushed));
    const onPushed = await applyChat();
    t(
      "[datum migrations] migrate.mjs's chat statements run without error on a schema drizzle already pushed, and change nothing there",
      onPushed.length === 0 && json(await catalog(qm)) === json(pushed),
      onPushed,
    );
    // Written directly, in the second database only: the chat's objects removed, as on a database from before the chat.
    await qm("drop table study_datum_messages");
    await qm("drop table study_revisions");
    await qm("alter table tis_projects drop column revised_from_project_id, drop column root_project_id");
    const removed = await catalog(qm);
    const built = await applyChat();
    const afterBuild = await catalog(qm);
    const again = await applyChat();
    const afterAgain = await catalog(qm);
    t("[datum migrations] precondition: with the chat's objects removed, none of them is left", removed.columns.length === 0 && removed.fks.length === 0 && removed.indexes.length === 0, removed);
    t("[datum migrations] on a database without them, migrate.mjs's chat statements all run, in file order, without error", built.length === 0, built);
    t(
      "[datum migrations] what migrate.mjs builds is what drizzle builds: the same columns (type, length, nullability, default), foreign keys (target, delete rule) and indexes",
      json(afterBuild) === json(pushed),
      { columns: afterBuild.columns.filter((c) => !pushed.columns.some((p) => json(p) === json(c))), fks: afterBuild.fks, indexes: afterBuild.indexes.map((i) => i.indexdef) },
    );
    t("[datum migrations] a second run of the same statements (the next deploy's boot) is a no-op", again.length === 0 && json(afterAgain) === json(pushed), again);

    // -- [datum RF3] the versions: insert-only, max+1 within the lineage, concurrent saves never share a number --
    const THEME = "5b0c2d1e-3f4a-4b5c-8d6e-7f8091a2b3c4";
    const mkStudy = async (name) =>
      (
        await q(
          "insert into tis_projects (user_id, firm_id, study_type, project_name, land_use_code, land_use_size, site_lat, site_lon, region_code, report_theme_id, request_payload, result_payload) values ('user-a', $1, 'tis', $2, '820', '125000', '33.7490', '-84.3880', 'atlanta_metro', $3, $4, $5) returning id",
          [fa, name, THEME, json({ projectName: name, growthRatePct: 2.1, marker: `${name} request 4b7e` }), json({ marker: `${name} result 9a1c`, big: "x".repeat(3000) })],
        )
      )[0].id;
    const V1 = await mkStudy("D-study");
    const rowOf = async (id) =>
      (await q("select md5(t::text || ':' || t.xmin::text) h, request_payload::text rq, result_payload::text rs from tis_projects t where id = $1", [id]))[0];
    const allRows = async () => new Map((await q("select id, md5(t::text || ':' || t.xmin::text) h from tis_projects t")).map((r) => [r.id, r.h]));
    const v1Before = await rowOf(V1);
    const rowsBefore = await allRows();
    const revisionsBefore = await count("select count(*) c from study_revisions");
    const revArgs = (parentId, { firmId = fa, userId = "user-a", label = "x", sourceLabel = null, messageId = null, findingId = null, clauseId = null } = {}) => ({
      parentId,
      firmId,
      userId,
      request: { projectName: "D-study", growthRatePct: 1, marker: `request ${label}` },
      result: { marker: `result ${label}` },
      changes: [{ field: "growthRatePct", from: 2.1, to: 1 }],
      reason: `reason ${label}`,
      sourceLabel,
      messageId,
      findingId,
      clauseId,
    });
    const [c1, c2] = await Promise.all([val("createRevision", revArgs(V1, { label: "c1" })), val("createRevision", revArgs(V1, { userId: "user-c", label: "c2" }))]);
    t("[datum RF3] two concurrent createRevision calls from v1 give versions {2,3}, no duplicate", json([c1.version, c2.version].sort()) === json([2, 3]), [c1, c2]);
    const studyRow = async (id) => (await q("select * from tis_projects where id = $1", [id]))[0];
    const V1ROW = await studyRow(V1);
    const COPIED = ["firm_id", "study_type", "project_name", "land_use_code", "land_use_size", "site_lat", "site_lon", "region_code", "report_theme_id"];
    const made = await Promise.all([c1, c2].map((c) => studyRow(c.projectId)));
    t(
      "[datum RF3] each is revised from v1, with v1 as its root, the parent's name, study type, land use, size, site, region and report format, the asking user, and the request and result it was given",
      made.every((r, i) => r && r.revised_from_project_id === V1 && r.root_project_id === V1 && COPIED.every((k) => r[k] === V1ROW[k]) && r.report_theme_id === THEME && r.user_id === (i === 0 ? "user-a" : "user-c") && r.request_payload.marker === `request c${i + 1}` && r.result_payload.marker === `result c${i + 1}`),
      made.map((r) => r && { revised: r.revised_from_project_id, root: r.root_project_id, user: r.user_id, version: r.version }),
    );
    const FINDING = (await q("select id, clause_id from study_proofread_findings order by created_at limit 1"))[0];
    const MESSAGE = "8c7d6e5f-4a3b-4c2d-9e1f-0a1b2c3d4e5f";
    const c3 = await val("createRevision", revArgs(V1, { label: "c3", sourceLabel: "County letter, 2026-09-14", messageId: MESSAGE, findingId: FINDING.id, clauseId: FINDING.clause_id }));
    const c3row = await studyRow(c3.projectId);
    t("[datum RF3] a third createRevision from v1, after v2 and v3 exist, gives 4, revised from v1", c3.version === 4 && c3row?.version === 4 && c3row.revised_from_project_id === V1 && c3row.root_project_id === V1, { c3, revised: c3row?.revised_from_project_id });
    const fromV2 = await val("createRevision", revArgs(c1.projectId, { label: "from-v2" }));
    const fromV2row = await studyRow(fromV2.projectId);
    t(
      "[datum RF3] a fix asked on a later version numbers within the same lineage: from v2 gives 5, revised from v2, its root still v1",
      fromV2.version === 5 && fromV2row?.revised_from_project_id === c1.projectId && fromV2row.root_project_id === V1,
      { fromV2, revised: fromV2row?.revised_from_project_id, root: fromV2row?.root_project_id },
    );
    // A burst under contention, from three parents of the one lineage at once.
    const burstParents = [V1, c1.projectId, c3.projectId, fromV2.projectId, V1, c2.projectId, V1, c1.projectId, V1, c3.projectId];
    const burstMade = await Promise.all(burstParents.map((p, i) => datum("createRevision", revArgs(p, { userId: i % 2 ? "user-c" : "user-a", label: `burst-${i}` }))));
    const lineageVersions = (await q("select version from tis_projects where id = $1 or root_project_id = $1 order by version", [V1])).map((r) => r.version);
    t(
      "[datum RF3] a burst of 10 concurrent createRevision calls on one lineage: every one is saved, and the lineage's versions are exactly 1..15, none shared",
      burstMade.every((r) => r.ok === true) && json(lineageVersions) === json(Array.from({ length: 15 }, (_, i) => i + 1)),
      { failed: burstMade.filter((r) => !r.ok).map((r) => r.error), lineageVersions },
    );
    const v1After = await rowOf(V1);
    t(
      "[datum RF3] the v1 row's request_payload and result_payload are byte-equal to before, and the whole row is identical, xmin included: the lock on it wrote nothing",
      v1After.rq === v1Before.rq && v1After.rs === v1Before.rs && v1After.h === v1Before.h,
      { before: v1Before.h, after: v1After.h },
    );
    const rowsAfter = await allRows();
    const touched = [...rowsBefore].filter(([id, h]) => rowsAfter.get(id) !== h).map(([id]) => id);
    t(
      "[datum RF3] insert-only: no tis_projects row that existed before the saves was changed or deleted (row text and xmin), and exactly 14 were added",
      touched.length === 0 && rowsAfter.size === rowsBefore.size + 14,
      { touched, added: rowsAfter.size - rowsBefore.size },
    );
    const revRows = await q("select r.*, p.version from study_revisions r join tis_projects p on p.id = r.project_id where r.root_project_id = $1 order by p.version", [V1]);
    t(
      "[datum RF3] one study_revisions row per new version (14), each naming the version it was made from, the lineage's root, firm A and the user who asked",
      revRows.length === 14 && revisionsBefore + 14 === (await count("select count(*) c from study_revisions")) && revRows.every((r) => r.firm_id === fa && r.from_project_id && r.root_project_id === V1 && ["user-a", "user-c"].includes(r.requested_by_user_id)),
      revRows.map((r) => [r.version, r.from_project_id === V1, r.requested_by_user_id]),
    );
    const revV4 = revRows.find((r) => r.project_id === c3.projectId);
    const revV2 = revRows.find((r) => r.project_id === c1.projectId);
    t(
      "[datum RF3] the log row keeps the changes, the reason, the source, the message, the finding and the clause it was given",
      revV4 && isDeepStrictEqual(revV4.changes, [{ field: "growthRatePct", from: 2.1, to: 1 }]) && revV4.reason === "reason c3" && revV4.source_label === "County letter, 2026-09-14" && revV4.message_id === MESSAGE && revV4.finding_id === FINDING.id && revV4.clause_id === FINDING.clause_id,
      revV4,
    );
    t("[datum RF3] with no source given, source_label is NULL: the words 'no source given' are the change card's, never stored", revV2 && revV2.source_label === null && (await count("select count(*) c from study_revisions where source_label ilike '%no source%'")) === 0, revV2?.source_label);

    // -- [datum] another firm --
    const projectsNow = await count("select count(*) c from tis_projects");
    const revisionsNow = await count("select count(*) c from study_revisions");
    const crossFirm = await datum("createRevision", revArgs(V1, { firmId: fb, userId: "user-b", label: "cross" }));
    const unknownParent = await datum("createRevision", revArgs(UNKNOWN, { label: "unknown" }));
    const malformedParent = await datum("createRevision", revArgs("-".repeat(36), { label: "malformed" }));
    t("[datum] createRevision with another firm's id throws NotFound", crossFirm.ok === false && crossFirm.error?.name === "NotFound" && crossFirm.error?.notFound === true, crossFirm);
    t(
      "[datum] an unknown parent and a malformed id throw the same NotFound (not a Postgres error)",
      [unknownParent, malformedParent].every((r) => r.ok === false && r.error?.notFound === true && r.error.message === crossFirm.error?.message),
      [unknownParent, malformedParent],
    );
    t(
      "[datum] none of those wrote anything: no study row, no revision row",
      (await count("select count(*) c from tis_projects")) === projectsNow && (await count("select count(*) c from study_revisions")) === revisionsNow,
    );

    // -- [datum] the lineage, the revisions, the count --
    const lastId = (await q("select id from tis_projects where root_project_id = $1 and version = 15", [V1]))[0]?.id;
    const lin1 = await val("lineageFor", fa, V1);
    const lin5 = await val("lineageFor", fa, fromV2.projectId);
    t(
      "[datum] lineageFor v1: version 1, revised from nothing, the latest version 15 and its id",
      json(lin1) === json({ version: 1, revisedFromProjectId: null, revisedFromVersion: null, latestVersionId: lastId, latestVersion: 15 }) && holds("lineage v1", datumContract.DatumChatReadResponse.shape.lineage, lin1),
      lin1,
    );
    t(
      "[datum] lineageFor v5: version 5, revised from v2 (version 2), the same latest version",
      json(lin5) === json({ version: 5, revisedFromProjectId: c1.projectId, revisedFromVersion: 2, latestVersionId: lastId, latestVersion: 15 }) && holds("lineage v5", datumContract.DatumChatReadResponse.shape.lineage, lin5),
      lin5,
    );
    t("[datum] countLineage counts every version of the lineage, the original included (15)", (await val("countLineage", fa, V1)) === 15);
    const fromV1 = await val("listRevisions", fa, V1);
    const atV2 = await val("listRevisions", fa, c1.projectId);
    const madeFromV1 = revRows.filter((r) => r.from_project_id === V1).map((r) => r.project_id).sort();
    const madeFromV2 = revRows.filter((r) => r.from_project_id === c1.projectId).map((r) => r.project_id);
    t(
      "[datum] listRevisions(v1) is exactly the revisions made from v1 (v1 itself was made by none), newest first",
      json(fromV1.map((r) => r.projectId).sort()) === json(madeFromV1) && fromV1.every((r, i) => i === 0 || r.createdAt <= fromV1[i - 1].createdAt) && fromV1.every((r) => r.fromProjectId === V1),
      fromV1.map((r) => [r.version, r.createdAt]),
    );
    t(
      "[datum] listRevisions(v2) holds the revision made into v2 and every one made from it",
      json(atV2.map((r) => r.projectId).sort()) === json([c1.projectId, ...madeFromV2].sort()) && atV2.some((r) => r.projectId === c1.projectId && r.version === 2),
      atV2.map((r) => [r.version, r.fromProjectId === c1.projectId]),
    );
    t(
      "[datum] each revision answers who asked by name (the email when the user has none), and its version",
      fromV1.every((r) => ["a@example.test", "c@example.test"].includes(r.requestedBy)) && fromV1.find((r) => r.projectId === c3.projectId)?.version === 4,
      fromV1.map((r) => r.requestedBy),
    );
    t("[datum] every revision read parses under DatumRevision", [...fromV1, ...atV2].every((r, i) => holds(`revision ${i}`, datumContract.DatumRevision, r)));
    t(
      "[datum] a revision's changes are served as { field, from, to }, in that order, whatever order jsonb keeps them in",
      fromV1.every((r) => r.changes.length === 1 && json(r.changes[0]) === json({ field: "growthRatePct", from: 2.1, to: 1 })),
      fromV1.map((r) => r.changes),
    );
    const crossReads = {
      lineage: await datum("lineageFor", fb, V1),
      revisions: await val("listRevisions", fb, V1),
      count: await val("countLineage", fb, V1),
      messages: await val("listMessages", fb, V1),
    };
    t(
      "[datum] another firm reads nothing of the lineage: lineageFor NotFound, no revisions, a count of 0, no messages",
      crossReads.lineage.ok === false && crossReads.lineage.error?.notFound === true && crossReads.revisions.length === 0 && crossReads.count === 0 && crossReads.messages.length === 0,
      crossReads,
    );

    // -- [datum] the thread and the firm's 24-hour reply count --
    const msg = (projectId, firmId, role, content, extra = {}) => val("insertMessage", { projectId, firmId, userId: role === "datum" ? null : "user-a", role, content, ...extra });
    const backdate = (id, hours) => q(`update study_datum_messages set created_at = now() - interval '${Number(hours)} hours' where id = $1`, [id]);
    const repliesA0 = await val("firmRepliesLast24h", fa);
    const repliesB0 = await val("firmRepliesLast24h", fb);
    const old25 = await msg(V1, fa, "datum", "a reply from yesterday");
    await backdate(old25.id, 25);
    const old23 = await msg(V1, fa, "datum", "a reply from this morning");
    await backdate(old23.id, 23);
    const eng = await msg(V1, fa, "engineer", "why was growth flagged?", { findingId: FINDING.id });
    const rep = await msg(V1, fa, "datum", "Because the override has no source.", { revisionId: revV2.id, model: "claude-opus-5-5", inputTokens: 1200, outputTokens: 80, stopReason: "end_turn" });
    await msg(c1.projectId, fa, "datum", "a reply on v2");
    await msg(PB, fb, "datum", "a reply to firm B");
    const engOld = await msg(V1, fa, "engineer", "an older question");
    await backdate(engOld.id, 2);
    t(
      "[datum] firmRepliesLast24h counts only role='datum' rows of that firm within 24 h (3 new for A: not the engineer's, not the one 25 h old, not firm B's)",
      (await val("firmRepliesLast24h", fa)) === repliesA0 + 3 && (await val("firmRepliesLast24h", fb)) === repliesB0 + 1,
      { a: [repliesA0, await val("firmRepliesLast24h", fa)], b: [repliesB0, await val("firmRepliesLast24h", fb)] },
    );
    const repRow = (await q("select * from study_datum_messages where id = $1", [rep.id]))[0];
    t(
      "[datum] insertMessage stores the reply's revision, model, token counts and stop reason, with no user",
      repRow && repRow.user_id === null && repRow.role === "datum" && repRow.revision_id === revV2.id && repRow.model === "claude-opus-5-5" && repRow.input_tokens === 1200 && repRow.output_tokens === 80 && repRow.stop_reason === "end_turn",
      repRow,
    );
    await q("update users set first_name = 'Cee', last_name = 'Member' where id = 'user-c'");
    await val("insertMessage", { projectId: V1, firmId: fa, userId: "user-c", role: "engineer", content: "a question from C" });
    const thread = await val("listMessages", fa, V1);
    t(
      "[datum] listMessages is the study's thread, oldest first, and only this study's",
      thread.length === 6 && thread.every((m, i) => i === 0 || m.createdAt >= thread[i - 1].createdAt) && thread[0].id === old25.id && thread[1].id === old23.id && thread[2].id === engOld.id,
      thread.map((m) => [m.role, m.content, m.createdAt]),
    );
    const byId = new Map(thread.map((m) => [m.id, m]));
    t(
      "[datum] each engineer message carries its author's name, joined at read time (the email when there is none); Datum's carry none",
      byId.get(eng.id)?.authorName === "a@example.test" && thread.find((m) => m.content === "a question from C")?.authorName === "Cee Member" && thread.filter((m) => m.role === "datum").every((m) => m.authorName === null),
      thread.map((m) => [m.role, m.authorName]),
    );
    t("[datum] the thread keeps the finding an engineer asked about and the revision a reply reports", byId.get(eng.id)?.findingId === FINDING.id && byId.get(rep.id)?.revisionId === revV2.id);
    t("[datum] every message read parses under DatumMessage", thread.every((m, i) => holds(`message ${i}`, datumContract.DatumMessage, m)));
    const foreignThread = await val("listMessages", fb, V1);
    t("[datum] another firm reads none of that thread (listMessages with firm B's id, on a study whose thread now has 6 messages)", Array.isArray(foreignThread) && foreignThread.length === 0 && thread.length === 6, foreignThread);
    const afterNames = await val("listRevisions", fa, V1);
    t("[datum] a revision's requestedBy is read at read time too: C's now answer 'Cee Member'", afterNames.some((r) => r.requestedBy === "Cee Member") && !afterNames.some((r) => r.requestedBy === "c@example.test"), afterNames.map((r) => r.requestedBy));

    // -- [datum] the findings the chat may talk about are what the panel shows --
    const pmRun = (await q("select id, revision from study_proofread_runs where project_id = $1 order by revision desc limit 1", [PM]))[0];
    // Written directly: an admin-audience finding on the study's newest run, and a decision on it.
    const hiddenF = (
      await q(
        "insert into study_proofread_findings (run_id, clause_id, section, type, title, detail, source_label, read_paths, remedy, audience, fingerprint) values ($1,'x-datum-admin',4,'DEFECT','datum hidden 31f0','d','s','[]','r','admin','datumadminfp') returning id",
        [pmRun.id],
      )
    )[0].id;
    await q("insert into study_proofread_dispositions (finding_id, disposition, note, actor_user_id) values ($1,'BUG_FILED','datum hidden note 7a2e','user-admin')", [hiddenF]);
    const panel = await call("GET", `/projects/${PM}/proofread`, { user: U("a") });
    const chat = await val("loadVisible", fa, PM);
    const byFid = (xs) => [...xs].sort((x, y) => (x.id < y.id ? -1 : 1));
    const panelFindings = byFid((panel.body?.findings ?? []).map(({ section, fingerprint, ...rest }) => rest));
    const byDecision = (xs) => [...xs].sort((x, y) => (x.findingId + x.createdAt + x.disposition < y.findingId + y.createdAt + y.disposition ? -1 : 1));
    t(
      "[datum] precondition: the panel's read of that study has findings, decisions on them, and withholds the admin finding",
      panel.status === 200 && panelFindings.length > 0 && (panel.body?.dispositions ?? []).length > 0 && panel.body?.withheld >= 1,
      { status: panel.status, findings: panelFindings.length, dispositions: panel.body?.dispositions?.length, withheld: panel.body?.withheld },
    );
    t(
      "[datum] loadVisible's findings are exactly the panel's (id, clause, type, title, detail, source, read paths, remedy)",
      json(byFid(chat.findings)) === json(panelFindings) && chat.findings.every((f) => Object.keys(f).sort().join() === "clauseId,detail,id,readPaths,remedy,sourceLabel,title,type"),
      { chat: chat.findings.map((f) => f.id), panel: panelFindings.map((f) => f.id) },
    );
    t(
      "[datum] loadVisible's decisions are exactly the panel's, under the names the grounding pack reads (findingId, disposition, note, sourceLabel, createdAt)",
      json(byDecision(chat.dispositions)) === json(byDecision(panel.body?.dispositions ?? [])) && chat.dispositions.every((d) => Object.keys(d).sort().join() === "createdAt,disposition,findingId,note,sourceLabel"),
      { chat: chat.dispositions, panel: panel.body?.dispositions },
    );
    t(
      "[datum] the admin-audience finding and the decision on it reach the chat in no form",
      !json(chat).includes(hiddenF) && !json(chat).includes("datum hidden") && !json(chat).includes("BUG_FILED") && !json(chat).includes("DEFECT"),
      chat,
    );
    const noRun = await val("loadVisible", fa, V1);
    const foreignVisible = await val("loadVisible", fb, PM);
    t("[datum] loadVisible on a study with no run, and on another firm's study, is empty", json(noRun) === json({ findings: [], dispositions: [] }) && json(foreignVisible) === json({ findings: [], dispositions: [] }), [noRun, foreignVisible]);

    // -- [datum] the delete rules --
    // A finding that goes leaves the log and the thread, unlinked.
    const goneF = (
      await q(
        "insert into study_proofread_findings (run_id, clause_id, section, type, title, detail, source_label, read_paths, remedy, audience, fingerprint) values ($1,'x-datum-gone',6,'NOTE','t','d','s','[]','r','engineer','datumgonefp') returning id",
        [pmRun.id],
      )
    )[0].id;
    const withF = await val("createRevision", revArgs(V1, { label: "with-finding", findingId: goneF, clauseId: "x-datum-gone" }));
    const msgF = await msg(V1, fa, "engineer", "about the finding that goes", { findingId: goneF });
    await q("delete from study_proofread_findings where id = $1", [goneF]);
    const revF = (await q("select finding_id, clause_id from study_revisions where project_id = $1", [withF.projectId]))[0];
    const msgFRow = (await q("select finding_id from study_datum_messages where id = $1", [msgF.id]))[0];
    t(
      "[datum] deleting a finding sets finding_id NULL on the revision and the message that named it, and both stay",
      revF && revF.finding_id === null && revF.clause_id === "x-datum-gone" && msgFRow && msgFRow.finding_id === null,
      { revF, msgFRow },
    );
    // Written directly: a lineage of its own, whose first version is then deleted.
    const P1 = await mkStudy("D-cascade-study");
    const P2 = await val("createRevision", revArgs(P1, { label: "cascade" }));
    const pm1 = await msg(P1, fa, "engineer", "on the parent");
    const pm2 = await msg(P2.projectId, fa, "engineer", "on v2");
    const pm2b = await msg(P2.projectId, fa, "datum", "a reply on v2");
    const v1Messages = await count("select count(*) c from study_datum_messages where project_id = $1", [V1]);
    await q("delete from tis_projects where id = $1", [P1]);
    const p2Row = await studyRow(P2.projectId);
    const p2Rev = (await q("select * from study_revisions where project_id = $1", [P2.projectId]))[0];
    const present = async (ids) => (await q("select id from study_datum_messages where id = any($1::uuid[])", [ids])).map((r) => r.id).sort();
    t(
      "[datum] deleting the parent project leaves v2, with revised_from_project_id (and root_project_id) NULL",
      p2Row && p2Row.revised_from_project_id === null && p2Row.root_project_id === null && p2Row.version === 2,
      p2Row && { revised: p2Row.revised_from_project_id, root: p2Row.root_project_id, version: p2Row.version },
    );
    t("[datum] the log row of v2 stays, still naming the deleted parent: it is history", p2Rev && p2Rev.from_project_id === P1 && p2Rev.root_project_id === P1, p2Rev);
    t(
      "[datum] the parent's messages went with it; v2's stayed, and so did every other study's",
      json(await present([pm1.id, pm2.id, pm2b.id])) === json([pm2.id, pm2b.id].sort()) && (await count("select count(*) c from study_datum_messages where project_id = $1", [V1])) === v1Messages,
    );
    const linOrphan = await val("lineageFor", fa, P2.projectId);
    t(
      "[datum] lineageFor a version whose parent and root are gone: revised from nothing, and the latest of what is left is itself",
      json(linOrphan) === json({ version: 2, revisedFromProjectId: null, revisedFromVersion: null, latestVersionId: P2.projectId, latestVersion: 2 }),
      linOrphan,
    );
    await q("delete from tis_projects where id = $1", [P2.projectId]);
    t(
      "[datum] deleting v2 takes its messages and its log row with it (cascade), and nothing else",
      (await present([pm2.id, pm2b.id])).length === 0 &&
        (await count("select count(*) c from study_revisions where project_id = $1", [P2.projectId])) === 0 &&
        (await count("select count(*) c from study_datum_messages where project_id = $1", [V1])) === v1Messages,
    );
    t(`[datum] every chat read (${datumContractChecked}) parses under the chat contract`, datumContractChecked > 0 && datumContractFailures.length === 0, datumContractFailures);
  } catch (err) {
    console.log(`DRIVER ERROR ${withCauses(err)}`);
    console.log(err);
    t("driver completed", false, withCauses(err));
  }
  return results;
}
