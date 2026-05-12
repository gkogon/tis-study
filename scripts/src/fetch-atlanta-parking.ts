/**
 * Fetch every OSM `amenity=parking` feature inside the City of Sandy Springs
 * bounding box AND every dining venue in the same area, then write a compact
 * tuple-array (with each lot named for its nearest restaurant) to
 * artifacts/api-server/src/data/atlanta-parking.json.
 *
 * Tuple shape (kept short to minimize JSON size):
 *   [id, lat, lon, name|null, kind, capacity|null, fee, accessCode]
 *
 *   kind:        0=surface 1=garage 2=multi-storey 3=underground 4=street 5=other
 *   fee:         0=no 1=yes 2=unknown
 *   accessCode:  0=public 1=customer 2=permit 3=private 4=unknown
 *   capacity:    integer if OSM had a capacity tag, else null (modelled downstream)
 *   name:        derived from the closest restaurant / cafe / bar / fast-food
 *                within ~250m so every lot gets a memorable, location-anchored
 *                label like "Lot near Bagel Boys". OSM-tagged names take priority.
 *
 * Run from repo root: pnpm --filter @workspace/scripts run fetch-parking
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Sandy Springs city limits — using the actual OSM administrative polygon
// (admin_level=8) instead of a rectangle. A rectangle around Sandy Springs
// inevitably swept in Dunwoody, Chamblee, and Brookhaven (you'd see "Dunwoody
// Park & Ride" turn up in a "Sandy Springs" inventory). The `area(...)`
// filter restricts results to features actually inside the city.
const AREA_FILTER = `area["name"="Sandy Springs"]["admin_level"="8"]["boundary"="administrative"]->.ss;`;

// Max distance from a lot to a restaurant before we stop trying to name the
// lot after it. 250m ≈ 3-min walk; further than that the association becomes
// noisy.
const NAME_RADIUS_M = 250;

const OVERPASS_PARKING_QUERY = `
[out:json][timeout:120];
${AREA_FILTER}
(
  node["amenity"="parking"](area.ss);
  way["amenity"="parking"](area.ss);
  relation["amenity"="parking"](area.ss);
);
out tags center;
`.trim();

// Dining-adjacent OSM amenities we'll use as anchor names. Cafes/bars/pubs
// included so we don't end up with hundreds of unnamed lots in residential or
// office strips that lack a sit-down restaurant.
const OVERPASS_RESTAURANTS_QUERY = `
[out:json][timeout:120];
${AREA_FILTER}
(
  node["amenity"~"^(restaurant|fast_food|cafe|bar|pub|food_court|biergarten)$"]["name"](area.ss);
  way["amenity"~"^(restaurant|fast_food|cafe|bar|pub|food_court|biergarten)$"]["name"](area.ss);
);
out tags center;
`.trim();

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

async function fetchOverpass(query: string, label: string): Promise<OverpassResponse> {
  let lastErr: unknown;
  for (const ep of ENDPOINTS) {
    try {
      console.log(`[${label}] Fetching from ${ep} …`);
      const res = await fetch(ep, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "atlanta-traffic-analyzer/1.0 (parking inventory; contact: replit-app)",
          Accept: "application/json",
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as OverpassResponse;
      console.log(`  → ${json.elements.length} elements`);
      return json;
    } catch (e) {
      console.warn(`  failed: ${(e as Error).message}`);
      lastErr = e;
    }
  }
  throw new Error(`All Overpass endpoints failed. Last error: ${String(lastErr)}`);
}

// Equirectangular distance approximation in meters — accurate enough at
// neighborhood scale and ~50× faster than a full haversine.
function distMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const x = (bLon - aLon) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180) * Math.PI / 180;
  const y = (bLat - aLat) * Math.PI / 180;
  return Math.sqrt(x * x + y * y) * R;
}

interface NamedPlace {
  lat: number;
  lon: number;
  name: string;
}

function classifyKind(tags: Record<string, string>): number {
  const p = (tags.parking ?? "").toLowerCase();
  if (p === "garage") return 1;
  if (p === "multi-storey" || p === "multi_storey") return 2;
  if (p === "underground") return 3;
  if (p === "street_side" || p === "lane" || p === "on_street") return 4;
  if (p === "surface") return 0;
  if ((tags.covered ?? "").toLowerCase() === "yes") return 1;
  if ((tags.building ?? "").toLowerCase() === "parking") return 2;
  return 0;
}

function classifyFee(tags: Record<string, string>): number {
  const f = (tags.fee ?? "").toLowerCase();
  if (f === "yes" || f === "interval") return 1;
  if (f === "no") return 0;
  return 2;
}

function classifyAccess(tags: Record<string, string>): number {
  const a = (tags.access ?? "").toLowerCase();
  if (a === "yes" || a === "public" || a === "permissive") return 0;
  if (a === "customers") return 1;
  if (a === "permit" || a === "students" || a === "employees" || a === "visitors") return 2;
  if (a === "private" || a === "no" || a === "delivery" || a === "restricted") return 3;
  return 4;
}

function parseCapacity(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null;
}

function deriveName(tags: Record<string, string>): string | null {
  return tags.name ?? tags["name:en"] ?? tags.operator ?? null;
}

type ParkingTuple = [
  number,        // id (note: OSM ids are unique only within a type, so we
                 // namespace the dedupe key by type below)
  number,        // lat
  number,        // lon
  string | null, // name
  number,        // kind
  number | null, // capacity
  number,        // fee
  number,        // accessCode
];

interface PendingTuple {
  /** Composite dedupe key — OSM ids only collide within a type. */
  key: string;
  tuple: ParkingTuple;
}

