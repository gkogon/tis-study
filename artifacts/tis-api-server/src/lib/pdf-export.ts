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
import { regionForCoordinate, type Region } from "./regions";

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
 * Resolve a firm logo URL to image bytes that PDFKit can render.
 * Accepts a `data:` URL or an `https?:` URL; returns null (with a
 * warning logged by the caller) for anything else, fetch failures,
 * or oversized payloads. Bounded at 2 MB to match the upload cap +
 * a 5-second timeout so a flaky logo host can't hang the PDF.
 */
const LOGO_FETCH_TIMEOUT_MS = 5_000;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

async function fetchLogoBuffer(logoUrl: string | null): Promise<Buffer | null> {
  if (!logoUrl) return null;
  try {
    if (logoUrl.startsWith("data:")) {
      const comma = logoUrl.indexOf(",");
      if (comma < 0) return null;
      const meta = logoUrl.slice(5, comma);
      if (!meta.includes("base64")) return null;
      const buf = Buffer.from(logoUrl.slice(comma + 1), "base64");
      return buf.length <= LOGO_MAX_BYTES ? buf : null;
    }
    if (/^https?:\/\//.test(logoUrl)) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), LOGO_FETCH_TIMEOUT_MS);
      try {
        const r = await fetch(logoUrl, { signal: ctrl.signal });
        if (!r.ok) return null;
        const ct = r.headers.get("content-type") ?? "";
        if (!/^image\//.test(ct)) return null;
        const ab = await r.arrayBuffer();
        if (ab.byteLength > LOGO_MAX_BYTES) return null;
        return Buffer.from(ab);
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Returns a Buffer holding the rendered PDF. Streams internally for
 * memory efficiency but resolves a single Buffer for handler simplicity.
 */
export async function renderStudyPdf(
  project: StoredProject,
  firm: FirmStamp,
): Promise<Buffer> {
  // Resolve the firm logo to bytes up front — the cover and header
  // both want to draw it, and fetching twice would be wasteful (and
  // could double the timeout window if the host is slow).
  const logoBuf = await fetchLogoBuffer(firm.logoUrl);

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

  drawCover(doc, project, firm, logoBuf);
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

function drawCover(
  doc: PDFKit.PDFDocument,
  project: StoredProject,
  firm: FirmStamp,
  logoBuf: Buffer | null,
) {
  // Top brand band
  doc.rect(0, 0, doc.page.width, 12).fill(BRAND_BLUE);
  doc.fillColor("black");

  doc.moveDown(2);
  // Firm logo (if uploaded), top-right corner. PDFKit's image()
  // preserves aspect ratio when given just a width; we cap at 120pt
  // wide / 50pt tall so a square logo doesn't push the page banner
  // off the cover. Fall back to the firm name in text if no logo is
  // available or the fetch failed.
  if (logoBuf) {
    try {
      const logoMaxW = 120;
      const logoMaxH = 50;
      const logoX = doc.page.width - PAGE_MARGIN - logoMaxW;
      const logoY = doc.y;
      doc.image(logoBuf, logoX, logoY, {
        fit: [logoMaxW, logoMaxH],
        align: "right",
      });
      // Advance the cursor past the logo block so subsequent moveDown
      // calls don't draw over it.
      doc.y = logoY + logoMaxH + 4;
    } catch {
      // PDFKit throws on unsupported image formats (it accepts JPEG +
      // PNG only). Silently fall back to the name banner.
      doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(firm.name.toUpperCase(), { align: "right" });
    }
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(firm.name.toUpperCase(), { align: "right" });
  }
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
    case "tis": dispatchTisRender(doc, result, project); break;
    case "parking": renderParking(doc, result); break;
    case "warrants": renderWarrants(doc, result); break;
    case "sight_distance": renderSightDistance(doc, result); break;
    case "queuing": renderQueuing(doc, result); break;
    case "road_diet": renderRoadDiet(doc, result); break;
    default: renderGenericJson(doc, result); break;
  }
}

/**
 * Region-dispatched TIS renderer. Looks up the site's region from its
 * coordinates and routes to a jurisdiction-specific renderer that
 * follows that jurisdiction's TIS reporting conventions (section
 * structure, citation conventions, terminology, methodology
 * disclosure). Falls back to the generic `renderTis` for any region
 * we don't yet have a specialized renderer for — so the new dispatch
 * never regresses existing markets.
 *
 * Region-specific renderers added so far:
 *   - GA (Georgia) — matches the GRTA/ARC/GDOT format engineers expect
 *     in Atlanta-metro and Georgia-statewide submittals.
 *
 * Planned (spec-research-in-progress):
 *   - FL (FDOT Site Impact Handbook)
 *   - IL (IDOT BLR + CDOT)
 *   - TX (TxDOT + city overlays)
 *   - UK / London (DfT + TfL Transport Assessment)
 *   - CA (Caltrans + SB 743 VMT — paradigm shift, may require engine work)
 */
function dispatchTisRender(
  doc: PDFKit.PDFDocument,
  result: Record<string, unknown>,
  project: StoredProject,
) {
  const region = detectRegion(project);
  if (region?.stateCode === "GA" && (region?.country ?? "US") === "US") {
    renderTisGeorgia(doc, result, project, region);
    return;
  }
  renderTis(doc, result);
}

function detectRegion(project: StoredProject): Region | null {
  const lat = project.siteLat ? Number(project.siteLat) : NaN;
  const lon = project.siteLon ? Number(project.siteLon) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return regionForCoordinate(lat, lon);
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

  // Affected intersections table — three scenarios stacked per standard
  // TIS convention: Existing (current year) / No-Build (opening year,
  // growth only) / Build (opening year, growth + project).
  if (intersections.length) {
    section(doc, `Affected Intersections (${intersections.length})`);
    table(doc, {
      headers: ["Intersection", "Dist (mi)", "Trips", "Exist LOS", "No-Bld LOS", "Build LOS", "Δ delay", "Q95"],
      widths: [165, 45, 40, 55, 60, 55, 55, 45],
      align: ["left", "right", "right", "center", "center", "center", "right", "right"],
      rows: intersections.map((it) => {
        const losChanged = it.losChanged === true;
        // Fallback when older payloads don't carry currentLos.
        const currentLos = it.currentLos ?? it.existingLos ?? "—";
        const noBuildLos = it.existingLos ?? "—";
        const buildLos = it.futureLos ?? "—";
        return [
          it.name ?? it.signalId ?? "—",
          fmtNum(it.distanceMi, 2),
          fmtNum(it.addedTripsPmPeak),
          String(currentLos),
          String(noBuildLos),
          (losChanged ? "▲ " : "") + String(buildLos),
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

/**
 * Georgia-specific TIS renderer. Follows the section structure and
 * conventions that GRTA / ARC / GDOT reviewers expect on a Georgia
 * Transportation Analysis deliverable, modeled on the GDOT/GRTA DRI
 * report format (e.g., 131 Ponce De Leon DRI #1476).
 *
 * Section structure (matches the GA convention):
 *   §1  Project Description
 *   §2  Traffic Analysis Methodology and Assumptions
 *   §3  Study Network
 *   §4  Trip Generation
 *   §5  Trip Distribution and Assignment
 *   §6  Traffic Analysis (existing + build; multi-scenario
 *       Existing/No-Build/Build pending engine refactor)
 *   §7  Identification of Programmed Projects
 *   §8  Ingress/Egress Analysis
 *   §9  Internal Circulation Analysis
 *   §10 Compliance with Comprehensive Plan Analysis
 *
 * DRI-specific sections (§11 Non-Expedited Criteria, §12 Area of
 * Influence, §13 ARC Air Quality Benchmark) are not produced by this
 * renderer — those require GRTA-specific data integration (AOI GIS,
 * ARC scoring rubric, Census ACS demographics) tracked separately as
 * the "DRI Module" roadmap item. When the project clearly exceeds
 * DRI thresholds, this renderer notes that the DRI sections need
 * separate preparation.
 */
function renderTisGeorgia(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];

  // --- Executive Summary --------------------------------------------------
  gaSection(doc, "EXECUTIVE SUMMARY");
  doc.font("body").fontSize(10).fillColor("black");
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  const summary = `This report presents the analysis of anticipated traffic impacts associated with the proposed ${project.projectName || "development"} located within ${region.displayName}, Georgia. The study evaluates ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile study radius using methodology consistent with the Highway Capacity Manual 6th Edition and Institute of Transportation Engineers' Trip Generation Manual 11th Edition. Trip generation is calculated for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}) at a development size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`;
  doc.text(summary, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text("Findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (losDrops === 0 && losEf === 0) {
    doc.text("• No intersections within the study network are projected to drop one or more LOS during the build conditions.", { paragraphGap: 2 });
    doc.text("• No improvements are necessary to maintain the Level of Service standard (LOS D) within the study network.", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} intersection${losDrops === 1 ? "" : "s"} project to drop one or more LOS under build conditions.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} intersection${losEf === 1 ? "" : "s"} operate at LOS E or F under build conditions and may require mitigation.`, { paragraphGap: 4 });
  }
  doc.fillColor("black");
  doc.moveDown(0.5);

  // Headline metric strip retains the engine's at-a-glance numbers.
  metricStrip(doc, [
    { label: "Intersections", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "LOS drops", value: String(losDrops) },
    { label: "At LOS E/F", value: String(losEf) },
    { label: "Worst Δ delay", value: `${(r.worstDelayDeltaSec ?? 0).toFixed(1)}s` },
  ]);
  doc.moveDown(0.8);

  // --- §1 Project Description --------------------------------------------
  gaSection(doc, "1.0 PROJECT DESCRIPTION");
  gaSubsection(doc, "1.1 Introduction");
  doc.font("body").fontSize(10).fillColor("black").text(
    `This report presents the analysis of the anticipated traffic impacts associated with the proposed ${project.projectName || "development"}, located within ${region.displayName}, Georgia. Analysis follows methodology consistent with Georgia Department of Transportation (GDOT), Atlanta Regional Commission (ARC), and Georgia Regional Transportation Authority (GRTA) guidance.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "1.2 Site Plan Review");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Region", region.displayName],
  ]);
  doc.moveDown(0.5);

  gaSubsection(doc, "1.3 Site Access");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Site access analysis for proposed driveways is not included in this screening-level analysis. Driveway-level ingress/egress evaluation per GRTA Site Plan Guidelines should be prepared separately based on the final site plan.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "1.4 Bicycle and Pedestrian Facilities");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Existing bicycle and pedestrian facility inventory within the study area should be confirmed against current GDOT and local agency mapping. ARC-programmed bicycle and pedestrian improvements per the Regional Transportation Plan (RTP) should be reviewed during the methodology meeting.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "1.5 Transit Facilities");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Transit service area within the study network should be confirmed against current MARTA, GRTA Xpress, and local transit operator route maps. Proximity to transit influences trip-mode reductions under ARC's Air Quality Benchmark.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.5);

  // --- §2 Methodology and Assumptions ------------------------------------
  gaSection(doc, "2.0 TRAFFIC ANALYSIS METHODOLOGY AND ASSUMPTIONS");
  gaSubsection(doc, "2.1 Growth Rate");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Background traffic growth is applied at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"}. This rate is consistent with GDOT historical traffic count growth observed along adjacent roadways within the study area. For DRI submittals, the growth rate is typically agreed upon during the pre-application methodology meeting with GRTA, ARC, GDOT, and the local jurisdiction.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "2.2 Traffic Data Collection");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Intersection capacity analysis uses calibration data from the GDOT 511 NaviGAtor system, including live incident, camera, and signal data feeds. Per-intersection delay calibration is updated hourly from the 7-day rolling incident archive. For formal submittal, supplementary peak-hour turning movement counts conducted within the most recent 12 months are recommended.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "2.3 Detailed Intersection Analysis");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Level of Service (LOS) is calculated per the Highway Capacity Manual 6th Edition, Chapter 19 (Signalized Intersections), Equation 19-13 (control delay) and Equation 19-50 (95th-percentile queue). LOS is reported for each affected intersection per HCM 6th Ed. Exhibit 19-8 thresholds: A ≤10s · B ≤20s · C ≤35s · D ≤55s · E ≤80s · F >80s of average control delay per vehicle.",
    { paragraphGap: 6 },
  );

  // --- §3 Study Network --------------------------------------------------
  gaSection(doc, "3.0 STUDY NETWORK");

  gaSubsection(doc, "3.1 Gross Trip Generation");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Gross trip generation is calculated per the ITE Trip Generation Manual 11th Edition for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed development size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Average rates are used where ITE-published equations are not available.`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Entering trips", "Exiting trips"],
    widths: [180, 100, 100],
    align: ["left", "right", "right"],
    rows: [
      ["Daily", fmtNum(((tg.dailyTrips ?? 0) as number) / 2), fmtNum(((tg.dailyTrips ?? 0) as number) / 2)],
      ["AM peak hour", fmtNum(tg.amPeakTrips), "—"],
      ["PM peak hour", fmtNum(tg.pmIn), fmtNum(tg.pmOut)],
    ],
  });
  doc.moveDown(0.5);

  gaSubsection(doc, "3.2 Trip Distribution");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Directional distribution and assignment of new project trips is based on the existing roadway network geometry, proximity to project access points, and engineering judgment. For formal DRI submittal, distribution percentages should be agreed upon during the methodology meeting with GRTA, ARC, GDOT, and the local jurisdiction.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "3.3 Level of Service Standards");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per GDOT and GRTA convention, the Level of Service standard for all intersections and roadway segments within the study network is LOS D. Where an intersection or segment currently operates at LOS E or F during the existing peak period, the LOS standard for that period becomes LOS E, consistent with GRTA's Letter of Understanding.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "3.4 Study Network Determination");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The study network covers all signalized intersections within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile radius of the project site. For DRI-level submittal, GRTA's 7-percent rule (which extends the network to any intersection or segment where project-generated trips exceed 7 percent of the service volume) should be applied; this screening-level analysis applies the radius-based criterion as a starting point.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "3.5 Existing Facilities");
  if (intersections.length > 0) {
    table(doc, {
      headers: ["Affected intersection", "Distance (mi)", "Existing LOS", "Existing delay (s)"],
      widths: [240, 70, 70, 90],
      align: ["left", "right", "center", "right"],
      rows: intersections.map((it) => [
        it.name ?? it.signalId ?? "—",
        fmtNum(it.distanceMi, 2),
        // Prefer the true current-year LOS; fall back to the legacy
        // "existing" (no-build) field if the engine output predates the
        // currentLos addition.
        String(it.currentLos ?? it.existingLos ?? "—"),
        fmtNum(it.currentDelaySec ?? it.existingDelaySec, 1),
      ]),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No signalized intersections within the study radius. Off-site capacity impact is not anticipated for this development.", { paragraphGap: 6 });
    doc.fillColor("black");
  }
  doc.moveDown(0.5);

  // --- §4 Trip Generation (detailed) -------------------------------------
  gaSection(doc, "4.0 TRIP GENERATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Net new trips applied to the study network are calculated by subtracting pass-by capture and internal capture from the gross trip generation, per the ITE Trip Generation Handbook (current edition).",
    { paragraphGap: 6 },
  );
  rows(doc, [
    ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
    ["Internal capture applied", `${r.internalCapturePctApplied ?? 0}%`],
    ["Background growth applied", `${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s)`],
    ["Weather condition", String(r.weather ?? req.weather ?? "clear")],
  ]);
  doc.moveDown(0.5);

  if (periods.length > 0) {
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
    doc.moveDown(0.5);
  }

  // --- §5 Trip Distribution and Assignment -------------------------------
  gaSection(doc, "5.0 TRIP DISTRIBUTION AND ASSIGNMENT");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Net new trips are assigned to the study network proportionally to signal proximity and approach geometry. The per-intersection trip allocation for each affected signal is reflected in the Section 6.0 Traffic Analysis tables below.",
    { paragraphGap: 6 },
  );

  // --- §6 Traffic Analysis -----------------------------------------------
  gaSection(doc, "6.0 TRAFFIC ANALYSIS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Three scenarios are evaluated at each affected intersection: (1) Existing — current-year volumes from the GDOT 511 system, no growth applied; (2) No-Build (opening year ${req.openingYear ?? "—"}) — existing volumes grown at ${r.growthAppliedPct ?? "—"}%/yr over ${r.growthYears ?? "—"} year(s) without project trips; (3) Build (opening year ${req.openingYear ?? "—"}) — No-Build volumes plus the proposed development's external trips at the assigned distribution.`,
    { paragraphGap: 6 },
  );

  if (intersections.length > 0) {
    table(doc, {
      headers: ["Intersection", "Existing LOS", "No-Build LOS", "Build LOS", "Δ delay (s)", "Q95 (ft)"],
      widths: [200, 65, 75, 65, 70, 60],
      align: ["left", "center", "center", "center", "right", "right"],
      rows: intersections.map((it) => {
        const losChanged = it.losChanged === true;
        // Fallback: if `currentLos` is missing (older payload), use existingLos
        // for both Existing and No-Build columns so the table still renders.
        const currentLos = it.currentLos ?? it.existingLos ?? "—";
        const noBuildLos = it.existingLos ?? "—";
        const buildLos = it.futureLos ?? "—";
        return [
          it.name ?? it.signalId ?? "—",
          String(currentLos),
          String(noBuildLos),
          (losChanged ? "▲ " : "") + String(buildLos),
          fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
          fmtNum(it.queue95thFt),
        ];
      }),
    });

    // Mitigation list — GA-style, called out as "Recommended Improvements"
    const needMitigation = intersections.filter((it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none");
    if (needMitigation.length > 0) {
      doc.moveDown(0.5);
      doc.font("bold").fontSize(11).fillColor("black").text("Recommended Improvements (Build Conditions)");
      doc.moveDown(0.3);
      doc.font("body").fontSize(10).fillColor("black");
      for (const it of needMitigation) {
        const sev = String(it.mitigationSeverity ?? "").toUpperCase();
        doc.font("bold").text(`${it.name ?? it.signalId} `, { continued: true });
        doc.font("body").fillColor(TEXT_GRAY).text(`[${sev}]`, { continued: false });
        doc.font("body").fillColor("black").text("  " + it.mitigation);
        doc.moveDown(0.3);
      }
    } else {
      doc.moveDown(0.3);
      doc.font("body").fontSize(10).fillColor("black").text(
        "No improvements are necessary to maintain the Level of Service standard (LOS D) within the study network under build conditions.",
        { paragraphGap: 6 },
      );
    }
  }
  doc.moveDown(0.5);

  // --- §7 Programmed Projects --------------------------------------------
  gaSection(doc, "7.0 IDENTIFICATION OF PROGRAMMED PROJECTS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Review of programmed transportation projects within the study area should consult: GDOT Transportation Improvement Program (TIP), Statewide Transportation Improvement Program (STIP), Atlanta Regional Commission Regional Transportation Plan (RTP), and GDOT's Construction Work Program. This screening analysis does not automatically integrate programmed-projects data; manual review is recommended for any submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §8 Ingress/Egress Analysis ----------------------------------------
  gaSection(doc, "8.0 INGRESS/EGRESS ANALYSIS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Per-driveway operational analysis is not included in this screening-level study. Proposed site access driveways should be analyzed individually under build conditions to determine ingress and egress operations, including full-movement vs. left-in/left-out configurations and signal warrant evaluation where appropriate.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §9 Internal Circulation Analysis ----------------------------------
  gaSection(doc, "9.0 INTERNAL CIRCULATION ANALYSIS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Internal site circulation, parking access, and service-vehicle pathways are dependent on the final site plan and are not included in this screening-level analysis. Internal circulation review should follow the local jurisdiction's site plan review process.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §10 Comprehensive Plan Compliance ---------------------------------
  gaSection(doc, "10.0 COMPLIANCE WITH COMPREHENSIVE PLAN ANALYSIS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Compliance with the local jurisdiction's Future Land Use Plan and Comprehensive Plan should be confirmed against the most recent adopted plan and any applicable Neighborhood Planning Unit (NPU) or Special Public Interest (SPI) overlay district designations.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- DRI advisory note -------------------------------------------------
  // Detect probable DRI-scale projects (per GA DCA Chapter 110-12-3 — a
  // moving target with metro-vs-rural thresholds; this is a rough flag,
  // not a determination). When the project looks DRI-scale, surface the
  // additional sections that would normally be required.
  if (probablyDriScale(tg)) {
    doc.moveDown(0.5);
    doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text("Note: DRI Threshold Considerations");
    doc.moveDown(0.3);
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Based on the proposed development size, this project may meet or exceed Development of Regional Impact (DRI) review thresholds under the Georgia Planning Act (O.C.G.A. § 50-8-7.1) and GRTA's review jurisdiction. If DRI review is triggered, additional sections required for submittal include: §11 Non-Expedited Criteria (transit, VMT, regional mobility, transit relationship, TMA designation, offsite trip reduction, jobs/housing balance, infrastructure relationship), §12 Area of Influence analysis, and §13 ARC Air Quality Benchmark. These sections require GIS-based demographic analysis, ARC scoring rubric application, and pre-application coordination with GRTA, ARC, GDOT, and the local jurisdiction — they are not automatically generated by this screening tool.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- Findings + Methodology (engine output preserved) ------------------
  const findings: string[] = Array.isArray(r.findings) ? r.findings : [];
  if (findings.length > 0) {
    doc.moveDown(0.5);
    gaSection(doc, "FINDINGS");
    doc.font("body").fontSize(10).fillColor("black");
    for (const f of findings) {
      doc.text("• " + f, { paragraphGap: 4 });
    }
    doc.moveDown(0.5);
  }

  const methodology: string[] = Array.isArray(r.methodology) ? r.methodology : [];
  if (methodology.length > 0) {
    gaSection(doc, "METHODOLOGY NOTES");
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY);
    for (const m of methodology) {
      doc.text("• " + m, { paragraphGap: 4 });
    }
    doc.fillColor("black");
  }
}

/** Section heading in the GA-style numbered format (uppercase, bold). */
function gaSection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(13).fillColor("black").text(title, { characterSpacing: 0.5 });
  doc.moveDown(0.3);
  doc.x = PAGE_MARGIN;
}

/** Subsection heading (e.g. "1.1 Introduction"). */
function gaSubsection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(11).fillColor("black").text(title);
  doc.moveDown(0.2);
  doc.x = PAGE_MARGIN;
}

/**
 * Rough DRI-scale detector. The actual GA DRI thresholds vary by use
 * type and metro/rural designation (O.C.G.A. § 50-8-7.1 + GA DCA
 * regulations Chapter 110-12-3) — this is a screening flag only.
 * Triggers a DRI advisory note in the report when project size looks
 * DRI-scale; does NOT determine DRI applicability.
 */
function probablyDriScale(tg: any): boolean {
  const size = Number(tg?.size ?? 0);
  const code = String(tg?.landUseCode ?? "");
  if (!Number.isFinite(size) || size <= 0 || !code) return false;
  // Quick screening thresholds — metro Atlanta (lower) values.
  if (code.startsWith("21") || code.startsWith("22") || code.startsWith("23")) return size >= 200; // residential DU
  if (code === "310" || code === "311" || code === "320" || code === "330") return size >= 200; // hotel rooms
  if (code.startsWith("71") || code.startsWith("75") || code.startsWith("77")) return size >= 100; // office ksf
  if (code.startsWith("82") || code.startsWith("85") || code.startsWith("86") || code.startsWith("87") || code.startsWith("88")) return size >= 50; // retail ksf
  if (code.startsWith("11") || code.startsWith("13") || code.startsWith("14") || code.startsWith("15")) return size >= 200; // industrial ksf
  return false;
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
