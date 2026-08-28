// Shared trip-distribution PDF section, rendered in every US regional renderer.
// Self-contained (Path A): re-declares the tiny primitives it needs so it stays
// free of cross-file coupling that breaks under merge conflicts — same
// convention as pdf-export-ny.ts / pdf-export-states.ts.
//
// FL byte-identity: when opts.flavor === "fl" this emits Florida's exact §6.1/§6.2
// prose, captions (incl. FDOT TAH §2.7), and doc.moveDown(0.2) spacing so the
// refactored FL section is byte-identical to origin/main.
import type { TripDistributionSummary } from "./trip-distribution";
import { drawColumnChart, drawLineChart, drawCompassRose, CHART_COLORS } from "./pdf-charts";
import { CARDINALS } from "./caltran-gravity";

// ---- primitives table() closes over (copied per Path A) ----
const PAGE_MARGIN = 50;
// Off for US renderers; renderTripDistributionSection flips this on for the
// duration of a UK (flavor "uk") render so the shared tables adopt the Velocity
// green palette that the rest of the London TA uses, then resets it in a finally.
let velocityPaletteActive = false as boolean;
const VELOCITY_FILL = "#ECF5E9";
const VELOCITY_GREEN = "#8EC57C";
const TEXT_GRAY = "#6b7280";

const fin2 = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

/**
 * A "nice" ring interval (1/2/5 x a power of ten) giving roughly four rings at
 * any scale. Scale-derived rather than a fixed ladder so the ring count stays
 * bounded no matter how large the study extent is.
 */
function niceRingStep(maxMi: number): number {
  const target = Math.max(maxMi, 1e-6) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const norm = target / mag;
  const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return mult * mag;
}

/**
 * Figure — Project Trip Distribution, drawn as a TO-SCALE plan.
 *
 * The section already carries a compass rose and two charts, but none of them
 * is the exhibit a reviewing engineer looks for: the conventional TIS figure
 * puts the study locations in their real geographic relationship to the site
 * and writes each one's percentage of project trips on the leg that serves it.
 * A bar chart of the same numbers does not answer "where is that 12% going?"
 *
 * Each zone is plotted from its own `bearingDeg` / `distanceMi` — the polar
 * position the gravity model already computed — so unlike the site-access
 * schematic elsewhere in the report, this figure IS to scale, and carries a
 * scale bar to say so. Leg weight is proportional to trip share, which is what
 * makes the dominant corridors readable at a glance.
 */
