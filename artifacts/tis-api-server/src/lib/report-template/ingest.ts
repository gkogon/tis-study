/**
 * Template ingestion — turn a firm's example report PDF into a JSON
 * `ReportTemplate` the registry can load. This is the "import any template"
 * capability: instead of hand-coding a renderer for each firm's format, point
 * the ingester at one of their filed reports and it derives the structure
 * (chapters / sections), maps recognised figures/tables to providers, and emits
 * a spec a study renders into.
 *
 * V1 is heuristic and offline: it extracts the document's heading outline and
 * figure captions from the PDF text layer, maps known captions to providers,
 * and seeds every section with an editable prose placeholder. Branding (palette,
 * cover, firm name) is supplied by the caller (or defaults to a neutral brand);
 * colour auto-extraction from the cover is a later enhancement. The output is a
 * starting point a human refines — not a pixel-perfect clone — which is exactly
 * how importing a new firm should work.
 */
import { execFileSync } from "node:child_process";
import type { Block, Brand, Chapter, ReportTemplate, Section } from "./engine";
import { validateTemplate } from "./registry";
import { extractBrand } from "./pdf-assets";

export type IngestOptions = {
  /** Template id (defaults to a slug of the document type). */
  id?: string;
  /** Display name. */
  name?: string;
  /** Cover label; auto-detected from the cover when omitted. */
  documentType?: string;
  /** Firm name for branding (defaults to "{{firm.name}}"). */
  firmName?: string;
  /** Brand override; a neutral brand is used otherwise. */
  brand?: Partial<Brand>;
};

const NEUTRAL_BRAND: Brand = {
  firmName: "{{firm.name}}",
  palette: {
    primary: "#2b3a55",
    onPrimary: "#ffffff",
    accent: "#4a6fa5",
    text: "#1a1a1a",
    muted: "#6b7280",
    tableHeader: "#eef1f6",
    rule: "#d8dee6",
  },
  cover: { style: "band" },
  footer: "{{firm.name}}  ·  {{project.projectName}}  ·  Page {{page}}",
  docControl: false,
};

/** Map a figure/table caption to a provider id, or null when unrecognised. */
export function mapCaptionToBlock(caption: string): Block | null {
  const c = caption.toLowerCase();
  if (/start time|inbound.*outbound|outbound.*inbound|trips by hour/.test(c))
    return { kind: "chart", provider: "diurnalColumn" };
  if (/accumulation|person.*profile|occupancy profile/.test(c))
    return { kind: "chart", provider: "diurnalLine" };
  if (/trip generation|trip gen/.test(c)) return { kind: "table", provider: "tripGenSummary" };
  if (/distribution|assignment/.test(c)) return { kind: "table", provider: "tripDistribution" };
  if (/capacity|degree of saturation|level of service|\blos\b/.test(c))
    return { kind: "table", provider: "ukCapacity" };
  return null;
}

/** Skip dotted ToC lines, figure/table-list lines, footers and page numbers. */
function isNoise(l: string): boolean {
  if (!l) return false;
  if (/\.{4,}\s*\d+\s*$/.test(l)) return true; // ToC dot leaders
  if (/^(figure|table)\b/i.test(l)) return true; // figure/table captions + lists
  if (/^\d{1,4}$/.test(l)) return true; // bare page number
  if (/\bpage\s+\d+\b/i.test(l) && l.includes("|")) return true; // running footer
  if ((l.match(/\|/g)?.length ?? 0) >= 2) return true; // pipe-delimited footer/header
  return false;
}

/** Join captured body lines into clean paragraphs (verbatim, capped for length). */
function cleanProse(buf: string[], maxChars = 1400): string {
  const paras: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    const p = cur.join(" ").replace(/\s+/g, " ").trim();
    // Drop flattened-table run-on text: pdftotext -layout collapses a source
    // table into a number-heavy paragraph. Capturing it as prose produces an
    // illegible run-on, so skip paragraphs that are mostly numeric tokens.
    const toks = p.split(" ").filter(Boolean);
    const numeric = toks.filter((t) => /^[\d.,%()/+-]+$/.test(t)).length;
    const tableLike = toks.length > 8 && numeric / toks.length > 0.45;
    if (p.length >= 24 && !tableLike) paras.push(p);
    cur = [];
  };
  for (const l of buf) {
    if (!l.trim()) flush();
    else cur.push(l.trim());
  }
  flush();
  let out = "";
  for (const p of paras) {
    if (out.length + p.length > maxChars) break;
    out += (out ? "\n\n" : "") + p;
  }
  return out;
}

