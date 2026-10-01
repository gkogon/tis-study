/**
 * §6 Limitations disclosure — what the study did NOT analyze has to be said
 * out loud.
 *
 * Two clauses with no build-time ancestor. The period one enforces the
 * protocol's multifamily-AM-peak example, which nothing enforces today; the
 * scope one recomputes the inputs buildStudyScopeNote reads, honouring that
 * force-included signals come from outside the radius so analyzed may
 * legitimately exceed the in-radius count.
 *
 * Both ask "does the study say this?" of `findings` only (prose.ts), and both
 * survive the engine's own findings: "N signalized intersections fall within
 * the study area" and "…new daily vehicle trips, with N during the PM peak
 * hour" are on every study and are not disclosures.
 */
import type { Clause, ReadPath, StudyRecord } from "./types.ts";
import { numeric } from "./types.ts";
import { authoredProse, clauses } from "./prose.ts";

const DEFAULT_PERIODS = ["am_peak", "pm_peak", "saturday_midday", "daily"];

/** How a period is written in prose. The identifier itself ("am_peak") also matches. */
const LABEL: Record<string, RegExp> = {
  am_peak: /\bAM[\s_-]*peak\b|\bmorning peak\b/i,
  pm_peak: /\bPM[\s_-]*peak\b|\bevening peak\b/i,
  saturday_midday: /\bSaturday[\s_-]*(midday|peak)\b/i,
  daily: /\bdaily\b|\b24[\s-]*hour\b/i,
};
const ANY_LABEL = new RegExp(Object.values(LABEL).map((r) => r.source).join("|"), "i");
const labelFor = (period: string): RegExp => LABEL[period] ?? new RegExp(`\\b${period.replace(/[^a-z0-9]+/gi, "[\\s_-]*")}\\b`, "i");

/** Words that make a clause a statement of what was NOT done. A bare mention of a period is not one. */
const LIMITS = /\b(not|never|no|without|omit\w*|exclud\w*|unanaly[sz]ed|absent|outside)\b/i;
const ONLY = /\bonly\b/i;

/**
 * A period is disclosed when one clause of the findings names it AND says it was not covered, or when a clause
 * says "only <some period>" (which discloses every period it leaves out). The engine's first finding names
 * both "daily" and "PM peak" while saying nothing about what was omitted.
 */
function disclosed(period: string, cs: string[]): boolean {
  const label = labelFor(period);
  return cs.some((c) => (label.test(c) && LIMITS.test(c)) || (ONLY.test(c) && ANY_LABEL.test(c)));
}

export const periodScopeDisclosed: Clause = {
  id: "periodScopeDisclosed",
  section: 6,
  title: "Every requested analysis period is reported, or its absence disclosed",
  run(rec: StudyRecord) {
    // The engine runs every period when `analysisPeriods` is absent OR empty (tis.ts: `length > 0`).
    const rawAsked = rec.request.analysisPeriods as unknown;
    const strings = Array.isArray(rawAsked) ? rawAsked.filter((p): p is string => typeof p === "string") : [];
    const fromRequest = strings.length > 0;
    const asked = fromRequest ? [...new Set(strings)] : DEFAULT_PERIODS;
    const rawReports = rec.result.periodReports as unknown;
    const hasReports = Array.isArray(rawReports) && rawReports.length > 0;
    const top = rec.result.affectedIntersections as unknown;
    if (!hasReports && !Array.isArray(top)) {
      return { status: "not-run", reason: "record carries neither periodReports nor affectedIntersections, so which periods were analyzed cannot be read" };
    }
    // period -> its index in periodReports (the literal path), first occurrence.
    const reported = new Map<string, number>();
    if (hasReports) {
      (rawReports as any[]).forEach((p, k) => {
        if (typeof p?.period === "string" && !reported.has(p.period)) reported.set(p.period, k);
      });
    } else {
      // A record that predates periodReports: the only analysis it carries is the top-level PM block.
      reported.set("pm_peak", -1);
    }
    const note = hasReports ? undefined : "record carries no periodReports; judged against the top-level PM block only";
    const missing = asked.filter((p) => !reported.has(p));
    if (missing.length === 0) return { status: "ran", findings: [], note };
    const cs = clauses(rec);
    const undisclosed = missing.filter((p) => !disclosed(p, cs));
    if (undisclosed.length === 0) return { status: "ran", findings: [], note };
    const readPaths: ReadPath[] = [];
    if (fromRequest) for (const p of undisclosed) readPaths.push({ path: `request.analysisPeriods[${(rawAsked as unknown[]).indexOf(p)}]`, value: p });
    if (hasReports) {
      readPaths.push({ path: "result.periodReports.length", value: (rawReports as unknown[]).length });
      for (const [period, k] of reported) readPaths.push({ path: `result.periodReports[${k}].period`, value: period });
    } else {
      readPaths.push({ path: "result.affectedIntersections.length", value: (top as unknown[]).length });
    }
    return {
      status: "ran",
      note,
      findings: [
        {
          clauseId: "periodScopeDisclosed",
          section: 6,
          type: "DISCLOSE",
          title: "A requested analysis period is neither reported nor disclosed",
          detail:
            `Requested: ${fromRequest ? asked.join(", ") : `none specified (all four defaults apply: ${DEFAULT_PERIODS.join(", ")})`}. ` +
            `Reported: ${[...reported.keys()].join(", ") || "none"}. ` +
            `Missing and not disclosed: ${undisclosed.join(", ")}. ` +
            `No finding says these periods were not analyzed, so a reader cannot tell whether the peak that governs this land use was analyzed.`,
          sourceLabel: "request.analysisPeriods (the engine's four defaults when absent), compared against result.periodReports[].period",
          readPaths,
          remedy: "State which periods were analyzed and why the others were not, in the limitations section.",
          audience: "engineer",
        },
      ],
    };
  },
};