export function drawDistributionPlan(
  doc: PDFKit.PDFDocument,
  td: TripDistributionSummary,
  accent: string,
): void {
  const zones = (td.zones ?? [])
    .filter((z) => Number.isFinite(z.distanceMi) && Number.isFinite(z.bearingDeg) && fin2(z.sharePct) > 0)
    .slice(0, 12);
  if (zones.length === 0) return;

  const figW = doc.page.width - 2 * PAGE_MARGIN;
  const figH = 330;
  // Site box dimensions, declared up front: the label pass needs them to avoid
  // printing over the box, and the box itself is drawn last.
  const SITE_W = 92, SITE_H = 26;
  // Keep the whole figure on one page — splitting a plan across a page break
  // makes it unreadable and mis-scales the bar.
  if (doc.y + figH > doc.page.height - PAGE_MARGIN - 40) doc.addPage();
  const x0 = PAGE_MARGIN;
  const y0 = doc.y;
  const cx = x0 + figW / 2;
  const cy = y0 + figH / 2;

  doc.save();
  doc.lineWidth(0.75).strokeColor("#d1d5db").rect(x0, y0, figW, figH).stroke();

  // Usable radius leaves room for the labels that sit outside each node.
  const R = Math.min(figW / 2 - 96, figH / 2 - 46);
  // One absurd distance would otherwise set the scale and collapse every real
  // zone onto the site marker. Clamp the extent to the largest SANE distance
  // (zones beyond it still plot, just at the frame edge).
  const dists = zones.map((z) => z.distanceMi).filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  const p95 = dists.length > 0 ? dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.95))]! : 0.1;
  const maxMi = Math.min(Math.max(p95, 0.1), 500);
  const pxPerMi = R / maxMi;

  // Distance rings at "nice" intervals, so the reader can read range directly.
  //
  // The step is derived from maxMi rather than taken from a fixed ladder. A
  // fixed ladder topped out at 2 mi, so one zone with an absurd distanceMi — a
  // data error, or a genuinely far-flung zone — meant maxMi of 1e9 and a loop
  // of ~500 MILLION iterations, each drawing a circle. That is an out-of-memory
  // crash of the whole render, not a cosmetic problem, and the `rp > R` break
  // never fires because pxPerMi shrinks in exact proportion. Found by stress
  // testing with pathological zone geometry.
  const ringStep = niceRingStep(maxMi);
  const MAX_RINGS = 12;
  doc.save().lineWidth(0.4).strokeColor("#e5e7eb").dash(2, { space: 2 });
  for (let k = 1; k <= MAX_RINGS; k++) {
    const r = ringStep * k;
    if (r > maxMi + 1e-9) break;
    const rp = r * pxPerMi;
    if (rp > R + 1) break;
    doc.circle(cx, cy, rp).stroke();
    doc.undash();
    doc.font("Helvetica").fontSize(6).fillColor("#9ca3af")
      .text(`${r % 1 === 0 ? r : r.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} mi`,
        cx + 2, cy - rp - 7, { lineBreak: false });
    doc.dash(2, { space: 2 });
  }
  doc.undash().restore();

  // North arrow — triangle above, letter below, so they never overlap.
  const nax = x0 + figW - 20;
  doc.save().fillColor(TEXT_GRAY)
    .moveTo(nax, y0 + 8).lineTo(nax - 4, y0 + 17).lineTo(nax + 4, y0 + 17)
    .closePath().fill().restore();
  doc.fillColor(TEXT_GRAY).font("Helvetica").fontSize(7)
    .text("N", nax - 4, y0 + 19, { width: 8, align: "center", lineBreak: false });

  const maxShare = Math.max(...zones.map((z) => fin2(z.sharePct)), 1);

  // Legs first so the node markers sit on top of them.
  for (const z of zones) {
    const rad = (z.bearingDeg * Math.PI) / 180;
    const r = Math.min(z.distanceMi * pxPerMi, R);
    const px = cx + r * Math.sin(rad);
    const py = cy - r * Math.cos(rad);
    const w = 0.6 + 3.4 * (fin2(z.sharePct) / maxShare);
    doc.save().lineWidth(w).strokeColor(accent).opacity(0.55)
      .moveTo(cx, cy).lineTo(px, py).stroke().opacity(1).restore();
  }

  // Nodes.
  const placed = zones.map((z, i) => {
    const rad = (z.bearingDeg * Math.PI) / 180;
    // Clamped to the plot radius: a zone beyond the (95th-percentile) extent
    // is drawn at the frame edge rather than off the page.
    const r = Math.min(z.distanceMi * pxPerMi, R);
    const px = cx + r * Math.sin(rad);
    const py = cy - r * Math.cos(rad);
    doc.save().fillColor(accent).circle(px, py, 4).fill().restore();
    doc.save().lineWidth(0.75).strokeColor("#ffffff").circle(px, py, 4).stroke().restore();
    return { z, i, px, py, east: Math.sin(rad) >= 0 };
  });

  // Labels, de-collided. Close-in zones land almost on top of each other, and
  // two overlapping percentages in an engineering figure are worse than none.
  // Each side of the plan is swept top-to-bottom and any label closer than one
  // label-height to the previous one is pushed down; a leader line then keeps
  // it tied to its node.
  const LABEL_W = 86;
  const LABEL_H = 15;
  for (const side of [true, false]) {
    const col = placed.filter((p) => p.east === side).sort((a, b) => a.py - b.py);
    let lastY = -Infinity;
    for (const p of col) {
      let ly = Math.max(y0 + 4, Math.min(p.py - 8, y0 + figH - 24));
      if (ly - lastY < LABEL_H) ly = lastY + LABEL_H;
      // Ran out of room below: fall back to the node's own position rather
      // than marching labels off the bottom of the frame.
      if (ly > y0 + figH - 24) ly = Math.max(y0 + 4, p.py - 8);
      lastY = ly;

      let lx = side ? p.px + 8 : p.px - 8 - LABEL_W;
      // Never let a label sit on the site box. Close-in zones put their label
      // right where "PROJECT SITE" is printed, which is the one place in the
      // figure that must stay readable.
      const boxTop = cy - SITE_H / 2 - 4;
      const boxBot = cy + SITE_H / 2 + 4;
      if (ly + LABEL_H > boxTop && ly < boxBot) {
        if (side) lx = Math.max(lx, cx + SITE_W / 2 + 6);
        else lx = Math.min(lx, cx - SITE_W / 2 - 6 - LABEL_W);
      }
      if (lx < x0 + 3) lx = x0 + 3;
      if (lx + LABEL_W > x0 + figW - 3) lx = x0 + figW - 3 - LABEL_W;

      // Leader line whenever the label had to move off its node.
      if (Math.abs(ly + 4 - p.py) > 5) {
        const anchorX = side ? lx : lx + LABEL_W;
        doc.save().lineWidth(0.4).strokeColor("#c7cdd4")
          .moveTo(p.px, p.py).lineTo(anchorX, ly + 5).stroke().restore();
      }

      doc.font("Helvetica-Bold").fontSize(7).fillColor("black")
        .text(`${fin2(p.z.sharePct).toFixed(1)}%`, lx, ly, { width: LABEL_W, align: side ? "left" : "right", lineBreak: false });
      doc.font("Helvetica").fontSize(6).fillColor(TEXT_GRAY)
        .text(shortZoneLabel(p.z.name, p.i), lx, ly + 8, { width: LABEL_W, align: side ? "left" : "right", lineBreak: false });
    }
  }

  // Site marker last — it belongs on top of every leg.
  doc.save().fillColor("#fde68a").opacity(0.9).rect(cx - SITE_W / 2, cy - SITE_H / 2, SITE_W, SITE_H).fill().opacity(1).restore();
  doc.lineWidth(1).strokeColor("#b45309").rect(cx - SITE_W / 2, cy - SITE_H / 2, SITE_W, SITE_H).stroke();
  doc.fillColor("black").font("Helvetica-Bold").fontSize(7.5)
    .text("PROJECT SITE", cx - SITE_W / 2 + 3, cy - 4, { width: SITE_W - 6, align: "center", lineBreak: false });

  // Scale bar — the claim that this figure is to scale, made checkable.
  const barMi = ringStep;  // same interval as the rings, so the two agree
  const barPx = barMi * pxPerMi;
  const bx = x0 + 14, by = y0 + figH - 18;
  doc.save().lineWidth(1).strokeColor("#374151")
    .moveTo(bx, by).lineTo(bx + barPx, by).stroke()
    .moveTo(bx, by - 3).lineTo(bx, by + 3).stroke()
    .moveTo(bx + barPx, by - 3).lineTo(bx + barPx, by + 3).stroke().restore();
  doc.font("Helvetica").fontSize(6.5).fillColor(TEXT_GRAY)
    .text(`${barMi} mi`, bx, by + 4, { lineBreak: false });

  doc.restore();
  doc.y = y0 + figH + 6;
  doc.x = PAGE_MARGIN;
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
    `Figure — Project Trip Distribution. Study-area zones plotted to scale at their true bearing and distance from the site; leg weight is proportional to each zone's share of project trips, and the label gives that share. Derived from the ${td.methodLabel} distribution — the same shares tabulated above. Screening-grade: zone positions are the analysis locations, not a surveyed base map.`,
    PAGE_MARGIN,
    doc.y,
    { width: doc.page.width - 2 * PAGE_MARGIN, paragraphGap: 6 },
  );
  doc.fillColor("black");
}
const shortZoneLabel = (name: string, i: number): string => {
  const s = (name || `Zone ${i + 1}`).replace(/\s+/g, " ").trim();
  return s.length > 16 ? s.slice(0, 15) + "…" : s;
};

