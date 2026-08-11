/**
 * Carolinas TIA renderers — North Carolina + South Carolina.
 *
 * Sibling file (not folded into pdf-export.ts) per the pdf-export-ny.ts
 * precedent: concurrent edits to the main file must not risk this
 * renderer, so the layout primitives are duplicated intentionally.
 *
 * NC: merges the NCDOT Policy on Street and Driveway Access (July 2003)
 * Ch. 5 report outline with the Congestion Management Capacity Analysis
 * Guidelines (Standards, March 2022; Best Practices, Nov 20 2024) —
 * MOE table format, hard methodology defaults, and the Ch. 5.J
 * mitigation-criteria check that NC reviewers apply verbatim.
 * Spec: REGIONAL-SPECS/nc-tis-spec.md.
 *
 * SC: SCDOT ARMS 2008 (update 7-8-2025) Ch. 6 ten-element TIS inside
 * the encroachment-permit process, TG-21 LOS C standard, District
 * Traffic Engineer framing, and the ARMS Technical Completeness
 * Checklist rendered as a compliance table.
 * Spec: REGIONAL-SPECS/sc-tis-spec.md.
 */
import type { Region } from "./regions";

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

// ---- Layout primitives (duplicated intentionally; see docstring) ----------

function carSection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(13).fillColor("black").text(title, { characterSpacing: 0.5 });
  doc.moveDown(0.3);
  doc.x = PAGE_MARGIN;
}

function carSubsection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(11).fillColor("black").text(title);
  doc.moveDown(0.2);
  doc.x = PAGE_MARGIN;
}

function carBody(doc: PDFKit.PDFDocument, text: string, gray = false) {
  doc.font("body").fontSize(10).fillColor(gray ? TEXT_GRAY : "black").text(text, { paragraphGap: 6 });
  doc.fillColor("black");
  doc.x = PAGE_MARGIN;
}

function carRows(doc: PDFKit.PDFDocument, pairs: [string, string | undefined][]) {
  const labelW = 220;
  const startX = PAGE_MARGIN;
  doc.x = startX;
  const valueW = doc.page.width - startX - labelW - PAGE_MARGIN - 10;
  for (const [label, value] of pairs) {
    // Long wrapped values advance doc.y past the page bottom; without
    // this guard the next label lands off-page and pdfkit emits an
    // orphaned near-blank page (seen on the first real-data NC render).
    const estH = doc.font("body").fontSize(10).heightOfString(value ?? "—", { width: valueW });
    if (doc.y + Math.max(estH, 14) > doc.page.height - PAGE_MARGIN - 40) {
      doc.addPage();
      doc.x = startX;
    }
    const y = doc.y;
    doc.font("body").fontSize(10).fillColor(TEXT_GRAY).text(label, startX, y, { width: labelW, continued: false });
    doc.font("body").fontSize(10).fillColor("black").text(value ?? "—", startX + labelW + 10, y, { width: valueW });
    doc.y = Math.max(doc.y, y + estH) + 2;
    doc.moveDown(0.05);
  }
  doc.x = PAGE_MARGIN;
}

type CarTableSpec = {
  headers: string[];
  widths: number[];
  align?: Array<"left" | "right" | "center">;
  rows: string[][];
};

