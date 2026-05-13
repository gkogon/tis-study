/**
 * Per-study PDF export. PDFKit generates the deliverable a firm can hand
 * to a developer client or submit to a jurisdiction.
 *
 * Layout convention shared across study types:
 *   - Page 1: cover (firm logo placeholder, study title, project name,
 *     date, PE stamp box, signature line)
 *   - Page 2+: structured results — major metrics first, supporting
 *     tables, citation footer on every page
 *
 * Each study type has its own renderer that knows how to walk its
 * `result_payload` shape. New study types add a renderer here.
 *
 * Fonts: PDFKit's built-in Helvetica/Courier use WinAnsi encoding, which
 * mangles math glyphs (≤ ≥ ≈ × ±) that the methodology and findings
 * strings rely on. We embed DejaVu Sans (BSD-clean) for full Unicode.
 */
import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

type FirmStamp = {
  name: string;
  logoUrl: string | null;
};

const PAGE_MARGIN = 50;
const BRAND_BLUE = "#2563eb";
const TEXT_GRAY = "#6b7280";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In prod __dirname is dist/, so ../data/fonts works (same convention as
// atlanta-leads.ts). In tsx/test runs __dirname is src/lib/ so we need
// ../../data/fonts. Probe both so the file is portable across builds.
const FONT_DIR = (() => {
  for (const c of [path.resolve(__dirname, "../data/fonts"), path.resolve(__dirname, "../../data/fonts")]) {
    if (existsSync(path.join(c, "DejaVuSans.ttf"))) return c;
  }
  return path.resolve(__dirname, "../data/fonts");
})();
const FONT_REGULAR = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
const FONT_MONO = path.join(FONT_DIR, "DejaVuSansMono.ttf");

/**
 * Returns a Buffer holding the rendered PDF. Streams internally for
 * memory efficiency but resolves a single Buffer for handler simplicity.
 */
export async function renderStudyPdf(
  project: StoredProject,
  firm: FirmStamp,
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    // bufferPages lets us iterate every page once at the end to stamp
    // the screening-disclaimer footer without firing pageAdded
    // recursively during the draw passes.
    bufferPages: true,
    info: {
      Title: `${studyLabel(project.studyType)} — ${project.projectName}`,
      Author: firm.name,
      Subject: studyLabel(project.studyType),
      Creator: "Atlanta TIS",
    },
  });

  doc.registerFont("body", FONT_REGULAR);
  doc.registerFont("bold", FONT_BOLD);
  doc.registerFont("mono", FONT_MONO);
  doc.font("body");

  const chunks: Buffer[] = [];
  doc.on("data", (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  drawCover(doc, project, firm);
  doc.addPage();
  drawHeader(doc, project, firm);
  drawBody(doc, project);
  drawCitationsFooter(doc, project);

  // Iterate every buffered page and stamp the screening footer.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    drawPageFooter(doc);
  }
  doc.flushPages();
  doc.end();
  return done;
}

/**
 * Per-page screening-only disclaimer + page number. Keeps engineers
 * from accidentally submitting an Atlanta TIS PDF to a jurisdiction
 * unchanged.
 */
function drawPageFooter(doc: PDFKit.PDFDocument) {
  const y = doc.page.height - 32;
  const w = doc.page.width - PAGE_MARGIN * 2;
  doc.save();
  // `lineBreak: false` is critical: without it the footer text can
  // auto-paginate, which re-fires `pageAdded` and infinitely recurses.
  doc.font("body").fontSize(7).fillColor("#9ca3af").text(
    "Screening estimate — not for design submittal without independent verification by a licensed PE.   |   See /legal/disclaimer.",
    PAGE_MARGIN, y, { width: w, align: "center", lineBreak: false },
  );
  doc.restore();
}

