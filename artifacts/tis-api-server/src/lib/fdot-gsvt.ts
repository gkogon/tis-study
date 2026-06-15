/**
 * FDOT Generalized Service Volume Tables (GSVTs) — Q/LOS Handbook v6.0
 * (August 2025), Appendix B. Pure data + row-selection logic, no PDFKit
 * dependency, so the Florida renderer (and any future caller) can pick the
 * applicable peak-hour two-way service volume for a roadway segment by
 * facility type + context class + lane count.
 *
 * Source rows are transcribed verbatim from the Florida TIS build-spec
 * §3.10 (REGIONAL-SPECS/florida-tis-spec.md), which extracted them from
 * Q/LOS v6.0 Appendix B. v6.0 retired the HCM-5th-edition "Class I/II"
 * arterial labels and now keys arterials by FDM Chapter 200 context class
 * (C1 Natural … C6 Urban Core, C2T Rural Town). D = 0.55 statewide.
 *
 * IMPORTANT — what this module does NOT do: it does not infer a segment's
 * context class or lane count. Those are FDOT RCI attributes (Feature 126
 * context class; lane count from the RCI flat file). When the caller does
 * not supply them, the renderer must defer to the methodology meeting /
 * the (future) fdot-data adapter rather than guess.
 */

export type FdotFacility = "freeway" | "arterial";

/** Freeway context buckets used by the Limited Access GSVT. */
export type FdotFreewayContext = "urbanized" | "core_urbanized" | "rural";

/** Arterial context classes per FDM Ch. 200 §200.4 (Table 200.4.1). */
export type FdotContextClass =
  | "C1" | "C2" | "C2T" | "C3R" | "C3C" | "C4" | "C5" | "C6";

export type FdotLos = "B" | "C" | "D" | "E";

/**
 * Freeway peak-hour two-way service volumes (vph) — Q/LOS v6.0 App. B,
 * Limited Access GSVT. `aadtD` is the published AADT equivalent at LOS D
 * where the spec lists one (used for an AADT-level screen).
 */
export const FDOT_FREEWAY_GSVT: ReadonlyArray<{
  context: FdotFreewayContext;
  lanes: number;
  label: string;
  B: number; C: number; D: number; E: number;
  aadtD: number | null;
}> = [
  { context: "urbanized",      lanes: 4, label: "Urbanized 4-lane freeway",       B: 4550, C: 6000,  D: 7400,  E: 7710,  aadtD: 82200 },
  { context: "core_urbanized", lanes: 4, label: "Core Urbanized 4-lane freeway",  B: 4360, C: 5760,  D: 7220,  E: 7550,  aadtD: null },
  { context: "urbanized",      lanes: 6, label: "Urbanized 6-lane freeway",       B: 6490, C: 8910,  D: 11050, E: 11560, aadtD: 122800 },
  { context: "core_urbanized", lanes: 6, label: "Core Urbanized 6-lane freeway",  B: 6160, C: 8360,  D: 10560, E: 11150, aadtD: null },
  { context: "urbanized",      lanes: 8, label: "Urbanized 8-lane freeway",       B: 8580, C: 11820, D: 14710, E: 15440, aadtD: 163400 },
  { context: "core_urbanized", lanes: 8, label: "Core Urbanized 8-lane freeway",  B: 7890, C: 11020, D: 14000, E: 14850, aadtD: null },
  { context: "rural",          lanes: 4, label: "Rural 4-lane divided (uninterrupted)", B: 3650, C: 5040, D: 5950, E: 6640, aadtD: 56700 },
];

/**
 * Arterial (signalized) peak-hour two-way service volumes (vph) — Q/LOS
 * v6.0 App. B. `null` = not defined in v6.0 (C6 LOS C is deliberately
 * undefined: "C6 facilities are neither planned nor designed to achieve
 * auto LOS C"). LOS E is published only for C5/C6; "—" past LOS D for the
 * other classes is F at signal capacity (left `null`).
 */
