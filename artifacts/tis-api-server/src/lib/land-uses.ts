/**
 * Canonical land-use registry for the TIS screening engine.
 *
 * Trip-generation rates are sourced from PUBLIC, openly-published data
 * sets — no proprietary trip-generation manual is reproduced here:
 *
 *   - SANDAG (San Diego Association of Governments), "(Not So) Brief Guide
 *     of Vehicular Traffic Generation Rates for the San Diego Region"
 *     (April 2002). A freely-distributed MPO traffic-generation table.
 *     This is the primary per-land-use rate source.
 *   - NHTS 2017 (FHWA National Household Travel Survey, "Summary of Travel
 *     Trends," Table 3a) — 5.11 vehicle-trips per household per day (2017),
 *     used to corroborate the residential daily rate.
 *   - NCHRP Report 716 ("Travel Demand Forecasting: Parameters and
 *     Techniques," TRB 2012) — ~9.5–10 person-trips per household per day
 *     and per-employee office rates, used as an independent backstop.
 *
 * The retail/service rates (shopping center, supermarket, bank) are taken
 * directly from the SANDAG 2002 guide's own published rows (Community
 * Shopping Center, Supermarket, Walk-In Bank) — a free public source, not
 * a blended/proprietary input. Verified against the official SANDAG table:
 * https://www.sandiegocounty.gov/content/dam/sdc/pds/ceqa/LehmanTPM/38%20Appendix%20T9_SANDAG%20Trip%20Generation%20Rates.pdf
 *
 * Restaurant / fast-food land uses are intentionally NOT offered: there is
 * no clean free replacement rate for them and the screening engine should
 * not guess. A reviewing PE should supply a site-specific or
 * jurisdiction-approved rate for those uses.
 *
 * The screening engine may apply locale-specific calibration multipliers
 * from `intersection_calibration` to refine a result.
 *
 * Maintenance: when a newer public data release supersedes these, update
 * the rate AND its `source` string in place; never duplicate the table.
 */

/**
 * Provenance tag for a trip-generation rate.
 *
 *   - `nhts_2017`     FHWA National Household Travel Survey 2017 trend table.
 *   - `sandag_2002`   SANDAG 2002 vehicular traffic-generation guide (clean).
 *   - `nchrp_716`     NCHRP Report 716 parameter tables (per-employee/HH).
 *   - `blended_mpo`   Blended MPO screening guidance — not provably tied to a
 *                     single free source; surfaced as rough in the report.
 *   - `interpolated`  Derived from a defensible engineering ratio (e.g. an
 *                     office sized by employees instead of ksf). Flagged in
 *                     the methodology note AND the legal disclaimer so a
 *                     reviewing PE can verify the assumption.
 */
export type RateConfidence =
  | "nhts_2017"
  | "sandag_2002"
  | "nchrp_716"
  | "blended_mpo"
  | "interpolated";

/**
 * Alternate independent variable for a land use. Some land uses publish a
 * defensible secondary basis (e.g. an office sized by ksf GFA OR by
 * employees). Where a developer or PE has the secondary number handy but
 * not the primary, letting them enter what they have lowers the bounce
 * rate on the demo form without compromising the math.
 *
 * The directional splits, Sat multiplier, and pass-by / internal-capture
 * percentages stay tied to the LAND USE, not the variable choice — they
 * describe the trip pattern of the development type itself and don't
 * change because the developer counted employees instead of square feet.
 */
export type SecondaryVariable = {
  unit: string;
  unitShort: string;
  dailyRate: number;
  amRate: number;
  pmRate: number;
  confidence: RateConfidence;
  /** Free-source provenance string for this secondary rate. */
  source: string;
  /** Optional engineering note — e.g. "Derived at 250 sqft/employee". */
  note?: string;
};

export type LandUse = {
  code: string;
  name: string;
  unit: string;
  unitShort: string;
  dailyRate: number;
  amRate: number;
  pmRate: number;
  /** Provenance of the primary rate. */
  confidence: RateConfidence;
  /** Free-source provenance string for the primary rate. */
  source: string;
  directionalSplitPm: { in: number; out: number };
  amDirectionalIn: number;
  // Saturday-midday rate as a fraction of the PM peak rate.
  satMultiplier: number;
  passByPctPm: number;
  internalCapturePctPm: number;
  // Optional alternate independent variables. See SecondaryVariable.
  secondaryVariables?: SecondaryVariable[];
};

