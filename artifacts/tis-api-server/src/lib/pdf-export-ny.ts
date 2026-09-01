/**
 * NYSDOT TIS Shell renderer — NYSDOT Highway Design Manual (HDM)
 * Chapter 5, Section 5, rev. 9/16/2014.
 *
 * Sibling file (not folded into pdf-export.ts) so concurrent edits to
 * the main file by other agents don't risk losing this renderer. The
 * helper primitives (section heading, table, rows, metric strip,
 * fmtNum) are duplicated here intentionally to keep the file
 * self-contained and free of cross-file coupling that would break
 * under merge conflicts.
 *
 * The Shell prescribes a four-section structure that NY PEs / PTOEs
 * recognize on sight: (1) Summary of Traffic Impacts, (2) Travel
 * Speeds, (3) Capacity Analysis (with 3.1 Growth Rates · 3.2 Existing
 * AADT/DHV · 3.3 Traffic Control Device Data · 3.4 Existing No-Build
 * Capacity · 3.5 Proposed Build Capacity · 3.6 Capacity Improvement
 * Measures), (4) Crash Analysis, plus Appendices A–D. The multi-year-
 * horizon AADT/DHV table (Existing / ETC / ETC+20 / ETC+30) is the
 * single strongest "this is NYSDOT-shaped" signal.
 *
 * Crash data ships in three tiers, all fail-soft: county-level 3-year
 * totals from the NY State Police dataset (r.nyCrashSummary), NYC
 * site-radius precise records from OpenData h9gi-nx95
 * (r.nyPreciseCrashSummary), and the statewide NHTSA FARS fatal-crash
 * supplement (r.farsKSummary). The remaining gap is Tier-2 statewide
 * per-intersection exposure (NYSDOT TSSR/CLEAR), which is gated on
 * Regional Traffic Office access — until then upstate sites carry the
 * county aggregate plus FARS, and §4 falls back to the Shell's
 * escape-hatch language only when every ingest returns nothing.
 */
import type { Region } from "./regions";
import { renderDiurnalCharts } from "./pdf-charts";
import { getCbdtpStatus, type CbdtpStatus, type Gml239Status } from "./nysdot-data";
import type { NycTransitContext } from "./nyc-transit-data";
import { getMeasuredGrowthRate } from "./regional-growth-rates";
import { renderAtrMeasuredVolumes } from "./atr-measured-volumes";
import { renderTripDistributionSection } from "./pdf-export-distribution";
import { renderLaneGroupQueues } from "./lane-group-queues";

type StoredProject = {
  id: string;
  studyType: string;
  projectName: string;
  landUseCode: string;
  siteLat: string | null;
  siteLon: string | null;
  version: number;
  createdAt: Date;
  requestPayload: unknown;
  resultPayload: unknown;
};

const PAGE_MARGIN = 50;
const BRAND_BLUE = "#2563eb";
const TEXT_GRAY = "#6b7280";

// ---- Layout primitives (duplicated from pdf-export.ts intentionally;
// see file-level docstring) -------------------------------------------------

function nySection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(13).fillColor("black").text(title, { characterSpacing: 0.5 });
  doc.moveDown(0.3);
  doc.x = PAGE_MARGIN;
}

function nySubsection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(11).fillColor("black").text(title);
  doc.moveDown(0.2);
  doc.x = PAGE_MARGIN;
}

function nyRows(doc: PDFKit.PDFDocument, pairs: [string, string | undefined][]) {
  const labelW = 220;
  const startX = PAGE_MARGIN;
  doc.x = startX;
  const valueW = doc.page.width - startX - labelW - PAGE_MARGIN - 10;
  for (const [label, value] of pairs) {
    const y = doc.y;
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(label, startX, y, { width: labelW, continued: false });
    doc.font("body").fontSize(10).fillColor("black").text(value ?? "—", startX + labelW + 10, y, { width: valueW });
    doc.moveDown(0.05);
  }
  doc.x = PAGE_MARGIN;
}

type NyTableSpec = {
  headers: string[];
  widths: number[];
  align?: Array<"left" | "right" | "center">;
  rows: string[][];
};

function nyTable(doc: PDFKit.PDFDocument, spec: NyTableSpec) {
  const { headers, widths, rows: dataRows } = spec;
  const align = spec.align ?? headers.map(() => "left" as const);
  const startX = PAGE_MARGIN;
  const rowH = 16;
  const headerH = 18;
  const drawRow = (cells: string[], y: number, isHeader: boolean) => {
    let x = startX;
    if (isHeader) {
      doc.rect(startX, y, widths.reduce((s, w) => s + w, 0), headerH).fill("#f3f4f6");
    }
    for (let i = 0; i < cells.length; i++) {
      const w = widths[i] ?? 60;
      const a = align[i] ?? "left";
      doc.font(isHeader ? "bold" : "body")
        .fontSize(9)
        .fillColor("black")
        .text(cells[i] ?? "", x + 4, y + (isHeader ? 5 : 3), {
          width: w - 8,
          align: a,
          lineBreak: false,
          ellipsis: true,
        });
      x += w;
    }
  };
  let y = doc.y;
  drawRow(headers, y, true);
  y += headerH;
  for (const r of dataRows) {
    if (y + rowH > doc.page.height - PAGE_MARGIN - 40) {
      doc.addPage();
      y = doc.y;
      drawRow(headers, y, true);
      y += headerH;
    }
    drawRow(r, y, false);
    doc.strokeColor("#e5e7eb").lineWidth(0.5)
      .moveTo(startX, y + rowH).lineTo(startX + widths.reduce((s, w) => s + w, 0), y + rowH).stroke();
    y += rowH;
  }
  doc.y = y + 4;
  doc.x = PAGE_MARGIN;
}

type NyMetric = { label: string; value: string };

function nyMetricStrip(doc: PDFKit.PDFDocument, metrics: NyMetric[]) {
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const cellW = usableW / metrics.length;
  const startX = PAGE_MARGIN;
  const y = doc.y;
  const h = 50;
  for (let i = 0; i < metrics.length; i++) {
    const x = startX + i * cellW;
    doc.rect(x, y, cellW, h).fillAndStroke("#f9fafb", "#e5e7eb");
    doc.font("bold").fontSize(20).fillColor(BRAND_BLUE).text(metrics[i].value, x, y + 8, { width: cellW, align: "center" });
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(metrics[i].label.toUpperCase(), x, y + 32, { width: cellW, align: "center", characterSpacing: 1 });
  }
  doc.fillColor("black");
  doc.x = startX;
  doc.y = y + h + 4;
}

function fmtNum(n: any, decimals: number = 0): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const num = Number(n);
  return decimals > 0 ? num.toFixed(decimals) : Math.round(num).toLocaleString();
}

// ---- NYSDOT-Region resolver ----------------------------------------------

export type NysdotRegion = {
  num: number;
  /** "Region 11 — New York City" — for cover and §3.1 prose. */
  label: string;
  /** Regional Planning Group convention name for growth-rate citation. */
  planningGroup: string;
};

/**
 * Resolve the NYSDOT Region number (1–11) for a NY site. NYSDOT splits
 * the state into 11 regions for design and planning; the Regional
 * Planning Group's growth-rate convention can override the statewide
 * defaults (Interstate/ramps 1.7%/yr per NYSDOT Data Services Bureau,
 * all other roads 2%/yr per Regional Planning Group). Bounding boxes
 * are rough — accurate enough for prose adaptation; not authoritative.
 */
// Exported for scripts/verify-long-island-coverage.mjs — the Queens/Nassau
// line is asserted against the real implementation, not a copy of the rule.
export function nysdotRegion(lat: number, lon: number, region: Region): NysdotRegion {
  const code = region.code;
  if (code === "buffalo_metro") return { num: 5, label: "Region 5 — Buffalo / Western New York", planningGroup: "GBNRTC (Greater Buffalo-Niagara Regional Transportation Council)" };
  if (code === "rochester_ny_metro") return { num: 4, label: "Region 4 — Rochester / Genesee Valley", planningGroup: "GTC (Genesee Transportation Council)" };
  if (code === "syracuse_metro") return { num: 3, label: "Region 3 — Syracuse / Central New York", planningGroup: "SMTC (Syracuse Metropolitan Transportation Council)" };
  if (code === "albany_metro") return { num: 1, label: "Region 1 — Capital District", planningGroup: "CDTC (Capital District Transportation Committee)" };
  if (code === "new_york_metro") {
    // Region 8 (Hudson Valley) — Westchester, Rockland, Putnam, Orange,
    // Dutchess, Ulster, Sullivan, Columbia. The Bronx's northernmost edge
    // sits at lat ~40.92; anything north of that within the new_york_metro
    // bounding box belongs to Region 8. Without this branch, Westchester
    // sites (e.g. Rye 40.985, -73.683) get labeled Region 11 — the
    // DTS Provident / HVEA cold-outreach pitch is built on accurate
    // Hudson Valley framing, so misclassifying here would be a
    // credibility hit on the demo.
    if (lat >= 40.92) {
      return { num: 8, label: "Region 8 — Hudson Valley", planningGroup: "NYMTC (New York Metropolitan Transportation Council)" };
    }
    // Region 10 (Long Island) — Nassau + Suffolk, below the Westchester
    // line. The Queens/Nassau border runs near -73.70 in the north (Elmont,
    // Floral Park) and -73.74 in the south (Valley Stream), so no single
    // vertical line is exact; -73.73 is the best constant fit. The old
    // -73.83 was far enough west to label Jamaica, St. Albans, Queens
    // Village, Cambria Heights and Rosedale as Long Island when NYSDOT puts
    // all five in Region 11. Residual error is a ~0.015 deg sliver of
    // easternmost Queens (Bellerose, Glen Oaks), which the border genuinely
    // interleaves with Nassau — see the note above: these boxes are rough,
    // accurate enough for prose adaptation, not authoritative.
    if (lon > -73.73) {
      return { num: 10, label: "Region 10 — Long Island", planningGroup: "NYMTC (New York Metropolitan Transportation Council)" };
    }
    // Default: Region 11 (NYC five boroughs).
    return { num: 11, label: "Region 11 — New York City", planningGroup: "NYMTC (New York Metropolitan Transportation Council)" };
  }
  return { num: 0, label: "NYSDOT Region (to be confirmed)", planningGroup: "Regional Planning Group (to be confirmed)" };
}

