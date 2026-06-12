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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regionForCoordinate, type Region } from "./regions";
import { getAutoModeShare } from "./mode-share";
import { renderTisNewYork } from "./pdf-export-ny";
import { enrichNyIntersectionsWithSpeed, getNyCrashSummaryForSite } from "./nysdot-data";
import { crashesNearPoint } from "./crashes";
import { jurisdictionTierLabel, resolveStudyTier, type TierInput } from "./study-tier";
import type { StudyTier } from "./tis";
import { renderTisCaliforniaWorksheet } from "./pdf-export-ca-worksheet";

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

  // NY-only Tier-1 data enrichment: hit NYSDOT RDM_Roadway_Current
  // FeatureServer for posted-speed-per-intersection BEFORE drawBody, so
  // the renderer stays sync. Fails open — any error keeps the existing
  // placeholders. Concurrency + timeouts are bounded inside the adapter.
  if (project.studyType === "tis") {
    const lat = project.siteLat ? Number(project.siteLat) : NaN;
    const lon = project.siteLon ? Number(project.siteLon) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const region = regionForCoordinate(lat, lon);
      if (region?.stateCode === "NY" && (region?.country ?? "US") === "US") {
        const result = project.resultPayload as Record<string, unknown> | null;
        const intersections = Array.isArray(result?.affectedIntersections)
          ? (result?.affectedIntersections as Array<Record<string, unknown>>)
          : [];
        // Three Tier-1 NY enrichments, run in parallel:
        //   (a) per-intersection posted-speed from NYSDOT RDM
        //       (mutates intersections in place)
        //   (b) county-level 3-year crash summary from the NY State
        //       Police Case Information SODA endpoint (stashed on
        //       result.nyCrashSummary for renderTisNewYork §4)
        //   (c) precise intersection-radius 3-year crash records from
        //       our crashes table, populated by ingest-crashes-nyc.ts
        //       (stashed on result.nyPreciseCrashSummary). Only
        //       returns non-empty inside NYC where coords exist; the
        //       renderer falls through to the county-level block
        //       outside NYC.
        // All three fail open: any error leaves the prior placeholders.
        const speedTask = intersections.length > 0
          ? enrichNyIntersectionsWithSpeed(intersections)
          : Promise.resolve();
        const crashTask = getNyCrashSummaryForSite(lat, lon).then((s) => {
          if (s && result && typeof result === "object") {
            (result as Record<string, unknown>).nyCrashSummary = s;
          }
        });
        const preciseCrashTask = crashesNearPoint({
          lat,
          lon,
          radiusMi: 0.25,
          windowYears: 3,
          source: "nyc_opendata",
        })
          .then((s) => {
            if (s.totalCrashes > 0 && result && typeof result === "object") {
              (result as Record<string, unknown>).nyPreciseCrashSummary = s;
            }
          })
          .catch(() => {
            // DB unreachable or table missing — keep county-level
            // fallback. No reason to surface this as a render error.
          });
        await Promise.all([speedTask, crashTask, preciseCrashTask]);
      }
    }
  }

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
  if (region?.stateCode === "FL" && (region?.country ?? "US") === "US") {
    renderTisFlorida(doc, result, project, region);
    return;
  }
  if (region?.stateCode === "GA" && (region?.country ?? "US") === "US") {
    renderTisGeorgia(doc, result, project, region);
    return;
  }
  if (region?.stateCode === "IL" && (region?.country ?? "US") === "US") {
    renderTisIllinois(doc, result, project, region);
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
  if (region?.stateCode === "CA" && (region?.country ?? "US") === "US") {
    renderTisCalifornia(doc, result, project, region);
    return;
  }
  if (region?.stateCode === "NY" && (region?.country ?? "US") === "US") {
    renderTisNewYork(doc, result, project, region);
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

  // PM peak trip generation summary. Independent-variable label is recorded
  // here so a reviewing PE can verify which ITE 11th rate set the screening
  // used — primary vs. one of the alternate variables (employees, occupied
  // rooms, weekly attendees, etc.) added by the multi-variable pass.
  section(doc, "PM Peak Trip Generation");
  const tgRowsTop: Array<[string, string]> = [
    ["Independent variable", `${tg.unit ?? "—"} (${tg.unitShort ?? "—"})`],
  ];
  if (tg.variableConfidence === "interpolated") {
    tgRowsTop.push([
      "Rate confidence",
      `Interpolated${tg.variableNote ? ` — ${tg.variableNote}` : ""}`,
    ]);
  } else if (tg.variableConfidence === "ite_published") {
    tgRowsTop.push(["Rate confidence", "ITE 11th Ed. published"]);
  }
  rows(doc, [
    ...tgRowsTop,
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

  // --- Tier dispatch ------------------------------------------------------
  // Gwinnett's 4-level scheme is the de-facto metro Atlanta template
  // (Level 1: 0–20 PHT = Worksheet; Level 2: 21–249 PHT = Abbreviated;
  // Level 3: 250–499 PHT = Full TIS; Level 4: ≥500 PHT OR DRI = DRI). Below
  // the Level 1 threshold a Worksheet / Screening Letter is the
  // appropriate deliverable, not a Full TIS — short-circuit here.
  const tierInput: TierInput = {
    dailyTrips: Number(tg.dailyTrips ?? 0),
    pmPeakTrips: Number(tg.pmPeakTrips ?? (Number(tg.pmIn ?? 0) + Number(tg.pmOut ?? 0))),
    size: Number(tg.size ?? 0),
    unit: String(tg.unit ?? ""),
    landUseCode: String(tg.landUseCode ?? ""),
  };
  const requested: StudyTier | undefined = req.studyTier;
  const resolvedTier = resolveStudyTier(region, tierInput, requested);
  if (resolvedTier === "worksheet") {
    renderTisGeorgiaWorksheet(doc, r, project, region, tierInput);
    return;
  }
  if (resolvedTier === "abbreviated") {
    renderTisGeorgiaAbbreviated(doc, r, project, region, tierInput);
    return;
  }

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
  // Surface which ITE 11th independent variable the screening used so the
  // reviewing engineer can verify the assumption (GRTA reviewers ask for
  // this explicitly). Interpolated secondaries are flagged so the
  // submittal-grade study can re-run against the primary if needed.
  const gaTopRows: Array<[string, string]> = [
    ["Independent variable", `${tg.unit ?? "—"} (${tg.unitShort ?? "—"})`],
  ];
  if (tg.variableConfidence === "interpolated") {
    gaTopRows.push([
      "Rate confidence",
      `Interpolated${tg.variableNote ? ` — ${tg.variableNote}` : ""}`,
    ]);
  } else if (tg.variableConfidence === "ite_published") {
    gaTopRows.push(["Rate confidence", "ITE 11th Ed. published"]);
  }
  rows(doc, [
    ...gaTopRows,
    ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
    ["Internal capture applied", `${r.internalCapturePctApplied ?? 0}%`],
    ["Background growth applied", `${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s)`],
    ["Weather condition", String(r.weather ?? req.weather ?? "clear")],
  ]);
  if (tg.variableConfidence === "interpolated") {
    doc.moveDown(0.3);
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
      "Note: trip rate for the chosen independent variable was derived from a defensible engineering ratio rather than transcribed directly from the ITE 11th Edition tables. A submittal-grade study should verify this assumption against the primary published variable for this code.",
      { paragraphGap: 4 },
    );
    doc.fillColor("black");
  }
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

  // --- §11–§13 DRI-only sections -----------------------------------------
  // Triggered when project size exceeds GA DCA Chapter 110-12-3 thresholds
  // (O.C.G.A. § 50-8-7.1). Covers Non-Expedited Criteria, Area of
  // Influence, and ARC Air Quality Benchmark required by GRTA for DRI
  // submittal. Auto-computes from engine data where available; surfaces
  // explicit data-source requirements (Census ACS overlay, MARTA station
  // proximity, TMA designation) where it doesn't.
  if (probablyDriScale(tg)) {
    renderTisGeorgiaDriSections(doc, r, project, region);
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

// ===========================================================================
// California (SB 743 / VMT-aware) renderer
// ===========================================================================
//
// California Senate Bill 743 (effective statewide 2020-07-01) replaced
// LOS-based CEQA transportation impact analysis with VMT-based analysis
// (PRC § 21099(b)(2); CEQA Guidelines 14 CCR § 15064.3). The existing
// LOS engine therefore CANNOT produce a CEQA-compliant transportation
// determination on its own — but LOS is still the operational metric
// for Caltrans Encroachment Permits, local non-CEQA operational review,
// HDM design, EPM permitting, and CA MUTCD Part 4C signal warrants.
//
// Per REGIONAL-SPECS/california-vmt-spec.md (Option C, phased), the
// Phase 1 renderer:
//   (1) leads with explicit SB 743 framing so the reviewer knows what
//       this report does and does not satisfy,
//   (2) reframes the LOS engine output as a "Non-CEQA Operational
//       Analysis" section with the PRC § 21099(b)(2) footnote,
//   (3) ships the CEQA-VMT determination as a structured Tier-1
//       placeholder that lists exactly the inputs needed (MPO baseline,
//       project VMT estimate, jurisdiction threshold) — NEVER
//       fabricates baseline VMT numbers, and
//   (4) adapts terminology and citations to the host jurisdiction
//       (LA TAG / SF TIA Guidelines / San Diego TSM / etc.).
//
// Phase 2 (~3–4 engineering-weeks) wires the Tier-1 VMT screening
// engine — OPR's six screening criteria + per-jurisdiction baseline
// lookups. Not implemented here. See spec §5 + §10.

type CaliforniaJurisdiction = {
  name: string;
  guidelinesDoc: string;
  vmtThresholdPct: number;
  baselineGeography: string;
  screeningTripCount: number;
  mpoName: string;
  vmtCalculator?: string;
  operationalContext: string;
  extraNote?: string;
  mpoModel: string;
  rtpScs: string;
  mpoBaselineUrl: string;
  publishedBaseline?: string;
};

/**
 * Resolve the host jurisdiction for a California site. Uses rough
 * bounding boxes (good enough for prose adaptation; not authoritative).
 * Falls back to a "Caltrans / OPR default" jurisdiction for sites
 * outside the named major cities.
 */
function californiaJurisdiction(lat: number, lon: number): CaliforniaJurisdiction {
  const inBox = (latMin: number, latMax: number, lonMin: number, lonMax: number) =>
    lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;

  if (inBox(37.708, 37.835, -122.515, -122.355)) {
    return {
      name: "City and County of San Francisco",
      guidelinesDoc: "SF Planning, Transportation Impact Analysis Guidelines for Environmental Review (Oct 2019)",
      vmtThresholdPct: 15,
      baselineGeography: "MTC Bay Area regional VMT/capita and VMT/employee",
      screeningTripCount: 100,
      mpoName: "Metropolitan Transportation Commission (MTC)",
      vmtCalculator: "SFCTA's SF-CHAMP model (TM1-derived TAZ baselines)",
      operationalContext: "site-access design review; non-CEQA local operational review (SF Public Works)",
      extraNote: "San Francisco is the only California jurisdiction that has removed LOS from CEQA review entirely. The non-CEQA operational analysis below is provided for site-access design and SF Public Works coordination; it is not part of the SF Planning CEQA record.",
          mpoModel: "Travel Model One v1.6.1 (May 2025); TM2 under development",
      rtpScs: "Plan Bay Area 2050 (adopted Oct 2021); PBA 2050+ update slated early 2026",
      mpoBaselineUrl: "https://vitalsigns.mtc.ca.gov/indicators/daily-miles-traveled",
      publishedBaseline: "MTC publishes regional aggregate via Vital Signs; project-level VMT delegated to cities. SF uses SFCTA SF-CHAMP TAZ baselines.",
};
  }
  if (inBox(33.700, 34.337, -118.668, -118.155)) {
    return {
      name: "City of Los Angeles",
      guidelinesDoc: "LADOT Transportation Assessment Guidelines (TAG) (Jul 2020)",
      vmtThresholdPct: 15,
      baselineGeography: "LA Area Planning Commission (APC) sub-area average VMT/capita and VMT/employee",
      screeningTripCount: 250,
      mpoName: "Southern California Association of Governments (SCAG)",
      vmtCalculator: "LADOT VMT Calculator v1.3 (May 2020); SCAG HELPR 3.0 for TAZ baselines",
      operationalContext: "Caltrans Encroachment Permit review on SHS frontage; LADOT site-access design review",
          mpoModel: "SCAG ABM (TransCAD); legacy TBM retained as parallel",
      rtpScs: "Connect SoCal 2024 (adopted Apr 4, 2024)",
      mpoBaselineUrl: "https://rdp.scag.ca.gov/helpr/",
      publishedBaseline: "Project-level baseline pulled from SCAG HELPR 3.0 (Regional Data Platform, parcel-level VMT layer at 2019 baseline) at the APC sub-area aggregation.",
};
  }
  if (inBox(33.730, 33.890, -118.250, -118.080)) {
    return {
      name: "City of Long Beach",
      guidelinesDoc: "Long Beach CM Memo, CEQA Transportation Methodology / VMT Standards for Development Review (Jun 30, 2020)",
      vmtThresholdPct: 15,
      baselineGeography: "LA County (SCAG) regional VMT/capita and VMT/employee",
      screeningTripCount: 500,
      mpoName: "Southern California Association of Governments (SCAG)",
      operationalContext: "Caltrans Encroachment Permit review on SHS frontage; Long Beach Public Works site-access review",
          mpoModel: "SCAG ABM (TransCAD)",
      rtpScs: "Connect SoCal 2024 (adopted Apr 4, 2024)",
      mpoBaselineUrl: "https://rdp.scag.ca.gov/helpr/",
      publishedBaseline: "LA County (SCAG region) VMT/capita and VMT/employee — pull from SCAG HELPR 3.0 at the LA County aggregation.",
};
  }
  if (inBox(33.770, 33.890, -118.020, -117.690)) {
    return {
      name: "City of Anaheim",
      guidelinesDoc: "Anaheim Traffic Impact Analysis Guidelines for CEQA (Feb 2025, final draft)",
      vmtThresholdPct: 15,
      baselineGeography: "Orange County VMT per service population (population + employment denominator)",
      screeningTripCount: 110,
      mpoName: "Southern California Association of Governments (SCAG)",
      operationalContext: "Caltrans D12 Encroachment Permit review; Anaheim Public Works site-access review",
      extraNote: "Anaheim uses VMT per service population (population + employment), not VMT per capita — a different denominator than the OPR default. Verify the OC service-population baseline against the Feb 2025 final-draft TIA Guidelines before adopting for submittal.",
          mpoModel: "SCAG ABM (TransCAD)",
      rtpScs: "Connect SoCal 2024 (adopted Apr 4, 2024)",
      mpoBaselineUrl: "https://rdp.scag.ca.gov/helpr/",
      publishedBaseline: "OC VMT per service population (population + employment denominator). Pull from SCAG HELPR 3.0 at the Orange County aggregation; confirm denominator method against the Feb 2025 final-draft TIA Guidelines.",
};
  }
  if (inBox(33.700, 34.823, -118.951, -117.646)) {
    return {
      name: "Los Angeles County (Department of Public Works)",
      guidelinesDoc: "LA County DPW Transportation Impact Analysis Guidelines (Jul 23, 2020, v1.1)",
      vmtThresholdPct: 16.8,
      baselineGeography: "LA County sub-area VMT/capita (~22.3 North / ~12.7 South) and VMT/employee (~19.0 / ~18.4)",
      screeningTripCount: 110,
      mpoName: "Southern California Association of Governments (SCAG)",
      operationalContext: "Caltrans Encroachment Permit review on SHS frontage; LA County DPW site-access review",
      extraNote: "LA County uses a 16.8% reduction threshold (CARB 2017 Scoping Plan compute), NOT the 15% OPR default. Baseline values diverge between North and South sub-areas.",
          mpoModel: "SCAG ABM (TransCAD)",
      rtpScs: "Connect SoCal 2024 (adopted Apr 4, 2024)",
      mpoBaselineUrl: "https://rdp.scag.ca.gov/helpr/",
      publishedBaseline: "LA County DPW Guidelines § 3.1.4.2 require the SCAG RTP/SCS Travel Demand Forecast Model. Rough sub-area values cited in jurisdiction guidelines: ~22.3 (North VMT/capita) / ~12.7 (South VMT/capita); ~19.0 / ~18.4 VMT/employee. Confirm against current SCAG model run for submittal.",
};
  }
  if (inBox(32.534, 33.114, -117.282, -116.906)) {
    return {
      name: "City of San Diego",
      guidelinesDoc: "San Diego Transportation Study Manual (TSM), adopted Sept 29, 2020; current revision Sept 19, 2022",
      vmtThresholdPct: 15,
      baselineGeography: "SANDAG regional VMT/resident and VMT/employee (project ≤85% of regional baseline)",
      screeningTripCount: 110,
      mpoName: "San Diego Association of Governments (SANDAG)",
      vmtCalculator: "SANDAG SB 743 VMT Maps (ArcGIS Experience Builder); San Diego Mobility Evaluation Tool (MET)",
      operationalContext: "Caltrans D11 Encroachment Permit review; San Diego TSM Ch. 4 operational analysis",
      extraNote: "San Diego applies a Mobility Zone-based screen (1/2/3) rather than a single trip count; verify the project's Mobility Zone via the MET before adopting the 110-trip floor.",
          mpoModel: "SANDAG ABM3 (base year 2022) for 2025 plan; ABM2+ (2016 base) for 2021 plan",
      rtpScs: "Final Amended 2021 Regional Plan (CARB-approved Feb 2025); 2025 Regional Plan in development",
      mpoBaselineUrl: "https://geo.sandag.org/portal/apps/experiencebuilder/experience/?id=636ddd919dc6439cb7b8f26ba2c25388",
      publishedBaseline: "SANDAG SB 743 VMT Maps (ArcGIS Experience Builder) — VMT/resident and VMT/employee by City, CPA, or Census Tract. The most project-ready VMT portal in California; reads MET (Mobility Evaluation Tool) for Mobility Zone screen.",
};
  }
  if (inBox(38.430, 38.685, -121.560, -121.362)) {
    return {
      name: "City of Sacramento",
      guidelinesDoc: "Sacramento 2040 General Plan, VMT Thresholds of Significance (Council Ord. 2024-0017, Jun 25, 2024)",
      vmtThresholdPct: 15,
      baselineGeography: "Citywide existing VMT/capita and VMT/employee",
      screeningTripCount: 250,
      mpoName: "Sacramento Area Council of Governments (SACOG)",
      operationalContext: "Caltrans D3 Encroachment Permit review; Sacramento Public Works site-access review",
          mpoModel: "SACSIM23 (activity-based, DaySim)",
      rtpScs: "2025 Blueprint (MTP/SCS) — adoption Fall 2025",
      mpoBaselineUrl: "https://github.com/SACOG/SACSIM19",
      publishedBaseline: "No SACOG-published project-level tool; member jurisdictions handle independently. Citywide existing VMT baseline maintained by Sacramento Community Development for §3.1.4 lookups.",
};
  }
  if (inBox(37.180, 37.470, -122.045, -121.745)) {
    return {
      name: "City of San Jose",
      guidelinesDoc: "San Jose Transportation Analysis Handbook (TAH), April 2023; CEQA thresholds via Council Policy 5-1",
      vmtThresholdPct: 15,
      baselineGeography: "Citywide existing VMT/capita and VMT/employee",
      screeningTripCount: 110,
      mpoName: "Metropolitan Transportation Commission (MTC)",
      operationalContext: "Caltrans D4 Encroachment Permit review; San Jose Local Transportation Analysis (LTA) non-CEQA track",
      extraNote: "San Jose codifies a non-CEQA Local Transportation Analysis (LTA) track that runs IN PARALLEL with the CEQA-VMT analysis. The operational LOS section below corresponds to the LTA scope when ≥10 peak-hour trips per lane are added to a signalized intersection within ½-mile already at LOS D or worse.",
          mpoModel: "Travel Model One v1.6.1 (May 2025); TM2 under development",
      rtpScs: "Plan Bay Area 2050 (adopted Oct 2021); PBA 2050+ update slated early 2026",
      mpoBaselineUrl: "https://github.com/BayAreaMetro/travel-model-one",
      publishedBaseline: "Citywide existing VMT baseline maintained by San Jose Department of Transportation. SJ TAH Apr 2023 publishes residential + office screening maps; consult those before any MPO model run.",
};
  }
  if (inBox(37.700, 37.880, -122.350, -122.114)) {
    return {
      name: "City of Oakland",
      guidelinesDoc: "Oakland Transportation Impact Review Guidelines for Land Use Development Projects (Apr 2017)",
      vmtThresholdPct: 15,
      baselineGeography: "MTC Bay Area regional VMT/capita and VMT/employee",
      screeningTripCount: 100,
      mpoName: "Metropolitan Transportation Commission (MTC)",
      operationalContext: "Caltrans D4 Encroachment Permit review; Oakland Public Works site-access review",
          mpoModel: "Travel Model One v1.6.1 (May 2025); TM2 under development",
      rtpScs: "Plan Bay Area 2050 (adopted Oct 2021); PBA 2050+ update slated early 2026",
      mpoBaselineUrl: "https://vitalsigns.mtc.ca.gov/indicators/daily-miles-traveled",
      publishedBaseline: "MTC Bay Area regional VMT/capita and VMT/employee — pull from MTC Vital Signs or commission a TM1 model run at the project TAZ.",
};
  }
  if (inBox(36.670, 36.910, -119.910, -119.620)) {
    return {
      name: "City of Fresno",
      guidelinesDoc: "Fresno CEQA Guidelines for VMT Thresholds (Council adoption Jun 25, 2020) + 2025 VMT Reduction Program (Aug 2025)",
      vmtThresholdPct: 13,
      baselineGeography: "Fresno County VMT/capita and VMT/employee (Central Valley GHG math)",
      screeningTripCount: 500,
      mpoName: "Fresno Council of Governments (Fresno COG)",
      vmtCalculator: "Fresno COG VMT Screening Tool (LSA-hosted ArcGIS app)",
      operationalContext: "Caltrans D6 Encroachment Permit review; Fresno Public Works site-access review",
      extraNote: "Fresno uses a 13% reduction threshold (Central Valley GHG-aligned), NOT the 15% OPR default applied in coastal metros.",
          mpoModel: "Fresno COG ABM (DaySim + Replica IX/XI)",
      rtpScs: "SJV COGs hub; current Fresno COG MTP",
      mpoBaselineUrl: "http://gis1.lsa.net/FCOGVMT/",
      publishedBaseline: "Fresno COG VMT Screening Tool (LSA-hosted ArcGIS app, parcel-level screening). User guide: gis1.lsa.net/FCOGVMT/Fresno COG Screening Tool User Guide 2025.pdf. SB 743 Regional Guidelines published June 2025.",
};
  }
  if (inBox(35.270, 35.480, -119.190, -118.910)) {
    return {
      name: "City of Bakersfield",
      guidelinesDoc: "No separately adopted Bakersfield VMT guidelines; defers to OPR Technical Advisory on Evaluating Transportation Impacts in CEQA (Dec 2018)",
      vmtThresholdPct: 15,
      baselineGeography: "OPR default — regional or city VMT/capita and VMT/employee (Kern COG draft guidance pending)",
      screeningTripCount: 110,
      mpoName: "Kern Council of Governments (Kern COG)",
      operationalContext: "Caltrans D6 Encroachment Permit review; Bakersfield Public Works site-access review",
      extraNote: "Bakersfield has not formally adopted city-level VMT guidelines; defaults to the OPR Dec 2018 Technical Advisory. Kern COG has been workshopping regional VMT guidance; verify Kern COG adoption status before submittal.",
          mpoModel: "Kern COG model (regional guidance in workshopping)",
      rtpScs: "Kern COG RTP/SCS",
      mpoBaselineUrl: "https://www.bakersfieldcity.us/279/Environmental-Documents",
      publishedBaseline: "No city-level TIA/VMT guidelines adopted; defers to OPR Dec 2018 defaults on project EIRs. Kern COG workshopping regional guidance. Use OPR floor (15% below baseline; 110-trip screen) unless Kern COG publishes intervening guidance.",
};
  }
  return {
    name: "Caltrans + OPR Dec 2018 defaults",
    guidelinesDoc: "OPR (LCI) Technical Advisory on Evaluating Transportation Impacts in CEQA (Dec 2018); local lead-agency adoption status to be confirmed",
    vmtThresholdPct: 15,
    baselineGeography: "Regional MPO VMT/capita and VMT/employee (OPR default); county-level if region is much larger than commute-shed (OPR p. 16)",
    screeningTripCount: 110,
    mpoName: "Regional MPO covering project site",
    operationalContext: "Caltrans District Encroachment Permit review (SHS frontage); local agency site-access design review",
    extraNote: "No host-jurisdiction-specific TIA guidelines were identified for this site. Confirm the local lead agency's adopted VMT guidelines and threshold before submittal — most California jurisdictions adopted between 2019 and 2024 and many post-date OPR defaults.",
    mpoModel: "Host MPO model — confirm at scoping",
    rtpScs: "Host MPO RTP/SCS — confirm at scoping",
    mpoBaselineUrl: "https://dot.ca.gov/programs/sustainability/sb-743/resources",
    publishedBaseline: "No host-jurisdiction baseline lookup; use OPR floor (15% below regional baseline) and pull baseline from host MPO RTP/SCS at scoping.",
  };
}

/**
 * California-specific TIS renderer. SB 743 paradigm-aware: leads with
 * explicit framing that distinguishes the engine's LOS output (a
 * non-CEQA operational analysis useful for Caltrans Encroachment
 * Permit review + local site-access design) from the CEQA-VMT
 * determination required under PRC § 21099(b)(2) / CEQA Guidelines
 * § 15064.3. The CEQA-VMT section ships as a structured placeholder
 * pending the Tier-1 VMT screening engine (Phase 2 roadmap per
 * REGIONAL-SPECS/california-vmt-spec.md). Per-jurisdiction adaptation
 * routes through {@link californiaJurisdiction} for thresholds,
 * baseline geography, guidelines docs, screening trip counts, and
 * MPO citations.
 */
type ScreeningCriterionStatus = "screened_out" | "not_screened_out" | "not_applicable" | "requires_verification";

type ScreeningCriterionResult = {
  label: string;
  status: ScreeningCriterionStatus;
  note: string;
};

function statusLabel(s: ScreeningCriterionStatus): string {
  switch (s) {
    case "screened_out": return "Screened out — presumed less-than-significant";
    case "not_screened_out": return "Not screened out by this criterion";
    case "not_applicable": return "N/A for this project";
    case "requires_verification": return "Requires verification (data source named below)";
  }
}

/**
 * OPR § E.1 six-criteria boolean cascade. Auto-determines the
 * criteria the engine can evaluate from project metadata
 * (trip count, ITE land-use code, size). Flags GIS-dependent
 * criteria (TPA, low-VMT map, redevelopment baseline) as
 * "Requires verification" with the data source named.
 */
function caVmtScreening(
  dailyTrips: number,
  luCode: string,
  size: number,
  unit: string,
  jurisScreeningTripCount: number,
  jurisName: string,
): ScreeningCriterionResult[] {
  const isResidential = luCode.startsWith("21") || luCode.startsWith("22") || luCode.startsWith("23");
  const isRetail = luCode.startsWith("82") || luCode.startsWith("85") || luCode.startsWith("86") || luCode.startsWith("87") || luCode.startsWith("88");
  const sizeKsf = unit && unit.toLowerCase().includes("ksf") ? size : NaN;

  const results: ScreeningCriterionResult[] = [];

  // (1) Small project — auto-evaluable
  results.push({
    label: `Small project: <${jurisScreeningTripCount} daily trips (${jurisName} screening threshold; OPR floor 110)`,
    status: dailyTrips > 0 && dailyTrips < jurisScreeningTripCount ? "screened_out" : (dailyTrips > 0 ? "not_screened_out" : "requires_verification"),
    note: dailyTrips > 0
      ? `Project generates ${Math.round(dailyTrips).toLocaleString()} daily trips. Threshold: ${jurisScreeningTripCount}.`
      : "Daily trip count not available from engine output.",
  });

  // (2) Transit Priority Area — requires GIS
  results.push({
    label: "Transit Priority Area (TPA): within ½ mi of a major transit stop (PRC § 21064.3) or high-quality transit corridor (PRC § 21155)",
    status: "requires_verification",
    note: "Requires GIS query against the MPO's major-transit-stop layer + high-quality-transit-corridor layer. TPA presumption does NOT apply if FAR <0.75, parking exceeds requirement, project is inconsistent with the SCS, or affordable units are replaced with fewer market-rate units (OPR Tech Advisory p. 14) — flag in submittal even if TPA-eligible.",
  });

  // (3) Low-VMT area map — requires GIS
  results.push({
    label: "Low-VMT area: project sited in a TAZ already performing ≥15% below baseline",
    status: "requires_verification",
    note: "Consult the host jurisdiction's published low-VMT screening map (e.g., SCAG HELPR 3.0; SANDAG SB 743 portal; LADOT VMT Calculator zone lookup; Fresno COG screening tool). Auto-screening from project lat/lon not implemented in this Phase-2 slice.",
  });

  // (4) Locally-serving retail <50 ksf — auto-evaluable when ITE codes a retail use
  if (isRetail) {
    if (Number.isFinite(sizeKsf)) {
      results.push({
        label: "Locally-serving retail <50,000 sf (LA County / OPR convention)",
        status: sizeKsf < 50 ? "screened_out" : "not_screened_out",
        note: `Project is ITE land use ${luCode} (retail category) at ${sizeKsf} ksf. Threshold: 50 ksf.`,
      });
    } else {
      results.push({
        label: "Locally-serving retail <50,000 sf",
        status: "requires_verification",
        note: `Project is ITE land use ${luCode} (retail) but size unit (${unit || "—"}) is not in ksf; cannot auto-compare. Convert to ksf and reapply.`,
      });
    }
  } else {
    results.push({
      label: "Locally-serving retail <50,000 sf",
      status: "not_applicable",
      note: `Project is ITE land use ${luCode}${isResidential ? " (residential)" : ""}, not a retail category. This criterion applies only to local-serving retail uses.`,
    });
  }

  // (5) 100% affordable residential infill — requires applicant-side attestation
  if (isResidential) {
    results.push({
      label: "100% affordable residential infill (OPR Tech Advisory p. 14–15)",
      status: "requires_verification",
      note: "Project is ITE residential. Applicant must attest to 100% affordable unit mix + infill-location qualification. Not auto-determined from ITE land use alone.",
    });
  } else {
    results.push({
      label: "100% affordable residential infill",
      status: "not_applicable",
      note: `Project is ITE land use ${luCode}, not residential.`,
    });
  }

  // (6) Redevelopment net VMT decrease — requires prior-use VMT
  results.push({
    label: "Redevelopment with net VMT decrease (existing use → proposed use)",
    status: "requires_verification",
    note: "Requires prior-use VMT computation (existing site land use + intensity + tenancy). If the site is vacant or undeveloped, this criterion does not apply — flag as N/A in submittal. OPR p. 14: presumption does not apply where redevelopment displaces affordable housing near transit.",
  });

  return results;
}

function renderTisCalifornia(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];

  const lat = Number(project.siteLat ?? req.latitude ?? NaN);
  const lon = Number(project.siteLon ?? req.longitude ?? NaN);
  const jur = Number.isFinite(lat) && Number.isFinite(lon)
    ? californiaJurisdiction(lat, lon)
    : californiaJurisdiction(34.0522, -118.2437);

  // --- Tier dispatch ------------------------------------------------------
  // CA does not formally tier (single "Transportation Analysis" is the
  // standard deliverable above the OPR screen), but OPR § E.1 explicitly
  // permits a screened-out memo for projects below the host-jurisdiction
  // screening trip floor (110 OPR default; 250 LA/Sacramento; 500
  // Long Beach/Fresno). When the cascade screens the project out, the
  // appropriate deliverable is a short Screened-Out Determination Memo,
  // NOT a full TIA — short-circuit to the worksheet renderer.
  const tierInput: TierInput = {
    dailyTrips: Number(tg.dailyTrips ?? 0),
    pmPeakTrips: Number(tg.pmPeakTrips ?? (Number(tg.pmIn ?? 0) + Number(tg.pmOut ?? 0))),
    size: Number(tg.size ?? 0),
    unit: String(tg.unit ?? ""),
    landUseCode: String(tg.landUseCode ?? ""),
    jurisdictionScreeningTripCount: jur.screeningTripCount,
  };
  const requested: StudyTier | undefined = req.studyTier;
  const resolvedTier = resolveStudyTier(region, tierInput, requested);
  if (resolvedTier === "worksheet") {
    renderTisCaliforniaWorksheet(doc, r, project, region, tierInput, jur);
    return;
  }

  // --- Executive Summary --------------------------------------------------
  caSection(doc, "EXECUTIVE SUMMARY");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text(
    `This report addresses the transportation impacts associated with the proposed ${project.projectName || "development"} located within ${region.displayName}, California. The host lead agency is ${jur.name}; the regional MPO is ${jur.mpoName}.`,
    { paragraphGap: 6 },
  );

  doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(
    "SB 743 FRAMING — SCOPE OF THIS REPORT",
    { paragraphGap: 2 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    `California Senate Bill 743 (Stats. 2013, Ch. 386), codified at Public Resources Code § 21099(b)(2) and implemented through CEQA Guidelines 14 CCR § 15064.3 (effective statewide 2020-07-01), replaced LOS-based CEQA transportation impact analysis with Vehicle Miles Traveled (VMT) analysis. Per § 21099(b)(2), "automobile delay, as described solely by level of service or similar measures of vehicular capacity or traffic congestion, shall not be considered a significant impact on the environment."`,
    { paragraphGap: 4 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    `This report presents §4 non-CEQA operational LOS analysis suitable for ${jur.operationalContext}, AND §3 a Tier-1 CEQA-VMT screening determination that auto-evaluates the six OPR § E.1 screening criteria against project metadata. The §4 LOS analysis does NOT, by itself, satisfy CEQA transportation-impact requirements. If §3 auto-screens the project out, the project is presumed less-than-significant under CEQA Guidelines § 15064.3 without further VMT analysis; otherwise, §3 surfaces the inputs needed for a full VMT determination under the ${jur.guidelinesDoc} methodology (OPR Technical Advisory, Dec 2018).`,
    { paragraphGap: 6 },
  );

  doc.font("body").fontSize(10).fillColor("black").text("Findings (operational scope):", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  if (losDrops === 0 && losEf === 0) {
    doc.text("• No intersections within the study network are projected to drop one or more LOS under build conditions.", { paragraphGap: 2 });
    doc.text("• No operational improvements appear necessary to maintain the LOS D standard within the study network (non-CEQA scope).", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} intersection${losDrops === 1 ? "" : "s"} project to drop one or more LOS under build conditions (non-CEQA scope).`, { paragraphGap: 2 });
    doc.text(`• ${losEf} intersection${losEf === 1 ? "" : "s"} operate at LOS E or F under build conditions and may warrant operational mitigation (non-CEQA scope).`, { paragraphGap: 4 });
  }
  doc.fillColor("black");
  doc.moveDown(0.3);

  metricStrip(doc, [
    { label: "Intersections", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "LOS drops", value: String(losDrops) },
    { label: "At LOS E/F", value: String(losEf) },
    { label: "Worst Δ delay", value: `${(r.worstDelayDeltaSec ?? 0).toFixed(1)}s` },
  ]);
  doc.moveDown(0.8);

  // --- §1 Project Description --------------------------------------------
  caSection(doc, "1.0 PROJECT DESCRIPTION");
  caSubsection(doc, "1.1 Project Location");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The proposed ${project.projectName || "development"} is located within ${region.displayName}, California. The host CEQA lead agency for the transportation determination is ${jur.name}.`,
    { paragraphGap: 6 },
  );

  caSubsection(doc, "1.2 Project Summary");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Host lead agency", jur.name],
    ["Regional MPO", jur.mpoName],
  ]);
  doc.moveDown(0.5);

  caSubsection(doc, "1.3 Site Access and Multimodal Context");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Driveway-level ingress/egress, internal circulation, bicycle/pedestrian network connectivity, and transit access detail are dependent on the final site plan and are not produced by this screening tool. Site-plan-stage analysis is recommended for any formal submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- §2 Regulatory Framework -------------------------------------------
  caSection(doc, "2.0 REGULATORY FRAMEWORK");
  caSubsection(doc, "2.1 CEQA / SB 743 / OPR Technical Advisory");
  doc.font("body").fontSize(10).fillColor("black").text(
    "CEQA transportation-impact significance for this project is governed by Pub. Resources Code § 21099 (SB 743, Stats. 2013, Ch. 386), CEQA Guidelines 14 CCR § 15064.3 (adopted Dec 28, 2018; effective statewide 2020-07-01), and the OPR (now Governor's Office of Land Use and Climate Innovation, LCI) Technical Advisory on Evaluating Transportation Impacts in CEQA (Dec 2018). Per § 15064.3(a), VMT is the default transportation metric for CEQA impact significance determinations.",
    { paragraphGap: 6 },
  );

  caSubsection(doc, `2.2 Local Lead Agency Guidelines — ${jur.name}`);
  doc.font("body").fontSize(10).fillColor("black").text(
    `The applicable local lead-agency methodology and significance thresholds derive from: ${jur.guidelinesDoc}. Significance threshold: ${jur.vmtThresholdPct}% below the ${jur.baselineGeography}. Screening floor: <${jur.screeningTripCount} daily project trips presumed less-than-significant. Project-level VMT estimation source: ${jur.vmtCalculator ?? `${jur.mpoName} travel demand model or jurisdiction-published calculator (host agency to confirm)`}.`,
    { paragraphGap: 6 },
  );
  if (jur.extraNote) {
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(`Note. ${jur.extraNote}`, { paragraphGap: 6 });
    doc.fillColor("black");
  }

  caSubsection(doc, "2.3 Caltrans Authority on State Highway System Frontage");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Where the project fronts on a Caltrans-owned State Highway System (SHS) facility, the Caltrans Transportation Analysis under CEQA (TAC, 2nd Edition, Sept 2025) governs CEQA significance determination for SHS impacts and invokes the Caltrans Transportation Analysis Framework (TAF, 2nd Edition, Sept 2025) for induced-travel analysis on capacity-increasing SHS projects. Non-CEQA encroachment permitting in state right-of-way is governed by the Caltrans Encroachment Permits Manual (EPM); HDM-compliant operational analysis (LOS, queueing, signal warrants per CA MUTCD 2026 Part 4C) is expected for any new access onto an SHS facility.",
    { paragraphGap: 6 },
  );

  // --- §3 CEQA-VMT Determination (Tier-1 screening engine) ---------------
  caSection(doc, "3.0 CEQA-VMT IMPACT DETERMINATION");
  doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(
    "TIER-1 SCREENING DETERMINATION (Phase 2)",
    { paragraphGap: 2 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    `This section auto-evaluates the six OPR § E.1 screening criteria against project metadata where the engine has the inputs and surfaces the remaining GIS-dependent criteria (TPA / low-VMT TAZ / redevelopment baseline) as "Requires verification." If any criterion auto-screens out, the project is presumed less-than-significant under CEQA Guidelines § 15064.3 without further VMT analysis. Otherwise, §3.1 / §3.2 list the baseline + project-VMT inputs needed to apply the §3.4 significance threshold; the auto-screening engine does NOT fabricate VMT numbers or substitute for a regional MPO model run (see REGIONAL-SPECS/california-vmt-spec.md §5 for Tier-1 scope and §3.6 below for Tier-2 wiring roadmap).`,
    { paragraphGap: 6 },
  );

  caSubsection(doc, "3.1 Required Baseline VMT Inputs");
  rows(doc, [
    ["Baseline geography", jur.baselineGeography],
    ["Residential metric (OPR Tech Advisory p. 10)", "Home-based VMT per capita (tour-based ideal; trip-based acceptable)"],
    ["Office / employment metric (OPR p. 16)", "Home-based work VMT per employee"],
    ["Retail metric (OPR p. 16)", "Net change in total VMT (absolute, not per-capita)"],
    ["MPO travel-demand model", jur.mpoModel],
    ["Current RTP/SCS", jur.rtpScs],
    ["MPO baseline portal / source", jur.mpoBaselineUrl],
    ["Published baseline status", jur.publishedBaseline ?? "Not specified — commission an MPO model run at the project TAZ"],
    ["Optional jurisdiction calculator", jur.vmtCalculator ?? "None published — MPO model run required"],
  ]);
  doc.moveDown(0.3);

  caSubsection(doc, "3.2 Required Project VMT Inputs");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per OPR Technical Advisory p. 4–5, the project VMT estimate and the threshold must use the same method (apples-to-apples constraint — tour-based with tour-based, trip-based with trip-based).",
    { paragraphGap: 4 },
  );
  rows(doc, [
    ["Required project VMT estimate", `${jur.mpoName} with-project travel demand model run, or the jurisdiction's published calculator`],
    ["Required method consistency", "Project method MUST match baseline method (tour-based OR trip-based; not mixed)"],
    ["Required cumulative scenario", "Project + reasonably-foreseeable cumulative projects vs. RTP/SCS horizon year baseline"],
    ["Required RTP/SCS consistency check", `Project alignment with ${jur.mpoName} Sustainable Communities Strategy`],
  ]);
  doc.moveDown(0.3);

  caSubsection(doc, "3.3 Auto-Screening Cascade (OPR § E.1, p. 12–14)");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The six OPR screening criteria below are auto-evaluated against project metadata where the engine has the inputs (daily trip count, ITE land-use category, project size). Criteria that require GIS layers the engine does not yet ingest (Transit Priority Area, low-VMT TAZ map, prior-use VMT for redevelopment) are flagged "Requires verification" with the data source named. If ANY criterion resolves to "Screened out," the project is presumed less-than-significant for CEQA-VMT purposes and a full VMT impact analysis is not required.`,
    { paragraphGap: 6 },
  );

  const screeningResults = caVmtScreening(
    Number(tg.dailyTrips ?? 0),
    String(tg.landUseCode ?? ""),
    Number(tg.size ?? 0),
    String(tg.unit ?? ""),
    jur.screeningTripCount,
    jur.name,
  );

  table(doc, {
    headers: ["OPR Criterion", "Auto-screening result", "Notes"],
    widths: [200, 130, 170],
    align: ["left", "center", "left"],
    rows: screeningResults.map((c) => [c.label, statusLabel(c.status), c.note]),
  });
  doc.moveDown(0.3);

  const anyScreenedOut = screeningResults.some((c) => c.status === "screened_out");
  doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(
    anyScreenedOut
      ? "AUTO-SCREENING RESULT: SCREENED OUT — presumed less-than-significant under CEQA Guidelines § 15064.3."
      : "AUTO-SCREENING RESULT: NOT screened out by any auto-evaluable criterion. Verification-pending criteria above may still resolve to screened-out; otherwise, complete the §3.1 / §3.2 baseline + project-VMT inputs and apply the §3.4 significance threshold.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Note: this screening cascade does not fabricate VMT numbers or substitute for a full MPO model run. The TPA, low-VMT-map, and redevelopment criteria are GIS-dependent and on the Phase-2 roadmap (per REGIONAL-SPECS/california-vmt-spec.md § 5).",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  caSubsection(doc, "3.4 Significance Threshold");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per ${jur.guidelinesDoc}: project VMT (per capita for residential, per employee for office, total for retail) is significant if it exceeds ${(100 - jur.vmtThresholdPct).toFixed(1)}% of the ${jur.baselineGeography} (i.e., reduction of less than ${jur.vmtThresholdPct}% from baseline). The baseline value must be drawn from the ${jur.mpoName} latest published RTP/SCS travel demand model; the value is not hardcoded in this report because MPO model updates and RTP/SCS cycles shift the published number.`,
    { paragraphGap: 6 },
  );

  caSubsection(doc, "3.5 VMT-Reduction Mitigation Menu (CAPCOA 2024)");
  doc.font("body").fontSize(10).fillColor("black").text(
    "If the project exceeds the §3.4 significance threshold, the CEQA-VMT analysis must propose VMT-reducing mitigation drawn from the CAPCOA Handbook for Analyzing GHG Emission Reductions, Assessing Climate Vulnerabilities, and Advancing Health and Equity (2024 Edition, adopted 2024-11-21; supersedes Dec 2021). The categories and representative measures below are the Tier-1 reference menu. Project-specific reduction percentages must be computed in CAPCOA's per-measure formulas, parameterized on context (urban / suburban / rural; transit availability), with the multiplicative stacked-measures cap applied to prevent double-counting.",
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["CAPCOA category", "Representative measures", "Reduction range (context-dependent)"],
    widths: [130, 220, 150],
    align: ["left", "left", "left"],
    rows: [
      ["Land use", "Increased residential density (T-1); increased job density (T-2); diverse / mixed-use land use (T-3); affordable-housing integration (T-4)", "Up to ~30% (density); ~9% (mixed-use); ~10% (affordable inclusion). Urban context, project-specific."],
      ["Neighborhood design", "Improved pedestrian network (T-7); traffic calming (T-9, T-26); local-serving retail (T-27); intersection-density / street-grid improvements", "0–~7% per measure; high-leverage when combined with transit access."],
      ["Transit", "Transit-accessibility improvements (T-5); subsidized / discounted transit (T-12); bicycle end-trip facilities (T-13); bike-sharing (T-29); EV charging (T-31)", "0–~15% (transit access); transit subsidy ~0.3–20% per CAPCOA Ch. 3."],
      ["Parking management", "Limit residential parking supply (T-22); price residential parking (T-23); unbundle parking costs (T-24); price workplace parking (T-20); cash-out (T-21); car-sharing (T-18, T-28)", "Parking supply / pricing among the highest-leverage measures in suburban contexts."],
      ["Trip reduction / TDM", "Workplace TDM program (T-10, T-30); ride-share (T-11); marketing (T-14); compressed work week (T-15); telecommute / WFH (T-16); vehicle-trip caps (T-17); school-pool (T-19)", "Workplace TDM up to ~21%; telecommute / compressed weeks scale with eligible employee share."],
      ["Pricing / road management", "Cordon / area pricing; HOT lanes; VMT fee programs; locally-administered VMT mitigation funds (e.g., San Diego Mobility Choices Active Transportation In-Lieu Fee, City of Fresno VMT Reduction Program 2025)", "Context-specific; programmatic mitigation typically requires nexus / fee adoption by the lead agency."],
    ],
  });
  doc.moveDown(0.3);
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Measure codes (T-1 … T-31) reference CAPCOA 2024 Handbook Ch. 3. Reduction ranges above are illustrative ceilings drawn from the published handbook tables; the binding project-specific reduction is computed from the per-measure formula in the host jurisdiction's adopted CAPCOA edition (some jurisdictions still lock to CAPCOA Dec 2021 — confirm at scoping). The 2024 update split measures into (a) sufficient-evidence-for-quantified-reductions and (b) requires-additional-evidence; only (a) is creditable as primary mitigation, (b) is supplemental.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Important: intersection geometry improvements (turn lanes, signal-timing retiming, queue jumps, additional through lanes) do NOT reduce VMT and are NOT creditable mitigation under CEQA Guidelines § 15064.3(b)(1). Those improvements remain creditable as non-CEQA operational improvements (see §4 of this report) but cannot serve as CEQA-VMT mitigation. Caltrans' July 2022 Mitigation Playbook (citing CAPCOA Dec 2021, now superseded by 2024) specifically endorses increased density and affordable-housing inclusion as the highest-leverage residential VMT mitigations.",
    { paragraphGap: 6 },
  );

  // --- §3.6 Cumulative VMT Determination ---------------------------------
  caSubsection(doc, "3.6 Cumulative VMT Determination");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per CEQA Guidelines § 15130 and OPR Technical Advisory p. 17, the CEQA-VMT analysis must evaluate the project's contribution to cumulative VMT impacts in the host RTP/SCS horizon year (${jur.rtpScs}). Two cumulative scenarios are required: (1) cumulative no-project — the RTP/SCS horizon-year baseline VMT including all reasonably-foreseeable cumulative projects; (2) cumulative plus project — the same horizon plus this project's VMT. A project's cumulative contribution is significant when the project's incremental contribution exceeds the §3.4 threshold OR when the cumulative no-project scenario already exceeds the regional GHG-reduction target and the project is not RTP/SCS-consistent (OPR p. 17).`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "This screening tool does not auto-generate cumulative VMT — the cumulative scenario requires an MPO horizon-year model run with the reasonably-foreseeable project pipeline coded. The inputs below identify what the consultant must compile.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  rows(doc, [
    ["Horizon year", jur.rtpScs],
    ["Cumulative no-project source", `${jur.mpoName} ${jur.mpoModel} run at the RTP/SCS horizon year, including all reasonably-foreseeable cumulative projects per CEQA Guidelines § 15130(b)(1)(B)`],
    ["Cumulative plus-project source", "Same MPO model run with this project coded into the cumulative pipeline"],
    ["Reasonably-foreseeable project pipeline", "Pulled from host jurisdiction's pending-applications register and the MPO's RTP committed-projects list"],
    ["GHG-reduction-target benchmark", "CARB SB 375 regional GHG target for the host MPO; cumulative exceedance + project inconsistency triggers § 15130 significance"],
    ["RTP/SCS consistency check", "See §3.7"],
  ]);
  doc.moveDown(0.3);

  // --- §3.7 RTP/SCS Consistency ------------------------------------------
  caSubsection(doc, "3.7 RTP/SCS Consistency Narrative");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per CEQA Guidelines § 15125(d) and § 15183.3, the project must demonstrate consistency with the host MPO's Sustainable Communities Strategy (${jur.rtpScs}). A project that is RTP/SCS-consistent receives presumption that its land-use pattern aligns with the regional GHG-reduction trajectory. Inconsistency does not by itself render a project significant, but it removes the consistency presumption and shifts the burden onto the lead agency to demonstrate that the project's deviation from the SCS does not cumulatively undermine the SB 375 target.`,
    { paragraphGap: 6 },
  );
  rows(doc, [
    ["SCS land-use designation", `Pull the project parcel's SCS designation from the ${jur.mpoName} RTP/SCS land-use overlay`],
    ["Project land use vs. SCS designation", "Apply the SCS-consistency test from the host MPO's adopted SCS consistency review framework (varies by MPO — SCAG uses the SCS Consistency Review Process; MTC uses the PBA 2050 Implementation Plan; SANDAG uses the SB 375 Consistency Determination)"],
    ["Transit Priority Project (TPP) eligibility", "PRC § 21155 — TPPs receive streamlined CEQA review; check if project qualifies"],
    ["Priority Development Area (PDA) eligibility", "MTC region: PBA 2050 PDA overlay confers SCS-consistency presumption"],
    ["Priority Conservation Area (PCA) overlap", "Project sited in a PCA cannot claim SCS consistency without explicit lead-agency variance"],
    ["GHG-reduction policy alignment", `Project's role in helping the host MPO meet its CARB SB 375 GHG target (per the latest CARB Sustainable Communities Strategy Evaluation)`],
  ]);
  doc.moveDown(0.3);
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Note: SCS consistency is a narrative determination by the lead agency, not a computed metric. The renderer surfaces the required inputs; the narrative itself is compiled by the consultant against the host MPO's consistency review framework prior to submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §4 Non-CEQA Operational Analysis (LOS engine output) --------------
  caSection(doc, "4.0 NON-CEQA OPERATIONAL ANALYSIS");
  doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(
    "SCOPE — NON-CEQA OPERATIONAL ANALYSIS ONLY",
    { paragraphGap: 2 },
  );
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    `Per Pub. Resources Code § 21099(b)(2) and CEQA Guidelines § 15064.3(a), level-of-service analysis does not constitute a CEQA transportation-impact determination. This section is provided for non-CEQA operational review including ${jur.operationalContext} — that is, Caltrans Encroachment Permit review under the Encroachment Permits Manual, signal warrant analysis under CA MUTCD 2026 Part 4C, queueing and site-access design under Highway Design Manual Chapters 100 and 400, and the local agency's adopted operational standards.`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  caSubsection(doc, "4.1 Methodology");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Level of Service (LOS) is calculated per the Highway Capacity Manual 6th Edition, Chapter 19 (Signalized Intersections), Equation 19-13 (control delay) and Equation 19-50 (95th-percentile queue). LOS thresholds (HCM 6th Ed. Exhibit 19-8): A ≤10s · B ≤20s · C ≤35s · D ≤55s · E ≤80s · F >80s of average control delay per vehicle. Caltrans Highway Design Manual (HDM, 7th Edition) Topic 102 + Ch. 400 governs LOS-based design capacity for SHS facilities. CA MUTCD 2026 Part 4C governs signal-warrant analyses.",
    { paragraphGap: 6 },
  );

  caSubsection(doc, "4.2 Trip Generation");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Gross trip generation is calculated per the ITE Trip Generation Manual 11th Edition for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed development size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Background traffic growth is applied at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"}. Pass-by capture applied: ${r.passByPctApplied ?? 0}%; internal capture applied: ${r.internalCapturePctApplied ?? 0}%.`,
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

  caSubsection(doc, "4.3 Affected Intersections — Existing / No-Build / Build");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Three scenarios are evaluated at each affected intersection: (1) Existing — current-year volumes from live data feeds, no growth applied; (2) No-Build (opening year ${req.openingYear ?? "—"}) — existing volumes grown at ${r.growthAppliedPct ?? "—"}%/yr over ${r.growthYears ?? "—"} year(s) without project trips; (3) Build (opening year ${req.openingYear ?? "—"}) — No-Build volumes plus the proposed development's external trips at the assigned distribution.`,
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

    caSubsection(doc, "4.4 Recommended Operational Improvements (Non-CEQA)");
    const needMitigation = intersections.filter((it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none");
    if (needMitigation.length > 0) {
      doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
        "Improvements below address non-CEQA operational impact only. Per § 15064.3, intersection geometry improvements do NOT reduce VMT and are NOT creditable as CEQA mitigation; CEQA mitigation must come from CAPCOA 2024 (see §3.5).",
        { paragraphGap: 6 },
      );
      doc.fillColor("black");
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
        "No operational improvements are necessary to maintain the LOS D standard within the study network under build conditions (non-CEQA scope).",
        { paragraphGap: 6 },
      );
    }
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No signalized intersections within the study radius. Off-site operational capacity impact is not anticipated for this development.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  // --- §5 Caltrans Coordination ------------------------------------------
  caSection(doc, "5.0 CALTRANS COORDINATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    "If the project fronts on a Caltrans State Highway System (SHS) facility or proposes new access to an SHS route, the following Caltrans coordination items apply:",
    { paragraphGap: 6 },
  );
  rows(doc, [
    ["CEQA significance on SHS", "Caltrans Transportation Analysis under CEQA (TAC, 2nd Ed., Sept 2025)"],
    ["Induced-travel analysis", "Caltrans Transportation Analysis Framework (TAF, 2nd Ed., Sept 2025) — capacity-increasing SHS projects only"],
    ["Design references", "Caltrans Highway Design Manual (HDM, 7th Edition), Chapters 100 + 400"],
    ["Encroachment permitting", "Caltrans Encroachment Permits Manual (EPM) — non-CEQA, LOS-based operational analysis required"],
    ["Signal warrants", "California MUTCD 2026 (effective 2026-01-18), Part 4C"],
    ["Signal timing operations", "Caltrans Traffic Signal Operations Manual (Jan 2020)"],
  ]);
  doc.moveDown(0.5);

  // --- §6 Findings -------------------------------------------------------
  const findings: string[] = Array.isArray(r.findings) ? r.findings : [];
  if (findings.length > 0) {
    caSection(doc, "6.0 FINDINGS");
    doc.font("body").fontSize(10).fillColor("black");
    for (const f of findings) {
      doc.text("• " + f, { paragraphGap: 4 });
    }
    doc.moveDown(0.3);
  }

  // --- §7 Methodology Notes ----------------------------------------------
  const methodology: string[] = Array.isArray(r.methodology) ? r.methodology : [];
  if (methodology.length > 0) {
    caSection(doc, "7.0 METHODOLOGY NOTES (NON-CEQA OPERATIONAL)");
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY);
    for (const m of methodology) {
      doc.text("• " + m, { paragraphGap: 4 });
    }
    doc.fillColor("black");
  }
}