/** "was"/"were" for a count. */
const be = (n: number) => (n === 1 ? "was" : "were");

export const scopeNoteConsistent: Clause = {
  id: "scopeNoteConsistent",
  section: 6,
  title: "A study area narrower than its radius is disclosed",
  run(rec: StudyRecord) {
    const inArea = rec.result.intersectionsInStudyArea as unknown;
    const merged = rec.result.intersectionsMergedAsDuplicates as unknown;
    const studied = rec.result.intersectionsStudied as unknown;
    if (inArea === undefined || merged === undefined) return { status: "not-run", reason: "payload predates intersectionsInStudyArea / intersectionsMergedAsDuplicates" };
    if (!numeric(inArea) || !numeric(merged)) return { status: "not-run", reason: "intersectionsInStudyArea or intersectionsMergedAsDuplicates is not a number" };
    if (!numeric(studied)) return { status: "not-run", reason: "intersectionsStudied absent or not a number" };
    // Force-included signals come from outside the radius, so studied > inArea is legitimate.
    if (merged === 0 && studied >= inArea) return { status: "ran", findings: [] };
    // "merged" or "duplicate" — NOT "study area": the engine's own finding "N signalized intersections fall within
    // the study area" is on every study with rows and says nothing about a gap.
    if (/merged|duplicate/i.test(authoredProse(rec))) return { status: "ran", findings: [] };
    const radius = numeric(rec.result.studyRadiusMi) ? `${rec.result.studyRadiusMi} mi radius` : "study radius";
    const leftOut = Math.max(0, inArea - merged - studied);
    return {
      status: "ran",
      findings: [
        {
          clauseId: "scopeNoteConsistent",
          section: 6,
          // NOTE, not DISCLOSE: buildStudyScopeNote runs inside the PDF
          // renderer and its sentence is never written to findings or
          // methodology, so this clause cannot see whether the deliverable
          // discloses the gap. It reports what the saved record does establish.
          type: "NOTE",
          title: "The set analyzed is not the set in the study radius",
          detail:
            `The inventory holds ${inArea} signalized intersection(s) within the ${radius}` +
            `${merged > 0 ? `; ${merged} ${be(merged)} absorbed as duplicate records of a junction already kept` : ""}; ` +
            `${studied} ${be(studied)} analyzed.` +
            `${leftOut > 0 ? ` ${leftOut} distinct junction(s) inside the radius are not in the analyzed set.` : ""}` +
            `${merged > 0 ? " Merges above 45 m rest on name equality, so this is a prompt to verify, not proof of duplication." : ""}`,
          sourceLabel: "artifacts/tis-api-server/src/lib/study-scope-note.ts — buildStudyScopeNote inputs",
          readPaths: [
            { path: "result.intersectionsInStudyArea", value: inArea },
            { path: "result.intersectionsMergedAsDuplicates", value: merged },
            { path: "result.intersectionsStudied", value: studied },
          ],
          remedy: "Confirm the merged records are the same physical junction before relying on the analyzed set; the scope note the PDF prints states these counts.",
          audience: "engineer",
        },
      ],
    };
  },
};
