/**
 * What counts as this study's OWN disclosure prose.
 *
 * `result.methodology` is not an engineer-authored list: the engine splices a
 * fixed 15-line methodology boilerplate into it on every study
 * (`TIS_METHODOLOGY`, mapped in at `tis.ts:1250`). That text already contains
 * the words a naive keyword gate looks for — "Pass-by and internal-capture
 * credits are applied…", "Reported control delay is capped at 300 s…",
 * "de-duplicated within a 45m clustering threshold", "within the study radius"
 * — so a clause gated on `[...findings, ...methodology]` matches the
 * boilerplate on EVERY study and never fires. Four clauses in this file set
 * would have been silently dead.
 *
 * So the corpus is `findings` only: the study-specific lines. The plausibility
 * guard already writes its disclosure to the head of both arrays, so nothing
 * that matters is lost by ignoring `methodology`.
 *
 * `findings` carries engine boilerplate of its own, though, and a gate must
 * survive it. `plainFindings` (tis.ts) writes these on every study with rows,
 * and each one contains a word a careless gate would take for a disclosure:
 *   - "…new daily vehicle trips, with N during the PM peak hour…"   (daily, PM peak)
 *   - "N signalized intersections fall within the study area; …"    (study area)
 *   - "…internal capture and pass-by credit variants; and a ±0.5%/yr…" (pass-by)
 *   - "…at the AM and Saturday-midday periods…"                       (Saturday-midday)
 * A gate is therefore a CLAUSE-level pattern (`clauses`), never a bare keyword.
 */
import type { StudyRecord } from "./types.ts";

/** This study's findings, as strings. Anything else in the array is ignored. */
function findings(rec: StudyRecord): string[] {
  const f = rec.result.findings as unknown;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

/** The findings as one block of text, for a gate that is genuinely a whole-text question ("is the agency named?"). */
export function authoredProse(rec: StudyRecord): string {
  return findings(rec).join(" ");
}

/**
 * The findings split into clauses at a sentence or semicolon boundary. A decimal or a percentage never splits
 * (`1.50%/yr`, `±0.5%/yr` carry no whitespace after the point); an abbreviation like "Rd. &" may, harmlessly.
 * A gate that needs two things to be true TOGETHER ("pass-by" and a percentage) asks it of one clause, so the
 * engine's sensitivity sentence — which says "pass-by" in one clause and "±0.5%/yr" in the next — does not satisfy it.
 */
export function clauses(rec: StudyRecord): string[] {
  return findings(rec).flatMap((f) => f.split(/(?<=[.;!?])\s+/)).filter((c) => c.length > 0);
}
