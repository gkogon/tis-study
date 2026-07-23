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
import { fetchStreetViewImage } from "./streetview";
import {
  getAutoModeShare,
  getLondonCensusModeSplit,
  getLondonCensusAutoShare,
  LONDON_CITY_CENSUS_2011_SOURCE,
} from "./mode-share";
import { ukCapacityForIntersection, type UkCapacityResult } from "./uk-capacity";
import { renderTisNewYork, renderCeqrNyc } from "./pdf-export-ny";
import { renderTisState } from "./pdf-export-states";
import { renderDiurnalCharts, drawColumnChart, drawLineChart, CHART_COLORS } from "./pdf-charts";
import { renderTripDistributionSection } from "./pdf-export-distribution";
import { profileForLandUse, distributeDaily, type ProfileLocale } from "./office-diurnal";
import { renderTemplatePdf, type RenderContext, type ReportTemplate } from "./report-template/engine";
import { loadTemplate } from "./report-template/registry";
import { buildProviders } from "./report-template/providers";
import { loadFirmTemplate } from "./report-template/store";
import { getTransitContext, type TransitContext } from "./transit-routes";
import { enrichFdotIntersections, enrichSerpmIntersections, enrichTmsCountIntersections, fetchFdotSiteSnapshot, decodeFdotFunClass, decodeFdotAccessClass, SERPM_BASE_YEAR, SERPM_FUTURE_YEAR, type FdotSegmentSnapshot } from "./fdot-live-data";
import { enrichGdotIntersections, fetchGdotSiteSnapshot } from "./gdot-live-data";
import { enrichNyIntersectionsWithSpeed, getNyCrashSummaryForSite, getGml239Status, getCbdtpStatus } from "./nysdot-data";
import { getNycTransitContext } from "./nyc-transit-data";
import { crashesNearPoint } from "./crashes";
import { atrSegmentsNearPoint } from "./atr-counts";
import { jurisdictionTierLabel, resolveStudyTier, type TierInput } from "./study-tier";
import type { StudyTier } from "./tis";
import {
  FDOT_ARTERIAL_GSVT,
  floridaGsvtServiceVolume,
  floridaRepresentativeK,
  asFdotContextClass,
  type FdotFacility,
} from "./fdot-gsvt";

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
  brandColor?: string | null;
  addressLine?: string | null;
  phone?: string | null;
  website?: string | null;
  /** When set and the firm has an uploaded template, the study renders in it. */
  firmId?: string | null;
};

// Default cover brand color when a firm hasn't set one — a professional
// deep maroon matching the consultant-cover aesthetic.
const DEFAULT_BRAND_COLOR = "#7a1420";

// Velocity Transport Planning brand identity, sampled from their filed
// reports (60 Gracechurch Street TA, Velocity, July 2024). Applied ONLY to
// the London (`london_metro`) furniture + headings; every other UK region
// (Manchester, Glasgow …) and all US/Canada studies keep their own colours.
//   • VELOCITY_GREEN — chapter titles, section headings, the rules under
//     them, ring/bullet markers, table-header text + borders, Document
//     Control Sheet accents.
//   • VELOCITY_GRAD — diagonal cover gradient green→teal→blue (white text).
//   • VELOCITY_FILL / VELOCITY_FILL_ALT — pale table/row fills.
const VELOCITY_GREEN = "#8EC57C";
const VELOCITY_GRAD = ["#07B160", "#269D89", "#5BA7CF"] as const;
const VELOCITY_FILL = "#ECF5E9";
const VELOCITY_FILL_ALT = "#E2F0DD";
// Retained name for the Document Control Sheet top rule + cover fallback
// tint; now the brand green rather than the old slate-teal placeholder.
const VELOCITY_BRAND = VELOCITY_GREEN;

// When the London (Velocity) render path is active, the SHARED table /
// metricStrip helpers (used by every region) switch their header fill +
// accent to the Velocity palette. Set true only for the duration of the
// London render and reset in a finally, so non-London regions are never
// touched. Module-level avoids threading a flag through ~40 call sites.
let velocityPaletteActive = false;

const PAGE_MARGIN = 50;
const BRAND_BLUE = "#2563eb";
const TEXT_GRAY = "#6b7280";

// Reconciliation note for the per-period trip-generation table. The "External"
// column is net-new VEHICLE trips = (Raw − Pass-by − Internal capture) × the
// per-metro auto-mode share, so a reviewer hand-summing Raw − Pass-by − Int.
// cap. won't land on External unless the mode-split step is stated. Surfacing
// the share (derived from the emitted values, so it always cross-foots) lets
// every number in the table be checked.
export function tripGenExternalNote(doc: PDFKit.PDFDocument, periods: any[]): void {
  const p = (periods ?? []).find((x) => Number(x?.tripGeneration?.rawTrips) > 0);
  if (!p) return;
  const t = p.tripGeneration ?? {};
  const allModes =
    Number(t.rawTrips) - Number(t.passByCredit) - Number(t.internalCaptureCredit);
  if (!(allModes > 0)) return;
  const pct = Math.round((Number(t.externalTrips) / allModes) * 1000) / 10;
  // When a prior on-site use supplies an existing-use credit, some renderers
  // (e.g. Florida) print a separate "Net new" column and split In / Out off
  // net-new external, not off external. Reference the right column so the note
  // never contradicts the table. Greenfield (credit = 0) keeps the original
  // wording byte-for-byte.
  const hasCredit = (periods ?? []).some(
    (x) => Number(x?.tripGeneration?.existingUseCredit) > 0,
  );
  const msg = hasCredit
    ? `The external column is gross vehicle trips = (gross − pass-by − internal-capture) × auto-mode share (${pct}% for this metro); the net-new external column then deducts the existing-use credit. Walk / bike / transit person-trips are excluded from off-site assignment, so In + Out equals the net-new external column.`
    : `The external / net-external column is net-new vehicle trips assigned to the roadway = (gross − pass-by − internal-capture) × auto-mode share (${pct}% for this metro). Walk / bike / transit person-trips are excluded from off-site assignment, so In + Out equals the external column.`;
  doc
    .font("body")
    .fontSize(8)
    .fillColor(TEXT_GRAY)
    .text(msg, { paragraphGap: 6 });
  doc.fillColor("black");
}

// Human-readable label for a trip-generation rate's provenance. The
// screening engine sources rates from public data (SANDAG 2002 / NHTS 2017
// / NCHRP 716); a few retail rates are blended MPO guidance, and secondary
// independent variables may be interpolated from a defensible ratio. The
// renderer surfaces this so a reviewing PE can verify the basis.
function rateConfidenceLabel(c: unknown, note?: string): string | null {
  switch (c) {
    case "interpolated":
      return `Interpolated${note ? ` — ${note}` : ""}`;
    case "sandag_2002":
      return "Public data — SANDAG 2002 vehicular trip-generation guide";
    case "nhts_2017":
      return "Public data — FHWA NHTS 2017 trend table";
    case "nchrp_716":
      return "Public data — NCHRP Report 716 parameter table";
    case "blended_mpo":
      return "Blended MPO screening guidance (rough — verify against a jurisdiction-approved rate)";
    default:
      return null;
  }
}

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

// Velocity logo assets (real, extracted from the filed 60 Gracechurch TA):
// the white cover wordmark, plus the grey wordmark + green multimodal icon
// for the title/footer furniture. Probed beside the bundled fonts (same
// ../data vs ../../data dual-path as FONT_DIR so it resolves in both the
// dist/ build and tsx/test runs). London-only — never loaded for other
// regions.
const VELOCITY_ASSET_DIR = (() => {
  for (const c of [path.resolve(__dirname, "../data/velocity"), path.resolve(__dirname, "../../data/velocity")]) {
    if (existsSync(path.join(c, "velocity-wordmark-white.png"))) return c;
  }
  return path.resolve(__dirname, "../data/velocity");
})();
function velocityAsset(name: string): Buffer | null {
  try {
    const p = path.join(VELOCITY_ASSET_DIR, name);
    return existsSync(p) ? readFileSync(p) : null;
  } catch { return null; }
}

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
/**
 * Region/firm → declarative report template. Template-driven studies render
 * through the generic engine (report-template/) instead of a hand-coded
 * renderer. A firm's uploaded template wins in any region; otherwise UK/London
 * uses the built-in Velocity TA. US regions return null and keep their dedicated
 * renderers.
 */
function resolveTemplate(project: StoredProject, firm: FirmStamp): { template: ReportTemplate; locale: ProfileLocale } | null {
  if (project.studyType !== "tis") return null;
  const lat = Number(project.siteLat ?? NaN);
  const lon = Number(project.siteLon ?? NaN);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const region = regionForCoordinate(lat, lon);
  const locale: ProfileLocale = region?.country === "UK" ? "uk" : "us";
  if (firm.firmId) {
    const t = loadFirmTemplate(firm.firmId);
    if (t) return { template: t, locale };
  }
  if (region?.country === "UK") return { template: loadTemplate("velocity-ta"), locale };
  return null;
}

/** Render a study through the declarative template engine. */
async function renderTemplateReport(
  project: StoredProject,
  firm: FirmStamp,
  sel: { template: ReportTemplate; locale: ProfileLocale },
): Promise<Buffer> {
  const lat = Number(project.siteLat ?? NaN);
  const lon = Number(project.siteLon ?? NaN);
  const region = regionForCoordinate(lat, lon);
  const report = (project.resultPayload ?? {}) as any;
  const address = report?.request?.address ?? project.projectName ?? "";
  const dateLabel = project.createdAt
    ? new Date(project.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : "";
  const ctx: RenderContext = {
    report,
    project: { ...project, address, dateLabel },
    region,
    firm: { name: firm.name, logoUrl: firm.logoUrl },
  };
  return renderTemplatePdf(sel.template, ctx, buildProviders({ locale: sel.locale }));
}

export async function renderStudyPdf(
  project: StoredProject,
  firm: FirmStamp,
): Promise<Buffer> {
  // Template-driven studies render through the declarative engine rather than a
  // hand-coded renderer; this is the path the Velocity / imported formats take.
  const tplSel = resolveTemplate(project, firm);
  if (tplSel) return renderTemplateReport(project, firm, tplSel);

  // Resolve the firm logo to bytes up front — the cover and header
  // both want to draw it, and fetching twice would be wasteful (and
  // could double the timeout window if the host is slow).
  const logoBuf = await fetchLogoBuffer(firm.logoUrl);

  // Cover site photo (Street View). Best-effort: null when no API key,
  // no imagery at the site, or any error — the cover falls back to a
  // brand-color band. Resolved from the project coordinate.
  const coverLat = Number(project.siteLat ?? NaN);
  const coverLon = Number(project.siteLon ?? NaN);
  const sitePhotoBuf = (Number.isFinite(coverLat) && Number.isFinite(coverLon))
    ? await fetchStreetViewImage(coverLat, coverLon)
    : null;

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
    // bufferPages lets us iterate every page once at the end to stamp
    // the screening-disclaimer footer without firing pageAdded
    // recursively during the draw passes.
    bufferPages: true,
    info: {
      Title: `${documentLabel(project)} — ${project.projectName}`,
      Author: firm.name,
      Subject: documentLabel(project),
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
        // (d) GML §239-m / §239-n referral test — site within 500 ft
        //     of a state or county road? Outside NYC only (NYC uses
        //     ULURP / CEQR, not §239 referral). Stashes
        //     result.nyGml239Status for renderTisNewYork §4.4
        //     permitting block.
        const gml239Task = getGml239Status(lat, lon).then((s) => {
          if (s && result && typeof result === "object") {
            (result as Record<string, unknown>).nyGml239Status = s;
          }
        });
        // (e) NYC transit + active-mode context — MTA subway stations
        //     within 0.5 mi + nearest NYC DOT bike counter within 1 mi.
        //     Only meaningful inside the five boroughs; the adapter
        //     returns empty results harmlessly for non-NYC coords.
        const transitTask = getNycTransitContext(lat, lon).then((ctx) => {
          if (ctx && result && typeof result === "object") {
            (result as Record<string, unknown>).nyTransitContext = ctx;
          }
        });
        // (f) NYC DOT ATR measured volumes — populates §3.2a in
        //     renderTisNewYork when ATR coverage exists within 1.0 mi.
        //     Fails open: outside NYC or when no ATR rows are nearby,
        //     the §3.2a block is silently omitted and the K-factor-
        //     derived §3.2 table stands alone. 1.0 mi radius because
        //     NYC DOT counts a rotating sample — many midtown sites
        //     have no ATR segment closer than 0.5 mi (e.g. Times
        //     Square's nearest is on 9th Ave, 0.7 mi west).
        const atrTask = atrSegmentsNearPoint({
          lat,
          lon,
          radiusMi: 1.0,
          windowYears: 3,
          source: "nyc_dot_atr",
        })
          .then((s) => {
            if (s.segments.length > 0 && result && typeof result === "object") {
              (result as Record<string, unknown>).nycAtrSummary = s;
            }
          })
          .catch(() => {});
        await Promise.all([speedTask, crashTask, preciseCrashTask, gml239Task, transitTask, atrTask]);
      }
      // FL — three parallel live-data enrichments:
      //   (a) precise crash records from FDOT SSO ingest (fdot_sso, 10y
      //       window — public extract is stale after 2019).
      //   (b) per-intersection FDOT RCI live AADT + functional class +
      //       SHS membership + Rule 14-97 access class from the TDA
      //       ArcGIS REST services (gis.fdot.gov + services1.arcgis.com).
      //       Mutates the intersection rows in place; stashes a site-level
      //       snapshot at result.fdotSiteSnapshot.
      //   (c) transit context — bus stops + route refs within 0.25 mi via
      //       Transit.land v2 (preferred) with OSM Overpass fallback;
      //       lets §11 emit Caltran-style "BCT routes 02, 22, 30, 81"
      //       prose instead of a placeholder.
      // All three fail-open: any error keeps the existing prose paths.
      if (region?.stateCode === "FL" && (region?.country ?? "US") === "US") {
        const result = project.resultPayload as Record<string, unknown> | null;
        const intersections = Array.isArray(result?.affectedIntersections)
          ? (result?.affectedIntersections as Array<Record<string, unknown>>)
          : [];
        const flCrashTask = crashesNearPoint({
          lat, lon, radiusMi: 0.5, windowYears: 10, source: "fdot_sso",
        })
          .then((cs) => {
            if (cs.totalCrashes > 0 && result && typeof result === "object") {
              (result as Record<string, unknown>).flCrashSummary = cs;
            }
          })
          .catch(() => {});
        const fdotIntersectionsTask = intersections.length > 0
          ? enrichFdotIntersections(intersections as any).catch(() => 0)
          : Promise.resolve(0);
        // SERPM regional-model link volumes per study intersection (SE-FL D4/D6).
        const serpmTask = intersections.length > 0
          ? enrichSerpmIntersections(intersections as any).catch(() => 0)
          : Promise.resolve(0);
        // FDOT count-station collected peak-hour + daily volumes per intersection.
        const tmsTask = intersections.length > 0
          ? enrichTmsCountIntersections(intersections as any).catch(() => 0)
          : Promise.resolve(0);
        const fdotSiteTask = fetchFdotSiteSnapshot(lat, lon).then((snap) => {
          if (snap && result && typeof result === "object") {
            (result as Record<string, unknown>).fdotSiteSnapshot = snap;
          }
        }).catch(() => {});
        const transitTask = getTransitContext(lat, lon, 0.25).then((ctx) => {
          if (ctx && result && typeof result === "object") {
            (result as Record<string, unknown>).transitContext = ctx;
          }
        }).catch(() => {});
        await Promise.all([flCrashTask, fdotIntersectionsTask, serpmTask, tmsTask, fdotSiteTask, transitTask]);
      }
      // GA — ARC AADT enrich for Atlanta-metro intersections + transit
      // context (MARTA / CCT / Gwinnett County Transit via Transit.land /
      // Overpass). Statewide outside the ARC footprint, the AADT enrich
      // returns nothing and the GA renderer's existing prose stands.
      if (region?.stateCode === "GA" && (region?.country ?? "US") === "US") {
        const result = project.resultPayload as Record<string, unknown> | null;
        const intersections = Array.isArray(result?.affectedIntersections)
          ? (result?.affectedIntersections as Array<Record<string, unknown>>)
          : [];
        const gdotIntersectionsTask = intersections.length > 0
          ? enrichGdotIntersections(intersections as any).catch(() => 0)
          : Promise.resolve(0);
        const gdotSiteTask = fetchGdotSiteSnapshot(lat, lon).then((snap) => {
          if (snap && result && typeof result === "object") {
            (result as Record<string, unknown>).gdotSiteSnapshot = snap;
          }
        }).catch(() => {});
        const transitTaskGa = getTransitContext(lat, lon, 0.25).then((ctx) => {
          if (ctx && result && typeof result === "object") {
            (result as Record<string, unknown>).transitContext = ctx;
          }
        }).catch(() => {});
        await Promise.all([gdotIntersectionsTask, gdotSiteTask, transitTaskGa]);
      }
      // Universal fatal-crash supplement — NHTSA FARS covers all US
      // states. Per-state per-crash data is gated almost everywhere
      // (GEARS / SWITRS / CRIS / Signal4 all require agency login),
      // so FARS is the only public source of recent (post-2019)
      // crash records for most states. Severity is fatal-only (K) by
      // definition. Stashed on `farsKSummary`; each state renderer
      // emits its own block format.
      if ((region?.country ?? "US") === "US") {
        const result = project.resultPayload as Record<string, unknown> | null;
        await crashesNearPoint({
          lat, lon, radiusMi: 2.0, windowYears: 7, source: "nhtsa_fars",
        })
          .then((cs) => {
            if (cs.totalCrashes > 0 && result && typeof result === "object") {
              (result as Record<string, unknown>).farsKSummary = cs;
            }
          })
          .catch(() => {});
      }
    }
  }

  // Velocity Transport Planning is the only City-of-London client; their
  // filed-report furniture (cover variant + Document Control Sheet + a
  // bespoke per-page footer) is the London default. Gated to the
  // `london_metro` region only — every other UK region (Manchester,
  // Glasgow, Edinburgh, Birmingham …) and all US/Canada studies keep the
  // shared consultant cover + screening footer unchanged.
  const docRegion = project.studyType === "tis" ? detectRegion(project) : null;
  const isVelocityLondon = docRegion?.code === "london_metro";
  const velocityMeta = isVelocityLondon ? velocityDocMeta(project) : null;

  if (velocityMeta) {
    drawVelocityCover(doc, project, firm, logoBuf, sitePhotoBuf, velocityMeta);
    doc.addPage();
    drawVelocityDocControlSheet(doc, velocityMeta, firm);
  } else {
    drawCover(doc, project, firm, logoBuf, sitePhotoBuf);
  }
  doc.addPage();
  drawHeader(doc, project, firm);
  drawBody(doc, project);
  drawCitationsFooter(doc, project);

  // Iterate every buffered page and stamp the footer. London (Velocity)
  // gets the client's per-page footer; everyone else gets the screening
  // disclaimer. The cover page (index 0) is skipped for the Velocity
  // footer so it does not overprint the cover's own contact block.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    if (velocityMeta) {
      if (i > range.start) drawVelocityPageFooter(doc, velocityMeta, i - range.start);
    } else {
      drawPageFooter(doc);
    }
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
  // The footer sits in the bottom margin band, below `page.maxY()`. PDFKit's
  // text() runs an end-of-page check — `doc.y + lineHeight > maxY` — AFTER it
  // draws the line, and when tripped it appends a fresh page. `lineBreak:
  // false` only disables horizontal wrapping, NOT that vertical check, so the
  // footer fired it once per stamped page and produced a run of trailing
  // footer-only blank pages. Temporarily dropping the bottom margin lifts maxY
  // above the footer line so the check never trips. (Stamped by the buffered-
  // page footer loop in renderStudyPdf.)
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  doc.font("body").fontSize(7).fillColor("#9ca3af").text(
    "Screening estimate — not for design submittal without independent verification by a licensed PE.   |   See /legal/disclaimer.",
    PAGE_MARGIN, y, { width: w, align: "center", lineBreak: false },
  );
  doc.restore();
  doc.page.margins.bottom = savedBottom;
}

// --- Velocity Transport Planning furniture (London / City-of-London) ----
// Velocity is our only City-of-London client, so their filed-report
// furniture is the London default (see REGIONAL-SPECS/velocity-ta-format.md,
// derived from the 60 Gracechurch Street TA, Velocity, Project 23/186, Doc
// D002, v1.0, July 2024). SITE and DATE are pulled from existing project
// fields; project number, doc number, revision and client are emitted as
// bracket placeholders — this task deliberately does NOT add new request-
// schema fields (stays off the codegen path), so the consultant fills the
// brackets at submittal.
const VELOCITY_NAME = "Velocity Transport Planning Ltd";
const VELOCITY_NAME_LIMITED = "Velocity Transport Planning Limited";
const VELOCITY_WEB = "www.velocity-tp.com";

type VelocityMeta = {
  site: string;
  monthYear: string;
  projectNo: string;
  docNo: string;
  version: string;
  client: string;
};

function velocityDocMeta(project: StoredProject): VelocityMeta {
  // SITE: prefer the request address (the street address Velocity prints
  // on the cover), falling back to the project name.
  const req = (project.resultPayload as { request?: { address?: string } } | null)?.request;
  const addr = typeof req?.address === "string" ? req.address.trim() : "";
  const site = addr || project.projectName || "[SITE]";
  const monthYear = project.createdAt.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
  });
  return {
    site,
    monthYear,
    // Bracket placeholders — filled by the consultant; no schema field yet.
    projectNo: "[NN/NNN]",
    docNo: "[DNNN]",
    version: "[n.n]",
    client: "[CLIENT]",
  };
}

/**
 * Velocity cover page. Full-bleed diagonal green→teal→blue gradient with
 * the white VELOCITY wordmark top-left, the site / "Transport Assessment" /
 * date bottom-left, and the project metadata + sign-off — reproducing the
 * 60 Gracechurch Street cover. The Street View photo is dropped to a very
 * faint ghost so the gradient stays the priority. London-only; the shared
 * `drawCover` is untouched for every other region.
 *
 * If the firm has set its own `brandColor`, we honour it with a flat brand
 * cover instead of Velocity's gradient (so a white-labelling firm gets its
 * own identity); only the unbranded Velocity default gets the gradient.
 */
function drawVelocityCover(
  doc: PDFKit.PDFDocument,
  project: StoredProject,
  firm: FirmStamp,
  logoBuf: Buffer | null,
  sitePhotoBuf: Buffer | null,
  meta: VelocityMeta,
) {
  const W = doc.page.width;
  const H = doc.page.height;
  const firmBranded = !!(firm.brandColor && /^#[0-9a-fA-F]{6}$/.test(firm.brandColor));

  // 1) Background. Velocity default → diagonal gradient. White-labelled firm
  //    → flat brand fill (their own colour, not Velocity's gradient).
  if (firmBranded) {
    doc.rect(0, 0, W, H).fill(firm.brandColor as string);
  } else {
    const g = doc.linearGradient(0, 0, W, H);
    g.stop(0, VELOCITY_GRAD[0]).stop(0.55, VELOCITY_GRAD[1]).stop(1, VELOCITY_GRAD[2]);
    doc.rect(0, 0, W, H).fill(g);
  }

  // 2) Very faint ghost of the Street View photo over the gradient, lower
  //    half only, so the gradient reads first. Skipped if no photo.
  if (sitePhotoBuf) {
    try {
      doc.save();
      doc.rect(0, H * 0.32, W, H * 0.68).clip();
      doc.opacity(0.12);
      doc.image(sitePhotoBuf, 0, H * 0.32, { cover: [W, H * 0.68], align: "center", valign: "center" });
      doc.opacity(1);
      doc.restore();
    } catch {
      doc.opacity(1);
    }
  }

  const onBrand = firmBranded ? readableOn(firm.brandColor as string) : "#ffffff";
  const subOnBrand = onBrand === "#ffffff" ? "rgba(255,255,255,0.88)" : "#333333";
  const tX = PAGE_MARGIN;
  const tW = W - PAGE_MARGIN * 2;

  // 3) Wordmark top-left: firm logo if uploaded, else Velocity's real white
  //    wordmark asset, else a styled-text fallback.
  const whiteWordmark = velocityAsset("velocity-wordmark-white.png");
  let placedLogo = false;
  if (logoBuf) {
    try { doc.image(logoBuf, tX, 44, { fit: [240, 60] }); placedLogo = true; } catch { placedLogo = false; }
  } else if (!firmBranded && whiteWordmark) {
    try { doc.image(whiteWordmark, tX, 46, { fit: [232, 52] }); placedLogo = true; } catch { placedLogo = false; }
  }
  if (!placedLogo) {
    // Styled-text fallback in the brand voice (italic, letter-spaced).
    doc.font("bold").fontSize(30).fillColor(onBrand)
      .text((firmBranded ? firm.name : "VELOCITY").toUpperCase(), tX, 48, { width: tW, characterSpacing: 3, oblique: true });
    if (!firmBranded) {
      doc.font("body").fontSize(10).fillColor(subOnBrand)
        .text("Transport Planning", tX, 86, { width: tW, characterSpacing: 4 });
    }
  }

  // 4) Bottom-left title block: site, "Transport Assessment", rule, metadata.
  let y = H - 300;
  doc.fillColor(onBrand).font("bold").fontSize(30).text(meta.site, tX, y, { width: tW * 0.92 });
  y = doc.y + 4;
  doc.font("body").fontSize(18).fillColor(onBrand).text("Transport Assessment", tX, y, { width: tW });
  y = doc.y + 8;
  doc.font("body").fontSize(12).fillColor(subOnBrand).text(meta.monthYear, tX, y, { width: tW });
  y = doc.y + 12;
  doc.save().lineWidth(1.25).strokeColor(onBrand).opacity(0.85)
    .moveTo(tX, y).lineTo(tX + Math.min(tW, 320), y).stroke().opacity(1).restore();
  y += 12;

  const metaLines = [
    `PROJECT NO. ${meta.projectNo}    DOC NO. ${meta.docNo}`,
    `VERSION: ${meta.version}`,
    `CLIENT: ${meta.client}`,
  ];
  doc.font("body").fontSize(10).fillColor(subOnBrand);
  for (const line of metaLines) {
    doc.text(line, tX, y, { width: tW });
    y = doc.y + 2;
  }

  // 5) Velocity sign-off, bottom-left under the metadata.
  doc.font("bold").fontSize(11).fillColor(onBrand)
    .text(VELOCITY_NAME, tX, H - PAGE_MARGIN - 28, { width: tW });
  doc.font("body").fontSize(10).fillColor(subOnBrand)
    .text(VELOCITY_WEB, tX, H - PAGE_MARGIN - 13, { width: tW });
  doc.opacity(1).fillColor("black");
}

/**
 * Velocity Document Control Sheet (page i). Reference / title / number
 * block, the Prepared-By / Reviewed-By / Authorised-By review table, and
 * the © reproduction line. Placeholders for the metadata the consultant
 * sets at submittal. London-only.
 */
function drawVelocityDocControlSheet(
  doc: PDFKit.PDFDocument,
  meta: VelocityMeta,
  firm: FirmStamp,
) {
  const W = doc.page.width;
  // Green diagonal corner badge top-right carrying the page mark "i",
  // reproducing the filed-report Document Control Sheet header. Drawn
  // inside save/restore; the badge "i" text is positioned explicitly and
  // must NOT leave the text cursor near the right margin (restore() only
  // restores graphics state, not doc.x/doc.y), so the title below sets its
  // own x / y / width explicitly.
  doc.save();
  doc.fillColor(VELOCITY_GREEN);
  doc.moveTo(W - 150, 0).lineTo(W, 0).lineTo(W, 70).lineTo(W - 110, 70).closePath().fill();
  doc.fillColor("#ffffff").font("body").fontSize(11).text("i", W - 62, 24, { width: 24, align: "left", lineBreak: false });
  doc.restore();
  doc.fillColor("black");
  doc.font("bold").fontSize(16).fillColor(VELOCITY_GREEN)
    .text("DOCUMENT CONTROL SHEET", PAGE_MARGIN, 96, { width: W - PAGE_MARGIN * 2 });
  doc.x = PAGE_MARGIN;
  doc.moveDown(0.8);

  rows(doc, [
    ["Document Reference", `${meta.projectNo} ${meta.docNo}`],
    ["Project Title", `${meta.site} — Transport Assessment`],
    ["Document Title", "Transport Assessment"],
    ["Project Number", meta.projectNo],
    ["Document Number", meta.docNo],
    ["Revision No.", meta.version],
    ["Document Date", meta.monthYear],
  ]);
  doc.moveDown(0.8);

  doc.font("bold").fontSize(11).fillColor("black").text("Document Review");
  doc.moveDown(0.3);
  velocityPaletteActive = true;
  table(doc, {
    headers: ["Role", "Name / Initials", "Date completed"],
    widths: [170, 170, 130],
    align: ["left", "left", "left"],
    rows: [
      ["Prepared By", "[..]", "[..]"],
      ["Reviewed By", "[..]", "[..]"],
      ["Authorised By", "[..]", "[..]"],
    ],
  });
  velocityPaletteActive = false;
  doc.moveDown(0.5);

  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Notes: project number, document number, revision, the named reviewers and the client are completed by " + (firm.name || VELOCITY_NAME) + " at submittal. The site and document date are auto-populated from the study record.",
    { paragraphGap: 8 },
  );
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "© " + VELOCITY_NAME + " — Extracts may be reproduced provided that the source is acknowledged.",
    { paragraphGap: 4 },
  );
  doc.fillColor("black");
}

/**
 * Velocity per-page footer. Stamped on every page except the cover.
 * Format: `Velocity Transport Planning Limited | Transport Assessment |
 * Project No [..] Doc No [..] | [Site] | Page n | [Month Year]`.
 */
function drawVelocityPageFooter(doc: PDFKit.PDFDocument, meta: VelocityMeta, pageNum: number) {
  const W = doc.page.width;
  const y = doc.page.height - 30;
  // Drop the bottom margin while stamping: the footer line sits below
  // page.maxY(), and PDFKit's post-draw end-of-page check would otherwise
  // append a fresh page per stamp (see drawPageFooter for the full mechanism).
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.save();
  // Green rule above the footer (brand), grey footer text below it.
  doc.strokeColor(VELOCITY_GREEN).lineWidth(0.75)
    .moveTo(PAGE_MARGIN, y - 6).lineTo(W - PAGE_MARGIN, y - 6).stroke();

  // Green multimodal icon, bottom-right, mirroring the filed report.
  const icon = velocityAsset("velocity-multimodal.png");
  let textRight = W - PAGE_MARGIN;
  if (icon) {
    try {
      const iconW = 66;
      const iconH = iconW * (138 / 529); // preserve the asset aspect ratio
      doc.image(icon, W - PAGE_MARGIN - iconW, y - 1, { fit: [iconW, iconH] });
      textRight = W - PAGE_MARGIN - iconW - 8;
    } catch { /* fall through to text-only footer */ }
  }
  const w = textRight - PAGE_MARGIN;
  // `lineBreak: false` disables horizontal wrapping only; the bottom-margin
  // drop above is what stops the vertical end-of-page check from paginating.
  doc.font("body").fontSize(7).fillColor("#6b7280").text(
    `${VELOCITY_NAME_LIMITED} | Transport Assessment | Project No ${meta.projectNo} Doc No ${meta.docNo} | ${meta.site} | Page ${pageNum} | ${meta.monthYear}`,
    PAGE_MARGIN, y, { width: w, align: "left", lineBreak: false },
  );
  doc.restore();
  doc.page.margins.bottom = savedBottom;
}

// --- Cover color helpers ------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Relative luminance (0 dark … 1 light) for pick-readable-text decisions. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
/** White on dark brand colors, near-black on light ones. */
function readableOn(hex: string): string {
  return luminance(hex) < 0.55 ? "#ffffff" : "#1a1a1a";
}
/** Lighten (f>1) or darken (f<1) a hex color, clamped to [0,255]. */
function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Consultant-grade branded cover, modeled on the FDOT/Caltran submittal
 * format: firm logo top-left, a full-width site photo band (Street View
 * when available), a brand-color geometric design (diagonal corner accent
 * + chevrons), the project title on the brand block, and a firm contact
 * block. All color comes from `firm.brandColor` (default deep maroon), so
 * each firm gets this layout in its own brand.
 */
