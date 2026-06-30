/**
 * Vector chart primitives for the PDF renderers (PDFKit).
 *
 * The renderers already draw tables, metric strips and filled rects with
 * PDFKit's vector API; this module adds the two chart types the Velocity
 * Transport Planning London format relies on:
 *
 *   • drawColumnChart — clustered vertical-bar chart (Velocity Fig 2-1,
 *     "Employee Inbound/Outbound Trips by Start Time").
 *   • drawLineChart   — line / area chart (Velocity Fig 6-2,
 *     "Total Person Daily Accumulation").
 *
 * No charting dependency is introduced — everything is rect/line/text on the
 * same `doc`. Colours default to the Velocity palette sampled from the filed
 * 60 Gracechurch Street TA (inbound #FC8460, outbound #60C09C, captions in
 * Velocity green) but every colour is overridable so the helpers are reusable
 * by any region's renderer.
 *
 * Both helpers manage `doc.y` the way `table()`/`metricStrip()` do: they
 * page-break when the chart will not fit, draw from the left page margin, and
 * leave `doc.x`/`doc.y` below the chart for the next block.
 */

import { profileForLandUse, distributeDaily, type ProfileLocale } from "./office-diurnal";

const PAGE_MARGIN = 50;
const TEXT_GRAY = "#6b7280";

/** Coerce a chart value to a finite number so NaN/Infinity can never reach a draw op. */
const fin = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/** Velocity palette (sampled from 60gcs-ta-partA.pdf). */
export const CHART_COLORS = {
  inbound: "#FC8460",
  outbound: "#60C09C",
  /** Velocity heading / figure-caption green. */
  caption: "#6FA840",
  line: "#5A8FBf",
  grid: "#D9D9D9",
  axis: "#595959",
  baseline: "#9CA3AF",
};

type Scale = { max: number; step: number; ticks: number[] };

/** Round an axis up to a clean maximum with evenly-spaced ticks. */
function niceScale(maxValue: number, targetTicks = 5): Scale {
  if (!(maxValue > 0)) return { max: 1, step: 1, ticks: [0, 1] };
  const rawStep = maxValue / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  step *= mag;
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 1e-6; v += step) ticks.push(Number(v.toFixed(6)));
  return { max, step, ticks };
}

/** Page-break if `needed` vertical points will not fit below the cursor. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > doc.page.height - PAGE_MARGIN - 30) {
    doc.addPage();
  }
}

type ChartLayout = {
  chartX0: number;
  chartW: number;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  plotW: number;
  plotH: number;
};

/** Shared frame: caption, axes, gridlines, y/x titles. Returns the plot box. */
function drawFrame(
  doc: PDFKit.PDFDocument,
  opts: {
    title?: string;
    yLabel?: string;
    xLabel?: string;
    legendW: number;
    plotH: number;
    scale: Scale;
    yTickFormat: (v: number) => string;
  },
): ChartLayout {
  const { title, yLabel, xLabel, legendW, plotH, scale, yTickFormat } = opts;
  const chartX0 = PAGE_MARGIN;
  const chartW = doc.page.width - PAGE_MARGIN * 2;

  // Caption (Velocity green, above the plot).
  let cursorY = doc.y;
  if (title) {
    doc.font("bold").fontSize(9.5).fillColor(CHART_COLORS.caption).text(title, chartX0, cursorY, {
      width: chartW,
    });
    cursorY = doc.y + 4;
  }

  const yTitleW = yLabel ? 14 : 0;
  const yLabelsW = 36;
  const xLabelH = 12;
  const xTitleH = xLabel ? 14 : 0;

  const plotLeft = chartX0 + yTitleW + yLabelsW;
  const plotRight = chartX0 + chartW - legendW;
  const plotTop = cursorY;
  const plotBottom = plotTop + plotH;
  const plotW = plotRight - plotLeft;

  // Horizontal gridlines + y tick labels.
  doc.lineWidth(0.5);
  for (const t of scale.ticks) {
    const y = plotBottom - (t / scale.max) * plotH;
    doc.strokeColor(CHART_COLORS.grid).moveTo(plotLeft, y).lineTo(plotRight, y).stroke();
    doc.font("body").fontSize(7).fillColor(CHART_COLORS.axis).text(yTickFormat(t), chartX0 + yTitleW, y - 4, {
      width: yLabelsW - 4,
      align: "right",
    });
  }

  // Baseline (x-axis).
  doc.lineWidth(0.8).strokeColor(CHART_COLORS.baseline).moveTo(plotLeft, plotBottom).lineTo(plotRight, plotBottom).stroke();

  // y-axis title (rotated).
  if (yLabel) {
    const cy = plotTop + plotH / 2;
    const tx = chartX0 + 4;
    doc.save();
    doc.rotate(-90, { origin: [tx, cy] });
    doc.font("body").fontSize(8).fillColor(CHART_COLORS.axis).text(yLabel, tx - 70, cy - 5, {
      width: 140,
      align: "center",
    });
    doc.restore();
  }

  // x-axis title.
  if (xLabel) {
    doc.font("body").fontSize(8).fillColor(CHART_COLORS.axis).text(xLabel, plotLeft, plotBottom + xLabelH + 1, {
      width: plotW,
      align: "center",
    });
  }

  return { chartX0, chartW, plotLeft, plotRight, plotTop, plotBottom, plotW, plotH };
}