/** California-style section heading (uppercase, bold). Mirrors gaSection. */
function caSection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(13).fillColor("black").text(title, { characterSpacing: 0.5 });
  doc.moveDown(0.3);
  doc.x = PAGE_MARGIN;
}

/** California-style subsection heading. Mirrors gaSubsection. */
function caSubsection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(11).fillColor("black").text(title);
  doc.moveDown(0.2);
  doc.x = PAGE_MARGIN;
}

/**
 * GA Worksheet / Screening Letter (Gwinnett County DOT TIS Guidelines 2023
 * Level 1 / GRTA Limited Trip Generation Memo). Short-form deliverable
 * for projects below the warrant-implicit TIS trigger (≤20 PHT per
 * Gwinnett Table 1; <1,000 Net ADT per GRTA DRI Procedures p. 9).
 *
 * Content (per Gwinnett Level 1 verbatim section list): Location
 * Description; Existing/Proposed Land Use; Trip Generation Estimate;
 * Access Management Review; Adjacent Access Spacing; Intersection Sight
 * Distance; Connectivity & Circulation Review; Existing Street Functional
 * Classification; Posted Speed Limit; Future Identified Projects
 * (GCCTP/GDOT/SPLOST); Existing-Conditions Scenario only; Intersection
 * & Roadway Geometric Recommendations. No turning movement counts, no
 * crash history, no future ADT, no operations analysis.
 */
function renderTisGeorgiaWorksheet(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
  tierInput: TierInput,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const tierName = jurisdictionTierLabel(region, "worksheet");

  // --- Header banner ----------------------------------------------------
  gaSection(doc, "TRAFFIC IMPACT SCREENING LETTER");
  doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(tierName, { paragraphGap: 4 });
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Worksheet-tier deliverable per Gwinnett County DOT TIS Guidelines (2023) Level 1 / GRTA DRI Review Procedures (2021-03-10) Limited Trip Generation Memo. Selected automatically based on the project's screened trip generation; an Abbreviated or Full TIS would be substituted at higher tiers.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §1 Location Description -----------------------------------------
  gaSection(doc, "1.0 LOCATION DESCRIPTION");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Region", region.displayName],
    ["Opening year", String(req.openingYear ?? "—")],
  ]);
  doc.moveDown(0.5);

  // --- §2 Existing / Proposed Land Use ---------------------------------
  gaSection(doc, "2.0 EXISTING AND PROPOSED LAND USE");
  rows(doc, [
    ["Proposed ITE land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Existing land use", "Subject to site verification (Gwinnett Level 1 does not require existing-use trip credit)"],
  ]);
  doc.moveDown(0.5);

  // --- §3 Trip Generation Estimate -------------------------------------
  gaSection(doc, "3.0 TRIP GENERATION ESTIMATE");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is estimated per the ITE Trip Generation Manual (current edition) for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. No pass-by or internal capture credits have been applied at this screening tier (Gwinnett Level 1 explicitly excludes those from the worksheet scope).`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Trips"],
    widths: [280, 100],
    align: ["left", "right"],
    rows: [
      ["Daily total", fmtNum(tg.dailyTrips)],
      ["AM peak hour", fmtNum(tg.amPeakTrips)],
      ["PM peak hour (in)", fmtNum(tg.pmIn)],
      ["PM peak hour (out)", fmtNum(tg.pmOut)],
      ["PM peak hour (total)", fmtNum(tierInput.pmPeakTrips)],
    ],
  });
  doc.moveDown(0.3);

  // --- §4 Tier Determination -------------------------------------------
  gaSection(doc, "4.0 WORKSHEET-TIER DETERMINATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per Gwinnett County DOT TIS Guidelines (2023) Table 1, projects generating 0–20 peak-hour site-generated automobile trips qualify as Level 1. The proposed development estimate of ${fmtNum(tierInput.pmPeakTrips)} PM peak-hour trips falls within this band; accordingly, no Level 2 (Abbreviated) or Level 3 (Full) TIS is required. The GRTA equivalent (Limited Trip Generation Memo, applicable when Net ADT < 1,000) is also satisfied at ${fmtNum(tierInput.dailyTrips)} daily trips.`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Verification: the consultant should confirm the screened trip count against any reviewing-agency-specific credit (existing-use credit, internal capture) before finalizing this determination. Where the reviewing agency requests a higher-tier deliverable (e.g. site fronts a state route, or the agency cites a non-trip-related concern), regenerate the report with Tier = Abbreviated or Full from the form.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §5 Access, Sight Distance, Circulation --------------------------
  gaSection(doc, "5.0 ACCESS MANAGEMENT AND SITE CIRCULATION");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "The following items are part of the Gwinnett Level 1 scope and require site-plan inputs to populate in this screening tool: (a) adjacent access spacing (upstream and downstream driveways within the influence area); (b) intersection sight distance per AASHTO Green Book / GDOT BLR-style checks; (c) connectivity and circulation review against the local jurisdiction's site-plan standards; (d) inventory of existing street functional classification and posted speed limit on each fronting roadway; (e) review of future identified projects in the Gwinnett County Comprehensive Transportation Plan (GCCTP), GDOT TIP/STIP, and SPLOST programs. Verify these items against the site plan prior to submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §6 Findings -----------------------------------------------------
  gaSection(doc, "6.0 FINDINGS");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text(`• The proposed ${project.projectName || "development"} is projected to generate ${fmtNum(tierInput.dailyTrips)} daily trips and ${fmtNum(tierInput.pmPeakTrips)} PM peak-hour trips.`, { paragraphGap: 2 });
  doc.text("• Trip generation falls within Gwinnett County DOT Level 1 worksheet criteria; no Level 2 or Level 3 TIS is required at this tier.", { paragraphGap: 2 });
  doc.text("• Site access geometry, sight distance, and pedestrian / bicycle connectivity should be verified against the final site plan and applicable jurisdictional standards prior to permit submittal.", { paragraphGap: 4 });
  doc.moveDown(0.5);

  // --- PE Seal block ---------------------------------------------------
  gaSection(doc, "PROFESSIONAL ENGINEER CERTIFICATION");
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "This screening letter has been prepared at the worksheet tier defined by Gwinnett County DOT TIS Guidelines (2023) and is consistent with GRTA DRI Review Procedures Adopted 2021-03-10. As a screening-level deliverable it does not substitute for a full TIS where one is required by the reviewing agency. The signing PE attests only to the worksheet-tier scope and that the project's screened trip generation falls below the warrant-implicit Level 2 threshold.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
}

