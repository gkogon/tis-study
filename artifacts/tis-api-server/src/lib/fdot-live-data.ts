/**
 * FDOT Transportation Data and Analytics (TDA) live-data adapter.
 *
 * Pulls per-intersection (and per-site) live AADT, lane count, functional
 * classification, and SHS membership from the FDOT public ArcGIS REST
 * endpoints catalogued in `REGIONAL-SPECS/florida-tis-spec.md` §7.
 *
 * Endpoints (all anonymous, no API key, ~1,000 record page limit):
 *   - AADT (current):  RCI_Layers/FeatureServer/0
 *   - Functional Class: RCI_Layers/FeatureServer/3
 *   - State Highway System: RCI_Layers/FeatureServer/15
 *   - Access Management Class (Rule 14-97):
 *       services1.arcgis.com/.../Access_Management_TDA/FeatureServer/0
 *
 * Each per-intersection query is a `geometry=POINT&distance=RADIUS_M&
 * units=esriSRUnit_Meter` spatial buffer that returns the closest segment
 * polyline. We pick the row with the smallest reported distance (or the
 * first row when ArcGIS ranks them itself) and stash the AADT / LANES /
 * FUNCLASS / ACMANCLS values on the intersection in place.
 *
 * Failure mode: any error / timeout returns the intersection unchanged —
 * the FL renderer's existing prose surfaces "verify against Florida Traffic
 * Online" in that case so a network outage never breaks the PDF.
 *
 * Concurrency: bounded at MAX_CONCURRENT to respect the polite-use norm on
 * the FDOT shared ArcGIS instance.
 */

const RCI_AADT_URL = "https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer/0/query";
const RCI_FUNCLASS_URL = "https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer/3/query";
const RCI_SHS_URL = "https://gis.fdot.gov/arcgis/rest/services/RCI_Layers/FeatureServer/15/query";
const ACMAN_URL = "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Access_Management_TDA/FeatureServer/0/query";

const REQUEST_TIMEOUT_MS = 6_000;
const TOTAL_BUDGET_MS = 30_000;
const MAX_CONCURRENT = 4;
const DEFAULT_SEARCH_RADIUS_M = 60;
/**
 * Progressive search radii (m). The 60-m default catches direct-on-segment
 * intersections; 200 m catches the common case where the intersection point
 * sits in the median or a parallel frontage road; 500 m is the last-resort
 * fallback for sparse rural corridors where the nearest RCI vertex may be
 * several seconds of arc away. Each step is tried in order and the first
 * with a returned feature wins; this fills the previously-documented gap
 * where off-segment intersections silently returned no FDOT data.
 */
const PROGRESSIVE_RADII_M = [60, 200, 500];

export type FdotSegmentSnapshot = {
  /** RCI roadway ID (8-digit string, e.g., "86010000"). */
  roadway: string | null;
  /** Begin/end mileposts for the matched RCI segment. */
  beginPost: number | null;
  endPost: number | null;
  /** Current-year AADT from RCI_Layers/0. */
  aadt: number | null;
  /** AADT year. */
  aadtYear: number | null;
  /** AADT flag (R = roadway count, etc. — RCI Feature 121 codes). */
  aadtFlag: string | null;
  /** K factor (peak-hour fraction of AADT). */
  kFactor: number | null;
  /** D factor (directional split). */
  dFactor: number | null;
  /** Truck percentage. */
  truckPct: number | null;
  /** FDOT district number (1-7, or 8 = Turnpike). */
  fdotDistrict: number | null;
  /** County name (DOT spelling). */
  county: string | null;
  /** Functional Classification code (RCI Feature 121 — 01-19). */
  funClassCode: string | null;
  /** SHS membership ("Y" / "N" or null). */
  onShs: boolean | null;
  /** Access management class (Rule 14-97, code 00-07 or 99). */
  accessClass: string | null;
  /** Which progressive radius (m) returned the match. Populated by fetchSegmentProgressive. */
  matchedRadiusM?: number;
};

