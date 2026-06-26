/**
 * MTIASD deep methodology layer — data + helpers extracted verbatim from the
 * ITE Recommended Practice "Multimodal Transportation Impact Analysis for Site
 * Development" (RP-020G-E, 2023). This is the content the older 2010 RP did not
 * cover: multimodal study thresholds, person-trips by mode, multimodal Q/LOS,
 * TDM, and pro-rata share districts.
 *
 * Pure data + small helpers, no PDFKit dependency (mirrors standard-methodology.ts
 * and fdot-gsvt.ts) so any renderer can consume it. The per-state controlling
 * paradigm + the MTIASD citation live in standard-methodology.ts
 * (controllingImpactParadigm, MTIASD_CITATION); this module deepens it.
 *
 * Section references below are to the RP. Tables reproduce the RP's own values;
 * where the RP gives a range or "most common" value, both are preserved so the
 * renderer can state the basis honestly.
 */

// ─── §2.1 Study Thresholds (Table 1) ─────────────────────────────────────────

/**
 * The MTIASD suggested default trigger, used "in lieu of other locally preferred
 * thresholds" (Table 1, §2.1). Local/state agency thresholds govern where they
 * exist (those live in study-tier.ts); this is the national baseline.
 */
export const STUDY_THRESHOLD_DEFAULT = {
  peakHourVehicleTrips: 50,
  basis:
    "In lieu of a locally preferred threshold, the MTIASD suggests a study when a development generates 50 or more added vehicle trips during the adjacent roadway's peak hour or the development's peak hour (RP §2.1, Table 1). An added 50–100 vehicles/hour can change intersection LOS, raise v/c, and reduce comfort/safety for people walking, biking, and riding transit.",
} as const;

/**
 * The ITE-collected sampling of thresholds that commonly trigger a study (§2.1).
 * Stated as ranges with the most-common value, so the report can be candid that
 * these vary by agency.
 */
export const STUDY_TRIGGER_SAMPLING = {
  dailyVehicleTrips: { min: 500, max: 3000, common: 1000 },
  peakHourTrips: { min: 20, max: 500, common: 50, commonUpper: 100 },
} as const;

/** Non-quantitative triggers (§2.1) — a study may be warranted below the numeric
 *  threshold for any of these. */
export const STUDY_TRIGGER_CONDITIONS: ReadonlyArray<string> = [
  "A specified number of dwelling units or square footage is reached (varies widely by land use)",
  "A financial assessment / pro-rata contribution must be sized",
  "Significant transportation-improvement investment is required for one or more modes",
  "A prior study is out of date (commonly 1–3 years, per local policy)",
  "Development occurs in a sensitive area — established residential neighborhood, historic district, school (K-12), senior center, environmental-justice priority area, park, or recreational area",
  "An existing safety or multimodal deficiency near the site (high-crash location, complex geometry, missing pedestrian/bicycle accommodation) — at staff discretion",
];

// ─── §2.1 Table 2 — Land-use size thresholds (≈50 peak-hour vehicle trips) ────

export type LandUseSizeThreshold = { landUse: string; size: number; unit: string; iteHint?: string };

/** Table 2: development size that generates ≈50 weekday PM-peak-hour vehicle
 *  trips (the suggested study trigger), adapted from the ITE Trip Generation
 *  Manual fitted-curve equations. */
