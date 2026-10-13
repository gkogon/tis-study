/**
 * Pure data helpers for the private Pittsburgh sample-study page
 * (pages/pittsburgh-study-private.tsx). No React, no DOM beyond the
 * noindex helper's injected document, no path aliases — so
 * scripts/check-pittsburgh-study-private.mjs runs them under node against
 * the same static payload the page fetches.
 *
 * Every number the page prints comes from the saved engine report; the
 * helpers only select, count and format. Scenario naming follows the PDF's
 * §8.1 three-scenario table: Existing = the row's current-year values
 * (`currentLos` / `currentDelaySec`), No-Build = the opening-year
 * background-grown values (`existingLos` / `existingDelaySec`), Build =
 * No-Build plus project trips (`futureLos` / `futureDelaySec`).
 */
import type {
  TisReport,
  TisAffectedIntersection,
  TisPeriodReport,
  TisAnalysisPeriod,
} from "@workspace/tis-api-client-react";

/** The static payload under public/ (fetched at runtime, never bundled). */
export const SAMPLE_JSON_PATH = "samples/pittsburgh-mcknight-2026-10-05.json";
/** The state the Pittsburgh MSA region sits in (the PDF's "State" row). */
export const STATE_NAME = "Pennsylvania";
/** The note the page carries wherever it states a result. */
export const SCREENING_NOTE = "Screening estimate — not for design submittal without verification by a licensed PE.";

/** The saved payload: the request echo plus the engine's full report. */
export type PittsburghSamplePayload = {
  projectName: string;
  regionName: string;
  latitude: number;
  longitude: number;
  landUseCode: string;
  landUseName: string;
  landUseUnitShort: string;
  size: number;
  openingYear: number;
  studyRadiusMi: number;
  report: TisReport;
};

// ---------------------------------------------------------------------------
// noindex while mounted
// ---------------------------------------------------------------------------

export const ROBOTS_NOINDEX = "noindex, nofollow";

type HeadDoc = {
  head: { querySelector(sel: string): unknown; appendChild(el: never): unknown };
  createElement(tag: string): unknown;
};
type MetaLike = {
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  remove(): void;
};

/** Put `<meta name="robots" content="noindex, nofollow">` in the head and
 *  return the cleanup. An existing robots meta is overridden in place and
 *  restored on cleanup; one this call added is removed. */
export function installRobotsNoIndex(doc: HeadDoc): () => void {
  const existing = doc.head.querySelector('meta[name="robots"]') as MetaLike | null;
  if (existing) {
    const prev = existing.getAttribute("content");
    existing.setAttribute("content", ROBOTS_NOINDEX);
    return () => {
      if (prev === null) existing.removeAttribute("content");
      else existing.setAttribute("content", prev);
    };
  }
  const el = doc.createElement("meta") as MetaLike;
  el.setAttribute("name", "robots");
  el.setAttribute("content", ROBOTS_NOINDEX);
  doc.head.appendChild(el as never);
  return () => el.remove();
}

// ---------------------------------------------------------------------------
// payload validation — every field the page reads
// ---------------------------------------------------------------------------

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** Paths of the fields the page reads that are missing or the wrong type.
 *  Empty ⇒ the page can render every section. */
