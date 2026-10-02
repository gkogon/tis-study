/**
 * Finding identity and engine identity.
 *
 * A fingerprint is the key a triage disposition carries forward across a
 * re-run: same clause, same section, same values read → same finding, so a
 * WITHDRAWN item never silently reopens and an ACCEPTED RISK keeps its named
 * person. An engine stamp says which engine produced the study the finding is
 * about — nothing in the payload records that (the only version-ish field is
 * generatedAt), which is why the same Wake request produced v/c 2.61-3.93
 * before #227 and 0.71-1.87 after.
 */
import {
  hash32,
  APPROACH_CAPACITY_VPH,
  CYCLE_LEN,
  DESIGN_YEAR_HORIZON_DEFAULT,
  G_OVER_C,
  LAND_USES,
  PLAUSIBLE_MAX_INTERSECTION_VC,
  SATURATION_FLOW_VPH,
  SCREENING_MAX_DELAY_SEC,
} from "@workspace/tis-engine-core";
import type { ProofreadFinding } from "./types.ts";

const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");

export function findingFingerprint(f: ProofreadFinding): string {
  const canon = [
    f.clauseId,
    String(f.section),
    ...f.readPaths.map((p) => `${p.path}=${String(p.value)}`).sort(),
  ].join("|");
  return hex(hash32(canon));
}

/** Rule-relevant engine constants, plus the deploy's commit when the platform provides one. */
export function engineStamp(): string {
  const constants = JSON.stringify({
    PLAUSIBLE_MAX_INTERSECTION_VC,
    SCREENING_MAX_DELAY_SEC,
    CYCLE_LEN,
    G_OVER_C,
    SATURATION_FLOW_VPH,
    APPROACH_CAPACITY_VPH,
    DESIGN_YEAR_HORIZON_DEFAULT,
    landUseCount: LAND_USES.length,
  });
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? "";
  return sha ? `${hex(hash32(constants))}-${sha.slice(0, 7)}` : hex(hash32(constants));
}

/**
 * Which rule set produced a finding. Recorded on every run; bump it whenever the clause set or what a clause
 * judges changes materially, so a stored finding can be told apart from one the current rules would produce.
 * "2": the twelve-clause set (§1, §2, §4, §5, §6); "1" was the three v/c clauses alone.
 */
export const RULES_VERSION = "2";
