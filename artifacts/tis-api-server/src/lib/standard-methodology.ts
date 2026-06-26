/**
 * Standard TIS methodology framework — the universal baseline applied to
 * EVERY location's report, on top of whatever jurisdiction-specific renderer
 * runs (FL/GA/CA/NY/IL/TX/UK/generic).
 *
 * Source: the "TIS Standard Methodology" framework (Miami-Dade DTPW Traffic
 * Engineering Division) — a generic, jurisdiction-agnostic statement of
 * accepted national TIS practice — now aligned to the current national
 * Recommended Practice: ITE's "Multimodal Transportation Impact Analysis for
 * Site Development" (MTIASD, RP-020G-E, 2023), which supersedes the 2010
 * "Transportation Impact Analyses for Site Development" (RP-020D) this layer
 * previously cited. It is treated here as the cross-location STANDARD, not a
 * Miami artifact: the three Levels of Analysis, the standard data requirements,
 * the trip-reduction caps, the three analysis scenarios, the MOEs, and the
 * de-minimis / methodology-meeting rules are all common practice everywhere.
 *
 * The MTIASD shifts the baseline from vehicle-centric traffic analysis to
 * MULTIMODAL, PERSON-TRIP analysis with Quality/Level of Service (Q/LOS)
 * objectives for all modes (auto, pedestrian, bicycle, transit) per HCM 7th Ed.
 * Critically, it is a guideline "for local consideration" — §Usage directs that
 * "modifications, additions, and deletions should be made to meet local
 * ordinances, policies, and priorities," and outside the US "state" is read as
 * province. That is the textual basis for the per-state variation below: the
 * controlling impact paradigm (LOS/Q-LOS vs. VMT) is resolved by jurisdiction,
 * not assumed nationally. See controllingImpactParadigm().
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
  "Standard methodology framework per ITE's Multimodal Transportation Impact Analysis for Site Development Recommended Practice (MTIASD, RP-020G-E, 2023 — superseding the 2010 Transportation Impact Analyses for Site Development, RP-020D), the ITE Trip Generation Manual / Handbook (current edition), and the Highway Capacity Manual 7th Edition. Levels of Analysis keyed to net new peak-hour person trips on the adjacent street; multimodal Quality/Level of Service evaluated for all modes where present.";

// ─── MTIASD multimodal framing + per-state controlling paradigm ───────────────

/** Canonical citation for the current national Recommended Practice. */
export const MTIASD_CITATION =
  "ITE Recommended Practice — Multimodal Transportation Impact Analysis for Site Development (RP-020G-E, 2023)";

/**
 * The four modes the MTIASD evaluates. Q/LOS (not just vehicular LOS) is assessed
 * for each mode that is present/relevant in the study area, per HCM 7th Ed. and
 * the Transit Capacity & Quality of Service Manual (TCQSM).
 */
export const MULTIMODAL_QOS_MODES: ReadonlyArray<{ key: string; label: string; qosBasis: string }> = [
  { key: "vehicle", label: "Vehicular (auto/truck)", qosBasis: "HCM 7th Ed. intersection control delay → LOS A–F; v/c; 95th-percentile queues" },
  { key: "pedestrian", label: "Pedestrian", qosBasis: "HCM 7th Ed. pedestrian LOS; Level of Traffic Stress (LTS); crossing/comfort exposure" },
  { key: "bicycle", label: "Bicycle", qosBasis: "HCM 7th Ed. bicycle LOS; Level of Traffic Stress (LTS); network connectivity" },
  { key: "transit", label: "Public transit", qosBasis: "TCQSM transit Q/LOS — service frequency, travel-time ratio, stop access/comfort" },
];

export type ImpactParadigm = {
  /** Primary metric the reviewing jurisdiction uses to determine significance. */
  primaryMetric: "VMT" | "LOS";
  /** Whether the primary metric is adopted as the controlling standard statewide. */
  adoptedStatewide: boolean;
  /** One-line basis citation for the determination. */
  basis: string;
};

/**
 * Resolve the controlling transportation-impact paradigm for a US state, per the
 * MTIASD's guidance that the measure varies by adopted local/state practice
 * (§11.3 Vehicle Miles Traveled; §11.3.1 California's Policy Guidance on VMT).
 *
 * California adopted VMT statewide for CEQA transportation impacts under SB 743
 * (OPR 2018 Technical Advisory; effective July 1, 2020) — LOS is no longer the
 * CEQA significance metric there. No other US state has a statewide VMT mandate;
 * elsewhere the controlling metric remains LOS / Q-LOS, with VMT applied only
 * where an individual local jurisdiction has adopted it. The MTIASD's multimodal
 * Q/LOS objectives apply in either case.
 */
export function controllingImpactParadigm(stateCode: string | undefined): ImpactParadigm {
  if (stateCode === "CA") {
    return {
      primaryMetric: "VMT",
      adoptedStatewide: true,
      basis: "California SB 743 / CEQA Guidelines §15064.3; OPR 2018 Technical Advisory. VMT is the CEQA significance metric; LOS retained only for operational/local-ordinance review. MTIASD §11.3.1.",
    };
  }
  return {
    primaryMetric: "LOS",
    adoptedStatewide: false,
    basis: "Level of Service / Quality of Service per HCM 7th Ed. is the controlling significance metric; VMT applied only where the local jurisdiction has separately adopted it. MTIASD §7.4 / §11.3.",
  };
}

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
