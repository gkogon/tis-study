/**
 * Finding identity and engine identity.
 *
 * A fingerprint is the key a triage disposition carries forward across a
 * re-run: same clause, same section, same values read → same finding, so a
 * WITHDRAWN item never silently reopens and an ACCEPTED RISK keeps its named
 * person. Whether a carry happens at all is gated on RULES_VERSION (below),
 * never on the engine stamp.
 *
 * The engine stamp is attribution: it records which deploy RAN the check — the
 * rule-relevant engine constants, plus the deploy's commit when the platform
 * provides one — stamped on the run, with RULES_VERSION and the protocol
 * version, when its clauses run (not when it is queued: the deploy that queues
 * a run is not always the one that runs it). It does not say which engine
 * produced the study: a re-run of an old study is stamped with today's deploy.
 * Nothing in the payload records the producing engine (the only version-ish
 * field is generatedAt), which is why the same Wake request produced v/c
 * 2.61-3.93 before #227 and 0.71-1.87 after with nothing naming either engine.
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

/**
 * Rule-relevant engine constants, plus the deploy's commit when the platform provides one: which deploy ran the
 * check, recorded on the run as attribution. Not a carry gate — it changes on every deploy, while the study row it
 * judges never changes.
 */
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
 * Which rule set produced a finding. Stamped on every run when its clauses run; bump it whenever the clause set or
 * what a clause judges changes materially, so a stored finding can be told apart from one the current rules would
 * produce.
 * "2": the twelve-clause set (§1, §2, §4, §5, §6); "1" was the three v/c clauses alone.
 */
export const RULES_VERSION = "2";