/** Legend swatches stacked at the top-right of the plot. */
function drawLegend(
  doc: PDFKit.PDFDocument,
  layout: ChartLayout,
  entries: Array<{ name: string; color: string }>,
): void {
  const x = layout.plotRight + 10;
  let y = layout.plotTop + 2;
  for (const e of entries) {
    doc.rect(x, y, 8, 8).fill(e.color);
    doc.font("body").fontSize(8).fillColor(CHART_COLORS.axis).text(e.name, x + 11, y, { width: layout.chartX0 + layout.chartW - x - 11 });
    y += 14;
  }
}

function finish(doc: PDFKit.PDFDocument, layout: ChartLayout, xLabel?: string, caption?: string): void {
  const xTitleH = xLabel ? 14 : 0;
  let endY = layout.plotBottom + 12 + xTitleH + 4;
  if (caption) {
    doc.font("body").fontSize(7.5).fillColor(CHART_COLORS.axis).text(caption, layout.chartX0, endY, {
      width: layout.chartW,
      paragraphGap: 2,
    });
    endY = doc.y;
  }
  doc.fillColor("black").lineWidth(1);
  doc.x = PAGE_MARGIN;
  doc.y = endY + 6;
}

export type ColumnSeries = { name: string; color: string; values: number[] };

export type ColumnChartSpec = {
  /** Figure caption drawn above the plot (e.g. "Figure 2-1: …"). */
  title?: string;
  /** x-axis category labels (one per group). */
  categories: string[];
  /** One or more clustered series. */
  series: ColumnSeries[];
  yLabel?: string;
  xLabel?: string;
  /** Plot-area height in points (default 200). */
  height?: number;
  /** y tick formatter (default integer with thousands separators). */
  yTickFormat?: (v: number) => string;
  /** Small grey note printed under the chart. */
  caption?: string;
  /** Stack the series into one bar per category (series[0] at the bottom) instead of clustering. */
  stacked?: boolean;
};

