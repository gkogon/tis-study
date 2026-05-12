/**
 * Parking Demand Study engine.
 *
 * Computes peak parking demand per ITE Parking Generation 5th Ed. for a
 * given land use + size, compares against:
 *   - The local code minimum (City of Atlanta defaults; engineers can
 *     override per-jurisdiction in the request).
 *   - The proposed parking supply.
 *
 * Returns a structured result suitable for a screening-level Parking
 * Demand Study deliverable. Hourly profiles are derived from ITE PG
 * Figures 2.1 (weekday) / 2.2 (Saturday) — normalized fractions of peak
 * demand applied uniformly across major retail/residential/office uses.
 * Site-specific tuning lives in `intersection_calibration` analogues we
 * can add later; this is intentionally simple for the screening tier.
 */
import {
  type GenerateParkingBodyT,
  type GenerateParkingResponseT,
} from "@workspace/tis-api-zod";
import { PARKING_LAND_USES } from "./land-uses";

// Re-export so existing callers (route handlers) keep importing from
// this module without churn.
export { PARKING_LAND_USES };

// Hourly demand profile as fraction of peak (ITE PG 5th Ed. Fig 2.1-2.2,
// generalized). 24 entries, hour 0..23.
// Office / industrial: tight weekday peak 09–17.
const OFFICE_WEEKDAY = [0, 0, 0, 0, 0, 0, 0.05, 0.40, 0.85, 1.00, 1.00, 0.95, 0.80, 0.95, 1.00, 1.00, 0.95, 0.65, 0.20, 0.10, 0.05, 0.02, 0.01, 0];
const OFFICE_SATURDAY = [0, 0, 0, 0, 0, 0, 0, 0.05, 0.10, 0.18, 0.20, 0.20, 0.18, 0.15, 0.12, 0.10, 0.08, 0.05, 0.02, 0.01, 0, 0, 0, 0];
// Retail / restaurant: midday weekday + Sat afternoon peak.
const RETAIL_WEEKDAY = [0, 0, 0, 0, 0, 0, 0.05, 0.15, 0.30, 0.55, 0.75, 0.95, 1.00, 0.90, 0.80, 0.85, 0.95, 0.95, 0.85, 0.60, 0.40, 0.20, 0.10, 0.05];
const RETAIL_SATURDAY = [0, 0, 0, 0, 0, 0, 0.05, 0.20, 0.45, 0.70, 0.90, 1.00, 1.00, 0.95, 0.90, 0.95, 0.95, 0.90, 0.75, 0.55, 0.40, 0.25, 0.15, 0.08];
// Residential: inverse of office — peak overnight, low midday.
const RESIDENTIAL_WEEKDAY = [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.95, 0.80, 0.55, 0.40, 0.40, 0.40, 0.40, 0.42, 0.45, 0.50, 0.65, 0.85, 0.90, 0.92, 0.95, 0.98, 1.00, 1.00];
const RESIDENTIAL_SATURDAY = [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.98, 0.90, 0.75, 0.65, 0.60, 0.60, 0.60, 0.62, 0.65, 0.70, 0.78, 0.88, 0.92, 0.95, 0.97, 0.98, 1.00, 1.00];

// Lookup tables that map land-use code → hourly-demand profile family.
// Residential = peak overnight, low midday. Office = tight 09-17 spike.
// Retail = bimodal weekday + flatter Saturday. Institutional & lodging
// fall through to retail because their shapes are dominated by a
// midday-to-afternoon curve at the screening fidelity we're claiming.
const RESIDENTIAL_CODES = new Set([
  "210", "215", "220", "221", "222", "230", "240",
  "251", "252", "253", "254",
]);
const OFFICE_CODES = new Set([
  "610", "630", "710", "712", "715", "720", "730", "750", "760", "770",
  "110", "130", "140", "150", "151",
]);

function profilesFor(code: string): { weekday: number[]; saturday: number[] } {
  if (RESIDENTIAL_CODES.has(code)) {
    return { weekday: RESIDENTIAL_WEEKDAY, saturday: RESIDENTIAL_SATURDAY };
  }
  if (OFFICE_CODES.has(code)) {
    return { weekday: OFFICE_WEEKDAY, saturday: OFFICE_SATURDAY };
  }
  return { weekday: RETAIL_WEEKDAY, saturday: RETAIL_SATURDAY };
}

export class ParkingEngineError extends Error {}

export function generateParkingReport(
  body: GenerateParkingBodyT,
): GenerateParkingResponseT {
  const landUse = PARKING_LAND_USES.find((lu) => lu.code === body.landUseCode);
  if (!landUse) {
    throw new ParkingEngineError(`Unknown land-use code: ${body.landUseCode}`);
  }

  const weekdayPeak = round(body.size * landUse.weekdayPeakRate);
  const saturdayPeak = round(body.size * landUse.saturdayPeakRate);
  const governingDemand = Math.max(weekdayPeak, saturdayPeak);
  const governingPeriod = saturdayPeak > weekdayPeak ? "saturday" : "weekday";

  const sharedUseReductionPct = body.sharedUseReductionPct ?? 0;
  const adjustedDemand = round(governingDemand * (1 - sharedUseReductionPct / 100));

  const perUnit = body.codeMinOverridePerUnit ?? landUse.codeMinPerUnit;
  const codeRequiredTotal = Math.ceil(body.size * perUnit);

  const proposed = body.proposedSpaces;
  const iteVerdict = verdictOf(proposed, adjustedDemand);
  const codeVerdict = verdictOf(proposed, codeRequiredTotal);
  // Governing comparison: the higher of ITE-adjusted demand vs code
  // minimum is what the engineer must satisfy.
  // Round to whole spaces — proposed and codeRequiredTotal are already
  // integers, adjustedDemand can be a fraction, and the schema demands
  // an int delta (you can't be 1.4 spaces short of a code minimum).
  const governingMin = Math.max(adjustedDemand, codeRequiredTotal);
  const governingDelta = Math.round(proposed - governingMin);

  const profiles = profilesFor(landUse.code);
  const hourlyProfileWeekday = profiles.weekday.map((frac, hour) => ({
    hour,
    demand: round(weekdayPeak * frac),
  }));
  const hourlyProfileSaturday = profiles.saturday.map((frac, hour) => ({
    hour,
    demand: round(saturdayPeak * frac),
  }));

  return {
    projectName: body.projectName,
    landUse: { code: landUse.code, name: landUse.name, unit: landUse.unit },
    size: body.size,
    demand: {
      weekdayPeak,
      saturdayPeak,
      governingDemand,
      governingPeriod,
      adjustedDemand,
      sharedUseReductionPct,
    },
    codeRequired: {
      perUnit,
      total: codeRequiredTotal,
      source: body.codeMinOverridePerUnit !== undefined
        ? "user_override"
        : "city_of_atlanta_default",
    },
    proposedSpaces: proposed,
    iteVerdict,
    codeVerdict,
    governingDelta,
    hourlyProfileWeekday,
    hourlyProfileSaturday,
    citations: [
      "ITE Parking Generation Manual, 5th Ed. — peak parking demand rates by land-use code.",
      "City of Atlanta Zoning Ordinance, Article 10 — Off-Street Parking and Loading.",
      ...(sharedUseReductionPct > 0
        ? ["ULI Shared Parking, 3rd Ed. — adjustment factors for mixed-use developments."]
        : []),
    ],
  };
}

function verdictOf(proposed: number, required: number): "surplus" | "match" | "deficit" {
  if (proposed > required) return "surplus";
  if (proposed === required) return "match";
  return "deficit";
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
