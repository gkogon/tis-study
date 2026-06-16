/**
 * Transit route adapter — returns bus/rail stops and route names within
 * walking distance of a study site. Used by the FL / GA / multi-state TIS
 * renderers to populate the §11 Transit / Multimodal section with the same
 * level of agency-named-route detail that Caltran's HCA Westside Hospital
 * TIS surfaced ("Broward County Transit bus routes 02, 22, 30, and 81
 * along NW 84th Avenue").
 *
 * Two-tier source chain (both fail-open):
 *
 *   1. Transit.land v2 REST (preferred) — clean GTFS-derived data when
 *      `TRANSIT_LAND_API_KEY` is set in the environment. Free tier: 1k
 *      requests / day per key.
 *      https://www.transit.land/documentation/index/api
 *
 *   2. OSM Overpass API (fallback) — anonymous, no key, used when (a) no
 *      Transit.land key is set, OR (b) Transit.land errored / timed out.
 *      Overpass returns `network`, `operator`, and `route_ref` tags from
 *      bus_stop nodes; route detail is patchier than GTFS but covers every
 *      US transit agency uniformly.
 *
 * Fails open: any error returns `null` and the renderer falls through to
 * the previous "transit service should be verified" placeholder.
 *
 * Design choices:
 *   - 0.25-mile search radius matches CEQR Technical Manual walkshed
 *     convention; the FL MTSIH 2024 does not prescribe a transit search
 *     radius, so we adopt the conservative US-default.
 *   - Both adapters bounded by 8 s; the whole pre-compute pass is capped
 *     so a slow Overpass mirror cannot block PDF rendering.
 *   - Returned routes are grouped by agency so the renderer can emit
 *     Caltran-style prose ("BCT routes 02, 22, 30, and 81 along ...").
 */

const TRANSIT_LAND_BASE = "https://transit.land/api/v2/rest";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_SEARCH_RADIUS_MI = 0.25;

const MI_PER_DEG_LAT = 69.0;
const M_PER_MI = 1609.344;

export type TransitStop = {
  /** Display name from GTFS stop_name or OSM `name` tag. */
  stopName: string;
  /** GTFS agency name or OSM `network` tag (e.g., "Broward County Transit", "MARTA"). */
  agency: string | null;
  /** Route short names this stop serves (e.g., ["02", "22", "30", "81"]). */
  routeRefs: string[];
  /** Travel mode: "bus" | "rail" | "tram" | "subway" | "unknown" */
  mode: string;
  /** Distance from site in miles. */
  distanceMi: number;
};

export type TransitContext = {
  /** Search radius applied. */
  radiusMi: number;
  /** Stops within radius, sorted nearest-first. */
  stops: TransitStop[];
  /** Routes by agency, deduplicated and sorted (for §11 prose). */
  routesByAgency: Record<string, string[]>;
  /** Source actually used. */
  source: "transit_land" | "osm_overpass";
};

/**
 * Top-level entry point. Tries Transit.land first when a key is set,
 * falls back to Overpass. Returns null only if both sources return
 * nothing useful (or both error).
 */
export async function getTransitContext(
  lat: number,
  lon: number,
  radiusMi: number = DEFAULT_SEARCH_RADIUS_MI,
): Promise<TransitContext | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const haveKey = Boolean(process.env.TRANSIT_LAND_API_KEY);
  if (haveKey) {
    try {
      const ctx = await fetchTransitLand(lat, lon, radiusMi);
      if (ctx && ctx.stops.length > 0) return ctx;
    } catch {
      // fall through to Overpass
    }
  }
  try {
    return await fetchOverpass(lat, lon, radiusMi);
  } catch {
    return null;
  }
}

// ─── Transit.land v2 REST ───────────────────────────────────────────────────

type TLandStop = {
  stop_id?: string;
  stop_name?: string;
  geometry?: { coordinates?: [number, number] };
  route_stops?: Array<{
    route?: { route_short_name?: string; route_long_name?: string; route_type?: number; agency?: { agency_name?: string } };
  }>;
};