function drawCover(doc: PDFKit.PDFDocument, project: StoredProject, firm: FirmStamp) {
  // Top brand band
  doc.rect(0, 0, doc.page.width, 12).fill(BRAND_BLUE);
  doc.fillColor("black");

  doc.moveDown(2);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(firm.name.toUpperCase(), { align: "right" });
  doc.fillColor("black");

  doc.moveDown(4);
  doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(studyLabel(project.studyType).toUpperCase(), { align: "center", characterSpacing: 2 });
  doc.moveDown(0.5);
  doc.font("bold").fontSize(28).fillColor("black").text(project.projectName, { align: "center" });

  doc.moveDown(2);
  doc.font("body").fontSize(11).fillColor(TEXT_GRAY).text(`Prepared ${project.createdAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`, { align: "center" });

  // Field block
  doc.moveDown(4);
  const fields: [string, string][] = [
    ["Project No.", "—"],
    ["Prepared By", firm.name],
    ["Reviewer", "—"],
    ["Study Type", studyLabel(project.studyType)],
  ];
  if (project.siteLat && project.siteLon) {
    fields.push(["Site Coordinates", `${Number(project.siteLat).toFixed(4)}, ${Number(project.siteLon).toFixed(4)}`]);
  }
  const fieldX = PAGE_MARGIN + 30;
  fields.forEach(([label, value], i) => {
    const y = doc.y + (i === 0 ? 0 : 18);
    doc.font("bold").fontSize(8).fillColor(TEXT_GRAY).text(label.toUpperCase(), fieldX, y);
    doc.font("body").fontSize(12).fillColor("black").text(value, fieldX + 130, y);
  });

  // PE stamp + signature
  doc.moveDown(8);
  const stampY = doc.page.height - 200;
  doc.rect(PAGE_MARGIN + 30, stampY, 120, 120).strokeColor(TEXT_GRAY).stroke();
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text("PE Stamp", PAGE_MARGIN + 30 + 40, stampY + 55);

  const sigX = PAGE_MARGIN + 200;
  doc.strokeColor("black").moveTo(sigX, stampY + 60).lineTo(sigX + 200, stampY + 60).stroke();
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text("Signature", sigX, stampY + 65);
  doc.moveTo(sigX, stampY + 100).lineTo(sigX + 200, stampY + 100).stroke();
  doc.font("body").fontSize(8).text("Date", sigX, stampY + 105);
  doc.fillColor("black");

  // Footer
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
    "Screening-level deliverable. See methodology + limitations on subsequent pages.",
    PAGE_MARGIN,
    doc.page.height - PAGE_MARGIN - 10,
    { align: "center", width: doc.page.width - PAGE_MARGIN * 2 },
  );
}

function drawHeader(doc: PDFKit.PDFDocument, project: StoredProject, firm: FirmStamp) {
  doc.rect(0, 0, doc.page.width, 4).fill(BRAND_BLUE);
  doc.fillColor("black");
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY)
    .text(firm.name, PAGE_MARGIN, 12)
    .text(studyLabel(project.studyType) + " — " + project.projectName, PAGE_MARGIN, 12, { align: "right" });
  doc.fillColor("black");
  doc.moveDown(2);
}

function drawCitationsFooter(doc: PDFKit.PDFDocument, project: StoredProject) {
  const result = project.resultPayload as { citations?: string[] } | null;
  if (!result?.citations?.length) return;
  doc.addPage();
  drawHeader(doc, project, { name: "", logoUrl: null });
  doc.font("bold").fontSize(14).fillColor("black").text("Citations & Methodology");
  doc.moveDown(0.5);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  for (const c of result.citations) {
    doc.text("• " + c);
  }
}

function drawBody(doc: PDFKit.PDFDocument, project: StoredProject) {
  doc.font("bold").fontSize(18).fillColor("black").text(studyLabel(project.studyType));
  doc.moveDown(0.3);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(`Generated ${project.createdAt.toISOString()}`);
  doc.moveDown(1);

  const result = project.resultPayload as Record<string, unknown>;
  switch (project.studyType) {
    case "tis": renderTis(doc, result); break;
    case "parking": renderParking(doc, result); break;
    case "warrants": renderWarrants(doc, result); break;
    case "sight_distance": renderSightDistance(doc, result); break;
    case "queuing": renderQueuing(doc, result); break;
    case "road_diet": renderRoadDiet(doc, result); break;
    default: renderGenericJson(doc, result); break;
  }
}