// Arterial rows. NOTE on the `B` column: Q/LOS v6.0 Appendix B does NOT
// publish LOS B for signalized arterials — the published columns start at
// LOS C because v6.0 frames signal-controlled arterials as "LOS C is the
// service-volume design target, LOS D the planning maximum, LOS E for
// C5/C6 only, F at signal capacity." LOS B is included in the row type as
// `null` so the lookup at floridaGsvtServiceVolume() is type-safe when
// `los: FdotLos` is "B"; the function returns the standard
// "not-published" note in that case.
export const FDOT_ARTERIAL_GSVT: ReadonlyArray<{
  context: FdotContextClass;
  lanes: number;
  label: string;
  B: number | null; C: number | null; D: number | null; E: number | null;
}> = [
  { context: "C3C", lanes: 2, label: "C3C (Suburban Commercial), 2-lane undivided", B: null, C: 1380, D: 1950, E: null },
  { context: "C4",  lanes: 2, label: "C4 (Urban General), 2-lane",                  B: null, C: 1310, D: 1710, E: null },
  { context: "C3C", lanes: 4, label: "C3C, 4-lane divided",                          B: null, C: 2760, D: 3290, E: null },
  { context: "C4",  lanes: 4, label: "C4, 4-lane divided",                           B: null, C: 2070, D: 2980, E: null },
  { context: "C3R", lanes: 4, label: "C3R (Suburban Residential), 4-lane divided",   B: null, C: 3090, D: 3360, E: null },
  { context: "C3C", lanes: 6, label: "C3C, 6-lane divided",                          B: null, C: 4290, D: 4870, E: null },
  { context: "C4",  lanes: 6, label: "C4, 6-lane divided",                           B: null, C: 3850, D: 4560, E: null },
  { context: "C2T", lanes: 2, label: "C2T (Rural Town), 2-lane undivided",           B: null, C: 1310, D: 1710, E: null },
  { context: "C5",  lanes: 4, label: "C5 (Urban Center), 4-lane",                     B: null, C: 2350, D: 3450, E: 3870 },
  { context: "C5",  lanes: 6, label: "C5, 6-lane",                                    B: null, C: 2560, D: 4850, E: 5650 },
  { context: "C6",  lanes: 4, label: "C6 (Urban Core), 4-lane",                       B: null, C: null, D: 2710, E: 3490 },
  { context: "C6",  lanes: 6, label: "C6, 6-lane",                                    B: null, C: null, D: 4960, E: 5350 },
];

/** Material adjustment multipliers (every arterial GSVT). */
export const FDOT_GSVT_MULTIPLIERS: ReadonlyArray<{ treatment: string; factor: number }> = [
  { treatment: "One-way (peak direction)",                 factor: 1.2 },
  { treatment: "2-lane divided with exclusive left-turn",  factor: 1.05 },
  { treatment: "Multilane undivided with exclusive LT",    factor: 0.95 },
  { treatment: "Multilane without exclusive LT",           factor: 0.75 },
  { treatment: "2-lane undivided without exclusive LT",    factor: 0.80 },
  { treatment: "Non-State signalized",                     factor: 0.90 },
  { treatment: "Exclusive right-turn lane",                factor: 1.05 },
];

/**
 * K-factor ranges (Q/LOS v6.0 Ch. 6, Tables 2–3) by facility + context,
 * plus a representative midpoint used for a screening AADT→peak-hour
 * conversion. The midpoint is a SCREENING convenience only; a submittal
 * derives K per-segment from FDOT RCI (KFCTR / K100FCTR).
 */
export const FDOT_K_RANGES: ReadonlyArray<{
  facility: FdotFacility;
  contexts: string;
  min: number; max: number; mid: number;
}> = [
  { facility: "freeway",  contexts: "Rural",            min: 0.085, max: 0.105, mid: 0.095 },
  { facility: "freeway",  contexts: "Urban",            min: 0.075, max: 0.095, mid: 0.085 },
  { facility: "freeway",  contexts: "Urban Core",       min: 0.070, max: 0.090, mid: 0.080 },
  { facility: "arterial", contexts: "C1 / C2 / C2T",    min: 0.085, max: 0.105, mid: 0.095 },
  { facility: "arterial", contexts: "C3C / C3R / C4",   min: 0.075, max: 0.095, mid: 0.085 },
  { facility: "arterial", contexts: "C5 / C6",          min: 0.070, max: 0.090, mid: 0.080 },
];

/** D factor: GSVT default 0.55 statewide; minimum acceptable 0.51. */
export const FDOT_D_FACTOR_DEFAULT = 0.55;
export const FDOT_D_FACTOR_MIN = 0.51;

/** Representative K midpoint for a screening AADT→peak-hour conversion. */
export function floridaRepresentativeK(facility: FdotFacility, context: FdotFreewayContext | FdotContextClass): number {
  if (facility === "freeway") {
    if (context === "rural") return 0.095;
    if (context === "core_urbanized") return 0.080;
    return 0.085; // urbanized
  }
  // arterial — key by context class group
  if (context === "C1" || context === "C2" || context === "C2T") return 0.095;
  if (context === "C5" || context === "C6") return 0.080;
  return 0.085; // C3C / C3R / C4 (and any unspecified arterial context)
}

