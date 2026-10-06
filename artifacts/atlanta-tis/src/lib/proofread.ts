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
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
}

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

export type OpenSummary = {
  /** Every finding on the run. */
  total: number;
  /** Findings with no recorded decision. */
  open: number;
  /** Open BLOCKER, CONTESTED and DEFECT — the ones the protocol's completion gate turns on. */
  holds: number;
  disclose: number;
  note: number;
  unverified: number;
};

/** Counts the findings that still have no recorded decision, by how much they weigh. */
export function summarizeOpen(findings: ProofreadFindingT[], dispositions: DispositionT[]): OpenSummary {
  const decided = new Set(dispositions.map((d) => d.findingId));
  const s: OpenSummary = { total: findings.length, open: 0, holds: 0, disclose: 0, note: 0, unverified: 0 };
  for (const f of findings) {
    if (decided.has(f.id)) continue;
    s.open++;
    if (rankOf(f.type) === 0) s.holds++;
    else if (f.type === "DISCLOSE") s.disclose++;
    else if (f.type === "NOTE") s.note++;
    else s.unverified++;
  }
  return s;
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