export function payloadProblems(x: unknown): string[] {
  const out: string[] = [];
  if (!isObj(x)) return ["payload"];
  const need = (cond: boolean, path: string) => { if (!cond) out.push(path); };
  need(isStr(x.projectName), "projectName");
  need(isStr(x.regionName), "regionName");
  need(isNum(x.latitude), "latitude");
  need(isNum(x.longitude), "longitude");
  need(isStr(x.landUseCode), "landUseCode");
  need(isStr(x.landUseName), "landUseName");
  need(isNum(x.size), "size");
  need(isNum(x.openingYear), "openingYear");
  need(isNum(x.studyRadiusMi), "studyRadiusMi");
  const r = x.report;
  if (!isObj(r)) { out.push("report"); return out; }
  need(isStr(r.generatedAt), "report.generatedAt");
  need(isObj(r.request) && isNum((r.request as Record<string, unknown>).latitude) && isNum((r.request as Record<string, unknown>).openingYear), "report.request");
  need(isNum(r.studyRadiusMi), "report.studyRadiusMi");
  const tg = r.tripGeneration;
  need(isObj(tg) && ["dailyTrips", "amPeakTrips", "pmPeakTrips", "pmIn", "pmOut", "dailyRate", "amRate", "pmRate", "size"].every((k) => isNum((tg as Record<string, unknown>)[k])), "report.tripGeneration");
  for (const k of ["intersectionsStudied", "intersectionsWithLosDrop", "intersectionsAtLosEf", "worstDelayDeltaSec", "growthAppliedPct", "growthYears", "passByPctApplied", "internalCapturePctApplied", "autoModeShareApplied", "designYear"]) {
    need(isNum(r[k]), `report.${k}`);
  }
  for (const k of ["growthSource", "autoModeShareSource"]) need(isStr(r[k]), `report.${k}`);
  need(isObj(r.tripDistribution) && isObj((r.tripDistribution as Record<string, unknown>).byDirection), "report.tripDistribution");
  const rows = r.affectedIntersections;
  if (!Array.isArray(rows) || rows.length === 0) out.push("report.affectedIntersections");
  else {
    const rowKeys = ["signalId", "name"] as const;
    const numKeys = ["latitude", "longitude", "distanceMi", "addedTripsPmPeak", "currentDelaySec", "existingDelaySec", "futureDelaySec", "queue95thFt"] as const;
    const losKeys = ["currentLos", "existingLos", "futureLos"] as const;
    rows.forEach((row: unknown, i: number) => {
      if (!isObj(row)) { out.push(`report.affectedIntersections[${i}]`); return; }
      for (const k of rowKeys) need(isStr(row[k]), `report.affectedIntersections[${i}].${k}`);
      for (const k of numKeys) need(isNum(row[k]), `report.affectedIntersections[${i}].${k}`);
      for (const k of losKeys) need(isStr(row[k]) && losRank(row[k] as string) >= 0, `report.affectedIntersections[${i}].${k}`);
      need(typeof row.mitigation === "string" && isStr(row.mitigationSeverity), `report.affectedIntersections[${i}].mitigation`);
      need(Array.isArray(row.approaches), `report.affectedIntersections[${i}].approaches`);
    });
  }
  const periods = r.periodReports;
  if (!Array.isArray(periods) || periods.length === 0) out.push("report.periodReports");
  else {
    const pk = ["rawTrips", "passByCredit", "internalCaptureCredit", "externalTrips", "inTrips", "outTrips"];
    periods.forEach((p: unknown, i: number) => {
      const t = isObj(p) ? p.tripGeneration : null;
      need(isObj(p) && isStr(p.period) && isObj(t) && pk.every((k) => isNum((t as Record<string, unknown>)[k])), `report.periodReports[${i}]`);
    });
    need(periods.some((p: unknown) => isObj(p) && p.period === "pm_peak"), "report.periodReports[pm_peak]");
  }
  return out;
}

// ---------------------------------------------------------------------------
// LOS by scenario
// ---------------------------------------------------------------------------

export const LOS_GRADES = ["A", "B", "C", "D", "E", "F"] as const;
export type LosGrade = (typeof LOS_GRADES)[number];
export type LosScenario = "existing" | "noBuild" | "build";
export const LOS_SCENARIOS: readonly LosScenario[] = ["existing", "noBuild", "build"];

/** A–F → 0–5; anything else → −1. */
export function losRank(los: string): number {
  return (LOS_GRADES as readonly string[]).indexOf(los);
}

