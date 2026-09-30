/**
 * Which records of an authoritative signal layer are traffic signals, and how
 * those layers are overlaid onto the OSM baseline.
 *
 * The regional loader (regional-intersections.ts) treats every tuple in a
 * `<slug>-signals.json` file as a signalized intersection: it gets a cycle,
 * green ratios, a saturation-flow capacity and a control-delay LOS grade. So
 * a device with no signal cycle must never reach that file.
 *
 * The city, county and FDOT layers do not hold only signals. CDOT's layer
 * holds every device CDOT maintains; Miami-Dade's holds school signs,
 * flashing beacons, cameras and records marked Future or Removed; FDOT types
 * beacons, mid-block ped controls and emergency signals next to its signals;
 * Orlando's and Raleigh's carry beacons, school flashers, HAWKs and ped-only
 * signals. Each record is therefore classified from the source's own type
 * fields:
 *   - "signal":  an existing vehicle traffic signal; overlaid onto the baseline
 *   - "device":  a device OSM also maps as `highway=traffic_signals`
 *                (flasher, beacon, school sign, emergency or ped signal); never
 *                overlaid, and an OSM node that maps one is dropped
 *   - "exclude": anything else, or anything the source leaves ambiguous; never
 *                overlaid, and never evidence against an OSM node
 *
 * Consumed at fetch time by scripts/src/fetch-city-signals.ts; guarded by
 * scripts/verify-signal-device-types.mjs.
 */

export type SignalTuple = [number, number, number, string | null, number];
export type Point = { lat: number; lon: number };
export type RecordClass = "signal" | "device" | "exclude";
export type AuthorityRecord = { id: number; lat: number; lon: number; name: string | null; cls: RecordClass };
export type Pass = {
  records: AuthorityRecord[];
  /** Added to a record's id before negation when it gets a new tuple. */
  idNamespace: number;
  /**
   * The source's type field cannot express ped or emergency signals, so it
   * files them as signals. Such a signal yields to a co-located device from a
   * more specific pass (reconcileCoarseSignals).
   */
  coarseSignalType?: boolean;
};

/**
 * FDOT's FIDs were renumbered upstream after the May fetch, so an FDOT-derived
 * id carries no identity across fetches. New FDOT tuples take ids from their
 * own range, which no city, county or OSM id can reach.
 */
export const FDOT_ID_NAMESPACE = 10_000_000;

/** The overlay's match radius, and the radius a device can explain a node in. */
const MATCH_RADIUS_M = 50;
/** A new record inherits a previous tuple's id within this distance. */
const CONTINUITY_RADIUS_M = 2;

const norm = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();
const FIRE_STATION = /\bFIRE STATION\b/i;
/** Names match for id continuity when equal ignoring capitalization. */
const sameName = (a: string | null, b: string | null): boolean =>
  a === b || (a !== null && b !== null && a.toLowerCase() === b.toLowerCase());

// ── names ───────────────────────────────────────────────────────────────────

const ACRONYMS = new Set(["NC", "SC", "FL", "US", "I", "II", "III", "IV", "NW", "NE", "SW", "SE", "SR"]);

/**
 * Title-case a street label; keeps common acronyms and directionals upper case.
 * A word is capitalized after "/", "-" and "(" as after a space, so an FDOT
 * "US 441/SR 7/NW 7 AVE" reads "US 441/SR 7/NW 7 Ave", not "US 441/sr 7/nw 7
 * Ave", CDOT's "INDEPENDENCE/I-277" reads "Independence/I-277", and Raleigh's
 * "SEGAL (WALMART)" reads "Segal (Walmart)".
 */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) =>
      w
        .split(/([/(-])/)
        .map((p) => {
          if (p === "/" || p === "-" || p === "(" || p.length === 0) return p;
          const up = p.toUpperCase();
          return ACRONYMS.has(up) ? up : p[0]!.toUpperCase() + p.slice(1);
        })
        .join(""),
    )
    .join(" ");
}