export const LAND_USE_SIZE_THRESHOLDS: ReadonlyArray<LandUseSizeThreshold> = [
  { landUse: "Single-Family Detached Housing", size: 50, unit: "DU", iteHint: "210" },
  { landUse: "Single-Family Attached Housing", size: 90, unit: "DU", iteHint: "215" },
  { landUse: "Multifamily Housing (Mid-Rise)", size: 130, unit: "DU", iteHint: "221" },
  { landUse: "Single-Family Senior Adult Housing", size: 110, unit: "DU", iteHint: "251" },
  { landUse: "Hotel", size: 100, unit: "rooms", iteHint: "310" },
  { landUse: "Day Care Center", size: 65, unit: "students", iteHint: "565" },
  { landUse: "General Office Building", size: 25_000, unit: "sq ft GFA", iteHint: "710" },
  { landUse: "Medical-Dental Office Building", size: 13_000, unit: "sq ft GFA", iteHint: "720" },
  { landUse: "Strip Retail Plaza", size: 5_300, unit: "sq ft GLA", iteHint: "822" },
  { landUse: "Drive-In Bank", size: 2_400, unit: "sq ft GFA", iteHint: "912" },
  { landUse: "Fast-Food Restaurant with Drive-Through", size: 1_500, unit: "sq ft GFA", iteHint: "934" },
  { landUse: "Industrial Park", size: 145_000, unit: "sq ft GFA", iteHint: "130" },
];

// ─── §2.2 Table 3 — Suggested study limits by development size ────────────────

export type StudyLimitTier = {
  /** Inclusive lower bound on peak-hour vehicle trips for this tier. */
  minPeakHourVehTrips: number;
  developmentExamples: string;
  studyExtent: string;
};

/**
 * Table 3 (adapted from Stover & Koepke 2002; Schroeder). Defines how far the
 * study area should extend, scaled to development size / trip-making. Ordered
 * ascending by trip-making so resolveStudyLimit() can pick the smallest tier
 * that still bounds the project.
 */
export const STUDY_LIMIT_TIERS: ReadonlyArray<StudyLimitTier> = [
  {
    minPeakHourVehTrips: 0,
    developmentExamples:
      "Fast-food / service station (corner); mini-mart or convenience store; other developments under 200 peak-hour vehicle trips",
    studyExtent:
      "Corner uses: the adjacent intersection. Convenience: 660 ft from the access drive. Otherwise: 1,000 ft from the access drive.",
  },
  {
    minPeakHourVehTrips: 200,
    developmentExamples:
      "Shopping center < 70,000 sq ft GLA, or any development generating 200–500 peak-hour vehicle trips",
    studyExtent:
      "All signalized intersections and access drives within 0.5 mile, plus all major unsignalized intersections and access drives within 0.25 mile.",
  },
  {
    minPeakHourVehTrips: 500,
    developmentExamples:
      "Shopping center 70,000–100,000 sq ft GLA; office/industrial park with 300–500 employees; well-balanced mixed-use > 500 peak-hour vehicle trips",
    studyExtent:
      "All signalized and major unsignalized intersections and freeway ramps within 1 mile of a property line of the site.",
  },
  {
    minPeakHourVehTrips: 1000,
    developmentExamples:
      "Shopping center > 100,000 sq ft GLA; office/industrial park with > 500 employees; all other developments > 500 peak-hour vehicle trips (large)",
    studyExtent:
      "All signalized intersections and freeway ramps within 2 miles of a property line, plus all major unsignalized access (streets and driveways) within 1 mile.",
  },
];

/** Resolve the suggested study-limit tier for a project from its peak-hour
 *  vehicle-trip generation (§2.2, Table 3). Returns the largest tier whose
 *  threshold the project meets. */
export function resolveStudyLimitTier(peakHourVehTrips: number): StudyLimitTier {
  const t = Number.isFinite(peakHourVehTrips) ? Math.max(0, peakHourVehTrips) : 0;
  let chosen = STUDY_LIMIT_TIERS[0]!;
  for (const tier of STUDY_LIMIT_TIERS) if (t >= tier.minPeakHourVehTrips) chosen = tier;
  return chosen;
}

/** Does this project meet the MTIASD default study trigger? (§2.1) */
export function meetsStudyThreshold(peakHourVehTrips: number): boolean {
  return (Number.isFinite(peakHourVehTrips) ? peakHourVehTrips : 0) >= STUDY_THRESHOLD_DEFAULT.peakHourVehicleTrips;
}