/** The row's LOS in one of the PDF's three scenarios. */
export function rowLos(row: TisAffectedIntersection, sc: LosScenario): string {
  if (sc === "existing") return row.currentLos ?? row.existingLos;
  if (sc === "noBuild") return row.existingLos;
  return row.futureLos;
}

/** The row's control delay (s/veh) in one of the three scenarios. */
export function rowDelay(row: TisAffectedIntersection, sc: LosScenario): number {
  if (sc === "existing") return row.currentDelaySec ?? row.existingDelaySec;
  if (sc === "noBuild") return row.existingDelaySec;
  return row.futureDelaySec;
}

/** How many rows sit at each grade in a scenario. */
export function losDistribution(rows: readonly TisAffectedIntersection[], sc: LosScenario): Record<LosGrade, number> {
  const out = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 } as Record<LosGrade, number>;
  for (const r of rows) {
    const g = rowLos(r, sc);
    if (losRank(g) >= 0) out[g as LosGrade] += 1;
  }
  return out;
}

/** Rows at LOS E or F in a scenario. */
export function countAtLosEf(rows: readonly TisAffectedIntersection[], sc: LosScenario): number {
  return rows.filter((r) => losRank(rowLos(r, sc)) >= 4).length;
}

/** Rows whose opening-year Build grade is worse than No-Build. */
export function countLosDrops(rows: readonly TisAffectedIntersection[]): number {
  return rows.filter((r) => losRank(r.futureLos) > losRank(r.existingLos)).length;
}

/** The project's delay change at a row: Build − No-Build, opening year. */
export function delayDelta(row: TisAffectedIntersection): number {
  return row.futureDelaySec - row.existingDelaySec;
}

/** The current-conditions year the growth runs from. */
export function existingYear(report: TisReport): number {
  return report.request.openingYear - report.growthYears;
}

/** Compound background-growth multiplier applied to existing volumes. */
export function growthMultiplier(report: TisReport): number {
  return Math.pow(1 + report.growthAppliedPct / 100, report.growthYears);
}

export function topByDelayDelta(rows: readonly TisAffectedIntersection[], n: number): TisAffectedIntersection[] {
  return [...rows].sort((a, b) => delayDelta(b) - delayDelta(a) || a.name.localeCompare(b.name)).slice(0, n);
}

export function topByQueue(rows: readonly TisAffectedIntersection[], n: number): TisAffectedIntersection[] {
  return [...rows].sort((a, b) => b.queue95thFt - a.queue95thFt || a.name.localeCompare(b.name)).slice(0, n);
}

/** The approach whose 95th-percentile queue is the row's (the critical
 *  approach the PDF's Q95 column reports); null when no approach carries one. */
export function criticalApproach(row: TisAffectedIntersection): string | null {
  let best: { dir: string; q: number } | null = null;
  for (const a of row.approaches ?? []) {
    const q = typeof a.queue95thFt === "number" ? a.queue95thFt : -1;
    if (q > 0 && (!best || q > best.q)) best = { dir: a.direction, q };
  }
  return best ? best.dir : null;
}

/** Feet of queue → vehicles at the engine's 25 ft per queued vehicle. */
export const QUEUE_FT_PER_VEHICLE = 25;
export function queueVehicles(ft: number): number {
  return Math.round(ft / QUEUE_FT_PER_VEHICLE);
}

// ---------------------------------------------------------------------------
// headline + trip generation
// ---------------------------------------------------------------------------

export type HeadlineStats = {
  dailyTrips: number;
  pmGross: number;
  pmNetExternal: number;
  pmIn: number;
  pmOut: number;
  intersections: number;
  losDrops: number;
  atLosEf: number;
  worstDelta: number;
  worstRow: TisAffectedIntersection | null;
};

/** The executive-summary tiles: the report's own counters (what the PDF's
 *  §1.0 strip prints), plus the PM peak's net external trips and the row
 *  that carries the worst opening-year delay change. */
