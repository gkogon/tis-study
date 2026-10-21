/**
 * The re-run: an engineer's corrections, applied to a saved study and run on
 * the current engine, saved as a NEW version. The original is never changed,
 * and no study slot is charged (docs/superpowers/specs/2026-10-20-datum-chat-design.md,
 * "Limits and cost"): the site, land use and size are locked, so it is the
 * same study revised, not a new one.
 *
 * Pure, like the rest of lib/datum-chat/ apart from store.ts and client.ts: no
 * db, logging library, fetch or SDK, and importable under plain `node`. Every
 * piece of I/O is a dep the route hands in (getProject, firmMayRunUncharged,
 * generateTisReport, GenerateTisResponse.parse, createRevision,
 * enqueueProofread), so the check script drives it with fakes.
 *
 * What a caller can rely on:
 *   - It never rejects. A failure anywhere is passed to `log` with its cause
 *     and answered `{ ok: false, error }` in words the engineer can be told,
 *     carrying nothing of the cause. run.ts answers a throw from `revise` with
 *     a generic line and no cause, so this is the one place the cause is seen.
 *   - The steps run in this order, and each refusal stops the rest: the firm's
 *     uncharged gate, one re-run at a time per user, the parent read within the
 *     firm, the cap on versions per lineage, the merge, the engine, the
 *     coverage warning, the result parse, the save, and then the new version's
 *     proofread, fired and not awaited.
 *   - The per-user key is added only after the gate, and removed in `finally`
 *     only by the call that added it: a refusal never frees another re-run's
 *     lock.
 *   - The version cap is checked twice: here before the engine runs (the fast
 *     path), and again by createRevision under the lineage lock, which throws
 *     LineageCapReached when a concurrent save took the last version. Both
 *     answer the same refusal.
 *   - Even malformed `args` are answered and logged, not thrown: nothing of
 *     them is read outside the `try`.
 *   - It never reserves or releases a study slot.
 */
import { DATUM_LIMITS } from "./contract.ts";
import type { DatumChange, RerunToolInput } from "./contract.ts";
import { applyRevisionChanges } from "./tools.ts";
import type { TisRequestLike } from "./tools.ts";
import type { TurnDeps } from "./run.ts";

/**
 * Thrown by createRevision when the lineage already holds
 * DATUM_LIMITS.versionsPerLineage versions, counted under the lineage lock, so
 * a concurrent save cannot take a version past the cap. Nothing was written.
 * Here, so the pure re-run can recognise it; lib/study-revisions.ts throws it.
 */
export class LineageCapReached extends Error {
  constructor() {
    super(`The lineage already has ${DATUM_LIMITS.versionsPerLineage} versions.`);
    this.name = "LineageCapReached";
  }
}

/** What run.ts's loop expects `revise` to answer. */
export type ReviseResult = Awaited<ReturnType<TurnDeps["revise"]>>;

/** The parent study, as getProject returns it, as far as the re-run reads it. */
export type ParentStudy = { id: string; rootProjectId: string | null; requestPayload: unknown };

/** What generate returns, as far as the re-run reads it before the parse. */
export type EngineReport = { coverageWarning?: { message: string } | null | undefined };

/** What createRevision (lib/study-revisions.ts) takes: the new version's inputs, and its log row. */
export type CreateRevisionArgs = {
  /** The version the fix was asked on. */
  parentId: string;
  firmId: string;
  /** The engineer who asked: the new version's user and the log's requested_by. */
  userId: string;
  /** The request the engine ran, and the parsed result it gave. */
  request: unknown;
  result: unknown;
  changes: DatumChange[];
  reason: string;
  /** Where the engineer's numbers came from; null when they gave none (the change card says so). */
  sourceLabel: string | null;
  messageId: string | null;
  findingId: string | null;
  clauseId: string | null;
};

export type ReviseDeps<Firm extends { id: string }, Report extends EngineReport> = {
  /** getProject(firmId, id): the parent within the firm, or null. */
  getParent: (firmId: string, parentId: string) => Promise<ParentStudy | null>;
  /** firmMayRunUncharged: may this firm still run studies (read-only; nothing is charged). */
  firmGate: (firm: Firm, email: string | null | undefined) => { ok: true } | { ok: false; reason: string };
  /** The ids of the users with a re-run going. Shared across requests by the caller. */
  inFlight: Set<string>;
  /** The versions in the lineage whose first version is `rootId`, the original included. */
  countLineage: (firmId: string, rootId: string) => Promise<number>;
  /** generateTisReport, given the merge's request: the parse of GenerateTisBody, as the generate route runs it. */
  generate: (request: TisRequestLike) => Promise<Report>;
  /** GenerateTisResponse.parse: what is saved as the result, exactly as the generate route saves it. */
  parseResult: (report: Report) => unknown;
  /** The insert-only save of the new version and its log row. */
  createRevision: (args: CreateRevisionArgs) => Promise<{ projectId: string; version: number; revisionId: string }>;
  /** Queue the new version's proofread. Not awaited. */
  enqueueProofread: (args: { projectId: string; firmId: string; userId: string }) => Promise<void>;
  /** Where a failure's cause goes. Optional; a log that throws is ignored. */
  log?: (err: unknown, ctx: Record<string, unknown>) => void;
};

