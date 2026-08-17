/**
 * Extend the Atlanta signal + road inventory to the full 29-county MSA.
 *
 * `atlanta_metro` grew from a single 33.4–34.2 / -84.9..-83.9 box to the
 * union of rectangles in `ATLANTA_METRO.coverageBoxes`, which added 18 county
 * seats. But the inventory is keyed on region code — `atlanta-signals.json` /
 * `atlanta-roads.json` — and those files only ever covered the old box, so
 * without this pass the newly-claimed counties would resolve to Atlanta and
 * then find NOTHING: 14 of the 18 new seats had zero signals in
 * atlanta-signals.json, which would have dropped them onto the 15-mile
 * nearest-N fallback and made the study *worse* than the statewide tier it
 * replaced.
 *
 * The gap is filled from the `georgia-statewide-*` assets already committed
 * for the georgia_statewide tier — the same OSM extraction, statewide extent,
 * and a near-superset of the Atlanta files (7,372 of Atlanta's 7,393 signals
 * appear in it at matching coordinates). No network fetch is needed.
 *
 * Strictly APPEND-ONLY: every existing tuple keeps its position and its id.
 * That matters because `atlanta-accidents.json` keys crash aggregates by
 * signal id and `atlanta-parking.json` snaps to signal coordinates — a
 * re-key would silently orphan both. The two id spaces are disjoint
 * (statewide ids run 0–13,288, Atlanta's are raw OSM ids from 66.2M up), so
 * appended signals cannot collide with existing ones.
 *
 * Roads are normalized from the statewide 5-tuple
 * `[class, name, coords, lanes, maxspeed]` to the 3-tuple
 * `[class, name, coords]` that `atlanta-signal-naming.ts` reads — it skips
 * any way whose length isn't 3, so an un-normalized append would be silently
 * ignored and every new intersection would render as "Signal #<id>".
 *
 * Idempotent: a second run sees the appended geometry in the occupancy grid
 * and adds nothing.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/expand-atlanta-inventory.ts
 *   pnpm --filter @workspace/scripts exec tsx src/expand-atlanta-inventory.ts --dry-run
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ATLANTA_METRO, type LatLonBox } from "../../artifacts/tis-api-server/src/lib/regions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../artifacts/api-server/src/data");

/** `[osm_id, lat, lon, name|null, roadClass]` — see fetch-osm-signals.ts. */
type SignalTuple = [number, number, number, string | null, number];
type Coords = Array<[number, number]>;
/** Atlanta ways are `[class, coords]` or `[class, name, coords]`; the
 *  statewide extract also carries `[class, name, coords, lanes, maxspeed]`. */
type Way = unknown[];
type RoadNetwork = { classes: string[]; ways: Way[] };

/**
 * Signal dedup cell, ~40 m at this latitude. Comfortably below the 45 m the
 * engine already treats as one physical junction (DEDUP_DISTANCE_M), so a
 * statewide record for a signal Atlanta already has is dropped here rather
 * than being left for runtime dedup.
 */
const SIGNAL_CELLS_PER_DEG = 2750;
/** Road occupancy cell, ~110 m — coarse enough that a re-traced way lands in
 *  the same cells as the copy already in atlanta-roads.json. */
const ROAD_CELLS_PER_DEG = 1000;
/** A statewide way counts as already-covered when at least this share of its
 *  vertices land in cells the Atlanta network already occupies. */
const ROAD_COVERED_SHARE = 0.5;

function inCoverage(lat: number, lon: number, boxes: readonly LatLonBox[]): boolean {
  return boxes.some(
    (b) => lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax,
  );
}

function signalCell(lat: number, lon: number): string {
  return `${Math.round(lat * SIGNAL_CELLS_PER_DEG)}:${Math.round(lon * SIGNAL_CELLS_PER_DEG)}`;
}

function roadCell(p: [number, number]): string {
  return `${Math.round(p[0] * ROAD_CELLS_PER_DEG)}:${Math.round(p[1] * ROAD_CELLS_PER_DEG)}`;
}