export function headlineStats(p: PittsburghSamplePayload): HeadlineStats {
  const r = p.report;
  const pm = r.periodReports.find((x) => x.period === "pm_peak");
  const worstRow = topByDelayDelta(r.affectedIntersections, 1)[0] ?? null;
  return {
    dailyTrips: r.tripGeneration.dailyTrips,
    pmGross: r.tripGeneration.pmPeakTrips,
    pmNetExternal: pm ? pm.tripGeneration.externalTrips : 0,
    pmIn: pm ? pm.tripGeneration.inTrips : 0,
    pmOut: pm ? pm.tripGeneration.outTrips : 0,
    intersections: r.intersectionsStudied,
    losDrops: r.intersectionsWithLosDrop,
    atLosEf: r.intersectionsAtLosEf,
    worstDelta: r.worstDelayDeltaSec,
    worstRow,
  };
}

export const PERIOD_LABEL: Record<TisAnalysisPeriod, string> = {
  am_peak: "Weekday AM peak hour",
  pm_peak: "Weekday PM peak hour",
  saturday_midday: "Saturday midday peak hour",
  daily: "Weekday daily total",
};
export const PERIOD_TAB: Record<TisAnalysisPeriod, string> = {
  am_peak: "AM peak",
  pm_peak: "PM peak",
  saturday_midday: "Saturday midday",
  daily: "Daily",
};

/** LOS, delay and queues are graded for the weekday PM peak hour only
 *  (PDF §3.3); the other periods carry trip generation. */
export function isGradedPeriod(p: TisAnalysisPeriod): boolean {
  return p === "pm_peak";
}

export type Waterfall = {
  period: TisAnalysisPeriod;
  gross: number;
  passBy: number;
  passByPct: number;
  internalCapture: number;
  /** Trips removed by the auto-mode share (walk / bike / transit), the
   *  remainder of gross − credits − external. */
  nonAuto: number;
  external: number;
  inTrips: number;
  outTrips: number;
};

/** One period's gross → net-external walk, as the PDF's §5.1 row. */
export function periodWaterfall(p: TisPeriodReport): Waterfall {
  const t = p.tripGeneration;
  const gross = Math.round(t.rawTrips);
  const passBy = Math.round(t.passByCredit);
  const internalCapture = Math.round(t.internalCaptureCredit);
  const external = Math.round(t.externalTrips);
  return {
    period: p.period,
    gross,
    passBy,
    passByPct: gross > 0 ? Math.round((passBy / gross) * 1000) / 10 : 0,
    internalCapture,
    nonAuto: gross - passBy - internalCapture - external,
    external,
    inTrips: Math.round(t.inTrips),
    outTrips: Math.round(t.outTrips),
  };
}

// ---------------------------------------------------------------------------
// mitigation
// ---------------------------------------------------------------------------

export type Severity = "major" | "moderate" | "minor" | "none";
export const SEVERITIES: readonly Severity[] = ["major", "moderate", "minor", "none"];

export function severityCounts(rows: readonly TisAffectedIntersection[]): Record<Severity, number> {
  const out: Record<Severity, number> = { major: 0, moderate: 0, minor: 0, none: 0 };
  for (const r of rows) {
    const s = (SEVERITIES as readonly string[]).includes(r.mitigationSeverity) ? (r.mitigationSeverity as Severity) : "none";
    out[s] += 1;
  }
  return out;
}

/** The engine writes `<verdict> Governing horizon: <label> (<deltas>).`;
 *  split it so the page can state the verdict once per severity and the
 *  horizon per row. */
export function splitMitigation(text: string): { verdict: string; horizon: string | null } {
  const i = text.indexOf(" Governing horizon: ");
  if (i < 0) return { verdict: text.trim(), horizon: null };
  return {
    verdict: text.slice(0, i).trim(),
    horizon: text.slice(i + " Governing horizon: ".length).trim().replace(/\.$/, ""),
  };
}