/**
 * CDOT's two-letter street types, as the standard abbreviations. Rd, St, Dr,
 * Av and Ln are kept as CDOT writes them.
 */
const CDOT_STREET_TYPES: Record<string, string> = {
  Bv: "Blvd", Py: "Pkwy", Hy: "Hwy", Wy: "Way", Ra: "Ramp", Dy: "Dwy", Dw: "Dwy",
};

/**
 * Charlotte CDOT UNITDESC names every street at the signal, separated by
 * underscores: "IDLEWILD RD_MONROE RD_RAMA RD". Splitting on the first
 * underscore only printed "Idlewild Rd & Monroe Rd_rama Rd" (219 of 894
 * embedded names). Every street is kept, joined with " & "; empty parts from
 * doubled or trailing underscores are dropped. One signal (SIGNAL_ID 1997)
 * reads "BRAWLEY LN & ... ROBINSON CHURCH RD TRAFFIC SIGNAL"; the type tag is
 * not part of the name. Two-letter street types are spelled as the standard
 * abbreviations ("DURANT BV" reads "Durant Blvd").
 */
export function formatCdotIntersectionName(unitdesc: string | null | undefined): string | null {
  const parts = (unitdesc ?? "")
    .replace(/\s*\btraffic signal\s*$/i, "")
    .split("_")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  return parts
    .map((p) => titleCase(p).split(" ").map((w) => CDOT_STREET_TYPES[w] ?? w).join(" "))
    .join(" & ");
}

/**
 * Raleigh's Intersecti separates every street at the signal with a slash,
 * spaced or not: "ATHENS DR. / AVENT FERRY RD. / LAKE DAM RD. / PINEVIEW DR.",
 * "INMAN PARK DR./LEAD MINE RD./SUGAR BUSH RD.". Splitting on the first slash
 * only left the rest joined by slashes (94 + 16 of 638 names on 2026-09-29).
 * Every street is kept, joined with " & ".
 */
export function formatRaleighIntersectionName(intersecti: string | null | undefined): string | null {
  const parts = (intersecti ?? "")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length === 0 ? null : parts.map(titleCase).join(" & ");
}

// ── classifiers ─────────────────────────────────────────────────────────────

/** CDOT UNITTYPE codes for a traffic signal: fixed time, loops, video. */
const CDOT_SIGNAL_CODES = new Set(["TS", "TSL", "TSV"]);
/** School flashers, ped beacons and signals, stop/warning flashers, emergency signals, RRFBs. */
const CDOT_DEVICE_CODES = new Set(["SF", "SFS", "MPB", "MPS", "MPCS", "MSF", "SWSF", "ES", "RRFB"]);

/**
 * Charlotte CDOT (UNITTYPE, UNITTYPEDESC). A device code decides on its own:
 * Rensselaer Av & South Bv carries MPB with a signal description, and OSM
 * tags both of its nodes pedestrian_crossing. A signal code needs a
 * description that agrees, so "E 4TH ST CROSSING DR" (TS, described as a
 * mid-block ped signal) is excluded rather than guessed. Parking wayfinding
 * signs are excluded: OSM never maps a sign as a signal.
 */
export function classifyCdot(unitType: string | null | undefined, unitTypeDesc: string | null | undefined): RecordClass {
  const code = norm(unitType);
  if (CDOT_DEVICE_CODES.has(code)) return "device";
  if (!CDOT_SIGNAL_CODES.has(code)) return "exclude";
  const desc = norm(unitTypeDesc);
  return desc === "" || desc.startsWith("TRAFFIC SIGNAL") ? "signal" : "exclude";
}

/**
 * Miami-Dade county (ASSETTYPE, CNSTRSTAT). Only CNSTRSTAT 3 (Existing) is on
 * the street: a Future signal is not there yet (ASSETID 8338 was printed at
 * LOS D in the hosted sample) and a Removed one is gone. Cameras and
 * reversible lanes sit at real intersections and OSM never maps them as
 * signals, so they are excluded, not devices.
 */