// ─── §2.1 / §5.1 — Person-trip uplift over vehicle trips ──────────────────────

/**
 * The MTIASD's headline multimodal fact (§2.1, restated §5.1): a peak-hour
 * vehicle-trip count understates travel demand because it ignores people who
 * walk, bike, or ride transit. Total PERSON trips in a weekday peak hour run
 * ~20–30% above vehicle trips for typical residential/office uses, and ~100%
 * above for typical retail uses (urban/suburban setting). Used to scale a
 * vehicle-trip estimate up to person trips before mode split (estimatePersonTrips).
 */
export const PERSON_TRIP_UPLIFT = {
  residentialOffice: { minPct: 20, maxPct: 30 },
  retail: { pct: 100 },
} as const;

// ─── §5.1.1 / Table 6 — Person trips by mode (3-step method) ──────────────────

/** Average vehicle occupancy, NHTS "Summary of Travel Trends 2017" Table 16. */
export const NHTS_AVO = 1.67;

/** NHTS national baseline mode shares (Table 6, Step 1d). Auto driver = vehicle
 *  trips; auto passenger from AVO; transit + non-motorized from NHTS averages. */
export const NHTS_BASELINE_MODE_SHARE = {
  autoDriver: 0.495,
  autoPassenger: 0.332,
  transit: 0.025,
  nonMotorized: 0.149,
} as const;

export type ModeSplit = {
  autoDriver: number;
  autoPassenger: number;
  transit: number;
  nonMotorized: number;
  totalPersons: number;
  /** Vehicle trips = auto-driver trips (one driver per vehicle). */
  vehicleTrips: number;
};

export type PersonTripEstimate = {
  step1Baseline: ModeSplit;
  step2Local: ModeSplit;
  step3Tdm: ModeSplit | null;
  /** The estimate the analysis should carry forward (step 3 if TDM applied, else step 2). */
  final: ModeSplit;
  localTransitSharePct: number;
  tdmModalShiftPct: number | null;
};

const round = (n: number) => Math.round(n);

function splitFromShares(totalPersons: number, autoDriverShare: number, autoPassengerShare: number, transitShare: number, nonMotorizedShare: number): ModeSplit {
  const autoDriver = round(totalPersons * autoDriverShare);
  const autoPassenger = round(totalPersons * autoPassengerShare);
  const transit = round(totalPersons * transitShare);
  const nonMotorized = round(totalPersons * nonMotorizedShare);
  return { autoDriver, autoPassenger, transit, nonMotorized, totalPersons: round(totalPersons), vehicleTrips: autoDriver };
}

/**
 * Estimate site-generated person trips by mode from a vehicle-trip estimate,
 * following the MTIASD §5.1.1 / Table 6 three-step process:
 *   1. Baseline — expand vehicle trips to persons via NHTS AVO + national mode shares.
 *   2. Local — re-balance to the locally observed transit share (varies by metro/state).
 *   3. TDM — apply a site-specific modal shift (increase transit + non-motorized by X%),
 *      reassigning the freed auto persons proportionally between driver/passenger.
 *
 * @param vehicleTrips      gross site vehicle trips (the ITE TGM estimate)
 * @param localTransitSharePct  locally observed transit mode share, % (default 2.5 = NHTS)
 * @param tdmModalShiftPct  % increase in transit + non-motorized person trips from
 *                          site-specific TDM (null = no TDM step)
 */
