/**
 * Per-region measured background-traffic growth rate, sourced from
 * historical AADT layers published by state DOTs.
 *
 * Both the engine (`tis.ts`) and the renderer (`pdf-export.ts`) read
 * from this module so the renderer prose and the engine's projected
 * volumes stay consistent: the §5 Background Growth paragraph and the
 * §6 No-Build / Build LOS tables both reflect the SAME measured rate
 * for the metro, not a screening default in one place and a measured
 * value in the other.
 *
 * Currently populated for the 5 IL metros from IDOT's Historical AADT
 * FeatureServer (2020 → 2025 segment match by INVENTORY). Generalizes
 * cleanly — every state DOT that publishes per-year AADT snapshots
 * (GA / FL / TX / NY / CA all do) can be wired the same way.
 * Refresh: re-run `scripts/src/fetch-il-growth-rate.ts` and copy the
 * resulting per-metro median CAGR + IQR into the table below.
 */

export type MeasuredGrowthRate = {
  /** Per-segment median compound annual growth rate, percentage points. */
  growthPct: number;
  /** Year of the early snapshot used for the trend. */
  yearFrom: number;
  /** Year of the late snapshot used for the trend. */
  yearTo: number;
  /** Number of segments matched across the two snapshots — sample size. */
  stations: number;
  /** 25th percentile of the per-segment CAGR distribution, in % per year. */
  p25Pct: number;
  /** 75th percentile of the per-segment CAGR distribution, in % per year. */
  p75Pct: number;
  /** Source citation written into the result payload's `growthSource`
   *  field — the renderers print this verbatim, so it should name the
   *  authoritative DOT layer that the rate came from. Optional with a
   *  per-state group default. */
  source?: string;
};

/** Per-state source citations for the per-metro CAGR data. The
 *  engine writes this into `r.growthSource` so each renderer can
 *  cite the authoritative DOT layer. */
const SOURCE_BY_STATE: Record<string, string> = {
  IL: "IDOT Historical AADT FeatureServer (per-year polyline snapshots; segment match by INVENTORY)",
  NY: "NYSDOT Traffic_Monitoring AADT FeatureServer layer 1 (rolling per-station actual counts; CAGR across oldest and newest non-null actual values)",
  FL: "FDOT TDA Annual_Average_Daily_Traffic_Historical FeatureServer layer 0 (per-year polyline snapshots; segment match by COSITE composite site ID)",
  GA: "Atlanta Regional Commission Open Data Hub — GDOT Traffic Counts (AADT and Truck Percent) 2008-2017 (per-station record with AADT_2008 … AADT_2017 columns; CAGR across earliest and latest non-null AADT per Station_ID, ≥5yr span)",
  TX: "TxDOT TPP TMB_RPT_SHORT_AADT_HIST 5-Year Statewide AADT Traffic Counts FeatureServer (per-station LATEST_AADT_YR + AADT_RPT_QTY + AADT_RPT_HIST_01..HIST_04; CAGR across earliest and latest non-null AADT per TRFC_STATN_ID; coverage uneven — only metros with n ≥ 100 wired here)",
};

const STATE_BY_METRO: Record<string, string> = {
  // IL
  chicago_metro: "IL", springfield_il_metro: "IL", rockford_metro: "IL", peoria_metro: "IL", champaign_metro: "IL",
  // NY
  new_york_metro: "NY", albany_metro: "NY", buffalo_metro: "NY", rochester_ny_metro: "NY", syracuse_metro: "NY",
  // FL
  tampa_metro: "FL", orlando_metro: "FL", miami_dade_metro: "FL", jacksonville_metro: "FL",
  fort_lauderdale_metro: "FL", west_palm_beach_metro: "FL", daytona_beach_metro: "FL",
  lakeland_metro: "FL", tallahassee_metro: "FL", fort_myers_metro: "FL", pensacola_metro: "FL",
  sarasota_metro: "FL",
  // GA
  atlanta_metro: "GA", savannah_metro: "GA", augusta_metro: "GA", columbus_ga_metro: "GA", macon_metro: "GA",
  // TX (only DFW + McAllen wired — others below n≥100 confidence floor)
  dallas_fort_worth_metro: "TX", mcallen_metro: "TX",
};

/** Return the authoritative DOT-layer citation for a metro's measured
 *  growth rate. Used by the engine to populate result.growthSource. */
export function getMeasuredGrowthSource(regionCode: string): string | undefined {
  const state = STATE_BY_METRO[regionCode];
  return state ? SOURCE_BY_STATE[state] : undefined;
}