type Intersection = {
  latitude?: number | string | null;
  longitude?: number | string | null;
  fdotSnapshot?: FdotSegmentSnapshot;
  // Mirror fields the FL renderer reads directly without traversing
  // fdotSnapshot — keeps the existing table-row code path unchanged.
  existingAadt?: number | null;
  aadt?: number | null;
  aadtYear?: number | null;
  funClassDesc?: string | null;
  accessClass?: string | null;
};

type ArcGisFeature = {
  attributes?: Record<string, unknown>;
  geometry?: unknown;
};

/**
 * Public entry point — enrich each intersection in place with the closest
 * FDOT RCI segment's AADT / lane count / functional class / SHS / access
 * class. Mutates the input array; returns count of intersections enriched.
 */
export async function enrichFdotIntersections(
  intersections: Intersection[],
): Promise<number> {
  if (!intersections.length) return 0;
  const start = Date.now();
  let enriched = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < intersections.length) {
      if (Date.now() - start > TOTAL_BUDGET_MS) return;
      const idx = cursor++;
      const it = intersections[idx];
      const lat = Number(it.latitude ?? NaN);
      const lon = Number(it.longitude ?? NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      try {
        const snap = await fetchSegmentProgressive(lat, lon);
        if (!snap) continue;
        it.fdotSnapshot = snap;
        if (snap.aadt != null) {
          if (it.existingAadt == null) it.existingAadt = snap.aadt;
          if (it.aadt == null) it.aadt = snap.aadt;
        }
        if (snap.aadtYear != null && it.aadtYear == null) it.aadtYear = snap.aadtYear;
        if (snap.accessClass != null && it.accessClass == null) it.accessClass = snap.accessClass;
        enriched++;
      } catch {
        // fail-open: leave the intersection unchanged
      }
    }
  };

  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, intersections.length) }, () => worker());
  await Promise.all(workers);
  return enriched;
}

/**
 * Site-level snapshot — fetches the closest segment to the site itself.
 * Used by the FL renderer §4 to anchor the existing-conditions narrative.
 */
export async function fetchFdotSiteSnapshot(
  lat: number,
  lon: number,
): Promise<FdotSegmentSnapshot | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  try {
    return await fetchSegmentProgressive(lat, lon);
  } catch {
    return null;
  }
}

/**
 * Try each progressive radius in turn; return the first that yields a row.
 * The returned snapshot includes the radius that worked so the renderer can
 * disclose whether the match was direct (60 m) or an inferred wider buffer.
 */
async function fetchSegmentProgressive(
  lat: number,
  lon: number,
): Promise<FdotSegmentSnapshot | null> {
  for (const radius of PROGRESSIVE_RADII_M) {
    const snap = await fetchSegmentSnapshot(lat, lon, radius);
    if (snap) {
      snap.matchedRadiusM = radius;
      return snap;
    }
  }
  return null;
}

// ─── one segment fetch ──────────────────────────────────────────────────────

async function fetchSegmentSnapshot(
  lat: number,
  lon: number,
  radiusM: number,
): Promise<FdotSegmentSnapshot | null> {
  // Run AADT + funclass + SHS + access-class in parallel — they share the
  // same RCI key (ROADWAY + BEGIN_POST + END_POST). We pick the closest
  // segment per layer and report the union.
  const [aadtAttr, funAttr, shsAttr, acmanAttr] = await Promise.all([
    queryNearestFeature(RCI_AADT_URL, lat, lon, radiusM),
    queryNearestFeature(RCI_FUNCLASS_URL, lat, lon, radiusM),
    queryNearestFeature(RCI_SHS_URL, lat, lon, radiusM),
    queryNearestFeature(ACMAN_URL, lat, lon, radiusM),
  ]);

  if (!aadtAttr && !funAttr && !shsAttr && !acmanAttr) return null;

  return {
    roadway: asStr(aadtAttr?.ROADWAY ?? funAttr?.ROADWAY ?? shsAttr?.ROADWAY ?? acmanAttr?.ROADWAY),
    beginPost: asNum(aadtAttr?.BEGIN_POST ?? funAttr?.BEGIN_POST ?? shsAttr?.BEGIN_POST),
    endPost: asNum(aadtAttr?.END_POST ?? funAttr?.END_POST ?? shsAttr?.END_POST),
    aadt: asNum(aadtAttr?.AADT),
    aadtYear: asNum(aadtAttr?.YEAR_),
    aadtFlag: asStr(aadtAttr?.AADTFLG),
    kFactor: asNum(aadtAttr?.KFCTR),
    dFactor: asNum(aadtAttr?.DFCTR),
    truckPct: asNum(aadtAttr?.TFCTR),
    fdotDistrict: asNum(aadtAttr?.DISTRICT ?? funAttr?.DISTRICT ?? shsAttr?.DISTRICT),
    county: asStr(aadtAttr?.COUNTY ?? funAttr?.COUNTY ?? shsAttr?.COUNTY),
    funClassCode: asStr(funAttr?.FUNCLASS),
    onShs: shsAttr ? Boolean(shsAttr.STATEXPT) : null,
    accessClass: asStr(acmanAttr?.ACMANCLS),
  };
}