/**
 * LOS-threshold tables. Shell §3 requires these three blocks
 * (signalized / unsignalized / freeway) so a reviewer can verify the
 * engine is calibrated against the same thresholds NYSDOT reviewers
 * use. Values are the conventional US control-delay / density bands as
 * republished in publicly-available state DOT design manuals (incl.
 * NYSDOT HDM); no licensed exhibit text is reproduced.
 */
function nyLosThresholdTables(doc: PDFKit.PDFDocument) {
  doc.font("bold").fontSize(10).fillColor("black").text("Signalized intersections — conventional US control-delay bands, sec/veh (as republished in state DOT design manuals); any v/c > 1.0 is F.");
  doc.moveDown(0.2);
  nyTable(doc, {
    headers: ["LOS", "A", "B", "C", "D", "E", "F"],
    widths: [60, 60, 60, 60, 60, 60, 60],
    align: ["left", "center", "center", "center", "center", "center", "center"],
    rows: [["sec/veh", "≤10", "10–20", "20–35", "35–55", "55–80", ">80"]],
  });
  doc.moveDown(0.3);

  doc.font("bold").fontSize(10).fillColor("black").text("Unsignalized — 2-way stop / all-way stop / roundabout — conventional US control-delay bands, sec/veh; any v/c > 1.0 is F.");
  doc.moveDown(0.2);
  nyTable(doc, {
    headers: ["LOS", "A", "B", "C", "D", "E", "F"],
    widths: [60, 60, 60, 60, 60, 60, 60],
    align: ["left", "center", "center", "center", "center", "center", "center"],
    rows: [["sec/veh", "≤10", "10–15", "15–25", "25–35", "35–50", ">50"]],
  });
  doc.moveDown(0.3);

  doc.font("bold").fontSize(10).fillColor("black").text("Freeway basic / weaving / merge-diverge — conventional US density bands, pc/mi/ln; any component vd/c > 1.00 is F.");
  doc.moveDown(0.2);
  nyTable(doc, {
    headers: ["LOS", "A", "B", "C", "D", "E", "F"],
    widths: [60, 60, 60, 60, 60, 60, 60],
    align: ["left", "center", "center", "center", "center", "center", "center"],
    rows: [["pc/mi/ln", "≤11", "11–18", "18–26", "26–35", "35–45", ">45"]],
  });
  doc.moveDown(0.4);
}

/**
 * NYSDOT TIS Shell renderer. Matches the four-section structure of
 * NYSDOT HDM Chapter 5 §5 (rev. 9/16/2014) so the deliverable is
 * visually recognizable to a NY PE/PTOE within seconds. Engine output
 * (LOS scenarios, growth rate, mitigations, approach volumes) is
 * reshaped into Shell-conformant tables and boilerplate; §4 renders
 * the stashed crash tiers (county, NYC-precise, FARS) and only falls
 * back to the Shell's escape-hatch language when all are absent.
 */