// ---------------------------------------------------------------------------
// Gwinnett Level 2 / Abbreviated TIS renderer.
//
// Level 2 per Gwinnett County DOT TIS Guidelines (2023) is a strict superset
// of Level 1 (Worksheet) plus existing/future ADT, turning movement volumes,
// truck circulation, pedestrian/bicycle and transit inventories, trip
// distribution + pass-by assumptions, a Traffic Operation Analysis, MUTCD
// signal warrant analysis (as part of an Intersection Control Evaluation),
// turn lane warrant analysis, and traffic control recommendations.
//
// Explicitly excluded at Level 2 (Level 3 / Full TIS triggers): crash
// history, comparative no-build vs. build scenarios, and turn-lane storage
// recommendations. The §7 operations table therefore reports Existing and
// Future-with-Project conditions only — no No-Build column, no Δ-delay
// against No-Build.
// ---------------------------------------------------------------------------
function renderTisGeorgiaAbbreviated(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
  tierInput: TierInput,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];
  const tierName = jurisdictionTierLabel(region, "abbreviated");

  // --- Header banner ----------------------------------------------------
  gaSection(doc, "TRAFFIC IMPACT STUDY — ABBREVIATED");
  doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(tierName, { paragraphGap: 4 });
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Abbreviated-tier deliverable per Gwinnett County DOT TIS Guidelines (2023) Level 2 (21–249 PM peak-hour site-generated trips). Selected automatically based on the project's screened trip generation; a Full TIS would be substituted at Level 3 (≥250 PHT) and a DRI-level TIS at Level 4 (≥500 PHT or DRI status).",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // Headline metric strip — same at-a-glance numbers as the Full TIS so a
  // reviewer can locate the screen quickly.
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  metricStrip(doc, [
    { label: "Intersections", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "PM PHT", value: fmtNum(tierInput.pmPeakTrips) },
    { label: "Daily trips", value: fmtNum(tierInput.dailyTrips) },
    { label: "At LOS E/F", value: String(losEf) },
  ]);
  doc.moveDown(0.6);

  // --- §1 Location Description -----------------------------------------
  gaSection(doc, "1.0 LOCATION DESCRIPTION");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Region", region.displayName],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Study radius", `${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)} mi`],
  ]);
  doc.moveDown(0.5);

  // --- §2 Existing and Proposed Land Use --------------------------------
  gaSection(doc, "2.0 EXISTING AND PROPOSED LAND USE");
  rows(doc, [
    ["Proposed ITE land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Existing land use", "Subject to site verification (existing-use trip credit may apply at this tier; confirm with reviewing agency)"],
  ]);
  doc.moveDown(0.5);

  // --- §3 Trip Generation Estimate --------------------------------------
  gaSection(doc, "3.0 TRIP GENERATION ESTIMATE");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is estimated per the ITE Trip Generation Manual 11th Edition for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`,
    { paragraphGap: 6 },
  );
  const gaAbbrTopRows: Array<[string, string]> = [
    ["Independent variable", `${tg.unit ?? "—"} (${tg.unitShort ?? "—"})`],
  ];
  if (tg.variableConfidence === "interpolated") {
    gaAbbrTopRows.push([
      "Rate confidence",
      `Interpolated${tg.variableNote ? ` — ${tg.variableNote}` : ""}`,
    ]);
  } else if (tg.variableConfidence === "ite_published") {
    gaAbbrTopRows.push(["Rate confidence", "ITE 11th Ed. published"]);
  }
  rows(doc, gaAbbrTopRows);
  doc.moveDown(0.3);
  table(doc, {
    headers: ["Period", "Trips"],
    widths: [280, 100],
    align: ["left", "right"],
    rows: [
      ["Daily total", fmtNum(tg.dailyTrips)],
      ["AM peak hour", fmtNum(tg.amPeakTrips)],
      ["PM peak hour (in)", fmtNum(tg.pmIn)],
      ["PM peak hour (out)", fmtNum(tg.pmOut)],
      ["PM peak hour (total)", fmtNum(tierInput.pmPeakTrips)],
    ],
  });
  doc.moveDown(0.5);

  // --- §4 Tier Determination -------------------------------------------
  gaSection(doc, "4.0 ABBREVIATED-TIER DETERMINATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per Gwinnett County DOT TIS Guidelines (2023) Table 1, projects generating 21–249 PM peak-hour site-generated automobile trips qualify as Level 2 (Abbreviated). The proposed development estimate of ${fmtNum(tierInput.pmPeakTrips)} PM peak-hour trips falls within this band; accordingly, a Level 2 Abbreviated deliverable is prepared rather than a Level 3 Full TIS or Level 4 DRI-level study. Where the reviewing agency requests a higher-tier deliverable (e.g. site fronts a state route, abuts a constrained corridor, or the agency cites a non-trip-related concern), regenerate the report with Tier = Full from the form.`,
    { paragraphGap: 6 },
  );

  // --- §5 Existing Conditions ------------------------------------------
  gaSection(doc, "5.0 EXISTING CONDITIONS");

  gaSubsection(doc, "5.1 Existing ADT Volumes");
  if (intersections.length > 0) {
    table(doc, {
      headers: ["Roadway segment / intersection approach", "Existing ADT (vpd)", "Source"],
      widths: [260, 110, 110],
      align: ["left", "right", "center"],
      rows: intersections.map((it) => [
        it.name ?? it.signalId ?? "—",
        fmtNum(it.existingAadt ?? it.aadt ?? it.dailyVolume),
        it.aadtSource ? String(it.aadtSource) : "GDOT 511 / TADA",
      ]),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No affected segments within the study radius.", { paragraphGap: 6 });
    doc.fillColor("black");
  }
  doc.moveDown(0.4);

  gaSubsection(doc, "5.2 Current Intersection Turning Movement Peak Period Volumes");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Peak-period turning movement volumes are sourced from the GDOT 511 NaviGAtor signal-controller feed at each affected signal and supplemented (where available) by Gwinnett County DOT counts. For formal submittal, supplementary AM and PM peak-hour TMCs conducted within the most recent 12 months are recommended.",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    table(doc, {
      headers: ["Intersection", "AM peak (veh)", "PM peak (veh)", "Count source"],
      widths: [220, 80, 80, 100],
      align: ["left", "right", "right", "center"],
      rows: intersections.map((it) => [
        it.name ?? it.signalId ?? "—",
        fmtNum(it.amPeakVolume ?? it.amTotal),
        fmtNum(it.pmPeakVolume ?? it.pmTotal ?? it.existingPeakVolume),
        it.countSource ? String(it.countSource) : "GDOT 511",
      ]),
    });
  }
  doc.moveDown(0.4);

  gaSubsection(doc, "5.3 Truck Volumes and Circulation");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Heavy-vehicle (FHWA Class 4+) percentage on fronting roadways is approximated from GDOT Traffic Analysis & Data Application (TADA) classification counts. Site truck circulation should be designed for WB-67 turning templates per GDOT Driveway & Encroachment Control Manual §6 unless the proposed land use justifies a smaller design vehicle (SU-30 / SU-40). Truck percentage applied to the operations analysis: ${fmtNum(r.truckPct ?? r.heavyVehiclePct ?? 3, 1)}%.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "5.4 Pedestrian and Bicycle Facilities Summary");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Existing sidewalk continuity, marked crosswalk locations, and bicycle facility inventory (ARC Regional Bicycle Network, Gwinnett Countywide Trails Master Plan, and any locally adopted bike/ped plans) within the study area should be confirmed against current ARC and Gwinnett County DOT mapping prior to submittal. Programmed bicycle and pedestrian improvements per the ARC Regional Transportation Plan (RTP) should be reviewed during the methodology meeting.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "5.5 Existing Transit Routes and Stops");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Transit service within the study area should be confirmed against current Gwinnett County Transit, MARTA (Routes 110/410 cross-county service), and GRTA Xpress route maps (noting the May 2026 consolidation of GRTA Xpress under the Georgia Transportation Efficiency Authority, HB 297). Stop locations within ¼ mile of the site frontage warrant inclusion in the access management discussion. Proximity to fixed-route transit may support ARC Air Quality Benchmark trip-mode credit if pursued.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.4);

  // --- §6 Future Conditions --------------------------------------------
  gaSection(doc, "6.0 FUTURE CONDITIONS");

  gaSubsection(doc, "6.1 Future ADT Volumes");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Future-year ADT volumes are calculated by applying background traffic growth at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s) to existing volumes, then layering the proposed development's site-generated daily trips (${fmtNum(tierInput.dailyTrips)} vpd gross) net of any pass-by and internal capture credits. Growth rate is consistent with GDOT historical TADA growth observed along comparable roadways in the study area.`,
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    table(doc, {
      headers: ["Roadway segment / intersection approach", "Future ADT (vpd)", "Δ vs. existing"],
      widths: [260, 110, 110],
      align: ["left", "right", "right"],
      rows: intersections.map((it) => {
        const existing = Number(it.existingAadt ?? it.aadt ?? it.dailyVolume ?? 0);
        const future = Number(it.futureAadt ?? (existing * Math.pow(1 + Number(r.growthAppliedPct ?? 0) / 100, Number(r.growthYears ?? 0))));
        return [
          it.name ?? it.signalId ?? "—",
          fmtNum(future),
          existing > 0 ? `+${fmtNum(future - existing)}` : "—",
        ];
      }),
    });
  }
  doc.moveDown(0.4);

  gaSubsection(doc, "6.2 Distribution and Assignment Assumptions");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Directional distribution of site-generated trips is based on the existing roadway network geometry, proximity to project access points, regional travel patterns from the ARC Activity-Based Model (ABM2), and engineering judgment. Assignment to the study network follows a proportional allocation by signal proximity and approach geometry; the per-intersection allocation is reflected in the §7 Traffic Operation Analysis below. For final submittal, distribution percentages should be confirmed during the methodology meeting with Gwinnett County DOT, GDOT District 7, and (where applicable) GTEA.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "6.3 Pass-By and Trip-Generation Reduction Assumptions");
  rows(doc, [
    ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
    ["Internal capture applied", `${r.internalCapturePctApplied ?? 0}%`],
    ["Background growth applied", `${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s)`],
    ["Weather condition", String(r.weather ?? req.weather ?? "clear")],
  ]);
  if (periods.length > 0) {
    doc.moveDown(0.3);
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
  }
  doc.moveDown(0.3);
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Pass-by and internal capture rates follow the ITE Trip Generation Handbook (current edition) for the applicable land use. Where the screened rate exceeds the ITE Handbook 85th-percentile value, the reduction is held back to the 85th percentile.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- §7 Traffic Operation Analysis -----------------------------------
  // Level 2 reports Existing + Future-with-Project only; the No-Build
  // scenario and the Δ-delay comparison against No-Build are Level 3+.
  gaSection(doc, "7.0 TRAFFIC OPERATION ANALYSIS");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Level of Service (LOS) is calculated per the Highway Capacity Manual 6th Edition, Chapter 19 (Signalized Intersections), Equation 19-13 (control delay) and Equation 19-50 (95th-percentile queue). LOS is reported per HCM 6th Ed. Exhibit 19-8 thresholds: A ≤10s · B ≤20s · C ≤35s · D ≤55s · E ≤80s · F >80s of average control delay per vehicle. Per Gwinnett DOT Level 2 scope, Existing and Future-with-Project conditions are reported; comparative No-Build vs. Build scenario analysis is a Level 3 (Full TIS) requirement and is not included here.",
    { paragraphGap: 6 },
  );

  if (intersections.length > 0) {
    table(doc, {
      headers: ["Intersection", "Existing LOS", "Existing delay (s)", "Future LOS", "Future delay (s)", "Q95 (ft)"],
      widths: [180, 60, 70, 60, 70, 60],
      align: ["left", "center", "right", "center", "right", "right"],
      rows: intersections.map((it) => {
        const currentLos = it.currentLos ?? it.existingLos ?? "—";
        const currentDelay = it.currentDelaySec ?? it.existingDelaySec;
        const futureLos = it.futureLos ?? "—";
        const futureDelay = it.futureDelaySec;
        return [
          it.name ?? it.signalId ?? "—",
          String(currentLos),
          fmtNum(currentDelay, 1),
          String(futureLos),
          fmtNum(futureDelay, 1),
          fmtNum(it.queue95thFt),
        ];
      }),
    });
  }
  doc.moveDown(0.4);

  // --- §8 MUTCD Signal Warrant Analysis (ICE) --------------------------
  gaSection(doc, "8.0 MUTCD SIGNAL WARRANT ANALYSIS (ICE)");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Where the future condition introduces new traffic demand at an unsignalized intersection within the study network, a signal warrant analysis is presented as part of an Intersection Control Evaluation (ICE) per FHWA Every Day Counts and GDOT design policy. The applicable warrants from the Manual on Uniform Traffic Control Devices (MUTCD, 11th Edition, 2023) Chapter 4C are:",
    { paragraphGap: 4 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  doc.text("• Warrant 1 — Eight-Hour Vehicular Volume (4C.02): Conditions A (minimum vehicular volume) and B (interruption of continuous traffic).", { paragraphGap: 2 });
  doc.text("• Warrant 2 — Four-Hour Vehicular Volume (4C.03).", { paragraphGap: 2 });
  doc.text("• Warrant 3 — Peak Hour (4C.04).", { paragraphGap: 2 });
  doc.text("• Warrant 4 — Pedestrian Volume (4C.05).", { paragraphGap: 2 });
  doc.text("• Warrant 5 — School Crossing (4C.06).", { paragraphGap: 2 });
  doc.text("• Warrant 6 — Coordinated Signal System (4C.07).", { paragraphGap: 2 });
  doc.text("• Warrant 7 — Crash Experience (4C.08) — flagged as data-dependent; see scope note below.", { paragraphGap: 2 });
  doc.text("• Warrant 8 — Roadway Network (4C.09).", { paragraphGap: 2 });
  doc.text("• Warrant 9 — Intersection Near a Highway-Rail Grade Crossing (4C.10).", { paragraphGap: 4 });
  doc.fillColor("black");
  doc.font("body").fontSize(10).fillColor("black").text(
    "The ICE compares signal control against alternative control strategies (modern roundabout, restricted-crossing U-turn, etc.) on safety, operations, multimodal, environmental, and life-cycle-cost criteria per FHWA-SA-18-027. This screening tool does not auto-execute MUTCD warrant calculations; per-intersection warrant evaluation should be completed using the §5.2 turning movement volumes and §6.1 future ADT inputs above, and submitted with the ICE matrix during the methodology meeting. Warrant 7 (Crash Experience) requires crash history input that is not included in the Level 2 scope.",
    { paragraphGap: 6 },
  );

  // --- §9 Turn Lane Warrant Analysis -----------------------------------
  gaSection(doc, "9.0 TURN LANE WARRANT ANALYSIS");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Turn lane warrant analysis on the major street at each project access and at affected study intersections is conducted per NCHRP Report 457 (Engineering Study Guide for Evaluating Intersection Improvements) and the AASHTO Policy on Geometric Design of Highways and Streets (Green Book, 7th Edition, 2018) — supplemented by GDOT Driveway & Encroachment Control Manual §6 left-turn lane and §7 right-turn lane criteria. The warrant inputs are the §5.2 peak-period turning volumes, the §6.1 future ADT volumes, the §5.3 truck percentage, and the posted/operating speed on the major street.",
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Turn lane storage length recommendations are a Level 3 (Full TIS) deliverable and are not included at this tier. The Level 2 warrant analysis identifies whether a turn lane is warranted and the design vehicle that governs; final taper, deceleration, and storage geometry should be developed in the Full TIS or under separate site-plan review.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §10 Traffic Control Recommendations -----------------------------
  gaSection(doc, "10.0 TRAFFIC CONTROL RECOMMENDATIONS");
  const needMitigation = intersections.filter((it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none");
  if (needMitigation.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "Based on the §7 Traffic Operation Analysis and §8/§9 warrant findings, the following traffic control adjustments are recommended at affected study intersections. Storage-length geometry is intentionally left to the Level 3 / Full TIS scope per Gwinnett County DOT TIS Guidelines (2023).",
      { paragraphGap: 6 },
    );
    for (const it of needMitigation) {
      const sev = String(it.mitigationSeverity ?? "").toUpperCase();
      doc.font("bold").text(`${it.name ?? it.signalId} `, { continued: true });
      doc.font("body").fillColor(TEXT_GRAY).text(`[${sev}]`, { continued: false });
      doc.font("body").fillColor("black").text("  " + it.mitigation);
      doc.moveDown(0.3);
    }
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      "No traffic control adjustments are recommended at the study intersections under the Level 2 operations analysis. Signal warrants (§8) and turn lane warrants (§9) should be re-evaluated against the final site plan prior to permit submittal.",
      { paragraphGap: 6 },
    );
  }

  // --- §11 Access Management and Site Circulation ----------------------
  gaSection(doc, "11.0 ACCESS MANAGEMENT AND SITE CIRCULATION");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Adjacent access spacing (upstream and downstream driveways within the influence area), intersection sight distance per AASHTO Green Book / GDOT BLR-style checks, and connectivity against the local jurisdiction's site-plan standards should be verified against the final site plan prior to submittal. The fronting roadway functional classification and posted speed limit should be inventoried, and programmed projects in the Gwinnett County Comprehensive Transportation Plan (GCCTP), GDOT TIP/STIP, and SPLOST programs should be reviewed at the methodology meeting.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §12 Findings ----------------------------------------------------
  gaSection(doc, "12.0 FINDINGS");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text(`• The proposed ${project.projectName || "development"} is projected to generate ${fmtNum(tierInput.dailyTrips)} daily trips and ${fmtNum(tierInput.pmPeakTrips)} PM peak-hour trips.`, { paragraphGap: 2 });
  doc.text("• Trip generation falls within Gwinnett County DOT Level 2 (Abbreviated) criteria; a Level 3 Full TIS is not required at this tier.", { paragraphGap: 2 });
  if (losEf > 0) {
    doc.text(`• ${losEf} intersection${losEf === 1 ? "" : "s"} operate at LOS E or F under future conditions and warrant mitigation per the §10 recommendations.`, { paragraphGap: 2 });
  } else {
    doc.text("• All affected study intersections are projected to operate at LOS D or better under future conditions, meeting the GDOT/Gwinnett LOS standard.", { paragraphGap: 2 });
  }
  doc.text("• MUTCD signal warrant analysis (§8) and turn lane warrant analysis (§9) should be completed by the engineer of record using the §5.2 and §6.1 inputs prior to permit submittal.", { paragraphGap: 4 });
  const engineFindings: string[] = Array.isArray(r.findings) ? r.findings : [];
  for (const f of engineFindings) {
    doc.text("• " + f, { paragraphGap: 2 });
  }
  doc.moveDown(0.4);

  // --- PE Seal block ---------------------------------------------------
  gaSection(doc, "PROFESSIONAL ENGINEER CERTIFICATION");
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "This Abbreviated Traffic Impact Study has been prepared at the Level 2 tier defined by Gwinnett County DOT TIS Guidelines (2023). As an Abbreviated deliverable it covers existing + future-year operations, signal and turn-lane warrant identification, and traffic control recommendations; it does not include crash history, comparative No-Build vs. Build scenario analysis, or turn-lane storage geometry — those are Level 3 (Full TIS) elements. The signing PE attests to the Level 2 scope as set forth herein.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
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

  // --- Deliverable shape: TA vs TS (DfT 2007 Appendix B) -----------------
  // Calibration against three published London residential TAs:
  //   • Holloway (985 DU, Velocity 2021)             — full 8-chapter
  //     TfL Healthy Streets TA TOC (GLA-referable)
  //   • Registry Beckenham (134 DU, Waterman 2022)   — 6-chapter TS shape
  //   • Hyde Estate (115 DU, Patrick Parsons 2020)   — 7-chapter TS shape
  // showed that sub-200-DU borough-only schemes overwhelmingly use the
  // leaner Transport Statement (TS) shape. The branch here implements
  // the two Appendix B tables: size-band thresholds (residential 50 /
  // 80 DU, hotel 75 / 100 bedrooms, floorspace bands for other use
  // classes) AND the "regardless of size" escalator table (≥ 30 vph in
  // any peak, ≥ 100 vpd, ≥ 100 parking spaces — last not derivable from
  // the engine — AQMA proximity, or inadequate local transport
  // infrastructure). The latter two are surfaced as user-flagged
  // TisRequest inputs (ptaInsideAqma, infrastructureAdequacy) so the
  // renderer can document the trigger when the engine itself cannot
  // compute it.
  const code = String(tg.landUseCode ?? "");
  const sizeNum = Number(tg.size ?? 0);
  const isResidentialC3 = code.startsWith("21") || code.startsWith("22") || code.startsWith("23");
  const isHotelC1 = code === "310" || code === "311" || code === "320" || code === "330";
  const unitStr = String(tg.unit ?? "").toLowerCase();
  const sizeM2 = unitStr.includes("ksf") ? sizeNum * 92.9 : sizeNum;

  let sizeShape: "ta" | "ts" | "below_ts" = "ta";
  let sizeRule = "";
  if (isResidentialC3) {
    if (sizeNum < 50) { sizeShape = "below_ts"; sizeRule = `${sizeNum} dwellings < 50-unit DfT 2007 Appendix B Table 1 residential TS floor — no assessment recommended`; }
    else if (sizeNum <= 80) { sizeShape = "ts"; sizeRule = `${sizeNum} dwellings within the 50–80 residential TS band per DfT 2007 Appendix B Table 1`; }
    else { sizeShape = "ta"; sizeRule = `${sizeNum} dwellings > 80-unit residential TA trigger per DfT 2007 Appendix B Table 1`; }
  } else if (isHotelC1) {
    if (sizeNum < 75) { sizeShape = "below_ts"; sizeRule = `${sizeNum} bedrooms < 75-bedroom C1 hotel TS floor per DfT 2007 Appendix B Table 1 — no assessment recommended`; }
    else if (sizeNum <= 100) { sizeShape = "ts"; sizeRule = `${sizeNum} bedrooms within the 75–100 C1 hotel TS band per DfT 2007 Appendix B Table 1`; }
    else { sizeShape = "ta"; sizeRule = `${sizeNum} bedrooms > 100-bedroom C1 hotel TA trigger per DfT 2007 Appendix B Table 1`; }
  } else {
    // Other use classes: conservative middle ground at ~750 m² TS floor,
    // ~2,000 m² TA threshold (matches study-tier.ukTier defaults).
    if (sizeM2 < 750) { sizeShape = "below_ts"; sizeRule = `${Math.round(sizeM2)} m² < ~750 m² TS floor for use class ${code || "(unspecified)"} — no assessment recommended`; }
    else if (sizeM2 <= 2000) { sizeShape = "ts"; sizeRule = `${Math.round(sizeM2)} m² within ~750–2,000 m² TS band for use class ${code || "(unspecified)"}`; }
    else { sizeShape = "ta"; sizeRule = `${Math.round(sizeM2)} m² > ~2,000 m² TA threshold for use class ${code || "(unspecified)"}`; }
  }

  // Appendix B Table 1 "regardless of size" escalators. Any one forces TA.
  const escalators: string[] = [];
  const amPeak = Number(tg.amPeakTrips ?? 0);
  const pmPeak = Number(tg.pmIn ?? 0) + Number(tg.pmOut ?? 0);
  const peakHourMax = Math.max(amPeak, pmPeak);
  if (peakHourMax >= 30) escalators.push(`peak-hour two-way vehicle movements ${Math.round(peakHourMax)} ≥ 30 (Appendix B Table 1)`);
  const dailyVeh = Number(tg.dailyTrips ?? 0);
  if (dailyVeh >= 100) escalators.push(`daily two-way vehicle movements ${Math.round(dailyVeh)} ≥ 100 (Appendix B Table 1)`);
  if (req.ptaInsideAqma === true) escalators.push("site lies inside or adjacent to a declared Air Quality Management Area (LAQM under Environment Act 1995)");
  if (req.infrastructureAdequacy === "inadequate") escalators.push("local transport infrastructure judged inadequate to serve the proposal");

  const deliverableShape: "ts" | "ta" = (sizeShape === "ta" || escalators.length > 0) ? "ta" : "ts";
  const isBelowAssessmentFloor = sizeShape === "below_ts" && escalators.length === 0;
  // True only when the escalator is what forced TA (size alone would
  // have given TS or below-floor). Used in the prose declaration below
  // and in the TA executive-summary disclosure.
  const escalatorTriggered = deliverableShape === "ta" && sizeShape !== "ta" && escalators.length > 0;

  if (deliverableShape === "ts") {
    renderLondonTransportStatement(doc, r, project, region, {
      isLondon,
      lpa,
      sizeRule,
      isBelowAssessmentFloor,
    });
    return;
  }

  // --- Executive Summary --------------------------------------------------
  ldnSection(doc, "EXECUTIVE SUMMARY");
  doc.font("body").fontSize(10).fillColor("black");
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  const radiusMi = Number(r.studyRadiusMi ?? req.studyRadiusMi ?? 0);
  const radiusKm = (radiusMi * 1.609344).toFixed(2);

  // In-prose declaration of the deliverable shape and the Appendix B
  // trigger that selected it. Placed before the body of the executive
  // summary so a reviewer can verify the screen in the first paragraph.
  const taTriggerSentence = escalatorTriggered
    ? `This document is structured as a Transport Assessment (TA) under the full 8-chapter TfL Healthy Streets format. Size alone (${sizeRule.toLowerCase()}) would otherwise have indicated a Transport Statement; the TA shape was forced by the DfT 2007 Appendix B "regardless of size" escalator(s): ${escalators.join("; ")}.`
    : `This document is structured as a Transport Assessment (TA) under the full 8-chapter TfL Healthy Streets format per DfT 2007 Appendix B (${sizeRule}).`;
  doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(taTriggerSentence, { paragraphGap: 6 });
  doc.font("body").fontSize(10).fillColor("black");

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
    `This report cross-references the anticipated transport effects of the proposed ${project.projectName || "development"}, located within ${region.displayName}. It is presented in the structure of a UK Transport Assessment (TA) as set out in the TfL Healthy Streets TA Recommended Contents & Chapters (last updated 17 June 2019), with the National Planning Policy Framework (NPPF, December 2024) as the statutory planning hook — paragraph 115 (sustainable modes, including the December-2024 "vision-led" framing), paragraph 116 (the residual-impact "severe" refusal test) and paragraph 118 (vision-led TA / TS plus travel plan for developments generating significant amounts of movement). Where the proposed development falls below the local planning authority's "significant amount of movement" trigger a Transport Statement (TS) may suffice in place of a full TA; the threshold is judgement-led by ${lpa}, supported by the indicative DfT 2007 Appendix B floorspace thresholds that TfL continues to host operationally at content.tfl.gov.uk/thresholds-for-transport-assessments.pdf (note that the DfT 2007 guidance was formally withdrawn in October 2014 — Appendix B remains in operational use but is no longer live policy, and the Use Class labels A1 / A2 / B1 / D1 / D2 in the table are pre-2020 nomenclature now collapsed into Class E under SI 2020/757).`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Note that the same Appendix B contains a second \"thresholds based on other considerations\" table that forces a TA regardless of floorspace whenever ANY of the following apply: ≥ 30 two-way vehicle movements in any hour; ≥ 100 two-way vehicle movements per day; ≥ 100 off-street parking spaces; location in or adjacent to an Air Quality Management Area (AQMA); or local transport infrastructure inadequate to serve the proposal. This screening-level report does not auto-evaluate AQMA proximity or infrastructure adequacy; the vehicle-movement and parking-space triggers should be checked against the engine's external-trip totals reported in §5.1 and the proposed parking provision before relying on a floorspace-only screen.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  ldnSubsection(doc, "1.2 Methodology Cross-Reference and Disclosure");
  doc.font("body").fontSize(10).fillColor("black").text(
    "This is the critical disclosure for a UK reviewer. The analysis in this report is generated by a screening engine calibrated to United States standards and is presented here as a cross-reference to UK methodology, not as a substitute for it:",
    { paragraphGap: 4 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  doc.text("• Capacity analysis uses the Highway Capacity Manual 6th Edition, Chapter 19 (signalised junctions) — NOT DMRB CD 116 (roundabouts) or CD 123 (priority and signal junctions). A chartered engineer preparing a submitted TA should re-run the affected junctions in LinSig 3, TRANSYT 16, or Junctions 11 (with ARCADY / PICADY / OSCADY modules as appropriate) and report Ratio of Flow to Capacity (RFC), Degree of Saturation (DOS), Practical Reserve Capacity (PRC) and Mean Maximum Queue (MMQ in PCUs).", { paragraphGap: 4 });
  doc.text("• Trip generation uses the ITE Trip Generation Manual 11th Edition — NOT TRICS. UK reviewers do not accept ITE rates for TA work. The required source is the TRICS multi-modal database (currently TRICS 8 generation, base release March 2025, with the TRICS Good Practice Guide 2025 and Multi-Modal Methodology 2025 as the governing methodology, and the TRICS Decide & Provide Guidance Note 2021 for vision-led applications). The 85th-percentile rate remains the conventional UK starting point in TA practice, cited from DfT 2007 §4.62 (withdrawn October 2014 but still the de-facto reference); TRICS itself is methodologically neutral on which percentile to use and recommends ≥ 20 surveys in the rank-order list before 85th-percentile figures are quoted (TRICS Good Practice Guide 2025 §14.5–14.7). The scenario filter recorded for reviewer audit is date band, TRICS Main Location Type, day type, parking provision, GFA range, and any survey-day inclusion/exclusion decision on COVID-restriction surveys (which TRICS flags in the database but does not auto-exclude — user judgement, reason for any exclusion stated in the report, per Good Practice Guide §16.6). \"Region\" alone is no longer recommended as an exclusion criterion (Good Practice Guide §5.5–5.7) and TRICS 8 no longer allows exclusion on the basis of region or area alone. Three reporting-discipline elements must accompany any TRICS rates cited in a submitted TA: (i) the TRICS Calculation Reference code and licensee TRICS licence number, both auto-printed on every page of the TRICS PDF output (GPG §13.8 + §22.7) — reports lacking either are inadmissible per TRICS T&Cs; (ii) Cross Test results (mean vs median trip-rate variation %, GPG §14.8) reported alongside the rates so the reviewer can assess weighting/bias in the selected set; and (iii) where Vision-Led / Decide & Provide factoring has been applied to the TRICS-generated rates, the raw TRICS data is presented first and the factored data second, with the factoring method and reasoning explicit (GPG §10.7) — factored figures are not TRICS data. Per the 19 May 2026 TRICS licence-monitoring notice, TRICS will contact the LPA to advise that TRICS data is to be rejected as void if cited by a non-licensed organisation; the submitting consultancy's TRICS licence and produced-by attestation must be in the report.", { paragraphGap: 4 });
  doc.text("• Level of Service is reported as letters A–F against the HCM Exhibit 19-8 control-delay thresholds (A ≤ 10 s, B ≤ 20 s, C ≤ 35 s, D ≤ 55 s, E ≤ 80 s, F > 80 s of average control delay per vehicle). LOS letters are not used in UK TA practice; the thresholds are given here so a UK reviewer can map them informally to the delay categories they recognise.", { paragraphGap: 4 });
  {
    const appliedShare = Number(r.autoModeShareApplied);
    const sharePct = Number.isFinite(appliedShare) && appliedShare > 0
      ? `${(appliedShare * 100).toFixed(0)}%`
      : "38%";
    const band = typeof req.ptalBand === "string" && req.ptalBand.length > 0 ? req.ptalBand : null;
    const ptalClause = band
      ? `driven by the supplied PTAL ${band} band (engine PTAL-band lookup against the curve calibrated to TfL Travel in London plus three published London TAs — Holloway PTAL 6a 985-unit car-free, Registry Beckenham PTAL 5 134-unit with parking, Hyde Estate PTAL 2 115-unit with parking)`
      : `no PTAL band was supplied for this run so the flat London-wide average has been applied (TfL Travel in London), which materially over-states car-mode demand at inner-London high-PTAL sites — the run should be re-issued with the site's PTAL band`;
    doc.text(`• Sustainable-mode demand is approximated through a metro-specific auto-mode-share factor (${sharePct} applied for London, per the engine's mode-share configuration sourced from TfL Travel in London). The external-trip totals shown below already reflect that ${sharePct} reduction from the gross ITE rate — ${ptalClause}. This is a screening-level approximation in place of the full multi-modal split (walking / cycling / bus / rail / car / taxi / motorcycle / LGV / HGV) that a UK TA is required to demonstrate under NPPF paragraph 115.`, { paragraphGap: 4 });
  }
  doc.text("• Geometric design citations in the engine's output are HCM and AASHTO; UK chartered review would substitute DMRB CD 109 / CD 116 / CD 122 / CD 123 (trunk) and Manual for Streets / Manual for Streets 2 (urban / residential).", { paragraphGap: 4 });
  doc.text("• Units are metric where derivable; some engine-generated fields remain in imperial (queue 95th-percentile reported in feet rather than MMQ in PCUs) and are flagged inline.", { paragraphGap: 4 });
  doc.text("• Where net peak car-mode generation falls below 15 trips per peak hour, the engine demotes the junction capacity table to an appendix and surfaces a trip-comparison narrative shell — matching the convention adopted by London consultancies (Waterman, Patrick Parsons) for sub-150-unit residential schemes. Above that threshold the junction table remains the §5.4 headline.", { paragraphGap: 6 });
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
  {
    const ptalBand = typeof req.ptalBand === "string" && req.ptalBand.length > 0 ? req.ptalBand : null;
    if (isLondon && ptalBand) {
      rows(doc, [
        ["Site PTAL band (supplied)", `PTAL ${ptalBand}`],
        ["Engine auto-mode share applied at this PTAL", `${(Number(r.autoModeShareApplied) * 100).toFixed(0)}% (calibrated against TfL Travel in London + 3 published London TAs)`],
        ["Source of band", "Caller-supplied (not computed by this engine)"],
      ]);
      doc.moveDown(0.3);
    }
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      isLondon
        ? (ptalBand
            ? `PTAL ${ptalBand} has been carried into the trip-generation calculation via the engine's PTAL-banded London auto-mode-share curve (mode-share.ts). The Accessibility Index (AI) value behind the band is not computed by this engine; the band itself was supplied by the caller and should be reconciled against the TfL 100 m × 100 m PTAL grid via WebCAT 3.0 (tfl.gov.uk planning-with-webcat) or the GIS layer on the London Datastore at the time of submittal. TfL's methodology: Service Access Points are bus stops within 640 m (8 min walk) and rail / tube / Overground / DLR / Elizabeth line / tram / river-bus stations within 960 m (12 min walk), both at the standard assumed walking speed of 80 m/min; the Equivalent Doorstep Frequency window is the AM peak 08:15–09:15; AI sums weighted EDFs across all SAPs. The published AI → PTAL bands are: PTAL 0 = AI 0 (no SAP in range); 1a = 0.01–2.50; 1b = 2.51–5.00; 2 = 5.01–10.00; 3 = 10.01–15.00; 4 = 15.01–20.00; 5 = 20.01–25.00; 6a = 25.01–40.00; 6b > 40.00. PTAL band drives the car-parking maxima under London Plan policy T6 sub-policies — Table 10.3 (T6.1 residential), Table 10.4 (T6.2 office) and Table 10.5 (T6.3 retail) are the PTAL-banded maxima; T6.4 hotel and leisure is PTAL-band narrative with no numbered maxima table; Table 10.6 (T6.5) sets non-residential disabled persons provision. Policy T6 Part B is worded as "Car-free development should be the starting point for all development proposals in places that are (or are planned to be) well-connected by public transport, with developments elsewhere designed to provide the minimum necessary parking ('car-lite')" — the policy text itself does not name a hard PTAL-band cut-off; the only explicit numeric PTAL hook in the policy is Part K, which restricts Outer London boroughs adopting minimum residential parking standards to PTAL 0–1 parts of London.`
            : "PTAL is mandatory in every London TA. The site's PTAL band (0, 1a, 1b, 2, 3, 4, 5, 6a, 6b) and Accessibility Index (AI) value were NOT supplied for this run and are not computed by this engine; they should be drawn from the TfL 100 m × 100 m PTAL grid via WebCAT 3.0 (tfl.gov.uk planning-with-webcat) or the GIS layer on the London Datastore, and the run should then be re-issued with the band passed in so the engine's London auto-mode-share is set band-specifically rather than at the flat London-wide average. TfL's methodology: Service Access Points are bus stops within 640 m (8 min walk) and rail / tube / Overground / DLR / Elizabeth line / tram / river-bus stations within 960 m (12 min walk), both at the standard assumed walking speed of 80 m/min; the Equivalent Doorstep Frequency window is the AM peak 08:15–09:15; AI sums weighted EDFs across all SAPs. The published AI → PTAL bands are: PTAL 0 = AI 0 (no SAP in range); 1a = 0.01–2.50; 1b = 2.51–5.00; 2 = 5.01–10.00; 3 = 10.01–15.00; 4 = 15.01–20.00; 5 = 20.01–25.00; 6a = 25.01–40.00; 6b > 40.00. PTAL band drives the car-parking maxima under London Plan policy T6 sub-policies — Table 10.3 (T6.1 residential), Table 10.4 (T6.2 office) and Table 10.5 (T6.3 retail) are the PTAL-banded maxima; T6.4 hotel and leisure is PTAL-band narrative with no numbered maxima table; Table 10.6 (T6.5) sets non-residential disabled persons provision. Policy T6 Part B is worded as \"Car-free development should be the starting point for all development proposals in places that are (or are planned to be) well-connected by public transport, with developments elsewhere designed to provide the minimum necessary parking ('car-lite')\" — the policy text itself does not name a hard PTAL-band cut-off; the only explicit numeric PTAL hook in the policy is Part K, which restricts Outer London boroughs adopting minimum residential parking standards to PTAL 0–1 parts of London.")
        : "Public-transport accessibility metrics for non-London UK metros vary by combined authority and are not standardised; the local authority's adopted methodology should be applied.",
      { paragraphGap: 6 },
    );
  }

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
      ? "Cycle parking provision is set by London Plan policy T5 / Table 10.2. Car-parking maxima are set by London Plan policy T6 sub-policies — Table 10.3 governs T6.1 residential, Table 10.4 governs T6.2 office, and Table 10.5 governs T6.3 retail, each banded by PTAL and use class; T6.4 hotel and leisure is PTAL-band narrative (CAZ + PTAL 4–6 operational only; PTAL 0–3 case-by-case under Healthy Streets) with no numbered maxima table; Table 10.6 covers T6.5 non-residential disabled persons provision. Borough Supplementary Planning Documents may impose tighter local standards. Neither standard is automatically determined by this engine; both should be calculated against the final scheme at the chartered-engineer stage."
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
  {
    const appliedShare = Number(r.autoModeShareApplied);
    const sharePct = Number.isFinite(appliedShare) && appliedShare > 0
      ? `${(appliedShare * 100).toFixed(0)}%`
      : "38%";
    const band = typeof req.ptalBand === "string" && req.ptalBand.length > 0 ? req.ptalBand : null;
    const bandClause = band
      ? `the PTAL ${band}–specific London auto-mode-share factor of ${sharePct}`
      : `the flat London-wide ${sharePct} auto-mode-share factor (no PTAL band supplied — band-specific share would refine this materially at high-PTAL inner-London sites)`;
    doc.font("body").fontSize(10).fillColor("black").text(
      `Gross trip generation in this report is calculated per the ITE Trip Generation Manual 11th Edition for land-use code ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. The TRICS-equivalent multi-modal table — person-trips by mode (Cars, Taxis, Motor Cycles, LGVs, OGVs, PSVs, Cyclists, Scooters, Pedestrians, plus the London public-transport split into Bus, Tram, Underground, Overground, National Rail, DLR and Water Service Passengers), linked PT trips, mean and 85th-percentile rate against the agreed TRICS filter — is not produced by this engine and must be prepared separately for any submitted TA. The figures below represent the engine's car-mode estimate after ${bandClause} has been applied to net out walking, cycling, bus, rail and other modes.`,
      { paragraphGap: 6 },
    );
  }
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

  {
    const appliedShare = Number(r.autoModeShareApplied);
    const sharePct = Number.isFinite(appliedShare) && appliedShare > 0
      ? `${(appliedShare * 100).toFixed(0)}%`
      : "38%";
    const band = typeof req.ptalBand === "string" && req.ptalBand.length > 0 ? req.ptalBand : null;
    const shareLabel = band
      ? `${sharePct} (PTAL ${band}–specific, engine PTAL-band lookup — already applied upstream)`
      : `${sharePct} (London-wide flat average, Travel in London — already applied upstream; no PTAL band supplied)`;
    rows(doc, [
      ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
      ["Internalisation (linked trips) applied", `${r.internalCapturePctApplied ?? 0}%`],
      ["Background growth applied", `${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s)`],
      ["Auto-mode-share factor (London)", shareLabel],
    ]);
  }
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
  // Sub-threshold residential schemes (Registry Beckenham 134 DU,
  // Hyde Estate 115 DU) carry no junction model in their published TAs
  // — the convention is a trip-comparison narrative against the prior
  // site use. The engine still surfaces every signal within the study
  // radius for completeness; those are demoted to Appendix A below.
  // Default-true fallback (`!== false`) preserves the headline table
  // for older payloads that pre-date `junctionImpactSignificant`.
  const junctionImpactSignificant = r.junctionImpactSignificant !== false;
  if (!junctionImpactSignificant) {
    const pmTgPeriod = periods.find((p) => p.period === "pm_peak")?.tripGeneration ?? {};
    const amTgPeriod = periods.find((p) => p.period === "am_peak")?.tripGeneration ?? {};
    const pmExt = Number(pmTgPeriod.externalTrips ?? tg.pmPeakTrips ?? 0);
    const amExt = Number(amTgPeriod.externalTrips ?? tg.amPeakTrips ?? 0);
    doc.font("body").fontSize(10).fillColor("black").text(
      `Net peak car-mode generation (${fmtNum(amExt, 0)} AM / ${fmtNum(pmExt, 0)} PM) falls below the threshold at which junction capacity is conventionally the limiting factor for a London residential TA. The screening engine still flags ${intersections.length} nearby signalised junction${intersections.length === 1 ? "" : "s"} for completeness; their Current / No-Build / With-Development LOS is provided in Appendix A for reviewer reference.`,
      { paragraphGap: 6 },
    );
    const priorUse = String(req.priorUse ?? "").trim();
    if (priorUse) {
      doc.font("body").fontSize(10).fillColor("black").text(
        `The reviewer-facing assessment in place of a junction-by-junction LOS model is a cumulative-vs-previous-use trip comparison: the site's prior ${priorUse} generated a baseline of vehicular movements that should be netted against the proposed ${tg.landUseName ?? "scheme"} trips before the residual impact is reported. The TRICS-derived prior-use rates and the resulting net trip-comparison table are to be prepared by the chartered engineer at submittal.`,
        { paragraphGap: 6 },
      );
    } else {
      doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
        `[TODO — Consultant to insert trip-comparison narrative: name the prior use on the site (set TisRequest.priorUse to populate automatically), present TRICS-derived rates for both the prior use and the proposed ${tg.landUseName ?? "scheme"}, report the net change, and conclude on whether the residual impact warrants any further capacity assessment.]`,
        { paragraphGap: 6 },
      );
      doc.fillColor("black");
    }
  } else if (intersections.length > 0) {
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
  doc.text("• TRICS multi-modal trip generation (TRICS 8; mean + 85th-percentile rate per TRICS Good Practice Guide 2025 §14, with ≥ 20 surveys for any quoted 85th-percentile figure; scenario filter — date band, TRICS Main Location Type, day type, parking provision, GFA range, COVID-flag inclusion/exclusion — recorded for reviewer audit; Cross Test mean-vs-median variation reported; TRICS Calculation Reference + licensee TRICS licence number on every output page; produced by a TRICS-licensed organisation per the 19 May 2026 TRICS licence-monitoring notice).", { paragraphGap: 3 });
  if (isLondon) {
    doc.text("• PTAL band and Accessibility Index for the site centroid (TfL grid via WebCAT).", { paragraphGap: 3 });
    doc.text("• Active Travel Zone (20-minute cycle catchment) and walking isochrones from WebCAT.", { paragraphGap: 3 });
    doc.text("• Healthy Streets Check for Designers workbook (existing and proposed).", { paragraphGap: 3 });
  }
  doc.text("• Junction capacity analysis in LinSig 3 / Junctions 11 / TRANSYT / VISSIM as appropriate, reporting RFC, DOS, PRC and MMQ (PCUs).", { paragraphGap: 3 });
  doc.text("• Borough Local Plan and SPD compliance review.", { paragraphGap: 3 });
  doc.text("• S106 / S278 / MCIL2 contribution schedule per the agreed mitigation.", { paragraphGap: 3 });
  doc.text("• Travel Plan with named Travel Plan Coordinator, modal-shift targets, monitoring and remedial-measure ladder. For any S106-secured travel plan, post-permission monitoring is conventionally undertaken via the TRICS Standardised Assessment Methodology (SAM) — Level-3 multi-modal surveys commissioned at years 1, 3 and 5 of operation, reported through the TRICS Travel Plan Monitoring Report (TPMR) module.", { paragraphGap: 3 });
  doc.text("• Construction Logistics Plan and Delivery and Servicing Plan.", { paragraphGap: 3 });
  doc.text("• Scoping note signed by the LPA" + (isLondon ? " and (for any TLRN-impacting or PSI-triggering scheme) TfL." : "."), { paragraphGap: 6 });
  doc.fillColor("black");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Sign-off should be by a Chartered Engineer (CEng) and Member of CIHT (MCIHT) under their professional registration; the PE stamp on the cover page is the US engine's default and should be replaced by the chartered engineer's signature block on submitted work.",
    { paragraphGap: 6 },
  );

  // --- Appendix A — Affected junctions (screening-level) ----------------
  // Surface the per-junction screening table only when §5.4 has been
  // demoted. When junction-impact is significant the table is already
  // the §5.4 headline; repeating it here would be noise. When demoted,
  // the table lands here so a reviewer can still audit which signals
  // the engine flagged + their LOS triplet (Current / No-Build / Build).
  if (r.junctionImpactSignificant === false && intersections.length > 0) {
    ldnSection(doc, "APPENDIX A — AFFECTED JUNCTIONS (SCREENING-LEVEL)");
    doc.font("body").fontSize(10).fillColor("black").text(
      `Screening-level LOS triplet for each signalised junction within the ${fmtNum(Number(r.studyRadiusMi ?? req.studyRadiusMi ?? 0), 2)} mi study radius. Reproduced from the engine's per-junction output for reviewer reference; per §5.4, the scheme's net peak car-mode generation falls below the threshold at which junction capacity is the limiting factor, so this table is not the headline assessment.`,
      { paragraphGap: 6 },
    );
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
    doc.moveDown(0.3);
  }

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
 * Transport Statement (TS) renderer — the leaner shape that the
 * Appendix B branching in renderTisLondon falls through to for
 * sub-80-DU residential schemes (and the equivalent floorspace bands
 * for non-residential use classes), absent any "regardless of size"
 * escalator.
 *
 * Chapter set calibrated against published London residential TSs:
 *   Cover + Executive Summary (with explicit TS declaration)
 *   Ch 1  Introduction (incl. methodology-mismatch disclosure)
 *   Ch 2  Site and Surroundings (condensed — merges Ch 2 + Ch 3 of TA)
 *   Ch 3  Proposed Development (split from §3.1 of TA)
 *   Ch 4  Trip Generation (TA §5.1)
 *   Ch 5  Conclusion (TA §8)
 *
 * Dropped vs the full TA TOC: 2.0 Transport planning for people,
 * 4.0 Active Travel Zone, 6.0 Additional borough analysis,
 * 7.0 Construction (the last would re-enter only on TA-shaped
 * schemes with an on-site Construction Logistics Plan requirement).
 */
function renderLondonTransportStatement(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
  opts: { isLondon: boolean; lpa: string; sizeRule: string; isBelowAssessmentFloor: boolean },
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];
  const { isLondon, lpa, sizeRule, isBelowAssessmentFloor } = opts;

  ldnSection(doc, "EXECUTIVE SUMMARY");
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  const radiusMi = Number(r.studyRadiusMi ?? req.studyRadiusMi ?? 0);
  const radiusKm = (radiusMi * 1.609344).toFixed(2);

  const tsTriggerSentence = isBelowAssessmentFloor
    ? `This document is structured as a Transport Statement (TS); however, ${sizeRule} so no formal assessment is recommended by DfT 2007 Appendix B. The TS shape is retained as a screening-level cross-reference for the consultant's pre-application discussion with ${lpa}.`
    : `This document is structured as a Transport Statement (TS) per DfT 2007 Appendix B (${sizeRule}). The full 8-chapter TfL Healthy Streets Transport Assessment TOC is reserved for schemes that exceed the residential 80-DU / hotel 100-bedroom / equivalent-floorspace TA trigger, or that trip one of the Appendix B "regardless of size" escalators (≥ 30 vph in any peak, ≥ 100 vpd, ≥ 100 parking spaces, AQMA proximity, or inadequate local transport infrastructure).`;
  doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(tsTriggerSentence, { paragraphGap: 6 });
  doc.font("body").fontSize(10).fillColor("black");

  const summary = `This Transport Statement reports the anticipated transport effects of the proposed ${project.projectName || "development"} within ${region.displayName}, ${isLondon ? "Greater London" : "United Kingdom"}. ${intersections.length} junction${intersections.length === 1 ? "" : "s"} fall within a ${radiusKm} km (${fmtNum(radiusMi, 2)} mi) study radius of the site. The analysis is screening-level and is prepared as a cross-reference to UK Transport Statement methodology; a submittable TS prepared by a chartered engineer would re-run trip generation on TRICS multi-modal rates and junction capacity in LinSig 3 / Junctions 11 as appropriate.`;
  doc.text(summary, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text("Headline findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (losDrops === 0 && losEf === 0) {
    doc.text("• No junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario.", { paragraphGap: 2 });
    doc.text("• Highway capacity is not the limiting factor for this scheme on the basis of this screening; PTAL-banded car parking and sustainable-mode uptake remain to be confirmed at the chartered-engineer stage.", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} junction${losDrops === 1 ? "" : "s"} project to deteriorate by one or more LOS categories under the With-Development scenario.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} junction${losEf === 1 ? " operates" : "s operate"} at LOS E or F under With-Development and would warrant mitigation.`, { paragraphGap: 4 });
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

  ldnSection(doc, "1.0 INTRODUCTION");
  ldnSubsection(doc, "1.1 Purpose and Planning Context");
  doc.font("body").fontSize(10).fillColor("black").text(
    `This Transport Statement cross-references the anticipated transport effects of the proposed ${project.projectName || "development"}, located within ${region.displayName}. It is presented in the structure of a UK Transport Statement consistent with the DfT Guidance on Transport Assessment (2007) Appendix B residential and use-class size bands, with the National Planning Policy Framework (NPPF, December 2024) paragraphs 115 / 116 / 118 as the statutory planning hook. ${sizeRule}. The TS shape is appropriate where the scheme does not generate a "significant amount of movement" within the judgement of ${lpa}; promotion to a Transport Assessment (TA) would be triggered by exceeding the TA size threshold or by tripping any of the Appendix B "regardless of size" escalators.`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Note. The DfT 2007 guidance was formally withdrawn in October 2014 but Appendix B remains in operational use as the de-facto threshold register; TfL continues to host the table at content.tfl.gov.uk/thresholds-for-transport-assessments.pdf. Use Class labels A1 / A2 / B1 / D1 / D2 in the original table are pre-2020 nomenclature now collapsed into Class E under SI 2020/757.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  ldnSubsection(doc, "1.2 Methodology Cross-Reference and Disclosure");
  doc.font("body").fontSize(10).fillColor("black").text(
    "The analysis is generated by a screening engine calibrated to United States standards and is presented as a cross-reference to UK methodology, not as a substitute for it. Capacity analysis uses the HCM 6th Edition (Ch. 19, signalised junctions) rather than DMRB CD 116 / CD 123; trip generation uses the ITE Trip Generation Manual 11th Edition rather than TRICS 8; LOS letters A–F are reported against the HCM Exhibit 19-8 control-delay thresholds. A chartered engineer preparing a submittable TS should re-run the affected junctions in LinSig 3 / Junctions 11 with TRICS multi-modal trip rates filtered per the TRICS Good Practice Guide 2025.",
    { paragraphGap: 6 },
  );
  doc.moveDown(0.3);

  ldnSection(doc, "2.0 SITE AND SURROUNDINGS");
  ldnSubsection(doc, "2.1 Site Identification");
  rows(doc, [
    ["Scheme", project.projectName || "—"],
    ["Land use (ITE proxy)", `${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Region", region.displayName],
    ["Highway authority(ies)", isLondon ? "Transport for London (TLRN); host London borough (borough roads)" : "Local highway authority for the area"],
    ["Local planning authority", lpa],
  ]);
  doc.moveDown(0.4);

  ldnSubsection(doc, "2.2 Public Transport, Active Travel and Parking");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    isLondon
      ? "PTAL band, cycle infrastructure, and London Plan policy T5 / T6 parking provision (cycle parking under Table 10.2; car parking maxima under Tables 10.3–10.5 banded by PTAL and use class) should be confirmed against the WebCAT 3.0 lookup and the host borough's Local Plan / SPDs at the chartered-engineer stage. This TS does not auto-compute PTAL or parking standards."
      : "Public-transport accessibility, active-travel network and parking standards should be confirmed against the host authority's adopted methodology at the chartered-engineer stage.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  ldnSection(doc, "3.0 PROPOSED DEVELOPMENT");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The proposed scheme is a ${tg.landUseName ?? "—"} (ITE land use ${tg.landUseCode ?? "—"}) of ${tg.size ?? "—"} ${tg.unit ?? ""} at the address above. The scheme size sits within the Appendix B TS band for the use class (${sizeRule}). Access, servicing arrangements and any Travel Plan commitments are bespoke to the planning submission and should be drawn from the architectural and access drawings at the chartered-engineer stage.`,
    { paragraphGap: 6 },
  );
  if (req.priorUse) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      `Existing / prior use on the site: ${req.priorUse}. A cumulative-vs-prior-use trip comparison is typically presented in a London TS where the net new car-mode peak is the key acceptability test.`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  ldnSection(doc, "4.0 TRIP GENERATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Gross trip generation is calculated per the ITE Trip Generation Manual 11th Edition for land-use code ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. A submittable TS would substitute TRICS 8 multi-modal rates filtered per the TRICS Good Practice Guide 2025; the figures below are screening-level estimates after the London 38% auto-mode-share factor has been applied.`,
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

  if (intersections.length > 0) {
    table(doc, {
      headers: ["Junction", "Existing LOS", "No-Build LOS", "With-Dev LOS", "Δ delay (s)"],
      widths: [225, 70, 75, 75, 75],
      align: ["left", "center", "center", "center", "right"],
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
        ];
      }),
    });
    doc.moveDown(0.4);
  }

  ldnSection(doc, "5.0 CONCLUSION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `On the basis of this screening-level Transport Statement, ${losDrops === 0 && losEf === 0 ? "no junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario, and capacity is not the limiting factor on this analysis." : `${losDrops} junction(s) project to deteriorate by one or more LOS categories under the With-Development scenario and ${losEf} junction(s) project to operate at LOS E or F, indicating mitigation would be warranted.`} The scheme falls within the DfT 2007 Appendix B TS size band for the use class (${sizeRule}) and trips none of the "regardless of size" escalators (peak-hour ≥ 30 vph, daily ≥ 100 vpd, ≥ 100 parking spaces, AQMA proximity, inadequate local transport infrastructure); a Transport Statement is therefore the appropriate deliverable shape under the de-facto DfT 2007 / PPG split. Promotion to a full Transport Assessment (TA) would be required only if (i) the scheme grew above the TA size threshold for the use class, or (ii) any Appendix B escalator subsequently triggered.`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "A submittable TS prepared by a chartered engineer would substitute TRICS multi-modal trip rates, LinSig 3 / Junctions 11 capacity, and London Plan T5 / T6 parking provision for the screening-level figures above; PTAL band and Healthy Streets Indicators are not required at TS shape but may still be requested by the host borough at pre-application discussion.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
}