/**
 * Extract the heading outline (chapters → sections) AND the verbatim body text
 * under each section, so an imported template carries the firm's own words.
 */
export function parseOutline(text: string): Chapter[] {
  const lines = text.split(/\r?\n/);
  const chapters: Chapter[] = [];
  const byNum = new Map<string, Chapter>();

  // "2 TRANSPORT PLANNING FOR PEOPLE" / "3.0 SITE AND SURROUNDINGS"
  const chapRe = /^\s*(\d{1,2})(?:\.0)?[ \t]+([A-Z][A-Z0-9 ,&/'’()-]{4,60})\s*$/;
  // "N.M Title" with a normal-case title (not a 3-part body-paragraph number).
  const secRe = /^\s*(\d{1,2})\.(\d{1,2})(?!\.\d)[ \t]+([A-Za-z][\w ,&/'’()?:–-]{3,70})\s*$/;
  const MAX_CHAPTER = 12;

  const ensureChapter = (num: string, title: string): Chapter => {
    let ch = byNum.get(num);
    if (!ch) {
      ch = { number: `${num}.0`, title: titleCase(title), sections: [] };
      byNum.set(num, ch);
      chapters.push(ch);
    }
    return ch;
  };

  let curSection: Section | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (curSection && buf.length) {
      const prose = cleanProse(buf);
      if (prose) curSection.blocks.push({ kind: "prose", text: prose });
    }
    buf = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, " ").trimEnd();
    const cm = line.match(chapRe);
    if (cm && Number(cm[1]) <= MAX_CHAPTER) {
      flush();
      ensureChapter(cm[1], cm[2]);
      curSection = null;
      continue;
    }
    const sm = line.match(secRe);
    if (sm && Number(sm[1]) <= MAX_CHAPTER) {
      flush();
      const ch = ensureChapter(sm[1], `Chapter ${sm[1]}`);
      const number = `${sm[1]}.${sm[2]}`;
      let sec = ch.sections.find((s) => s.number === number);
      if (!sec) {
        sec = { number, title: titleCase(sm[3]), blocks: [] };
        ch.sections.push(sec);
      }
      curSection = sec;
      continue;
    }
    if (curSection && !isNoise(line.trim())) buf.push(line);
  }
  flush();

  chapters.sort((a, b) => parseInt(a.number || "0") - parseInt(b.number || "0"));
  for (const ch of chapters) ch.sections.sort((a, b) => cmpNum(a.number, b.number));
  return chapters.filter((c) => c.sections.length > 0 || /[A-Z]/.test(c.title));
}

/** Extract figure/table captions (e.g. "Figure 2-1: …") for provider mapping. */
export function parseCaptions(text: string): Array<{ section: string; caption: string }> {
  const out: Array<{ section: string; caption: string }> = [];
  const re = /\b(?:Figure|Table)\s+(\d{1,2})[-.](\d{1,2})\s*[:–-]\s*([^\n.]{3,90})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({ section: `${m[1]}`, caption: m[3].trim() });
  }
  return out;
}

function titleCase(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t === t.toUpperCase()) {
    return t
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/\b(And|Or|Of|For|The|To|A|An|In|On)\b/g, (w) => w.toLowerCase());
  }
  return t;
}

function cmpNum(a?: string, b?: string): number {
  const pa = (a ?? "0").split(".").map(Number);
  const pb = (b ?? "0").split(".").map(Number);
  return pa[0] - pb[0] || (pa[1] ?? 0) - (pb[1] ?? 0);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported-template";
}

