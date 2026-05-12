/**
 * Canonical land-use registry for both the TIS engine (trip generation
 * rates per ITE Trip Generation Manual 11th Ed.) and the Parking Demand
 * engine (peak parking demand per ITE Parking Generation 5th Ed. + City
 * of Atlanta Article 10 minimums).
 *
 * Rates are the published ITE averages — fitted-curve values used for
 * site-specific analyses are not reproduced here. The screening engine
 * may apply Atlanta-specific calibration multipliers from
 * `intersection_calibration` to refine the result.
 *
 * Maintenance: when ITE publishes a new edition, update the rates in
 * place; do not duplicate the table elsewhere.
 */
import type { ParkingLandUseT } from "@workspace/tis-api-zod";

export type LandUse = {
  code: string;
  name: string;
  unit: string;
  unitShort: string;
  dailyRate: number;
  amRate: number;
  pmRate: number;
  directionalSplitPm: { in: number; out: number };
  amDirectionalIn: number;
  // Saturday-midday rate as a fraction of the PM peak rate.
  satMultiplier: number;
  passByPctPm: number;
  internalCapturePctPm: number;
};

// ITE Trip Generation Manual 11th Ed. — average daily / AM peak / PM peak
// rates, directional splits, Sat multipliers, default pass-by %.
export const LAND_USES: LandUse[] = [
  // ---------- Residential ----------
  { code: "210", name: "Single-Family Detached Housing",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  9.43, amRate: 0.70, pmRate: 0.94, directionalSplitPm: { in: 0.63, out: 0.37 }, amDirectionalIn: 0.25, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "215", name: "Single-Family Attached Housing",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  7.20, amRate: 0.48, pmRate: 0.57, directionalSplitPm: { in: 0.59, out: 0.41 }, amDirectionalIn: 0.24, satMultiplier: 0.68, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "220", name: "Multifamily Housing (Low-Rise)",          unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  6.74, amRate: 0.40, pmRate: 0.51, directionalSplitPm: { in: 0.61, out: 0.39 }, amDirectionalIn: 0.24, satMultiplier: 0.65, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "221", name: "Multifamily Housing (Mid-Rise)",          unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  4.54, amRate: 0.30, pmRate: 0.36, directionalSplitPm: { in: 0.61, out: 0.39 }, amDirectionalIn: 0.24, satMultiplier: 0.65, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "222", name: "Multifamily Housing (High-Rise)",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  4.50, amRate: 0.28, pmRate: 0.36, directionalSplitPm: { in: 0.61, out: 0.39 }, amDirectionalIn: 0.24, satMultiplier: 0.65, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "230", name: "Residential Condominium / Townhouse",     unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  5.81, amRate: 0.44, pmRate: 0.52, directionalSplitPm: { in: 0.59, out: 0.41 }, amDirectionalIn: 0.24, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "240", name: "Mobile Home Park",                        unit: "Occupied Dwelling Units", unitShort: "DU",     dailyRate:  5.00, amRate: 0.40, pmRate: 0.46, directionalSplitPm: { in: 0.62, out: 0.38 }, amDirectionalIn: 0.27, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "251", name: "Senior Adult Housing — Detached",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  4.30, amRate: 0.20, pmRate: 0.25, directionalSplitPm: { in: 0.56, out: 0.44 }, amDirectionalIn: 0.41, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "252", name: "Senior Adult Housing — Attached",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  3.24, amRate: 0.13, pmRate: 0.20, directionalSplitPm: { in: 0.45, out: 0.55 }, amDirectionalIn: 0.41, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "253", name: "Congregate Care Facility",                unit: "Occupied Units",        unitShort: "units",    dailyRate:  2.06, amRate: 0.06, pmRate: 0.17, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.69, satMultiplier: 0.60, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "254", name: "Assisted Living",                          unit: "Beds",                  unitShort: "beds",     dailyRate:  2.60, amRate: 0.18, pmRate: 0.26, directionalSplitPm: { in: 0.43, out: 0.57 }, amDirectionalIn: 0.66, satMultiplier: 0.60, passByPctPm:  0, internalCapturePctPm: 0 },

  // ---------- Lodging ----------
  { code: "310", name: "Hotel",                                    unit: "Rooms",                 unitShort: "rooms",    dailyRate:  7.99, amRate: 0.47, pmRate: 0.60, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.59, satMultiplier: 0.95, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "311", name: "All Suites Hotel",                         unit: "Rooms",                 unitShort: "rooms",    dailyRate:  4.40, amRate: 0.40, pmRate: 0.43, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.59, satMultiplier: 0.95, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "320", name: "Motel",                                    unit: "Rooms",                 unitShort: "rooms",    dailyRate:  3.35, amRate: 0.36, pmRate: 0.39, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.51, satMultiplier: 0.95, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "330", name: "Resort Hotel",                             unit: "Rooms",                 unitShort: "rooms",    dailyRate:  6.05, amRate: 0.34, pmRate: 0.42, directionalSplitPm: { in: 0.52, out: 0.48 }, amDirectionalIn: 0.59, satMultiplier: 1.00, passByPctPm:  0, internalCapturePctPm: 0 },

  // ---------- Recreational ----------
  { code: "430", name: "Golf Course",                              unit: "Holes",                 unitShort: "holes",    dailyRate: 35.00, amRate: 2.20, pmRate: 2.74, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.80, satMultiplier: 1.30, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "444", name: "Movie Theater",                            unit: "Screens",               unitShort: "screens",  dailyRate: 78.00, amRate: 0.50, pmRate: 13.50, directionalSplitPm: { in: 0.64, out: 0.36 }, amDirectionalIn: 0.50, satMultiplier: 1.40, passByPctPm: 10, internalCapturePctPm: 0 },
  { code: "491", name: "Racquet / Tennis Club",                    unit: "Courts",                unitShort: "courts",   dailyRate: 36.95, amRate: 2.30, pmRate: 3.40, directionalSplitPm: { in: 0.60, out: 0.40 }, amDirectionalIn: 0.55, satMultiplier: 1.10, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "492", name: "Health / Fitness Club",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 28.00, amRate: 1.40, pmRate: 3.45, directionalSplitPm: { in: 0.60, out: 0.40 }, amDirectionalIn: 0.50, satMultiplier: 1.20, passByPctPm: 10, internalCapturePctPm: 0 },
  { code: "495", name: "Recreational Community Center",            unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 28.82, amRate: 1.76, pmRate: 2.31, directionalSplitPm: { in: 0.46, out: 0.54 }, amDirectionalIn: 0.50, satMultiplier: 1.20, passByPctPm:  0, internalCapturePctPm: 0 },

  // ---------- Institutional ----------
  { code: "520", name: "Public Elementary School",                 unit: "Students",              unitShort: "students", dailyRate:  2.27, amRate: 0.78, pmRate: 0.31, directionalSplitPm: { in: 0.46, out: 0.54 }, amDirectionalIn: 0.51, satMultiplier: 0.05, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "522", name: "Middle School / Junior High",              unit: "Students",              unitShort: "students", dailyRate:  2.10, amRate: 0.71, pmRate: 0.16, directionalSplitPm: { in: 0.46, out: 0.54 }, amDirectionalIn: 0.51, satMultiplier: 0.05, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "530", name: "High School",                              unit: "Students",              unitShort: "students", dailyRate:  1.94, amRate: 0.42, pmRate: 0.14, directionalSplitPm: { in: 0.43, out: 0.57 }, amDirectionalIn: 0.55, satMultiplier: 0.05, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "540", name: "Junior / Community College",               unit: "Students",              unitShort: "students", dailyRate:  1.20, amRate: 0.10, pmRate: 0.12, directionalSplitPm: { in: 0.42, out: 0.58 }, amDirectionalIn: 0.65, satMultiplier: 0.30, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "550", name: "University / College",                     unit: "Students",              unitShort: "students", dailyRate:  1.56, amRate: 0.17, pmRate: 0.18, directionalSplitPm: { in: 0.41, out: 0.59 }, amDirectionalIn: 0.65, satMultiplier: 0.30, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "560", name: "Church",                                   unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  6.95, amRate: 0.30, pmRate: 0.49, directionalSplitPm: { in: 0.49, out: 0.51 }, amDirectionalIn: 0.50, satMultiplier: 1.40, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "565", name: "Day Care Center",                          unit: "Students",              unitShort: "students", dailyRate:  4.09, amRate: 0.78, pmRate: 0.81, directionalSplitPm: { in: 0.47, out: 0.53 }, amDirectionalIn: 0.53, satMultiplier: 0.10, passByPctPm: 38, internalCapturePctPm: 0 },
  { code: "590", name: "Library",                                  unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 72.05, amRate: 1.95, pmRate: 8.16, directionalSplitPm: { in: 0.52, out: 0.48 }, amDirectionalIn: 0.49, satMultiplier: 1.10, passByPctPm: 15, internalCapturePctPm: 0 },
  { code: "610", name: "Hospital",                                 unit: "Beds",                  unitShort: "beds",     dailyRate: 11.85, amRate: 1.05, pmRate: 1.17, directionalSplitPm: { in: 0.36, out: 0.64 }, amDirectionalIn: 0.66, satMultiplier: 0.65, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "620", name: "Nursing Home",                             unit: "Beds",                  unitShort: "beds",     dailyRate:  3.06, amRate: 0.19, pmRate: 0.26, directionalSplitPm: { in: 0.42, out: 0.58 }, amDirectionalIn: 0.61, satMultiplier: 0.55, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "630", name: "Clinic",                                   unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 37.60, amRate: 2.85, pmRate: 5.18, directionalSplitPm: { in: 0.31, out: 0.69 }, amDirectionalIn: 0.69, satMultiplier: 0.20, passByPctPm:  0, internalCapturePctPm: 0 },

  // ---------- Office ----------
  { code: "710", name: "General Office",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 10.84, amRate: 1.43, pmRate: 1.44, directionalSplitPm: { in: 0.17, out: 0.83 }, amDirectionalIn: 0.86, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "712", name: "Small Office Building",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 16.19, amRate: 2.32, pmRate: 2.45, directionalSplitPm: { in: 0.19, out: 0.81 }, amDirectionalIn: 0.86, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "715", name: "Single Tenant Office Building",            unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 11.57, amRate: 1.60, pmRate: 1.74, directionalSplitPm: { in: 0.17, out: 0.83 }, amDirectionalIn: 0.86, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "720", name: "Medical / Dental Office",                  unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 36.00, amRate: 2.78, pmRate: 3.46, directionalSplitPm: { in: 0.28, out: 0.72 }, amDirectionalIn: 0.79, satMultiplier: 0.20, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "730", name: "Government Office Building",               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 22.59, amRate: 2.62, pmRate: 2.50, directionalSplitPm: { in: 0.33, out: 0.67 }, amDirectionalIn: 0.83, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "750", name: "Office Park",                              unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 11.42, amRate: 1.46, pmRate: 1.50, directionalSplitPm: { in: 0.17, out: 0.83 }, amDirectionalIn: 0.86, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "760", name: "Research & Development Center",            unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  8.11, amRate: 1.07, pmRate: 1.08, directionalSplitPm: { in: 0.19, out: 0.81 }, amDirectionalIn: 0.83, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "770", name: "Business Park",                            unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 12.44, amRate: 1.26, pmRate: 1.29, directionalSplitPm: { in: 0.34, out: 0.66 }, amDirectionalIn: 0.79, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0 },

  // ---------- Retail ----------
  { code: "820", name: "Shopping Center (≤100 ksf)",                unit: "1,000 sqft GLA",        unitShort: "ksf",      dailyRate: 37.75, amRate: 0.94, pmRate: 3.40, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 25, internalCapturePctPm: 0 },
  { code: "821", name: "Shopping Plaza (40–150 ksf)",               unit: "1,000 sqft GLA",        unitShort: "ksf",      dailyRate: 67.52, amRate: 1.73, pmRate: 5.40, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.20, passByPctPm: 28, internalCapturePctPm: 0 },
  { code: "822", name: "Strip Retail Plaza (<40 ksf)",              unit: "1,000 sqft GLA",        unitShort: "ksf",      dailyRate: 54.45, amRate: 2.36, pmRate: 6.59, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.20, passByPctPm: 34, internalCapturePctPm: 0 },
  { code: "840", name: "Automobile Sales (New)",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 27.84, amRate: 1.74, pmRate: 2.43, directionalSplitPm: { in: 0.42, out: 0.58 }, amDirectionalIn: 0.78, satMultiplier: 1.00, passByPctPm: 20, internalCapturePctPm: 0 },
  { code: "841", name: "Automobile Sales (Used)",                   unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 27.06, amRate: 1.74, pmRate: 3.75, directionalSplitPm: { in: 0.42, out: 0.58 }, amDirectionalIn: 0.78, satMultiplier: 1.00, passByPctPm: 20, internalCapturePctPm: 0 },
  { code: "843", name: "Auto Parts Sales",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 54.74, amRate: 2.36, pmRate: 4.91, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "848", name: "Tire Store",                                unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 27.69, amRate: 0.84, pmRate: 4.39, directionalSplitPm: { in: 0.40, out: 0.60 }, amDirectionalIn: 0.59, satMultiplier: 1.00, passByPctPm: 28, internalCapturePctPm: 0 },
  { code: "850", name: "Supermarket",                               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 93.84, amRate: 3.40, pmRate: 9.24, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.62, satMultiplier: 1.20, passByPctPm: 36, internalCapturePctPm: 0 },
  { code: "851", name: "Convenience Market",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 762.28, amRate: 65.38, pmRate: 49.11, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.51, satMultiplier: 0.85, passByPctPm: 61, internalCapturePctPm: 0 },
  { code: "857", name: "Discount Club",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 41.80, amRate: 0.85, pmRate: 4.18, directionalSplitPm: { in: 0.49, out: 0.51 }, amDirectionalIn: 0.61, satMultiplier: 1.25, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "862", name: "Home Improvement Superstore",               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 30.74, amRate: 0.74, pmRate: 2.33, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 42, internalCapturePctPm: 0 },
  { code: "863", name: "Electronics Superstore",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 41.05, amRate: 0.79, pmRate: 4.50, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 40, internalCapturePctPm: 0 },
  { code: "866", name: "Pet Supply Superstore",                     unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 25.65, amRate: 0.51, pmRate: 3.55, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "867", name: "Office Supply Superstore",                  unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 30.50, amRate: 0.69, pmRate: 3.40, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.20, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "868", name: "Book Superstore",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 25.40, amRate: 0.55, pmRate: 2.85, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "870", name: "Apparel Store",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 66.40, amRate: 1.31, pmRate: 4.20, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "875", name: "Department Store",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 22.88, amRate: 0.61, pmRate: 1.99, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "880", name: "Pharmacy w/o Drive-Through",                unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 90.06, amRate: 2.94, pmRate: 8.51, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 49, internalCapturePctPm: 0 },
  { code: "881", name: "Pharmacy w/ Drive-Through",                 unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 108.40, amRate: 5.04, pmRate: 10.29, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 50, internalCapturePctPm: 0 },
  { code: "890", name: "Furniture Store",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  5.06, amRate: 0.20, pmRate: 0.52, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 50, internalCapturePctPm: 0 },

  // ---------- Services / Banks / Food ----------
  { code: "911", name: "Walk-In Bank",                              unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 156.48, amRate: 12.13, pmRate: 21.01, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 0.40, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "912", name: "Drive-In Bank",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 100.35, amRate: 12.13, pmRate: 20.45, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 0.40, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "925", name: "Drinking Place / Tavern",                   unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 11.36, amRate: 0.46, pmRate: 11.36, directionalSplitPm: { in: 0.65, out: 0.35 }, amDirectionalIn: 0.55, satMultiplier: 1.30, passByPctPm: 43, internalCapturePctPm: 0 },
  { code: "930", name: "Fast Casual Restaurant",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 315.17, amRate: 9.50, pmRate: 14.13, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.50, satMultiplier: 1.15, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "931", name: "Quality Restaurant",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 83.84, amRate: 0.73, pmRate: 7.80, directionalSplitPm: { in: 0.62, out: 0.38 }, amDirectionalIn: 0.55, satMultiplier: 1.20, passByPctPm: 44, internalCapturePctPm: 0 },
  { code: "932", name: "High-Turnover (Sit-Down) Restaurant",       unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 107.20, amRate: 9.94, pmRate: 9.05, directionalSplitPm: { in: 0.59, out: 0.41 }, amDirectionalIn: 0.55, satMultiplier: 1.15, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "933", name: "Fast-Food Restaurant w/o Drive-Through",    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 346.23, amRate: 24.50, pmRate: 28.34, directionalSplitPm: { in: 0.52, out: 0.48 }, amDirectionalIn: 0.51, satMultiplier: 0.95, passByPctPm: 36, internalCapturePctPm: 0 },
  { code: "934", name: "Fast-Food Restaurant w/ Drive-Through",     unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 467.48, amRate: 44.61, pmRate: 33.03, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.51, satMultiplier: 0.85, passByPctPm: 40, internalCapturePctPm: 0 },
  { code: "935", name: "Coffee/Donut Shop w/ Drive-Through",        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 533.57, amRate: 101.49, pmRate: 41.95, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 0.70, passByPctPm: 70, internalCapturePctPm: 0 },
  { code: "936", name: "Coffee/Donut Shop w/o Drive-Through",       unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 234.85, amRate: 80.19, pmRate: 36.31, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 0.70, passByPctPm: 60, internalCapturePctPm: 0 },
  { code: "941", name: "Quick Lubrication Vehicle Shop",            unit: "Service Positions",     unitShort: "bays",     dailyRate: 40.00, amRate: 2.34, pmRate: 4.85, directionalSplitPm: { in: 0.45, out: 0.55 }, amDirectionalIn: 0.55, satMultiplier: 1.10, passByPctPm: 40, internalCapturePctPm: 0 },
  { code: "942", name: "Automobile Care Center",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 23.10, amRate: 1.10, pmRate: 3.11, directionalSplitPm: { in: 0.45, out: 0.55 }, amDirectionalIn: 0.55, satMultiplier: 1.10, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "944", name: "Gas Station (no C-store)",                  unit: "Vehicle Fueling Positions", unitShort: "VFP", dailyRate: 168.56, amRate: 11.10, pmRate: 13.99, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 1.05, passByPctPm: 42, internalCapturePctPm: 0 },
  { code: "945", name: "Gas Station / Convenience Store",           unit: "Vehicle Fueling Positions", unitShort: "VFP", dailyRate: 205.36, amRate: 13.99, pmRate: 14.03, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 1.05, passByPctPm: 50, internalCapturePctPm: 0 },
  { code: "947", name: "Self-Service Car Wash",                     unit: "Wash Stalls",           unitShort: "stalls",   dailyRate: 43.94, amRate: 2.34, pmRate: 5.54, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 1.30, passByPctPm: 44, internalCapturePctPm: 0 },
  { code: "948", name: "Automated Car Wash",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 77.50, amRate: 4.30, pmRate: 13.60, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 1.20, passByPctPm: 45, internalCapturePctPm: 0 },

  // ---------- Industrial ----------
  { code: "110", name: "Light Industrial",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  4.96, amRate: 0.70, pmRate: 0.65, directionalSplitPm: { in: 0.19, out: 0.81 }, amDirectionalIn: 0.81, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "130", name: "Industrial Park",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  3.37, amRate: 0.42, pmRate: 0.40, directionalSplitPm: { in: 0.21, out: 0.79 }, amDirectionalIn: 0.81, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "140", name: "Manufacturing",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  4.75, amRate: 0.74, pmRate: 0.74, directionalSplitPm: { in: 0.36, out: 0.64 }, amDirectionalIn: 0.78, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "150", name: "Warehousing",                               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  1.71, amRate: 0.17, pmRate: 0.18, directionalSplitPm: { in: 0.27, out: 0.73 }, amDirectionalIn: 0.78, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "151", name: "Mini-Warehouse / Self-Storage",             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  1.51, amRate: 0.10, pmRate: 0.17, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.51, satMultiplier: 1.10, passByPctPm:  0, internalCapturePctPm: 0 },
];

