/**
 * Proofread surface: read a run, request a run, record a triage decision.
 *
 * That is the whole API on purpose. Datum is an advisor — there is no endpoint
 * that changes a study, and no handler here touches request_payload or
 * result_payload. Firm scoping is in every query's WHERE clause; there is no
 * middleware that does it.
 */
import { Router, type IRouter } from "express";
import { OFFERED_DISPOSITIONS, ProofreadDispositionBody } from "@workspace/tis-api-zod";
import { getOrCreateFirmForUser } from "../lib/firms";
import { projectExistsForFirm } from "../lib/tis-projects";
import { proofreadDispositionLimiter, proofreadReadLimiter, proofreadRunLimiter } from "../lib/security";
import { claimAndRunOne, enqueueProofread } from "../lib/proofread-run";
import {
  findingAudienceForFirm,
  findingInFirmRun,
  insertDisposition,
  latestRunForProject,
  latestRunStatusForProject,
} from "../lib/proofread-store";

const router: IRouter = Router();

// Canonical form only. The repo's looser /^[0-9a-f-]{36}$/ also admits 36
// dashes, which Postgres rejects as a 500 rather than the 404 this should be.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dispositions only the sealing PE may record. Phase 4 adds the `pe` role and gates these; until then they are refused. */
const PE_ONLY = new Set(["ACCEPTED_RISK", "CONTESTED_PE"]);

/**
 * Whether the contract offers this decision on a finding of this type
 * (OFFERED_DISPOSITIONS, the table the panel offers from too). A type the
 * contract does not name is offered nothing: refuse, never guess. The
 * own-property test keeps a type such as "constructor" from reading
 * Object.prototype.
 */
function decisionApplies(type: string, disposition: string): boolean {
  if (!Object.hasOwn(OFFERED_DISPOSITIONS, type)) return false;
  const offered: readonly string[] = OFFERED_DISPOSITIONS[type as keyof typeof OFFERED_DISPOSITIONS];
  return offered.includes(disposition);
}

/**
 * Two quick presses of "Run again" both derive the same next revision, and the
 * (project_id, revision) unique key rejects the loser (insertQueuedRun). The
 * winner's run IS queued, and a run is a pure function of a study row that has
 * not changed, so the loser has nothing left to do: that is a success, not a
 * 500. Drizzle wraps the driver's error, so look through `cause`.
 */
const REVISION_KEY = "UQ_study_proofread_runs_project_revision";
function isRevisionConflict(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e.code === "23505" && e.constraint === REVISION_KEY) return true;
  }
  return false;
}

router.get("/projects/:id/proofread", proofreadReadLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to view this check." });
    return;
  }
  const id = String(req.params.id);
  if (!UUID.test(id)) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  try {
    const user = req.user!;
    const { firm } = await getOrCreateFirmForUser(user.id, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    // Existence only — getProject would pull both large jsonb study payloads
    // out of Postgres on every poll just to discard them.
    if (!(await projectExistsForFirm(firm.id, id))) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    // No scheduler in this service: every read gets one opportunistic sweep.
    void claimAndRunOne().catch(() => undefined);
    const latest = await latestRunForProject(firm.id, id);
    if (!latest) {
      res.json({ status: "none", withheld: 0, rulesChanged: false, findings: [], coverage: [], dispositions: [] });
      return;
    }
    const { run, findings, dispositions, previous } = latest;
    // Hidden, but never silent: a DEFECT holds the study until a re-run no
    // longer raises it, so the panel must not read a run that carries one as
    // clear. The count is all that leaves the server — no type, clause, path
    // or message of a withheld finding. Counted first, from every finding the
    // store read for the run, before anything is filtered out of the list.
    const withheld = findings.filter((f) => f.audience === "admin").length;
    // DEFECT is admin-side: a software fault is not the engineer's to rule on.
    // The dispositions are narrowed to the same findings, so a row about a
    // hidden finding does not leak its id.
    const visible = findings.filter((f) => f.audience !== "admin");
    const visibleIds = new Set(visible.map((f) => f.id));
    // Whether the revision this run carried its decisions from ran under other
    // rules — the carry gate's own comparison. Then nothing carried: a
    // RULES_VERSION change reopens every decision on purpose, and the panel
    // says so rather than showing them open with no reason. run.rulesVersion
    // is stamped when the run's clauses run, so on a finished run it is the
    // rules the carry compared with.
    const rulesChanged = previous !== null && previous.rulesVersion !== run.rulesVersion;
    res.json({
      status: run.status,
      runId: run.id,
      revision: run.revision,
      protocolVersion: run.protocolVersion,
      rulesVersion: run.rulesVersion,
      engineStamp: run.engineStamp,
      inputManifest: run.inputManifest,
      coverage: run.coverage,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      withheld,
      rulesChanged,
      findings: visible.map((f) => ({
        id: f.id,
        clauseId: f.clauseId,
        section: f.section,
        type: f.type,
        title: f.title,
        detail: f.detail,
        sourceLabel: f.sourceLabel,
        readPaths: f.readPaths,
        remedy: f.remedy,
        fingerprint: f.fingerprint,
      })),
      dispositions: dispositions
        .filter((d) => visibleIds.has(d.findingId))
        .map((d) => ({
          findingId: d.findingId,
          disposition: d.disposition,
          note: d.note,
          sourceLabel: d.sourceLabel,
          createdAt: d.createdAt.toISOString(),
        })),
    });
  } catch (err) {
    req.log.error({ err }, "proofread.get_failed");
    res.status(500).json({ error: "Failed to load the check." });
  }
});