export type ReviseArgs<Firm extends { id: string }> = {
  firm: Firm;
  user: { id: string; email?: string | null };
  parentId: string;
  /** Already parsed with RerunToolInput (run.ts does that before it calls revise). */
  input: RerunToolInput;
  /** The engineer's message that asked for the re-run. */
  messageId: string | null;
  /**
   * The finding the re-run answers, and its clause, as the CALLER resolved them
   * against the findings this engineer may see. `input.findingId` is the
   * model's word and is never written: a uuid it made up would point the log
   * at a finding that is not there, or at another firm's.
   */
  findingId?: string;
  clauseId?: string;
};

// The words the engineer is told (through the model). None names a field or carries a cause.
const GATE_REFUSED =
  "Your firm has no studies left this billing period, so re-runs are paused. Nothing was re-run. Upgrade or add credits in Settings → Billing, then ask again.";
const IN_FLIGHT = "A re-run is already going for your account. Nothing new was started; wait for it to finish, then ask again.";
const AT_CAP = `This study has ${DATUM_LIMITS.versionsPerLineage} versions, the most one study can have. Nothing was re-run; start a new study in the generator to keep revising it.`;
const PARENT_GONE = "This study was not found, so nothing was re-run.";
const FAILED = "The re-run failed, so there is no new version to open. The original study is unchanged. Tell the engineer, and that they can try again.";

export async function reviseStudy<Firm extends { id: string }, Report extends EngineReport>(
  deps: ReviseDeps<Firm, Report>,
  args: ReviseArgs<Firm>,
): Promise<ReviseResult> {
  /** What the log is told, filled in as far as `args` can be read. */
  let ctx: Record<string, unknown> = {};
  const report = (err: unknown, extra: Record<string, unknown> = {}): void => {
    try {
      deps.log?.(err, { ...ctx, ...extra });
    } catch {
      // A log that fails must not turn an answer into a throw.
    }
  };

  /** The in-flight key this call added, and so must remove. */
  let held: string | null = null;
  try {
    // Optional chaining only, so building the context cannot throw; the destructuring below can, inside the try.
    ctx = { firmId: args?.firm?.id, userId: args?.user?.id, parentId: args?.parentId };
    const { firm, user, parentId, input } = args;
    const gate = deps.firmGate(firm, user.email);
    if (!gate.ok) return { ok: false, error: GATE_REFUSED };

    if (deps.inFlight.has(user.id)) return { ok: false, error: IN_FLIGHT };
    deps.inFlight.add(user.id);
    held = user.id;

    const parent = await deps.getParent(firm.id, parentId);
    if (parent === null) return { ok: false, error: PARENT_GONE };

    // The original is its own root; a later version names its root.
    const rootId = parent.rootProjectId ?? parent.id;
    if ((await deps.countLineage(firm.id, rootId)) >= DATUM_LIMITS.versionsPerLineage) return { ok: false, error: AT_CAP };

    const merged = applyRevisionChanges(parent.requestPayload, input);
    if (!merged.ok) return { ok: false, error: merged.error };

    // runSensitivity is a locked field, so the merge carries the parent's value: kept as the parent had it, where
    // /whatif forces it off. The parse is what the generator takes, so this is the request it runs and the one saved.
    const request = merged.request;
    const engine = await deps.generate(request);
    if (engine.coverageWarning) return { ok: false, error: engine.coverageWarning.message };

    const result = deps.parseResult(engine);
    const sourceLabel = typeof input.sourceLabel === "string" && input.sourceLabel.trim() !== "" ? input.sourceLabel.trim() : null;
    const saved = await deps.createRevision({
      parentId,
      firmId: firm.id,
      userId: user.id,
      request,
      result,
      changes: merged.changes,
      reason: input.reason,
      sourceLabel,
      messageId: args.messageId,
      findingId: args.findingId ?? null,
      clauseId: args.clauseId ?? null,
    });

    // The new version is proofread the way a generated study is: queued now, and not waited on. Once the version
    // is saved nothing here can fail the re-run, so a queue failure is logged and the answer is still ok.
    const queued = { projectId: saved.projectId, firmId: firm.id, userId: user.id };
    try {
      void Promise.resolve(deps.enqueueProofread(queued)).catch((err: unknown) => report(err, { projectId: saved.projectId, step: "enqueueProofread" }));
    } catch (err) {
      report(err, { projectId: saved.projectId, step: "enqueueProofread" });
    }

    return { ok: true, projectId: saved.projectId, version: saved.version, changes: merged.changes };
  } catch (err) {
    // Another save took the last version while the engine ran: the cap, not a failure.
    if (err instanceof LineageCapReached) return { ok: false, error: AT_CAP };
    report(err);
    return { ok: false, error: FAILED };
  } finally {
    if (held !== null) deps.inFlight.delete(held);
  }
}
