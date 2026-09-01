/**
 * Regulations layer — a versioned, dated standards registry.
 *
 * The applicable codes for a report depend on jurisdiction and study type, and
 * they change (ITE editions, FDM, MUTCD, NPPF, London Plan…). Keeping them as
 * dated data — rather than hard-coded strings scattered through renderers — lets
 * a report cite "current as of [date]" and lets the set be updated in one place
 * as standards are revised.
 */
export type StudyKind = "vehicular" | "pedestrian" | "parking" | "all";

export type Regulation = {
  code: string;
  title: string;
  edition: string;
  /** Effective date, YYYY or YYYY-MM. */
  effective: string;
  /** "US", "US-FL", "UK", "UK-London", … */
  jurisdiction: string;
  appliesTo: StudyKind[];
};

/**
 * The standards registry. Update an edition + effective date here when a code is
 * revised and every report that cites it updates. (Auto-tracking revisions is a
 * data pipeline on top of this; the registry is the single source of truth.)
 */
export const REGULATIONS: Regulation[] = [
  // US national
  { code: "SANDAG 2002", title: "SANDAG (Not So) Brief Guide of Vehicular Traffic Generation Rates", edition: "April 2002", effective: "2002-04", jurisdiction: "US", appliesTo: ["vehicular"] },
  { code: "NHTS 2017", title: "FHWA National Household Travel Survey — Summary of Travel Trends", edition: "2017", effective: "2018", jurisdiction: "US", appliesTo: ["vehicular"] },
  { code: "NCHRP 716", title: "NCHRP Report 716: Travel Demand Forecasting Parameters and Techniques", edition: "2012", effective: "2012", jurisdiction: "US", appliesTo: ["vehicular"] },
  // ⚠️ The Highway Capacity Manual is DELIBERATELY ABSENT and must not be re-added.
  // This product holds no HCM licence (cease-and-desist 2026-07-08); the HCM strip
  // (#104, #144) cleared every renderer and UI string but missed this registry, which
  // the `regulations` provider renders as a literal citation table. The delay model is
  // and always was Webster + Akçelik, both openly published — cite those instead.
  { code: "Webster 1958", title: "Webster, Traffic Signal Settings, Road Research Technical Paper No. 39 (RRL/HMSO)", edition: "1958", effective: "1958", jurisdiction: "US", appliesTo: ["vehicular"] },
  { code: "Akçelik", title: "Akçelik time-dependent overflow-delay function, Australian Road Research Board", edition: "open literature", effective: "1980", jurisdiction: "US", appliesTo: ["vehicular"] },
  { code: "MUTCD", title: "Manual on Uniform Traffic Control Devices", edition: "11th Edition", effective: "2023-12", jurisdiction: "US", appliesTo: ["vehicular"] },
  { code: "AASHTO", title: "A Policy on Geometric Design of Highways and Streets (Green Book)", edition: "7th Edition", effective: "2018", jurisdiction: "US", appliesTo: ["vehicular"] },
  // US state examples
  { code: "FDM", title: "FDOT Design Manual", edition: "2026", effective: "2026-01-01", jurisdiction: "US-FL", appliesTo: ["vehicular"] },
  { code: "FDOT Q/LOS", title: "FDOT Quality/Level of Service Handbook", edition: "v6.0 (Aug 2025)", effective: "2025-08", jurisdiction: "US-FL", appliesTo: ["vehicular"] },
  { code: "GDOT", title: "GDOT Regulations for Driveway and Encroachment Control (RDEC)", edition: "2021", effective: "2021", jurisdiction: "US-GA", appliesTo: ["vehicular"] },
  // UK
  { code: "NPPF", title: "National Planning Policy Framework", edition: "December 2024", effective: "2024-12", jurisdiction: "UK", appliesTo: ["vehicular", "pedestrian"] },
  { code: "PPG", title: "Planning Practice Guidance — Travel Plans, Transport Assessments and Statements", edition: "current", effective: "2024", jurisdiction: "UK", appliesTo: ["vehicular", "pedestrian"] },
  { code: "DMRB", title: "Design Manual for Roads and Bridges (CD 109 / 116 / 123)", edition: "2020", effective: "2020", jurisdiction: "UK", appliesTo: ["vehicular"] },
  // ⚠️ TRICS is DELIBERATELY ABSENT and must not be re-added — no licence; dropped in #73.
  // UK trip generation runs on the 2011 Census origin-destination table instead.
  { code: "Census WU03EW", title: "ONS 2011 Census origin-destination: usual residence and place of work by method of travel", edition: "2011", effective: "2014", jurisdiction: "UK", appliesTo: ["vehicular", "pedestrian"] },
  // UK — London
  { code: "London Plan", title: "The London Plan (Policies T1–T9)", edition: "2021", effective: "2021-03", jurisdiction: "UK-London", appliesTo: ["vehicular", "pedestrian"] },
  { code: "MTS", title: "Mayor's Transport Strategy", edition: "2018", effective: "2018", jurisdiction: "UK-London", appliesTo: ["vehicular", "pedestrian"] },
  { code: "Healthy Streets TA", title: "TfL Healthy Streets Transport Assessment guidance", edition: "17 June 2019", effective: "2019-06", jurisdiction: "UK-London", appliesTo: ["vehicular", "pedestrian"] },
  { code: "PCL", title: "TfL Pedestrian Comfort Guidance", edition: "2010", effective: "2010", jurisdiction: "UK-London", appliesTo: ["pedestrian"] },
];