export function classifyMiamiDadeCounty(assetType: number | null | undefined, constructionStatus: number | null | undefined): RecordClass {
  const EXISTING = 3, TRAFFIC_SIGNAL = 1;
  const SCHOOL_SIGN = 2, FLASHING_SIGNAL = 3, FLASHING_BEACON = 4;
  if (constructionStatus !== EXISTING) return "exclude";
  if (assetType === TRAFFIC_SIGNAL) return "signal";
  if (assetType === SCHOOL_SIGN || assetType === FLASHING_SIGNAL || assetType === FLASHING_BEACON) return "device";
  return "exclude";
}

/**
 * FDOT SIGNALTY (VALUE_, SIGNALNC, side street). VALUE_ is the type; SIGNALNC
 * stands in only when VALUE_ is N/A (its 04/05 codes are marked obsolete).
 *
 * Mid-block ped controls (03) and emergency signals (04) are devices. Beacons
 * (01) are excluded, not devices: at all 7 Miami-Dade locations where the
 * county, which operates them, also has a record, it files a traffic signal
 * -- among them NW 27 Av & NW 36 St -- although its own types include
 * flashing beacons. So an FDOT beacon is not added, but it is not evidence
 * against an OSM signal either. 05 "intersection control at school" does not
 * say whether it is a signal or a school flasher, so it is excluded. A signal
 * whose side street is a fire station could be a full signal with fire
 * preemption or an emergency-vehicle signal; FDOT has a separate code (04) for
 * the latter but these are typed 02, so they are excluded rather than guessed.
 */
export function classifyFdot(
  signalType: string | null | undefined,
  signalTypeNc: string | null | undefined,
  sideStreet: string | null | undefined,
): RecordClass {
  const v = norm(signalType) === "N/A" ? "" : norm(signalType);
  const nc = norm(signalTypeNc) === "N/A" ? "" : norm(signalTypeNc);
  if (v && nc && v !== nc) return "exclude";
  const type = v || (["01", "02", "03"].includes(nc) ? nc : "");
  if (type === "02") return FIRE_STATION.test(sideStreet ?? "") ? "exclude" : "signal";
  if (type === "03" || type === "04") return "device";
  return "exclude";
}

