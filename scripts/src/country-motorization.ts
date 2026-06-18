/**
 * Vehicles per 1000 people, by ISO 3166-1 alpha-2 country code (with the
 * alpha-3 collision-forms used elsewhere in the codebase mirrored in).
 *
 * Used by the per-metro AADT calibrator to extrapolate baselines from
 * measured cities (e.g. Berlin) to unmeasured cities in different countries
 * within the same motorization group (e.g. Athens → Greece motorization).
 *
 * Values are 2020-2023 averages from World Bank + OICA + national stat
 * offices; precision is ±10% — they are scalars on a synthetic baseline,
 * not the baseline itself. Where two countries are in the same group but
 * have very different motorization (Singapore vs Tokyo in east_asia, Egypt
 * vs Morocco in africa), the scalar pulls the synthetic toward the right
 * order of magnitude without claiming false precision.
 *
 * Singapore + Hong Kong are atypical — vehicle ownership is artificially
 * compressed by COE / first-registration tax but per-vehicle utilization
 * is high. The lookup reports the ownership figure; the AADT impact is
 * dampened (see CITY_MOTORIZATION_OVERRIDE below) so the synthetic doesn't
 * crater for those two metros.
 */

export const VEHICLES_PER_1000: Record<string, number> = {
  // North America
  US: 868, CA: 685, MX: 348,
  // Europe (EU + UK + EFTA + Balkans + Baltics + Ukraine + Russia)
  DE: 580, FR: 569, IT: 663, ES: 591, NL: 522, BE: 568, CH: 538, AT: 569,
  PT: 511, IE: 451, PL: 718, CZ: 619, HU: 488, RO: 391, SE: 480, NO: 524,
  DK: 472, FI: 654, GR: 686, UK: 533, GB: 533, BG: 477, RS: 366, HR: 480,
  LT: 530, LV: 416, EE: 583, UA: 215, RU: 369, BY: 374, AL: 196, BA: 280,
  MK: 270, SK: 511, SI: 555, LU: 696, IS: 791, MD: 220, ME: 460, CY: 660,
  MT: 644,
  // East Asia
  JP: 622, KR: 504, TW: 363, HK: 100, SG: 145, MN: 270,
  // Gulf + Levant + Türkiye
  AE: 540, SA: 199, QA: 562, KW: 537, OM: 308, BH: 524,
  IL: 388, ISR: 388, JO: 175, LB: 460, SY: 100, IQ: 110, IR: 220,
  TR: 263, YE: 60, PS: 80,
  // South + Southeast + Central Asia
  IN: 67, IND: 67, ID: 100, IDN: 100, MY: 542, PK: 19, TH: 285, VN: 50,
  PH: 86, BD: 5, LK: 75, NP: 24, MM: 28, KH: 60, LA: 33, BN: 750,
  UZ: 75, KZ: 230, KG: 60, TJ: 50, TM: 175, AF: 30,
  // Africa
  ZA: 200, EG: 53, NG: 70, KE: 27, MA: 90, MAR: 90, GH: 65, ET: 6, TZ: 9,
  SN: 19, TN: 162, DZ: 132, LY: 309, SD: 27, AO: 50, CI: 35, CM: 16,
  ZW: 142, UG: 8, MZ: 6, RW: 5, BJ: 24, ZM: 38, MW: 7, NA: 162, BW: 178,
  SS: 5,
  // Latin America + Caribbean
  BR: 393, AR: 379, CL: 285, CO: 78, COL: 78, PE: 80, UY: 252, EC: 77,
  PA: 180, PAN: 180, CR: 311, CU: 47, BO: 92, PY: 130, VE: 165, GT: 130,
  HN: 117, NI: 70, SV: 75, DO: 207, JM: 188, HT: 18, BS: 280, BB: 463,
  TT: 467,
  // Oceania
  AU: 769, NZ: 877, FJ: 90, PG: 14,
};

/**
 * Per-metro overrides for cases where the country motorization figure under-
 * represents the actual AADT environment. Keyed by region code.
 *
 * Singapore and Hong Kong have very low car ownership (COE / first-reg-tax
 * compress it artificially) but high per-vehicle utilization → real road
 * AADT is comparable to a much higher motorization figure. The override
 * acts as if their motorization were ~3x what the registry says.
 */
export const CITY_MOTORIZATION_OVERRIDE: Record<string, number> = {
  singapore_metro: 350,    // raw SG=145; pumped to ~350 to reflect actual AADT
  hong_kong_metro: 280,    // raw HK=100; pumped to ~280 to reflect actual AADT
};

/**
 * Look up motorization for a (regionCode, country) pair. Returns null if the
 * country is unknown — caller should fall back to region-group reference.
 */
export function metroMotorization(regionCode: string, country: string | undefined): number | null {
  if (regionCode in CITY_MOTORIZATION_OVERRIDE) return CITY_MOTORIZATION_OVERRIDE[regionCode]!;
  if (!country) return VEHICLES_PER_1000.US ?? null;
  return VEHICLES_PER_1000[country] ?? null;
}

/**
 * Mean motorization for a region-group, used as the denominator when scaling
 * a group's baseline to a country with different motorization.
 *
 * Calibrated from the motorization of the cities that anchor each group's
 * baseline. Where a group's baseline is an estimate (gulf, south_se_asia,
 * africa, latin_america, oceania), the reference is the population-weighted
 * group median.
 */
export const GROUP_REFERENCE_MOTORIZATION: Record<string, number> = {
  north_america: 868,   // US DOT-anchored
  canada: 685,          // 10 Canadian metros
  europe: 580,          // Paris/Madrid/Berlin mean
  east_asia: 622,       // Tokyo/Osaka anchor (JP)
  gulf: 400,            // typical Gulf+Levant+Türkiye
  south_se_asia: 100,   // typical South+SE+Central Asia, ex Pakistan/Bangladesh tail
  africa: 80,           // typical Sub-Saharan + North Africa
  latin_america: 250,   // typical LatAm
  oceania: 800,         // AU/NZ
};
