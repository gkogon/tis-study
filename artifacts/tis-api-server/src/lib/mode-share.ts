/**
 * Per-metro auto-mode-share defaults applied at the screening level.
 *
 * Background — Caltran flagged in their meeting feedback that the engine
 * treats every metro as 100% auto, which produces obviously-wrong trip
 * counts in transit-heavy markets ("NYC has the subway"). At a screening-
 * level tool's resolution we can't run a full mode-choice model per
 * project, but we CAN apply a per-metro default auto-mode-share to the
 * external-trip total before assignment. Trip counts at affected
 * intersections then reflect the actual share of project trips that
 * actually arrive by car.
 *
 * Source: American Community Survey (ACS) 5-Year Estimates, Table B08301
 * "Means of Transportation to Work" — drive-alone + carpool share by
 * metro. International metros use local equivalents (TfL Travel-to-Work
 * in London; Eurostat / OECD for Europe; MLIT for Japan; etc.).
 *
 * Resolution caveats:
 *   - Trip-to-work mode share is a useful proxy for project trips, but
 *     it's not exact — project trips include non-work travel which is
 *     usually MORE auto-dependent than commute travel. So these defaults
 *     are slightly conservative (under-state auto). For a screening
 *     output that's a safer default than the opposite.
 *   - Some metros have huge intra-MSA variation (NYC: Manhattan is ~20%
 *     auto, outer Long Island is ~85% auto). The metro-level number is
 *     the right default for a screening tool; a real TIS would use the
 *     project-specific TAZ.
 *
 * Roadmap: the right next step is project-specific mode share, derived
 * from the project's coordinate via TAZ-level data per metro. Multi-week
 * data integration; deferred until first metro-tier customer signs.
 */

const FALLBACK_AUTO_SHARE = 0.90; // US suburban / low-transit default

/**
 * Per-region auto mode share, keyed by Region.code. The structure is a
 * flat lookup so adding a new metro is a one-line change. Where a metro
 * isn't listed the engine falls back to FALLBACK_AUTO_SHARE.
 */
