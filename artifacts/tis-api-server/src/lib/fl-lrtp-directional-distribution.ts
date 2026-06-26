/**
 * Miami-Dade 2045 LRTP — Directional Trip Distribution accessor.
 *
 * Typed API over the per-TAZ cardinal-distribution tables published in the
 * Miami-Dade TPO 2045 LRTP "Directional Trip Distribution Report" (Gannett
 * Fleming, September 2019). The report summarizes the daily vehicle trips
 * leaving each of the 1,506 internal Southeast Regional Planning Model
 * (SERPM v8.0) TAZs into eight cardinal directions, expressed as a percentage
 * of that TAZ's outbound trips (intrazonal trips excluded).
 *
 * This is the authoritative trip-distribution basis the Miami-Dade Standard
 * TIS Methodology calls for: "Trip Distribution should be based on statistical
 * data such as the Traffic Analysis Zone-based cardinal distribution from the
 * current adopted Miami-Dade MPO Long Range Transportation Plan." It is FLORIDA
 * (Miami-Dade) specific — other regions use the four-step gravity model or
 * their own MPO/TPO distribution.
 *
 * The raw rows live in fl-lrtp-directional-distribution.data.ts (auto-generated
 * from the source PDF). This module never fabricates a distribution — when a
 * TAZ is not found it returns null and the caller defers to the methodology
 * meeting.
 */

import {
  LRTP_DIR_2015,
  LRTP_DIR_2045,
  type LrtpDirRow,
} from "./fl-lrtp-directional-distribution.data";
import {
  type CardinalDirection,
  CARDINALS,
  CARDINAL_DEFS,
  bearingToCardinal,
} from "./cardinal-directions";

// Re-export the shared cardinal taxonomy under the LRTP-flavored names that
// existing callers reference, so this module stays the FL entry point while
// the primitives live in one neutral place (cardinal-directions.ts).
export type { CardinalDirection };
export { bearingToCardinal };
export const LRTP_CARDINALS = CARDINALS;
export const LRTP_CARDINAL_DEFS = CARDINAL_DEFS;

export type LrtpYear = 2015 | 2045;

export type LrtpDistribution = {
  countyTaz: number;
  regionalTaz: number;
  /** Total daily outbound vehicle trips summarized for this origin TAZ. */
  totalTrips: number;
  year: LrtpYear;
  /** Percent of outbound trips leaving in each cardinal direction (sums ≈ 100). */
  pct: Record<CardinalDirection, number>;
};

export const LRTP_SOURCE =
  "Miami-Dade TPO 2045 LRTP, Directional Trip Distribution Report (Gannett Fleming, September 2019); Southeast Regional Planning Model (SERPM) v8.0. Appendix A = 2015 Base Year validation network; Appendix B = 2045 Cost Feasible Plan network.";

function rowsFor(year: LrtpYear): ReadonlyArray<LrtpDirRow> {
  return year === 2045 ? LRTP_DIR_2045 : LRTP_DIR_2015;
}

function toDistribution(row: LrtpDirRow, year: LrtpYear): LrtpDistribution {
  const pct = {} as Record<CardinalDirection, number>;
  for (let i = 0; i < LRTP_CARDINALS.length; i++) {
    pct[LRTP_CARDINALS[i]!] = row[3 + i] ?? 0;
  }
  return { countyTaz: row[0], regionalTaz: row[1], totalTrips: row[2], year, pct };
}

/** Directional distribution for a Miami-Dade County TAZ id. */
export function lrtpDistributionByCountyTaz(
  countyTaz: number,
  year: LrtpYear = 2015,
): LrtpDistribution | null {
  const row = rowsFor(year).find((r) => r[0] === countyTaz);
  return row ? toDistribution(row, year) : null;
}

/** Directional distribution for a SERPM Regional TAZ id. */
export function lrtpDistributionByRegionalTaz(
  regionalTaz: number,
  year: LrtpYear = 2015,
): LrtpDistribution | null {
  const row = rowsFor(year).find((r) => r[1] === regionalTaz);
  return row ? toDistribution(row, year) : null;
}

/**
 * Trip-weighted county-wide average directional split — a defensible
 * "typical Miami-Dade" distribution for screening when the project's specific
 * origin TAZ has not yet been selected from the SERPM TAZ map. The formal
 * submittal must use the project TAZ's row (confirmed at the methodology
 * meeting), not this aggregate.
 */
export function lrtpCountywideAverage(year: LrtpYear = 2015): Record<CardinalDirection, number> {
  const acc = {} as Record<CardinalDirection, number>;
  for (const d of LRTP_CARDINALS) acc[d] = 0;
  let totalWeight = 0;
  for (const r of rowsFor(year)) {
    const w = r[2];
    if (!(w > 0)) continue;
    totalWeight += w;
    for (let i = 0; i < LRTP_CARDINALS.length; i++) {
      acc[LRTP_CARDINALS[i]!] += (r[3 + i] ?? 0) * w;
    }
  }
  if (totalWeight === 0) return acc;
  for (const d of LRTP_CARDINALS) acc[d] = Math.round((acc[d] / totalWeight) * 10) / 10;
  return acc;
}

/** Number of TAZs covered for a given network year. */
export function lrtpTazCount(year: LrtpYear = 2015): number {
  return rowsFor(year).length;
}
