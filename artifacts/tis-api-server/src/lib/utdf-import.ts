/**
 * UTDF (Universal Traffic Data Format) reader — the inverse of utdf-export.ts.
 *
 * Why this exists: a practicing engineer already HAS the three things the
 * screening engine keeps telling them to re-key — measured turning-movement
 * counts, signal timings, and lane geometry — sitting in the Synchro model
 * they built for the same corridor. One UTDF export from Synchro (File →
 * Transfer → Write UTDF) carries all three. Reading it turns the biggest
 * manual-entry time sink into a file drop, and gives the engine measured
 * per-movement volumes where it currently applies a 10/80/10 default split.
 *
 * TWO LAYOUTS EXIST and both must parse:
 *
 *  - "row" layout (what utdf-export.ts emits): one row per intersection,
 *    movements as columns —
 *        [Volumes]
 *        INTID,NBL,NBT,NBR,...
 *        1,12,96,12,...
 *
 *  - "matrix" layout (what Synchro itself writes): RECORDNAME-first, one row
 *    per record type per intersection —
 *        [Volumes]
 *        RECORDNAME,INTID,NBL,NBT,NBR,...
 *        Volume,1,12,96,12,...
 *        PHF,1,0.92,0.92,...
 *
 * The parser detects the layout per section from the header row, so a file
 * that mixes them (Synchro versions differ section-to-section) still reads.
 *
 * Deliberately tolerant: unknown sections and record types are skipped with a
 * warning, not an error — a reviewer's UTDF must never be rejected because
 * Synchro appended a section this parser predates. Anything skipped is
 * NAMED in `warnings` so silence never masquerades as coverage (the road-file
 * parser bug was exactly a silent skip; never again).
 */

/** The twelve standard Synchro movements. */
export const UTDF_MOVEMENTS = [
  "NBL", "NBT", "NBR", "SBL", "SBT", "SBR",
  "EBL", "EBT", "EBR", "WBL", "WBT", "WBR",
] as const;
export type UtdfMovement = (typeof UTDF_MOVEMENTS)[number];

export type UtdfNode = {
  intId: number;
  name: string;
  /** Present when the file carries LATITUDE/LONGITUDE columns (ours does). */
  latitude?: number;
  longitude?: number;
  x?: number;
  y?: number;
  type?: string;
};

export type UtdfVolumes = {
  intId: number;
  /** Vehicles per hour by movement. Only movements present in the file. */
  movements: Partial<Record<UtdfMovement, number>>;
  /** Peak-hour factor by movement, when a PHF record exists (matrix layout). */
  phf?: Partial<Record<UtdfMovement, number>>;
  /** Heavy-vehicle % by movement, when present. */
  heavyVehiclesPct?: Partial<Record<UtdfMovement, number>>;
};

export type UtdfLaneInfo = { lanes?: number; storageFt?: number; widthFt?: number };

export type UtdfLanes = {
  intId: number;
  movements: Partial<Record<UtdfMovement, UtdfLaneInfo>>;
};

export type UtdfPhase = {
  phase: number;
  /** Split (max green) seconds, when derivable. */
  splitS?: number;
  minGreenS?: number;
  yellowS?: number;
  allRedS?: number;
};

export type UtdfTiming = {
  intId: number;
  cycleLengthS?: number;
  offsetS?: number;
  coordinated?: boolean;
  phases: UtdfPhase[];
};

export type UtdfDocument = {
  /** [Network] key/value pairs, verbatim. */
  network: Record<string, string>;
  nodes: UtdfNode[];
  volumes: UtdfVolumes[];
  lanes: UtdfLanes[];
  timings: UtdfTiming[];
  /** Everything skipped or ambiguous — named, never silent. */
  warnings: string[];
};

// ---------------------------------------------------------------------------

type Section = { name: string; header: string[]; rows: string[][] };

/** Split into [Section] blocks; tolerate BOM, CRLF, '#' comments, blank lines. */
function splitSections(text: string): Section[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const sections: Section[] = [];
  let cur: { name: string; raw: string[] } | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("#") || t === "") continue;
    const m = t.match(/^\[([^\]]+)\]$/);
    if (m) {
      if (cur) sections.push(finishSection(cur));
      cur = { name: m[1]!.trim(), raw: [] };
      continue;
    }
    if (cur) cur.raw.push(t);
  }
  if (cur) sections.push(finishSection(cur));
  return sections;
}

function finishSection(cur: { name: string; raw: string[] }): Section {
  const [head, ...rest] = cur.raw;
  return {
    name: cur.name,
    header: head ? splitCsv(head).map((h) => h.trim()) : [],
    rows: rest.map(splitCsv),
  };
}

