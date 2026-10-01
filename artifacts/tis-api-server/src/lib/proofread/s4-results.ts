/**
 * §4 Results — the plausibility ceiling, in the three places it can be breached.
 *
 * implausibleVolumeDisclosures (lib/tis-engine-core/src/volume-plausibility.ts)
 * judges INTERSECTION rows only, and its Math.max drops a row whose currentVc
 * is absent (Math.max(undefined, 8.68) is NaN) — so a legacy record reports
 * clean at any v/c. These clauses normalize at the boundary and add the two
 * scopes the guard never covered: per-approach and design-year.
 */
import { PLAUSIBLE_MAX_INTERSECTION_VC } from "@workspace/tis-engine-core";
import type { Clause, ProofreadFinding, ReadPath, StudyRecord } from "./types.ts";
import { rowBuckets } from "./types.ts";

const SOURCE = "lib/tis-engine-core/src/signal-delay.ts — PLAUSIBLE_MAX_INTERSECTION_VC = 2.5";
const REMEDY =
  "Obtain measured turning-movement counts for these locations and analyze them with observed lane geometry and signal timing (HCS/Synchro) rather than the screening capacity used here.";
const CEIL = PLAUSIBLE_MAX_INTERSECTION_VC;

/** Highest no-project v/c on a row, tolerating either scenario field being absent. */
const noProjectVc = (r: any): number => Math.max(Number(r?.currentVc ?? 0), Number(r?.existingVc ?? 0));

type Offender = { label: string; vc: number; path: string };

/**
 * `basis` says which scenarios were judged, because the sentence is read by an
 * engineer: the intersection and approach clauses judge only the no-project
 * scenarios, but the design-year clause also judges the Build scenario, and
 * calling a Build v/c "no-project" would be the proofreader misreporting.
 */
function finding(
  clauseId: string,
  title: string,
  scope: string,
  basis: string,
  offenders: Offender[],
  total: number,
): ProofreadFinding {
  const named = offenders.slice(0, 5).map((o) => `${o.label} (v/c ${o.vc.toFixed(2)})`).join("; ");
  const more = offenders.length > 5 ? `, and ${offenders.length - 5} more` : "";
  const readPaths: ReadPath[] = offenders.map((o) => ({ path: o.path, value: o.vc }));
  return {
    clauseId,
    section: 4,
    type: "BLOCKER",
    title,
    detail:
      `${offenders.length} of ${total} ${scope} report ${basis} above ${CEIL.toFixed(1)}, ` +
      `which no at-grade signalized location can operate at: ${named}${more}. ` +
      `Either the background volume is a limited-access count matched to a surface street, or the volume is a ` +
      `legitimately high arterial volume the screening capacity understates. The delay, LOS and queue values ` +
      `reported here are not defensible under either cause.`,
    sourceLabel: SOURCE,
    readPaths,
    remedy: REMEDY,
    audience: "engineer",
  };
}

export const vcPlausibilityIntersection: Clause = {
  id: "vcPlausibilityIntersection",
  section: 4,
  title: "Intersection no-project v/c within the plausibility ceiling",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    if (buckets.length === 0) return { status: "not-run", reason: "no affectedIntersections on the record" };
    const offenders: Offender[] = [];
    let total = 0;
    for (const b of buckets) {
      b.rows.forEach((r: any, i: number) => {
        total++;
        const vc = noProjectVc(r);
        if (Number.isFinite(vc) && vc > CEIL) {
          offenders.push({ label: `${r.name} [${b.period}]`, vc, path: `result.${b.period}.affectedIntersections[${i}]` });
        }
      });
    }
    if (offenders.length === 0) return { status: "ran", findings: [] };
    offenders.sort((a, b) => b.vc - a.vc);
    return {
      status: "ran",
      findings: [
        finding("vcPlausibilityIntersection", "Implausible background volume at study intersections", "study intersections", "a no-project v/c", offenders, total),
      ],
    };
  },
};

export const vcPlausibilityApproach: Clause = {
  id: "vcPlausibilityApproach",
  section: 4,
  title: "Approach no-project v/c within the plausibility ceiling",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    const withApproaches = buckets.filter((b) => b.rows.some((r: any) => Array.isArray(r?.approaches) && r.approaches.length > 0));
    if (withApproaches.length === 0) return { status: "not-run", reason: "no approach detail on the record" };
    const offenders: Offender[] = [];
    let total = 0;
    for (const b of withApproaches) {
      b.rows.forEach((r: any, i: number) => {
        (r.approaches ?? []).forEach((a: any, j: number) => {
          total++;
          const vc = noProjectVc(a);
          if (Number.isFinite(vc) && vc > CEIL) {
            offenders.push({
              label: `${r.name} ${a.direction} [${b.period}]`,
              vc,
              path: `result.${b.period}.affectedIntersections[${i}].approaches[${j}]`,
            });
          }
        });
      });
    }
    if (offenders.length === 0) return { status: "ran", findings: [] };
    offenders.sort((a, b) => b.vc - a.vc);
    return {
      status: "ran",
      findings: [
        finding("vcPlausibilityApproach", "Implausible background volume on study approaches", "study approaches", "a no-project v/c", offenders, total),
      ],
    };
  },
};

export const vcPlausibilityDesignYear: Clause = {
  id: "vcPlausibilityDesignYear",
  section: 4,
  title: "Design-year v/c within the plausibility ceiling",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    const hasDesign = buckets.some((b) => b.rows.some((r: any) => r?.designNoBuildVc !== undefined || r?.designBuildVc !== undefined));
    if (!hasDesign) return { status: "not-run", reason: "record carries no design-year scenario" };
    const offenders: Offender[] = [];
    let total = 0;
    for (const b of buckets) {
      b.rows.forEach((r: any, i: number) => {
        for (const field of ["designNoBuildVc", "designBuildVc"] as const) {
          const vc = Number(r?.[field]);
          if (!Number.isFinite(vc)) continue;
          total++;
          if (vc > CEIL) {
            offenders.push({
              label: `${r.name} ${field === "designBuildVc" ? "Design Build" : "Design No-Build"} [${b.period}]`,
              vc,
              path: `result.${b.period}.affectedIntersections[${i}].${field}`,
            });
          }
        }
      });
    }
    if (offenders.length === 0) return { status: "ran", findings: [] };
    offenders.sort((a, b) => b.vc - a.vc);
    return {
      status: "ran",
      findings: [
        finding("vcPlausibilityDesignYear", "Implausible design-year volume", "design-year scenarios", "a v/c", offenders, total),
      ],
    };
  },
};
