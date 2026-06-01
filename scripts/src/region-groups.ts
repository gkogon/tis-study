/**
 * Motorization-aware region grouping for synthetic-AADT calibration.
 *
 * The single global per-class AADT baseline was wrong by ~3.5x between regions:
 * measured medians run ~6.5k vph-equivalent in European cities (Paris, Madrid)
 * vs ~23k in Japanese ones (Tokyo, Osaka). "Continent" is too crude an axis —
 * it would lump high-motorization Gulf states with dense low-motorization South
 * Asia, repeating the same mistake. So we group by *motorization regime*:
 *
 *   north_america  US/CA/MX        — legacy US baseline (DOT-anchored)
 *   europe         EU + UK + Balkans + Baltics + Ukraine — measured-anchored (Paris/Madrid/Berlin)
 *   east_asia      JP/KR/TW/HK/SG  — high-volume dense; measured-anchored (Tokyo/Osaka)
 *   gulf           Gulf + Levant + Türkiye — high motorization, car-dependent (ESTIMATE)
 *   south_se_asia  South + SE + Central Asia — dense, lower motorization, high congestion (ESTIMATE)
 *   africa         Sub-Saharan + North Africa — sparse networks, low motorization (ESTIMATE)
 *   latin_america  South + Central America + Caribbean — mid motorization (ESTIMATE)
 *   oceania        AU/NZ           — car-dependent, low density (ESTIMATE)
 *
 * Only north_america/europe/east_asia are anchored to measured AADT (the cities
 * where we have real counts). The other five are scaled estimates — honest, and
 * exactly why the international tier stays `aadtQuality: "synthetic"`.
 */

export type RegionGroup =
  | "north_america"
  | "europe"
  | "east_asia"
  | "gulf"
  | "south_se_asia"
  | "africa"
  | "latin_america"
  | "oceania";

/** country code (the `country` field on a region; ISO 3166-1 alpha-2, with the
 *  alpha-3 collision-forms also accepted) → group. US/undefined → north_america. */
const COUNTRY_TO_GROUP: Record<string, RegionGroup> = {
  // North America
  US: "north_america", CA: "north_america", MX: "north_america",
  // Europe (EU + UK + EFTA + Balkans + Baltics + Ukraine)
  DE: "europe", FR: "europe", IT: "europe", ES: "europe", NL: "europe",
  BE: "europe", CH: "europe", AT: "europe", PT: "europe", IE: "europe",
  PL: "europe", CZ: "europe", HU: "europe", RO: "europe", SE: "europe",
  NO: "europe", DK: "europe", FI: "europe", GR: "europe", UK: "europe",
  UA: "europe", RS: "europe", BG: "europe", HR: "europe", LT: "europe",
  // East Asia (high-volume dense)
  JP: "east_asia", KR: "east_asia", TW: "east_asia", HK: "east_asia", SG: "east_asia",
  // Gulf / Levant / Türkiye (high motorization, car-dependent)
  AE: "gulf", SA: "gulf", QA: "gulf", KW: "gulf", OM: "gulf",
  IL: "gulf", ISR: "gulf", JO: "gulf", LB: "gulf", TR: "gulf",
  // South + Southeast + Central Asia (dense, lower motorization, high congestion)
  IN: "south_se_asia", IND: "south_se_asia", ID: "south_se_asia", IDN: "south_se_asia",
  MY: "south_se_asia", PK: "south_se_asia", TH: "south_se_asia", VN: "south_se_asia",
  PH: "south_se_asia", BD: "south_se_asia", UZ: "south_se_asia", KZ: "south_se_asia",
  // Africa
  ZA: "africa", EG: "africa", NG: "africa", KE: "africa", MA: "africa", MAR: "africa",
  GH: "africa", ET: "africa", TZ: "africa", SN: "africa", TN: "africa",
  // Latin America (South + Central America + Caribbean)
  BR: "latin_america", AR: "latin_america", CL: "latin_america",
  CO: "latin_america", COL: "latin_america", PE: "latin_america",
  UY: "latin_america", EC: "latin_america", PA: "latin_america", PAN: "latin_america",
  CR: "latin_america", CU: "latin_america",
  // Oceania
  AU: "oceania", NZ: "oceania",
};

export function regionGroup(country: string | undefined): RegionGroup {
  if (!country) return "north_america"; // US regions omit `country` (back-compat default)
  return COUNTRY_TO_GROUP[country] ?? "north_america";
}

/** Returns the country codes not covered by COUNTRY_TO_GROUP, for gap auditing. */
export function uncoveredCountries(countries: Iterable<string>): string[] {
  const out: string[] = [];
  for (const c of countries) {
    if (c !== "US" && !(c in COUNTRY_TO_GROUP)) out.push(c);
  }
  return out;
}