/**
 * Texas uses "TIA" (Traffic Impact Analysis), not "TIS". Statewide
 * procedure lives in TxDOT TSP Ch. 16 + Appendix Q, but Houston,
 * Austin, Dallas, Fort Worth, and San Antonio each publish their own
 * city-level TIA standards that materially differ. The renderer picks
 * the host-city section pack from site coords; outside all five city
 * envelopes we fall back to TxDOT-only framing.
 *
 * The Appendix Q outline ordering (Intro → Exec Summary → Project
 * Description → Study Area Conditions → Existing Operations →
 * Projected Traffic → Traffic and Improvement Analysis → Safety
 * Analysis → Conclusions → Recommendations → Appendices) is sourced
 * directly from txdot.gov/manuals/des/tsp/chapter-16---appendix-q.
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

/**
 * TSP §16.2.1 Table 16-1 categories, keyed on peak-hour trip generation.
 * Below 100 PHT, the District may still request analysis if local
 * safety or capacity issues exist — we surface that as a "below
 * threshold" tier rather than skipping the framing.
 */
type TxTiaCategory = "below" | "cat1" | "cat2" | "cat3";
function txTiaCategory(peakHourTrips: number): TxTiaCategory {
  if (!Number.isFinite(peakHourTrips) || peakHourTrips < 100) return "below";
  if (peakHourTrips <= 499) return "cat1";
  if (peakHourTrips <= 1000) return "cat2";
  return "cat3";
}


/**
 * Rough Texas county overlay for unincorporated coords. When the
 * site falls in unincorporated Harris/Travis/Bexar territory the
 * county-level TIA program supersedes the (absent) host-city
 * standard. Bounds are rough county-outline rectangles intersected
 * with their respective MSA — good enough to pick the citation pack.
 *
 * Harris County: TIA Guidelines May 8, 2025 — ≥50 PHT triggers a TIA;
 * study-area scaling 50–149 → ¼ mi, 150–299 → ½ mi, ≥300 → 1 mi.
 * Travis County: TNR Subdivision Preliminary Plan — ≥1,000 net new
 * daily trips triggers TIA review.
 * Bexar County: coordinates through City of San Antonio UDC §35-502
 * (the 76-PHT trigger).
 */
type TxCounty = "harris" | "travis" | "bexar" | null;
function txCounty(lat: number, lon: number): TxCounty {
  // Harris County rough bounds (covers Houston MSA core)
  if (lat >= 29.5 && lat <= 30.2 && lon >= -95.95 && lon <= -94.9) return "harris";
  // Travis County rough bounds (covers Austin MSA core)
  if (lat >= 30.0 && lat <= 30.55 && lon >= -98.05 && lon <= -97.55) return "travis";
  // Bexar County rough bounds (covers San Antonio MSA core)
  if (lat >= 29.25 && lat <= 29.75 && lon >= -98.85 && lon <= -98.2) return "bexar";
  return null;
}

type TxJurisdictionKey = "houston" | "austin" | "dallas" | "fortworth" | "sanantonio" | "txdot";

function txCityName(juris: TxJurisdictionKey): string {
  return {
    houston: "City of Houston",
    austin: "City of Austin",
    dallas: "City of Dallas",
    fortworth: "City of Fort Worth",
    sanantonio: "City of San Antonio",
    txdot: "TxDOT (no host-city overlay)",
  }[juris];
}

function txCountyName(county: NonNullable<TxCounty>): string {
  return {
    harris: "Harris County (unincorporated)",
    travis: "Travis County (unincorporated)",
    bexar: "Bexar County (unincorporated)",
  }[county];
}

function txCountyOverlayNote(county: NonNullable<TxCounty>): string {
  return {
    harris: "Harris County (unincorporated) overlay: per the Harris County TIA Guidelines (May 8, 2025), a development that generates more than 50 trips during the highest peak hour triggers a TIA. Study-area scaling from the plat boundary: 50 ≤ PHT < 150 → ¼ mile; 150 ≤ PHT < 300 → ½ mile; PHT ≥ 300 → 1 mile.",
    travis: "Travis County (unincorporated) overlay: per the Travis County TNR Subdivision Preliminary Plan process, a project generating ≥ 1,000 net new daily trips triggers TIA review.",
    bexar: "Bexar County (unincorporated) overlay: TIA review coordinates through the City of San Antonio UDC §35-502 process (76-PHT trigger), as no separate county-level TIA program is published.",
  }[county];
}

/**
 * Tier label keyed off the coord-resolved `juris`, not region.displayName.
 * Needed because the Dallas-Fort Worth MSA displayName contains both city
 * names, and `jurisdictionTierLabel` matches "fort worth" first — without
 * this override, Dallas-coord projects would get a Fort Worth label.
 */
function txTierLabel(juris: TxJurisdictionKey, tier: "worksheet" | "abbreviated"): string {
  const tiers = {
    houston: {
      worksheet: "Houston Access Management Form / Technical Memorandum / Category I",
      abbreviated: "Houston Category II TIA",
    },
    austin: {
      worksheet: "Austin TIA Determination Worksheet",
      abbreviated: "Austin TIA Memo / Neighborhood Traffic Analysis",
    },
    dallas: {
      worksheet: "Dallas Traffic Impact Worksheet / TIS Waiver",
      abbreviated: "Dallas Abbreviated TIS (consultant convention)",
    },
    fortworth: {
      worksheet: "Fort Worth TIA Worksheet",
      abbreviated: "Fort Worth Abbreviated TIA",
    },
    sanantonio: {
      worksheet: "San Antonio Peak Hour Trip Generation Form + Turn Lane Assessment",
      abbreviated: "San Antonio Abbreviated TIA (no formal tier — consultant convention)",
    },
    txdot: {
      worksheet: "TxDOT Below-Category-1 Scoping Memo",
      abbreviated: "TxDOT Category 1 TIA (TSP §16.2.1)",
    },
  } as const;
  return tiers[juris][tier];
}

/**
 * Worksheet-tier Texas TIA. Routes to a per-city deliverable name and
 * a city-tailored section list per REGIONAL-SPECS/texas-tis-spec.md.
 * Mirrors renderTisGeorgiaWorksheet's structural pattern.
 */