// Public-data trip-generation registry. Daily / AM peak / PM peak rates
// drawn from SANDAG 2002 (primary), corroborated by NHTS 2017 + NCHRP 716.
// Directional splits, Sat multipliers, pass-by % describe the trip PATTERN
// (not a proprietary rate) and use sensible screening-level defaults.
const SANDAG_2002 =
  "SANDAG 2002 “(Not So) Brief Guide of Vehicular Traffic Generation Rates for the San Diego Region”";
const NCHRP_716 = "NCHRP Report 716 (TRB 2012) per-employee parameter table";

export const LAND_USES: LandUse[] = [
  // ---------- Residential ----------
  // 210 — corroborated by NHTS 2017 Table 3a (5.11 veh-trips/HH/day) and
  // NCHRP 716 (~9.5–10 person-trips/HH/day).
  { code: "210", name: "Single-Family Detached Housing",          unit: "Dwelling Units",        unitShort: "DU",       dailyRate: 10.0, amRate: 0.80, pmRate: 1.00, confidence: "sandag_2002", source: `${SANDAG_2002}; corroborated by NHTS 2017 Table 3a (5.11 veh-trips/HH/day) + NCHRP 716 (~9.5–10 person-trips/HH/day)`, directionalSplitPm: { in: 0.63, out: 0.37 }, amDirectionalIn: 0.25, satMultiplier: 0.70, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "220", name: "Multifamily Housing / Apartment",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  6.0, amRate: 0.48, pmRate: 0.54, confidence: "sandag_2002", source: `${SANDAG_2002}; corroborated by NHTS 2017 Table 3a`, directionalSplitPm: { in: 0.61, out: 0.39 }, amDirectionalIn: 0.24, satMultiplier: 0.65, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Lodging ----------
  { code: "310", name: "Hotel",                                    unit: "Occupied Rooms",        unitShort: "rooms",    dailyRate: 10.0, amRate: 0.60, pmRate: 0.80, confidence: "sandag_2002", source: SANDAG_2002, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.59, satMultiplier: 0.95, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Institutional (Schools) ----------
  { code: "520", name: "Elementary / Primary School",             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 14.0, amRate: 4.50, pmRate: 1.30, confidence: "sandag_2002", source: SANDAG_2002, directionalSplitPm: { in: 0.46, out: 0.54 }, amDirectionalIn: 0.51, satMultiplier: 0.05, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "530", name: "High School",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 13.0, amRate: 4.00, pmRate: 1.20, confidence: "sandag_2002", source: SANDAG_2002, directionalSplitPm: { in: 0.43, out: 0.57 }, amDirectionalIn: 0.55, satMultiplier: 0.05, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Office ----------
  // 710 — SANDAG per-ksf primary; NCHRP 716 per-employee backstop.
  { code: "710", name: "General Office",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 20.0, amRate: 2.80, pmRate: 2.60, confidence: "sandag_2002", source: `${SANDAG_2002}; per-employee backstop from ${NCHRP_716}`, directionalSplitPm: { in: 0.17, out: 0.83 }, amDirectionalIn: 0.86, satMultiplier: 0.10, passByPctPm: 0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  3.50, amRate: 0.49, pmRate: 0.46, confidence: "nchrp_716", source: NCHRP_716, note: "NCHRP 716 general-office per-employee daily rate (~3.5 veh-trips/employee)" },
    ] },
  { code: "720", name: "Medical / Dental Office",                 unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 50.0, amRate: 3.00, pmRate: 5.50, confidence: "sandag_2002", source: SANDAG_2002, directionalSplitPm: { in: 0.28, out: 0.72 }, amDirectionalIn: 0.79, satMultiplier: 0.20, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Retail / Commercial ----------
  // 820 / 850 / 912 — blended MPO screening guidance; disclosed as rough.
  { code: "820", name: "Shopping Center / Retail",                unit: "1,000 sqft GLA",        unitShort: "ksf",      dailyRate: 80.0, amRate: 3.20, pmRate: 8.00, confidence: "sandag_2002", source: `${SANDAG_2002} — Community Shopping Center (daily 80/ksf; PM pass-by 30%)`, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "850", name: "Supermarket",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 150.0, amRate: 6.00, pmRate: 15.0, confidence: "sandag_2002", source: `${SANDAG_2002} — Supermarket (daily 150/ksf; PM pass-by 40%)`, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.62, satMultiplier: 1.20, passByPctPm: 40, internalCapturePctPm: 0 },
  { code: "912", name: "Bank",                                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 150.0, amRate: 6.00, pmRate: 12.0, confidence: "sandag_2002", source: `${SANDAG_2002} — Bank, Walk-In (daily 150/ksf; PM pass-by 25%); drive-through banks run higher (≈200/ksf), PE selects per project`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 0.40, passByPctPm: 25, internalCapturePctPm: 0 },

  // ---------- Industrial / Warehouse ----------
  // 110 / 130 / 140 / 150 share the SANDAG industrial-park rate (clean).
  { code: "110", name: "Light Industrial",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  8.0, amRate: 0.88, pmRate: 0.96, confidence: "sandag_2002", source: `${SANDAG_2002} — industrial park`, directionalSplitPm: { in: 0.19, out: 0.81 }, amDirectionalIn: 0.81, satMultiplier: 0.15, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "130", name: "Industrial Park",                         unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  8.0, amRate: 0.88, pmRate: 0.96, confidence: "sandag_2002", source: `${SANDAG_2002} — industrial park`, directionalSplitPm: { in: 0.21, out: 0.79 }, amDirectionalIn: 0.81, satMultiplier: 0.15, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "140", name: "Manufacturing",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  8.0, amRate: 0.88, pmRate: 0.96, confidence: "sandag_2002", source: `${SANDAG_2002} — industrial park`, directionalSplitPm: { in: 0.36, out: 0.64 }, amDirectionalIn: 0.78, satMultiplier: 0.15, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "150", name: "Warehousing",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  8.0, amRate: 0.88, pmRate: 0.96, confidence: "sandag_2002", source: `${SANDAG_2002} — industrial park`, directionalSplitPm: { in: 0.27, out: 0.73 }, amDirectionalIn: 0.78, satMultiplier: 0.15, passByPctPm: 0, internalCapturePctPm: 0 },
];

/**
 * Resolve the active rate set + unit metadata for a given land use and the
 * variable the user picked. `variableUnitShort` matches against the primary
 * `unitShort` (default) or any secondary's `unitShort`. Returns the
 * resolved unit name + short label + daily/AM/PM rates + a `confidence`
 * tag + `source` provenance string the renderer surfaces in §4 of the
 * report so a reviewing PE can tell which assumption the screening relied
 * on. Falls back to the primary when `variableUnitShort` is undefined or
 * doesn't match a secondary.
 */
export type ResolvedRates = {
  unit: string;
  unitShort: string;
  dailyRate: number;
  amRate: number;
  pmRate: number;
  /** Provenance tag of the resolved rate (primary or matched secondary). */
  confidence: RateConfidence;
  /** Free-source provenance string for the resolved rate. */
  source: string;
  /** Engineering note for the chosen variable, when present. */
  note?: string;
  /** True iff a secondary variable was matched (not the primary). */
  isSecondary: boolean;
};

export function resolveRatesForVariable(lu: LandUse, variableUnitShort?: string): ResolvedRates {
  if (variableUnitShort && variableUnitShort !== lu.unitShort) {
    const sec = lu.secondaryVariables?.find((s) => s.unitShort === variableUnitShort);
    if (sec) {
      return {
        unit: sec.unit,
        unitShort: sec.unitShort,
        dailyRate: sec.dailyRate,
        amRate: sec.amRate,
        pmRate: sec.pmRate,
        confidence: sec.confidence,
        source: sec.source,
        note: sec.note,
        isSecondary: true,
      };
    }
  }
  // Primary — the canonical public-sourced rate for this code.
  return {
    unit: lu.unit,
    unitShort: lu.unitShort,
    dailyRate: lu.dailyRate,
    amRate: lu.amRate,
    pmRate: lu.pmRate,
    confidence: lu.confidence,
    source: lu.source,
    isSecondary: false,
  };
}