// ---------- Per-study renderers ----------

function renderTis(doc: PDFKit.PDFDocument, r: any) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];

  // Headline metric strip
  metricStrip(doc, [
    { label: "Intersections", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "LOS drops", value: String(r.intersectionsWithLosDrop ?? 0) },
    { label: "At LOS E/F", value: String(r.intersectionsAtLosEf ?? 0) },
    { label: "Worst Δ delay", value: `${(r.worstDelayDeltaSec ?? 0).toFixed(1)}s` },
  ]);
  doc.moveDown(1);

  // Project & inputs
  section(doc, "Project & Inputs");
  rows(doc, [
    ["Project name", req.projectName ?? "—"],
    ["Address", req.address ?? "—"],
    ["Coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}, ${Number(req.longitude).toFixed(4)}` : "—"],
    ["Land use", `${tg.landUseCode ?? "—"} ${tg.landUseName ?? ""}`.trim()],
    ["Size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Study radius", `${r.studyRadiusMi ?? req.studyRadiusMi ?? "—"} mi`],
    ["Weather", String(r.weather ?? req.weather ?? "clear")],
    ["Background growth", `${r.growthAppliedPct ?? "—"}%/yr × ${r.growthYears ?? "—"} yr`],
    ["Pass-by applied", `${r.passByPctApplied ?? 0}%`],
    ["Internal capture", `${r.internalCapturePctApplied ?? 0}%`],
  ]);
  doc.moveDown(1);

  // PM peak trip generation summary
  section(doc, "PM Peak Trip Generation");
  rows(doc, [
    ["Daily trips", String(tg.dailyTrips ?? "—")],
    ["AM peak trips", String(tg.amPeakTrips ?? "—")],
    ["PM peak trips", `${tg.pmPeakTrips ?? "—"} (${tg.pmIn ?? 0} in / ${tg.pmOut ?? 0} out)`],
  ]);
  doc.moveDown(1);

  // Per-period trip generation table
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];
  if (periods.length) {
    section(doc, "Trip Generation by Period");
    table(doc, {
      headers: ["Period", "Raw", "Pass-by", "Int. cap.", "External", "In", "Out"],
      widths: [100, 50, 60, 60, 70, 50, 50],
      align: ["left", "right", "right", "right", "right", "right", "right"],
      rows: periods.map((p) => {
        const t = p.tripGeneration ?? {};
        return [
          String(p.periodLabel ?? p.period ?? ""),
          fmtNum(t.rawTrips),
          fmtNum(t.passByCredit),
          fmtNum(t.internalCaptureCredit),
          fmtNum(t.externalTrips),
          fmtNum(t.inTrips),
          fmtNum(t.outTrips),
        ];
      }),
    });
    doc.moveDown(1);
  }

  // Affected intersections table
  if (intersections.length) {
    section(doc, `Affected Intersections (${intersections.length})`);
    table(doc, {
      headers: ["Intersection", "Dist (mi)", "Trips", "Existing LOS", "Future LOS", "Δ delay (s)", "Q95 (ft)"],
      widths: [180, 50, 40, 60, 60, 60, 50],
      align: ["left", "right", "right", "center", "center", "right", "right"],
      rows: intersections.map((it) => {
        const losChanged = it.losChanged === true;
        return [
          it.name ?? it.signalId ?? "—",
          fmtNum(it.distanceMi, 2),
          fmtNum(it.addedTripsPmPeak),
          String(it.existingLos ?? "—"),
          (losChanged ? "▲ " : "") + String(it.futureLos ?? "—"),
          fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
          fmtNum(it.queue95thFt),
        ];
      }),
    });
    doc.moveDown(0.5);

    // Mitigation list — only intersections that need it
    const needMitigation = intersections.filter((it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none");
    if (needMitigation.length) {
      section(doc, "Recommended Mitigations");
      doc.font("body").fontSize(10).fillColor("black");
      for (const it of needMitigation) {
        const sev = String(it.mitigationSeverity ?? "").toUpperCase();
        doc.font("bold").text(`${it.name ?? it.signalId} `, { continued: true });
        doc.font("body").fillColor(TEXT_GRAY).text(`[${sev}]`, { continued: false });
        doc.font("body").fillColor("black").text("  " + it.mitigation);
        doc.moveDown(0.3);
      }
    }
    doc.moveDown(0.5);
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No signalized intersections within the study radius — no off-site capacity impact is anticipated.");
    doc.moveDown(1);
  }

  // Sensitivity (optional)
  if (r.sensitivity) {
    const s = r.sensitivity;
    section(doc, "Monte-Carlo Sensitivity");
    rows(doc, [
      ["Iterations", String(s.iterations ?? "—")],
      ["Mean worst Δ delay", `${fmtNum(s.worstDelayDeltaMean, 2)}s`],
      ["P10 / P50 / P90", `${fmtNum(s.worstDelayDeltaP10, 2)}s / ${fmtNum(s.worstDelayDeltaP50, 2)}s / ${fmtNum(s.worstDelayDeltaP90, 2)}s`],
      ["Probability ≥1 LOS drop", `${Math.round((s.probAnyLosDrop ?? 0) * 100)}%`],
      ["Probability any LOS E/F", `${Math.round((s.probAnyLosEf ?? 0) * 100)}%`],
      ["Expected LOS drops", fmtNum(s.expectedLosDrops, 2)],
    ]);
    doc.moveDown(1);
  }

  // Findings
  const findings: string[] = Array.isArray(r.findings) ? r.findings : [];
  if (findings.length) {
    section(doc, "Findings");
    doc.font("body").fontSize(10).fillColor("black");
    for (const f of findings) {
      doc.text("• " + f, { paragraphGap: 4 });
    }
    doc.moveDown(1);
  }

  // Methodology
  const methodology: string[] = Array.isArray(r.methodology) ? r.methodology : [];
  if (methodology.length) {
    section(doc, "Methodology");
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY);
    for (const m of methodology) {
      doc.text("• " + m, { paragraphGap: 4 });
    }
    doc.moveDown(1);
  }
}