// ---------------------------------------------------------------------------
// the scroll-driven opener — its featured signal and every number it narrates
// ---------------------------------------------------------------------------

/** The signal the opener's second act and the "Watch it live" section
 *  feature: McKnight Road & McKnight Circle — on McKnight Road, Webster
 *  timing computed from its own volumes, two loaded approaches, a clean
 *  C → C → C with the project's trips visibly arriving on one of them. */
export const FEATURED_SIGNAL_ID = "pittsburgh-2402";

/** Rows the page never features (presenting them invites the wrong
 *  conversation): Perrysville Avenue / West View Avenue junctions, and rows
 *  whose name is only "Near …" (no cross street on record). */
const NOT_FEATURED = /perrysville|west view|^\s*near\b/i;

/** A row the opener may feature: on McKnight Road, a named cross street,
 *  not a Perrysville / West View junction, timing computed (not the flat
 *  screening default), and at least one loaded approach. */
export function isPresentableSignal(row: TisAffectedIntersection): boolean {
  return /\bMcKnight Road\b/.test(row.name)
    && /&/.test(row.name)
    && !NOT_FEATURED.test(row.name)
    && row.signalTiming?.basis === "webster"
    && (row.approaches ?? []).some((a) => a.existingVolumeVph > 0);
}

/** The featured row: FEATURED_SIGNAL_ID when it is presentable, else the
 *  presentable McKnight Road row carrying the most project trips. */
export function featuredSignal(report: TisReport): TisAffectedIntersection | null {
  const rows = report.affectedIntersections;
  const pinned = rows.find((r) => r.signalId === FEATURED_SIGNAL_ID);
  if (pinned && isPresentableSignal(pinned)) return pinned;
  return [...rows].filter(isPresentableSignal).sort((a, b) => b.addedTripsPmPeak - a.addedTripsPmPeak || a.name.localeCompare(b.name))[0] ?? null;
}

/** "200,000 sq ft GLA" for a ksf land use, else "<size> <unit>". */
export function siteSizeLabel(report: TisReport): string {
  const tg = report.tripGeneration;
  if (tg.unitShort === "ksf") return `${fmtInt(tg.size * 1000)} sq ft${/GLA/.test(tg.unit) ? " GLA" : ""}`;
  return `${fmtInt(tg.size)} ${tg.unit}`;
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"] as const;
/** Eight-wind compass word for the bearing from a to b. */
export function compassFrom(aLat: number, aLon: number, bLat: number, bLon: number): (typeof COMPASS)[number] {
  const φ1 = (aLat * Math.PI) / 180, φ2 = (bLat * Math.PI) / 180, dλ = ((bLon - aLon) * Math.PI) / 180;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8]!;
}

const LEG_SOURCE_SHORT: Record<string, string> = {
  csv: "link count",
  signal_aadt: "AADT design hour",
  signal_baseline: "baseline volume",
  class_default: "road-class default",
};

export type OpenerApproach = {
  dir: string;
  /** Existing (current year), No-Build (opening year) and Build volumes, vph. */
  existing: number;
  noBuild: number;
  build: number;
  /** Project trips added on this approach, PM peak. */
  added: number;
  /** Where the leg's background volume came from (the row's legVolumes). */
  source: string | null;
};

export type OpenerStory = {
  site: {
    projectName: string;
    sizeLabel: string;
    landUseCode: string;
    landUseName: string;
    dailyTrips: number;
    pmGross: number;
    pmPassBy: number;
    passByPct: number;
    pmInternal: number;
    pmNonAuto: number;
    autoSharePct: number;
    pmNet: number;
    pmIn: number;
    pmOut: number;
    pmRate: number;
    rateUnit: string;
  };
  signal: {
    id: string;
    name: string;
    distanceMi: number;
    compass: string;
    latitude: number;
    longitude: number;
    /** Loaded approaches only (an approach with no volume in any scenario is a one-way exit leg). */
    approaches: OpenerApproach[];
    cycleSec: number;
    gNs: number;
    gEw: number;
    delay: Record<LosScenario, number>;
    los: Record<LosScenario, string>;
    addedTrips: number;
  } | null;
  area: {
    radiusMi: number;
    signals: number;
    losDrops: number;
    ef: Record<LosScenario, number>;
    existingYear: number;
    openingYear: number;
    netPmTrips: number;
  };
};

