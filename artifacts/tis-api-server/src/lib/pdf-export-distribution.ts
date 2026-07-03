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
// The shared section is NEVER used in London, so the Velocity palette is off.
const velocityPaletteActive = false as boolean;
const VELOCITY_FILL = "#ECF5E9";
const VELOCITY_GREEN = "#8EC57C";
const TEXT_GRAY = "#6b7280";

const fin2 = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
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
   *  "generic" (default) → the region-neutral wording for the new sections. */
  flavor?: "fl" | "generic";
};

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
        : "Project trips assigned to each study intersection from the distribution shares above: the directional shares orient the loading toward the high-share sectors, distance-decayed to each approach.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
}
