/**
 * The proofread runner: enqueue, then claim-and-run.
 *
 * A proofread that cannot run never affects the study — the same contract
 * saveProject holds. Everything after a run is queued (the claim, the clause
 * pass, every write, the carry-forward) is caught and logged inside
 * claimAndRunOne, which does not reject whatever the store throws. The one
 * error that does propagate is the insert's: enqueueProofread lets it reach
 * its caller on purpose, because POST run reads a 23505 on the revision key
 * from it, and the /generate hook in routes/tis.ts holds its own .catch.
 * Phase 1 ends at 'rules_ready'; the judgment pass will take it to 'ready'.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StudyProofreadRun } from "@workspace/db";
import { logger } from "./logger";
import { ALL_CLAUSES, engineStamp, RULES_VERSION, runClauses, type StudyRecord } from "./proofread/index.ts";
import { MAX_ATTEMPTS, nextStatusAfterFailure } from "./proofread/lifecycle.ts";
import {
  carryForwardDispositions,
  claimOneRun,
  completeRun,
  insertQueuedRun,
  loadStudyForRun,
  previousRunForProject,
  runHoldsFindings,
} from "./proofread-store";

/**
 * Who holds a claim. claimed_by is VARCHAR(64): an un-truncated hostname makes
 * every claim throw 22001 "value too long", which claimAndRunOne catches and
 * logs — so no run would ever execute and nothing would say why.
 *
 * The HOST is sliced, with room reserved for the pid, rather than slicing the
 * finished string: a host name of 64 characters or more would otherwise drop
 * the pid and collapse every process on that host to one claimed_by, which is
 * the one thing this value exists to tell apart. Written as one self-contained
 * expression so the guard can evaluate it against a 200-character hostname.
 */
const INSTANCE_ID = (() => {
  const host = process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local";
  const pid = String(process.pid);
  return `${host.slice(0, 63 - pid.length)}-${pid}`;
})();

/**
 * Read once at boot: the protocol version every run record must carry (§Logging).
 *
 * Searched upward from the working directory rather than taken from it alone,
 * because the start script runs this service from its own package directory
 * (`pnpm --filter @workspace/tis-api-server run start`) while the protocol
 * lives at the repo root. 'unknown' is the honest answer when it is not found —
 * a missing protocol file must not stop a study from being proofread.
 */