/** Minimal CSV split honouring double-quoted fields (utdf-export csvEscape). */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Case-insensitive column lookup. */
function col(header: string[], name: string): number {
  const lower = name.toLowerCase();
  return header.findIndex((h) => h.toLowerCase() === lower);
}

function movementColumns(header: string[]): Array<{ idx: number; mv: UtdfMovement }> {
  const out: Array<{ idx: number; mv: UtdfMovement }> = [];
  header.forEach((h, idx) => {
    const u = h.trim().toUpperCase() as UtdfMovement;
    if ((UTDF_MOVEMENTS as readonly string[]).includes(u)) out.push({ idx, mv: u });
  });
  return out;
}

// ---------------------------------------------------------------------------

export function parseUtdf(text: string): UtdfDocument {
  const doc: UtdfDocument = {
    network: {}, nodes: [], volumes: [], lanes: [], timings: [], warnings: [],
  };
  const sections = splitSections(text);
  if (sections.length === 0) {
    doc.warnings.push("no [Section] headers found — not a UTDF file?");
    return doc;
  }

  for (const sec of sections) {
    switch (sec.name.toLowerCase()) {
      case "network": parseNetwork(sec, doc); break;
      case "nodes": parseNodes(sec, doc); break;
      case "volumes": parseVolumes(sec, doc); break;
      case "lanes": parseLanes(sec, doc); break;
      case "timings":
      case "timing": parseTimings(sec, doc); break;
      case "phasing":
      case "phases": break; // ring/barrier structure — nothing we consume yet
      case "links": break;  // geometry we already have from OSM
      default:
        doc.warnings.push(`section [${sec.name}] not understood — skipped (${sec.rows.length} rows)`);
    }
  }
  return doc;
}

function parseNetwork(sec: Section, doc: UtdfDocument): void {
  // Header is RECORDNAME,DATA; rows are key,value.
  for (const r of sec.rows) {
    if (r.length >= 2 && r[0]!.trim() !== "") doc.network[r[0]!.trim()] = r.slice(1).join(",").trim();
  }
}

function parseNodes(sec: Section, doc: UtdfDocument): void {
  const iId = col(sec.header, "INTID");
  if (iId < 0) { doc.warnings.push("[Nodes] missing INTID column — section skipped"); return; }
  const iName = col(sec.header, "Name");
  const iLat = col(sec.header, "LATITUDE");
  const iLon = col(sec.header, "LONGITUDE");
  const iX = col(sec.header, "X"), iY = col(sec.header, "Y");
  const iType = col(sec.header, "TYPE");
  for (const r of sec.rows) {
    const intId = num(r[iId]);
    if (intId === undefined) continue;
    doc.nodes.push({
      intId,
      name: iName >= 0 ? (r[iName] ?? "").trim() : `Node ${intId}`,
      latitude: iLat >= 0 ? num(r[iLat]) : undefined,
      longitude: iLon >= 0 ? num(r[iLon]) : undefined,
      x: iX >= 0 ? num(r[iX]) : undefined,
      y: iY >= 0 ? num(r[iY]) : undefined,
      type: iType >= 0 ? (r[iType] ?? "").trim() : undefined,
    });
  }
}

/** Get (or create) the per-intersection record in an array keyed by intId. */
function slot<T extends { intId: number }>(arr: T[], intId: number, make: (id: number) => T): T {
  let e = arr.find((x) => x.intId === intId);
  if (!e) { e = make(intId); arr.push(e); }
  return e;
}

function parseVolumes(sec: Section, doc: UtdfDocument): void {
  const mvCols = movementColumns(sec.header);
  if (mvCols.length === 0) { doc.warnings.push("[Volumes] has no movement columns — skipped"); return; }
  const iRec = col(sec.header, "RECORDNAME");
  const iId = col(sec.header, "INTID");
  if (iId < 0) { doc.warnings.push("[Volumes] missing INTID column — skipped"); return; }

  for (const r of sec.rows) {
    const intId = num(r[iId]);
    if (intId === undefined) continue;
    const record = iRec >= 0 ? (r[iRec] ?? "").trim().toLowerCase() : "volume";
    const entry = slot(doc.volumes, intId, (id): UtdfVolumes => ({ intId: id, movements: {} }));
    const target =
      record === "volume" ? entry.movements
      : record === "phf" ? (entry.phf ??= {})
      : record === "heavyvehicles" ? (entry.heavyVehiclesPct ??= {})
      : null;
    if (!target) {
      doc.warnings.push(`[Volumes] record "${r[iRec]}" at INTID ${intId} not consumed`);
      continue;
    }
    for (const { idx, mv } of mvCols) {
      const v = num(r[idx]);
      if (v !== undefined) target[mv] = v;
    }
  }
}