// ITE Parking Generation Manual 5th Ed. peak demand + Atlanta zoning
// Article 10 minimums. Each row corresponds to a `LAND_USES` entry above;
// some land uses (e.g. movie theater per-screen, hospital per-bed) carry
// jurisdiction-specific minimums that engineers should override when the
// site is outside the City of Atlanta.
export const PARKING_LAND_USES: ParkingLandUseT[] = [
  { code: "210", name: "Single-Family Detached Housing",          unit: "Dwelling Units",        unitShort: "DU",       weekdayPeakRate:  1.83, saturdayPeakRate:  1.71, codeMinPerUnit:  2.0 },
  { code: "215", name: "Single-Family Attached Housing",          unit: "Dwelling Units",        unitShort: "DU",       weekdayPeakRate:  1.46, saturdayPeakRate:  1.38, codeMinPerUnit:  1.5 },
  { code: "220", name: "Multifamily Housing (Low-Rise)",           unit: "Dwelling Units",        unitShort: "DU",       weekdayPeakRate:  1.23, saturdayPeakRate:  1.16, codeMinPerUnit:  1.0 },
  { code: "221", name: "Multifamily Housing (Mid-Rise)",           unit: "Dwelling Units",        unitShort: "DU",       weekdayPeakRate:  1.31, saturdayPeakRate:  1.20, codeMinPerUnit:  1.0 },
  { code: "222", name: "Multifamily Housing (High-Rise)",          unit: "Dwelling Units",        unitShort: "DU",       weekdayPeakRate:  1.10, saturdayPeakRate:  1.05, codeMinPerUnit:  1.0 },
  { code: "230", name: "Residential Condominium / Townhouse",      unit: "Dwelling Units",        unitShort: "DU",       weekdayPeakRate:  1.30, saturdayPeakRate:  1.25, codeMinPerUnit:  1.5 },
  { code: "240", name: "Mobile Home Park",                         unit: "Occupied Dwelling Units", unitShort: "DU",     weekdayPeakRate:  1.45, saturdayPeakRate:  1.40, codeMinPerUnit:  1.5 },
  { code: "251", name: "Senior Adult Housing — Detached",          unit: "Dwelling Units",        unitShort: "DU",       weekdayPeakRate:  0.78, saturdayPeakRate:  0.72, codeMinPerUnit:  1.0 },
  { code: "252", name: "Senior Adult Housing — Attached",          unit: "Dwelling Units",        unitShort: "DU",       weekdayPeakRate:  0.62, saturdayPeakRate:  0.58, codeMinPerUnit:  0.8 },
  { code: "253", name: "Congregate Care Facility",                 unit: "Occupied Units",        unitShort: "units",    weekdayPeakRate:  0.40, saturdayPeakRate:  0.40, codeMinPerUnit:  0.5 },
  { code: "254", name: "Assisted Living",                          unit: "Beds",                  unitShort: "beds",     weekdayPeakRate:  0.52, saturdayPeakRate:  0.50, codeMinPerUnit:  0.4 },

  { code: "310", name: "Hotel",                                    unit: "Rooms",                 unitShort: "rooms",    weekdayPeakRate:  0.85, saturdayPeakRate:  0.92, codeMinPerUnit:  1.0 },
  { code: "311", name: "All Suites Hotel",                         unit: "Rooms",                 unitShort: "rooms",    weekdayPeakRate:  0.95, saturdayPeakRate:  1.00, codeMinPerUnit:  1.0 },
  { code: "320", name: "Motel",                                    unit: "Rooms",                 unitShort: "rooms",    weekdayPeakRate:  0.79, saturdayPeakRate:  0.84, codeMinPerUnit:  1.0 },
  { code: "330", name: "Resort Hotel",                             unit: "Rooms",                 unitShort: "rooms",    weekdayPeakRate:  1.00, saturdayPeakRate:  1.10, codeMinPerUnit:  1.2 },

  { code: "430", name: "Golf Course",                              unit: "Holes",                 unitShort: "holes",    weekdayPeakRate:  4.50, saturdayPeakRate:  6.50, codeMinPerUnit:  6.0 },
  { code: "444", name: "Movie Theater",                            unit: "Screens",               unitShort: "screens",  weekdayPeakRate: 25.00, saturdayPeakRate: 60.00, codeMinPerUnit: 40.0 },
  { code: "491", name: "Racquet / Tennis Club",                    unit: "Courts",                unitShort: "courts",   weekdayPeakRate:  3.50, saturdayPeakRate:  4.50, codeMinPerUnit:  4.0 },
  { code: "492", name: "Health / Fitness Club",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  6.60, saturdayPeakRate:  7.10, codeMinPerUnit:  5.0 },
  { code: "495", name: "Recreational Community Center",            unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  4.20, saturdayPeakRate:  5.10, codeMinPerUnit:  4.0 },

  { code: "520", name: "Public Elementary School",                 unit: "Students",              unitShort: "students", weekdayPeakRate:  0.14, saturdayPeakRate:  0.02, codeMinPerUnit:  0.2 },
  { code: "522", name: "Middle School / Junior High",              unit: "Students",              unitShort: "students", weekdayPeakRate:  0.18, saturdayPeakRate:  0.02, codeMinPerUnit:  0.2 },
  { code: "530", name: "High School",                              unit: "Students",              unitShort: "students", weekdayPeakRate:  0.25, saturdayPeakRate:  0.03, codeMinPerUnit:  0.3 },
  { code: "540", name: "Junior / Community College",               unit: "Students",              unitShort: "students", weekdayPeakRate:  0.40, saturdayPeakRate:  0.10, codeMinPerUnit:  0.4 },
  { code: "550", name: "University / College",                     unit: "Students",              unitShort: "students", weekdayPeakRate:  0.40, saturdayPeakRate:  0.12, codeMinPerUnit:  0.4 },
  { code: "560", name: "Church",                                   unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  0.80, saturdayPeakRate:  3.50, codeMinPerUnit:  3.0 },
  { code: "565", name: "Day Care Center",                          unit: "Students",              unitShort: "students", weekdayPeakRate:  0.45, saturdayPeakRate:  0.05, codeMinPerUnit:  0.3 },
  { code: "590", name: "Library",                                  unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.30, saturdayPeakRate:  3.80, codeMinPerUnit:  3.0 },
  { code: "610", name: "Hospital",                                 unit: "Beds",                  unitShort: "beds",     weekdayPeakRate:  3.10, saturdayPeakRate:  2.60, codeMinPerUnit:  2.0 },
  { code: "620", name: "Nursing Home",                             unit: "Beds",                  unitShort: "beds",     weekdayPeakRate:  0.50, saturdayPeakRate:  0.55, codeMinPerUnit:  0.4 },
  { code: "630", name: "Clinic",                                   unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  4.80, saturdayPeakRate:  1.50, codeMinPerUnit:  4.0 },

  { code: "710", name: "General Office",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.70, saturdayPeakRate:  0.20, codeMinPerUnit:  2.5 },
  { code: "712", name: "Small Office Building",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.15, saturdayPeakRate:  0.30, codeMinPerUnit:  2.5 },
  { code: "715", name: "Single Tenant Office Building",            unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.80, saturdayPeakRate:  0.20, codeMinPerUnit:  2.5 },
  { code: "720", name: "Medical / Dental Office",                  unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.53, saturdayPeakRate:  0.90, codeMinPerUnit:  4.0 },
  { code: "730", name: "Government Office Building",               unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  4.10, saturdayPeakRate:  0.50, codeMinPerUnit:  3.0 },
  { code: "750", name: "Office Park",                              unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.60, saturdayPeakRate:  0.20, codeMinPerUnit:  2.5 },
  { code: "760", name: "Research & Development Center",            unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.40, saturdayPeakRate:  0.20, codeMinPerUnit:  2.0 },
  { code: "770", name: "Business Park",                            unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.50, saturdayPeakRate:  0.30, codeMinPerUnit:  2.5 },

  { code: "820", name: "Shopping Center (≤100 ksf)",                unit: "1,000 sqft GLA",        unitShort: "ksf",      weekdayPeakRate:  2.65, saturdayPeakRate:  3.31, codeMinPerUnit:  3.0 },
  { code: "821", name: "Shopping Plaza (40–150 ksf)",               unit: "1,000 sqft GLA",        unitShort: "ksf",      weekdayPeakRate:  2.90, saturdayPeakRate:  3.80, codeMinPerUnit:  3.5 },
  { code: "822", name: "Strip Retail Plaza (<40 ksf)",              unit: "1,000 sqft GLA",        unitShort: "ksf",      weekdayPeakRate:  3.15, saturdayPeakRate:  3.90, codeMinPerUnit:  4.0 },
  { code: "840", name: "Automobile Sales (New)",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.45, saturdayPeakRate:  3.20, codeMinPerUnit:  3.0 },
  { code: "841", name: "Automobile Sales (Used)",                   unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.90, saturdayPeakRate:  3.40, codeMinPerUnit:  3.0 },
  { code: "843", name: "Auto Parts Sales",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.10, saturdayPeakRate:  3.80, codeMinPerUnit:  3.5 },
  { code: "848", name: "Tire Store",                                unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.80, saturdayPeakRate:  3.20, codeMinPerUnit:  3.0 },
  { code: "850", name: "Supermarket",                               unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  4.60, saturdayPeakRate:  5.50, codeMinPerUnit:  4.5 },
  { code: "851", name: "Convenience Market",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  5.80, saturdayPeakRate:  6.20, codeMinPerUnit:  4.0 },
  { code: "857", name: "Discount Club",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.60, saturdayPeakRate:  4.80, codeMinPerUnit:  4.0 },
  { code: "862", name: "Home Improvement Superstore",               unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.30, saturdayPeakRate:  3.20, codeMinPerUnit:  3.0 },
  { code: "863", name: "Electronics Superstore",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.10, saturdayPeakRate:  4.10, codeMinPerUnit:  3.5 },
  { code: "866", name: "Pet Supply Superstore",                     unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.85, saturdayPeakRate:  3.60, codeMinPerUnit:  3.0 },
  { code: "867", name: "Office Supply Superstore",                  unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.95, saturdayPeakRate:  3.50, codeMinPerUnit:  3.0 },
  { code: "868", name: "Book Superstore",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.80, saturdayPeakRate:  3.40, codeMinPerUnit:  3.0 },
  { code: "870", name: "Apparel Store",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.20, saturdayPeakRate:  4.20, codeMinPerUnit:  3.5 },
  { code: "875", name: "Department Store",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  2.30, saturdayPeakRate:  3.10, codeMinPerUnit:  3.0 },
  { code: "880", name: "Pharmacy w/o Drive-Through",                unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.40, saturdayPeakRate:  3.80, codeMinPerUnit:  4.0 },
  { code: "881", name: "Pharmacy w/ Drive-Through",                 unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.65, saturdayPeakRate:  4.00, codeMinPerUnit:  4.0 },
  { code: "890", name: "Furniture Store",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  0.50, saturdayPeakRate:  0.85, codeMinPerUnit:  2.0 },

  { code: "911", name: "Walk-In Bank",                              unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  4.20, saturdayPeakRate:  1.80, codeMinPerUnit:  4.0 },
  { code: "912", name: "Drive-In Bank",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  6.78, saturdayPeakRate:  1.85, codeMinPerUnit:  4.0 },
  { code: "925", name: "Drinking Place / Tavern",                   unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate: 12.50, saturdayPeakRate: 16.50, codeMinPerUnit: 10.0 },
  { code: "930", name: "Fast Casual Restaurant",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate: 12.40, saturdayPeakRate: 14.20, codeMinPerUnit: 12.0 },
  { code: "931", name: "Quality Restaurant",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  9.85, saturdayPeakRate: 14.30, codeMinPerUnit: 10.0 },
  { code: "932", name: "High-Turnover (Sit-Down) Restaurant",       unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate: 11.04, saturdayPeakRate: 13.31, codeMinPerUnit: 10.0 },
  { code: "933", name: "Fast-Food Restaurant w/o Drive-Through",    unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate: 13.85, saturdayPeakRate: 12.40, codeMinPerUnit: 12.0 },
  { code: "934", name: "Fast-Food Restaurant w/ Drive-Through",     unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate: 14.76, saturdayPeakRate: 13.10, codeMinPerUnit: 12.0 },
  { code: "935", name: "Coffee/Donut Shop w/ Drive-Through",        unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate: 10.40, saturdayPeakRate:  9.20, codeMinPerUnit: 10.0 },
  { code: "936", name: "Coffee/Donut Shop w/o Drive-Through",       unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  9.10, saturdayPeakRate:  8.30, codeMinPerUnit: 10.0 },
  { code: "941", name: "Quick Lubrication Vehicle Shop",            unit: "Service Positions",     unitShort: "bays",     weekdayPeakRate:  2.50, saturdayPeakRate:  3.20, codeMinPerUnit:  3.0 },
  { code: "942", name: "Automobile Care Center",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.20, saturdayPeakRate:  3.60, codeMinPerUnit:  3.0 },
  { code: "944", name: "Gas Station (no C-store)",                  unit: "Vehicle Fueling Positions", unitShort: "VFP", weekdayPeakRate:  3.70, saturdayPeakRate:  4.40, codeMinPerUnit:  3.0 },
  { code: "945", name: "Gas Station / Convenience Store",           unit: "Vehicle Fueling Positions", unitShort: "VFP", weekdayPeakRate:  4.18, saturdayPeakRate:  5.34, codeMinPerUnit:  4.0 },
  { code: "947", name: "Self-Service Car Wash",                     unit: "Wash Stalls",           unitShort: "stalls",   weekdayPeakRate:  1.80, saturdayPeakRate:  2.40, codeMinPerUnit:  2.0 },
  { code: "948", name: "Automated Car Wash",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  3.40, saturdayPeakRate:  4.80, codeMinPerUnit:  3.0 },

  { code: "110", name: "Light Industrial",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  1.32, saturdayPeakRate:  0.25, codeMinPerUnit:  1.5 },
  { code: "130", name: "Industrial Park",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  1.20, saturdayPeakRate:  0.20, codeMinPerUnit:  1.5 },
  { code: "140", name: "Manufacturing",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  1.45, saturdayPeakRate:  0.30, codeMinPerUnit:  1.5 },
  { code: "150", name: "Warehousing",                               unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  0.52, saturdayPeakRate:  0.13, codeMinPerUnit:  0.5 },
  { code: "151", name: "Mini-Warehouse / Self-Storage",             unit: "1,000 sqft GFA",        unitShort: "ksf",      weekdayPeakRate:  0.25, saturdayPeakRate:  0.30, codeMinPerUnit:  0.3 },
];