function drawCover(
  doc: PDFKit.PDFDocument,
  project: StoredProject,
  firm: FirmStamp,
  logoBuf: Buffer | null,
  sitePhotoBuf: Buffer | null,
) {
  const W = doc.page.width;
  const H = doc.page.height;
  const brand = (firm.brandColor && /^#[0-9a-fA-F]{6}$/.test(firm.brandColor))
    ? firm.brandColor
    : DEFAULT_BRAND_COLOR;
  const onBrand = readableOn(brand);
  const subOnBrand = onBrand === "#ffffff" ? "rgba(255,255,255,0.82)" : "#333333";

  const photoTop = 116;
  const photoH = 348;
  const blockTop = photoTop + photoH; // brand block starts here

  // 1) Site photo band (or brand-tint fallback). Clipped to the band rect.
  if (sitePhotoBuf) {
    try {
      doc.save();
      doc.rect(0, photoTop, W, photoH).clip();
      doc.image(sitePhotoBuf, 0, photoTop, { cover: [W, photoH], align: "center", valign: "center" });
      doc.restore();
    } catch {
      doc.rect(0, photoTop, W, photoH).fill(shade(brand, 1.6));
    }
  } else {
    // No photo: a soft brand-tint band keeps the cover composed. No
    // placeholder text — an empty labelled box reads as unfinished on a
    // client-facing cover; a clean tint band does not.
    doc.rect(0, photoTop, W, photoH).fill(shade(brand, 1.7));
  }

  // 2) Top-right diagonal brand accent (over the white top zone + photo).
  doc.polygon([W, 0], [W, 150], [W - 175, 0]).fill(brand);
  doc.polygon([W, 0], [W, 92], [W - 108, 0]).fill(shade(brand, 0.78));

  // 3) Bottom brand block.
  doc.rect(0, blockTop, W, H - blockTop).fill(brand);

  // 4) Chevron accent on the right of the brand block (Caltran motif).
  const chevColor = shade(brand, onBrand === "#ffffff" ? 1.28 : 0.78);
  for (let i = 0; i < 3; i++) {
    const cx = W - 150 + i * 26;
    const cy = blockTop + 70;
    doc.save().lineWidth(11).strokeColor(chevColor).lineJoin("miter")
      .moveTo(cx, cy - 34).lineTo(cx + 26, cy).lineTo(cx, cy + 34).stroke().restore();
  }

  // 5) Firm logo top-left (on white), or firm name fallback.
  if (logoBuf) {
    try {
      doc.image(logoBuf, PAGE_MARGIN, 38, { fit: [220, 64] });
    } catch {
      doc.font("bold").fontSize(16).fillColor(brand).text(firm.name.toUpperCase(), PAGE_MARGIN, 52);
    }
  } else {
    doc.font("bold").fontSize(16).fillColor(brand).text(firm.name.toUpperCase(), PAGE_MARGIN, 52);
  }

  // 6) Title block on the brand block. Width is capped short of the
  //    right edge so a long title wraps clear of the chevron accent.
  const titleX = PAGE_MARGIN;
  const titleW = W - PAGE_MARGIN - 175;
  doc.fillColor(onBrand).font("bold").fontSize(26)
    .text(project.projectName, titleX, blockTop + 44, { width: titleW });
  // Underline rule under the title.
  const ulY = doc.y + 2;
  doc.save().lineWidth(1.5).strokeColor(onBrand).moveTo(titleX, ulY).lineTo(titleX + Math.min(titleW, 360), ulY).stroke().restore();
  doc.moveDown(0.6);
  doc.font("body").fontSize(16).fillColor(onBrand)
    .text(studyLabel(project.studyType), titleX, doc.y, { width: titleW, oblique: true });
  doc.moveDown(0.3);
  doc.font("body").fontSize(10).fillColor(subOnBrand).text(
    `Prepared ${project.createdAt.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`
    + (project.siteLat && project.siteLon ? `   ·   ${Number(project.siteLat).toFixed(4)}, ${Number(project.siteLon).toFixed(4)}` : ""),
    titleX, doc.y, { width: titleW },
  );

  // 7) Firm contact block, bottom-right of the brand block.
  const contact: string[] = [];
  if (firm.addressLine) contact.push(firm.addressLine);
  if (firm.phone) contact.push(`Phone: ${firm.phone}`);
  if (firm.website) contact.push(firm.website);
  const lineH = 14;
  const blockH = 18 + contact.length * lineH; // firm name line + contact lines
  let cy = H - PAGE_MARGIN - blockH;
  const cw = W - PAGE_MARGIN * 2;
  doc.font("bold").fontSize(13).fillColor(onBrand).text(firm.name, PAGE_MARGIN, cy, { width: cw, align: "right" });
  cy += 20;
  doc.font("body").fontSize(10).fillColor(subOnBrand);
  for (const line of contact) {
    doc.text(line, PAGE_MARGIN, cy, { width: cw, align: "right" });
    cy += lineH;
  }
  doc.fillColor("black");
}

function drawHeader(doc: PDFKit.PDFDocument, project: StoredProject, firm: FirmStamp) {
  doc.rect(0, 0, doc.page.width, 4).fill(BRAND_BLUE);
  doc.fillColor("black");
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY)
    .text(firm.name, PAGE_MARGIN, 12)
    .text(documentLabel(project) + " — " + project.projectName, PAGE_MARGIN, 12, { align: "right" });
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
  doc.font("bold").fontSize(18).fillColor("black").text(documentLabel(project));
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
/**
 * Site-access figure (Phase 3): a north-up schematic of the site with its
 * driveways placed by their real bearing from the site, each labelled with its
 * access type and entering / exiting AM (PM) project volumes — the Caltran HCA
 * site-plan inset style. Volumes scale each driveway's share of the entering /
 * exiting movement to the AM and PM period external in / out trips. Rendered
 * only when `result.driveways` is present (opt-in). Best-effort: if the request
 * driveway coordinates are missing it silently skips (the table still prints).
 */
type DrivewayFigureRow = { label: string; access: string; inAm: number; inPm: number; outAm: number; outPm: number; forcesReroute: boolean };

function renderDrivewayFigure(doc: PDFKit.PDFDocument, result: Record<string, unknown>, uk = false): DrivewayFigureRow[] {
  const dw = (result as any).driveways;
  const req = (result as any).request ?? {};
  const reqDws: any[] = Array.isArray(req.driveways) ? req.driveways : [];
  const resDws: any[] = dw && Array.isArray(dw.driveways) ? dw.driveways : [];
  if (reqDws.length === 0 || resDws.length === 0) return [];
  const site = { lat: Number(req.latitude), lon: Number(req.longitude) };
  const canDraw = Number.isFinite(site.lat) && Number.isFinite(site.lon);

  // Period in/out totals for the AM (PM) labels.
  const periods: any[] = Array.isArray((result as any).periodReports) ? (result as any).periodReports : [];
  const per = (p: string) => periods.find((x) => x.period === p)?.tripGeneration ?? null;
  const am = per("am_peak");
  const pm = per("pm_peak") ?? per("saturday_midday");
  const amIn = Number(am?.inTrips) || 0, amOut = Number(am?.outTrips) || 0;
  const pmIn = Number(pm?.inTrips) || 0, pmOut = Number(pm?.outTrips) || 0;

  const enterShare = resDws.map((d) => (Number(d.enterByMovement?.inLeft) || 0) + (Number(d.enterByMovement?.inRight) || 0));
  const exitShare = resDws.map((d) => (Number(d.exitByMovement?.outLeft) || 0) + (Number(d.exitByMovement?.outRight) || 0));
  const sumEnter = enterShare.reduce((s, v) => s + v, 0) || 1;
  const sumExit = exitShare.reduce((s, v) => s + v, 0) || 1;
  const scale = (share: number, sum: number, total: number) => Math.round((share / sum) * total);

  const bearing = (lat: number, lon: number): number => {
    const φ1 = (site.lat * Math.PI) / 180, φ2 = (lat * Math.PI) / 180;
    const Δλ = ((lon - site.lon) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  };
  const ACCESS_LABEL: Record<string, string> = {
    full: "Full", riro: "RIRO", three_quarter: "¾ access", entrance_only: "Entry only", exit_only: "Exit only", custom: "Custom",
  };
  // UK access terminology (DMRB CD 123 / Manual for Streets). Britain drives on
  // the left, so the US near-side RIRO restriction is left-in/left-out here; a
  // full access is a priority junction; a ¾ access is a ghost-island right-turn.
  const ACCESS_LABEL_UK: Record<string, string> = {
    full: "All movements (priority)", riro: "LILO (left-in/left-out)", three_quarter: "¾ (ghost-island)", entrance_only: "Entry only", exit_only: "Exit only", custom: "Bespoke",
  };
  const labelMap = uk ? ACCESS_LABEL_UK : ACCESS_LABEL;

  // Row data (always computed — drives both the figure and the table below).
  const n = Math.min(reqDws.length, resDws.length);
  const rows: DrivewayFigureRow[] = [];
  for (let i = 0; i < n; i++) {
    const rq = reqDws[i], rs = resDws[i];
    rows.push({
      label: String(rs.label ?? rq.label ?? `${uk ? "Access" : "Driveway"} ${String.fromCharCode(65 + i)}`),
      access: labelMap[String(rq.accessType)] ?? String(rq.accessType ?? ""),
      inAm: scale(enterShare[i]!, sumEnter, amIn), inPm: scale(enterShare[i]!, sumEnter, pmIn),
      outAm: scale(exitShare[i]!, sumExit, amOut), outPm: scale(exitShare[i]!, sumExit, pmOut),
      forcesReroute: (Number(rs.reroutedTrips) || 0) > 1e-4,
    });
  }

  if (canDraw) {
    const W = doc.page.width;
    const figW = W - 2 * PAGE_MARGIN;
    const figH = 340;
    const x0 = PAGE_MARGIN, y0 = doc.y;
    const cx = x0 + figW / 2, cy = y0 + figH / 2;
    const R = Math.max(78, Math.min(figW / 2 - 150, figH / 2 - 58)); // marker ring radius (room for labels)

    doc.save();
    // Frame + north arrow.
    doc.lineWidth(0.75).strokeColor("#d1d5db").rect(x0, y0, figW, figH).stroke();
    doc.fillColor(TEXT_GRAY).font("body").fontSize(8).text("N", x0 + figW - 22, y0 + 10, { lineBreak: false });
    doc.save().fillColor(TEXT_GRAY).moveTo(x0 + figW - 16, y0 + 9).lineTo(x0 + figW - 20, y0 + 18).lineTo(x0 + figW - 12, y0 + 18).closePath().fill().restore();

    // Site box.
    const sw = 104, sh = 62;
    doc.save().fillColor("#fde68a").opacity(0.55).rect(cx - sw / 2, cy - sh / 2, sw, sh).fill().opacity(1).restore();
    doc.lineWidth(1).strokeColor("#b45309").rect(cx - sw / 2, cy - sh / 2, sw, sh).stroke();
    doc.fillColor("black").font("bold").fontSize(8.5).text("PROPOSED SITE", cx - sw / 2 + 4, cy - 12, { width: sw - 8, align: "center", lineBreak: false });
    const projName = String((result as any).request?.projectName ?? "").slice(0, 22);
    if (projName) doc.font("body").fontSize(7).fillColor(TEXT_GRAY).text(projName, cx - sw / 2 + 4, cy + 1, { width: sw - 8, align: "center", lineBreak: false });

    // Driveways placed by bearing.
    for (let i = 0; i < n; i++) {
      const rq = reqDws[i], r = rows[i]!;
      const lat = Number(rq.latitude), lon = Number(rq.longitude);
      const brg = (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== site.lat || lon !== site.lon))
        ? bearing(lat, lon) : (i / Math.max(1, n)) * 360;
      const rad = (brg * Math.PI) / 180;
      const mx = cx + R * Math.sin(rad), my = cy - R * Math.cos(rad);
      // Connector from just outside the site box (64pt > box half-diagonal) to the marker.
      const sx = cx + 64 * Math.sin(rad), sy = cy - 64 * Math.cos(rad);
      doc.save().lineWidth(0.75).strokeColor("#9ca3af").moveTo(sx, sy).lineTo(mx, my).stroke().restore();
      // Marker.
      doc.save().fillColor("#F2A20C").rect(mx - 9, my - 9, 18, 18).fill().restore();
      doc.fillColor("#1a1a1a").font("bold").fontSize(9).text(String.fromCharCode(65 + i), mx - 9, my - 6, { width: 18, align: "center", lineBreak: false });
      // Label block (side depends on which half of the figure the marker sits in).
      const rawTitle = `${r.label.slice(0, 16)} · ${r.access}`;
      const title = rawTitle.length > 26 ? rawTitle.slice(0, 25) + "…" : rawTitle;
      const right = mx >= cx;
      const tw = 128;
      const tx = right ? Math.min(mx + 13, x0 + figW - tw - 4) : Math.max(mx - 13 - tw, x0 + 4);
      const align: "left" | "right" = right ? "left" : "right";
      doc.font("bold").fontSize(7.5).fillColor("black").text(title, tx, my - 17, { width: tw, align, lineBreak: false, ellipsis: true });
      doc.font("body").fontSize(7).fillColor("#1d4ed8").text(`In  ${r.inAm} (${r.inPm})`, tx, my - 5, { width: tw, align, lineBreak: false });
      doc.fillColor("#b91c1c").text(`Out ${r.outAm} (${r.outPm})`, tx, my + 5, { width: tw, align, lineBreak: false });
    }
    doc.restore();
    doc.y = y0 + figH + 6;
    doc.font("body").fontSize(7.5).fillColor(TEXT_GRAY).text(
      uk
        ? "Site-access schematic (not to scale). Vehicular accesses placed by bearing from the site; volumes are net new project trips as AM (PM), In = entering / Out = exiting, scaled from each access's share of the permitted movements (arrangement per DMRB CD 123 / Manual for Streets)."
        : "Site-access schematic (not to scale). Driveways placed by bearing from the site; volumes are net new project trips as AM (PM), In = entering / Out = exiting, scaled from each driveway's share of the allowed movements.",
      x0, doc.y, { width: figW, align: "left" });
    doc.fillColor("black");
    doc.moveDown(0.5);
  }
  return rows;
}

// Set true by renderDrivewayAccessBlock when it renders, and reset to false at
// the top of each dispatchTisRender. Lets a state renderer place the driveway
// figure inside its own Site Access section (GA/CA/TX/FL) while the generic
// wrapper fallback skips it — no double-render, and renderers without a Site
// Access section (IL, generic, worksheet/abbreviated tiers, London) still get
// the fallback block. Single-threaded render, so a module flag is safe here.
let drivewayBlockRendered = false;

/**
 * Site-access driveway figure + turn-restriction table + reroute note.
 *
 * Opt-in: absent/empty `result.driveways` ⇒ renders nothing and returns false,
 * so every report without driveways is byte-identical to today. UK regions get
 * UK access terminology (DMRB CD 123 / Manual for Streets); US output unchanged.
 *
 * Call from within a state renderer's Site Access section (pass that section's
 * heading fn + a heading), or from the generic wrapper fallback. Sets the
 * module `drivewayBlockRendered` flag so the fallback never double-renders.
 */
function renderDrivewayAccessBlock(
  doc: PDFKit.PDFDocument,
  result: Record<string, unknown>,
  region: Region | null,
  headingFn: (doc: PDFKit.PDFDocument, title: string) => void,
  headingText: string,
): boolean {
  const dw = (result as any).driveways;
  if (!dw || !Array.isArray(dw.driveways) || dw.driveways.length === 0) return false;
  // UK studies use UK access terminology; US output is byte-identical.
  const ukAccess = (region?.country ?? "US") === "UK";
  // Reserve room so the heading + ~340pt figure stay on one page.
  if (doc.y + 400 > doc.page.height - PAGE_MARGIN) doc.addPage();
  headingFn(doc, headingText);
  const figRows = renderDrivewayFigure(doc, result, ukAccess);
  if (figRows.length > 0) {
    table(doc, {
      headers: ukAccess
        ? ["Access", "Arrangement", "In AM (PM)", "Out AM (PM)"]
        : ["Driveway", "Access", "In AM (PM)", "Out AM (PM)"],
      widths: [200, 100, 105, 105],
      align: ["left", "left", "right", "right"],
      rows: figRows.map((r) => [r.label, r.access, `${r.inAm} (${r.inPm})`, `${r.outAm} (${r.outPm})`]),
    });
    const rerouters = figRows.filter((r) => r.forcesReroute).map((r) => r.label);
    if (rerouters.length > 0) {
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
        ukAccess
          ? `${rerouters.join(", ")}: turns banned by the access arrangement (per DMRB CD 123 / Manual for Streets access design) re-route to the nearest signal-controlled junction, adding turning volume there (reflected in the assessed junctions' capacity results).`
          : `${rerouters.join(", ")}: forbidden movements reroute as U-turns at the nearest signal, adding turning volume there (reflected in the affected intersections' LOS).`,
        { paragraphGap: 6 });
      doc.fillColor("black");
    }
  }
  drivewayBlockRendered = true;
  return true;
}

function dispatchTisRender(
  doc: PDFKit.PDFDocument,
  result: Record<string, unknown>,
  project: StoredProject,
) {
  // Velocity's brand palette is applied to the SHARED heading/table/metric
  // helpers only while the London (`london_metro`) body + appendix render.
  // Gated here (not inside renderTisLondon, which also serves non-London UK
  // regions like Manchester) and reset in finally so no other region — and
  // not even a non-London UK TA — picks up the green.
  const region = project.studyType === "tis" ? detectRegion(project) : null;
  const isVelocityLondon = region?.code === "london_metro";
  if (isVelocityLondon) velocityPaletteActive = true;
  drivewayBlockRendered = false;
  try {
    // 1. Run the region-specific body renderer (GA/FL/NY/CA/TX/IL/UK/…). The
    //    full-tier US renderers (GA/CA/TX/FL) place the driveway figure inside
    //    their own numbered Site Access section via renderDrivewayAccessBlock,
    //    which sets drivewayBlockRendered.
    selectRegionalTisRenderer(doc, result, project);

    // 1b. Driveway access fallback — for renderers that did NOT integrate the
    //     figure into their own Site Access section (IL, generic, worksheet /
    //     abbreviated tiers, and the UK/London renderer), place it here. Opt-in:
    //     absent/empty driveways ⇒ nothing renders (byte-identical to today).
    if (!drivewayBlockRendered) {
      const ukAccess = (region?.country ?? "US") === "UK";
      renderDrivewayAccessBlock(doc, result, region,
        gaSubsection, ukAccess ? "Vehicular Access Arrangements" : "Site Access — Driveways");
    }

    // 2. Append the shared per-intersection capacity appendix for EVERY
    //    region — turning-movement diagrams per analyzed peak period + the
    //    per-approach HCM capacity table. This was previously FL-only, which
    //    is why an Atlanta (GA) study showed no worksheets.
    const intersections = Array.isArray(result.affectedIntersections)
      ? (result.affectedIntersections as any[]) : [];
    const periods = Array.isArray(result.periodReports)
      ? (result.periodReports as any[]) : [];
    if (intersections.length > 0) {
      // Four-step travel demand model write-up (generation → gravity
      // distribution → mode choice → BPR assignment), then the
      // per-intersection capacity worksheets.
      renderFourStepSection(doc, result);
      renderCapacityAppendix(doc, intersections, periods,
        Number(result.intersectionsInStudyArea) || intersections.length,
        Number(result.studyRadiusMi) || 0.5);
    }
  } finally {
    velocityPaletteActive = false;
  }
}

