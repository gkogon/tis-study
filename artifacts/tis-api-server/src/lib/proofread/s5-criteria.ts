/**
 * §5 Criteria — the study must name the criteria it was judged against, and
 * their source.
 *
 * This repo stores no agency document, so nothing can verify a threshold
 * against the agency's own published PDF. That is a standing gap, reported as
 * not-run coverage rather than an assumed pass — and never as UNVERIFIED,
 * which is reserved for a source that was reachable in principle.
 */
import type { Clause, ReadPath, StudyRecord } from "./types.ts";
import { authoredProse } from "./prose.ts";

export const criteriaNamed: Clause = {
  id: "criteriaNamed",
  section: 5,
  title: "The governing agency is named in the study's findings",
  run(rec: StudyRecord) {
    // The agency names live in `jurisdiction`, whose own doc comment says it is
    // "the region's governing-agency names, as the findings ... print them".
    // There is no `agencies` key on TisReport — reading one would make this
    // clause not-run on every study ever proofread, which is a dead clause
    // masquerading as coverage.
    const j = rec.result.jurisdiction as { dotName?: unknown; planningOfficeName?: unknown } | undefined;
    const dot = typeof j?.dotName === "string" ? j.dotName : undefined; // "" is as absent as undefined
    const office = typeof j?.planningOfficeName === "string" && j.planningOfficeName.length > 0 ? j.planningOfficeName : undefined;
    if (!dot) {
      return { status: "not-run", reason: "record names no governing agency (result.jurisdiction.dotName absent); no agency document is stored anywhere in this system" };
    }
    // The criteria-issuing agency is the DOT. The planning office is who the engine says to coordinate with,
    // and it prints that name only in `mitigationSummary`, never in `findings` — so requiring it here would make
    // this clause fire on every engine-generated study, including one whose finding reads "…per City of Atlanta
    // DOT TIS guidance". The DOT's name appears in findings exactly when the engine cites its guidance (tis.ts).
    const findings = rec.result.findings as unknown;
    if (authoredProse(rec).includes(dot)) return { status: "ran", findings: [] };
    const readPaths: ReadPath[] = [{ path: "result.jurisdiction.dotName", value: dot }];
    if (office) readPaths.push({ path: "result.jurisdiction.planningOfficeName", value: office });
    if (Array.isArray(findings)) readPaths.push({ path: "result.findings.length", value: findings.length });
    return {
      status: "ran",
      findings: [
        {
          clauseId: "criteriaNamed",
          section: 5,
          type: "UNVERIFIED",
          title: "The governing agency is not named in the study's findings",
          detail:
            `The record names ${dot} as the governing agency${office ? ` (planning office: ${office})` : ""}, but ${dot} ` +
            `does not appear in the study's findings. Which agency's criteria the LOS verdicts were judged against ` +
            `cannot be established from the saved findings; the rendered deliverable may name it elsewhere, which ` +
            `this record cannot show.`,
          sourceLabel: "result.jurisdiction.dotName, compared against result.findings",
          readPaths,
          remedy: "Name the governing agency and the criteria applied, with the published document and section they come from.",
          audience: "engineer",
        },
      ],
    };
  },
};