/** Map a Region to the jurisdiction tags that select its applicable standards. */
export function jurisdictionTags(region: any): string[] {
  const country = region?.country ?? "US";
  if (country === "UK") {
    const tags = ["UK"];
    if (region?.code === "ln" || /london/i.test(region?.displayName ?? "")) tags.push("UK-London");
    return tags;
  }
  const tags = ["US"];
  if (region?.stateCode) tags.push(`US-${region.stateCode}`);
  return tags;
}

/** Standards applicable to a region + study kind, most-recent first. */
export function applicableRegulations(region: any, kind: StudyKind): Regulation[] {
  const tags = new Set(jurisdictionTags(region));
  return REGULATIONS.filter((r) => tags.has(r.jurisdiction) && (r.appliesTo.includes(kind) || r.appliesTo.includes("all")))
    .sort((a, b) => b.effective.localeCompare(a.effective));
}

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function formatYm(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  return m ? `${MONTHS[Number(m[2])]} ${m[1]}` : ym;
}

/** The "current as of" label = the most recent effective date among applicable standards. */
export function regulationsAsOf(regs: Regulation[]): string {
  if (!regs.length) return "";
  return formatYm(regs.map((r) => r.effective).sort().reverse()[0]);
}

// ── Registry freshness / auto-track signal ─────────────────────────────────
// When the registry above was last human-verified, and how often it should be
// re-checked. A maintenance task (cron) reads `registryStatus` to know when an
// edition review is due — the honest hook behind "auto-updating regulations":
// the report states its standards currency and flags when a review is overdue,
// rather than silently drifting as codes are revised.
export const REGISTRY_REVIEWED = "2026-06"; // YYYY-MM
export const REVIEW_CADENCE_MONTHS = 12;

function addMonths(ym: string, n: number): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type RegistryStatus = { reviewedOn: string; reviewBy: string; overdue: boolean };

/** Registry freshness as of `today`: when verified, when the next review is due, overdue? */
export function registryStatus(today: Date): RegistryStatus {
  const reviewBy = addMonths(REGISTRY_REVIEWED, REVIEW_CADENCE_MONTHS);
  return {
    reviewedOn: formatYm(REGISTRY_REVIEWED),
    reviewBy: formatYm(reviewBy),
    overdue: ymOf(today) > reviewBy,
  };
}