/** Vertical-bar chart — clustered by default, or stacked (Velocity Fig 2-1 is stacked). */
export function drawColumnChart(doc: PDFKit.PDFDocument, spec: ColumnChartSpec): void {
  const plotH = spec.height ?? 200;
  const yTickFormat = spec.yTickFormat ?? ((v: number) => fmtTick(v));
  const captionH = spec.title ? 16 : 0;
  ensureSpace(doc, captionH + plotH + 30 + (spec.xLabel ? 14 : 0) + (spec.caption ? 28 : 0));

  const stacked = spec.stacked ?? false;
  const nCat = spec.categories.length;
  const colTotal = (i: number) => spec.series.reduce((s, ser) => s + Math.max(0, fin(ser.values[i])), 0);
  const maxVal = stacked
    ? Math.max(0, ...Array.from({ length: nCat }, (_, i) => colTotal(i)))
    : Math.max(0, ...spec.series.flatMap((s) => s.values));
  const scale = niceScale(maxVal, 5);
  const legendW = spec.series.length > 1 ? 84 : 0;

  const layout = drawFrame(doc, {
    title: spec.title,
    yLabel: spec.yLabel,
    xLabel: spec.xLabel,
    legendW,
    plotH,
    scale,
    yTickFormat,
  });

  const n = nCat;
  const groupW = layout.plotW / Math.max(1, n);
  const nS = spec.series.length;
  const groupInner = groupW * 0.74; // leave 26% as the inter-group gap
  const barW = stacked ? groupInner : groupInner / nS;

  for (let i = 0; i < n; i++) {
    const groupX = layout.plotLeft + i * groupW + (groupW - groupInner) / 2;
    if (stacked) {
      let yCursor = layout.plotBottom;
      for (let s = 0; s < nS; s++) {
        const v = Math.max(0, fin(spec.series[s].values[i]));
        if (v <= 0) continue;
        const h = (v / scale.max) * layout.plotH;
        doc.rect(groupX, yCursor - h, barW, h).fill(spec.series[s].color);
        yCursor -= h;
      }
    } else {
      for (let s = 0; s < nS; s++) {
        const v = fin(spec.series[s].values[i]);
        if (v <= 0) continue;
        const h = (v / scale.max) * layout.plotH;
        const x = groupX + s * barW;
        doc.rect(x, layout.plotBottom - h, barW * 0.9, h).fill(spec.series[s].color);
      }
    }
    // x label centred under the group.
    doc.font("body").fontSize(7).fillColor(CHART_COLORS.axis).text(spec.categories[i], layout.plotLeft + i * groupW, layout.plotBottom + 2, {
      width: groupW,
      align: "center",
    });
  }

  if (legendW > 0) drawLegend(doc, layout, spec.series.map((s) => ({ name: s.name, color: s.color })));
  finish(doc, layout, spec.xLabel, spec.caption);
}

export type LineChartSpec = {
  title?: string;
  categories: string[];
  /** y values, one per category. */
  values: number[];
  color?: string;
  /** Fill the area under the line (default true). */
  fillArea?: boolean;
  yLabel?: string;
  xLabel?: string;
  height?: number;
  yTickFormat?: (v: number) => string;
  caption?: string;
  /** Optionally thin the x labels (e.g. every 2nd hour) — show label when index % step === 0. */
  labelEvery?: number;
};

/** Line / area chart (Velocity Fig 6-2). */
export function drawLineChart(doc: PDFKit.PDFDocument, spec: LineChartSpec): void {
  const plotH = spec.height ?? 200;
  const yTickFormat = spec.yTickFormat ?? ((v: number) => fmtTick(v));
  const color = spec.color ?? CHART_COLORS.line;
  const fillArea = spec.fillArea ?? true;
  const captionH = spec.title ? 16 : 0;
  ensureSpace(doc, captionH + plotH + 30 + (spec.xLabel ? 14 : 0) + (spec.caption ? 28 : 0));

  const maxVal = Math.max(0, ...spec.values.map(fin));
  const scale = niceScale(maxVal, 5);

  const layout = drawFrame(doc, {
    title: spec.title,
    yLabel: spec.yLabel,
    xLabel: spec.xLabel,
    legendW: 0,
    plotH,
    scale,
    yTickFormat,
  });

  const n = spec.values.length;
  const stepX = layout.plotW / Math.max(1, n - 1);
  const px = (i: number) => layout.plotLeft + i * stepX;
  const py = (v: number) => layout.plotBottom - (Math.max(0, fin(v)) / scale.max) * layout.plotH;

  if (fillArea && n > 1) {
    doc.save();
    doc.moveTo(px(0), layout.plotBottom);
    for (let i = 0; i < n; i++) doc.lineTo(px(i), py(spec.values[i]));
    doc.lineTo(px(n - 1), layout.plotBottom).closePath();
    doc.fillOpacity(0.15).fill(color);
    doc.restore();
  }

  doc.lineWidth(1.5).strokeColor(color);
  doc.moveTo(px(0), py(spec.values[0] ?? 0));
  for (let i = 1; i < n; i++) doc.lineTo(px(i), py(spec.values[i]));
  doc.stroke();

  const step = spec.labelEvery ?? 1;
  for (let i = 0; i < n; i++) {
    if (i % step !== 0) continue;
    doc.font("body").fontSize(7).fillColor(CHART_COLORS.axis).text(spec.categories[i], px(i) - stepX / 2, layout.plotBottom + 2, {
      width: stepX,
      align: "center",
    });
  }

  finish(doc, layout, spec.xLabel, spec.caption);
}

