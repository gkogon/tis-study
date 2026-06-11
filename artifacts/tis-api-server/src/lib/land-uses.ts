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

/**
 * Alternate independent variable for a land use. ITE TGM 11th Ed.
 * publishes rates for more than one variable for many codes — e.g.,
 * an office can be sized by ksf GFA OR by employees, a hotel by rooms
 * OR by occupied rooms, a church by ksf OR by weekly attendees. Where
 * a developer or PE has the secondary number handy but not the
 * primary, letting them enter what they have lowers the bounce rate
 * on the demo form significantly without compromising the math.
 *
 * `confidence: "ite_published"` — rate is transcribed from the ITE
 * 11th Ed. tables. `confidence: "interpolated"` — ITE only publishes
 * the primary variable; the secondary rate is derived from a
 * defensible engineering ratio (e.g. office at 250 sqft/employee →
 * 4 employees per ksf GFA) and is flagged explicitly in the methodology
 * note AND the legal disclaimer so a reviewing PE can verify the
 * assumption used.
 *
 * The directional splits, Sat multiplier, and pass-by / internal-
 * capture percentages stay tied to the LAND USE, not the variable
 * choice — they describe the trip pattern of the development type
 * itself and don't change because the developer counted employees
 * instead of square feet.
 */
export type SecondaryVariable = {
  unit: string;
  unitShort: string;
  dailyRate: number;
  amRate: number;
  pmRate: number;
  confidence: "ite_published" | "interpolated";
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
  directionalSplitPm: { in: number; out: number };
  amDirectionalIn: number;
  // Saturday-midday rate as a fraction of the PM peak rate.
  satMultiplier: number;
  passByPctPm: number;
  internalCapturePctPm: number;
  // Optional alternate independent variables. See SecondaryVariable.
  secondaryVariables?: SecondaryVariable[];
};

