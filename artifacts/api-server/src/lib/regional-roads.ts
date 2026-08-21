/**
 * Region road-network loader for the bounded /roads endpoint.
 *
 * The TIS engine's four-step route-assignment step needs the local road
 * graph around a project site. The full per-region `<slug>-roads.json`
 * files are large (tens of thousands of OSM ways), so this module loads
 * one (cached per slug) and returns only the segments within a small
 * radius of the site — a payload the engine can build a graph from in
 * milliseconds. Fails soft (returns null) when a region has no road file.
 *
 * On-disk format is dual: `<slug>-roads.json.gz` is preferred over
 * `<slug>-roads.json` (see data-files.ts). Post-residential-refetch the
 * corpus only fits in the repo/image gzipped, so new files land as .gz
 * while already-shipped raw files keep working untouched.
 */
import { regionCodeToSlug } from "./regional-intersections";
import { lruSet } from "./bounded-cache";
import { findDataFile, readJsonMaybeGz } from "./data-files";

/**
 * A way tuple as it actually appears in the shipped `<slug>-roads.json` files.
 * Two shapes are in circulation and BOTH must be handled:
 *
 *   legacy   [classCode, polyline, lanes?, maxspeed?]
 *   current  [classCode, name, polyline, lanes?, maxspeed?]
 *
 * The type used to declare only the legacy shape, which is why the parser was
 * written to read `way[1]` as the polyline. 315 of the 316 shipped files are
 * current-format, so that read silently discarded nearly every road in the
 * product. Keeping both arms in the type is what stops that regressing.
 */
type RoadWayLegacy = [number, Array<[number, number]>, (number | null)?, (number | null)?];
type RoadWayNamed = [
  number, string, Array<[number, number]>,
  (number | null)?, (number | null)?,
  // `oneway` (1 = along node order, -1 = against, 0 = two-way) is emitted by
  // fetch-osm-roads.ts as of 2026-08. Files fetched before that stop at
  // maxspeed, so it is optional and absent reads as two-way — which is exactly
  // the old behaviour, letting regions be re-fetched incrementally.
  (number | null)?,
];
type RoadWay = RoadWayLegacy | RoadWayNamed;
type RoadFile = { classes: string[]; ways: RoadWay[] };

const cache = new Map<string, RoadFile | null>();

function loadRoadFile(slug: string): RoadFile | null {
  if (cache.has(slug)) return cache.get(slug) ?? null;
  const path = findDataFile(`${slug}-roads.json`);
  if (!path) { cache.set(slug, null); return null; }
  try {
    const parsed = readJsonMaybeGz(path) as RoadFile;
    // Cap 4 (not the default 8): parsed road files are the largest objects
    // in the process, and the residential refetch grows them ~3.2x — a
    // statewide file can parse to 300MB+ of JS objects. 8 grown regions
    // resident at once risks OOMing the Railway analyzer; 4 halves the
    // worst case while keeping the hot regions warm.
    lruSet(cache, slug, parsed, 4);
    return parsed;
  } catch {
    cache.set(slug, null);
    return null;
  }
}

/**
 * Compact directionless segment:
 * [classCode, aLat, aLon, bLat, bLon, lanes, maxspeed, name?]
 *
 * `name` is appended, not inserted, so every existing consumer indexing 0-6 is
 * unaffected. It exists so the router can give a continuity credit to staying
 * on the same named street: without it, shortest paths cut diagonally through a
 * grid to save seconds and produce zig-zag turn patterns at studied
 * intersections that no engineer would recognise.
 */
export type RoadSegment = [
  number, number, number, number, number,
  number | null, number | null,
  (string | null)?,
  // oneway: 1 = a->b only, -1 = b->a only, 0 = two-way. Absent on segments from
  // road files fetched before oneway capture; absent reads as two-way, which is
  // the behaviour every consumer already assumed.
  (number | null)?,
];

function distMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Road segments within `radiusMi` of (lat,lon) for a region. Returns null
 * when no road data exists for the region. Caps the returned set so a
 * pathological radius can't produce an unbounded payload.
 */
export function roadSegmentsNear(
  regionCode: string,
  lat: number,
  lon: number,
  radiusMi: number,
  cap = 8000,
): RoadSegment[] | null {
  const slug = regionCodeToSlug(regionCode);
  const road = loadRoadFile(slug);
  if (!road || !Array.isArray(road.ways)) return null;
  const r = Math.max(0.1, Math.min(8, radiusMi));
  // Collect with distance so the cap can be applied radially rather than by
  // file order — see the truncation note at the end of this function.
  const out: Array<{ seg: RoadSegment; d: number }> = [];
  for (const way of road.ways) {
    const cls = typeof way[0] === "number" ? way[0] : 99;
    // Way tuples ship in TWO shapes and this loop only ever understood one:
    //   legacy  [classCode, polyline, lanes?, maxspeed?]
    //   current [classCode, name, polyline, lanes?, maxspeed?]
    // Reading way[1] unconditionally meant every current-format way hit a
    // string, failed the Array.isArray guard, and was skipped — so
    // roadSegmentsNear returned [], /api/roads reported no segments,
    // fetchLocalRoads returned null, and tis.ts silently skipped route
    // assignment as "region has no road network". 315 of 316 shipped road
    // files are current-format (Miami-Dade: 0 of 31,592 ways parsed); Atlanta
    // is the lone mixed file and only 31% of its ways got through.
    //
    // Locate the polyline by shape rather than by index, and read lanes /
    // maxspeed from the two slots AFTER it so both shapes keep their metadata
    // (current-format files do carry lanes/maxspeed — they were unreachable).
    const named = !Array.isArray(way[1]);
    const pts = named ? way[2] : way[1];
    if (!Array.isArray(pts) || pts.length < 2) continue;
    // Read through locals typed as unknown: a computed tuple index widens the
    // element type back to the full union and defeats the typeof guard.
    const lanesRaw: unknown = named ? way[3] : way[2];
    const maxspeedRaw: unknown = named ? way[4] : way[3];
    const lanes = typeof lanesRaw === "number" ? lanesRaw : null;
    const maxspeed = typeof maxspeedRaw === "number" ? maxspeedRaw : null;
    const name = named && typeof way[1] === "string" ? way[1] : null;
    // Only the named (current) shape can carry oneway; legacy files predate it.
    const onewayRaw: unknown = named ? way[5] : undefined;
    const oneway = typeof onewayRaw === "number" ? onewayRaw : 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      // Keep the segment if either endpoint is within the radius, and remember
      // HOW near it is so the cap can be applied radially below.
      const dA = distMi(lat, lon, a[0], a[1]);
      const dB = distMi(lat, lon, b[0], b[1]);
      const d = Math.min(dA, dB);
      if (d <= r) out.push({ seg: [cls, a[0], a[1], b[0], b[1], lanes, maxspeed, name, oneway], d });
    }
  }

  // Radial truncation. The cap used to be enforced with an early `return`
  // partway through the file, so an over-cap request kept whatever happened to
  // appear FIRST in the JSON and silently dropped everything after it. Way
  // order is arbitrary, so entire streets vanished while distant ones survived
  // — the graph lost connectivity in patches instead of degrading outward, and
  // shortest paths routed around holes that do not exist on the ground.
  //
  // Keeping the NEAREST `cap` segments makes truncation isotropic: the network
  // is complete out to some radius and empty beyond it, which is the failure
  // mode the router can reason about. Sorting is stable, so equidistant
  // segments keep file order and the result stays deterministic.
  if (out.length > cap) out.sort((x, y) => x.d - y.d);
  const kept = out.length > cap ? out.slice(0, cap) : out;
  return kept.map((s) => s.seg);
}