const ORLANDO_SIGNAL_TYPES = new Set(["RCSS", "ISOL", "EAGLE", "TRAFSIG"]);
const ORLANDO_DEVICE_TYPES = new Set(["FLBEA", "SCHFL"]);
const CROSSING_ANNOTATION = /CROSS ?WALK|\bX WALK\b|\bPED(ESTRIAN)? CROSSING\b|\bBIKE PATH\b/i;
const FIRE_DEPT_ANNOTATION = /\(OFD#\d+\)/i;

/**
 * City of Orlando (Type, cross-street text). Type is the controller class;
 * the city annotates what a signal controls in the street text: "(CROSS
 * WALK)", "PEDESTRIAN CROSSING", "OIA Ped Crossing", "BIKE PATH" mark
 * crossing signals, "(OFD#3)" a fire-department signal, which is excluded for
 * the same reason as FDOT's fire-station 02s.
 */
export function classifyOrlandoCity(type: string | null | undefined, name: string): RecordClass {
  const t = norm(type);
  if (ORLANDO_DEVICE_TYPES.has(t)) return "device";
  if (!ORLANDO_SIGNAL_TYPES.has(t)) return "exclude";
  if (FIRE_DEPT_ANNOTATION.test(name)) return "exclude";
  return CROSSING_ANNOTATION.test(name) ? "device" : "signal";
}

/**
 * Raleigh (Subtype, Intersecti). HAWK signals rest dark and ped-only signals
 * stop the main road only for a crossing; neither runs a cycle that serves a
 * cross street. A "Signal" whose only cross leg is a fire station is excluded
 * as for FDOT.
 */
export function classifyRaleigh(subtype: string | null | undefined, name: string): RecordClass {
  const s = norm(subtype);
  if (s === "HAWK SIGNAL" || s === "PEDESTRIAN SIGNAL") return "device";
  if (s !== "SIGNAL") return "exclude";
  return FIRE_STATION.test(name) ? "exclude" : "signal";
}

// ── geometry ────────────────────────────────────────────────────────────────

/** Equirectangular metres, computed exactly as the fetcher's original overlay
 *  did (sqrt of squares, not Math.hypot, which can differ in the last bit), so
 *  a rebuild reproduces its match decisions. */
function distMeters(a: Point, b: Point): number {
  const M_PER_DEG_LAT = 111_320;
  const midLat = (a.lat + b.lat) / 2;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  return Math.sqrt(((a.lat - b.lat) * M_PER_DEG_LAT) ** 2 + ((a.lon - b.lon) * mPerDegLon) ** 2);
}

const cellKey = (lat: number, lon: number, dLat = 0, dLon = 0) =>
  `${Math.floor(lat / 0.005) + dLat}_${Math.floor(lon / 0.005) + dLon}`;

/** 0.005° buckets (~550 m); a 3×3 neighbourhood covers any radius up to that. */
function gridOf<T>(items: T[], at: (x: T) => Point): Map<string, T[]> {
  const g = new Map<string, T[]>();
  for (const x of items) {
    const p = at(x);
    const k = cellKey(p.lat, p.lon);
    const b = g.get(k);
    if (b) b.push(x);
    else g.set(k, [x]);
  }
  return g;
}

function within<T>(g: Map<string, T[]>, at: (x: T) => Point, p: Point, r: number): T[] {
  const out: T[] = [];
  for (let dl = -1; dl <= 1; dl++) {
    for (let dn = -1; dn <= 1; dn++) {
      for (const x of g.get(cellKey(p.lat, p.lon, dl, dn)) ?? []) if (distMeters(p, at(x)) <= r) out.push(x);
    }
  }
  return out;
}

const pointOf = (r: Point) => r;
const tuplePoint = (t: SignalTuple): Point => ({ lat: t[1], lon: t[2] });

// ── the build ───────────────────────────────────────────────────────────────

/**
 * Split baseline (OSM) nodes into those to keep and those that map one of the
 * authority's non-signal devices: a node is dropped when a non-signal device
 * lies within `radiusM` and no authoritative signal does.
 *
 * Excluding a device from the overlay is not enough on its own, because OSM
 * maps many of the same devices as `highway=traffic_signals`. Run against the
 * Charlotte archive on 2026-09-25 this drops 65 nodes: 59 carry OSM's own
 * non-signal subtag (35 `emergency`, 21 `pedestrian_crossing`, 3 `blinker`,
 * among them Sheffield Dr & Woodland Dr from the Mecklenburg sample). The
 * other 6 are tagged plain `signal`, but CDOT has a non-signal device 1-27 m
 * away and its nearest traffic signal 246-886 m away. At S Mint St & W Summit
 * Av, where OSM still shows a signal, CDOT lists a multi-way stop flasher and
 * a non-operational record named "Mint & Summit", both within 1 m.
 *
 * The signal test protects signalized junctions that have a school flasher on
 * an approach: Quail Hollow Rd & Heathstead Place has one 20 m from its node
 * and CDOT's signal record 1.8 m from it.
 */
export function dropNodesAtNonSignalDevices<T extends SignalTuple>(
  nodes: T[],
  signals: Point[],
  devices: Point[],
  radiusM: number,
): { kept: T[]; dropped: T[] } {
  const sig = gridOf(signals, pointOf);
  const dev = gridOf(devices, pointOf);
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const node of nodes) {
    const at = tuplePoint(node);
    const mapsDevice = within(dev, pointOf, at, radiusM).length > 0 && within(sig, pointOf, at, radiusM).length === 0;
    (mapsDevice ? dropped : kept).push(node);
  }
  return { kept, dropped };
}