type TableSpec = {
  headers: string[];
  widths: number[];
  align?: Array<"left" | "right" | "center">;
  rows: string[][];
};

// ---- fmtNum: VERBATIM from pdf-export.ts:8990 ----
function fmtNum(n: any, decimals: number = 0): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const num = Number(n);
  return decimals > 0 ? num.toFixed(decimals) : Math.round(num).toLocaleString();
}

// ---- table: VERBATIM from pdf-export.ts:8881 ----
function table(doc: PDFKit.PDFDocument, spec: TableSpec) {
  const { headers, widths, rows: dataRows } = spec;
  const align = spec.align ?? headers.map(() => "left" as const);
  const startX = PAGE_MARGIN;
  const totalW = widths.reduce((s, w) => s + w, 0);
  const PADX = 4;
  const PADY = 4;
  const velo = velocityPaletteActive;
  const headerFill = velo ? VELOCITY_FILL : "#f3f4f6";
  const headerText = velo ? VELOCITY_GREEN : "black";
  const sepColor = velo ? VELOCITY_GREEN : "#e5e7eb";

  const measureRow = (cells: string[], isHeader: boolean): number => {
    doc.font(isHeader ? "bold" : "body").fontSize(9);
    let maxH = 0;
    for (let i = 0; i < cells.length; i++) {
      const w = (widths[i] ?? 60) - PADX * 2;
      const h = doc.heightOfString(cells[i] ?? "", { width: w, align: align[i] ?? "left" });
      if (h > maxH) maxH = h;
    }
    return Math.max(13, maxH) + PADY * 2;
  };

  const drawRow = (cells: string[], y: number, isHeader: boolean, h: number) => {
    if (isHeader) {
      doc.rect(startX, y, totalW, h).fill(headerFill);
      if (velo) {
        doc.save().strokeColor(VELOCITY_GREEN).lineWidth(0.75)
          .moveTo(startX, y + h).lineTo(startX + totalW, y + h).stroke().restore();
      }
    }
    let x = startX;
    doc.font(isHeader ? "bold" : "body").fontSize(9).fillColor(isHeader ? headerText : "black");
    for (let i = 0; i < cells.length; i++) {
      const w = widths[i] ?? 60;
      doc.text(cells[i] ?? "", x + PADX, y + PADY, {
        width: w - PADX * 2,
        align: align[i] ?? "left",
      });
      x += w;
    }
  };

  let y = doc.y;
  const headerH = measureRow(headers, true);
  const firstRowH = dataRows.length > 0 ? measureRow(dataRows[0], false) : 0;
  if (y + headerH + firstRowH > doc.page.height - PAGE_MARGIN - 40) {
    doc.addPage();
    y = doc.y;
  }
  drawRow(headers, y, true, headerH);
  y += headerH;

  for (const r of dataRows) {
    const rh = measureRow(r, false);
    if (y + rh > doc.page.height - PAGE_MARGIN - 40) {
      doc.addPage();
      y = doc.y;
      const hh = measureRow(headers, true);
      drawRow(headers, y, true, hh);
      y += hh;
    }
    drawRow(r, y, false, rh);
    doc.strokeColor(sepColor).lineWidth(0.5)
      .moveTo(startX, y + rh).lineTo(startX + totalW, y + rh).stroke();
    y += rh;
  }
  doc.y = y + 4;
  doc.x = PAGE_MARGIN;
}