// ITE Trip Generation Manual 11th Ed. — average daily / AM peak / PM peak
// rates, directional splits, Sat multipliers, default pass-by %.
//
// `secondaryVariables` carries alternate independent variables a developer
// or PE might quote a project size in (e.g. office sized by employees
// instead of ksf, hotel by occupied rooms instead of total rooms, church
// by weekly attendees instead of square feet). Where ITE 11th publishes
// a rate for the secondary variable it's transcribed; where it doesn't,
// a defensible engineering ratio is used and the entry is marked
// `confidence: "interpolated"` so the methodology note + legal disclaimer
// can flag the assumption to a reviewing PE.
export const LAND_USES: LandUse[] = [
  // ---------- Residential ----------
  { code: "210", name: "Single-Family Detached Housing",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  9.43, amRate: 0.70, pmRate: 0.94, directionalSplitPm: { in: 0.63, out: 0.37 }, amDirectionalIn: 0.25, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate:  3.77, amRate: 0.28, pmRate: 0.38, confidence: "interpolated", note: "Derived at ~2,500 sqft/DU (typical SF detached)" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 28.29, amRate: 2.10, pmRate: 2.82, confidence: "interpolated", note: "Derived at ~3 DU/acre (low-density SF detached)" },
    ] },
  { code: "215", name: "Single-Family Attached Housing",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  7.20, amRate: 0.48, pmRate: 0.57, directionalSplitPm: { in: 0.59, out: 0.41 }, amDirectionalIn: 0.24, satMultiplier: 0.68, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate:  4.00, amRate: 0.27, pmRate: 0.32, confidence: "interpolated", note: "Derived at ~1,800 sqft/DU (typical SF attached / townhouse)" },
    ] },
  { code: "220", name: "Multifamily Housing (Low-Rise)",          unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  6.74, amRate: 0.40, pmRate: 0.51, directionalSplitPm: { in: 0.61, out: 0.39 }, amDirectionalIn: 0.24, satMultiplier: 0.65, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate:  5.61, amRate: 0.33, pmRate: 0.43, confidence: "interpolated", note: "Derived at ~1,200 sqft/DU (typical low-rise MF)" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 168.5, amRate: 10.0, pmRate: 12.8, confidence: "interpolated", note: "Derived at ~25 DU/acre" },
    ] },
  { code: "221", name: "Multifamily Housing (Mid-Rise)",          unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  4.54, amRate: 0.30, pmRate: 0.36, directionalSplitPm: { in: 0.61, out: 0.39 }, amDirectionalIn: 0.24, satMultiplier: 0.65, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate:  4.54, amRate: 0.30, pmRate: 0.36, confidence: "interpolated", note: "Derived at ~1,000 sqft/DU (typical mid-rise MF)" },
      { unit: "Bedrooms",          unitShort: "BR",    dailyRate:  2.50, amRate: 0.17, pmRate: 0.20, confidence: "interpolated", note: "Derived at ~1.8 BR/DU (typical mid-rise MF mix)" },
    ] },
  { code: "222", name: "Multifamily Housing (High-Rise)",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  4.50, amRate: 0.28, pmRate: 0.36, directionalSplitPm: { in: 0.61, out: 0.39 }, amDirectionalIn: 0.24, satMultiplier: 0.65, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate:  5.00, amRate: 0.31, pmRate: 0.40, confidence: "interpolated", note: "Derived at ~900 sqft/DU (typical high-rise MF)" },
      { unit: "Bedrooms",          unitShort: "BR",    dailyRate:  2.65, amRate: 0.16, pmRate: 0.21, confidence: "interpolated", note: "Derived at ~1.7 BR/DU (high-rise MF skews 1-BR / studio)" },
    ] },
  { code: "230", name: "Residential Condominium / Townhouse",     unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  5.81, amRate: 0.44, pmRate: 0.52, directionalSplitPm: { in: 0.59, out: 0.41 }, amDirectionalIn: 0.24, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate:  4.84, amRate: 0.37, pmRate: 0.43, confidence: "interpolated", note: "Derived at ~1,200 sqft/DU (typical condo / townhouse)" },
    ] },
  { code: "240", name: "Mobile Home Park",                        unit: "Occupied Dwelling Units", unitShort: "DU",     dailyRate:  5.00, amRate: 0.40, pmRate: 0.46, directionalSplitPm: { in: 0.62, out: 0.38 }, amDirectionalIn: 0.27, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Acres",             unitShort: "acres", dailyRate: 30.00, amRate: 2.40, pmRate: 2.76, confidence: "interpolated", note: "Derived at ~6 DU/acre (typical mobile home park density)" },
    ] },
  { code: "251", name: "Senior Adult Housing — Detached",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  4.30, amRate: 0.20, pmRate: 0.25, directionalSplitPm: { in: 0.56, out: 0.44 }, amDirectionalIn: 0.41, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Occupied Units",    unitShort: "occ",   dailyRate:  4.52, amRate: 0.21, pmRate: 0.26, confidence: "interpolated", note: "Derived at 95% occupancy (typical senior community)" },
    ] },
  { code: "252", name: "Senior Adult Housing — Attached",         unit: "Dwelling Units",        unitShort: "DU",       dailyRate:  3.24, amRate: 0.13, pmRate: 0.20, directionalSplitPm: { in: 0.45, out: 0.55 }, amDirectionalIn: 0.41, satMultiplier: 0.70, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Occupied Units",    unitShort: "occ",   dailyRate:  3.41, amRate: 0.14, pmRate: 0.21, confidence: "interpolated", note: "Derived at 95% occupancy" },
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate:  3.60, amRate: 0.14, pmRate: 0.22, confidence: "interpolated", note: "Derived at ~900 sqft/DU (typical attached senior unit)" },
    ] },
  { code: "253", name: "Congregate Care Facility",                unit: "Occupied Units",        unitShort: "units",    dailyRate:  2.06, amRate: 0.06, pmRate: 0.17, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.69, satMultiplier: 0.60, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "254", name: "Assisted Living",                          unit: "Beds",                  unitShort: "beds",     dailyRate:  2.60, amRate: 0.18, pmRate: 0.26, directionalSplitPm: { in: 0.43, out: 0.57 }, amDirectionalIn: 0.66, satMultiplier: 0.60, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  6.20, amRate: 0.43, pmRate: 0.62, confidence: "interpolated", note: "Derived at ~0.42 employees/bed (skilled-care staffing)" },
    ] },

  // ---------- Lodging ----------
  { code: "310", name: "Hotel",                                    unit: "Rooms",                 unitShort: "rooms",    dailyRate:  7.99, amRate: 0.47, pmRate: 0.60, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.59, satMultiplier: 0.95, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Occupied Rooms",    unitShort: "occ",   dailyRate: 10.65, amRate: 0.63, pmRate: 0.80, confidence: "ite_published", note: "ITE 11th — at 75% typical occupancy" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 14.34, amRate: 0.84, pmRate: 1.08, confidence: "ite_published", note: "ITE 11th — Hotel per-employee rates" },
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 13.32, amRate: 0.78, pmRate: 1.00, confidence: "interpolated", note: "Derived at ~600 sqft/room (typical full-service hotel)" },
    ] },
  { code: "311", name: "All Suites Hotel",                         unit: "Rooms",                 unitShort: "rooms",    dailyRate:  4.40, amRate: 0.40, pmRate: 0.43, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.59, satMultiplier: 0.95, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Occupied Rooms",    unitShort: "occ",   dailyRate:  5.87, amRate: 0.53, pmRate: 0.57, confidence: "interpolated", note: "Derived at 75% typical occupancy" },
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate:  6.29, amRate: 0.57, pmRate: 0.61, confidence: "interpolated", note: "Derived at ~700 sqft/suite (typical extended-stay)" },
    ] },
  { code: "320", name: "Motel",                                    unit: "Rooms",                 unitShort: "rooms",    dailyRate:  3.35, amRate: 0.36, pmRate: 0.39, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.51, satMultiplier: 0.95, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Occupied Rooms",    unitShort: "occ",   dailyRate:  4.47, amRate: 0.48, pmRate: 0.52, confidence: "interpolated", note: "Derived at 75% typical occupancy" },
    ] },
  { code: "330", name: "Resort Hotel",                             unit: "Rooms",                 unitShort: "rooms",    dailyRate:  6.05, amRate: 0.34, pmRate: 0.42, directionalSplitPm: { in: 0.52, out: 0.48 }, amDirectionalIn: 0.59, satMultiplier: 1.00, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Occupied Rooms",    unitShort: "occ",   dailyRate:  8.07, amRate: 0.45, pmRate: 0.56, confidence: "interpolated", note: "Derived at 75% typical occupancy" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 10.08, amRate: 0.57, pmRate: 0.70, confidence: "interpolated", note: "Derived at ~0.6 employees/room (resort staffing)" },
    ] },

  // ---------- Recreational ----------
  { code: "415", name: "Public Park",                              unit: "Acres",                 unitShort: "acres",    dailyRate:  0.78, amRate: 0.02, pmRate: 0.11, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.50, satMultiplier: 1.30, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Picnic Sites",      unitShort: "sites", dailyRate:  7.80, amRate: 0.18, pmRate: 1.05, confidence: "interpolated", note: "Derived at ~10 picnic sites/acre (typical urban park)" },
      { unit: "Ballfields",        unitShort: "fld",   dailyRate:  2.34, amRate: 0.06, pmRate: 0.33, confidence: "interpolated", note: "Derived at ~1 ballfield per 3 acres (typical neighborhood-park sports area)" },
      { unit: "Parking Spaces",    unitShort: "stalls", dailyRate: 1.56, amRate: 0.04, pmRate: 0.22, confidence: "interpolated", note: "Derived at ~2 stalls/acre (typical municipal park parking provision)" },
    ] },
  { code: "430", name: "Golf Course",                              unit: "Holes",                 unitShort: "holes",    dailyRate: 35.00, amRate: 2.20, pmRate: 2.74, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.80, satMultiplier: 1.30, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Acres",             unitShort: "acres", dailyRate:  5.83, amRate: 0.37, pmRate: 0.46, confidence: "ite_published", note: "ITE 11th — Golf Course per-acre rates" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 23.33, amRate: 1.47, pmRate: 1.83, confidence: "interpolated", note: "Derived at ~1.5 emp/hole (typical full-service golf)" },
      { unit: "Rounds per Day",    unitShort: "rnd",   dailyRate:  2.06, amRate: 0.13, pmRate: 0.16, confidence: "interpolated", note: "Derived at ~17 rounds/hole/day (typical busy public course)" },
    ] },
  { code: "444", name: "Movie Theater",                            unit: "Screens",               unitShort: "screens",  dailyRate: 78.00, amRate: 0.50, pmRate: 13.50, directionalSplitPm: { in: 0.64, out: 0.36 }, amDirectionalIn: 0.50, satMultiplier: 1.40, passByPctPm: 10, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Seats",             unitShort: "seats", dailyRate:  0.39, amRate: 0.0025, pmRate: 0.068, confidence: "ite_published", note: "ITE 11th — Movie Theater per-seat" },
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 17.55, amRate: 0.11, pmRate: 3.04, confidence: "interpolated", note: "Derived at ~4.45 ksf/screen (multiplex industry avg)" },
      { unit: "Auditoriums",       unitShort: "aud",   dailyRate: 78.00, amRate: 0.50, pmRate: 13.50, confidence: "interpolated", note: "Equivalent to Screens for typical multiplex (1 auditorium = 1 screen)" },
    ] },
  { code: "445", name: "Live Theater",                             unit: "Seats",                 unitShort: "seats",    dailyRate:  0.42, amRate: 0.00, pmRate: 0.10, directionalSplitPm: { in: 0.70, out: 0.30 }, amDirectionalIn: 0.50, satMultiplier: 1.40, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 23.10, amRate: 0.00, pmRate: 5.50, confidence: "interpolated", note: "Derived at ~55 seats/ksf (typical performing-arts venue)" },
    ] },
  { code: "480", name: "Amusement Park / Theme Park",              unit: "Acres",                 unitShort: "acres",    dailyRate: 95.65, amRate: 1.97, pmRate: 8.67, directionalSplitPm: { in: 0.45, out: 0.55 }, amDirectionalIn: 0.55, satMultiplier: 1.40, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Peak-Day Attendees", unitShort: "att",  dailyRate:  3.83, amRate: 0.08, pmRate: 0.35, confidence: "interpolated", note: "Derived at ~25 attendees/acre peak-day" },
    ] },
  { code: "481", name: "Zoo",                                      unit: "Acres",                 unitShort: "acres",    dailyRate: 36.06, amRate: 1.50, pmRate: 3.74, directionalSplitPm: { in: 0.47, out: 0.53 }, amDirectionalIn: 0.55, satMultiplier: 1.40, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Annual Visitors (thousands)", unitShort: "Kvis", dailyRate: 0.099, amRate: 0.0041, pmRate: 0.010, confidence: "interpolated", note: "Derived at ~365 K-visitors / acre / yr (typical metro zoo)" },
    ] },
  { code: "482", name: "Aquarium",                                 unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 73.96, amRate: 1.20, pmRate: 3.04, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.50, satMultiplier: 1.40, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Annual Visitors (thousands)", unitShort: "Kvis", dailyRate: 5.49, amRate: 0.089, pmRate: 0.226, confidence: "interpolated", note: "Derived at ~13.5 Kvis/ksf/yr (typical urban aquarium)" },
    ] },
  { code: "488", name: "Soccer Complex",                           unit: "Fields",                unitShort: "fields",   dailyRate: 71.33, amRate: 0.00, pmRate: 17.50, directionalSplitPm: { in: 0.65, out: 0.35 }, amDirectionalIn: 0.50, satMultiplier: 1.40, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Acres",             unitShort: "acres", dailyRate: 35.67, amRate: 0.00, pmRate: 8.75, confidence: "interpolated", note: "Derived at ~2 acres/field (standard tournament soccer field plus parking)" },
      { unit: "Peak-Hour Attendees", unitShort: "att", dailyRate:  1.78, amRate: 0.00, pmRate: 0.44, confidence: "interpolated", note: "Derived at ~40 peak-hour attendees per field (tournament-day estimate)" },
    ] },
  { code: "491", name: "Racquet / Tennis Club",                    unit: "Courts",                unitShort: "courts",   dailyRate: 36.95, amRate: 2.30, pmRate: 3.40, directionalSplitPm: { in: 0.60, out: 0.40 }, amDirectionalIn: 0.55, satMultiplier: 1.10, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate:  7.39, amRate: 0.46, pmRate: 0.68, confidence: "interpolated", note: "Derived at ~5 ksf/court (typical indoor racquet club)" },
    ] },
  { code: "492", name: "Health / Fitness Club",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 28.00, amRate: 1.40, pmRate: 3.45, directionalSplitPm: { in: 0.60, out: 0.40 }, amDirectionalIn: 0.50, satMultiplier: 1.20, passByPctPm: 10, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Members (thousands)", unitShort: "Kmem", dailyRate: 5.60, amRate: 0.28, pmRate: 0.69, confidence: "interpolated", note: "Derived at ~5 Kmembers/ksf (national gym chain density)" },
    ] },
  { code: "493", name: "Athletic Club",                            unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 28.50, amRate: 1.45, pmRate: 3.50, directionalSplitPm: { in: 0.60, out: 0.40 }, amDirectionalIn: 0.50, satMultiplier: 1.20, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "495", name: "Recreational Community Center",            unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 28.82, amRate: 1.76, pmRate: 2.31, directionalSplitPm: { in: 0.46, out: 0.54 }, amDirectionalIn: 0.50, satMultiplier: 1.20, passByPctPm:  0, internalCapturePctPm: 0 },

  // ---------- Institutional ----------
  { code: "520", name: "Public Elementary School",                 unit: "Students",              unitShort: "students", dailyRate:  2.27, amRate: 0.78, pmRate: 0.31, directionalSplitPm: { in: 0.46, out: 0.54 }, amDirectionalIn: 0.51, satMultiplier: 0.05, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 19.52, amRate: 6.71, pmRate: 2.67, confidence: "ite_published", note: "ITE 11th — Elementary School per-ksf" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 21.30, amRate: 7.32, pmRate: 2.91, confidence: "interpolated", note: "Derived at ~10.7 students/employee (typical public K-5)" },
      { unit: "Classrooms",        unitShort: "rooms", dailyRate: 45.40, amRate: 15.60, pmRate: 6.20, confidence: "interpolated", note: "Derived at ~20 students/classroom (typical elementary cap)" },
    ] },
  { code: "522", name: "Middle School / Junior High",              unit: "Students",              unitShort: "students", dailyRate:  2.10, amRate: 0.71, pmRate: 0.16, directionalSplitPm: { in: 0.46, out: 0.54 }, amDirectionalIn: 0.51, satMultiplier: 0.05, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 18.06, amRate: 6.11, pmRate: 1.38, confidence: "ite_published", note: "ITE 11th — Middle School per-ksf" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 16.80, amRate: 5.68, pmRate: 1.28, confidence: "interpolated", note: "Derived at ~8 students/employee (typical middle school)" },
      { unit: "Classrooms",        unitShort: "rooms", dailyRate: 46.20, amRate: 15.62, pmRate: 3.52, confidence: "interpolated", note: "Derived at ~22 students/classroom (typical middle-school cap)" },
    ] },
  { code: "530", name: "High School",                              unit: "Students",              unitShort: "students", dailyRate:  1.94, amRate: 0.42, pmRate: 0.14, directionalSplitPm: { in: 0.43, out: 0.57 }, amDirectionalIn: 0.55, satMultiplier: 0.05, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 14.07, amRate: 3.05, pmRate: 1.02, confidence: "ite_published", note: "ITE 11th — High School per-ksf" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 30.10, amRate: 6.51, pmRate: 2.17, confidence: "interpolated", note: "Derived at ~15.5 students/employee (typical high school)" },
      { unit: "Classrooms",        unitShort: "rooms", dailyRate: 48.50, amRate: 10.50, pmRate: 3.50, confidence: "interpolated", note: "Derived at ~25 students/classroom (typical high-school cap)" },
    ] },
  { code: "540", name: "Junior / Community College",               unit: "Students",              unitShort: "students", dailyRate:  1.20, amRate: 0.10, pmRate: 0.12, directionalSplitPm: { in: 0.42, out: 0.58 }, amDirectionalIn: 0.65, satMultiplier: 0.30, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 27.51, amRate: 2.29, pmRate: 2.75, confidence: "ite_published", note: "ITE 11th — Community College per-ksf" },
    ] },
  { code: "550", name: "University / College",                     unit: "Students",              unitShort: "students", dailyRate:  1.56, amRate: 0.17, pmRate: 0.18, directionalSplitPm: { in: 0.41, out: 0.59 }, amDirectionalIn: 0.65, satMultiplier: 0.30, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 16.85, amRate: 1.84, pmRate: 1.94, confidence: "ite_published", note: "ITE 11th — University per-ksf" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 10.92, amRate: 1.19, pmRate: 1.26, confidence: "interpolated", note: "Derived at ~7 students/employee (typical four-year university)" },
    ] },
  { code: "560", name: "Church",                                   unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  6.95, amRate: 0.30, pmRate: 0.49, directionalSplitPm: { in: 0.49, out: 0.51 }, amDirectionalIn: 0.50, satMultiplier: 1.40, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Seats",             unitShort: "seats", dailyRate:  0.42, amRate: 0.018, pmRate: 0.030, confidence: "ite_published", note: "ITE 11th — Church per-seat" },
      { unit: "Weekly Attendees",  unitShort: "att",   dailyRate:  0.36, amRate: 0.016, pmRate: 0.025, confidence: "interpolated", note: "Derived at ~58% of seats / weekly attendees (typical congregation utilization)" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 19.86, amRate: 0.86, pmRate: 1.40, confidence: "interpolated", note: "Derived at ~0.35 emp/ksf (typical mid-size congregation staffing)" },
    ] },
  { code: "565", name: "Day Care Center",                          unit: "Students",              unitShort: "students", dailyRate:  4.09, amRate: 0.78, pmRate: 0.81, directionalSplitPm: { in: 0.47, out: 0.53 }, amDirectionalIn: 0.53, satMultiplier: 0.10, passByPctPm: 38, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 47.62, amRate: 9.08, pmRate: 9.42, confidence: "ite_published", note: "ITE 11th — Day Care per-ksf" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 28.63, amRate: 5.46, pmRate: 5.67, confidence: "interpolated", note: "Derived at ~7 students/employee (typical infant + preschool blend)" },
      { unit: "Classrooms",        unitShort: "rooms", dailyRate: 49.10, amRate: 9.36, pmRate: 9.72, confidence: "interpolated", note: "Derived at ~12 students/classroom (typical multi-age day care)" },
    ] },
  { code: "580", name: "Museum",                                   unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 22.93, amRate: 0.41, pmRate: 0.99, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.50, satMultiplier: 1.30, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Annual Visitors (thousands)", unitShort: "Kvis", dailyRate: 1.91, amRate: 0.034, pmRate: 0.083, confidence: "interpolated", note: "Derived at ~12 Kvis/ksf/yr (typical mid-sized urban museum)" },
    ] },
  { code: "590", name: "Library",                                  unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 72.05, amRate: 1.95, pmRate: 8.16, directionalSplitPm: { in: 0.52, out: 0.48 }, amDirectionalIn: 0.49, satMultiplier: 1.10, passByPctPm: 15, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 120.1, amRate: 3.25, pmRate: 13.6, confidence: "interpolated", note: "Derived at ~0.6 emp/ksf (typical municipal library staffing)" },
    ] },
  { code: "591", name: "Lodge / Fraternal Organization",           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 25.50, amRate: 0.20, pmRate: 0.66, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.50, satMultiplier: 1.40, passByPctPm:  0, internalCapturePctPm: 0 },
  { code: "610", name: "Hospital",                                 unit: "Beds",                  unitShort: "beds",     dailyRate: 11.85, amRate: 1.05, pmRate: 1.17, directionalSplitPm: { in: 0.36, out: 0.64 }, amDirectionalIn: 0.66, satMultiplier: 0.65, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "1,000 sqft GFA",    unitShort: "ksf",   dailyRate: 10.77, amRate: 0.95, pmRate: 1.06, confidence: "ite_published", note: "ITE 11th — Hospital per-ksf" },
      { unit: "Employees",         unitShort: "emp",   dailyRate:  3.79, amRate: 0.34, pmRate: 0.37, confidence: "ite_published", note: "ITE 11th — Hospital per-employee" },
      { unit: "Licensed Beds",     unitShort: "lic",   dailyRate: 10.07, amRate: 0.89, pmRate: 0.99, confidence: "interpolated", note: "Derived at ~85% beds licensed/staffed (typical acute-care)" },
      { unit: "Surgical Suites",   unitShort: "OR",    dailyRate: 593, amRate: 53, pmRate: 59, confidence: "interpolated", note: "Derived at ~50 beds per OR (typical full-service hospital)" },
    ] },
  { code: "620", name: "Nursing Home",                             unit: "Beds",                  unitShort: "beds",     dailyRate:  3.06, amRate: 0.19, pmRate: 0.26, directionalSplitPm: { in: 0.42, out: 0.58 }, amDirectionalIn: 0.61, satMultiplier: 0.55, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  6.80, amRate: 0.42, pmRate: 0.58, confidence: "ite_published", note: "ITE 11th — Nursing Home per-employee" },
      { unit: "Residents",         unitShort: "res",   dailyRate:  3.22, amRate: 0.20, pmRate: 0.27, confidence: "interpolated", note: "Derived at 95% bed occupancy (typical SNF census)" },
    ] },
  { code: "630", name: "Clinic",                                   unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 37.60, amRate: 2.85, pmRate: 5.18, directionalSplitPm: { in: 0.31, out: 0.69 }, amDirectionalIn: 0.69, satMultiplier: 0.20, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 31.45, amRate: 2.38, pmRate: 4.33, confidence: "interpolated", note: "Derived at ~1.2 emp/ksf (typical outpatient clinic staffing)" },
      { unit: "Exam Rooms",        unitShort: "exam",  dailyRate: 75.20, amRate: 5.70, pmRate: 10.36, confidence: "interpolated", note: "Derived at ~0.5 exam rooms/ksf (typical urgent-care / specialty clinic)" },
      { unit: "Practitioners",     unitShort: "pract", dailyRate: 188.0, amRate: 14.25, pmRate: 25.90, confidence: "interpolated", note: "Derived at ~5 ksf per practitioner (typical multi-specialty clinic)" },
    ] },

  // ---------- Office ----------
  { code: "710", name: "General Office",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 10.84, amRate: 1.43, pmRate: 1.44, directionalSplitPm: { in: 0.17, out: 0.83 }, amDirectionalIn: 0.86, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  3.28, amRate: 0.43, pmRate: 0.44, confidence: "ite_published", note: "ITE 11th — General Office per-employee" },
    ] },
  { code: "712", name: "Small Office Building",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 16.19, amRate: 2.32, pmRate: 2.45, directionalSplitPm: { in: 0.19, out: 0.81 }, amDirectionalIn: 0.86, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  4.04, amRate: 0.58, pmRate: 0.61, confidence: "interpolated", note: "Derived at ~250 sqft/employee (small-office staffing)" },
    ] },
  { code: "715", name: "Single Tenant Office Building",            unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 11.57, amRate: 1.60, pmRate: 1.74, directionalSplitPm: { in: 0.17, out: 0.83 }, amDirectionalIn: 0.86, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  2.89, amRate: 0.40, pmRate: 0.44, confidence: "interpolated", note: "Derived at ~250 sqft/employee" },
    ] },
  { code: "720", name: "Medical / Dental Office",                  unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 36.00, amRate: 2.78, pmRate: 3.46, directionalSplitPm: { in: 0.28, out: 0.72 }, amDirectionalIn: 0.79, satMultiplier: 0.20, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  9.00, amRate: 0.70, pmRate: 0.87, confidence: "ite_published", note: "ITE 11th — Medical/Dental Office per-employee" },
      { unit: "Exam Rooms",        unitShort: "exam",  dailyRate: 90.00, amRate: 6.95, pmRate: 8.65, confidence: "interpolated", note: "Derived at ~0.4 exam rooms/ksf (typical medical/dental office)" },
      { unit: "Practitioners",     unitShort: "pract", dailyRate: 270.0, amRate: 20.85, pmRate: 25.95, confidence: "interpolated", note: "Derived at ~7.5 ksf per practitioner (typical solo/small-group MOB)" },
    ] },
  { code: "730", name: "Government Office Building",               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 22.59, amRate: 2.62, pmRate: 2.50, directionalSplitPm: { in: 0.33, out: 0.67 }, amDirectionalIn: 0.83, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  5.65, amRate: 0.66, pmRate: 0.63, confidence: "interpolated", note: "Derived at ~250 sqft/employee (gov office)" },
    ] },
  { code: "750", name: "Office Park",                              unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 11.42, amRate: 1.46, pmRate: 1.50, directionalSplitPm: { in: 0.17, out: 0.83 }, amDirectionalIn: 0.86, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  3.46, amRate: 0.44, pmRate: 0.45, confidence: "ite_published", note: "ITE 11th — Office Park per-employee" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 159.9, amRate: 20.4, pmRate: 21.0, confidence: "interpolated", note: "Derived at ~14 ksf/acre (suburban office park FAR)" },
    ] },
  { code: "760", name: "Research & Development Center",            unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  8.11, amRate: 1.07, pmRate: 1.08, directionalSplitPm: { in: 0.19, out: 0.81 }, amDirectionalIn: 0.83, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  2.77, amRate: 0.37, pmRate: 0.37, confidence: "ite_published", note: "ITE 11th — R&D per-employee" },
    ] },
  { code: "770", name: "Business Park",                            unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 12.44, amRate: 1.26, pmRate: 1.29, directionalSplitPm: { in: 0.34, out: 0.66 }, amDirectionalIn: 0.79, satMultiplier: 0.10, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  4.04, amRate: 0.41, pmRate: 0.42, confidence: "interpolated", note: "Derived at ~325 sqft/employee (mixed-use business park)" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 124.4, amRate: 12.6, pmRate: 12.9, confidence: "interpolated", note: "Derived at ~10 ksf/acre (suburban business park FAR)" },
    ] },

  // ---------- Retail ----------
  { code: "820", name: "Shopping Center (≤100 ksf)",                unit: "1,000 sqft GLA",        unitShort: "ksf",      dailyRate: 37.75, amRate: 0.94, pmRate: 3.40, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 25, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 15.10, amRate: 0.38, pmRate: 1.36, confidence: "ite_published", note: "ITE 11th — Shopping Center per-employee" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 377.5, amRate: 9.40, pmRate: 34.0, confidence: "interpolated", note: "Derived at ~10 ksf/acre (typical strip retail FAR)" },
      { unit: "Tenants",           unitShort: "tnt",   dailyRate: 113.3, amRate: 2.82, pmRate: 10.20, confidence: "interpolated", note: "Derived at ~3 ksf/tenant (typical small-format shopping center)" },
      { unit: "Parking Spaces",    unitShort: "stalls", dailyRate: 9.44, amRate: 0.24, pmRate: 0.85, confidence: "interpolated", note: "Derived at ~4 stalls/ksf (typical suburban retail parking standard)" },
    ] },
  { code: "821", name: "Shopping Plaza (40–150 ksf)",               unit: "1,000 sqft GLA",        unitShort: "ksf",      dailyRate: 67.52, amRate: 1.73, pmRate: 5.40, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.20, passByPctPm: 28, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 27.01, amRate: 0.69, pmRate: 2.16, confidence: "interpolated", note: "Derived at ~2.5 emp/ksf (typical mid-format shopping plaza)" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 675.2, amRate: 17.3, pmRate: 54.0, confidence: "interpolated", note: "Derived at ~10 ksf/acre" },
    ] },
  { code: "822", name: "Strip Retail Plaza (<40 ksf)",              unit: "1,000 sqft GLA",        unitShort: "ksf",      dailyRate: 54.45, amRate: 2.36, pmRate: 6.59, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.20, passByPctPm: 34, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 21.78, amRate: 0.94, pmRate: 2.64, confidence: "interpolated", note: "Derived at ~2.5 emp/ksf" },
    ] },
  { code: "840", name: "Automobile Sales (New)",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 27.84, amRate: 1.74, pmRate: 2.43, directionalSplitPm: { in: 0.42, out: 0.58 }, amDirectionalIn: 0.78, satMultiplier: 1.00, passByPctPm: 20, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 12.65, amRate: 0.79, pmRate: 1.11, confidence: "interpolated", note: "Derived at ~2.2 emp/ksf (typical new-car dealership)" },
      { unit: "Inventory Vehicles", unitShort: "veh",  dailyRate:  1.39, amRate: 0.09, pmRate: 0.12, confidence: "interpolated", note: "Derived at ~20 inventory vehicles/ksf (typical new-car lot density)" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 222.7, amRate: 13.92, pmRate: 19.44, confidence: "interpolated", note: "Derived at ~8 ksf/acre (typical dealership site coverage)" },
    ] },
  { code: "841", name: "Automobile Sales (Used)",                   unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 27.06, amRate: 1.74, pmRate: 3.75, directionalSplitPm: { in: 0.42, out: 0.58 }, amDirectionalIn: 0.78, satMultiplier: 1.00, passByPctPm: 20, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Inventory Vehicles", unitShort: "veh",  dailyRate:  1.35, amRate: 0.09, pmRate: 0.19, confidence: "interpolated", note: "Derived at ~20 inventory vehicles/ksf (typical used-car lot density)" },
    ] },
  { code: "843", name: "Auto Parts Sales",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 54.74, amRate: 2.36, pmRate: 4.91, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 30, internalCapturePctPm: 0 },
  { code: "848", name: "Tire Store",                                unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 27.69, amRate: 0.84, pmRate: 4.39, directionalSplitPm: { in: 0.40, out: 0.60 }, amDirectionalIn: 0.59, satMultiplier: 1.00, passByPctPm: 28, internalCapturePctPm: 0 },
  { code: "850", name: "Supermarket",                               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 93.84, amRate: 3.40, pmRate: 9.24, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.62, satMultiplier: 1.20, passByPctPm: 36, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 24.69, amRate: 0.89, pmRate: 2.43, confidence: "ite_published", note: "ITE 11th — Supermarket per-employee" },
      { unit: "Cashier Lanes",     unitShort: "lanes", dailyRate: 586.5, amRate: 21.25, pmRate: 57.75, confidence: "interpolated", note: "Derived at ~1 lane per 6.25 ksf (typical full-service supermarket)" },
    ] },
  { code: "851", name: "Convenience Market",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 762.28, amRate: 65.38, pmRate: 49.11, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.51, satMultiplier: 0.85, passByPctPm: 61, internalCapturePctPm: 0 },
  { code: "857", name: "Discount Club",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 41.80, amRate: 0.85, pmRate: 4.18, directionalSplitPm: { in: 0.49, out: 0.51 }, amDirectionalIn: 0.61, satMultiplier: 1.25, passByPctPm: 30, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 27.87, amRate: 0.57, pmRate: 2.79, confidence: "interpolated", note: "Derived at ~1.5 emp/ksf (warehouse-club staffing)" },
    ] },
  { code: "862", name: "Home Improvement Superstore",               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 30.74, amRate: 0.74, pmRate: 2.33, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 42, internalCapturePctPm: 0 },
  { code: "863", name: "Electronics Superstore",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 41.05, amRate: 0.79, pmRate: 4.50, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 40, internalCapturePctPm: 0 },
  { code: "866", name: "Pet Supply Superstore",                     unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 25.65, amRate: 0.51, pmRate: 3.55, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "867", name: "Office Supply Superstore",                  unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 30.50, amRate: 0.69, pmRate: 3.40, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.20, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "868", name: "Book Superstore",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 25.40, amRate: 0.55, pmRate: 2.85, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "870", name: "Apparel Store",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 66.40, amRate: 1.31, pmRate: 4.20, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 35, internalCapturePctPm: 0 },
  { code: "875", name: "Department Store",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 22.88, amRate: 0.61, pmRate: 1.99, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 30, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 11.44, amRate: 0.31, pmRate: 1.00, confidence: "interpolated", note: "Derived at ~2 emp/ksf (typical anchor department store)" },
    ] },
  { code: "880", name: "Pharmacy w/o Drive-Through",                unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 90.06, amRate: 2.94, pmRate: 8.51, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 49, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Prescription Counters", unitShort: "rx", dailyRate: 1080.7, amRate: 35.28, pmRate: 102.1, confidence: "interpolated", note: "Derived at ~1 prescription counter per 12 ksf (typical chain pharmacy)" },
    ] },
  { code: "881", name: "Pharmacy w/ Drive-Through",                 unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 108.40, amRate: 5.04, pmRate: 10.29, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.61, satMultiplier: 1.10, passByPctPm: 50, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Drive-Through Lanes", unitShort: "DTL", dailyRate: 1301, amRate: 60.48, pmRate: 123.5, confidence: "interpolated", note: "Derived at ~1 DTL per 12 ksf (typical drive-thru pharmacy)" },
    ] },
  { code: "890", name: "Furniture Store",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  5.06, amRate: 0.20, pmRate: 0.52, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.61, satMultiplier: 1.30, passByPctPm: 50, internalCapturePctPm: 0 },

  // ---------- Services / Banks / Food ----------
  { code: "911", name: "Walk-In Bank",                              unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 156.48, amRate: 12.13, pmRate: 21.01, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 0.40, passByPctPm: 35, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 41.73, amRate: 3.23, pmRate: 5.60, confidence: "interpolated", note: "Derived at ~3.75 emp/ksf (typical retail bank staffing)" },
      { unit: "Teller Windows",    unitShort: "tlr",   dailyRate: 313.0, amRate: 24.26, pmRate: 42.02, confidence: "interpolated", note: "Derived at ~0.5 tellers/ksf (typical full-service retail branch)" },
    ] },
  { code: "912", name: "Drive-In Bank",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 100.35, amRate: 12.13, pmRate: 20.45, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.55, satMultiplier: 0.40, passByPctPm: 35, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Drive-Through Lanes", unitShort: "DTL", dailyRate: 100.4, amRate: 12.13, pmRate: 20.45, confidence: "interpolated", note: "Derived at ~1 DTL per ksf (typical 3 ksf / 3-lane drive-in branch)" },
      { unit: "Employees",         unitShort: "emp",   dailyRate: 26.76, amRate: 3.23, pmRate: 5.45, confidence: "interpolated", note: "Derived at ~3.75 emp/ksf" },
    ] },
  { code: "925", name: "Drinking Place / Tavern",                   unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 11.36, amRate: 0.46, pmRate: 11.36, directionalSplitPm: { in: 0.65, out: 0.35 }, amDirectionalIn: 0.55, satMultiplier: 1.30, passByPctPm: 43, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Seats",             unitShort: "seats", dailyRate:  0.42, amRate: 0.017, pmRate: 0.42, confidence: "interpolated", note: "Derived at ~27 seats/ksf (typical tavern seating density)" },
    ] },
  { code: "930", name: "Fast Casual Restaurant",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 315.17, amRate: 9.50, pmRate: 14.13, directionalSplitPm: { in: 0.55, out: 0.45 }, amDirectionalIn: 0.50, satMultiplier: 1.15, passByPctPm: 30, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Seats",             unitShort: "seats", dailyRate:  4.20, amRate: 0.13, pmRate: 0.19, confidence: "interpolated", note: "Derived at ~75 seats/ksf (typical fast-casual layout)" },
    ] },
  { code: "931", name: "Quality Restaurant",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 83.84, amRate: 0.73, pmRate: 7.80, directionalSplitPm: { in: 0.62, out: 0.38 }, amDirectionalIn: 0.55, satMultiplier: 1.20, passByPctPm: 44, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Seats",             unitShort: "seats", dailyRate:  1.20, amRate: 0.010, pmRate: 0.11, confidence: "ite_published", note: "ITE 11th — Quality Restaurant per-seat" },
    ] },
  { code: "932", name: "High-Turnover (Sit-Down) Restaurant",       unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 107.20, amRate: 9.94, pmRate: 9.05, directionalSplitPm: { in: 0.59, out: 0.41 }, amDirectionalIn: 0.55, satMultiplier: 1.15, passByPctPm: 35, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Seats",             unitShort: "seats", dailyRate:  2.30, amRate: 0.21, pmRate: 0.19, confidence: "ite_published", note: "ITE 11th — High-Turnover Restaurant per-seat" },
    ] },
  { code: "933", name: "Fast-Food Restaurant w/o Drive-Through",    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 346.23, amRate: 24.50, pmRate: 28.34, directionalSplitPm: { in: 0.52, out: 0.48 }, amDirectionalIn: 0.51, satMultiplier: 0.95, passByPctPm: 36, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Seats",             unitShort: "seats", dailyRate:  9.90, amRate: 0.70, pmRate: 0.81, confidence: "interpolated", note: "Derived at ~35 seats/ksf (typical QSR layout)" },
    ] },
  { code: "934", name: "Fast-Food Restaurant w/ Drive-Through",     unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 467.48, amRate: 44.61, pmRate: 33.03, directionalSplitPm: { in: 0.51, out: 0.49 }, amDirectionalIn: 0.51, satMultiplier: 0.85, passByPctPm: 40, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Seats",             unitShort: "seats", dailyRate: 13.36, amRate: 1.27, pmRate: 0.94, confidence: "ite_published", note: "ITE 11th — Fast-Food w/ Drive-Through per-seat" },
      { unit: "Drive-Through Lanes", unitShort: "DTL", dailyRate: 1870, amRate: 178.4, pmRate: 132.1, confidence: "interpolated", note: "Derived at ~4 ksf per drive-through lane (typical QSR 1-lane restaurant)" },
    ] },
  { code: "935", name: "Coffee/Donut Shop w/ Drive-Through",        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 533.57, amRate: 101.49, pmRate: 41.95, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 0.70, passByPctPm: 70, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Drive-Through Lanes", unitShort: "DTL", dailyRate: 1067, amRate: 203.0, pmRate: 83.9, confidence: "interpolated", note: "Derived at ~2 ksf per drive-through lane (typical 1-lane coffee shop)" },
      { unit: "Seats",             unitShort: "seats", dailyRate: 17.79, amRate: 3.38, pmRate: 1.40, confidence: "interpolated", note: "Derived at ~30 seats/ksf (typical drive-thru coffee layout)" },
    ] },
  { code: "936", name: "Coffee/Donut Shop w/o Drive-Through",       unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 234.85, amRate: 80.19, pmRate: 36.31, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 0.70, passByPctPm: 60, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Seats",             unitShort: "seats", dailyRate:  4.70, amRate: 1.60, pmRate: 0.73, confidence: "interpolated", note: "Derived at ~50 seats/ksf (typical walk-in coffee shop)" },
    ] },
  { code: "941", name: "Quick Lubrication Vehicle Shop",            unit: "Service Positions",     unitShort: "bays",     dailyRate: 40.00, amRate: 2.34, pmRate: 4.85, directionalSplitPm: { in: 0.45, out: 0.55 }, amDirectionalIn: 0.55, satMultiplier: 1.10, passByPctPm: 40, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate: 13.33, amRate: 0.78, pmRate: 1.62, confidence: "interpolated", note: "Derived at ~3 employees/bay (typical quick-lube staffing)" },
    ] },
  { code: "942", name: "Automobile Care Center",                    unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 23.10, amRate: 1.10, pmRate: 3.11, directionalSplitPm: { in: 0.45, out: 0.55 }, amDirectionalIn: 0.55, satMultiplier: 1.10, passByPctPm: 30, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Service Bays",      unitShort: "bays",  dailyRate: 11.55, amRate: 0.55, pmRate: 1.56, confidence: "interpolated", note: "Derived at ~2 bays/ksf (typical auto-care center layout)" },
    ] },
  { code: "944", name: "Gas Station (no C-store)",                  unit: "Vehicle Fueling Positions", unitShort: "VFP", dailyRate: 168.56, amRate: 11.10, pmRate: 13.99, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 1.05, passByPctPm: 42, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Pumps",             unitShort: "pumps", dailyRate: 337.1, amRate: 22.20, pmRate: 27.98, confidence: "interpolated", note: "Derived at 2 VFP per pump (standard 2-sided fuel dispenser)" },
    ] },
  { code: "945", name: "Gas Station / Convenience Store",           unit: "Vehicle Fueling Positions", unitShort: "VFP", dailyRate: 205.36, amRate: 13.99, pmRate: 14.03, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 1.05, passByPctPm: 50, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Pumps",             unitShort: "pumps", dailyRate: 410.7, amRate: 27.98, pmRate: 28.06, confidence: "interpolated", note: "Derived at 2 VFP per pump" },
      { unit: "C-Store ksf GFA",   unitShort: "ksf",   dailyRate: 762.3, amRate: 65.38, pmRate: 49.11, confidence: "interpolated", note: "Use the c-store sqft; same rate as ITE 851 Convenience Market" },
    ] },
  { code: "947", name: "Self-Service Car Wash",                     unit: "Wash Stalls",           unitShort: "stalls",   dailyRate: 43.94, amRate: 2.34, pmRate: 5.54, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 1.30, passByPctPm: 44, internalCapturePctPm: 0 },
  { code: "948", name: "Automated Car Wash",                        unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate: 77.50, amRate: 4.30, pmRate: 13.60, directionalSplitPm: { in: 0.50, out: 0.50 }, amDirectionalIn: 0.51, satMultiplier: 1.20, passByPctPm: 45, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Wash Tunnels",      unitShort: "tnls",  dailyRate: 116.3, amRate: 6.45, pmRate: 20.40, confidence: "interpolated", note: "Derived at ~1.5 ksf per tunnel (typical conveyorized car wash)" },
    ] },

  // ---------- Industrial ----------
  { code: "110", name: "Light Industrial",                          unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  4.96, amRate: 0.70, pmRate: 0.65, directionalSplitPm: { in: 0.19, out: 0.81 }, amDirectionalIn: 0.81, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  3.05, amRate: 0.43, pmRate: 0.40, confidence: "ite_published", note: "ITE 11th — Light Industrial per-employee" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 39.68, amRate: 5.60, pmRate: 5.20, confidence: "interpolated", note: "Derived at ~8 ksf/acre (typical light-industrial FAR)" },
    ] },
  { code: "130", name: "Industrial Park",                           unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  3.37, amRate: 0.42, pmRate: 0.40, directionalSplitPm: { in: 0.21, out: 0.79 }, amDirectionalIn: 0.81, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  2.36, amRate: 0.29, pmRate: 0.28, confidence: "ite_published", note: "ITE 11th — Industrial Park per-employee" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 33.70, amRate: 4.20, pmRate: 4.00, confidence: "interpolated", note: "Derived at ~10 ksf/acre" },
    ] },
  { code: "140", name: "Manufacturing",                             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  4.75, amRate: 0.74, pmRate: 0.74, directionalSplitPm: { in: 0.36, out: 0.64 }, amDirectionalIn: 0.78, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  2.51, amRate: 0.39, pmRate: 0.39, confidence: "ite_published", note: "ITE 11th — Manufacturing per-employee" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 38.00, amRate: 5.92, pmRate: 5.92, confidence: "interpolated", note: "Derived at ~8 ksf/acre" },
    ] },
  { code: "150", name: "Warehousing",                               unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  1.71, amRate: 0.17, pmRate: 0.18, directionalSplitPm: { in: 0.27, out: 0.73 }, amDirectionalIn: 0.78, satMultiplier: 0.15, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Employees",         unitShort: "emp",   dailyRate:  5.05, amRate: 0.50, pmRate: 0.53, confidence: "ite_published", note: "ITE 11th — Warehousing per-employee" },
      { unit: "Acres",             unitShort: "acres", dailyRate: 17.10, amRate: 1.70, pmRate: 1.80, confidence: "interpolated", note: "Derived at ~10 ksf/acre (typical bulk warehouse coverage)" },
      { unit: "Truck Dock Doors",  unitShort: "dock",  dailyRate: 17.10, amRate: 1.70, pmRate: 1.80, confidence: "interpolated", note: "Derived at ~1 dock door per 10 ksf (typical bulk-warehouse loading)" },
    ] },
  { code: "151", name: "Mini-Warehouse / Self-Storage",             unit: "1,000 sqft GFA",        unitShort: "ksf",      dailyRate:  1.51, amRate: 0.10, pmRate: 0.17, directionalSplitPm: { in: 0.48, out: 0.52 }, amDirectionalIn: 0.51, satMultiplier: 1.10, passByPctPm:  0, internalCapturePctPm: 0,
    secondaryVariables: [
      { unit: "Storage Units",     unitShort: "units", dailyRate:  0.15, amRate: 0.010, pmRate: 0.017, confidence: "interpolated", note: "Derived at ~100 sqft per rentable unit" },
    ] },
];

/**
 * Resolve the active rate set + unit metadata for a given land use and the
 * variable the user picked. `variableUnitShort` matches against the primary
 * `unitShort` (default) or any secondary's `unitShort`. Returns the
 * resolved unit name + short label + daily/AM/PM rates + a `confidence`
 * tag the renderer surfaces in §4 of the report so a reviewing PE can
 * tell which assumption the screening relied on. Falls back to the
 * primary when `variableUnitShort` is undefined or doesn't match a
 * secondary (caller defends the input first; this fallback is belt-
 * and-braces, not silent-error friendly).
 */
export type ResolvedRates = {
  unit: string;
  unitShort: string;
  dailyRate: number;
  amRate: number;
  pmRate: number;
  /** "ite_published" for the primary variable; the secondary's value otherwise. */
  confidence: "ite_published" | "interpolated";
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
        note: sec.note,
        isSecondary: true,
      };
    }
  }
  // Primary — ITE-published rates are the canonical entries for this code.
  return {
    unit: lu.unit,
    unitShort: lu.unitShort,
    dailyRate: lu.dailyRate,
    amRate: lu.amRate,
    pmRate: lu.pmRate,
    confidence: "ite_published",
    isSecondary: false,
  };
}

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