export type GsvtSelection = {
  label: string;
  serviceVolumeVph: number | null;
  /** True when v6.0 leaves the cell deliberately undefined (C6 LOS C). */
  undefinedByDesign: boolean;
  note?: string;
};

/**
 * Select the GSVT peak-hour two-way service volume (vph) for a segment.
 * Picks the closest published lane count at or above `lanes` for the given
 * context, then reads the requested LOS column. Returns serviceVolumeVph =
 * null with a note when the cell is undefined or no row matches — never a
 * guessed number.
 */
export function floridaGsvtServiceVolume(opts: {
  facility: FdotFacility;
  context: FdotFreewayContext | FdotContextClass;
  lanes: number;
  los: FdotLos;
}): GsvtSelection {
  const { facility, context, lanes, los } = opts;

  if (facility === "freeway") {
    const ctx = context as FdotFreewayContext;
    const candidates = FDOT_FREEWAY_GSVT.filter((r) => r.context === ctx);
    const row = pickByLanes(candidates, lanes);
    if (!row) {
      return { label: `Freeway / ${ctx} / ${lanes}-lane`, serviceVolumeVph: null, undefinedByDesign: false, note: "No published GSVT row for this freeway context/lane combination; confirm against Q/LOS v6.0 App. B." };
    }
    return { label: row.label, serviceVolumeVph: row[los], undefinedByDesign: false };
  }

  const ctx = context as FdotContextClass;
  const candidates = FDOT_ARTERIAL_GSVT.filter((r) => r.context === ctx);
  const row = pickByLanes(candidates, lanes);
  if (!row) {
    return { label: `Arterial / ${ctx} / ${lanes}-lane`, serviceVolumeVph: null, undefinedByDesign: false, note: `No published GSVT row for context ${ctx} at ${lanes} lanes; confirm against Q/LOS v6.0 App. B.` };
  }
  const sv = row[los];
  if (sv == null) {
    const c6NoLosC = ctx === "C6" && los === "C";
    const arterialLosB = los === "B";
    return {
      label: row.label,
      serviceVolumeVph: null,
      undefinedByDesign: c6NoLosC || arterialLosB,
      note: c6NoLosC
        ? "LOS C is undefined for C6 in Q/LOS v6.0 — C6 facilities are neither planned nor designed to achieve auto LOS C."
        : arterialLosB
        ? "LOS B is not published for signalized arterials in Q/LOS v6.0 — published service volumes for arterials start at LOS C (the design target) and run to LOS E (C5/C6 only), with F at signal capacity."
        : `LOS ${los} is not published for ${row.label} (F at signal capacity past LOS D).`,
    };
  }
  return { label: row.label, serviceVolumeVph: sv, undefinedByDesign: false };
}

/**
 * AADT-equivalent of a GSVT service volume: AADT = peak-hour two-way
 * volume / K. Uses the representative K midpoint for the facility/context.
 * Returns null when the service volume is undefined.
 */
export function floridaGsvtAadtEquivalent(opts: {
  facility: FdotFacility;
  context: FdotFreewayContext | FdotContextClass;
  lanes: number;
  los: FdotLos;
}): number | null {
  // Prefer the published freeway AADT equivalent where the spec lists one.
  if (opts.facility === "freeway") {
    const ctx = opts.context as FdotFreewayContext;
    const row = pickByLanes(FDOT_FREEWAY_GSVT.filter((r) => r.context === ctx), opts.lanes);
    if (row && opts.los === "D" && row.aadtD != null) return row.aadtD;
  }
  const sel = floridaGsvtServiceVolume(opts);
  if (sel.serviceVolumeVph == null) return null;
  const k = floridaRepresentativeK(opts.facility, opts.context);
  return Math.round(sel.serviceVolumeVph / k);
}

/** Pick the row whose lane count is the smallest ≥ requested; else the largest available. */
function pickByLanes<T extends { lanes: number }>(rows: T[], lanes: number): T | undefined {
  if (rows.length === 0) return undefined;
  const sorted = [...rows].sort((a, b) => a.lanes - b.lanes);
  return sorted.find((r) => r.lanes >= lanes) ?? sorted[sorted.length - 1];
}

/** Narrow an arbitrary string to a context class, or null if unrecognized. */
export function asFdotContextClass(v: unknown): FdotContextClass | null {
  if (typeof v !== "string") return null;
  const up = v.trim().toUpperCase();
  const valid: FdotContextClass[] = ["C1", "C2", "C2T", "C3R", "C3C", "C4", "C5", "C6"];
  return valid.includes(up as FdotContextClass) ? (up as FdotContextClass) : null;
}