async function fetchTransitLand(
  lat: number,
  lon: number,
  radiusMi: number,
): Promise<TransitContext | null> {
  const radiusM = Math.round(radiusMi * M_PER_MI);
  const key = process.env.TRANSIT_LAND_API_KEY!;
  const url = `${TRANSIT_LAND_BASE}/stops?lat=${lat}&lon=${lon}&radius=${radiusM}&include_routes=true&limit=50&apikey=${key}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error(`transit.land status ${resp.status}`);
  const json = (await resp.json()) as { stops?: TLandStop[] };
  const stops: TransitStop[] = [];
  const routesByAgency = new Map<string, Set<string>>();

  for (const s of json.stops ?? []) {
    const coords = s.geometry?.coordinates;
    if (!coords || coords.length !== 2) continue;
    const stopLon = Number(coords[0]);
    const stopLat = Number(coords[1]);
    if (!Number.isFinite(stopLat) || !Number.isFinite(stopLon)) continue;
    const distanceMi = haversineMi(lat, lon, stopLat, stopLon);
    if (distanceMi > radiusMi) continue;

    const refs = new Set<string>();
    let agency: string | null = null;
    let mode = "unknown";
    for (const rs of s.route_stops ?? []) {
      const r = rs.route;
      if (!r) continue;
      const name = (r.route_short_name?.trim() || r.route_long_name?.trim() || "").trim();
      if (name) refs.add(name);
      if (!agency && r.agency?.agency_name) agency = r.agency.agency_name;
      if (mode === "unknown") mode = routeTypeToMode(r.route_type);
    }
    if (refs.size === 0) continue;

    stops.push({
      stopName: s.stop_name?.trim() ?? "Unnamed stop",
      agency,
      routeRefs: Array.from(refs).sort(naturalCompare),
      mode,
      distanceMi: Number(distanceMi.toFixed(3)),
    });

    if (agency) {
      const bucket = routesByAgency.get(agency) ?? new Set<string>();
      for (const ref of refs) bucket.add(ref);
      routesByAgency.set(agency, bucket);
    }
  }

  stops.sort((a, b) => a.distanceMi - b.distanceMi);
  return {
    radiusMi,
    stops,
    routesByAgency: Object.fromEntries(
      Array.from(routesByAgency.entries()).map(([k, v]) => [k, Array.from(v).sort(naturalCompare)]),
    ),
    source: "transit_land",
  };
}

function routeTypeToMode(rt: number | undefined): string {
  // GTFS route_type — https://developers.google.com/transit/gtfs/reference#routestxt
  switch (rt) {
    case 0: return "tram";
    case 1: return "subway";
    case 2: return "rail";
    case 3: return "bus";
    case 4: return "ferry";
    case 5: return "cable_tram";
    case 6: return "aerial";
    case 7: return "funicular";
    case 11: return "trolleybus";
    case 12: return "monorail";
    default: return "unknown";
  }
}

// ─── OSM Overpass fallback ──────────────────────────────────────────────────

type OverpassNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};

type OverpassRelation = {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members?: Array<{ type: "node" | "way" | "relation"; ref: number; role?: string }>;
};

type OverpassElement = OverpassNode | OverpassRelation;

async function fetchOverpass(
  lat: number,
  lon: number,
  radiusMi: number,
): Promise<TransitContext | null> {
  const radiusM = Math.round(radiusMi * M_PER_MI);
  // Two-stage Overpass query:
  //   1. Get stop nodes within radius (bus_stop / platform / stop_position
  //      / railway station).
  //   2. Get route relations (type=route, route=bus|tram|train|subway) that
  //      contain those stop nodes as members. The relation's `ref` tag is
  //      the route number — this fills the gap where stop nodes don't
  //      carry a `route_ref` tag (very common in OSM).
  //
  // `rel(bn.stops)` selects relations referenced by the stop nodes. We
  // emit both stops AND relations in one response so a single round-trip
  // returns the full picture.
  const q = `[out:json][timeout:25];
(
  node["highway"="bus_stop"](around:${radiusM},${lat},${lon});
  node["public_transport"="platform"](around:${radiusM},${lat},${lon});
  node["public_transport"="stop_position"](around:${radiusM},${lat},${lon});
  node["railway"="station"](around:${radiusM},${lat},${lon});
)->.stops;
.stops out body;
rel(bn.stops)["type"="route"]["route"~"^(bus|tram|train|subway|light_rail|trolleybus|monorail|ferry)$"];
out body;`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(q)}`,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error(`overpass status ${resp.status}`);
  const json = (await resp.json()) as { elements?: OverpassElement[] };

  // Partition: collect stops, then build a stop_id → [route_ref, agency]
  // index from route relations.
  const stopsRaw: OverpassNode[] = [];
  const routeRels: OverpassRelation[] = [];
  for (const el of json.elements ?? []) {
    if (el.type === "node") stopsRaw.push(el);
    else if (el.type === "relation") routeRels.push(el);
  }

  // Index: stop_node_id → Set<routeRef>, and stop_node_id → agency.
  // A single stop is often served by multiple routes; multi-agency too.
  const stopIdToRefs = new Map<number, Set<string>>();
  const stopIdToAgencies = new Map<number, Set<string>>();
  const stopIdToMode = new Map<number, string>();
  for (const rel of routeRels) {
    const rt = rel.tags ?? {};
    const ref = (rt.ref ?? rt.name ?? "").trim();
    const agency = (rt.network ?? rt.operator ?? "").trim();
    const mode = rt.route ?? "unknown";
    if (!ref) continue;
    for (const m of rel.members ?? []) {
      if (m.type !== "node") continue;
      if (!stopIdToRefs.has(m.ref)) stopIdToRefs.set(m.ref, new Set());
      stopIdToRefs.get(m.ref)!.add(ref);
      if (agency) {
        if (!stopIdToAgencies.has(m.ref)) stopIdToAgencies.set(m.ref, new Set());
        stopIdToAgencies.get(m.ref)!.add(agency);
      }
      if (!stopIdToMode.has(m.ref)) stopIdToMode.set(m.ref, mode);
    }
  }

  const stops: TransitStop[] = [];
  const routesByAgency = new Map<string, Set<string>>();
  const seenNames = new Set<string>();

  for (const el of stopsRaw) {
    const t = el.tags ?? {};
    const name = (t.name ?? "").trim();
    if (!name) continue;
    const key = `${name}:${Math.round(el.lat * 1000)}:${Math.round(el.lon * 1000)}`;
    if (seenNames.has(key)) continue;
    seenNames.add(key);

    const distanceMi = haversineMi(lat, lon, el.lat, el.lon);
    if (distanceMi > radiusMi) continue;

    // Merge route refs: from the stop's own tag AND from any route relations
    // that include this stop. Relation-derived refs are usually richer.
    const refs = new Set<string>(parseRouteRefs(t.route_ref ?? t["route_ref:bus"] ?? ""));
    for (const r of stopIdToRefs.get(el.id) ?? []) refs.add(r);

    // Agency: prefer the stop's own tag, fall back to the relation's.
    let agency = pickAgency(t);
    if (!agency) {
      const relAgencies = stopIdToAgencies.get(el.id);
      if (relAgencies && relAgencies.size > 0) {
        agency = Array.from(relAgencies)[0];
      }
    }

    let mode = inferOsmMode(t);
    if (mode === "unknown") {
      const relMode = stopIdToMode.get(el.id);
      if (relMode) mode = relMode;
    }

    stops.push({
      stopName: name,
      agency,
      routeRefs: Array.from(refs).sort(naturalCompare),
      mode,
      distanceMi: Number(distanceMi.toFixed(3)),
    });

    if (agency) {
      const bucket = routesByAgency.get(agency) ?? new Set<string>();
      for (const r of refs) bucket.add(r);
      routesByAgency.set(agency, bucket);
    }
  }

  stops.sort((a, b) => a.distanceMi - b.distanceMi);
  return {
    radiusMi,
    stops,
    routesByAgency: Object.fromEntries(
      Array.from(routesByAgency.entries()).map(([k, v]) => [k, Array.from(v).sort(naturalCompare)]),
    ),
    source: "osm_overpass",
  };
}

function pickAgency(t: Record<string, string>): string | null {
  const a = (t.network ?? t.operator ?? "").trim();
  return a.length > 0 ? a : null;
}

function inferOsmMode(t: Record<string, string>): string {
  if (t.railway === "station") return "rail";
  if (t.subway === "yes") return "subway";
  if (t.tram === "yes") return "tram";
  if (t.bus === "yes" || t.highway === "bus_stop") return "bus";
  return "unknown";
}

function parseRouteRefs(raw: string): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw.split(/[;,]/).map((s) => s.trim()).filter(Boolean),
    ),
  ).sort(naturalCompare);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return MI_PER_DEG_LAT * (c * 180 / Math.PI);
}

/** "02" before "10" before "100" (handles BCT-style padded route names). */
function naturalCompare(a: string, b: string): number {
  const an = Number(a), bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return a.localeCompare(b);
}