router.post("/projects/:id/proofread", proofreadRunLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const id = String(req.params.id);
  if (!UUID.test(id)) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  try {
    const user = req.user!;
    const { firm } = await getOrCreateFirmForUser(user.id, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    // Existence only, and before anything is enqueued: a run queued for
    // another firm's project would be a write under someone else's tenant.
    if (!(await projectExistsForFirm(firm.id, id))) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    await enqueueProofread({ projectId: id, firmId: firm.id, userId: user.id });
    res.json({ ok: true });
  } catch (err) {
    if (isRevisionConflict(err)) {
      res.json({ ok: true });
      return;
    }
    req.log.error({ err }, "proofread.request_failed");
    res.status(500).json({ error: "Failed to start the check." });
  }
});

router.post(
  "/projects/:id/proofread/:runId/findings/:findingId/dispositions",
  proofreadDispositionLimiter,
  async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const parsed = ProofreadDispositionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid disposition." });
      return;
    }
    if (PE_ONLY.has(parsed.data.disposition)) {
      res.status(403).json({
        error: "Only the sealing engineer can record this decision, and that role is not available yet.",
      });
      return;
    }
    const urlProjectId = String(req.params.id);
    const urlRunId = String(req.params.runId);
    const urlFindingId = String(req.params.findingId);
    if (!UUID.test(urlProjectId) || !UUID.test(urlRunId) || !UUID.test(urlFindingId)) {
      res.status(404).json({ error: "Finding not found." });
      return;
    }
    // One spelling from here on: lowercase, as Postgres renders a uuid. The
    // gate accepts either case and every query compares uuid columns without
    // regard to it, but the 409 below compares the newest run's id with this
    // one as text, and refused an uppercase id of the newest run as "run again".
    const projectId = urlProjectId.toLowerCase();
    const runId = urlRunId.toLowerCase();
    const findingId = urlFindingId.toLowerCase();
    try {
      const user = req.user!;
      const { firm } = await getOrCreateFirmForUser(user.id, {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      // Verifies the whole chain the URL asserts — firm owns the run, the run
      // belongs to this project, the finding belongs to that run — so a
      // disposition cannot be recorded under an unrelated project or run id.
      if (!(await findingInFirmRun(firm.id, projectId, runId, findingId))) {
        res.status(404).json({ error: "Finding not found." });
        return;
      }
      // That answered whether the finding is this firm's. Whether the caller
      // may act on it is a separate question: a DEFECT is a software fault for
      // the code queue and a person outside admin cannot rule on one, so the
      // write path refuses it even though the read path never shows it. 404,
      // not 403: a 403 would confirm that the finding exists.
      const finding = await findingAudienceForFirm(firm.id, findingId);
      if (finding === null || finding.audience === "admin") {
        res.status(404).json({ error: "Finding not found." });
        return;
      }
      // Which decision fits which finding is the contract's, and the panel
      // offers from the same table. The log is append-only, so a decision that
      // does not fit — a BLOCKER marked Disclosed, anything on a CONTESTED item —
      // would otherwise stay written for good.
      if (!decisionApplies(finding.type, parsed.data.disposition)) {
        res.status(422).json({ error: "This decision does not apply to this finding." });
        return;
      }
      // A decision belongs on the run the panel shows: the project's newest
      // run, finished. On an older revision it would be stranded — the newer
      // run carries forward what this one held when it ran and never looks
      // back — and on an unfinished run it races that carry. 409, so the panel
      // refetches. Not atomic with the insert below: a re-run claimed and
      // carried in the moment between this read and that write still strands
      // the decision. Finished is 'rules_ready' (phase 1's end) or 'ready' (a
      // later phase's): the panel shows findings and offers decisions on both,
      // and previousRunForProject carries from both.
      const newest = await latestRunStatusForProject(firm.id, projectId);
      if (newest === null || newest.id !== runId || (newest.status !== "rules_ready" && newest.status !== "ready")) {
        res.status(409).json({ error: "This check has been run again. Refresh to see the latest." });
        return;
      }
      await insertDisposition({
        findingId,
        disposition: parsed.data.disposition,
        note: parsed.data.note,
        sourceLabel: parsed.data.sourceLabel,
        actorUserId: user.id,
      });
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "proofread.disposition_failed");
      res.status(500).json({ error: "Failed to record the decision." });
    }
  },
);

export default router;