function selectRegionalTisRenderer(
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
    // CEQR Chapter 16 overlay — only for NYC sites (inside the CBDTP
    // cordon serves as a proxy for "in the five boroughs that need
    // CEQR"). The CEQR overlay appears after the HDM Chapter 5
    // shell so a reviewer sees both framings.
    const reqAny = result?.request as { latitude?: number | string; longitude?: number | string } | undefined;
    const lat = reqAny?.latitude !== undefined ? Number(reqAny.latitude) : NaN;
    const lon = reqAny?.longitude !== undefined ? Number(reqAny.longitude) : NaN;
    const cbdtp = getCbdtpStatus(lat, lon);
    if (cbdtp.inCordon || cbdtp.nearCordon) {
      renderCeqrNyc(doc, result, project, region);
    }
    return;
  }
  // All remaining US states — use the multi-state generic renderer with
  // per-state config (agency name, LOS standard, PE seal statute, etc.).
  // The dedicated renderers above handle FL, GA, IL, TX, CA, NY explicitly;
  // any other US state code falls through to renderTisState.
  if ((region?.country ?? "US") === "US" && region?.stateCode) {
    renderTisState(doc, result, project, region);
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
  // here so a reviewing PE can verify which public-data rate set the
  // screening used — primary vs. one of the alternate variables (employees,
  // etc.) added by the multi-variable pass.
  section(doc, "PM Peak Trip Generation");
  const tgRowsTop: Array<[string, string]> = [
    ["Independent variable", `${tg.unit ?? "—"} (${tg.unitShort ?? "—"})`],
  ];
  {
    const label = rateConfidenceLabel(tg.variableConfidence, tg.variableNote);
    if (label) tgRowsTop.push(["Rate basis", label]);
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
    tripGenExternalNote(doc, periods);
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

  // Scenario sensitivity (replaces the statistical Monte-Carlo block per
  // standard TIA practice — discrete scoping-meeting-bound variants, not
  // bootstrap perturbation of trip rates and existing volumes). The
  // underlying Monte-Carlo engine in tis.ts is retained for demo-mode
  // diagnostics but is not rendered in the deliverable.
  section(doc, "Scenario Sensitivity");
  doc.font("body").fontSize(10).fillColor("black").text(
    `At the applied background growth rate of ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s), ${r.intersectionsWithLosDrop ?? 0} intersection${(r.intersectionsWithLosDrop ?? 0) === 1 ? "" : "s"} project a LOS drop and ${r.intersectionsAtLosEf ?? 0} operate${(r.intersectionsAtLosEf ?? 0) === 1 ? "s" : ""} at LOS E or F under build conditions. Conclusions are sensitive to four scoping-meeting assumptions and should be exercised at discrete variants in the formal TIA:`,
    { paragraphGap: 4 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  doc.text(`• Trip-generation method (rate vs. equation per standard fitted-curve-vs-average screening methodology) — equation preferred when the rate plot has ≥ 20 data points or R² ≥ 0.75 with the fitted curve falling within the data cluster.`, { paragraphGap: 2 });
  doc.text(`• Internal capture credit: ${r.internalCapturePctApplied ?? 0}% applied. Removing the credit increases assigned external trips at the affected intersections; confirm internal capture % at the scoping methodology meeting.`, { paragraphGap: 2 });
  doc.text(`• Pass-by credit: ${r.passByPctApplied ?? 0}% applied. Removing the credit increases assigned external trips proportionally; confirm at scoping. (Florida sites: pass-by cannot exceed 10% of adjacent peak-hour two-way street traffic per MTSIH 2024 §4.6.6.6.)`, { paragraphGap: 2 });
  doc.text(`• Background growth rate: ${r.growthAppliedPct ?? "—"}%/yr applied. A ±0.5%/yr variation would shift buildout-year volumes proportionally; the LOS-deficient list is expected to be stable within that band when v/c margins at the worst-impact location exceed 0.05.`, { paragraphGap: 6 });
  doc.fillColor("black");
  doc.moveDown(0.5);

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
  const summary = `This report presents the analysis of anticipated traffic impacts associated with the proposed ${project.projectName || "development"} located within ${region.displayName}, Georgia. The study evaluates ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile study radius using methodology consistent with the Highway Capacity Manual 6th Edition and public-data trip-generation screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716). Trip generation is calculated for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}) at a development size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`;
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
    ["Land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Region", region.displayName],
  ]);
  doc.moveDown(0.5);

  gaSubsection(doc, "1.3 Site Access");
  if ((r.driveways?.driveways?.length ?? 0) > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "The proposed site driveways and their permitted turning movements are modeled below. Movements banned at a driveway are re-routed onto the surrounding network, and the resulting turning volumes are carried into the intersection LOS analysis. Final driveway geometry and sight-distance evaluation per GRTA Site Plan Guidelines should be confirmed against the final site plan.",
      { paragraphGap: 6 });
    doc.fillColor("black");
    renderDrivewayAccessBlock(doc, r, region, gaSubsection, "Proposed Site Driveways");
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Site access analysis for proposed driveways is not included in this screening-level analysis. Driveway-level ingress/egress evaluation per GRTA Site Plan Guidelines should be prepared separately based on the final site plan.",
      { paragraphGap: 6 },
    );
  }

  gaSubsection(doc, "1.4 Bicycle and Pedestrian Facilities");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Existing bicycle and pedestrian facility inventory within the study area should be confirmed against current GDOT and local agency mapping. ARC-programmed bicycle and pedestrian improvements per the Regional Transportation Plan (RTP) should be reviewed during the methodology meeting.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "1.5 Transit Facilities");
  {
    const gaTransitCtx = (r as any).transitContext as TransitContext | undefined;
    if (gaTransitCtx && gaTransitCtx.stops.length > 0) {
      const src = gaTransitCtx.source === "transit_land" ? "Transit.land v2" : "OSM Overpass";
      const agencyEntries = Object.entries(gaTransitCtx.routesByAgency).filter(([, refs]) => refs.length > 0);
      const phrase = agencyEntries.length > 0
        ? agencyEntries.map(([a, refs]) => `${a} route${refs.length === 1 ? "" : "s"} ${refs.join(", ")}`).join("; ")
        : null;
      doc.font("body").fontSize(10).fillColor("black").text(
        `Within ${gaTransitCtx.radiusMi.toFixed(2)} mi of the site (live ${src} extract): ${gaTransitCtx.stops.length} transit stop${gaTransitCtx.stops.length === 1 ? "" : "s"}${phrase ? ` served by ${phrase}` : ""}. Proximity to transit informs trip-mode reductions under ARC's Air Quality Benchmark; the applicant should confirm route frequency and ridership with the controlling transit operator.`,
        { paragraphGap: 6 },
      );
      const near = gaTransitCtx.stops.slice(0, 5);
      table(doc, {
        headers: ["Stop", "Agency", "Mode", "Routes", "Distance (mi)"],
        widths: [180, 110, 60, 100, 75],
        align: ["left", "left", "left", "left", "right"],
        rows: near.map((s) => [
          s.stopName, s.agency ?? "—", s.mode,
          s.routeRefs.length > 0 ? s.routeRefs.join(", ") : "Verify",
          s.distanceMi.toFixed(2),
        ]),
      });
    } else {
      doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
        "No transit stops detected within 0.25 mi of the site via the live Transit.land / OSM Overpass query. Transit service area should be confirmed against current MARTA, GRTA Xpress, CCT, GCT, and local transit operator route maps. Proximity to transit influences trip-mode reductions under ARC's Air Quality Benchmark.",
        { paragraphGap: 6 },
      );
      doc.fillColor("black");
    }
  }
  doc.moveDown(0.5);

  // --- §2 Methodology and Assumptions ------------------------------------
  gaSection(doc, "2.0 TRAFFIC ANALYSIS METHODOLOGY AND ASSUMPTIONS");
  gaSubsection(doc, "2.1 Growth Rate");
  if (r.growthSource) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Background traffic growth is applied at ${r.growthAppliedPct?.toFixed(2) ?? "—"}% per year, derived from measured per-segment compound annual growth at GDOT count stations within the study metro. Source: ${r.growthSource}. The metro-level median is published here for transparency. For DRI submittals, the growth rate is typically refined to per-segment trend on the affected facilities and agreed upon during the pre-application methodology meeting with GRTA, ARC, GDOT, and the local jurisdiction.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Background traffic growth is applied at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"}. This rate is consistent with GDOT historical traffic count growth observed along adjacent roadways within the study area. For DRI submittals, the growth rate is typically agreed upon during the pre-application methodology meeting with GRTA, ARC, GDOT, and the local jurisdiction.`,
      { paragraphGap: 6 },
    );
  }

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
    `Gross trip generation is calculated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed development size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Average rates are used where fitted-curve equations are not available.`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Entering trips", "Exiting trips"],
    widths: [180, 100, 100],
    align: ["left", "right", "right"],
    rows: [
      ["Daily", fmtNum(((tg.dailyTrips ?? 0) as number) / 2), fmtNum(((tg.dailyTrips ?? 0) as number) / 2)],
      ["AM peak hour", fmtNum(tg.amIn), fmtNum(tg.amOut)],
      ["PM peak hour", fmtNum(tg.pmIn), fmtNum(tg.pmOut)],
    ],
  });
  doc.moveDown(0.5);

  renderDiurnalCharts(doc, r);

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
    "Net new trips applied to the study network are calculated by subtracting pass-by capture and internal capture from the gross trip generation. Gross trip rates are drawn from public data (SANDAG 2002 / NHTS 2017 / NCHRP 716); a submittal-grade study should confirm rates against the jurisdiction-approved source.",
    { paragraphGap: 6 },
  );
  // Surface which public-data independent variable the screening used so the
  // reviewing engineer can verify the assumption (GRTA reviewers ask for
  // this explicitly). Interpolated/blended secondaries are flagged so the
  // submittal-grade study can re-run against an approved rate if needed.
  const gaTopRows: Array<[string, string]> = [
    ["Independent variable", `${tg.unit ?? "—"} (${tg.unitShort ?? "—"})`],
  ];
  {
    const label = rateConfidenceLabel(tg.variableConfidence, tg.variableNote);
    if (label) gaTopRows.push(["Rate basis", label]);
  }
  rows(doc, [
    ...gaTopRows,
    ["Pass-by capture applied", `${r.passByPctApplied ?? 0}%`],
    ["Internal capture applied", `${r.internalCapturePctApplied ?? 0}%`],
    ["Background growth applied", `${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s)`],
    ["Weather condition", String(r.weather ?? req.weather ?? "clear")],
  ]);
  if (tg.variableConfidence === "interpolated" || tg.variableConfidence === "blended_mpo") {
    doc.moveDown(0.3);
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
      "Note: the trip rate for the chosen independent variable was derived from a defensible engineering ratio or blended MPO screening guidance rather than a single jurisdiction-approved published rate. A submittal-grade study should verify this assumption against the controlling agency's approved trip-generation source for this land use.",
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
    tripGenExternalNote(doc, periods);
    doc.moveDown(0.5);
  }

  // --- §5 Trip Distribution and Assignment -------------------------------
  gaSection(doc, "5.0 TRIP DISTRIBUTION AND ASSIGNMENT");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Net new trips are assigned to the study network proportionally to signal proximity and approach geometry. The per-intersection trip allocation for each affected signal is reflected in the Section 6.0 Traffic Analysis tables below.",
    { paragraphGap: 6 },
  );
  renderTripDistributionSection(doc, r as any, {
    subsectionNumber: "5.1",
    assignmentNumber: "5.2",
    headingFn: gaSubsection,
    cap: 20,
    intersections,
    periods,
  });

  // --- §6 Traffic Analysis -----------------------------------------------
  gaSection(doc, "6.0 TRAFFIC ANALYSIS");
  const gaHasDesignYear = intersections.some(
    (it) => it.designNoBuildLos != null || it.designBuildLos != null,
  );
  const gaDesignYr = r.designYear ?? (req.openingYear ? Number(req.openingYear) + 20 : null);
  if (gaHasDesignYear) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Four scenarios are evaluated at each affected intersection per GRTA / GDOT convention for projects exceeding screening thresholds: (1) Existing — current-year volumes from the GDOT 511 system, no growth applied; (2) No-Build at opening year ${req.openingYear ?? "—"} — existing volumes grown at ${r.growthAppliedPct ?? "—"}%/yr over ${r.growthYears ?? "—"} year(s); (3) Build at opening year ${req.openingYear ?? "—"} — No-Build volumes plus project external trips at the assigned distribution; (4) 20-Year Design Year (${gaDesignYr ?? "—"}) No-Build and Build — opening-year volumes compounded another 20 years at the same growth rate, project trips at full build-out unchanged.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Three scenarios are evaluated at each affected intersection: (1) Existing — current-year volumes from the GDOT 511 system, no growth applied; (2) No-Build (opening year ${req.openingYear ?? "—"}) — existing volumes grown at ${r.growthAppliedPct ?? "—"}%/yr over ${r.growthYears ?? "—"} year(s) without project trips; (3) Build (opening year ${req.openingYear ?? "—"}) — No-Build volumes plus the proposed development's external trips at the assigned distribution.`,
      { paragraphGap: 6 },
    );
  }

  if (intersections.length > 0 && gaHasDesignYear) {
    table(doc, {
      headers: ["Intersection", "Existing", "Opening NB", "Opening Bld", "Design NB", "Design Bld", "Δ delay (s)"],
      widths: [180, 55, 65, 65, 55, 55, 55],
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
  } else if (intersections.length > 0) {
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
  }
  if (intersections.length > 0) {
    // Mitigation list — GA-style, "Recommended Improvements". Runs for
    // both the 3-scenario and 4-scenario branches.
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
  renderFarsKBlock(doc, r, { subsection: "6.5 Safety / NHTSA FARS Fatal Crash History" });
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
 * (trip count, land-use code, size). Flags GIS-dependent
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

  // (4) Locally-serving retail <50 ksf — auto-evaluable when the land-use code is a retail use
  if (isRetail) {
    if (Number.isFinite(sizeKsf)) {
      results.push({
        label: "Locally-serving retail <50,000 sf (LA County / OPR convention)",
        status: sizeKsf < 50 ? "screened_out" : "not_screened_out",
        note: `Project is land use ${luCode} (retail category) at ${sizeKsf} ksf. Threshold: 50 ksf.`,
      });
    } else {
      results.push({
        label: "Locally-serving retail <50,000 sf",
        status: "requires_verification",
        note: `Project is land use ${luCode} (retail) but size unit (${unit || "—"}) is not in ksf; cannot auto-compare. Convert to ksf and reapply.`,
      });
    }
  } else {
    results.push({
      label: "Locally-serving retail <50,000 sf",
      status: "not_applicable",
      note: `Project is land use ${luCode}${isResidential ? " (residential)" : ""}, not a retail category. This criterion applies only to local-serving retail uses.`,
    });
  }

  // (5) 100% affordable residential infill — requires applicant-side attestation
  if (isResidential) {
    results.push({
      label: "100% affordable residential infill (OPR Tech Advisory p. 14–15)",
      status: "requires_verification",
      note: "Project is residential. Applicant must attest to 100% affordable unit mix + infill-location qualification. Not auto-determined from land use alone.",
    });
  } else {
    results.push({
      label: "100% affordable residential infill",
      status: "not_applicable",
      note: `Project is land use ${luCode}, not residential.`,
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
    ["Land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Host lead agency", jur.name],
    ["Regional MPO", jur.mpoName],
  ]);
  doc.moveDown(0.5);

  caSubsection(doc, "1.3 Site Access and Multimodal Context");
  if ((r.driveways?.driveways?.length ?? 0) > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "The proposed site driveways and their permitted turning movements are modeled below; movements banned at a driveway re-route onto the surrounding network and the added turning volumes are carried into the intersection analysis. Internal circulation, bicycle/pedestrian connectivity and transit-access detail remain dependent on the final site plan and are recommended for site-plan-stage analysis at formal submittal.",
      { paragraphGap: 6 });
    doc.fillColor("black");
    renderDrivewayAccessBlock(doc, r, region, caSubsection, "Proposed Site Driveways");
    doc.moveDown(0.3);
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Driveway-level ingress/egress, internal circulation, bicycle/pedestrian network connectivity, and transit access detail are dependent on the final site plan and are not produced by this screening tool. Site-plan-stage analysis is recommended for any formal submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
    doc.moveDown(0.3);
  }

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
    `The six OPR screening criteria below are auto-evaluated against project metadata where the engine has the inputs (daily trip count, land-use category, project size). Criteria that require GIS layers the engine does not yet ingest (Transit Priority Area, low-VMT TAZ map, prior-use VMT for redevelopment) are flagged "Requires verification" with the data source named. If ANY criterion resolves to "Screened out," the project is presumed less-than-significant for CEQA-VMT purposes and a full VMT impact analysis is not required.`,
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
  if (r.growthSource) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Gross trip generation is calculated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed development size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Background traffic growth is applied at ${r.growthAppliedPct?.toFixed(2) ?? "—"}% per year, derived from measured per-segment compound annual growth at Caltrans count stations within the study metro. Source: ${r.growthSource}. Pass-by capture applied: ${r.passByPctApplied ?? 0}%; internal capture applied: ${r.internalCapturePctApplied ?? 0}%.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Gross trip generation is calculated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed development size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Background traffic growth is applied at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"}. Pass-by capture applied: ${r.passByPctApplied ?? 0}%; internal capture applied: ${r.internalCapturePctApplied ?? 0}%.`,
      { paragraphGap: 6 },
    );
  }
  table(doc, {
    headers: ["Period", "Entering trips", "Exiting trips"],
    widths: [180, 100, 100],
    align: ["left", "right", "right"],
    rows: [
      ["Daily", fmtNum(((tg.dailyTrips ?? 0) as number) / 2), fmtNum(((tg.dailyTrips ?? 0) as number) / 2)],
      ["AM peak hour", fmtNum(tg.amIn), fmtNum(tg.amOut)],
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
    tripGenExternalNote(doc, periods);
    doc.moveDown(0.5);
  }

  renderDiurnalCharts(doc, r);

  renderTripDistributionSection(doc, r as any, {
    subsectionNumber: "4.3",
    assignmentNumber: "4.4",
    headingFn: caSubsection,
    cap: 20,
    intersections,
    periods,
  });

  const caHasDesignYear = intersections.some(
    (it) => it.designNoBuildLos != null || it.designBuildLos != null,
  );
  const caDesignYr = r.designYear ?? (req.openingYear ? Number(req.openingYear) + 20 : null);
  caSubsection(doc, caHasDesignYear
    ? "4.5 Affected Intersections — Existing / Opening / 20-Year Design"
    : "4.5 Affected Intersections — Existing / No-Build / Build");
  if (caHasDesignYear) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Four scenarios are evaluated at each affected intersection per Caltrans / local-jurisdiction operational-analysis convention (LOS-only context, not CEQA-VMT): (1) Existing — current-year volumes, no growth; (2) Opening-Year No-Build (${req.openingYear ?? "—"}) — existing grown at ${r.growthAppliedPct ?? "—"}%/yr; (3) Opening-Year Build — No-Build plus project external trips; (4) 20-Year Design Year (${caDesignYr ?? "—"}) No-Build and Build — opening volumes compounded another 20 years, project trips at full build-out unchanged.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Three scenarios are evaluated at each affected intersection: (1) Existing — current-year volumes from live data feeds, no growth applied; (2) No-Build (opening year ${req.openingYear ?? "—"}) — existing volumes grown at ${r.growthAppliedPct ?? "—"}%/yr over ${r.growthYears ?? "—"} year(s) without project trips; (3) Build (opening year ${req.openingYear ?? "—"}) — No-Build volumes plus the proposed development's external trips at the assigned distribution.`,
      { paragraphGap: 6 },
    );
  }

  if (intersections.length > 0 && caHasDesignYear) {
    table(doc, {
      headers: ["Intersection", "Existing", "Opening NB", "Opening Bld", "Design NB", "Design Bld", "Δ delay (s)"],
      widths: [180, 55, 65, 65, 55, 55, 55],
      align: ["left", "center", "center", "center", "center", "center", "right"],
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
          String(it.designNoBuildLos ?? "—"),
          String(it.designBuildLos ?? "—"),
          fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
        ];
      }),
    });
  } else if (intersections.length > 0) {
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
  if (intersections.length > 0) {

    caSubsection(doc, "4.6 Recommended Operational Improvements (Non-CEQA)");
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
  renderFarsKBlock(doc, r, { subsection: "4.5 Safety — NHTSA FARS Fatal Crash History" });
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
 * Map each OPR § E.1 screening criterion to its Dec 2018 Technical
 * Advisory page citation. Index order matches caVmtScreening() above
 * (small project / TPA / low-VMT / retail / affordable / redevelopment).
 */
function caScreeningCriterionCitation(index: number): string {
  switch (index) {
    case 0: return "OPR Tech Advisory (Dec 2018), p. 12 — small-project floor (CEQA § 15301(e)(2))";
    case 1: return "OPR Tech Advisory (Dec 2018), p. 14 — TPA presumption (PRC § 21064.3 + § 21155)";
    case 2: return "OPR Tech Advisory (Dec 2018), p. 13–14 — low-VMT area map screen";
    case 3: return "OPR Tech Advisory (Dec 2018), p. 14 — locally-serving retail size cap";
    case 4: return "OPR Tech Advisory (Dec 2018), p. 14–15 — 100% affordable residential infill";
    case 5: return "OPR Tech Advisory (Dec 2018), p. 14 — redevelopment with net VMT decrease";
    default: return "OPR Tech Advisory (Dec 2018), § E.1";
  }
}

/**
 * California Screened-Out Determination Memo (worksheet tier).
 * Short-form deliverable the OPR § E.1 cascade supports when a project
 * clears one of the six screening criteria (typical case: daily trips
 * below the host-jurisdiction screening floor — 110 OPR default; 250
 * LA / Sacramento; 500 Long Beach / Fresno). Five sections — project
 * description, the screening cascade table, citation chain, PE seal,
 * and a non-CEQA operational carve-out — sized to land at 4–5 pages
 * so the reviewer sees the determination + chain on the first sweep.
 *
 * Shares all helpers (caVmtScreening, caSection, rows, table,
 * statusLabel, fmtNum, BRAND_BLUE, TEXT_GRAY, the CaliforniaJurisdiction
 * type) with renderTisCalifornia above — no duplication. The dispatch
 * site in renderTisCalifornia short-circuits here when resolvedTier ===
 * "worksheet".
 */
function renderTisCaliforniaWorksheet(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
  tierInput: TierInput,
  jur: CaliforniaJurisdiction,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const tierName = jurisdictionTierLabel(region, "worksheet");

  const screeningResults = caVmtScreening(
    tierInput.dailyTrips,
    tierInput.landUseCode,
    tierInput.size,
    tierInput.unit,
    jur.screeningTripCount,
    jur.name,
  );
  const firedIndex = screeningResults.findIndex((c) => c.status === "screened_out");
  const firedCriterion = firedIndex >= 0 ? screeningResults[firedIndex] : null;

  // --- Header banner + determination ------------------------------------
  caSection(doc, "CEQA-VMT SCREENED-OUT DETERMINATION MEMO");
  doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(tierName, { paragraphGap: 4 });
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    `Short-form deliverable issued when the OPR § E.1 six-criterion cascade screens a project out of full CEQA-VMT analysis. Per ${jur.guidelinesDoc.split("(")[0].trim()} and the OPR Dec 2018 Technical Advisory, a project satisfying any of the six criteria is presumed less-than-significant under CEQA Guidelines § 15064.3 without further VMT analysis. Does NOT substitute for the §5 non-CEQA operational review.`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  if (firedCriterion) {
    doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(
      `AUTO-SCREENING RESULT: SCREENED OUT via ${firedCriterion.label} — presumed less-than-significant under CEQA Guidelines § 15064.3.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(
      "AUTO-SCREENING RESULT: No auto-evaluable criterion fired. Tier resolved to Worksheet by explicit request — verify the screening basis (TPA / low-VMT map / redevelopment baseline) before relying on this memo.",
      { paragraphGap: 6 },
    );
  }
  doc.fillColor("black");

  // --- §1 Project Description -------------------------------------------
  caSection(doc, "1.0 PROJECT DESCRIPTION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The proposed ${project.projectName || "development"} is located within ${region.displayName}, California. Host CEQA lead agency: ${jur.name}; regional MPO: ${jur.mpoName}.`,
    { paragraphGap: 6 },
  );
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Host lead agency", jur.name],
    ["Daily trips · screening floor", `${fmtNum(tierInput.dailyTrips)} · ${jur.screeningTripCount}`],
  ]);
  doc.moveDown(0.2);

  // --- §2 Auto-Screening Result -----------------------------------------
  // The determination banner above and §3's citation block already carry
  // the OPR § E.1 framing — drop §2's preamble paragraph to keep the
  // cascade table the focus and save ~3 lines of vertical space.
  caSection(doc, "2.0 AUTO-SCREENING RESULT (OPR § E.1)");
  table(doc, {
    headers: ["OPR Criterion", "Result", "Notes"],
    widths: [200, 130, 170],
    align: ["left", "center", "left"],
    rows: screeningResults.map((c) => [c.label, statusLabel(c.status), c.note]),
  });
  doc.moveDown(0.2);
  if (firedCriterion) {
    doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(
      `DETERMINATION: SCREENED OUT via "${firedCriterion.label}" — § 15064.3(b)(1).`,
      { paragraphGap: 4 },
    );
  }
  doc.fillColor("black");

  // --- §3 Citation Block -------------------------------------------------
  caSection(doc, "3.0 CITATION BLOCK");
  rows(doc, [
    ["Screening criterion fired", firedCriterion ? firedCriterion.label : "None auto-fired — verification pending (see §2)"],
    ["OPR Tech Advisory", firedIndex >= 0 ? caScreeningCriterionCitation(firedIndex) : "OPR Tech Advisory (Dec 2018), § E.1"],
    ["SB 743 / CEQA", "PRC § 21099(b)(2) · 14 CCR § 15064.3(b)(1)"],
    ["Host jurisdiction guidelines", jur.guidelinesDoc],
  ]);
  doc.moveDown(0.2);
  if (jur.extraNote) {
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
      `Jurisdiction note. ${jur.extraNote}`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- §4 Professional Engineer Certification ----------------------------
  caSection(doc, "4.0 PROFESSIONAL ENGINEER CERTIFICATION");
  doc.font("body").fontSize(10).fillColor("black").text(
    "California Business & Professions Code § 6730 (Civil Engineers) and § 6731.5 (Traffic Engineers) reserve transportation-impact determinations submitted to a public agency to PEs licensed by BPELSG. The cover and signature page of the formal submittal must bear the seal, signature, and date of a California-licensed Civil Engineer or Traffic Engineer per 16 CCR Div. 5, Article 6, § 411 (Seals — content, form, and use). The signing PE attests only to (a) the screening criterion auto-fire identified in §2 and (b) the citation chain in §3 as applied to §1's project parameters — NOT to any non-CEQA operational analysis (§5), which is a separate scope under the Caltrans EPM / HDM stack.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- §5 Non-CEQA Operational Note --------------------------------------
  caSection(doc, "5.0 NON-CEQA OPERATIONAL NOTE");
  doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(
    "A screened-out CEQA determination does NOT exempt the project from non-CEQA operational review.",
    { paragraphGap: 4 },
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    `LOS is not a CEQA metric under § 21099(b)(2), but it remains the operational metric Caltrans and most local agencies apply for permit and site-access review. Check both carve-outs against the final site plan: (1) Caltrans Encroachment Permit (EPM) if the project fronts on or proposes new access to a State Highway System facility — HCM LOS, queueing, and CA MUTCD 2026 Part 4C signal-warrant analysis are typically required; (2) HDM Ch. 100 (Basic Design Policies) + Ch. 400 (Intersections at Grade) for driveway geometry, intersection sight distance (AASHTO Green Book), and turn-lane warrants on any project access. Host-jurisdiction operational context: ${jur.operationalContext}.`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
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
    ["Proposed land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Existing land use", "Subject to site verification (Gwinnett Level 1 does not require existing-use trip credit)"],
  ]);
  doc.moveDown(0.5);

  // --- §3 Trip Generation Estimate -------------------------------------
  gaSection(doc, "3.0 TRIP GENERATION ESTIMATE");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is estimated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. No pass-by or internal capture credits have been applied at this screening tier (Gwinnett Level 1 explicitly excludes those from the worksheet scope).`,
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
    ["Proposed land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Existing land use", "Subject to site verification (existing-use trip credit may apply at this tier; confirm with reviewing agency)"],
  ]);
  doc.moveDown(0.5);

  // --- §3 Trip Generation Estimate --------------------------------------
  gaSection(doc, "3.0 TRIP GENERATION ESTIMATE");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is estimated from public-data screening rates (SANDAG 2002 / NHTS 2017 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`,
    { paragraphGap: 6 },
  );
  const gaAbbrTopRows: Array<[string, string]> = [
    ["Independent variable", `${tg.unit ?? "—"} (${tg.unitShort ?? "—"})`],
  ];
  {
    const label = rateConfidenceLabel(tg.variableConfidence, tg.variableNote);
    if (label) gaAbbrTopRows.push(["Rate basis", label]);
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
  if (r.growthSource) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Future-year ADT volumes are calculated by applying background traffic growth at ${r.growthAppliedPct?.toFixed(2) ?? "—"}% per year (derived from the measured per-segment compound annual growth rate at GDOT count stations within the study metro; source: ${r.growthSource}) to existing volumes, then layering the proposed development's site-generated daily trips (${fmtNum(tierInput.dailyTrips)} vpd gross) net of any pass-by and internal capture credits.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Future-year ADT volumes are calculated by applying background traffic growth at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s) to existing volumes, then layering the proposed development's site-generated daily trips (${fmtNum(tierInput.dailyTrips)} vpd gross) net of any pass-by and internal capture credits. Growth rate is consistent with GDOT historical TADA growth observed along comparable roadways in the study area.`,
      { paragraphGap: 6 },
    );
  }
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
    tripGenExternalNote(doc, periods);
  }
  doc.moveDown(0.3);
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Pass-by and internal capture rates follow standard pass-by / internal-capture screening methodology for the applicable land use. Where the screened rate exceeds the published 85th-percentile screening value, the reduction is held back to the 85th percentile.",
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
 * Generic FARS fatal-crash history block. Reads from
 * `result.farsKSummary` (populated by the universal NHTSA FARS hook
 * in renderStudyPdf for any US site) and renders a K-severity
 * summary that every state renderer can call.
 *
 * No-op when no FARS data is present (e.g. before ingest runs or
 * outside the 6-year FARS window).
 */
function renderFarsKBlock(doc: PDFKit.PDFDocument, r: any, opts?: { subsection?: string }): void {
  const fars = (r as any).farsKSummary as
    | {
        windowYears: number;
        radiusMi: number;
        totalCrashes: number;
        bySeverity: { K: number; A: number; B: number; C: number; O: number; UNKNOWN: number };
        recentSevere: Array<{ occurredAt: string; severity: string; onStreet: string | null; crossStreet: string | null; mannerOfCollision: string | null }>;
      }
    | undefined;
  if (!fars || fars.totalCrashes === 0) return;
  gaSubsection(doc, opts?.subsection ?? "Fatal Crash History (NHTSA FARS supplement)");
  doc.font("body").fontSize(10).fillColor("black").text(
    `${fars.totalCrashes} fatal crash${fars.totalCrashes === 1 ? "" : "es"} within ${(fars.radiusMi ?? 0).toFixed(2)} mi of the site over a ${fars.windowYears}-year window are recorded in the NHTSA Fatality Analysis Reporting System (FARS) public ArcGIS layer (services.arcgis.com / FARS_Fatal_Crashes_2017_2022). FARS is the only public per-crash data source that covers every state uniformly with precise lat/lon — most state DOT systems (GEARS, SWITRS, CRIS, Signal4, etc.) gate per-crash data behind agency login. FARS records only K-severity (fatal) crashes by definition; injury and PDO crashes are not represented in this block and must be sourced from the state's restricted-access system for a formal Highway Safety Manual analysis. The crash date in FARS' public ArcGIS layer carries the calendar year only — the renderer stamps Jan 1 of the crash year and the engineer should not infer time-of-day patterns from this dataset.`,
    { paragraphGap: 6 },
  );
  if (fars.recentSevere.length > 0) {
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(`Most recent ${fars.recentSevere.length} fatal crashes within radius:`, { paragraphGap: 2 });
    doc.fillColor("black");
    table(doc, {
      headers: ["Year", "Severity", "On street", "Cross street", "Manner"],
      widths: [55, 60, 150, 130, 90],
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

/**
 * UK capacity headline for the London executive summary — derived from
 * the SAME per-junction UK capacity computation the Ch 6 capacity table
 * uses (`ukCapacityForIntersection(it, "build")` → DoS / PRC / MMQ), so
 * the headline cards never disagree with the table below. UK TAs do not
 * use HCM Level of Service, so the London exec summary reports junctions
 * assessed, junctions over the UK practical-capacity threshold
 * (signals DoS ≥ 90% / priority+roundabout RFC ≥ 0.85) and the worst
 * Degree of Saturation, in place of the US "LOS drops / At LOS E-F"
 * cards.
 */
function londonCapacityHeadline(intersections: any[]): {
  assessed: number;
  overCapacity: number;
  worstDosPct: number;
} {
  let overCapacity = 0;
  let worstDosPct = 0;
  for (const it of intersections) {
    const cap = ukCapacityForIntersection(it, "build");
    if (!cap.withinCapacity) overCapacity += 1;
    if (cap.dosPct > worstDosPct) worstDosPct = cap.dosPct;
  }
  return { assessed: intersections.length, overCapacity, worstDosPct };
}

/**
 * London Transport Assessment renderer. First non-US state-specific
 * renderer. Frames the engine's HCM-based output in UK Transport
 * Assessment terminology following the TfL Healthy Streets TA
 * Recommended Contents & Chapters TOC (8 chapters).
 *
 * Honest framing: the engine computes HCM 6 Ch.19 capacity from its
 * public-data screening trip rates (SANDAG 2002 / NHTS 2017 / NCHRP
 * 716). A defensible UK TA requires TRICS multi-modal
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

  // Within-day office trip profile for the Fig 2-1 / Fig 6-2 figures. The London
  // renderer uses the LTDS/Velocity (TfL LTDS 2019) office shape via locale "uk"
  // — the only renderer permitted to print that provenance; profileForLandUse
  // gates it (US renderers ship no office shape and omit the office figure).
  // distributeDaily spreads the engine's gross daily screening trip generation
  // across the published office curve.
  const diurnalSel = profileForLandUse(code, (req as any).tripProfile, "uk");
  const drawDiurnal = diurnalSel.matched && Number.isFinite(Number(tg.dailyTrips)) && Number(tg.dailyTrips) > 0;
  const diurnalHourly = drawDiurnal ? distributeDaily(Number(tg.dailyTrips ?? 0), diurnalSel.profile) : null;
  const diurnalHourLabels = Array.from({ length: 24 }, (_, h) => String(h));
  const diurnalBasis = diurnalSel.family ?? "supplied";

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
  doc.font("bold").fontSize(10).fillColor(velocityPaletteActive ? VELOCITY_GREEN : BRAND_BLUE).text(taTriggerSentence, { paragraphGap: 6 });
  doc.font("body").fontSize(10).fillColor("black");

  // UK capacity headline (London only) — derived from the same Ch 6
  // `ukCapacityForIntersection(it, "build")` computation (DoS / PRC /
  // MMQ) so the exec-summary cards match the capacity table. UK TAs do
  // not use HCM Level of Service.
  const ukCap = isLondon ? londonCapacityHeadline(intersections) : null;

  const studyRadiusPhrase = isLondon ? `${radiusKm} km` : `${radiusKm} km (${fmtNum(radiusMi, 2)} mi)`;
  const summary = `This Transport Assessment cross-reference reports the anticipated transport effects of the proposed ${project.projectName || "development"} within ${region.displayName}, ${isLondon ? "Greater London" : "United Kingdom"}. ${intersections.length} junction${intersections.length === 1 ? "" : "s"} fall within a ${studyRadiusPhrase} study radius of the site. The analysis is screening-level and is prepared as a cross-reference to UK Transport Assessment methodology; it does not replace a TRICS-based TA prepared by a chartered engineer reviewing under the NPPF (December 2024), the Planning Practice Guidance on transport assessments, and (within Greater London) the London Plan 2021 and TfL Healthy Streets TA format.`;
  doc.text(summary, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text("Headline findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (isLondon && ukCap) {
    // UK capacity convention (DoS / PRC), not HCM LOS.
    if (ukCap.overCapacity === 0) {
      doc.text(`• No study junction exceeds the UK practical-capacity threshold (signals DoS ≥ 90% / priority and roundabout RFC ≥ 0.85) under the With-Development scenario; the worst Degree of Saturation is ${fmtNum(ukCap.worstDosPct, 1)}%.`, { paragraphGap: 2 });
      doc.text("• Highway capacity is not the limiting factor for this scheme on the basis of this screening; PTAL-banded car parking, sustainable-mode uptake and Healthy Streets compliance remain to be assessed separately.", { paragraphGap: 4 });
    } else {
      doc.text(`• ${ukCap.overCapacity} junction${ukCap.overCapacity === 1 ? " exceeds" : "s exceed"} the UK practical-capacity threshold (signals DoS ≥ 90% / priority and roundabout RFC ≥ 0.85) under the With-Development scenario; the worst Degree of Saturation is ${fmtNum(ukCap.worstDosPct, 1)}%.`, { paragraphGap: 2 });
      doc.text(`• Mitigation would be warranted at the over-capacity junction${ukCap.overCapacity === 1 ? "" : "s"} under either S106 obligation or S278 highway works (depending on the responsible authority), confirmed in LinSig 3 / Junctions 11.`, { paragraphGap: 4 });
    }
  } else if (losDrops === 0 && losEf === 0) {
    doc.text("• No junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario.", { paragraphGap: 2 });
    doc.text("• Highway capacity is not the limiting factor for this scheme on the basis of this screening; PTAL-banded car parking, sustainable-mode uptake and Healthy Streets compliance remain to be assessed separately.", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} junction${losDrops === 1 ? "" : "s"} project to deteriorate by one or more LOS categories under the With-Development scenario.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} junction${losEf === 1 ? " operates" : "s operate"} at LOS E or F under With-Development and would warrant mitigation under either S106 obligation or S278 highway works (depending on the responsible authority).`, { paragraphGap: 4 });
  }
  doc.fillColor("black");
  doc.moveDown(0.5);

  metricStrip(doc, isLondon && ukCap
    ? [
        { label: "Junctions assessed", value: String(ukCap.assessed) },
        { label: "Over capacity", value: String(ukCap.overCapacity) },
        { label: "Worst DoS", value: `${fmtNum(ukCap.worstDosPct, 1)}%` },
      ]
    : [
        { label: "Junctions", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
        { label: "LOS drops", value: String(losDrops) },
        { label: "At LOS E/F", value: String(losEf) },
        { label: "Worst Δ delay", value: `${(r.worstDelayDeltaSec ?? 0).toFixed(1)}s` },
      ]);
  doc.moveDown(0.8);

  // PTAL / public-transport-access block. Extracted into a closure so it
  // can be emitted at the right place per format:
  //   • Holloway / non-London UK format → §3.4 (Site and Surroundings)
  //   • Velocity / London format        → Chapter 6 (Public Transport &
  //     Trip Generation), where Velocity places the PTAL band + map.
  // The block's text (PTAL band, Accessibility Index, WebCAT 3.0, the TfL
  // GIS Open Data URL, "Engine-resolved" phrasing) is preserved VERBATIM —
  // the London smoke test greps for it.
  const renderPtalAccessBlock = (headingNum: string) => {
    ldnSubsection(doc, `${headingNum} Access to Public Transport (incl. PTAL)`);
    // Prefer the structured TisReport.resolvedPtalBand (carries the
    // source — caller vs. TfL WebCAT 3.0 grid lookup). Fall back to the
    // raw request.ptalBand when older payloads were generated before
    // the resolver shipped.
    const resolved = r.resolvedPtalBand as
      | { band?: string; source?: "caller" | "tfl-webcat-2023"; ai?: number }
      | undefined;
    const ptalBand =
      (resolved && typeof resolved.band === "string" && resolved.band.length > 0 ? resolved.band : null) ??
      (typeof req.ptalBand === "string" && req.ptalBand.length > 0 ? req.ptalBand : null);
    const bandSource: "caller" | "tfl-webcat-2023" | "request-fallback" =
      resolved?.source ?? (req.ptalBand ? "request-fallback" : "caller");
    const sourceLabel =
      bandSource === "tfl-webcat-2023"
        ? "Engine-resolved via point-in-polygon lookup against the TfL WebCAT 3.0 PTAL 2023 100 m × 100 m grid (gis-tfl.opendata.arcgis.com, Open Government Licence v3.0). Reconcile against WebCAT 3.0 at the time of submittal."
        : "Caller-supplied (not computed by this engine — should be cross-checked against WebCAT 3.0 at submittal).";
    if (isLondon && ptalBand) {
      const sourceCellRows: [string, string][] = [
        ["Site PTAL band", `PTAL ${ptalBand}`],
        ["Engine auto-mode share applied at this PTAL", `${(Number(r.autoModeShareApplied) * 100).toFixed(0)}% (calibrated against TfL Travel in London + 3 published London TAs)`],
        ["Source of band", sourceLabel],
      ];
      if (typeof resolved?.ai === "number") {
        sourceCellRows.splice(1, 0, ["Accessibility Index (AI) at cell", resolved.ai.toFixed(2)]);
      }
      rows(doc, sourceCellRows);
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
  };

  // --- Ch 1 Introduction --------------------------------------------------
  // Chapter/subsection structure mirrors the Velocity Transport Planning
  // "Former Holloway Prison (Holloway Park)" Healthy Streets TA (LB Islington,
  // 2024) — the deep, GLA-referable London TA adopted as the canonical format.
  ldnSection(doc, "1.0 INTRODUCTION");
  if (isLondon) ldnChapterIntro(doc, "i.e. What is being built, why, and when — and how, specifically, will the scheme support Healthy Streets, Vision Zero and the Mayor's Transport Strategy? (Structure per TfL's Healthy Streets TA Recommended Contents & Chapters, 17 June 2019, modelled on the Velocity Transport Planning / Holloway Park Healthy Streets TA.)");

  ldnSubsection(doc, "1.1 Overview");
  doc.font("body").fontSize(10).fillColor("black").text(
    `This report cross-references the anticipated transport effects of the proposed ${project.projectName || "development"}, located within ${region.displayName}. It is presented in the structure of a UK Transport Assessment (TA) as set out in the TfL Healthy Streets TA Recommended Contents & Chapters (last updated 17 June 2019), with the National Planning Policy Framework (NPPF, December 2024) as the statutory planning hook — paragraph 115 (sustainable modes), paragraph 116 (the residual-impact "severe" refusal test) and paragraph 118 (vision-led TA / TS plus travel plan for developments generating significant amounts of movement).`,
    { paragraphGap: 6 },
  );

  ldnSubsection(doc, "1.2 Existing Site Use");
  {
    const priorUse = String(req.priorUse ?? "").trim();
    const tripGenCh = isLondon ? "Chapter 6" : "Chapter 5";
    ldnNote(doc, priorUse
      ? `The site's existing / most-recent lawful use is ${priorUse}. The vehicular and multi-modal trips generated by that use should be established (TRICS or observed counts) and netted against the proposed trips before the residual impact is reported (see ${tripGenCh}).`
      : `The site's existing / most-recent lawful use and its established trip generation should be set out here and netted against the proposed trips (${tripGenCh}). Set TisRequest.priorUse to populate this automatically; not otherwise produced by the engine.`);
  }

  ldnSubsection(doc, "1.3 What is Being Built?");
  ldnNote(doc, `The proposal is ${project.projectName || "the subject development"} — land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"}. The detailed development schedule (unit mix, GFA by use, affordable provision) and the proposed access arrangements are described in Chapter 3 and the application drawings (Appendix A).`);

  ldnSubsection(doc, "1.4 Why is it Being Built?");
  ldnNote(doc, "NPPF (December 2024) paragraph 118 frames TAs and TSs as \"vision-led\": the assessment should articulate the place outcome the scheme seeks and demonstrate how transport supports that vision before reporting capacity numbers. This narrative is bespoke to the scheme and should be drafted by the chartered engineer with the design team — it is not produced by this screening engine.");

  ldnSubsection(doc, "1.5 When is it Being Built?");
  ldnNote(doc, `The assessed opening year is ${req.openingYear ?? "—"}. The construction phasing and build programme (which drive the Construction Logistics Plan in Chapter 7) are scheme-specific and to be confirmed by the project team.`);

  ldnSubsection(doc, "1.6 Policy Context");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Applicable policy framework, in order: NPPF Chapter 9 (Promoting sustainable transport, December 2024 edition); Planning Practice Guidance — Travel plans, transport assessments and statements${isLondon ? "; the London Plan 2021 (in particular policies T1 Strategic approach to transport, T2 Healthy Streets, T5 Cycling, and T6 Car parking sub-policies banded by PTAL); the Mayor's Transport Strategy 2018 (the 80% sustainable-mode-share target by 2041); the City of London Local Plan (the City Plan, in particular its transport, servicing and public-realm policies); the City of London Transport Strategy (2019, the 25-year strategy delivering the Square Mile's Healthy Streets and Vision Zero commitments); and the local borough Local Plan and any borough Supplementary Planning Documents on parking, travel plans and S106" : "; and the local development plan adopted by " + region.displayName}.`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    `Whether a full TA or a lighter Transport Statement (TS) is required is judgement-led by ${lpa}, supported by the indicative DfT 2007 Appendix B thresholds TfL still hosts operationally at content.tfl.gov.uk/thresholds-for-transport-assessments.pdf (DfT 2007 was withdrawn October 2014 — Appendix B remains in operational use but is no longer live policy, and its A1 / A2 / B1 / D1 / D2 use-class labels are pre-2020 nomenclature now collapsed into Class E under SI 2020/757). Appendix B also forces a TA regardless of floorspace where ANY of the following apply: ≥ 30 two-way vehicle movements in any hour; ≥ 100 two-way vehicle movements per day; ≥ 100 off-street parking spaces; location in or adjacent to an Air Quality Management Area (AQMA); or local transport infrastructure inadequate to serve the proposal. This screening report does not auto-evaluate AQMA proximity or infrastructure adequacy; the vehicle-movement and parking-space triggers should be checked against the external-trip totals in ${isLondon ? "Chapter 6" : "Chapter 5"} and the proposed parking provision before relying on a floorspace-only screen.`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  ldnSubsection(doc, "1.7 Consultations");
  ldnNote(doc, isLondon
    ? "Pre-application scoping with the GLA, the host London borough and (for any TLRN-impacting or PSI-triggering scheme) TfL should be recorded here, with the agreed methodology / scoping note appended. The engine does not capture consultation correspondence."
    : "Pre-application scoping with the local planning and highway authorities should be recorded here, with the agreed scoping note appended.");

  ldnSubsection(doc, "1.8 Report Purpose and Methodology Disclosure");
  doc.font("body").fontSize(10).fillColor("black").text(
    "This is the critical disclosure for a UK reviewer. The analysis in this report is generated by a screening engine calibrated to United States standards and is presented here as a cross-reference to UK methodology, not as a substitute for it:",
    { paragraphGap: 4 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  doc.text("• Capacity is reported using the UK signalised method (TRL RR67 / OSCADY–LinSig) per DMRB CD 123, NOT the Highway Capacity Manual: §5.4 gives Degree of Saturation (DoS), Practical Reserve Capacity (PRC = (0.9/DoS − 1)·100) and Mean Maximum Queue (MMQ) in PCU. Because the screening engine models every junction as signalised, the DoS is the engine's calibrated saturation ratio (its v/c) — a faithful UK signalised result, not an HCM cross-reference. Two limits remain for a submitted TA: (a) any junction that is in fact a roundabout or priority junction must be re-run in ARCADY (Kimber LR942, per DMRB CD 116) or PICADY (gap-acceptance) — both models are implemented and route automatically once junction control type is supplied, but until then are evaluated against DMRB default geometry and report Ratio of Flow to Capacity (RFC); and (b) a formal submission validates the signalised arms in LinSig 3 / TRANSYT 16 / Junctions 11 with the site's measured lane geometry, stage/phase diagram and saturation-flow survey rather than the engine's 1,900 PCU/h RR67 base and 0.45 green ratio.", { paragraphGap: 4 });
  doc.text("• Trip generation uses US public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) — NOT TRICS. UK reviewers do not accept US screening rates for TA work. The required source is the TRICS multi-modal database (currently TRICS 8 generation, base release March 2025, with the TRICS Good Practice Guide 2025 and Multi-Modal Methodology 2025 as the governing methodology, and the TRICS Decide & Provide Guidance Note 2021 for vision-led applications). The 85th-percentile rate remains the conventional UK starting point in TA practice, cited from DfT 2007 §4.62 (withdrawn October 2014 but still the de-facto reference); TRICS itself is methodologically neutral on which percentile to use and recommends ≥ 20 surveys in the rank-order list before 85th-percentile figures are quoted (TRICS Good Practice Guide 2025 §14.5–14.7). The scenario filter recorded for reviewer audit is date band, TRICS Main Location Type, day type, parking provision, GFA range, and any survey-day inclusion/exclusion decision on COVID-restriction surveys (which TRICS flags in the database but does not auto-exclude — user judgement, reason for any exclusion stated in the report, per Good Practice Guide §16.6). \"Region\" alone is no longer recommended as an exclusion criterion (Good Practice Guide §5.5–5.7) and TRICS 8 no longer allows exclusion on the basis of region or area alone. Three reporting-discipline elements must accompany any TRICS rates cited in a submitted TA: (i) the TRICS Calculation Reference code and licensee TRICS licence number, both auto-printed on every page of the TRICS PDF output (GPG §13.8 + §22.7) — reports lacking either are inadmissible per TRICS T&Cs; (ii) Cross Test results (mean vs median trip-rate variation %, GPG §14.8) reported alongside the rates so the reviewer can assess weighting/bias in the selected set; and (iii) where Vision-Led / Decide & Provide factoring has been applied to the TRICS-generated rates, the raw TRICS data is presented first and the factored data second, with the factoring method and reasoning explicit (GPG §10.7) — factored figures are not TRICS data. Per the 19 May 2026 TRICS licence-monitoring notice, TRICS will contact the LPA to advise that TRICS data is to be rejected as void if cited by a non-licensed organisation; the submitting consultancy's TRICS licence and produced-by attestation must be in the report.", { paragraphGap: 4 });
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
    doc.text(`• Sustainable-mode demand is approximated through a metro-specific auto-mode-share factor (${sharePct} applied for London, per the engine's mode-share configuration sourced from TfL Travel in London). The external-trip totals shown below already reflect that ${sharePct} reduction from the gross screening rate — ${ptalClause}. This is a screening-level approximation in place of the full multi-modal split (walking / cycling / bus / rail / car / taxi / motorcycle / LGV / HGV) that a UK TA is required to demonstrate under NPPF paragraph 115.`, { paragraphGap: 4 });
  }
  doc.text("• Geometric design citations in the engine's output are HCM and AASHTO; UK chartered review would substitute DMRB CD 109 / CD 116 / CD 122 / CD 123 (trunk) and Manual for Streets / Manual for Streets 2 (urban / residential).", { paragraphGap: 4 });
  doc.text("• Units are metric where derivable; some engine-generated fields remain in imperial (queue 95th-percentile reported in feet rather than MMQ in PCUs) and are flagged inline.", { paragraphGap: 4 });
  doc.text("• Where net peak car-mode generation falls below 15 trips per peak hour, the engine demotes the junction capacity table to an appendix and surfaces a trip-comparison narrative shell — matching the convention adopted by London consultancies (Waterman, Patrick Parsons) for sub-150-unit residential schemes. Above that threshold the junction table remains the §5.4 headline.", { paragraphGap: 6 });
  doc.fillColor("black");
  doc.font("body").fontSize(10).fillColor("black").text(
    "In short: treat the LOS / delay / queue numbers in this report as a sanity check on capacity-driven impact, not as the capacity assessment a submitted TA requires. The PTAL band, Active Travel Zone, Healthy Streets Indicators check and TRICS-derived multi-modal trip generation are the deliverables a London TA actually stands on — they are listed as placeholders below.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- Ch 2 Transport Planning for People (Velocity / Holloway format) -----
  // Velocity's Chapter 2 is "Transport Planning for People" — who the
  // development is for and when / why they travel (TfL LTDS-based), NOT the
  // floor-area schedule. The GIA area schedule lives in Chapter 1 §1.4
  // "Proposed Development" in the source TA, so it is not repeated here.
  ldnSection(doc, "2.0 TRANSPORT PLANNING FOR PEOPLE");
  if (isLondon) ldnChapterIntro(doc, "i.e. Who is the Proposed Development for, and when and why will they travel? This chapter sets out the people-first travel-demand basis for the assessment, drawing on TfL's London Travel Demand Survey (LTDS); the floorspace / area schedule is in Chapter 1 (§1.4 Proposed Development).");

  if (isLondon) {
    ldnSubsection(doc, "2.1 Who, When and Why People Travel");
    ldnNote(doc, `This chapter summarises who the Proposed Development would be for and when and why they would travel — the people-first basis for the assessment that follows. The proposal is ${project.projectName || "the subject development"} — land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"}; its floorspace / area schedule is set out in Chapter 1 (§1.4 Proposed Development) and the application drawings (Appendix A). Travel-attitude and demand context should be drawn from TfL's London Travel Demand Survey (LTDS) at submittal; it is not produced by this screening engine. The trip generation itself is presented in Chapter 6.`);
  } else {
    ldnSubsection(doc, "2.1 Content");
    ldnNote(doc, "This chapter establishes who will use the development and how, when and why they will travel — the people-first basis for the assessment that follows.");
  }

  ldnSubsection(doc, "2.2 Who is the Development For?");
  ldnNote(doc, `The proposed ${tg.landUseName ?? "development"} will be used by its occupiers and visitors. Demographic context for the site catchment (2021 Census MSOA / ward profile, GLA population projections, journey-to-work mode share) and the Public Sector Equality Duty (Equality Act 2010 — step-free access for people of all abilities) should be drawn from the London Datastore (data.london.gov.uk) at submittal; neither is produced by this screening engine.`);

  ldnSubsection(doc, "2.3 Transport Classification of Londoners (TCoL)");
  ldnNote(doc, "TfL's Transport Classification of Londoners segments residents into travel-attitude groups for TA work. TCoL is not produced here and should be drawn from TfL Insight at the time of submittal.");

  ldnSubsection(doc, "2.4 How Will People Travel?");
  {
    const appliedShare = Number(r.autoModeShareApplied);
    const sharePct = Number.isFinite(appliedShare) && appliedShare > 0 ? `${(appliedShare * 100).toFixed(0)}%` : "38%";
    ldnNote(doc, `Mode of travel is approximated in this screening via a metro-specific auto-mode-share factor (${sharePct} car for London, from TfL Travel in London), applied to the gross trip rate to net out walking, cycling, bus and rail. A submitted TA replaces this with the full TRICS multi-modal split (walk / cycle / bus / Underground / Overground / National Rail / DLR / car / taxi / LGV / HGV) and the linked-PT-trip behaviour required under NPPF paragraph 115 — see ${isLondon ? "Chapter 6" : "Chapter 5"}.`);
  }

  ldnSubsection(doc, "2.5 Where Will People Travel?");
  ldnNote(doc, `Trip origins / destinations and the assignment of person-trips across the network are summarised in ${isLondon ? "Chapter 6" : "Chapter 5"} (trip distribution). For a submitted TA the distribution is agreed in the scoping note and, for public transport, informed by TfL gateline / journey data.`);

  ldnSubsection(doc, "2.6 When Will People Travel and Why?");
  ldnNote(doc, `The assessed periods are the weekday AM peak (08:00–09:00) and PM peak (17:00–18:00), with a Saturday peak where the use warrants it. Trip purpose (commuting, education, retail, leisure) follows the proposed use and is detailed in ${isLondon ? "Chapter 6" : "Chapter 5"}.`);

  if (drawDiurnal && diurnalHourly) {
    ldnNote(doc, `A daily profile of journeys to and from the development is shown in Figure 2-1, distributing the engine's gross trip generation (${fmtNum(tg.dailyTrips)} daily trips) across the ${diurnalBasis} within-day distribution. The highest inbound (arrival) flow is in the AM peak and the highest outbound (departure) flow is in the PM peak, with a midday exchange over the lunch period.`);
    drawColumnChart(doc, {
      title: "Figure 2-1: Inbound/Outbound Trips by Start Time",
      categories: diurnalHourLabels,
      stacked: true,
      series: [
        { name: "Outbound", color: CHART_COLORS.outbound, values: diurnalHourly.departuresSharePct },
        { name: "Inbound", color: CHART_COLORS.inbound, values: diurnalHourly.arrivalsSharePct },
      ],
      yLabel: "% of daily total",
      xLabel: "Hour of day",
      yTickFormat: (v) => `${v}%`,
      caption: diurnalSel.profile.source,
    });
  } else {
    ldnNote(doc, "A within-day arrival/departure profile (Figure 2-1) and daily person-accumulation profile (Figure 6-2) are produced for office / commercial Class E schemes from the LTDS office distribution; for this use class they should be derived from the matching TRICS / LTDS profile at submittal, or supplied via the request trip-profile override.");
  }

  ldnSubsection(doc, "2.7 Why Will They Travel?");
  ldnNote(doc, "Trip purpose and the extent to which the scheme's location supports sustainable, active travel for those purposes is a vision-led narrative (see §1.4) to be completed by the chartered engineer; it is not generated by the engine.");

  ldnSubsection(doc, "2.8 Summary");
  ldnNote(doc, isLondon
    ? "The development is planned to be accessible by walking, cycling and public transport for people of all abilities; the chapters that follow assess that at the site scale (Chapter 3), pedestrian comfort (Chapter 4), the Active Travel Zone (Chapter 5) and the public-transport & highway networks (Chapter 6)."
    : "The development is planned to be accessible by walking, cycling and public transport for people of all abilities; the chapters that follow assess that at the site scale (Chapter 3), the Active Travel Zone (Chapter 4) and the London-wide network (Chapter 5).");
  doc.moveDown(0.3);

  // --- Ch 3 Site and Surroundings -----------------------------------------
  // Velocity's Chapter 3 is "Site and Surroundings" — site context, walking,
  // cycling, access, parking, servicing. Same body for every UK region
  // EXCEPT the PTAL block, which Velocity places in Chapter 6 — so for
  // London it is omitted here and emitted there.
  ldnSection(doc, "3.0 SITE AND SURROUNDINGS");
  if (isLondon) ldnChapterIntro(doc, "i.e. How can people of all abilities move to, through and around the site and its immediate surroundings — both before and after the development is built? This covers existing and proposed access, the walking catchment, local cycle routes, the strategic highway network, cycle parking, servicing and parking.");

  ldnSubsection(doc, "3.1 Introduction");
  rows(doc, [
    ["Scheme", project.projectName || "—"],
    ["Land use (public-data proxy)", `${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Region", region.displayName],
    ["Highway authority(ies)", isLondon ? "Transport for London (TLRN / red routes), the relevant London borough (borough roads); National Highways for any affected SRN length" : "Local highway authority for the area"],
    ["Local planning authority", lpa],
  ]);
  doc.moveDown(0.4);

  ldnSubsection(doc, "3.2 Walking");
  ldnNote(doc, isLondon
    ? "The pedestrian environment within and around the site (footway widths, crossings, severance, step-free routes, lighting) should be assessed against CIHT Planning for Walking and the relevant Healthy Streets Indicators. The engine does not survey the walking environment; a walk audit of the key desire lines should be appended."
    : "The pedestrian environment should be assessed against the local authority's walking standards.");

  ldnSubsection(doc, "3.3 Cycling");
  ldnNote(doc, isLondon
    ? "Cycle infrastructure within ~1 km of the site (Cycleways, segregated lanes, Advanced Stop Lines, on-street cycle parking, Santander Cycles docks) should be drawn from the TfL Cycle Infrastructure Database (cycling.data.tfl.gov.uk); Strategic Cycling Analysis corridors should be flagged where the site falls on or near one. Not produced by the engine."
    : "Cycle infrastructure should be drawn from the local highway authority's mapping.");

  // PTAL / public-transport-access. Holloway / non-London UK puts this at
  // §3.4; the Velocity / London format moves it to Chapter 6 (Public
  // Transport & Trip Generation), so it is emitted there instead.
  if (!isLondon) renderPtalAccessBlock("3.4");

  ldnSubsection(doc, isLondon ? "3.4 Access to Local Facilities and Amenities" : "3.5 Access to Local Facilities and Amenities");
  ldnNote(doc, `Walking / cycling access to local facilities (shops, schools, healthcare, open space, town-centre uses) within the active-travel catchment supports a car-light scheme. The amenity inventory is site-specific and is not produced by the engine; it is examined at the catchment scale in ${isLondon ? "Chapter 5" : "Chapter 4"}.`);

  ldnSubsection(doc, isLondon ? "3.5 Road Network" : "3.6 Road Network");
  ldnNote(doc, isLondon
    ? "The surrounding highway network — TLRN (red routes, TfL), Strategic Road Network and borough roads, with classifications, speed limits and any Controlled Parking Zones — should be described here. The engine carries the highway-authority split (see §3.1) but not the detailed road inventory."
    : "The surrounding highway network classification and speed limits should be described here.");

  ldnSubsection(doc, isLondon ? "3.6 Nearby Public Realm" : "3.7 Nearby Public Realm");
  ldnNote(doc, isLondon
    ? "The public realm immediately around the site should be assessed against the 10 Healthy Streets Indicators (existing condition), identifying any scores the scheme can improve. Not produced by the engine."
    : "The nearby public realm should be assessed against the local authority's standards.");

  ldnSubsection(doc, isLondon ? "3.7 Healthy Streets Designers Checklist" : "3.8 Healthy Streets Designers Checklist");
  ldnNote(doc, isLondon
    ? "TfL's Healthy Streets Check for Designers workbook (31 metrics, XLSX) should be completed for both existing and proposed conditions for any street the scheme alters — scoring as highly as possible across all 10 indicators and eliminating any score of zero (Appendix D). This screening engine does not run the Check."
    : "Where the local authority operates a Healthy Streets or equivalent framework, the relevant check should be appended.");

  ldnSubsection(doc, isLondon ? "3.8 On-Site Public Realm" : "3.9 On-Site Public Realm");
  ldnNote(doc, "The proposed on-site streets, squares and routes (legibility, accessibility, greening, play) are a design-team output assessed against Healthy Streets and the London Plan; not produced by the engine.");

  ldnSubsection(doc, isLondon ? "3.9 Pedestrian and Cycle Access" : "3.10 Pedestrian and Cycle Access");
  ldnNote(doc, "The proposed pedestrian and cycle access points, their connection to the surrounding network, and visibility / desire-line provision are a design output; swept-path and visibility drawings are appended (Appendix I).");

  ldnSubsection(doc, isLondon ? "3.10 Vehicle Access" : "3.11 Vehicle Access");
  ldnNote(doc, isLondon
    ? "The proposed vehicle access (site-access geometry, visibility splays, swept paths for the design and refuse vehicles) is a design output. Any works to the public highway require a Stage 1 Road Safety Audit (Appendix F) and, on the TLRN, a Section 278 agreement with TfL; the engine produces neither."
    : "The proposed vehicle access and any highway works require a Stage 1 Road Safety Audit to the local highway authority's standards.");

  ldnSubsection(doc, isLondon ? "3.11 Cycle Parking" : "3.12 Cycle Parking");
  ldnNote(doc, isLondon
    ? "Cycle parking provision (long- and short-stay) is set by London Plan policy T5 / Table 10.2 by use class, with the London Cycling Design Standards governing layout. Provision should be calculated against the final scheme; the engine does not size it."
    : "Cycle parking should be provided to the adopted local plan standards.");

  ldnSubsection(doc, isLondon ? "3.12 Delivery and Servicing" : "3.13 Delivery and Servicing");
  ldnNote(doc, isLondon
    ? "Servicing, deliveries and refuse collection should be accommodated on-site wherever possible, with swept-path analysis for the design vehicle (Appendix I) and a Delivery and Servicing Plan prepared in line with TfL guidance. Where the site fronts a TLRN red route, kerbside servicing is governed by the red-route restrictions and must be agreed with TfL."
    : "Servicing and refuse collection should be accommodated on-site with swept-path analysis and a Delivery and Servicing Plan to the local authority's standards.");

  ldnSubsection(doc, isLondon ? "3.13 Car Parking" : "3.14 Car Parking");
  ldnNote(doc, isLondon
    ? "Car-parking maxima are set by London Plan policy T6 sub-policies — Table 10.3 (T6.1 residential), Table 10.4 (T6.2 office) and Table 10.5 (T6.3 retail), each banded by PTAL and use class; T6.4 hotel and leisure is PTAL-band narrative with no numbered maxima; Table 10.6 (T6.5) sets disabled-persons provision. Car-free / car-lite development is the starting point under Policy T6 Part B. The car-free / permit-free justification and blue-badge provision should be set against the final scheme; the engine does not size them."
    : "Car parking should be assessed against the adopted local plan parking standards for the area.");
  doc.fillColor("black");
  doc.moveDown(0.3);

  // --- Ch 4 Pedestrian Comfort (PCL) — LONDON ONLY ------------------------
  // Velocity's Chapter 4 is the TfL Pedestrian Comfort Level assessment.
  // The engine carries no footway-survey or pedestrian-count data, so this
  // is a structured framework + "prepared at submittal / survey inputs
  // uploaded" stub in the existing ldnNote style — a skeleton, not invented
  // numbers. Non-London UK regions do not get this chapter (the ATZ chapter
  // below stays their Chapter 4).
  if (isLondon) {
    ldnSection(doc, "4.0 PEDESTRIAN COMFORT LEVEL ANALYSIS");
    ldnChapterIntro(doc, "i.e. Are the footways and crossings around the site comfortable for the people who will use them, once the development's pedestrian demand is added? Assessed with TfL's Pedestrian Comfort Level (PCL) methodology.");

    ldnSubsection(doc, "4.1 Introduction and Methodology");
    ldnNote(doc, "Footway and crossing comfort is assessed with TfL's Pedestrian Comfort Level (PCL) method — peak pedestrian flow per metre of effective footway width is compared against the TfL PCL comfort bands (A+ to E-). The assessment requires footway widths, an obstruction/effective-width audit and surveyed pedestrian flows on the busiest nearby footways. None of these are produced by this screening engine; the survey pack is uploaded and the PCL worksheets prepared at submittal.");

    ldnSubsection(doc, "4.2 Assessment Scenarios");
    ldnNote(doc, "PCL is reported across the four scenarios Velocity assesses: Base 2024 (surveyed), Sensitivity 2024, Future Base 2040 (background growth) and 2040 + Development. The scenario flows are built from the surveyed base plus the forecast additional pedestrian trips (below); the engine does not generate the scenario pedestrian matrices.");

    ldnSubsection(doc, "4.3 Forecast Additional Pedestrian Trips");
    ldnNote(doc, "The development's additional pedestrian trips by mode (walk-all-the-way plus the walk leg of public-transport trips) feed the PCL scenarios. These derive from the trip generation in Chapter 6 once the full multi-modal split is prepared; the screening engine outputs only the car-mode estimate, so the pedestrian trip table is prepared at submittal (Velocity Table 4-6 equivalent).");

    ldnSubsection(doc, "4.4 Pedestrian Movement Distribution and Assignment");
    ldnNote(doc, "The forecast pedestrian trips are distributed to the surrounding footways and crossings along the key desire lines (to stations, the town centre and local amenities) and assigned to the assessed links. This distribution is a manual, survey-informed step and is not produced by the engine.");

    ldnSubsection(doc, "4.5 Observed Crossing Flows and Queues");
    ldnNote(doc, "Observed pedestrian flows and queues at the key crossings are surveyed at the AM, lunchtime and PM 15-minute peaks. The survey data is uploaded at submittal; the engine carries no crossing-count data.");

    ldnSubsection(doc, "4.6 PCL Summary");
    ldnNote(doc, "The footway and crossing PCL bands across all four scenarios are summarised in the PCL summary tables (Velocity Tables 4-10 and 4-15 equivalents), flagging any footway or crossing falling below the comfort threshold under 2040 + Development. Prepared at submittal from the surveyed inputs.");
    doc.moveDown(0.3);
  }

  // --- Ch 5 Active Travel Zone Assessment (London) / Ch 4 ATZ (other UK) --
  ldnSection(doc, isLondon ? "5.0 ACTIVE TRAVEL ZONE ASSESSMENT" : "4.0 ACTIVE TRAVEL ZONE ASSESSMENT");
  if (isLondon) ldnChapterIntro(doc, "i.e. How will people of all abilities make the key journeys in the Active Travel Zone — the 20-minute cycle around the site (TfL WebCAT) — that are essential to support car-free lifestyles?");

  ldnSubsection(doc, isLondon ? "5.1 Introduction" : "4.1 Introduction");
  ldnNote(doc, isLondon
    ? "The Active Travel Zone (ATZ) — the 20-minute cycle catchment from the site, with 5 / 10 / 15-minute walking isochrones — is required in a TfL Healthy Streets TA and is generated through WebCAT 3.0. The engine does not produce isochrones; the WebCAT export and the route-survey pack are appended (Appendix J)."
    : "Where applicable, an active-travel catchment analysis should be appended.");

  ldnSubsection(doc, isLondon ? "5.2 Map One — Active Travel Zone Catchment" : "4.2 Map 1 — Active Travel Zone Catchment");
  ldnNote(doc, "WebCAT 20-minute cycle / walking-isochrone catchment map centred on the site. Generated at submittal; not produced by the engine.");

  ldnSubsection(doc, isLondon ? "5.3 Map Two — Key Walking and Cycling Routes" : "4.3 Map 2 — Key Walking and Cycling Routes");
  ldnNote(doc, "The key walking and cycling routes between the site and the destinations people need to reach (stations, town centre, schools, open space) within the catchment. Generated at submittal.");

  if (isLondon) {
    ldnSubsection(doc, "5.4 Key-Destination Prioritisation");
    ldnNote(doc, "The destinations people most need to reach from the site are prioritised to select the agreed key routes for the Healthy Streets analysis (Velocity Table 5-1 equivalent). The prioritisation is agreed with the borough/TfL at scoping and is not produced by the engine.");
  }

  ldnSubsection(doc, isLondon ? "5.5 Route Surveys — Healthy Streets Indicators" : "4.4 Route Surveys");
  ldnNote(doc, isLondon
    ? "Each of the ~5 agreed key routes is audited on foot / by cycle at ~150 m intervals against the 10 Healthy Streets Indicators, with survey photographs and a Neighbourhood Photo Survey, identifying barriers and improvement opportunities. The per-route Healthy Streets Indicator scoring tables (Velocity Tables 5-2 … 5-6 equivalents) are a manual survey output prepared at submittal; the engine carries no route-survey data."
    : "Each key route is audited on foot / by cycle at ~150 m intervals against the 10 Healthy Streets Indicators, with survey photographs, identifying barriers and improvement opportunities. A manual survey task; not produced by the engine.");
  if (isLondon) {
    // Per-route Healthy Streets Indicator table framework. Survey inputs
    // uploaded at submittal; the engine emits the skeleton only.
    table(doc, {
      headers: ["Key route", "Healthy Streets Indicators assessed", "Status"],
      widths: [150, 246, 100],
      align: ["left", "left", "left"],
      rows: [
        ["Route 1", "10 HSI (pedestrians from all walks of life … things to see & do)", "Survey at submittal"],
        ["Route 2", "10 HSI", "Survey at submittal"],
        ["Route 3", "10 HSI", "Survey at submittal"],
        ["Route 4", "10 HSI", "Survey at submittal"],
        ["Route 5", "10 HSI", "Survey at submittal"],
      ],
    });
    doc.moveDown(0.3);
  }

  ldnSubsection(doc, isLondon ? "5.6 Vision Zero / KSI (Collision) Analysis" : "4.5 KSI (Collision) Analysis");
  ldnNote(doc, isLondon
    ? "A Vision Zero analysis using DfT personal-injury collision data — the latest 3 years of Killed-or-Seriously-Injured (KSI) records (police STATS19 / TfL Personal Injury data) — across the ATZ key routes, with a collision map, to identify safety constraints the scheme should not worsen and may help address. Not produced by the engine."
    : "A collision-history analysis over the latest available period should be appended.");

  ldnSubsection(doc, isLondon ? "5.7 Map Three — Constraints and Opportunities" : "4.6 Map 3 — Constraints and Opportunities");
  ldnNote(doc, "A synthesis map of severance, desire lines, collision clusters and Healthy Streets constraints / opportunities across the catchment, informing the scheme's active-travel strategy. Generated at submittal.");
  doc.moveDown(0.3);

  // --- Ch 6 London-Wide Network (London) / Ch 5 (other UK) ----------------
  // Velocity's Chapter 6 is "London-Wide Network" and legitimately contains
  // public transport + trip generation + network impact: the PTAL band/map
  // opens the chapter, followed by service frequencies, trip generation (the
  // engine's car-mode estimate), net-change demand and the network/capacity
  // assessment. The PTAL block is relocated here verbatim from §3.4. Other
  // UK regions keep "Ch 5 London-Wide Network" unchanged.
  ldnSection(doc, isLondon ? "6.0 LONDON-WIDE NETWORK" : "5.0 LONDON-WIDE NETWORK");
  if (isLondon) ldnChapterIntro(doc, "i.e. How will people of all abilities travel smoothly and easily from the development onto London's public transport and highway networks? This chapter covers the site's PTAL, public-transport service frequencies, trip generation (especially public transport, including linked trips), net-change travel demand, design solutions / mitigation for network-capacity impacts, and modelling where required.");

  ldnSubsection(doc, isLondon ? "6.1 Introduction" : "5.1 Introduction");
  ldnNote(doc, "This chapter establishes the development's travel demand, distributes it across the public-transport and highway networks, and assesses the resulting impact and any mitigation.");

  // PTAL block, relocated here from §3.4 for the Velocity / London format.
  if (isLondon) {
    renderPtalAccessBlock("6.2");
    ldnSubsection(doc, "6.3 Public Transport Service Frequencies");
    ldnNote(doc, "Bus, Underground, Elizabeth line, DLR and National Rail service frequencies at the nearest stops/stations (Velocity Tables 6-1 … 6-3 equivalents) are drawn from TfL/rail-industry timetables at submittal; the engine carries no timetable data.");

    // Census Mode Share for Travel to Work (Velocity Table 6-6 equivalent).
    // London-gated. The TRICS office rates give the all-purpose mode split;
    // the 2011 Census travel-to-work split (workplace population, City of
    // London MSOA) disaggregates the public-transport share — Underground /
    // Rail / Bus — and pins the car/van share for trip generation, per
    // velocity-ta-format.md §4. Non-London regions never reach this block.
    ldnSubsection(doc, "6.3.1 Census Mode Share for Travel to Work (City of London)");
    {
      const split = getLondonCensusModeSplit();
      const pct = (x: number) => (x * 100).toFixed(1) + "%";
      const ptTotal = split.underground + split.rail + split.bus;
      doc.font("body").fontSize(10).fillColor("black").text(
        `The public-transport mode split for trip generation is disaggregated from the 2011 Census "Method of Travel to Work" for the City of London as the workplace destination (Velocity Table 6-6 equivalent). The Underground, Rail and Bus shares below are the census-derived public-transport portion (${pct(ptTotal)} of travelling commuters); the bus, cycle and pedestrian trip rates blend with the TRICS office rates at submittal so the final multi-modal rates carry through the TRICS survey base rather than the census alone. The 2011 Census is used in preference to 2021: the 2021 Census was enumerated during a COVID-19 lockdown that heavily distorted travel-to-work, and ONS advises its 2021 travel-to-work figures are not comparable with earlier censuses, so 2011 is retained as the stable pre-COVID basis.`,
        { paragraphGap: 6 },
      );
      table(doc, {
        headers: ["Mode", "Census mode share"],
        widths: [260, 130],
        align: ["left", "right"],
        rows: [
          ["Underground / metro / light rail / tram", pct(split.underground)],
          ["Rail (National Rail)", pct(split.rail)],
          ["Bus / minibus / coach", pct(split.bus)],
          ["DLR", pct(split.dlr)],
          ["Public transport (subtotal)", pct(ptTotal)],
          ["Car / van (driver + passenger)", pct(split.car)],
          ["Taxi", pct(split.taxi)],
          ["Bicycle", pct(split.cycle)],
          ["On foot", pct(split.walk)],
        ],
      });
      doc.moveDown(0.2);
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
        `Source: ${LONDON_CITY_CENSUS_2011_SOURCE}. Shares are of the travelling population (workplace total minus work-from-home). DLR rolls into "Underground, metro, light rail or tram" under the 2001 method-of-travel specification and is reported as 0 here. The car/van share (${pct(split.car)}) is the trip-generation auto-mode basis applied to the City-of-London site below.`,
        { paragraphGap: 4 },
      );
      doc.fillColor("black");
    }
  }

  ldnSubsection(doc, isLondon ? "6.4 Existing Site" : "5.2 Existing Site");
  {
    const priorUse = String(req.priorUse ?? "").trim();
    ldnNote(doc, priorUse
      ? `The existing / most-recent use (${priorUse}) generated a baseline of trips that should be netted from the proposed demand below; the net change is what is assessed.`
      : "Any trips generated by the site's existing / most-recent lawful use should be netted from the proposed demand below (set TisRequest.priorUse to surface this).");
  }

  ldnSubsection(doc, isLondon ? "6.5 Travel Demand / Trip Generation (TRICS proxy — engine uses US public-data rates)" : "5.3 Residential Travel Demand (TRICS proxy — engine uses US public-data rates)");
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
      `Gross trip generation in this report is calculated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land-use code ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. The TRICS-equivalent multi-modal table — person-trips by mode (Cars, Taxis, Motor Cycles, LGVs, OGVs, PSVs, Cyclists, Scooters, Pedestrians, plus the London public-transport split into Bus, Tram, Underground, Overground, National Rail, DLR and Water Service Passengers), linked PT trips, mean and 85th-percentile rate against the agreed TRICS filter — is not produced by this engine and must be prepared separately for any submitted TA. The figures below represent the engine's car-mode estimate after ${bandClause} has been applied to net out walking, cycling, bus, rail and other modes.`,
      { paragraphGap: 6 },
    );
    if (isLondon) {
      doc.font("body").fontSize(10).fillColor("black").text(
        `Consistent with the Velocity Table 6-6 method (§6.3.1), the car/van basis for a City-of-London site is the 2011 Census travel-to-work share of ${(getLondonCensusAutoShare() * 100).toFixed(1)}% — the near-car-free signature of a Zone-1 Square Mile workplace. The Underground / Rail / Bus public-transport split is taken from that census disaggregation, while the bus, cycle and pedestrian trip rates blend with the TRICS office survey rates at submittal; the final submitted trip rates therefore carry through TRICS rather than the census alone.`,
        { paragraphGap: 6 },
      );
    }
  }
  table(doc, {
    headers: ["Period", "Entering trips", "Exiting trips"],
    widths: [180, 100, 100],
    align: ["left", "right", "right"],
    rows: [
      ["Daily", fmtNum(((tg.dailyTrips ?? 0) as number) / 2), fmtNum(((tg.dailyTrips ?? 0) as number) / 2)],
      ["AM peak hour (08:00–09:00)", fmtNum(tg.amIn), fmtNum(tg.amOut)],
      ["PM peak hour (17:00–18:00)", fmtNum(tg.pmIn), fmtNum(tg.pmOut)],
    ],
  });
  doc.moveDown(0.4);

  ldnSubsection(doc, isLondon ? "6.6 Non-Residential Travel Demand (TRICS)" : "5.4 Non-Residential Travel Demand (TRICS)");
  ldnNote(doc, "Where the scheme includes non-residential floorspace (retail, office, community), its TRICS multi-modal demand is assessed separately and added to the residential demand. The engine models a single primary land use; any mix should be assessed at submittal.");

  ldnSubsection(doc, isLondon ? "6.7 Total Travel Demand (Net Change)" : "5.5 Total Travel Demand");
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

  if (drawDiurnal && diurnalHourly) {
    ldnNote(doc, `The daily on-site person accumulation is shown in Figure 6-2, derived by running the Figure 2-1 inbound/outbound profile across the ${fmtNum(tg.dailyTrips)} gross daily trips. On-site occupancy builds through the AM peak, plateaus over the working day and empties across the PM peak.`);
    drawLineChart(doc, {
      title: "Figure 6-2: Daily Person Accumulation",
      categories: diurnalHourLabels,
      values: diurnalHourly.accumulation,
      color: CHART_COLORS.outbound,
      yLabel: "On-site (est.)",
      xLabel: "Hour of day",
      caption: `Peak on-site accumulation ~${fmtNum(diurnalHourly.peakAccumulation)} at ${String(diurnalHourly.peakAccumulationHour).padStart(2, "0")}:00, from ${fmtNum(tg.dailyTrips)} gross daily trips on the ${diurnalBasis} within-day profile. Screening estimate; not a substitute for a calibrated time-of-day model.`,
    });
    doc.moveDown(0.2);
  }

  ldnSubsection(doc, isLondon ? "6.8 Delivery and Servicing Trips" : "5.6 Delivery and Servicing Trips");
  ldnNote(doc, "Delivery, servicing and refuse-vehicle trips are generated separately (typically by GFA / unit count against TfL or freight-survey rates) and added to the demand. Not produced by the engine; assess against the Delivery and Servicing Plan at submittal.");

  ldnSubsection(doc, isLondon ? "6.9 Site Land Use Quantum" : "5.7 Site Land Use Quantum");
  ldnNote(doc, `Assessed quantum: land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at ${tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"}. A mixed-use scheme should tabulate GFA / units per use class here.`);

  ldnSubsection(doc, isLondon ? "6.10 Servicing Accumulation Profile" : "5.8 Servicing Accumulation Profile");
  ldnNote(doc, "The hourly accumulation of servicing / delivery vehicles (to size on-site servicing bays and confirm no overspill to the highway) is a Delivery and Servicing Plan output; not produced by the engine.");

  // §6.11 (London) / §5.9 (UK): the method-aware trip-distribution section — the
  // same shared renderer the US reports use, in its UK flavor (WebTAG M2 / DMRB
  // gravity, TRICS-comparable analogy, or the 2011 Census WU03EW journey-to-work
  // catchment surrogate). The selected method already drove the per-junction
  // loading above; here it is documented with the directional sector table,
  // per-zone worksheet and distribution charts. The former single prose paragraph
  // (proximity gravity + TfL MoTiON/LoHAM/MAP references) is now carried in the
  // method-aware basis narrative. The per-junction km assignment table below is
  // retained as the London-convention (metric) assignment view.
  renderTripDistributionSection(doc, r as any, {
    subsectionNumber: isLondon ? "6.11" : "5.9",
    headingFn: ldnSubsection,
    flavor: "uk",
    cap: 20,
    intersections,
    periods,
  });
  if (intersections.length > 0) {
    ldnSubsection(doc, isLondon ? "6.11.1 Project Trip Assignment — Study Junctions" : "5.9.1 Project Trip Assignment — Study Junctions");
    const amPeriodD = periods.find((p) => p.period === "am_peak");
    const amIntsD: any[] = Array.isArray(amPeriodD?.affectedIntersections) ? amPeriodD.affectedIntersections : [];
    const amBySignalD = new Map<string, any>(amIntsD.map((a) => [String(a.signalId ?? a.name), a]));
    const hasAmD = amIntsD.length > 0;
    const totalPm = intersections.reduce((s, it) => s + (Number(it.addedTripsPmPeak) || 0), 0) || 1;
    // London reports distance metric (km); other UK regions (Manchester …)
    // keep the engine's imperial miles for now.
    const distHeader = isLondon ? "Dist (km)" : "Dist (mi)";
    const distCell = (mi: any) => {
      if (mi == null || Number.isNaN(Number(mi))) return "—";
      return isLondon ? fmtNum(Number(mi) * 1.609344, 2) : fmtNum(mi, 2);
    };
    const distRows = intersections.map((it) => {
      const pm = Number(it.addedTripsPmPeak) || 0;
      const amTwin = amBySignalD.get(String(it.signalId ?? it.name));
      const am = amTwin ? Number(amTwin.addedTripsPmPeak) || 0 : null;
      const head = [String(it.name ?? it.signalId ?? "—"), distCell(it.distanceMi)];
      const tail = [fmtNum(pm, 0), ((pm / totalPm) * 100).toFixed(1) + "%"];
      return hasAmD ? [...head, am === null ? "—" : fmtNum(am, 0), ...tail] : [...head, ...tail];
    });
    table(doc, hasAmD
      ? { headers: ["Junction", distHeader, "Added trips AM", "Added trips PM", "Share of added PM"], widths: [175, 60, 90, 90, 90], align: ["left", "right", "right", "right", "right"], rows: distRows }
      : { headers: ["Junction", distHeader, "Added trips PM", "Share of added PM"], widths: [220, 70, 110, 100], align: ["left", "right", "right", "right"], rows: distRows });
    doc.moveDown(0.3);
    // Name the actual selected distribution method so this footnote matches the
    // §6.11 method narrative above (not always "gravity" — surrogate/analogy also
    // drive the assignment).
    const distMethod = String((r as any)?.tripDistribution?.method ?? "gravity");
    const methodDesc =
      distMethod === "surrogate" ? "Census journey-to-work catchment"
      : distMethod === "analogy" ? "analogous-site distribution"
      : "gravity-model";
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      isLondon
        ? `Net car trips assigned per junction (engine ${methodDesc} assignment). Bus / Underground / rail person-trip distribution is not produced by the engine — see §6.12–§6.14.`
        : `Net car trips assigned per junction (engine ${methodDesc} assignment). Bus / Underground / rail person-trip distribution is not produced by the engine — see §5.10–§5.12.`,
      { paragraphGap: 4 },
    );
    doc.fillColor("black");
  }

  ldnSubsection(doc, isLondon ? "6.12 Bus Trip Distribution" : "5.10 Bus Trip Distribution");
  ldnNote(doc, "Bus-mode person-trips are distributed across the local bus network using TfL route and patronage data. Not produced by the engine; prepare at submittal where bus mode share is material.");

  ldnSubsection(doc, isLondon ? "6.13 LUL (Underground) Trip Distribution" : "5.11 LUL (Underground) Trip Distribution");
  ldnNote(doc, "Underground person-trips are distributed to the nearest stations and assessed against gateline / interchange capacity using TfL data. Not produced by the engine.");

  ldnSubsection(doc, isLondon ? "6.14 Train Trip Distribution" : "5.12 Train Trip Distribution");
  ldnNote(doc, "National Rail / Overground / Elizabeth line / DLR person-trips are distributed to the nearest stations and assessed against capacity using rail-industry / TfL data. Not produced by the engine.");

  ldnSubsection(doc, isLondon ? "6.15 Road Network Impact" : "5.13 Road Network Impact");
  {
    const hasDesign = intersections[0]?.designNoBuildVc != null;
    const oy = String(req.openingYear ?? "—");
    doc.font("body").fontSize(10).fillColor("black").text(
      `The scheme's net car trips are added to growth-adjusted baseline flows and assessed at each affected junction across the scenarios in the ladder below. ${hasDesign ? "A design-year horizon is also reported." : "A submitted TA conventionally also reports a design-year horizon (commonly opening + 5 or + 10 years)."}`,
      { paragraphGap: 6 },
    );
    const ladder: string[][] = [
      ["Existing", "Current-year observed baseline", "None"],
      ["No-Build", `Opening year ${oy}`, `${r.growthAppliedPct ?? "—"}%/yr × ${r.growthYears ?? "—"} yr`],
      ["With-Development", `Opening year ${oy}`, "No-Build + scheme net car trips"],
    ];
    if (hasDesign) {
      ladder.push(["Design No-Build", "Design-year horizon", `${r.growthAppliedPct ?? "—"}%/yr to design year`]);
      ladder.push(["Design Build", "Design-year horizon", "Design No-Build + scheme net car trips"]);
    }
    table(doc, { headers: ["Scenario", "Basis", "Growth / trips applied"], widths: [130, 180, 215], align: ["left", "left", "left"], rows: ladder });
    doc.moveDown(0.2);
    ldnNote(doc, "Committed-development (cumulative) flows and zonal TEMPRO / NTM growth factors are not produced by this engine — a single flat background-growth rate is applied; both should be added at submittal.");
  }

  ldnSubsection(doc, isLondon ? "6.16 LinSig Modelling" : "5.14 LinSig Modelling");
  if (isLondon) ldnNote(doc, "A submitted TA models the affected signalised junctions in LinSig 3 (or TRANSYT / Junctions 11 / VISSIM as appropriate) with measured geometry, the stage / phase diagram and a saturation-flow survey, audited under TfL's Model Auditing Process (Appendix C). The engine's signalised Degree-of-Saturation result below (per DMRB CD 123 / TRL RR67) stands in for that at the screening level — see §1.8.");
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
    // UK capacity (DMRB / TRL signalised method, uk-capacity.ts): one table
    // per junction across every scenario the payload carries, with AM/PM
    // column groups where an am_peak period is present — modelled on the
    // Velocity / Holloway §5.14 LinSig tables (DoS / PRC / MMQ). Detailed
    // tables are capped to the worst junctions; all are summarised after.
    const amP = periods.find((p) => p.period === "am_peak");
    const amInts: any[] = Array.isArray(amP?.affectedIntersections) ? amP.affectedIntersections : [];
    const amBySignal = new Map<string, any>(amInts.map((a) => [String(a.signalId ?? a.name), a]));
    const hasAm = amInts.length > 0;
    const prcCell = (v: number | null) => (v === null ? "—" : (v >= 0 ? "+" : "") + fmtNum(v, 0) + "%");
    type Scen = { key: "current" | "noBuild" | "build" | "designNoBuild" | "designBuild"; label: string };
    const scenarios: Scen[] = [
      { key: "current", label: "Existing" },
      { key: "noBuild", label: "No-Build" },
      { key: "build", label: "With-Development" },
    ];
    if (intersections[0]?.designNoBuildVc != null) {
      scenarios.push({ key: "designNoBuild", label: "Design No-Build" });
      scenarios.push({ key: "designBuild", label: "Design Build" });
    }
    const DETAIL_CAP = 6;
    const ranked = [...intersections].sort(
      (a, b) => ukCapacityForIntersection(b, "build").dosPct - ukCapacityForIntersection(a, "build").dosPct,
    );
    ranked.slice(0, DETAIL_CAP).forEach((it, i) => {
      const amIt = amBySignal.get(String(it.signalId ?? it.name));
      const noBuildPm = ukCapacityForIntersection(it, "noBuild");
      ldnSubsection(doc, `Table ${isLondon ? "6.16" : "5.14"}.${i + 1} — Signalised capacity (DoS / PRC / MMQ): ${it.name ?? it.signalId ?? "junction"}`);
      const scRows = scenarios.map((s) => {
        const pm = ukCapacityForIntersection(it, s.key);
        const worse = s.key === "build" && pm.dosPct > noBuildPm.dosPct + 0.05;
        const pmDos = (worse ? "▲ " : "") + fmtNum(pm.dosPct, 1) + "%";
        if (hasAm && amIt) {
          const am = ukCapacityForIntersection(amIt, s.key);
          return [s.label, fmtNum(am.dosPct, 1) + "%", prcCell(am.prcPct), fmtNum(am.mmqPcu, 1), pmDos, prcCell(pm.prcPct), fmtNum(pm.mmqPcu, 1), pm.withinCapacity ? "Yes" : "No"];
        }
        return [s.label, pmDos, prcCell(pm.prcPct), fmtNum(pm.mmqPcu, 1), pm.withinCapacity ? "Yes" : "No"];
      });
      table(doc, (hasAm && amIt)
        ? { headers: ["Scenario", "AM DoS", "AM PRC", "AM MMQ", "PM DoS", "PM PRC", "PM MMQ", "Within cap?"], widths: [118, 52, 52, 50, 52, 52, 50, 60], align: ["left", "right", "right", "right", "right", "right", "right", "center"], rows: scRows }
        : { headers: ["Scenario", "DoS", "PRC", "MMQ (PCU)", "Within cap?"], widths: [150, 80, 80, 90, 86], align: ["left", "right", "right", "right", "center"], rows: scRows });
      doc.moveDown(0.2);
      const apps: any[] = Array.isArray(it.approaches) ? it.approaches : [];
      const appRows = apps
        .filter((a) => (Number(a.existingVc) || 0) > 0 || (Number(a.futureVc) || 0) > 0)
        .map((a) => {
          const nb = ukCapacityForIntersection(a, "noBuild");
          const bd = ukCapacityForIntersection(a, "build");
          const amApp = Array.isArray(amIt?.approaches) ? amIt.approaches.find((x: any) => x.direction === a.direction) : undefined;
          if (hasAm && amApp) {
            const nbA = ukCapacityForIntersection(amApp, "noBuild");
            const bdA = ukCapacityForIntersection(amApp, "build");
            return [String(a.direction), fmtNum(nbA.dosPct, 1) + "%", fmtNum(bdA.dosPct, 1) + "%", fmtNum(bdA.mmqPcu, 1), fmtNum(nb.dosPct, 1) + "%", fmtNum(bd.dosPct, 1) + "%", fmtNum(bd.mmqPcu, 1), fmtNum(a.queue95thFt, 0)];
          }
          return [String(a.direction), fmtNum(nb.dosPct, 1) + "%", fmtNum(bd.dosPct, 1) + "%", fmtNum(bd.mmqPcu, 1), fmtNum(a.queue95thFt, 0)];
        });
      if (appRows.length > 0) {
        table(doc, (hasAm && Array.isArray(amIt?.approaches) && amIt.approaches.length > 0)
          ? { headers: ["Approach", "AM NB DoS", "AM WD DoS", "AM MMQ", "PM NB DoS", "PM WD DoS", "PM MMQ", "Q95 (ft)"], widths: [66, 58, 58, 48, 58, 58, 48, 54], align: ["left", "right", "right", "right", "right", "right", "right", "right"], rows: appRows }
          : { headers: ["Approach", "No-Build DoS", "With-Dev DoS", "MMQ (PCU)", "Queue 95% (ft)"], widths: [90, 95, 95, 80, 90], align: ["left", "right", "right", "right", "right"], rows: appRows });
        doc.moveDown(0.3);
      }
    });
    if (ranked.length > DETAIL_CAP) {
      doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(`The detailed tables above cover the ${DETAIL_CAP} junctions with the highest With-Development Degree of Saturation; all ${ranked.length} study junctions are summarised below.`, { paragraphGap: 4 });
      doc.fillColor("black");
    }
    ldnSubsection(doc, "Summary — all study junctions (PM peak)");
    const ukRows = intersections.map((it) => {
      const noBuild = ukCapacityForIntersection(it, "noBuild");
      const build = ukCapacityForIntersection(it, "build");
      const worse = build.dosPct > noBuild.dosPct + 0.05;
      return [
        it.name ?? it.signalId ?? "—",
        fmtNum(noBuild.dosPct, 1) + "%",
        (worse ? "▲ " : "") + fmtNum(build.dosPct, 1) + "%",
        prcCell(build.prcPct),
        fmtNum(build.mmqPcu, 1),
        build.withinCapacity ? "Yes" : "No",
      ];
    });
    table(doc, {
      headers: ["Junction", "DoS No-Build", "DoS With-Dev", "PRC With-Dev", "MMQ (PCU)", "Within cap?"],
      widths: [185, 75, 75, 70, 65, 60],
      align: ["left", "right", "right", "right", "right", "center"],
      rows: ukRows,
    });
    doc.moveDown(0.3);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Capacity reported per DMRB / TRL signalised method (uk-capacity.ts): DoS = Degree of Saturation; PRC = Practical Reserve Capacity to the 90% limit (PRC ≥ 0 ⇒ within practical capacity); MMQ = Mean Maximum Queue in PCU; Q95 = engine HCM 95th-percentile back-of-queue, in feet (per-approach). Scenarios: Existing (current-year, no growth) · No-Build (opening-year grown) · With-Development (+ scheme trips)" + (intersections[0]?.designNoBuildVc != null ? " · Design No-Build / Design Build (design-year horizon)." : ".") + " The engine models each junction as signalised, so DoS equals the calibrated v/c; a submitted TA re-runs these in LinSig 3 / Junctions 11 with measured geometry (see §1.8 and Appendix C).",
      { paragraphGap: 4 },
    );
    doc.fillColor("black");
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text("No signalised junctions within the study radius. No off-network capacity impact is anticipated at the screening level.", { paragraphGap: 6 });
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  ldnSubsection(doc, isLondon ? "6.17 Site Access and Junction Capacity — Design Solutions and Mitigation" : "5.15 Site Access and Junction Capacity — Design Solutions and Mitigation");
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

  if (isLondon) {
    // --- Ch 7 Planning Policy Delivery (Velocity / London) ----------------
    // Velocity's Chapter 7 is the strategic-policy-delivery chapter: a table
    // of how the scheme meets NPPF / London Plan / MTS / City-of-London
    // policy, then the outline management plans (DSP, Operational Waste
    // Management Plan, Cycle Promotion Plan, Construction Logistics Plan).
    // The old "Additional Borough Analysis" PCL item now lives in Ch 4; the
    // construction-logistics detail is condensed into the CLP plan below.
    ldnSection(doc, "7.0 PLANNING POLICY DELIVERY");
    ldnChapterIntro(doc, "i.e. How does the scheme deliver against the strategic transport policies, and which management plans secure that delivery through to occupation and operation?");

    ldnSubsection(doc, "7.1 Strategic Policy Delivery");
    ldnNote(doc, "A strategic-policy-delivery table sets out how the scheme responds to each relevant policy — NPPF Chapter 9 (sustainable transport), London Plan policies T1–T9, the Mayor's Transport Strategy (the 80% sustainable-mode target), Healthy Streets, and the City of London Local Plan and Transport Strategy. The policy text is fixed; the per-scheme delivery commitments are drafted by the chartered engineer with the design team and are not produced by this screening engine.");
    table(doc, {
      headers: ["Policy", "Delivery mechanism", "Status"],
      widths: [186, 210, 100],
      align: ["left", "left", "left"],
      rows: [
        ["NPPF Ch 9 (sustainable transport)", "Vision-led, car-free/car-lite scheme; sustainable-mode priority", "Drafted at submittal"],
        ["London Plan T1–T9", "Healthy Streets, cycle parking (T5), PTAL-banded car parking (T6)", "Drafted at submittal"],
        ["Mayor's Transport Strategy", "Contribution to the 80% sustainable-mode-share target", "Drafted at submittal"],
        ["City of London Local Plan + Transport Strategy", "Square Mile Healthy Streets / Vision Zero alignment", "Drafted at submittal"],
      ],
    });
    doc.moveDown(0.4);

    ldnSubsection(doc, "7.2 Delivery and Servicing Plan (DSP)");
    ldnNote(doc, "An outline Delivery and Servicing Plan — consolidated, retimed and off-peak servicing to minimise kerbside demand — is prepared on the TfL DSP template at submittal. Where the City of London applies, the servicing demand is estimated via the City's Loading Bay Ready Reckoner and off-site freight consolidation is assumed; neither is produced by the engine.");

    ldnSubsection(doc, "7.3 Operational Waste Management Plan");
    ldnNote(doc, "An outline Operational Waste Management Plan setting out on-site storage, collection frequencies and swept-path access for the refuse vehicle. A design-team / project-team output, prepared at submittal.");

    ldnSubsection(doc, "7.4 Cycle Promotion Plan");
    ldnNote(doc, "An outline Cycle Promotion Plan — cycle-parking provision (London Plan T5), end-of-trip facilities, and the measures to encourage cycling among occupiers and visitors. Prepared at submittal.");

    ldnSubsection(doc, "7.5 Construction Logistics Plan (CLP)");
    ldnNote(doc, "An outline Construction Logistics Plan on TfL's CLP template — construction programme and methodology, approved HGV routing and site access, consolidation/retiming and FORS/CLOCS measures to protect pedestrians and cyclists, estimated vehicle movements by phase, and the monitoring/updating regime through the build. The CLP is a live document confirmed with the contractor; it is not produced by this screening engine.");
    doc.moveDown(0.3);
  } else {
    // --- Ch 6 Additional Borough Analysis (non-London UK) -----------------
    ldnSection(doc, "6.0 ADDITIONAL BOROUGH ANALYSIS");
    ldnNote(doc, "Local-authority-specific policies (Local Plan, Supplementary Planning Documents, parking standards) are not produced by this screening engine.");

    ldnSubsection(doc, "6.1 Pedestrian Comfort Level (PCL) Analysis");
    ldnNote(doc, "TfL's Pedestrian Comfort Level methodology assesses footway crowding on the busiest nearby footways (peak pedestrian flow ÷ effective footway width → PCL band A–F+). Required where the scheme adds significant pedestrian demand. Not produced by the engine.");

    ldnSubsection(doc, "6.2 Approach to Access Road Design");
    ldnNote(doc, "The design rationale for the proposed access road(s) — geometry, widths, speed control, materials, Healthy Streets fit and adoption (S38 / S278) — is a design-team output presented here at the borough's request; not produced by the engine.");
    doc.moveDown(0.3);

    // --- Ch 7 Construction Logistics Plan (non-London UK) -----------------
    ldnSection(doc, "7.0 CONSTRUCTION LOGISTICS PLAN");

    ldnSubsection(doc, "7.1 Introduction");
    ldnNote(doc, "A Construction Logistics Plan (CLP) and Delivery and Servicing Plan are required at submittal for a major application; they are prepared on TfL's CLP template and are not produced by this screening engine. The subsections below mirror the canonical CLP structure.");

    ldnSubsection(doc, "7.2 Context, Considerations and Challenges");
    ldnNote(doc, "Site context and the principal construction constraints (proximity to busy footways, schools, cycle routes, a TLRN red route or a major junction) that the CLP must mitigate.");

    ldnSubsection(doc, "7.3 Construction Programme and Methodology");
    ldnNote(doc, "The build programme by phase (demolition, substructure, superstructure, fit-out) and the construction methodology that drives vehicle demand. Project-team output.");

    ldnSubsection(doc, "7.4 Vehicle Routing and Site Access");
    ldnNote(doc, "Approved HGV routes to / from the strategic network, the construction access point(s), and any holding / call-up arrangement to keep vehicles off the local network.");

    ldnSubsection(doc, "7.5 Strategies to Reduce Impacts");
    ldnNote(doc, "Measures to reduce and consolidate vehicle movements and protect pedestrians and cyclists — consolidation centres, retiming outside peaks, FORS / CLOCS accreditation, banksmen, hoarding and wayfinding.");

    ldnSubsection(doc, "7.6 Estimated Vehicle Movements");
    ldnNote(doc, "Estimated construction-vehicle movements by phase (the TfL CLP spreadsheet output), with the peak-day / peak-hour totals the local network must absorb. Not produced by the engine.");

    ldnSubsection(doc, "7.7 Implementing, Monitoring and Updating");
    ldnNote(doc, "How the CLP is implemented and governed across the build, including the responsible parties and the trigger points for review.");

    ldnSubsection(doc, "7.8 Monitoring");
    ldnNote(doc, "The monitoring regime — vehicle logs, complaint handling and compliance reporting to the borough / TfL.");

    ldnSubsection(doc, "7.9 Updating");
    ldnNote(doc, "The CLP is a live document, updated as the contractor, programme and methodology are confirmed; meanwhile uses should be considered where possible.");
    doc.moveDown(0.3);
  }

  // --- Ch 8 Summary and Conclusions (London) / Conclusion (other UK) ------
  ldnSection(doc, isLondon ? "8.0 SUMMARY AND CONCLUSIONS" : "8.0 CONCLUSION");
  if (isLondon) {
    ldnChapterIntro(doc, "i.e. The summary table below — the matrix TfL recommends for a Healthy Streets TA conclusion — sets out the key transport impacts/issues and the solutions/mechanisms that respond to them. Outcomes (planning obligations, design changes, mitigation) are to be agreed between the applicant, the borough and TfL before planning permission is recommended.");
    const networkImpact = (ukCap && ukCap.overCapacity === 0)
      ? `No study junction exceeds the UK practical-capacity threshold (DoS ≥ 90% / RFC ≥ 0.85) under the With-Development scenario (worst DoS ${fmtNum(ukCap.worstDosPct, 1)}%); capacity is not the limiting factor at screening.`
      : `${ukCap?.overCapacity ?? 0} junction(s) exceed the UK practical-capacity threshold (DoS ≥ 90% / RFC ≥ 0.85) under the With-Development scenario (worst DoS ${fmtNum(ukCap?.worstDosPct ?? 0, 1)}%).`;
    const networkSolution = needMitigation.length > 0
      ? `Mitigation flagged at ${needMitigation.length} junction(s); secure via S106 / S278 (borough or TLRN) plus an MCIL2 check, confirmed in LinSig 3 / Junctions 11.`
      : "No mitigation indicated at screening; confirm against DMRB CD 116 / CD 123 and the TfL / borough operational standards.";
    const ptalForTable = (typeof req.ptalBand === "string" && req.ptalBand.length > 0)
      ? `PTAL ${req.ptalBand}` : "PTAL to be confirmed (WebCAT)";
    table(doc, {
      headers: ["", "Key transport impacts / issues", "Solutions / mechanisms"],
      widths: [118, 199, 199],
      align: ["left", "left", "left"],
      rows: [
        ["Site and surroundings", `${ptalForTable}; site access, public-realm fit against the 10 Healthy Streets Indicators, servicing and parking demand.`, "London Plan T5 cycle parking + T6 car-parking maxima; Healthy Streets Check for Designers; access/servicing design; Stage 1 RSA for any highway works."],
        ["Active Travel Zone (ATZ)", "Quality of the 20-minute cycle catchment and walking isochrones for car-free travel.", "ATZ assessment from WebCAT; active-travel and public-realm improvements within the catchment."],
        ["London-wide network", networkImpact, networkSolution],
        ["Construction", "Construction traffic and the safety of pedestrians and cyclists across all phases.", "TfL Construction Logistics Plan (CLP) + Delivery and Servicing Plan (DSP)."],
      ],
    });
    doc.moveDown(0.5);
  }
  const concCapacityClause = isLondon && ukCap
    ? (ukCap.overCapacity === 0
        ? `no study junction exceeds the UK practical-capacity threshold (signals DoS ≥ 90% / priority and roundabout RFC ≥ 0.85) under the With-Development scenario (worst Degree of Saturation ${fmtNum(ukCap.worstDosPct, 1)}%), and capacity is not the limiting factor on this analysis.`
        : `${ukCap.overCapacity} junction(s) exceed the UK practical-capacity threshold (signals DoS ≥ 90% / priority and roundabout RFC ≥ 0.85) under the With-Development scenario (worst Degree of Saturation ${fmtNum(ukCap.worstDosPct, 1)}%), indicating mitigation would be warranted.`)
    : (losDrops === 0 && losEf === 0
        ? "no junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario, and capacity is not the limiting factor on this analysis."
        : `${losDrops} junction(s) project to deteriorate by one or more LOS categories under the With-Development scenario and ${losEf} junction(s) project to operate at LOS E or F, indicating mitigation would be warranted.`);
  doc.font("body").fontSize(10).fillColor("black").text(
    `On the basis of the screening-level cross-reference set out above, ${concCapacityClause} The following deliverables remain outstanding and are required for a submittable London Transport Assessment:`,
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

  // --- Appendices register (TfL Healthy Streets TA) -----------------------
  // The deep London TA binds its technical evidence as appendices A–N (per
  // the canonical Velocity / Holloway Park TA). The engine does not generate
  // them; this register sets out the expected appendix set + who prepares it.
  if (isLondon) {
    ldnSection(doc, "APPENDICES");
    ldnNote(doc, "A full London Healthy Streets TA binds its technical evidence as appendices A–N (per the canonical Holloway Park TA). This screening engine does not generate them; they are prepared by the project team / chartered engineer at submittal. The expected appendix set is:");
    table(doc, {
      headers: ["Appendix", "Contents", "Prepared by"],
      widths: [60, 296, 160],
      align: ["left", "left", "left"],
      rows: [
        ["A", "Proposed site plans / development drawings", "Architect / design team"],
        ["B", "Construction programme", "Contractor / project team"],
        ["C", "LinSig modelling audit process", "Transport consultant (LinSig 3)"],
        ["D", "Healthy Streets Check for Designers (workbook)", "Transport consultant (TfL XLSX)"],
        ["E", "Site access design", "Highway engineer"],
        ["F", "Stage 1 Road Safety Audit", "Independent RSA team"],
        ["G", "Junctions (ARCADY / PICADY) modelling", "Transport consultant"],
        ["H", "Cycle parking provision", "Design team (London Plan T5)"],
        ["I", "Swept-path analysis (operational phase)", "Highway engineer"],
        ["J", "Active Travel Zone photos / route surveys", "Transport consultant (WebCAT)"],
        ["K", "Traffic flow diagrams", "Transport consultant"],
        ["L", "Swept-path analysis (construction phase)", "Highway engineer / contractor"],
        ["M", "Assignment routes", "Transport consultant"],
        ["N", "Servicing trips", "Transport consultant"],
      ],
    });
    doc.moveDown(0.3);
  }

  // --- Screening annex — Affected junctions (screening-level) ------------
  // Surface the per-junction screening table only when §5.4 has been
  // demoted. When junction-impact is significant the table is already
  // the §5.4 headline; repeating it here would be noise. When demoted,
  // the table lands here so a reviewer can still audit which signals
  // the engine flagged + their LOS triplet (Current / No-Build / Build).
  if (r.junctionImpactSignificant === false && intersections.length > 0) {
    ldnSection(doc, "SCREENING ANNEX — AFFECTED JUNCTIONS");
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
  // London (Velocity): green chapter/section title with a green hairline rule
  // beneath it. Non-London UK (Manchester …) keeps the original black heading
  // — gated on velocityPaletteActive so Velocity's identity stays London-only.
  if (velocityPaletteActive) {
    doc.font("bold").fontSize(13).fillColor(VELOCITY_GREEN).text(title, { characterSpacing: 0.5 });
    const ry = doc.y + 2;
    doc.save().strokeColor(VELOCITY_GREEN).lineWidth(0.75)
      .moveTo(PAGE_MARGIN, ry).lineTo(doc.page.width - PAGE_MARGIN, ry).stroke().restore();
    doc.moveDown(0.45);
  } else {
    doc.font("bold").fontSize(13).fillColor("black").text(title, { characterSpacing: 0.5 });
    doc.moveDown(0.3);
  }
  doc.fillColor("black");
  doc.x = PAGE_MARGIN;
}

/** Subsection heading for the London renderer. */
function ldnSubsection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(11).fillColor(velocityPaletteActive ? VELOCITY_GREEN : "black").text(title);
  doc.fillColor("black");
  doc.moveDown(0.2);
  doc.x = PAGE_MARGIN;
}

/**
 * Chapter framing line. TfL's *Healthy Streets TA Recommended Contents &
 * Chapters* (17 June 2019) opens every chapter with an italic "i.e. …"
 * question that frames what the chapter must answer. Reproduced verbatim
 * under each chapter heading so the document matches the TfL format
 * exactly. London-only — the framing is TfL-specific.
 */
function ldnChapterIntro(doc: PDFKit.PDFDocument, text: string) {
  doc.x = PAGE_MARGIN;
  doc.font("body").fontSize(9.5).fillColor(TEXT_GRAY).text(text, { paragraphGap: 6 });
  doc.font("body").fontSize(10).fillColor("black");
  doc.x = PAGE_MARGIN;
}

/**
 * Secondary-text body note (gray) for the London renderer. Used for the
 * many Holloway-format subsections that the screening engine cannot
 * populate from its own data — they are emitted at the correct place in
 * the TOC with an honest "prepare at submittal" note so the document
 * matches the real TA's structure without fabricating analysis.
 */
function ldnNote(doc: PDFKit.PDFDocument, text: string) {
  doc.x = PAGE_MARGIN;
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(text, { paragraphGap: 6 });
  doc.font("body").fillColor("black");
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
  doc.font("bold").fontSize(10).fillColor(velocityPaletteActive ? VELOCITY_GREEN : BRAND_BLUE).text(tsTriggerSentence, { paragraphGap: 6 });
  doc.font("body").fontSize(10).fillColor("black");

  // UK capacity headline (London only) — same Ch-4 / Ch-6 UK capacity
  // computation (DoS / PRC / MMQ); UK reports do not use HCM LOS.
  const ukCap = isLondon ? londonCapacityHeadline(intersections) : null;

  const studyRadiusPhrase = isLondon ? `${radiusKm} km` : `${radiusKm} km (${fmtNum(radiusMi, 2)} mi)`;
  const summary = `This Transport Statement reports the anticipated transport effects of the proposed ${project.projectName || "development"} within ${region.displayName}, ${isLondon ? "Greater London" : "United Kingdom"}. ${intersections.length} junction${intersections.length === 1 ? "" : "s"} fall within a ${studyRadiusPhrase} study radius of the site. The analysis is screening-level and is prepared as a cross-reference to UK Transport Statement methodology; a submittable TS prepared by a chartered engineer would re-run trip generation on TRICS multi-modal rates and junction capacity in LinSig 3 / Junctions 11 as appropriate.`;
  doc.text(summary, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text("Headline findings:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  if (isLondon && ukCap) {
    if (ukCap.overCapacity === 0) {
      doc.text(`• No study junction exceeds the UK practical-capacity threshold (signals DoS ≥ 90% / priority and roundabout RFC ≥ 0.85) under the With-Development scenario; the worst Degree of Saturation is ${fmtNum(ukCap.worstDosPct, 1)}%.`, { paragraphGap: 2 });
      doc.text("• Highway capacity is not the limiting factor for this scheme on the basis of this screening; PTAL-banded car parking and sustainable-mode uptake remain to be confirmed at the chartered-engineer stage.", { paragraphGap: 4 });
    } else {
      doc.text(`• ${ukCap.overCapacity} junction${ukCap.overCapacity === 1 ? " exceeds" : "s exceed"} the UK practical-capacity threshold (signals DoS ≥ 90% / priority and roundabout RFC ≥ 0.85) under the With-Development scenario; the worst Degree of Saturation is ${fmtNum(ukCap.worstDosPct, 1)}%.`, { paragraphGap: 2 });
      doc.text(`• Mitigation would be warranted at the over-capacity junction${ukCap.overCapacity === 1 ? "" : "s"}, confirmed in LinSig 3 / Junctions 11.`, { paragraphGap: 4 });
    }
  } else if (losDrops === 0 && losEf === 0) {
    doc.text("• No junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario.", { paragraphGap: 2 });
    doc.text("• Highway capacity is not the limiting factor for this scheme on the basis of this screening; PTAL-banded car parking and sustainable-mode uptake remain to be confirmed at the chartered-engineer stage.", { paragraphGap: 4 });
  } else {
    doc.text(`• ${losDrops} junction${losDrops === 1 ? "" : "s"} project to deteriorate by one or more LOS categories under the With-Development scenario.`, { paragraphGap: 2 });
    doc.text(`• ${losEf} junction${losEf === 1 ? " operates" : "s operate"} at LOS E or F under With-Development and would warrant mitigation.`, { paragraphGap: 4 });
  }
  doc.fillColor("black");
  doc.moveDown(0.5);

  metricStrip(doc, isLondon && ukCap
    ? [
        { label: "Junctions assessed", value: String(ukCap.assessed) },
        { label: "Over capacity", value: String(ukCap.overCapacity) },
        { label: "Worst DoS", value: `${fmtNum(ukCap.worstDosPct, 1)}%` },
      ]
    : [
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
    "The analysis is generated by a screening engine calibrated to United States standards and is presented as a cross-reference to UK methodology, not as a substitute for it. Capacity analysis uses the HCM 6th Edition (Ch. 19, signalised junctions) rather than DMRB CD 116 / CD 123; trip generation uses US public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) rather than TRICS 8; LOS letters A–F are reported against the HCM Exhibit 19-8 control-delay thresholds. A chartered engineer preparing a submittable TS should re-run the affected junctions in LinSig 3 / Junctions 11 with TRICS multi-modal trip rates filtered per the TRICS Good Practice Guide 2025.",
    { paragraphGap: 6 },
  );
  doc.moveDown(0.3);

  ldnSection(doc, "2.0 SITE AND SURROUNDINGS");
  ldnSubsection(doc, "2.1 Site Identification");
  rows(doc, [
    ["Scheme", project.projectName || "—"],
    ["Land use (public-data proxy)", `${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
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
    `The proposed scheme is a ${tg.landUseName ?? "—"} (land use ${tg.landUseCode ?? "—"}) of ${tg.size ?? "—"} ${tg.unit ?? ""} at the address above. The scheme size sits within the Appendix B TS band for the use class (${sizeRule}). Access, servicing arrangements and any Travel Plan commitments are bespoke to the planning submission and should be drawn from the architectural and access drawings at the chartered-engineer stage.`,
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
    `Gross trip generation is calculated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land-use code ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. A submittable TS would substitute TRICS 8 multi-modal rates filtered per the TRICS Good Practice Guide 2025; the figures below are screening-level estimates after the London 38% auto-mode-share factor has been applied.`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Entering trips", "Exiting trips"],
    widths: [180, 100, 100],
    align: ["left", "right", "right"],
    rows: [
      ["Daily", fmtNum(((tg.dailyTrips ?? 0) as number) / 2), fmtNum(((tg.dailyTrips ?? 0) as number) / 2)],
      ["AM peak hour (08:00–09:00)", fmtNum(tg.amIn), fmtNum(tg.amOut)],
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
  const tsConcCapacityClause = isLondon && ukCap
    ? (ukCap.overCapacity === 0
        ? `no study junction exceeds the UK practical-capacity threshold (signals DoS ≥ 90% / priority and roundabout RFC ≥ 0.85) under the With-Development scenario (worst Degree of Saturation ${fmtNum(ukCap.worstDosPct, 1)}%), and capacity is not the limiting factor on this analysis.`
        : `${ukCap.overCapacity} junction(s) exceed the UK practical-capacity threshold (signals DoS ≥ 90% / priority and roundabout RFC ≥ 0.85) under the With-Development scenario (worst Degree of Saturation ${fmtNum(ukCap.worstDosPct, 1)}%), indicating mitigation would be warranted.`)
    : (losDrops === 0 && losEf === 0
        ? "no junction within the study network is projected to deteriorate by one or more LOS categories under the With-Development scenario, and capacity is not the limiting factor on this analysis."
        : `${losDrops} junction(s) project to deteriorate by one or more LOS categories under the With-Development scenario and ${losEf} junction(s) project to operate at LOS E or F, indicating mitigation would be warranted.`);
  doc.font("body").fontSize(10).fillColor("black").text(
    `On the basis of this screening-level Transport Statement, ${tsConcCapacityClause} The scheme falls within the DfT 2007 Appendix B TS size band for the use class (${sizeRule}) and trips none of the "regardless of size" escalators (peak-hour ≥ 30 vph, daily ≥ 100 vpd, ≥ 100 parking spaces, AQMA proximity, inadequate local transport infrastructure); a Transport Statement is therefore the appropriate deliverable shape under the de-facto DfT 2007 / PPG split. Promotion to a full Transport Assessment (TA) would be required only if (i) the scheme grew above the TA size threshold for the use class, or (ii) any Appendix B escalator subsequently triggered.`,
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
    houston: `Houston worksheet-tier deliverable per the Infrastructure Design Manual (IDM) Ch. 15, revision 07-01-2022, Table 15.04.01 — currently routed to ${houstonSubTier}. The IDM publishes four Table 15.04.01 categories — I (<100 PHT), II (100–499), III (500–999), IV (≥1,000) — plus the sub-tiers below Category I (Access Management Form / Technical Memorandum 80–120 PHT per §15.04.A.5). ≥100 PHT triggers the scoping meeting that determines whether a full TIA is required (§15.04.A.4.a); the AMF + Tech Memo + Cat I band is collapsed into this worksheet shape.`,
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
    ["Proposed land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Existing land use", "Subject to site verification — no existing-use trip credit applied at the worksheet tier."],
  ]);
  doc.moveDown(0.5);

  // --- §3 Trip Generation Estimate -------------------------------------
  gaSection(doc, "3.0 TRIP GENERATION ESTIMATE");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is estimated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. No pass-by or internal capture credits are applied at the worksheet tier — those reductions belong in the formal Full TIA where one is required.`,
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
    houston: `Per IDM Ch. 15 (revision 07-01-2022), projects below the Category III Full TIA scoping threshold are gated through one of three lower tiers: Access Management Form (driveway-only review), Technical Memorandum (80–120 PHT band per §15.04.A.5), or Category I TIA (<100 PHT per Table 15.04.01). ≥100 PHT triggers a scoping meeting that determines whether a full TIA is required (§15.04.A.4.a). The screened ${fmtNum(pht)} PM PHT and ${fmtNum(daily)} daily trips route this project to ${houstonSubTier}.`,
    austin: `Per Land Development Code §25-6-117 and TIA Guidelines (June 2022), a project must submit the TIA Determination Worksheet whenever site-generated traffic is < 2,000 vpd net new. The screened ${fmtNum(daily)} daily trips falls within that band, so this Determination Worksheet is the gating deliverable. Scope of Work + Full TIA submittal follows only if Transportation Development Services (TDS) escalates after worksheet review.`,
    dallas: `Per the Paving/Drainage Traffic Impact Study Waiver form, less than 1,000 trips per day requires no Traffic Impact Study or Waiver; greater than 1,000 trips per day requires either a Traffic Impact Study or a TIS Waiver, with waivers considered per-case by the Director of the Department of Development Services. The screened ${fmtNum(daily)} daily trips (and ${fmtNum(pht)} PM PHT) falls within the no-action band. Development Code §51A-4.803 (Site Plan Review) governs the engineering submittal regardless of whether a TIS is required.`,
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
    houston: "Per Houston IDM Ch. 15, the Access Management Data Summary Form (embedded in IDM pp. 15-5 to 15-8) is required for all commercial site driveways regardless of TIA tier — driveway spacing, throat depth, and turn-lane assessment must be submitted as a companion to this worksheet. CPC 101 Form is also required per the OCE TIA Content Guide p. 3. Where any site frontage is on a TxDOT route (IH / US / SH / FM / RM / BU / BS / SL / SS), a parallel DAP application is required.",
    austin: "Per Transportation Criteria Manual §10, even at the Determination Worksheet tier the consultant should verify the adjacent transit/bike network against the Austin Strategic Mobility Plan, fronting-street classification against the Future Land Use Map, and any AISD school-zone overlays. The City of Austin TIA Guidelines (June 2022) Sustainable Modes Analysis is not required at this tier but should be summarized informally.",
    dallas: "Per Development Code §51A-4.803, the Site Plan Review tracks the substantive engineering items even when a TIS is waived: adjacent access spacing, intersection sight distance, sidewalk continuity, and any Connect Dallas multimodal corridors abutting the site. The TIS Waiver form should be filed concurrently with the engineering site plan via ProjectDox.",
    fortworth: "Per the FW Transportation Engineering Manual (June 2019), the TIA Worksheet requires: (a) trip generation table; (b) site access geometry against the Master Thoroughfare Plan classification; (c) pass-by/internal-capture justification (often n/a at this tier); (d) any NCTCOG Regional Thoroughfare Plan corridors abutting the site; (e) driveway sight distance and posted-speed verification. The full set should be carried into the formal submittal.",
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
    "This worksheet-tier deliverable has been prepared at the screening level defined by the host jurisdiction's TIA-tier scheme and is sealed by a Texas-licensed Professional Engineer per 22 TAC §137.33 (Sealing Procedures), promulgated under The Texas Engineering Practice Act (Tex. Occ. Code Ch. 1001). The signing PE attests only to the worksheet-tier scope and that the project's screened trip generation falls below the host jurisdiction's Full TIA threshold. It does not substitute for a Full TIA where one is later required by the reviewing agency.",
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
    houston: `Houston Category II per IDM Ch. 15 (revision 07-01-2022) Table 15.04.01 — the mid-tier between Category I (<100 PHT) and Category III (500–999 PHT). The screened ${fmtNum(pht)} PM PHT routes this project to Category II (100–499 PHT). LOS D remains the published threshold of significance for area-street facilities per IDM §15.04.B.6.a.`,
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
    ["Proposed land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Existing land use", "Subject to site verification — abbreviated-tier credit handled per the host jurisdiction's TIA standard."],
  ]);
  doc.moveDown(0.5);

  // --- §3 Trip Generation ---------------------------------------------
  gaSection(doc, "3.0 TRIP GENERATION ESTIMATE");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation is estimated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. At the abbreviated tier, pass-by and internal-capture credits per standard pass-by / internal-capture screening methodology are applied where supported by the land use and adjacent network context.`,
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
    houston: `Per IDM Ch. 15 (revision 07-01-2022) Table 15.04.01, Category II covers the 100–499 PHT band. The screened ${fmtNum(pht)} PM PHT places this project within that band. The OCE TIA Content Guide outline is reduced relative to Category III — LOS analysis at the site-access intersections plus adjacent signalized intersections (LOS D threshold of significance per IDM §15.04.B.6.a), no full corridor-capacity sweep. The Access Management Data Summary Form remains required as a commercial-site companion regardless of TIA tier; CPC 101 Form is also required per TIA Content Guide p. 3.`,
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
      "Reminder: the Access Management Data Summary Form (IDM pp. 15-5 to 15-8) and the CPC 101 Form (OCE TIA Content Guide p. 3) must accompany this Category II TIA for any commercial site, submitted via the Houston Permitting Center alongside the report. The TIA must be sealed by a Texas-licensed civil PE per IDM §15.04.B.1.a (civil specialty, not traffic).",
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
    "This abbreviated-tier TIA has been prepared at the mid-tier deliverable defined by the host jurisdiction's TIA scheme and is sealed by a Texas-licensed Professional Engineer per 22 TAC §137.33 (Sealing Procedures), promulgated under The Texas Engineering Practice Act (Tex. Occ. Code Ch. 1001). The signing PE attests only to the abbreviated-tier scope and the screened operational outcome reported above. It does not substitute for a Full TIA where one is later required by the reviewing agency.",
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
    houston: "Houston Public Works — Office of the City Engineer (OCE), Traffic Group, per the Infrastructure Design Manual (IDM) Ch. 15, revision 07-01-2022, and the OCE TIA Content Guide.",
    austin: "Austin Transportation and Public Works — Transportation Development Services (TDS), per Land Development Code Ch. 25-6 (§25-6-117 TIA trigger), Transportation Criteria Manual §10, and the City of Austin TIA Guidelines (June 2022).",
    dallas: "Dallas Department of Transportation — Traffic Engineering, per Dallas Development Code §51A-4.803 (Site Plan Review) and Connect Dallas (Strategic Mobility Plan, adopted Apr 28, 2021).",
    fortworth: "Fort Worth Transportation & Public Works (TPW) — Traffic Engineering, per the City of Fort Worth Transportation Engineering Manual (June 2019) and the Master Thoroughfare Plan.",
    sanantonio: "San Antonio Development Services Department (DSD) — Land Development, per Unified Development Code §35-502 (TIA & Roughly Proportionate Determination) and UDC Appendix B §35-B122 (TIA Submittal Contents).",
    txdot: "the TxDOT District with jurisdiction over the host route (no incorporated host-city standard applies).",
  }[juris];
  const cityThreshold = {
    houston: "≥100 PHT triggers a scoping meeting that determines whether a full TIA is required (IDM §15.04.A.4.a, revision 07-01-2022). The Technical Memorandum tier is 80–120 vph during AM or PM peak (IDM §15.04.A.5). Table 15.04.01 categories: I (<100 PHT), II (100–499), III (500–999), IV (≥1,000).",
    austin: "≥ 2,000 vpd unadjusted triggers analysis. 2,000–5,000 vpd → Transportation Assessment + TDM Plan; > 5,000 vpd → Full TIA + TDM Plan (Austin TIA Guidelines, June 2022; LDC §25-6-117 is the statutory trigger, but the 2,000/5,000 bands live in the Guidelines, not the LDC). Below 2,000 vpd a Neighborhood Traffic Analysis or TIA Determination Worksheet may still be required.",
    dallas: "Less than 1,000 trips per day → no Traffic Impact Study or Waiver required (Paving/Drainage TIS Waiver form). Greater than 1,000 trips per day → either a Traffic Impact Study or a TIS Waiver is required; waivers are considered per-case by the Director of the Department of Development Services.",
    fortworth: "≥ 300 PHT or ≥ 5,000 ADT triggers a Full TIA; 100–299 PHT triggers an Abbreviated TIA; <100 PHT uses the TIA Worksheet only.",
    sanantonio: "≥ 76 peak-hour trips (UDC §35-502). An update-TIA is required when an increase to an existing TIA or zoning results in ≥ 76 PHT or ≥ 10% of the total PHT for the development, whichever is greater. Below 76 PHT a Peak Hour Trip Generation Form only.",
    txdot: "no statewide trip-count trigger; TSP §16.2.1 Categories 1 (100–499 PHT), 2 (500–1,000 PHT), 3 (>1,000 PHT) drive the level of effort.",
  }[juris];
  const cityLos = {
    houston: "Per IDM §15.04.B.6.a: the need for mitigation is determined by using the qualitative measure Level-of-Service (LOS); the threshold of significance for transportation facilities on the area street system is LOS D.",
    austin: "LOS A–F (no VMT switch as of June 2022). Mitigation required when a movement drops from LOS D (Background) to LOS E (Background plus site).",
    dallas: "Transitional — Connect Dallas (Apr 2021) is moving Dallas from LOS toward VMT. Practice currently uses LOS D suburban / LOS E in the CBD.",
    fortworth: "LOS D for arterials and collectors outside the CBD; LOS E in the CBD and Urban Villages.",
    sanantonio: "LOS D generally; LOS E inside Transit-Oriented Development overlays per UDC §35-208.",
    txdot: "no statewide LOS mandate — per TSP §16.4.3, the LOS threshold (and queue / travel-time MOEs) is agreed upon with the District during preliminary scoping.",
  }[juris];
  const cityDeliverables = {
    houston: "TIA + Access Management Data Summary Form (mandatory for commercial sites, embedded in IDM pp. 15-5 to 15-8) + CPC 101 Form (per OCE TIA Content Guide p. 3), submitted via the Houston Permitting Center. Approval is required before plan submittal if no plat is required. The TIA must be sealed by a Texas-licensed civil PE (civil specialty per IDM §15.04.B.1.a, not traffic specialty).",
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
  const summary = `This Traffic Impact Analysis (TIA) presents the anticipated traffic impacts of the proposed ${project.projectName || "development"} located within ${region.displayName}, Texas. The study evaluates ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile study radius. The report follows the outline in TxDOT Traffic and Safety Analysis Procedures Manual (TSP) Chapter 16 Appendix Q, with capacity analysis per the Highway Capacity Manual (HCM) latest edition and trip generation per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716). The development generates a determining peak-hour trip count of ${determiningPht.toFixed(0)} ${determiningPht === 1 ? "vehicle" : "vehicles"}, classifying it as ${catLabel} under TSP §16.2.1 Table 16-1.`;
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
    ["Land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
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
    "Existing AADT for state-system segments is taken from the TxDOT Open Data Portal AADT layer (annual refresh). Peak-hour turning-movement counts at study intersections should be collected mid-week (Tue/Wed/Thu), school-in-session, within 12 months of submittal — per Houston IDM §15.06.01.A counts must be within 12 months in high-growth areas and within 24 months elsewhere; Austin TDS no longer accepts pre-COVID counts by default.",
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
    `Trip generation is calculated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Per TSP §16.3.3, the fitted curve equation is preferred when the data plot contains at least 20 data points or has an R² of at least 0.75; otherwise average rates apply. Daily, AM peak, and PM peak hour trips are reported below.`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Entering trips", "Exiting trips"],
    widths: [180, 100, 100],
    align: ["left", "right", "right"],
    rows: [
      ["Daily", fmtNum(((tg.dailyTrips ?? 0) as number) / 2), fmtNum(((tg.dailyTrips ?? 0) as number) / 2)],
      ["AM peak hour", fmtNum(tg.amIn), fmtNum(tg.amOut)],
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

  renderDiurnalCharts(doc, r);

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
  if (r.growthSource) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Background traffic is grown at ${r.growthAppliedPct?.toFixed(2) ?? "—"}% per year, derived from measured per-segment compound annual growth at TxDOT count stations within the study metro. Source: ${r.growthSource}. Per TSP §16.4.2, the prescribed method is to average at least the last five years of historical AADT data for the segment analyzed; the metro-level median published here is a starting point and should be refined to per-segment trend on the affected facilities before formal submittal. Background growth data is also commonly sourced from the host city or regional MPO travel-demand model (H-GAC, NCTCOG, CAMPO, or AAMPO depending on the MSA).`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Background traffic is grown at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"}. Per TSP §16.4.2, the prescribed method is to average at least the last five years of historical AADT data for the segment analyzed to derive an average annual growth rate; the value applied here is a screening default and should be re-calibrated to the affected segments' five-year AADT trend before formal submittal. Background growth data is also commonly sourced from the host city or regional MPO travel-demand model (H-GAC, NCTCOG, CAMPO, or AAMPO depending on the MSA).`,
      { paragraphGap: 6 },
    );
  }
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
    tripGenExternalNote(doc, periods);
    doc.moveDown(0.4);
  }
  renderTripDistributionSection(doc, r as any, {
    subsectionNumber: "5.6",
    headingFn: gaSubsection,
    cap: 20,
    intersections,
    periods,
  });

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
      ? "Within the CTRMA managed-lane corridor (183A, MoPac Express, 290 Toll), any new or modified access onto the CTRMA frontage roads is governed by CTRMA Board Resolution 07-58 (Policies and Procedures for Access Management of Frontage Roads on CTRMA Facilities) and remains subject to the underlying TxDOT DAP review."
      : "Where the project fronts an HCTRA (Sam Houston Tollway, Hardy Toll Road, Westpark Tollway), NTTA (DNT, PGBT, SRT, LLTB), CTRMA (183A, MoPac Express, 290 Toll), or TxDOT-operated toll facility frontage road, access review runs through TxDOT (and the host city where applicable); the tollway authority itself reviews only direct facility impacts on ramp / managed-lane geometry.";
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(ctrmaNote, { paragraphGap: 6 });
    doc.fillColor("black");
  }

  // Proposed site driveways (opt-in) — integrated into the §6.1 Site Access
  // section; renders only when driveways are supplied (byte-identical otherwise).
  renderDrivewayAccessBlock(doc, r, region, gaSubsection, "Proposed Site Driveways");

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
      "Houston commercial submittals must include the Access Management Data Summary Form (IDM pp. 15-5 to 15-8) and the CPC 101 Form (OCE TIA Content Guide p. 3) alongside this TIA; an MDR drainage report integration is required where new impervious cover is added — none of these are generated by this screening report [placeholder — requires site-civil inputs].",
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
  renderFarsKBlock(doc, r, { subsection: "7.1 NHTSA FARS Fatal Crash History" });
  gaSection(doc, "8.0 CONCLUSIONS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Based on the screening analysis above, the project is classified as ${catLabel} per TSP §16.2.1. Of the ${intersections.length} affected intersection${intersections.length === 1 ? "" : "s"} analyzed, ${losDrops} drop one or more LOS grade and ${losEf} operate at LOS E or F under the Background-plus-site scenario. The horizon analyzed in this screening is the buildout year only; the full submittal must cover the years required by the project's TIA category per TSP §16.2.1 Table 16-1.`,
    { paragraphGap: 6 },
  );

  // --- §9 Recommendations ------------------------------------------------
  gaSection(doc, "9.0 RECOMMENDATIONS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Submit this TIA to ${cityName}, with parallel TxDOT-District coordination where any state-system route is in frontage. Validate the screening results against current-edition manuals, updated turning-movement counts within the most recent 12 months (Houston IDM §15.06.01.A: 12 months in high-growth areas, 24 months elsewhere), and the preliminary-scoping outcome with the District. The report must be sealed by a Texas-licensed Professional Engineer per 22 TAC §137.33 (Sealing Procedures), promulgated under The Texas Engineering Practice Act (Tex. Occ. Code Ch. 1001), with the seal on the cover and on every sealed sheet${juris === "houston" ? " — Houston IDM §15.04.B.1.a requires the signing PE to hold the civil specialty (not traffic)" : ""}.`,
    { paragraphGap: 6 },
  );

  // --- §10 Appendices ----------------------------------------------------
  gaSection(doc, "10.0 APPENDICES");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "The formal submittal appendices, per the Appendix Q outline, should include: scoping correspondence with the TxDOT District; site plan figures; TMC count sheets with date, weather, observer; Trip-generation worksheets with rate/equation selection rationale; HCS / Synchro / Vissim / Vistro output; signal warrant analyses citing the TMUTCD (2025 edition, effective Jan 18, 2026); auxiliary-lane and sight-distance worksheets; CRIS crash data summary; and the host-jurisdiction's submission forms (Houston Access Management Data Summary Form + CPC 101 Form / Austin TIA Determination + Scope / Dallas TIS Waiver / Fort Worth TIA Worksheet / San Antonio TIA Threshold Worksheet + Rough Proportionality calculation).",
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
    chicago_cdot: "Tiered by dwelling-unit count per the CDOT TDM Guidelines v1.2 (February 2024): Tier 1 (20–50 DU site plan), Tier 2 (51–175 DU TDM Memo), Tier 3 (>175 DU full TDM Study + Plan). Connected Communities Ordinance transit-served-location designation (½ mile of a CTA/Metra rail station entrance, or ¼ mile of an eligible high-frequency CTA/Pace bus corridor with ≤15-minute midday headways) drives by-right parking reductions and informs trip-generation reductions. The July 16, 2025 amendment (O2025-0015577, effective September 25, 2025) eliminated parking mandates outright in transit-served locations outside the downtown D districts — confirm the project's zoning district and the version of the Ordinance in force at submittal.",
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
  const summary = `This Traffic Impact Study (TIS) presents the anticipated traffic impacts of the proposed ${project.projectName || "development"} located within ${region.displayName}, Illinois. The study evaluates ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile study radius using methodology consistent with the Highway Capacity Manual current edition and the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716). Trip generation is calculated for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}) at a development size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`;
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
    ["Land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
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
    `Trip generation is calculated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. IDOT District 8 Appendix A requires "the current edition of the ITE Trip Generation Manual" for a submitted study; the figures here are public-data screening estimates (NHTS 2017 / SANDAG 2002 / NCHRP 716) and must be re-run with the jurisdiction-required source before submittal. Pass-by and internal-capture credits are taken from standard screening methodology and applied only against the external trips assigned to the study network. Supplemental sources are allowed for land uses not represented in ITE, with District permission.`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Entering trips", "Exiting trips"],
    widths: [180, 100, 100],
    align: ["left", "right", "right"],
    rows: [
      ["Daily", fmtNum(((tg.dailyTrips ?? 0) as number) / 2), fmtNum(((tg.dailyTrips ?? 0) as number) / 2)],
      ["AM peak hour", fmtNum(tg.amIn), fmtNum(tg.amOut)],
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
      "Chicago additional reductions (TDM context, not auto-applied): Connected Communities Ordinance transit-served-location reduction (½-mi rule from CTA/Metra rail station entrance per §17-3-0308 / §17-4-0301), pedestrian-network density credits, and P-street designation effects on access geometry. The site's transit-served eligibility and TDM Measures Matrix commitments determine the final trip-reduction figure used in the TDM deliverable; this screening report shows the screening-base trip generation only.",
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
    tripGenExternalNote(doc, periods);
    doc.moveDown(0.5);
  }

  renderDiurnalCharts(doc, r);

  renderTripDistributionSection(doc, r as any, {
    subsectionNumber: "4.1",
    assignmentNumber: "4.2",
    headingFn: gaSubsection,
    cap: 20,
    intersections,
    periods,
  });

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
  renderFarsKBlock(doc, r, { subsection: "7.5 NHTSA FARS Fatal Crash History" });
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
    ["Proposed land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Screened daily / PM-peak trips (screening base)", `${fmtNum(tierInput.dailyTrips)} / ${fmtNum(tierInput.pmPeakTrips)}`],
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
    `If CDOT PRC requests additional analysis — e.g., the project triggers a Planned Development designation, the site fronts an IDOT state route requiring co-review, or the project crosses a CCO size threshold during design refinement — regenerate this report with Tier = Abbreviated (Tier 2 TDM Memo) or Full (Tier 3 TDM Study + Plan). The dwelling-unit count screening for residential land uses (land-use 220-series): Tier 1 = 20–50 DU, Tier 2 = 51–175 DU, Tier 3 = >175 DU. The screened project size of ${tg.size ?? "—"} ${tg.unit ?? ""} falls within the Tier 1 band.`,
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
    ["Proposed land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Proposed development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Tier (CDOT TDM Guidelines v1.1)", "Tier 2 — TDM Memo (residential 51–175 DU, or equivalent threshold per use class)"],
    ["Screened daily / PM-peak trips (screening base)", `${fmtNum(tierInput.dailyTrips)} / ${fmtNum(tierInput.pmPeakTrips)}`],
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
    `Baseline trip generation is calculated per the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at a proposed size of ${tg.size ?? "—"} ${tg.unit ?? ""}. The Tier 2 TDM Memo's primary performance metric is the projected single-occupancy-vehicle (SOV) trip share AFTER the selected TDM strategies are applied. CDOT's baseline goal is that the project demonstrate an SOV share ≤ 50% of total trips. Reductions from the screening base are claimed against the modal hierarchy: pedestrian trips (walk-up from transit-served-location density), transit trips (CTA / Metra catchment), bicycle trips (PBL network connectivity + Divvy access), shared-vehicle trips (carpool / vanpool, TNC), and trip elimination (work-from-home, mixed-use internal capture).`,
    { paragraphGap: 6 },
  );
  table(doc, {
    headers: ["Period", "Screening base", "After TDM (target)", "SOV share goal"],
    widths: [140, 90, 110, 100],
    align: ["left", "right", "right", "right"],
    rows: [
      ["Daily", fmtNum(tierInput.dailyTrips), "—", "≤ 50%"],
      ["AM peak hour", fmtNum(tg.amIn), fmtNum(tg.amOut), "≤ 50%"],
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
    "CDOT's baseline performance goal for a Tier 2 TDM Memo is that the project demonstrate ≤50% single-occupancy-vehicle (SOV) share of total daily trips after the selected TDM strategies are applied. SOV share is computed against the screening-base daily trip count, net of mode-shift, internal-capture, and trip-elimination credits, with documented source rates. Projects in transit-served locations with strong walk-up density commonly exceed the 50%-reduction goal; suburban-style projects (limited transit catchment + high parking ratios) may fail this gate and trigger escalation to a Tier 3 TDM Study + Plan.",
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
    `Daily VMT is estimated as the product of net external auto-mode trips and an assumed average trip length of ${avgTripLen.toFixed(0)} miles for land use ${luCode} (${luName}). This trip-length assumption is conservative and reflects Atlanta-region NHTS/ARC regional-travel-survey literature for the land-use category; the formal DRI submittal should substitute a project-specific value from the ARC Activity-Based Model where available.`,
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
    `Reduction sources: pass-by per standard screening methodology; internal capture per ULI Mixed-Use Internal Capture defaults; alternative-mode share from ACS B08301 for ${region.displayName} (${(autoModeShare * 100).toFixed(0)}% auto). Assumed average trip length is a screening input — not a calibrated AOI-specific value.`,
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
          : "land use does not indicate mixed-use programming",
      ],
      [
        "Internal capture credit (mixed-use)",
        internalCaptureCredit ? "Eligible — auto-computed" : "Not claimed",
        internalCaptureCredit ? `${fmtNum(intCapPct, 0)}% credit applied per ULI defaults` : "No internal-capture credit applied",
      ],
      [
        "Pass-by trip credit",
        passByCredit ? "Eligible — auto-computed" : "Not claimed",
        passByCredit ? `${fmtNum(passByPct, 0)}% credit applied per standard pass-by screening methodology` : "No pass-by credit applied",
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
 * MTSIH 2024 + statewide Policy 000-525-006 conventions.
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
      losStandardNote: "Per the Miami-Dade Comprehensive Development Master Plan (CDMP) Transportation Element; SHS LOS D urbanized per FDOT Policy 000-525-006 applies on State Highway System frontage",
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
      losStandardNote: "LOS D on arterials per ULDC Table 12.B.2.C (triple table: link service volumes / intersection thresholds / speed thresholds); SHS LOS D urbanized per FDOT Policy 000-525-006 applies on State Highway System frontage",
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
      losStandardNote: "Mobility-fee jurisdiction — no vehicle LOS pass/fail; SHS LOS D urbanized per FDOT Policy 000-525-006 applies on State Highway System frontage for connection-permit review",
      tripThreshold: "Per Land Development Code; mobility fee assessed at building permit",
      horizonConvention: "Per Land Development Code; mobility fee applies at permit (no horizon-year LOS test)",
      mpoName: "Plan Hillsborough (Hillsborough TPO)",
      preStudyMeetingRequired: false,
      methodologyLetterAppendix: "A",
      certificationFrontMatter: false,
      threeTrackEndChapters: false,
      feeMethodologyNote: "The Hillsborough mobility fee schedule blends ITE 10th Edition (2017) rates with the Florida Trip Characteristics Studies Database — a PROPRIETARY Tindale Oliver / Stantec corpus, NOT an FDOT public asset (no public URL, no API). Vehicle occupancy 1.40 persons/vehicle per Tampa Bay Regional Planning Model. ITE is on 11th Ed. for FDOT-wide MTIA work; the Hillsborough fee schedule has not yet migrated.",
      extraNote: "Trip generation for the mobility-fee calculation should be prepared in parallel using the published Hillsborough fee schedule; the trip generation reported in this analysis follows public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) per MTSIH 2024 §3.5.",
    };
  }
  if (inBox(28.34, 28.78, -81.66, -80.87)) {
    return {
      key: "orange",
      name: "Orange County (Orlando)",
      fdotDistrict: "FDOT District 5 (DeLand)",
      framework: "Concurrency + STAMP overlay (Specific Transportation Analysis Methodology Plan)",
      frameworkDoc: "Orange County STAMP — adopted via Ordinance 2023-11, effective 2024-02-27; layered on existing Orange County concurrency",
      losStandardNote: "Per Orange County Comprehensive Plan; SHS LOS D urbanized per FDOT Policy 000-525-006 applies on State Highway System frontage",
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
      losStandardNote: "Mobility-fee jurisdiction — no vehicle LOS pass/fail; SHS LOS D urbanized per FDOT Policy 000-525-006 applies on State Highway System frontage for connection-permit review",
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
    frameworkDoc: "MTSIH 2024 + statewide Policy 000-525-006",
    losStandardNote: "SHS LOS D in urbanized areas and LOS C outside urbanized areas per FDOT Policy 000-525-006",
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
 * Policy 000-525-006 (SHS LOS standards).
 *
 * Key conventions that differ from the generic / Georgia renderer:
 *   - SHS LOS standard is D in urbanized areas and C outside urbanized
 *     areas per Policy 000-525-006 (not a blanket LOS D).
 *   - "MTIA" / "Multimodal Transportation Impact Assessment" is the
 *     FDOT-preferred term; multimodal scope is reflected throughout.
 *   - Connection / access work cites Rule 14-96 F.A.C. (Connection
 *     Permits) and Rule 14-97 F.A.C. (Access Classification).
 *   - Geometric / driveway design cites the FDOT Design Manual (FDM),
 *     not the superseded Plans Preparation Manual.
 *   - Committed-projects review uses the FDOT Five-Year Work Program,
 *     not GA TIP/STIP.
 *   - DRI is curtailed post-2015 SB 1216 (Ch. 2015-30) + CS/CS/HB 1151
 *     (Ch. 2018-158); the renderer does not assume DRI review and instead
 *     frames the deliverable around local concurrency / comp plan
 *     amendments / FDOT connection permits.
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

  // ─────────────────────────────────────────────────────────────────────
  // Florida TIS — canonical section structure mirrors the Caltran Engineering
  // Group, Inc. FDOT-District format (validated against the HCA Florida
  // Westside Hospital Re-development TIS, City of Plantation / Broward County,
  // 2026): 1.0 Executive Summary · 2.0 Analysis Methodology · 3.0 Introduction
  // · 4.0 Scenario 1 (Existing) · 5.0 Scenario 2 (No-Build) · 6.0 Scenario 3
  // (Build) · 7.0 Level of Service Analysis · 8.0 Queue Analysis · 9.0 Turn
  // Lane Evaluation · 10.0 Concurrency Analysis · 11.0 Transit and Mobility ·
  // 12.0 Crash Analysis · 13.0 Preliminary Signal Warrant Analysis · 14.0
  // Conclusions and Recommendations. Firm-neutral (white-label) — the running
  // firm's brand is applied on the cover by renderStudyPdf, not here.
  // ─────────────────────────────────────────────────────────────────────
  const openingYear = req.openingYear ?? "—";
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);

  // --- 1.0 Executive Summary --------------------------------------------
  gaSection(doc, "1.0 EXECUTIVE SUMMARY");
  doc.font("body").fontSize(10).fillColor("black");
  doc.text(
    `This Traffic Impact Study has been prepared to evaluate the potential traffic impact, identify short-term roadway and circulation needs, determine potential mitigation strategies, and identify critical traffic issues that should be addressed during the planning process of the proposed ${project.projectName || "development"}, located at ${req.address ?? (project as any).address ?? region.displayName}, within ${jur.name}, Florida. The host controlling jurisdiction is ${jur.name} (${jur.fdotDistrict}); the applicable review framework is ${jur.framework}. Analysis follows the FDOT Multimodal Transportation Site Impact Handbook (MTSIH, March 25, 2024) and the FDOT Quality/Level of Service Handbook v6.0 (August 2025); capacity analysis follows the Highway Capacity Manual 6th Edition consistent with FDOT Traffic Analysis Handbook §4.1. The study covers ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile study area for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}) at a development size of ${tg.size ?? "—"} ${tg.unit ?? ""}.`,
    { paragraphGap: 6 },
  );
  doc.text("As part of this Traffic Impact Study, the following assignments were prepared consistent with the FDOT-approved methodology:", { paragraphGap: 2 });
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY);
  doc.text("•  Existing geometric conditions and assessment of the study impact area.", { paragraphGap: 2, indent: 6 });
  doc.text("•  Traffic data collection — daily volume counts and turning-movement counts at the critical study intersections and site driveways.", { paragraphGap: 2, indent: 6 });
  doc.text("•  Evaluation of existing traffic operations — Level of Service (LOS) and concurrency analysis.", { paragraphGap: 2, indent: 6 });
  doc.text("•  Traffic growth analysis, including committed-development assessment.", { paragraphGap: 2, indent: 6 });
  doc.text(`•  Simulation of existing (current-year) and future conditions (opening year ${openingYear}) across three scenarios.`, { paragraphGap: 2, indent: 6 });
  doc.text("•  Queue, turn-lane, and preliminary signal-warrant evaluation of the impacted network.", { paragraphGap: 4, indent: 6 });
  doc.fillColor("black");

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

  // --- 2.0 Analysis Methodology -----------------------------------------
  gaSection(doc, "2.0 ANALYSIS METHODOLOGY");
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

  gaSubsection(doc, "2.1 Controlling Guidance");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Primary references: FDOT Multimodal Transportation Site Impact Handbook (MTSIH), March 25, 2024; FDOT Multimodal Transportation Site Impact Applications Guide, June 5, 2024; FDOT Quality/Level of Service Handbook v6.0, August 2025; FDOT Policy 000-525-006 (Level of Service Targets for the State Highway System); FDOT Procedure 525-030-120 (project traffic forecasting); FDOT Traffic Analysis Handbook (TAH), October 2025.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "2.2 Analysis Software");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per FDOT TAH §4.1, approved analysis tools are HCS, Synchro / SimTraffic, SIDRA INTERSECTION (roundabouts), CORSIM, and Vissim. This screening analysis applies the HCM 6th Edition signalized-intersection model consistent with HCS output formatting. Vistro is not included in the FDOT TAH tool inventory; formal submittal output should be prepared in HCS or Synchro.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "2.3 Traffic Data Collection");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per MTSIH 2024, roadway-segment counts should be 72 consecutive hours (Monday afternoon through Friday morning) in urbanized, transitioning, and urban area classes, and 7 days in rural areas, in 15-minute increments on typical weekdays excluding holiday weeks. The default analysis peak per MTSIH 2024 §2.3.1 is the Weekday PM Peak Hour of Adjacent Street Traffic (one hour between 4–6 PM); MTSIH 2024 imposes no blanket Saturday-peak requirement for retail or restaurant land uses — midday, Saturday, or other special peaks are added only where site characteristics warrant (the Applications Guide fast-food case study analyzes AM + PM + midday). For turning-movement counts, MTSIH 2024 Appendix A (p. A-3) requires AM and PM TMCs covering trucks, pedestrians, and bicycles but does not prescribe duration or bin size; both are agreed at the pre-application methodology meeting. The Applications Guide Case Study 2 (§3.4.3) uses 8-hour TMCs (3 hr AM + 2 hr midday + 3 hr PM) as a worked example, while 2-hr AM and 2-hr PM in 15-minute bins is common Florida practice.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "2.4 Analysis Scenarios and Time Horizons");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Per MTSIH 2024 §4.3, minimum analysis years are: Existing, Future Background (No-Build), Future Build, and Future Build with Mitigation. This study is organized around three scenarios consistent with FDOT District practice: Scenario 1 — Existing Conditions (current-year); Scenario 2 — Future Conditions No-Build (opening year ${openingYear}); and Scenario 3 — Future Conditions Build (opening year ${openingYear}). Opening year is canonical; there is no fixed +5 horizon for concurrency or connection-permit work. Each year is explicitly labeled. For a Comprehensive Plan Amendment (CPA) review, the analysis must additionally include short-term (5-year) and long-term (10-year minimum) horizons. ${jur.name} convention: ${jur.horizonConvention}.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "2.5 Trip Generation");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Trip generation follows the public-data screening rates (NHTS 2017 / SANDAG 2002 / NCHRP 716) for land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? ""}) at the proposed development size of ${tg.size ?? "—"} ${tg.unit ?? ""}. Net new external trips are calculated by applying pass-by and internal capture credits to gross trip generation per standard pass-by / internal-capture screening methodology. Per MTSIH 2024 §4.6.4, the fitted-curve equation is preferred when ≥20 data points are available, or when R² ≥ 0.75 with the fitted curve falling within the data cluster and weighted standard deviation > 55% of the weighted average rate; otherwise the weighted average rate applies. Per MTSIH 2024 §4.6.6.6, pass-by trips at a site driveway cannot exceed 10% of the adjacent peak-hour two-way street traffic — this reasonableness check applies per roadway when the site fronts multiple streets and should be verified against the adjacent-street counts at submittal time.`,
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
    ["Internal capture applied", `${r.internalCapturePctApplied ?? 0}% (MTSIH 2024 §4.6.9 sets no statewide numeric cap; rate negotiated at the methodology meeting per NCHRP 684 / standard screening methodology)`],
    ...(tg.existingLandUseCode
      ? [
          ["Existing on-site use (credit)", `LU ${tg.existingLandUseCode} — ${tg.existingLandUseName ?? ""} · ${tg.existingSize ?? "—"} ${tg.existingUnit ?? ""}`.trim()],
          ["Existing-use credit (PM peak)", `−${fmtNum(tg.existingUseCreditPm ?? 0)} external trips`],
          ["Net new external (PM peak)", `${fmtNum(tg.netNewExternalPm ?? tg.pmPeakTrips)} trips`],
        ] as [string, string][]
      : []),
    ["Background growth applied", `${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year(s)`],
    [`${jur.name} TIA threshold`, jur.tripThreshold],
    ["Weather condition", String(r.weather ?? req.weather ?? "clear")],
  ]);
  doc.moveDown(0.3);
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text("Table: Site Trip Generation Summary", { paragraphGap: 2 });
  doc.fillColor("black");
  table(doc, {
    headers: ["Period", "Entering trips", "Exiting trips"],
    widths: [180, 100, 100],
    align: ["left", "right", "right"],
    rows: [
      ["Daily", fmtNum(((tg.dailyTrips ?? 0) as number) / 2), fmtNum(((tg.dailyTrips ?? 0) as number) / 2)],
      ["AM peak hour", fmtNum(tg.amIn), fmtNum(tg.amOut)],
      ["PM peak hour", fmtNum(tg.pmIn), fmtNum(tg.pmOut)],
    ],
  });
  doc.moveDown(0.3);
  if (periods.length > 0) {
    // When a prior on-site use is supplied, show the full redevelopment table
    // (gross → internal capture → pass-by → existing-use credit → net new
    // external). Otherwise keep the greenfield columns (byte-identical output).
    const hasCredit = periods.some((p) => (p.tripGeneration ?? {}).existingUseCredit != null);
    if (hasCredit) {
      doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
        `Table: Trip Generation by Period (gross → pass-by / internal capture → external → existing-use credit → net new external). Existing-use credit is for the prior ${tg.existingLandUseName ?? "on-site use"} (LU ${tg.existingLandUseCode ?? "—"}, ${tg.existingSize ?? "—"} ${tg.existingUnit ?? ""}), computed on the same basis and credited per the FDOT redevelopment / change-of-use convention.`,
        { paragraphGap: 2 });
      doc.fillColor("black");
      table(doc, {
        headers: ["Period", "Raw", "Pass-by", "Int. cap.", "External", "Exist. credit", "Net new", "In", "Out"],
        widths: [86, 46, 50, 50, 56, 66, 56, 44, 44],
        align: ["left", "right", "right", "right", "right", "right", "right", "right", "right"],
        rows: periods.map((p) => {
          const t = p.tripGeneration ?? {};
          const net = t.netNewExternalTrips ?? t.externalTrips;
          return [
            String(p.periodLabel ?? p.period ?? ""),
            fmtNum(t.rawTrips),
            fmtNum(t.passByCredit),
            fmtNum(t.internalCaptureCredit),
            fmtNum(t.externalTrips),
            `−${fmtNum(t.existingUseCredit ?? 0)}`,
            fmtNum(net),
            fmtNum(t.inTrips),
            fmtNum(t.outTrips),
          ];
        }),
      });
      tripGenExternalNote(doc, periods);
      doc.moveDown(0.15);
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
        "In / Out are the directional split of the net new external trips (what is assigned to the network). The existing-use credit is floored so a smaller redevelopment yields zero net new trips rather than a reduction to background volumes; confirm the prior-use trip basis and any FDOT change-of-use thresholds (F.S. 335.182) at the methodology meeting.",
        { paragraphGap: 6 });
      doc.fillColor("black");
    } else {
      doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text("Table: Trip Generation by Period (raw → pass-by / internal capture → net external)", { paragraphGap: 2 });
      doc.fillColor("black");
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
      tripGenExternalNote(doc, periods);
    }
    doc.moveDown(0.3);
  }

  gaSubsection(doc, "2.6 Growth Rate");
  if (r.growthSource) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Per FDOT TAH §2.7, demand projections should use the adopted regional MPO/TPO travel-demand model (TDM); where TDM use is not warranted, historical AADT trend growth from Florida Traffic Online (FTO) is the FDOT-wide convention. Background traffic is grown at ${r.growthAppliedPct?.toFixed(2) ?? "—"}% per year, derived from the measured per-segment compound annual growth rate across the FDOT TDA Annual_Average_Daily_Traffic_Historical layer. Source: ${r.growthSource}. The metro-level median is published here for transparency; for formal submittal, the FDOT District / FTO segment-level trend on the affected facilities is the authoritative input and should be confirmed at the methodology meeting.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Per FDOT TAH §2.7, demand projections should use the adopted regional MPO/TPO travel-demand model (TDM); where TDM use is not warranted, historical AADT trend growth from Florida Traffic Online (FTO) is the FDOT-wide convention. Background traffic is grown at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"} for this analysis; the rate should be confirmed against FDOT historical AADT and agreed upon during the methodology meeting.`,
      { paragraphGap: 6 },
    );
  }

  gaSubsection(doc, "2.7 Level of Service Standards");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per FDOT Policy 000-525-006, the peak-hour automobile-mode LOS standard on the State Highway System is LOS D in urbanized areas and LOS C in rural and transitioning areas. Constrained or backlogged facilities maintain their facility-specific designation. Roadway segment LOS reporting uses the FDOT Q/LOS Handbook v6.0 Generalized Service Volume Tables (GSVTs). Intersection LOS uses HCM 6th Edition Chapter 19 (signalized intersections), Exhibit 19-8 thresholds: A ≤10s, B ≤20s, C ≤35s, D ≤55s, E ≤80s, F >80s of average control delay per vehicle.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "2.8 Context Classification");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Per FDOT Q/LOS v6.0 (which replaced \"complete streets\" terminology with \"context-based solutions\") and FDM Chapter 200 §200.4 (Table 200.4.1), the study network's context classification (C1 Natural, C2 Rural, C2T Rural Town, C3R Suburban Residential, C3C Suburban Commercial, C4 Urban General, C5 Urban Center, C6 Urban Core) calibrates mode treatments and design standards; cross-section and lane widths follow FDM Table 210.2.1. The controlling context class should be confirmed against the FDOT Preliminary Context Classification mapping during the methodology meeting.",
    { paragraphGap: 6 },
  );

  // --- 3.0 Introduction -------------------------------------------------
  gaSection(doc, "3.0 INTRODUCTION");
  doc.font("body").fontSize(10).fillColor("black").text(
    `The proposed ${project.projectName || "development"} is located at ${req.address ?? (project as any).address ?? "the study site"} within ${jur.name}, in the ${region.displayName} area. The project consists of ${tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "the proposed program"} under ITE land use ${tg.landUseCode ?? "—"} (${tg.landUseName ?? "—"}), and is anticipated to be completed by the opening year ${openingYear}.`,
    { paragraphGap: 6 },
  );
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", req.latitude && req.longitude ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°` : "—"],
    ["Region", region.displayName],
    ["Host jurisdiction", jur.name],
    ["FDOT District", jur.fdotDistrict],
    ["Review framework", jur.framework],
    ["Controlling document(s)", jur.frameworkDoc],
    ["Regional MPO / TPO", jur.mpoName ?? "Per controlling local government"],
    ["Opening year", String(openingYear)],
  ]);
  doc.moveDown(0.3);
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Surrounding land use, site plan figures, and detailed land-use description are dependent on the final site plan and are not produced by this screening tool. Final submittal should incorporate site plan figures (surrounding intersections and studied area) and a written project description per MTSIH 2024.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "3.1 Study Area");
  if (intersections.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `The study area comprises the ${intersections.length} intersection${intersections.length === 1 ? "" : "s"} listed below, selected for their proximity to the site and their share of project-generated traffic. Existing lane geometry and traffic control at each location are shown in the Scenario 1 figures (see the turning-movement appendix).`,
      { paragraphGap: 4 },
    );
    table(doc, {
      headers: ["#", "Study intersection", "Distance (mi)"],
      widths: [30, 320, 90],
      align: ["right", "left", "right"],
      rows: intersections.map((it, i) => [String(i + 1), it.name ?? it.signalId ?? "—", fmtNum(it.distanceMi, 2)]),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No signalized intersections were identified within the study radius. Off-site capacity impact is not anticipated; the study area is limited to the site driveways.",
      { paragraphGap: 4 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  if (jur.certificationFrontMatter) {
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
        "Miami-Dade large-CDMP reports additionally conclude with three parallel-track end-chapters (Concurrency Analysis / CDMP Analysis / Zoning Analysis, each independently numbered 1.0–3.0). This screening tool does not auto-generate the three-track parallel content; §10.0 below identifies the concurrency inputs required.",
        { paragraphGap: 6 },
      );
    }
    doc.fillColor("black");
  } else if (jur.key === "palm_beach") {
    doc.font("bold").fontSize(10).fillColor(BRAND_BLUE).text(
      "STRUCTURE NOTE — PALM BEACH COUNTY CONVENTION",
      { paragraphGap: 2 },
    );
    doc.font("body").fontSize(10).fillColor("black").text(
      "Palm Beach review type determines structure. A full ULDC Article 12 TPS report uses named \"Test 1\" + \"Test 2\" subsections at site-plan stage; a Future Land Use Atlas (FLUA) amendment uses a deliberately thinner 6-section variant (Project Description / Current FLU / Proposed FLU / Traffic Impact / Traffic Analysis [5.1 Test 2 + 5.2 Long Range] / Conclusion). The scenario-based structure used by this renderer is the MTSIH-aligned default; substitute the applicable Palm Beach variant at submittal time.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 4.0 Scenario 1 — Existing Conditions -----------------------------
  gaSection(doc, "4.0 SCENARIO 1 — EXISTING CONDITIONS");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Scenario 1 establishes existing (current-year) conditions from the collected daily and turning-movement counts at the study intersections. Existing Level of Service and control delay are summarized below; existing lane geometry and traffic control are shown in the Scenario 1 turning-movement figures (appendix).",
    { paragraphGap: 6 },
  );
  if (intersections.length > 0) {
    table(doc, {
      headers: ["Study intersection", "Distance (mi)", "Existing LOS", "Existing delay (s)"],
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
    "Existing AADT counts and functional classification are seeded from a live query of the FDOT Transportation Data and Analytics (TDA) ArcGIS REST services (gis.fdot.gov RCI_Layers FeatureServer 0/3/15 + Access_Management_TDA) within an 80-meter buffer of each intersection. Where the live extract returns a row, the in-table AADT, AADT year, and access-management class reflect the FDOT-published value at render time. Where no segment is matched (off-SHS local-road intersections, or radii beyond 80 m), values fall back to the engine estimate and must be confirmed against Florida Traffic Online (https://tdaappsprod.dot.state.fl.us/fto/). Existing turn-lane storage length must be field-supplied as `existingStorageFt` on each intersection record to enable the §9.0 storage-bay-adequacy comparison; the renderer surfaces a deficit calculation only when that field is present.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  const fdotSite = (r as any).fdotSiteSnapshot as FdotSegmentSnapshot | undefined;
  if (fdotSite) {
    gaSubsection(doc, "4.1 FDOT TDA Site Snapshot (live)");
    rows(doc, [
      ["RCI roadway ID", fdotSite.roadway ?? "—"],
      ["Begin/end mileposts", fdotSite.beginPost != null && fdotSite.endPost != null ? `${fdotSite.beginPost.toFixed(3)} → ${fdotSite.endPost.toFixed(3)}` : "—"],
      ["AADT", fdotSite.aadt != null ? `${fmtNum(fdotSite.aadt)} vpd${fdotSite.aadtYear ? ` (${fdotSite.aadtYear})` : ""}` : "—"],
      ["K factor (peak-hour)", fdotSite.kFactor != null ? `${fdotSite.kFactor.toFixed(3)}` : "—"],
      ["D factor (directional)", fdotSite.dFactor != null ? `${fdotSite.dFactor.toFixed(3)}` : "—"],
      ["Truck %", fdotSite.truckPct != null ? `${fdotSite.truckPct.toFixed(1)}%` : "—"],
      ["Functional class", decodeFdotFunClass(fdotSite.funClassCode) ?? "—"],
      ["On State Highway System?", fdotSite.onShs == null ? "—" : (fdotSite.onShs ? "Yes" : "No")],
      ["Access management class", decodeFdotAccessClass(fdotSite.accessClass) ?? "Not classified — interim Rule 14-97.004(1) standards apply"],
      ["FDOT District", fdotSite.fdotDistrict != null ? `D-${fdotSite.fdotDistrict}` : "—"],
    ]);
    doc.moveDown(0.2);
    {
      const matched = fdotSite.matchedRadiusM;
      const matchNote = matched != null
        ? (matched <= 60
            ? "Direct on-segment match (≤60 m buffer)."
            : matched <= 200
              ? `Nearest-segment match at ${matched} m (intersection point sits off the RCI polyline — likely in median or frontage road; verify route attribution).`
              : `Wide-buffer fallback at ${matched} m (sparse rural corridor or significant offset from nearest RCI segment; treat attribute values as approximate and verify in FTO).`)
        : "Match radius unrecorded.";
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
        `Live extract from gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer at render time. ${matchNote} Cross-check against Florida Traffic Online (https://tdaappsprod.dot.state.fl.us/fto/) for the most recent annual update before submittal.`,
        { paragraphGap: 6 },
      );
    }
    doc.fillColor("black");
  } else {
    gaSubsection(doc, "4.1 FDOT TDA Site Snapshot");
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "The live FDOT Transportation Data and Analytics (TDA) RCI query returned no segment snapshot at render time (off-SHS local-road site, a coordinate beyond the 80-meter match buffer, or the service was unavailable). Existing AADT, K/D factors, functional class, and access-management class for the study facilities are therefore unconfirmed by this run and must be retrieved from Florida Traffic Online (https://tdaappsprod.dot.state.fl.us/fto/) and the FDOT RCI before submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 4.2 Roadway Segments Configuration (FDOT RCI, per-intersection) ---
  const flCfgRows = intersections.filter((it: any) => it.fdotSnapshot || it.existingAadt != null || it.aadt != null);
  if (flCfgRows.length > 0) {
    gaSubsection(doc, "4.2 Roadway Segments Configuration");
    doc.font("body").fontSize(10).fillColor("black").text(
      "Physical and operational characteristics of each study segment from a live FDOT Transportation Data and Analytics (TDA) Roadway Characteristics Inventory (RCI) query at render time. Through-lane count and median type are RCI flat-file attributes not returned by this point query and must be confirmed from the RCI or a field inventory at submittal.",
      { paragraphGap: 6 },
    );
    table(doc, {
      headers: ["Study segment", "RCI roadway", "Functional class", "SHS", "Access cls", "K", "D"],
      widths: [150, 70, 120, 35, 55, 42, 42],
      align: ["left", "left", "left", "center", "center", "right", "right"],
      rows: flCfgRows.map((it: any) => {
        const snap = it.fdotSnapshot as FdotSegmentSnapshot | undefined;
        return [
          it.name ?? it.signalId ?? "—",
          snap?.roadway ?? "—",
          decodeFdotFunClass(snap?.funClassCode ?? null) ?? "—",
          snap?.onShs == null ? "—" : (snap.onShs ? "Yes" : "No"),
          snap?.accessClass ?? it.accessClass ?? "—",
          snap?.kFactor != null ? snap.kFactor.toFixed(3) : "—",
          snap?.dFactor != null ? snap.dFactor.toFixed(3) : "—",
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Live extract from gis.fdot.gov RCI_Layers FeatureServer. Access-management class per Rule 14-97 F.A.C.; functional classification per RCI Feature 121. Confirm lane count, median type, and posted speed from the RCI flat file or a field inventory before submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 4.3 Daily Peak-Hour Traffic Volumes (collected counts, T4) --------
  const flTmsRows = intersections.filter((it: any) => it.tmscount && (it.tmscount.daily2way != null || it.tmscount.pmPeak2way != null));
  if (flTmsRows.length > 0) {
    gaSubsection(doc, "4.3 Daily Peak-Hour Traffic Volumes (Collected Counts)");
    doc.font("body").fontSize(10).fillColor("black").text(
      "Collected daily and peak-hour volumes at the nearest FDOT continuous / short-count monitoring station to each study segment, from a live query of the FDOT TMSCOUNT (Transportation Data & Analytics) service at render time. Volumes are two-way (summed across the station's counted directions); AM = the 08:00 hour and PM = the 17:00 hour of the station's directional hourly counts. A count station is not present at every study intersection; where none falls within range the row is omitted and project-specific counts are required at submittal.",
      { paragraphGap: 6 },
    );
    table(doc, {
      headers: ["Study segment", "Count station", "Count yr", "AM peak (2-way)", "PM peak (2-way)", "Daily (2-way)"],
      widths: [145, 70, 48, 83, 83, 83],
      align: ["left", "left", "center", "right", "right", "right"],
      rows: flTmsRows.map((it: any) => {
        const t = it.tmscount;
        return [
          it.name ?? it.signalId ?? "—",
          t.cosite ?? "—",
          t.countYear != null ? String(t.countYear) : "—",
          t.amPeak2way == null ? "—" : fmtNum(t.amPeak2way),
          t.pmPeak2way == null ? "—" : fmtNum(t.pmPeak2way),
          t.daily2way == null ? "—" : fmtNum(t.daily2way),
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Source: FDOT TMSCOUNT TDA FeatureServer (services1.arcgis.com … Traffic_TMSCOUNT_TDA), nearest station within 1,600 m by highest daily total. These are corridor mid-block monitoring counts, not intersection turning-movement counts; a formal submittal requires AM/PM turning-movement counts at the study intersections and site driveways per MTSIH 2024 Appendix A.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 5.0 Scenario 2 — Future Conditions No Build ----------------------
  gaSection(doc, `5.0 SCENARIO 2 — FUTURE CONDITIONS NO BUILD (${openingYear})`);
  doc.font("body").fontSize(10).fillColor("black").text(
    `Scenario 2 represents future background (No-Build) conditions at the opening year ${openingYear}: existing volumes grown to the opening year without the proposed project. Background traffic is grown at ${r.growthAppliedPct ?? "—"}% per year over ${r.growthYears ?? "—"} year${r.growthYears === 1 ? "" : "s"}, and any committed developments in the study area should be added to the No-Build network. The methodology and derivation of the applied growth rate are described in §2.6; the resulting No-Build Level of Service at each study intersection is reported in §7.0 alongside the Existing and Build scenarios.`,
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Where the reviewing agency requires a travel-demand-model forecast (e.g., SERPM for Southeast Florida, or the controlling MPO/TPO model), the No-Build volumes should be reconciled against the adopted model run; the model version, base year, and horizon year are identified in the methodology letter. This screening analysis applies historical-AADT trend growth per FDOT TAH §2.7 in lieu of a model run.",
    { paragraphGap: 6 },
  );
  if (r.growthSource) {
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(`Growth source: ${r.growthSource}.`, { paragraphGap: 6 });
  }
  doc.fillColor("black");

  // --- 5.1 AADT Growth Projection ---------------------------------------
  const flGrowthPct = Number(r.growthAppliedPct);
  const flAadtRows = intersections.filter((it: any) => Number(it.fdotSnapshot?.aadt ?? it.existingAadt ?? it.aadt) > 0);
  if (flAadtRows.length > 0 && Number.isFinite(flGrowthPct) && flGrowthPct > 0) {
    const g = flGrowthPct / 100;
    const oy = Number(req.openingYear);
    const dy = Number(r.designYear ?? NaN);
    const hasDy = Number.isFinite(dy) && dy > 0;
    gaSubsection(doc, "5.1 AADT Growth Projection");
    doc.font("body").fontSize(10).fillColor("black").text(
      `Current-year segment AADT (live FDOT RCI, §4.2) is projected to the No-Build horizon${hasDy ? "s" : ""} at the applied ${flGrowthPct.toFixed(2)}%/yr compound growth rate derived from the FDOT historical-AADT trend (§2.6). These are screening-level trend projections; the adopted MPO/TPO travel-demand model volumes govern at formal submittal.`,
      { paragraphGap: 6 },
    );
    table(doc, {
      headers: hasDy
        ? ["Study segment", "Current AADT (yr)", "CAGR", `No-Build AADT (${Number.isFinite(oy) ? oy : "opening"})`, `Design AADT (${dy})`]
        : ["Study segment", "Current AADT (yr)", "CAGR", `No-Build AADT (${Number.isFinite(oy) ? oy : "opening"})`],
      widths: hasDy ? [160, 100, 55, 110, 100] : [210, 130, 65, 120],
      align: hasDy ? ["left", "right", "right", "right", "right"] : ["left", "right", "right", "right"],
      rows: flAadtRows.map((it: any) => {
        const snap = it.fdotSnapshot as FdotSegmentSnapshot | undefined;
        const aadt = Number(snap?.aadt ?? it.existingAadt ?? it.aadt);
        const yr = Number(snap?.aadtYear ?? it.aadtYear ?? NaN);
        const baseYr = Number.isFinite(yr) ? yr : (Number.isFinite(oy) ? oy - (Number(r.growthYears) || 1) : NaN);
        const oyAadt = Number.isFinite(oy) && Number.isFinite(baseYr) ? aadt * Math.pow(1 + g, Math.max(0, oy - baseYr)) : null;
        const dyAadt = hasDy && Number.isFinite(baseYr) ? aadt * Math.pow(1 + g, Math.max(0, dy - baseYr)) : null;
        const base = [
          it.name ?? it.signalId ?? "—",
          `${fmtNum(aadt)}${Number.isFinite(yr) ? ` (${yr})` : ""}`,
          `${flGrowthPct.toFixed(2)}%`,
          oyAadt == null ? "—" : fmtNum(oyAadt),
        ];
        return hasDy ? [...base, dyAadt == null ? "—" : fmtNum(dyAadt)] : base;
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Projection = current AADT × (1 + CAGR)^(horizon − count year). Where the live RCI count year is unavailable, the applied growth-years span is used. For submittal, use the per-segment FDOT historical AADT series (Florida Traffic Online) and, where required, the adopted MPO/TPO model volumes.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 5.2 SERPM Projected Model Volumes (Caltran Table 6) --------------
  const flSerpmRows = intersections.filter((it: any) => it.serpm && (it.serpm.baseDaily != null || it.serpm.futureDaily != null));
  if (flSerpmRows.length > 0) {
    gaSubsection(doc, "5.2 SERPM Projected Model Volumes");
    doc.font("body").fontSize(10).fillColor("black").text(
      `Regional travel-demand-model volumes for the study corridors from the adopted Southeast Florida Regional Planning Model (SERPM 9.62, FDOT District 4), fetched at render time from the published FDOT D4 loaded-network layers. Values are the nearest model link's base-year (${SERPM_BASE_YEAR}) and horizon-year (${SERPM_FUTURE_YEAR}) daily and PM-peak volumes; confirm link-node correspondence to the specific study segments against the adopted model at submittal.`,
      { paragraphGap: 6 },
    );
    table(doc, {
      headers: ["Study segment", `Base ${SERPM_BASE_YEAR} daily`, "Base PM", `Future ${SERPM_FUTURE_YEAR} daily`, "Future PM"],
      widths: [200, 90, 70, 100, 70],
      align: ["left", "right", "right", "right", "right"],
      rows: flSerpmRows.map((it: any) => [
        it.name ?? it.signalId ?? "—",
        it.serpm.baseDaily == null ? "—" : fmtNum(it.serpm.baseDaily),
        it.serpm.basePm == null ? "—" : fmtNum(it.serpm.basePm),
        it.serpm.futureDaily == null ? "—" : fmtNum(it.serpm.futureDaily),
        it.serpm.futurePm == null ? "—" : fmtNum(it.serpm.futurePm),
      ]),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Source: FDOT D4 SERPM loaded networks (services1.arcgis.com … D4_Travel_Demand_Models, layers 0 and 7), nearest link within 200 m by highest daily volume. The SERPM horizon volumes are the authoritative No-Build growth basis where the reviewing agency requires a model forecast in lieu of historical-trend growth (§2.6 / §5.1).",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 6.0 Scenario 3 — Future Conditions Build -------------------------
  gaSection(doc, `6.0 SCENARIO 3 — FUTURE CONDITIONS BUILD (${openingYear})`);
  doc.font("body").fontSize(10).fillColor("black").text(
    `Scenario 3 represents future Build conditions at the opening year ${openingYear}: the Scenario 2 No-Build network plus the proposed development's net new external trips at the assigned distribution. Per FDOT TAH §2.7, trip distribution and assignment should use the adopted regional MPO/TPO travel-demand model${jur.mpoName ? ` (${jur.mpoName})` : ""}, with model version, base year, and horizon year identified in the methodology letter. This screening analysis distributes net new external trips to study-area zones with the Caltran gravity model (mass ÷ distance; see §6.1) and assigns them to signalized intersections within the study area; for formal submittal, distribution percentages and the TDM run identifier should be agreed upon during the methodology meeting.`,
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

  // §6.1/§6.2 Trip Distribution + Assignment via the shared unified renderer.
  // flavor "fl" reproduces Florida's exact prose, captions (FDOT TAH §2.7),
  // and moveDown spacing so the section is byte-identical to origin/main.
  renderTripDistributionSection(doc, r as any, {
    subsectionNumber: "6.1",
    assignmentNumber: "6.2",
    headingFn: gaSubsection,
    cap: 20,
    intersections,
    periods,
    flavor: "fl",
  });
  renderDiurnalCharts(doc, r);

  // --- 7.0 Level of Service Analysis ------------------------------------
  gaSection(doc, "7.0 LEVEL OF SERVICE ANALYSIS");
  // Each scenario cell shows the LOS grade AND the absolute average control
  // delay (s/veh) so an LOS F at 82 s reads differently from an LOS F at 155 s
  // — the project-induced Δ delay alone hides the severity of a pre-existing
  // failure. Delay is rounded to whole seconds to keep the narrow columns
  // legible; the Δ-delay column retains one decimal.
  const losDelayCell = (los: any, delaySec: any): string => {
    const g = los ?? "—";
    return delaySec == null || Number.isNaN(Number(delaySec))
      ? String(g)
      : `${g} / ${Math.round(Number(delaySec))}`;
  };
  const flHasDesignYear = intersections.some(
    (it) => it.designNoBuildLos != null || it.designBuildLos != null,
  );
  const flDesignYr = r.designYear ?? (req.openingYear ? Number(req.openingYear) + 20 : null);
  if (flHasDesignYear) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Intersection Level of Service is reported across the analysis scenarios per HCM 6th Edition Chapter 19 (Exhibit 19-8 control-delay thresholds). Four horizons are evaluated: (1) Existing — Scenario 1 current-year volumes; (2) No-Build — Scenario 2 at opening year ${openingYear}; (3) Build — Scenario 3 at opening year ${openingYear}; and (4) 20-Year Long-Range (${flDesignYr ?? "—"}) No-Build and Build. A ▲ flag marks any intersection projected to drop a LOS grade under Build conditions.`,
      { paragraphGap: 6 },
    );
    table(doc, {
      headers: ["Intersection", "Existing", "Opening NB", "Opening Bld", "Design NB", "Design Bld", "Δ delay (s)"],
      widths: [150, 58, 66, 66, 58, 58, 54],
      align: ["left", "center", "center", "center", "center", "center", "right"],
      rows: intersections.map((it) => {
        const losChanged = it.losChanged === true;
        return [
          it.name ?? it.signalId ?? "—",
          losDelayCell(it.currentLos ?? it.existingLos, it.currentDelaySec ?? it.existingDelaySec),
          losDelayCell(it.existingLos, it.existingDelaySec),
          (losChanged ? "▲ " : "") + losDelayCell(it.futureLos, it.futureDelaySec),
          losDelayCell(it.designNoBuildLos, it.designNoBuildDelaySec),
          losDelayCell(it.designBuildLos, it.designBuildDelaySec),
          fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Each scenario cell shows LOS grade / average control delay (s/veh) per HCM 6th Ed. Ex. 19-8 (A ≤10, B ≤20, C ≤35, D ≤55, E ≤80, F >80 s). Screening delays use a generic signal model (90 s cycle, g/C 0.45, 1,800 pc/h/ln, one critical lane per approach) and are superseded by a calibrated HCS/Synchro analysis of the actual lane geometry and signal timing at submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  } else if (intersections.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `Intersection Level of Service is reported across the three analysis scenarios per HCM 6th Edition Chapter 19 (Exhibit 19-8 control-delay thresholds): Scenario 1 Existing, Scenario 2 No-Build (opening year ${openingYear}), and Scenario 3 Build (opening year ${openingYear}). A ▲ flag marks any intersection projected to drop a LOS grade under Build conditions.`,
      { paragraphGap: 6 },
    );
    table(doc, {
      headers: ["Intersection", "Existing", "No-Build", "Build", "Δ delay (s)", "Q95 (ft)"],
      widths: [175, 72, 72, 72, 66, 58],
      align: ["left", "center", "center", "center", "right", "right"],
      rows: intersections.map((it) => {
        const losChanged = it.losChanged === true;
        return [
          it.name ?? it.signalId ?? "—",
          losDelayCell(it.currentLos ?? it.existingLos, it.currentDelaySec ?? it.existingDelaySec),
          losDelayCell(it.existingLos, it.existingDelaySec),
          (losChanged ? "▲ " : "") + losDelayCell(it.futureLos, it.futureDelaySec),
          fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
          fmtNum(it.queue95thFt),
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Each scenario cell shows LOS grade / average control delay (s/veh) per HCM 6th Ed. Ex. 19-8 (A ≤10, B ≤20, C ≤35, D ≤55, E ≤80, F >80 s). Screening delays use a generic signal model (90 s cycle, g/C 0.45, 1,800 pc/h/ln, one critical lane per approach) and are superseded by a calibrated HCS/Synchro analysis of the actual lane geometry and signal timing at submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No signalized study intersections were identified; intersection Level of Service analysis is not applicable. Driveway operations should be evaluated at the site-access points per §9.0.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  // 7.1 Improvement Alternatives / Mitigation (Caltran "Alternative LOS")
  const needMitigation = intersections.filter((it) => it.mitigation && it.mitigationSeverity && it.mitigationSeverity !== "none");
  gaSubsection(doc, "7.1 Improvement Alternatives");
  if (needMitigation.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "The following intersection improvement alternatives are recommended to address projected Build-condition LOS impacts. Geometric mitigation should be designed to FDOT Design Manual (FDM 2026, Topic No. 625-000-002, dated January 1, 2026) standards — turn-lane warrants, deceleration / storage / taper lengths, intersection sight distance, and median-opening design per FDM Chapter 212; roundabouts per FDM Chapter 213. Proportionate-share, mobility-fee, or developer-contribution amounts for jurisdictions that retain concurrency (e.g., Miami-Dade Chapter 33-G) or operate mobility-fee programs (e.g., Hillsborough, Jacksonville/Duval Chapter 655, Miami-Dade Chapter 33E) should be calculated separately based on the controlling local-government ordinance.",
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
      "No intersection improvement alternatives are required to maintain the FDOT SHS LOS standard within the study network under Build conditions. Proportionate-share and mobility-fee calculations (where applicable per the controlling local-government ordinance) are not produced by this screening tool.",
      { paragraphGap: 6 },
    );
  }

  // 7.2 Alternative (with-improvement) LOS — Caltran Table 13
  if (needMitigation.length > 0) {
    gaSubsection(doc, "7.2 Alternative Intersection LOS (with improvement)");
    doc.font("body").fontSize(10).fillColor("black").text(
      "The improvement alternatives in §7.1 are sized to mitigate the project's incremental impact and restore each affected intersection to approximately its No-Build (without-project) Level of Service. The table below states the with-improvement objective per location; the achieved Level of Service must be confirmed by a detailed HCS / Synchro analysis of the specific improvement at submittal.",
      { paragraphGap: 6 },
    );
    table(doc, {
      headers: ["Intersection", "Build LOS", "Δ delay (s)", "Improvement class", "Target LOS (improved)"],
      widths: [175, 55, 60, 110, 110],
      align: ["left", "center", "right", "left", "center"],
      rows: needMitigation.map((it: any) => {
        const target = it.existingLos ?? it.currentLos ?? "—"; // No-Build target
        const sev = String(it.mitigationSeverity ?? "").toLowerCase();
        const cls = sev === "major" ? "Major (geometry + signal)" : sev === "moderate" ? "Moderate (phasing)" : "Minor (retiming)";
        const targetLabel = sev === "major" ? `${target} (verify — may remain constrained)` : String(target);
        return [
          it.name ?? it.signalId ?? "—",
          String(it.futureLos ?? "—"),
          fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
          cls,
          targetLabel,
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Target LOS is the No-Build (without-project) grade the improvement is sized to restore, not a re-run HCM result. Confirm the achieved delay / LOS with a detailed HCS / Synchro analysis of the specific geometry and signal timing at submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 8.0 Queue Analysis -----------------------------------------------
  gaSection(doc, `8.0 QUEUE ANALYSIS (${openingYear})`);
  const queueRows = intersections.filter((it) => Number.isFinite(Number(it.queue95thFt)));
  if (queueRows.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "The 95th-percentile back-of-queue at each study intersection under Build conditions is summarized below (worst-approach basis). Queues are estimated from the HCM 6th Edition signalized-intersection model; a formal submittal should report per-lane-group queues from a Synchro / SimTraffic run and compare them to the available turn-lane storage evaluated in §9.0.",
      { paragraphGap: 6 },
    );
    table(doc, {
      headers: ["Intersection", "Critical movement", "Build Q95 (ft)"],
      widths: [250, 150, 90],
      align: ["left", "left", "right"],
      rows: queueRows.map((it) => [
        it.name ?? it.signalId ?? "—",
        it.criticalMovement ?? it.storageMovement ?? "Worst approach",
        fmtNum(it.queue95thFt),
      ]),
    });
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No per-intersection 95th-percentile queue estimates are available for this run (no signalized study intersections, or queue outputs not populated). A formal submittal should include per-lane-group queue reporting from a Synchro / SimTraffic analysis.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 9.0 Turn Lane Evaluation -----------------------------------------
  gaSection(doc, `9.0 TURN LANE EVALUATION (${openingYear})`);
  const storageRows = intersections.filter((it: any) => Number.isFinite(Number(it.existingStorageFt)) && Number.isFinite(Number(it.queue95thFt)));
  doc.font("body").fontSize(10).fillColor("black").text(
    "Turn-lane evaluation proceeds in two steps per FDM Chapter 212: first whether a turn lane is warranted at each affected approach (a function of the turning volume, opposing/through volume, and speed), and second — where a bay is warranted or already exists — whether its storage length is adequate for the projected queue.",
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "9.1 Turn-Lane Warrants");
  doc.font("body").fontSize(10).fillColor("black").text(
    `A turn-lane warrant is a movement-level screen: an exclusive left-turn lane is evaluated against the FDM Chapter 212 / NCHRP 745 left-turn-lane guidelines (a function of advancing volume, opposing volume, and posted speed), and an exclusive right-turn lane is conventionally warranted where the peak-hour right-turn volume exceeds roughly 40–60 vph (or the applicable local threshold, e.g., ${jur.name} land-development code). The proposed development adds approximately ${fmtNum(tg.pmIn)} inbound and ${fmtNum(tg.pmOut)} outbound trips in the PM peak hour, distributed to the site driveways and adjacent intersections; the by-movement turning volumes required to apply the warrant thresholds are established from the AM/PM turning-movement counts and the approved trip-distribution at the methodology meeting. This screening tool does not decompose approach volumes into left/through/right movements, so a definitive turn-lane warrant determination — particularly at the site driveways connecting to the SHS — is deferred to the sealed submittal against the counted and assigned movement volumes.`,
    { paragraphGap: 6 },
  );

  gaSubsection(doc, "9.2 Storage-Bay Adequacy");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Where a turn bay is warranted or already present, its storage length must contain the Build-scenario 95th-percentile queue without spill-back into the adjacent through lane; a deficit indicates the bay is shorter than the projected queue and requires either a bay extension (where adjacent infrastructure permits) or a documented engineering finding that the spill-back is acceptable. Deceleration and taper lengths follow FDM Chapter 212.",
    { paragraphGap: 6 },
  );
  if (storageRows.length > 0) {
    table(doc, {
      headers: ["Intersection", "Movement", "Existing bay (ft)", "Q95 Build (ft)", "Required (ft)", "Deficit (ft)"],
      widths: [165, 80, 80, 70, 70, 70],
      align: ["left", "left", "right", "right", "right", "right"],
      rows: storageRows.map((it: any) => {
        const existing = Number(it.existingStorageFt);
        const q95 = Number(it.queue95thFt);
        const required = q95;
        const deficit = Math.max(0, required - existing);
        return [
          it.name ?? it.signalId ?? "—",
          it.criticalMovement ?? it.storageMovement ?? "Left-turn (verify)",
          fmtNum(existing),
          fmtNum(q95),
          fmtNum(required),
          deficit > 0 ? fmtNum(deficit) : "Adequate",
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Required storage = Build-scenario 95th-percentile queue per FDM Chapter 212. Where the deficit is small relative to project contribution, a proportionate-share allocation per the controlling local-government formula is the conventional path; where adjacent infrastructure precludes bay extension, an engineering finding documenting acceptable spill-back is required.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Storage-bay adequacy: no intersection carries a field-measured existing storage length (`existingStorageFt`). Supply that field on each affected intersection record to enable the Required-vs-Existing-vs-Deficit turn-lane table per FDM Chapter 212 storage / taper standards. Turn-lane warrants at the site driveways must be evaluated against the assigned turning volumes at submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 10.0 Concurrency Analysis ----------------------------------------
  gaSection(doc, "10.0 CONCURRENCY ANALYSIS");
  doc.font("body").fontSize(10).fillColor("black").text(
    `Transportation concurrency was made optional statewide by HB 7207 (2011). For new development, the Development of Regional Impact (DRI) review track was further curtailed by SB 1216 / Ch. 2015-30 (which added F.S. 380.06(30) routing otherwise-DRI projects through the State Coordinated Review Process at F.S. 163.3184(4) in lieu of DRI), with cleanup completed by CS/CS/HB 1151 / Ch. 2018-158 — DRI is now a legacy branch retained only for amendments/abandonments of existing DRIs. ${jur.name} review framework: ${jur.framework}. Controlling document(s): ${jur.frameworkDoc}. LOS standard: ${jur.losStandardNote}. Per Florida Statutes §163.3180(5)(h)1.a., local governments must consult with FDOT whenever a Strategic Intermodal System (SIS) facility is expected to be impacted by a comprehensive-plan amendment.`,
    { paragraphGap: 6 },
  );
  if (jur.extraNote) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(`Note. ${jur.extraNote}`, { paragraphGap: 6 });
    doc.fillColor("black");
  }

  gaSubsection(doc, "10.1 Roadway Segment Capacity — Generalized Service Volumes");
  doc.font("body").fontSize(10).fillColor("black").text(
    "Roadway-segment level of service is screened against the FDOT Quality/Level of Service Handbook v6.0 (August 2025) Generalized Service Volume Tables (GSVTs). Per Q/LOS v6.0 the peak-hour two-way service volume is keyed to FDM Chapter 200 context class (C1–C6, C2T) and through-lane count, with D = 0.55 statewide. The applicable context class and lane count for each segment are FDOT Roadway Characteristics Inventory (RCI) attributes (Feature 126 context class; lane count from the RCI flat file) and must be confirmed during the methodology meeting. This screening tool selects the GSVT row only where those inputs are supplied and otherwise defers the segment v/c rather than assume a class.",
    { paragraphGap: 6 },
  );
  doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
    "Arterial (signalized) peak-hour two-way service volumes (vph) — Q/LOS v6.0 App. B:",
    { paragraphGap: 2 },
  );
  doc.fillColor("black");
  table(doc, {
    headers: ["Context / lanes", "LOS C", "LOS D", "LOS E"],
    widths: [250, 70, 70, 70],
    align: ["left", "right", "right", "right"],
    rows: FDOT_ARTERIAL_GSVT.map((row) => [
      row.label,
      row.C == null ? "—" : fmtNum(row.C),
      row.D == null ? "—" : fmtNum(row.D),
      row.E == null ? "—" : fmtNum(row.E),
    ]),
  });
  doc.moveDown(0.2);
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
    "C6 LOS C is undefined in v6.0 (C6 facilities are neither planned nor designed for auto LOS C); cells marked \"—\" past LOS D are F at signal capacity. Material adjustment multipliers (one-way × 1.2; multilane without exclusive LT × 0.75; 2-lane undivided without exclusive LT × 0.80; non-State signalized × 0.90; exclusive RT lane × 1.05) and per-context K factors (C1/C2/C2T 8.5–10.5%; C3C/C3R/C4 7.5–9.5%; C5/C6 7.0–9.0%) apply per Q/LOS v6.0 Ch. 6. Freeway (Limited Access) GSVT LOS-D capacities: Urbanized 4/6/8-lane = 7,400 / 11,050 / 14,710 vph (AADT-equivalent 82,200 / 122,800 / 163,400); Rural 4-lane divided = 5,950 vph (AADT-equivalent 56,700).",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  const flCtx = asFdotContextClass((req as any).contextClass ?? (r as any).contextClass);
  const flLanes = Number((req as any).segmentLanes ?? (req as any).throughLanes ?? NaN);
  const flFacility: FdotFacility =
    String((req as any).facilityType ?? "arterial").toLowerCase().includes("freeway") ? "freeway" : "arterial";
  if (intersections.length > 0 && flCtx != null && Number.isFinite(flLanes) && flLanes > 0) {
    const losD = floridaGsvtServiceVolume({ facility: flFacility, context: flCtx, lanes: flLanes, los: "D" });
    const k = floridaRepresentativeK(flFacility, flCtx);
    table(doc, {
      headers: ["Roadway segment", "AADT", "Peak-hr 2-way", `LOS-D SV (${flCtx}/${flLanes}-ln)`, "v/c", "≤ LOS D?"],
      widths: [165, 60, 80, 100, 45, 60],
      align: ["left", "right", "right", "right", "right", "center"],
      rows: intersections.map((it) => {
        const aadt = Number(it.existingAadt ?? it.aadt ?? it.dailyVolume ?? 0);
        const peak = aadt * k;
        const sv = losD.serviceVolumeVph;
        const vc = sv && sv > 0 && aadt > 0 ? peak / sv : null;
        return [
          it.name ?? it.signalId ?? "—",
          aadt > 0 ? fmtNum(aadt) : "—",
          aadt > 0 ? fmtNum(peak) : "—",
          sv == null ? "—" : fmtNum(sv),
          vc == null ? "—" : vc.toFixed(2),
          vc == null ? "—" : (vc <= 1.0 ? "Yes" : "No"),
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      `Segment v/c = (AADT × K) ÷ GSVT LOS-D service volume for context ${flCtx}, ${flLanes} through lanes, using representative screening K = ${k.toFixed(3)} (Q/LOS v6.0 Ch. 6 midpoint). For submittal, derive K per segment from RCI (KFCTR / K100FCTR) and confirm context class and lane count against the FDOT Preliminary Context Classification and RCI lane attributes.`,
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Per-segment GSVT v/c is not computed for this run: a segment context class (C1–C6 / C2T) and through-lane count were not supplied. Provide them as inputs — or rely on the FDOT RCI data adapter once wired — to populate the roadway-segment LOS table against the service volumes above. Segment AADT available to the screen is listed in §4.0.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  gaSubsection(doc, "10.2 Site Access / Ingress-Egress");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Per MTSIH 2024 §3.2 Table 5, driveway TIA-scoping is keyed to gross trips per day (including pass-by): Category A 1–20 vpd (single-family); B 21–600 (small multifamily / very small commercial); C 601–1,500 (small-mid retail / small office); D 1,501–4,000 (mid retail / mid office); E 4,001–15,000 (large retail / mixed-use); F 15,001–30,000 (very large mixed-use / mall); G ≥30,001 (regional mall). Pre-application meeting + traffic study are required for Categories C–G (>600 vpd including pass-by). A connection-permit change-of-use is additionally triggered per F.S. 335.182(3)(b) when trip generation increases by >25% AND >100 vpd vs. the existing use. Connection to the FDOT State Highway System requires a connection permit per Rule 14-96 F.A.C. (last amended April 2, 2023). Driveway spacing, median-opening spacing, and signal spacing are governed by the access-management class (Classes 1–7) assigned to the impacted SHS segment per Rule 14-97 F.A.C. and FDOT Procedure 525-030-155; the class is stored in the RCI as Feature 146 / ACMANCLS (codes 00–07; 99 = unclassified, interim standards in Rule 14-97.004(1) apply until assignment). Driveway geometry (W, R, F, Y, G, Driveway Length, S, I; Categories A–D in FDM Chapter 214, Categories E–F–G punt to FDM Chapter 212), turn-lane warrants, deceleration-lane length, and intersection sight distance must be designed to FDOT Design Manual (FDM 2026) standards; off-SHS connections on city/county facilities follow the Florida Greenbook. The access-management class for the impacted SHS facility should be confirmed against the FDOT-published Access Management TDA layer.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
  if (jur.threeTrackEndChapters) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Three-track end-chapter convention (Miami-Dade): the formal CDMP-amendment submittal should additionally provide three parallel-track end-chapters (Concurrency Analysis / CDMP Analysis / Zoning Analysis), each independently numbered 1.0–3.0. The Concurrency track is reviewed against Code Ch. 33-G + Admin. Order 4-85; the CDMP track is reviewed against the adopted Transportation Element; the Zoning track is reviewed against the host municipal zoning ordinance. This screening tool does not auto-generate the three-track parallel content; the inputs required for each track must be coordinated with the Miami-Dade TPO and Miami-Dade County DTPW prior to submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // Proposed site driveways (opt-in) — integrated into the §10.2 Site Access /
  // Ingress-Egress section; renders only when driveways are supplied.
  renderDrivewayAccessBlock(doc, r, region, gaSubsection, "Proposed Site Driveways");

  // --- 11.0 Transit and Mobility ----------------------------------------
  gaSection(doc, "11.0 TRANSIT AND MOBILITY");
  gaSubsection(doc, "11.1 Transit Service");
  const transitCtx = (r as any).transitContext as TransitContext | undefined;
  if (transitCtx && transitCtx.stops.length > 0) {
    const sourceLabel = transitCtx.source === "transit_land" ? "Transit.land v2" : "OSM Overpass";
    const agencyEntries = Object.entries(transitCtx.routesByAgency).filter(([, refs]) => refs.length > 0);
    const agencyPhrase = agencyEntries.length > 0
      ? agencyEntries.map(([agency, refs]) => `${agency} route${refs.length === 1 ? "" : "s"} ${refs.join(", ")}`).join("; ")
      : null;
    doc.font("body").fontSize(10).fillColor("black").text(
      `Within ${transitCtx.radiusMi.toFixed(2)} mi of the site (live ${sourceLabel} extract at render time): ${transitCtx.stops.length} transit stop${transitCtx.stops.length === 1 ? "" : "s"}${agencyPhrase ? ` served by ${agencyPhrase}` : ""}. The applicant should coordinate with the controlling transit agency to confirm route frequency, ridership at the affected stops, and any planned bus stop / shelter upgrades concurrent with the project.`,
      { paragraphGap: 6 },
    );
    const nearest = transitCtx.stops.slice(0, 5);
    table(doc, {
      headers: ["Stop", "Agency", "Mode", "Routes", "Distance (mi)"],
      widths: [180, 110, 60, 100, 75],
      align: ["left", "left", "left", "left", "right"],
      rows: nearest.map((s) => [
        s.stopName,
        s.agency ?? "—",
        s.mode,
        s.routeRefs.length > 0 ? s.routeRefs.join(", ") : "Verify",
        s.distanceMi.toFixed(2),
      ]),
    });
    if (transitCtx.source === "osm_overpass") {
      doc.moveDown(0.2);
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
        "Source: OpenStreetMap Overpass API — route_ref tags are crowdsourced and may be incomplete. Confirm exact route numbers against the controlling transit agency's GTFS feed (or set TRANSIT_LAND_API_KEY to use the Transit.land v2 GTFS-derived source primarily) before submittal.",
        { paragraphGap: 6 },
      );
      doc.fillColor("black");
    }
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No transit stops detected within 0.25 mi of the site via the live Transit.land / OSM Overpass query. Verify against the controlling transit agency's published GTFS feed (e.g., Broward County Transit, Miami-Dade Transit, MARTA, LYNX, JTA, HART) at the methodology meeting. If transit-mode reduction is applied to trip generation, the supporting service must be cited and an alternative-mode trip reduction memo retained in the methodology letter (Appendix A or C per jurisdiction).",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.3);

  gaSubsection(doc, "11.2 Internal Circulation and Multimodal");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Internal site circulation, parking access, and service-vehicle pathways depend on the final site plan and are not included in this screening-level analysis. Internal queuing at the principal driveway should be evaluated for adequate storage between the SHS edge of pavement and the first internal conflict point per FDM guidance. Pedestrian and bicycle connectivity to the surrounding network and to the transit stops above should be confirmed against FDM Chapter 222/223 (sidewalk / bicycle facilities).",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- 12.0 Crash Analysis ----------------------------------------------
  gaSection(doc, "12.0 CRASH ANALYSIS");
  const flCrash = (r as any).flCrashSummary as
    | {
        windowYears: number;
        totalCrashes: number;
        bySeverity: { K: number; A: number; B: number; C: number; O: number; UNKNOWN: number };
        pedestrianInvolved: number;
        cyclistInvolved: number;
        recentSevere: Array<{ occurredAt: string; severity: string; onStreet: string | null; crossStreet: string | null; mannerOfCollision: string | null }>;
      }
    | undefined;
  if (flCrash && flCrash.totalCrashes > 0) {
    const earliestSevere = flCrash.recentSevere.length > 0 ? flCrash.recentSevere[flCrash.recentSevere.length - 1].occurredAt : null;
    const latestSevere = flCrash.recentSevere.length > 0 ? flCrash.recentSevere[0].occurredAt : null;
    doc.font("body").fontSize(10).fillColor("black").text(
      `A site-radius crash review (0.5-mile radius) was performed using the FDOT SSO Crashes (All) FeatureServer (gis.fdot.gov / ssogis layer 2000). The FDOT public crash extract is known to be incomplete for 2020 and later — agency data agreements changed and the most-recent comprehensive year on the public service is 2018-2019. ${flCrash.totalCrashes.toLocaleString()} crashes are recorded within the radius${earliestSevere ? ` (severe-crash range ${earliestSevere} → ${latestSevere})` : ""}. For a formal submittal requiring current-year crash data per FDOT Crash Analysis Reporting (CAR) or per Highway Safety Manual conventions, the analyst should consult Signal4 Analytics (signal4lab.geoplan.ufl.edu, agency login required) for the post-2019 records this screening tool cannot provide.`,
      { paragraphGap: 6 },
    );
    table(doc, {
      headers: ["Severity (KABCO)", "Count", "Note"],
      widths: [180, 100, 170],
      align: ["left", "right", "left"],
      rows: [
        ["K — Fatal", fmtNum(flCrash.bySeverity.K), "INJSEVER 5"],
        ["A — Incapacitating", fmtNum(flCrash.bySeverity.A), "INJSEVER 4"],
        ["B — Non-incapacitating", fmtNum(flCrash.bySeverity.B), "INJSEVER 3"],
        ["C — Possible Injury", fmtNum(flCrash.bySeverity.C), "INJSEVER 2"],
        ["O — Property Damage Only", fmtNum(flCrash.bySeverity.O), "INJSEVER 1"],
        ["UNKNOWN", fmtNum(flCrash.bySeverity.UNKNOWN), "INJSEVER blank"],
        ["Total", fmtNum(flCrash.totalCrashes), ""],
      ],
    });
    doc.moveDown(0.2);
    if (flCrash.pedestrianInvolved > 0 || flCrash.cyclistInvolved > 0) {
      doc.font("body").fontSize(10).fillColor("black").text(
        `Vulnerable road user involvement: ${fmtNum(flCrash.pedestrianInvolved)} pedestrian-involved crash${flCrash.pedestrianInvolved === 1 ? "" : "es"}, ${fmtNum(flCrash.cyclistInvolved)} cyclist-involved crash${flCrash.cyclistInvolved === 1 ? "" : "es"}. Per Florida's Vital Few statewide focus on pedestrian/cyclist safety (FDOT Office of Modal Safety), VRU involvement within the study radius triggers a Safety Screening per FDM Chapter 213 and may warrant lighting, marking, or geometric mitigation.`,
        { paragraphGap: 6 },
      );
    }
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "Site-radius crash query against the FDOT SSO Crashes (All) public FeatureServer returned no records within 0.5 mi over the available data window (FDOT public extract is comprehensive through 2018-2019; post-2019 records require Signal4 Analytics agency login). A formal submittal must include the 3-year Crash Analysis Reporting (CAR) extract for the affected intersections — this screening tool's public-data path cannot supply that for current years.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
  doc.moveDown(0.3);
  renderFarsKBlock(doc, r, { subsection: "12.1 NHTSA FARS Fatal Crash Supplement" });

  // --- 13.0 Preliminary Signal Warrant Analysis -------------------------
  gaSection(doc, "13.0 PRELIMINARY SIGNAL WARRANT ANALYSIS");
  doc.font("body").fontSize(10).fillColor("black").text(
    "A preliminary traffic-signal warrant screening is performed against the MUTCD (2009 Edition, FDOT-adopted per the Florida Traffic Engineering Manual) warrants — Warrant 1 (Eight-Hour Vehicular Volume), Warrant 2 (Four-Hour Vehicular Volume), Warrant 3 (Peak Hour), Warrant 4 (Pedestrian), Warrant 5 (School Crossing), Warrant 6 (Coordinated Signal System), Warrant 7 (Crash Experience), and Warrant 8 (Roadway Network). A definitive warrant determination requires the full 8-hour approach-volume counts and the applicable engineering study; a signal is not justified on any single warrant alone without an engineering study demonstrating that a signal will improve the overall safety and/or operation of the intersection.",
    { paragraphGap: 6 },
  );
  const warrantCandidates = intersections.filter((it) => {
    const efBuild = String(it.futureLos ?? "").toUpperCase();
    return it.losChanged === true || efBuild === "E" || efBuild === "F";
  });
  if (warrantCandidates.length > 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      "Based on the projected Build-condition operations, the following study locations should carry a full signal / control-modification warrant analysis (Warrants 1–3 with 8-hour counts, plus Warrant 7 where the §12.0 crash review indicates a correctable pattern) at submittal:",
      { paragraphGap: 4 },
    );
    table(doc, {
      headers: ["Study location", "Build LOS", "Δ delay (s)", "Preliminary indication"],
      widths: [220, 60, 70, 130],
      align: ["left", "center", "right", "left"],
      rows: warrantCandidates.map((it) => [
        it.name ?? it.signalId ?? "—",
        String(it.futureLos ?? "—"),
        fmtNum((it.futureDelaySec ?? 0) - (it.existingDelaySec ?? 0), 1),
        it.losChanged ? "Operational review warranted" : "At/over LOS E — monitor",
      ]),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Preliminary indication is a screening flag from projected LOS/delay only, not a warrant determination. The site driveways connecting to the SHS must additionally be evaluated for signalization / turn-lane control against the assigned turning volumes and the access-management class per Rule 14-97 F.A.C.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  } else {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No study intersection exhibits a Build-condition LOS drop or LOS E/F operation that would preliminarily indicate a signal or control modification. The site driveways connecting to the SHS should nonetheless be evaluated for turn-lane control and, where volumes warrant, signalization against the access-management class per Rule 14-97 F.A.C. at submittal.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }

  // --- 14.0 Conclusions and Recommendations -----------------------------
  gaSection(doc, "14.0 CONCLUSIONS AND RECOMMENDATIONS");
  if (losDrops === 0 && losEf === 0) {
    doc.font("body").fontSize(10).fillColor("black").text(
      `The proposed ${project.projectName || "development"} is projected to generate ${fmtNum(tg.dailyTrips)} daily trips (${fmtNum(tg.pmIn)} in / ${fmtNum(tg.pmOut)} out in the PM peak hour) at full build-out. Under Build (Scenario 3) conditions at opening year ${openingYear}, no study intersection is projected to drop a Level of Service grade and no location operates at LOS E or F; the project maintains the applicable FDOT SHS LOS standard within the study network without off-site capacity mitigation. Site-access geometry, turn-lane warrants, and connection permitting must still be designed and permitted per FDM 2026 and Rule 14-96/14-97 F.A.C.`,
      { paragraphGap: 6 },
    );
  } else {
    doc.font("body").fontSize(10).fillColor("black").text(
      `The proposed ${project.projectName || "development"} is projected to generate ${fmtNum(tg.dailyTrips)} daily trips (${fmtNum(tg.pmIn)} in / ${fmtNum(tg.pmOut)} out in the PM peak hour) at full build-out. Under Build (Scenario 3) conditions at opening year ${openingYear}, ${losDrops} study intersection${losDrops === 1 ? "" : "s"} project to drop a Level of Service grade and ${losEf} operate${losEf === 1 ? "s" : ""} at LOS E or F. The improvement alternatives identified in §7.1 should be advanced, and the applicable proportionate-share / mobility-fee obligation should be calculated per the controlling ${jur.name} ordinance to maintain the FDOT SHS LOS standard within the study network.`,
      { paragraphGap: 6 },
    );
  }

  const findings: string[] = Array.isArray(r.findings) ? r.findings : [];
  if (findings.length > 0) {
    gaSubsection(doc, "14.1 Findings");
    doc.font("body").fontSize(10).fillColor("black");
    for (const f of findings) doc.text("• " + f, { paragraphGap: 4 });
    doc.moveDown(0.3);
  }

  gaSubsection(doc, "14.2 Programmed Projects");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Committed-projects review should consult the FDOT Five-Year Work Program (https://www.fdot.gov/workprogram) and the controlling MPO/TPO Transportation Improvement Program (TIP) and Long Range Transportation Plan (LRTP). Programmed roadway and intersection improvements within the study area should be incorporated into the No-Build network. This screening analysis does not automatically integrate Work Program data; manual review is recommended for any submittal.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  gaSubsection(doc, "14.3 Professional Engineer Certification");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "A Florida TIS / MTIA deliverable must be signed and sealed by a Florida-licensed Professional Engineer per Florida Statutes Chapter 471 and Florida Administrative Code Rule 61G15-23.001. The cover and signature page of the formal submittal must bear the seal, signature, and date of the Engineer of Record.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  const methodology: string[] = Array.isArray(r.methodology) ? r.methodology : [];
  if (methodology.length > 0) {
    gaSubsection(doc, "14.4 Methodology Notes");
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY);
    for (const m of methodology) doc.text("• " + m, { paragraphGap: 4 });
    doc.fillColor("black");
  }

  // The per-intersection turning-movement + capacity appendix is appended
  // by dispatchTisRender for EVERY region (not just FL), so it is not
  // called here.
}

/**
 * Turning-movement diagram for one intersection + scenario, drawn as a
 * labeled crossroads with each approach's Left/Through/Right volumes and
 * geometrically-correct movement arrows. Approach totals come from the
 * engine; the L/T/R split is an estimated 15/70/15 (disclosed in the
 * appendix intro) since the screening engine works at the approach level.
 */
function drawTurningMovementDiagram(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  ix: any, scenario: "nobuild" | "build", title: string,
) {
  const approaches: any[] = Array.isArray(ix.approaches) ? ix.approaches : [];
  const byDir: Record<string, any> = {};
  for (const a of approaches) byDir[String(a.direction).toUpperCase()] = a;
  const volOf = (a: any) =>
    Math.round(Number(scenario === "build" ? a.futureVolumeVph : a.existingVolumeVph) || 0);
  const split = (v: number) => { const l = Math.round(v * 0.15), r = Math.round(v * 0.15); return { l, t: v - l - r, r }; };

  doc.font("bold").fontSize(8).fillColor("#0f172a").text(title, x, y, { width: w, align: "center" });
  const bx = x, by = y + 12, bw = w, bh = h - 12;
  doc.rect(bx, by, bw, bh).lineWidth(0.75).strokeColor("#cbd5e1").stroke();
  const cx = bx + bw / 2, cy = by + bh / 2, rw = 14;
  doc.rect(cx - rw, by + 1, 2 * rw, bh - 2).fill("#eef2f6");
  doc.rect(bx + 1, cy - rw, bw - 2, 2 * rw).fill("#eef2f6");

  // Street labels (split "A & B": A = N-S street top, B = E-W street).
  const parts = String(ix.name ?? "").split(/\s*&\s*/);
  const clip = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : (s ?? ""));
  doc.font("body").fontSize(6).fillColor("#64748b");
  if (parts[0]) doc.text(clip(parts[0], 30), bx + 2, by + 2, { width: bw - 4, align: "center" });
  if (parts[1]) doc.text(clip(parts[1], 16), cx + rw + 2, by + 14, { width: bw / 2 - rw - 4, align: "left" });

  const block = (dir: string, gl: { l: string; t: string; r: string }) => {
    const a = byDir[dir]; if (!a) return null;
    const m = split(volOf(a));
    return `${dir}   L${gl.l}${m.l}   T${gl.t}${m.t}   R${gl.r}${m.r}`;
  };
  doc.font("body").fontSize(7).fillColor("#0f172a");
  const sb = block("SB", { l: "→", t: "↓", r: "←" });
  if (sb) doc.text(sb, bx, by + 22, { width: bw, align: "center" });
  const nb = block("NB", { l: "←", t: "↑", r: "→" });
  if (nb) doc.text(nb, bx, by + bh - 13, { width: bw, align: "center" });
  const eb = block("EB", { l: "↑", t: "→", r: "↓" });
  if (eb) doc.text(eb, bx + 3, cy + rw + 4, { width: bw / 2 - rw - 4, align: "left" });
  const wb = block("WB", { l: "↓", t: "←", r: "↑" });
  if (wb) doc.text(wb, cx + 2, cy + rw + 4, { width: bw / 2 - 5, align: "right" });
  doc.fillColor("black");
}

/**
 * Appendix A for the FDOT renderer: a per-intersection capacity worksheet
 * for every study intersection. Each worksheet shows the intersection-level
 * Existing(No-Build)→Build summary plus a per-approach table (volumes, v/c,
 * delay, LOS, queue). All values come straight from the engine result; this
 * function fabricates nothing. Intersections are ordered by impact severity
 * (LOS changes first, then by added control delay) to match the on-screen
 * table and put the reviewer's attention on the affected signals first.
 */
/**
 * Four-Step Travel Demand Model section (FHWA / NCHRP 716). Documents the
 * generation → gravity distribution → mode choice → BPR assignment chain
 * the engine ran, with a per-signal distribution table. Computed from the
 * report fields the PDF already carries — no extra payload needed.
 */
function renderFourStepSection(
  doc: PDFKit.PDFDocument,
  result: Record<string, unknown>,
) {
  const tg = (result.tripGeneration ?? {}) as Record<string, any>;
  const intersections: any[] = Array.isArray(result.affectedIntersections) ? result.affectedIntersections : [];
  if (intersections.length === 0) return;
  const autoShare = Number(result.autoModeShareApplied);
  const SPEED_MPH = 25;

  doc.addPage();
  gaSection(doc, "FOUR-STEP TRAVEL DEMAND MODEL");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "Off-site project trips are distributed and assigned with the four-step urban transportation modeling process "
    + "(FHWA; NCHRP Report 716, Travel Demand Forecasting). Each step below shows what the engine computed for this site.",
    { paragraphGap: 8 },
  );
  doc.fillColor("black");

  // Step 1 — Trip Generation
  gaSubsection(doc, "Step 1 — Trip Generation");
  doc.font("body").fontSize(9.5).fillColor(TEXT_GRAY).text(
    "Public-data screening trip rates (SANDAG 2002, corroborated by NHTS 2017 / NCHRP 716) applied to the proposed land use give the site's productions.",
    { paragraphGap: 3 });
  doc.fillColor("black");
  rows(doc, [
    ["Land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Daily trips (productions)", fmtNum(tg.dailyTrips)],
    ["PM peak-hour trips", `${fmtNum(tg.pmPeakTrips)} (${fmtNum(tg.pmIn)} in / ${fmtNum(tg.pmOut)} out)`],
  ]);
  doc.moveDown(0.4);

  // Step 2 — Trip Distribution (gravity model). Florida uses the Caltran
  // mass/distance form (see the regional renderer's §6.1); all other regions
  // use the NCHRP-716 gamma-friction gravity model.
  gaSubsection(doc, "Step 2 — Trip Distribution (Gravity Model)");
  doc.font("body").fontSize(9.5).fillColor(TEXT_GRAY).text(
    (result as any).flGravity
      ? "The Caltran mass/distance gravity model (the Florida distribution standard, §6.1) allocates trips to surrounding zones:  "
        + "T_j = (M_j / (d_j · d_site)) / Σ (M_x / (d_x · d_site)).  Zone mass M_j is each signal's through-volume "
        + "(destination-activity proxy) and d_j its distance from the site (d_site = 1). The shares below are the §6.1 distribution."
      : "A production-constrained gravity model allocates trips to surrounding signals:  T_j = P · (A_j · F_j) / Σ (A_x · F_x).  "
        + "Attractiveness A_j is each signal's through-volume; the friction factor F_j is the NCHRP-716 gamma function "
        + "F = a·t^b·e^(c·t) (home-based-work: a=28507, b=-0.02, c=-0.123) on the travel time t to the signal.",
    { paragraphGap: 4 });
  doc.fillColor("black");
  const totalAdded = intersections.reduce((s, r) => s + (Number(r.addedTripsPmPeak) || 0), 0) || 1;
  const distRows = [...intersections]
    .sort((a, b) => (Number(b.addedTripsPmPeak) || 0) - (Number(a.addedTripsPmPeak) || 0))
    .slice(0, 12)
    .map((r) => {
      const tMin = (Math.max(0.06, Number(r.distanceMi) || 0) / SPEED_MPH) * 60;
      return [
        String(r.name ?? r.signalId ?? "—"),
        fmtNum(r.distanceMi, 2),
        fmtNum(tMin, 1),
        fmtNum(r.addedTripsPmPeak),
        `${((Number(r.addedTripsPmPeak) || 0) / totalAdded * 100).toFixed(1)}%`,
      ];
    });
  table(doc, {
    headers: ["Signal (attraction zone)", "Dist mi", "Time min", "PM trips", "Share"],
    widths: [250, 56, 60, 64, 60],
    align: ["left", "right", "right", "right", "right"],
    rows: distRows,
  });
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
    "Top 12 distribution zones by assigned PM-peak trips shown; the full set is in the capacity appendix.",
    { paragraphGap: 6 });
  doc.fillColor("black");

  // Step 3 — Mode Choice
  gaSubsection(doc, "Step 3 — Mode Choice");
  const autoPct = Number.isFinite(autoShare) ? Math.round(autoShare * 100) : 100;
  doc.font("body").fontSize(9.5).fillColor("black").text(
    `Auto-mode share ${autoPct}% applied via a binary logit  P(auto) = 1 / (1 + e^-(ASC − λ·ΔGC))  calibrated to the `
    + `metro's measured auto-mode share (ACS B08301) and shifted by site urbanity (local density), so a denser, more `
    + `transit-served site splits further from auto than a greenfield parcel in the same metro. The remaining `
    + `${100 - autoPct}% of trips (transit, walking, cycling) do not load the off-site roadway network; only auto `
    + `trips are carried into Step 4.`,
    { paragraphGap: 6 });

  // Step 4 — Route Assignment
  gaSubsection(doc, "Step 4 — Route Assignment");
  const ra = result.routeAssignment as Record<string, any> | undefined;
  if (ra && ra.available && Array.isArray(ra.corridors) && ra.corridors.length) {
    doc.font("body").fontSize(9.5).fillColor("black").text(
      "Project trips are routed over the local road network by shortest path and loaded with a capacity-constrained "
      + "BPR equilibrium (volume-delay  t = t0·[1 + 0.15·(v/c)^4], Method of Successive Averages), so congested links "
      + `shift trips toward alternative routes. ${ra.onNetworkPct ?? 0}% of study signals lie on a modeled route; `
      + `highest loaded-link v/c: ${Number(ra.worstLinkVoverC || 0).toFixed(2)}. Corridors carrying the project trips:`,
      { paragraphGap: 4 });
    doc.fillColor("black");
    table(doc, {
      headers: ["Corridor (road class)", "Loaded length mi", "PM project vph", "v/c"],
      widths: [250, 100, 100, 60],
      align: ["left", "right", "right", "right"],
      rows: ra.corridors.slice(0, 8).map((c: any) => [
        String(c.classLabel ?? "—"),
        fmtNum(c.lengthMi, 2),
        fmtNum(c.projectVph),
        Number(c.vOverC || 0).toFixed(2),
      ]),
    });
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      "Network shortest-path assignment over the OSM road graph within the study area; per-signal v/c, delay, LOS, "
      + "and queue are in the capacity appendix.",
      { paragraphGap: 6 });
    doc.fillColor("black");
  } else {
    const vcs = intersections.map((r) => Number(r.futureVc) || 0).filter((v) => v > 0).sort((a, b) => b - a);
    const worstVc = vcs.length ? vcs[0] : 0;
    doc.font("body").fontSize(9.5).fillColor("black").text(
      "A capacity-constrained assignment using the BPR volume-delay function  t = t0 · [1 + 0.15·(v/c)^4]  iteratively "
      + "shifts trips away from over-capacity signals toward less-congested alternatives until the assignment is "
      + `congestion-consistent. Highest post-build v/c among study signals: ${worstVc ? worstVc.toFixed(2) : "—"}. `
      + "Per-signal v/c, delay, LOS, and queue are in the capacity appendix. (Road-network corridor routing was not "
      + "available for this region; per-signal capacity-constrained assignment was used.)",
      { paragraphGap: 6 });
    doc.fillColor("black");
  }
}

function renderCapacityAppendix(
  doc: PDFKit.PDFDocument,
  intersections: any[],
  periods: any[],
  inStudyArea?: number,
  studyRadiusMi?: number,
) {
  doc.addPage();
  gaSection(doc, "APPENDIX — INTERSECTION CAPACITY ANALYSIS WORKSHEETS");
  doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
    "One worksheet per study intersection: a turning-movement diagram for each analyzed peak period plus "
    + "the per-approach HCM capacity table. Analysis follows the Highway Capacity Manual 6th Edition "
    + "signalized-intersection method; v/c, control delay (sec/veh), Level of Service, and 95th-percentile "
    + "back-of-queue (ft) are reported for the Existing (No-Build) and Build conditions.",
    { paragraphGap: 4 },
  );
  // Scope transparency: state how many signals are in the study area vs. how many
  // were analyzed, and why, when the impact-significance scope trimmed the set.
  const analyzed = intersections.length;
  if (inStudyArea && inStudyArea > analyzed) {
    const radius = studyRadiusMi && studyRadiusMi > 0 ? studyRadiusMi : 0.5;
    doc.font("body").fontSize(9).fillColor(TEXT_GRAY).text(
      `Study scope: ${inStudyArea} signalized intersections lie within the ${radius}-mile study area; `
      + `${analyzed} are carried as study intersections — the site frontage/adjacent intersections plus those the `
      + `project materially impacts. The remainder receive net new site traffic below the impact-significance `
      + `threshold (de-minimis, per ITE MTIASD §2.2) and are not analyzed individually.`,
      { paragraphGap: 8 },
    );
  }
  doc.font("body").fontSize(9).fillColor("#b45309").text(
    "Background turning-movement volumes in the diagrams are distributed from each approach total using an "
    + "estimated 15/70/15 (Left/Through/Right) split. Project-trip movements are assigned geometrically from "
    + "the study's directional trip distribution (see each worksheet's Affected movements table). Replace both "
    + "with measured turning-movement counts (TMCs) before a formal submittal.",
    { paragraphGap: 8 },
  );
  doc.fillColor("black");

  if (!Array.isArray(intersections) || intersections.length === 0) {
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(
      "No signalized intersections fall within the study area, so no capacity worksheets are generated.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
    return;
  }

  const ordered = [...intersections].sort((a, b) => {
    const ac = !!a.losChanged, bc = !!b.losChanged;
    if (ac !== bc) return ac ? -1 : 1;
    const ad = (Number(b.futureDelaySec) || 0) - (Number(b.existingDelaySec) || 0);
    const aa = (Number(a.futureDelaySec) || 0) - (Number(a.existingDelaySec) || 0);
    return ad - aa;
  });

  // Peak periods to draw a diagram for (skip the daily total).
  const peakPeriods = (Array.isArray(periods) ? periods : []).filter((p) => p && p.period !== "daily");

  ordered.forEach((ix, i) => {
    doc.addPage(); // one intersection per page — clean layout, no crowding
    gaSubsection(doc, `A.${i + 1}  ${ix.name ?? ix.signalId ?? "Intersection"}`);
    const deltaDelay = (Number(ix.futureDelaySec) || 0) - (Number(ix.existingDelaySec) || 0);
    // A junction can receive < 1 net peak car trip — most often at high-PTAL
    // London sites where the car-mode share collapses the whole scheme to a
    // handful of car trips spread across the network. The reported count
    // rounds to 0, but the capacity math already carried the exact fractional
    // load (see buildAffectedRow). Surface "< 1" rather than a bare "0" so the
    // unchanged Existing/Build columns read as a deliberate negligible-impact
    // finding rather than a failed analysis.
    const addedNegligible = Math.round(Number(ix.addedTripsPmPeak) || 0) === 0;
    rows(doc, [
      ["Signal ID", String(ix.signalId ?? "—")],
      ["Location", `${ix.zone ?? "—"} · ${fmtNum(ix.distanceMi, 2)} mi from site`],
      ["Added PM peak trips", addedNegligible ? "< 1 (negligible)" : fmtNum(ix.addedTripsPmPeak)],
      ["Existing / No-Build (PM)", `LOS ${ix.existingLos ?? "—"} · ${fmtNum(ix.existingDelaySec, 1)} s/veh · v/c ${fmtNum(ix.existingVc, 2)}`],
      ["Build (PM)", `LOS ${ix.futureLos ?? "—"} · ${fmtNum(ix.futureDelaySec, 1)} s/veh · v/c ${fmtNum(ix.futureVc, 2)}`],
      ["Δ control delay", `${deltaDelay >= 0 ? "+" : ""}${fmtNum(deltaDelay, 1)} s/veh${ix.losChanged ? "  (LOS change)" : ""}`],
      ["Mitigation", ix.mitigation ? String(ix.mitigation) : "None required at screening level"],
    ]);
    doc.moveDown(0.4);
    if (addedNegligible) {
      doc.font("body").fontSize(8.5).fillColor(TEXT_GRAY).text(
        "The development distributes fewer than one net PM peak car trip to this junction, so the Existing (No-Build) and Build conditions are numerically identical at reporting precision. The junction is reproduced here for completeness; the scheme's net car-mode trip generation is below the level at which junction capacity governs.",
        { paragraphGap: 4 },
      );
      doc.fillColor("black");
      doc.moveDown(0.2);
    }

    // Turning-movement diagrams — one per analyzed peak period (Build),
    // pulling that period's approach volumes from periodReports. Falls back
    // to the top-level (PM) No-Build + Build pair when no period detail.
    doc.font("bold").fontSize(9.5).fillColor("black").text("Turning-Movement Diagrams (Build condition)", { paragraphGap: 4 });
    const W = doc.page.width;
    const usable = W - PAGE_MARGIN * 2;
    type Fig = { rec: any; scenario: "nobuild" | "build"; title: string };
    let figs: Fig[] = [];
    for (const p of peakPeriods) {
      const rec = (Array.isArray(p.affectedIntersections) ? p.affectedIntersections : [])
        .find((z: any) => z.signalId === ix.signalId);
      if (rec && Array.isArray(rec.approaches) && rec.approaches.length) {
        figs.push({ rec, scenario: "build", title: `${p.periodLabel ?? p.period} — Build` });
      }
    }
    if (figs.length === 0) {
      // No per-period detail — show PM No-Build vs Build from the top-level record.
      figs = [
        { rec: ix, scenario: "nobuild", title: "PM Peak — No-Build" },
        { rec: ix, scenario: "build", title: "PM Peak — Build" },
      ];
    }
    // Multi-period diagrams (one Build figure per analyzed peak hour) vs. the
    // PM-only No-Build/Build fallback (mixed scenarios). Only the former gets
    // the period-peaking caption.
    const multiPeriod = figs.length > 1 && figs.every((f) => f.scenario === "build");
    const perRow = Math.min(figs.length, 3);
    const gap = 10;
    const dw = (usable - gap * (perRow - 1)) / perRow;
    const dh = 132;
    let rowY = doc.y;
    figs.forEach((f, idx) => {
      const col = idx % perRow;
      if (col === 0 && idx > 0) rowY += dh + 12;
      if (rowY + dh > doc.page.height - PAGE_MARGIN - 30) { doc.addPage(); rowY = doc.y; }
      const fx = PAGE_MARGIN + col * (dw + gap);
      drawTurningMovementDiagram(doc, fx, rowY, dw, dh, f.rec, f.scenario, f.title);
    });
    // drawTurningMovementDiagram leaves the text cursor at the last (rightmost)
    // diagram's internal x. Restore the left margin before flowing the caption /
    // per-approach table, or they wrap into a narrow right-hand column and spill
    // off the bottom of every worksheet page.
    doc.x = PAGE_MARGIN;
    doc.y = rowY + dh + 14;
    if (multiPeriod) {
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
        "Background turning-movement volumes vary by period: the stored design-hour count (AADT × K-factor, ≈ the PM peak) is carried at 100% for the PM peak and at screening-level shares of the design hour for the AM peak (90%) and Saturday midday (80%), reflecting that the network is not equally loaded across the day. A submitted study replaces these with measured per-period turning-movement counts.",
        { paragraphGap: 4 },
      );
      doc.fillColor("black");
      doc.moveDown(0.2);
    }

    const approaches: any[] = Array.isArray(ix.approaches) ? ix.approaches : [];
    if (approaches.length === 0) return;

    doc.font("bold").fontSize(9.5).fillColor("black").text("Per-Approach Capacity (PM Peak)", { paragraphGap: 4 });
    table(doc, {
      headers: ["Appr.", "Exist vph", "+Trips", "Build vph", "v/c Ex→Bld", "Delay Ex→Bld", "LOS Ex→Bld", "Q95 ft"],
      widths: [52, 64, 44, 64, 70, 84, 60, 54],
      align: ["left", "right", "right", "right", "center", "center", "center", "right"],
      rows: approaches.map((a) => [
        String(a.direction ?? "—"),
        fmtNum(a.existingVolumeVph),
        // Sub-1-trip junction: only the approaches the geometry actually
        // loads show "< 1"; a zero-load approach reads 0, not "< 1".
        addedNegligible
          ? (Number(a.futureVolumeVph) > Number(a.existingVolumeVph) ? "< 1" : "0")
          : fmtNum(a.addedTripsPeak),
        fmtNum(a.futureVolumeVph),
        `${fmtNum(a.existingVc, 2)} → ${fmtNum(a.futureVc, 2)}`,
        `${fmtNum(a.existingDelaySec, 1)} → ${fmtNum(a.futureDelaySec, 1)}`,
        `${a.existingLos ?? "—"} → ${a.futureLos ?? "—"}`,
        fmtNum(a.queue95thFt),
      ]),
    });

    // Affected movements: which turning movements the project's trips load.
    // Preferred source is the engine's geometric movement assignment
    // (ix.movements — outbound trips enter on the site leg and turn toward
    // their destination sector, inbound the mirror; see movement-assignment.ts),
    // whose integer trips cross-foot with the junction's added-trip count.
    // Fallback for older payloads without `movements`: the flat 15/70/15
    // approach-level estimate. Either way this is screening-level — measured
    // turning-movement counts govern at submittal.
    if (!addedNegligible) {
      const mv: any[] = Array.isArray(ix.movements) ? ix.movements : [];
      if (mv.length > 0) {
        doc.moveDown(0.3);
        doc.font("bold").fontSize(9).fillColor("black").text("Affected movements (PM peak project trips)", { paragraphGap: 3 });
        const MOVE_NAME: Record<string, string> = { L: "Left", T: "Through", R: "Right" };
        const totalMv = mv.reduce((s, m) => s + (Number(m.trips) || 0), 0) || 1;
        table(doc, {
          headers: ["Movement", "Project trips", "% of project trips"],
          widths: [190, 100, 120],
          align: ["left", "right", "right"],
          rows: mv.map((m) => [
            `${m.approach} ${MOVE_NAME[String(m.movement)] ?? m.movement}`,
            fmtNum(m.trips),
            `${((Number(m.trips) || 0) / totalMv * 100).toFixed(0)}%`,
          ]),
        });
        doc.moveDown(0.15);
        // Stored studies re-render through this path: a payload generated
        // before the movement-derived loading shipped still carries the legacy
        // floor-smeared +Trips split next to this movements table — the very
        // mismatch the disclosure wording below covers. Verify the
        // reconciliation instead of asserting it, and keep the disclosure for
        // payloads where the columns don't cross-foot.
        const reconciled = approaches.every((a) => {
          const mvSum = mv.reduce(
            (s, m) => s + (m.approach === a.direction ? (Number(m.trips) || 0) : 0), 0,
          );
          return Math.round(Number(a.addedTripsPeak) || 0) === mvSum;
        });
        doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
          reconciled
            ? "Movement loads are derived from the study's directional trip distribution and the site's bearing from this intersection (outbound trips enter from the site leg and turn toward their destination sector; inbound trips mirror). U-turns are folded into the left-turn movement. The same assignment drives the per-approach capacity loading above, so the movement rows cross-foot with the junction's added project trips in total and with the +Trips column approach-by-approach (each trip is counted on its entering approach). The turning-movement diagrams show TOTAL approach volumes under the screening 15/70/15 split, not the project increment. Screening-level: replace with measured turning-movement counts and the site's access-point routing at submittal."
            : "Movement loads are derived from the study's directional trip distribution and the site's bearing from this intersection (outbound trips enter from the site leg and turn toward their destination sector; inbound trips mirror). U-turns are folded into the left-turn movement. Totals cross-foot with the junction's added project trips — but NOT approach-by-approach with the +Trips column above: this study was generated before the per-approach loading derived from the movement assignment (that column used a smoothed directional spread with a floor share on every leg), while the movement rows are named by entering approach only. Re-generate the study to reconcile the two. Likewise the turning-movement diagrams show TOTAL approach volumes under the screening 15/70/15 split, not the project increment. Screening-level: replace with measured turning-movement counts and the site's access-point routing at submittal.",
          { paragraphGap: 6 },
        );
        doc.fillColor("black");
      } else {
        const loaded = approaches
          .filter((a) => Math.round(Number(a.addedTripsPeak) || 0) > 0)
          .sort((a, b) => (Number(b.addedTripsPeak) || 0) - (Number(a.addedTripsPeak) || 0));
        if (loaded.length > 0) {
          doc.moveDown(0.3);
          doc.font("bold").fontSize(9).fillColor("black").text("Affected movements (PM peak project trips)", { paragraphGap: 2 });
          const parts = loaded.map((a) => {
            const dir = String(a.direction ?? "").toUpperCase();
            const added = Math.round(Number(a.addedTripsPeak) || 0);
            const thru = Math.round(added * 0.70);
            const left = Math.round(added * 0.15);
            const right = added - thru - left;
            return `${dir} approach +${added} (≈ ${dir}-Thru ${thru} / ${dir}-Left ${left} / ${dir}-Right ${right})`;
          });
          doc.font("body").fontSize(8.5).fillColor(TEXT_GRAY).text(parts.join(";  ") + ".", { paragraphGap: 3 });
          doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
            "Project trips are resolved at the approach level; the Left/Through/Right split shown is the screening 15/70/15 estimate and should be replaced with measured turning-movement counts and the site's access-point directional routing at submittal.",
            { paragraphGap: 6 },
          );
          doc.fillColor("black");
        }
      }
    }

    // Turbo-lane (continuous-green-T) screening — shown for every candidate
    // 3-leg T-intersection regardless of LOS (screening-study convention).
    const tl = ix.turboLane;
    if (tl) {
      doc.moveDown(0.5);
      if (doc.y > doc.page.height - PAGE_MARGIN - 120) doc.addPage();
      doc.font("bold").fontSize(9.5).fillColor(BRAND_BLUE).text("Turbo-Lane Screening (Continuous-Green T)", { paragraphGap: 4 });
      doc.fillColor("black");
      rows(doc, [
        ["Configuration", `Type ${tl.turboType} · ${tl.medianType} median · ${tl.turboDirection} main-street through continuous`],
        ["Main street", `${tl.approachLanes} through lane(s)/dir · g/C ${fmtNum(tl.throughGreenRatio, 2)} (${tl.provenance?.greenRatio ?? "derived"}) · minor leg ${tl.minorLegDirection}`],
        ["Approach-capacity gain", `+${fmtNum(tl.capacityGainPct, 0)}%  on the ${tl.turboDirection} approach`],
        ["Turbo approach v/c", `${fmtNum(tl.baselineApproachVc, 2)} → ${fmtNum(tl.mitigatedApproachVc, 2)}`],
        ["Turbo approach delay / LOS", `${fmtNum(tl.baselineApproachDelaySec, 1)}s (${tl.baselineApproachLos}) → ${fmtNum(tl.mitigatedApproachDelaySec, 1)}s (${tl.mitigatedApproachLos})`],
        ["95th-pct queue", `${fmtNum(tl.baselineApproachQueueFt, 0)} ft → ${fmtNum(tl.mitigatedApproachQueueFt, 0)} ft`],
      ]);
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(String(tl.note ?? ""), { paragraphGap: 6 });
      doc.fillColor("black");
    }
  });
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
    ["Verdict — vs screening-adjusted demand", String(r.iteVerdict)],
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
    const val = value ?? "—";
    // Measure the row before drawing so the label and its value stay on the
    // same page. Drawing the label first and letting PDFKit auto-paginate
    // mid-pair stranded the label (or value) alone on its own page; reserve
    // the row's height and break BEFORE it when it will not fit.
    doc.font("body").fontSize(10);
    const rowH = Math.max(
      doc.heightOfString(label, { width: labelW }),
      doc.heightOfString(val, { width: valueW }),
    );
    if (doc.y + rowH > doc.page.height - PAGE_MARGIN) doc.addPage();
    const y = doc.y;
    doc.fillColor(TEXT_GRAY).text(label, startX, y, { width: labelW, continued: false });
    doc.fillColor("black").text(val, startX + labelW + 10, y, { width: valueW });
    // Anchor the cursor to the taller cell so a wrapped label/value never
    // overlaps the next row.
    doc.y = y + rowH;
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
  const totalW = widths.reduce((s, w) => s + w, 0);
  const PADX = 4;
  const PADY = 4;
  // London (Velocity) palette, gated; every other region keeps the neutral
  // greys. Header: pale-green fill + green text; rule under header + row
  // separators in green. Body text stays dark.
  const velo = velocityPaletteActive;
  const headerFill = velo ? VELOCITY_FILL : "#f3f4f6";
  const headerText = velo ? VELOCITY_GREEN : "black";
  const sepColor = velo ? VELOCITY_GREEN : "#e5e7eb";

  // Measure the height a row needs by wrapping every cell within its
  // column width and taking the tallest. This is what prevents the old
  // overlap bug: long street names wrap and the row grows to fit instead
  // of colliding with the next row.
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
  // Keep-together: never strand the header at the bottom of a page. The
  // per-row loop below breaks pages and re-draws the header, but the INITIAL
  // header was drawn unconditionally at doc.y — so a table starting low on a
  // page (e.g. right after the §6.5 TRICS narrative) printed its header at the
  // very bottom, then row 1's break pushed the body to the next page, leaving
  // an orphaned header behind. If the header plus the first data row won't fit,
  // start the table on a fresh page instead.
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

type Metric = { label: string; value: string };

function metricStrip(doc: PDFKit.PDFDocument, metrics: Metric[]) {
  const usableW = doc.page.width - PAGE_MARGIN * 2;
  const cellW = usableW / metrics.length;
  const startX = PAGE_MARGIN;
  const y = doc.y;
  const h = 50;
  // London (Velocity) palette, gated; other regions keep the blue accent.
  const velo = velocityPaletteActive;
  const cellFill = velo ? VELOCITY_FILL : "#f9fafb";
  const cellStroke = velo ? VELOCITY_GREEN : "#e5e7eb";
  const valColor = velo ? VELOCITY_GREEN : BRAND_BLUE;
  for (let i = 0; i < metrics.length; i++) {
    const x = startX + i * cellW;
    doc.rect(x, y, cellW, h).fillAndStroke(cellFill, cellStroke);
    doc.font("bold").fontSize(20).fillColor(valColor).text(metrics[i].value, x, y + 8, { width: cellW, align: "center" });
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

/**
 * Document label for the running header, body H1 and PDF metadata, with
 * the London (`london_metro`) TIS overriding the US "Traffic Impact
 * Study" string with the UK "Transport Assessment" term a TfL/borough
 * reviewer expects (it matches the Velocity cover, which hardcodes
 * "Transport Assessment"). Gated to London only — every other UK region
 * (Manchester, Glasgow …) and all US/Canada studies keep studyLabel().
 */
function documentLabel(project: StoredProject): string {
  if (project.studyType === "tis" && detectRegion(project)?.code === "london_metro") {
    return "Transport Assessment";
  }
  return studyLabel(project.studyType);
}