function renderParking(doc: PDFKit.PDFDocument, r: any) {
  doc.font("bold").fontSize(14).fillColor("black").text("Demand summary");
  doc.moveDown(0.3);
  rows(doc, [
    ["Land use", `${r.landUse?.code} ${r.landUse?.name}`],
    ["Size", `${r.size} ${r.landUse?.unit}`],
    ["Weekday peak demand", `${r.demand?.weekdayPeak} spaces`],
    ["Saturday peak demand", `${r.demand?.saturdayPeak} spaces`],
    ["Governing demand (after shared-use)", `${r.demand?.adjustedDemand} spaces (${r.demand?.governingPeriod})`],
  ]);
  doc.moveDown(1);
  doc.font("bold").fontSize(14).text("Code & supply");
  doc.moveDown(0.3);
  rows(doc, [
    ["Code minimum (Atlanta default)", `${r.codeRequired?.total} spaces (${r.codeRequired?.perUnit} per unit)`],
    ["Proposed supply", `${r.proposedSpaces} spaces`],
    ["Verdict — vs ITE-adjusted demand", String(r.iteVerdict)],
    ["Verdict — vs code minimum", String(r.codeVerdict)],
    ["Governing margin", `${r.governingDelta >= 0 ? "+" : ""}${r.governingDelta} spaces`],
  ]);
}