export function estimatePersonTripsByMode(
  vehicleTrips: number,
  localTransitSharePct = NHTS_BASELINE_MODE_SHARE.transit * 100,
  tdmModalShiftPct: number | null = null,
): PersonTripEstimate {
  const V = Number.isFinite(vehicleTrips) ? Math.max(0, vehicleTrips) : 0;

  // Step 1 — baseline from NHTS. Auto driver = V; total persons follows from the
  // fixed auto-driver share, internally consistent with AVO.
  const totalPersons = V > 0 ? V / NHTS_BASELINE_MODE_SHARE.autoDriver : 0;
  const step1Baseline = splitFromShares(
    totalPersons,
    NHTS_BASELINE_MODE_SHARE.autoDriver,
    NHTS_BASELINE_MODE_SHARE.autoPassenger,
    NHTS_BASELINE_MODE_SHARE.transit,
    NHTS_BASELINE_MODE_SHARE.nonMotorized,
  );

  // Step 2 — adjust to local transit share; scale the non-transit modes to fill
  // the remainder, preserving total persons.
  const localTransit = Math.min(0.95, Math.max(0, localTransitSharePct / 100));
  const nonTransitBaseline = 1 - NHTS_BASELINE_MODE_SHARE.transit;
  const scale = nonTransitBaseline > 0 ? (1 - localTransit) / nonTransitBaseline : 0;
  const step2Local = splitFromShares(
    totalPersons,
    NHTS_BASELINE_MODE_SHARE.autoDriver * scale,
    NHTS_BASELINE_MODE_SHARE.autoPassenger * scale,
    localTransit,
    NHTS_BASELINE_MODE_SHARE.nonMotorized * scale,
  );

  // Step 3 — site-specific TDM modal shift (optional). Increase transit +
  // non-motorized person trips by tdmModalShiftPct; reassign the freed auto
  // persons proportionally between driver and passenger.
  let step3Tdm: ModeSplit | null = null;
  if (tdmModalShiftPct != null && totalPersons > 0) {
    const f = 1 + tdmModalShiftPct / 100;
    const newTransit = step2Local.transit * f;
    const newNonMotorized = step2Local.nonMotorized * f;
    const autoPersons = Math.max(0, totalPersons - newTransit - newNonMotorized);
    const autoBase = step2Local.autoDriver + step2Local.autoPassenger;
    const driverFrac = autoBase > 0 ? step2Local.autoDriver / autoBase : 0.5;
    const newDriver = autoPersons * driverFrac;
    const newPassenger = autoPersons * (1 - driverFrac);
    step3Tdm = {
      autoDriver: round(newDriver),
      autoPassenger: round(newPassenger),
      transit: round(newTransit),
      nonMotorized: round(newNonMotorized),
      totalPersons: round(totalPersons),
      vehicleTrips: round(newDriver),
    };
  }

  return {
    step1Baseline,
    step2Local,
    step3Tdm,
    final: step3Tdm ?? step2Local,
    localTransitSharePct: round(localTransit * 1000) / 10,
    tdmModalShiftPct,
  };
}

// ─── §7.2 Table 10 — Multimodal Q/LOS framework (per-mode considerations) ─────

/** Table 10: the quality-of-service considerations the analyst weighs per mode.
 *  Reproduced from the RP. Complements MULTIMODAL_QOS_MODES (qosBasis) in
 *  standard-methodology.ts with the fuller consideration list. */
export const MULTIMODAL_QOS_FRAMEWORK: ReadonlyArray<{ mode: string; considerations: ReadonlyArray<string> }> = [
  {
    mode: "Pedestrian",
    considerations: [
      "Presence, connectivity, and width of sidewalks",
      "Curb ramps, crosswalks meeting local design standards and ADA best practices",
      "Lateral separation, barriers, and buffers from traffic",
      "Spacing between crossing opportunities and crossing delays on arterials/collectors",
      "Delays at intersections; driveway frequency and volumes",
      "Visitor experience; curb extensions/raised tables and removing channelized right-turn lanes",
    ],
  },
  {
    mode: "Bicycle",
    considerations: [
      "Presence of a dedicated facility; network connectivity",
      "Level of Traffic Stress (LTS) metric",
      "Number and width of travel lanes adjacent to the route",
      "Volume and speed of traffic; physical separation/protection from motor vehicles",
      "Percentage of trucks and buses encountered; pavement condition",
      "Driveway frequency and volumes",
    ],
  },
  {
    mode: "Transit",
    considerations: [
      "Travel times/speed; ratio of auto to transit travel time",
      "Frequency of service; hours of service; reliability",
      "Passenger loads; dwell time (component of travel time)",
      "Presence of and ADA accessibility of bus shelters; rider amenities (benches, shelters, etc.)",
    ],
  },
  {
    mode: "Automobile",
    considerations: [
      "Corridor travel times; intersection delay",
      "Queue length; design speed",
    ],
  },
];

