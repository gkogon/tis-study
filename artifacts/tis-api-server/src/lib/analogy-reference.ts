/**
 * Screening-grade curated analogy reference library for trip distribution.
 *
 * Implements ComparableSource as an in-process curated table that maps
 * land-use family × area-type to a directional OctantProfile and a
 * distance-decay rate.  The interface is intentionally designed for
 * substitution: a DB-backed ComparableSource (seeded from actual comparable
 * TIS submissions) can implement the same interface and be consulted BEFORE
 * falling through to this library.  The caller simply tries the DB source
 * first and falls back here — "library now, DB later."
 *
 * Pure leaf: imports ONLY from ./caltran-gravity.
 */
import { CARDINALS } from "./caltran-gravity";

// Make CARDINALS visible to consumers that import this module (re-export not
// needed; the import ensures the leaf dependency graph is correct).
void CARDINALS;

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Broad land-use category derived from an ITE-style numeric land-use code. */
export type LandUseFamily =
  | "retail"
  | "office"
  | "residential"
  | "industrial"
  | "medical"
  | "hotel"
  | "restaurant"
  | "education"
  | "recreation"
  | "other";

/** Urbanization classification derived from the site's density index. */
export type AreaType = "cbd" | "urban" | "suburban" | "rural";

/**
 * Eight relative weights, one per compass octant (NNE, ENE, ENE, ESE, SSE,
 * SSW, WSW, WNW, NNW — the same clockwise order as CARDINALS), oriented so
 * index 0 = the DOMINANT approach octant.  Values are relative; they are
 * normalized to Σ = 1 at use.
 */
export type OctantProfile = readonly [
  number, // 0 = dominant octant
  number, // +45° clockwise
  number, // +90°
  number, // +135°
  number, // +180° (opposite corridor)
  number, // +225°
  number, // +270°
  number, // +315°
];

export type AnalogyPattern = {
  /** Relative octant weights (normalized at use). */
  profile: OctantProfile;
  /**
   * Distance-decay coefficient λ: exp(−λ · distanceMi).
   * Larger λ → shorter effective trip length (restaurant, education).
   * Smaller λ → longer effective trip length (industrial, retail).
   */
  decayPerMile: number;
  /**
   * Human-readable basis statement.  Included verbatim in the PDF study to
   * disclose the screening-grade nature of the estimate and instruct the
   * reviewer on when a site-specific comparable is required.
   */
  basis: string;
};

/** A source of comparable directional-distribution patterns. */
export interface ComparableSource {
  /**
   * Return the best pattern for the given family × area-type combination.
   * Never returns null for recognized inputs (falls back internally).
   * Returns null only when the source genuinely has no applicable entry —
   * callers must guard and try the next source.
   */
  find(
    family: LandUseFamily,
    areaType: AreaType,
  ): { pattern: AnalogyPattern; matched: string } | null;
}

// ---------------------------------------------------------------------------
// ITE-code → land-use family mapping
// ---------------------------------------------------------------------------

/**
 * Map an ITE-style land-use code string (e.g. "820", "710", "220") to its
 * broad LandUseFamily.  Parses the leading integer of the code; non-numeric
 * codes → "other".
 *
 * Numeric ranges follow ITE Trip Generation Manual groupings:
 *   100–199  Industrial / warehouse / manufacturing
 *   200–299  Residential (single-family, multi-family, mobile home)
 *   310/311/320  Hotel / motel
 *   400–499  Recreation (parks, golf, stadiums, marinas)
 *   520–545/550  Educational (schools, universities, day care)
 *   610/620/630/640/650  Medical (hospital, clinic, nursing home)
 *   700–799  Office (general, medical, government)
 *   800–899  Retail (shopping center, hardware, furniture, auto)
 *   912  Drive-in bank → retail
 *   931/932/934/936/937/938  Restaurant / fast-food / coffee
 *   940–949  Convenience / gas / service station → retail
 */
export function landUseFamily(code: string): LandUseFamily {
  const leading = parseInt(code, 10);
  if (!Number.isFinite(leading)) return "other";
  const n = Math.floor(Math.abs(leading));

  // Specific overrides evaluated before the range sweep.
  if (n === 310 || n === 311 || n === 320) return "hotel";
  if (n === 912) return "retail";
  if (n === 931 || n === 932 || n === 934 || n === 936 || n === 937 || n === 938) return "restaurant";

  if (n >= 100 && n <= 199) return "industrial";
  if (n >= 200 && n <= 299) return "residential";
  if (n >= 400 && n <= 499) return "recreation";
  if ((n >= 520 && n <= 545) || n === 550) return "education";
  if (n === 610 || n === 620 || n === 630 || n === 640 || n === 650) return "medical";
  if (n >= 700 && n <= 799) return "office";
  if (n >= 800 && n <= 899) return "retail";
  if (n >= 940 && n <= 949) return "retail";

  return "other";
}

