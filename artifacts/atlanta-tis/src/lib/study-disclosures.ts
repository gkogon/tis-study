/**
 * What the report appendices may say about THIS study: its region, the growth
 * rate and credits the engine actually applied, and whether counts were
 * supplied. Read only from the report payload, never assumed.
 *
 * The region comes from `report.regionCode` looked up in the METROS catalog
 * (which carries every region code in tis-api-server's regions.ts, with its
 * state). A payload without a regionCode, or with a code the catalog does not
 * know, gets neutral wording ("the study region") and no state-specific text;
 * likewise an absent growthSource or autoModeShareApplied is reported as not
 * recorded rather than guessed. The wording follows the states PDF
 * (pdf-export-states.ts §3.5–§3.7) so the website and the PDF agree.
 */
import type { TisReport } from "@workspace/tis-api-client-react";
import { METROS, STATE_NAMES } from "../data/metro-coverage";

export type StudyRegion = {
  code: string | null;
  /** The catalog's long name ("Pittsburgh MSA"), or null when unknown. */
  name: string | null;
  /** The name as it reads after "within" ("the Pittsburgh MSA", "Georgia"). */
  phrase: string;
  stateCode: string | null;
  stateName: string | null;
  isGeorgia: boolean;
  isAtlanta: boolean;
};

export function studyRegion(regionCode: string | null | undefined): StudyRegion {
  const metro = regionCode ? METROS.find((m) => m.code === regionCode) : undefined;
  if (!metro) {
    return { code: regionCode ?? null, name: null, phrase: "the study region", stateCode: null, stateName: null, isGeorgia: false, isAtlanta: false };
  }
  return {
    code: metro.code,
    name: metro.longName,
    phrase: regionPhrase(metro.longName),
    stateCode: metro.state,
    stateName: STATE_NAMES[metro.state] ?? null,
    isGeorgia: metro.state === "GA",
    isAtlanta: metro.code === "atlanta_metro",
  };
}

/** "Atlanta MSA" → "the Atlanta MSA"; "Georgia (statewide)" → "Georgia"; "Greater London" as is. */
function regionPhrase(name: string): string {
  const statewide = /^(.*) \(statewide\)$/.exec(name);
  if (statewide) return statewide[1]!;
  return /\b(MSA|CSA|CMA|CMM|ZM)$/.test(name) ? `the ${name}` : name;
}

/** A percentage as the report prints it: whole numbers bare, otherwise one decimal. */
export function pct(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

const finite = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);

export type TripCredits = {
  /** PM-peak pass-by % applied; null when the payload does not record it. */
  passByPct: number | null;
  /** PM-peak internal-capture % applied; null when not recorded. */
  internalCapturePct: number | null;
  /** Non-auto share removed before assignment, whole %; null when not recorded. */
  nonAutoPct: number | null;
  modeShareSource: string | null;
};

export function tripCredits(report: TisReport): TripCredits {
  const share = finite(report.autoModeShareApplied);
  return {
    passByPct: finite(report.passByPctApplied),
    internalCapturePct: finite(report.internalCapturePctApplied),
    nonAutoPct: share == null ? null : Math.max(0, Math.round((1 - share) * 100)),
    modeShareSource: report.autoModeShareSource?.trim() || null,
  };
}

const joinList = (xs: string[], word: "and" | "or") =>
  xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${word} ${xs[xs.length - 1]}`;
const orList = (xs: string[]) => joinList(xs, "or");
/** "pass-by", "pass-by and internal-capture", "pass-by, internal-capture and mode-share". */
export const andList = (xs: string[]) => joinList(xs, "and");

export type CreditsDisclosure = {
  /** Every credit is recorded and zero: the "no credits" wording is true. */
  allZero: boolean;
  /** At least one credit was applied. */
  anyApplied: boolean;
  /** The adjustments applied, in print order: "pass-by", "internal-capture", "mode-share". */
  appliedKinds: string[];
  /** What was applied, what was not, and what the payload does not record. Empty when allZero. */
  summary: string;
};

/** The credits sentence both appendices print; each component adds its own closing advice. */
export function creditsDisclosure(c: TripCredits): CreditsDisclosure {
  const { passByPct: pb, internalCapturePct: ic, nonAutoPct: na } = c;
  const allZero = pb === 0 && ic === 0 && na === 0;
  const pm = [pb != null && pb > 0 ? `${pct(pb)}% pass-by` : null, ic != null && ic > 0 ? `${pct(ic)}% internal capture` : null].filter(
    (x): x is string => x != null,
  );
  const applied: string[] = [];
  if (pm.length) applied.push(`${pm.join(" and ")} at the PM peak`);
  if (na != null && na > 0) {
    applied.push(
      `a ${na}% non-auto mode share removed before assignment (the metro auto-mode share${c.modeShareSource ? ` per ${c.modeShareSource}` : ""}, adjusted for site density)`,
    );
  }
  const none = [pb === 0 ? "pass-by" : null, ic === 0 ? "internal-capture" : null, na === 0 ? "mode-shift" : null].filter((x): x is string => x != null);
  const unrecorded = [pb == null ? "pass-by credit" : null, ic == null ? "internal-capture credit" : null, na == null ? "mode-share adjustment" : null].filter(
    (x): x is string => x != null,
  );
  const parts: string[] = [];
  if (applied.length) parts.push(`Credits applied to project trips: ${applied.join(", and ")}.`);
  if (none.length) parts.push(`No ${orList(none)} credit has been applied.`);
  if (unrecorded.length) parts.push(`This study's output does not record the ${orList(unrecorded)} applied.`);
  const appliedKinds = [
    pb != null && pb > 0 ? "pass-by" : null,
    ic != null && ic > 0 ? "internal-capture" : null,
    na != null && na > 0 ? "mode-share" : null,
  ].filter((x): x is string => x != null);
  return { allZero, anyApplied: applied.length > 0, appliedKinds, summary: allZero ? "" : parts.join(" ") };
}

export type GrowthDisclosure = {
  /** "2.00", or null when the payload carries no finite rate. */
  ratePct: string | null;
  years: number | null;
  /** The engine's provenance text, without a trailing period; null when absent. */
  source: string | null;
};

export function growthDisclosure(report: TisReport): GrowthDisclosure {
  const rate = finite(report.growthAppliedPct);
  const years = finite(report.growthYears);
  return {
    ratePct: rate == null ? null : rate.toFixed(2),
    years,
    source: report.growthSource?.trim().replace(/\.$/, "") || null,
  };
}

/** Study signals whose volumes came from counts supplied with the study, not the estimate. */
export function suppliedCounts(report: TisReport): { signals: number; tmc: number; linkCounts: number } {
  const rows = Array.isArray(report.affectedIntersections) ? report.affectedIntersections : [];
  let tmc = 0;
  let linkCounts = 0;
  for (const r of rows) {
    if (r.volumeSource === "utdf_tmc" || r.volumeSource === "synchro_pdf_tmc") tmc++;
    else if (r.volumeSource === "link_csv") linkCounts++;
  }
  return { signals: rows.length, tmc, linkCounts };
}
