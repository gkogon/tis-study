/**
 * Client for a study's proofread run (`/tis-api/projects/:id/proofread`) — an
 * internal consistency and traceability check over the saved study. Read-only
 * plus two writes that record a decision; nothing here changes a study.
 */
export type ProofreadFindingT = {
  id: string;
  clauseId: string;
  section: number;
  type: "BLOCKER" | "DEFECT" | "DISCLOSE" | "NOTE" | "UNVERIFIED" | "CONTESTED";
  title: string;
  detail: string;
  sourceLabel: string;
  readPaths: Array<{ path: string; value: string | number | boolean | null }>;
  remedy: string;
  fingerprint: string;
};

export type CoverageEntryT = {
  clauseId: string;
  section: number;
  status: "ran" | "not-run";
  reason?: string;
  /** Set when the clause ran but judged only part of the record. */
  note?: string;
};

export type DispositionT = {
  findingId: string;
  disposition: string;
  note: string | null;
  sourceLabel: string | null;
  createdAt: string;
};

export type ProofreadRun = {
  status: "none" | "queued" | "running" | "rules_ready" | "ready" | "failed";
  /** The run's uuid. The disposition route validates it, so the panel must send the real id, not the revision. */
  runId?: string;
  revision?: number;
  protocolVersion?: string;
  engineStamp?: string;
  coverage: CoverageEntryT[];
  findings: ProofreadFindingT[];
  dispositions: DispositionT[];
  /**
   * How many findings on this run the server did not send because their audience
   * is admin — a DEFECT, a software fault routed to the software team. Never
   * shown and never decided here, and each one holds the study until a re-run no
   * longer raises it, so a run with any is never read as clear. A count only:
   * nothing else about a withheld finding reaches the client.
   */
  withheld: number;
  createdAt?: string;
  finishedAt?: string | null;
};