function carTable(doc: PDFKit.PDFDocument, spec: CarTableSpec) {
  const { headers, widths, rows: dataRows } = spec;
  const align = spec.align ?? headers.map(() => "left" as const);
  const startX = PAGE_MARGIN;
  const padY = 3;
  // Rows grow to fit wrapped cell text: pdfkit wraps long cells at the
  // column width regardless of lineBreak/ellipsis, so a fixed row height
  // lets wrapped lines bleed into the row below.
  const rowHeightFor = (cells: string[], isHeader: boolean): number => {
    doc.font(isHeader ? "bold" : "body").fontSize(9);
    let textH = 0;
    for (let i = 0; i < cells.length; i++) {
      const w = (widths[i] ?? 60) - 8;
      textH = Math.max(textH, doc.heightOfString(cells[i] ?? "", { width: w, align: align[i] ?? "left" }));
    }
    return Math.max(isHeader ? 18 : 16, textH + padY * 2);
  };
  const drawRow = (cells: string[], y: number, isHeader: boolean, h: number) => {
    let x = startX;
    if (isHeader) {
      doc.rect(startX, y, widths.reduce((s, w) => s + w, 0), h).fill("#f3f4f6");
    }
    for (let i = 0; i < cells.length; i++) {
      const w = widths[i] ?? 60;
      const a = align[i] ?? "left";
      doc.font(isHeader ? "bold" : "body")
        .fontSize(9)
        .fillColor("black")
        .text(cells[i] ?? "", x + 4, y + padY + (isHeader ? 2 : 0), {
          width: w - 8,
          align: a,
        });
      x += w;
    }
  };
  let y = doc.y;
  const headerH = rowHeightFor(headers, true);
  drawRow(headers, y, true, headerH);
  y += headerH;
  for (const r of dataRows) {
    const rowH = rowHeightFor(r, false);
    if (y + rowH > doc.page.height - PAGE_MARGIN - 40) {
      doc.addPage();
      y = doc.y;
      const hh = rowHeightFor(headers, true);
      drawRow(headers, y, true, hh);
      y += hh;
    }
    drawRow(r, y, false, rowH);
    doc.strokeColor("#e5e7eb").lineWidth(0.5)
      .moveTo(startX, y + rowH).lineTo(startX + widths.reduce((s, w) => s + w, 0), y + rowH).stroke();
    y += rowH;
  }
  doc.y = y + 4;
  doc.x = PAGE_MARGIN;
}

type CarMetric = { label: string; value: string };

