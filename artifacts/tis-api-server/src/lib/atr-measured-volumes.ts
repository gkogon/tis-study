/**
 * Measured ATR (Automated Traffic Recorder) volume block, shared by every
 * regional renderer.
 *
 * Its own leaf module for the same reason `lane-group-queues.ts` is one:
 * pdf-export.ts already imports the regional renderers, so putting this there
 * and importing it back would cycle. Self-contained per the Path A convention —
 * it re-declares the couple of primitives it needs rather than coupling to a
 * renderer's private `table()`.
 *
 * WHY THIS EXISTS. `renderStudyPdf` has been attaching `result.atrSummary`
 * generically since #167, but the ONLY reader was `pdf-export-ny.ts`. Florida
 * resolved its source (`fdot_tda`), ran the query, and threw the answer away —
 * silently. Any state added to `ATR_SOURCE_BY_STATE` had the same fate. This
 * module is the renderer-agnostic reader, so a new metro is an ingest adapter
 * plus one row in that map, with nothing to write here.
 *
 * Renders NOTHING when no ATR segment was found within the search radius, which
 * is the common case: agencies count a rotating sample, not the full grid. A
 * study with no coverage keeps its AADT x K x D estimate and stays byte-identical.
 */

const PAGE_MARGIN = 50;
const TEXT_GRAY = "#6b7280";

export type AtrSegmentRow = {
  street: string | null;
  direction: string;
  distanceMi: number;
  latestCountDate: string;
  sampleDays: number;
  amPeakHourVph: number | null;
  pmPeakHourVph: number | null;
  /** Vehicles per DAY, not per hour — comparable to AADT. */
  avgDailyVeh: number | null;
};

export type AtrSummaryLike = {
  windowYears: number;
  radiusMi: number;
  segments: AtrSegmentRow[];
  source: string;
  totalSegmentsFound: number;
};

/**
 * Provenance per ingested source. Keep the citation exact — this block's whole
 * value is that a reviewer can go pull the same public file and check us.
 */
const SOURCE_PROVENANCE: Record<string, { agency: string; citation: string }> = {
  nyc_dot_atr: {
    agency: "NYC DOT",
    citation: "NYC DOT Automated Traffic Volume Counts (data.cityofnewyork.us / 7ym2-wayt)",
  },
  fdot_tda: {
    agency: "FDOT",
    citation: "FDOT Traffic Monitoring TMSCOUNT / Transportation Data & Analytics (Traffic_TMSCOUNT_TDA)",
  },
  fhwa_tmas: {
    agency: "the state DOT, via FHWA",
    citation:
      "FHWA Travel Monitoring Analysis System (TMAS) continuous-count volumes, 2023 "
      + "(data.transportation.gov / kv7k-jsg5), station coordinates from the NTAD TMAS Stations layer. "
      + "Counts are collected and reported by the state highway agency",
  },
};

