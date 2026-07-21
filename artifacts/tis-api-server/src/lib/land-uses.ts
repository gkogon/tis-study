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
 * Restaurant / fast-food rates ARE now offered (codes 930–934), sourced
 * from SANDAG 2002's own MEASURED "San Diego Traffic Generators" rows —
 * re-enabling a category previously gated as "no clean free source" now
 * that a verified free measured source is confirmed. Restaurant trip-gen
 * is highly site-specific, so a reviewing PE should still verify against a
 * local / jurisdiction-approved rate before submittal.
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
const SD_CITY_2003 =
  "City of San Diego LDC Trip Generation Manual (May 2003) — San Diego Traffic Generators measured data (locally measured, not ITE)";
// July 2026 re-derivation: every rate row below traces to one of
//   (a) the SANDAG 2002 guide's own published rows (daily rate × the row's
//       published AM/PM peak-hour % of ADT), used directly where the
//       published value sits within ~1.5× of prevailing screening levels
//       ("conservative screening rate" posture), or as the nearest-category
//       screening analog, tagged `interpolated`; or
//   (b) an independent per-employee reconstruction — public employment-
//       density planning figures × NCHRP 716 / NHTS 2017 per-employee
//       daily vehicle-trip rates — with the arithmetic shown in the source
//       string and SANDAG diurnal shares applied for the AM/PM peaks,
//       tagged `interpolated`. Used where SANDAG 2002 runs systematically
//       high vs current conditions (office, industrial, hospital, motel).
// No rate value or source string in this table derives from any edition of
// a proprietary trip-generation manual, nor from a government
// republication of one.

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
  // 710 — reconstructed, not copied: ≈4 emp/ksf (≈250 sqft GFA/employee,
  // the standard office planning density this file already uses for the
  // per-employee secondary) × ≈3.5 daily veh-trips/employee (NCHRP 716)
  // = 14/ksf; SANDAG office diurnal shares (AM 14%, PM 13% of ADT) give
  // the peaks. SANDAG's own measured office row (20/ksf) runs high vs
  // current conditions, so the reconstruction is the primary.
  { code: "710", name: "General Office",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 14.0, amRate: 1.96, pmRate: 1.82, confidence: "interpolated", source: `Reconstructed from independent public inputs — ≈4 employees/ksf (≈250 sqft GFA/employee office planning density) × ≈3.5 daily vehicle-trips/employee (${NCHRP_716}) ≈ 14/ksf; AM 14% / PM 13% diurnal shares from the ${SANDAG_2002} office rows`, directionalSplitPm: { in: 0.17, out: 0.83 }, amDirectionalIn: 0.86, satMultiplier: 0.10, passByPctPm: 0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  3.50, amRate: 0.49, pmRate: 0.46, confidence: "nchrp_716", source: NCHRP_716, note: "NCHRP 716 general-office per-employee daily rate (~3.5 veh-trips/employee)" },
    ] },
  { code: "720", name: "Medical / Dental Office",                 unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 50.0, amRate: 3.00, pmRate: 5.50, confidence: "sandag_2002", source: `${SANDAG_2002} — Medical-Dental Office, San Diego Traffic Generators primary (daily 50/ksf; AM 6%, PM 11% of ADT)`, directionalSplitPm: { in: 0.28, out: 0.72 }, amDirectionalIn: 0.79, satMultiplier: 0.20, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Retail / Commercial ----------
  // 820 / 850 / 912 — SANDAG 2002's own published retail rows.
  { code: "820", name: "Shopping Center / Retail",                unit: "1,000 sqft GLA",        unitShort: "ksf",      dailyRate: 80.0, amRate: 3.20, pmRate: 8.00, confidence: "sandag_2002", source: `${SANDAG_2002} — Community Shopping Center (daily 80/ksf; PM pass-by 30%)`, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "850", name: "Supermarket",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 150.0, amRate: 6.00, pmRate: 15.0, confidence: "sandag_2002", source: `${SANDAG_2002} — Supermarket (daily 150/ksf; AM 4%, PM 10% of ADT; SANDAG's own PM pass-by guidance 40%)`, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.62, satMultiplier: 1.20, passByPctPm: 40, internalCapturePctPm: 0 },
  { code: "912", name: "Bank",                                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 150.0, amRate: 6.00, pmRate: 12.0, confidence: "sandag_2002", source: `${SANDAG_2002} — Bank, Walk-In (daily 150/ksf; PM pass-by 25%); drive-through banks run higher (≈200/ksf), PE selects per project`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 0.40, passByPctPm: 25, internalCapturePctPm: 0 },

  // ---------- Industrial / Warehouse ----------
  // 110 / 130 / 150 — reconstructed, not copied: public employment-density
  // planning figures × ≈3 daily veh-trips/employee (NHTS 2017 commute legs
  // + a midday/visitor/delivery allowance; cf NCHRP 716's ≈3.5 for office),
  // with SANDAG 2002 diurnal shares for the AM/PM peaks. SANDAG's own
  // industrial rows (8/ksf park, 5/ksf warehouse) run high vs current
  // staffing. 140 is SANDAG's own Manufacturing/Assembly row (4/ksf).
  { code: "110", name: "Light Industrial",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 4.5, amRate: 0.50, pmRate: 0.54, confidence: "interpolated", source: `Reconstructed from independent public inputs — ≈1.5 employees/ksf (≈650 sqft GFA/employee light-industrial planning density) × ≈3 daily vehicle-trips/employee (NHTS 2017 commute legs + midday/visitor/delivery allowance) ≈ 4.5/ksf; AM 11% / PM 12% diurnal shares from the ${SANDAG_2002} Industrial Park row`, directionalSplitPm: { in: 0.19, out: 0.81 }, amDirectionalIn: 0.81, satMultiplier: 0.15, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "130", name: "Industrial Park",                         unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 4.5, amRate: 0.50, pmRate: 0.54, confidence: "interpolated", source: `Reconstructed from independent public inputs — ≈1.5 employees/ksf (≈650 sqft GFA/employee industrial-park planning density) × ≈3 daily vehicle-trips/employee (NHTS 2017 commute legs + midday/visitor/delivery allowance) ≈ 4.5/ksf; AM 11% / PM 12% diurnal shares from the ${SANDAG_2002} Industrial Park row`, directionalSplitPm: { in: 0.21, out: 0.79 }, amDirectionalIn: 0.81, satMultiplier: 0.15, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "140", name: "Manufacturing",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 4.0, amRate: 0.76, pmRate: 0.80, confidence: "sandag_2002", source: `${SANDAG_2002} — Manufacturing/Assembly (daily 4/ksf; AM 19%, PM 20% of ADT — shift-change peaked)`, directionalSplitPm: { in: 0.36, out: 0.64 }, amDirectionalIn: 0.78, satMultiplier: 0.15, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "150", name: "Warehousing",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 1.5, amRate: 0.20, pmRate: 0.23, confidence: "interpolated", source: `Reconstructed from independent public inputs — ≈0.5 employees/ksf (≈2,000 sqft GFA/employee warehouse planning density) × ≈3 daily vehicle-trips/employee (NHTS 2017 commute legs + midday/visitor/delivery allowance) ≈ 1.5/ksf; AM 13% / PM 15% diurnal shares from the ${SANDAG_2002} Warehousing row`, directionalSplitPm: { in: 0.27, out: 0.73 }, amDirectionalIn: 0.78, satMultiplier: 0.15, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Food / Beverage ----------
  // SANDAG 2002 MEASURED "San Diego Traffic Generators" rows (primary `*`).
  // Daily/AM/PM rates are the published values; directional splits, Sat
  // multipliers and pass-by % are screening-level pattern defaults (header).
  { code: "931", name: "Restaurant — Quality / Sit-Down",         unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 100.0, amRate: 1.00, pmRate: 8.00, confidence: "sandag_2002", source: `${SANDAG_2002} — Quality Restaurant, measured (daily 100/ksf; PM pass-by 10%)`, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.55, satMultiplier: 1.20, passByPctPm: 10, internalCapturePctPm: 0 },
  { code: "932", name: "Restaurant — High-Turnover Sit-Down",     unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 160.0, amRate: 12.80, pmRate: 12.80, confidence: "sandag_2002", source: `${SANDAG_2002} — Sit-Down High-Turnover Restaurant, measured (daily 160/ksf; PM pass-by 20%)`, directionalSplitPm: { in: 0.52, out: 0.48 }, amDirectionalIn: 0.55, satMultiplier: 1.20, passByPctPm: 20, internalCapturePctPm: 0 },
  { code: "934", name: "Fast Food w/ Drive-Through",              unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 650.0, amRate: 45.50, pmRate: 45.50, confidence: "sandag_2002", source: `${SANDAG_2002} — Fast Food w/ Drive-Through, measured (daily 650/ksf; PM pass-by 40%)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.52, satMultiplier: 1.10, passByPctPm: 40, internalCapturePctPm: 0 },
  { code: "930", name: "Delicatessen (breakfast / lunch)",        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 150.0, amRate: 13.50, pmRate: 4.50, confidence: "sandag_2002", source: `${SANDAG_2002} — Delicatessen 7a–4p, measured (daily 150/ksf)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.60, satMultiplier: 0.50, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Auto / Fuel ----------
  { code: "944", name: "Gas / Service Station",                   unit: "Fueling Positions",     unitShort: "VFP",      dailyRate: 150.0, amRate: 10.50, pmRate: 13.50, confidence: "sandag_2002", source: `${SANDAG_2002} — Older Service Station Design, measured (daily 150/fueling position; PM pass-by 50%)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.50, satMultiplier: 0.90, passByPctPm: 50, internalCapturePctPm: 0 },
  { code: "841", name: "Auto Sales (New Car Dealership)",         unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 50.0, amRate: 2.50, pmRate: 4.00, confidence: "sandag_2002", source: `${SANDAG_2002} — Automobile Sales, Dealer & Repair, San Diego Traffic Generators primary (daily 50/ksf; AM 5%, PM 8% of ADT) — bundles service/repair traffic, conservative for a sales-only dealership`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.60, satMultiplier: 1.10, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "942", name: "Auto Repair Center",                      unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 20.0, amRate: 1.60, pmRate: 2.20, confidence: "sandag_2002", source: `${SANDAG_2002} — Auto Repair Center, measured (daily 20/ksf)`, directionalSplitPm: { in: 0.45, out: 0.55 }, amDirectionalIn: 0.70, satMultiplier: 0.50, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Recreation / Civic ----------
  { code: "492", name: "Health / Racquetball Club",               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 30.0, amRate: 1.20, pmRate: 2.70, confidence: "sandag_2002", source: `${SANDAG_2002} — Racquetball / Health Club, measured (daily 30/ksf)`, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.55, satMultiplier: 0.90, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "444", name: "Movie Theater (Multiplex)",               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 80.0, amRate: 0.26, pmRate: 6.40, confidence: "sandag_2002", source: `${SANDAG_2002} — Multiplex Theater w/ Matinee, measured (daily 80/ksf; AM negligible — PM/evening use)`, directionalSplitPm: { in: 0.65, out: 0.35 }, amDirectionalIn: 0.50, satMultiplier: 1.40, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "430", name: "Golf Course",                             unit: "Acres",                 unitShort: "ac",       dailyRate: 7.0, amRate: 0.49, pmRate: 0.63, confidence: "sandag_2002", source: `${SANDAG_2002} — Golf Course, measured (daily 7/acre)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.60, satMultiplier: 1.40, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Retail / Storage (measured additions) ----------
  { code: "857", name: "Discount / Warehouse Club",               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 60.0, amRate: 0.60, pmRate: 5.40, confidence: "sandag_2002", source: `${SANDAG_2002} — Discount Club, measured (daily 60/ksf; PM pass-by 30%)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.60, satMultiplier: 1.20, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "151", name: "Mini-Warehouse / Self-Storage",           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 2.0, amRate: 0.12, pmRate: 0.18, confidence: "sandag_2002", source: `${SANDAG_2002} — Storage / Mini-Warehouse, measured (daily 2/ksf)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.50, satMultiplier: 0.90, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Residential (additional types) ----------
  // City of San Diego LDC Trip Generation Manual (May 2003) — measured
  // San Diego Traffic Generators data, NOT ITE. Directional splits / Sat
  // multipliers / pass-by are screening-level pattern defaults (header).
  { code: "230", name: "Condominium / Townhouse",                 unit: "Dwelling Units",        unitShort: "DU",       dailyRate: 8.0, amRate: 0.64, pmRate: 0.72, confidence: "sandag_2002", source: `${SD_CITY_2003} — Multiple Dwelling <20 DU/acre (daily 8/DU)`, directionalSplitPm: { in: 0.62, out: 0.38 }, amDirectionalIn: 0.25, satMultiplier: 0.65, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "221", name: "Mid-Rise Apartment",                      unit: "Dwelling Units",        unitShort: "DU",       dailyRate: 6.0, amRate: 0.48, pmRate: 0.54, confidence: "sandag_2002", source: `${SD_CITY_2003} — Multiple Dwelling >20 DU/acre (daily 6/DU)`, directionalSplitPm: { in: 0.61, out: 0.39 }, amDirectionalIn: 0.24, satMultiplier: 0.60, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "222", name: "High-Rise Apartment",                     unit: "Dwelling Units",        unitShort: "DU",       dailyRate: 6.0, amRate: 0.44, pmRate: 0.50, confidence: "sandag_2002", source: `${SD_CITY_2003} — Multiple Dwelling >20 DU/acre (daily 6/DU)`, directionalSplitPm: { in: 0.60, out: 0.40 }, amDirectionalIn: 0.24, satMultiplier: 0.55, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "240", name: "Mobile Home Park",                        unit: "Dwelling Units",        unitShort: "DU",       dailyRate: 5.0, amRate: 0.40, pmRate: 0.45, confidence: "sandag_2002", source: `${SD_CITY_2003} — Mobile Home (daily 5/DU)`, directionalSplitPm: { in: 0.62, out: 0.38 }, amDirectionalIn: 0.26, satMultiplier: 0.65, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Senior / Care ----------
  { code: "253", name: "Senior Adult Housing",                    unit: "Dwelling Units",        unitShort: "DU",       dailyRate: 4.0, amRate: 0.20, pmRate: 0.28, confidence: "sandag_2002", source: `${SD_CITY_2003} — Retirement / Senior Citizen Housing (daily 4/DU)`, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.35, satMultiplier: 0.60, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "251", name: "Congregate / Continuing-Care",            unit: "Dwelling Units",        unitShort: "DU",       dailyRate: 2.0, amRate: 0.10, pmRate: 0.16, confidence: "sandag_2002", source: `${SD_CITY_2003} — Congregate Care Facility (daily 2/DU)`, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.40, satMultiplier: 0.60, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "620", name: "Nursing Home",                            unit: "Beds",                  unitShort: "bed",      dailyRate: 3.0, amRate: 0.18, pmRate: 0.24, confidence: "sandag_2002", source: `${SD_CITY_2003} — Convalescent / Nursing (daily 3/bed)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.45, satMultiplier: 0.60, passByPctPm: 0, internalCapturePctPm: 0 },

  // ---------- Institutional / Retail (additional) ----------
  { code: "565", name: "Day Care Center",                         unit: "Children",              unitShort: "child",    dailyRate: 5.0, amRate: 0.85, pmRate: 0.85, confidence: "sandag_2002", source: `${SD_CITY_2003} — Day Care Center (daily 5/child; drop-off/pick-up peaked, ~25% linked/pass-by)`, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.53, satMultiplier: 0.10, passByPctPm: 25, internalCapturePctPm: 0 },
  { code: "560", name: "Church / Place of Worship",              unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 15.0, amRate: 0.45, pmRate: 0.75, confidence: "sandag_2002", source: `${SD_CITY_2003} — House of Worship (daily 15/ksf; weekday low, Sunday-peaked)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.50, satMultiplier: 1.50, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "822", name: "Strip Retail / Specialty (<40k sf)",      unit: "1,000 sqft GLA",        unitShort: "ksf",      dailyRate: 40.0, amRate: 1.60, pmRate: 3.60, confidence: "sandag_2002", source: `${SD_CITY_2003} — Specialty Retail / Strip Commercial (daily 40/ksf)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 1.20, passByPctPm: 25, internalCapturePctPm: 0 },

  // ============ SANDAG 2002 additions (guide rows + screening analogs) ============
  // Common uses without a row in the sections above. Values are the SANDAG
  // 2002 guide's own published rows (daily rate × the row's published AM/PM
  // peak-hour % of ADT). Where SANDAG lacks the exact category, or its 2002
  // value runs high vs current conditions, the rate is a nearest-row
  // screening analog or a per-employee reconstruction (arithmetic in the
  // source string), tagged `interpolated` so the report discloses the
  // assumption for the reviewing PE.
  { code: "851", name: "Convenience Market (24-hr)",              unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 700.0, amRate: 63.0, pmRate: 49.0, confidence: "sandag_2002", source: `${SANDAG_2002} — Convenience Market, 24-hour (daily 700/ksf; AM 9%, PM 7% of ADT; SANDAG's own PM pass-by guidance 50%)`, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.51, satMultiplier: 1.00, passByPctPm: 50, internalCapturePctPm: 0 },
  { code: "853", name: "Convenience Market w/ Gas Pumps",         unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 850.0, amRate: 51.0, pmRate: 59.5, confidence: "sandag_2002", source: `${SANDAG_2002} — Convenience Market w/ Gasoline Pumps (daily 850/ksf; AM 6%, PM 7% of ADT)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.50, satMultiplier: 1.00, passByPctPm: 50, internalCapturePctPm: 0 },
  { code: "937", name: "Coffee / Donut Shop w/ Drive-Through",    unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 650.0, amRate: 58.5, pmRate: 45.5, confidence: "interpolated", source: `${SANDAG_2002} — screening analog: Fast Food w/ Drive-Through daily + PM (650/ksf; PM 7% of ADT), with the guide's AM-peaked Delicatessen AM share (9% of ADT) applied to preserve the morning coffee peak — PE verify`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 0.90, passByPctPm: 49, internalCapturePctPm: 0 },
  { code: "933", name: "Fast Food without Drive-Through",         unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 700.0, amRate: 35.0, pmRate: 49.0, confidence: "sandag_2002", source: `${SANDAG_2002} — Fast Food without Drive-Through (daily 700/ksf; AM 5%, PM 7% of ADT)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.52, satMultiplier: 1.10, passByPctPm: 45, internalCapturePctPm: 0 },
  { code: "948", name: "Automated Car Wash",                      unit: "Sites",          unitShort: "site",   dailyRate: 900.0, amRate: 36.0, pmRate: 81.0, confidence: "sandag_2002", source: `${SANDAG_2002} — Car Wash, Automatic (daily 900/site; AM 4%, PM 9% of ADT)`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.50, satMultiplier: 1.20, passByPctPm: 40, internalCapturePctPm: 0 },
  { code: "881", name: "Pharmacy / Drugstore w/ Drive-Through",   unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 90.0, amRate: 3.60, pmRate: 9.00, confidence: "sandag_2002", source: `${SANDAG_2002} — Drugstore (daily 90/ksf; AM 4%, PM 10% of ADT); a drive-through window may add trips — PE verify`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 0.90, passByPctPm: 50, internalCapturePctPm: 0 },
  { code: "610", name: "Hospital",                                unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 12.0, amRate: 0.96, pmRate: 1.20, confidence: "interpolated", source: `Reconstructed from independent public inputs — ≈3.3 employees/ksf (≈300 sqft GFA/employee hospital staffing density) × ≈3 daily vehicle-trips/employee ≈ 10/ksf, + ≈2/ksf patient/visitor allowance ≈ 12/ksf; AM 8% / PM 10% diurnal shares from the ${SANDAG_2002} General Hospital row`, directionalSplitPm: { in: 0.35, out: 0.65 }, amDirectionalIn: 0.65, satMultiplier: 0.70, passByPctPm: 10, internalCapturePctPm: 0 },
  { code: "630", name: "Clinic / Urgent Care",                    unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 50.0, amRate: 3.00, pmRate: 5.50, confidence: "interpolated", source: `${SANDAG_2002} — screening analog: Medical-Dental Office, San Diego Traffic Generators primary (daily 50/ksf; AM 6%, PM 11% of ADT) — PE verify for a clinic / urgent-care operation`, directionalSplitPm: { in: 0.30, out: 0.70 }, amDirectionalIn: 0.75, satMultiplier: 0.40, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "320", name: "Motel",                                   unit: "Occupied Rooms", unitShort: "rooms",  dailyRate: 4.0, amRate: 0.32, pmRate: 0.36, confidence: "interpolated", source: `Reconstructed from independent public inputs — ≈1 travel party per occupied room × ≈3 daily one-way vehicle legs (NHTS 2017 daily person-trip rates) + ≈1 staff/service allowance ≈ 4/occupied room; AM 8% / PM 9% diurnal shares from the ${SANDAG_2002} Motel row`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 0.95, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "750", name: "Office Park",                             unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 12.0, amRate: 1.56, pmRate: 1.56, confidence: "sandag_2002", source: `${SANDAG_2002} — Office Park, 400k+ sf (daily 12/ksf; AM 13%, PM 13% of ADT)`, directionalSplitPm: { in: 0.20, out: 0.80 }, amDirectionalIn: 0.85, satMultiplier: 0.10, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "540", name: "Community College",                       unit: "Students",       unitShort: "student", dailyRate: 1.2, amRate: 0.14, pmRate: 0.11, confidence: "sandag_2002", source: `${SANDAG_2002} — Junior College, 2 years (daily 1.2/student; AM 12%, PM 9% of ADT)`, directionalSplitPm: { in: 0.45, out: 0.55 }, amDirectionalIn: 0.55, satMultiplier: 0.30, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "590", name: "Library",                                 unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 50.0, amRate: 1.00, pmRate: 5.00, confidence: "sandag_2002", source: `${SANDAG_2002} — Library (daily 50/ksf; AM 2%, PM 10% of ADT)`, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.50, satMultiplier: 1.20, passByPctPm: 10, internalCapturePctPm: 0 },
  { code: "862", name: "Home Improvement Superstore",             unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 40.0, amRate: 2.00, pmRate: 3.20, confidence: "sandag_2002", source: `${SANDAG_2002} — Home Improvement Superstore (daily 40/ksf; AM 5%, PM 8% of ADT)`, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.55, satMultiplier: 1.10, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "495", name: "Recreational Community Center",           unit: "1,000 sqft GFA", unitShort: "ksf",    dailyRate: 30.0, amRate: 1.20, pmRate: 2.70, confidence: "interpolated", source: `${SANDAG_2002} — screening analog: Racquetball/Health Club, San Diego Traffic Generators primary (daily 30/ksf; AM 4%, PM 9% of ADT) — PE verify for a community recreation center`, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.50, satMultiplier: 1.30, passByPctPm: 0, internalCapturePctPm: 0 },
  { code: "155", name: "High-Cube Fulfillment Center (e-commerce)", unit: "1,000 sqft GFA", unitShort: "ksf",  dailyRate: 5.0, amRate: 0.65, pmRate: 0.75, confidence: "interpolated", source: `Reconstructed from independent public inputs — ≈1 employee/ksf sort-facility staffing × ≈3 daily vehicle-trips/employee + delivery-van/truck allowance ≈ 5/ksf (equals the ${SANDAG_2002} Warehousing row, whose AM 13% / PM 15% diurnal shares are applied); e-commerce operations vary widely by shift pattern — PE verify`, directionalSplitPm: { in: 0.30, out: 0.70 }, amDirectionalIn: 0.75, satMultiplier: 0.30, passByPctPm: 0, internalCapturePctPm: 0 },
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
