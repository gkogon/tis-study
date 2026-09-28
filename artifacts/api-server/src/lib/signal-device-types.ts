/**
 * Which records of an authoritative city signal layer are traffic signals.
 *
 * The regional loader (regional-intersections.ts) treats every tuple in a
 * `<slug>-signals.json` file as a signalized intersection: it gets a cycle,
 * green ratios, a saturation-flow capacity and a control-delay LOS grade. So
 * a device with no signal cycle must never reach that file.
 *
 * City layers do not hold only signals. CDOT's "Traffic Signals" layer
 * (gis.charlottenc.gov Accela MapServer/11) holds every device CDOT
 * maintains. Of its 1,307 operational records on 2026-09-25, 411 were school
 * flashers, mid-block ped beacons and crossings, multi-way stop flashers,
 * fire-station emergency signals, RRFBs, warning/stop flashers and parking
 * wayfinding signs. Filtering on SERVSTAT alone put all of them into
 * charlotte-signals.json, and the hosted Mecklenburg sample graded six of them
 * -- two school flashers, a multi-way stop flasher and three mid-block ped
 * beacons -- as signalized intersections.
 *
 * Consumed at fetch time by scripts/src/fetch-city-signals.ts; guarded by
 * scripts/verify-signal-device-types.mjs.
 */

export type SignalTuple = [number, number, number, string | null, number];
export type Point = { lat: number; lon: number };

/** CDOT UNITTYPE codes for a traffic signal: fixed time, loops, video. */
const CDOT_SIGNAL_CODES = new Set(["TS", "TSL", "TSV"]);

/**
 * True when a CDOT record is a traffic signal. The code and the description
 * must agree: two records carry a signal code with a mid-block ped signal
 * description or the reverse, and a record the source cannot classify
 * consistently is excluded rather than guessed.
 */
export function isCdotTrafficSignal(
  unitType: string | null | undefined,
  unitTypeDesc: string | null | undefined,
): boolean {
  const code = (unitType ?? "").trim().toUpperCase();
  if (!CDOT_SIGNAL_CODES.has(code)) return false;
  const desc = (unitTypeDesc ?? "").trim().toUpperCase();
  return desc === "" || desc.startsWith("TRAFFIC SIGNAL");
}

/** Equirectangular metres; the fetchers' match radius uses the same formula. */
function distMeters(a: Point, b: Point): number {
  const M_PER_DEG_LAT = 111_320;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return Math.hypot((a.lat - b.lat) * M_PER_DEG_LAT, (a.lon - b.lon) * mPerDegLon);
}

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
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const node of nodes) {
    const at: Point = { lat: node[1], lon: node[2] };
    const mapsDevice =
      devices.some((d) => distMeters(at, d) <= radiusM) && !signals.some((s) => distMeters(at, s) <= radiusM);
    (mapsDevice ? dropped : kept).push(node);
  }
  return { kept, dropped };
}