function renderTisTexasWorksheet(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
  tierInput: TierInput,
  juris: TxJurisdictionKey,
  county: TxCounty,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const tierName = txTierLabel(juris, "worksheet");
  const pht = tierInput.pmPeakTrips;
  const daily = tierInput.dailyTrips;

  // Houston has four published sub-tiers below Full TIA (AMF / Tech
  // Memo 80-120 PHT / Cat I <100 PHT / Cat II 100-499 PHT). At the
  // worksheet shape we collapse AMF + Tech Memo + Cat I and pick the
  // sub-label by PHT band.
  const houstonSubTier =
    pht < 80 ? "Access Management Form"
    : pht <= 120 ? "Technical Memorandum (Tech Memo)"
    : "Category I TIA";

  const banner = {
    houston: `Houston worksheet-tier deliverable per 2023 Infrastructure Design Manual Ch. 15 Table 15.04.01-02 — currently routed to ${houstonSubTier}. The 2023 IDM publishes four sub-tiers below the Full TIA Category III threshold (AMF / Tech Memo 80–120 PHT / Cat I <100 PHT / Cat II 100–499 PHT); the AMF + Tech Memo + Cat I band is collapsed into this worksheet shape.`,
    austin: "Austin worksheet-tier deliverable per Land Development Code §25-6-117 and TIA Guidelines (June 2022). At <2,000 vpd net new the TIA Determination Worksheet is the gating deliverable submitted via the TDS portal; a Scope of Work + Full TIA only follows when staff escalates.",
    dallas: "Dallas worksheet-tier deliverable per Development Code §51A-4.803 (Site Plan Review) plus the Paving/Drainage Traffic Impact Study Waiver form. At <1,000 daily a non-school site qualifies for the TIS Waiver; this report carries that form's substantive fields plus the screening trip generation.",
    fortworth: "Fort Worth worksheet-tier deliverable per the City of Fort Worth Transportation Engineering Manual (June 2019). The TIA Worksheet is the published deliverable for projects under 100 PHT and 1,000 ADT; an Abbreviated TIA follows at 100–299 PHT and Full TIA at ≥300 PHT or ≥5,000 ADT.",
    sanantonio: "San Antonio worksheet-tier deliverable per UDC §35-502. Below 76 PHT a Peak Hour Trip Generation Form + Turn Lane Assessment is the published deliverable; no abbreviated tier exists between this and the Full TIA + Rough Proportionality Determination at ≥76 PHT.",
    txdot: "TxDOT below-Category-1 scoping memo. With <100 peak-hour trips the project falls below the TSP §16.2.1 Category 1 floor; the District may still elect to require a TIA for local safety or capacity concerns under District discretion, but no Appendix Q-formatted Full TIA is required by default.",
  }[juris];

  const sectionTitle = {
    houston: "HOUSTON WORKSHEET-TIER TIA",
    austin: "AUSTIN TIA DETERMINATION WORKSHEET",
    dallas: "DALLAS TRAFFIC IMPACT WORKSHEET / TIS WAIVER",
    fortworth: "FORT WORTH TIA WORKSHEET",
    sanantonio: "SAN ANTONIO PEAK HOUR TRIP GENERATION FORM",
    txdot: "TxDOT BELOW-CATEGORY-1 SCOPING MEMO",
  }[juris];

  // --- Header banner ----------------------------------------------------
  gaSection(doc, sectionTitle);
  doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(tierName, { paragraphGap: 4 });
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(banner, { paragraphGap: 6 });
  doc.fillColor("black");

  // --- §1 Location Description -----------------------------------------
  gaSection(doc, "1.0 LOCATION DESCRIPTION");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Region", region.displayName],
    ["Host jurisdiction", txCityName(juris)],
    ["County overlay", county ? txCountyName(county) : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
  ]);
  doc.moveDown(0.5);

  // --- §2 Existing / Proposed Land Use ---------------------------------
  gaSection(doc, "2.0 EXISTING AND PROPOSED LAND USE");
  rows(doc, [
    ["Proposed ITE land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Existing land use", "Subject to site verification — no existing-use trip credit applied at the worksheet tier."],
  ]);
  doc.moveDown(0.5);

  // --- §3 Trip Generation Estimate -------------------------------------
  gaSection(doc, "3.0 TRIP GENERATION ESTIMATE");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is estimated per the ITE Trip Generation Manual 11th Ed. for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. No pass-by or internal capture credits are applied at the worksheet tier — those reductions belong in the formal Full TIA where one is required.`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Trips"],
    widths: [280, 100],
    align: ["left", "right"],
    rows: [
      ["Daily total", fmtNum(tg.dailyTrips)],
      ["AM peak hour", fmtNum(tg.amPeakTrips)],
      ["PM peak hour (in)", fmtNum(tg.pmIn)],
      ["PM peak hour (out)", fmtNum(tg.pmOut)],
      ["PM peak hour (total)", fmtNum(pht)],
    ],
  });
  doc.moveDown(0.3);

  // --- §4 Worksheet-Tier Determination ---------------------------------
  gaSection(doc, "4.0 WORKSHEET-TIER DETERMINATION");
  const determinationText = {
    houston: `Per the 2023 Infrastructure Design Manual Ch. 15, projects below the Houston Category III Full TIA threshold are gated through one of three lower tiers: Access Management Form (driveway-only review), Technical Memorandum (≈80–120 PHT band), or Category I TIA (<100 PHT, ~100-trip floor per consultant practice; the verbatim IDM threshold was not auto-pulled from Houston Permitting PDFs). The screened ${fmtNum(pht)} PM PHT and ${fmtNum(daily)} daily trips route this project to ${houstonSubTier}.`,
    austin: `Per Land Development Code §25-6-117 and TIA Guidelines (June 2022), a project must submit the TIA Determination Worksheet whenever site-generated traffic is < 2,000 vpd net new. The screened ${fmtNum(daily)} daily trips falls within that band, so this Determination Worksheet is the gating deliverable. Scope of Work + Full TIA submittal follows only if Transportation Development Services (TDS) escalates after worksheet review.`,
    dallas: `Per Development Code §51A-4.803 (Site Plan Review) plus the Paving/Drainage Traffic Impact Study Waiver form, a non-school site generating < 1,000 daily trips qualifies for the TIS Waiver. The screened ${fmtNum(daily)} daily trips (and ${fmtNum(pht)} PM PHT) falls within that band. Note that Dallas has no single canonical TIA threshold — consultant practice also cites ~100 PHT / ~2,000 ADT; review is partly discretionary under §51A-4.803.`,
    fortworth: `Per the City of Fort Worth Transportation Engineering Manual (June 2019), the published tier ladder is: TIA Worksheet (<100 PHT and <1,000 ADT) → Abbreviated TIA (100–299 PHT or 1,000–4,999 ADT) → Full TIA (≥300 PHT or ≥5,000 ADT). The screened ${fmtNum(pht)} PM PHT and ${fmtNum(daily)} daily trips falls within the TIA Worksheet band; no Abbreviated or Full TIA is required at the consultant-screening level.`,
    sanantonio: `Per UDC §35-502, a project that generates < 76 peak-hour trips submits the Peak Hour Trip Generation Form + Turn Lane Assessment instead of a Full TIA. The screened ${fmtNum(pht)} PM PHT falls below the 76-PHT trigger, so this deliverable is the gating form. (The often-cited "100 PHT" figure in San Antonio is the driveway-geometry threshold, not the TIA trigger.) No formal abbreviated tier exists in San Antonio between this form and the Full TIA + Rough Proportionality Determination.`,
    txdot: `Per TxDOT Traffic and Safety Analysis Procedures Manual (TSP) §16.2.1, Category 1 begins at 100 peak-hour trips. The screened ${fmtNum(pht)} PM PHT falls below the Category 1 floor, so no Appendix Q-formatted Full TIA is required by default; the TxDOT District may still request a TIA under District discretion for local safety or capacity concerns. ACM Ch. 3 §3 driveway-compliance review still applies on any state-system frontage.`,
  }[juris];
  doc.font("body").fontSize(10).fillColor("black").text(determinationText, { paragraphGap: 6 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Verification: the consultant should confirm the screened trip count against current jurisdiction publications and any reviewing-agency-specific credit (existing-use credit, internal capture, pass-by) before finalizing this determination. Where the reviewing agency requests a higher-tier deliverable — staff escalation, frontage on a state-system route, or a non-trip-related concern — regenerate the report with Tier = Abbreviated or Full from the form.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §5 Access, Sight Distance, Circulation --------------------------
  gaSection(doc, "5.0 ACCESS MANAGEMENT AND SITE CIRCULATION");
  const accessText = {
    houston: "Per Houston IDM Ch. 15, the Access Management Form is required for all commercial site driveways regardless of TIA tier — driveway spacing, throat depth, and turn-lane assessment must be submitted as a companion to this worksheet. Where any site frontage is on a TxDOT route (IH / US / SH / FM / RM / BU / BS / SL / SS), a parallel DAP application is required.",
    austin: "Per Transportation Criteria Manual §10, even at the Determination Worksheet tier the consultant should verify the adjacent transit/bike network against the Austin Strategic Mobility Plan, fronting-street classification against the Future Land Use Map, and any AISD school-zone overlays. The City of Austin TIA Guidelines (June 2022) Sustainable Modes Analysis is not required at this tier but should be summarized informally.",
    dallas: "Per Development Code §51A-4.803, the Site Plan Review tracks the substantive engineering items even when a TIS is waived: adjacent access spacing, intersection sight distance, sidewalk continuity, and any Connect Dallas multimodal corridors abutting the site. The TIS Waiver form should be filed concurrently with the engineering site plan via ProjectDox.",
    fortworth: "Per the FW Transportation Engineering Manual (June 2019), the TIA Worksheet requires: (a) trip generation table; (b) site access geometry against the Master Thoroughfare Plan classification; (c) ITE pass-by/internal-capture justification (often n/a at this tier); (d) any NCTCOG Regional Thoroughfare Plan corridors abutting the site; (e) driveway sight distance and posted-speed verification. The full set should be carried into the formal submittal.",
    sanantonio: "Per UDC §35-502, the Peak Hour Trip Generation Form pairs with a Turn Lane Assessment evaluating right-turn deceleration and left-turn warrant on each fronting roadway. The pre-submittal scoping meeting with TCI + Public Works + Planning is mandatory regardless of TIA tier; this worksheet is the input to that meeting.",
    txdot: "Per ACM Ch. 2 §3 (Table 2-2 connection spacing) and ACM Ch. 2 §4 (driveway permits), driveway spacing, geometry, and auxiliary lanes are reviewed at the DAP stage on any state-system frontage. Roadway Design Manual Ch. 16 (driveways) and Ch. 2 (sight distance) govern the geometric design.",
  }[juris];
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(accessText, { paragraphGap: 6 });
  doc.fillColor("black");

  if (county) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      txCountyOverlayNote(county),
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- §6 Findings -----------------------------------------------------
  gaSection(doc, "6.0 FINDINGS");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text(`• The proposed ${project.projectName || "development"} is projected to generate ${fmtNum(daily)} daily trips and ${fmtNum(pht)} PM peak-hour trips.`, { paragraphGap: 2 });
  doc.text(`• Trip generation falls within the ${txCityName(juris)} worksheet-tier band; no Abbreviated or Full TIA is required at the consultant-screening level for this deliverable.`, { paragraphGap: 2 });
  doc.text("• Site access geometry, sight distance, and pedestrian / bicycle connectivity should be verified against the final site plan and applicable jurisdictional standards prior to permit submittal.", { paragraphGap: 4 });
  doc.moveDown(0.5);

  // --- PE Seal block ---------------------------------------------------
  gaSection(doc, "PROFESSIONAL ENGINEER CERTIFICATION");
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "This worksheet-tier deliverable has been prepared at the screening level defined by the host jurisdiction's TIA-tier scheme and is sealed by a Texas-licensed Professional Engineer per 22 TAC §137.33 (Texas Engineering Practice Act, Tex. Occ. Code Ch. 1001). The signing PE attests only to the worksheet-tier scope and that the project's screened trip generation falls below the host jurisdiction's Full TIA threshold. It does not substitute for a Full TIA where one is later required by the reviewing agency.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
}

/**
 * Abbreviated-tier Texas TIA per REGIONAL-SPECS/texas-tis-spec.md:
 *   FW → Abbreviated TIA · Houston → Cat II · Austin → NTA (residential
 *   only) · Dallas → consultant convention · SA → no formal tier (flag) ·
 *   TxDOT → TSP Cat 1.
 */
function renderTisTexasAbbreviated(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
  tierInput: TierInput,
  juris: TxJurisdictionKey,
  county: TxCounty,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const tierName = txTierLabel(juris, "abbreviated");
  const pht = tierInput.pmPeakTrips;
  const daily = tierInput.dailyTrips;

  // Austin's NTA shape is residential-only by TIA Guidelines (June 2022).
  // Non-residential at this trip count normally escalates to Full TIA; we
  // still render but flag it.
  const isResidentialUse =
    tierInput.landUseCode.startsWith("21") ||
    tierInput.landUseCode.startsWith("22") ||
    tierInput.landUseCode.startsWith("23");

  const sectionTitle = {
    houston: "HOUSTON CATEGORY II TIA",
    austin: isResidentialUse ? "AUSTIN NEIGHBORHOOD TRAFFIC ANALYSIS (NTA)" : "AUSTIN MID-TIER TIA",
    dallas: "DALLAS ABBREVIATED TIS (CONSULTANT CONVENTION)",
    fortworth: "FORT WORTH ABBREVIATED TIA",
    sanantonio: "SAN ANTONIO ABBREVIATED TIA (NO FORMAL TIER)",
    txdot: "TxDOT CATEGORY 1 TIA",
  }[juris];

  const banner = {
    houston: `Houston Category II per 2023 IDM Ch. 15 Table 15.04.01-02 — the mid-tier deliverable between Category I (<100 PHT) and Category III Full TIA (≥500 PHT). The screened ${fmtNum(pht)} PM PHT routes this project to Category II at the abbreviated trip-band (100–499 PHT). Houston's Vehicle LOS (VLOS) framing replaces letter-grade LOS as the operational MOE at this tier.`,
    austin: isResidentialUse
      ? `Austin Neighborhood Traffic Analysis per TIA Guidelines (June 2022) and the Transportation Criteria Manual §10. The NTA shape applies to residential-only-access sites generating > 300 vpd net new, gating concerns about neighborhood-street volume rather than full-network capacity. The screened ${fmtNum(daily)} daily trips and ${fmtNum(pht)} PM PHT at residential land use ${tierInput.landUseCode} fits this template.`
      : `Austin mid-tier TIA at non-residential land use ${tierInput.landUseCode}. The published Austin tier ladder for non-residential is binary: <2,000 vpd → Determination Worksheet, ≥2,000 vpd → Full TIA. The Neighborhood Traffic Analysis (NTA) shape used here is residential-only by the TIA Guidelines (June 2022). At this trip band a non-residential project would normally escalate to Full TIA; this report carries the abbreviated shape as a consultant-screening deliverable.`,
    dallas: `Dallas has no codified abbreviated TIS tier — Development Code §51A-4.803 publishes only Worksheet/Waiver and Full TIS. The screened ${fmtNum(pht)} PM PHT and ${fmtNum(daily)} daily trips falls within the 100–499 PHT band where consultant practice commonly carries an abbreviated shape; this is a practitioner convention, not a formal tier. Dallas DOT Traffic Engineering may request escalation to Full TIS at their discretion.`,
    fortworth: `Fort Worth Abbreviated TIA per the City of Fort Worth Transportation Engineering Manual (June 2019). The published tier ladder is: TIA Worksheet (<100 PHT, <1,000 ADT) → Abbreviated TIA (100–299 PHT or 1,000–4,999 ADT) → Full TIA (≥300 PHT or ≥5,000 ADT). The screened ${fmtNum(pht)} PM PHT and ${fmtNum(daily)} daily trips routes this project to Abbreviated TIA.`,
    sanantonio: `San Antonio publishes no formal abbreviated TIA tier — UDC §35-502 collapses straight from the Peak Hour Trip Generation Form (<76 PHT) to the Full TIA + Rough Proportionality Determination (≥76 PHT). The screened ${fmtNum(pht)} PM PHT is at or above the 76-PHT trigger; the consultant-convention Abbreviated shape carried here should escalate to a Full TIA before formal submittal.`,
    txdot: `TxDOT Category 1 per TSP §16.2.1 (100–499 PHT). The screened ${fmtNum(pht)} PM PHT falls within the Category 1 band. Per TSP §16.2.1 Table 16-1 the analysis horizon at Category 1 is the buildout year only; the Appendix Q-formatted outline is reduced from the Full Category 2/3 outline.`,
  }[juris];

  // --- Header banner ----------------------------------------------------
  gaSection(doc, sectionTitle);
  doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(tierName, { paragraphGap: 4 });
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(banner, { paragraphGap: 6 });
  doc.fillColor("black");

  // --- §1 Location Description -----------------------------------------
  gaSection(doc, "1.0 LOCATION DESCRIPTION");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Region", region.displayName],
    ["Host jurisdiction", txCityName(juris)],
    ["County overlay", county ? txCountyName(county) : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Study radius", `${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)} mi`],
  ]);
  doc.moveDown(0.5);

  // --- §2 Existing / Proposed Land Use ---------------------------------
  gaSection(doc, "2.0 EXISTING AND PROPOSED LAND USE");
  rows(doc, [
    ["Proposed ITE land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Existing land use", "Subject to site verification — abbreviated-tier credit handled per the host jurisdiction's TIA standard."],
  ]);
  doc.moveDown(0.5);

  // --- §3 Trip Generation ---------------------------------------------
  gaSection(doc, "3.0 TRIP GENERATION ESTIMATE");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is estimated per the ITE Trip Generation Manual 11th Ed. for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. At the abbreviated tier, pass-by and internal-capture credits per ITE Trip Generation Handbook 3rd Ed. Fig. 4.2 are applied where supported by the land use and adjacent network context.`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Trips"],
    widths: [280, 100],
    align: ["left", "right"],
    rows: [
      ["Daily total", fmtNum(tg.dailyTrips)],
      ["AM peak hour", fmtNum(tg.amPeakTrips)],
      ["PM peak hour (in)", fmtNum(tg.pmIn)],
      ["PM peak hour (out)", fmtNum(tg.pmOut)],
      ["PM peak hour (total)", fmtNum(pht)],
    ],
  });
  doc.moveDown(0.3);
  rows(doc, [
    ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
    ["Internal capture applied", `${r.internalCapturePctApplied ?? 0}%`],
  ]);
  doc.moveDown(0.4);

  // --- §4 Tier Determination ------------------------------------------
  gaSection(doc, "4.0 ABBREVIATED-TIER DETERMINATION");
  const determinationText = {
    houston: `Per Houston IDM Ch. 15 Table 15.04.01-02, Category II covers the 100–499 PHT band. The screened ${fmtNum(pht)} PM PHT places this project within that band. The OCE TIA Content Guide outline is reduced relative to Category III — VLOS at the site-access intersections plus adjacent signalized intersections, no full corridor-capacity sweep. The Houston Access Form remains required as a commercial-site companion regardless of TIA tier.`,
    austin: isResidentialUse
      ? `Per Austin TIA Guidelines (June 2022), Neighborhood Traffic Analysis (NTA) is the deliverable for residential-only-access sites generating > 300 vpd net new. The analysis focuses on neighborhood-street volume and speed rather than full-network LOS. A Sustainable Modes Analysis and TDM Plan are required at this tier when site access is on a city collector or higher.`
      : `Per LDC §25-6-117, a non-residential project generating ≥ 2,000 vpd should submit a Transportation Assessment or Full TIA — there is no formal mid-tier deliverable for non-residential land uses in Austin. This abbreviated shape is a screening-level cross-reference; the formal submittal should be regenerated at the Full TIA tier.`,
    dallas: `Dallas has no codified abbreviated tier; the screened ${fmtNum(pht)} PM PHT falls within the 100–499 PHT band where consultant practice commonly carries an abbreviated shape. Connect Dallas (Apr 28, 2021) is in mid-transition from LOS to VMT — both context types are addressed below. Dallas DOT Traffic Engineering may require escalation to Full TIS at their discretion; flag this in the formal submittal cover letter.`,
    fortworth: `Per the City of Fort Worth Transportation Engineering Manual (June 2019), the Abbreviated TIA covers 100–299 PHT or 1,000–4,999 ADT. The screened ${fmtNum(pht)} PM PHT and ${fmtNum(daily)} daily trips falls within that band. Required: trip generation table, distribution, abbreviated LOS analysis at site-access intersections plus first adjacent intersection on each fronting street, mitigation summary referencing the Master Thoroughfare Plan and NCTCOG Regional Thoroughfare Plan.`,
    sanantonio: `San Antonio publishes no formal abbreviated TIA tier — UDC §35-502 ladder is binary at 76 PHT. At ${fmtNum(pht)} PM PHT this project sits above the 76-PHT trigger; the formal submittal should be a Full TIA + Rough Proportionality Determination, not the abbreviated shape carried here. The pre-submittal scoping meeting with TCI + Public Works + Planning is mandatory before any TIA submittal at this trip count.`,
    txdot: `Per TSP §16.2.1, Category 1 (100–499 PHT) is the lowest TIA category. The screened ${fmtNum(pht)} PM PHT places this project within Category 1. Per Table 16-1, the analysis horizon at Category 1 is the buildout year only — no opening-year+5 horizon and no per-phase analysis required. The Appendix Q outline still applies but the appendix workload is reduced.`,
  }[juris];
  doc.font("body").fontSize(10).fillColor("black").text(determinationText, { paragraphGap: 6 });
  doc.fillColor("black");

  // --- §5 Abbreviated Operations Analysis ------------------------------
  gaSection(doc, "5.0 ABBREVIATED OPERATIONS ANALYSIS");
  doc.font("body").fontSize(10).fillColor("black").text(
    "At the abbreviated tier, capacity analysis is restricted to the site-access intersections and the first adjacent signalized intersection on each fronting street. Two scenarios are compared: Background (grown traffic without the proposed project) and Background-plus-site (grown traffic plus the project's external trips at the assigned distribution).",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    table(doc, {
      headers: ["Intersection", "Existing LOS", "Background LOS", "Bgd+Site LOS", "Δ delay (s)"],
      widths: [215, 75, 80, 75, 75],
      align: ["left", "center", "center", "center", "right"],
      rows: intersections.slice(0, 8).map((it) => {
        const losChanged = it.losChanged === true;
        return [
          it.name ?? it.signalId ?? "—",
          String(it.currentLos ?? it.existingLos ?? "—"),
          String(it.existingLos ?? "—"),
          (losChanged ? "▲ " : "") + String(it.futureLos ?? "—"),
          fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
        ];
      }),
    });
    if (intersections.length > 8) {
      doc.moveDown(0.2);
      doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
        `(${intersections.length - 8} additional intersection${intersections.length - 8 === 1 ? "" : "s"} not shown at the abbreviated tier; carry into Full TIA if escalated.)`,
        { paragraphGap: 4 },
      );
      doc.fillColor("black");
    }
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No signalized intersections within the abbreviated-tier study radius. Off-site capacity impact is not anticipated for this development at this tier.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.4);

  // --- §6 Mitigation / Access ----------------------------------------
  gaSection(doc, "6.0 MITIGATION AND ACCESS MANAGEMENT");
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  if (losDrops === 0 && losEf === 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "No intersections within the abbreviated study network are projected to drop one or more LOS grade between the Background and Background-plus-site scenarios. No mitigation is necessary to maintain the host-jurisdiction operational threshold at this tier.",
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `${losDrops} intersection${losDrops === 1 ? "" : "s"} project to drop one or more LOS grade and ${losEf} operate at LOS E or F under the Background-plus-site scenario. Abbreviated-tier mitigation typically covers driveway geometry (right-turn deceleration / left-turn lanes per ACM Ch. 2 §4 and RDW Ch. 16), signal-timing tweaks, and turn-lane warrants; full corridor mitigation belongs in the Full TIA where one is later required.`,
      { paragraphGap: 6 },
    );
  }
  if (juris === "sanantonio") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Reminder: at ≥76 PHT the formal San Antonio submittal must include a Rough Proportionality cost calculation (UDC §35-502). This abbreviated shape does not generate that calculation [placeholder].",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  if (juris === "houston") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Reminder: a Houston Access Form must accompany this Category II TIA for any commercial site, submitted via the Houston Permitting Center alongside the report.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  if (county) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      txCountyOverlayNote(county),
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- §7 Findings ---------------------------------------------------
  gaSection(doc, "7.0 FINDINGS");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text(`• The proposed ${project.projectName || "development"} is projected to generate ${fmtNum(daily)} daily trips and ${fmtNum(pht)} PM peak-hour trips.`, { paragraphGap: 2 });
  doc.text(`• Trip generation routes this project to ${txCityName(juris)}'s abbreviated-tier deliverable; the Full TIA scope is not triggered at this trip count.`, { paragraphGap: 2 });
  doc.text(`• ${intersections.length} affected intersection${intersections.length === 1 ? "" : "s"} analyzed; ${losDrops} drop one or more LOS and ${losEf} operate at LOS E/F under the Background-plus-site scenario.`, { paragraphGap: 2 });
  doc.text("• Final mitigation and access geometry should be verified against the site plan and confirmed in the host-jurisdiction pre-submittal scoping meeting prior to permit submittal.", { paragraphGap: 4 });
  doc.moveDown(0.5);

  // --- PE Seal block ------------------------------------------------
  gaSection(doc, "PROFESSIONAL ENGINEER CERTIFICATION");
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "This abbreviated-tier TIA has been prepared at the mid-tier deliverable defined by the host jurisdiction's TIA scheme and is sealed by a Texas-licensed Professional Engineer per 22 TAC §137.33 (Texas Engineering Practice Act, Tex. Occ. Code Ch. 1001). The signing PE attests only to the abbreviated-tier scope and the screened operational outcome reported above. It does not substitute for a Full TIA where one is later required by the reviewing agency.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
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
  const county = Number.isFinite(lat) && Number.isFinite(lon) ? txCounty(lat, lon) : null;

  // --- Tier dispatch ------------------------------------------------------
  // Each Texas city publishes its own deliverable shapes for small/mid
  // projects below the Full TIA threshold. Below Fort Worth's 100 PHT
  // worksheet floor (or Austin's 2,000 vpd / Dallas's 1,000 ADT /
  // San Antonio's 76 PHT / Houston's 100 PHT) the appropriate deliverable
  // is a worksheet, not a Full TIA — short-circuit to the worksheet
  // renderer here. Same for the city-specific abbreviated tier where one
  // exists.
  const tierInput: TierInput = {
    dailyTrips: Number(tg.dailyTrips ?? 0),
    pmPeakTrips: Number(tg.pmPeakTrips ?? (Number(tg.pmIn ?? 0) + Number(tg.pmOut ?? 0))),
    size: Number(tg.size ?? 0),
    unit: String(tg.unit ?? ""),
    landUseCode: String(tg.landUseCode ?? ""),
  };
  const requested: StudyTier | undefined = req.studyTier;
  const resolvedTier = resolveStudyTier(region, tierInput, requested);
  if (resolvedTier === "worksheet") {
    renderTisTexasWorksheet(doc, r, project, region, tierInput, juris, county);
    return;
  }
  if (resolvedTier === "abbreviated") {
    renderTisTexasAbbreviated(doc, r, project, region, tierInput, juris, county);
    return;
  }

  // Pick the determining peak-hour trip count: the larger of AM/PM peak
  // entering+exiting, per TSP §16.2.1 "peak hour trip generation".
  const amPeak = Number(tg.amPeakTrips ?? 0);
  const pmPeak = Number(tg.pmPeakTrips ?? (Number(tg.pmIn ?? 0) + Number(tg.pmOut ?? 0)));
  const determiningPht = Math.max(amPeak, pmPeak);
  const cat = txTiaCategory(determiningPht);
  const catLabel = {
    below: "Below Category 1 threshold (< 100 peak-hour trips)",
    cat1: "Category 1 (100–499 peak-hour trips)",
    cat2: "Category 2 (500–1,000 peak-hour trips)",
    cat3: "Category 3 (> 1,000 peak-hour trips)",
  }[cat];

  // Per TSP §16.2.1 the analysis horizon is category-dependent:
  // Cat 1 → buildout year only.
  // Cat 2 → buildout year + each phase completion + 5 years post-buildout.
  // Cat 3 → each phase completion + final completion + 5 years post-buildout + 10 years post-buildout.
  const horizonNote = {
    below: "Buildout-year analysis only if the TxDOT District elects to require a TIA for local safety or capacity concerns (TSP §16.2.1 — District discretion below 100 PHT).",
    cat1: "Buildout year only (TSP §16.2.1 Category 1).",
    cat2: "Buildout year, each phase completion year, and five years past buildout (TSP §16.2.1 Category 2).",
    cat3: "Each phase completion year, final completion, five years past buildout, and ten years past buildout (TSP §16.2.1 Category 3 — most comprehensive).",
  }[cat];

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
    houston: "Technical Memorandum tier 80–120 vph during the AM or PM peak hour; Full TIA above 120 vph (2023 IDM Ch. 15, effective Nov 27, 2023; OCE TIA Content Guide).",
    austin: "≥ 2,000 vpd unadjusted triggers analysis (LDC §25-6-117). 2,000–5,000 vpd → Transportation Assessment + TDM Plan; > 5,000 vpd → Full TIA + TDM Plan (TCM §10 / TIA Guidelines June 2022). Below 2,000 vpd a Neighborhood Traffic Analysis or TIA Determination Worksheet may still be required.",
    dallas: "< 1,000 trips per day exempts a non-school site per the Paving/Drainage TIS Waiver form. Above that, consultant practice triggers a TIS at ~100 PHT or ~2,000 ADT — the Development Code (§51A-4.803) does not publish a single canonical numeric, leaving the threshold partly discretionary under Site Plan Review.",
    fortworth: "≥ 300 PHT or ≥ 5,000 ADT triggers a Full TIA; 100–299 PHT triggers an Abbreviated TIA; <100 PHT uses the TIA Worksheet only.",
    sanantonio: "≥ 76 peak-hour trips (UDC §35-502). An update-TIA is required when an increase to an existing TIA or zoning results in ≥ 76 PHT or ≥ 10% of the total PHT for the development, whichever is greater. Below 76 PHT a Peak Hour Trip Generation Form only.",
    txdot: "no statewide trip-count trigger; TSP §16.2.1 Categories 1 (100–499 PHT), 2 (500–1,000 PHT), 3 (>1,000 PHT) drive the level of effort.",
  }[juris];
  const cityLos = {
    houston: "Vehicle LOS (VLOS) per the 2023 IDM; LOS D was the historical target but the 2023 IDM demotes letter-grade LOS in favor of multimodal metrics.",
    austin: "LOS A–F (no VMT switch as of June 2022). Mitigation required when a movement drops from LOS D (Background) to LOS E (Background plus site).",
    dallas: "Transitional — Connect Dallas (Apr 2021) is moving Dallas from LOS toward VMT. Practice currently uses LOS D suburban / LOS E in the CBD.",
    fortworth: "LOS D for arterials and collectors outside the CBD; LOS E in the CBD and Urban Villages.",
    sanantonio: "LOS D generally; LOS E inside Transit-Oriented Development overlays per UDC §35-208.",
    txdot: "no statewide LOS mandate — per TSP §16.4.3, the LOS threshold (and queue / travel-time MOEs) is agreed upon with the District during preliminary scoping.",
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
  const summary = `This Traffic Impact Analysis (TIA) presents the anticipated traffic impacts of the proposed ${project.projectName || "development"} located within ${region.displayName}, Texas. The study evaluates ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile study radius. The report follows the outline in TxDOT Traffic and Safety Analysis Procedures Manual (TSP) Chapter 16 Appendix Q, with capacity analysis per the Highway Capacity Manual (HCM) latest edition and trip generation per the ITE Trip Generation Manual latest edition. The development generates a determining peak-hour trip count of ${determiningPht.toFixed(0)} ${determiningPht === 1 ? "vehicle" : "vehicles"}, classifying it as ${catLabel} under TSP §16.2.1 Table 16-1.`;
  doc.text(summary, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text(`Reviewing authority: ${cityName}.`, { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(cityAuthority, { paragraphGap: 6 });
  doc.fillColor("black");

  doc.font("body").fontSize(10).fillColor("black").text("Findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (losDrops === 0 && losEf === 0) {
    doc.text("• No intersections within the study network are projected to drop one or more LOS grade between the Background and Background-plus-site scenarios.", { paragraphGap: 2 });
    doc.text("• No mitigation is necessary to maintain the operational thresholds agreed upon during preliminary scoping.", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} intersection${losDrops === 1 ? "" : "s"} project to drop one or more LOS grade under the Background-plus-site scenario.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} intersection${losEf === 1 ? "" : "s"} operate at LOS E or F under the Background-plus-site scenario and are flagged for mitigation under TSP §16.4.3.`, { paragraphGap: 4 });
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
    `Per TSP §16.1, this Traffic Impact Analysis determines whether the transportation infrastructure surrounding the project can accommodate the traffic demand the proposed development will introduce. ${juris === "txdot" ? "No incorporated host-city standard applies; the review authority is the TxDOT District alone." : `It is layered with the ${cityName} TIA standard where applicable.`} ${cityAuthority}`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    `TSP §16.1 also flags that this chapter does not provide final TIA recommendation thresholds — the TxDOT District and the host municipality may request analysis beyond this scope, and the project manager determines final methodology. Refer to the TxDOT Access Management Manual Chapter 3 for the TIA-request criteria that apply on the state system.`,
    { paragraphGap: 6 },
  );

  // Preliminary Scoping callout — TSP §16.2.2 lists 11 items the
  // applicant should confirm with the District before the TIA begins.
  doc.font("bold").fontSize(10).fillColor("black").text("Preliminary Scoping (TSP §16.2.2)");
  doc.moveDown(0.2);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Per TSP §16.2.2, the specific project scope should be confirmed with the local TxDOT District before the TIA begins, via an in-person meeting or alternate correspondence. Items to confirm:",
    { paragraphGap: 4 },
  );
  const scopingItems = [
    "Number of access points to TxDOT roadways",
    "Acceptable LOS thresholds",
    "Selected study years",
    "Anticipated influence area",
    "Intersections and roadways to be analyzed",
    "Scenarios to analyze",
    "Data collection method",
    "Project schedule and buildout year",
    "Data source",
    "Use of TDM outputs, growth factors, etc.",
    "Other major projects in the area",
  ];
  for (const it of scopingItems) {
    doc.text(`• ${it}`, { paragraphGap: 2 });
  }
  doc.fillColor("black");
  doc.moveDown(0.4);

  doc.font("body").fontSize(10).fillColor("black").text(
    `Required submission: ${cityDeliverables}`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    `Host-jurisdiction TIA threshold: ${cityThreshold}`,
    { paragraphGap: 6 },
  );
  // County-level overlay — applies in unincorporated TX where the
  // host city standard isn't the controlling authority.
  if (juris === "txdot" && county) {
    const countyNote = {
      harris: "Harris County (unincorporated) overlay: per the Harris County TIA Guidelines (May 8, 2025), a development that generates more than 50 trips during the highest peak hour triggers a TIA. Study-area scaling from the plat boundary: 50 ≤ PHT < 150 → ¼ mile; 150 ≤ PHT < 300 → ½ mile; PHT ≥ 300 → 1 mile.",
      travis: "Travis County (unincorporated) overlay: per the Travis County TNR Subdivision Preliminary Plan process, a project generating ≥ 1,000 net new daily trips triggers TIA review.",
      bexar: "Bexar County (unincorporated) overlay: TIA review coordinates through the City of San Antonio UDC §35-502 process (76-PHT trigger), as no separate county-level TIA program is published.",
    }[county];
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(countyNote, { paragraphGap: 6 });
    doc.fillColor("black");
  }
  if (juris === "dallas") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Dallas TIA standards are not consolidated into a single dated manual — review is partly discretionary under §51A-4.803 site plan review. This report aligns with the engineering tables and figures expected by Dallas DOT Traffic Engineering plus the multimodal context of Connect Dallas.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- §2 Project Description --------------------------------------------
  gaSection(doc, "2.0 PROJECT DESCRIPTION");
  gaSubsection(doc, "2.1 Site Plan");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : "—"],
    ["Host jurisdiction", cityName],
  ]);
  doc.moveDown(0.4);

  gaSubsection(doc, "2.2 Area of Influence");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The anticipated area of influence is the ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile radius surrounding the site, defined per TSP §16.3.1 to include the roads and intersections within the project and the area impacted by project-generated trips. Final area of influence is confirmed with the District during preliminary scoping.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "2.3 Phasing and Timing");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Single-phase buildout year: ${req.openingYear ?? "—"}. Future analysis horizon for this TIA category: ${horizonNote}`,
    { paragraphGap: 6 },
  );
  if (cat === "cat2" || cat === "cat3") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Phased development scenarios are not modeled in this screening analysis. Each phase completion year listed above should be analyzed separately in the formal submittal — phase boundaries and completion dates must come from the applicant's construction schedule.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- §3 Study Area Conditions ------------------------------------------
  gaSection(doc, "3.0 STUDY AREA CONDITIONS");
  gaSubsection(doc, "3.1 Existing and Anticipated Land Use");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Existing land use and the host-jurisdiction Future Land Use Plan for parcels within the area of influence should be compiled from the host city's adopted Comprehensive Plan and any applicable overlay districts. This screening report does not generate that inventory [placeholder — requires GIS pull against host-jurisdiction parcel layer].",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  gaSubsection(doc, "3.2 Existing and Future Roadway System");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Roadway functional class, lane count, posted speed, and surface for state-system routes (IH / US / SH / FM / RM / BU / BS / SL / SS) are referenced against TxDOT Roadway Inventory (RHiNo) and the TxDOT Statewide Planning Map. Future roadway system context is taken from the TxDOT Unified Transportation Program (UTP) and the regional MPO Metropolitan Transportation Plan (MTP) where in-area projects are programmed.",
    { paragraphGap: 6 },
  );

  // --- §4 Existing Operations --------------------------------------------
  gaSection(doc, "4.0 EXISTING OPERATIONS");
  gaSubsection(doc, "4.1 Roadway Conditions and Traffic Controls");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Geometry, signal timing, and traffic-control inventory for the study network are derived from RHiNo plus host-jurisdiction signal-timing records. For the formal submittal, supplementary field inspection within 12 months of submittal is recommended.",
    { paragraphGap: 6 },
  );
  gaSubsection(doc, "4.2 Alternate Modes");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Pedestrian, bicycle, and transit facility inventories within the area of influence should be confirmed against host-jurisdiction GIS and regional transit-operator maps. Per TSP §16.3.3, multimodal reduction is applied to trip generation in areas where alternate transit is readily available — this screening report does not auto-apply multimodal reduction.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  gaSubsection(doc, "4.3 Traffic Volumes");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Existing AADT for state-system segments is taken from the TxDOT Open Data Portal AADT layer (annual refresh). Peak-hour turning-movement counts at study intersections should be collected mid-week (Tue/Wed/Thu), school-in-session, within 12 months of submittal — Houston OCE requires 24 months max; Austin TDS no longer accepts pre-COVID counts by default.",
    { paragraphGap: 6 },
  );
  gaSubsection(doc, "4.4 Level of Service");
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
  doc.moveDown(0.3);
  gaSubsection(doc, "4.5 Safety");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Crash history for the most recent five years on study segments and intersections should be pulled from the TxDOT Crash Records Information System (CRIS Public Query). This screening report does not auto-generate the crash summary [placeholder — requires CRIS pull].",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §5 Projected Traffic ----------------------------------------------
  gaSection(doc, "5.0 PROJECTED TRAFFIC");
  gaSubsection(doc, "5.1 Site Generated Traffic");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is calculated per the ITE Trip Generation Manual latest edition for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Per TSP §16.3.3, the fitted curve equation is preferred when the data plot contains at least 20 data points or has an R² of at least 0.75; otherwise average rates apply. Daily, AM peak, and PM peak hour trips are reported below.`,
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
  doc.font("body").fontSize(10).fillColor("black").text(
    "Internal capture (per TSP §16.3.3: trips between land uses within the same development that do not touch the off-site street system) and pass-by trips (already traveling on the adjacent roadway network and entering the proposed development) are accounted for below.",
    { paragraphGap: 6 },
  );
  rows(doc, [
    ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
    ["Internal capture applied", `${r.internalCapturePctApplied ?? 0}%`],
  ]);
  doc.moveDown(0.4);
  if (juris === "austin") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Austin TIAs require a Sustainable Modes Analysis and a TDM Plan; internal capture, transit-proximity, reduced-parking-supply, and TDM credits are codified as Street Impact Fee credits per the SIF Guidelines (Jan 31, 2023). The trip-generation table above does not yet apply Austin SIF credits — those reductions are scoped in the TDM Plan section [placeholder].",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  gaSubsection(doc, "5.2 Trip Distribution");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per TSP §16.4, project distribution is assigned using engineering judgment, informed by the surrounding roadway network geometry and proximity to the project access points. If only one project driveway is proposed, all trips enter and exit through that driveway. Final distribution percentages are confirmed with the District during preliminary scoping.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "5.3 Trip Assignment");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Site-generated external trips are assigned to the study network using inverse-distance weighting from the project site to each signalized intersection, normalized so the period total matches the external-trip count from §5.1.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "5.4 Non-Site Traffic");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Background traffic is grown at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"}. Per TSP §16.4.2, the prescribed method is to average at least the last five years of historical AADT data for the segment analyzed to derive an average annual growth rate; the value applied here is a screening default and should be re-calibrated to the affected segments' five-year AADT trend before formal submittal. Background growth data is also commonly sourced from the host city or regional MPO travel-demand model (H-GAC, NCTCOG, CAMPO, or AAMPO depending on the MSA).`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Other major projects in the area (committed developments) must be coordinated with the District and governing municipality per TSP §16.3.3 and added on top of the AADT-derived background growth. This screening analysis does not auto-pull committed-development trips.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "5.5 Total Traffic");
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
    doc.moveDown(0.4);
  }

  // --- §6 Traffic and Improvement Analysis -------------------------------
  gaSection(doc, "6.0 TRAFFIC AND IMPROVEMENT ANALYSIS");
  gaSubsection(doc, "6.1 Site Access");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Where the project fronts a state-system roadway (IH / US / SH / FM / RM / BU / BS / SL / SS), site access is reviewed through the TxDOT Driveway Access Permit (DAP) process under the Access Management Manual Chapter 3 §3. Driveway spacing, geometry, and auxiliary lanes (right-turn deceleration, left-turn) are checked against ACM Chapter 2 §3 (Table 2-2 spacing) and the Roadway Design Manual Chapter 16.",
    { paragraphGap: 6 },
  );
  if (juris === "austin" || juris === "txdot") {
    // CTRMA-specific frontage-road policy.
    const ctrmaNote = juris === "austin"
      ? "Within the CTRMA managed-lane corridor (183A, MoPac Express, 290 Toll), any new or modified access onto the CTRMA frontage roads is governed by CTRMA Board Resolution 07-58 (Procedures for Access Management of Frontage Roads on CTRMA Facilities) and remains subject to the underlying TxDOT DAP review."
      : "Where the project fronts an HCTRA (Sam Houston Tollway, Hardy Toll Road, Westpark Tollway), NTTA (DNT, PGBT, SRT, LLTB), CTRMA (183A, MoPac Express, 290 Toll), or TxDOT-operated toll facility frontage road, access review runs through TxDOT (and the host city where applicable); the tollway authority itself reviews only direct facility impacts on ramp / managed-lane geometry.";
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(ctrmaNote, { paragraphGap: 6 });
    doc.fillColor("black");
  }

  gaSubsection(doc, "6.2 Auxiliary Lane and Sight Distance Analysis");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Auxiliary lane warrants (right-turn deceleration, left-turn) per ACM Chapter 2 §4 and Roadway Design Manual Chapter 16 should be checked against the project's access geometry. Intersection sight distance per RDW Ch. 2 should be verified at every proposed driveway. This screening report does not perform per-driveway sight-distance or auxiliary-lane warrant calculations [placeholder — requires final driveway geometry].",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "6.3 Capacity and Level of Service Analysis");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per TSP §16.4.1 and §16.4.4, capacity analysis follows the latest HCM methodology using one of the District-accepted tools (Synchro, HCS, Vissim, or Vistro). For signalized intersections, each approach and the overall intersection are analyzed. Two future scenarios are compared at each affected intersection: Background (grown traffic without the proposed project) and Background-plus-site (grown traffic plus the project's external trips at the assigned distribution). An Existing scenario is included for context. Host-jurisdiction LOS standard: ${cityLos}`,
    { paragraphGap: 6 },
  );

  if (intersections.length > 0) {
    table(doc, {
      headers: ["Intersection", "Existing LOS", "Background LOS", "Bgd+Site LOS", "Δ delay (s)", "Q95 (ft)"],
      widths: [195, 65, 75, 70, 70, 60],
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
  doc.moveDown(0.4);

  gaSubsection(doc, "6.4 Mitigation");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per TSP §16.4.3, any operational deficiencies found in the future analysis are considered for mitigation. The threshold for acceptable operations (LOS, queue length, travel time, and other MOEs) is agreed upon with the District during preliminary scoping rather than being set as a single statewide standard. Typical mitigation measures listed in TSP §16.4.3 include: right-turn deceleration lanes, left-turn lanes, median modifications, traffic signal modification and installation, road widening, revised striping, turning lane restrictions, and alternative intersections / interchanges. The developer is responsible for implementing the agreed-upon mitigation measures.",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    const needMitigation = intersections.filter((it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none");
    if (needMitigation.length > 0) {
      doc.font("bold").fontSize(10).fillColor("black").text("Screening Mitigation Recommendations");
      doc.moveDown(0.2);
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
        "No mitigation is necessary to maintain the scoping-agreed LOS threshold under the Background-plus-site scenario.",
        { paragraphGap: 6 },
      );
    }
  }
  if (juris === "sanantonio") {
    doc.moveDown(0.3);
    doc.font("bold").fontSize(10).fillColor("black").text("Rough Proportionality Cap (UDC §35-502)");
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Per UDC §35-502, if the proposed mitigation cost is less than or roughly equal to the maximum proportional impact, the mitigation is considered roughly proportionate; if it exceeds that maximum, the City must limit required mitigation to an amount roughly equal to the maximum proportional impact. A Rough Proportionality cost calculation must be prepared and submitted with this TIA; this screening report does not generate that calculation [placeholder — requires final mitigation cost estimate and the City's proportionality worksheet].",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  if (juris === "houston") {
    doc.moveDown(0.3);
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Houston commercial submittals must include the Houston Access Form alongside this TIA, and an MDR drainage report integration is required where new impervious cover is added — neither is generated by this screening report [placeholder — requires site-civil inputs].",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  if (juris === "austin") {
    doc.moveDown(0.3);
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Austin's two-tier TIA Memo / Full TIA process determines which deliverable set applies based on the TIA Determination Worksheet outcome and the Scope of Work pre-approval. Tier selection is a discretionary determination by TDS and is not generated by this screening report [placeholder].",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  gaSubsection(doc, "6.5 Driveway Operational Analysis");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Per-driveway operational analysis (full-movement vs. left-in/left-out configuration, throat depth, on-site queue spillback) depends on the final site plan and is not included in this screening-level TIA [placeholder].",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §7 Safety Analysis ------------------------------------------------
  gaSection(doc, "7.0 SAFETY ANALYSIS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Per the Appendix Q outline, Safety Analysis is a standalone section separate from §4.5 Existing Operations — Safety. It includes the project's effect on study-area crash trends, sight-distance impacts at proposed access, and any HSIP-identified crash clusters within the area of influence. This screening report does not auto-generate the safety analysis [placeholder — requires CRIS pull + sight-distance verification].",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §8 Conclusions ----------------------------------------------------
  gaSection(doc, "8.0 CONCLUSIONS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Based on the screening analysis above, the project is classified as ${catLabel} per TSP §16.2.1. Of the ${intersections.length} affected intersection${intersections.length === 1 ? "" : "s"} analyzed, ${losDrops} drop one or more LOS grade and ${losEf} operate at LOS E or F under the Background-plus-site scenario. The horizon analyzed in this screening is the buildout year only; the full submittal must cover the years required by the project's TIA category per TSP §16.2.1 Table 16-1.`,
    { paragraphGap: 6 },
  );

  // --- §9 Recommendations ------------------------------------------------
  gaSection(doc, "9.0 RECOMMENDATIONS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Submit this TIA to ${cityName}, with parallel TxDOT-District coordination where any state-system route is in frontage. Validate the screening results against current-edition manuals, updated turning-movement counts within the most recent 12 months (24 months max per Houston OCE), and the preliminary-scoping outcome with the District. The report must be sealed by a Texas-licensed Professional Engineer per 22 TAC §137.33 (Texas Engineering Practice Act, Tex. Occ. Code Ch. 1001), with the seal on the cover and on every sealed sheet.`,
    { paragraphGap: 6 },
  );

  // --- §10 Appendices ----------------------------------------------------
  gaSection(doc, "10.0 APPENDICES");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "The formal submittal appendices, per the Appendix Q outline, should include: scoping correspondence with the TxDOT District; site plan figures; TMC count sheets with date, weather, observer; ITE worksheets with rate/equation selection rationale; HCS / Synchro / Vissim / Vistro output; signal warrant analyses citing the TMUTCD (2025 edition, effective Jan 18, 2026); auxiliary-lane and sight-distance worksheets; CRIS crash data summary; and the host-jurisdiction's submission forms (Houston Access Form / Austin TIA Determination + Scope / Dallas TIS Waiver / Fort Worth TIA Worksheet / San Antonio TIA Threshold Worksheet + Rough Proportionality calculation).",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- Programmed projects callout (informational, not in Appendix Q) ---
  const mpoName = {
    houston: "Houston-Galveston Area Council (H-GAC) TIP 2025–2028",
    austin: "CAMPO TIP",
    dallas: "North Central Texas Council of Governments (NCTCOG) TIP and Mobility 2045",
    fortworth: "NCTCOG TIP, Mobility 2045, and the NCTCOG Regional Thoroughfare Plan",
    sanantonio: "Alamo Area MPO (AAMPO) TIP",
    txdot: "the applicable regional MPO TIP",
  }[juris];
  doc.moveDown(0.3);
  doc.font("bold").fontSize(10).fillColor("black").text("Programmed Projects (informational)");
  doc.moveDown(0.2);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    `Review of programmed transportation projects within the area of influence should consult the TxDOT Unified Transportation Program (UTP 2026, adopted Aug 2025), the federally-required Statewide Transportation Improvement Program (STIP), and ${mpoName}. This screening analysis does not automatically integrate programmed-projects data; manual review is recommended for any submittal.`,
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

/**
 * Illinois has no single statewide TIS manual. Methodology is
 * assembled from IDOT BLRS chapters, Title 92 Part 550 driveway
 * policy, and the District 8 Access-Permit Guidelines April 2024
 * (the only IDOT-published doc with a fully prescribed TIS section
 * structure that this codebase's research located).
 *
 * Inside Chicago, CDOT's TDM Guidelines v1.2 (Feb 2024; supersedes the interim v1.1 of June 2023) replace
 * vehicle-LOS analysis with a multimodal Travel Demand Management
 * plan keyed off the Connected Communities Ordinance — a
 * fundamentally different deliverable, surfaced here as a Chicago
 * Variant block at the head of the report rather than as a separate
 * renderer.
 *
 * Bounds below are rough county-envelope rectangles; the
 * collar/Cook overlap is real and unresolved by lat/lon alone — the
 * kickoff-meeting flag in the cover memo acknowledges this.
 *
 * Spec: REGIONAL-SPECS/illinois-tis-spec.md
 */