function carMetricStrip(doc: PDFKit.PDFDocument, metrics: CarMetric[]) {
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

// ---- Jurisdiction resolvers ------------------------------------------------

type NcJurisdiction = {
  key: "charlotte" | "raleigh" | "ncdot_district";
  name: string;
  triggerNote: string;
  processNote: string;
  mpoName: string;
};

/**
 * Rough bounding boxes — adequate for prose adaptation (which overlay,
 * which MPO, which thresholds), not parcel-authoritative. Same pattern
 * and caveats as floridaJurisdiction() in pdf-export.ts.
 */
function ncJurisdiction(lat: number, lon: number): NcJurisdiction {
  const inBox = (latMin: number, latMax: number, lonMin: number, lonMax: number) =>
    lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
  if (inBox(35.0, 35.5, -81.1, -80.55)) {
    return {
      key: "charlotte",
      name: "City of Charlotte / Mecklenburg County",
      triggerNote:
        "Charlotte UDO Article 32, Section 32.1 (effective 6/1/2023) requires a Comprehensive Transportation Review (CTR) — Multimodal Assessment + TDM Assessment + Traffic Impact Study — when Charlotte Streets Manual Chapter 3, Table 3.1 thresholds are met (reported secondary-source values: >1,500 vpd or >150 peak-hour trips in lower-intensity districts; >2,000 vpd or >200 peak-hour trips in medium/high-intensity districts — confirm against the current Table 3.1 at scoping). The CTR applies at permitting even for by-right development.",
      processNote:
        "CDOT publishes a Rezoning Transportation Analysis memo per rezoning petition; the TIS must be prepared by a North Carolina licensed Professional Engineer. NCDOT coordination applies on state-system streets.",
      mpoName: "CRTPO (Charlotte Regional Transportation Planning Organization) — 2026–2035 TIP",
    };
  }
  if (inBox(35.55, 36.0, -78.9, -78.3)) {
    return {
      key: "raleigh",
      name: "City of Raleigh / Wake County",
      triggerNote:
        "Raleigh Street Design Manual Section 7.1.3 triggers a TIA at: 150 or more total peak-hour trips; 100 or more peak-hour trips where primary access is on a two-lane roadway; more than 100 peak-direction trips; or 3,000 or more daily trips. Raleigh UDO Section 8.2.2 (Infrastructure Sufficiency — Streets) governs; Sec. 8.2.2.E.5 requires a traffic mitigation plan evaluated by the Transportation Director.",
      processNote:
        "Effective 7/1/2024, Raleigh DOT scopes the TIA jointly with the applicant team and NCDOT where applicable; reviews are performed by the City's on-call consultant with a fee of $5,500 per submittal ($1,000 per addendum). Rezoning TIAs compare maximum current-entitlement trips against maximum proposed-entitlement trips.",
      mpoName: "CAMPO (Capital Area Metropolitan Planning Organization)",
    };
  }
  return {
    key: "ncdot_district",
    name: "NCDOT District (statewide default)",
    triggerNote:
      "Per the NCDOT Policy on Street and Driveway Access (July 2003) Ch. 4.C, a Traffic Impact Analysis may be required at an estimated trip generation of 3,000 vehicles per day or greater (average weekday, ITE rates, with no reductions applied in the threshold test), and may also be required near interchanges (within 1,000 ft), high-crash locations, major arterials, median crossovers, or TIP-programmed improvements, at the District Engineer's discretion.",
    processNote:
      "The District Engineer administers the permit and sets the basic TIA parameters (modifiable at a pre-submittal conference); NCDOT Congestion Management reviews the TIA via the TIA Request / TIA Checklist process. An Approved Scoping Document is a required element of the TIA submittal.",
    mpoName: "Controlling MPO/RPO per site location",
  };
}

type ScJurisdiction = {
  key: "charleston" | "columbia" | "greenville" | "myrtle_beach" | "scdot_district";
  name: string;
  triggerNote: string;
  creditCapNote?: string;
  mpoName: string;
};

function scJurisdiction(lat: number, lon: number): ScJurisdiction {
  const inBox = (latMin: number, latMax: number, lonMin: number, lonMax: number) =>
    lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
  if (inBox(32.6, 33.1, -80.3, -79.7)) {
    return {
      key: "charleston",
      name: "Charleston region (Charleston / Berkeley / Dorchester)",
      triggerNote:
        "City of Charleston TIS Preparation Guide (June 2021): a TIS is required when a development includes ANY of — a drive-through window; more than 6 fuel dispensers; more than 10,000 sf of non-residential building coverage; a site of 5 acres or more; a driveway-spacing variance request; a restaurant over 4,000 sf GFA; or single/two-family projects totaling 45 or more units. The statewide ARMS 100 peak-hour-trip trigger applies on SCDOT facilities.",
      creditCapNote:
        "SCDOT District 6 caps for Charleston-area studies: internal capture limited to 20% of the lesser of entering/exiting trips; pass-by limited to 10% of adjacent street traffic. The credits applied in this screening analysis must be checked against these caps at submittal.",
      mpoName: "CHATS (Charleston Area Transportation Study), staffed by BCDCOG",
    };
  }
  if (inBox(33.85, 34.25, -81.35, -80.75)) {
    return {
      key: "columbia",
      name: "Columbia region (Richland / Lexington)",
      triggerNote:
        "Accepted Columbia-area submittals follow \"City of Columbia and SCDOT guidelines\" — i.e., ARMS Chapter 6 with the study area established with City planning staff. The statewide 100 peak-hour-trip ARMS trigger governs on SCDOT facilities.",
      mpoName: "COATS (Columbia Area Transportation Study), staffed by CMCOG",
    };
  }
  if (inBox(34.6, 35.1, -82.6, -82.1)) {
    return {
      key: "greenville",
      name: "Greenville County",
      triggerNote:
        "Greenville County Land Development Regulations Article 9 (April 2018): TIS on county roads at 100+ peak-hour trips (50 in unzoned areas; expansions adding 25%+ peak-hour trips), default study area of the 3 highest-volume intersections within 1/2 mile (3/4 mile unzoned), with a fee-in-lieu mechanism where right-of-way cannot be obtained. State roads follow ARMS with the SCDOT Traffic Requirements Form filed with the County. The County UDO Sec. 22.8 (adopted Dec 2024) carries the 100 peak-hour-trip trigger forward.",
      mpoName: "GPATS (Greenville-Pickens Area Transportation Study)",
    };
  }
  if (inBox(33.5, 34.0, -79.3, -78.6)) {
    return {
      key: "myrtle_beach",
      name: "Horry County / Myrtle Beach",
      triggerNote:
        "Horry County Land Development Regulations Table 7-6: an impact study may be required for shopping centers of 100,000+ gsf, PUDs of 75+ acres, industrial sites with 350+ employees, residential projects of 100+ single-family or 200+ total dwelling units, or offices of 100,000+ gsf, analyzed at initial opening and full development under the most critical traffic. The statewide ARMS 100 peak-hour-trip trigger applies on SCDOT facilities.",
      mpoName: "GSATS (Grand Strand Area Transportation Study — bi-state MPO)",
    };
  }
  return {
    key: "scdot_district",
    name: "SCDOT District (statewide default)",
    triggerNote:
      "Per SCDOT ARMS (2008, updated 7-8-2025) Chapter 6: a Traffic Impact Study is required for developments generating 100 or more trips during the peak hour of the generator or of the adjacent street, for expansions adding 100 or more such trips, and below that threshold when the District Traffic Engineer determines significant impact. Thresholds may be lower in rural areas and small cities; waivers may be requested through the District Traffic Engineer.",
    mpoName: "Controlling MPO/COG per site location",
  };
}

// ---- Shared engine-data helpers -------------------------------------------

/**
 * Engine scenario naming footgun (see architecture memory): current* =
 * Existing (no growth), existing* = No-Build (grown), future* = Build.
 */
function scenarioTriplet(it: any): { exLos: string; exDelay: number; nbLos: string; nbDelay: number; bLos: string; bDelay: number } {
  return {
    exLos: String(it.currentLos ?? "—"),
    exDelay: Number(it.currentDelaySec ?? NaN),
    nbLos: String(it.existingLos ?? "—"),
    nbDelay: Number(it.existingDelaySec ?? NaN),
    bLos: String(it.futureLos ?? "—"),
    bDelay: Number(it.futureDelaySec ?? NaN),
  };
}

const LOS_ORDER = "ABCDEF";
function losWorsened(from: string, to: string): boolean {
  const a = LOS_ORDER.indexOf(from);
  const b = LOS_ORDER.indexOf(to);
  return a >= 0 && b >= 0 && b > a;
}

// ============================================================================
// NORTH CAROLINA
// ============================================================================

export function renderTisNorthCarolina(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const lat = Number(project.siteLat ?? req.latitude ?? 0);
  const lon = Number(project.siteLon ?? req.longitude ?? 0);
  const jur = ncJurisdiction(lat, lon);
  const daily = Number(tg.dailyTrips ?? 0);
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);
  const losEf = Number(r.intersectionsAtLosEf ?? 0);

  // --- Executive Summary ---
  carSection(doc, "EXECUTIVE SUMMARY");
  carBody(doc,
    `This Traffic Impact Analysis (TIA) evaluates the anticipated traffic impacts of the proposed ${project.projectName || "development"} within ${region.displayName}, North Carolina (${jur.name}). The analysis follows the structure of the NCDOT Policy on Street and Driveway Access to North Carolina Highways (July 2003) Chapter 5 and the NCDOT Congestion Management Capacity Analysis Guidelines (Standards, March 2022; Best Practices, November 20, 2024). ${intersections.length} study intersection${intersections.length === 1 ? "" : "s"} within a ${fmtNum(r.studyRadiusMi ?? req.studyRadiusMi, 2)}-mile radius are analyzed under Existing, No-Build, and Build conditions.`);
  carMetricStrip(doc, [
    { label: "Intersections", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "LOS drops", value: String(losDrops) },
    { label: "At LOS E/F", value: String(losEf) },
    { label: "Daily trips (raw)", value: fmtNum(daily) },
  ]);
  doc.moveDown(0.8);

  // --- 1.0 Introduction ---
  carSection(doc, "1.0 INTRODUCTION");
  carRows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`],
    ["Build-out (horizon) year", String(req.openingYear ?? "—")],
    ["Controlling jurisdiction", jur.name],
    ["MPO", jur.mpoName],
    ["Programmed projects source", "NCDOT 2026–2035 STIP (adopted July 2025), as amended"],
  ]);
  doc.moveDown(0.4);
  carSubsection(doc, "1.1 TIA Applicability");
  carBody(doc, jur.triggerNote);
  carBody(doc,
    daily >= 3000
      ? `The proposed development's estimated raw trip generation of ${fmtNum(daily)} vehicles per day meets or exceeds the 3,000 vpd threshold at which NCDOT may require a TIA (no reductions are applied in the threshold test).`
      : `The proposed development's estimated raw trip generation of ${fmtNum(daily)} vehicles per day falls below the 3,000 vpd NCDOT threshold; TIA need is at the District Engineer's discretion per the trigger conditions above.`);
  if (daily >= 15000) {
    carBody(doc,
      "At an estimated build-out generation of 15,000 vpd or greater, the District Engineer forwards the development to Division traffic engineering staff (Division Traffic Engineer / Traffic Engineering and Safety Systems Branch) per Policy Ch. 1.B.", true);
  }
  carSubsection(doc, "1.2 Scoping");
  carBody(doc,
    `${jur.processNote} The background growth factor and the list of approved background developments must be agreed in the Approved Scoping Document prior to TIA submittal; a placeholder for that document is carried in the Appendix.`, true);

  // --- 2.0 Methodology ---
  carSection(doc, "2.0 METHODOLOGY");
  carBody(doc,
    "NCDOT requires HCM-based analysis; the Department currently utilizes Synchro 11 (with mandatory SimTraffic simulation, minimum ten runs), HCS for freeway facilities, and Sidra for roundabouts. This screening analysis applies HCM-consistent computation; Synchro 11-compatible models and SimTraffic outputs are to be provided at formal submittal.");
  carRows(doc, [
    ["Peak periods", "AM and PM weekday peak hours (minimum); counts Tue–Thu, school in session, less than 12 months old"],
    ["PHF (future conditions)", "0.90 per Standards"],
    ["Heavy vehicles", "Average of duals and TTSTs, 2% minimum"],
    ["RTOR (future analysis)", "Not permitted per Standards"],
    ["Turn-lane storage", "Greater of Synchro 95th percentile and SimTraffic maximum queue, rounded up to 25 ft; 100 ft minimum"],
    ["Roundabout threshold", "v/c 0.85"],
    ["Study-area rule", "Intersections where site trips add 10% or more to background volumes on any approach/movement"],
  ]);
  doc.moveDown(0.3);
  carSubsection(doc, "2.1 Trip Generation Basis");
  carBody(doc,
    "NCDOT's Best Practices call for the ITE Trip Generation Manual with the Department's Rate-vs-Equation spreadsheet, internal capture per the NCHRP 684 spreadsheet method (vehicle occupancy 1.1, 4,000-ft maximum walking distance), and pass-by limited to retail uses with multi-use pass-by capped at 10% of the adjacent street volume. This screening analysis applies public-data trip-generation rates (NHTS 2017 / SANDAG 2002 / NCHRP 716), with every rate tagged so the jurisdiction-approved ITE figure can be substituted at submittal; applied internal-capture and pass-by credits must be reconciled against the NCDOT limits at scoping.");

  // --- 3.0–5.0 Conditions + MOE table ---
  carSection(doc, "3.0 ANALYSIS CONDITIONS AND MEASURES OF EFFECTIVENESS");
  carBody(doc,
    "Scenarios follow the NCDOT Standards set: Existing Base Year; No-Build Design Year (build-out); and Design Year Build. Where a scoped project is phased, intermediate build-out years are analyzed with earlier-phase trips carried as site trips (never background). Where an impacted STIP project is in planning, design, or construction (or within 5 years post-construction) and site traffic was not in the STIP forecast, an additional STIP design-year analysis is coordinated per the Best Practices TIA/STIP flow chart.", true);
  carSubsection(doc, "3.1 Intersection MOE Summary (NCDOT format)");
  carBody(doc,
    "Approaches are ordered EB, WB, NB, SB and movements left–through–right per the Best Practices reporting format. Signalized intersections report control delay and LOS overall and per lane group (any v/c > 1.0 is reported as LOS F regardless of delay); unsignalized intersections report no overall LOS — results are per lane group with the conflicting movement. SimTraffic maximum-queue columns are populated at submittal.", true);
  const moeRows = intersections.slice(0, 20).map((it: any, i: number) => {
    const s = scenarioTriplet(it);
    return [
      String(i + 1),
      String(it.name ?? it.description ?? "Intersection"),
      `${s.exLos} / ${fmtNum(s.exDelay, 1)}s`,
      `${s.nbLos} / ${fmtNum(s.nbDelay, 1)}s`,
      `${s.bLos} / ${fmtNum(s.bDelay, 1)}s`,
    ];
  });
  carTable(doc, {
    headers: ["No.", "Intersection", "Existing LOS/Delay", "No-Build LOS/Delay", "Build LOS/Delay"],
    widths: [30, 200, 90, 95, 90],
    align: ["left", "left", "center", "center", "center"],
    rows: moeRows.length ? moeRows : [["—", "No study intersections in radius", "—", "—", "—"]],
  });

  // --- 6.0 Mitigation criteria check (Ch. 5.J) ---
  carSection(doc, "4.0 MITIGATION CRITERIA CHECK (POLICY CH. 5.J)");
  carBody(doc,
    "NCDOT requires improvements when, comparing base-network and project conditions: total average delay increases by 25% or more while remaining at the same LOS; the LOS degrades by one level; or the intersection operates at LOS F. Turn-lane mitigation applies where the 95th-percentile queue exceeds existing storage. Signal-timing changes alone are not considered mitigation. The District Engineer makes the final mitigation determination.");
  const mitRows = intersections.slice(0, 20).map((it: any, i: number) => {
    const s = scenarioTriplet(it);
    const deltaPct = Number.isFinite(s.nbDelay) && s.nbDelay > 0 && Number.isFinite(s.bDelay)
      ? ((s.bDelay - s.nbDelay) / s.nbDelay) * 100 : NaN;
    const delayTrip = Number.isFinite(deltaPct) && deltaPct >= 25 && s.bLos === s.nbLos;
    const losTrip = losWorsened(s.nbLos, s.bLos);
    const fTrip = s.bLos === "F";
    const any = delayTrip || losTrip || fTrip;
    return [
      String(i + 1),
      String(it.name ?? "Intersection"),
      Number.isFinite(deltaPct) ? `${deltaPct >= 0 ? "+" : ""}${fmtNum(deltaPct, 0)}%` : "—",
      losTrip ? `YES (${s.nbLos}→${s.bLos})` : "no",
      fTrip ? "YES" : "no",
      any ? "MITIGATION INDICATED" : "none indicated",
    ];
  });
  carTable(doc, {
    headers: ["No.", "Intersection", "Δ delay", "LOS drop", "LOS F", "Ch. 5.J result"],
    widths: [30, 165, 60, 85, 55, 120],
    align: ["left", "left", "center", "center", "center", "left"],
    rows: mitRows.length ? mitRows : [["—", "—", "—", "—", "—", "—"]],
  });

  // --- Conclusions + compliance block ---
  carSection(doc, "5.0 CONCLUSIONS AND SUBMITTAL NOTES");
  carBody(doc,
    losDrops === 0 && losEf === 0
      ? "No study intersection is projected to trigger the Policy Ch. 5.J mitigation criteria under Build conditions at the screening level."
      : `${losDrops} intersection${losDrops === 1 ? "" : "s"} project a LOS drop and ${losEf} operate at LOS E or F under Build conditions; mitigation per Policy Ch. 5.J should be developed with the District Engineer.`);
  carBody(doc,
    "Data conventions: NCDOT forecasts supply AADT, % duals and TTSTs, directional split (D), and design-hour factor (K); forecast conversion to peak-hour volumes uses the Intersection Analysis Utility (IAU) in the NCDOT Traffic Engineering Suite. AADT reference: NCDOT ArcGIS AADT mapping application. Crash analysis: a site-radius crash assessment from NCDOT's TEAAS (Traffic Engineering Accident Analysis System) is prepared at submittal — not generated by this screening tool.", true);
  carBody(doc,
    "This TIA is to be prepared under the direct charge of and sealed by a licensed North Carolina Professional Engineer with expertise in traffic engineering (Policy Ch. 5.A; 21 NCAC 56 .1103 — seal with signature over or adjacent to the seal and date of signing; firm name, address, and NC firm license number on the title block). TIAs marked confidential remain so until a driveway permit is requested or the project is publicly announced.", true);
  carBody(doc,
    "SCREENING DISCLOSURE: this document is a screening-level draft. It does not include the Approved Scoping Document, SimTraffic outputs, Synchro models, TEAAS crash analysis, or signed/sealed certification — all required for a formal NCDOT TIA submittal.", true);
}