export async function fetchProofread(projectId: string): Promise<ProofreadRun> {
  const r = await fetch(`/tis-api/projects/${encodeURIComponent(projectId)}/proofread`, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as Partial<ProofreadRun>;
  return {
    status: data.status ?? "none",
    runId: data.runId,
    revision: data.revision,
    protocolVersion: data.protocolVersion,
    engineStamp: data.engineStamp,
    // The panel filters and sorts these; a value that is not a list would take the whole project page down.
    coverage: Array.isArray(data.coverage) ? data.coverage : [],
    findings: Array.isArray(data.findings) ? data.findings : [],
    dispositions: Array.isArray(data.dispositions) ? data.dispositions : [],
    withheld: typeof data.withheld === "number" && Number.isInteger(data.withheld) && data.withheld > 0 ? data.withheld : 0,
    createdAt: data.createdAt,
    finishedAt: data.finishedAt ?? null,
  };
}

export async function requestProofread(projectId: string): Promise<void> {
  const r = await fetch(`/tis-api/projects/${encodeURIComponent(projectId)}/proofread`, {
    method: "POST",
    credentials: "include",
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
}

/** A request the server refused, with its HTTP status: the panel answers a 409 differently from any other refusal. */
export class ProofreadRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ProofreadRequestError";
    this.status = status;
  }
}

export async function recordDisposition(
  projectId: string,
  runId: string,
  findingId: string,
  body: { disposition: string; note?: string; sourceLabel?: string },
): Promise<void> {
  const r = await fetch(
    `/tis-api/projects/${encodeURIComponent(projectId)}/proofread/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}/dispositions`,
    { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!r.ok) {
    const message = ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`;
    throw new ProofreadRequestError(message, r.status);
  }
}

/**
 * Whether a refused decision was refused because the run it was made on is no
 * longer the project's newest finished run — the check was run again after the
 * page loaded. The route answers that with a 409 and records nothing; the panel
 * then shows the newest run and says why (SUPERSEDED_NOTICE).
 */
export function isSuperseded(e: unknown): boolean {
  return e instanceof ProofreadRequestError && e.status === 409;
}

/** What the panel says after a 409, above the newest run it has fetched in its place. */
export const SUPERSEDED_NOTICE =
  "This check was run again after this page loaded, so that decision was not recorded. The latest run is shown.";

/** A run the runner has not finished writing: findings may already be stored, but dispositions have not been carried forward. */
export function isPending(status: string): boolean {
  return status === "queued" || status === "running";
}

/**
 * A run whose result may be shown. Not the same as "not pending": a run that
 * failed after the runner wrote its findings but before it carried the
 * previous revision's dispositions forward holds findings with the carry
 * missing, and nothing will ever finish it. `rules_ready` is where phase 1
 * ends; `ready` is the status a later phase adds after its own pass.
 */
export function isFinished(status: string): boolean {
  return status === "rules_ready" || status === "ready";
}

/**
 * The order the panel shows findings in: what holds the study first, then what
 * the deliverable has to say, then what is only worth knowing, and what could
 * not be verified last. Rank 0 is also where a type this client does not know
 * lands — an unclassified finding is not buried. Ties keep the order the
 * server sent (the sort is stable).
 */
const SEVERITY_RANK: Record<string, number> = { BLOCKER: 0, CONTESTED: 0, DEFECT: 0, DISCLOSE: 1, NOTE: 2, UNVERIFIED: 3 };
const rankOf = (type: string): number => SEVERITY_RANK[type] ?? 0;

export function orderFindings(findings: ProofreadFindingT[]): ProofreadFindingT[] {
  return [...findings].sort((a, b) => rankOf(a.type) - rankOf(b.type));
}

/** What the server records. */
export type Disposition = "FIXED" | "DISCLOSED" | "WITHDRAWN" | "BUG_FILED" | "ACCEPTED_RISK" | "CONTESTED_PE";

/**
 * What an engineer can record in phase 1. BUG_FILED is a DEFECT's decision and a
 * DEFECT is admin-audience, filtered out before it reaches the panel; ACCEPTED_RISK
 * and CONTESTED_PE belong to the sealing engineer, a role that does not exist yet
 * (the server refuses both). The type keeps all three out of the table below.
 */
export type EngineerDisposition = Exclude<Disposition, "BUG_FILED" | "ACCEPTED_RISK" | "CONTESTED_PE">;

/**
 * The single statement of which decisions a finding may be given, and so of
 * which decisions close it. What the card offers and what the header counts as
 * closed are both read from here (`offeredFor`, `closes`), so they cannot drift:
 * a decision is offered on a type if and only if it resolves that type.
 *
 * TIS-PROOFREAD-PROTOCOL.md, Logging: a BLOCKER is a wrong number, a wrong source
 * or a missing input, and disclosing a wrong number does not make it right, so
 * only FIXED (the study changed) or WITHDRAWN (on a named source) closes one.
 * A CONTESTED item blocks completion until the sealing engineer rules, so in
 * phase 1 nothing closes it. A DISCLOSE is closed by the language it asks for.
 *
 * The server holds the same table (OFFERED_DISPOSITIONS in
 * lib/tis-api-zod/src/proofread.ts) and refuses any other pair with a 422; this
 * copy exists because the panel does not depend on that package, and
 * verify-proofread-copy.mjs pins the two equal.
 */
export const OFFERED: Record<ProofreadFindingT["type"], EngineerDisposition[]> = {
  BLOCKER: ["FIXED", "WITHDRAWN"],
  DISCLOSE: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  NOTE: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  UNVERIFIED: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  CONTESTED: [],
  DEFECT: [],
};

/**
 * What a finding is offered. A type this client does not know gets the strictest
 * set (a BLOCKER's): it is neither left with no way to be resolved nor offered
 * the loose resolutions that would let it read as closed on a disclosure.
 */
export function offeredFor(type: string): EngineerDisposition[] {
  return (OFFERED as Record<string, EngineerDisposition[] | undefined>)[type] ?? OFFERED.BLOCKER;
}

/** Whether recording `disposition` on a finding of this type resolves it. */
export function closes(type: string, disposition: string | null | undefined): boolean {
  return !!disposition && (offeredFor(type) as string[]).includes(disposition);
}

/** The newest decision recorded on a finding, by time, not by position in the list. */
export function latestDisposition(dispositions: DispositionT[], findingId: string): DispositionT | undefined {
  let latest: DispositionT | undefined;
  let at = -Infinity;
  for (const d of dispositions) {
    if (d.findingId !== findingId) continue;
    const t = Date.parse(d.createdAt);
    if (latest === undefined || (Number.isFinite(t) ? t : -Infinity) > at) {
      latest = d;
      at = Number.isFinite(t) ? t : -Infinity;
    }
  }
  return latest;
}

/**
 * The run as it stands once the server has accepted a decision, ahead of the
 * refetch that will replace it with the server's own record. The panel shows
 * this at once because `busy` is released before that refetch lands: until
 * then the old card would still offer the decision just recorded, and a second
 * press would append a duplicate to a log that cannot be edited.
 *
 * Only for `runId`: a decision recorded on another run (the project changed, or
 * a newer revision took over mid-flight) is not this run's business, and the
 * run comes back as it was. So does every run when `runId` is empty: a decision
 * with no run is no run's, not even that of a run that has no id either (a
 * project never checked). The record is stamped `now`, so as the newest it is
 * the one `latestDisposition` returns.
 */
export function withRecordedDecision(
  run: ProofreadRun,
  runId: string,
  finding: ProofreadFindingT,
  body: { disposition: string; sourceLabel?: string },
  now: Date,
): ProofreadRun {
  if (!runId || run.runId !== runId) return run;
  const recorded: DispositionT = {
    findingId: finding.id,
    disposition: body.disposition,
    note: null,
    sourceLabel: body.sourceLabel ?? null,
    createdAt: now.toISOString(),
  };
  return { ...run, dispositions: [recorded, ...run.dispositions] };
}

export type OpenSummary = {
  /** Every finding on the run, the withheld ones included. */
  total: number;
  /** Findings no recorded decision has resolved: none recorded, or one that does not close that type. */
  open: number;
  /**
   * Open BLOCKER, DEFECT and CONTESTED — the three the protocol's completion gate
   * turns on — including every withheld finding: a DEFECT is never shown to the
   * engineer and never decided by one, and holds until a re-run no longer raises it.
   */
  holds: number;
  /** Of `holds`, how many the server withheld (routed to the software team). */
  withheld: number;
  disclose: number;
  note: number;
  unverified: number;
};

/**
 * Counts the findings still open, by how much they weigh. Open means the latest
 * decision does not close that type. `withheld` findings (see ProofreadRun) are
 * open holds: nothing an engineer records reaches them.
 */
export function summarizeOpen(findings: ProofreadFindingT[], dispositions: DispositionT[], withheld = 0): OpenSummary {
  const w = Number.isInteger(withheld) && withheld > 0 ? withheld : 0;
  const s: OpenSummary = { total: findings.length + w, open: w, holds: w, withheld: w, disclose: 0, note: 0, unverified: 0 };
  for (const f of findings) {
    if (closes(f.type, latestDisposition(dispositions, f.id)?.disposition)) continue;
    s.open++;
    if (rankOf(f.type) === 0) s.holds++;
    else if (f.type === "DISCLOSE") s.disclose++;
    else if (f.type === "NOTE") s.note++;
    else s.unverified++;
  }
  return s;
}

/**
 * The line for findings the server withheld: a DEFECT is routed to the software
 * team, the engineer cannot rule on it, and it holds the study until a re-run no
 * longer raises it. The count and that instruction are all there is to say —
 * nothing else about a withheld finding reaches the client.
 */
export function withheldLine(n: number): string {
  return n === 1
    ? "1 item on this study was routed to the software team. Hold the study until a re-run no longer raises it."
    : `${n} items on this study were routed to the software team. Hold the study until a re-run no longer raises them.`;
}

/**
 * The request body for recording a decision, or null when there is nothing to
 * record. The route refuses an empty `sourceLabel` on anything but WITHDRAWN,
 * so the other decisions carry no `sourceLabel` key at all, and WITHDRAWN —
 * which must name the source it was withdrawn on — records nothing when the
 * person cancels or leaves the answer blank.
 */
export function dispositionBody(
  disposition: string,
  askSource: () => string | null | undefined,
): { disposition: string; sourceLabel?: string } | null {
  if (disposition !== "WITHDRAWN") return { disposition };
  const sourceLabel = (askSource() ?? "").trim();
  return sourceLabel ? { disposition, sourceLabel } : null;
}