/**
 * Per-metro measured background-traffic growth rate from IDOT's
 * Historical AADT layers. Values are the median per-segment CAGR
 * between the 2020 and 2025 IDOT snapshots, computed by
 * `scripts/src/fetch-il-growth-rate.ts` and inlined here so the
 * renderer remains a pure function. Re-run the fetcher and
 * regenerate this constant when IDOT publishes a newer historical
 * layer; the source-of-truth JSON lives at
 * `artifacts/api-server/src/data/il-growth-rates.json`.
 *
 * The downstate metros (Springfield-IL, Rockford, Peoria) showing
 * mildly negative growth is REAL — it reflects the actual urban-
 * to-rural-Illinois traffic dynamic of the 2020-2025 window
 * (COVID + remote-work persistence + population shift) and matches
 * the IDOT count-station distribution. The numbers are NOT
 * fabricated to look like "more growth = better"; they're what the
 * data says.
 */
type IlMeasuredGrowth = {
  growthPct: number;
  yearFrom: number;
  yearTo: number;
  stations: number;
  p25Pct: number;
  p75Pct: number;
};
const IL_MEASURED_GROWTH: Record<string, IlMeasuredGrowth> = {
  chicago_metro:        { growthPct:  1.80, yearFrom: 2020, yearTo: 2025, stations: 646, p25Pct: -1.69, p75Pct:  5.92 },
  springfield_il_metro: { growthPct: -1.87, yearFrom: 2020, yearTo: 2025, stations:  14, p25Pct: -8.28, p75Pct:  4.80 },
  rockford_metro:       { growthPct: -0.66, yearFrom: 2020, yearTo: 2025, stations:  33, p25Pct: -1.47, p75Pct:  2.74 },
  peoria_metro:         { growthPct: -1.34, yearFrom: 2020, yearTo: 2025, stations:  73, p25Pct: -5.92, p75Pct:  2.56 },
  champaign_metro:      { growthPct:  1.30, yearFrom: 2020, yearTo: 2025, stations:  43, p25Pct: -2.29, p75Pct:  4.76 },
};

type IlJurisdiction =
  | "chicago_cdot"
  | "chicago_idot"
  | "cook_county"
  | "collar_dupage"
  | "collar_lake"
  | "collar_will"
  | "collar_kane"
  | "collar_mchenry"
  | "tollway_influence"
  | "downstate_idot";

/**
 * IDOT state-route geometry inside Chicago city limits, densified
 * to ~25m point spacing. Built by
 * `scripts/src/fetch-chicago-state-routes.ts` from the IDOT
 * Historical AADT layer 2025 (MARKED_NAM where not null within the
 * Chicago bbox), covers 30 routes (US-41 Lake Shore Drive, IL-50
 * Cicero, IL-64 North Ave, IL-19 Irving Park, IL-43 Western,
 * plus the expressway network).
 *
 * Used by `ilJurisdiction()` to distinguish `chicago_idot` (IDOT/
 * CDOT co-review on state-route frontage) from `chicago_cdot`
 * (CDOT-only review on city streets) per the IL spec §8.1 /
 * §2.3. The check: snap the project lat/lon to the nearest state-
 * route point within 60m. 60m matches typical Chicago grid block
 * half-depth — a parcel within frontage distance of a state route
 * will land within 60m of at least one densified point.
 *
 * Lazy-loaded so module init doesn't pay the file-read cost for
 * non-IL renders; built once on first use, then cached. Falls back
 * to an empty grid (chicago_idot dispatch disabled) if the data
 * file is missing — keeps the renderer functional in dev without
 * the data shipped.
 */
type StateRoutePoint = { lat: number; lon: number; route: string };
let chicagoStateRoutesGrid: Map<string, StateRoutePoint[]> | null = null;
let chicagoStateRoutesLoadAttempted = false;
const CHICAGO_STATE_ROUTE_GRID_DEG = 0.0025; // ~250m cell
const CHICAGO_STATE_ROUTE_SNAP_M = 60;

function loadChicagoStateRoutesGrid(): Map<string, StateRoutePoint[]> | null {
  if (chicagoStateRoutesGrid !== null || chicagoStateRoutesLoadAttempted) {
    return chicagoStateRoutesGrid;
  }
  chicagoStateRoutesLoadAttempted = true;
  // Probe both dist (prod, __dirname = dist/lib) and src (tsx/test,
  // __dirname = src/lib) — same convention as FONT_DIR.
  const candidates = [
    path.resolve(__dirname, "../data/chicago-state-routes.json"),
    path.resolve(__dirname, "../../data/chicago-state-routes.json"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf8")) as { points: Array<[number, number, string]> };
      const grid = new Map<string, StateRoutePoint[]>();
      for (const [lat, lon, route] of j.points ?? []) {
        const k = `${Math.floor(lat / CHICAGO_STATE_ROUTE_GRID_DEG)}:${Math.floor(lon / CHICAGO_STATE_ROUTE_GRID_DEG)}`;
        let arr = grid.get(k);
        if (!arr) grid.set(k, (arr = []));
        arr.push({ lat, lon, route });
      }
      chicagoStateRoutesGrid = grid;
      return grid;
    } catch {
      // fall through to next candidate
    }
  }
  return null;
}

function nearestChicagoStateRoute(lat: number, lon: number): string | null {
  const grid = loadChicagoStateRoutesGrid();
  if (!grid) return null;
  const baseLat = Math.floor(lat / CHICAGO_STATE_ROUTE_GRID_DEG);
  const baseLon = Math.floor(lon / CHICAGO_STATE_ROUTE_GRID_DEG);
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  let bestRoute: string | null = null;
  let bestDist2 = (CHICAGO_STATE_ROUTE_SNAP_M + 1) ** 2;
  for (let dl = -1; dl <= 1; dl++) for (let dn = -1; dn <= 1; dn++) {
    const arr = grid.get(`${baseLat + dl}:${baseLon + dn}`);
    if (!arr) continue;
    for (const p of arr) {
      const dx = (p.lon - lon) * mLon;
      const dy = (p.lat - lat) * mLat;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestRoute = p.route;
      }
    }
  }
  return bestRoute;
}

function ilJurisdiction(lat: number, lon: number): IlJurisdiction {
  if (lat >= 41.64 && lat <= 42.03 && lon >= -87.94 && lon <= -87.52) {
    // Inside Chicago city bbox — check if project fronts an IDOT
    // state route. If so, IDOT/CDOT co-review applies (chicago_idot)
    // per the IL spec §2.3 + §8.1. Otherwise CDOT-only review on
    // city streets.
    return nearestChicagoStateRoute(lat, lon) ? "chicago_idot" : "chicago_cdot";
  }
  if (lat >= 42.15 && lat <= 42.50 && lon >= -88.20 && lon <= -87.65) return "collar_lake";
  if (lat >= 42.15 && lat <= 42.50 && lon >= -88.70 && lon <= -88.20) return "collar_mchenry";
  if (lat >= 41.70 && lat <= 42.15 && lon >= -88.65 && lon <= -88.30) return "collar_kane";
  if (lat >= 41.70 && lat <= 42.03 && lon >= -88.40 && lon <= -87.94) return "collar_dupage";
  if (lat >= 41.25 && lat <= 41.70 && lon >= -88.30 && lon <= -87.55) return "collar_will";
  if (lat >= 41.40 && lat <= 42.15 && lon >= -88.30 && lon <= -87.52) return "cook_county";
  return "downstate_idot";
}