// ─── §7.8 Table 14 — Transit proximity thresholds ────────────────────────────

export type TransitProximity = { mode: string; distanceMi: number };

/** Table 14: how far from the site each transit mode's stops/stations should be
 *  documented and analyzed. */
export const TRANSIT_PROXIMITY_THRESHOLDS: ReadonlyArray<TransitProximity> = [
  { mode: "Bus stops", distanceMi: 0.25 },
  { mode: "BRT / LRT stations", distanceMi: 0.5 },
  { mode: "Metro (heavy-rail) stations", distanceMi: 1.0 },
  { mode: "Commuter rail stations", distanceMi: 5.0 },
  { mode: "Other (ferry, funicular)", distanceMi: 1.0 },
];

/** The two transit Q/LOS indicators the RP says to disclose at minimum (§7.8.2):
 *  service frequency (headway) and the transit-to-auto travel-time ratio. Local
 *  agency thresholds govern; TCQSM (TCRP 165) is the fallback basis. */
export const TRANSIT_QOS_KEY_INDICATORS: ReadonlyArray<string> = [
  "Service frequency (peak / off-peak / late-night headway) vs. the adopted local frequency standard",
  "Transit-to-auto travel-time ratio (transit travel time ÷ auto travel time) for trips to/from the site",
];

/** Resolve the Table 14 documentation radius for a transit mode, defaulting to
 *  the bus threshold for unrecognized modes. */
export function transitProximityMi(mode: string): number {
  const m = mode.toLowerCase();
  if (m.includes("commuter")) return 5.0;
  if (m.includes("metro") || m.includes("heavy")) return 1.0;
  if (m.includes("brt") || m.includes("lrt") || m.includes("light")) return 0.5;
  if (m.includes("ferry") || m.includes("funicular")) return 1.0;
  return 0.25;
}

// ─── §7.5 Table 12 — Neighborhood-protection max desirable daily volumes ──────

/** Table 12 examples — maximum desirable daily traffic on local/neighborhood
 *  residential streets, well below physical capacity. Used to flag cut-through /
 *  neighborhood-intrusion impacts the RP says a study should address even when
 *  vehicular Q/LOS is met (§7.5). */
export const NEIGHBORHOOD_MAX_DAILY_VOLUMES: ReadonlyArray<{ jurisdiction: string; streetType: string; maxAdt: string }> = [
  { jurisdiction: "Pleasanton, CA", streetType: "2-lane local", maxAdt: "500–3,000" },
  { jurisdiction: "Pleasanton, CA", streetType: "2-lane residential collector", maxAdt: "3,000–6,000" },
  { jurisdiction: "Middleton, WI", streetType: "Local residential", maxAdt: "800" },
  { jurisdiction: "Middleton, WI", streetType: "Neighborhood collector", maxAdt: "3,000–5,000" },
  { jurisdiction: "Flagstaff, AZ", streetType: "Local residential", maxAdt: "500" },
  { jurisdiction: "Flagstaff, AZ", streetType: "Local residential (wide)", maxAdt: "1,000" },
];

export const NEIGHBORHOOD_PROTECTION_CRITERIA: ReadonlyArray<string> = [
  "Will not negatively impact a historic structure or place",
  "Will not raise traffic on local/collector streets above the adopted LOS standard for the impact area",
  "Will not create real or perceived cut-through traffic",
  "Will not push additional truck traffic, on-street parking pressure, or late-night noise/glare into the neighborhood",
];