/** Every number the opener narrates, read from the saved report — nothing
 *  typed. The opener formats these and nothing else. */
export function openerStory(p: PittsburghSamplePayload): OpenerStory {
  const r = p.report;
  const h = headlineStats(p);
  const pmPeriod = r.periodReports.find((x) => x.period === "pm_peak");
  const w = pmPeriod ? periodWaterfall(pmPeriod) : null;
  const tg = r.tripGeneration;
  const row = featuredSignal(r);
  let signal: OpenerStory["signal"] = null;
  if (row && row.signalTiming) {
    const legs = row.legVolumes ?? [];
    const approaches: OpenerApproach[] = (row.approaches ?? [])
      .filter((a) => (a.currentVolumeVph ?? 0) > 0 || a.existingVolumeVph > 0 || a.futureVolumeVph > 0)
      .map((a) => {
        const leg = legs.find((l) => l.direction === a.direction);
        return {
          dir: a.direction,
          existing: a.currentVolumeVph ?? a.existingVolumeVph,
          noBuild: a.existingVolumeVph,
          build: a.futureVolumeVph,
          added: a.addedTripsPeak,
          source: leg ? (LEG_SOURCE_SHORT[leg.source] ?? leg.source) : null,
        };
      });
    const t = row.signalTiming;
    signal = {
      id: row.signalId,
      name: row.name,
      distanceMi: row.distanceMi,
      compass: compassFrom(r.request.latitude, r.request.longitude, row.latitude, row.longitude),
      latitude: row.latitude,
      longitude: row.longitude,
      approaches,
      cycleSec: t.cycleLenSec,
      gNs: t.gOverCns,
      gEw: t.gOverCew,
      delay: { existing: rowDelay(row, "existing"), noBuild: rowDelay(row, "noBuild"), build: rowDelay(row, "build") },
      los: { existing: rowLos(row, "existing"), noBuild: rowLos(row, "noBuild"), build: rowLos(row, "build") },
      addedTrips: row.addedTripsPmPeak,
    };
  }
  const rows = r.affectedIntersections;
  return {
    site: {
      projectName: p.projectName,
      sizeLabel: siteSizeLabel(r),
      landUseCode: tg.landUseCode,
      landUseName: tg.landUseName,
      dailyTrips: h.dailyTrips,
      pmGross: h.pmGross,
      pmPassBy: w ? w.passBy : 0,
      passByPct: w ? w.passByPct : 0,
      pmInternal: w ? w.internalCapture : 0,
      pmNonAuto: w ? w.nonAuto : 0,
      autoSharePct: Math.round((r.autoModeShareApplied ?? 1) * 1000) / 10,
      pmNet: h.pmNetExternal,
      pmIn: h.pmIn,
      pmOut: h.pmOut,
      pmRate: tg.pmRate ?? 0,
      rateUnit: tg.unit,
    },
    signal,
    area: {
      radiusMi: r.studyRadiusMi,
      signals: r.intersectionsStudied,
      losDrops: r.intersectionsWithLosDrop,
      ef: { existing: countAtLosEf(rows, "existing"), noBuild: countAtLosEf(rows, "noBuild"), build: countAtLosEf(rows, "build") },
      existingYear: existingYear(r),
      openingYear: r.request.openingYear,
      netPmTrips: h.pmNetExternal,
    },
  };
}

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** "+58.9 s" / "−1.3 s" (true minus sign). */
export function fmtSignedSec(n: number): string {
  // Half away from zero, so −1.25 and +1.25 print the same magnitude.
  const mag = Math.round(Math.abs(n) * 10) / 10;
  return `${n < 0 && mag > 0 ? "−" : "+"}${mag.toFixed(1)} s`;
}

