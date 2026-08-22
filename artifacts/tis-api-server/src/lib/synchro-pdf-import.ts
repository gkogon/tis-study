/**
 * Synchro REPORT PDF reader — the sibling of utdf-import.ts for the file
 * engineers actually email around.
 *
 * A UTDF text export carries coordinates, but almost nobody attaches one to
 * a review email; what circulates is the printed Synchro report (a TIS
 * appendix full of "Timings" / "Queues" / "Lanes, Volumes, Timings" /
 * HCM-styled pages). Those pages carry intersection NAMES and per-movement
 * tables but NO coordinates — so this module extracts the structured data,
 * and the engine matches records to study intersections BY NAME at generate
 * time (synchro-name-match.ts). "Synchro" is named nominatively here: we
 * read the reports the engineer already has; no compatibility or
 * endorsement by Trafficware is implied.
 *
 * Extraction is PURE JS (pdfjs-dist) — the production image has no poppler,
 * so shelling out to pdftotext is not an option. pdfjs gives every text run
 * with its transform matrix, which buys two things whitespace-split text
 * never could:
 *   - ROTATED text (diagonal DRAFT watermarks — ubiquitous on filed TIS
 *     appendices) is dropped before it can corrupt a row, and
 *   - each value is assigned to its column by X-CENTER distance against the
 *     header labels, so right-aligned numerics land on the right movement.
 *
 * Page layouts parsed (Synchro 10–12 print layouts are column-stable):
 *   - "Timings"                          volumes + cycle length
 *   - "Lanes, Volumes, Timings"          volumes + PHF + HV% + storage + cycle
 *   - "Queues"                           turn-bay storage only (its
 *                                        "Lane Group Flow" row is PHF-adjusted
 *                                        flow, NOT raw volume — never imported)
 *   - "HCM … Signalized Intersection …"  volumes + PHF + HV% (+ cycle)
 *   - "HCM … TWSC/AWSC/Unsignalized …"   volumes + PHF + HV% + storage
 *   - "HCM … Roundabout"                 attempted via the same movement table
 *
 * Everything else is SKIPPED WITH A NAMED WARNING carrying what was at
 * stake — the utdf-import.ts discipline (silence never masquerades as
 * coverage). A PDF with no recognizable Synchro block parses to zero
 * intersections plus a clear "no Synchro report blocks recognized" warning,
 * never a crash.
 *
 * Reports print one page-set per analysis scenario ("Scenario 1 - AM",
 * "Existing PM", …). Mixing scenarios would silently blend different hours
 * into one "existing condition", so ONE scenario is imported — PM preferred
 * (the engine's measured anchor hour), "existing" preferred among PMs — and
 * every skipped scenario is named, with its intersection count, in the
 * warnings and the response's scenariosSkipped.
 */

import type { UtdfDocument, UtdfMovement } from "./utdf-import";
import { movementColumns } from "./utdf-import";

/** Size cap for an uploaded report PDF. ~20 MB nominal, set to 25 MB so a
 *  real-world full TIS appendix (the 688-page fixture source is 22 MB)
 *  still fits. */
export const SYNCHRO_PDF_MAX_BYTES = 25 * 1024 * 1024;
/** Page cap — a full TIS with appendices runs ~700 pages. */
export const SYNCHRO_PDF_MAX_PAGES = 800;

/** %PDF magic-byte check — the branch is on content, never on filename. */
export function isPdfBytes(data: Uint8Array): boolean {
  return (
    data.length >= 5 &&
    data[0] === 0x25 && // %
    data[1] === 0x50 && // P
    data[2] === 0x44 && // D
    data[3] === 0x46 && // F
    data[4] === 0x2d    // -
  );
}

export type SynchroPdfParseResult = {
  /** Same document shape utdf-import produces — nodes carry NO coordinates. */
  doc: UtdfDocument;
  pageCount: number;
  /** Pages recognized as Synchro report blocks (any scenario). */
  synchroPages: number;
  scenarioUsed?: string;
  scenariosSkipped: string[];
  /** Set when the PDF exceeded SYNCHRO_PDF_MAX_PAGES — nothing was parsed;
   *  the route maps this to a 400 (consistent with the size cap). */
  pageLimitExceeded?: number;
};