const PER_REGION_AUTO_SHARE: Record<string, number> = {
  // ---------- US metros (ACS 5-yr B08301, drive-alone + carpool) ----------

  // High-transit (≤55% auto): the markets where the 100% auto assumption
  // was most obviously wrong.
  "new_york_metro": 0.32,            // NYC-Newark-Jersey MSA
  "washington_metro": 0.45,          // DC-VA-MD-WV MSA
  "san_francisco_metro": 0.47,       // SF-Oakland-Berkeley MSA
  "boston_metro": 0.51,              // Boston-Cambridge-Newton MSA
  "philadelphia_metro": 0.55,        // Philadelphia MSA — old urban core lowers it

  // Mid-transit (55–70% auto).
  "chicago_metro": 0.60,
  "seattle_metro": 0.62,
  "portland_metro": 0.68,
  "los_angeles_metro": 0.70,         // surprisingly low for LA — Metrolink + Metro Rail

  // Modest-transit (70–80% auto): most large US metros.
  "denver_metro": 0.74,
  "minneapolis_metro": 0.75,
  "pittsburgh_metro": 0.75,
  "san_diego_metro": 0.76,
  "baltimore_metro": 0.78,
  "atlanta_metro": 0.78,             // MARTA serves only ~15% of metro pop
  "miami_dade_metro": 0.78,
  "honolulu_metro": 0.78,

  // Default-tier (≥80%) — let the FALLBACK_AUTO_SHARE catch these, with
  // a few exceptions where we have specific data.
  "houston_metro": 0.85,
  "phoenix_metro": 0.86,
  "dallas_fort_worth_metro": 0.86,
  "charlotte_metro": 0.88,
  "tampa_metro": 0.88,
  "orlando_metro": 0.88,
  "jacksonville_metro": 0.90,
  "nashville_metro": 0.90,
  "indianapolis_metro": 0.91,
  "san_antonio_metro": 0.91,
  "memphis_metro": 0.92,
  "oklahoma_city_metro": 0.92,

  // ---------- Canada ----------
  "toronto_metro": 0.55,             // TTC + GO Transit
  "montreal_metro": 0.58,
  "vancouver_metro": 0.55,           // SkyTrain
  "calgary_metro": 0.72,
  "edmonton_metro": 0.78,
  "ottawa_metro": 0.65,

  // ---------- UK ----------
  "london_metro": 0.38,              // TfL Travel in London Report — incl. cycle/walk
  "manchester_metro": 0.60,
  "birmingham_metro": 0.65,
  "leeds_metro": 0.70,
  "glasgow_metro": 0.62,
  "edinburgh_metro": 0.55,           // very strong bus + tram

  // ---------- Europe (Eurostat / national stats) ----------
  "paris_metro": 0.40,               // Île-de-France including outer suburbs
  "berlin_metro": 0.45,
  "madrid_metro": 0.50,
  "barcelona_metro": 0.45,
  "rome_metro": 0.55,
  "milan_metro": 0.50,
  "munich_metro": 0.50,
  "hamburg_metro": 0.52,
  "vienna_metro": 0.40,
  "amsterdam_metro": 0.35,           // dense transit + cycle
  "rotterdam_metro": 0.50,
  "stockholm_metro": 0.45,
  "copenhagen_metro": 0.45,
  "zurich_metro": 0.45,
  "lisbon_metro": 0.55,
  "warsaw_metro": 0.55,
  "prague_metro": 0.45,
  "budapest_metro": 0.45,
  "athens_metro": 0.55,
  "dublin_metro": 0.65,
  "brussels_metro": 0.50,

  // ---------- East Asia ----------
  "tokyo_metro": 0.30,               // MLIT / Tokyo Metropolitan Govt 2020
  "osaka_metro": 0.40,
  "fukuoka_metro": 0.55,
  "sapporo_metro": 0.55,
  "seoul_metro": 0.35,
  "busan_metro": 0.50,
  "incheon_metro": 0.40,
  "taipei_metro": 0.35,
  "kaohsiung_metro": 0.55,
  "hong_kong_metro": 0.10,           // ~90% transit/walk; near-unique globally
  "singapore_metro": 0.30,
  "bangkok_metro": 0.50,
  "shanghai_metro": 0.40,
  "beijing_metro": 0.40,
  "shenzhen_metro": 0.40,
  "guangzhou_metro": 0.40,
  "chengdu_metro": 0.50,

  // ---------- South / Southeast Asia ----------
  "mumbai_metro": 0.30,              // ~70% walk/transit/auto-rickshaw
  "delhi_metro": 0.40,
  "bangalore_metro": 0.50,
  "hyderabad_metro": 0.55,
  "chennai_metro": 0.50,
  "kolkata_metro": 0.30,
  "manila_metro": 0.45,
  "jakarta_metro": 0.50,
  "ho_chi_minh_metro": 0.55,
  "hanoi_metro": 0.55,
  "kuala_lumpur_metro": 0.65,
  "dhaka_metro": 0.35,

  // ---------- Middle East ----------
  "dubai_metro": 0.70,
  "abu_dhabi_metro": 0.80,
  "doha_metro": 0.80,
  "riyadh_metro": 0.85,              // pre-transit-buildout
  "kuwait_city_metro": 0.90,
  "tel_aviv_metro": 0.55,
  "istanbul_metro": 0.50,

  // ---------- Latin America ----------
  "mexico_city_metro": 0.40,         // ENOE
  "guadalajara_metro": 0.55,
  "monterrey_metro": 0.65,
  "buenos_aires_metro": 0.45,
  "sao_paulo_metro": 0.45,
  "rio_metro": 0.45,
  "santiago_metro": 0.55,
  "bogota_metro": 0.45,              // TransMilenio
  "lima_metro": 0.45,

  // ---------- Africa ----------
  "cairo_metro": 0.30,
  "lagos_metro": 0.40,
  "johannesburg_metro": 0.60,
  "cape_town_metro": 0.55,
  "nairobi_metro": 0.45,

  // ---------- Oceania ----------
  "sydney_metro": 0.65,
  "melbourne_metro": 0.65,
  "brisbane_metro": 0.78,
  "perth_metro": 0.82,
  "auckland_metro": 0.78,
};