const QUADRANT_LABEL: Record<string, string> = {
  "NNE+ENE": "Northeast (NNE + ENE)",
  "ESE+SSE": "Southeast (ESE + SSE)",
  "SSW+WSW": "Southwest (SSW + WSW)",
  "WNW+NNW": "Northwest (WNW + NNW)",
};

const WORKSHEET_CAP = 20;

export type TripDistributionSectionOpts = {
  /** e.g. "6.1", "5.1", "4.3" — the distribution subsection number. */
  subsectionNumber: string;
  /** e.g. "6.2", "5.2" — the assignment subsection number. Omit to skip the
   *  assignment sub-block entirely (used where the renderer has its own). */
  assignmentNumber?: string;
  /** Renderer-native subsection heading fn (gaSubsection/caSubsection/nySubsection). */
  headingFn: (doc: PDFKit.PDFDocument, title: string) => void;
  /** Worksheet row cap (default 20). */
  cap?: number;
  /** affectedIntersections rows for the assignment table (PM). */
  intersections?: any[];
  /** periodReports, to pull the am_peak column. */
  periods?: any[];
  /** "fl" → reproduce Florida's exact prose/captions/spacing (byte-identical);
   *  "uk" → UK narrative (WebTAG/DMRB/TRICS/Census WU03EW) + Velocity palette;
   *  "generic" (default) → the region-neutral wording for the new sections. */
  flavor?: "fl" | "uk" | "generic";
};

