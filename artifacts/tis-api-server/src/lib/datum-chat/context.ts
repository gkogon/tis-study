/**
 * What Datum answers from: the grounding pack the server builds for each
 * engineer message, and the reader behind the read-only `read_study_path` tool.
 *
 * Pure, like lib/proofread/: no db, logger, fetch or SDK, importable under
 * plain `node`. The caller (the store) hands over the study's saved request
 * and result and the findings this user may see; nothing here fetches either.
 *
 * The pack is text, in six sections, in this order:
 *   1. Focused finding      the one the engineer clicked "Ask about this" on, in full
 *   2. Clause guide entry   why that finding's clause fires and what clears it
 *   3. Values at the read paths   what the study holds now at each path the finding read
 *   4. Other findings       one line each
 *   5. Request              the saved inputs, large lists replaced by counts
 *   6. Result summary       rows over the v/c ceiling, growth, pass-by, coverage, DOT, periods
 * With no finding in focus, sections 1 to 3 are not there and section 4 is
 * "## Findings".
 *
 * It is capped at DATUM_LIMITS.packBytes. Two things keep it inside the cap:
 * every field and list that is not bounded by nature is clamped as it goes in,
 * and `trimSections` cuts from the end, by whole sections and then by whole
 * lines, if the clamps were not enough. A section is a list of units, and a
 * unit is one line or one whole fenced block, so a cut can never land inside
 * a JSON value. The focused finding is never cut away.
 *
 * Two properties are load-bearing:
 *   - Every fenced block is JSON that parses. The JSON is produced by
 *     JSON.stringify, and a backtick is written as its unicode escape (the same
 *     string once parsed), so no value in a study can end its own block.
 *   - A finding the engineer may not see never reaches the pack. The store
 *     filters; the tripwire below asserts the contract.
 */
import { DATUM_LIMITS } from "./contract.ts";
import { CLAUSE_GUIDE, FIXABLE_MEANING } from "./clause-guide.ts";
import { rowBuckets } from "../proofread/types.ts";
import type { ReadPath, StudyRecord } from "../proofread/types.ts";

/**
 * A finding as the engineer sees it in the panel. There is deliberately no
 * `audience` here: the store drops what the engineer may not see before this
 * type exists.
 */
export type VisibleFinding = {
  id: string;
  clauseId: string;
  type: string;
  title: string;
  detail: string;
  sourceLabel: string;
  readPaths: ReadPath[];
  remedy: string;
};