function renderTisIllinois(
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
  const juris = Number.isFinite(lat) && Number.isFinite(lon) ? ilJurisdiction(lat, lon) : "downstate_idot";

  // --- Chicago CDOT tier dispatch ---------------------------------------
  // Inside Chicago on CDOT-jurisdiction streets, the CDOT TDM Guidelines
  // v1.1 (June 2023, Table 1) define three tiers — Tier 1 (20–50 DU
  // site plan + project narrative emailed to PRC), Tier 2 (51–175 DU
  // TDM Memo), Tier 3 (>175 DU full TDM Study + Plan). The Full
  // template below already covers Tier 3. Short-circuit to the
  // tier-specific sub-renderers for Tier 1 and Tier 2. For
  // chicago_idot the Full template still runs — the IL spec §2.3
  // requires both an IDOT TIS appendix and a CDOT TDM summary, and
  // the Full template is the IDOT TIS half of that dual-jurisdiction
  // deliverable. For non-Chicago IL (downstate IDOT, collar counties,
  // Cook County, Tollway) there is no formal sub-tier structure —
  // IDOT D8 Appx. A is monolithic — and the Full template handles
  // everything.
  const ilTierInput: TierInput = {
    dailyTrips: Number(tg.dailyTrips ?? 0),
    pmPeakTrips: Number(tg.pmPeakTrips ?? (Number(tg.pmIn ?? 0) + Number(tg.pmOut ?? 0))),
    size: Number(tg.size ?? 0),
    unit: String(tg.unit ?? ""),
    landUseCode: String(tg.landUseCode ?? ""),
  };
  const ilRequested: StudyTier | undefined = req.studyTier;
  const ilResolvedTier = resolveStudyTier(region, ilTierInput, ilRequested);
  if (juris === "chicago_cdot") {
    if (ilResolvedTier === "worksheet") {
      renderTisIllinoisCdotWorksheet(doc, r, project, region, ilTierInput);
      return;
    }
    if (ilResolvedTier === "abbreviated") {
      renderTisIllinoisCdotAbbreviated(doc, r, project, region, ilTierInput);
      return;
    }
  }

  // For chicago_idot dispatch, the renderer also computes which
  // specific state route the project fronts (US-41, IL-50, etc.) so
  // the prose can name it for the reviewer.
  const chicagoStateRoute = juris === "chicago_idot"
    ? nearestChicagoStateRoute(lat, lon)
    : null;

  const jurisName: Record<IlJurisdiction, string> = {
    chicago_cdot: "City of Chicago (CDOT)",
    chicago_idot: chicagoStateRoute
      ? `IDOT District 1 + CDOT PRC co-review (project fronts ${chicagoStateRoute} inside Chicago)`
      : "IDOT District 1 + CDOT PRC co-review (state route inside Chicago)",
    cook_county: "Cook County DOTH",
    collar_dupage: "DuPage County DOT",
    collar_lake: "Lake County DOT",
    collar_will: "Will County DOT",
    collar_kane: "Kane County DOT",
    collar_mchenry: "McHenry County DOT",
    tollway_influence: "Illinois Tollway (ISTHA) influence area",
    downstate_idot: "IDOT District (downstate)",
  };
  const reviewAuthority: Record<IlJurisdiction, string> = {
    chicago_cdot: "Chicago Department of Transportation — Plan Review Committee (PRC), per the CDOT Guidelines for Travel Demand Study and Management (TDM) Plans v1.2 (February 5, 2024; supersedes interim v1.1 of June 2023), the Connected Communities Ordinance (Municipal Code §17-3-0308 / §17-4-0301), and Complete Streets Chicago (CDOT, 2013). State-system frontage routes inside Chicago co-route to IDOT District 1 (Schaumburg).",
    chicago_idot: `Dual-jurisdiction review${chicagoStateRoute ? ` — project fronts ${chicagoStateRoute}, an IDOT state-system route inside Chicago city limits` : " on state-system roadway inside Chicago"}. The IL spec (§2.3) requires both an IDOT TIS appendix and a CDOT TDM summary: IDOT District 1 (Schaumburg) Permits Unit Chief controls vehicle-LOS analysis per BLRS Ch. 27 / 32 / 34 / 41 + D8 Appx. A; CDOT Plan Review Committee controls the multimodal mode-shift commitments per the TDM Guidelines v1.2 (Feb 2024) + Complete Streets Chicago (2013). The January 2023 IDOT-CDOT MOU streamlines co-review on safety improvements along state routes inside Chicago.`,
    cook_county: "Cook County Department of Transportation & Highways (DOTH) — Permits Division, per the Construction Permit Packet (Nov 2020). Cook County publishes no standalone TIS manual; TIS scope is staff-discretionary during the access/signal permit review.",
    collar_dupage: "DuPage County DOT — Engineering, per the (request-only) Project Manual. DuPage's Fair Share Impact-Fee program terminated 2023-05-24; TIS is now staff-discretionary during the access/signal permit review.",
    collar_lake: "Lake County DOT, per the Highway Access and Use Ordinance (2019) and its Technical Reference Manual.",
    collar_will: "Will County DOT — Division of Transportation, Permit and Access Regulations. Will publishes no standalone TIS manual; TIS scope is staff-discretionary.",
    collar_kane: "Kane County DOT (KDOT), per the Permit Regulations Manual (2004 base + revisions).",
    collar_mchenry: "McHenry County DOT (MCDOT), per the Access Development Permit policy. Major Access Permit trigger: anticipated ADT > 50 trips per ITE → IL-PE-sealed TIS required.",
    tollway_influence: "Illinois Tollway (ISTHA) Planning. No published TIS manual; Tollway review fires when the development requests new/modified Tollway access OR discharges drainage to Tollway ROW. Cost-sharing per the 2007/2012 Interchange and Roadway Cost Sharing Policy (≥ 50% local share, IGA-driven).",
    downstate_idot: "IDOT District Permits Unit Chief, per BLRS Ch. 27 / 32 / 34 / 41 (design + access), Title 92 Part 550 (driveway permits), and the District 8 High-Volume Access-Permit Guidelines, April 2024 — Appendix A (the only IDOT-published prescriptive TIS section list located).",
  };
  const losStandard: Record<IlJurisdiction, string> = {
    chicago_cdot: "No vehicle LOS pass/fail. CDOT enforces the Complete Streets modal hierarchy (pedestrians → transit → cyclists → automobiles) and a Travel Demand Management measures matrix in lieu of LOS targets.",
    chicago_idot: "Dual standard: along the state-route mainline and at IDOT-jurisdiction intersections, BLRS Ch. 32 LOS applies (LOS C controlling for urban arterials/collectors, LOS D allowed in heavily-developed metro sections). On adjacent CDOT-jurisdiction city streets, CDOT does not apply vehicle-LOS pass/fail — the Complete Streets modal hierarchy and TDM measures matrix govern there.",
    cook_county: "BLRS Ch. 32: LOS C controlling for arterials/collectors, LOS D allowed in heavily-developed metro sections, LOS D minimum for urban local streets.",
    collar_dupage: "BLRS Ch. 32 plus DuPage County overlay where staff specify.",
    collar_lake: "Lake County Highway Access and Use Ordinance (2019) numeric thresholds — refer to the Technical Reference Manual for the LOS criterion applicable to the route classification.",
    collar_will: "BLRS Ch. 32 unless the County specifies otherwise during the permit review.",
    collar_kane: "BLRS Ch. 32 plus Kane County Permit Regulations Manual.",
    collar_mchenry: "BLRS Ch. 32 plus McHenry County Access Permit Policy.",
    tollway_influence: "BLRS Ch. 32 for cross-road LOS; Tollway mainline / ramp criteria per the Tollway Roadway Design Criteria (March 2026).",
    downstate_idot: "BLRS Ch. 32: LOS C controlling for rural arterials/collectors, LOS C controlling for urban arterials/collectors (with LOS D allowed in heavily-developed metro sections), LOS D minimum for urban local streets. Unsignalized intersections per BLRS Fig. 27-6A (HCM delay-based).",
  };
  const trigger: Record<IlJurisdiction, string> = {
    chicago_cdot: "Tiered by dwelling-unit count per the CDOT TDM Guidelines v1.2 (February 2024): Tier 1 (20–50 DU site plan), Tier 2 (51–175 DU TDM Memo), Tier 3 (>175 DU full TDM Study + Plan). Connected Communities Ordinance transit-served-location designation (½ mile of a CTA/Metra rail station entrance or eligible high-frequency bus corridor) drives by-right parking reductions and informs trip-generation reductions. The July 16, 2025 amendment (O2025-0015577, effective September 25, 2025) eliminated parking mandates outright in transit-served locations outside the downtown D districts — confirm the project's zoning district and the version of the Ordinance in force at submittal.",
    chicago_idot: "Both trigger paths apply: the CDOT TDM tiers (Tier 1/2/3 by DU count) gate the multimodal deliverable, AND the IDOT D8 Appx. A warrant-implicit trigger (turn-lane or signal warrant on the state-route frontage) gates the IDOT TIS appendix. Any access modification to the state route requires a permit under 92 Ill. Adm. Code Part 550 routed via OPER 1050 / OPER 1051 to District 1 Permits.",
    cook_county: "Staff-discretionary during the access/signal permit review (no published numeric trigger).",
    collar_dupage: "Staff-discretionary during the access/signal permit review (no published numeric trigger since Fair Share Impact-Fee termination 2023-05-24).",
    collar_lake: "Per Lake County Highway Access and Use Ordinance Technical Reference Manual — numeric thresholds keyed to access classification.",
    collar_will: "Staff-discretionary during the access/signal permit review.",
    collar_kane: "Per Kane County Permit Regulations Manual.",
    collar_mchenry: "Major Access Permit threshold: anticipated > 50 vehicle trips per day per ITE → IL-PE-sealed TIS required.",
    tollway_influence: "No numeric trigger; ISTHA review fires only when the development requests new/modified Tollway access OR proposes drainage discharge into Tollway ROW.",
    downstate_idot: "No statewide numeric peak-hour trip threshold. The IDOT TIS-trigger is implicit through turn-lane and signal warrants: a TIS is required if turn lanes or traffic signals are anticipated (D8 Appx. A). The renderer evaluates ILMUTCD signal warrants and BDE turn-lane nomographs as the gating analysis.",
  };
  const programmedSource: Record<IlJurisdiction, string> = {
    chicago_cdot: "IDOT Multi-Year Improvement Program FY 2026–2031, CMAP TIP (FFY 2023–2028, FFY 2026–2030 call open), CMAP ON TO 2050 Comprehensive Regional Plan, and the CDOT Capital Improvement Program.",
    chicago_idot: "IDOT Multi-Year Improvement Program FY 2026–2031 (any programmed project on the state-route frontage is committed background per the IDOT review), CMAP TIP, CMAP ON TO 2050, and the CDOT Capital Improvement Program (committed CDOT improvements adjacent to the state route per the CDOT review).",
    cook_county: "IDOT MYP FY 2026–2031, CMAP TIP, and Cook County DOTH project list.",
    collar_dupage: "IDOT MYP FY 2026–2031, CMAP TIP, ON TO 2050, and DuPage County DOT capital program.",
    collar_lake: "IDOT MYP FY 2026–2031, CMAP TIP, ON TO 2050, and Lake County DOT capital program.",
    collar_will: "IDOT MYP FY 2026–2031, CMAP TIP, ON TO 2050, and Will County DOT capital program.",
    collar_kane: "IDOT MYP FY 2026–2031, CMAP TIP, ON TO 2050, and Kane County DOT capital program.",
    collar_mchenry: "IDOT MYP FY 2026–2031, CMAP TIP, ON TO 2050, and McHenry County DOT capital program.",
    tollway_influence: "IDOT MYP FY 2026–2031, the Move Illinois capital program (completing end of 2027), and the successor Bridging the Future $2B / 7-yr program approved Dec 2024.",
    downstate_idot: "IDOT MYP FY 2026–2031 and the federally-required STIP FY 2026. For projects within an MPO planning area, the applicable regional MPO TIP also applies.",
  };

  // --- Executive Summary --------------------------------------------------
  gaSection(doc, "EXECUTIVE SUMMARY");
  doc.font("body").fontSize(10).fillColor("black");
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  const summary = `This Traffic Impact Study (TIS) presents the anticipated traffic impacts of the proposed ${project.projectName || "development"} located within ${region.displayName}, Illinois. The study evaluates ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile study radius using methodology consistent with the Highway Capacity Manual current edition and the ITE Trip Generation Manual current edition. Trip generation is calculated for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}) at a development size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`;
  doc.text(summary, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text(`Reviewing authority: ${jurisName[juris]}.`, { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(reviewAuthority[juris], { paragraphGap: 6 });
  doc.fillColor("black");

  if (juris === "chicago_cdot") {
    doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text("Chicago Variant — Travel Demand Management framework");
    doc.moveDown(0.2);
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Inside the City of Chicago, the CDOT TDM Guidelines v1.2 (February 5, 2024) replace the traditional vehicle-LOS TIS with a tiered Travel Demand Management deliverable: Tier 1 (site plan), Tier 2 (TDM Memo), Tier 3 (TDM Study + Plan). The vehicle-LOS analysis below is included as supplementary engineering context and as the IDOT-side basis if any state-route frontage co-routes to District 1 (Schaumburg). The TDM-side deliverable — mode-shift reductions, transit-served-location designation, TDM Measures Matrix tied to ordinance §17-3-0308 / §17-4-0301 — is scoped during DPD / CDOT PRC coordination and is not auto-generated by this screening tool.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  doc.font("body").fontSize(10).fillColor("black").text("Findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (losDrops === 0 && losEf === 0) {
    doc.text("• No intersections within the study network are projected to drop one or more LOS under build conditions.", { paragraphGap: 2 });
    doc.text("• No mitigation is necessary to maintain the host-jurisdiction Level of Service standard within the study network.", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} intersection${losDrops === 1 ? "" : "s"} project to drop one or more LOS under build conditions.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} intersection${losEf === 1 ? "" : "s"} operate at LOS E or F under build conditions and may require mitigation per BLRS Ch. 32 + Ch. 34 and the host-jurisdiction standard above.`, { paragraphGap: 4 });
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
    `This Traffic Impact Study follows the IDOT District 8 High-Volume Access-Permit Guidelines (April 2024) Appendix A as the base section structure — the only IDOT-published prescriptive TIS content list located. The report is layered with the ${jurisName[juris]} overlay where applicable. ${reviewAuthority[juris]}`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trigger basis: ${trigger[juris]}`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Note: Illinois has no single statewide TIS manual. The methodology applied here is assembled from IDOT BLRS chapters (Ch. 17 planning, Ch. 27 design controls + LOS, Ch. 28 sight distance, Ch. 32 geometric tables, Ch. 34 intersections, Ch. 39 traffic-control devices, Ch. 41 driveways), Title 92 Illinois Admin. Code Part 550 (driveway permit policy), and the IDOT District 8 April 2024 guidelines. District 1 (Schaumburg) publishes NO TIS-specific guideline document — only the D1 Traffic Signal Design Guidelines (October 2025), which govern signal design rather than TIS scope; D8 Appx. A is the de facto fallback statewide. D1 may still impose unwritten variations on growth-rate convention, software choice at IDS phase, and timeline — confirm at the kickoff meeting with the District Permits Unit Chief.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §2 Project Description --------------------------------------------
  gaSection(doc, "2.0 PROJECT DESCRIPTION");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Design year (opening + 20)", String((Number(req.openingYear ?? 0) || 0) + 20 || "—")],
    ["Region", region.displayName],
    ["Host jurisdiction", jurisName[juris]],
  ]);
  doc.moveDown(0.5);

  // --- §3 Existing Conditions --------------------------------------------
  gaSection(doc, "3.0 EXISTING CONDITIONS");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Existing roadway geometry, posted speed, functional classification, lane count, and historical AADT are referenced from the IDOT Getting Around Illinois public AADT viewer (gettingaroundillinois.com) and the IDOT AADT GIS open-data layer. Crash history (3-year minimum) is sourced from the IDOT Safety Data Mart (consultant access via FOIA). Existing peak-period turning-movement counts (TMCs) and 24-hr machine counts within the most recent 12 months should be collected per D8 Appx. A — three-to-four peak-period hours minimum, Tuesday/Wednesday/Thursday, clear-and-dry conditions.",
    { paragraphGap: 6 },
  );
  if (juris === "chicago_cdot") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Inside Chicago, the City of Chicago Average Daily Traffic Counts open-data portal supplies historical ADT (note: many CDOT counts are aged — flag the count year explicitly when citing). The CNT Chicago Truck Counts portal supplies truck / bike / pedestrian counts for freight-generator sites and TDM analysis.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
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

  // --- §4 Trip Generation -------------------------------------------------
  gaSection(doc, "4.0 TRIP GENERATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is calculated per the ITE Trip Generation Manual current edition for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Per IDOT District 8 Appendix A, "the current edition of the ITE Trip Generation Manual shall be used" — no edition pin. Pass-by and internal-capture credits are taken from the ITE Trip Generation Handbook and applied only against the external trips assigned to the study network. Supplemental sources are allowed for land uses not represented in ITE, with District permission.`,
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

  if (juris === "chicago_cdot") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Chicago additional reductions (TDM context, not auto-applied): Connected Communities Ordinance transit-served-location reduction (½-mi rule from CTA/Metra rail station entrance per §17-3-0308 / §17-4-0301), pedestrian-network density credits, and P-street designation effects on access geometry. The site's transit-served eligibility and TDM Measures Matrix commitments determine the final trip-reduction figure used in the TDM deliverable; this screening report shows the ITE-base trip generation only.",
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

  // --- §5 Background Growth ----------------------------------------------
  gaSection(doc, "5.0 BACKGROUND GROWTH");
  const measuredGrowth = IL_MEASURED_GROWTH[region.code];
  // When the engine applied a measured rate (via `r.growthSource`) the
  // §5 prose AND the §6 No-Build/Build columns are now derived from the
  // SAME number — no more renderer-vs-engine inconsistency where the
  // prose printed 1.80%/yr but the volumes were grown at 1.50%/yr.
  if (measuredGrowth) {
    // We have a real measured trend for this metro — print the
    // derivation in place of the "screening default" hedge.
    doc.font("body").fontSize(10).fillColor("black").text(
      `Background traffic is grown at ${measuredGrowth.growthPct.toFixed(2)}% per year, derived from the ${measuredGrowth.yearTo - measuredGrowth.yearFrom}-year compound AADT growth rate measured across ${measuredGrowth.stations} matched IDOT count stations within the ${region.displayName} bounding box. Source: IDOT Historical AADT, ${measuredGrowth.yearFrom} and ${measuredGrowth.yearTo} layer snapshots, segments matched by INVENTORY where the AADT vintage year is within ±1 of each layer year. Per-station CAGR distribution: P25 ${measuredGrowth.p25Pct.toFixed(2)}%/yr · median ${measuredGrowth.growthPct.toFixed(2)}%/yr · P75 ${measuredGrowth.p75Pct.toFixed(2)}%/yr. The wide IQR reflects real corridor heterogeneity (heavily developed infill arterials grow faster than legacy state highways in declining counties); for the formal submittal, IDOT D8 Appx. A asks for the per-segment trend on the affected facilities specifically, not the metro median. This screening value is published here for transparency and to give the District a starting point at the kickoff meeting.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Background traffic is grown at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"}. IDOT does not codify a statewide fixed growth rate; D8 Appx. A requires the consultant to derive and justify the rate. Common practice is the 5-year compound AADT growth rate from the nearest IDOT count station on Getting Around Illinois, or a CMAP travel-demand-model node projection for sites within the 7-county region. The value applied here is a screening default and should be re-calibrated against historical AADT trend on affected segments and confirmed at the District kickoff meeting before formal submittal.`,
      { paragraphGap: 6 },
    );
  }

  // --- §6 Future Conditions — Four Scenarios -----------------------------
  gaSection(doc, "6.0 FUTURE CONDITIONS ANALYSIS");
  const openingYr = Number(req.openingYear ?? 0) || null;
  const designYr = openingYr ? openingYr + 20 : null;
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per IDOT District 8 Appendix A, four mandatory scenarios are evaluated for each phase: (1) Opening (Construction) Year No-Build (${openingYr ?? "opening year"}); (2) Opening Year Build (${openingYr ?? "opening year"}); (3) 20-Year Design Year No-Build (${designYr ?? "opening + 20"}); (4) 20-Year Design Year Build (${designYr ?? "opening + 20"}). For phased developments, a Full-Build-Out year between opening and design year is added. The design year is measured from construction completion, not submittal year, per BLRS §27-6.02(a). Level of Service is calculated per HCM current edition.`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    `Host-jurisdiction LOS standard: ${losStandard[juris]}`,
    { paragraphGap: 6 },
  );
  const hasDesignYear = intersections.some(
    (it) => it.designNoBuildLos != null || it.designBuildLos != null,
  );
  if (hasDesignYear) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `All four D8-mandated scenarios are reported below at each affected intersection. The Design-Year columns project the No-Build and Build conditions forward to ${designYr ?? "design year"} (opening + 20 yr at the same compound growth rate); the project's external trip generation does not grow with the design horizon — only the background traffic does.`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "This screening tool currently reports three scenarios (Existing / Opening No-Build / Opening Build) at each affected intersection. The 20-Year Design Year No-Build and Build scenarios are required for the formal D8-style submittal and should be generated for each affected intersection at design year before submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  if (intersections.length > 0) {
    if (hasDesignYear) {
      table(doc, {
        headers: ["Intersection", "Existing", "Opening NB", "Opening Bld", "Design NB", "Design Bld", "Δ delay (s)"],
        widths: [165, 55, 65, 65, 60, 60, 55],
        align: ["left", "center", "center", "center", "center", "center", "right"],
        rows: intersections.map((it) => {
          const losChanged = it.losChanged === true;
          const currentLos = it.currentLos ?? it.existingLos ?? "—";
          const noBuildLos = it.existingLos ?? "—";
          const buildLos = it.futureLos ?? "—";
          const designNbLos = it.designNoBuildLos ?? "—";
          const designBldLos = it.designBuildLos ?? "—";
          return [
            it.name ?? it.signalId ?? "—",
            String(currentLos),
            String(noBuildLos),
            (losChanged ? "▲ " : "") + String(buildLos),
            String(designNbLos),
            String(designBldLos),
            fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
          ];
        }),
      });
    } else {
      table(doc, {
        headers: ["Intersection", "Existing LOS", "Opening NB LOS", "Opening Build LOS", "Δ delay (s)", "Q95 (ft)"],
        widths: [180, 65, 75, 80, 65, 60],
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
  }
  doc.moveDown(0.5);

  // --- §7 Mitigation, Warrants, Sight Distance ---------------------------
  gaSection(doc, "7.0 MITIGATION, WARRANTS, AND SIGHT DISTANCE");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Recommended improvements below are screening-level concepts sized to the projected delay change. The formal D8-style submittal additionally requires explicit turn-lane warrant analysis (BDE nomographs), ILMUTCD signal warrant analysis (Warrants 1–9 with met/not-met), sight-distance verification (BLRS Ch. 28: SSD, ISD), and auxiliary-lane / acceleration / deceleration geometry per BLRS Ch. 34. Pedestrian and bicycle accommodations are evaluated against BDE Ch. 17 non-motorized warrants.",
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
  if (juris === "chicago_cdot") {
    doc.moveDown(0.3);
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Chicago note: CDOT does not apply vehicle-LOS pass/fail mitigation. The TDM Measures Matrix — transit subsidies, bike/pedestrian infrastructure, off-street loading commitments, parking-supply caps — is the equivalent CDOT mitigation instrument, with a monetized cost share and monitoring commitment per the CDOT TDM Guidelines v1.2. Loading-zone minimums follow Chicago Municipal Code §17-10-1100. Driveways onto Pedestrian Streets (P-street overlay) are restricted under §17-3-0500 / §17-4-0500 — site access must come from the alley where applicable.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  if (juris === "tollway_influence") {
    doc.moveDown(0.3);
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Tollway interchange/ramp modifications fall under the ISTHA Interchange and Roadway Cost Sharing Policy (≥ 50% local share) and the Environmental Studies Manual (Categorical Exclusion / EA process). Drainage discharge to Tollway ROW requires conformance with the Tollway Drainage Design Manual (March 2026). This screening report does not size cost-share or trigger the IGA — coordinate directly with ISTHA Planning.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- §8 Programmed Projects --------------------------------------------
  gaSection(doc, "8.0 PROGRAMMED PROJECTS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    `Review of programmed transportation projects within the study area should consult: ${programmedSource[juris]} This screening analysis does not automatically integrate programmed-projects data; manual review against the IDOT MYP GIS layer (gis-idot.opendata.arcgis.com) is recommended for any submittal.`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §9 Conclusions ----------------------------------------------------
  gaSection(doc, "9.0 CONCLUSIONS & RECOMMENDATIONS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `This screening TIS identifies ${losDrops} intersection${losDrops === 1 ? "" : "s"} with LOS drops and ${losEf} operating at LOS E or F under build conditions. The formal submittal to ${jurisName[juris]} should validate these screening results against current-edition manuals, fresh TMCs within the most recent 12 months, derived growth rates, the four-scenario horizon analysis, and the host-jurisdiction scoping outcome. The report must be sealed by a Licensed Professional Engineer of Illinois; digital seals and signatures are allowed per 68 Ill. Admin. Code §1380.295. The required submittal package is two bound paper copies + one electronic PDF + the electronic capacity-analysis source files (Synchro / HCS / Vistro), routed to the District Permits Unit Chief. Allow approximately 8–10 weeks per submittal review and 18–24 months total for signalized or widening projects.`,
    { paragraphGap: 6 },
  );

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
 * CDOT Tier 1 — Site Plan + Project Narrative (cover memo, 1–2 pp).
 *
 * Per CDOT TDM Guidelines v1.1 (June 2023) Table 1, the Tier 1
 * deliverable is NOT a study — it is a site plan plus a project
 * narrative emailed to CDOTPRC@cityofchicago.org for Plan Review
 * Committee (PRC) review. CDOT enforces the Complete Streets
 * Chicago modal hierarchy (pedestrian → transit → bike → auto); no
 * vehicle-LOS analysis, no signal warrants, no turn-lane nomographs
 * are part of Tier 1. This memo surfaces the transit-served-
 * location designation (CCO ½-mile rule, Municipal Code §17-3-0308
 * / §17-4-0301) and the Connected Communities Ordinance compliance
 * check so the applicant + PRC can confirm tier classification.
 */
function renderTisIllinoisCdotWorksheet(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
  tierInput: TierInput,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const lat = Number(req.latitude ?? project.siteLat ?? NaN);
  const lon = Number(req.longitude ?? project.siteLon ?? NaN);
  const tierName = jurisdictionTierLabel(region, "worksheet");

  gaSection(doc, "CDOT TIER 1 — SITE PLAN + PROJECT NARRATIVE");
  doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(tierName, { paragraphGap: 4 });
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Tier 1 cover memo per the CDOT Guidelines for Travel Demand Study and Management (TDM) Plans v1.1 (June 2023), Table 1. No formal study is required at this tier — the deliverable is a site plan + project narrative emailed to CDOTPRC@cityofchicago.org for Plan Review Committee (PRC) review. CDOT enforces the Complete Streets Chicago modal hierarchy pedestrian → transit → bike → auto; vehicle-LOS analysis, signal warrants, and turn-lane nomographs are NOT part of a Tier 1 review.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSection(doc, "1.0 PROJECT NARRATIVE");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Site coordinates", Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : "—"],
    ["Region", region.displayName],
    ["Host jurisdiction", "City of Chicago (CDOT)"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Proposed ITE land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Screened daily / PM-peak trips (ITE base)", `${fmtNum(tierInput.dailyTrips)} / ${fmtNum(tierInput.pmPeakTrips)}`],
  ]);
  doc.moveDown(0.3);
  doc.font("body").fontSize(10).fillColor("black").text(
    `The proposed ${project.projectName || "development"} is a ${tg.landUseName ?? ""} project at ${tg.size ?? "—"} ${tg.unit ?? ""} located within ${region.displayName}, Illinois (City of Chicago, CDOT jurisdiction). At this scale (residential 20–50 dwelling units, or the equivalent threshold per use class), CDOT requires a site plan + project narrative for PRC review only. No TDM Memo, TDM Plan, or vehicle-LOS analysis is required.`,
    { paragraphGap: 6 },
  );

  gaSection(doc, "2.0 TRANSIT-SERVED LOCATION DESIGNATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    "The Connected Communities Ordinance (CCO) — Chicago Municipal Code §17-3-0308 (B/C districts) and §17-4-0301 (D districts) — defines a \"Transit-Served Location\" as within 2,640 feet (½ mile) of a CTA or Metra rail station entrance, or within an eligible high-frequency CTA bus corridor. Transit-served-location designation drives the by-right parking reductions and informs the project narrative's mode-share assumptions.",
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Verification items the applicant attests in the narrative: (a) walking distance from the site to the nearest CTA \"L\" station entrance; (b) walking distance to the nearest Metra commuter-rail station; (c) whether the site is on an eligible CTA high-frequency bus corridor. This screening tool does not auto-resolve transit-served eligibility — the applicant attests in the project narrative. The July 16, 2025 amendment (Ordinance O2025-0015577, effective September 25, 2025) eliminated parking mandates outright in transit-served locations outside the downtown D districts; confirm the project's zoning district and the Ordinance version in force at submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSection(doc, "3.0 CONNECTED COMMUNITIES ORDINANCE COMPLIANCE CHECK");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text("• §17-3-0308 (B/C transit-served zoning) — confirm the project's zoning district and applicable parking-reduction provisions.", { paragraphGap: 2 });
  doc.text("• §17-4-0301 (D transit-served zoning) — applies where the site is within a Downtown (D) district transit-served location.", { paragraphGap: 2 });
  doc.text("• §17-3-0500 / §17-4-0500 (Pedestrian Streets) — if any frontage is a designated P-street, new curb cuts / driveways are restricted on the primary frontage; primary access must come from the alley.", { paragraphGap: 2 });
  doc.text("• §17-10-1100 (loading-zone minimums) — verify required off-street loading spaces by use class and size.", { paragraphGap: 4 });
  doc.moveDown(0.3);

  gaSection(doc, "4.0 SITE-PLAN ITEMS (TIER 1 SUBMITTAL SCOPE)");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "The Tier 1 site plan submitted to the CDOT Plan Review Committee should label: (a) all proposed curb cuts and driveways, with horizontal dimensions and throat depth; (b) sidewalk, pedestrian crossing, and ADA ramp details at every street frontage; (c) bicycle parking (short-term and long-term per Chicago Municipal Code §17-10-0700); (d) off-street loading geometry per §17-10-1100; (e) any proposed modifications within the public way (note: a separate CIPW permit per the CDOT Regulations for Construction in the Public Way is required); (f) transit-stop / bus-shelter adjacency if a CTA stop fronts the site; (g) the alley-access path if any frontage is a Pedestrian Street.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSection(doc, "5.0 SUBMITTAL");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text("• Reviewing authority: Chicago Department of Transportation — Plan Review Committee (PRC).", { paragraphGap: 2 });
  doc.text("• Submission: site plan + this project narrative emailed to CDOTPRC@cityofchicago.org.", { paragraphGap: 2 });
  doc.text("• No formal Traffic Impact Study, TDM Memo, or TDM Plan is required at Tier 1.", { paragraphGap: 2 });
  doc.text("• PE seal: not strictly required at Tier 1 — the project architect or AICP/PTP may sign the narrative; confirm signing-professional requirements at PRC coordination.", { paragraphGap: 4 });
  doc.moveDown(0.3);

  gaSection(doc, "6.0 TIER ESCALATION");
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    `If CDOT PRC requests additional analysis — e.g., the project triggers a Planned Development designation, the site fronts an IDOT state route requiring co-review, or the project crosses a CCO size threshold during design refinement — regenerate this report with Tier = Abbreviated (Tier 2 TDM Memo) or Full (Tier 3 TDM Study + Plan). The dwelling-unit count screening for residential land uses (ITE 220-series): Tier 1 = 20–50 DU, Tier 2 = 51–175 DU, Tier 3 = >175 DU. The screened project size of ${tg.size ?? "—"} ${tg.unit ?? ""} falls within the Tier 1 band.`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
}

/**
 * CDOT Tier 2 — Travel Demand Management Memo.
 *
 * Per CDOT TDM Guidelines v1.1 (June 2023) Table 1, the Tier 2
 * deliverable is a TDM Memo — fundamentally a trip-REDUCTION plan,
 * not a network-impact study. The required Table 1 content list:
 *   • SOV-trip minimization approach
 *   • Transit / bike / walk maximization
 *   • Pedestrian-oriented design
 *   • Infrastructure improvements
 *   • TDM strategies selected (with monetized cost share + monitoring)
 *   • Baseline SOV-reduction goal (≤50% single-occupancy trip share)
 *   • Commitment letter required at approval (load-bearing legal hook)
 *
 * No vehicle LOS tables, no signal warrants, no turn-lane
 * nomographs. CDOT enforces the Complete Streets Chicago modal
 * hierarchy (pedestrian → transit → bike → auto); vehicle-LOS
 * pass/fail is not a CDOT performance metric.
 */
function renderTisIllinoisCdotAbbreviated(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
  tierInput: TierInput,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const lat = Number(req.latitude ?? project.siteLat ?? NaN);
  const lon = Number(req.longitude ?? project.siteLon ?? NaN);
  const tierName = jurisdictionTierLabel(region, "abbreviated");

  gaSection(doc, "CDOT TIER 2 — TRAVEL DEMAND MANAGEMENT MEMO");
  doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(tierName, { paragraphGap: 4 });
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Tier 2 TDM Memo per the CDOT Guidelines for Travel Demand Study and Management (TDM) Plans v1.1 (June 2023), Table 1. This is NOT a vehicle-LOS Traffic Impact Study — CDOT enforces the Complete Streets Chicago (CDOT, 2013) modal hierarchy pedestrian → transit → bike → auto and a Travel Demand Management strategies matrix in lieu of vehicle-LOS pass/fail. The Table 1 required content list is: (1) SOV-trip minimization approach, (2) transit / bike / walk maximization, (3) pedestrian-oriented design, (4) infrastructure improvements, (5) TDM strategies selected (monetized cost share + monitoring), (6) baseline SOV-reduction goal (≤50% single-occupancy trip share), and (7) a TDM commitment letter at approval.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSection(doc, "1.0 APPLICANT AND ZONING SUMMARY");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Site coordinates", Number.isFinite(lat) && Number.isFinite(lon) ? `${lat.toFixed(4)}°, ${lon.toFixed(4)}°` : "—"],
    ["Region", region.displayName],
    ["Host jurisdiction", "City of Chicago (CDOT)"],
    ["Proposed ITE land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Tier (CDOT TDM Guidelines v1.1)", "Tier 2 — TDM Memo (residential 51–175 DU, or equivalent threshold per use class)"],
    ["Screened daily / PM-peak trips (ITE base)", `${fmtNum(tierInput.dailyTrips)} / ${fmtNum(tierInput.pmPeakTrips)}`],
  ]);
  doc.moveDown(0.3);

  gaSection(doc, "2.0 MODAL HIERARCHY (COMPLETE STREETS CHICAGO)");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per Complete Streets Chicago (CDOT, 2013), the design priority order for every project within the public way is: (1) pedestrians, (2) transit, (3) cyclists, (4) automobiles. This Tier 2 TDM Memo demonstrates that each step in the modal hierarchy has been addressed in the proposed development's circulation, access geometry, and TDM strategies. Vehicle Level of Service is NOT a CDOT performance metric and is not part of this deliverable.",
    { paragraphGap: 6 },
  );

  gaSection(doc, "3.0 EXISTING MULTIMODAL CONDITIONS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "The Tier 2 memo describes existing conditions for each mode in priority order: (a) pedestrian — sidewalk widths, crossing distances, ADA compliance, P-street designation; (b) transit — CTA bus and rail service within ¼-mile walkshed, Metra commuter rail within ½-mile, headways, route frequency; (c) bicycle — adjacent CDOT-designated bike facilities (Streets for Cycling Plan 2020, protected bike lane network), Divvy bike-share station proximity; (d) auto — adjacent roadway functional class, posted speed, and (for context only) Chicago Data Portal ADT counts. Note: CDOT ADT counts at data.cityofchicago.org/Transportation/Average-Daily-Traffic-Counts/gc7y-n4xa are aged — flag the count year explicitly when citing. The CNT Chicago Truck Counts portal (chicagotruckcounts.cnt.org) supplies truck / bike / pedestrian counts for freight-generator sites.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSection(doc, "4.0 TRANSIT-SERVED LOCATION DESIGNATION (CCO)");
  doc.font("body").fontSize(10).fillColor("black").text(
    "The Connected Communities Ordinance (CCO) — Chicago Municipal Code §17-3-0308 (B/C districts) and §17-4-0301 (D districts) — defines a Transit-Served Location as within 2,640 feet (½ mile) of a CTA or Metra rail station entrance, or within an eligible high-frequency CTA bus corridor. The Tier 2 memo establishes transit-served-location eligibility by (a) measuring walking distance to the nearest CTA rail station entrance, (b) measuring walking distance to the nearest Metra rail station, and (c) confirming high-frequency-bus-corridor eligibility against the current CTA service plan. Transit-served-location designation drives the by-right parking reductions, the by-right zero-parking provisions in the downtown D districts (per the July 16, 2025 amendment O2025-0015577 effective September 25, 2025), and the TDM Memo mode-shift trip-reduction credit.",
    { paragraphGap: 6 },
  );

  gaSection(doc, "5.0 SOV-TRIP MINIMIZATION APPROACH");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Baseline ITE trip generation is calculated per the ITE Trip Generation Manual current edition for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. The Tier 2 TDM Memo's primary performance metric is the projected single-occupancy-vehicle (SOV) trip share AFTER the selected TDM strategies are applied. CDOT's baseline goal is that the project demonstrate an SOV share ≤ 50% of total trips. Reductions from the ITE base are claimed against the modal hierarchy: pedestrian trips (walk-up from transit-served-location density), transit trips (CTA / Metra catchment), bicycle trips (PBL network connectivity + Divvy access), shared-vehicle trips (carpool / vanpool, TNC), and trip elimination (work-from-home, mixed-use internal capture).`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "ITE base", "After TDM (target)", "SOV share goal"],
    widths: [140, 90, 110, 100],
    align: ["left", "right", "right", "right"],
    rows: [
      ["Daily", fmtNum(tierInput.dailyTrips), "—", "≤ 50%"],
      ["AM peak hour", fmtNum(tg.amPeakTrips), "—", "≤ 50%"],
      ["PM peak hour", fmtNum(tierInput.pmPeakTrips), "—", "≤ 50%"],
    ],
  });
  doc.moveDown(0.3);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "The After-TDM column is computed by the applicant at submittal from the §9 TDM Strategies Matrix cumulative reduction percentages — this screening renderer does not auto-apply the strategy bundle since the strategy selection is a design choice, not a deterministic computation. Show working in an appendix and cite source rates (e.g., TCRP Report 95 mode-shift literature; VTPI TDM Encyclopedia; ULI Mixed-Use Internal Capture).",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSection(doc, "6.0 TRANSIT, BIKE, AND WALK MAXIMIZATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Design moves taken to maximize each non-auto mode share: (a) pedestrian — sidewalk widening to Complete Streets standard, mid-block crossings where warranted, weather protection (canopy / colonnade) at primary entrances, direct pedestrian connections to adjacent transit; (b) transit — bus-shelter / queue accommodations on adjacent frontages, real-time transit information display in the project lobby, employer transit-benefit pre-tax (§132 TransitChek) commitment for non-residential uses; (c) bicycle — short-term and long-term bicycle parking per Chicago Municipal Code §17-10-0700 (and above-minimum bike parking as a TDM credit), shower / locker facilities for non-residential uses, repair station, Divvy station siting coordination with the operator (Lyft), direct connection to the protected bike lane (PBL) network. Each commitment carries through to the §9 TDM Strategies Matrix as a monetized commitment with a monitoring plan.",
    { paragraphGap: 6 },
  );

  gaSection(doc, "7.0 PEDESTRIAN-ORIENTED DESIGN");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per Complete Streets Chicago, the building face engages the public way as a pedestrian experience: (a) active uses (retail, lobby, residential entrances) at the ground floor; (b) no blank walls on primary frontages; (c) curb cuts minimized — primary access from the alley wherever a Pedestrian Street (§17-3-0500 / §17-4-0500) is involved, and even where not, curb-cut count limited to the minimum needed for off-street parking access; (d) pedestrian-scale lighting on every frontage; (e) loading and service docks oriented to side streets or alleys, not primary pedestrian frontages.",
    { paragraphGap: 6 },
  );

  gaSection(doc, "8.0 INFRASTRUCTURE IMPROVEMENTS");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Site-frontage infrastructure improvements committed under this Tier 2 TDM Memo (typical scope): sidewalk reconstruction to current CDOT standards, ADA-compliant curb ramps at every intersection touched, pedestrian-scale street lighting, planted curb extensions where reduced corner radii apply, bicycle parking and (where applicable) Divvy station relocation / expansion in coordination with the Divvy operator. Each improvement requires a separate Construction in the Public Way (CIPW) permit per the CDOT Regulations for Construction in the Public Way. Bus-stop displacement during construction follows the CDOT Better Streets for Buses Plan (December 2023) protocols + CTA coordination.",
    { paragraphGap: 6 },
  );

  gaSection(doc, "9.0 TDM STRATEGIES MATRIX (SELECTED)");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Per CDOT TDM Guidelines v1.1 Table 1, this section selects from the published TDM Strategies Matrix and binds each selection to a monetized cost share and a monitoring commitment. The matrix below shows a typical Tier 2 selection bundle for a mid-rise residential project; final selection is determined at PRC coordination. Each strategy's effective-trip-reduction percentage is drawn from the literature (TCRP Report 95; VTPI TDM Encyclopedia; ULI Mixed-Use Internal Capture) — values shown are typical ranges, not committed values.",
    { paragraphGap: 4 },
  );
  doc.fillColor("black");
  table(doc, {
    headers: ["Strategy", "Typ. SOV reduction", "Cost (est.)", "Monitoring"],
    widths: [220, 80, 80, 100],
    align: ["left", "right", "right", "left"],
    rows: [
      ["Unbundled parking (separate parking lease from unit)", "5–15%", "Operational", "Annual leasing report"],
      ["Transit-benefit subsidy / Ventra pass distribution", "3–8%", "$ per occupant/yr", "Quarterly enrollment count"],
      ["Bike-share (Divvy) corporate / building membership", "1–3%", "$ per member/yr", "Annual membership audit"],
      ["Above-minimum long-term bike parking", "1–4%", "Capital, $$", "Quarterly inventory check"],
      ["Carshare / TNC pick-up zone designation", "1–3%", "Capital, $$", "Annual usage report"],
      ["Pre-tax §132 TransitChek (employer-side)", "2–5%", "Tax-neutral", "Annual enrollment count"],
      ["Real-time transit info display in lobby", "0–1%", "Capital, $", "—"],
      ["Pedestrian-scale wayfinding to nearest CTA", "0–2%", "Capital, $", "—"],
      ["Telework / hybrid work agreement (non-residential)", "5–25%", "Operational", "Annual mode survey"],
    ],
  });
  doc.moveDown(0.3);
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Note: TDM-strategy reduction values are not additive — overlapping strategies share trips. The cumulative reduction should be calculated using a discounted-bundle approach (each subsequent strategy applied to the residual share after prior strategies), not a straight sum. CDOT requires the applicant to show the bundle calculation in an appendix.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSection(doc, "10.0 BASELINE SOV REDUCTION GOAL");
  doc.font("body").fontSize(10).fillColor("black").text(
    "CDOT's baseline performance goal for a Tier 2 TDM Memo is that the project demonstrate ≤50% single-occupancy-vehicle (SOV) share of total daily trips after the selected TDM strategies are applied. SOV share is computed against the ITE-base daily trip count, net of mode-shift, internal-capture, and trip-elimination credits, with documented source rates. Projects in transit-served locations with strong walk-up density commonly exceed the 50%-reduction goal; suburban-style projects (limited transit catchment + high parking ratios) may fail this gate and trigger escalation to a Tier 3 TDM Study + Plan.",
    { paragraphGap: 6 },
  );

  gaSection(doc, "11.0 TDM COMMITMENT LETTER (LOAD-BEARING)");
  doc.font("body").fontSize(10).fillColor("black").text(
    "At PRC approval, the applicant signs a TDM Commitment Letter — the load-bearing legal hook for the Tier 2 deliverable. The letter binds the applicant (and successors) to: (a) the selected TDM Strategies Matrix; (b) the per-strategy monetized cost share; (c) the per-strategy monitoring + reporting cadence; (d) annual reporting to CDOT for a defined post-occupancy term (commonly 3–5 years). The Commitment Letter is recorded with the project's zoning approval — it survives ownership transfer and operating-company changes. Tier 2 projects that fail to file annual TDM reports are flagged in the CDOT enforcement queue.",
    { paragraphGap: 6 },
  );

  gaSection(doc, "12.0 LOADING, PEDESTRIAN STREETS, AND ACCESS");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text("• Off-street loading: minimum spaces per Chicago Municipal Code §17-10-1100 by use class and size.", { paragraphGap: 2 });
  doc.text("• Pedestrian Street (P-street) overlay: §17-3-0500 / §17-4-0500 — restricts new curb cuts on primary frontage; primary access must come from the alley.", { paragraphGap: 2 });
  doc.text("• Curb cuts and driveways: subject to the CDOT Street and Site Plan Design Standards; minimize count and width.", { paragraphGap: 2 });
  doc.text("• Construction-period MOT: per the CDOT Regulations for Construction in the Public Way (CIPW). Bus-stop displacement requires CTA coordination per the Better Streets for Buses Plan (December 2023).", { paragraphGap: 4 });
  doc.moveDown(0.3);

  gaSection(doc, "13.0 SUBMITTAL");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text("• Reviewing authority: Chicago Department of Transportation — Plan Review Committee (PRC).", { paragraphGap: 2 });
  doc.text("• Submission: TDM Memo + appendices emailed to CDOTPRC@cityofchicago.org. Coordinate Planned Development (PD) routing via DPD if the project is a PD.", { paragraphGap: 2 });
  doc.text("• Signing professional: a Licensed Professional Engineer of Illinois (or an AICP / PTP with relevant transportation-planning credentials) signs the TDM Memo. Confirm signing-professional requirements at the CDOT PRC kickoff.", { paragraphGap: 2 });
  doc.text("• CTA: letter of no objection where the site affects bus-stop / station access.", { paragraphGap: 2 });
  doc.text("• If the site fronts an IDOT state route, co-route to IDOT District 1 (Schaumburg) Permits per 92 Ill. Adm. Code Part 550 — that triggers a parallel IDOT TIS appendix per IL spec §2.3.", { paragraphGap: 4 });
  doc.moveDown(0.3);

  gaSection(doc, "14.0 TIER ESCALATION");
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    `If the project's screened SOV share fails the ≤50% gate after the selected TDM Strategies Matrix is applied, OR if the dwelling-unit count exceeds 175 DU during design refinement, regenerate this report as a Tier 3 TDM Study + Plan (the existing renderTisIllinois Full template). The screened project size of ${tg.size ?? "—"} ${tg.unit ?? ""} falls within the Tier 2 band (residential 51–175 DU).`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
}

/**
 * Land-use-aware average trip length for VMT estimation.
 * Conservative blended values from NHTS/ARC regional travel-survey
 * literature for the Atlanta MSA. Used only where the engine has no
 * project-specific trip-length distribution. Surfaced explicitly in
 * §11.2 so a reviewer can substitute a model-derived value during
 * the methodology meeting.
 */
function gaAvgTripLengthMi(code: string): number {
  if (code.startsWith("21") || code.startsWith("22") || code.startsWith("23")) return 9;
  if (code === "310" || code === "311" || code === "320" || code === "330") return 7;
  if (code.startsWith("71") || code.startsWith("75") || code.startsWith("77")) return 10;
  if (code.startsWith("82") || code.startsWith("85") || code.startsWith("86") || code.startsWith("87") || code.startsWith("88")) return 5;
  if (code.startsWith("11") || code.startsWith("13") || code.startsWith("14") || code.startsWith("15")) return 12;
  return 8;
}

/**
 * §11–§13 of a GA DRI submittal. Each subsection auto-computes from
 * the engine output where possible (VMT from external trip × avg trip
 * length; ARC AQ rubric items keyed off pass-by / internal-capture /
 * auto-mode-share) and flags everything else as a named data-source
 * requirement (Census ACS overlay, MARTA station proximity, TMA
 * designation, infrastructure adequacy). No fabricated demographics,
 * no fabricated compliance findings.
 */
function renderTisGeorgiaDriSections(
  doc: PDFKit.PDFDocument,
  r: any,
  _project: StoredProject,
  region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];
  const luCode = String(tg.landUseCode ?? "");
  const luName = String(tg.landUseName ?? "");
  const passByPct = Number(r.passByPctApplied ?? 0);
  const intCapPct = Number(r.internalCapturePctApplied ?? 0);
  const autoModeShare = getAutoModeShare(region.code);
  const altModeReductionPct = Math.round((1 - autoModeShare) * 100);

  // ---- §11 Non-Expedited Criteria ---------------------------------------
  gaSection(doc, "11.0 NON-EXPEDITED REVIEW CRITERIA");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Per GA DCA Chapter 110-12-3, DRI submittals must address the eight non-expedited review criteria below. Items marked as auto-computed reflect the engine's deterministic outputs from this analysis; items flagged for verification require coordination with GRTA, ARC, MARTA, GDOT, and the local jurisdiction during the pre-application methodology meeting.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "11.1 Quality, Character, Convenience, and Flexibility of Transportation Options");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Evaluation of transportation options serving the proposed development site requires inventory of: (a) existing and ARC RTP-programmed bicycle and pedestrian facilities within the AOI; (b) MARTA bus and rail service frequency, span, and stop locations within 1/2 mile of the site; (c) GRTA Xpress and regional commuter-coach service to/from the site; and (d) first/last-mile connections between the site and the nearest fixed-route transit. This inventory should be confirmed against current GDOT, ARC, MARTA, and local-agency GIS layers — required for DRI submittal, not auto-generated.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "11.2 Vehicle Miles Traveled");
  const avgTripLen = gaAvgTripLengthMi(luCode);
  const dailyPeriod = periods.find((p) => String(p.period ?? p.periodLabel ?? "").toLowerCase().includes("daily")) ?? null;
  const dailyRaw = Number(dailyPeriod?.tripGeneration?.rawTrips ?? tg.dailyTrips ?? 0);
  const dailyPassBy = Number(dailyPeriod?.tripGeneration?.passByCredit ?? (dailyRaw * passByPct / 100));
  const dailyIntCap = Number(dailyPeriod?.tripGeneration?.internalCaptureCredit ?? ((dailyRaw - dailyPassBy) * intCapPct / 100));
  const dailyExternalAllModes = Math.max(0, dailyRaw - dailyPassBy - dailyIntCap);
  const dailyExternalAuto = dailyExternalAllModes * autoModeShare;
  const grossVmt = dailyRaw * avgTripLen;
  const netVmt = dailyExternalAuto * avgTripLen;
  doc.font("body").fontSize(10).fillColor("black").text(
    `Daily VMT is estimated as the product of net external auto-mode trips and an assumed average trip length of ${avgTripLen.toFixed(0)} miles for ITE land use ${luCode} (${luName}). This trip-length assumption is conservative and reflects Atlanta-region NHTS/ARC regional-travel-survey literature for the land-use category; the formal DRI submittal should substitute a project-specific value from the ARC Activity-Based Model where available.`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["VMT reduction component", "Value", "Daily trips", "Daily VMT (mi)"],
    widths: [220, 80, 80, 100],
    align: ["left", "right", "right", "right"],
    rows: [
      ["Gross trip generation", "—", fmtNum(dailyRaw), fmtNum(grossVmt)],
      ["Pass-by capture", `${fmtNum(passByPct, 0)}%`, `−${fmtNum(dailyPassBy)}`, `−${fmtNum(dailyPassBy * avgTripLen)}`],
      ["Internal capture (mixed-use)", `${fmtNum(intCapPct, 0)}%`, `−${fmtNum(dailyIntCap)}`, `−${fmtNum(dailyIntCap * avgTripLen)}`],
      ["Alternative-mode share (non-auto)", `${fmtNum(altModeReductionPct, 0)}%`, `−${fmtNum(dailyExternalAllModes - dailyExternalAuto)}`, `−${fmtNum((dailyExternalAllModes - dailyExternalAuto) * avgTripLen)}`],
      ["Net new auto trips and VMT", "—", fmtNum(dailyExternalAuto), fmtNum(netVmt)],
    ],
  });
  doc.moveDown(0.3);
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    `Reduction sources: pass-by per ITE Trip Generation Handbook; internal capture per ULI Mixed-Use Internal Capture defaults; alternative-mode share from ACS B08301 for ${region.displayName} (${(autoModeShare * 100).toFixed(0)}% auto). Assumed average trip length is a screening input — not a calibrated AOI-specific value.`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "11.3 Relationship Between Location of Proposed DRI and Regional Mobility");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The proposed development is located within ${region.displayName}. Connections to the regional mobility network — including the Interstate system, GDOT principal arterials, MARTA heavy-rail corridors, and GRTA Xpress park-and-ride facilities — should be enumerated in the DRI submittal based on direct distance and travel time from the site. This screening analysis does not auto-detect specific interstate corridor proximity; that determination requires manual GIS review against the GDOT functional classification layer and is required for DRI submittal.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "11.4 Relationship Between Proposed DRI and Existing or Planned Transit Facilities");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Required for DRI submittal: inventory of MARTA heavy-rail stations, MARTA bus routes (with peak headways), GRTA Xpress routes, and any ARC RTP-programmed transit expansion projects with right-of-way intersecting the AOI. Walk-shed analysis (1/4 mile and 1/2 mile) to fixed-route transit stops should be presented as a map exhibit. Not auto-generated — requires MARTA GTFS overlay and pre-application coordination with MARTA Planning.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "11.5 Transportation Management Area Designation");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Required for DRI submittal: identification of any Transportation Management Association (TMA) with service area covering the project site (e.g., Midtown Transportation, Buckhead REdeux, Perimeter Connects, Cumberland Community Improvement District). TMA membership and trip-reduction program participation should be documented, including any TMA-administered Guaranteed Ride Home, vanpool, or transit-pass-subsidy programs the development will participate in. Not auto-generated — requires lookup against the current ARC TMA service-area map and applicant-side membership confirmation.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "11.6 Offsite Trip Reduction and Trip Reduction Techniques");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Offsite trip reduction credits applied in this analysis are summarized below. Additional Trip Reduction Program (TRP) measures — including transit subsidies, vanpool/carpool incentives, telework programs, parking cash-out, and bicycle facilities — should be enumerated in the DRI submittal as commitments that further reduce vehicle trip generation beyond the screening-level reductions shown here.",
    { paragraphGap: 6 },
  );
  rows(doc, [
    ["Pass-by capture (PM peak)", `${fmtNum(passByPct, 0)}%`],
    ["Internal capture (mixed-use)", `${fmtNum(intCapPct, 0)}%`],
    ["Alternative-mode share (non-auto)", `${fmtNum(altModeReductionPct, 0)}% of external trips arrive by transit, walking, or cycling`],
    ["Applicant TRP commitments", "To be enumerated in DRI submittal (transit subsidy, vanpool, telework, parking cash-out, bike infrastructure)"],
  ]);
  doc.moveDown(0.5);

  gaSubsection(doc, "11.7 Balance of Land Uses — Jobs/Housing Balance");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "The jobs/housing balance analysis within the AOI is presented in §12 Area of Influence. ARC's review criterion typically targets a jobs-to-housing ratio between 1.3 and 1.7 for activity centers; values outside that range suggest the AOI is either employment-heavy (commuter-trip generating) or housing-heavy (out-commute generating). Refer to §12 for the AOI tabulation and required Census ACS overlay.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "11.8 Relationship Between Proposed DRI and Existing Development and Infrastructure");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Infrastructure adequacy is project-specific and depends on the site's utility connections (water/sewer/stormwater capacity), surrounding development pattern, and the local jurisdiction's capital improvement program. The DRI submittal should document: water/sewer service availability and capacity letters from the serving utility; stormwater management approach consistent with the GA Stormwater Management Manual; and consistency with the local jurisdiction's adopted Service Delivery Strategy. Not auto-generated — requires applicant-side utility coordination.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // ---- §12 Area of Influence --------------------------------------------
  gaSection(doc, "12.0 AREA OF INFLUENCE");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The Area of Influence (AOI) for this DRI is defined as the area within a 6-mile radius of the project site, consistent with GRTA's standard AOI definition for DRI review. The AOI is centered on the proposed development located in ${region.displayName} and includes all Census block groups whose centroids fall within the 6-mile buffer.`,
    { paragraphGap: 6 },
  );

  doc.font("bold").fontSize(11).fillColor("black").text("Required AOI demographic overlay");
  doc.moveDown(0.3);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Per GRTA DRI submittal guidance, the AOI characterization requires the following American Community Survey 5-Year Estimate tables aggregated to block-group geography and clipped to the 6-mile buffer. This screening analysis does not auto-generate the Census overlay — the tables below identify the data sources the DRI consultant must compile for the formal submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  table(doc, {
    headers: ["ACS Table", "Subject", "AOI tabulation required"],
    widths: [80, 200, 200],
    align: ["left", "left", "left"],
    rows: [
      ["B01003", "Total population", "Population within 6-mi AOI; growth 2010–2020"],
      ["B25001", "Housing units", "Total dwelling units within AOI; vacancy rate"],
      ["B25075", "Owner-occupied home value", "Median value; distribution by price bin"],
      ["B25064", "Median gross rent", "Median rent; rent-to-income ratio"],
      ["B19013", "Median household income", "Median household income within AOI"],
      ["B23025", "Employment status", "Labor force; employed civilian population"],
      ["C24050", "Industry of employed pop.", "Employment by NAICS sector — jobs side of jobs/housing"],
      ["B08301", "Means of transportation to work", "Drive-alone, carpool, transit, walk, bike, work-from-home mode shares"],
      ["B08303", "Travel time to work", "Mean commute time; distribution"],
      ["LEHD LODES WAC", "Workplace area characteristics", "Jobs by NAICS sector at block-group resolution (jobs side)"],
      ["LEHD LODES RAC", "Residence area characteristics", "Resident workers by industry (housing side)"],
    ],
  });
  doc.moveDown(0.5);

  doc.font("bold").fontSize(11).fillColor("black").text("Required AOI analysis exhibits");
  doc.moveDown(0.3);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "The DRI submittal must include the following analysis derived from the data sources above. None are auto-computed at this stage.",
    { paragraphGap: 6 },
  );
  rows(doc, [
    ["Population by Census tract", "Map exhibit + tabulation — required"],
    ["Housing units by tract + tenure", "Owner/renter split; required"],
    ["Employment by NAICS sector (LEHD WAC)", "Required — jobs side of balance"],
    ["Jobs/housing balance ratio", "Required — ARC target 1.3–1.7 for activity centers"],
    ["Median household income vs. median home value/rent", "Salary-to-housing affordability comparison — required"],
    ["Mode share to work (ACS B08301)", "Required — compares AOI to regional average"],
    ["Existing land use within AOI", "Map exhibit — required, sourced from local jurisdiction"],
  ]);
  doc.moveDown(0.3);
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Note: this screening tool does not fabricate AOI demographics. The DRI consultant must compile the above from the named sources prior to submittal. Reference: O.C.G.A. § 50-8-7.1 review criteria + GRTA DRI Review Procedures.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // ---- §13 ARC Air Quality Benchmark ------------------------------------
  gaSection(doc, "13.0 ARC AIR QUALITY BENCHMARK");
  doc.font("body").fontSize(10).fillColor("black").text(
    "The Atlanta Regional Commission Air Quality Benchmark evaluates a DRI's VMT-reduction performance against a scoring rubric of land-use, transit, and trip-reduction credits. Eligibility for each rubric item is determined below; items marked 'Requires verification' depend on AOI-specific GIS data (transit-station proximity, sidewalk network, TMA service area) that this screening tool does not auto-detect.",
    { paragraphGap: 6 },
  );
  doc.moveDown(0.3);

  const luIsMixedUseCandidate = luCode.startsWith("23") || luCode === "240" || luCode.startsWith("21") || luCode.startsWith("22");
  const internalCaptureCredit = intCapPct > 0;
  const passByCredit = passByPct > 0;
  const altModeCredit = altModeReductionPct > 0;
  const autoComputedReductionPct = passByPct + intCapPct + altModeReductionPct;

  table(doc, {
    headers: ["Rubric item", "Status", "Notes"],
    widths: [200, 130, 170],
    align: ["left", "center", "left"],
    rows: [
      [
        "Mixed-use development bonus",
        luIsMixedUseCandidate ? "Requires verification" : "Not eligible",
        luIsMixedUseCandidate
          ? "Single land use coded; mixed-use status requires site-plan confirmation"
          : "ITE land use does not indicate mixed-use programming",
      ],
      [
        "Internal capture credit (mixed-use)",
        internalCaptureCredit ? "Eligible — auto-computed" : "Not claimed",
        internalCaptureCredit ? `${fmtNum(intCapPct, 0)}% credit applied per ULI defaults` : "No internal-capture credit applied",
      ],
      [
        "Pass-by trip credit",
        passByCredit ? "Eligible — auto-computed" : "Not claimed",
        passByCredit ? `${fmtNum(passByPct, 0)}% credit applied per ITE Pass-By Handbook` : "No pass-by credit applied",
      ],
      [
        "Alternative-mode share (transit/walk/bike)",
        altModeCredit ? "Eligible — auto-computed" : "Not eligible",
        altModeCredit
          ? `${fmtNum(altModeReductionPct, 0)}% non-auto per ACS B08301 (${region.displayName})`
          : "Region defaults to ≥95% auto mode",
      ],
      [
        "Transit-station proximity (≤ 1/2 mi to MARTA rail)",
        "Requires verification",
        "Distance to nearest MARTA heavy-rail station — manual GIS check required",
      ],
      [
        "Bus-stop proximity (≤ 1/4 mi to MARTA bus)",
        "Requires verification",
        "Distance to nearest MARTA bus stop — manual GIS check required",
      ],
      [
        "Continuous pedestrian network",
        "Requires verification",
        "Sidewalk and crossing inventory within 1/2 mi of site — local agency data",
      ],
      [
        "Bicycle infrastructure (lane/path/shared-use)",
        "Requires verification",
        "Bike-facility inventory within AOI — ARC RTP + local agency data",
      ],
      [
        "TMA membership / TRP commitment",
        "Requires verification",
        "TMA service-area lookup + applicant commitment letter required",
      ],
      [
        "Park-and-ride / GRTA Xpress access",
        "Requires verification",
        "Distance to nearest park-and-ride lot — GRTA facility map",
      ],
      [
        "Auto-computed VMT reduction (from §11.2)",
        `${fmtNum(autoComputedReductionPct, 0)}%`,
        "Sum of pass-by + internal capture + non-auto mode share",
      ],
    ],
  });
  doc.moveDown(0.3);
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Notes: The auto-computed VMT reduction reflects only credits supported by engine data. Verification-required rubric items would add to this figure once confirmed during the methodology meeting with GRTA, ARC, MARTA, and the local jurisdiction. The final ARC Air Quality Benchmark score for DRI submittal is determined by ARC review staff and is not produced by this screening tool.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
}


