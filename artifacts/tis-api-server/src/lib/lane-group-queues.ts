/**
 * Per-lane-group (turn-movement) queue block, shared by every regional renderer.
 *
 * Its own leaf module for the same reason `trip-rate-rows.ts` is one: pdf-export.ts
 * already imports the Carolinas / states / NY renderers, so putting this there and
 * importing it back would cycle. Self-contained per the Path A convention — it
 * re-declares the couple of primitives it needs rather than coupling to a renderer.
 *
 * Renders NOTHING unless at least one approach carries `laneGroups`, which the
 * engine populates only where an imported Synchro/UTDF record supplied real
 * measured turning movements (see laneGroupsForApproach in tis.ts). So calling
 * this from a renderer is safe for every study that has no import: the output
 * stays byte-identical.
 */

const PAGE_MARGIN = 50;
const TEXT_GRAY = "#6b7280";

type LaneGroup = {
  movement: "L" | "T" | "R";
  futureVolumeVph: number;
  futureVc: number;
  queue95thFt: number;
  storageFt?: number;
  storageDeficient?: boolean;
};

const num = (x: unknown): string =>
  typeof x === "number" && Number.isFinite(x)
    ? Math.round(x).toLocaleString("en-US")
    : "—";

/** True when this study has at least one measured lane-group row to show. */
export function hasLaneGroups(intersections: unknown[]): boolean {
  return (intersections ?? []).some((it) =>
    ((it as { approaches?: unknown[] })?.approaches ?? []).some(
      (a) => Array.isArray((a as { laneGroups?: unknown[] })?.laneGroups)
        && ((a as { laneGroups?: unknown[] }).laneGroups as unknown[]).length > 0,
    ),
  );
}

/**
 * @param headingFn renderer-native subsection heading (gaSubsection / nySubsection / …)
 * @param heading   full heading text, e.g. "8.1 LANE-GROUP QUEUES"
 */
export function renderLaneGroupQueues(
  doc: PDFKit.PDFDocument,
  intersections: any[],
  opts: {
    headingFn?: (doc: PDFKit.PDFDocument, title: string) => void;
    heading?: string;
  } = {},
): void {
  const its = (intersections ?? []).filter((it) =>
    (it?.approaches ?? []).some((a: any) => Array.isArray(a?.laneGroups) && a.laneGroups.length > 0),
  );
  if (its.length === 0) return;

  const heading = opts.heading ?? "Lane-Group Queues at Intersections with Measured Turning Movements";
  if (opts.headingFn) opts.headingFn(doc, heading);
  else doc.font("bold").fontSize(11).fillColor("black").text(heading, { paragraphGap: 6 });

  doc.font("body").fontSize(10).fillColor("black").text(
    "At the intersections below, an imported Synchro record supplied measured turning-movement "
      + "counts, so the background traffic carries a real left / through / right split rather than an "
      + "assumed one. Each lane group is analyzed on the same one-critical-lane screening basis as the "
      + "approach (saturation flow × g/C), with the project's own trips assigned to specific movements "
      + "by the path assignment; lane-group volumes cross-foot to their approach total. Where the "
      + "imported record also carried a bay length, the queue is compared against that bay and a deficit "
      + "is flagged. Lane counts and phasing are NOT carried by the import, so a calibrated Synchro / "
      + "SimTraffic run supersedes these figures for design.",
    { paragraphGap: 6 },
  );

  const headers = ["Intersection", "Lane group", "Build vph", "v/c", "Q95 (ft)", "Bay (ft)", "Storage"];
  const widths = [150, 70, 55, 40, 55, 50, 65];
  const rows: string[][] = [];
  for (const it of its) {
    for (const a of it.approaches ?? []) {
      for (const g of (a.laneGroups ?? []) as LaneGroup[]) {
        const hasBay = typeof g.storageFt === "number" && Number.isFinite(g.storageFt);
        rows.push([
          String(it.name ?? it.signalId ?? "—"),
          `${a.direction} ${g.movement}`,
          num(g.futureVolumeVph),
          Number.isFinite(g.futureVc) ? g.futureVc.toFixed(2) : "—",
          num(g.queue95thFt),
          hasBay ? num(g.storageFt) : "—",
          g.storageDeficient ? "Deficient" : hasBay ? "Adequate" : "—",
        ]);
      }
    }
  }

  // Minimal self-contained table (Path A) — no dependency on any renderer's
  // table(), which each declares privately with different signatures.
  const startX = PAGE_MARGIN;
  const rowH = 14;
  let y = doc.y + 2;
  const drawRow = (cells: string[], bold: boolean, deficient: boolean) => {
    if (y + rowH > doc.page.height - PAGE_MARGIN - 30) {
      doc.addPage();
      y = doc.y;
    }
    let x = startX;
    doc.font(bold ? "bold" : "body").fontSize(8).fillColor(deficient ? "#b45309" : "black");
    cells.forEach((c, i) => {
      const right = i >= 2 && i <= 5;
      doc.text(c, x + 2, y + 3, { width: widths[i] - 4, align: right ? "right" : "left", lineBreak: false });
      x += widths[i];
    });
    doc.save().lineWidth(0.4).strokeColor("#e5e7eb")
      .moveTo(startX, y + rowH).lineTo(startX + widths.reduce((s, w) => s + w, 0), y + rowH).stroke().restore();
    y += rowH;
  };
  drawRow(headers, true, false);
  for (const r of rows) drawRow(r, false, r[6] === "Deficient");
  doc.y = y + 4;
  doc.x = PAGE_MARGIN;

  const deficient = rows.filter((r) => r[6] === "Deficient").length;
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
    deficient > 0
      ? `${deficient} lane group(s) show a 95th-percentile queue longer than the imported bay storage; these are carried into the turn-lane evaluation.`
      : "No lane group exceeds its imported bay storage under Build conditions.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");
}