async function queryNearestFeature(
  endpoint: string,
  lat: number,
  lon: number,
  radiusM: number,
): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusM),
    units: "esriSRUnit_Meter",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: "5",
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${endpoint}?${params.toString()}`, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) return null;
  const json = (await resp.json()) as { features?: ArcGisFeature[]; error?: unknown };
  if (json.error) return null;
  const features = json.features ?? [];
  if (features.length === 0) return null;
  // ArcGIS does not return distance with the default query — first feature
  // is "any intersecting"; we pick the one with the largest AADT when
  // present (proxy for the primary route through the intersection) or
  // simply the first row.
  let best = features[0]?.attributes ?? null;
  let bestAadt = asNum(best?.AADT) ?? -1;
  for (let i = 1; i < features.length; i++) {
    const a = features[i].attributes ?? null;
    const v = asNum(a?.AADT) ?? -1;
    if (v > bestAadt) { best = a; bestAadt = v; }
  }
  return best;
}

function asNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

// ─── SERPM regional travel-demand-model volumes ─────────────────────────────
// FDOT District 4 SERPM (Southeast Florida Regional Planning Model) loaded
// networks, published as PUBLIC ArcGIS FeatureServer layers (endpoint + fields
// verified live 2026-07-01). Layer 0 = base-year network, Layer 7 = future-year
// network; each carries link-level daily + peak-hour volumes (VOL_DA / VOL_AM /
// VOL_PM …) as polylines. Covers the Palm Beach / Broward / Miami-Dade D4-D6
// region. No auth, no licensed model run — the published loaded network itself.
const SERPM_BASE_URL =
  "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/D4_Travel_Demand_Models/FeatureServer/0/query";
const SERPM_FUTURE_URL =
  "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/D4_Travel_Demand_Models/FeatureServer/7/query";
/** Adopted SERPM 9.62 network years (base / horizon). */
export const SERPM_BASE_YEAR = 2020;
export const SERPM_FUTURE_YEAR = 2050;

export type SerpmVolumes = {
  baseDaily: number | null;
  basePm: number | null;
  futureDaily: number | null;
  futurePm: number | null;
};

/** Nearest primary SERPM link within `radiusM` of the point (highest daily
 * volume in the buffer = the through arterial). Returns null on any error. */
async function querySerpmLink(
  url: string,
  lat: number,
  lon: number,
  radiusM: number,
): Promise<{ da: number | null; pm: number | null } | null> {
  const params = new URLSearchParams({
    where: "VOL_DA>0",
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusM),
    units: "esriSRUnit_Meter",
    outFields: "VOL_DA,VOL_PM",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: "10",
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${url}?${params.toString()}`, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) return null;
  const json = (await resp.json()) as { features?: ArcGisFeature[]; error?: unknown };
  if (json.error) return null;
  const features = json.features ?? [];
  if (features.length === 0) return null;
  let best = features[0]?.attributes ?? null;
  let bestDa = asNum(best?.VOL_DA) ?? -1;
  for (let i = 1; i < features.length; i++) {
    const a = features[i].attributes ?? null;
    const v = asNum(a?.VOL_DA) ?? -1;
    if (v > bestDa) { best = a; bestDa = v; }
  }
  if (!best) return null;
  return { da: asNum(best.VOL_DA), pm: asNum(best.VOL_PM) };
}

