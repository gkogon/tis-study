/**
 * California Screened-Out Determination Memo renderer.
 *
 * Short-form deliverable the OPR § E.1 cascade supports when a project
 * clears one of the six screening criteria (typical case: daily trips
 * below the host-jurisdiction screening floor — 110 OPR default; 250
 * LA / Sacramento; 500 Long Beach / Fresno). Mirrors the GA / TX
 * worksheet shape: 3–5 pages, scoped to the determination and its
 * citation chain, with an explicit non-CEQA operational carve-out so
 * reviewers know the screen does NOT exempt the project from Caltrans
 * Encroachment Permit review or HDM site-access design.
 *
 * Section structure:
 *   §1 Project Description
 *   §2 Auto-Screening Result (caVmtScreening cascade table)
 *   §3 Citation Block (OPR / PRC / CCR / host guidelines)
 *   §4 PE Certification (CA-licensed Civil or Traffic Engineer)
 *   §5 Non-CEQA Operational Note (Encroachment Permit / HDM)
 *
 * Lives in its own module (sibling to pdf-export.ts) rather than inline
 * in the main renderer file. The layout primitives (rows, table,
 * caSection, statusLabel, fmtNum) and the screening cascade
 * (caVmtScreening) are duplicated locally so this module can be
 * iterated independently of pdf-export.ts; in exchange for that
 * coupling, the dispatch site in renderTisCalifornia() can short-
 * circuit with `renderTisCaliforniaWorksheet(doc, r, project, region,
 * tierInput, jur)` without threading deps through the call.
 */
import type { Region } from "./regions";
import { jurisdictionTierLabel, type TierInput } from "./study-tier";

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

export type CaliforniaJurisdiction = {
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

type ScreeningCriterionStatus =
  | "screened_out"
  | "not_screened_out"
  | "not_applicable"
  | "requires_verification";

type ScreeningCriterionResult = {
  label: string;
  status: ScreeningCriterionStatus;
  note: string;
};

const PAGE_MARGIN = 50;
const BRAND_BLUE = "#2563eb";
const TEXT_GRAY = "#6b7280";

function statusLabel(s: ScreeningCriterionStatus): string {
  switch (s) {
    case "screened_out":
      return "Screened out — presumed less-than-significant";
    case "not_screened_out":
      return "Not screened out by this criterion";
    case "not_applicable":
      return "N/A for this project";
    case "requires_verification":
      return "Requires verification (data source named below)";
  }
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function caSection(doc: PDFKit.PDFDocument, title: string) {
  doc.x = PAGE_MARGIN;
  doc.font("bold").fontSize(13).fillColor("black").text(title, { characterSpacing: 0.5 });
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
    doc
      .font("body")
      .fontSize(10)
      .fillColor(TEXT_GRAY)
      .text(label, startX, y, { width: labelW, continued: false });
    doc
      .font("body")
      .fontSize(10)
      .fillColor("black")
      .text(value ?? "—", startX + labelW + 10, y, { width: valueW });
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
      doc
        .font(isHeader ? "bold" : "body")
        .fontSize(9)
        .fillColor("black")
        .text(cells[i] ?? "", x + 4, y + (isHeader ? 5 : 3), {
          width: w - 8,
          align: a,
          lineBreak: true,
        });
      x += w;
    }
  };
  let y = doc.y;
  drawRow(headers, y, true);
  y += headerH;
  for (const r of dataRows) {
    if (y + rowH > doc.page.height - PAGE_MARGIN) {
      doc.addPage();
      y = PAGE_MARGIN;
      drawRow(headers, y, true);
      y += headerH;
    }
    drawRow(r, y, false);
    y += rowH;
  }
  doc.y = y + 2;
  doc.x = startX;
}

/**
 * OPR § E.1 six-criterion cascade (replica of pdf-export.ts's
 * caVmtScreening — duplicated here so this module stays standalone).
 * Auto-determines the criteria the engine can evaluate from project
 * metadata (trip count, ITE land-use code, size). Flags GIS-dependent
 * criteria (TPA, low-VMT map, redevelopment baseline) as "Requires
 * verification" with the data source named.
 */