export function renderTisNewYork(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];

  const lat = req.latitude ? Number(req.latitude) : NaN;
  const lon = req.longitude ? Number(req.longitude) : NaN;
  const nyRegion = nysdotRegion(lat, lon, region);
  // CBDTP cordon test — Manhattan south of 60th, in force from 5 Jan
  // 2025. When the site is inside or near the cordon, the renderer
  // must caveat any baseline counts that pre-date the program (CBD
  // vehicle volumes fell ~11% in the first year of operation).
  const cbdtp: CbdtpStatus = getCbdtpStatus(lat, lon);

  const openingYear = Number(req.openingYear);
  const growthYears = Number(r.growthYears ?? 0);
  const growthPct = Number(r.growthAppliedPct ?? 0);
  const currentYear = Number.isFinite(openingYear) && Number.isFinite(growthYears)
    ? openingYear - growthYears
    : NaN;
  // NYSDOT HDM K-factor convention for converting peak-hour DHV to AADT.
  // 0.10 is the statewide design default; rural and freeway facilities
  // tend higher (0.10–0.12), urban arterials slightly lower. Surfaced
  // in the §3.2 table caption so a reviewer can verify the assumption.
  const K_FACTOR = 0.10;

  // --- Cover-style body intro (PIN, framing, PE disclaimer) --------------
  doc.font("bold").fontSize(14).fillColor("black").text("TRAFFIC IMPACT STUDY FOR DOT PROJECTS", { align: "center" });
  doc.moveDown(0.2);
  doc.font("body").fontSize(11).fillColor(TEXT_GRAY).text("Prepared in Accordance With Chapter 5 of the NYSDOT Highway Design Manual (HDM)", { align: "center" });
  doc.fillColor("black");
  doc.moveDown(0.6);

  nyRows(doc, [
    ["Project name", project.projectName || "—"],
    ["PIN", "PIN xxxx.xx (to be assigned by NYSDOT)"],
    ["Project description", `${tg.landUseName ?? "Proposed development"} (${tg.size ?? "—"} ${tg.unit ?? ""}) within ${region.displayName}.`.trim()],
    ["NYSDOT Region", nyRegion.label],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Opening year (ETC)", Number.isFinite(openingYear) ? String(openingYear) : "—"],
  ]);
  doc.moveDown(0.4);

  doc.font("bold").fontSize(10).fillColor("black").text("Note:");
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "It is a violation of law for any person, unless they are acting under the direction of a licensed professional engineer, architect, landscape architect, or land surveyor, to alter an item in any way. If an item bearing the stamp of a licensed professional is altered, the altering engineer, architect, landscape architect, or land surveyor shall stamp the document and include the notation \"altered by\" followed by their signature, the date of such alteration, and a specific description of the alteration.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.2);
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text("This report is based on the NYSDOT TIS Shell revised on 9/16/2014.", { align: "center" });
  doc.fillColor("black");
  doc.moveDown(0.6);

  // --- Table of Contents -------------------------------------------------
  nySection(doc, "TABLE OF CONTENTS");
  const toc: Array<[string, string]> = [
    ["1.0  Summary of Traffic Impacts", ""],
    ["2.0  Travel Speeds", ""],
    ["3.0  Capacity Analysis", ""],
    ["       3.1  Growth Rates", ""],
    ["       3.2  Existing AADT and DHV", ""],
    ["       3.3  Traffic Control Device Data", ""],
    ["       3.4  Capacity Analysis for Existing No-Build Condition", ""],
    ["       3.5  Capacity Analysis for Proposed Build Condition", ""],
    ["       3.6  Capacity Improvement Measures", ""],
    ["       3.7  Trip Distribution and Assignment", ""],
    ["       3.8  Project Trip Assignment", ""],
    ["4.0  Crash Analysis", ""],
    ["Appendix A — Existing Volume Report", ""],
    ["Appendix B — Existing Condition Capacity Analysis Output", ""],
    ["Appendix C — Proposed Condition Capacity Analysis Output", ""],
    ["Appendix D — Crash Analysis Diagrams and Tables", ""],
  ];
  nyRows(doc, toc);
  doc.moveDown(0.4);

  // --- Project / regulatory context ---------------------------------------
  // SEQRA classification — surfaced when set on the project; default to
  // "not yet determined" so the reviewer sees the prompt. Inside NYC,
  // SEQRA findings are typically folded into the CEQR EAS/EIS package
  // rather than determined separately.
  const seqraType = typeof (project as any)?.seqraType === "string"
    ? String((project as any).seqraType)
    : null;
  const inNyc = cbdtp.inCordon || nyRegion.num === 11;
  nySection(doc, "PROJECT CONTEXT");
  doc.font("body").fontSize(10).fillColor("black");
  doc.font("bold").fontSize(10).text("NYSDOT region: ", { continued: true });
  doc.font("body").text(nyRegion.label);
  doc.font("bold").fontSize(10).text("Planning group: ", { continued: true });
  doc.font("body").text(nyRegion.planningGroup);
  doc.font("bold").fontSize(10).text("Regulatory regime: ", { continued: true });
  doc.font("body").text(
    inNyc
      ? "SEQRA (ECL Article 8 / 6 NYCRR Part 617) overlaid by CEQR (NYC Charter §192 + Mayor's EO 91; CEQR Technical Manual, December 2025 Edition, Chapter 16 Transportation)."
      : "SEQRA (ECL Article 8 / 6 NYCRR Part 617)."
  );
  doc.font("bold").fontSize(10).text("SEQRA classification: ", { continued: true });
  if (seqraType) {
    doc.font("body").text(`${seqraType} (per project record).`);
  } else {
    doc.font("body").fillColor(TEXT_GRAY).text(
      "Not yet determined — lead agency to classify as Type I (6 NYCRR Part 617.4 — likely EIS), Type II (Part 617.5 — exempt), or Unlisted (Part 617.6 — Short EAF + significance finding) before locking the TIS."
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.4);

  // --- §1.0 Summary of Traffic Impacts -----------------------------------
  nySection(doc, "1.0 SUMMARY OF TRAFFIC IMPACTS");
  doc.font("body").fontSize(10).fillColor("black");

  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  const needMitigation = intersections.filter(
    (it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none",
  );
  const mitigationSummary = needMitigation.length > 0
    ? needMitigation.slice(0, 6).map((it) => (it.mitigation ?? "").toString().trim().replace(/\.$/, "")).filter(Boolean).join("; ")
    : "";

  doc.font("bold").fontSize(11).fillColor("black").text("Capacity:");
  doc.moveDown(0.1);
  doc.font("body").fontSize(10).fillColor("black");
  if (needMitigation.length > 0 && mitigationSummary) {
    doc.text(`A capacity analysis was performed per NYSDOT Highway Design Manual Chapter 5. The following capacity improvement measures are cost effective, and are recommended to reduce reoccurring delay: ${mitigationSummary}.`, { paragraphGap: 4 });
  }
  if (losDrops === 0 && losEf === 0) {
    const losStd = "D";
    const yyLabel = Number.isFinite(openingYear) ? String(openingYear) : "____";
    doc.text(`The proposed project will maintain an acceptable Level of Service of ${losStd} or better in design year ${yyLabel}.`, { paragraphGap: 4 });
  }
  if (losEf > 0 && needMitigation.length === 0) {
    doc.text("The project includes segments that will be below the minimum Level of Service, however it is not feasible (not cost effective) to implement capacity improvements as part of this project. See Section 3.0 for more details.", { paragraphGap: 4 });
  }
  doc.moveDown(0.2);

  doc.font("bold").fontSize(11).fillColor("black").text("Crash:");
  doc.moveDown(0.1);
  // Summarize what §4.0 actually found rather than asserting the
  // screening passed — the old hardcoded "met all of the required
  // steps" sentence shipped regardless of the crash ingests' results.
  {
    const s1Precise = (r as any).nyPreciseCrashSummary;
    const s1County = (r as any).nyCrashSummary;
    const bits: string[] = [];
    if (s1Precise?.totalCrashes > 0) {
      bits.push(`${fmtNum(s1Precise.totalCrashes)} crashes within 0.25 mi of the site over the ${s1Precise.windowYears}-year window (NYC OpenData h9gi-nx95)`);
    }
    if (s1County?.totalAccidents > 0) {
      bits.push(`${fmtNum(s1County.totalAccidents)} crashes county-wide in ${s1County.countyName} County over the rolling 3-year window (NY DMV via data.ny.gov)`);
    }
    if (bits.length > 0) {
      doc.font("body").fontSize(10).fillColor("black").text(
        `A minimum three-year accident history review was performed: ${bits.join("; ")}. Section 4.0 carries the severity breakdown and HDM Chapter 5 §5.3.4 screening context; the project-specific rate comparison against NYSDOT statewide averages remains a submittal-stage task with Regional Traffic Office data.`,
        { paragraphGap: 6 },
      );
    } else {
      doc.font("body").fontSize(10).fillColor("black").text(
        "A minimum three-year accident history review was attempted; the automated crash ingests returned no records for this site (see Section 4.0). The HDM Chapter 5 §5.3.4 safety screening must be completed manually with Regional Traffic Office data before submittal.",
        { paragraphGap: 6 },
      );
    }
  }

  // CBDTP cordon caveat — surfaced in §1.0 when the site is inside or
  // adjacent to the Manhattan Central Business District Tolling
  // Program zone (in force from 5 January 2025). The caveat governs
  // any baseline-counts vintage discussion downstream in §3.2.
  if (cbdtp.inCordon || cbdtp.nearCordon) {
    doc.font("bold").fontSize(11).fillColor("black").text("Congestion-pricing context (CBDTP):");
    doc.moveDown(0.1);
    doc.font("body").fontSize(10).fillColor("black").text(
      cbdtp.inCordon
        ? "The site is within the Central Business District Tolling Program (CBDTP) cordon — Manhattan south of 60th Street, in force from 5 January 2025. The CBDTP is the first cordon-pricing program in the United States; first-year independent analyses (RPA, NBER, 2025–2026) report a ~11% drop in CBD vehicle volumes and a 15–25% rise in CBD vehicle speeds. Any TIS baseline drawn from pre-2025 NYSDOT or NYC DOT counts within the cordon will systematically overstate today's vehicle baseline; supplemental post-CBDTP counts at the affected intersections are recommended before the TIS is locked, and the No-Build assignment for opening years after 2025 should be drawn from post-CBDTP counts rather than interpolated from the pre-2025 trend. See §3.2 for the per-intersection count-vintage caveat."
        : `The site is within approximately ${cbdtp.bufferMiles} mile of the Central Business District Tolling Program (CBDTP) cordon (Manhattan south of 60th Street, in force from 5 January 2025). Generated trips that route through the cordon will be subject to the toll schedule; the project's mode-share assumptions for vehicle-vs-transit-vs-rideshare should reflect the CBDTP-era distribution rather than pre-2025 conditions. Baseline counts on study-area corridors that feed into the cordon may also reflect the program's first-year impact (CBD volumes fell ~11%) — see §3.2 for the count-vintage caveat.`,
      { paragraphGap: 6 },
    );
  }

  // GML §239-m / §239-n referral test — surfaced when the site sits
  // within 500 ft of a state or county road (outside NYC; NYC sites
  // use ULURP / CEQR instead). The lookup is done in renderStudyPdf
  // before this renderer is called and stashed at r.nyGml239Status.
  const gml239: Gml239Status | null =
    !inNyc && r && typeof r === "object" && r.nyGml239Status
      ? (r.nyGml239Status as Gml239Status)
      : null;
  if (gml239?.required) {
    doc.font("bold").fontSize(11).fillColor("black").text(
      "GML §239-m / §239-n county planning board referral required:",
    );
    doc.moveDown(0.1);
    doc.font("body").fontSize(10).fillColor("black").text(
      `The site is within ${gml239.bufferFeet} ft of ${gml239.triggeringRoadway ? `${gml239.triggeringRoadway} (${gml239.triggeringClass})` : "a state or county classified roadway"}, which triggers mandatory referral to the controlling county planning board under General Municipal Law §239-m (site-plan / special-permit / variance / zoning amendment) or §239-n (subdivision review) before the local board may act. The county may make adverse findings under §239-f; the local board can override only by supermajority. Practical TIS consequence: the county will typically request the TIS in full as part of the §239 referral package — pre-application coordination with the county planning agency is recommended.`,
      { paragraphGap: 6 },
    );
  } else if (!inNyc && r?.nyGml239Status !== undefined) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "GML §239 referral: no state or county classified roadway was identified within 500 ft of the site via the NYSDOT RDM FeatureServer. The lead agency should still verify against the county's locally-adopted §239 mapping (some counties extend referral to additional facilities — e.g. county-designated scenic byways).",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // NYC transit + active-mode context — surfaced when inside the five
  // boroughs. Stations within 0.5 mi establish the site's transit
  // accessibility (the CEQR Ch 16 walk-shed) and the nearest bike
  // counter anchors any subsequent active-mode analysis.
  const transit: NycTransitContext | null =
    inNyc && r && typeof r === "object" && r.nyTransitContext
      ? (r.nyTransitContext as NycTransitContext)
      : null;
  if (transit && (transit.subway.stations.length > 0 || transit.bike.nearest)) {
    doc.font("bold").fontSize(11).fillColor("black").text("Transit and active-mode context:");
    doc.moveDown(0.1);
    if (transit.subway.stations.length > 0) {
      const nStations = transit.subway.stations.length;
      const nRoutes = transit.subway.routesAvailable.length;
      const closest = transit.subway.stations[0];
      const routeBuckets = transit.subway.routesAvailable.slice(0, 12).join(" · ");
      doc.font("body").fontSize(10).fillColor("black").text(
        `${nStations} MTA subway station${nStations === 1 ? "" : "s"} within ${transit.subway.radiusMi.toFixed(2)} mi of the site, providing access to ${nRoutes} daytime route${nRoutes === 1 ? "" : "s"} (${routeBuckets}${transit.subway.routesAvailable.length > 12 ? " …" : ""}). Closest: ${closest.name} (${closest.distanceMi.toFixed(2)} mi, ${closest.routes || "—"}). Source: MTA Subway Stations (data.ny.gov resource 39hk-dx4f). The CEQR Tech Manual Ch 16 walk-shed convention is 0.5 mi from the site centroid.`,
        { paragraphGap: 4 },
      );
    } else {
      doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
        `No MTA subway station within ${transit.subway.radiusMi.toFixed(2)} mi of the site. Site is transit-served by NYCT bus and the controlling NYC DOT corridor — verify route coverage at scoping.`,
        { paragraphGap: 4 },
      );
      doc.fillColor("black");
    }
    if (transit.bike.nearest) {
      doc.font("body").fontSize(10).fillColor("black").text(
        `Nearest NYC DOT bicycle counter: ${transit.bike.nearest.name} (${transit.bike.nearest.distanceMi.toFixed(2)} mi). ${transit.bike.countWithin} counter${transit.bike.countWithin === 1 ? "" : "s"} within ${transit.bike.radiusMi.toFixed(2)} mi total. Source: NYC OpenData Bicycle Counters (smn3-rzf9). The counter provides a reference cyclist-volume baseline for the §C.3 pedestrian/bicycle analysis under CEQR Ch 16.`,
        { paragraphGap: 6 },
      );
    } else {
      doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
        `No NYC DOT automated bicycle counter within ${transit.bike.radiusMi.toFixed(2)} mi of the site. Bicycle analysis (where required) should rely on field-collected counts.`,
        { paragraphGap: 6 },
      );
      doc.fillColor("black");
    }
  }

  nyMetricStrip(doc, [
    { label: "Intersections", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "LOS drops", value: String(losDrops) },
    { label: "At LOS E/F", value: String(losEf) },
    { label: "Worst Δ delay", value: `${(r.worstDelayDeltaSec ?? 0).toFixed(1)}s` },
  ]);
  doc.moveDown(0.6);

  // --- §2.0 Travel Speeds ------------------------------------------------
  nySection(doc, "2.0 TRAVEL SPEEDS");
  // Tier-1 enrichment: posted speeds are auto-ingested from the NYSDOT
  // RDM_Roadway_Current FeatureServer (see lib/nysdot-data.ts) before
  // this renderer is called. The 85th-percentile column REMAINS field-
  // required — NYSDOT does not publish speed-study data; per project-
  // specific radar / floating-car study per HDM Chapter 5 §5.2.
  const nyEnriched = intersections.filter((it) =>
    typeof it.nysdotPostedSpeedMph === "number" || typeof it.nysdotRoadwayName === "string"
  );
  if (nyEnriched.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Per NYSDOT HDM Chapter 5 §5.2, posted speed limits and actual operating speeds (85th-percentile) along the study network are reported below. Posted-speed-limit values in the third column are auto-ingested from the NYSDOT Roadway Data Management (RDM) FeatureServer (https://gis.dot.ny.gov/hostingny/rest/services/Roadways/RDM_Roadway_Current/FeatureServer) at PDF-generation time — the same source data viewable through the NYSDOT Traffic Data Viewer (https://gis.dot.ny.gov/html5viewer/?viewer=tdv). Operating speeds (85th-percentile) are NOT published by NYSDOT and require a project-specific radar / floating-car speed study.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      "Per NYSDOT HDM Chapter 5 §5.2, posted speed limits and actual operating speeds (85th-percentile) along the study network are reported below. Speed data should be sourced from the NYSDOT Traffic Data Viewer (https://gis.dot.ny.gov/html5viewer/?viewer=tdv) or field-collected radar / floating-car study. (Auto-ingest from the NYSDOT RDM FeatureServer was attempted but returned no matching records — verify intersection coordinates and re-run, or fall through to manual TDV lookup.)",
      { paragraphGap: 6 },
    );
  }

  if (intersections.length > 0) {
    nyTable(doc, {
      headers: ["Street", "Functional class", "Posted speed", "85th-pctile operating speed"],
      widths: [140, 180, 80, 120],
      align: ["left", "left", "center", "center"],
      rows: intersections.slice(0, 6).map((it) => {
        const intName = String(it.name ?? it.signalId ?? "—").split(/[@&]|\s+at\s+/i)[0].trim() || "—";
        const ingestedName = typeof it.nysdotRoadwayName === "string" ? it.nysdotRoadwayName : null;
        const street = ingestedName
          ? `${intName} (${ingestedName})`
          : intName;
        const fc = typeof it.nysdotFunctionalClass === "string"
          ? it.nysdotFunctionalClass
          : "Refer to NYSDOT TDV";
        const ps = typeof it.nysdotPostedSpeedMph === "number"
          ? `${it.nysdotPostedSpeedMph} mph`
          : ingestedName
            ? "Not posted (local)"
            : "—";
        return [street, fc, ps, "Speed study required"];
      }),
    });
  } else {
    nyTable(doc, {
      headers: ["Street", "Functional class", "Posted speed", "85th-pctile operating speed"],
      widths: [140, 180, 80, 120],
      align: ["left", "left", "center", "center"],
      rows: [["—", "Speed study required per NYSDOT HDM Chapter 5 §5.2; refer to NYSDOT Traffic Data Viewer.", "—", "—"]],
    });
  }
  doc.moveDown(0.4);

  // --- §3.0 Capacity Analysis --------------------------------------------
  nySection(doc, "3.0 CAPACITY ANALYSIS");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Capacity analyses in this report use the SimpleImpactStudies screening solver — a per-approach control-delay model built on the openly-published Webster uniform-delay and Akçelik overflow formulations — reported against the conventional US control-delay bands. Synchro / SimTraffic, HCS, Sidra, or VISSIM may be substituted for formal submittal per NYSDOT Regional Traffic Office preference.",
    { paragraphGap: 6 },
  );
  // Functional-class summary — counts of each NYSDOT functional class
  // represented in the study network, drawn from the nysdot* fields
  // attached during the RDM enrichment pass. Gives the reviewer a
  // one-glance read on whether the study network is freeway-dominant
  // (K/D defaults skew higher), arterial-dominant (standard K/D), or
  // collector/local-dominant (lower K/D).
  const fcCounts = new Map<string, number>();
  for (const it of intersections) {
    const fc = typeof it.nysdotFunctionalClass === "string" ? it.nysdotFunctionalClass : null;
    if (!fc) continue;
    fcCounts.set(fc, (fcCounts.get(fc) ?? 0) + 1);
  }
  if (fcCounts.size > 0) {
    const sorted = Array.from(fcCounts.entries()).sort((a, b) => b[1] - a[1]);
    const summary = sorted.map(([fc, n]) => `${fc} (${n})`).join("; ");
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      `Study network functional-class composition (per NYSDOT RDM): ${summary}. NYSDOT functional class drives access management expectations under HDM Appendix 5A (entrance standards for state highways) and the default K-factor banding under HDM §5.3.`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.font("body").fontSize(10).fillColor("black").text(
    "Level of Service thresholds applied below are the conventional US control-delay and density bands for signalized, unsignalized (2-way stop / all-way stop / roundabout), and freeway facilities, as republished in publicly-available state DOT design manuals. Any component v/c > 1.0 is LOS F regardless of delay or density.",
    { paragraphGap: 6 },
  );
  nyLosThresholdTables(doc);

  // §3.1 Growth Rates
  nySubsection(doc, "3.1 Growth Rates");
  const measured = getMeasuredGrowthRate(region.code);
  if (measured) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Background traffic growth is applied at ${growthPct || "—"}% per year over ${growthYears || "—"} year${growthYears === 1 ? "" : "s"}. This rate is the per-station median CAGR measured from the NYSDOT Traffic Monitoring AADT FeatureServer for ${nyRegion.label}: ${measured.growthPct.toFixed(2)}%/yr median across ${measured.stations.toLocaleString()} count stations (rolling actual-count window approximately ${measured.yearFrom}-${measured.yearTo}; 25th-75th percentile range ${measured.p25Pct.toFixed(2)}% to ${measured.p75Pct.toFixed(2)}%). The measured value supersedes the NYSDOT statewide default fallbacks (per HDM Chapter 5: 1.7%/yr Interstate + ramps from the Data Services Bureau, 2.0%/yr all other roads from the Regional Planning Group). The controlling Regional Planning Group ${nyRegion.planningGroup} may have separately-adopted growth-rate guidance that overrides the measured median for formal submittal — confirm at scoping.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Background traffic growth is applied at ${growthPct || "—"}% per year over ${growthYears || "—"} year${growthYears === 1 ? "" : "s"}. NYSDOT statewide default fallbacks (per HDM Chapter 5) are 1.7%/yr for Interstate and ramp facilities (NYSDOT Data Services Bureau) and 2.0%/yr for all other roads (Regional Planning Group). For ${nyRegion.label}, the controlling Regional Planning Group is ${nyRegion.planningGroup}; its current adopted growth-rate guidance overrides the statewide default and should be confirmed for formal submittal.`,
      { paragraphGap: 6 },
    );
  }

  // §3.2 Existing AADT and DHV — multi-year horizon table.
  nySubsection(doc, "3.2 Existing AADT and DHV");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Existing AADT is sourced from the NYSDOT Traffic Data Viewer. Design Hourly Volume (DHV) is reported per HDM Chapter 5 convention as AADT × K-factor; this analysis applies K = ${K_FACTOR.toFixed(2)} as the statewide design default — facility-specific K should be substituted from NYSDOT count-station records for formal submittal. The table below grows the existing volume at ${growthPct || "—"}%/yr to Estimated Time of Completion (ETC), ETC + 20 years, and ETC + 30 years per HDM Chapter 5 §5.3.`,
    { paragraphGap: 6 },
  );

  // CBDTP count-vintage caveat — surfaced when the site sits in or
  // adjacent to the Manhattan cordon, where pre-Jan-2025 NYSDOT /
  // NYC DOT counts overstate today's vehicle baseline.
  if (cbdtp.inCordon || cbdtp.nearCordon) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      cbdtp.inCordon
        ? "Count-vintage caveat — CBDTP: existing volumes drawn from NYSDOT TDV or NYC DOT counts predating 5 January 2025 systematically overstate the post-cordon baseline (CBD vehicle volumes fell ~11% in the program's first year; CBD vehicle speeds rose 15-25%). For any intersection inside the cordon, the existing baseline should be replaced with a post-CBDTP count (manual classified count or NYC DOT post-Jan-2025 publish) before the analysis is locked. Where pre-2025 counts are retained as a placeholder, the renderer's growth-rate projection compounds the pre-cordon level into the future — i.e. the No-Build and Build columns will both be systematically high. Reviewer-facing flag noted."
        : `Count-vintage caveat — CBDTP feeder: this site lies within approximately ${cbdtp.bufferMiles} mile of the CBDTP cordon. Baseline counts on corridors that feed into the cordon may reflect the program's first-year ~11% volume reduction; vintage of each NYSDOT TDV count station used in the table below should be verified against the 5 January 2025 program date.`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  const projectVol = (v: number, yearsAhead: number) => v * Math.pow(1 + (growthPct / 100), yearsAhead);

  if (intersections.length > 0 && Number.isFinite(openingYear)) {
    const yrExisting = Number.isFinite(currentYear) ? String(currentYear) : "Existing";
    const yrEtc = String(openingYear);
    const yrEtc20 = String(openingYear + 20);
    const yrEtc30 = String(openingYear + 30);
    nyTable(doc, {
      headers: [
        "Intersection",
        `${yrExisting}\nAADT`,
        `${yrExisting}\nDHV`,
        `${yrEtc} (ETC)\nAADT`,
        `${yrEtc} (ETC)\nDHV`,
        `${yrEtc20}\nAADT`,
        `${yrEtc20}\nDHV`,
        `${yrEtc30}\nAADT`,
        `${yrEtc30}\nDHV`,
      ],
      widths: [110, 50, 45, 55, 45, 50, 45, 50, 45],
      align: ["left", "right", "right", "right", "right", "right", "right", "right", "right"],
      rows: intersections.map((it) => {
        const approaches: any[] = Array.isArray(it.approaches) ? it.approaches : [];
        const dhvExisting = approaches.reduce((s, a) => s + Number(a.currentVolumeVph ?? 0), 0);
        const aadtExisting = dhvExisting / K_FACTOR;
        return [
          String(it.name ?? it.signalId ?? "—"),
          fmtNum(aadtExisting),
          fmtNum(dhvExisting),
          fmtNum(projectVol(aadtExisting, growthYears || 0)),
          fmtNum(projectVol(dhvExisting, growthYears || 0)),
          fmtNum(projectVol(aadtExisting, (growthYears || 0) + 20)),
          fmtNum(projectVol(dhvExisting, (growthYears || 0) + 20)),
          fmtNum(projectVol(aadtExisting, (growthYears || 0) + 30)),
          fmtNum(projectVol(dhvExisting, (growthYears || 0) + 30)),
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      `Source: AADT estimated from engine peak-hour entering-volume sum via K = ${K_FACTOR.toFixed(2)}. NYSDOT Traffic Data Viewer measured AADT is recommended for submittal. Projection applies the ${growthPct || "—"}%/yr background growth rate compounded annually.`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No affected intersections within the study radius — no AADT/DHV horizon table is reportable. NYSDOT Traffic Data Viewer review is recommended for any adjacent state-system route in the project vicinity.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  // §3.2 supplement — NYC DOT ATR measured volumes when available.
  // Populated in renderStudyPdf by atrSegmentsNearPoint() and stashed
  // on result.nycAtrSummary. When present, the block replaces the
  // K-factor-derived DHV with measured peak-hour volumes from real
  // ATR counts; engineers can cross-check the AADT table above
  // against the measured peaks. The block omits silently when no ATR
  // coverage exists near the site (NYC DOT counts a rotating sample,
  // not the full grid).
  // Prefer the generic field; fall back to the NY-named one so studies stored
  // before the multi-source change keep rendering their ATR block.
  const atrSummary = ((r as any).atrSummary ?? (r as any).nycAtrSummary) as
    | {
        windowYears: number;
        radiusMi: number;
        segments: Array<{
          segmentId: string;
          street: string | null;
          fromStreet: string | null;
          toStreet: string | null;
          direction: string;
          distanceMi: number;
          latestCountDate: string;
          sampleDays: number;
          amPeakHourVph: number | null;
          pmPeakHourVph: number | null;
          avgDailyVeh: number | null;
        }>;
        source: string;
        totalSegmentsFound: number;
      }
    | undefined;

  // ⚠️ The block below names NYC DOT and its dataset id in the prose, which is
  // only true for the NYC feed. Upstate NY (Rochester/Buffalo/Syracuse/Albany)
  // is backed by FHWA TMAS, and rendering it here would have told a reviewer
  // that NYC DOT published counts for Syracuse. Anything that is not the NYC
  // feed goes through the shared, source-aware block instead.
  if (atrSummary && atrSummary.segments.length > 0 && atrSummary.source !== "nyc_dot_atr") {
    renderAtrMeasuredVolumes(doc, atrSummary, {
      headingFn: (_doc, title) => nySubsection(doc, title),
      heading: "3.2a Measured Traffic Counts (Supplemental)",
      estimateBasis: `the K-factor-derived AADT/DHV table in §3.2`,
    });
  } else if (atrSummary && atrSummary.segments.length > 0) {
    nySubsection(doc, "3.2a NYC DOT ATR Measured Volumes (Supplemental)");
    doc.font("body").fontSize(10).fillColor("black").text(
      `The §3.2 AADT/DHV table above is derived from the engine's modeled peak-hour estimate via K = ${K_FACTOR.toFixed(2)}. The block below carries Automated Traffic Recorder (ATR) volumes published by NYC DOT (data.cityofnewyork.us / 7ym2-wayt) at ${atrSummary.segments.length} count location${atrSummary.segments.length === 1 ? "" : "s"} within ${atrSummary.radiusMi.toFixed(2)} miles of the site, looking back ${atrSummary.windowYears} year${atrSummary.windowYears === 1 ? "" : "s"}. These are measured, not modeled — they should be used to validate the §3.2 estimate. NYC DOT ATR is directional segment volume, not per-approach turning movement counts; TMCs at the affected intersection${atrSummary.segments.length === 1 ? "" : "s"} must still be collected separately for formal submittal.`,
      { paragraphGap: 6 },
    );

    nyTable(doc, {
      // Widths must sum to <= 512 (612pt letter less two 50pt margins). They
      // summed to 580, which clipped the header row to "Directio n" / "Da (vp"
      // on the first study that ever had ATR rows to render.
      headers: ["Segment", "Dir.", "Dist (mi)", "Latest count", "Days", "AM peak (vph)", "PM peak (vph)", "Daily (veh/day)"],
      widths: [148, 34, 46, 62, 34, 60, 60, 68],
      align: ["left", "center", "right", "center", "right", "right", "right", "right"],
      rows: atrSummary.segments.map((s) => [
        s.street ?? "—",
        s.direction,
        s.distanceMi.toFixed(2),
        s.latestCountDate,
        String(s.sampleDays),
        s.amPeakHourVph !== null ? fmtNum(s.amPeakHourVph) : "—",
        s.pmPeakHourVph !== null ? fmtNum(s.pmPeakHourVph) : "—",
        s.avgDailyVeh !== null ? fmtNum(s.avgDailyVeh) : "—",
      ]),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      `Source: NYC DOT Automated Traffic Volume Counts (data.cityofnewyork.us / 7ym2-wayt). AM peak = max weekday hourly volume in 7:00-9:00 AM local. PM peak = max weekday hourly volume in 4:00-6:00 PM local. Daily = weekday average of 24-hour summed bins, i.e. vehicles per DAY (directly comparable to AADT, not to the vph columns). Sample-days counts unique calendar days of observation within the ${atrSummary.windowYears}-year window. Total ATR segments found within radius: ${atrSummary.totalSegmentsFound}.`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
    doc.moveDown(0.3);
  }

  // §3.3 Traffic Control Device Data
  nySubsection(doc, "3.3 Traffic Control Device Data");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Existing traffic control devices at each study-network intersection are summarized below. Signal timing data (cycle length, phase splits, offset) and per-approach detection presence should be confirmed against the controlling NYSDOT Regional Traffic Office or municipal traffic-engineering signal record for formal submittal.",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    nyTable(doc, {
      headers: ["Intersection", "Control type", "Approaches w/ detection"],
      widths: [240, 140, 140],
      align: ["left", "left", "center"],
      rows: intersections.map((it) => [
        String(it.name ?? it.signalId ?? "—"),
        String(it.controlType ?? "Signal (controlling RTO to confirm)"),
        "Field verification required",
      ]),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No affected intersections within the study radius — no traffic control device inventory is reportable.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  // §3.4 Existing No-Build Capacity Analysis
  nySubsection(doc, "3.4 Capacity Analysis for Existing No-Build Condition");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Existing No-Build conditions reflect current-year peak-hour volumes (no growth, no project trips). Existing measured volumes are grown to opening year ${Number.isFinite(openingYear) ? openingYear : "—"} at ${growthPct || "—"}%/yr to establish the No-Build baseline for §3.5 comparison.`,
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    nyTable(doc, {
      headers: ["Intersection", "Existing LOS", "Existing delay (s)", "No-Build LOS", "No-Build delay (s)", "v/c"],
      widths: [195, 65, 75, 65, 75, 45],
      align: ["left", "center", "right", "center", "right", "right"],
      rows: intersections.map((it) => [
        String(it.name ?? it.signalId ?? "—"),
        String(it.currentLos ?? it.existingLos ?? "—"),
        fmtNum(it.currentDelaySec ?? it.existingDelaySec, 1),
        String(it.existingLos ?? "—"),
        fmtNum(it.existingDelaySec, 1),
        fmtNum(it.existingVc, 2),
      ]),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No signalized intersections within the study radius.", { paragraphGap: 6 });
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  // §3.5 Proposed Build Capacity Analysis
  renderDiurnalCharts(doc, r);

  nySubsection(doc, "3.5 Capacity Analysis for Proposed Build Condition");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Build conditions add the project's external peak-hour trips (${tg.pmPeakTrips ?? "—"} PM peak, ${tg.pmIn ?? 0} inbound / ${tg.pmOut ?? 0} outbound) to the No-Build baseline at each affected intersection. Per HDM Chapter 5, intersection projects should also analyze each adjacent intersection plus any signal within ½ mile of the project site if expected left-turn volume changes materially affect capacity. The engine's network is determined by a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile screening radius; manual scoping should confirm the ½-mile left-turn rule is satisfied.`,
    { paragraphGap: 6 },
  );
  const nyHasDesignYear = intersections.some(
    (it: any) => it.designNoBuildLos != null || it.designBuildLos != null,
  );
  if (intersections.length > 0 && nyHasDesignYear) {
    // NYSDOT HDM Ch. 5 expects ETC + ETC+20 capacity analysis to mirror
    // the multi-horizon AADT/DHV table. When the engine produced
    // design-year scenarios, show all four LOS columns.
    nyTable(doc, {
      headers: ["Intersection", "ETC No-Build", "ETC Build", "ETC+20 NB", "ETC+20 Bld", "Δ delay (s)"],
      widths: [180, 70, 70, 70, 70, 65],
      align: ["left", "center", "center", "center", "center", "right"],
      rows: intersections.map((it: any) => {
        const losChanged = it.losChanged === true;
        return [
          String(it.name ?? it.signalId ?? "—"),
          String(it.existingLos ?? "—"),
          (losChanged ? "▲ " : "") + String(it.futureLos ?? "—"),
          String(it.designNoBuildLos ?? "—"),
          String(it.designBuildLos ?? "—"),
          fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
        ];
      }),
    });
  } else if (intersections.length > 0) {
    nyTable(doc, {
      headers: ["Intersection", "No-Build LOS", "Build LOS", "Δ delay (s)", "v/c", "Q95 (ft)"],
      widths: [200, 70, 70, 75, 50, 60],
      align: ["left", "center", "center", "right", "right", "right"],
      rows: intersections.map((it) => {
        const losChanged = it.losChanged === true;
        return [
          String(it.name ?? it.signalId ?? "—"),
          String(it.existingLos ?? "—"),
          (losChanged ? "▲ " : "") + String(it.futureLos ?? "—"),
          fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
          fmtNum(it.futureVc, 2),
          fmtNum(it.queue95thFt),
        ];
      }),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No signalized intersections within the study radius — no off-site capacity impact is anticipated.", { paragraphGap: 6 });
    doc.fillColor("black");
  }
  // Measured lane-group queues, where an import supplied a real turn split.
  // No-ops (byte-identical output) for studies without one.
  renderLaneGroupQueues(doc, intersections as any[], {
    heading: "Lane-Group Queues at Intersections with Measured Turning Movements",
  });
  doc.moveDown(0.3);

  // §3.6 Capacity Improvement Measures
  nySubsection(doc, "3.6 Capacity Improvement Measures");
  if (needMitigation.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "The following capacity improvements are recommended at affected intersections under Build conditions. Improvement category guidance per HDM Chapter 5: addition of turn lanes; installation or re-timing of traffic signals; signage and striping to prevent unwanted turning movements; conversion to roundabout; and TDM / TSM measures per HDM Chapter 24.",
      { paragraphGap: 6 },
    );
    doc.font("body").fontSize(10).fillColor("black");
    for (const it of needMitigation) {
      const sev = String(it.mitigationSeverity ?? "").toUpperCase();
      doc.font("bold").text(`${it.name ?? it.signalId} `, { continued: true });
      doc.font("body").fillColor(TEXT_GRAY).text(`[${sev}]`, { continued: false });
      doc.font("body").fillColor("black").text("  " + it.mitigation);
      doc.moveDown(0.3);
    }
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      "No capacity improvements are required under Build conditions. The project will operate within acceptable LOS standards at all affected intersections per HDM Chapter 5. Standard HDM Chapter 5 improvement categories (turn lanes, signal installation / re-timing, signing and striping, roundabout conversion, TDM / TSM per HDM Chapter 24) remain available if site-specific concerns arise during NYSDOT Regional Traffic Office review.",
      { paragraphGap: 6 },
    );
  }
  doc.moveDown(0.5);

  renderTripDistributionSection(doc, r as any, {
    subsectionNumber: "3.7",
    assignmentNumber: "3.8",
    headingFn: nySubsection,
    cap: 20,
  });

  // --- §4.0 Crash Analysis -----------------------------------------------
  nySection(doc, "4.0 CRASH ANALYSIS");
  const crashEnd = Number.isFinite(currentYear) ? currentYear : (Number.isFinite(openingYear) ? openingYear - growthYears : NaN);
  const crashEndLabel = Number.isFinite(crashEnd) ? String(crashEnd) : "current year";
  const crashStartLabel = Number.isFinite(crashEnd) ? String((crashEnd as number) - 3) : "(start)";

  // Tier-1 crash module: county-level 3-year crash counts from the
  // NY State Police MV Crash Case Information SODA endpoint, fetched
  // in renderStudyPdf via getNyCrashSummaryForSite() and stashed on
  // result.nyCrashSummary. Falls back to the Shell escape-hatch
  // language when the ingest returned nothing.
  const crashSummary = (r as any).nyCrashSummary as
    | {
        countyName: string;
        fatalAccidents: number;
        injuryAccidents: number;
        propertyDamageAccidents: number;
        propertyDamageAndInjuryAccidents: number;
        totalAccidents: number;
      }
    | undefined;

  // Tier-2 precise crash records — populated when the study site is
  // inside NYC. h9gi-nx95 carries officer-geocoded lat/lon, so we
  // can run a 0.25-mile-radius query against the local `crashes`
  // table (populated by ingest-crashes-nyc.ts) and produce
  // per-intersection-level crash exposure — the thing the county-
  // level table explicitly cannot give. Renders ABOVE the county
  // block; the county block stays as statewide-rate context for the
  // §5.3.4 screening.
  const preciseCrashSummary = (r as any).nyPreciseCrashSummary as
    | {
        windowYears: number;
        totalCrashes: number;
        bySeverity: { K: number; A: number; B: number; C: number; O: number; UNKNOWN: number };
        pedestrianInvolved: number;
        cyclistInvolved: number;
        recentSevere: Array<{
          occurredAt: string;
          severity: string;
          onStreet: string | null;
          crossStreet: string | null;
          mannerOfCollision: string | null;
          pedestrianInvolved: boolean;
          cyclistInvolved: boolean;
        }>;
        source: string;
        locationPrecision: "precise" | "approximate";
      }
    | undefined;

  if (preciseCrashSummary && preciseCrashSummary.totalCrashes > 0) {
    const fatal = preciseCrashSummary.bySeverity.K;
    const injury = preciseCrashSummary.bySeverity.C; // NYC dataset doesn't grade A/B/C; see ingest-crashes-nyc.ts.
    const pdo = preciseCrashSummary.bySeverity.O;
    doc.font("body").fontSize(10).fillColor("black").text(
      `A site-radius crash review (0.25-mile radius, ${preciseCrashSummary.windowYears}-year window) was performed using the NYC Open Data "Motor Vehicle Collisions — Crashes" dataset (data.cityofnewyork.us / h9gi-nx95), which carries lat/lon geocoded by NYPD Track Traffic / Criminal at the time of report. The values below are intersection-level, not county-level — they reflect the exposure local to the proposed site access and study network. NYC does not publish KABCO injury-severity grades; every injury crash is reported here as "C — minor" rather than fabricated A or B grades.`,
      { paragraphGap: 6 },
    );

    nyTable(doc, {
      headers: ["Severity (KABCO)", "Count (3-yr)", "Annualized"],
      widths: [240, 130, 110],
      align: ["left", "right", "right"],
      rows: [
        ["K — Fatal", fmtNum(fatal), fmtNum(fatal / preciseCrashSummary.windowYears, 2)],
        ["C — Injury (source publishes no A/B subgrade)", fmtNum(injury), fmtNum(injury / preciseCrashSummary.windowYears, 2)],
        ["O — Property Damage Only", fmtNum(pdo), fmtNum(pdo / preciseCrashSummary.windowYears, 2)],
        ["Total (all severities)", fmtNum(preciseCrashSummary.totalCrashes), fmtNum(preciseCrashSummary.totalCrashes / preciseCrashSummary.windowYears, 2)],
      ],
    });
    doc.moveDown(0.2);

    if (preciseCrashSummary.pedestrianInvolved > 0 || preciseCrashSummary.cyclistInvolved > 0) {
      doc.font("body").fontSize(10).fillColor("black").text(
        `Vulnerable road user involvement within the 0.25-mile radius: ${fmtNum(preciseCrashSummary.pedestrianInvolved)} pedestrian-involved crash${preciseCrashSummary.pedestrianInvolved === 1 ? "" : "es"}, ${fmtNum(preciseCrashSummary.cyclistInvolved)} cyclist-involved crash${preciseCrashSummary.cyclistInvolved === 1 ? "" : "es"}. Multimodal mitigation review is required at any site access where the §4 screening flags an above-statewide-average crash rate.`,
        { paragraphGap: 6 },
      );
    }

    if (preciseCrashSummary.recentSevere.length > 0) {
      doc.font("bold").fontSize(10).fillColor("black").text(`Recent severe crashes within 0.25 mi (most recent ${preciseCrashSummary.recentSevere.length}):`);
      doc.moveDown(0.2);
      nyTable(doc, {
        headers: ["Date", "Severity", "On street", "Cross street", "Manner"],
        widths: [70, 60, 150, 130, 70],
        align: ["left", "center", "left", "left", "left"],
        rows: preciseCrashSummary.recentSevere.map((c) => [
          c.occurredAt,
          c.severity,
          c.onStreet ?? "—",
          c.crossStreet ?? "—",
          c.mannerOfCollision ?? "—",
        ]),
      });
      doc.moveDown(0.3);
    }

    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "The county-level table below is included for statewide-rate context per HDM Chapter 5 §5.3.4. For formal submittal the rate comparison must be made against the controlling facility's exposure (segment AADT × segment length; intersection AADT × entry-flow) and benchmarked to NYSDOT Office of Modal Safety statewide averages; the site-radius detail above provides the per-intersection exposure the county-rate alone cannot.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
    doc.moveDown(0.3);
  }

  if (crashSummary && crashSummary.totalAccidents > 0) {
    const totalInjurious =
      crashSummary.injuryAccidents + crashSummary.propertyDamageAndInjuryAccidents;
    const fatalPctAnnual = (crashSummary.fatalAccidents / 3 / crashSummary.totalAccidents) * 100;
    doc.font("body").fontSize(10).fillColor("black").text(
      `A minimum three-year accident history review was performed for the period ${crashStartLabel} to ${crashEndLabel} per HDM Chapter 5 §5.3.4. County-level crash counts below are auto-ingested from the New York State Police "Motor Vehicle Crashes – Case Information: Three Year Window" Open Data dataset (https://data.ny.gov/Transportation/Motor-Vehicle-Crashes-Case-Information-Three-Year-/e8ky-4vqe), filtered by county_name resolved from the project site coordinates via the NYSDOT RDM_Roadway_Current FeatureServer. The values cover the entire rolling 3-year reporting window for ${crashSummary.countyName} County, statewide-system-wide — they are NOT a per-segment or per-intersection rate.`,
      { paragraphGap: 6 },
    );

    nyTable(doc, {
      headers: ["Severity descriptor (NY DMV)", "Count (3-yr rolling)", "Annualized"],
      widths: [240, 130, 110],
      align: ["left", "right", "right"],
      rows: [
        ["Fatal Accident", fmtNum(crashSummary.fatalAccidents), fmtNum(crashSummary.fatalAccidents / 3, 1)],
        ["Injury Accident", fmtNum(crashSummary.injuryAccidents), fmtNum(crashSummary.injuryAccidents / 3, 1)],
        ["Property Damage Accident", fmtNum(crashSummary.propertyDamageAccidents), fmtNum(crashSummary.propertyDamageAccidents / 3, 1)],
        ["Property Damage & Injury Accident", fmtNum(crashSummary.propertyDamageAndInjuryAccidents), fmtNum(crashSummary.propertyDamageAndInjuryAccidents / 3, 1)],
        ["Total (all severities)", fmtNum(crashSummary.totalAccidents), fmtNum(crashSummary.totalAccidents / 3, 1)],
      ],
    });

    doc.moveDown(0.3);
    doc.font("body").fontSize(10).fillColor("black").text(
      `Within ${crashSummary.countyName} County over the rolling 3-year window, ${fmtNum(crashSummary.totalAccidents)} crashes were reported to NY DMV (${fmtNum(crashSummary.fatalAccidents)} fatal, ${fmtNum(totalInjurious)} injury-involved, ${fmtNum(crashSummary.propertyDamageAccidents)} property damage only). The Fatal share is ${fatalPctAnnual.toFixed(3)}% of all reported crashes (annualized). For the Safety Screening per HDM Chapter 5 §5.3.4, the project-specific rate must be normalized against the controlling facility's exposure (segment AADT × segment length; intersection AADT × entry-flow) for comparison to NYSDOT Office of Modal Safety statewide averages and the 1.5× HAL trigger. County-totals above provide a county-baseline reference only — site-radius (1/4-mile typical) crash records, HAL / PIL / SDL flags, and CMF / CRF mitigation values must be obtained from the ${nyRegion.label} Regional Traffic Office via FOIL or SIMS. Required NYSDOT forms when the §4.0 section is expanded for formal submittal: TE-156a (Collision Diagram), TE-164a (Safety Benefits Evaluation), TE-204a (Accident Rate Summary), TE-213 (HAL / PIL / SDL Screening Output).`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `A minimum three-year accident history review was performed for the period ${crashStartLabel} to ${crashEndLabel} per HDM Chapter 5 §5.3.4. Auto-ingest from the New York State Police 3-year Crash Case Information dataset (data.ny.gov / e8ky-4vqe) was attempted but did not return county-level totals — either the project site's county could not be resolved via the NYSDOT RDM FeatureServer, or the SODA endpoint is unavailable. Refer to ${nyRegion.label} Regional Traffic Office for SIMS output documentation; the Safety Screening criteria from HDM Chapter 5 §5.3.4 (overall accident rate vs. 1.5× statewide average for comparable facility; HAL / PIL / SDL pattern flags; Fatal / Injury / Fatal+Injury rates not above average; addressed PIL list status; Fixed Object, Run-Off Road, and Wet-Road PIL list status) must be applied manually for this project.`,
      { paragraphGap: 6 },
    );
  }

  // NHTSA FARS fatal-crash supplement — the statewide public per-crash
  // source (per-crash NY data outside NYC is gated behind SIMS/TSSR
  // access). renderStudyPdf stashes r.farsKSummary for every US site
  // and each state renderer emits its own block; NY was the only US
  // renderer not rendering it. Primitives duplicated locally per this
  // file's no-cross-file-coupling rule.
  {
    const fars = (r as any).farsKSummary as
      | {
          windowYears: number;
          radiusMi: number;
          totalCrashes: number;
          recentSevere: Array<{ occurredAt: string; severity: string; onStreet: string | null; crossStreet: string | null; mannerOfCollision: string | null }>;
        }
      | undefined;
    if (fars && fars.totalCrashes > 0) {
      doc.moveDown(0.2);
      doc.font("bold").fontSize(10).fillColor("black").text("Fatal Crash History (NHTSA FARS supplement):");
      doc.moveDown(0.2);
      doc.font("body").fontSize(10).fillColor("black").text(
        `${fmtNum(fars.totalCrashes)} fatal crash${fars.totalCrashes === 1 ? "" : "es"} within ${(fars.radiusMi ?? 0).toFixed(2)} mi of the site over a ${fars.windowYears}-year window are recorded in the NHTSA Fatality Analysis Reporting System (FARS) public ArcGIS layer. FARS records only K-severity (fatal) crashes by definition and its public layer carries the calendar year only; injury and PDO crashes, and time-of-day patterns, must come from the ${nyRegion.label} Regional Traffic Office (SIMS / TSSR) for a formal Highway Safety Manual analysis.`,
        { paragraphGap: 6 },
      );
      if (fars.recentSevere.length > 0) {
        nyTable(doc, {
          headers: ["Year", "Severity", "On street", "Cross street", "Manner"],
          widths: [55, 60, 150, 130, 85],
          align: ["center", "center", "left", "left", "left"],
          rows: fars.recentSevere.map((c) => [
            c.occurredAt.slice(0, 4),
            c.severity,
            c.onStreet ?? "—",
            c.crossStreet ?? "—",
            c.mannerOfCollision ?? "—",
          ]),
        });
        doc.moveDown(0.3);
      }
    }
  }
  doc.moveDown(0.4);

  // --- Appendix A — Existing Volume Report -------------------------------
  doc.addPage();
  nySection(doc, "APPENDIX A — EXISTING VOLUME REPORT");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per-approach existing peak-hour volumes (vph) for all affected intersections within study limits. Source: SimpleImpactStudies screening solver (Webster/Akçelik control-delay model), calibrated against the controlling DOT 511 / Regional Traffic Office data feed.",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    const apxRows: string[][] = [];
    for (const it of intersections) {
      const approaches: any[] = Array.isArray(it.approaches) ? it.approaches : [];
      for (const a of approaches) {
        apxRows.push([
          String(it.name ?? it.signalId ?? "—"),
          String(a.direction ?? "—"),
          fmtNum(a.currentVolumeVph),
          fmtNum(a.existingVolumeVph),
          fmtNum(a.futureVolumeVph),
        ]);
      }
    }
    if (apxRows.length > 0) {
      nyTable(doc, {
        headers: ["Intersection", "Approach", "Existing (vph)", "No-Build (vph)", "Build (vph)"],
        widths: [200, 60, 80, 80, 80],
        align: ["left", "center", "right", "right", "right"],
        rows: apxRows,
      });
    } else {
      doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("Per-approach volume detail not available from engine payload.", { paragraphGap: 6 });
      doc.fillColor("black");
    }
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No affected intersections within the study radius.", { paragraphGap: 6 });
    doc.fillColor("black");
  }

  // --- Appendix B — Existing Condition Capacity Analysis Output ----------
  doc.addPage();
  nySection(doc, "APPENDIX B — EXISTING CONDITION CAPACITY ANALYSIS OUTPUT");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per-intersection screening-solver output (Webster/Akçelik control-delay model) for the Existing No-Build condition (current-year volumes; volumes grown to opening year at the §3.1 background-growth rate for No-Build comparison).",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    nyTable(doc, {
      headers: ["Intersection", "Approach", "Vol (vph)", "v/c", "Delay (s)", "LOS"],
      widths: [180, 60, 60, 50, 70, 50],
      align: ["left", "center", "right", "right", "right", "center"],
      rows: intersections.flatMap((it) => {
        const approaches: any[] = Array.isArray(it.approaches) ? it.approaches : [];
        return approaches.map((a) => [
          String(it.name ?? it.signalId ?? "—"),
          String(a.direction ?? "—"),
          fmtNum(a.existingVolumeVph),
          fmtNum(a.existingVc, 2),
          fmtNum(a.existingDelaySec, 1),
          String(a.existingLos ?? "—"),
        ]);
      }),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No affected intersections within the study radius.", { paragraphGap: 6 });
    doc.fillColor("black");
  }

  // --- Appendix C — Proposed Condition Capacity Analysis Output ----------
  doc.addPage();
  nySection(doc, "APPENDIX C — PROPOSED CONDITION CAPACITY ANALYSIS OUTPUT");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per-intersection screening-solver output (Webster/Akçelik control-delay model) for the Proposed Build condition (No-Build volumes plus project external trips at the assigned distribution).",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    nyTable(doc, {
      headers: ["Intersection", "Approach", "Vol (vph)", "v/c", "Delay (s)", "LOS"],
      widths: [180, 60, 60, 50, 70, 50],
      align: ["left", "center", "right", "right", "right", "center"],
      rows: intersections.flatMap((it) => {
        const approaches: any[] = Array.isArray(it.approaches) ? it.approaches : [];
        return approaches.map((a) => [
          String(it.name ?? it.signalId ?? "—"),
          String(a.direction ?? "—"),
          fmtNum(a.futureVolumeVph),
          fmtNum(a.futureVc, 2),
          fmtNum(a.futureDelaySec, 1),
          String(a.futureLos ?? "—"),
        ]);
      }),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No affected intersections within the study radius.", { paragraphGap: 6 });
    doc.fillColor("black");
  }

  // --- Appendix D — Crash Analysis Diagrams and Tables -------------------
  doc.addPage();
  nySection(doc, "APPENDIX D — CRASH ANALYSIS DIAGRAMS AND TABLES");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Crash analysis diagrams and tables are not produced by this screening analysis. When the §4.0 crash-analysis section is expanded for formal submittal, the following NYSDOT forms are required: TE-156a (Collision Diagram), TE-164a (Safety Benefits Evaluation Form), TE-204a (Accident Rate Summary), and TE-213 (HAL / PIL / SDL Screening Output). SIMS output and statewide-average rate references should be obtained from the controlling Regional Traffic Office per HDM Chapter 5 §5.3.4 and the NYSDOT Office of Modal Safety statewide rate tables (https://www.dot.ny.gov/divisions/operating/osss/highway/accident-rates).",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.4);
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text("This report is based on the NYSDOT TIS Shell revised on 9/16/2014.", { align: "center" });
  doc.fillColor("black");
}

// ===========================================================================
// CEQR Ch 16 — NYC overlay (scaffold)
// ===========================================================================
//
// renderCeqrNyc emits a CEQR-shaped overlay on top of the HDM Chapter
// 5 shell when the site is in the five boroughs. Per new-york-tis-spec
// §2.2 and §10, the recommended architecture is a sibling function
// (analogous to renderTisGeorgiaDriSections) that re-reads the engine
// output, classifies trip generation against the CEQR Table 16-1
// thresholds (50 peak-hr vehicle / 200 peak-hr transit / 200 peak-hr
// pedestrian), and emits the §A-§E section structure expected by NYC
// OEC reviewers.
//
// This first cut implements:
//   §A.1 Project description / screening assumptions
//   §A.2 Trip generation vs Table 16-1 thresholds (preliminary)
//   §A.3 Threshold-crossing summary
//   §B.1-B.4 Detailed trip generation (when any threshold is crossed)
//   §C-§E sections are SCAFFOLDED with placeholder text — the
//   detailed methodology (pedestrian LOS via Pushkarev/Zupan, subway
//   line-haul / bus capacity, parking accumulation, Vision Zero
//   review) is out of scope for this first cut and is queued as a
//   follow-up to new-york-tis-spec §12.

const CEQR_VEH_THRESHOLD = 50; // peak-hour vehicle trip-ends
const CEQR_TRANSIT_THRESHOLD = 200; // peak-hour transit riders
const CEQR_PED_THRESHOLD = 200; // peak-hour pedestrian trips

/**
 * Render the CEQR Chapter 16 overlay for NYC sites. Called from
 * renderStudyPdf AFTER renderTisNewYork when the site sits inside the
 * five boroughs (NYSDOT Region 11).
 *
 * The CEQR Technical Manual's December 2025 Edition is the governing
 * source; Chapter 16 (Transportation) is the operational chapter.
 * Preliminary screening uses Table 16-1 trip-end thresholds. Detailed
 * analysis only kicks in when at least one threshold is crossed.
 */
export function renderCeqrNyc(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  _region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const amPeak = Number(tg.amPeakTrips ?? 0);
  const pmIn = Number(tg.pmIn ?? 0);
  const pmOut = Number(tg.pmOut ?? 0);
  const peakHourVeh = Math.max(amPeak, pmIn + pmOut);
  // Modal split inferred from the transit-context — CEQR Ch 16 zone
  // bands are driven by transit accessibility, and the number of
  // subway routes within walk-shed is the cleanest available proxy:
  //   - 5+ routes (Manhattan CBD-typical) → 25/65/10 vehicle/transit/ped
  //   - 3-4 routes (Manhattan non-CBD)    → 30/60/10
  //   - 1-2 routes (Outer Borough TOD)    → 40/45/15
  //   - 0 routes  (Outer Borough non-TOD) → 55/30/15
  // A submittable CEQR analysis must replace the inferred split with
  // the actual CEQR Ch 16 Appendix C zone-specific value.
  const transitCtxCeqr = (r as any)?.nyTransitContext as NycTransitContext | undefined;
  const routesAvailable = transitCtxCeqr?.subway.routesAvailable.length ?? 0;
  let vehShare: number;
  let transitShare: number;
  let pedShare: number;
  let modalSplitBasis: string;
  if (routesAvailable >= 5) {
    vehShare = 0.25; transitShare = 0.65; pedShare = 0.10;
    modalSplitBasis = "Manhattan-CBD-typical (≥5 subway routes accessible within the 0.5-mi walk-shed)";
  } else if (routesAvailable >= 3) {
    vehShare = 0.30; transitShare = 0.60; pedShare = 0.10;
    modalSplitBasis = `Manhattan-non-CBD-typical (${routesAvailable} subway routes accessible within the walk-shed)`;
  } else if (routesAvailable >= 1) {
    vehShare = 0.40; transitShare = 0.45; pedShare = 0.15;
    modalSplitBasis = `Outer-Borough TOD (${routesAvailable} subway route${routesAvailable === 1 ? "" : "s"} accessible within the walk-shed)`;
  } else {
    vehShare = 0.55; transitShare = 0.30; pedShare = 0.15;
    modalSplitBasis = "Outer-Borough non-TOD (no subway station within 0.5 mi; transit served by NYCT bus only)";
  }
  const peakHourPerson = peakHourVeh / vehShare;
  const peakHourTransit = Math.round(peakHourPerson * transitShare);
  const peakHourPed = Math.round(peakHourPerson * pedShare);

  const vehAbove = peakHourVeh > CEQR_VEH_THRESHOLD;
  const transitAbove = peakHourTransit > CEQR_TRANSIT_THRESHOLD;
  const pedAbove = peakHourPed > CEQR_PED_THRESHOLD;
  const anyAbove = vehAbove || transitAbove || pedAbove;

  doc.addPage();
  nySection(doc, "CEQR CHAPTER 16 — NYC TRANSPORTATION ANALYSIS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "This section overlays the NYSDOT HDM Chapter 5 shell above with the CEQR Chapter 16 (Transportation) framing required for any NYC discretionary action. Reference: CEQR Technical Manual, December 2025 Edition (NYC Mayor's Office of Environmental Coordination). Chapter 16 PDF: https://www.nyc.gov/assets/oec/technical-manual/16_Transportation_2025.pdf.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // §A — Preliminary Screening
  nySubsection(doc, "A.1 Project Description and Screening Assumptions");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Project ${project.projectName || "(unnamed)"} — land-use code ${project.landUseCode || "—"}. Peak-hour vehicle trip-end estimate from the engine (max of AM and PM peaks): ${peakHourVeh} vehicle trips. The §A.2 screening converts the vehicle-trip figure to person-trips and modal totals using a ${(vehShare * 100).toFixed(0)}/${(transitShare * 100).toFixed(0)}/${(pedShare * 100).toFixed(0)} (vehicle / transit / pedestrian) mode split. Basis: ${modalSplitBasis}. A submittable CEQR analysis must replace this transit-context-inferred split with the zone-specific share drawn from CEQR Tech Manual Ch 16 Appendix C for the actual sub-borough zone of the site.`,
    { paragraphGap: 6 },
  );

  nySubsection(doc, "A.2 Trip Generation vs CEQR Table 16-1 Thresholds");
  nyTable(doc, {
    headers: ["Mode", "Peak-hour trip estimate", "CEQR threshold", "Status"],
    widths: [140, 140, 120, 100],
    align: ["left", "right", "right", "center"],
    rows: [
      [
        "Vehicle (trip-ends)",
        String(peakHourVeh),
        `${CEQR_VEH_THRESHOLD}`,
        vehAbove ? "Above" : "Below",
      ],
      [
        "Transit riders (subway + bus)",
        String(peakHourTransit),
        `${CEQR_TRANSIT_THRESHOLD}`,
        transitAbove ? "Above" : "Below",
      ],
      [
        "Pedestrians",
        String(peakHourPed),
        `${CEQR_PED_THRESHOLD}`,
        pedAbove ? "Above" : "Below",
      ],
    ],
  });
  doc.moveDown(0.2);
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
    "Thresholds per CEQR Tech Manual Ch 16 (Dec 2025 Edition). The Table 16-1 development-density thresholds translate the trip-end thresholds above into per-land-use floor-area cutoffs by zone; the renderer does not currently reproduce Table 16-1 verbatim — confirm against the December 2025 edition PDF for formal submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  nySubsection(doc, "A.3 Preliminary Screening Conclusion");
  if (!anyAbove) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "All three peak-hour trip-end estimates fall below the CEQR Ch 16 screening thresholds. Per the Tech Manual, no detailed transportation analysis is required (except in unusual circumstances). The CEQR transportation conclusion is no significant adverse impact. Sections B-E below are not triggered.",
      { paragraphGap: 6 },
    );
    return;
  }
  doc.font("body").fontSize(10).fillColor("black").text(
    `${[
      vehAbove ? "vehicle" : null,
      transitAbove ? "transit" : null,
      pedAbove ? "pedestrian" : null,
    ].filter(Boolean).join(" / ")} threshold(s) crossed — detailed analysis required for each crossed mode per CEQR Tech Manual Ch 16. The detailed analyses scaffolded below should be expanded by the engineering team for the formal CEQR submittal.`,
    { paragraphGap: 6 },
  );

  // §B — Detailed Trip Generation
  nySubsection(doc, "B.1-B.4 Detailed Trip Generation");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Detailed trip generation per CEQR Ch 16 §B requires: (1) daily + peak-hour person trips per zone-specific modal split (Appendix C); (2) vehicle occupancy from Table 16-3; (3) per-mode trip totals broken out by vehicle, taxi/FHV, subway, bus, walk, bike. The engine produces vehicle trip-ends only; the full multi-modal table must be derived from the CEQR rate library and is not auto-generated by this renderer. Pre-permission CEQR rate set should be agreed with NYC OEC at scoping.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // §B.2 transit anchor — real subway access drawn from the
  // MTA stations adapter when available. Anchors the modal split
  // discussion to actual routes accessible from the site.
  const transitCtx: NycTransitContext | null =
    r && typeof r === "object" && r.nyTransitContext
      ? (r.nyTransitContext as NycTransitContext)
      : null;
  if (transitCtx && transitCtx.subway.stations.length > 0) {
    const routes = transitCtx.subway.routesAvailable;
    const closest = transitCtx.subway.stations[0];
    doc.font("body").fontSize(10).fillColor("black").text(
      `Site transit accessibility (per CEQR Ch 16 walk-shed convention, 0.5 mi from the centroid): ${transitCtx.subway.stations.length} MTA subway station${transitCtx.subway.stations.length === 1 ? "" : "s"} within range, providing ${routes.length} daytime route${routes.length === 1 ? "" : "s"}: ${routes.join(", ") || "—"}. Closest station ${closest.name} at ${closest.distanceMi.toFixed(2)} mi. The high transit accessibility implied by direct walk-access to ${routes.length} subway route${routes.length === 1 ? "" : "s"} supports a transit-heavy modal split assumption (transit share commonly 50-70% for Manhattan CBD CEQR sites with comparable subway access).`,
      { paragraphGap: 6 },
    );
  }

  // §C — Detailed Analysis placeholders
  nySubsection(doc, "C.1-C.5 Detailed Analysis (scaffold — outside scope of this renderer iteration)");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (vehAbove) {
    doc.text("• C.1 Traffic operations — Synchro / HCS intersection LOS at affected intersections, with mitigation per the CEQR significant-impact thresholds for delay (5 sec for LOS C, 4 sec for D, 2.5 sec for E, etc.). The §3 HDM Ch 5 capacity analysis above provides the engine baseline; CEQR-specific delay-change thresholds apply.", { paragraphGap: 3 });
  }
  if (transitAbove) {
    doc.text("• C.2 Transit — subway line-haul capacity analysis (peak-load-point ridership vs NYCT capacity at affected stations) + bus-route capacity analysis (peak-load-point ridership vs MTA Bus / NYCT Bus guidelines). Requires MTA-supplied data; not produced by the engine.", { paragraphGap: 3 });
  }
  if (pedAbove) {
    doc.text("• C.3 Pedestrian — sidewalk / corner / crosswalk LOS via the Pushkarev & Zupan (1975) flow-rate procedure (NOT HCM Ch 18) at every affected sidewalk segment, corner reservoir, and crosswalk within the study area. Requires field-collected pedestrian counts; not produced by the engine.", { paragraphGap: 3 });
  }
  doc.text("• C.4 Parking — accumulation analysis vs zoning maxima/minima per NYC Zoning Resolution. Requires the development's parking provision and an hourly accumulation curve; not produced by the engine.", { paragraphGap: 3 });
  // §C.5 Safety — when NYC OpenData precise crashes are present at
  // the intersection radius (populated by crashesNearPoint with
  // source nyc_opendata), surface them as a Vision Zero
  // intersection-level overlay. Otherwise emit the scaffold prose.
  // Severity comes from CrashSummary.bySeverity (KABCO buckets) — the
  // summary carries no flat `fatalities`/`seriousInjuries` fields, and
  // reading those printed "0 fatalities" even when bySeverity.K > 0.
  // NYC's dataset publishes no A/B injury subgrades (everything is C),
  // so report fatal (K) and total injury (A+B+C) rather than a
  // "serious injuries" figure the source cannot support.
  const preciseCrash = (r as any)?.nyPreciseCrashSummary as
    | {
        totalCrashes?: number;
        radiusMi?: number;
        windowYears?: number;
        bySeverity?: { K?: number; A?: number; B?: number; C?: number };
        pedestrianInvolved?: number;
        cyclistInvolved?: number;
      }
    | undefined;
  if (preciseCrash && (preciseCrash.totalCrashes ?? 0) > 0) {
    const sev = preciseCrash.bySeverity ?? {};
    const fatalities = sev.K ?? 0;
    const injuries = (sev.A ?? 0) + (sev.B ?? 0) + (sev.C ?? 0);
    doc.text(
      `• C.5 Safety — NYC OpenData Vision Zero crashes within ${preciseCrash.radiusMi ?? "—"} mi of the site over the rolling ${preciseCrash.windowYears ?? "—"}-year window: ${preciseCrash.totalCrashes} total crashes (${fatalities} fatal, ${injuries} injury-involved, ${preciseCrash.pedestrianInvolved ?? 0} pedestrian-involved, ${preciseCrash.cyclistInvolved ?? 0} cyclist-involved). A submittable CEQR §C.5 narrative must compare these counts against the city-wide crash rate per veh-mi-traveled, identify HCLs in the study area, and surface mitigation per the NYC DOT Vision Zero priority-intersection list. Source: NYC OpenData Motor Vehicle Collisions (h9gi-nx95).`,
      { paragraphGap: 6 },
    );
  } else {
    doc.text(
      "• C.5 Safety — Vision Zero high-crash-location review at affected intersections within the study area. The county-level crash totals in §4.0 above provide reference but are NOT a substitute for the NYC Vision Zero View intersection-level overlay. The NYC OpenData precise-crash adapter returned no records — verify the intersection coordinates and re-run, or query Vision Zero View directly (https://www.nyc.gov/site/visionzero/maps/vz-view.page).",
      { paragraphGap: 6 },
    );
  }
  doc.fillColor("black");

  // §D — Impacts + Mitigation
  nySubsection(doc, "D.1-D.3 Significant Impact Determination and Mitigation (scaffold)");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "CEQR significant-impact thresholds are mode- and metric-specific (delay change, LOS drop, queue length, transit capacity utilization, pedestrian LOS step). The CEQR finding (positive declaration, conditioned negative declaration, or negative declaration) is determined by the lead agency on the basis of the §C detailed analyses; this renderer does not synthesize the finding.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
}

