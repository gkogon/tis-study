/**
 * Render-time plausibility guard on a study's BACKGROUND volumes.
 *
 * The engine will turn any volume into a delay and an LOS letter. It has no
 * way to notice that the volume it was handed cannot belong to a signalized
 * intersection — which is how tacoma_metro produced a 37-page deliverable in
 * which seven of thirteen study intersections printed v/c 8.15–8.55 and
 * 4,300–5,400 ft queues with nothing in the document saying anything was
 * wrong. The AADT→signal join had matched I-5 mainline counts (163,000 /
 * 171,000 AADT) onto S Hosmer St and Tacoma Mall Blvd surface-street signals
 * sitting 51–158 m from the freeway.
 *
 * The join now refuses functionally incompatible records (api-server's
 * aadt-plausibility.ts). This module is the second line of defence: whatever
 * route an impossible v/c arrives by, the deliverable discloses it instead of
 * printing it as an ordinary LOS F.
 *
 * The disclosure names TWO causes, not one. After the join fix the threshold is
 * still tripped in two distinct situations, and they need different remedies:
 *   (a) a freeway count matched to a surface signal — the Tacoma failure mode,
 *       remedied by measured counts;
 *   (b) a legitimately large arterial (an in-ceiling 76,000-AADT primary, say)
 *       that the screening capacity — one critical lane per approach at a flat
 *       0.45 green ratio — understates, remedied by a calibrated HCS/Synchro
 *       analysis with observed geometry and timing.
 * Region sweep after the join fix: Tacoma is case (a); Florida statewide (7.4%
 * of signals), Miami-Dade (5.6%) and Honolulu (5.7%) are mostly case (b).
 * Asserting (a) alone would report a data defect that is not there on most
 * Florida studies.
 *
 * Dependency-free leaf (same posture as intersection-coverage.ts) so the
 * check-script can import it under plain `node` without dragging in the
 * engine's import graph.
 */
import { PLAUSIBLE_MAX_INTERSECTION_VC } from "./signal-delay";

/** The only fields this guard needs from an AffectedIntersection row. */
export type PlausibilityRow = {
  name: string;
  /** Current-year baseline v/c (existing volumes, no growth, no project). */
  currentVc: number;
  /** Opening-year no-build v/c (grown existing volumes, no project). */
  existingVc: number;
};

/**
 * Disclosure lines for any study intersection whose PRE-DEVELOPMENT volume
 * implies an impossible v/c. Empty when every volume is plausible.
 *
 * Judged on the no-project scenarios: if the existing network already implies
 * an impossible v/c, the background volume is the defect, not the project.
 *
 * Callers put these at the head of both `findings` and `methodology` — every
 * renderer already prints both, so the disclosure reaches the PDF without a
 * per-renderer change, and a reader meets it before the LOS tables.
 */
export function implausibleVolumeDisclosures(rows: PlausibilityRow[]): string[] {
  const offenders = rows
    .map((r) => ({ row: r, vc: Math.max(r.currentVc, r.existingVc) }))
    .filter((o) => Number.isFinite(o.vc) && o.vc > PLAUSIBLE_MAX_INTERSECTION_VC)
    .sort((a, b) => b.vc - a.vc);
  if (offenders.length === 0) return [];

  const named = offenders
    .slice(0, 5)
    .map((o) => `${o.row.name} (v/c ${o.vc.toFixed(2)})`)
    .join("; ");
  const more = offenders.length > 5 ? `, and ${offenders.length - 5} more` : "";
  return [
    `DATA QUALITY — NOT SUITABLE FOR SUBMITTAL AS-IS: ${offenders.length} of ${rows.length} study intersection(s) report v/c above ${PLAUSIBLE_MAX_INTERSECTION_VC.toFixed(1)}, which no at-grade signalized intersection can operate at: ${named}${more}. This indicates a screening-model limitation rather than genuine congestion, and has two possible causes at this stage: (a) the background volume is a limited-access (freeway mainline) count matched to a surface-street signal rather than a count of the street itself, or (b) the intersection carries a legitimately high arterial volume that the screening capacity assumption — one critical lane per approach at a uniform 0.45 green ratio — understates. The delay, LOS and queue values reported for these intersections are not defensible under either cause. Resolve before submittal to a review agency: obtain measured turning-movement counts for these intersections, and analyze them with observed lane geometry and signal timing (HCS/Synchro) rather than the screening capacity used here.`,
  ];
}
