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
};

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
export const DESIGN_YEAR_HORIZON_DEFAULT = 20;
