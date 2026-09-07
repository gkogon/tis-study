/**
 * The study-scope disclosure sentence — dependency-free so it can be unit-tested
 * without standing up PDFKit.
 *
 * #191 stopped reporting the POST-merge count as the study-area population,
 * because a study that had silently lost intersections looked complete. That
 * fixed the number but left the sentence consuming it describing the OLD cause:
 * it blamed an impact-significance screen for every absent record and cited ITE
 * for the threshold. Both are wrong once the count is the raw inventory.
 *
 * Two DIFFERENT things remove a record from the study set, and they need
 * different sentences:
 *
 *  1. SAME-JUNCTION MERGING. Signal inventories commonly carry one node per
 *     approach, so one junction appears as three or four records. Measured on
 *     the Allegheny County sample (r = 2.0 mi): 72 records in radius, median
 *     nearest-neighbour distance 25.6 m, and 35 of the 36 merges fire on
 *     co-location alone. Those 36 are not skipped intersections — they are the
 *     same intersections counted more than once.
 *  2. IMPACT-SIGNIFICANCE SCOPING. Genuinely distinct junctions dropped because
 *     the project's net new traffic there is negligible. This is OPT-IN
 *     (`scopeStudyIntersections`, default false), so on a default run it removes
 *     nothing and must not be offered as the explanation.
 *
 * Reporting (1) as though it were (2) tells a reviewer that half the study area
 * was waved through on a threshold — the exact failure #191 set out to prevent,
 * pointed the other way. So the note leads with the post-merge count (the real
 * intersection count), then discloses the raw record count and the merge, and
 * only reaches for significance language when a screen actually trimmed
 * something.
 *
 * No ITE citation: standalone ITE references were removed after the 2026-07-08
 * C&D (#104/#144/#146/#147/#148/#151), and the threshold described here is the
 * one this study applied, not one quoted from a licensed document.
 */

export type StudyScopeCounts = {
  /** In-radius inventory records BEFORE same-junction merging. */
  inRadiusRecords: number;
  /** In-radius records absorbed into a junction already counted. */
  mergedAsDuplicates: number;
  /** Intersections actually carried as study intersections. */
  analyzed: number;
  studyRadiusMi: number;
};

/** "2" / "0.5" / "1.25" — no trailing zeros in the rendered sentence. */
function fmtMi(mi: number): string {
  if (!Number.isFinite(mi) || mi <= 0) return "0.5";
  return String(Number(mi.toFixed(2)));
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Build the appendix scope sentence, or null when there is nothing to disclose
 * (every in-radius junction is carried, and nothing was merged).
 */
export function buildStudyScopeNote(counts: StudyScopeCounts): string | null {
  const inRadius = Math.max(0, Math.trunc(counts.inRadiusRecords || 0));
  const merged = Math.max(0, Math.trunc(counts.mergedAsDuplicates || 0));
  const analyzed = Math.max(0, Math.trunc(counts.analyzed || 0));

  // Distinct junctions the radius actually contains, after per-approach records
  // collapse onto the junction they belong to.
  const distinct = Math.max(0, inRadius - merged);
  if (distinct === 0 && merged === 0) return null;

  // Force-included signals are carried from OUTSIDE the radius, so `analyzed`
  // can legitimately exceed the in-radius population; that is an addition to the
  // study set, never a screen-out.
  const scopedOut = Math.max(0, distinct - analyzed);
  const forcedIn = Math.max(0, analyzed - distinct);
  if (merged === 0 && scopedOut === 0 && forcedIn === 0) return null;

  const r = fmtMi(counts.studyRadiusMi);
  const parts: string[] = [];

  if (scopedOut > 0) {
    parts.push(
      `Study scope: ${distinct} signalized ${plural(distinct, "intersection lies", "intersections lie")} `
      + `within the ${r}-mile study area; ${analyzed} ${plural(analyzed, "is", "are")} carried as study `
      + `${plural(analyzed, "intersection", "intersections")} — the site frontage/adjacent intersections plus `
      + `those the project materially impacts.`,
    );
  } else if (forcedIn > 0) {
    parts.push(
      `Study scope: ${distinct} signalized ${plural(distinct, "intersection lies", "intersections lie")} `
      + `within the ${r}-mile study area; ${analyzed} are carried as study intersections, including `
      + `${forcedIn} added to the study set from outside the radius.`,
    );
  } else {
    parts.push(
      `Study scope: ${distinct} signalized ${plural(distinct, "intersection lies", "intersections lie")} `
      + `within the ${r}-mile study area, and all ${distinct} ${plural(distinct, "is", "are")} carried as `
      + `study ${plural(distinct, "intersection", "intersections")}.`,
    );
  }

  if (merged > 0) {
    // State the raw count and the merge plainly. A reviewer who wants to audit
    // the merge needs both numbers; without them a deduped set is indistinguishable
    // from a set that quietly lost junctions.
    parts.push(
      `The regional signal inventory holds ${inRadius} ${plural(inRadius, "record", "records")} inside that `
      + `radius; ${merged} ${plural(merged, "was", "were")} merged into a junction already counted, because a `
      + `signalized junction is commonly recorded once per approach rather than once per intersection. `
      + `Merged records are duplicates of an analyzed intersection, not intersections omitted from the study.`,
    );
  }

  if (scopedOut > 0) {
    parts.push(
      `The remaining ${scopedOut} ${plural(scopedOut, "receives", "receive")} net new site traffic below the `
      + `impact-significance threshold applied in this study and ${plural(scopedOut, "is", "are")} not analyzed `
      + `individually.`,
    );
  }

  return parts.join(" ");
}