function caVmtScreening(
  dailyTrips: number,
  luCode: string,
  size: number,
  unit: string,
  jurisScreeningTripCount: number,
  jurisName: string,
): ScreeningCriterionResult[] {
  const isResidential =
    luCode.startsWith("21") || luCode.startsWith("22") || luCode.startsWith("23");
  const isRetail =
    luCode.startsWith("82") ||
    luCode.startsWith("85") ||
    luCode.startsWith("86") ||
    luCode.startsWith("87") ||
    luCode.startsWith("88");
  const sizeKsf = unit && unit.toLowerCase().includes("ksf") ? size : NaN;

  const results: ScreeningCriterionResult[] = [];

  results.push({
    label: `Small project: <${jurisScreeningTripCount} daily trips (${jurisName} screening threshold; OPR floor 110)`,
    status:
      dailyTrips > 0 && dailyTrips < jurisScreeningTripCount
        ? "screened_out"
        : dailyTrips > 0
          ? "not_screened_out"
          : "requires_verification",
    note:
      dailyTrips > 0
        ? `Project generates ${Math.round(dailyTrips).toLocaleString()} daily trips. Threshold: ${jurisScreeningTripCount}.`
        : "Daily trip count not available from engine output.",
  });

  results.push({
    label:
      "Transit Priority Area (TPA): within ½ mi of a major transit stop (PRC § 21064.3) or high-quality transit corridor (PRC § 21155)",
    status: "requires_verification",
    note:
      "Requires GIS query against the MPO's major-transit-stop layer + high-quality-transit-corridor layer. TPA presumption does NOT apply if FAR <0.75, parking exceeds requirement, project is inconsistent with the SCS, or affordable units are replaced with fewer market-rate units (OPR Tech Advisory p. 14) — flag in submittal even if TPA-eligible.",
  });

  results.push({
    label: "Low-VMT area: project sited in a TAZ already performing ≥15% below baseline",
    status: "requires_verification",
    note:
      "Consult the host jurisdiction's published low-VMT screening map (e.g., SCAG HELPR 3.0; SANDAG SB 743 portal; LADOT VMT Calculator zone lookup; Fresno COG screening tool). Auto-screening from project lat/lon not implemented in this Phase-2 slice.",
  });

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

  if (isResidential) {
    results.push({
      label: "100% affordable residential infill (OPR Tech Advisory p. 14–15)",
      status: "requires_verification",
      note:
        "Project is ITE residential. Applicant must attest to 100% affordable unit mix + infill-location qualification. Not auto-determined from ITE land use alone.",
    });
  } else {
    results.push({
      label: "100% affordable residential infill",
      status: "not_applicable",
      note: `Project is ITE land use ${luCode}, not residential.`,
    });
  }

  results.push({
    label: "Redevelopment with net VMT decrease (existing use → proposed use)",
    status: "requires_verification",
    note:
      "Requires prior-use VMT computation (existing site land use + intensity + tenancy). If the site is vacant or undeveloped, this criterion does not apply — flag as N/A in submittal. OPR p. 14: presumption does not apply where redevelopment displaces affordable housing near transit.",
  });

  return results;
}

/**
 * OPR Dec 2018 Technical Advisory page citations by criterion index
 * (matches caVmtScreening() declaration order: small project / TPA /
 * low-VMT / retail / affordable / redevelopment).
 */
function caScreeningCriterionCitation(index: number): string {
  switch (index) {
    case 0:
      return "OPR Technical Advisory (Dec 2018), p. 12 (small-project screening floor; tied to CEQA § 15301(e)(2) categorical exemption)";
    case 1:
      return "OPR Technical Advisory (Dec 2018), p. 14 (Transit Priority Area presumption; PRC § 21064.3 + § 21155)";
    case 2:
      return "OPR Technical Advisory (Dec 2018), p. 13–14 (low-VMT area map-based screen)";
    case 3:
      return "OPR Technical Advisory (Dec 2018), p. 14 (locally-serving retail size cap)";
    case 4:
      return "OPR Technical Advisory (Dec 2018), p. 14–15 (100% affordable residential infill)";
    case 5:
      return "OPR Technical Advisory (Dec 2018), p. 14 (redevelopment with net VMT decrease)";
    default:
      return "OPR Technical Advisory (Dec 2018), § E.1 (screening criteria)";
  }
}