// UK method-mechanic one-liner, appended after the method label in the narrative.
function ukMethodMechanic(td: TripDistributionSummary): string {
  switch (td.method) {
    case "surrogate":
      return `The site MSOA's 2011 Census journey-to-work commuter flows are projected onto each study junction's bearing from the site and distance-decayed (${td.massBasis}).`;
    case "analogy":
      return "A screening-grade directional pattern by land-use family and area type is oriented to the site's primary access corridor and distance-decayed; for a submitted TA it is replaced by a TRICS multi-modal comparable site.";
    case "gravity":
    default:
      return "Net car trips are assigned to the study network in proportion to junction proximity (volume × distance⁻¹·⁵).";
  }
}

// -- FL VERBATIM narrative (pdf-export.ts:7770), templated on the summary fields
//    the original read off flg (betaExponent, massBasis). --
function flDistributionNarrative(td: TripDistributionSummary): string {
  return (
    `Project trips are distributed to the surrounding study-area zones with the gravity model used in the Caltran Engineering HCA Westside reference TIS, adopted here as the Florida distribution standard. Each zone attracts trips in proportion to its mass and inversely with its distance from the site — term = M / (d^${td.betaExponent} · d_site) — normalized so the zone shares sum to 100%. Zone mass M is the ${td.massBasis}; d_site (the site zone's own distance normalizer) is 1. The resulting shares set the directional distribution below and drive the project-trip assignment in §6.2.`
  );
}

// -- FL VERBATIM worksheet caption (pdf-export.ts:7807). --
function flWorksheetCaption(td: TripDistributionSummary, cap: number): string {
  const n = td.zones.length;
  return (
    `Screening-grade gravity distribution over ${n} study-area zone${n === 1 ? "" : "s"}${n > cap ? ` (top ${cap} by trip share shown)` : ""}. For formal submittal the adopted regional MPO/TPO travel-demand-model distribution and the run identifier are confirmed at the methodology meeting per FDOT TAH §2.7; this gravity worksheet documents the screening basis.`
  );
}

// -- FL VERBATIM assignment caption (pdf-export.ts:7847). --
const FL_ASSIGNMENT_CAPTION =
  "AM- and PM-peak project trips assigned to each study intersection from the §6.1 gravity distribution: the directional shares orient the loading toward the high-share sectors, while distance-decay from the site sets the magnitude that passes through each intersection. Entering/exiting splits at each intersection follow the site's period directional split.";