// Walk up from this file to find the monorepo root (the dir containing
// pnpm-workspace.yaml). Robust whether invoked via pnpm filter or from root.
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate monorepo root (pnpm-workspace.yaml)");
}

async function main() {
  // Pull both feeds in parallel.
  const [parkingData, restaurantsData] = await Promise.all([
    fetchOverpass(OVERPASS_PARKING_QUERY, "parking"),
    fetchOverpass(OVERPASS_RESTAURANTS_QUERY, "restaurants"),
  ]);

  // Index named restaurants for nearest-neighbor lookup.
  const restaurants: NamedPlace[] = [];
  for (const el of restaurantsData.elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = tags.name ?? tags["name:en"];
    if (lat === undefined || lon === undefined || !name) continue;
    restaurants.push({ lat, lon, name });
  }
  console.log(`\nIndexed ${restaurants.length} named dining venues for lot naming.`);

  function nameForLot(tags: Record<string, string>, lat: number, lon: number): string | null {
    // Prefer an explicit OSM name on the parking feature itself.
    const own = deriveName(tags);
    if (own) return own;

    // Fall back to nearest restaurant within NAME_RADIUS_M.
    let bestDist = Infinity;
    let bestName: string | null = null;
    for (const r of restaurants) {
      const d = distMeters(lat, lon, r.lat, r.lon);
      if (d < bestDist) {
        bestDist = d;
        bestName = r.name;
      }
    }
    if (bestName && bestDist <= NAME_RADIUS_M) return `Lot near ${bestName}`;
    return null;
  }

  const pending: PendingTuple[] = [];

  for (const el of parkingData.elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;

    // Skip clearly private / no-access lots — out of scope for a public
    // demand-pressure map. Permit/customer lots are kept.
    const access = classifyAccess(tags);
    if (access === 3) continue;

    pending.push({
      // OSM ids are unique per type, NOT globally — namespace the dedupe key
      // so a node and a way that happen to share an id don't get merged.
      key: `${el.type}:${el.id}`,
      tuple: [
        el.id,
        Math.round(lat * 1e5) / 1e5,
        Math.round(lon * 1e5) / 1e5,
        nameForLot(tags, lat, lon),
        classifyKind(tags),
        parseCapacity(tags.capacity),
        classifyFee(tags),
        access,
      ],
    });
  }

  // Dedupe by (type:id). When the same exact element shows up twice (rare —
  // Overpass mirror quirk), prefer the record with an explicit OSM capacity tag.
  const byKey = new Map<string, ParkingTuple>();
  for (const { key, tuple } of pending) {
    const existing = byKey.get(key);
    if (!existing || (tuple[5] !== null && existing[5] === null)) byKey.set(key, tuple);
  }
  const final = [...byKey.values()];

  const withCapacity = final.filter((t) => t[5] !== null).length;
  const namedFromRestaurant = final.filter((t) => t[3]?.startsWith("Lot near ")).length;
  const namedFromOSM = final.filter((t) => t[3] !== null && !t[3].startsWith("Lot near ")).length;
  const byKind = final.reduce<Record<number, number>>((acc, t) => {
    acc[t[4]] = (acc[t[4]] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nTotal returned : ${parkingData.elements.length}`);
  console.log(`Kept (public)  : ${final.length}`);
  console.log(`With capacity  : ${withCapacity} (${((withCapacity / final.length) * 100).toFixed(1)}%)`);
  console.log(`Named via OSM  : ${namedFromOSM}`);
  console.log(`Named via dining: ${namedFromRestaurant}`);
  console.log(`Unnamed        : ${final.length - namedFromOSM - namedFromRestaurant}`);
  console.log(`By kind        : ${JSON.stringify(byKind)} (0=surface 1=garage 2=multi-storey 3=underground 4=street)`);

  const outPath = path.join(
    findRepoRoot(),
    "artifacts/api-server/src/data/atlanta-parking.json",
  );
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(final));
  console.log(`\n✔ Wrote ${final.length} lots → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
