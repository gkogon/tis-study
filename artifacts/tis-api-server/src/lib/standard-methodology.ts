/**
 * Standard TIS methodology framework — the universal baseline applied to
 * EVERY location's report, on top of whatever jurisdiction-specific renderer
 * runs (FL/GA/CA/NY/IL/TX/UK/generic).
 *
 * Source: the "TIS Standard Methodology" framework (Miami-Dade DTPW Traffic
 * Engineering Division) — a generic, jurisdiction-agnostic statement of
 * accepted national TIS practice (ITE Trip Generation Handbook; ITE/FHWA
 * Transportation Impact Analyses for Site Development). It is treated here as
 * the cross-location STANDARD, not a Miami artifact: the three Levels of
 * Analysis, the standard data requirements, the trip-reduction caps, the
 * three analysis scenarios, the MOEs, and the de-minimis / methodology-meeting
 * rules are all common practice everywhere.
 *
 * Pure data + small helpers, no PDFKit dependency (mirrors fdot-gsvt.ts), so
 * any renderer can consume it. It deliberately does NOT override the
 * jurisdiction-specific DELIVERABLE tiers in study-tier.ts (Gwinnett's 4-level
 * scheme, TxDOT categories, OPR Tier 1, etc.) — those are real published local
 * rules. This is the methodology layer that sits above all of them.
 */

// ─── Levels of Analysis ──────────────────────────────────────────────────────

export type AnalysisLevelId = 1 | 2 | 3;

export type AnalysisLevel = {
  id: AnalysisLevelId;
  label: string;
  /** Inclusive lower / exclusive upper bound on net new peak-hour trips on the
   *  adjacent street. `upper: null` = no upper bound. */
  lowerTrips: number;
  upperTrips: number | null;
  rangeLabel: string;
  /** Report components REQUIRED at this level (cumulative). */
  components: string[];
};

/**
 * Three Levels of Analysis keyed to net new peak-hour trips generated onto the
 * adjacent street. Components are cumulative: Level 2 includes everything in a
 * worksheet-grade screen plus the full study elements; Level 3 adds mitigation
 * and a formal methodology meeting.
 */
export const ANALYSIS_LEVELS: ReadonlyArray<AnalysisLevel> = [
  {
    id: 1,
    label: "Level 1 — Trip Generation Screen",
    lowerTrips: 0,
    upperTrips: 100,
    rangeLabel: "< 100 net new peak-hour trips",
    components: [
      "Trip generation (ITE Trip Generation Manual, current edition)",
      "Queue-length analysis at site access where a gated/controlled entrance is proposed",
    ],
  },
  {
    id: 2,
    label: "Level 2 — Standard Traffic Impact Study",
    lowerTrips: 100,
    upperTrips: 300,
    rangeLabel: "100–300 net new peak-hour trips",
    components: [
      "Data requirements (turning-movement + roadway-link counts, signal timing, growth, committed developments)",
      "Study area definition",
      "Project trip reductions (internal capture, pass-by, mode split)",
      "Site plan and area plan",
      "Traffic analysis scenarios (Existing / Future No-Build / Future Build)",
      "Measures of effectiveness (LOS, 95th-percentile queues, control delay, v/c)",
    ],
  },
  {
    id: 3,
    label: "Level 3 — Full Traffic Impact Study with Mitigation",
    lowerTrips: 300,
    upperTrips: null,
    rangeLabel: "> 300 net new peak-hour trips",
    components: [
      "All Level 2 components",
      "Traffic impact mitigation recommendations",
      "Project methodology meeting with the reviewing agency before data collection",
    ],
  },
];

/** Resolve the standard Level of Analysis from net new peak-hour trips. */
export function resolveAnalysisLevel(netPeakHourTrips: number): AnalysisLevel {
  const t = Number.isFinite(netPeakHourTrips) ? Math.max(0, netPeakHourTrips) : 0;
  for (const lvl of ANALYSIS_LEVELS) {
    if (t >= lvl.lowerTrips && (lvl.upperTrips == null || t < lvl.upperTrips)) return lvl;
  }
  return ANALYSIS_LEVELS[ANALYSIS_LEVELS.length - 1]!;
}

// ─── Standard trip-reduction caps ────────────────────────────────────────────

/**
 * Caps on project trip reductions, in standard practice. Internal capture is
 * bounded as a share of total trip generation; pass-by is bounded both as a
 * share of generated trips AND — the binding check — as a share of the
 * adjacent street's peak-hour two-way volume.
 */