export function renderTripDistributionSection(
  doc: PDFKit.PDFDocument,
  result: any,
  opts: TripDistributionSectionOpts,
): void {
  const td = result?.tripDistribution as TripDistributionSummary | undefined;
  if (!td || !Array.isArray(td.zones) || td.zones.length === 0) return;

  const cap = opts.cap ?? WORKSHEET_CAP;
  const isFl = opts.flavor === "fl";
  const isUk = opts.flavor === "uk";
  // UK: adopt the Velocity green palette for the shared tables for the duration
  // of this section (reset in the finally), matching the rest of the London TA.
  const prevVelocity = velocityPaletteActive;
  if (isUk) velocityPaletteActive = true;
  try {

  // --- Distribution heading + method/basis narrative ---
  opts.headingFn(
    doc,
    isFl
      ? `${opts.subsectionNumber} Trip Distribution — Gravity Model`
      : `${opts.subsectionNumber} Trip Distribution — ${td.methodLabel}`,
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    isFl
      ? flDistributionNarrative(td)
      : isUk
        ? `The trip distribution uses the ${td.methodLabel} method. ${ukMethodMechanic(td)} ` +
            `Shares are normalized to 100% of the net car project trips and drive the assignment onto the ` +
            `study junctions below. Basis: ${td.basis}`
      : td.method === "analogy"
        ? `The trip distribution uses the ${td.methodLabel.toLowerCase()} ` +
            `(raw pull = orientation_profile[octant_offset] × exp(−λ × distanceMi), where the ` +
            `orientation profile is a screening-grade directional-concentration shape oriented to ` +
            `the site's primary access corridor and λ is a land-use-family distance-decay rate — a ` +
            `higher λ means a shorter trip-length catchment). ` +
            `Shares are normalized to 100% of project trips and drive the trip ` +
            `assignment below. Basis: ${td.basis}`
        : td.method === "surrogate"
          ? `The trip distribution uses the ${td.methodLabel.toLowerCase()} ` +
              `(raw pull = market-area mass × exp(−λ × distanceMi); market-area mass is ${td.massBasis}). ` +
              `Shares are normalized to 100% of project trips and drive the trip ` +
              `assignment below. Basis: ${td.basis}`
          : `The trip distribution uses the ${td.methodLabel.toLowerCase()} ` +
              `(term = M / (d^${td.betaExponent} · d_site); mass basis: ${td.massBasis}). ` +
              `Shares are normalized to 100% of project trips and drive the trip ` +
              `assignment below. Basis: ${td.basis}`,
    { paragraphGap: 6 },
  );

  // --- Directional (4 sector-pair) table ---
  const sectorRows: string[][] = Object.entries(td.sectors ?? {}).map(
    ([k, v]) => [QUADRANT_LABEL[k] ?? k, `${(Number(v) || 0).toFixed(0)}%`],
  );
  if (sectorRows.length > 0) {
    table(doc, {
      headers: ["Directional sector", "Share of project trips"],
      widths: [300, 180],
      align: ["left", "right"],
      rows: sectorRows,
    });
    doc.moveDown(0.2);
  }

  // --- Gravity worksheet table (top-N by share) ---
  const wsZones = td.zones.slice(0, cap);
  table(doc, {
    headers: ["Study-area zone", "Dir.", "Distance (mi)", td.method === "analogy" ? "Vol. (orient.)" : td.method === "surrogate" ? "Mkt. mass" : "Mass (M)", td.method === "analogy" ? "Pull term" : td.method === "surrogate" ? "Market term" : "Gravity term", "Trip share"],
    widths: [190, 45, 75, 75, 75, 65],
    align: ["left", "center", "right", "right", "right", "right"],
    rows: wsZones.map((z) => [
      z.name ?? z.id ?? "—",
      String(z.cardinal ?? "—"),
      fmtNum(z.distanceMi, 2),
      fmtNum(Math.round(Number(z.mass) || 0)),
      fmtNum(Number(z.term) || 0, 1),
      `${(Number(z.sharePct) || 0).toFixed(2)}%`,
    ]),
  });
  doc.moveDown(0.2);

  // --- Worksheet caption ---
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
    isFl
      ? flWorksheetCaption(td, cap)
      : `${td.zones.length} study-area zone(s)` +
          (td.zones.length > cap ? ` (top ${cap} by trip share shown)` : "") +
          ". Screening-grade distribution; not a calibrated regional model.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // ---- Distribution graphs (Task 8B): appended for every US flavor, incl. FL ----
  // (0) The plan exhibit. Goes FIRST because it is the figure a reviewer looks
  // for — the charts below quantify what this one locates.
  drawDistributionPlan(doc, td, CHART_COLORS.outbound);
  // (1) Directional distribution — compass rose over the eight octants.
  drawCompassRose(doc, {
    title: "Figure — Directional Distribution of Project Trips",
    labels: CARDINALS,
    values: CARDINALS.map((c) => fin2(td.byDirection?.[c])),
    caption:
      "Screening-grade directional distribution of net new project trips by compass octant " +
      "(spoke length ∝ percent of project trips). Derived from the " +
      `${td.methodLabel} distribution.`,
    color: CHART_COLORS.outbound,
  });
  // (2) Per-zone gravity share — top zones by trip share.
  {
    const top = td.zones.slice(0, Math.min(12, td.zones.length));
    if (top.length > 0) {
      drawColumnChart(doc, {
        title: "Figure — Project Trip Share by Study-Area Zone",
        categories: top.map((z, i) => shortZoneLabel(z.name, i)),
        series: [{ name: "Trip share (%)", color: CHART_COLORS.outbound, values: top.map((z) => fin2(z.sharePct)) }],
        yLabel: "% of project trips",
        height: 190,
      });
    }
  }
  // (3) Distance decay — trip share vs. distance from site.
  {
    const byDist = [...td.zones].sort((a, b) => a.distanceMi - b.distanceMi);
    if (byDist.length > 1) {
      drawLineChart(doc, {
        title: td.method === "analogy"
          ? "Figure — Trip Share vs. Distance from Site (Analogy Decay)"
          : td.method === "surrogate"
            ? "Figure — Trip Share vs. Distance from Site (Market-Area Decay)"
            : "Figure — Trip Share vs. Distance from Site (Gravity Decay)",
        categories: byDist.map((z) => `${z.distanceMi.toFixed(2)}`),
        values: byDist.map((z) => fin2(z.sharePct)),
        color: CHART_COLORS.line,
        yLabel: "% of project trips",
        xLabel: "distance from site (mi)",
        height: 190,
      });
    }
  }

  // --- Assignment sub-block (only when assignmentNumber is provided) ---
  const intersections: any[] = opts.intersections ?? result?.affectedIntersections ?? [];
  const assignRows = intersections.filter((it) => Number.isFinite(Number(it?.addedTripsPmPeak)));
  // FL byte-identity: origin/main (pdf-export.ts:7814) emits the "6.2 Project
  // Trip Assignment" heading UNCONDITIONALLY (outside the assignRows guard), then
  // only the table when rows exist. For flavor "fl" reproduce that: emit the
  // heading whenever assignmentNumber is set, and gate ONLY the table + caption
  // on assignRows.length > 0. For the generic flavor, keep the combined guard.
  if (isFl && opts.assignmentNumber) {
    opts.headingFn(doc, `${opts.assignmentNumber} Project Trip Assignment`);
  }
  if (opts.assignmentNumber && assignRows.length > 0) {
    if (!isFl) {
      opts.headingFn(doc, `${opts.assignmentNumber} Project Trip Assignment`);
    }
    const totalPm = assignRows.reduce((s, it) => s + (Number(it.addedTripsPmPeak) || 0), 0) || 1;
    const periods: any[] = opts.periods ?? result?.periodReports ?? [];
    const amRep = periods.find((p) => p?.period === "am_peak");
    const amBySig = new Map<string, number>(
      (Array.isArray(amRep?.affectedIntersections) ? amRep.affectedIntersections : []).map(
        (it: any) => [String(it.signalId), Number(it.addedTripsPmPeak) || 0],
      ),
    );
    const dirBySig = new Map<string, string>(
      td.zones.map((z) => [String(z.id), String(z.cardinal ?? "—")]),
    );
    table(doc, {
      headers: ["Study intersection", "Dir.", "Distance (mi)", "AM trips", "PM trips", "Share of project"],
      widths: [190, 45, 75, 65, 65, 80],
      align: ["left", "center", "right", "right", "right", "right"],
      rows: assignRows.map((it: any) => {
        const pm = Number(it.addedTripsPmPeak) || 0;
        const am = amBySig.get(String(it.signalId));
        return [
          it.name ?? it.signalId ?? "—",
          dirBySig.get(String(it.signalId)) ?? "—",
          fmtNum(it.distanceMi, 2),
          am == null ? "—" : fmtNum(am),
          fmtNum(pm),
          `${((pm / totalPm) * 100).toFixed(1)}%`,
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      isFl
        ? FL_ASSIGNMENT_CAPTION
        : "Project trips assigned to each study intersection from the distribution shares above: a four-step gravity model sets the share reaching each intersection from its attraction mass and its distance from the site. Directional load multipliers are a Florida (Caltran) refinement and are not applied in this region — each intersection's loading is taken directly from the gravity weights above.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  } finally {
    // Always restore the palette flag so a UK render never leaks the Velocity
    // green into a subsequent non-UK section rendered by the same process.
    velocityPaletteActive = prevVelocity;
  }
}
