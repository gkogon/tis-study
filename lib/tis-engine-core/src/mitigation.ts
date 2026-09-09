// Screening mitigation verdict — moved VERBATIM out of artifacts/tis-api-server/
// src/lib/tis.ts so the browser scenario solver can call the engine's own
// verdict rules. Pure: thresholds + text, no region lookup, no logger.
import type { Los } from "./signal-delay.ts";
import type { AffectedIntersection } from "./row-math.ts";

/** Screening mitigation thresholds, in seconds of delay increase.
 *
 *  These are SCREENING DEFAULTS WITH NO AGENCY ATTRIBUTION. No jurisdiction is
 *  resolved anywhere in this call path, so nothing here may be represented as
 *  a named agency's criterion — the previous wording named a governing city
 *  that is never determined anywhere in this call path. A governing agency's
 *  own TIS criteria supersede these, and typically add two tests this screen
 *  does NOT run: a v/c criterion, and a separate clause for approaches already
 *  failing in the no-build. */
export const SCREENING_DELAY_DELTA_MINOR_SEC = 5;
export const SCREENING_DELAY_DELTA_MODERATE_SEC = 15;

/** One analysis horizon put to the mitigation test. */
export type MitigationHorizon = { label: string; delta: number; los: Los | undefined };

const MITIGATION_RANK = { none: 0, minor: 1, moderate: 2, major: 3 } as const;

export function verdictForHorizon(
  delayDelta: number, futureLos: Los | undefined,
): { text: string; severity: AffectedIntersection["mitigationSeverity"] } {
  if (futureLos === "F") {
    return {
      text: "Major: add a dedicated turn lane on the critical approach AND retime the signal; reconsider site driveway alignment or development scale if delay remains above 80s.",
      severity: "major",
    };
  }
  if (futureLos === "E" || delayDelta >= SCREENING_DELAY_DELTA_MODERATE_SEC) {
    return {
      text: "Moderate: extend critical-phase green time and consider a protected-only left-turn phase to absorb the new demand without queue spillback.",
      severity: "moderate",
    };
  }
  if (delayDelta >= SCREENING_DELAY_DELTA_MINOR_SEC || (futureLos === "D" && delayDelta > 0)) {
    return {
      text: "Minor: signal-timing optimization (shift 3–5s of green to the critical phase) is sufficient. No geometric change required.",
      severity: "minor",
    };
  }
  return { text: "", severity: "none" };
}

/** Mitigation verdict across EVERY analyzed horizon.
 *
 *  Screening the opening year alone leaves the design year untested, and the
 *  design year usually carries the LARGER delta because two decades of
 *  background growth sit underneath it. A verdict that silently covers one
 *  horizon reads as covering the study. */
export function recommendMitigation(
  horizons: MitigationHorizon[],
): { text: string; severity: AffectedIntersection["mitigationSeverity"] } {
  let worst: { text: string; severity: AffectedIntersection["mitigationSeverity"]; label: string } = {
    text: "", severity: "none", label: horizons[0]?.label ?? "opening year",
  };
  for (const h of horizons) {
    const v = verdictForHorizon(h.delta, h.los);
    if (MITIGATION_RANK[v.severity] > MITIGATION_RANK[worst.severity]) worst = { ...v, label: h.label };
  }
  const screened = horizons
    .map((h) => `${h.label} ${h.delta >= 0 ? "+" : ""}${h.delta.toFixed(1)}s`)
    .join(", ");
  if (worst.severity === "none") {
    return {
      text: `No mitigation indicated at screening level (${screened}). The largest projected delay change is below the ${SCREENING_DELAY_DELTA_MINOR_SEC}-second screening threshold — a screening default, not an agency criterion: no jurisdiction was resolved for this site. The governing agency's TIS criteria supersede this, and typically add a v/c test and a separate clause for approaches already failing in the no-build; neither is screened here.`,
      severity: "none",
    };
  }
  return { text: `${worst.text} Governing horizon: ${worst.label} (${screened}).`, severity: worst.severity };
}