/** Bicycle LTS mitigation target (§7.7): a connected LTS-2-or-better network
 *  between the site and key destinations within this radius. */
export const BICYCLE_LTS_TARGET = {
  maxLts: 2,
  radiusFt: 750,
  basis: "Connect the site to key destinations via a Level-of-Traffic-Stress 2 (LTS-2) or better network within ~750 ft (Mineta Transportation Institute LTS framework; RP §7.7).",
} as const;

/** When a quantitative ped/bike Q/LOS analysis is warranted vs. a qualitative
 *  check (§7.6 / §7.7): quantitative if active-travel demand approaches/exceeds
 *  capacity or the site itself generates high active travel; else qualitative. */
export const ACTIVE_MODE_QUALITATIVE_CHECKLIST: ReadonlyArray<string> = [
  "Completeness of the on-site pedestrian/bicycle network",
  "Accessibility for users of all abilities (ADA accommodations)",
  "Connectivity of the site network to the surrounding area and nearby shared-use paths",
  "Directness/convenience of routes between destinations (not circuitous)",
  "Gaps in area facilities that could discourage walking/biking to the site",
  "Adequate width, queuing/waiting areas, and separation/buffers from motor vehicles",
  "Frequency and design of street-crossing opportunities (controlled or uncontrolled)",
];

// ─── §7.9 Travel Demand Management ────────────────────────────────────────────

/** §7.9.1 typical TDM techniques (+ Figure 24 categories). Two strategy types:
 *  physical/developer-committed actions, and non-physical/in-kind commitments. */
export const TDM_TECHNIQUES: ReadonlyArray<{ category: string; technique: string }> = [
  { category: "Parking", technique: "Reduce the number of parking spaces; unbundle and price parking from the lease/unit cost" },
  { category: "Parking", technique: "Charge for employee parking and/or provide parking cash-out for those who do not drive" },
  { category: "Programs", technique: "Hire or subsidize a transportation coordinator; use a Transportation Management Association (TMA)" },
  { category: "Programs", technique: "Carpool/vanpool support — ride-matching, parking-fee discounts, preferential parking, guaranteed ride home" },
  { category: "Programs", technique: "Shuttle / micro-transit services to transit stations or key destinations" },
  { category: "Programs", technique: "Transit subsidies and incentives to ride transit, bike, or share rides" },
  { category: "Programs", technique: "Telecommute / work-from-home programs" },
  { category: "Programs", technique: "Modified work schedules (flextime, staggered shifts, 4-day weeks)" },
  { category: "Mode share", technique: "High-quality on-site pedestrian environment and connections to the off-site network" },
  { category: "Mode share", technique: "Building amenities — secure bike parking (lockers/rooms), showers and changing facilities" },
  { category: "Mode share", technique: "Improve transit service/access; provide micromobility options (bike/scooter share)" },
  { category: "Mode share", technique: "On-site car-share priority parking and/or shared vehicles" },
  { category: "Outreach", technique: "Marketing campaigns on the benefits (including health) of choosing other modes" },
];

/** §7.9.2: modified work schedules / flextime can spread and reduce peak-hour
 *  vehicle traffic by up to ~25% where many employees share identical schedules. */
export const TDM_MODIFIED_SCHEDULE_MAX_REDUCTION_PCT = 25;

/** §7.9.3: the 9-step procedure to estimate and document TDM effectiveness so a
 *  reviewing agency can accept the trip reduction. */