// ---------------------------------------------------------------------------
// Density index → area type
// ---------------------------------------------------------------------------

/**
 * Classify a site's urbanization level from its density index (0–1 scale
 * derived from median surrounding intersection volume / 30 k-AADT reference).
 *
 *   ≥ 0.60  →  cbd       (dense urban core; very flat directional profile)
 *   ≥ 0.33  →  urban     (inner city / traditional grid)
 *   ≥ 0.12  →  suburban  (typical arterial corridor)
 *   <  0.12  →  rural     (low-volume environment; corridor-concentrated)
 */
export function areaTypeFromDensity(densityIndex: number): AreaType {
  if (densityIndex >= 0.6) return "cbd";
  if (densityIndex >= 0.33) return "urban";
  if (densityIndex >= 0.12) return "suburban";
  return "rural";
}

// ---------------------------------------------------------------------------
// Curated profiles
// ---------------------------------------------------------------------------

/**
 * OctantProfile by area type.  Index 0 = the dominant approach octant;
 * subsequent entries are at +45° increments clockwise.
 *
 * Design rationale (symmetric about the dominant axis — no left/right bias):
 *   - Denser (CBD)   → flat/omnidirectional; trips arrive from all directions.
 *   - Sparser (rural) → highly corridor-concentrated; most trips from one axis.
 *
 * Values are relative (normalized to Σ=1 at use).
 */
const AREA_PROFILES: Record<AreaType, OctantProfile> = {
  //              dom   +45  +90  +135  opp  +225  +270  +315
  cbd:       [1.25, 1.15, 1.05, 0.95, 0.85, 0.95, 1.05, 1.15],
  urban:     [1.60, 1.30, 1.00, 0.80, 0.65, 0.80, 1.00, 1.30],
  suburban:  [2.30, 1.60, 1.00, 0.60, 0.40, 0.60, 1.00, 1.60],
  rural:     [3.00, 1.90, 0.95, 0.45, 0.30, 0.45, 0.95, 1.90],
} as const;

/**
 * Distance-decay coefficient by land-use family.
 * Represents exp(−λ · mi): larger λ → shorter trips.
 *
 *   restaurant  1.5  (strong neighborhood catchment; very short trips)
 *   education   1.2  (local feeder zones; school-to-home model)
 *   residential 1.1  (trip origins close to home)
 *   office      1.0  (metropolitan-scale commute; moderate decay)
 *   medical     0.9  (regional draw; specialist travel)
 *   hotel       0.9  (regional/national visitors; airport corridor draw)
 *   recreation  0.9  (regional park / stadium draw)
 *   retail      0.7  (regional shopping; trade-area model)
 *   industrial  0.6  (distribution / logistics; long-haul component)
 *   other       1.0  (default when family is unknown)
 */
const FAMILY_DECAY: Record<LandUseFamily, number> = {
  restaurant:   1.5,
  education:    1.2,
  residential:  1.1,
  office:       1.0,
  medical:      0.9,
  hotel:        0.9,
  recreation:   0.9,
  retail:       0.7,
  industrial:   0.6,
  other:        1.0,
};

// ---------------------------------------------------------------------------
// Reference library implementation
// ---------------------------------------------------------------------------

/**
 * In-process curated ComparableSource.
 *
 * Future extension path:
 *   1. Build a DB-backed ComparableSource seeded from actual TIS submissions.
 *   2. Consult the DB source first in analogyCore (trip-distribution.ts).
 *   3. Fall through to REFERENCE_LIBRARY only when the DB has no match.
 *
 * The interface is identical for both — callers need no change.
 */
export const REFERENCE_LIBRARY: ComparableSource = {
  find(family: LandUseFamily, areaType: AreaType): { pattern: AnalogyPattern; matched: string } {
    // Resolve to a valid profile even for unknown combinations by clamping to
    // the nearest recognized value.  The public API guarantees non-null.
    const resolvedFamily: LandUseFamily = FAMILY_DECAY[family] != null ? family : "other";
    const resolvedArea: AreaType = AREA_PROFILES[areaType] != null ? areaType : "suburban";

    const profile = AREA_PROFILES[resolvedArea];
    const decayPerMile = FAMILY_DECAY[resolvedFamily] ?? 1.0;
    const matched = `${resolvedFamily} / ${resolvedArea}`;

    const basis =
      `Screening-grade typical directional concentration for ${resolvedFamily} land use in ` +
      `${resolvedArea} settings, oriented to the site's primary access corridor; ` +
      `NOT a site-specific comparable — replace with a comparable existing ` +
      `development's distribution or an O-D study before formal submittal.`;

    return {
      pattern: { profile, decayPerMile, basis },
      matched,
    };
  },
};
