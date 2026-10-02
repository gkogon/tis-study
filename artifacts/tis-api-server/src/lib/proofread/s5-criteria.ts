/**
 * §5 Criteria — the study must name the criteria it was judged against, and
 * their source.
 *
 * Two different facts, kept apart:
 *
 *  - "The study's findings do not name the governing agency" is a VERIFIED
 *    absence: `findings` was read and the name is not in it. It is a DISCLOSE
 *    finding — the analysis stands, the deliverable has to say it out loud.
 *
 *  - "The criteria VALUES were not checked against the agency's published
 *    document" is a standing gap, true of every study, because this repo stores
 *    no agency document. It is NOT a finding: an unverifiable attached to every
 *    study is the padding TIS-PROOFREAD-PROTOCOL.md forbids, and a findings
 *    list that long reads as coverage. It rides the coverage note instead, on
 *    every run of this clause, so the manifest says what was not checked
 *    without the findings list pretending to.
 */
import type { Clause, ReadPath, StudyRecord } from "./types.ts";
import { authoredProse } from "./prose.ts";

/** What this clause never checked, on every run. One sentence, in the coverage manifest, not the findings list. */
export const CRITERIA_VALUES_NOTE =
  "the criteria values themselves (thresholds, horizons, v/c tests) were not checked against the agency's published document, because no agency document is on file in this system";

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
      return { status: "not-run", reason: "record names no governing agency (result.jurisdiction.dotName absent)" };
    }
    // The criteria-issuing agency is the DOT. The planning office is who the engine says to coordinate with,
    // and it prints that name only in `mitigationSummary`, never in `findings` — so requiring it here would make
    // this clause fire on every engine-generated study, including one whose finding reads "…per City of Atlanta
    // DOT TIS guidance". The DOT's name appears in findings exactly when the engine cites its guidance (tis.ts).
    const findings = rec.result.findings as unknown;
    if (authoredProse(rec).includes(dot)) return { status: "ran", findings: [], note: CRITERIA_VALUES_NOTE };
    const readPaths: ReadPath[] = [{ path: "result.jurisdiction.dotName", value: dot }];
    if (office) readPaths.push({ path: "result.jurisdiction.planningOfficeName", value: office });
    if (Array.isArray(findings)) readPaths.push({ path: "result.findings.length", value: findings.length });
    return {
      status: "ran",
      note: CRITERIA_VALUES_NOTE,
      findings: [
        {
          clauseId: "criteriaNamed",
          section: 5,
          type: "DISCLOSE",
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