// ============================================================================
// SOUTH CAROLINA
// ============================================================================

export function renderTisSouthCarolina(
  doc: PDFKit.PDFDocument,
  r: any,
  project: StoredProject,
  region: Region,
) {
  const tg = r.tripGeneration ?? {};
  const req = r.request ?? {};
  const intersections: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  const lat = Number(project.siteLat ?? req.latitude ?? 0);
  const lon = Number(project.siteLon ?? req.longitude ?? 0);
  const jur = scJurisdiction(lat, lon);
  const pmPeak = Number(tg.pmPeakTrips ?? (Number(tg.pmIn ?? 0) + Number(tg.pmOut ?? 0)));
  const losEf = Number(r.intersectionsAtLosEf ?? 0);
  const losDrops = Number(r.intersectionsWithLosDrop ?? 0);

  // --- Executive Summary ---
  carSection(doc, "EXECUTIVE SUMMARY");
  carBody(doc,
    `This Traffic Impact Study evaluates the proposed ${project.projectName || "development"} within ${region.displayName}, South Carolina (${jur.name}), in accordance with SCDOT's Access and Roadside Management Standards (ARMS, 2008 edition, updated July 8, 2025) Chapter 6 and Traffic Engineering Guideline TG-21. In South Carolina the TIS is an element of the SCDOT encroachment-permit process: the study scope must be established with the District Traffic Engineer (DTE) before analysis begins, and the DTE makes the final mitigation determination.`);
  carMetricStrip(doc, [
    { label: "Intersections", value: String(r.intersectionsStudied ?? intersections.length ?? 0) },
    { label: "PM peak trips", value: fmtNum(pmPeak) },
    { label: "At LOS E/F", value: String(losEf) },
    { label: "LOS drops", value: String(losDrops) },
  ]);
  doc.moveDown(0.8);

  // --- 1.0 Introduction ---
  carSection(doc, "1.0 INTRODUCTION");
  carRows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `LU ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    ["Site coordinates", `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`],
    ["Build-out year", String(req.openingYear ?? "—")],
    ["Controlling jurisdiction", jur.name],
    ["MPO / study", jur.mpoName],
    ["Programmed projects source", "SCDOT FFY 2024–2033 STIP, as amended (e-STIP)"],
    ["Submittal channel", "SCDOT EPPS (Encroachment Permit Processing System) via the District Permit Engineer"],
  ]);
  doc.moveDown(0.4);
  carSubsection(doc, "1.1 TIS Applicability");
  carBody(doc, jur.triggerNote);
  carBody(doc,
    pmPeak >= 100
      ? `The proposed development's estimated peak-hour generation of ${fmtNum(pmPeak)} trips meets or exceeds the ARMS 100 peak-hour-trip threshold; a TIS is required for the encroachment permit.`
      : `The proposed development's estimated peak-hour generation of ${fmtNum(pmPeak)} trips falls below the ARMS 100 peak-hour-trip threshold; a TIS may still be required at the District Traffic Engineer's determination.`);

  // --- 2.0 Project Traffic ---
  carSection(doc, "2.0 PROJECT TRAFFIC");
  carBody(doc,
    "ARMS Chapter 6 calls for trip generation per the latest edition of the ITE Trip Generation Manual, with internal-capture, pass-by, and transit reductions justified to the DTE. This screening analysis applies public-data trip-generation rates (NHTS 2017 / SANDAG 2002 / NCHRP 716), with every rate tagged so the jurisdiction-approved ITE figure can be substituted at submittal.");
  if (jur.creditCapNote) carBody(doc, jur.creditCapNote, true);
  carRows(doc, [
    ["Daily trips (gross)", fmtNum(tg.dailyTrips)],
    ["AM peak hour", `${fmtNum(tg.amIn)} in / ${fmtNum(tg.amOut)} out`],
    ["PM peak hour", `${fmtNum(tg.pmIn)} in / ${fmtNum(tg.pmOut)} out`],
    ["Counts standard", "AM and PM weekday peaks minimum; counts ≤12 months old, school in session, seasonally adjusted"],
  ]);
  doc.moveDown(0.3);

  // --- 3.0 Volume development + 4.0 capacity vs TG-21 ---
  carSection(doc, "3.0 TRAFFIC VOLUME DEVELOPMENT AND CAPACITY ANALYSIS");
  carBody(doc,
    "Scenarios per ARMS: existing year, build-out no-build, and build-out build. Capacity analysis follows the Highway Capacity Manual (HCM 6th Edition consistent) with LOS reported for all approaches and movements; coordinated signal systems are analyzed as a system.", true);
  carSubsection(doc, "3.1 TG-21 Level of Service Standard — LOS C");
  carBody(doc,
    "Per SCDOT Traffic Engineering Guideline TG-21 (Mitigation of Traffic Impacts), the acceptable level of service for the design (peak) hour is LOS C or better for all roadway types statewide, applied in lieu of locally preferred thresholds. Where the baseline already operates at or below LOS C, the baseline LOS must be maintained or improved; where the baseline is LOS F in a congested urban area, mitigation is at the DTE's determination. Note: this is a stricter standard than the LOS D convention applied in several neighboring states.");
  const scRows = intersections.slice(0, 20).map((it: any, i: number) => {
    const s = scenarioTriplet(it);
    const belowC = LOS_ORDER.indexOf(s.bLos) > LOS_ORDER.indexOf("C");
    const baselineBelowC = LOS_ORDER.indexOf(s.nbLos) > LOS_ORDER.indexOf("C");
    let verdict: string;
    if (!belowC) verdict = "meets LOS C";
    else if (baselineBelowC && !losWorsened(s.nbLos, s.bLos)) verdict = "baseline maintained";
    else verdict = "TG-21 MITIGATION INDICATED";
    return [
      String(i + 1),
      String(it.name ?? "Intersection"),
      `${s.exLos}`, `${s.nbLos}`, `${s.bLos} / ${fmtNum(s.bDelay, 1)}s`,
      verdict,
    ];
  });
  carTable(doc, {
    headers: ["No.", "Intersection", "Exist.", "No-Build", "Build LOS/Delay", "TG-21 (LOS C) check"],
    widths: [30, 165, 45, 60, 95, 120],
    align: ["left", "left", "center", "center", "center", "left"],
    rows: scRows.length ? scRows : [["—", "No study intersections in radius", "—", "—", "—", "—"]],
  });

  // --- 5.0 Findings / access mgmt / warrants ---
  carSection(doc, "4.0 FINDINGS, ACCESS MANAGEMENT, AND SIGNAL WARRANTS");
  carBody(doc,
    losEf === 0 && losDrops === 0
      ? "No study intersection is projected below the TG-21 LOS C standard under Build conditions at the screening level."
      : `${losDrops} intersection${losDrops === 1 ? "" : "s"} project a LOS drop and ${losEf} operate at LOS E or F under Build conditions; mitigation alternatives (turn lanes with storage per ARMS Ch. 5 and the SCDOT Roadway Design Manual Ch. 9, signalization, or operational improvements) are developed with the DTE, who makes the final determination.`);
  carBody(doc,
    "Access management: ARMS requires demonstration that the fewest driveways necessary serve the site, with sight-distance verification at each access point. Signal proposals require a signal warrant analysis per the MUTCD. Both are site-plan-dependent and are prepared at submittal.", true);

  // --- Completeness checklist ---
  carSection(doc, "5.0 ARMS TECHNICAL COMPLETENESS CHECKLIST");
  carBody(doc,
    "SCDOT returns incomplete studies unreviewed. The ARMS completeness checklist is tracked below against this screening draft; unmet items are produced at formal submittal.", true);
  carTable(doc, {
    headers: ["Checklist item", "Status in this draft"],
    widths: [280, 225],
    rows: [
      ["SC PE stamp and signature", "At submittal (screening draft is unsealed)"],
      ["Introduction + executive summary", "Included"],
      ["Existing conditions (classification, peaks, LOS, volumes)", "Included (screening level)"],
      ["Trip generation / distribution / LOS analysis", "Included (public-data rates, tagged)"],
      ["Crash data / speeds / sight distance", "At submittal (site-specific)"],
      ["Mitigation w/ turn-lane storage lengths", "Indicated per TG-21 table; design at submittal"],
      ["Figures (vicinity, site plan, volumes, lane configs, LOS)", "Volume/LOS figures included; site-plan figures at submittal"],
      ["Tables (trip gen, LOS existing/background/build/mitigated)", "Included (screening level)"],
      ["Technical appendix (capacity reports, warrants)", "Capacity worksheets appended; Synchro/warrants at submittal"],
    ],
  });
  carBody(doc,
    "This TIS is to be prepared under the direct charge of and sealed by a registered South Carolina Professional Engineer with expertise in traffic engineering (ARMS), with seal, signature across the seal face, and date per S.C. Code §40-22-270 and Regs. Ch. 49, and the firm's Certificate of Authorization. Electronic sealing is accepted in current practice.", true);
  carBody(doc,
    "SCREENING DISCLOSURE: this document is a screening-level draft prepared before DTE scoping. Scope, growth rates, background developments, and mitigation are established with the District Traffic Engineer; a submittal-grade analysis supersedes this draft.", true);
}