/** Assemble a ReportTemplate from a parsed outline + captions + options. */
export function buildTemplate(
  outline: Chapter[],
  captions: Array<{ section: string; caption: string }>,
  opts: IngestOptions,
): ReportTemplate {
  const documentType = opts.documentType ?? "Report";
  const brand: Brand = { ...NEUTRAL_BRAND, ...opts.brand, firmName: opts.firmName ?? opts.brand?.firmName ?? NEUTRAL_BRAND.firmName };

  // Group recognised figure blocks by chapter number.
  const blocksByChapter = new Map<string, Block[]>();
  for (const cap of captions) {
    const block = mapCaptionToBlock(cap.caption);
    if (block) {
      const arr = blocksByChapter.get(cap.section) ?? [];
      if (!arr.some((b) => JSON.stringify(b) === JSON.stringify(block))) arr.push(block);
      blocksByChapter.set(cap.section, arr);
    }
  }

  const chapters: Chapter[] = outline.map((ch) => {
    const chapNum = (ch.number ?? "").split(".")[0];
    const mapped = blocksByChapter.get(chapNum) ?? [];
    const sections: Section[] =
      ch.sections.length > 0
        ? ch.sections.map((s, i) => ({
            ...s,
            blocks: [
              ...(s.blocks.length ? s.blocks : [{ kind: "prose", text: `[${s.title} — content from the imported report.]` } as Block]),
              ...(i === 0 ? mapped : []),
            ],
          }))
        : [{ number: "", title: "", blocks: [{ kind: "note", text: `[${ch.title} — section content to be supplied.]` } as Block, ...mapped] }];
    return { number: ch.number, title: ch.title, sections };
  });

  // Every imported report also gets the accuracy + applicable-standards
  // transparency, regardless of the source document's own structure.
  chapters.push({
    number: "",
    title: "Accuracy and Applicable Standards",
    sections: [
      {
        number: "",
        title: "",
        blocks: [
          { kind: "prose", text: "Each component of this study is graded for confidence below. The report is generated to current methodology and prepared for review and seal by a licensed / chartered engineer, who substitutes field-collected data and a calibrated model where a component is marked Medium or Low." },
          { kind: "metrics", provider: "accuracyOverall" },
          { kind: "table", provider: "accuracy" },
          { kind: "table", provider: "regulations" },
          { kind: "keyvalue", provider: "regulationStatus" },
        ] as Block[],
      },
    ],
  });

  const tpl: ReportTemplate = {
    id: opts.id ?? slug(documentType),
    name: opts.name ?? `${documentType} (imported)`,
    documentType,
    brand,
    chapters: chapters.length ? chapters : [{ number: "1", title: "Report", sections: [{ title: "", blocks: [{ kind: "metrics", provider: "headline" }] }] }],
  };
  return validateTemplate(tpl);
}

/** Detect the cover document type — the first prominent ALL-CAPS title line. */
export function detectDocumentType(text: string): string | undefined {
  const head = text.split(/\r?\n/).slice(0, 60).map((l) => l.trim());
  for (const l of head) {
    if (/^(TRANSPORT ASSESSMENT|TRAFFIC IMPACT STUDY|TRANSPORT STATEMENT|TRANSPORT IMPACT ASSESSMENT)$/i.test(l)) return titleCase(l);
  }
  return undefined;
}

/** Ingest raw report text (the pure core — pluggable extractor). */
export function ingestTemplateFromText(text: string, opts: IngestOptions = {}): ReportTemplate {
  const outline = parseOutline(text);
  const captions = parseCaptions(text);
  const documentType = opts.documentType ?? detectDocumentType(text) ?? "Report";
  return buildTemplate(outline, captions, { ...opts, documentType });
}

/**
 * Ingest a PDF file fully: extract the text layer (structure), and the brand
 * (palette + logo) from the document itself, so the imported template comes in
 * auto-branded — "reads the logo and the colours". Any caller-supplied brand
 * fields win over the auto-detected ones.
 */
export function ingestTemplateFromPdf(pdfPath: string, opts: IngestOptions = {}): ReportTemplate {
  let text = "";
  try {
    text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    throw new Error(`Could not extract text from ${pdfPath} (is poppler/pdftotext installed?): ${(e as Error).message}`);
  }
  // Auto-detect brand from the PDF, then layer any explicit overrides on top.
  const autoBrand = extractBrand(pdfPath, { ...NEUTRAL_BRAND, firmName: opts.firmName ?? NEUTRAL_BRAND.firmName });
  const brand: Brand = { ...autoBrand, ...opts.brand, palette: { ...autoBrand.palette, ...opts.brand?.palette } };
  return ingestTemplateFromText(text, { ...opts, brand });
}