/** Base + horizon SERPM model volumes for the nearest link to a coordinate. */
export async function fetchSerpmVolumes(lat: number, lon: number): Promise<SerpmVolumes | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const RADIUS_M = 200;
  try {
    const [base, future] = await Promise.all([
      querySerpmLink(SERPM_BASE_URL, lat, lon, RADIUS_M).catch(() => null),
      querySerpmLink(SERPM_FUTURE_URL, lat, lon, RADIUS_M).catch(() => null),
    ]);
    if (!base && !future) return null;
    return {
      baseDaily: base?.da ?? null,
      basePm: base?.pm ?? null,
      futureDaily: future?.da ?? null,
      futurePm: future?.pm ?? null,
    };
  } catch {
    return null;
  }
}

/** Enrich each study intersection with its nearest SERPM link volumes.
 * Mutates the array (sets `it.serpm`); returns the count enriched. Fail-open,
 * concurrency- and time-budget-bounded exactly like enrichFdotIntersections. */
export async function enrichSerpmIntersections(intersections: Intersection[]): Promise<number> {
  if (!intersections.length) return 0;
  const start = Date.now();
  let enriched = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < intersections.length) {
      if (Date.now() - start > TOTAL_BUDGET_MS) return;
      const idx = cursor++;
      const it = intersections[idx];
      const lat = Number(it.latitude ?? NaN);
      const lon = Number(it.longitude ?? NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      try {
        const v = await fetchSerpmVolumes(lat, lon);
        if (v && (v.baseDaily != null || v.futureDaily != null)) {
          (it as unknown as Record<string, unknown>).serpm = v;
          enriched++;
        }
      } catch {
        // fail-open: leave the intersection unchanged
      }
    }
  };
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, intersections.length) }, () => worker());
  await Promise.all(workers);
  return enriched;
}

// ─── FDOT TMSCOUNT continuous / short count-station hourly volumes ───────────
// Measured per-direction hourly counts at FDOT telemetered + short-count sites,
// published PUBLIC (endpoint + fields verified live 2026-07-01). One row per
// station (COSITE) + direction (DIR) + count date (BEGDATE) carrying HR1..HR24
// hourly volumes, TOTVOL, PEAKHR/PEAKVOL, TRUCKS. Gives the real COLLECTED
// peak-hour + daily volumes on the study roadways (Caltran Table 4) where a
// count station falls near a study segment. Coverage = monitored segments, not
// every signalized intersection.
const TMSCOUNT_URL =
  "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Traffic_TMSCOUNT_TDA/FeatureServer/0/query";

export type TmsCountVolumes = {
  cosite: string | null;
  countYear: number | null;
  amPeak2way: number | null; // 08:00 hour, summed across the station's directions
  pmPeak2way: number | null; // 17:00 hour, summed across the station's directions
  daily2way: number | null; // sum of the station's directional day totals
  directions: number; // directional records rolled up
};

/** Nearest count station within `radiusM`: the station (COSITE) with the
 * highest daily total in the buffer, summed across its directional rows. */