export const STANDARD_TRIP_REDUCTION_CAPS = {
  /** Internal capture ≤ 25% of total trip generation (ITE/ULI practice). */
  internalCaptureMaxPctOfTotal: 25,
  /** Pass-by applies to retail/commercial land uses only. */
  passByRetailCommercialOnly: true,
  /** Pass-by trips ≤ 10% of the adjacent street's peak-hour two-way volume. */
  passByMaxPctOfAdjacentStreet: 10,
} as const;

// ─── Standard analysis scenarios ─────────────────────────────────────────────

export type AnalysisScenario = { key: string; label: string; description: string };

export const STANDARD_ANALYSIS_SCENARIOS: ReadonlyArray<AnalysisScenario> = [
  { key: "existing", label: "Existing Conditions", description: "Field-collected current-year peak-hour volumes and geometry." },
  { key: "no_build", label: "Future No-Build", description: "Opening-year background volumes (existing grown at the agreed rate, plus committed developments), without the project." },
  { key: "build", label: "Future Build", description: "No-Build volumes plus the project's distributed net new external trips." },
];

// ─── Standard measures of effectiveness ──────────────────────────────────────

export const STANDARD_MOES: ReadonlyArray<string> = [
  "Level of Service (LOS A–F) per the Highway Capacity Manual",
  "95th-percentile queue lengths on the critical approaches",
  "Average control delay (seconds per vehicle)",
  "Volume-to-capacity (v/c) ratios",
];

// ─── Standard data requirements ──────────────────────────────────────────────

export const STANDARD_DATA_REQUIREMENTS: ReadonlyArray<string> = [
  "Intersection turning-movement counts over the weekday AM (7–9 AM) and PM (4–6 PM) peak periods",
  "Roadway-link counts (72-hour continuous) on the study-area segments",
  "Signal phasing and timing for study-area signals",
  "Trip generation per the ITE Trip Generation Manual (current edition)",
  "Trip distribution from a defensible basis (regional travel-demand model / MPO directional distribution / engineering judgment)",
  "Background growth rate from ≥5 years of count history or the adopted regional model",
  "Build-out (opening) year",
  "Committed (approved but unbuilt) developments in the study area",
  "Funded future transportation projects within the analysis horizon",
];

// ─── Conditions applicable to all levels ─────────────────────────────────────

/** Net new project traffic at or below this share of the adjacent street's
 *  peak-hour volume is de-minimis: no impact assessment is required on that
 *  link unless it already operates below the adopted LOS / concurrency. */
export const DE_MINIMIS_ADJACENT_STREET_PCT = 10;

export const STANDARD_CONDITIONS: ReadonlyArray<string> = [
  `De-minimis threshold: where net new project traffic is ≤ ${DE_MINIMIS_ADJACENT_STREET_PCT}% of a link's adjacent-street peak-hour volume, no further impact assessment is required on that link unless it already operates below the adopted LOS / concurrency standard.`,
  "Less-than-existing: where the proposed use generates no more peak-hour traffic than the existing or most recent prior use of the site, the impact assessment may be waived.",
  "Mitigation may take the form of roadway/intersection improvements, transit / bicycle / pedestrian enhancements, or a proportionate-share monetary contribution.",
];

export const STANDARD_METHODOLOGY_SOURCE =
  "Standard TIS methodology framework (ITE Trip Generation Handbook; ITE/FHWA Transportation Impact Analyses for Site Development; Miami-Dade DTPW TIS Standard Methodology). Levels of Analysis keyed to net new peak-hour trips on the adjacent street.";

/**
 * A compact set of methodology bullets the engine can append to its
 * result.methodology array so the standard framework also shows in renderers
 * that surface that list. Renderers that draw the full framework section
 * should use ANALYSIS_LEVELS / STANDARD_* directly rather than these.
 */
export function standardMethodologyNotes(netPeakHourTrips: number): string[] {
  const lvl = resolveAnalysisLevel(netPeakHourTrips);
  return [
    `Standard Levels of Analysis: this project generates ~${Math.round(netPeakHourTrips)} net new peak-hour trips, placing it in ${lvl.label} (${lvl.rangeLabel}).`,
    `Trip-reduction caps: internal capture ≤ ${STANDARD_TRIP_REDUCTION_CAPS.internalCaptureMaxPctOfTotal}% of total trip generation; pass-by (retail/commercial only) ≤ ${STANDARD_TRIP_REDUCTION_CAPS.passByMaxPctOfAdjacentStreet}% of the adjacent street's peak-hour two-way volume.`,
    `Analysis scenarios: ${STANDARD_ANALYSIS_SCENARIOS.map((s) => s.label).join(" / ")}.`,
    `De-minimis: net new traffic ≤ ${DE_MINIMIS_ADJACENT_STREET_PCT}% of a link's adjacent-street peak-hour volume requires no further impact assessment on that link unless it already fails the adopted LOS / concurrency standard.`,
  ];
}
