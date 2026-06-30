/**
 * Accuracy-grading layer — the product's defensibility spine.
 *
 * Rather than a blanket "screening only" disclaimer OR a false "complete study"
 * claim, every report states, per component, how accurate it is and why. The
 * grade is derived from the confidence signals the engine already tracks
 * (ITE-published vs interpolated rates, modelled vs field-collected volumes,
 * screening vs calibrated capacity, measured vs default growth). The
 * transparency IS the defense: a reviewer sees exactly which inputs are
 * High/Medium/Low and what a submittable study would substitute.
 */
export type Grade = "High" | "Medium" | "Low";

export type AccuracyItem = {
  component: string;
  grade: Grade;
  basis: string;
  /** What an agency-submittable study would substitute to raise the grade. */
  toSubmit?: string;
};

export type AccuracyReport = {
  items: AccuracyItem[];
  overall: Grade;
  /** ISO-ish "as of" label for the standards/data currency. */
  asOf: string;
  statement: string;
};

const ORDER: Record<Grade, number> = { Low: 0, Medium: 1, High: 2 };

export function buildAccuracyReport(report: any, opts: { asOf?: string } = {}): AccuracyReport {
  const tg = report?.tripGeneration ?? {};
  const items: AccuracyItem[] = [];
  const codeStr =
    tg.landUseCode == null || (typeof tg.landUseCode === "number" && !Number.isFinite(tg.landUseCode))
      ? "—"
      : String(tg.landUseCode);

  // Trip generation — High when a clean public-data rate (SANDAG 2002 /
  // NHTS 2017 / NCHRP 716) was used directly; Medium when the rate is
  // blended MPO guidance or interpolated from a secondary variable.
  const tgSolid =
    tg.variableConfidence === "sandag_2002" ||
    tg.variableConfidence === "nhts_2017" ||
    tg.variableConfidence === "nchrp_716";
  const PUBLIC_BASIS_LABEL: Record<string, string> = {
    sandag_2002: "SANDAG 2002 vehicular trip-generation guide",
    nhts_2017: "FHWA NHTS 2017 trend table",
    nchrp_716: "NCHRP Report 716 parameter table",
  };
  items.push({
    component: "Trip generation",
    grade: tgSolid ? "High" : "Medium",
    basis: tgSolid
      ? `Public-data rate (${PUBLIC_BASIS_LABEL[tg.variableConfidence] ?? "public source"}) for land use ${codeStr}.`
      : "Blended MPO guidance or interpolated secondary-variable rate — verify against a jurisdiction-approved trip-generation source.",
    toSubmit: tgSolid ? undefined : "Confirm the rate against a TRICS or jurisdiction-approved site set agreed in scoping.",
  });

  // Existing volumes — this engine models them; it does not field-count.
  items.push({
    component: "Existing traffic volumes",
    grade: "Medium",
    basis: "Modelled from measured AADT and diurnal/peak-hour factors.",
    toSubmit: "Field-collected turning-movement counts (mid-week, in-season, within 12 months).",
  });

  // Junction capacity — screening, not a calibrated micro/meso model.
  const ints = Array.isArray(report?.affectedIntersections) ? report.affectedIntersections : [];
  items.push({
    component: "Junction capacity",
    grade: "Medium",
    basis: ints.length
      ? "HCM / degree-of-saturation screening from v/c ratios."
      : "No junctions within the study radius — capacity is not the controlling factor.",
    toSubmit: ints.length ? "A calibrated LinSig / Synchro / Junctions model on the agreed demand." : undefined,
  });

  // Mode share.
  const share = Number(report?.autoModeShareApplied);
  items.push({
    component: "Mode share",
    grade: Number.isFinite(share) && share > 0 ? "Medium" : "Low",
    basis: "Regional auto-mode-share factor applied to net out non-car modes.",
    toSubmit: "A TRICS / Census multi-modal split for the site's catchment.",
  });

  // Background growth.
  items.push({
    component: "Background growth",
    grade: report?.growthSource ? "Medium" : "Low",
    basis: report?.growthSource
      ? `Measured per-segment compound growth (${report.growthSource}).`
      : "Default growth rate applied.",
    toSubmit: report?.growthSource ? undefined : "A 5-year AADT trend on the affected segments or the MPO model.",
  });

  // Overall is bounded by the weakest critical input, but trip generation being
  // High lifts a study with otherwise-Medium support to Medium overall.
  const min = items.reduce((m, it) => Math.min(m, ORDER[it.grade]), 2);
  const overall: Grade = min === 0 ? "Low" : min === 1 ? "Medium" : "High";

  const asOf = opts.asOf ?? "";
  const statement =
    `This report is generated to current methodology and is complete for the inputs available; component accuracy is graded above. ` +
    `It is prepared for review and seal by a licensed/chartered engineer — the grades show exactly which inputs a submittable study would substitute (those marked Medium or Low). ` +
    (asOf ? `Standards and data currency: as of ${asOf}.` : `Standards reflect the editions cited in this report.`);

  return { items, overall, asOf, statement };
}