function parseLanes(sec: Section, doc: UtdfDocument): void {
  const iId = col(sec.header, "INTID");
  if (iId < 0) { doc.warnings.push("[Lanes] missing INTID column — skipped"); return; }
  const mvCols = movementColumns(sec.header);
  const iRec = col(sec.header, "RECORDNAME");

  if (mvCols.length > 0 && iRec >= 0) {
    // Matrix layout: RECORDNAME,INTID,NBL,... with rows Lanes/Storage/Width/...
    for (const r of sec.rows) {
      const intId = num(r[iId]);
      if (intId === undefined) continue;
      const record = (r[iRec] ?? "").trim().toLowerCase();
      const entry = slot(doc.lanes, intId, (id): UtdfLanes => ({ intId: id, movements: {} }));
      const field: keyof UtdfLaneInfo | null =
        record === "lanes" ? "lanes"
        : record === "storage" ? "storageFt"
        : record === "width" ? "widthFt"
        : null;
      if (!field) continue; // Shared, Grade, Phase1... — real but unconsumed
      for (const { idx, mv } of mvCols) {
        const v = num(r[idx]);
        if (v === undefined) continue;
        const info = (entry.movements[mv] ??= {});
        info[field] = v;
      }
    }
    return;
  }

  // Row layout (our export): INTID,NAME,Lanes,Width,Shared,Storage,...
  const iName = col(sec.header, "NAME");
  const iLanes = col(sec.header, "Lanes");
  const iWidth = col(sec.header, "Width");
  const iStorage = col(sec.header, "Storage");
  if (iName < 0) { doc.warnings.push("[Lanes] layout not recognised — skipped"); return; }
  for (const r of sec.rows) {
    const intId = num(r[iId]);
    const mv = (r[iName] ?? "").trim().toUpperCase() as UtdfMovement;
    if (intId === undefined || !(UTDF_MOVEMENTS as readonly string[]).includes(mv)) continue;
    const entry = slot(doc.lanes, intId, (id): UtdfLanes => ({ intId: id, movements: {} }));
    entry.movements[mv] = {
      lanes: iLanes >= 0 ? num(r[iLanes]) : undefined,
      widthFt: iWidth >= 0 ? num(r[iWidth]) : undefined,
      storageFt: iStorage >= 0 ? num(r[iStorage]) : undefined,
    };
  }
}

function parseTimings(sec: Section, doc: UtdfDocument): void {
  const iId = col(sec.header, "INTID");
  const iPhase = col(sec.header, "Phase");
  if (iId < 0 || iPhase < 0) {
    doc.warnings.push("[Timings] missing INTID/Phase columns — skipped");
    return;
  }
  const iMin = col(sec.header, "MinInitial");
  const iMax = col(sec.header, "MaxInitial");
  const iYellow = col(sec.header, "Yellow");
  const iAllRed = col(sec.header, "AllRed");
  const iCycle = col(sec.header, "CycleLength");
  const iOffset = col(sec.header, "Offset");
  const iCoord = col(sec.header, "Coordinated");

  for (const r of sec.rows) {
    const intId = num(r[iId]);
    const phase = num(r[iPhase]);
    if (intId === undefined || phase === undefined) continue;
    const entry = slot(doc.timings, intId, (id): UtdfTiming => ({ intId: id, phases: [] }));
    if (iCycle >= 0) entry.cycleLengthS ??= num(r[iCycle]);
    if (iOffset >= 0) entry.offsetS ??= num(r[iOffset]);
    if (iCoord >= 0 && entry.coordinated === undefined) {
      const c = (r[iCoord] ?? "").trim().toLowerCase();
      if (c === "yes" || c === "no") entry.coordinated = c === "yes";
    }
    entry.phases.push({
      phase,
      minGreenS: iMin >= 0 ? num(r[iMin]) : undefined,
      splitS: iMax >= 0 ? num(r[iMax]) : undefined,
      yellowS: iYellow >= 0 ? num(r[iYellow]) : undefined,
      allRedS: iAllRed >= 0 ? num(r[iAllRed]) : undefined,
    });
  }
}

// ---------------------------------------------------------------------------

/** Per-approach totals derived from movement volumes — what the engine's
 *  approach-level model consumes. */
export function approachVolumes(v: UtdfVolumes): Record<"NB" | "SB" | "EB" | "WB", number> {
  const out = { NB: 0, SB: 0, EB: 0, WB: 0 };
  for (const mv of UTDF_MOVEMENTS) {
    const n = v.movements[mv];
    if (n !== undefined) out[mv.slice(0, 2) as keyof typeof out] += n;
  }
  return out;
}
