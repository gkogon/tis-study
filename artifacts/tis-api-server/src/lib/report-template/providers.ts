/**
 * Provider library for the template engine.
 *
 * Each provider is a typed computation over the study `RenderContext` that
 * returns block data (a table, metric strip, key-value list, or chart spec).
 * Templates reference these by id, so the SAME computations compose into any
 * firm's format. Built per-locale so the office diurnal profile and its
 * provenance string are jurisdiction-correct (see office-diurnal.ts).
 */
import { ukCapacityForIntersection } from "../uk-capacity";
import { profileForLandUse, distributeDaily, type ProfileLocale } from "../office-diurnal";
import { CHART_COLORS } from "../pdf-charts";
import type { ProviderRegistry, RenderContext, TableData } from "./engine";
import { buildAccuracyReport } from "./accuracy";
import { applicableRegulations, regulationsAsOf, registryStatus } from "./regulations";
import { detectStudyType } from "./study-type";

const num = (n: unknown, d = 0): string => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const x = Number(n);
  return d > 0 ? x.toFixed(d) : Math.round(x).toLocaleString();
};

/** Stringify a value, returning `dflt` for null/undefined or a non-finite number. */
const s = (v: unknown, dflt = "—"): string => {
  if (v == null) return dflt;
  if (typeof v === "number" && !Number.isFinite(v)) return dflt;
  return String(v);
};

/** A non-negative integer count, or `dflt` (counts can never be negative/NaN). */
const cnt = (v: unknown, dflt: string): string => {
  const x = Number(v);
  return Number.isFinite(x) && x >= 0 ? String(Math.round(x)) : dflt;
};

const tg = (ctx: RenderContext) => ctx.report?.tripGeneration ?? {};
const req = (ctx: RenderContext) => ctx.report?.request ?? {};
const ints = (ctx: RenderContext): any[] => (Array.isArray(ctx.report?.affectedIntersections) ? ctx.report.affectedIntersections : []);
const periods = (ctx: RenderContext): any[] => (Array.isArray(ctx.report?.periodReports) ? ctx.report.periodReports : []);
const dailyTrips = (ctx: RenderContext) => Number(tg(ctx).dailyTrips ?? 0);

const HOURS = Array.from({ length: 24 }, (_, h) => String(h));