export type GroundingPack = {
  text: string;
  bytes: number;
  /** The heading of each section the pack holds, in order. */
  sections: string[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The engine's PLAUSIBLE_MAX_INTERSECTION_VC (lib/tis-engine-core/src/signal-delay.ts):
 * no signalized intersection at grade operates above it. Copied, not imported,
 * to keep this module free of the engine; verify-datum-chat.mjs pins the two
 * to the same number.
 */
const VC_CEILING = 2.5;

/**
 * The five scenarios a row carries, by field prefix (`<prefix>Vc`, `<prefix>Los`,
 * `<prefix>DelaySec`). The names are the engine's, and one is historical:
 * `existing*` is the opening-year No-Build, and `current*` is today's counts.
 */
const SCENARIOS = ["current", "existing", "future", "designNoBuild", "designBuild"] as const;

/** The one clause the chat never sees: a DEFECT for the software team. */
const WITHHELD_CLAUSE = "losMatchesDelay";

const MAX_ROWS_OVER = 20;
const MAX_READ_PATHS = 100;
const MAX_OTHER_FINDINGS = 60;
/** A request field whose JSON is longer than this is replaced by a count or a size. */
const MAX_REQUEST_FIELD_JSON = 1500;
/** A value shown beside a read path: longer than this and it is clipped, or named by its size. */
const MAX_PATH_VALUE = 300;
/** The protected section is never cut below its heading and this many lines. */
const MIN_PROTECTED_UNITS = 3;

const CLIP = { id: 80, clauseId: 80, type: 24, title: 300, sourceLabel: 600, detail: 4000, remedy: 1500, note: 500, line: 200, path: 240, name: 200, growthSource: 1500 } as const;

const TRUNCATED = "…(truncated)";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const byteLength = (s: string): number => encoder.encode(s).length;

// ---------------------------------------------------------------------------
// Reading a path in the stored study
// ---------------------------------------------------------------------------

/**
 * The one path shape: `request` or `result`, then `.name`, `.index` or `[index]`
 * segments. Names are word characters only, so nothing here can express an
 * expression, a method call or a parent.
 */
const PATH = /^(request|result)((?:\.\w+|\[\d+\])+)$/;
const SEGMENT = /\.(\w+)|\[(\d+)\]/g;

type Hit = { found: true; value: unknown } | { found: false };
const MISS: Hit = { found: false };

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object";
const asObject = (v: unknown): Record<string, unknown> => (isObject(v) && !Array.isArray(v) ? v : {});

/**
 * Walk a path through the saved request or result. Only a record's own keys are
 * followed (never the prototype chain), an array is entered by index, and a
 * string is not entered at all, so the answer is always data the study holds.
 *
 * One member that is not an own key is allowed: a final `.length` on an array.
 * The clauses cite it as a count they read (result.findings.length,
 * result.periodReports.length, result.affectedIntersections.length), and
 * lib/proofread resolves it the same way. It is allowed on an array and only
 * last, so it is a number and nothing can be walked on from it.
 */
function lookup(record: { request: unknown; result: unknown }, path: unknown): Hit {
  if (typeof path !== "string") return MISS;
  const m = PATH.exec(path);
  if (!m || !isObject(record)) return MISS;
  let cur: unknown = m[1] === "request" ? record.request : record.result;
  const segments = [...m[2].matchAll(SEGMENT)];
  for (const [i, seg] of segments.entries()) {
    if (!isObject(cur)) return MISS;
    const key = seg[1] ?? seg[2];
    if (Array.isArray(cur)) {
      if (seg[1] === "length" && i === segments.length - 1) return { found: true, value: cur.length };
      if (!/^\d+$/.test(key)) return MISS;
    }
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return MISS;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur === undefined ? MISS : { found: true, value: cur };
}

/** `text` cut to at most `cap` bytes of UTF-8, on a character boundary, ending in the marker. */
function capBytes(text: string, cap: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= cap) return text;
  let end = Math.max(0, cap - byteLength(TRUNCATED));
  // A continuation byte at the cut means the cut is inside a character: back up to where it starts.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return decoder.decode(bytes.subarray(0, end)) + TRUNCATED;
}

/**
 * Read one value from the stored study, for the `read_study_path` tool. The
 * answer is the value as compact JSON, cut to DATUM_LIMITS.readPathBytes bytes
 * (the cut ends in "…(truncated)"), or "(no value at <path>)" when nothing is
 * stored there or the path is not a `request.` / `result.` path. Read-only.
 */
export function readStudyPath(record: { request: unknown; result: unknown }, path: string): string {
  const hit = lookup(record, path);
  const text = hit.found ? JSON.stringify(hit.value) : undefined;
  if (text === undefined) return `(no value at ${clip(String(path), CLIP.path)})`;
  return capBytes(text, DATUM_LIMITS.readPathBytes);
}

// ---------------------------------------------------------------------------
// Text that goes into the pack
// ---------------------------------------------------------------------------

/** `s` cut to `max` characters, on a character boundary, with an ellipsis when it was cut. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Prose from a study or a finding, made safe to sit on one line of the pack:
 * line breaks and control characters become spaces, runs of spaces collapse,
 * and a backtick becomes an apostrophe, so it can never open or close a fence.
 */
function oneLine(v: unknown, max: number): string {
  const s = typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
  return clip(s.replace(/[\u0000-\u001f\u007f`]/g, (c) => (c === "`" ? "'" : " ")).replace(/ {2,}/g, " ").trim(), max);
}

/** A value that fits on one line of this many characters is written on one line. */
const LINE_FITS = 600;

/** A backtick can only be inside a JSON string; its unicode escape is the same string once parsed. */
const noBackticks = (json: string): string => json.replace(/`/g, "\\u0060");

/**
 * JSON for a fenced block: one line for anything short, one entry per line for
 * anything longer, so a list of rows reads as rows. No backtick survives into
 * the text (see noBackticks), so no value can close its own block.
 */
function jsonText(value: unknown, depth = 0): string {
  const flat = JSON.stringify(value);
  if (flat === undefined) return "null";
  if (!isObject(value) || flat.length <= LINE_FITS) return noBackticks(flat);
  const pad = " ".repeat(depth + 1);
  const end = " ".repeat(depth);
  if (Array.isArray(value)) return `[\n${value.map((x) => pad + jsonText(x, depth + 1)).join(",\n")}\n${end}]`;
  const entries = Object.entries(value).filter(([, x]) => x !== undefined);
  return `{\n${entries.map(([k, x]) => `${pad}${noBackticks(JSON.stringify(k))}: ${jsonText(x, depth + 1)}`).join(",\n")}\n${end}}`;
}

const fence = (json: string): string => `\`\`\`json\n${json}\n\`\`\``;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const jsonLength = (v: unknown): number => JSON.stringify(v)?.length ?? 0;
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A value shown beside a read path: kept when small, otherwise clipped or named by its size. */
function shrinkValue(v: unknown): unknown {
  if (typeof v === "string") return clip(v, MAX_PATH_VALUE);
  if (isObject(v)) {
    const n = jsonLength(v);
    return n <= MAX_PATH_VALUE ? v : `(${Array.isArray(v) ? `list of ${v.length}` : "object"}, ${n} characters: read it with read_study_path)`;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Sections, rendering and trimming
// ---------------------------------------------------------------------------

/**
 * One section of the pack. `units` are whole lines, or whole fenced blocks
 * (which contain newlines): the smallest thing a cut may remove.
 *   atomic   the section goes whole or not at all (it holds a fenced block, or is one thought)
 *   protect  never removed; shortened by lines only as a last resort (the focused finding)
 *   noun     for a list: what the "(N more <noun> not shown)" line counts
 *   omitted  how many entries of that list are not shown
 */
export type Section = {
  heading: string;
  units: string[];
  atomic: boolean;
  protect?: boolean;
  noun?: string;
  omitted?: number;
};

const renderSection = (s: Section): string =>
  [s.heading, ...s.units, ...(s.noun !== undefined && (s.omitted ?? 0) > 0 ? [`(${s.omitted} more ${s.noun} not shown)`] : [])].join("\n");

export const renderSections = (sections: readonly Section[]): string => sections.map(renderSection).join("\n\n");

/**
 * Cut `sections` to fit `cap` bytes, from the end: a section that holds a fenced
 * block, or is one thought, goes whole; a list loses whole lines from its end
 * (and goes when none are left). The first, protected, section is never removed;
 * if it alone is over the cap it is shortened by whole lines, keeping its
 * heading and first lines. Returns new sections: the input is not changed.
 */
export function trimSections(input: readonly Section[], cap: number): Section[] {
  const secs: Section[] = input.map((s) => ({ ...s, units: [...s.units] }));
  const size = (): number => byteLength(renderSections(secs));
  while (size() > cap && secs.length > 0) {
    const last = secs[secs.length - 1];
    if (last.protect) break;
    if (!last.atomic && last.units.length > 0) {
      last.units.pop();
      last.omitted = (last.omitted ?? 0) + 1;
      if (last.units.length > 0) continue;
    }
    secs.pop();
  }
  const first = secs[0];
  if (first !== undefined && first.protect) {
    while (size() > cap && first.units.length > MIN_PROTECTED_UNITS) first.units.pop();
  }
  return secs;
}

// ---------------------------------------------------------------------------
// The sections' content
// ---------------------------------------------------------------------------

type Decision = { disposition: string; note: string | null; sourceLabel: string | null; at: string | null; time: number };

/** The newest decision recorded on each finding. Rows that are not decisions are ignored; ties keep the first, since the panel's read is newest first. */
function latestDecisions(dispositions: readonly unknown[]): Map<string, Decision> {
  const out = new Map<string, Decision>();
  for (const d of Array.isArray(dispositions) ? dispositions : []) {
    if (!isObject(d) || typeof d.findingId !== "string" || typeof d.disposition !== "string") continue;
    const created = d.createdAt;
    const time = created instanceof Date ? created.getTime() : typeof created === "string" ? Date.parse(created) : Number.NaN;
    const at = created instanceof Date ? (Number.isNaN(time) ? null : created.toISOString()) : typeof created === "string" ? created : null;
    const next: Decision = {
      disposition: d.disposition,
      note: typeof d.note === "string" && d.note.trim() ? d.note : null,
      sourceLabel: typeof d.sourceLabel === "string" && d.sourceLabel.trim() ? d.sourceLabel : null,
      at,
      time,
    };
    const cur = out.get(d.findingId);
    if (cur === undefined || (Number.isNaN(cur.time) && !Number.isNaN(next.time)) || next.time > cur.time) out.set(d.findingId, next);
  }
  return out;
}

const decisionText = (d: Decision | undefined): string =>
  d === undefined
    ? "none recorded"
    : [
        oneLine(d.disposition, CLIP.type),
        d.note ? `note: ${oneLine(d.note, CLIP.note)}` : "",
        d.sourceLabel ? `source: ${oneLine(d.sourceLabel, CLIP.sourceLabel)}` : "",
        d.at ? `recorded ${oneLine(d.at, 40)}` : "",
      ]
        .filter(Boolean)
        .join(" - ");

function focusedSection(f: VisibleFinding, decision: Decision | undefined): Section {
  return {
    heading: "## Focused finding",
    units: [
      `Finding id: ${oneLine(f.id, CLIP.id)}`,
      `Clause: ${oneLine(f.clauseId, CLIP.clauseId)}`,
      `Type: ${oneLine(f.type, CLIP.type)}`,
      `Title: ${oneLine(f.title, CLIP.title)}`,
      `Source: ${oneLine(f.sourceLabel, CLIP.sourceLabel)}`,
      `Detail: ${oneLine(f.detail, CLIP.detail)}`,
      `Remedy: ${oneLine(f.remedy, CLIP.remedy)}`,
      `Decision: ${decisionText(decision)}`,
    ],
    atomic: false,
    protect: true,
  };
}

function guideSection(clauseId: string): Section | null {
  const g = Object.prototype.hasOwnProperty.call(CLAUSE_GUIDE, clauseId) ? CLAUSE_GUIDE[clauseId] : undefined;
  if (g === undefined) return null;
  return {
    heading: "## Clause guide entry",
    units: [
      `Clause: ${clauseId}`,
      `Why it fires: ${g.why}`,
      `What clears it: ${g.clears}`,
      `Inputs that matter: ${g.inputs.length > 0 ? g.inputs.join(", ") : "none (no request field causes or clears it)"}`,
      `Fixability: ${g.fixable} - ${FIXABLE_MEANING[g.fixable]}`,
    ],
    atomic: true,
  };
}

function readPathsSection(f: VisibleFinding, rec: { request: unknown; result: unknown }): Section | null {
  const paths = (Array.isArray(f.readPaths) ? f.readPaths : []).filter((p): p is ReadPath => isObject(p) && typeof p.path === "string");
  if (paths.length === 0) return null;
  const shown = paths.slice(0, MAX_READ_PATHS);
  const items = shown.map((rp) => {
    const hit = lookup(rec, rp.path);
    const recorded = shrinkValue(rp.value);
    const item: Record<string, unknown> = { path: clip(rp.path, CLIP.path), value: hit.found ? shrinkValue(hit.value) : null };
    if (!hit.found) {
      item.recorded = recorded;
      item.note = "no value stored at this path";
    } else if (!sameJson(shrinkValue(hit.value), recorded)) {
      item.recorded = recorded;
    }
    return item;
  });
  const more = paths.length > shown.length ? ` Showing the first ${shown.length} of ${paths.length}.` : "";
  return {
    heading: "## Values at the read paths",
    units: [
      `The value the study holds now at each path this finding read ("value"), and what the check saw ("recorded") where the two differ.${more} Read any other path with read_study_path.`,
      fence(jsonText(items)),
    ],
    atomic: true,
  };
}

function otherFindingsSection(heading: string, others: readonly VisibleFinding[], decisions: Map<string, Decision>): Section {
  const shown = others.slice(0, MAX_OTHER_FINDINGS);
  const lines = shown.map((f) => {
    const d = decisions.get(f.id);
    return `- ${oneLine(f.id, CLIP.id)} | ${oneLine(f.clauseId, CLIP.clauseId)} | ${oneLine(f.type, CLIP.type)} | ${oneLine(f.title, CLIP.line)}${d ? ` | decision: ${oneLine(d.disposition, CLIP.type)}` : ""}`;
  });
  return {
    heading,
    units: lines.length > 0 ? lines : ["(no findings are visible for this study)"],
    atomic: false,
    noun: "findings",
    omitted: others.length - shown.length,
  };
}

/** The request with its large lists named by count and size, not copied. */
function requestSection(request: Record<string, unknown>): Section {
  const summary: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(request)) {
    if (v === undefined) continue;
    let value: unknown = v;
    if (key === "utdfIntersections" || key === "driveways" || key === "tripProfile") {
      if (Array.isArray(v)) value = { count: v.length };
      else if (isObject(v)) value = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) ? { count: x.length } : x]));
    }
    if (jsonLength(value) > MAX_REQUEST_FIELD_JSON) {
      value = Array.isArray(value) ? { count: value.length } : typeof value === "string" ? { chars: value.length } : isObject(value) ? { keys: Object.keys(value).length, characters: jsonLength(value) } : value;
    }
    summary[key] = value;
  }
  return {
    heading: "## Request",
    units: [
      "The study's saved inputs. A list or object too large to include is replaced by a count or a size; read any of it with read_study_path, for example request.utdfIntersections[0].",
      fence(jsonText(summary)),
    ],
    atomic: true,
  };
}

type RowOver = { name: string; period: string; path: string; over: { scenario: string; vc: number; los: string | null; delaySec: number | null }[] };

function resultSection(request: Record<string, unknown>, result: Record<string, unknown>): Section {
  const rec = { request, result } as unknown as StudyRecord;
  const rows: RowOver[] = [];
  for (const b of rowBuckets(rec)) {
    b.rows.forEach((row, i) => {
      const over = SCENARIOS.flatMap((scenario) => {
        const vc = row?.[`${scenario}Vc`];
        if (!finite(vc) || vc <= VC_CEILING) return [];
        const los = row?.[`${scenario}Los`];
        const delay = row?.[`${scenario}DelaySec`];
        return [{ scenario, vc, los: typeof los === "string" ? los : null, delaySec: finite(delay) ? delay : null }];
      }).sort((a, b2) => b2.vc - a.vc);
      if (over.length > 0) rows.push({ name: oneLine(row?.name, CLIP.name), period: b.period, path: `${b.at}[${i}]`, over });
    });
  }
  rows.sort((a, b) => b.over[0].vc - a.over[0].vc);
  const shown = rows.slice(0, MAX_ROWS_OVER);

  const reports = Array.isArray(result.periodReports) ? (result.periodReports as unknown[]) : [];
  const periods = reports.filter(isObject).map((p) => ({
    period: typeof p.period === "string" ? p.period : null,
    intersectionRows: Array.isArray(p.affectedIntersections) ? p.affectedIntersections.length : null,
    intersectionsWithLosDrop: finite(p.intersectionsWithLosDrop) ? p.intersectionsWithLosDrop : null,
    intersectionsAtLosEf: finite(p.intersectionsAtLosEf) ? p.intersectionsAtLosEf : null,
    worstDelayDeltaSec: finite(p.worstDelayDeltaSec) ? p.worstDelayDeltaSec : null,
  }));

  const num = (k: string): number | undefined => (finite(result[k]) ? (result[k] as number) : undefined);
  const jurisdiction = asObject(result.jurisdiction);
  const summary = {
    vcCeiling: VC_CEILING,
    rowsOverCeiling: { count: rows.length, shown: shown.length, rows: shown },
    growthSource: typeof result.growthSource === "string" ? oneLine(result.growthSource, CLIP.growthSource) : undefined,
    growthAppliedPct: num("growthAppliedPct"),
    growthYears: num("growthYears"),
    designYear: num("designYear"),
    passByPctApplied: num("passByPctApplied"),
    internalCapturePctApplied: num("internalCapturePctApplied"),
    coverage: {
      intersectionsInStudyArea: num("intersectionsInStudyArea"),
      intersectionsStudied: num("intersectionsStudied"),
      intersectionsMergedAsDuplicates: num("intersectionsMergedAsDuplicates"),
      intersectionsWithLosDrop: num("intersectionsWithLosDrop"),
      intersectionsAtLosEf: num("intersectionsAtLosEf"),
    },
    jurisdiction: { dotName: typeof jurisdiction.dotName === "string" ? oneLine(jurisdiction.dotName, CLIP.name) : undefined },
    regionCode: typeof result.regionCode === "string" ? oneLine(result.regionCode, CLIP.name) : undefined,
    periods,
  };
  return {
    heading: "## Result summary",
    units: [
      `Scenario keys: current = counts today with no growth; existing = opening-year No-Build (the field name is historical); future = opening-year Build; designNoBuild and designBuild = the design year. v/c ceiling ${VC_CEILING}. Rows over it are listed worst first, and each path reads back its row.`,
      fence(jsonText(summary)),
    ],
    atomic: true,
  };
}

// ---------------------------------------------------------------------------
// The pack
// ---------------------------------------------------------------------------

/**
 * Build the grounding pack for one engineer message.
 *
 * `findings` are the findings this engineer may see, and `dispositions` are the
 * decisions recorded on them (newest decision per finding is used). A finding
 * that carries `audience: "admin"` throws "withheld finding passed to pack":
 * the store filters before calling, and this asserts that it did.
 *
 * `maxBytes` defaults to DATUM_LIMITS.packBytes. It is a parameter only so the
 * check can exercise the trimming at smaller caps.
 */
export function buildGroundingPack(
  args: { request: unknown; result: unknown; findings: VisibleFinding[]; dispositions: unknown[]; focusFindingId?: string },
  maxBytes: number = DATUM_LIMITS.packBytes,
): GroundingPack {
  const findings = args.findings;
  for (const f of findings) {
    // VisibleFinding has no audience field; a row from the store can still carry one.
    if ((f as { audience?: string }).audience === "admin" || f.clauseId === WITHHELD_CLAUSE) throw new Error("withheld finding passed to pack");
  }
  const request = asObject(args.request);
  const result = asObject(args.result);
  const decisions = latestDecisions(args.dispositions);
  const focused = typeof args.focusFindingId === "string" ? findings.find((f) => f.id === args.focusFindingId) : undefined;
  const others = focused ? findings.filter((f) => f !== focused) : findings;

  const sections: Section[] = [];
  if (focused) {
    sections.push(focusedSection(focused, decisions.get(focused.id)));
    const guide = guideSection(focused.clauseId);
    if (guide) sections.push(guide);
    const values = readPathsSection(focused, { request, result });
    if (values) sections.push(values);
  }
  if (!focused || others.length > 0) sections.push(otherFindingsSection(focused ? "## Other findings" : "## Findings", others, decisions));
  sections.push(requestSection(request));
  sections.push(resultSection(request, result));

  const kept = trimSections(sections, maxBytes);
  const text = renderSections(kept);
  return { text, bytes: byteLength(text), sections: kept.map((s) => s.heading) };
}