/** Compact tick formatter: 1,250 → "1,250"; 0.5 → "0.5". */
function fmtTick(v: number): string {
  if (Number.isInteger(v)) return v.toLocaleString();
  return String(Number(v.toFixed(2)));
}

const fmtCount = (n: unknown): string => Math.round(Number(n) || 0).toLocaleString();

/**
 * Shared within-day trip-distribution charts, usable by every regional renderer:
 * a stacked inbound/outbound-by-hour bar chart and a daily accumulation line,
 * derived by distributing the engine's gross daily trip generation across the
 * use-class within-day profile (residential / retail / school from standard US
 * NHTS 2022 distributions). Office land uses ship NO US within-day shape, so the
 * office figure is omitted under the US locale. Self-skips when the use class has
 * no defensible profile or daily trips are zero, so callers drop one
 * unconditional call into their trip-generation section. A consultant
 * `tripProfile` override on the request takes precedence over the use-class
 * default. Requires the host doc to have registered "body"/"bold" fonts
 * (renderStudyPdf does).
 *
 * `locale` defaults to "us" — the only value the US DOT renderers pass — so the
 * office figure is omitted and no TfL/LTDS provenance line can be printed. The
 * London renderer prints its own LTDS figures directly and does not call this.
 */
export function renderDiurnalCharts(doc: PDFKit.PDFDocument, r: any, locale: ProfileLocale = "us"): void {
  const tg = r?.tripGeneration ?? {};
  const daily = Number(tg.dailyTrips ?? 0);
  if (!(Number.isFinite(daily) && daily > 0)) return;
  const sel = profileForLandUse(String(tg.landUseCode ?? ""), (r?.request ?? {}).tripProfile, locale);
  if (!sel.matched) return;
  const hourly = distributeDaily(daily, sel.profile);
  const hourLabels = Array.from({ length: 24 }, (_, h) => String(h));

  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(11).fillColor("black").text("Trip Distribution by Time of Day", { paragraphGap: 2 });
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    `Estimated within-day distribution of the ${fmtCount(daily)} gross daily trips and the resulting on-site accumulation. ${sel.profile.source}`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  drawColumnChart(doc, {
    title: "Figure — Inbound / Outbound Trips by Start Time",
    categories: hourLabels,
    stacked: true,
    series: [
      { name: "Outbound", color: CHART_COLORS.outbound, values: hourly.departuresSharePct },
      { name: "Inbound", color: CHART_COLORS.inbound, values: hourly.arrivalsSharePct },
    ],
    yLabel: "% of daily total",
    xLabel: "Hour of day",
    yTickFormat: (v) => `${v}%`,
  });

  drawLineChart(doc, {
    title: "Figure — Daily Trip Accumulation",
    categories: hourLabels,
    values: hourly.accumulation,
    color: CHART_COLORS.outbound,
    yLabel: "On-site (est.)",
    xLabel: "Hour of day",
    caption: `Peak on-site accumulation ~${fmtCount(hourly.peakAccumulation)} at ${String(hourly.peakAccumulationHour).padStart(2, "0")}:00, from ${fmtCount(daily)} gross daily trips on the ${sel.family ?? "supplied"} within-day profile. Screening estimate; not a substitute for a calibrated time-of-day model.`,
  });
  doc.moveDown(0.2);
}
