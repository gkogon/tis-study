/**
 * Proofread clause contract.
 *
 * A clause reads a SAVED study record and returns either findings or a declared
 * reason it could not run. Two properties are load-bearing and encoded in the
 * types rather than asked for in prose:
 *
 *   - `sourceLabel` and `readPaths` are non-optional, because a finding with no
 *     named source is an opinion, not a finding (TIS-PROOFREAD-PROTOCOL.md).
 *   - there is no patch, replacement value, or write path anywhere in the
 *     result. Datum advises; it never executes.
 *
 * Relative imports in this directory carry an explicit .ts extension so
 * scripts/verify-proofread.mjs can import the module under plain node.
 */
import type { TisReport, TisRequest } from "@workspace/tis-api-zod";

export type ProofreadSection = 1 | 2 | 3 | 4 | 5 | 6;

/** The protocol's taxonomy. A clause may emit any of these; the phase-2 model call may not emit BLOCKER or DEFECT. */
export type ProofreadType = "BLOCKER" | "DEFECT" | "DISCLOSE" | "NOTE" | "UNVERIFIED" | "CONTESTED";

export type ProofreadAudience = "engineer" | "pe" | "admin";

/** A payload path the clause actually read, with the value it saw. */
export type ReadPath = { path: string; value: string | number | boolean | null };

export type ProofreadFinding = {
  clauseId: string;
  section: ProofreadSection;
  type: ProofreadType;
  title: string;
  detail: string;
  sourceLabel: string;
  readPaths: ReadPath[];
  /** Prose advice for a person. Never machine-applicable. */
  remedy: string;
  audience: ProofreadAudience;
};

export type StudyRecord = {
  request: Partial<TisRequest> & Record<string, unknown>;
  result: Partial<TisReport> & Record<string, unknown>;
};

export type ClauseOutcome =
  | { status: "ran"; findings: ProofreadFinding[] }
  /** The clause did not run because a declared input was absent. NOT a finding, and never rendered as coverage. */
  | { status: "not-run"; reason: string };

export type Clause = {
  id: string;
  section: ProofreadSection;
  title: string;
  run: (rec: StudyRecord) => ClauseOutcome;
};

export type CoverageEntry = {
  clauseId: string;
  section: ProofreadSection;
  status: "ran" | "not-run";
  reason?: string;
};

export type ClauseRunResult = { findings: ProofreadFinding[]; coverage: CoverageEntry[] };

/**
 * Every scenario/period bucket of rows a record carries. Rows live in two
 * places: `result.affectedIntersections` (the PM anchor) and one array per
 * analysis period in `result.periodReports[].affectedIntersections`.
 *
 * The engine writes the PM report's rows to BOTH (tis.ts: the top-level block is
 * `pmReport.affectedIntersections`, and `pmReport` is the `periodReports` entry
 * whose period is pm_peak). Returning both would count every PM row twice — each
 * offender listed twice in a finding, the "N of M" denominator inflated. So the
 * top-level array is only a bucket of its own when no pm_peak period report
 * carries those rows: PM excluded from `analysisPeriods`, where the engine
 * synthesizes the top-level block, or a record that predates `periodReports`.
 */
export function rowBuckets(rec: StudyRecord): Array<{ period: string; rows: any[] }> {
  const out: Array<{ period: string; rows: any[] }> = [];
  const periods = rec.result.periodReports;
  const reports: any[] = Array.isArray(periods) ? (periods as any[]) : [];
  const pmReported = reports.some((p) => p?.period === "pm_peak" && Array.isArray(p?.affectedIntersections));
  const top = rec.result.affectedIntersections;
  if (Array.isArray(top) && !pmReported) out.push({ period: "pm_peak", rows: top });
  for (const p of reports) {
    if (Array.isArray(p?.affectedIntersections)) out.push({ period: String(p.period ?? "unknown"), rows: p.affectedIntersections });
  }
  return out;
}