/** Shorten `text` until it fits `maxW` at the doc's current font/size. */
function ellipsize(doc: PDFKit.PDFDocument, text: string, maxW: number): string {
  if (doc.widthOfString(text) <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(`${text.slice(0, mid)}…`) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : "";
}

const num = (x: unknown): string =>
  typeof x === "number" && Number.isFinite(x)
    ? Math.round(x).toLocaleString("en-US")
    : "—";

/** True when this study has at least one measured segment to show. */
export function hasAtrVolumes(summary: unknown): boolean {
  const s = summary as AtrSummaryLike | undefined;
  return !!s && Array.isArray(s.segments) && s.segments.length > 0;
}

/**
 * @param headingFn renderer-native subsection heading (gaSubsection / nySubsection / …)
 * @param heading   full heading text, e.g. "4.4 MEASURED TRAFFIC COUNTS"
 * @param estimateBasis how the surrounding volume table was derived, so the prose
 *        can say what this block is validating (e.g. "the K-factor estimate in §4.2")
 */
export function renderAtrMeasuredVolumes(
  doc: PDFKit.PDFDocument,
  summary: unknown,
  opts: {
    headingFn?: (doc: PDFKit.PDFDocument, title: string) => void;
    heading?: string;
    estimateBasis?: string;
  } = {},
): void {
  const s = summary as AtrSummaryLike | undefined;
  if (!hasAtrVolumes(s) || !s) return;

  const prov = SOURCE_PROVENANCE[s.source] ?? {
    agency: "the state or local agency",
    citation: s.source,
  };
  const n = s.segments.length;
  const plural = n === 1 ? "" : "s";

  const heading = opts.heading ?? "Measured Traffic Counts (Supplemental)";
  if (opts.headingFn) opts.headingFn(doc, heading);
  else doc.font("bold").fontSize(11).fillColor("black").text(heading, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text(
    `The volumes below are Automated Traffic Recorder (ATR) counts published by ${prov.agency}, at `
      + `${n} count location${plural} within ${s.radiusMi.toFixed(2)} miles of the site, looking back `
      + `${s.windowYears} year${s.windowYears === 1 ? "" : "s"}. These are MEASURED, not modeled — `
      + `they exist to validate ${opts.estimateBasis ?? "the estimated existing volumes above"}, which `
      + `are derived rather than counted. Where a measured segment and the estimate disagree materially, `
      + `the measured count governs and the estimate should be re-run against it. ATR is directional `
      + `SEGMENT volume, not per-approach turning movement counts; TMCs at the affected intersection${plural} `
      + `must still be collected separately for formal submittal.`,
    { paragraphGap: 6 },
  );

  const headers = ["Segment", "Dir.", "Dist (mi)", "Latest count", "Days", "AM peak (vph)", "PM peak (vph)", "Daily (veh/day)"];
  // Must sum to <= 512 (612pt letter less two 50pt margins).
  const widths = [148, 34, 46, 62, 34, 60, 60, 68];
  const rows: string[][] = s.segments.map((seg) => [
    seg.street ?? "—",
    seg.direction,
    Number.isFinite(seg.distanceMi) ? seg.distanceMi.toFixed(2) : "—",
    seg.latestCountDate,
    String(seg.sampleDays),
    num(seg.amPeakHourVph),
    num(seg.pmPeakHourVph),
    num(seg.avgDailyVeh),
  ]);

  // Minimal self-contained table (Path A) — no dependency on any renderer's
  // table(), which each declares privately with different signatures.
  const startX = PAGE_MARGIN;
  const rowH = 14;
  let y = doc.y + 2;
  const drawRow = (cells: string[], bold: boolean) => {
    if (y + rowH > doc.page.height - PAGE_MARGIN - 30) {
      doc.addPage();
      y = doc.y;
    }
    let x = startX;
    doc.font(bold ? "bold" : "body").fontSize(8).fillColor("black");
    cells.forEach((c, i) => {
      const right = i >= 2;
      // Truncate rather than rely on `lineBreak: false`, which still wrapped a
      // long segment name onto a second line in testing — and since the row
      // advance is a fixed 14pt, that second line printed straight through the
      // source caption below the table.
      doc.text(ellipsize(doc, c, widths[i] - 4), x + 2, y + 3, {
        width: widths[i] - 4,
        align: right ? "right" : "left",
        lineBreak: false,
      });
      x += widths[i];
    });
    doc.save().lineWidth(0.4).strokeColor("#e5e7eb")
      .moveTo(startX, y + rowH).lineTo(startX + widths.reduce((a, w) => a + w, 0), y + rowH).stroke().restore();
    y += rowH;
  };
  drawRow(headers, true);
  for (const r of rows) drawRow(r, false);
  doc.y = y + 4;
  doc.x = PAGE_MARGIN;

  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
    `Source: ${prov.citation}. AM peak = max weekday hourly volume 7:00-9:00 local. PM peak = max weekday `
      + `hourly volume 16:00-18:00 local. Daily = weekday average of 24-hour summed bins, i.e. vehicles per `
      + `DAY (comparable to AADT, not to the vph columns). Sample days counts unique calendar days of `
      + `observation in the ${s.windowYears}-year window. Total ATR segments found within radius: `
      + `${s.totalSegmentsFound}.`,
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
}