type FloridaJurisdictionKey =
  | "miami_dade"
  | "broward"
  | "palm_beach"
  | "hillsborough"
  | "orange"
  | "duval"
  | "district_default";

type FloridaJurisdiction = {
  key: FloridaJurisdictionKey;
  name: string;
  fdotDistrict: string;
  framework: string;
  frameworkDoc: string;
  losStandardNote: string;
  tripThreshold: string;
  horizonConvention: string;
  studyAreaNote?: string;
  mpoName?: string;
  preStudyMeetingRequired: boolean;
  methodologyLetterAppendix: "A" | "C";
  certificationFrontMatter: boolean;
  threeTrackEndChapters: boolean;
  feeMethodologyNote?: string;
  extraNote?: string;
};

/**
 * Resolve the controlling Florida jurisdiction for a site by lat/lon.
 * Uses rough county / metro bounding boxes — adequate for prose
 * adaptation (which framework, which LOS standard, which thresholds,
 * which methodology-meeting convention), not authoritative for parcel
 * lookup. Returns a statewide `district_default` for any FL coordinate
 * outside the six named major jurisdictions; the default surfaces only
 * MTSIH 2024 + statewide Procedure 525-000-006 conventions.
 *
 * Boxes ordered south-to-north along the Atlantic coast (Miami-Dade →
 * Broward → Palm Beach) with non-overlapping latitude bands to keep
 * dispatch deterministic; Gulf-coast (Hillsborough) and central-state
 * (Orange, Duval) follow.
 */
function floridaJurisdiction(lat: number, lon: number): FloridaJurisdiction {
  const inBox = (latMin: number, latMax: number, lonMin: number, lonMax: number) =>
    lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;

  if (inBox(25.13, 25.97, -80.87, -80.12)) {
    return {
      key: "miami_dade",
      name: "Miami-Dade County",
      fdotDistrict: "FDOT District 6 (Miami)",
      framework: "Concurrency retained + Chapter 33E multimodal mobility impact fee",
      frameworkDoc: "CDMP + Administrative Order 4-85 + Code Ch. 33-G (concurrency) + Ch. 33E (mobility fee)",
      losStandardNote: "Per the Miami-Dade Comprehensive Development Master Plan (CDMP) Transportation Element; SHS LOS D urbanized per FDOT Procedure 525-000-006 applies on State Highway System frontage",
      tripThreshold: "Per Code Ch. 33-G concurrency procedures (Admin. Order 4-85); all concurrency-relevant trips reviewed",
      horizonConvention: "Per CDMP review; large CDMP applications typically use Existing + short-term build (e.g., 2020) + long-term build (e.g., 2040)",
      mpoName: "Miami-Dade TPO",
      preStudyMeetingRequired: true,
      methodologyLetterAppendix: "C",
      certificationFrontMatter: true,
      threeTrackEndChapters: true,
      extraNote: "Miami-Dade conventions observed in published CDMP-amendment exemplars: Engineer's Certification page as the first section (before Executive Summary); Methodology Letter placed at Appendix C (not the canonical Appendix A); the report closes with three parallel-track end-chapters numbered 1.0–3.0 each (Concurrency Analysis / CDMP Analysis / Zoning Analysis). The renderer surfaces those conventions as required structure for a Miami-Dade submittal but does not auto-generate the three-track parallel content.",
    };
  }
  if (inBox(25.97, 26.32, -80.85, -80.05)) {
    return {
      key: "broward",
      name: "Broward County",
      fdotDistrict: "FDOT District 4 (Fort Lauderdale)",
      framework: "10-district concurrency (2 standard roadway + 8 Transit-Oriented Concurrency Districts)",
      frameworkDoc: "Broward County Transportation Concurrency System Guide + Broward Comprehensive Plan Transportation Element + per-Concurrency-District adequacy standards",
      losStandardNote: "Per Broward County Comprehensive Plan + per-Concurrency-District adequacy standards (the Broward Trafficways Plan is a right-of-way preservation plan, NOT an LOS-threshold table)",
      tripThreshold: "Per Comprehensive Plan + per-Concurrency-District adequacy standards",
      horizonConvention: "Per Broward Comprehensive Plan + per-Concurrency-District adequacy standards",
      mpoName: "Broward MPO",
      preStudyMeetingRequired: true,
      methodologyLetterAppendix: "A",
      certificationFrontMatter: false,
      threeTrackEndChapters: false,
      feeMethodologyNote: "Within the 8 Transit-Oriented Concurrency Districts the concurrency assessment is a per-peak-hour-trip dollar contribution funding Transit Development Plan enhancements, assessed pre-building-permit; within the 2 standard (NW / SW) Concurrency Districts adequacy is determined by link-level v/c against adopted LOS. LOS standard and fee-per-PHT vary per Concurrency District and must be confirmed against the current adopted schedule.",
      extraNote: "MPO note: Broward MPO publishes no developer-facing TIS guidance; rules dominate at the County level.",
    };
  }
  if (inBox(26.32, 27.00, -80.88, -79.97)) {
    return {
      key: "palm_beach",
      name: "Palm Beach County",
      fdotDistrict: "FDOT District 4 (Fort Lauderdale)",
      framework: "Concurrency (no countywide mobility fee)",
      frameworkDoc: "Palm Beach County ULDC Article 12 — Traffic Performance Standards (TPS)",
      losStandardNote: "LOS D on arterials per ULDC Table 12.B.2.C (triple table: link service volumes / intersection thresholds / speed thresholds); SHS LOS D urbanized per FDOT Procedure 525-000-006 applies on State Highway System frontage",
      tripThreshold: "≤ 20 gross peak-hour trips generally exempt from full TIA; Test 1 / Test 2 significance methodology determines full TIA scope",
      horizonConvention: "Buildout year + 5 years (Test 2 Five-Year) PLUS Long-Range horizon (e.g., 2045) — exceeds MTSIH default; both must be labeled explicitly",
      mpoName: "Palm Beach TPA",
      preStudyMeetingRequired: true,
      methodologyLetterAppendix: "A",
      certificationFrontMatter: false,
      threeTrackEndChapters: false,
      extraNote: "Palm Beach review type drives section structure: a full ULDC Art. 12 TPS report uses named \"Test 1\" + \"Test 2\" subsections at site-plan stage; an FLUA (Future Land Use Atlas) amendment uses a deliberately thin 6-section variant (Project Description / Current FLU / Proposed FLU / Traffic Impact / Traffic Analysis [5.1 Test 2 + 5.2 Long Range] / Conclusion). The renderer's default 1.0–13.0 structure should be substituted with the applicable PBC variant at submittal time.",
    };
  }
  if (inBox(27.57, 28.18, -82.74, -82.05)) {
    return {
      key: "hillsborough",
      name: "Hillsborough County (Tampa)",
      fdotDistrict: "FDOT District 7 (Tampa)",
      framework: "Mobility fee (replaced roadway impact fee in 2016)",
      frameworkDoc: "Hillsborough County Mobility Fee Ordinance + Mobility Fee Schedule (last full study 2020; update study begun early 2025) — methodology uses ITE 10th Ed. (2017) blended with the Florida Trip Characteristics Studies Database (Tindale Oliver / Stantec proprietary corpus; not an FDOT public asset).",
      losStandardNote: "Mobility-fee jurisdiction — no vehicle LOS pass/fail; SHS LOS D urbanized per FDOT Procedure 525-000-006 applies on State Highway System frontage for connection-permit review",
      tripThreshold: "Per Land Development Code; mobility fee assessed at building permit",
      horizonConvention: "Per Land Development Code; mobility fee applies at permit (no horizon-year LOS test)",
      mpoName: "Plan Hillsborough (Hillsborough TPO)",
      preStudyMeetingRequired: false,
      methodologyLetterAppendix: "A",
      certificationFrontMatter: false,
      threeTrackEndChapters: false,
      feeMethodologyNote: "The Hillsborough mobility fee schedule blends ITE 10th Edition (2017) rates with the Florida Trip Characteristics Studies Database — a PROPRIETARY Tindale Oliver / Stantec corpus, NOT an FDOT public asset (no public URL, no API). Vehicle occupancy 1.40 persons/vehicle per Tampa Bay Regional Planning Model. ITE is on 11th Ed. for FDOT-wide MTIA work; the Hillsborough fee schedule has not yet migrated.",
      extraNote: "Trip generation for the mobility-fee calculation should be prepared in parallel using the published Hillsborough fee schedule; the trip generation reported in this analysis follows ITE 11th Edition per MTSIH 2024 §3.5.",
    };
  }
  if (inBox(28.34, 28.78, -81.66, -80.87)) {
    return {
      key: "orange",
      name: "Orange County (Orlando)",
      fdotDistrict: "FDOT District 5 (DeLand)",
      framework: "Concurrency + STAMP overlay (Specific Transportation Analysis Methodology Plan)",
      frameworkDoc: "Orange County STAMP — adopted via Ordinance 2023-11, effective 2024-02-27; layered on existing Orange County concurrency",
      losStandardNote: "Per Orange County Comprehensive Plan; SHS LOS D urbanized per FDOT Procedure 525-000-006 applies on State Highway System frontage",
      tripThreshold: "> 5 net peak-hour trips → TIA required; > 50 net PM peak-hour trips → operational intersection analysis required",
      horizonConvention: "Per STAMP / Orange County Comprehensive Plan; opening year canonical per MTSIH 2024",
      studyAreaNote: "Per STAMP, the study area extends up to 2.5 miles from the site (broader than the MTSIH default)",
      mpoName: "MetroPlan Orlando",
      preStudyMeetingRequired: true,
      methodologyLetterAppendix: "A",
      certificationFrontMatter: false,
      threeTrackEndChapters: false,
      extraNote: "STAMP defines standardized county-specific pass-by reductions by land use; renderer-applied pass-by should be reconciled against the STAMP table at submittal time.",
    };
  }
  if (inBox(30.10, 30.60, -82.05, -81.30)) {
    return {
      key: "duval",
      name: "Duval County / City of Jacksonville",
      fdotDistrict: "FDOT District 2 (Lake City)",
      framework: "Mobility fee (replaced roadway concurrency)",
      frameworkDoc: "City of Jacksonville Ordinance Code Chapter 655 (Concurrency and Mobility Management System; Part 5 = Mobility Fee, §§ 655.503, .506, .507) + Land Development Procedures Manual (LDPM) Vol. 1 (effective 2026-01-30)",
      losStandardNote: "Mobility-fee jurisdiction — no vehicle LOS pass/fail; SHS LOS D urbanized per FDOT Procedure 525-000-006 applies on State Highway System frontage for connection-permit review",
      tripThreshold: "Per Land Development Procedures Manual (LDPM) Vol. 1 (effective 2026-01-30)",
      horizonConvention: "Per LDPM Vol. 1; mobility fee applies at permit",
      mpoName: "North Florida TPO",
      preStudyMeetingRequired: true,
      methodologyLetterAppendix: "A",
      certificationFrontMatter: false,
      threeTrackEndChapters: false,
      extraNote: "Jacksonville requires a Traffic Methodology Meeting with the City Traffic Engineer and the Chief of Transportation Planning BEFORE any TIS is accepted — the methodology meeting is a hard prerequisite, not an option. The Concurrency and Mobility Management System Office (CMMSO) was established in 1991 and is the controlling review body.",
    };
  }
  return {
    key: "district_default",
    name: "Florida (statewide default — no major-jurisdiction overlay)",
    fdotDistrict: "FDOT District (confirm against the FDOT districts map at https://www.fdot.gov/agencyresources/districts.shtm)",
    framework: "Per controlling local government; MTSIH 2024 default if no local TIS procedure",
    frameworkDoc: "MTSIH 2024 + statewide Procedure 525-000-006",
    losStandardNote: "SHS LOS D in urbanized areas and LOS C outside urbanized areas per FDOT Procedure 525-000-006",
    tripThreshold: "Driveway Category C–G (> 600 vpd including pass-by) triggers pre-application meeting + traffic study per MTSIH 2024 §3.2 / Appendix A",
    horizonConvention: "Per MTSIH 2024 §4.3: Existing + Future Background + Future Build + Future Build with Mitigation; opening year canonical",
    preStudyMeetingRequired: false,
    methodologyLetterAppendix: "A",
    certificationFrontMatter: false,
    threeTrackEndChapters: false,
    extraNote: "No FDOT district publishes a TIS supplement to MTSIH 2024; district-level practice is administered through pre-application meetings and methodology letters, not published handbooks.",
  };
}

/**
 * Florida-specific TIS renderer. Follows the section structure and
 * citation conventions FDOT and Florida-district reviewers expect on a
 * Florida Multimodal Transportation Impact Assessment (MTIA — FDOT's
 * current term, used interchangeably with TIA/SIA/TIS), per the FDOT
 * Multimodal Transportation Site Impact Handbook (MTSIH) March 25 2024,
 * the FDOT Quality/Level of Service Handbook v6.0 (Aug 2025), and FDOT
 * Procedure 525-000-006 (SHS LOS standards).
 *
 * Key conventions that differ from the generic / Georgia renderer:
 *   - SHS LOS standard is D in urbanized areas and C outside urbanized
 *     areas per Procedure 525-000-006 (not a blanket LOS D).
 *   - "MTIA" / "Multimodal Transportation Impact Assessment" is the
 *     FDOT-preferred term; multimodal scope is reflected throughout.
 *   - Connection / access work cites Rule 14-96 F.A.C. (Connection
 *     Permits) and Rule 14-97 F.A.C. (Access Classification).
 *   - Geometric / driveway design cites the FDOT Design Manual (FDM),
 *     not the superseded Plans Preparation Manual.
 *   - Committed-projects review uses the FDOT Five-Year Work Program,
 *     not GA TIP/STIP.
 *   - DRI is curtailed post-2015 HB 7065; the renderer does not assume
 *     DRI review and instead frames the deliverable around local
 *     concurrency / comp plan amendments / FDOT connection permits.
 *   - Approved software per FDOT TAH §4.1 (HCS, Synchro, SIDRA, CORSIM,
 *     Vissim) — Vistro is explicitly NOT in the FDOT inventory.
 *
 * Sections deferred (data the engine doesn't yet produce, or inputs
 * unique to a specific district / county) are surfaced as placeholder
 * prose naming what the section requires for formal submittal — never
 * fabricated values.
 */
function renderTisFlorida(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const periods: any[] = Array.isArray(r.periodReports) ? r.periodReports : [];

  const lat = Number(project.siteLat ?? req.latitude ?? NaN);
  const lon = Number(project.siteLon ?? req.longitude ?? NaN);
  const jur = Number.isFinite(lat) && Number.isFinite(lon)
    ? floridaJurisdiction(lat, lon)
    : floridaJurisdiction(27.7663, -82.6404);

  // --- 1.0 Executive Summary --------------------------------------------
  gaSection(doc, "1.0 EXECUTIVE SUMMARY");
  doc.font("body").fontSize(10).fillColor("black");
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  const summary = `This Multimodal Transportation Impact Assessment (MTIA) evaluates the anticipated transportation impacts of the proposed ${project.projectName || "development"} located within ${region.displayName}, Florida. The host controlling jurisdiction is ${jur.name} (${jur.fdotDistrict}); review framework: ${jur.framework}. Analysis follows the FDOT Multimodal Transportation Site Impact Handbook (MTSIH, March 25, 2024) and the FDOT Quality/Level of Service Handbook v6.0 (August 2025). Capacity analysis follows the Highway Capacity Manual 6th Edition consistent with FDOT Traffic Analysis Handbook §4.1. The study covers ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile study area for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}) at a development size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`;
  doc.text(summary, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text("Findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (losDrops === 0 && losEf === 0) {
    doc.text("• No intersections within the study network are projected to drop a Level of Service grade under Build conditions.", { paragraphGap: 2 });
    doc.text("• No mitigation is required to maintain the FDOT State Highway System LOS standard within the study area.", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} intersection${losDrops === 1 ? "" : "s"} project to drop one or more LOS grade${losDrops === 1 ? "" : "s"} under Build conditions.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} intersection${losEf === 1 ? "" : "s"} operate at LOS E or F under Build conditions; mitigation per MTSIH 2024 §5 should be evaluated.`, { paragraphGap: 4 });
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

  // --- 2.0 Project Description ------------------------------------------
  gaSection(doc, "2.0 PROJECT DESCRIPTION");
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Region", region.displayName],
    ["Host jurisdiction", jur.name],
    ["FDOT District", jur.fdotDistrict],
    ["Review framework", jur.framework],
    ["Controlling document(s)", jur.frameworkDoc],
    ["Regional MPO / TPO", jur.mpoName ?? "Per controlling local government"],
    ["Opening year", String(req.openingYear ?? "—")],
  ]);
  doc.moveDown(0.3);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Surrounding land use, site plan figures, and detailed land-use description are dependent on the final site plan and are not produced by this screening tool. Final submittal should incorporate site plan figures and a written project description per MTSIH 2024.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  if (jur.certificationFrontMatter) {
    doc.moveDown(0.2);
    doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(
      `STRUCTURE NOTE — ${jur.name.toUpperCase()} CONVENTION`,
      { paragraphGap: 2 },
    );
    doc.font("body").fontSize(10).fillColor("black").text(
      `Miami-Dade CDMP-amendment submittals conventionally place the Engineer's Certification page as the FIRST section of the report (before the Executive Summary), and place the Methodology Letter at Appendix ${jur.methodologyLetterAppendix} rather than the canonical Appendix A. Confirm the Engineer of Record's seal and the Methodology Letter placement against the most recent submittal expectations before delivering.`,
      { paragraphGap: 4 },
    );
    if (jur.threeTrackEndChapters) {
      doc.font("body").fontSize(10).fillColor("black").text(
        "Miami-Dade large-CDMP reports additionally conclude with three parallel-track end-chapters (Concurrency Analysis / CDMP Analysis / Zoning Analysis, each independently numbered 1.0–3.0). This screening tool does not auto-generate the three-track parallel content; sections 12.0 below identifies the inputs required.",
        { paragraphGap: 6 },
      );
    }
    doc.fillColor("black");
  } else if (jur.key === "palm_beach") {
    doc.moveDown(0.2);
    doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(
      "STRUCTURE NOTE — PALM BEACH COUNTY CONVENTION",
      { paragraphGap: 2 },
    );
    doc.font("body").fontSize(10).fillColor("black").text(
      "Palm Beach review type determines structure. A full ULDC Article 12 TPS report uses named \"Test 1\" + \"Test 2\" subsections at site-plan stage; a Future Land Use Atlas (FLUA) amendment uses a deliberately thinner 6-section variant (Project Description / Current FLU / Proposed FLU / Traffic Impact / Traffic Analysis [5.1 Test 2 + 5.2 Long Range] / Conclusion). The 1.0–13.0 structure used by this renderer is the MTSIH-aligned default; substitute the applicable Palm Beach variant at submittal time.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 3.0 Methodology --------------------------------------------------
  gaSection(doc, "3.0 METHODOLOGY");
  {
    const appendixLetter = jur.methodologyLetterAppendix;
    const meetingClause = jur.preStudyMeetingRequired
      ? `For ${jur.name} the pre-application methodology meeting is a hard prerequisite under the controlling local procedure (not an option); the meeting must occur and the methodology letter must be on file with the reviewing agency before this analysis can be accepted for review.`
      : "Per MTSIH 2024 §4.3, the pre-application methodology meeting establishes scope.";
    doc.font("body").fontSize(10).fillColor("black").text(
      `Per MTSIH 2024 §4.3, methodology and scope are established through a pre-application methodology meeting with the controlling FDOT District, county, and applicable MPO/TPO. ${meetingClause} The methodology letter or meeting minutes must be included as Appendix ${appendixLetter} of the formal submittal${appendixLetter === "C" ? " (Miami-Dade observed convention; canonical Florida default is Appendix A)" : ""}.`,
      { paragraphGap: 6 },
    );
    if (jur.key === "duval") {
      doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
        "Jacksonville-specific: the Traffic Methodology Meeting must be coordinated with the City Traffic Engineer and the Chief of Transportation Planning per the Land Development Procedures Manual (LDPM) Vol. 1 effective 2026-01-30. The Concurrency and Mobility Management System Office (CMMSO, established 1991) is the controlling review body.",
        { paragraphGap: 6 },
      );
      doc.fillColor("black");
    }
  }

  gaSubsection(doc, "3.1 Controlling Guidance");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Primary references: FDOT Multimodal Transportation Site Impact Handbook (MTSIH), March 25, 2024; FDOT Multimodal Transportation Site Impact Applications Guide, June 5, 2024; FDOT Quality/Level of Service Handbook v6.0, August 2025; FDOT Procedure 525-000-006 (Level of Service Standards and Highway Capacity Analysis for the State Highway System); FDOT Procedure 525-030-120 (project traffic forecasting); FDOT Traffic Analysis Handbook (TAH), October 2025.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "3.2 Analysis Software");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per FDOT TAH §4.1, approved analysis tools are HCS, Synchro / SimTraffic, SIDRA INTERSECTION (roundabouts), CORSIM, and Vissim. This screening analysis applies the HCM 6th Edition signalized-intersection model consistent with HCS output formatting. Vistro is not included in the FDOT TAH tool inventory; formal submittal output should be prepared in HCS or Synchro.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "3.3 Traffic Data Collection");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per MTSIH 2024, roadway-segment counts should be 72 consecutive hours (Monday afternoon through Friday morning) in urbanized, transitioning, and urban area classes, and 7 days in rural areas, in 15-minute increments on typical weekdays excluding holiday weeks. The default analysis peak per MTSIH 2024 §2.3.1 is the Weekday PM Peak Hour of Adjacent Street Traffic (one hour between 4–6 PM); MTSIH 2024 imposes no blanket Saturday-peak requirement for retail or restaurant land uses — midday, Saturday, or other special peaks are added only where site characteristics warrant (the Applications Guide fast-food case study analyzes AM + PM + midday). For turning-movement counts, MTSIH 2024 Appendix A (p. A-3) requires AM and PM TMCs covering trucks, pedestrians, and bicycles but does not prescribe duration or bin size; both are agreed at the pre-application methodology meeting. The Applications Guide Case Study 2 (§3.4.3) uses 8-hour TMCs (3 hr AM + 2 hr midday + 3 hr PM) as a worked example, while 2-hr AM and 2-hr PM in 15-minute bins is common Florida practice.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "3.4 Time Horizons");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per MTSIH 2024 §4.3, minimum analysis years are: Existing, Future Background (No-Build), Future Build, and Future Build with Mitigation. Opening year is canonical; there is no fixed +5 horizon for concurrency or connection-permit work. Each year must be explicitly labeled. For a Comprehensive Plan Amendment (CPA) review, the analysis must include Existing, short-term (5-year), and long-term (10-year minimum) horizons. ${jur.name} convention: ${jur.horizonConvention}. This analysis evaluates Existing (current-year), No-Build (opening year ${req.openingYear ?? "—"}), and Build (opening year ${req.openingYear ?? "—"}) scenarios.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "3.5 Growth Rate");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per FDOT TAH §2.7, demand projections should use the adopted regional MPO/TPO travel-demand model (TDM); where TDM use is not warranted, historical AADT trend growth from Florida Traffic Online (FTO) is the FDOT-wide convention. Background traffic is grown at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"} for this analysis; the rate should be confirmed against FDOT historical AADT and agreed upon during the methodology meeting.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "3.6 Level of Service Standards");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per FDOT Procedure 525-000-006, the peak-hour automobile-mode LOS standard on the State Highway System is LOS D in urbanized areas and LOS C in rural and transitioning areas. Constrained or backlogged facilities maintain their facility-specific designation. Roadway segment LOS reporting uses the FDOT Q/LOS Handbook v6.0 Generalized Service Volume Tables (GSVTs). Intersection LOS uses HCM 6th Edition Chapter 19 (signalized intersections), Exhibit 19-8 thresholds: A ≤10s, B ≤20s, C ≤35s, D ≤55s, E ≤80s, F >80s of average control delay per vehicle.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "3.7 Context Classification");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per FDOT Q/LOS v6.0 (which replaced \"complete streets\" terminology with \"context-based solutions\") and FDM Chapter 200 §200.4 (Table 200.4.1), the study network's context classification (C1 Natural, C2 Rural, C2T Rural Town, C3R Suburban Residential, C3C Suburban Commercial, C4 Urban General, C5 Urban Center, C6 Urban Core) calibrates mode treatments and design standards; cross-section and lane widths follow FDM Table 210.2.1. The controlling context class should be confirmed against the FDOT Preliminary Context Classification mapping during the methodology meeting.",
    { paragraphGap: 6 },
  );

  // --- 4.0 Existing Conditions ------------------------------------------
  gaSection(doc, "4.0 EXISTING CONDITIONS");
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
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No signalized intersections within the study radius. Off-site capacity impact is not anticipated.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.3);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Existing AADT counts should be confirmed against Florida Traffic Online (https://tdaappsprod.dot.state.fl.us/fto/) for the most recent year. Functional classification should be confirmed against the FDOT Roadway Characteristics Inventory (RCI). Existing turn-lane storage, signal control type, and existing pedestrian, bicycle, and transit facilities should be field-verified and documented as part of formal submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- 5.0 Trip Generation ----------------------------------------------
  gaSection(doc, "5.0 TRIP GENERATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation follows the ITE Trip Generation Manual 11th Edition for ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed development size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Net new external trips are calculated by applying pass-by and internal capture credits to gross trip generation per the ITE Trip Generation Handbook (current edition). Per MTSIH 2024 §4.6.4, the fitted-curve equation is preferred when ≥20 data points are available, or when R² ≥ 0.75 with the fitted curve falling within the data cluster and weighted standard deviation > 55% of the weighted average rate; otherwise the weighted average rate applies. Per MTSIH 2024 §4.6.6.6, pass-by trips at a site driveway cannot exceed 10% of the adjacent peak-hour two-way street traffic — this reasonableness check applies per roadway when the site fronts multiple streets and should be verified against the adjacent-street counts at submittal time.`,
    { paragraphGap: 6 },
  );
  if (jur.feeMethodologyNote) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      `${jur.name} fee methodology: ${jur.feeMethodologyNote}`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  rows(doc, [
    ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
    ["Internal capture applied", `${r.internalCapturePctApplied ?? 0}% (MTSIH 2024 §4.6.9 sets no statewide numeric cap; rate negotiated at the methodology meeting per NCHRP 684 / ITE Trip Generation Handbook)`],
    ["Background growth applied", `${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s)`],
    [`${jur.name} TIA threshold`, jur.tripThreshold],
    ["Weather condition", String(r.weather ?? req.weather ?? "clear")],
  ]);
  doc.moveDown(0.3);
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
    doc.moveDown(0.3);
  }

  // --- 6.0 Trip Distribution and Assignment ------------------------------
  gaSection(doc, "6.0 TRIP DISTRIBUTION AND ASSIGNMENT");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per FDOT TAH §2.7, trip distribution and assignment should use the adopted regional MPO/TPO travel-demand model${jur.mpoName ? ` (${jur.mpoName})` : ""}, with model version, base year, and horizon year identified in the methodology letter. This screening analysis assigns net new external trips by inverse-distance weighting to signalized intersections within the study area; for formal submittal, distribution percentages and the TDM run identifier should be agreed upon during the methodology meeting.`,
    { paragraphGap: 6 },
  );
  if (jur.studyAreaNote) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      `${jur.name} study-area convention: ${jur.studyAreaNote}. The renderer-applied study radius (${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)} mi) should be reconciled against this convention at submittal time.`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  if (jur.key === "orange") {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Orange County STAMP additionally publishes standardized county-specific pass-by reductions by land use; the renderer-applied pass-by capture should be reconciled against the STAMP pass-by table at submittal time.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 7.0 / 8.0 Future (No-Build) and Future (Build) -------------------
  gaSection(doc, "7.0 / 8.0 FUTURE (NO-BUILD) AND FUTURE (BUILD) TRAFFIC ANALYSIS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Three scenarios are evaluated at each affected intersection: (1) Existing — current-year background volumes; (2) Future Background / No-Build (opening year ${req.openingYear ?? "—"}) — existing volumes grown at ${r.growthAppliedPct ?? "—"}%/yr over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"} without project trips; (3) Future Build (opening year ${req.openingYear ?? "—"}) — No-Build volumes plus the proposed development's net new external trips at the assigned distribution.`,
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
  doc.moveDown(0.3);

  // --- 9.0 Mitigation Analysis ------------------------------------------
  gaSection(doc, "9.0 MITIGATION ANALYSIS");
  const needMitigation = intersections.filter((it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none");
  if (needMitigation.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "The following intersection mitigations are recommended to address projected Build-condition impacts. Geometric mitigation should be designed to FDOT Design Manual (FDM 2026, Topic No. 625-000-002, dated January 1, 2026) standards — turn-lane warrants, deceleration / storage / taper lengths, intersection sight distance, and median-opening design per FDM Chapter 212; roundabouts per FDM Chapter 213. Proportionate-share, mobility-fee, or developer contribution amounts for jurisdictions that retain concurrency (e.g., Miami-Dade Chapter 33-G) or operate mobility-fee programs (e.g., Hillsborough, Jacksonville/Duval Chapter 655, Miami-Dade Chapter 33E) should be calculated separately based on the controlling local-government ordinance.",
      { paragraphGap: 6 },
    );
    for (const it of needMitigation) {
      const sev = String(it.mitigationSeverity ?? "").toUpperCase();
      doc.font("bold").fontSize(10).fillColor("black").text(`${it.name ?? it.signalId} `, { continued: true });
      doc.font("body").fillColor(TEXT_GRAY).text(`[${sev}]`, { continued: false });
      doc.font("body").fillColor("black").text("  " + it.mitigation);
      doc.moveDown(0.3);
    }
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      "No mitigation is required to maintain the FDOT SHS LOS standard within the study network under Build conditions. Proportionate-share and mobility-fee calculations (where applicable per the controlling local-government ordinance) are not produced by this screening tool.",
      { paragraphGap: 6 },
    );
  }

  // --- 10.0 Site Access / Ingress-Egress --------------------------------
  gaSection(doc, "10.0 SITE ACCESS / INGRESS-EGRESS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Per MTSIH 2024 §3.2 Table 5, driveway TIA-scoping is keyed to gross trips per day (including pass-by): Category A 1–20 vpd (single-family); B 21–600 (small multifamily / very small commercial); C 601–1,500 (small-mid retail / small office); D 1,501–4,000 (mid retail / mid office); E 4,001–15,000 (large retail / mixed-use); F 15,001–30,000 (very large mixed-use / mall); G ≥30,001 (regional mall). Pre-application meeting + traffic study are required for Categories C–G (>600 vpd including pass-by). A connection-permit change-of-use is additionally triggered per F.S. 335.182(3)(b) when trip generation increases by >25% AND >100 vpd vs. the existing use. Connection to the FDOT State Highway System requires a connection permit per Rule 14-96 F.A.C. (2025 update). Driveway spacing, median-opening spacing, and signal spacing are governed by the access-management class (Classes 1–7) assigned to the impacted SHS segment per Rule 14-97 F.A.C. and FDOT Procedure 525-030-155; the class is stored in the RCI as Feature 146 / ACMANCLS (codes 00–07; 99 = unclassified, interim standards in Rule 14-97.004(1) apply until assignment). Driveway geometry (W, R, F, Y, G, Driveway Length, S, I; Categories A–D in FDM Chapter 214, Categories E–F–G punt to FDM Chapter 212), turn-lane warrants, deceleration-lane length, and intersection sight distance must be designed to FDOT Design Manual (FDM 2026) standards; off-SHS connections on city/county facilities follow the Florida Greenbook. The access-management class for the impacted SHS facility should be confirmed against the FDOT-published Access Management TDA layer.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- 11.0 Internal Circulation ----------------------------------------
  gaSection(doc, "11.0 INTERNAL CIRCULATION");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Internal site circulation, parking access, and service-vehicle pathways depend on the final site plan and are not included in this screening-level analysis. Internal queuing at the principal driveway should be evaluated for adequate storage between the SHS edge of pavement and the first internal conflict point per FDM guidance.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- 12.0 Comprehensive Plan / Concurrency Consistency ----------------
  gaSection(doc, "12.0 COMPREHENSIVE PLAN / CONCURRENCY CONSISTENCY");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Transportation concurrency was made optional statewide by HB 7207 (2011). For new development, the Development of Regional Impact (DRI) review track was further curtailed by SB 1216 / Ch. 2015-30 (which added F.S. 380.06(30) routing otherwise-DRI projects through the State Coordinated Review Process at F.S. 163.3184(4) in lieu of DRI), with cleanup completed by CS/CS/HB 1151 / Ch. 2018-158 — DRI is now a legacy branch retained only for amendments/abandonments of existing DRIs. ${jur.name} review framework: ${jur.framework}. Controlling document(s): ${jur.frameworkDoc}. LOS standard: ${jur.losStandardNote}. Per Florida Statutes §163.3180(5)(h)1.a., local governments must consult with FDOT whenever a Strategic Intermodal System (SIS) facility is expected to be impacted by a comprehensive-plan amendment.`,
    { paragraphGap: 6 },
  );
  if (jur.extraNote) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      `Note. ${jur.extraNote}`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  if (jur.threeTrackEndChapters) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Three-track end-chapter convention (Miami-Dade): the formal CDMP-amendment submittal should additionally provide three parallel-track end-chapters (Concurrency Analysis / CDMP Analysis / Zoning Analysis), each independently numbered 1.0–3.0. The Concurrency track is reviewed against Code Ch. 33-G + Admin. Order 4-85; the CDMP track is reviewed against the adopted Transportation Element; the Zoning track is reviewed against the host municipal zoning ordinance. This screening tool does not auto-generate the three-track parallel content; the inputs required for each track must be coordinated with the Miami-Dade TPO and Miami-Dade County DTPW prior to submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.fillColor("black");

  // --- 13.0 Programmed Projects -----------------------------------------
  gaSection(doc, "13.0 PROGRAMMED PROJECTS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Committed-projects review should consult the FDOT Five-Year Work Program (https://www.fdot.gov/workprogram) and the controlling MPO/TPO Transportation Improvement Program (TIP) and Long Range Transportation Plan (LRTP). Programmed roadway and intersection improvements within the study area should be incorporated into the No-Build network. This screening analysis does not automatically integrate Work Program data; manual review is recommended for any submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- 14.0 Professional Engineer Certification -------------------------
  gaSection(doc, "14.0 PROFESSIONAL ENGINEER CERTIFICATION");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "A Florida TIS / MTIA deliverable must be signed and sealed by a Florida-licensed Professional Engineer per Florida Statutes Chapter 471 and Florida Administrative Code Rule 61G15-23.001. The cover and signature page of the formal submittal must bear the seal, signature, and date of the Engineer of Record.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- Findings + Methodology (engine output preserved) ------------------
  const findings: string[] = Array.isArray(r.findings) ? r.findings : [];
  if (findings.length > 0) {
    doc.moveDown(0.3);
    gaSection(doc, "FINDINGS");
    doc.font("body").fontSize(10).fillColor("black");
    for (const f of findings) {
      doc.text("• " + f, { paragraphGap: 4 });
    }
    doc.moveDown(0.3);
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
