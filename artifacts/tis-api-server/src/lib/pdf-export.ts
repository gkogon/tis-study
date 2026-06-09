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
  if (region?.stateCode === "TX" && (region?.country ?? "US") === "US") {
    renderTisTexas(doc, result, project, region);
    return;
  }
  // One UK renderer covers both England (ENG) and Scotland (SCT) regions —
  // they share the NPPF + TRICS + DMRB methodology stack even though the
  // referral / planning regimes diverge (GLA referral is London-only).
  if (region?.country === "UK") {
    renderTisLondon(doc, result, project, region);
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
 * London Transport Assessment renderer. First non-US state-specific
 * renderer. Frames the engine's HCM-based output in UK Transport
 * Assessment terminology following the TfL Healthy Streets TA
 * Recommended Contents & Chapters TOC (8 chapters).
 *
 * Honest framing: the engine computes HCM 6 Ch.19 capacity from ITE
 * 11th Edition trip rates. A defensible UK TA requires TRICS multi-modal
 * rates + DMRB CD 116/123 capacity + PTAL + ATZ + Healthy Streets Check
 * — none of which the engine produces today. This renderer is a
 * screening-level cross-reference to UK methodology and names that
 * mismatch explicitly in §1.2. A chartered engineer preparing a
 * submitted TA must re-run the analysis on TRICS / DMRB tooling.
 *
 * Section structure (TfL Healthy Streets TA):
 *   Ch 1  Introduction (incl. methodology-mismatch disclosure)
 *   Ch 2  Transport planning for people (placeholder — needs demographics)
 *   Ch 3  Site and surroundings (PTAL placeholder, parking under London Plan T6)
 *   Ch 4  Active Travel Zone (placeholder — needs WebCAT isochrones)
 *   Ch 5  London-wide network (trip generation, assessment, mitigation
 *         framed as S106 / S278 / MCIL2)
 *   Ch 6  Additional borough analysis (placeholder — needs LPA Local Plan)
 *   Ch 7  Construction (placeholder — needs Construction Logistics Plan)
 *   Ch 8  Conclusion
 *
 * Mode share is applied per metro upstream (mode-share.ts, London 38%),
 * so the engine's external-trip count already reflects the car-mode
 * share. Surfaced in §1.2.
 */
function renderTisLondon(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];
  const isLondon = region.code === "london_metro";
  const lpa = isLondon ? "the relevant London borough (LPA)" : `${region.displayName} (LPA)`;

  // --- Executive Summary --------------------------------------------------
  ldnSection(doc, "EXECUTIVE SUMMARY");
  doc.font("body").fontSize(10).fillColor("black");
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  const radiusMi = Number(r.studyRadiusMi ?? req.studyRadiusMi ?? 0);
  const radiusKm = (radiusMi * 1.609344).toFixed(2);
  const summary = `This Transport Assessment cross-reference reports the anticipated transport effects of the proposed ${project.projectName || "development"} within ${region.displayName}, ${isLondon ? "Greater London" : "United Kingdom"}. ${intersections.length} junction${intersections.length === 1 ? "" : "s"} fall within a ${radiusKm} km (${fmtNum(radiusMi, 2)} mi) study radius of the site. The analysis is screening-level and is prepared as a cross-reference to UK Transport Assessment methodology; it does not replace a TRICS-based TA prepared by a chartered engineer reviewing under the NPPF (December 2024), the Planning Practice Guidance on transport assessments, and (within Greater London) the London Plan 2021 and TfL Healthy Streets TA format.`;
  doc.text(summary, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text("Headline findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (losDrops === 0 && losEf === 0) {
    doc.text("• No junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario.", { paragraphGap: 2 });
    doc.text("• Highway capacity is not the limiting factor for this scheme on the basis of this screening; PTAL-banded car parking, sustainable-mode uptake and Healthy Streets compliance remain to be assessed separately.", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} junction${losDrops === 1 ? "" : "s"} project to deteriorate by one or more LOS categories under the With-Development scenario.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} junction${losEf === 1 ? " operates" : "s operate"} at LOS E or F under With-Development and would warrant mitigation under either S106 obligation or S278 highway works (depending on the responsible authority).`, { paragraphGap: 4 });
  }
  doc.fillColor("black");
  doc.moveDown(0.5);

  metricStrip(doc, [
    { label: "Junctions", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "LOS drops", value: String(losDrops) },
    { label: "At LOS E/F", value: String(losEf) },
    { label: "Worst Δ delay", value: `${(r.worstDelayDeltaSec ?? 0).toFixed(1)}s` },
  ]);
  doc.moveDown(0.8);

  // --- Ch 1 Introduction --------------------------------------------------
  ldnSection(doc, "1.0 INTRODUCTION");
  ldnSubsection(doc, "1.1 Purpose and Planning Context");
  doc.font("body").fontSize(10).fillColor("black").text(
    `This report cross-references the anticipated transport effects of the proposed ${project.projectName || "development"}, located within ${region.displayName}. It is presented in the structure of a UK Transport Assessment (TA) as set out in the TfL Healthy Streets TA Recommended Contents & Chapters, with the National Planning Policy Framework (NPPF, December 2024) as the statutory planning hook — paragraph 115 (sustainable modes), paragraph 116 (significant transport impact) and paragraph 118 (vision-led TA / TS). Where the proposed development falls below the local planning authority's "significant amount of movement" trigger a Transport Statement (TS) may suffice in place of a full TA; the threshold is judgement-led by ${lpa}.`,
    { paragraphGap: 6 },
  );

  ldnSubsection(doc, "1.2 Methodology Cross-Reference and Disclosure");
  doc.font("body").fontSize(10).fillColor("black").text(
    "This is the critical disclosure for a UK reviewer. The analysis in this report is generated by a screening engine calibrated to United States standards and is presented here as a cross-reference to UK methodology, not as a substitute for it:",
    { paragraphGap: 4 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  doc.text("• Capacity analysis uses the Highway Capacity Manual 6th Edition, Chapter 19 (signalised junctions) — NOT DMRB CD 116 (roundabouts) or CD 123 (priority and signal junctions). A chartered engineer preparing a submitted TA should re-run the affected junctions in LinSig 3, TRANSYT 16, or Junctions 11 (with ARCADY / PICADY / OSCADY modules as appropriate) and report Ratio of Flow to Capacity (RFC), Degree of Saturation (DOS), Practical Reserve Capacity (PRC) and Mean Maximum Queue (MMQ in PCUs).", { paragraphGap: 4 });
  doc.text("• Trip generation uses the ITE Trip Generation Manual 11th Edition — NOT TRICS. UK reviewers do not accept ITE rates for TA work; the TRICS multi-modal database (85th-percentile rate as the starting point per DfT 2007 §4.62, with the scenario filter — date band, region, day type, parking provision, GFA range — recorded for reviewer audit) is the required source.", { paragraphGap: 4 });
  doc.text("• Level of Service is reported as letters A–F against the HCM Exhibit 19-8 control-delay thresholds (A ≤ 10 s, B ≤ 20 s, C ≤ 35 s, D ≤ 55 s, E ≤ 80 s, F > 80 s of average control delay per vehicle). LOS letters are not used in UK TA practice; the thresholds are given here so a UK reviewer can map them informally to the delay categories they recognise.", { paragraphGap: 4 });
  doc.text("• Sustainable-mode demand is approximated through a metro-specific auto-mode-share factor (38% applied for London, per the engine's mode-share configuration sourced from TfL Travel in London). The external-trip totals shown below already reflect that 38% reduction from the gross ITE rate. This is a screening-level approximation in place of the full multi-modal split (walking / cycling / bus / rail / car / taxi / motorcycle / LGV / HGV) that a UK TA is required to demonstrate under NPPF paragraph 115.", { paragraphGap: 4 });
  doc.text("• Geometric design citations in the engine's output are HCM and AASHTO; UK chartered review would substitute DMRB CD 109 / CD 116 / CD 122 / CD 123 (trunk) and Manual for Streets / Manual for Streets 2 (urban / residential).", { paragraphGap: 4 });
  doc.text("• Units are metric where derivable; some engine-generated fields remain in imperial (queue 95th-percentile reported in feet rather than MMQ in PCUs) and are flagged inline.", { paragraphGap: 6 });
  doc.fillColor("black");
  doc.font("body").fontSize(10).fillColor("black").text(
    "In short: treat the LOS / delay / queue numbers in this report as a sanity check on capacity-driven impact, not as the capacity assessment a submitted TA requires. The PTAL band, Active Travel Zone, Healthy Streets Indicators check and TRICS-derived multi-modal trip generation are the deliverables a London TA actually stands on — they are listed as placeholders below.",
    { paragraphGap: 6 },
  );

  ldnSubsection(doc, "1.3 Policy Context");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Applicable policy framework, in order: NPPF Chapter 9 (Promoting sustainable transport, December 2024 edition); Planning Practice Guidance — Travel plans, transport assessments and statements${isLondon ? "; the London Plan 2021 (in particular policies T1 Strategic approach to transport, T2 Healthy Streets, T5 Cycling, and T6 Car parking sub-policies banded by PTAL); the Mayor's Transport Strategy 2018 (the 80% sustainable-mode-share target by 2041); and the local borough Local Plan and any borough Supplementary Planning Documents on parking, travel plans and S106" : "; and the local development plan adopted by " + region.displayName}.`,
    { paragraphGap: 6 },
  );

  ldnSubsection(doc, "1.4 Vision-Led Approach");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "NPPF (December 2024) paragraph 118 frames TAs and TSs as \"vision-led\" — the assessment should articulate the place outcome the scheme seeks and demonstrate how transport supports that vision, before reporting capacity numbers. The vision-led narrative is bespoke to the scheme and is not produced by this screening report; it should be drafted by the chartered engineer in consultation with the design team.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- Ch 2 Transport planning for people ---------------------------------
  ldnSection(doc, "2.0 TRANSPORT PLANNING FOR PEOPLE");
  ldnSubsection(doc, "2.1 Site Demographics");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    `Demographic context within the site catchment (2021 Census MSOA / ward profile, GLA population projections, journey-to-work mode share) is not produced by this screening engine. It should be drawn from the London Datastore (data.london.gov.uk) for ${isLondon ? "the relevant ward and MSOA" : "the relevant UK ward and MSOA"} at the time of submittal.`,
    { paragraphGap: 6 },
  );
  ldnSubsection(doc, "2.2 Transport Classification of Londoners (ToL)");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "TfL's Transport Classification of Londoners segments residents into travel-attitude groups for use in TA work. ToL is not produced here and should be drawn from TfL Insight at the time of submittal.",
    { paragraphGap: 6 },
  );
  ldnSubsection(doc, "2.3 Equality and Inclusion");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Equality and inclusion considerations (step-free access, the Public Sector Equality Duty under the Equality Act 2010) require a bespoke assessment against the proposed access strategy and are not generated by the engine.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- Ch 3 Site and surroundings -----------------------------------------
  ldnSection(doc, "3.0 SITE AND SURROUNDINGS");
  ldnSubsection(doc, "3.1 Site Identification");
  rows(doc, [
    ["Scheme", project.projectName || "—"],
    ["Land use (ITE proxy)", `${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Region", region.displayName],
    ["Highway authority(ies)", isLondon ? "Transport for London (TLRN / red routes), the relevant London borough (borough roads); National Highways for any affected SRN length" : "Local highway authority for the area"],
    ["Local planning authority", lpa],
  ]);
  doc.moveDown(0.4);

  ldnSubsection(doc, "3.2 Public Transport Accessibility Level (PTAL)");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    isLondon
      ? "PTAL is mandatory in every London TA. The site's PTAL band (0, 1a, 1b, 2, 3, 4, 5, 6a, 6b) and Accessibility Index (AI) value are not computed by this engine; they should be drawn from the TfL 100 m × 100 m PTAL grid via WebCAT 3.0 (tfl.gov.uk planning-with-webcat) or the GIS layer on the London Datastore. PTAL band determines the car-parking maximum under London Plan policy T6 sub-policies (Tables 10.3–10.6) — PTAL 5 / 6a / 6b is a car-free starting point in policy."
      : "Public-transport accessibility metrics for non-London UK metros vary by combined authority and are not standardised; the local authority's adopted methodology should be applied.",
    { paragraphGap: 6 },
  );

  ldnSubsection(doc, "3.3 Active Travel Network");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    isLondon
      ? "Cycle infrastructure within 1 km of the site (Cycleways, segregated lanes, Advanced Stop Lines, cycle parking) should be drawn from the TfL Cycle Infrastructure Database (cycling.data.tfl.gov.uk). Strategic Cycling Analysis corridors should be flagged where the site falls on or near one. The walking environment should be assessed against CIHT Planning for Walking."
      : "Active-travel network inventory should be drawn from the local highway authority's mapping at the time of submittal.",
    { paragraphGap: 6 },
  );

  ldnSubsection(doc, "3.4 Healthy Streets Indicators");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    isLondon
      ? "TfL's 10 Healthy Streets Indicators are required for any London TA; the Healthy Streets Check for Designers workbook (31 metrics, XLSX) should be completed for both existing and proposed conditions and surfaced as an appendix. This screening engine does not run the Healthy Streets Check."
      : "Where the local authority operates a Healthy Streets or equivalent framework, the relevant check should be appended.",
    { paragraphGap: 6 },
  );

  ldnSubsection(doc, "3.5 Car and Cycle Parking");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    isLondon
      ? "Cycle parking provision is set by London Plan policy T5 / Table 10.2. Car-parking maxima are set by London Plan policy T6 sub-policies (Tables 10.3–10.6), banded by PTAL and use class. Borough Supplementary Planning Documents may impose tighter local standards. Neither standard is automatically determined by this engine; both should be calculated against the final scheme at the chartered-engineer stage."
      : "Parking provision should be assessed against the adopted local plan parking standards for the area.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- Ch 4 Active Travel Zone --------------------------------------------
  ldnSection(doc, "4.0 ACTIVE TRAVEL ZONE (ATZ)");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    isLondon
      ? "The Active Travel Zone — the 20-minute cycle catchment from the site — is required in Chapter 4 of a TfL Healthy Streets TA, generated through WebCAT 3.0. Walking catchments (5 / 10 / 15-minute isochrones) should also be reported. Severance, desire-line analysis and any constraints in the catchment (Healthy Streets Indicators applied at the catchment scale) should be discussed. The engine does not produce isochrones; the WebCAT export should be included as an appendix."
      : "Where applicable, an active-travel catchment analysis should be appended.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- Ch 5 London-wide network -------------------------------------------
  ldnSection(doc, "5.0 LONDON-WIDE NETWORK");
  ldnSubsection(doc, "5.1 Trip Generation (Engine — ITE 11th proxy)");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Gross trip generation in this report is calculated per the ITE Trip Generation Manual 11th Edition for land-use code ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. The TRICS-equivalent multi-modal table — person-trips by mode, linked PT trips, 85th-percentile rate against the agreed TRICS filter — is not produced by this engine and must be prepared separately for any submitted TA. The figures below represent the engine's car-mode estimate after the London 38% auto-mode-share factor has been applied to net out walking, cycling, bus, rail and other modes.`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Entering trips", "Exiting trips"],
    widths: [180, 100, 100],
    align: ["left", "right", "right"],
    rows: [
      ["Daily", fmtNum(((tg.dailyTrips ?? 0) as number) / 2), fmtNum(((tg.dailyTrips ?? 0) as number) / 2)],
      ["AM peak hour (08:00–09:00)", fmtNum(tg.amPeakTrips), "—"],
      ["PM peak hour (17:00–18:00)", fmtNum(tg.pmIn), fmtNum(tg.pmOut)],
    ],
  });
  doc.moveDown(0.4);

  rows(doc, [
    ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
    ["Internalisation (linked trips) applied", `${r.internalCapturePctApplied ?? 0}%`],
    ["Background growth applied", `${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s)`],
    ["Auto-mode-share factor (London)", "38% (Travel in London — already applied upstream)"],
  ]);
  doc.moveDown(0.4);

  if (periods.length > 0) {
    table(doc, {
      headers: ["Period", "Raw", "Pass-by", "Linked", "Net car", "In", "Out"],
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
    doc.moveDown(0.4);
  }

  ldnSubsection(doc, "5.2 Trip Distribution and Assignment");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Net car trips are assigned to the study network proportionally to junction proximity (gravity-model assignment, volume × distance⁻¹·⁵). For a submitted TA, distribution should be agreed in the scoping note signed by the LPA and (in London) TfL; for major schemes affecting the TLRN, TfL's strategic models (MoTiON for demand, LoHAM and the sub-regional HAMs for highway assignment, Railplan for PT) would be referenced and may need to be run under TfL's Model Auditing Process (MAP v4).",
    { paragraphGap: 6 },
  );

  ldnSubsection(doc, "5.3 Assessment Years");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Three scenarios are reported per affected junction: (1) Existing — current-year baseline, no growth applied; (2) No-Build (opening year ${req.openingYear ?? "—"}) — baseline grown at ${r.growthAppliedPct ?? "—"}%/yr over ${r.growthYears ?? "—"} year(s) without scheme trips; (3) With-Development (opening year ${req.openingYear ?? "—"}) — No-Build volumes plus the scheme's net car trips at the assigned distribution. A submitted TA conventionally also reports a design-year horizon (commonly opening + 5 or +10 years).`,
    { paragraphGap: 6 },
  );

  ldnSubsection(doc, "5.4 Assessment of Junction Impact");
  if (intersections.length > 0) {
    table(doc, {
      headers: ["Junction", "Existing LOS", "No-Build LOS", "With-Dev LOS", "Δ delay (s)", "Queue 95% (ft)*"],
      widths: [195, 60, 70, 70, 65, 70],
      align: ["left", "center", "center", "center", "right", "right"],
      rows: intersections.map((it) => {
        const losChanged = it.losChanged === true;
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
    doc.moveDown(0.3);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "* Queue is the engine's HCM 95th-percentile in feet (not MMQ in PCUs as a UK reviewer would expect). LOS letters map informally to delay categories — see §1.2.",
      { paragraphGap: 4 },
    );
    doc.fillColor("black");
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No signalised junctions within the study radius. No off-network capacity impact is anticipated at the screening level.", { paragraphGap: 6 });
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  ldnSubsection(doc, "5.5 Design Solutions and Mitigation");
  const needMitigation = intersections.filter((it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none");
  if (needMitigation.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      isLondon
        ? "The following screening-level mitigations are flagged. Each would be secured through one of: S106 planning obligation (Town and Country Planning Act 1990 s.106) — for off-site contributions, travel plan funding and monitoring fees; S278 highway works agreement (Highways Act 1980 s.278) — for physical works on the public highway, with the borough for borough roads or with TfL for the TLRN; or, where applicable, the Mayoral Community Infrastructure Levy (MCIL2). New estate roads are adopted under S38. The responsible authority for each junction must be confirmed against its highway-authority designation (borough / TLRN / SRN)."
        : "The following screening-level mitigations are flagged. Each would be secured through S106 planning obligation or S278 highway works agreement with the responsible highway authority.",
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
      "No screening-level mitigations are indicated under the With-Development scenario. A chartered engineer should still verify against DMRB CD 116 / CD 123 capacity and the relevant TfL / borough operational standards before concluding no mitigation is required.",
      { paragraphGap: 6 },
    );
  }
  doc.moveDown(0.3);

  // --- Ch 6 Additional borough analysis -----------------------------------
  ldnSection(doc, "6.0 ADDITIONAL BOROUGH / LPA ANALYSIS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    isLondon
      ? "Borough-level analysis — relevant Local Plan policies, Supplementary Planning Documents (parking, cycle parking, travel plan, S106 SPD), and any local cumulative-impact assessment drawn from the Planning London Datahub (PLD) approved-development pipeline — is bespoke to the host borough and is not produced by this screening engine."
      : "Local-authority-specific policies (Local Plan, Supplementary Planning Documents, parking standards) are not produced by this screening engine.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- Ch 7 Construction --------------------------------------------------
  ldnSection(doc, "7.0 CONSTRUCTION");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "A Construction Logistics Plan (CLP) and Delivery and Servicing Plan (DSP) are required at submittal and are not produced by this screening engine; they should be prepared in line with TfL's published CLP guidance and (where the site fronts a TLRN red route) the TLRN servicing rules.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- Ch 8 Conclusion ----------------------------------------------------
  ldnSection(doc, "8.0 CONCLUSION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `On the basis of the screening-level cross-reference set out above, ${losDrops === 0 && losEf === 0 ? "no junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario, and capacity is not the limiting factor on this analysis." : `${losDrops} junction(s) project to deteriorate by one or more LOS categories under the With-Development scenario and ${losEf} junction(s) project to operate at LOS E or F, indicating mitigation would be warranted.`} The following deliverables remain outstanding and are required for a submittable London Transport Assessment:`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  doc.text("• TRICS multi-modal trip generation (85th-percentile, scenario filter recorded for reviewer audit).", { paragraphGap: 3 });
  if (isLondon) {
    doc.text("• PTAL band and Accessibility Index for the site centroid (TfL grid via WebCAT).", { paragraphGap: 3 });
    doc.text("• Active Travel Zone (20-minute cycle catchment) and walking isochrones from WebCAT.", { paragraphGap: 3 });
    doc.text("• Healthy Streets Check for Designers workbook (existing and proposed).", { paragraphGap: 3 });
  }
  doc.text("• Junction capacity analysis in LinSig 3 / Junctions 11 / TRANSYT / VISSIM as appropriate, reporting RFC, DOS, PRC and MMQ (PCUs).", { paragraphGap: 3 });
  doc.text("• Borough Local Plan and SPD compliance review.", { paragraphGap: 3 });
  doc.text("• S106 / S278 / MCIL2 contribution schedule per the agreed mitigation.", { paragraphGap: 3 });
  doc.text("• Travel Plan with named Travel Plan Coordinator, modal-shift targets, monitoring and remedial-measure ladder.", { paragraphGap: 3 });
  doc.text("• Construction Logistics Plan and Delivery and Servicing Plan.", { paragraphGap: 3 });
  doc.text("• Scoping note signed by the LPA" + (isLondon ? " and (for any TLRN-impacting or PSI-triggering scheme) TfL." : "."), { paragraphGap: 6 });
  doc.fillColor("black");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Sign-off should be by a Chartered Engineer (CEng) and Member of CIHT (MCIHT) under their professional registration; the PE stamp on the cover page is the US engine's default and should be replaced by the chartered engineer's signature block on submitted work.",
    { paragraphGap: 6 },
  );

  // --- Engine output preserved -------------------------------------------
  const findings: string[] = Array.isArray(r.findings) ? r.findings : [];
  if (findings.length > 0) {
    doc.moveDown(0.3);
    ldnSection(doc, "ENGINE FINDINGS (CROSS-REFERENCE)");
    doc.font("body").fontSize(10).fillColor("black");
    for (const f of findings) {
      doc.text("• " + f, { paragraphGap: 4 });
    }
    doc.moveDown(0.3);
  }

  const methodology: string[] = Array.isArray(r.methodology) ? r.methodology : [];
  if (methodology.length > 0) {
    ldnSection(doc, "ENGINE METHODOLOGY NOTES");
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY);
    for (const m of methodology) {
      doc.text("• " + m, { paragraphGap: 4 });
    }
    doc.fillColor("black");
  }
}

/** Section heading for the London renderer (same visual treatment as GA). */
function ldnSection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(13).fillColor("black").text(title, { characterSpacing: 0.5 });
  doc.moveDown(0.3);
  doc.x = PAGE_MARGIN;
}

/** Subsection heading for the London renderer. */
function ldnSubsection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(11).fillColor("black").text(title);
  doc.moveDown(0.2);
  doc.x = PAGE_MARGIN;
}

/**
 * Texas uses "TIA" (Traffic Impact Analysis), not "TIS". Statewide
 * procedure lives in TxDOT TSP Ch. 16 + Appendix Q, but Houston,
 * Austin, Dallas, Fort Worth, and San Antonio each publish their own
 * city-level TIA standards that materially differ. The renderer picks
 * the host-city section pack from site coords; outside all five city
 * envelopes we fall back to TxDOT-only framing.
 *
 * Bounds are rough city-envelope rectangles (not legal city limits) —
 * good enough for picking the citation pack. Source: visual bounds
 * from each city's published MSA boundary shapefile.
 */
type TxJurisdiction = "houston" | "austin" | "dallas" | "fortworth" | "sanantonio" | "txdot";

function txJurisdiction(lat: number, lon: number): TxJurisdiction {
  if (lat >= 29.5 && lat <= 30.1 && lon >= -95.8 && lon <= -95.0) return "houston";
  if (lat >= 30.1 && lat <= 30.5 && lon >= -97.95 && lon <= -97.55) return "austin";
  // Dallas / Fort Worth envelopes overlap in latitude — disambiguate by
  // longitude (FW sits ~30 mi west of Dallas core).
  if (lat >= 32.6 && lat <= 32.95 && lon >= -97.5 && lon <= -97.2) return "fortworth";
  if (lat >= 32.6 && lat <= 33.0 && lon >= -96.95 && lon <= -96.65) return "dallas";
  if (lat >= 29.3 && lat <= 29.7 && lon >= -98.7 && lon <= -98.3) return "sanantonio";
  return "txdot";
}

function renderTisTexas(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];

  const lat = Number(req.latitude ?? project.siteLat ?? NaN);
  const lon = Number(req.longitude ?? project.siteLon ?? NaN);
  const juris = Number.isFinite(lat) && Number.isFinite(lon) ? txJurisdiction(lat, lon) : "txdot";

  const cityName = {
    houston: "City of Houston",
    austin: "City of Austin",
    dallas: "City of Dallas",
    fortworth: "City of Fort Worth",
    sanantonio: "City of San Antonio",
    txdot: "TxDOT (no host-city overlay)",
  }[juris];
  const cityAuthority = {
    houston: "Houston Public Works — Office of the City Engineer (OCE), Traffic Group, per the 2023 Infrastructure Design Manual (IDM) Ch. 15 and the OCE TIA Content Guide.",
    austin: "Austin Transportation and Public Works — Transportation Development Services (TDS), per Land Development Code Ch. 25-6 (§25-6-117 TIA trigger), Transportation Criteria Manual §10, and the City of Austin TIA Guidelines (June 2022).",
    dallas: "Dallas Department of Transportation — Traffic Engineering, per Dallas Development Code §51A-4.803 (Site Plan Review) and Connect Dallas (Strategic Mobility Plan, adopted Apr 28, 2021).",
    fortworth: "Fort Worth Transportation & Public Works (TPW) — Traffic Engineering, per the City of Fort Worth Transportation Engineering Manual (June 2019) and the Master Thoroughfare Plan.",
    sanantonio: "San Antonio Development Services Department (DSD) — Land Development, per Unified Development Code §35-502 (TIA & Roughly Proportionate Determination) and UDC Appendix B §35-B122 (TIA Submittal Contents).",
    txdot: "the TxDOT District with jurisdiction over the host route (no incorporated host-city standard applies).",
  }[juris];
  const cityThreshold = {
    houston: "≥ ~100 new peak-hour trips (2023 IDM Ch. 15 — verify exact figure against current edition).",
    austin: "≥ 2,000 vpd net new trips (LDC §25-6-117). Below 2,000 vpd, a Neighborhood Traffic Analysis or TIA Determination Worksheet may still be required.",
    dallas: "no canonical figure published — consultant practice uses ~1,000 ADT (TIS Waiver form) or ~100 PHT. Flagged as ambiguous.",
    fortworth: "≥ 300 PHT or ≥ 5,000 ADT triggers a Full TIA; 100–299 PHT triggers an Abbreviated TIA; <100 PHT uses the TIA Worksheet only.",
    sanantonio: "≥ 75 peak-hour trips (UDC §35-502). Below 75 PHT, a Peak Hour Trip Generation Form only.",
    txdot: "no statewide trip-count trigger; TxDOT TSP Ch. 16 Categories 1 (100–499 PHT), 2 (500–1,000 PHT), 3 (>1,000 PHT) drive the level of effort.",
  }[juris];
  const cityLos = {
    houston: "Vehicle LOS (VLOS) per the 2023 IDM; LOS D was the historical target but the 2023 IDM demotes letter-grade LOS in favor of multimodal metrics.",
    austin: "LOS A–F (no VMT switch as of June 2022). Mitigation required when a movement drops from LOS D (No-Build) to LOS E (Build).",
    dallas: "Transitional — Connect Dallas (Apr 2021) is moving Dallas from LOS toward VMT. Practice currently uses LOS D suburban / LOS E in the CBD.",
    fortworth: "LOS D for arterials and collectors outside the CBD; LOS E in the CBD and Urban Villages.",
    sanantonio: "LOS D generally; LOS E inside Transit-Oriented Development overlays per UDC §35-208.",
    txdot: "no statewide LOS mandate — target is District-discretionary per TSP Ch. 16.",
  }[juris];
  const cityDeliverables = {
    houston: "TIA + Houston Access Form (mandatory for commercial sites) submitted via the Houston Permitting Center. Approval is required before plan submittal if no plat is required.",
    austin: "Three-tier process — (1) TIA Determination Worksheet → TDS portal, (2) Scope of Work submittal, (3) Full TIA — plus a Sustainable Modes Analysis within a TDM Plan. Scoping pre-approval is a hard gate before TIA submittal.",
    dallas: "No fixed required-elements list. Submittal carries the TxDOT-equivalent engineering tables/figures plus alignment with Connect Dallas and any PD-overlay traffic conditions. A TIS Waiver form is required when the threshold is not triggered.",
    fortworth: "Tiered deliverables (Worksheet <100 PHT · Abbreviated 100–299 PHT · Full TIA ≥300 PHT or ≥5,000 ADT). Full TIA requires a mitigation plan with cost/phasing referencing the Master Thoroughfare Plan and the NCTCOG Regional Thoroughfare Plan.",
    sanantonio: "TIA + Rough Proportionality cost calculation (mitigation cost capped at the maximum proportional impact, UDC §35-502). Pre-submittal scoping meeting with TCI + Public Works + Planning is mandatory.",
    txdot: "TIA accompanies a Driveway Access Permit (DAP) application submitted through the TxDOT District with jurisdiction over the route.",
  }[juris];

  // --- Executive Summary --------------------------------------------------
  gaSection(doc, "EXECUTIVE SUMMARY");
  doc.font("body").fontSize(10).fillColor("black");
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  const summary = `This Traffic Impact Analysis (TIA) presents the anticipated traffic impacts of the proposed ${project.projectName || "development"} located within ${region.displayName}, Texas. The study evaluates ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile study radius using methodology consistent with the Highway Capacity Manual 6th Edition, the ITE Trip Generation Manual 11th Edition, and TxDOT Traffic and Safety Analysis Procedures Manual (TSP) Chapter 16 — Traffic Impact Analysis. Trip generation is calculated for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}) at a development size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`;
  doc.text(summary, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text(`Reviewing authority: ${cityName}.`, { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(cityAuthority, { paragraphGap: 6 });
  doc.fillColor("black");

  doc.font("body").fontSize(10).fillColor("black").text("Findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (losDrops === 0 && losEf === 0) {
    doc.text("• No intersections within the study network are projected to drop one or more LOS under build conditions.", { paragraphGap: 2 });
    doc.text("• No mitigation is necessary to maintain the host-jurisdiction Level of Service standard within the study network.", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} intersection${losDrops === 1 ? "" : "s"} project to drop one or more LOS under build conditions.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} intersection${losEf === 1 ? "" : "s"} operate at LOS E or F under build conditions and may require mitigation per TxDOT TSP §16.4.3 and the host-city standard above.`, { paragraphGap: 4 });
  }
  doc.fillColor("black");
  doc.moveDown(0.5);

  metricStrip(doc, [
    { label: "Intersections", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "LOS drops", value: String(losDrops) },
    { label: "At LOS E/F", value: String(losEf) },
    { label: "Worst Δ delay", value: `${(r.worstDelayDeltaSec ?? 0).toFixed(1)}s` },
  ]);
  doc.moveDown(0.8);

  // --- §1 Introduction ---------------------------------------------------
  gaSection(doc, "1.0 INTRODUCTION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `This Traffic Impact Analysis follows the TxDOT Traffic and Safety Analysis Procedures Manual Chapter 16 outline (with Appendix Q as the structural reference) and is layered with the ${cityName} TIA standard where applicable. ${cityAuthority}`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    `Required submission: ${cityDeliverables}`,
    { paragraphGap: 6 },
  );
  if (juris === "dallas") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Dallas TIA standards are not consolidated into a single dated manual — review is partly discretionary under §51A-4.803 site plan review. This report aligns with the engineering tables and figures expected by Dallas DOT Traffic Engineering plus the multimodal context of Connect Dallas.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- §2 Project Description --------------------------------------------
  gaSection(doc, "2.0 PROJECT DESCRIPTION");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Region", region.displayName],
    ["Host jurisdiction", cityName],
  ]);
  doc.moveDown(0.5);

  // --- §3 Study Area -----------------------------------------------------
  gaSection(doc, "3.0 STUDY AREA");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The study area covers all signalized intersections within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile radius of the project site. Host-jurisdiction TIA threshold: ${cityThreshold}`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per TxDOT TSP §16.3 the study network is defined during the TxDOT-District scoping coordination. Where the project fronts a state-system roadway (IH / US / SH / FM / RM / BU / BS / SL / SS), a Driveway Access Permit (DAP) application under the Access Management Manual Ch. 3 §3 accompanies the TIA submittal.",
    { paragraphGap: 6 },
  );

  // --- §4 Existing Conditions --------------------------------------------
  gaSection(doc, "4.0 EXISTING CONDITIONS");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Existing geometry, signal timing, posted speed, and historical AADT for state-system routes are referenced from the TxDOT Statewide Planning Map, TxDOT Roadway Inventory (RHiNo), and the TxDOT Open Data Portal AADT layer. Crash history is sourced from the TxDOT Crash Records Information System (CRIS).",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    table(doc, {
      headers: ["Affected intersection", "Distance (mi)", "Existing LOS", "Existing delay (s)"],
      widths: [240, 70, 70, 90],
      align: ["left", "right", "center", "right"],
      rows: intersections.map((it) => [
        it.name ?? it.signalId ?? "—",
        fmtNum(it.distanceMi, 2),
        String(it.currentLos ?? it.existingLos ?? "—"),
        fmtNum(it.currentDelaySec ?? it.existingDelaySec, 1),
      ]),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No signalized intersections within the study radius. Off-site capacity impact is not anticipated for this development.", { paragraphGap: 6 });
    doc.fillColor("black");
  }
  doc.moveDown(0.5);

  // --- §5 Trip Generation -------------------------------------------------
  gaSection(doc, "5.0 TRIP GENERATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is calculated per the ITE Trip Generation Manual 11th Edition for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Rate-vs.-equation selection follows the ITE Trip Generation Handbook 3rd Edition, Figure 4.2. Pass-by and internal-capture credits are taken from the ITE Trip Generation Handbook and reflected only against the external trips assigned to the study network.`,
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
  doc.moveDown(0.3);
  rows(doc, [
    ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
    ["Internal capture applied", `${r.internalCapturePctApplied ?? 0}%`],
  ]);
  doc.moveDown(0.5);
  if (juris === "austin") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Austin TIAs require a Sustainable Modes Analysis and a TDM Plan; internal capture, transit-proximity, reduced-parking-supply, and TDM credits are codified as Street Impact Fee credits per the SIF Guidelines (Jan 31, 2023). The trip-generation table above does not yet apply Austin SIF credits — those reductions are scoped in the TDM Plan section [placeholder, requires site-specific TDM inputs].",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

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

  // --- §6 Trip Distribution and Assignment -------------------------------
  gaSection(doc, "6.0 TRIP DISTRIBUTION AND ASSIGNMENT");
  doc.font("body").fontSize(10).fillColor("black").text(
    "External trips are assigned to the study network using inverse-distance weighting from the project site to each signalized intersection, normalized so the period total matches the external-trip count from §5. Final distribution percentages should be agreed upon during the TxDOT-District + host-city scoping meeting prior to formal submittal.",
    { paragraphGap: 6 },
  );

  // --- §7 Background Growth ----------------------------------------------
  gaSection(doc, "7.0 BACKGROUND GROWTH");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Background traffic is grown at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"}. TxDOT TSP §16.3.3 does not prescribe a fixed growth rate — it is derived from historical AADT trend (TxDOT STARS II / TCDS) combined with current field counts and committed-development trips. The value applied here is a screening default and should be re-calibrated to the historical AADT trend on the affected segments before formal submittal. Regional MPO model factors (H-GAC, NCTCOG, CAMPO, or AAMPO depending on the host MSA) are commonly cited.`,
    { paragraphGap: 6 },
  );

  // --- §8 Build / No-Build Analysis --------------------------------------
  gaSection(doc, "8.0 BUILD / NO-BUILD ANALYSIS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per TxDOT TSP §16.3, the future horizon is Opening Year + 5. Three scenarios are evaluated at each affected intersection: (1) Existing — current-year volumes, no growth applied; (2) No-Build (opening year ${req.openingYear ?? "—"}) — existing volumes grown at ${r.growthAppliedPct ?? "—"}%/yr over ${r.growthYears ?? "—"} year(s) without project trips; (3) Build (opening year ${req.openingYear ?? "—"}) — No-Build volumes plus the project's external trips at the assigned distribution. Level of Service is calculated per HCM 6th Edition Exhibit 19-8. Host-jurisdiction LOS standard: ${cityLos}`,
    { paragraphGap: 6 },
  );

  if (intersections.length > 0) {
    table(doc, {
      headers: ["Intersection", "Existing LOS", "No-Build LOS", "Build LOS", "Δ delay (s)", "Q95 (ft)"],
      widths: [200, 65, 75, 65, 70, 60],
      align: ["left", "center", "center", "center", "right", "right"],
      rows: intersections.map((it) => {
        const losChanged = it.losChanged === true;
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
  }
  doc.moveDown(0.5);

  // --- §9 Mitigation ------------------------------------------------------
  gaSection(doc, "9.0 MITIGATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Mitigation recommendations follow TxDOT TSP §16.4.3. Each recommendation below is a screening-level concept sized to the projected delay change; detailed signal-timing optimization (HCS or Synchro) and turn-lane geometry checks per Roadway Design Manual Ch. 16 should be confirmed in the formal submittal.",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    const needMitigation = intersections.filter((it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none");
    if (needMitigation.length > 0) {
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
        "No mitigation is necessary to maintain the host-jurisdiction LOS standard within the study network under build conditions.",
        { paragraphGap: 6 },
      );
    }
  }
  if (juris === "sanantonio") {
    doc.moveDown(0.3);
    doc.font("bold").fontSize(10).fillColor("black").text("Rough Proportionality Cap");
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Per UDC §35-502, the total mitigation cost the City may require of this development is capped at the project's maximum proportional traffic impact. A Rough Proportionality cost calculation must be prepared and submitted with this TIA; this screening report does not generate that calculation — it requires the final mitigation cost estimate and the City's proportionality methodology [placeholder].",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  if (juris === "houston") {
    doc.moveDown(0.3);
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Houston commercial submittals must include the Houston Access Form alongside this TIA, and an MDR drainage report integration is required where new impervious cover is added — neither is generated by this screening report [placeholder, requires site-civil inputs].",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  if (juris === "austin") {
    doc.moveDown(0.3);
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Austin's two-tier TIA Memo / Full TIA process determines which deliverable set applies based on the TIA Determination Worksheet outcome and the Scope of Work pre-approval. Tier selection is a discretionary determination by TDS and is not generated by this screening report [placeholder, requires TDS scoping outcome].",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- §10 Conclusions & Recommendations ---------------------------------
  gaSection(doc, "10.0 CONCLUSIONS & RECOMMENDATIONS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `This screening TIA identifies ${losDrops} intersection${losDrops === 1 ? "" : "s"} with LOS drops and ${losEf} operating at LOS E or F under build conditions. A formal submittal to ${cityName} (with parallel TxDOT-District coordination where any state-system route is in frontage) should validate these screening results against current-edition manuals, updated turning-movement counts within the most recent 12 months, and the host-jurisdiction scoping outcome. The report must be sealed by a Texas-licensed Professional Engineer per 22 TAC §137.33.`,
    { paragraphGap: 6 },
  );

  // --- §11 Programmed Projects -------------------------------------------
  gaSection(doc, "11.0 PROGRAMMED PROJECTS");
  const mpoName = {
    houston: "Houston-Galveston Area Council (H-GAC) TIP 2025–2028",
    austin: "CAMPO TIP",
    dallas: "North Central Texas Council of Governments (NCTCOG) TIP and Mobility 2045",
    fortworth: "NCTCOG TIP, Mobility 2045, and the NCTCOG Regional Thoroughfare Plan",
    sanantonio: "Alamo Area MPO (AAMPO) TIP",
    txdot: "the applicable regional MPO TIP",
  }[juris];
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    `Review of programmed transportation projects within the study area should consult the TxDOT Unified Transportation Program (UTP 2026, adopted Aug 2025), the federally-required Statewide Transportation Improvement Program (STIP), and ${mpoName}. This screening analysis does not automatically integrate programmed-projects data; manual review is recommended for any submittal.`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

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