// ---------------------------------------------------------------------------
// PDF text extraction (positioned, rotation-filtered)
// ---------------------------------------------------------------------------

type PositionedItem = { str: string; x0: number; xc: number };
type Line = { y: number; items: PositionedItem[]; text: string };

// pdfjs-dist@5 constructs a DOMMatrix at module load; Node has none without
// a canvas package. Text extraction never renders, so a tiny inert shim is
// all the module needs to load headless.
function shimDomGlobals(): void {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrixShim {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[]) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init as [number, number, number, number, number, number];
        }
      }
      scale(): DOMMatrixShim { return this; }
      translate(): DOMMatrixShim { return this; }
      multiply(): DOMMatrixShim { return this; }
      inverse(): DOMMatrixShim { return this; }
    };
  }
}

// Minimal structural view of the pdfjs API this module consumes. The
// package's legacy/build/pdf.d.mts type shim self-references "pdfjs-dist"
// (no `exports` map), which TS cannot resolve from inside the package — so
// we type the four members we use rather than fight the resolver.
type PdfjsTextItem = { str?: string; transform?: number[]; width?: number };
type PdfjsPage = {
  getTextContent(): Promise<{ items: PdfjsTextItem[] }>;
  cleanup(): void;
};
type PdfjsDocument = {
  numPages: number;
  getPage(n: number): Promise<PdfjsPage>;
  destroy(): Promise<void>;
};
type PdfjsModule = {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfjsDocument> };
};

/**
 * Extract every page's UPRIGHT text as lines (top → bottom, items left →
 * right). Rotated runs (watermarks/stamps) are counted and dropped.
 */
