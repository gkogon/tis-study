// Per-period project trip generation — moved VERBATIM out of artifacts/
// tis-api-server/src/lib/tis.ts (periodRawTrips, periodDirectionalIn) plus the
// pass-by / internal-capture / auto-mode credit chain that generateTisReport's
// period loop applies, lifted into one function so the server and the browser
// scenario solver run the identical arithmetic. Pure: land-use registry data in,
// numbers out.
import type { LandUse, ResolvedRates } from "./land-uses.ts";
import type { AnalysisPeriod } from "./row-math.ts";

export function periodRawTrips(lu: LandUse, size: number, period: AnalysisPeriod, rates?: ResolvedRates): number {
  // Sat multiplier and directional split are inherent to the land use
  // (people don't change *when* they drive because the developer counted
  // employees instead of square feet) so they keep coming from `lu`;
  // only the size-vs-trips conversion factor switches with the variable.
  const dailyRate = rates?.dailyRate ?? lu.dailyRate;
  const amRate = rates?.amRate ?? lu.amRate;
  const pmRate = rates?.pmRate ?? lu.pmRate;
  switch (period) {
    case "am_peak": return amRate * size;
    case "pm_peak": return pmRate * size;
    case "saturday_midday": return pmRate * size * lu.satMultiplier;
    case "daily": return dailyRate * size;
  }
}

export function periodDirectionalIn(lu: LandUse, period: AnalysisPeriod): number {
  switch (period) {
    case "am_peak": return lu.amDirectionalIn;
    case "pm_peak": return lu.directionalSplitPm.in;
    case "saturday_midday": return 0.50;
    case "daily": return 0.50;
  }
}

/** The credit chain generateTisReport applies per period, step by step. */
export type PeriodExternalTrips = {
  /** Gross trips for the period: rate x size (Saturday x satMultiplier). */
  rawTrips: number;
  /** Pass-by credit. Full at the PM peak; 25% of the PM credit fraction in
   *  every other period (industry rule of thumb — off-peak has less pass-by). */
  passByCredit: number;
  /** Internal-capture credit, taken after pass-by, scaled the same way. */
  internalCredit: number;
  /** External trips across every mode, floored at zero. */
  externalTripsAllModes: number;
  /** External AUTO trips — the only ones that load the off-site roadway. */
  externalTrips: number;
};

/**
 * Pass-by + internal-capture credits, then the auto-mode share, for one
 * analysis period. Pass-by / internal capture only credit in full at the PM
 * peak (the most defensible application); other periods apply 25% of the PM
 * credit fraction. Walk / transit / cycle trips do not contribute to
 * intersection v/c, so only the auto share is returned as `externalTrips`.
 *
 * This is the arithmetic generateTisReport ran inline before the move —
 * identical operations in identical order — for both the proposed use and the
 * optional existing-use credit (which calls this with the existing use's own
 * registry defaults and subtracts the result's `externalTrips`).
 */
export function externalTripsForPeriod(args: {
  lu: LandUse;
  size: number;
  period: AnalysisPeriod;
  rates?: ResolvedRates;
  /** Pass-by percentage at the PM peak, already clamped by the caller. */
  passByPct: number;
  /** Internal-capture percentage at the PM peak, already clamped by the caller. */
  internalCapturePct: number;
  /** Auto-mode share of external trips (0..1). */
  autoModeShare: number;
}): PeriodExternalTrips {
  const raw = periodRawTrips(args.lu, args.size, args.period, args.rates);
  const creditScale = args.period === "pm_peak" ? 1.0 : 0.25;
  const passByCredit = raw * (args.passByPct / 100) * creditScale;
  const internalCredit = (raw - passByCredit) * (args.internalCapturePct / 100) * creditScale;
  const externalTripsAllModes = Math.max(0, raw - passByCredit - internalCredit);
  const externalTrips = externalTripsAllModes * args.autoModeShare;
  return { rawTrips: raw, passByCredit, internalCredit, externalTripsAllModes, externalTrips };
}