/**
 * The record's own name places it mid-block: a block address ("@ SW 9200
 * Blk"), or between two cross streets ("Collins Av / 31 St / 32 St",
 * "SW 8 St @ SW 29 Ct / SW 30 Av", "NW 54 St/ NW 1 Av & 1 Ct").
 */
function describesMidBlock(name: string | null): boolean {
  if (!name) return false;
  return /\bBlk\b|\bBlock\b/i.test(name) || /\/.*[/&]/.test(name) || /@.*\//.test(name);
}

/**
 * A coarse-typed signal becomes a device when another pass puts a device
 * within 50 m and nearer than any signal, and the record's own name places it
 * mid-block. Miami-Dade's county layer has no ped or emergency type, so it
 * files "Coral Reef Dr @ SW 9200 Blk" as a traffic signal where FDOT types the
 * same device 04 (emergency) 2.5 m away; on 2026-09-28, 102 county signals had
 * an FDOT device nearer than any FDOT signal, most of them mid-block ped
 * controls.
 *
 * The other pass only confirms a location the operating agency already
 * describes as mid-block; a record it names as an intersection is never
 * overridden. FDOT types full signals at major intersections as beacons
 * (NW 27 Av & NW 36 St, SIGNALNC 01) or emergency signals (NW 7 Av & NW 36 St,
 * 04: a full signal that also serves a fire station).
 */
export function reconcileCoarseSignals(passes: Pass[]): { passes: Pass[]; reclassified: AuthorityRecord[] } {
  const reclassified: AuthorityRecord[] = [];
  const out = passes.map((p, i) => {
    if (!p.coarseSignalType) return p;
    const others = passes.filter((_, j) => j !== i).flatMap((q) => q.records);
    const dev = gridOf(others.filter((r) => r.cls === "device"), pointOf);
    const sig = gridOf(others.filter((r) => r.cls === "signal"), pointOf);
    const nearest = (g: Map<string, Point[]>, r: AuthorityRecord) =>
      Math.min(Infinity, ...within(g, pointOf, r, MATCH_RADIUS_M).map((x) => distMeters(r, x)));
    return {
      ...p,
      records: p.records.map((r) => {
        if (r.cls !== "signal" || !describesMidBlock(r.name)) return r;
        const dDev = nearest(dev, r);
        if (dDev === Infinity || nearest(sig, r) <= dDev) return r;
        const device: AuthorityRecord = { ...r, cls: "device" };
        reclassified.push(device);
        return device;
      }),
    };
  });
  return { passes: out, reclassified };
}

/**
 * Rebuild a slug's inventory: the archived OSM baseline, minus nodes that map
 * a device of any pass, with each pass's signals overlaid in order.
 *
 * The overlay is the fetcher's original: a record takes over the nearest
 * baseline node within 50 m (keeping its id, taking the record's position and
 * name), otherwise it is appended. Protection spans passes, so an FDOT device
 * cannot drop a node that a county signal confirms.
 *
 * An appended tuple keeps the id a previous output gave the same record: the
 * tuple within 2 m under the same name (ignoring capitalization), if exactly
 * one. AADT records are keyed by these ids, and FDOT's FIDs change between
 * fetches. Otherwise it gets -(idNamespace + record id).
 */