const PROTOCOL_VERSION = (() => {
  try {
    let dir = process.cwd();
    for (let up = 0; up < 5; up++) {
      const file = path.join(dir, "TIS-PROOFREAD-PROTOCOL.md");
      if (existsSync(file)) {
        return /^PROTOCOL_VERSION:\s*(\S+)$/m.exec(readFileSync(file, "utf8"))?.[1] ?? "unknown";
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
})();

/** Which declared inputs the record actually carries, so partial coverage is a stated fact. */
export function buildInputManifest(rec: StudyRecord): Record<string, boolean> {
  const r = rec.result as Record<string, any>;
  const rows: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  return {
    currentVc: rows.some((x) => x?.currentVc !== undefined),
    designYear: rows.some((x) => x?.designBuildVc !== undefined || x?.designNoBuildVc !== undefined),
    approaches: rows.some((x) => Array.isArray(x?.approaches) && x.approaches.length > 0),
    signalTiming: rows.some((x) => x?.signalTiming !== undefined),
    tripGenRates: r.tripGeneration?.pmRate !== undefined,
    growthMultiplier: r.growthMultiplierExact !== undefined,
    scopeCounts: r.intersectionsInStudyArea !== undefined && r.intersectionsMergedAsDuplicates !== undefined,
    agencies: Array.isArray(r.agencies) && r.agencies.length > 0,
    periodReports: Array.isArray(r.periodReports) && r.periodReports.length > 0,
  };
}

/**
 * Queue a run, then opportunistically drain one — there is no scheduler in this service. An insert error
 * propagates (see the header); once the run is queued, nothing the store throws during the drain makes this reject.
 * The versions recorded here are this deploy's; the run is stamped again by whichever deploy runs its clauses.
 */
export async function enqueueProofread(args: { projectId: string; firmId: string; userId: string }): Promise<void> {
  const run = await insertQueuedRun({
    ...args,
    protocolVersion: PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    engineStamp: engineStamp(),
  });
  if (!run) {
    logger.warn({ projectId: args.projectId }, "proofread.enqueue_failed");
    return;
  }
  await claimAndRunOne();
}

/** Claim at most one run and execute the clauses. Returns whether work was done. */
export async function claimAndRunOne(): Promise<boolean> {
  let run: StudyProofreadRun | null = null;
  try {
    run = await claimOneRun(INSTANCE_ID);
  } catch (err) {
    logger.error({ err }, "proofread.claim_failed");
    return false;
  }
  if (!run) return false;
  // The claim incremented `attempts`. A row that has now exhausted them must be
  // failed WITHOUT running: a clause pass that crashes the process would
  // otherwise be re-claimed and re-crash forever, since nothing else moves the
  // row out of the queue.
  if (run.attempts > MAX_ATTEMPTS) {
    // Caught and logged here, never thrown. The row claimed here is the oldest
    // claimable one, not necessarily the run the caller just queued: POST run
    // reaches this through enqueueProofread AFTER its own insert succeeded, and
    // a throw from this write made it answer 500 "Failed to start the check"
    // for a check that was queued. Nothing is lost by catching it: the row
    // stays 'running', its lease expires, and the next claim lands here again.
    try {
      await completeRun({
        runId: run.id,
        status: "failed",
        findings: [],
        error: `attempts exhausted (${run.attempts} > ${MAX_ATTEMPTS})`,
      });
    } catch (err) {
      logger.warn({ err, runId: run.id }, "proofread.exhausted_write_failed");
    }
    logger.warn({ runId: run.id, attempts: run.attempts }, "proofread.attempts_exhausted");
    return true;
  }
  try {
    // A re-claimed run whose earlier attempt wrote its findings under OTHER
    // rules (it failed after its clause pass, and the deploy that claimed it
    // again changed RULES_VERSION) cannot be finished here: this pass would
    // add new-rule findings beside the old ones in one run, and the store never
    // deletes. The run fails, saying why, and the next "Run again" starts a
    // clean revision. Its rules_version is the one its first pass stamped.
    if (run.rulesVersion !== RULES_VERSION && (await runHoldsFindings(run.id))) {
      await completeRun({ runId: run.id, status: "failed", findings: [], error: "rules_changed_mid_run" });
      logger.warn({ runId: run.id, rulesVersion: run.rulesVersion, now: RULES_VERSION }, "proofread.rules_changed_mid_run");
      return true;
    }
    const study = await loadStudyForRun(run);
    if (!study) {
      await completeRun({ runId: run.id, status: "failed", coverage: [], inputManifest: {}, findings: [], error: "study row not found" });
      return true;
    }
    const rec: StudyRecord = { request: (study.request ?? {}) as any, result: (study.result ?? {}) as any };
    const { findings, coverage } = runClauses(rec, ALL_CLAUSES);
    // Three steps, in this order, and the order is the point: write what the
    // pass produced while the row is still 'running', carry the dispositions
    // forward, and only then declare the revision done. A row that flipped to
    // 'rules_ready' before the carry is visible to previousRunForProject, so a
    // re-run claimed in that window would take THIS revision as its source,
    // find no dispositions on it, and lose the previous revision's WITHDRAWN
    // for good — an append-only log cannot be corrected.
    //
    // The same write stamps the run with the code that ran the clauses: this
    // RULES_VERSION, this deploy's engine stamp, this protocol version. The
    // values recorded at queue time name the deploy that queued the run, which
    // is not always the one that claims it.
    await completeRun({
      runId: run.id,
      status: "running",
      coverage,
      inputManifest: buildInputManifest(rec),
      findings,
      stamp: { rulesVersion: RULES_VERSION, engineStamp: engineStamp(), protocolVersion: PROTOCOL_VERSION },
    });
    // A re-run must not reopen a WITHDRAWN item or lose an ACCEPTED RISK with
    // its named person. Dispositions carry forward by fingerprint, and only
    // when the previous run's clauses ran under the RULES_VERSION this pass ran
    // under — its rules_version as stamped when it ran, compared with this
    // process's constant, not the row's queue-time value. Not the engine
    // stamp: it ends in the deploy's commit, and a study row never changes,
    // so gating on it reopened every decision on the first "Run again" after
    // any deploy. The fingerprint already holds the exact values a finding
    // read, so an unchanged finding over an unchanged study is the same
    // finding; a RULES_VERSION bump means what a clause judges changed, and
    // reopens every decision on purpose.
    const prev = await previousRunForProject(run.projectId, run.revision);
    if (prev) await carryForwardDispositions(run.id, prev.id, prev.rulesVersion === RULES_VERSION);
    await completeRun({ runId: run.id, status: "rules_ready", findings: [] });
    // A DEFECT is a software fault: the engineer never sees one (GET counts it
    // as withheld) and nobody in the app can rule on it, so this line is how
    // the software team hears of it — once per finished run. The run, the
    // project and the clause, and nothing else from the finding: its text and
    // the values it read quote the study.
    for (const f of findings) {
      if (f.type === "DEFECT") {
        logger.warn({ runId: run.id, projectId: run.projectId, clause: f.clauseId }, "proofread.defect_raised");
      }
    }
    logger.info({ runId: run.id, findings: findings.length }, "proofread.rules_ready");
    return true;
  } catch (err) {
    const status = nextStatusAfterFailure({ status: run.status, claimedAt: run.claimedAt, attempts: run.attempts });
    // No coverage or inputManifest: whatever this row already holds is better
    // than {}. The failure can arrive AFTER the clause pass was written (a
    // throw in the findings insert, or in the carry-forward), and a requeue
    // that replaced real coverage with an empty one would report a study as
    // unjudged that was in fact judged. completeRun writes only the fields it
    // is given, which is what makes that omission mean "leave it alone".
    await completeRun({
      runId: run.id,
      status,
      findings: [],
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
    logger.error({ err, runId: run.id, status }, "proofread.run_failed");
    return true;
  }
}