async function extractPages(
  data: Uint8Array,
): Promise<{ pages: Line[][]; rotatedDropped: number }> {
  shimDomGlobals();
  const { getDocument } = (await import(
    "pdfjs-dist/legacy/build/pdf.mjs"
  )) as unknown as PdfjsModule;
  const doc = await getDocument({
    // pdfjs transfers (detaches) the buffer it is given — hand it a copy so
    // the caller's bytes survive the parse.
    data: data.slice(),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  let rotatedDropped = 0;
  const pages: Line[][] = [];
  try {
    if (doc.numPages > SYNCHRO_PDF_MAX_PAGES) {
      const err = new Error(
        `PDF has ${doc.numPages} pages — over the ${SYNCHRO_PDF_MAX_PAGES}-page cap`,
      ) as Error & { pageLimit?: number };
      err.pageLimit = doc.numPages;
      throw err;
    }
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const byY = new Map<number, PositionedItem[]>();
      for (const it of tc.items) {
        if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
        if (it.str.trim().length === 0) continue;
        const [a, b, c, , e, f] = it.transform as [number, number, number, number, number, number];
        // Rotated or mirrored runs are watermark/stamp text, never table
        // content — drop them BEFORE they can interleave with a row.
        if (Math.abs(b) > 0.01 || Math.abs(c) > 0.01 || a <= 0) {
          rotatedDropped++;
          continue;
        }
        const w = typeof it.width === "number" ? it.width : 0;
        // 2-pt Y bucket: Synchro rows are ≥ 10 pt apart.
        const yKey = Math.round(f / 2) * 2;
        const arr = byY.get(yKey) ?? [];
        arr.push({ str: it.str, x0: e, xc: e + w / 2 });
        byY.set(yKey, arr);
      }
      const lines: Line[] = Array.from(byY.entries())
        .sort((l, r) => r[0] - l[0]) // PDF y grows upward → top first
        .map(([y, items]) => {
          items.sort((l, r) => l.x0 - r.x0);
          return { y, items, text: items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim() };
        });
      pages.push(lines);
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return { pages, rotatedDropped };
}

// ---------------------------------------------------------------------------
// Page classification + table parsing
// ---------------------------------------------------------------------------

type BlockKind = "lvt" | "timings" | "queues" | "hcm_signalized" | "hcm_unsignalized" | "hcm_roundabout";

/** Volume priority when several pages describe one intersection: raw-vph
 *  blocks beat HCM (whose volumes are the same input, but LVT/Timings are
 *  the canonical print of the modeler's entered counts). */
const BLOCK_VOLUME_PRIORITY: Record<BlockKind, number> = {
  lvt: 4, timings: 3, hcm_signalized: 2, hcm_unsignalized: 2, hcm_roundabout: 1, queues: 0,
};

function classifyBlock(title: string): BlockKind | null {
  const t = title.trim();
  if (/^lanes, volumes, timings/i.test(t)) return "lvt";
  if (/^timings$/i.test(t)) return "timings";
  if (/^queues$/i.test(t)) return "queues";
  if (/^hcm\b.*signalized intersection/i.test(t)) return "hcm_signalized";
  if (/^hcm\b.*(twsc|awsc|unsignalized|two-?way stop|all-?way stop)/i.test(t)) return "hcm_unsignalized";
  if (/^hcm\b.*roundabout/i.test(t)) return "hcm_roundabout";
  return null;
}

type PageBlock = {
  kind: BlockKind;
  intId: number;
  name: string;
  scenario: string;
  volumes: Partial<Record<UtdfMovement, number>>;
  phf: Partial<Record<UtdfMovement, number>>;
  heavyVehiclesPct: Partial<Record<UtdfMovement, number>>;
  storageFt: Partial<Record<UtdfMovement, number>>;
  cycleLengthS?: number;
  unmappedCols: string[];
  unmappedVph: number;
  warnings: string[];
};

const NUM_RE = /^[-+]?\d+(?:\.\d+)?$/;
const num = (s: string): number | undefined => {
  const t = s.trim();
  if (!NUM_RE.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

/** Row labels we consume, per target field. Synchro varies the wording by
 *  block style; all observed variants are listed. Rows NOT listed here are
 *  simply other report content — they are not "skipped sections" (the page
 *  as a whole is the unit of coverage). */
const ROW_LABELS: Array<{ field: "volumes" | "phf" | "hv" | "storage"; re: RegExp }> = [
  { field: "volumes", re: /^traffic volume \(vph\)$/i },
  { field: "volumes", re: /^traffic volume \(veh\/h\)$/i },
  { field: "volumes", re: /^traffic vol, veh\/h$/i },
  { field: "phf", re: /^peak hour factor$/i },
  { field: "hv", re: /^heavy vehicles \(%\)$/i },
  { field: "hv", re: /^percent heavy veh, %$/i },
  { field: "hv", re: /^heavy vehicles, %$/i },
  { field: "storage", re: /^storage length \(ft\)$/i },
  { field: "storage", re: /^storage length$/i },
  { field: "storage", re: /^turn bay length \(ft\)$/i },
];

/**
 * Parse one classified page into a PageBlock, or null (with a reason pushed
 * to `warnings`) when the page has no usable table.
 */
function parseBlockPage(lines: Line[], kind: BlockKind, warnings: string[]): PageBlock | null {
  const titleIdx = 0;
  // Intersection line: "12: Main St & First Ave" within the lines just
  // after the title.
  let intId: number | undefined;
  let name = "";
  for (let i = titleIdx + 1; i < Math.min(lines.length, titleIdx + 6); i++) {
    const m = lines[i]!.text.match(/^(\d+)\s*:\s*(.+)$/);
    if (m) {
      intId = Number(m[1]);
      name = m[2]!.trim();
      break;
    }
  }
  if (intId === undefined || name.length === 0) {
    warnings.push(
      `Synchro "${lines[titleIdx]?.text ?? kind}" page has no "<id>: <cross streets>" line — page skipped`,
    );
    return null;
  }

  // Scenario footer: the bottom-most line containing "Synchro N Report".
  let scenario = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]!.text;
    const m = t.match(/^(.*?)\s*Synchro(?:\s+\d+)?\s+Report\b/i);
    if (m) {
      scenario = (m[1] ?? "").trim();
      break;
    }
  }

  // Header row: first item "Lane Group" or "Movement"; the REMAINING items
  // are the column labels with their x-centers.
  let colLabels: Array<{ label: string; xc: number }> | undefined;
  let headerEndX = 0;
  for (const line of lines) {
    const first = line.items[0]!;
    if (/^(lane group|movement)$/i.test(first.str.trim()) && line.items.length >= 3) {
      colLabels = line.items.slice(1).map((i) => ({ label: i.str.trim(), xc: i.xc }));
      headerEndX = Math.min(...colLabels.map((c) => c.xc));
      break;
    }
  }
  if (!colLabels || colLabels.length === 0) {
    warnings.push(
      `${intId}: ${name} — "${lines[titleIdx]!.text}" page has no Lane Group/Movement header row — page skipped`,
    );
    return null;
  }

  // Column classification via the shared UTDF movement classifier: standard
  // 12 movements, U-turn folds, and unmappable diagonal legs (SEL/NWT/…).
  const cols = movementColumns(colLabels.map((c) => c.label));
  const colX = colLabels.map((c) => c.xc);
  const minGap = colX.length > 1
    ? Math.min(...colX.slice(1).map((x, i) => x - colX[i]!))
    : 40;
  const tol = Math.max(8, minGap / 2);
  // Cells left of (first column − a gap) are row-label text, not values.
  const labelBoundary = headerEndX - Math.max(20, minGap * 0.75);

  const block: PageBlock = {
    kind, intId, name, scenario,
    volumes: {}, phf: {}, heavyVehiclesPct: {}, storageFt: {},
    unmappedCols: [], unmappedVph: 0, warnings: [],
  };

  const assignRow = (line: Line): { byCol: Map<number, number>; label: string } => {
    const labelParts: string[] = [];
    const byCol = new Map<number, number>();
    for (const item of line.items) {
      if (item.xc < labelBoundary || item.x0 < labelBoundary - 10) {
        labelParts.push(item.str);
        continue;
      }
      const v = num(item.str);
      if (v === undefined) continue; // "-", "None", "Free" — not a value
      let best = -1;
      let bestD = Infinity;
      for (let ci = 0; ci < colX.length; ci++) {
        const d = Math.abs(item.xc - colX[ci]!);
        if (d < bestD) { bestD = d; best = ci; }
      }
      if (best >= 0 && bestD <= tol && !byCol.has(best)) byCol.set(best, v);
    }
    return { byCol, label: labelParts.join(" ").replace(/\s+/g, " ").trim() };
  };

  const seenFields = new Set<string>();
  for (const line of lines) {
    // Cycle length rides the Intersection Summary prose, not the table.
    const cyc = line.text.match(/^Cycle Length:\s*(\d+(?:\.\d+)?)/i);
    if (cyc && block.cycleLengthS === undefined) {
      block.cycleLengthS = Number(cyc[1]);
      continue;
    }
    const { byCol, label } = assignRow(line);
    if (byCol.size === 0 || label.length === 0) continue;
    const row = ROW_LABELS.find((r) => r.re.test(label));
    if (!row || seenFields.has(row.field)) continue;
    seenFields.add(row.field);
    for (const [ci, vRaw] of byCol) {
      const colLabel = colLabels[ci]!.label;
      const std = cols.std.find((s) => s.idx === ci);
      const ut = cols.uturns.find((u) => u.idx === ci);
      let v = vRaw;
      if (row.field === "phf" && v > 1.5 && v <= 100) v = v / 100; // TWSC prints "92"
      if (std) {
        const mv = std.mv;
        if (row.field === "volumes") block.volumes[mv] = v;
        else if (row.field === "phf") block.phf[mv] = v;
        else if (row.field === "hv") block.heavyVehiclesPct[mv] = v;
        else if (row.field === "storage" && v > 0) block.storageFt[mv] = v;
      } else if (ut && row.field === "volumes" && v > 0) {
        // U-turn volumes fold into the corresponding left (engine convention).
        block.volumes[ut.foldInto] = (block.volumes[ut.foldInto] ?? 0) + v;
        block.warnings.push(
          `${intId}: ${name} — U-turn column ${ut.label} folded into ${ut.foldInto} (engine convention)`,
        );
      } else if (cols.unmapped.includes(colLabel.toUpperCase()) && row.field === "volumes") {
        block.unmappedVph += v;
      }
    }
  }
  block.unmappedCols = cols.unmapped;
  return block;
}

// ---------------------------------------------------------------------------
// Scenario grouping + document assembly
// ---------------------------------------------------------------------------

/** PM beats AM (the engine anchors measured volumes at the PM peak);
 *  "existing" beats build/mitigation scenarios; earlier page order breaks
 *  the remaining ties. */
function scenarioScore(label: string): number {
  let s = 0;
  if (/\bpm\b/i.test(label)) s += 2;
  if (/exist/i.test(label)) s += 1;
  return s;
}

export async function parseSynchroPdf(data: Uint8Array): Promise<SynchroPdfParseResult> {
  const doc: UtdfDocument = {
    network: {}, nodes: [], volumes: [], lanes: [], timings: [], warnings: [],
  };

  let pages: Line[][];
  let rotatedDropped = 0;
  try {
    const extracted = await extractPages(data);
    pages = extracted.pages;
    rotatedDropped = extracted.rotatedDropped;
  } catch (e) {
    const pageLimit = (e as { pageLimit?: number } | null)?.pageLimit;
    doc.warnings.push(
      `could not read the PDF (${e instanceof Error ? e.message : String(e)}) — nothing imported`,
    );
    return {
      doc, pageCount: pageLimit ?? 0, synchroPages: 0, scenariosSkipped: [],
      ...(pageLimit !== undefined ? { pageLimitExceeded: pageLimit } : {}),
    };
  }

  const blocks: PageBlock[] = [];
  const unrecognizedTitles = new Map<string, number>();
  for (const lines of pages) {
    if (lines.length === 0) continue;
    const title = lines[0]!.text;
    const kind = classifyBlock(title);
    if (!kind) {
      const key = title.slice(0, 60);
      unrecognizedTitles.set(key, (unrecognizedTitles.get(key) ?? 0) + 1);
      continue;
    }
    const b = parseBlockPage(lines, kind, doc.warnings);
    if (b) blocks.push(b);
  }

  if (rotatedDropped > 0) {
    doc.warnings.push(
      `${rotatedDropped} rotated text run(s) (watermark/stamp) ignored during extraction`,
    );
  }
  if (blocks.length === 0) {
    doc.warnings.push(
      `no Synchro report blocks recognized in ${pages.length} page(s) — is this a Synchro report PDF? ` +
      `(recognized page titles: Timings, Queues, Lanes/Volumes/Timings, HCM signalized/unsignalized summaries)`,
    );
    return { doc, pageCount: pages.length, synchroPages: 0, scenariosSkipped: [] };
  }

  // Group by scenario label, pick ONE (PM preferred), name what's skipped.
  const byScenario = new Map<string, PageBlock[]>();
  for (const b of blocks) {
    const arr = byScenario.get(b.scenario) ?? [];
    arr.push(b);
    byScenario.set(b.scenario, arr);
  }
  const scenarios = Array.from(byScenario.keys());
  let chosen = scenarios[0]!;
  for (const s of scenarios) {
    if (scenarioScore(s) > scenarioScore(chosen)) chosen = s;
  }
  const scenariosSkipped = scenarios.filter((s) => s !== chosen);
  if (scenariosSkipped.length > 0) {
    const skippedDesc = scenariosSkipped
      .map((s) => {
        const bs = byScenario.get(s)!;
        const names = Array.from(new Set(bs.map((b) => `${b.intId}: ${b.name}`)));
        return `"${s || "(unlabeled)"}" (${names.length} intersection(s): ${names.slice(0, 6).join("; ")}${names.length > 6 ? "; …" : ""})`;
      })
      .join(", ");
    doc.warnings.push(
      `report contains ${scenarios.length} analysis scenarios — imported "${chosen || "(unlabeled)"}" (PM preferred); ` +
      `skipped ${skippedDesc}. To import a different scenario, print just that scenario's pages to a PDF.`,
    );
  }

  // Merge the chosen scenario's pages per intersection, volume rows by block
  // priority, other fields first-nonempty in priority order.
  const chosenBlocks = byScenario.get(chosen)!;
  const byInt = new Map<number, PageBlock[]>();
  for (const b of chosenBlocks) {
    const arr = byInt.get(b.intId) ?? [];
    arr.push(b);
    byInt.set(b.intId, arr);
  }

  for (const [intId, bs] of Array.from(byInt.entries()).sort((a, z) => a[0] - z[0])) {
    bs.sort((a, z) => BLOCK_VOLUME_PRIORITY[z.kind] - BLOCK_VOLUME_PRIORITY[a.kind]);
    const name = bs[0]!.name;
    doc.nodes.push({ intId, name });
    for (const b of bs) doc.warnings.push(...b.warnings);

    const pick = <K extends "volumes" | "phf" | "heavyVehiclesPct" | "storageFt">(
      field: K,
    ): PageBlock[K] | undefined =>
      bs.map((b) => b[field]).find((rec) => Object.keys(rec).length > 0);

    const volumes = pick("volumes");
    const phf = pick("phf");
    const hv = pick("heavyVehiclesPct");
    const storage = pick("storageFt");
    const cycle = bs.map((b) => b.cycleLengthS).find((c) => c !== undefined);

    // Diagonal-leg disclosure follows the utdf-import wording: name the
    // columns AND the vehicles at stake.
    const unmapped = bs.find((b) => b.unmappedCols.length > 0);
    if (unmapped) {
      const vph = Math.round(Math.max(...bs.map((b) => b.unmappedVph)));
      doc.warnings.push(
        `${intId}: ${name} — ${unmapped.unmappedCols.length} movement column(s) not mappable to a 4-leg model ` +
        `(${unmapped.unmappedCols.join(", ")}) — ${vph} vph NOT imported. Diagonal approaches need manual entry.`,
      );
    }

    if (volumes && Object.keys(volumes).length > 0) {
      doc.volumes.push({
        intId,
        movements: volumes,
        ...(phf && Object.keys(phf).length > 0 ? { phf } : {}),
        ...(hv && Object.keys(hv).length > 0 ? { heavyVehiclesPct: hv } : {}),
      });
    } else {
      const kinds = Array.from(new Set(bs.map((b) => b.kind))).join(", ");
      doc.warnings.push(
        `${intId}: ${name} — no importable Traffic Volume row on its page(s) (${kinds})` +
        (bs.some((b) => b.kind === "queues")
          ? " — the Queues page's Lane Group Flow is PHF-adjusted flow, deliberately not imported as a count"
          : "") +
        " — intersection carries no measured volumes",
      );
    }
    if (storage && Object.keys(storage).length > 0) {
      doc.lanes.push({
        intId,
        movements: Object.fromEntries(
          Object.entries(storage).map(([mv, ft]) => [mv, { storageFt: ft }]),
        ),
      });
    }
    if (cycle !== undefined) {
      doc.timings.push({ intId, cycleLengthS: cycle, phases: [] });
    }
  }

  if (unrecognizedTitles.size > 0) {
    const parts = Array.from(unrecognizedTitles.entries())
      .slice(0, 8)
      .map(([t, n]) => `"${t}" ×${n}`);
    doc.warnings.push(
      `${Array.from(unrecognizedTitles.values()).reduce((a, b) => a + b, 0)} page(s) were not Synchro report blocks and were skipped (${parts.join(", ")}${unrecognizedTitles.size > 8 ? ", …" : ""})`,
    );
  }

  return {
    doc,
    pageCount: pages.length,
    synchroPages: blocks.length,
    scenarioUsed: chosen,
    scenariosSkipped,
  };
}