const RATES: Record<string, MeasuredGrowthRate> = {
  // Illinois — IDOT Historical AADT FeatureServer 2020 + 2025 (script:
  // scripts/src/fetch-il-growth-rate.ts; raw output:
  // artifacts/api-server/src/data/il-growth-rates.json). Downstate
  // negatives are real and reflect post-COVID rural-IL dynamics.
  chicago_metro:        { growthPct:  1.80, yearFrom: 2020, yearTo: 2025, stations: 646, p25Pct: -1.69, p75Pct:  5.92 },
  springfield_il_metro: { growthPct: -1.87, yearFrom: 2020, yearTo: 2025, stations:  14, p25Pct: -8.28, p75Pct:  4.80 },
  rockford_metro:       { growthPct: -0.66, yearFrom: 2020, yearTo: 2025, stations:  33, p25Pct: -1.47, p75Pct:  2.74 },
  peoria_metro:         { growthPct: -1.34, yearFrom: 2020, yearTo: 2025, stations:  73, p25Pct: -5.92, p75Pct:  2.56 },
  champaign_metro:      { growthPct:  1.30, yearFrom: 2020, yearTo: 2025, stations:  43, p25Pct: -2.29, p75Pct:  4.76 },

  // New York — NYSDOT Traffic_Monitoring AADT FeatureServer layer 1
  // (script: scripts/src/fetch-ny-growth-rate.ts; raw output:
  // artifacts/api-server/src/data/ny-growth-rates.json). NY uses the
  // rolling-4-actual-counts per station shape (vs IL's per-year
  // snapshot layers) so the per-station CAGR spans the oldest and
  // newest non-null actual counts — typically a 3-4 year window.
  // The aggregate yearFrom-yearTo below shows the absolute min/max
  // across all stations included in the median; the typical station
  // span is closer to 4 years. Statewide medians are essentially
  // flat — consistent with mature-network NY traffic patterns and
  // post-COVID remote-work persistence in the metro counties.
  new_york_metro:        { growthPct:  0.07, yearFrom: 2000, yearTo: 2019, stations: 12244, p25Pct: -1.57, p75Pct: 1.80 },
  albany_metro:          { growthPct:  0.02, yearFrom: 2000, yearTo: 2019, stations:  2050, p25Pct: -1.42, p75Pct: 1.28 },
  buffalo_metro:         { growthPct:  0.13, yearFrom: 2000, yearTo: 2019, stations:  3171, p25Pct: -1.24, p75Pct: 1.48 },
  rochester_ny_metro:    { growthPct:  0.01, yearFrom: 2000, yearTo: 2019, stations:  1892, p25Pct: -1.45, p75Pct: 1.40 },
  syracuse_metro:        { growthPct:  0.00, yearFrom: 2000, yearTo: 2019, stations:  1492, p25Pct: -1.16, p75Pct: 1.39 },

  // Florida — FDOT TDA Annual_Average_Daily_Traffic_Historical 2021 +
  // 2025 layers (script: scripts/src/fetch-fl-growth-rate.ts; raw
  // output: artifacts/api-server/src/data/fl-growth-rates.json). All
  // 11 FDOT metros wired. Florida is uniformly growing — the slowest
  // metros (Tallahassee, Pensacola) still trend positive; the fastest
  // (Fort Lauderdale 3.66%/yr) reflects real Sun Belt population
  // influx and housing-driven trip generation. Sample sizes are
  // robust (352-2181 sites per metro, all measured against the
  // stable COSITE composite ID).
  // Texas — TxDOT TPP TMB_RPT_SHORT_AADT_HIST 5-year service
  // (script: scripts/src/fetch-tx-growth-rate.ts; raw output:
  // artifacts/api-server/src/data/tx-growth-rates.json). Window
  // 2020-2024 (LATEST_AADT_YR = 2024 statewide; HIST_01..HIST_04
  // are 2023..2020). Coverage is uneven — TxDOT count stations
  // are concentrated on the state highway system, so Dallas-Fort
  // Worth (n=1971) has solid coverage while Houston / Austin /
  // San Antonio / El Paso get <10 stations each (city streets
  // are counted by the host municipality, not TxDOT). Only metros
  // with n ≥ 100 are wired here; the other TX metros fall back to
  // the screening default.
  dallas_fort_worth_metro: { growthPct: 1.77, yearFrom: 2020, yearTo: 2024, stations: 1971, p25Pct: -4.68, p75Pct: 7.99 },
  mcallen_metro:           { growthPct: 2.20, yearFrom: 2020, yearTo: 2024, stations:  117, p25Pct: -3.96, p75Pct: 8.28 },

  // Georgia — Atlanta Regional Commission Open Data Hub
  // re-publication of GDOT AADT 2008-2017 (script:
  // scripts/src/fetch-ga-growth-rate.ts; raw output: artifacts/api-
  // server/src/data/ga-growth-rates.json). GDOT does NOT publish a
  // multi-year historical AADT layer through their own ArcGIS REST
  // endpoint — the ARC republication is a single feature service
  // with per-station AADT_2008 … AADT_2017 columns plus a stable
  // Station_ID. Trade-off: window ends at 2017 (pre-COVID). For
  // projects entitled now, the 9-year 2008-2017 trend better
  // represents structural Atlanta-metro growth than the COVID-
  // distorted 2020-2025 window would.
  atlanta_metro:         { growthPct:  0.92, yearFrom: 2008, yearTo: 2017, stations: 5148, p25Pct: -0.66, p75Pct: 2.52 },
  savannah_metro:        { growthPct:  0.82, yearFrom: 2008, yearTo: 2017, stations:  818, p25Pct: -0.96, p75Pct: 2.59 },
  augusta_metro:         { growthPct:  0.53, yearFrom: 2008, yearTo: 2017, stations:  536, p25Pct: -1.31, p75Pct: 2.38 },
  columbus_ga_metro:     { growthPct:  0.36, yearFrom: 2008, yearTo: 2017, stations:  561, p25Pct: -1.18, p75Pct: 2.01 },
  macon_metro:           { growthPct: -0.16, yearFrom: 2008, yearTo: 2017, stations:  612, p25Pct: -1.81, p75Pct: 1.14 },

  tampa_metro:           { growthPct:  2.92, yearFrom: 2021, yearTo: 2025, stations: 2129, p25Pct:  0.87, p75Pct: 6.05 },
  orlando_metro:         { growthPct:  2.14, yearFrom: 2021, yearTo: 2025, stations: 2181, p25Pct: -0.54, p75Pct: 5.63 },
  miami_dade_metro:      { growthPct:  2.74, yearFrom: 2021, yearTo: 2025, stations: 1747, p25Pct:  0.00, p75Pct: 6.66 },
  jacksonville_metro:    { growthPct:  1.69, yearFrom: 2021, yearTo: 2025, stations: 1411, p25Pct: -0.90, p75Pct: 4.35 },
  fort_lauderdale_metro: { growthPct:  3.66, yearFrom: 2021, yearTo: 2025, stations: 1377, p25Pct:  1.12, p75Pct: 6.99 },
  west_palm_beach_metro: { growthPct:  2.50, yearFrom: 2021, yearTo: 2025, stations:  814, p25Pct:  0.42, p75Pct: 4.66 },
  daytona_beach_metro:   { growthPct:  1.47, yearFrom: 2021, yearTo: 2025, stations:  352, p25Pct: -1.96, p75Pct: 3.45 },
  lakeland_metro:        { growthPct:  3.11, yearFrom: 2021, yearTo: 2025, stations:  457, p25Pct:  0.47, p75Pct: 5.97 },
  tallahassee_metro:     { growthPct:  0.73, yearFrom: 2021, yearTo: 2025, stations:  414, p25Pct: -0.79, p75Pct: 2.93 },
  fort_myers_metro:      { growthPct:  2.48, yearFrom: 2021, yearTo: 2025, stations:  445, p25Pct:  0.90, p75Pct: 5.82 },
  pensacola_metro:       { growthPct:  0.30, yearFrom: 2021, yearTo: 2025, stations:  555, p25Pct: -1.98, p75Pct: 2.78 },
  sarasota_metro:        { growthPct:  2.86, yearFrom: 2021, yearTo: 2025, stations:  623, p25Pct:  0.78, p75Pct: 5.83 },
};

export function getMeasuredGrowthRate(regionCode: string): MeasuredGrowthRate | undefined {
  return RATES[regionCode];
}

/**
 * Design-year horizon offset from opening year. IL D8 Appx. A and
 * BLRS §27-6.02(a) mandate 20 years from construction completion;
 * most US state DOTs converge on the same number. Encoded as a
 * single constant so the engine can compute Design-Year scenarios
 * uniformly. Per-state overrides can be layered later if any state
 * deviates (e.g. a 3R-project shorter horizon).
 */
/** Marker that opens `growthSource` when the request supplied its own
 *  growth rate. The renderers branch on this: the measured-derivation
 *  wording ("derived from measured per-segment CAGR at DOT count
 *  stations") is FALSE for an overridden rate, and an override that a
 *  reviewer cannot see is the failure this marker exists to prevent. */
export const GROWTH_OVERRIDE_PREFIX = "Explicit override";

/** True when `growthSource` describes an explicitly overridden rate
 *  rather than a measured one. */
export function isGrowthOverride(growthSource: string | null | undefined): boolean {
  return typeof growthSource === "string" && growthSource.startsWith(GROWTH_OVERRIDE_PREFIX);
}

export const DESIGN_YEAR_HORIZON_DEFAULT = 20;