export const TDM_EFFECTIVENESS_PROCEDURE: ReadonlyArray<string> = [
  "Identify policies/ordinances of the agencies that provide TDM guidance or metrics",
  "Describe quantifiable objectives (e.g., % reduction in PM peak-hour vehicle trips, % non-SOV, target AVO)",
  "Identify specific candidate TDM actions in the site's design, operations, and incentive programs",
  "Determine the base conditions relative to each TDM action inherent in the base trip-generation estimate",
  "From local data / accepted studies, determine the change attributable to each action — do not double-count across measures",
  "Apply the reductions as appropriate",
  "Document how continued TDM performance is a requirement of development/ownership (and tenant obligations)",
  "Discuss the actions and reductions with study reviewers to ensure acceptance",
  "Obtain legally binding commitments for post-opening monitoring and ongoing operation (with remedies/penalties if targets are missed)",
];

// ─── §11.2 Pro-Rata Share Districts + §11.3 VMT ───────────────────────────────

/**
 * §11.2 Pro-Rata Share District (PSD): a defined geographic area where developers
 * pay toward needed transportation improvements in proportion to the need they
 * create (rational nexus). Distinct from Special Assessment Districts (tax-based).
 * The PSD goes by different statutory names by state — the "vary by state" hook.
 */
export const PSD_STATE_TERMINOLOGY: Record<string, string> = {
  DE: "Transportation Improvement District",
  FL: "Multimodal Transportation District",
  OR: "System Development Charge",
  MD: "Traffic Mitigation Zone",
};

/** Resolve the local statutory name for a pro-rata share program by state, with
 *  the generic term as the fallback (§11.2). */
export function psdTerminologyForState(stateCode: string | undefined): string {
  return (stateCode && PSD_STATE_TERMINOLOGY[stateCode]) || "Pro-Rata Share District (impact-fee district)";
}

export const PSD_WHEN_TO_CONSIDER: ReadonlyArray<string> = [
  "Areas experiencing or expecting sudden growth, where a unified planning effort better assesses impacts",
  "Areas with large infrastructure needs, to focus developer contributions and supplement public funds",
  "Areas with developments of varying sizes, to distribute costs more equitably",
  "Concurrency areas — a district eases pressure on rural areas and removes the capacity 'free-rider' problem",
];

export const PSD_ESSENTIAL_FACTORS: ReadonlyArray<string> = [
  "Which jurisdictions are involved (often city + county + state + transit agency, via intergovernmental agreement)",
  "Defining the district boundary (prefer edges with few access points — streams, rail lines, expressways)",
  "Determining the improvements that will be funded (from an upfront MTIA-style district study; multimodal where relevant)",
  "Apportioning cost via a rational-nexus fee formula — typically vehicle or person trips, possibly weighted by trip length",
];

/**
 * §11.3 Vehicle Miles Traveled. VMT = vehicle trip generation × average trip
 * length. An emerging (not yet "recommended") development-review metric that the
 * RP discusses; adopted statewide only in California (SB 743). controllingImpactParadigm()
 * in standard-methodology.ts decides whether VMT or LOS governs by state.
 */
export const VMT_GUIDANCE = {
  definition: "VMT = vehicle trip generation × average trip length. It correlates with congestion, emissions, fuel use, and carbon footprint better than raw trip counts, and captures the regional benefit of locating uses to shorten trips.",
  caThreshold:
    "California (OPR/SB 743): a development whose per-unit VMT (per capita / per employee / per sq ft) is below the regional average is presumed to have no significant transportation impact, unless a safety trigger applies.",
  safetyTriggers: [
    "Additional development traffic predicted to create a ~15-mph speed differential between adjacent travel lanes",
    "Additional development traffic predicted to cause an off-ramp queue to back up onto a freeway",
  ],
  advantages: [
    "Evaluates land-use type and location in a regional context (e.g., the Sacramento Kings downtown-arena relocation reduced overall VMT)",
    "Captures cumulative benefits of complementary uses that shorten trips (housing next to retail, etc.)",
  ],
  limitations: [
    "A comparison to a regional average can penalize non-core/suburban jurisdictions whose VMT rates are inherently higher",
    "VMT alone can overlook localized safety; pair it with safety standards and methodologies",
  ],
} as const;