function renderWarrants(doc: PDFKit.PDFDocument, r: any) {
  doc.font("bold").fontSize(14).fillColor("black").text("Intersection");
  doc.moveDown(0.3);
  rows(doc, [
    ["Name", r.intersection?.name ?? ""],
    ["Lane configuration", r.intersection?.laneConfig ?? ""],
    ["Reduction applied", r.reductionApplied ? "Yes (70% thresholds)" : "No (100% thresholds)"],
    ["Overall result", r.anyWarrantMet ? "At least one warrant met" : "No warrants met"],
  ]);
  doc.moveDown(0.5);
  for (const w of (r.warrants ?? [])) {
    doc.moveDown(0.3);
    doc.font("bold").fontSize(12).fillColor(w.met ? BRAND_BLUE : "black").text(`${w.name} — ${w.met ? "MET" : "Not met"}`);
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(`${w.hoursSatisfied} / ${w.hoursRequired} qualifying hours`);
    doc.fillColor("black");
    for (const n of w.notes ?? []) doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text("  · " + n);
    doc.fillColor("black");
  }
}

function renderSightDistance(doc: PDFKit.PDFDocument, r: any) {
  doc.font("bold").fontSize(14).fillColor("black").text("Intersection");
  rows(doc, [
    ["Name", r.intersection?.name],
    ["Design speed", `${r.intersection?.designSpeedMph} mph`],
    ["Maneuver", String(r.inputs?.maneuver).replace(/_/g, " ")],
    ["Vehicle class", String(r.inputs?.vehicleClass).replace(/_/g, " ")],
  ]);
  doc.moveDown(0.5);
  doc.font("bold").fontSize(14).text("Stopping Sight Distance");
  rows(doc, [
    ["Required", `${r.ssd?.requiredFt} ft`],
    ["Available", r.ssd?.availableFt !== null ? `${r.ssd?.availableFt} ft` : "—"],
    ["Margin", r.ssd?.marginFt !== null ? `${r.ssd?.marginFt >= 0 ? "+" : ""}${r.ssd?.marginFt} ft` : "—"],
    ["Verdict", String(r.ssd?.verdict)],
  ]);
  doc.moveDown(0.5);
  doc.font("bold").fontSize(14).text("Intersection Sight Distance");
  rows(doc, [
    ["Required", `${r.isd?.requiredFt} ft`],
    ["Available", r.isd?.availableFt !== null ? `${r.isd?.availableFt} ft` : "—"],
    ["Time gap", `${r.isd?.timeGapSec} s`],
    ["Verdict", String(r.isd?.verdict)],
  ]);
}

function renderQueuing(doc: PDFKit.PDFDocument, r: any) {
  doc.font("bold").fontSize(14).fillColor("black").text("Approach");
  rows(doc, [
    ["Intersection", r.intersection?.name],
    ["Movement", String(r.intersection?.movement).replace(/_/g, " ")],
    ["Lanes", String(r.inputs?.laneCount)],
    ["Volume", `${r.inputs?.hourlyVolumeVph} vph`],
    ["Cycle / green", `${r.inputs?.cycleLengthSec}s / ${r.inputs?.effectiveGreenSec}s`],
    ["v/c", String(r.capacity?.vOverC)],
    ["Capacity", `${r.capacity?.totalVph} vph total`],
  ]);
  doc.moveDown(0.5);
  doc.font("bold").fontSize(14).text("Queue results (per lane)");
  rows(doc, [
    ["Average queue", `${r.queue?.averageVehicles} veh / ${r.queue?.averageFt} ft`],
    ["95th-pct queue", `${r.queue?.p95Vehicles} veh / ${r.queue?.p95Ft} ft`],
    ["Required storage", `${r.storage?.requiredFt} ft`],
    ["Available storage", r.storage?.availableFt !== null ? `${r.storage?.availableFt} ft` : "—"],
    ["Verdict", String(r.storage?.verdict)],
  ]);
}