export function buildProviders(opts: { locale: ProfileLocale }): ProviderRegistry {
  const { locale } = opts;

  const diurnal = (ctx: RenderContext) => {
    const daily = dailyTrips(ctx);
    if (!(Number.isFinite(daily) && daily > 0)) return null;
    const sel = profileForLandUse(String(tg(ctx).landUseCode ?? ""), req(ctx).tripProfile, locale);
    if (!sel.matched) return null;
    return { sel, hourly: distributeDaily(daily, sel.profile) };
  };

  return {
    metrics: {
      headline: (ctx) => {
        const r = ctx.report ?? {};
        const n = ints(ctx).length;
        const wd = Number(r.worstDelayDeltaSec);
        return [
          { label: "Junctions", value: cnt(r.intersectionsStudied, cnt(n, "0")) },
          { label: "LOS drops", value: cnt(r.intersectionsWithLosDrop, "0") },
          { label: "At LOS E/F", value: cnt(r.intersectionsAtLosEf, "0") },
          { label: "Worst Δ delay", value: `${Number.isFinite(wd) && wd >= 0 ? wd.toFixed(1) : "0.0"}s` },
        ];
      },
      accuracyOverall: (ctx) => {
        const cfg = detectStudyType(ctx.report, ctx.project);
        const asOf = regulationsAsOf(applicableRegulations(ctx.region, cfg.kind));
        const rep = buildAccuracyReport(ctx.report, { asOf });
        return [
          { label: "Study confidence", value: rep.overall },
          { label: "Study type", value: cfg.kind },
          { label: "Standards as of", value: asOf || "—" },
        ];
      },
    },

    keyvalues: {
      schemeSummary: (ctx) => [
        ["Scheme", ctx.project?.projectName ?? "—"],
        ["Address", ctx.project?.address ?? "—"],
        ["Land use", `${s(tg(ctx).landUseCode)} — ${s(tg(ctx).landUseName, "")}`.trim()],
        ["Quantum", `${s(tg(ctx).size, "")} ${s(tg(ctx).unit, "")}`.trim() || "—"],
        ["Study radius", `${num(ctx.report?.studyRadiusMi ?? req(ctx).studyRadiusMi, 2)} mi`],
      ],
      demandAssumptions: (ctx) => {
        const share = Number(ctx.report?.autoModeShareApplied);
        const sharePct = Number.isFinite(share) && share > 0 ? `${(share * 100).toFixed(0)}%` : "—";
        return [
          ["Pass-by capture applied", `${s(ctx.report?.passByPctApplied, "0")}%`],
          ["Internalisation applied", `${s(ctx.report?.internalCapturePctApplied, "0")}%`],
          ["Background growth", `${s(ctx.report?.growthAppliedPct)}% / yr over ${s(ctx.report?.growthYears)} yr`],
          ["Auto-mode share", sharePct],
        ];
      },
      regulationStatus: () => {
        const s = registryStatus(new Date());
        return [
          ["Standards verified", s.reviewedOn],
          ["Next review due", s.reviewBy],
          ["Currency", s.overdue ? "Review overdue — verify editions" : "Current"],
        ];
      },
    },

    tables: {
      landUseSchedule: (ctx): TableData => ({
        headers: ["Land use", "Land use code", "Size", "Unit"],
        widths: [240, 80, 90, 90],
        align: ["left", "left", "right", "left"],
        rows: [[s(tg(ctx).landUseName), s(tg(ctx).landUseCode), num(tg(ctx).size), s(tg(ctx).unit)]],
      }),

      tripGenSummary: (ctx): TableData => {
        const t = tg(ctx);
        return {
          headers: ["Period", "Entering", "Exiting"],
          widths: [220, 110, 110],
          align: ["left", "right", "right"],
          rows: [
            ["Daily", num((Number(t.dailyTrips ?? 0)) / 2), num((Number(t.dailyTrips ?? 0)) / 2)],
            ["AM peak hour (08:00–09:00)", num(t.amPeakTrips), "—"],
            ["PM peak hour (17:00–18:00)", num(t.pmIn), num(t.pmOut)],
          ],
        };
      },

      periodTripGen: (ctx): TableData | null => {
        const ps = periods(ctx);
        if (!ps.length) return null;
        return {
          headers: ["Period", "Raw", "Pass-by", "Linked", "Net", "In", "Out"],
          widths: [110, 55, 60, 60, 60, 50, 50],
          align: ["left", "right", "right", "right", "right", "right", "right"],
          rows: ps.map((p) => {
            const t = p.tripGeneration ?? {};
            return [
              s(p.periodLabel, "") || s(p.period, "") || "—",
              num(t.rawTrips),
              num(t.passByCredit),
              num(t.internalCaptureCredit),
              num(t.externalTrips),
              num(t.inTrips),
              num(t.outTrips),
            ];
          }),
        };
      },

      ukCapacity: (ctx): TableData | null => {
        const list = ints(ctx);
        if (!list.length) return null;
        const pctOf = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "—");
        const rows: string[][] = [];
        for (const it of list.slice(0, 25)) {
          try {
            const nb = ukCapacityForIntersection(it, "noBuild");
            const bd = ukCapacityForIntersection(it, "build");
            const status = Number.isFinite(bd.dosPct) ? (bd.dosPct > 90 ? "Over practical" : "Within practical") : "—";
            rows.push([
              s(it.name ?? it.signalId),
              pctOf(nb.dosPct),
              pctOf(bd.dosPct),
              bd.prcPct == null || !Number.isFinite(bd.prcPct) ? "—" : `${bd.prcPct.toFixed(0)}%`,
              status,
            ]);
          } catch {
            rows.push([s(it.name ?? it.signalId), "—", "—", "—", "—"]);
          }
        }
        return {
          headers: ["Junction", "DoS (No-Build)", "DoS (Build)", "PRC (Build)", "Status"],
          widths: [180, 90, 90, 70, 82],
          align: ["left", "right", "right", "right", "left"],
          rows,
        };
      },

      tripDistribution: (ctx): TableData | null => {
        const list = ints(ctx);
        if (!list.length) return null;
        const fin = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
        const totalPm = list.reduce((sum, it) => sum + fin(it.addedTripsPmPeak), 0) || 1;
        return {
          headers: ["Junction", "Dist (mi)", "Added PM", "Share"],
          widths: [220, 80, 100, 90],
          align: ["left", "right", "right", "right"],
          rows: list.map((it) => {
            const pm = fin(it.addedTripsPmPeak);
            return [s(it.name ?? it.signalId), num(it.distanceMi, 2), num(pm), `${((pm / totalPm) * 100).toFixed(1)}%`];
          }),
        };
      },

      accuracy: (ctx): TableData => {
        const cfg = detectStudyType(ctx.report, ctx.project);
        const asOf = regulationsAsOf(applicableRegulations(ctx.region, cfg.kind));
        const rep = buildAccuracyReport(ctx.report, { asOf });
        return {
          headers: ["Component", "Confidence", "Basis", "For submittal"],
          widths: [120, 70, 168, 154],
          align: ["left", "left", "left", "left"],
          rows: rep.items.map((it) => [it.component, it.grade, it.basis, it.toSubmit ?? "—"]),
        };
      },

      regulations: (ctx): TableData | null => {
        const cfg = detectStudyType(ctx.report, ctx.project);
        const regs = applicableRegulations(ctx.region, cfg.kind);
        if (!regs.length) return null;
        return {
          headers: ["Code", "Standard", "Edition", "Effective"],
          widths: [85, 238, 112, 77],
          align: ["left", "left", "left", "left"],
          rows: regs.map((r) => [r.code, r.title, r.edition, r.effective]),
        };
      },
    },

    charts: {
      diurnalColumn: (ctx) => {
        const d = diurnal(ctx);
        if (!d) return null;
        return {
          type: "column" as const,
          spec: {
            title: `Figure: ${detectStudyType(ctx.report, ctx.project).flowChartTitle}`,
            categories: HOURS,
            stacked: true,
            series: [
              { name: "Outbound", color: CHART_COLORS.outbound, values: d.hourly.departuresSharePct },
              { name: "Inbound", color: CHART_COLORS.inbound, values: d.hourly.arrivalsSharePct },
            ],
            yLabel: "% of daily total",
            xLabel: "Hour of day",
            yTickFormat: (v: number) => `${v}%`,
            caption: d.sel.profile.source,
          },
        };
      },
      diurnalLine: (ctx) => {
        const d = diurnal(ctx);
        if (!d) return null;
        const cfg = detectStudyType(ctx.report, ctx.project);
        return {
          type: "line" as const,
          spec: {
            title: `Figure: ${cfg.accumulationTitle}`,
            categories: HOURS,
            values: d.hourly.accumulation,
            color: CHART_COLORS.outbound,
            yLabel: `${cfg.unit} on site (est.)`,
            xLabel: "Hour of day",
            caption: `Peak ~${num(d.hourly.peakAccumulation)} ${cfg.unit} at ${String(d.hourly.peakAccumulationHour).padStart(2, "0")}:00, from ${num(dailyTrips(ctx))} gross daily trips on the ${d.sel.family ?? "supplied"} within-day profile.`,
          },
        };
      },
    },

    flags: {
      hasIntersections: (ctx) => ints(ctx).length > 0,
      hasPeriods: (ctx) => periods(ctx).length > 0,
      drawDiurnal: (ctx) => diurnal(ctx) != null,
      noLosImpact: (ctx) => Number(ctx.report?.intersectionsWithLosDrop ?? 0) === 0 && Number(ctx.report?.intersectionsAtLosEf ?? 0) === 0,
      showCapacity: (ctx) => detectStudyType(ctx.report, ctx.project).showCapacity,
      isPedestrian: (ctx) => detectStudyType(ctx.report, ctx.project).kind === "pedestrian",
      isParking: (ctx) => detectStudyType(ctx.report, ctx.project).kind === "parking",
      isVehicular: (ctx) => detectStudyType(ctx.report, ctx.project).kind === "vehicular",
    },
  };
}
