/**
 * The assertions run.mjs makes against the real proofread routes, store, runner and limiters, over HTTP, with SQL
 * against the throwaway database for setup and for what the HTTP answers cannot show. Not runnable alone: run.mjs
 * hands it the server, the database and the tree's fixture and read contract.
 *
 * Tags name the fix each newer family pins: [FW-1 carry] carry-forward is gated on the rules version, not the
 * deploy; [FW-2 date] a carried decision keeps its date; [FW-3 withheld] admin-audience findings are counted,
 * never shown; [FW-5 422] the server refuses a decision the finding's type is not offered; [FW-6 409] a decision
 * on a run that is not the project's newest finished run is refused; [claim] claimAndRunOne leaves the study rows
 * alone. Untagged assertions are the original tenancy, rules and limiter suite.
 *
 * The database is written directly in a few places, each named where it happens: users and projects (the app has
 * no route the harness can use for them), a finding of a type or audience the clause pass does not produce, a
 * run that is still running, a run recorded under another rules version, and one queued run for the claim.
 */

const UNKNOWN = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const NOT_FOUND = "Finding not found.";
const DOES_NOT_APPLY = "This decision does not apply to this finding.";
const RUN_AGAIN = "This check has been run again. Refresh to see the latest.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function drive({ call, q, claimOne, restart, contract, fixture, serverLines, SHA_A, SHA_B }) {
  const results = [];
  const t = (name, cond, detail) => {
    results.push({ name, ok: !!cond });
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || detail === undefined ? "" : `\n        ${typeof detail === "string" ? detail : JSON.stringify(detail)}`.slice(0, 1200)}`);
  };
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
    for (const n of ["a", "b", "c", "lim", "lim2"]) await q("insert into users (id, email) values ($1, $2)", [`user-${n}`, `${n}@example.test`]);
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
    t("the log is append-only: every accepted decision is its own row (3 so far)", (await count("select count(*) c from study_proofread_dispositions where finding_id = $1", [target.id])) === 3);
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
    const revs = await q("select id, revision, status, rules_version, engine_stamp, created_at from study_proofread_runs where project_id = $1 order by revision", [PA]);
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

    // ---- concurrency: quick presses of "Run again" -------------------------------------------------------------------
    const burst = await Promise.all(Array.from({ length: 12 }, () => call("POST", `/projects/${PA2}/proofread`, { user: U("a") })));
    const burstRevs = (await q("select revision from study_proofread_runs where project_id = $1 order by revision", [PA2])).map((r) => r.revision);
    const tally = {};
    for (const r of burst) tally[r.status] = (tally[r.status] ?? 0) + 1;
    console.log(`INFO  burst of 12 simultaneous "Run again" presses: statuses ${JSON.stringify(tally)}, revisions written ${JSON.stringify(burstRevs)}`);

    // ---- limiters: separate budgets, draft-7 headers (this server process started at the restart above) -----------------
    const runStatuses = [];
    let lastRun;
    for (let i = 0; i < 31; i++) {
      lastRun = await call("POST", `/projects/${PL}/proofread`, { user: U("lim") });
      runStatuses.push(lastRun.status);
    }
    t("run limiter: 30 runs in the hour are served, the 31st is 429", runStatuses.slice(0, 30).every((s) => s === 200) && runStatuses[30] === 429, runStatuses);
    t(
      "the 429 uses draft-7 headers (RateLimit + RateLimit-Policy, no X-RateLimit-*)",
      lastRun.headers.get("ratelimit-policy") && lastRun.headers.get("ratelimit") && !lastRun.headers.get("x-ratelimit-limit") && /Too many proofread runs/.test(lastRun.body?.error ?? ""),
      `${lastRun.headers.get("ratelimit-policy")} | ${lastRun.headers.get("ratelimit")} | ${JSON.stringify(lastRun.body)}`,
    );
    const limView = await get(PL, "lim");
    const limTarget = limView.body?.findings?.find((f) => f.type !== "CONTESTED");
    const dispStatuses = [];
    for (let i = 0; i < 5; i++) dispStatuses.push((await call("POST", dispUrl(PL, limView.body?.runId, limTarget?.id), { user: U("lim"), body: { disposition: "FIXED" } })).status);
    t("with the run budget spent, the SAME user can still read and record decisions (separate budgets)", limView.status === 200 && dispStatuses.every((s) => s === 200), [limView.status, dispStatuses]);
    const readStatuses = [];
    for (let i = 0; i < 125; i++) readStatuses.push((await call("GET", `/projects/${PL2}/proofread`, { user: U("lim2") })).status);
    t(
      "read limiter: 120/min then 429",
      readStatuses.slice(0, 120).every((s) => s === 200) && readStatuses.slice(120).every((s) => s === 429),
      `200s=${readStatuses.filter((s) => s === 200).length} 429s=${readStatuses.filter((s) => s === 429).length}`,
    );
    const otherUser = await call("GET", `/projects/${PA}/proofread`, { user: U("a") });
    t("limits are per user: another user is unaffected by the spent budgets", otherUser.status === 200, otherUser.status);

    // ---- the advisor boundary, for everything above ------------------------------------------------------------------
    const hEnd = await studyHash();
    t("after every request above, tis_projects is byte-identical (xmin included) to what it was before the first call", h0 === hEnd, `${h0} -> ${hEnd}`);
    // Last, because it writes a study row: the hash is not looking at nothing.
    await q("update tis_projects set project_name = project_name where id = $1", [PA2]);
    t("[claim] the hash sees xmin: a value-identical UPDATE of one tis_projects row changes it", (await studyHash()) !== hEnd);
    t(`every GET answer (${contractChecked}) parses under the read contract (ProofreadReadResponse)`, contractChecked > 0 && contractFailures.length === 0, contractFailures);
  } catch (err) {
    console.log("DRIVER ERROR", err);
    results.push({ name: "driver completed", ok: false });
  }
  return results;
}
