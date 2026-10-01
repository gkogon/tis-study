/**
 * The proofread clause registry and runner.
 *
 * Pure: no db, no logger, no fetch, so scripts/verify-proofread.mjs imports it
 * under plain node. Persistence lives in ../proofread-store.ts.
 */
import type { Clause, ClauseRunResult, CoverageEntry, ProofreadFinding, StudyRecord } from "./types.ts";
import { growthMultiplierReproduces, growthOverrideDisclosed } from "./s1-inputs.ts";
import { passByBasisNamed, rateReproducesTotal } from "./s2-trip-gen.ts";
import {
  losMatchesDelay,
  screeningClampDisclosed,
  vcPlausibilityApproach,
  vcPlausibilityDesignYear,
  vcPlausibilityIntersection,
} from "./s4-results.ts";
import { criteriaNamed } from "./s5-criteria.ts";
import { periodScopeDisclosed, scopeNoteConsistent } from "./s6-limitations.ts";

export * from "./types.ts";
export { findingFingerprint, engineStamp, RULES_VERSION } from "./fingerprint.ts";

export const ALL_CLAUSES: Clause[] = [
  growthOverrideDisclosed,
  growthMultiplierReproduces,
  rateReproducesTotal,
  passByBasisNamed,
  vcPlausibilityIntersection,
  vcPlausibilityApproach,
  vcPlausibilityDesignYear,
  losMatchesDelay,
  screeningClampDisclosed,
  criteriaNamed,
  periodScopeDisclosed,
  scopeNoteConsistent,
];

export function runClauses(rec: StudyRecord, clauses: Clause[] = ALL_CLAUSES): ClauseRunResult {
  const findings: ProofreadFinding[] = [];
  const coverage: CoverageEntry[] = [];
  for (const c of clauses) {
    let outcome;
    try {
      outcome = c.run(rec);
    } catch (err) {
      // A clause that throws is coverage we did not get, never a finding.
      outcome = { status: "not-run" as const, reason: `clause threw: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (outcome.status === "ran") {
      findings.push(...outcome.findings);
      coverage.push({ clauseId: c.id, section: c.section, status: "ran", ...(outcome.note ? { note: outcome.note } : {}) });
    } else {
      coverage.push({ clauseId: c.id, section: c.section, status: "not-run", reason: outcome.reason });
    }
  }
  return { findings, coverage };
}