async function queryTmsCountStation(lat: number, lon: number, radiusM: number): Promise<TmsCountVolumes | null> {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusM),
    units: "esriSRUnit_Meter",
    outFields: "COSITE,DIR,HR8,HR17,TOTVOL,BEGDATE",
    returnGeometry: "false",
    orderByFields: "BEGDATE DESC",
    f: "json",
    resultRecordCount: "50",
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${TMSCOUNT_URL}?${params.toString()}`, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) return null;
  const json = (await resp.json()) as { features?: ArcGisFeature[]; error?: unknown };
  if (json.error) return null;
  const feats = json.features ?? [];
  if (feats.length === 0) return null;
  // Group directional rows by station; keep the most recent count per (COSITE,
  // DIR) since orderBy BEGDATE DESC puts newest first.
  const byStation = new Map<string, Record<string, unknown>[]>();
  const seenDir = new Set<string>();
  for (const f of feats) {
    const a = f.attributes ?? {};
    const cosite = asStr(a.COSITE);
    if (!cosite) continue;
    const dirKey = `${cosite}|${asStr(a.DIR) ?? ""}`;
    if (seenDir.has(dirKey)) continue; // newest count for this direction already taken
    seenDir.add(dirKey);
    let arr = byStation.get(cosite);
    if (!arr) { arr = []; byStation.set(cosite, arr); }
    arr.push(a);
  }
  let best: { cosite: string; rows: Record<string, unknown>[]; total: number } | null = null;
  for (const [cosite, rows] of byStation) {
    const total = rows.reduce((s, a) => s + (asNum(a.TOTVOL) ?? 0), 0);
    if (!best || total > best.total) best = { cosite, rows, total };
  }
  if (!best) return null;
  const am = best.rows.reduce((s, a) => s + (asNum(a.HR8) ?? 0), 0);
  const pm = best.rows.reduce((s, a) => s + (asNum(a.HR17) ?? 0), 0);
  const beg = asNum(best.rows[0]?.BEGDATE);
  const yr = beg != null ? new Date(beg).getUTCFullYear() : NaN;
  return {
    cosite: best.cosite,
    countYear: Number.isFinite(yr) ? yr : null,
    amPeak2way: am > 0 ? am : null,
    pmPeak2way: pm > 0 ? pm : null,
    daily2way: best.total > 0 ? best.total : null,
    directions: best.rows.length,
  };
}

/** Collected peak-hour + daily volumes at the nearest FDOT count station. */
export async function fetchTmsCount(lat: number, lon: number): Promise<TmsCountVolumes | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const radius of [400, 800, 1600]) {
    try {
      const v = await queryTmsCountStation(lat, lon, radius);
      if (v) return v;
    } catch {
      // widen and retry
    }
  }
  return null;
}

/** Enrich each study intersection with its nearest FDOT count-station volumes.
 * Mutates the array (sets `it.tmscount`); fail-open, budget-bounded. */
export async function enrichTmsCountIntersections(intersections: Intersection[]): Promise<number> {
  if (!intersections.length) return 0;
  const start = Date.now();
  let enriched = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < intersections.length) {
      if (Date.now() - start > TOTAL_BUDGET_MS) return;
      const idx = cursor++;
      const it = intersections[idx];
      const lat = Number(it.latitude ?? NaN);
      const lon = Number(it.longitude ?? NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      try {
        const v = await fetchTmsCount(lat, lon);
        if (v && (v.daily2way != null || v.pmPeak2way != null)) {
          (it as unknown as Record<string, unknown>).tmscount = v;
          enriched++;
        }
      } catch {
        // fail-open
      }
    }
  };
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, intersections.length) }, () => worker());
  await Promise.all(workers);
  return enriched;
}

/**
 * Decode the FUNCLASS code (RCI Feature 121) into a human label for the
 * FL renderer prose. Codes per FDOT RCI Handbook Feature 121.
 */
export function decodeFdotFunClass(code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    "01": "Rural Principal Arterial - Interstate",
    "02": "Rural Principal Arterial - Other",
    "06": "Rural Minor Arterial",
    "07": "Rural Major Collector",
    "08": "Rural Minor Collector",
    "09": "Rural Local",
    "11": "Urban Principal Arterial - Interstate",
    "12": "Urban Principal Arterial - Other Freeway / Expressway",
    "14": "Urban Principal Arterial - Other",
    "16": "Urban Minor Arterial",
    "17": "Urban Collector",
    "19": "Urban Local",
  };
  return map[code] ?? `FUNCLASS ${code}`;
}

/**
 * Decode the ACMANCLS code (RCI Feature 146 / Rule 14-97) into a label.
 */
export function decodeFdotAccessClass(code: string | null): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    "01": "Class 1 — Limited Access (Interstate / Turnpike)",
    "02": "Class 2 — Principal Arterial, undeveloped",
    "03": "Class 3 — Principal Arterial, low / probable change",
    "04": "Class 4 — Principal/Minor Arterial, low / probable change (non-restrictive)",
    "05": "Class 5 — Minor Arterial, extensively developed",
    "06": "Class 6 — Minor Arterial / Collector, extensively developed (non-restrictive)",
    "07": "Class 7 — Urban arterial / collector, max-intensity, low-speed",
    "99": "Unclassified — interim Rule 14-97.004(1) standards apply",
  };
  return map[code] ?? `ACMANCLS ${code}`;
}