export function renderTisCaliforniaWorksheet(
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

  caSection(doc, "CEQA-VMT SCREENED-OUT DETERMINATION MEMO");
  doc.font("bold").fontSize(11).fillColor(BRAND_BLUE).text(tierName, { paragraphGap: 4 });
  doc
    .font("body")
    .fontSize(9)
    .fillColor(TEXT_GRAY)
    .text(
      `Short-form deliverable issued when the OPR § E.1 six-criterion cascade screens a project out of full CEQA-VMT analysis. Per the ${jur.guidelinesDoc} screening floor of ${jur.screeningTripCount} daily trips and the OPR Dec 2018 Technical Advisory, a project that satisfies any of the six screening criteria is presumed less-than-significant under CEQA Guidelines § 15064.3 without further VMT analysis. This memo does NOT substitute for the §5 non-CEQA operational review noted below where state-route frontage or HDM site-access design applies.`,
      { paragraphGap: 6 },
    );
  doc.fillColor("black");

  if (firedCriterion) {
    doc
      .font("bold")
      .fontSize(11)
      .fillColor(BRAND_BLUE)
      .text(
        `AUTO-SCREENING RESULT: SCREENED OUT via ${firedCriterion.label} — presumed less-than-significant under CEQA Guidelines § 15064.3.`,
        { paragraphGap: 6 },
      );
  } else {
    doc
      .font("bold")
      .fontSize(11)
      .fillColor(BRAND_BLUE)
      .text(
        "AUTO-SCREENING RESULT: No auto-evaluable criterion fired in the engine cascade. Tier resolved to Worksheet by explicit request; verify the screening basis (e.g. TPA, low-VMT map, redevelopment baseline) before relying on this memo.",
        { paragraphGap: 6 },
      );
  }
  doc.fillColor("black");

  // --- §1 Project Description -------------------------------------------
  caSection(doc, "1.0 PROJECT DESCRIPTION");
  doc
    .font("body")
    .fontSize(10)
    .fillColor("black")
    .text(
      `The proposed ${project.projectName || "development"} is located within ${region.displayName}, California. The host CEQA lead agency for the transportation determination is ${jur.name}; the regional MPO is ${jur.mpoName}.`,
      { paragraphGap: 6 },
    );
  rows(doc, [
    ["Project name", project.projectName || "—"],
    ["Land use", `ITE ${tg.landUseCode ?? "—"} — ${tg.landUseName ?? ""}`.trim()],
    ["Development size", tg.size != null ? `${tg.size} ${tg.unit ?? ""}`.trim() : "—"],
    [
      "Site coordinates",
      req.latitude && req.longitude
        ? `${Number(req.latitude).toFixed(4)}°, ${Number(req.longitude).toFixed(4)}°`
        : "—",
    ],
    ["Opening year", String(req.openingYear ?? "—")],
    ["Host lead agency", jur.name],
    ["Regional MPO", jur.mpoName],
    ["Daily trip generation (ITE)", `${fmtNum(tierInput.dailyTrips)} trips/day`],
    ["Jurisdiction screening floor", `${jur.screeningTripCount} daily trips`],
  ]);
  doc.moveDown(0.5);

  // --- §2 Auto-Screening Result -----------------------------------------
  caSection(doc, "2.0 AUTO-SCREENING RESULT (OPR § E.1)");
  doc
    .font("body")
    .fontSize(10)
    .fillColor("black")
    .text(
      `The six OPR § E.1 screening criteria are auto-evaluated against project metadata (daily trip count, ITE land-use category, project size). Criteria requiring GIS layers the engine does not yet ingest (Transit Priority Area, low-VMT TAZ map, prior-use VMT for redevelopment) are flagged "Requires verification" with the data source named. If ANY criterion resolves to "Screened out," the project is presumed less-than-significant for CEQA-VMT purposes and a full VMT impact analysis is not required.`,
      { paragraphGap: 6 },
    );

  table(doc, {
    headers: ["OPR Criterion", "Auto-screening result", "Notes"],
    widths: [200, 130, 170],
    align: ["left", "center", "left"],
    rows: screeningResults.map((c) => [c.label, statusLabel(c.status), c.note]),
  });
  doc.moveDown(0.3);

  if (firedCriterion) {
    doc
      .font("bold")
      .fontSize(10)
      .fillColor(BRAND_BLUE)
      .text(
        `DETERMINATION: SCREENED OUT via "${firedCriterion.label}" — presumed less-than-significant under CEQA Guidelines § 15064.3(b)(1).`,
        { paragraphGap: 6 },
      );
  }
  doc.fillColor("black");
  doc
    .font("body")
    .fontSize(9)
    .fillColor(TEXT_GRAY)
    .text(
      "Note: this cascade does not fabricate VMT numbers or substitute for a full MPO model run. The TPA, low-VMT-map, and redevelopment criteria are GIS-dependent and require manual verification by the consultant before submittal.",
      { paragraphGap: 6 },
    );
  doc.fillColor("black");

  // --- §3 Citation Block -------------------------------------------------
  caSection(doc, "3.0 CITATION BLOCK");
  doc
    .font("body")
    .fontSize(10)
    .fillColor("black")
    .text(
      "The screened-out determination above derives from the statutory, regulatory, and host-jurisdiction citations below. The signing PE must verify each citation against the version in force at submittal — OPR Tech Advisory page numbers refer to the Dec 2018 edition (no superseding edition as of report generation).",
      { paragraphGap: 6 },
    );
  rows(doc, [
    [
      "Screening criterion fired",
      firedCriterion ? firedCriterion.label : "None auto-fired — verification pending (see §2)",
    ],
    [
      "OPR Tech Advisory citation",
      firedIndex >= 0
        ? caScreeningCriterionCitation(firedIndex)
        : "OPR Technical Advisory (Dec 2018), § E.1 (screening criteria)",
    ],
    [
      "Statutory hook (SB 743)",
      "Pub. Resources Code § 21099(b)(2) — automobile delay (LOS or similar) shall not be considered a significant impact on the environment.",
    ],
    [
      "CEQA Guidelines regulation",
      "14 CCR § 15064.3(b)(1) — VMT is the default transportation metric for CEQA significance; projects qualifying under a screening criterion are presumed less-than-significant without further VMT analysis.",
    ],
    ["Host jurisdiction guidelines", jur.guidelinesDoc],
    [
      "Screening floor (host)",
      `<${jur.screeningTripCount} daily trips presumed less-than-significant per ${jur.guidelinesDoc.split("(")[0].trim()}.`,
    ],
  ]);
  doc.moveDown(0.3);
  if (jur.extraNote) {
    doc
      .font("body")
      .fontSize(9)
      .fillColor(TEXT_GRAY)
      .text(`Jurisdiction note. ${jur.extraNote}`, { paragraphGap: 6 });
    doc.fillColor("black");
  }

  // --- §4 Professional Engineer Certification ----------------------------
  caSection(doc, "4.0 PROFESSIONAL ENGINEER CERTIFICATION");
  doc
    .font("body")
    .fontSize(10)
    .fillColor("black")
    .text(
      "California Business & Professions Code § 6730 (Civil Engineers) and § 6731.5 (Traffic Engineers) reserve the practice of civil and traffic engineering — including the preparation of transportation impact determinations submitted to a public agency — to PEs licensed by the California Board for Professional Engineers, Land Surveyors, and Geologists (BPELSG). The cover and signature page of the formal submittal must bear the seal, signature, and date of a California-licensed Civil Engineer (CE) or Traffic Engineer (TE) per 16 CCR Div. 5, Article 6, § 411 (Seals — content, form, and use). The signing PE attests that the screened-out determination above is technically defensible against the OPR Dec 2018 Technical Advisory at the project's host jurisdiction.",
      { paragraphGap: 6 },
    );
  doc
    .font("body")
    .fontSize(9)
    .fillColor(TEXT_GRAY)
    .text(
      "Scope of the seal: this is a screening-tier deliverable. The signing PE attests only to (a) the screening criterion auto-fire identified in §2 and (b) the citation chain in §3 as applied to the project's parameters listed in §1. The PE does NOT thereby certify any non-CEQA operational analysis (see §5) — that requires a separate scope of work under the Caltrans EPM / HDM stack.",
      { paragraphGap: 6 },
    );
  doc.fillColor("black");

  // --- §5 Non-CEQA Operational Note --------------------------------------
  caSection(doc, "5.0 NON-CEQA OPERATIONAL NOTE");
  doc
    .font("bold")
    .fontSize(10)
    .fillColor(BRAND_BLUE)
    .text(
      "A screened-out CEQA determination does NOT exempt the project from non-CEQA operational review.",
      { paragraphGap: 4 },
    );
  doc
    .font("body")
    .fontSize(10)
    .fillColor("black")
    .text(
      "Per Pub. Resources Code § 21099(b)(2), LOS is not a CEQA metric — but it remains the operational metric Caltrans and most local agencies apply for permit and site-access review. The carve-outs below should be checked against the final site plan before submittal:",
      { paragraphGap: 6 },
    );
  doc
    .font("body")
    .fontSize(10)
    .fillColor("black")
    .text(
      "• Caltrans Encroachment Permit (state-route frontage): if the project fronts on or proposes new access to a Caltrans-owned State Highway System (SHS) facility, Caltrans Encroachment Permits Manual (EPM) review applies and is non-CEQA — typically requires HCM-based LOS, queueing, and CA MUTCD 2026 Part 4C signal-warrant analysis even when the CEQA-VMT determination is screened out.",
      { paragraphGap: 4 },
    );
  doc
    .font("body")
    .fontSize(10)
    .fillColor("black")
    .text(
      "• HDM Ch. 100 / Ch. 400 (site-access design): regardless of state-route frontage, Caltrans Highway Design Manual Chapters 100 (Basic Design Policies) and 400 (Intersections at Grade) apply to driveway geometry, intersection sight distance (AASHTO Green Book), and turn-lane warrants on any access serving the project. The local agency's adopted operational standards layer on top of HDM for the local-street network.",
      { paragraphGap: 6 },
    );
  doc
    .font("body")
    .fontSize(9)
    .fillColor(TEXT_GRAY)
    .text(
      `Host-jurisdiction operational context applicable to this project: ${jur.operationalContext}.`,
      { paragraphGap: 6 },
    );
  doc.fillColor("black");
}