/**
 * Auto-mode share for the region a project sits in, with a graceful
 * fallback when the metro isn't in the table. Pass-by reductions and
 * internal-capture credits are applied AFTER this — the mode-share
 * multiplier represents the share of generated trips that arrive at
 * the site by car at all.
 */
export function getAutoModeShare(regionCode: string | null | undefined): number {
  if (!regionCode) return FALLBACK_AUTO_SHARE;
  return PER_REGION_AUTO_SHARE[regionCode] ?? FALLBACK_AUTO_SHARE;
}

/**
 * London PTAL bands as published by TfL (0, 1a, 1b, 2, 3, 4, 5, 6a, 6b).
 * Mirrors the band labels surfaced via WebCAT 3.0 and the GIS layer on
 * the London Datastore.
 */
export type PTALBand = "0" | "1a" | "1b" | "2" | "3" | "4" | "5" | "6a" | "6b";

/**
 * Per-PTAL-band auto-mode share for London projects.
 *
 * The flat london_metro 0.38 figure (TfL Travel in London) is a useful
 * Greater-London-wide average, but it is wildly wrong at the band
 * extremes — inner-London PTAL 6a/6b schemes are policy car-free under
 * London Plan T6 Part B ("car-free should be the starting point for
 * development… well-connected by public transport"), while outer-London
 * PTAL 0/1 sites behave close to a UK suburban average.
 *
 * Calibration sources:
 *   - TfL "Travel in London" reports (mode-share curves vs. PTAL band).
 *   - Holloway 985-unit PTAL 6a TA (car-free; ~0% car-mode).
 *   - Registry Beckenham 134-unit PTAL 5 TA (~18% car-mode incl.
 *     parking provision; local Bromley mode share quoted in the TA is
 *     more car-skewed than the inner-London average so we sit closer
 *     to the TfL band curve).
 *   - Hyde Estate 115-unit PTAL 2 TA (~40% car-mode; matches the
 *     flat London average — this is the band the 0.38 default was
 *     unintentionally calibrated to).
 *
 * The flat 0.38 stays in PER_REGION_AUTO_SHARE as the backward-compat
 * default when no PTAL band is supplied by the caller — preserving
 * pre-PTAL behavior for any payload that doesn't yet carry the band.
 */
const PTAL_AUTO_SHARE: Record<PTALBand, number> = {
  "6b": 0.03, // dense central / Zone 1 super-PT; policy car-free zone
  "6a": 0.05, // inner London core; policy car-free zone (T6 Part B)
  "5":  0.18, // strong PT, e.g. Registry Beckenham PTAL 5 ref
  "4":  0.25,
  "3":  0.32,
  "2":  0.40, // matches Hyde Estate PTAL 2 calibration
  "1b": 0.50, // outer London low PT
  "1a": 0.50,
  "0":  0.55, // no SAP in range — close to UK suburban average
};

/**
 * London auto-mode share by PTAL band. When `ptalBand` is undefined
 * the engine falls back to the flat london_metro 0.38 (Travel in
 * London Greater-London-wide average) so older payloads without a
 * PTAL band continue to behave as before.
 */
export function getLondonAutoModeShare(ptalBand?: PTALBand): number {
  if (!ptalBand) return PER_REGION_AUTO_SHARE["london_metro"] ?? FALLBACK_AUTO_SHARE;
  return PTAL_AUTO_SHARE[ptalBand] ?? PER_REGION_AUTO_SHARE["london_metro"] ?? FALLBACK_AUTO_SHARE;
}

/** Same lookup, but returns the source label for the methodology note. */
export function getAutoModeShareSource(regionCode: string | null | undefined): string {
  if (!regionCode || !(regionCode in PER_REGION_AUTO_SHARE)) {
    return "US suburban default (ACS B08301 metropolitan median ≈ 90%)";
  }
  // Most US metros source from ACS 5-Year B08301; international tier
  // uses national stats agencies. Detailed citations live in the
  // mode-share.ts header — the methodology note keeps it short.
  if (regionCode.endsWith("_metro") && PER_REGION_AUTO_SHARE[regionCode] !== undefined) {
    return "ACS 5-Year Estimates Table B08301 (US) or national-stats equivalent";
  }
  return "screening-level metro default";
}