/** Coordinate list of a way in either the 2-, 3- or 5-element layout. */
function wayCoords(w: Way): Coords | null {
  const pts = w.length === 2 ? w[1] : w[2];
  return Array.isArray(pts) && pts.length >= 2 ? (pts as Coords) : null;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(DATA_DIR, file), "utf8")) as T;
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const boxes = ATLANTA_METRO.coverageBoxes;
  if (!boxes?.length) {
    throw new Error("ATLANTA_METRO.coverageBoxes is empty — nothing to expand into");
  }

  // ── Signals ────────────────────────────────────────────────────────────
  const atlSignals = readJson<SignalTuple[]>("atlanta-signals.json");
  const gaSignals = readJson<SignalTuple[]>("georgia-statewide-signals.json");

  const occupied = new Set(atlSignals.map((s) => signalCell(s[1], s[2])));
  const existingIds = new Set(atlSignals.map((s) => s[0]));
  const newSignals: SignalTuple[] = [];
  for (const s of gaSignals) {
    const [id, lat, lon] = s;
    if (!inCoverage(lat, lon, boxes)) continue;
    const cell = signalCell(lat, lon);
    if (occupied.has(cell)) continue;
    if (existingIds.has(id)) {
      throw new Error(
        `signal id ${id} collides with an existing Atlanta signal — the id spaces ` +
          `are supposed to be disjoint; re-key before appending`,
      );
    }
    occupied.add(cell);
    newSignals.push(s);
  }

  // ── Roads ──────────────────────────────────────────────────────────────
  const atlRoads = readJson<RoadNetwork>("atlanta-roads.json");
  const gaRoads = readJson<RoadNetwork>("georgia-statewide-roads.json");
  if (JSON.stringify(atlRoads.classes) !== JSON.stringify(gaRoads.classes)) {
    throw new Error(
      `road class tables differ — appending would mislabel every road class.\n` +
        `  atlanta:   ${JSON.stringify(atlRoads.classes)}\n` +
        `  statewide: ${JSON.stringify(gaRoads.classes)}`,
    );
  }

  const roadOccupied = new Set<string>();
  for (const w of atlRoads.ways) {
    const pts = wayCoords(w);
    if (pts) for (const p of pts) roadOccupied.add(roadCell(p));
  }

  const newWays: Way[] = [];
  for (const w of gaRoads.ways) {
    const pts = wayCoords(w);
    if (!pts) continue;
    const name = w[1];
    // The naming grid only indexes named ways; an unnamed append would add
    // bytes and buy nothing.
    if (typeof name !== "string" || !name.trim()) continue;
    if (!pts.some((p) => inCoverage(p[0], p[1], boxes))) continue;
    // Compared against the PRE-EXISTING network only. Folding appended ways
    // into the grid as we go would drop every cross street sharing a cell
    // with the first way added to a town — and cross streets are the whole
    // point, since that is what names an intersection.
    const covered = pts.filter((p) => roadOccupied.has(roadCell(p))).length;
    if (covered / pts.length >= ROAD_COVERED_SHARE) continue;
    newWays.push([w[0], name, pts]);
  }

  console.log(
    `signals: ${atlSignals.length} existing + ${newSignals.length} appended = ` +
      `${atlSignals.length + newSignals.length}`,
  );
  console.log(
    `roads:   ${atlRoads.ways.length} existing + ${newWays.length} appended = ` +
      `${atlRoads.ways.length + newWays.length}`,
  );

  if (dryRun) {
    console.log("--dry-run: no files written");
    return;
  }
  if (!newSignals.length && !newWays.length) {
    console.log("nothing to append — inventory already covers the coverage boxes");
    return;
  }

  writeFileSync(
    path.join(DATA_DIR, "atlanta-signals.json"),
    JSON.stringify(atlSignals.concat(newSignals)),
  );
  writeFileSync(
    path.join(DATA_DIR, "atlanta-roads.json"),
    JSON.stringify({ classes: atlRoads.classes, ways: atlRoads.ways.concat(newWays) }),
  );
  console.log("wrote atlanta-signals.json + atlanta-roads.json");
}

main();