export function fmtPct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

// ---------------------------------------------------------------------------
// method and limits — the report's own fields, in the PDF's terms
// ---------------------------------------------------------------------------

export type MethodFact = { label: string; text: string };

export function methodFacts(p: PittsburghSamplePayload): MethodFact[] {
  const r = p.report;
  const by = (k: TisAnalysisPeriod) => r.periodReports.find((x) => x.period === k);
  const pbPct = (k: TisAnalysisPeriod) => { const x = by(k); return x ? periodWaterfall(x).passByPct : null; };
  const offPeak = (["am_peak", "saturday_midday", "daily"] as const)
    .map((k) => ({ k, pct: pbPct(k) }))
    .filter((x): x is { k: "am_peak" | "saturday_midday" | "daily"; pct: number } => x.pct !== null);
  const sameOffPeak = offPeak.length > 0 && offPeak.every((x) => x.pct === offPeak[0]!.pct);
  const pmPb = pbPct("pm_peak");
  const ofPm = sameOffPeak && pmPb ? ` (${fmtPct((offPeak[0]!.pct / pmPb) * 100)} of the PM credit)` : "";
  const offPeakText = sameOffPeak
    ? `${fmtPct(offPeak[0]!.pct, 1)} at the AM peak, Saturday midday and daily${ofPm}`
    : offPeak.map((x) => `${fmtPct(x.pct, 1)} at the ${PERIOD_TAB[x.k]}`).join(", ");
  const auto = (r.autoModeShareApplied ?? 1) * 100;
  const merged = r.intersectionsMergedAsDuplicates ?? 0;
  const inArea = r.intersectionsInStudyArea ?? r.intersectionsStudied;
  const radius = r.studyRadiusMi;
  return [
    {
      label: "Region",
      text: `${p.regionName}, ${STATE_NAME}. The study follows the report structure of PennDOT Publication 282 but is not a submittal prepared in conformance with it: no turning-movement counts, field review or calibrated capacity analysis were performed.`,
    },
    {
      label: "Study area",
      text: `All ${r.intersectionsStudied} signalized intersections within ${radius} miles of the site${merged > 0 ? ` (${inArea} signal records, ${merged} merged as duplicates of the same junction)` : ""}. Unsignalized intersections, site driveways and roadway segments are not screened.`,
    },
    {
      label: "Background growth",
      text: `${r.growthAppliedPct.toFixed(2)}%/yr compounded over ${r.growthYears} years (×${growthMultiplier(r).toFixed(3)}), ${existingYear(r)} to ${r.request.openingYear}. ${r.growthSource ?? ""}`.trim(),
    },
    {
      label: "Trip credits",
      text: `Pass-by ${fmtPct(r.passByPctApplied)} at the PM peak; ${offPeakText}. Internal capture ${fmtPct(r.internalCapturePctApplied)}.`,
    },
    {
      label: "Mode share",
      text: `Auto mode share ${fmtPct(auto, 1)} applied before assignment; the other ${fmtPct(100 - auto, 1)} of trips arrive by transit, walking or cycling and do not load the off-site network. Source: ${r.autoModeShareSource ?? "—"}.`,
    },
    {
      label: "Level of service",
      text: "Graded for the weekday PM peak hour only. AM peak and Saturday-midday trip generation is shown, but those periods are not graded in this screening.",
    },
    {
      label: "Capacity method",
      text: "Signalized control delay from the openly published Webster/Akçelik model (uniform plus incremental delay), graded on the conventional bands A ≤ 10 s … F > 80 s. HCS or Synchro supersede it at submittal.",
    },
  ];
}