export function buildSignalInventory(archive: SignalTuple[], passes: Pass[], previous: SignalTuple[]): {
  tuples: SignalTuple[];
  dropped: SignalTuple[];
  reclassified: AuthorityRecord[];
  ids: { continued: number; fresh: number };
} {
  const { passes: rp, reclassified } = reconcileCoarseSignals(passes);
  const all = rp.flatMap((p) => p.records);
  const { kept, dropped } = dropNodesAtNonSignalDevices(
    archive,
    all.filter((r) => r.cls === "signal"),
    all.filter((r) => r.cls === "device"),
    MATCH_RADIUS_M,
  );

  const prevIndex = gridOf(previous.filter((t) => t[0] < 0), tuplePoint);
  const used = new Set<number>(kept.map((t) => t[0]));
  const ids = { continued: 0, fresh: 0 };
  const assignId = (r: AuthorityRecord, ns: number, at: Point): number => {
    const same = within(prevIndex, tuplePoint, at, CONTINUITY_RADIUS_M).filter((t) => sameName(t[3], r.name));
    if (same.length === 1 && !used.has(same[0]![0])) {
      used.add(same[0]![0]);
      ids.continued++;
      return same[0]![0];
    }
    const id = -(ns + r.id);
    if (used.has(id)) throw new Error(`id ${id} (record ${r.id}, ${JSON.stringify(r.name)}) is already taken in this inventory`);
    used.add(id);
    ids.fresh++;
    return id;
  };

  let tuples: SignalTuple[] = kept.map((t) => [...t] as SignalTuple);
  for (const p of rp) {
    const idx = gridOf(tuples.map((t, i) => [t, i] as const), ([t]) => tuplePoint(t));
    const merged = tuples.map((t) => [...t] as SignalTuple);
    const added: SignalTuple[] = [];
    for (const r of p.records) {
      if (r.cls !== "signal") continue;
      // Nearest by the merged tuple's current position, over the pass
      // baseline's buckets; the first of equal distances wins.
      let best: { i: number; d: number } | null = null;
      for (let dl = -1; dl <= 1; dl++) {
        for (let dn = -1; dn <= 1; dn++) {
          for (const [, i] of idx.get(cellKey(r.lat, r.lon, dl, dn)) ?? []) {
            const d = distMeters(r, tuplePoint(merged[i]!));
            if (d <= MATCH_RADIUS_M && (best === null || d < best.d)) best = { i, d };
          }
        }
      }
      const lat = Math.round(r.lat * 1e5) / 1e5;
      const lon = Math.round(r.lon * 1e5) / 1e5;
      if (best) merged[best.i] = [merged[best.i]![0], lat, lon, r.name, 2];
      else added.push([assignId(r, p.idNamespace, { lat, lon }), lat, lon, r.name, 2]);
    }
    tuples = [...merged, ...added];
  }
  return { tuples, dropped, reclassified, ids };
}

/**
 * Keep an AADT record only on the tuple it was snapped to: one tuple held the
 * key before and one holds it now, within 50 m of each other. A key with no
 * tuple before or after is orphaned; a key two tuples shared has an unknown
 * owner; a tuple that moved further was snapped somewhere else. In Miami-Dade,
 * devices processed after a signal had dragged 30 OSM nodes 57-92 m, and the
 * counts were snapped there.
 */
export function reconcileAadtKeys<R>(
  aadt: Record<string, R>,
  previous: SignalTuple[],
  next: SignalTuple[],
  maxMoveM = MATCH_RADIUS_M,
): { kept: Record<string, R>; orphaned: string[]; moved: string[]; shared: string[] } {
  const group = (ts: SignalTuple[]) => {
    const m = new Map<number, SignalTuple[]>();
    for (const t of ts) {
      const g = m.get(t[0]);
      if (g) g.push(t);
      else m.set(t[0], [t]);
    }
    return m;
  };
  const before = group(previous);
  const after = group(next);
  const kept: Record<string, R> = {};
  const orphaned: string[] = [];
  const moved: string[] = [];
  const shared: string[] = [];
  for (const [key, rec] of Object.entries(aadt)) {
    const p = before.get(Number(key)) ?? [];
    const n = after.get(Number(key)) ?? [];
    if (p.length === 0 || n.length === 0) orphaned.push(key);
    else if (p.length > 1 || n.length > 1) shared.push(key);
    else if (distMeters(tuplePoint(p[0]!), tuplePoint(n[0]!)) > maxMoveM) moved.push(key);
    else kept[key] = rec;
  }
  return { kept, orphaned, moved, shared };
}
