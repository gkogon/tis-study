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

/** Truncate a long junction/road name so it fits a chart x-axis tick. */
const shortName = (v: unknown): string => {
  const x = s(v, "—");
  return x.length > 16 ? `${x.slice(0, 15)}…` : x;
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
        headers: ["Land use", "ITE code", "Size", "Unit"],
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

      // Policy-compliance matrix — the scheme's screening stance against the
      // controlling NPPF / London Plan / MTS policies (Chapter 7).
      policyCompliance: (ctx): TableData => {
        const share = Number(ctx.report?.autoModeShareApplied);
        const carPct = Number.isFinite(share) && share > 0 ? `${Math.round(share * 100)}%` : "a car-light";
        return {
          headers: ["Policy", "Requirement", "Scheme response (screening)"],
          widths: [120, 186, 188],
          align: ["left", "left", "left"],
          rows: [
            ["NPPF 2024 ¶108–116", "Vision-led approach; safe and suitable access; development refused only on severe residual impact", "Central, accessible site; screening finds no severe residual highway impact (Chapter 6)."],
            ["London Plan T1", "80% sustainable mode share by 2041", `Applied private-vehicle share of ${carPct} is consistent with a car-light central scheme.`],
            ["London Plan T2", "Healthy Streets and active travel", "Pedestrian comfort and Active Travel Zone assessed in Chapters 4–5."],
            ["London Plan T4", "Transport assessment and impact mitigation", "This Transport Assessment; any mitigation delivered via S106 / S278."],
            ["London Plan T5", "Cycle parking to Table 10.2 standards", "Long-, short-stay and end-of-trip provision assessed in Chapter 3."],
            ["London Plan T6", "Car-parking restraint / car-free in the CAZ", "Car-free / car-capped consistent with the CAZ and site PTAL."],
            ["London Plan T7", "Freight, servicing and consolidation", "Servicing assessed via the CoL Ready Reckoner with off-site consolidation (Chapter 3)."],
            ["MTS 2018", "80% sustainable trips; Vision Zero", "Mode share, PCL and collision review support the MTS outcomes."],
          ],
        };
      },

      // PCL assessment framework — the four scenarios assessed at submittal (Chapter 4).
      pclScenarios: (): TableData => ({
        headers: ["Scenario", "Horizon", "Basis", "Status"],
        widths: [150, 70, 215, 105],
        align: ["left", "left", "left", "left"],
        rows: [
          ["Base", "2024", "Observed 15-minute peak pedestrian flows and footway widths", "Survey at submittal"],
          ["Sensitivity", "2024", "Base plus the committed development pipeline", "Survey at submittal"],
          ["Future Base", "2040", "TfL growth factors applied to the Base flows", "Modelled at submittal"],
          ["Future + Development", "2040", "Future Base plus the scheme's pedestrian generation", "Modelled at submittal"],
        ],
      }),

      // The 10 TfL Healthy Streets indicators and the screening basis (Chapter 5).
      healthyStreets: (): TableData => ({
        headers: ["Healthy Streets indicator", "Screening basis / status"],
        widths: [250, 290],
        align: ["left", "left"],
        rows: [
          ["Pedestrians from all walks of life", "Step-free, legible routes — confirmed against access drawings"],
          ["People choose to walk, cycle and use public transport", "High PTAL and ATZ provision support modal choice"],
          ["Clean air", "Car-light scheme; consolidated servicing reduces vehicle movements"],
          ["People feel safe", "Active frontages and lighting — design review at submittal"],
          ["Not too noisy", "Reduced vehicle activity; servicing managed off-peak"],
          ["Easy to cross", "Crossing provision assessed in the PCL analysis (Chapter 4)"],
          ["Places to stop and rest", "Public-realm provision — landscape drawings at submittal"],
          ["Shade and shelter", "Public-realm provision — landscape drawings at submittal"],
          ["People feel relaxed", "Footway comfort assessed via PCL (Chapter 4)"],
          ["Things to see and do", "Active ground-floor uses per the design and access statement"],
        ],
      }),

      // Local study network — the junctions within the study radius (Chapter 3).
      localNetwork: (ctx): TableData | null => {
        const list = ints(ctx);
        if (!list.length) return null;
        return {
          headers: ["Junction", "Distance (mi)", "In radius", "Added PM trips"],
          widths: [220, 90, 90, 110],
          align: ["left", "right", "center", "right"],
          rows: list.slice(0, 30).map((it) => [s(it.name ?? it.signalId), num(it.distanceMi, 2), "Yes", num(it.addedTripsPmPeak)]),
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

      // Trip generation by period — net arriving/departing per assessment period.
      tripGenByPeriod: (ctx) => {
        const ps = periods(ctx);
        let cats: string[];
        let inV: number[];
        let outV: number[];
        if (ps.length) {
          cats = ps.map((p) => s(p.periodLabel, "") || s(p.period, "") || "Period");
          inV = ps.map((p) => Number(p.tripGeneration?.inTrips ?? 0));
          outV = ps.map((p) => Number(p.tripGeneration?.outTrips ?? 0));
        } else {
          const t = tg(ctx);
          const daily = Number(t.dailyTrips ?? 0);
          if (!(daily > 0)) return null;
          cats = ["AM peak", "PM peak", "Daily (½)"];
          inV = [Number(t.amPeakTrips ?? 0), Number(t.pmIn ?? 0), daily / 2];
          outV = [0, Number(t.pmOut ?? 0), daily / 2];
        }
        if (!inV.some((v) => v > 0) && !outV.some((v) => v > 0)) return null;
        return {
          type: "column" as const,
          spec: {
            title: "Figure 6-1: Vehicle Trip Generation by Assessment Period",
            categories: cats,
            height: 165,
            series: [
              { name: "Arriving", color: CHART_COLORS.inbound, values: inV },
              { name: "Departing", color: CHART_COLORS.outbound, values: outV },
            ],
            yLabel: "Two-way trips",
            xLabel: "Assessment period",
            caption: "Net trips by period after pass-by and internalisation credits. A submitted TA substitutes the agreed TRICS multi-modal rates with the 2011 Census public-transport adjustment.",
          },
        };
      },

      // Indicative mode share from the applied private-vehicle share.
      modalSplit: (ctx) => {
        const share = Number(ctx.report?.autoModeShareApplied);
        if (!(Number.isFinite(share) && share > 0)) return null;
        const carPct = Math.round(share * 100);
        return {
          type: "column" as const,
          spec: {
            title: "Figure 2-2: Indicative Mode Share",
            categories: ["Private vehicle", "Sustainable modes"],
            height: 150,
            series: [{ name: "Share", color: CHART_COLORS.outbound, values: [carPct, 100 - carPct] }],
            yLabel: "% of person trips",
            xLabel: "Travel mode",
            yTickFormat: (v: number) => `${v}%`,
            caption: `Applied private-vehicle mode share of ${carPct}% for this central, highly-accessible location; the residual ${100 - carPct}% is made by public transport, walking and cycling. A submitted TA derives the full multi-modal split from the 2011 Census Method-of-Travel-to-Work for the site LSOA.`,
          },
        };
      },

      // Junction degree of saturation, No-Build vs With-Development (top 12 loaded).
      junctionDoS: (ctx) => {
        const list = ints(ctx).slice(0, 12);
        if (!list.length) return null;
        const cats: string[] = [];
        const nb: number[] = [];
        const bd: number[] = [];
        for (const it of list) {
          try {
            const a = ukCapacityForIntersection(it, "noBuild");
            const b = ukCapacityForIntersection(it, "build");
            if (!Number.isFinite(a.dosPct) && !Number.isFinite(b.dosPct)) continue;
            cats.push(shortName(it.name ?? it.signalId));
            nb.push(Number.isFinite(a.dosPct) ? a.dosPct : 0);
            bd.push(Number.isFinite(b.dosPct) ? b.dosPct : 0);
          } catch { /* skip un-modellable junction */ }
        }
        if (!cats.length) return null;
        return {
          type: "column" as const,
          spec: {
            title: "Figure 6-3: Junction Degree of Saturation — No-Build vs With-Development",
            categories: cats,
            height: 175,
            series: [
              { name: "No-Build", color: CHART_COLORS.inbound, values: nb },
              { name: "With Dev", color: CHART_COLORS.outbound, values: bd },
            ],
            yLabel: "Degree of saturation",
            xLabel: "Junction",
            yTickFormat: (v: number) => `${v}%`,
            caption: "UK degree of saturation by junction; 90% is the practical reserve-capacity threshold. Junctions screening above 90% With-Development are re-run in LinSig 3 / Junctions 11 on the agreed TRICS demand at submittal.",
          },
        };
      },

      // PM-peak trip distribution across the study network (top 12 loaded).
      tripDistributionChart: (ctx) => {
        const list = ints(ctx);
        if (!list.length) return null;
        const fin = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
        const total = list.reduce((sm, it) => sm + fin(it.addedTripsPmPeak), 0) || 1;
        const top = [...list].sort((a, b) => fin(b.addedTripsPmPeak) - fin(a.addedTripsPmPeak)).slice(0, 12);
        const cats = top.map((it) => shortName(it.name ?? it.signalId));
        const vals = top.map((it) => Number(((fin(it.addedTripsPmPeak) / total) * 100).toFixed(1)));
        if (!vals.some((v) => v > 0)) return null;
        return {
          type: "column" as const,
          spec: {
            title: "Figure 6-4: PM-Peak Trip Distribution by Junction",
            categories: cats,
            height: 165,
            series: [{ name: "Share of added PM trips", color: CHART_COLORS.line, values: vals }],
            yLabel: "% of added PM trips",
            xLabel: "Junction",
            yTickFormat: (v: number) => `${v}%`,
            caption: "Distribution of net new PM-peak trips across the study network from the gravity-model assignment; the 12 most-loaded junctions are shown.",
          },
        };
      },
    },

    flags: {
      hasIntersections: (ctx) => ints(ctx).length > 0,
      hasPeriods: (ctx) => periods(ctx).length > 0,
      hasModeShare: (ctx) => { const x = Number(ctx.report?.autoModeShareApplied); return Number.isFinite(x) && x > 0; },
      hasTripGen: (ctx) => dailyTrips(ctx) > 0,
      drawDiurnal: (ctx) => diurnal(ctx) != null,
      noLosImpact: (ctx) => Number(ctx.report?.intersectionsWithLosDrop ?? 0) === 0 && Number(ctx.report?.intersectionsAtLosEf ?? 0) === 0,
      showCapacity: (ctx) => detectStudyType(ctx.report, ctx.project).showCapacity,
      isPedestrian: (ctx) => detectStudyType(ctx.report, ctx.project).kind === "pedestrian",
      isParking: (ctx) => detectStudyType(ctx.report, ctx.project).kind === "parking",
      isVehicular: (ctx) => detectStudyType(ctx.report, ctx.project).kind === "vehicular",
    },
  };
}