function renderRoadDiet(doc: PDFKit.PDFDocument, r: any) {
  doc.font("bold").fontSize(14).fillColor("black").text("Corridor");
  rows(doc, [
    ["Corridor", r.corridor?.name],
    ["Current → Proposed", `${r.corridor?.currentConfig} → ${r.corridor?.proposedConfig}`],
    ["ADT", String(r.corridor?.adt)],
    ["Posted speed", `${r.corridor?.postedSpeedMph} mph`],
  ]);
  doc.moveDown(0.5);
  doc.font("bold").fontSize(14).text("Verdict");
  doc.font("bold").fontSize(13).fillColor(BRAND_BLUE).text(String(r.overall?.verdict).replace(/_/g, " ").toUpperCase());
  doc.font("body").fillColor(TEXT_GRAY).fontSize(10);
  for (const reasoning of r.overall?.reasoning ?? []) doc.text("• " + reasoning);
  doc.fillColor("black");
  doc.moveDown(0.5);
  doc.font("bold").fontSize(14).text("Numbers");
  rows(doc, [
    ["Proposed direction capacity", `${r.capacity?.proposedCapacityVph} vph`],
    ["Projected peak-hour demand", `${r.capacity?.projectedPeakHourVph} vph`],
    ["v/c", String(r.capacity?.vOverC)],
    ["Headroom", r.capacity?.headroom],
    ["Estimated crash reduction", `${r.safety?.estimatedReductionPct}%`],
    ["Crashes prevented (est)", r.safety?.estimatedCrashesPrevented !== null ? String(r.safety?.estimatedCrashesPrevented) : "—"],
  ]);
}

function renderGenericJson(doc: PDFKit.PDFDocument, r: any) {
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("This study type has no PDF-specific renderer yet. The raw report payload follows:");
  doc.moveDown(0.5);
  doc.font("mono").fillColor("black").fontSize(9).text(JSON.stringify(r, null, 2));
}

// ---------- Layout primitives ----------

function section(doc: PDFKit.PDFDocument, title: string) {
  // Reset to left margin — previous renderers (rows, table, text wrapped
  // across columns) leave doc.x offset, which would otherwise wrap
  // the heading into a thin column at whatever x the cursor was at.
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(13).fillColor("black").text(title);
  doc.moveDown(0.3);
  doc.x = PAGE_MARGIN;
}

function rows(doc: PDFKit.PDFDocument, pairs: [string, string | undefined][]) {
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

type TableSpec = {
  headers: string[];
  widths: number[];
  align?: Array<"left" | "right" | "center">;
  rows: string[][];
};

/**
 * Lightweight tabular layout. Auto-paginates by checking remaining space
 * before each row and inserting a page break when needed.
 */
function table(doc: PDFKit.PDFDocument, spec: TableSpec) {
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
        .fontSize(isHeader ? 9 : 9)
        .fillColor(isHeader ? "black" : "black")
        .text(cells[i] ?? "", x + 4, y + (isHeader ? 5 : 3), {
          width: w - 8,
          align: a,
          lineBreak: false,
          ellipsis: true,
        });
      x += w;
    }
  };
  // Header
  let y = doc.y;
  drawRow(headers, y, true);
  y += headerH;
  // Rows with pagination
  for (const r of dataRows) {
    if (y + rowH > doc.page.height - PAGE_MARGIN - 40) {
      doc.addPage();
      y = doc.y;
      drawRow(headers, y, true);
      y += headerH;
    }
    drawRow(r, y, false);
    // Light separator
    doc.strokeColor("#e5e7eb").lineWidth(0.5)
      .moveTo(startX, y + rowH).lineTo(startX + widths.reduce((s, w) => s + w, 0), y + rowH).stroke();
    y += rowH;
  }
  doc.y = y + 4;
  doc.x = PAGE_MARGIN;
}

type Metric = { label: string; value: string };

function metricStrip(doc: PDFKit.PDFDocument, metrics: Metric[]) {
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

function studyLabel(type: string): string {
  switch (type) {
    case "tis": return "Traffic Impact Study";
    case "parking": return "Parking Demand Study";
    case "warrants": return "Signal Warrant Analysis";
    case "sight_distance": return "Sight Distance Analysis";
    case "queuing": return "Queuing Analysis";
    case "road_diet": return "Road-Diet Feasibility Screening";
    default: return type.toUpperCase();
  }
}
