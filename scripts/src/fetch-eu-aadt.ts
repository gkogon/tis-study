/**
 * Generic measured-AADT overlay fetcher for European metros whose open data
 * is reachable as a one-shot HTTP/JSON source (ArcGIS REST, OGC WFS, OGC API
 * Features, Opendatasoft, or the Norwegian Trafikkdata GraphQL).
 *
 * Mirrors fetch-toulouse-aadt.ts: pull counters (point or line geometry +
 * a daily-volume field) → filter to the metro bbox → IDW-snap to signals at
 * 150 m → merge measured over the synthetic baseline in <slug>-aadt.json →
 * rewrite the metro's metro-coverage.ts row (synthetic → measured) when the
 * snapped coverage clears MIN_MEASURED_PCT.
 *
 * Line geometry (Helsinki/Prague/Lyon-arterials/etc.) is densified to ~30 m
 * vertices so a segment's volume snaps to any nearby signal, the same trick
 * the JP census fetcher uses.
 *
 * Sources verified live 2026-06-05 (see project memory). All no-key, open.
 *
 * Run:  pnpm --filter @workspace/scripts exec tsx src/fetch-eu-aadt.ts <slug>
 *       pnpm --filter @workspace/scripts exec tsx src/fetch-eu-aadt.ts --all
 *       (add --dry to skip writing files)
 */

import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const SNAP_RADIUS_M = 150;
const DENSIFY_STEP_M = 30;
const MIN_MEASURED_PCT = 2; // below this, keep the synthetic label (still writes the overlay).
// 2% matches the existing measured floor (Berlin shipped at ~2.7%, 451 signals).

type BBox = { latMin: number; latMax: number; lonMin: number; lonMax: number };
type Kind = "arcgis" | "wfs" | "ogcapi" | "ods_hourly_sum" | "graphql_oslo" | "csv_join";

interface Cfg {
  slug: string;
  code: string;
  bbox: BBox;
  kind: Kind;
  url: string;
  geometry: "point" | "line";
  /** ordered list of volume fields; first present & positive wins */
  volumeFields?: string[];
  yearField?: string;
  sourceLabel: string;
  coverageSource: string;
  // arcgis
  where?: string;
  // wfs
  typeName?: string;
  wfsOutputFormat?: string;
  wfsVersion?: "1.0.0" | "2.0.0";
  // ods_hourly_sum
  odsHourlyCols?: string[];
  odsLatField?: string;
  odsLonField?: string;
  odsIdField?: string;
  odsWhere?: string;
  // graphql_oslo
  graphqlCounty?: number;
  // csv_join (coords CSV at `url` ⋈ volume CSV at `csvValueUrl` on odsIdField)
  csvValueUrl?: string;
  csvDayTypeField?: string;
  csvDayTypeValue?: string;
}

const HOURLY_COLS_24 = [
  "00_00_01_00", "01_00_02_00", "02_00_03_00", "03_00_04_00", "04_00_05_00", "05_00_06_00",
  "06_00_07_00", "07_00_08_00", "08_00_09_00", "09_00_10_00", "10_00_11_00", "11_00_12_00",
  "12_00_13_00", "13_00_14_00", "14_00_15_00", "15_00_16_00", "16_00_17_00", "17_00_18_00",
  "18_00_19_00", "19_00_20_00", "20_00_21_00", "21_00_22_00", "22_00_23_00", "23_00_24_00",
];

// NOTE: Spain's national DGT "Mapa de Tráfico" (mapas.fomento.gob.es) is
// motorway/ring-road IMD points — they snap to ~0% of urban signals. Useless for
// our intersection overlay. The clean urban sources are the *city* aforaments:
// Madrid (Ayuntamiento, already done) and Barcelona (Open Data BCN, below).
// Valencia's geoportal IMV is dirty (-1/0/recurring 21/42/84) — not wired.

const CONFIGS: Cfg[] = [
  // ---- OGC API Features ----
  {
    slug: "hamburg", code: "hamburg_metro",
    bbox: { latMin: 53.39, latMax: 53.74, lonMin: 9.73, lonMax: 10.32 },
    kind: "ogcapi",
    url: "https://api.hamburg.de/datasets/v1/verkehrsstaerken/collections/verkehrsstaerken_dtv_dtvw/items",
    volumeFields: ["dtv_2025", "dtv_2024", "dtv_2023", "dtv_2022"],
    geometry: "point", sourceLabel: "hamburg_geoportal_dtv",
    coverageSource: "Hamburg Geoportal (BVM) — Verkehrsstärken DTV",
  },
  // ---- ArcGIS REST ----
  {
    slug: "munich", code: "munich_metro",
    bbox: { latMin: 48.06, latMax: 48.25, lonMin: 11.36, lonMax: 11.72 },
    kind: "arcgis",
    url: "https://gisportal-stmb.bayern.de/server/rest/services/WFS/BAYSIS_Verkehrsdaten/MapServer/0",
    where: "DTV_Kfz>0", volumeFields: ["DTV_Kfz"], geometry: "point",
    sourceLabel: "baysis_svz2021",
    coverageSource: "Bayern BAYSIS — Straßenverkehrszählung SVZ 2021 (DTV Kfz)",
  },
  {
    slug: "geneva", code: "geneva_metro",
    bbox: { latMin: 46.16, latMax: 46.27, lonMin: 6.07, lonMax: 6.22 },
    kind: "arcgis",
    url: "https://vector.sitg.ge.ch/arcgis/rest/services/OTC_COMPTAGE_TRAFIC/FeatureServer/0",
    where: "TJM>0", volumeFields: ["TJM"], yearField: "TJM_ANNEE", geometry: "point",
    sourceLabel: "sitg_tjm",
    coverageSource: "SITG Genève — Comptage du trafic routier (TJM)",
  },
  {
    slug: "prague", code: "prague_metro",
    bbox: { latMin: 49.97, latMax: 50.16, lonMin: 14.30, lonMax: 14.62 },
    kind: "arcgis",
    url: "https://geoportal.rsd.cz/arcgis/rest/services/ScitaniDopravy/MapServer/3",
    where: "SV>0", volumeFields: ["SV"], geometry: "line", sourceLabel: "rsd_scitani_2020",
    coverageSource: "ŘSD ČR — Celostátní sčítání dopravy 2020 (RPDI)",
  },
  {
    // Rotterdam + The Hague share one provincial service (Zuid-Holland N-roads);
    // city-centre streets are municipal (uncovered), so this snaps the arterials/ring.
    slug: "rotterdam", code: "rotterdam_metro",
    bbox: { latMin: 51.85, latMax: 52.02, lonMin: 4.30, lonMax: 4.62 },
    kind: "arcgis",
    url: "https://geoservices.zuid-holland.nl/arcgis/rest/services/Verkeer/Verkeer_weg_intensiteit_pzh/MapServer/35",
    where: "totaal_2024>0", volumeFields: ["totaal_2024", "totaal_2025", "totaal_2023"], geometry: "line",
    sourceLabel: "pzh_verkeersintensiteit",
    coverageSource: "Provincie Zuid-Holland — Verkeersintensiteit provinciale wegen",
  },
  {
    slug: "the-hague", code: "the_hague_metro",
    bbox: { latMin: 51.96, latMax: 52.12, lonMin: 4.18, lonMax: 4.42 },
    kind: "arcgis",
    url: "https://geoservices.zuid-holland.nl/arcgis/rest/services/Verkeer/Verkeer_weg_intensiteit_pzh/MapServer/35",
    where: "totaal_2024>0", volumeFields: ["totaal_2024", "totaal_2025", "totaal_2023"], geometry: "line",
    sourceLabel: "pzh_verkeersintensiteit",
    coverageSource: "Provincie Zuid-Holland — Verkeersintensiteit provinciale wegen",
  },
  // NOTE: Valencia's geoportal layer 188 `imv` is NOT clean daily AADT — it's
  // dense with -1/0 no-data and implausible recurring 21/42/84 values (median
  // ~513 across snapped signals), an order of magnitude below real urban AADT.
  // Wiring it would inject garbage, so Valencia stays synthetic. Not wired.
  // ---- WFS ----
  {
    slug: "lyon", code: "lyon_metro",
    bbox: { latMin: 45.66, latMax: 45.83, lonMin: 4.74, lonMax: 4.95 },
    kind: "wfs", url: "https://download.data.grandlyon.com/wfs/grandlyon",
    typeName: "metropole-de-lyon:pvo_patrimoine_voirie.pvocomptagecriter",
    wfsOutputFormat: "application/json", wfsVersion: "2.0.0",
    volumeFields: ["moyennejoursouvrable"], yearField: "anneereference", geometry: "point",
    sourceLabel: "grandlyon_comptage",
    coverageSource: "Grand Lyon Métropole — Comptages tous véhicules (moyenne jour ouvrable)",
  },
  {
    slug: "copenhagen", code: "copenhagen_metro",
    bbox: { latMin: 55.60, latMax: 55.75, lonMin: 12.45, lonMax: 12.66 },
    kind: "wfs", url: "https://wfs-kbhkort.kk.dk/k101/ows",
    typeName: "k101:trafiktaelling", wfsOutputFormat: "json", wfsVersion: "1.0.0",
    volumeFields: ["aadt_koretojer"], yearField: "aar", geometry: "point",
    sourceLabel: "kk_trafiktaelling",
    coverageSource: "Københavns Kommune — Trafiktælling (AADT motorkøretøjer)",
  },
  {
    slug: "helsinki", code: "helsinki_metro",
    bbox: { latMin: 60.13, latMax: 60.27, lonMin: 24.83, lonMax: 25.15 },
    kind: "wfs", url: "https://kartta.hel.fi/ws/geoserver/avoindata/wfs",
    typeName: "avoindata:Ajoneuvoliikenne_liikennemaarat_viiva", wfsOutputFormat: "application/json",
    wfsVersion: "2.0.0", volumeFields: ["autot", "syksyn_kavl"], yearField: "lvuosi", geometry: "line",
    sourceLabel: "helsinki_liikennemaarat",
    coverageSource: "Helsinki HRI — Ajoneuvoliikenteen liikennemäärät (autot/vrk)",
  },
  // ---- Opendatasoft, 24 hourly columns summed → daily ----
  {
    slug: "bologna", code: "bologna_metro",
    bbox: { latMin: 44.42, latMax: 44.55, lonMin: 11.27, lonMax: 11.42 },
    kind: "ods_hourly_sum",
    url: "https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets/rilevazione-flusso-veicoli-tramite-spire-anno-2024/records",
    odsHourlyCols: HOURLY_COLS_24, odsLatField: "latitudine", odsLonField: "longitudine",
    odsIdField: "codice_spira", odsWhere: "data>='2024-05-13' AND data<='2024-05-19'",
    geometry: "point", sourceLabel: "bologna_spire_2024",
    coverageSource: "Comune di Bologna — Rilevazione flusso veicoli (spire, 2024)",
  },
  // ---- Two-CSV join (coords ⋈ daily value on a station id) ----
  {
    slug: "barcelona", code: "barcelona_metro",
    bbox: { latMin: 41.32, latMax: 41.47, lonMin: 2.05, lonMax: 2.23 },
    kind: "csv_join",
    url: "https://opendata-ajuntament.barcelona.cat/data/dataset/2cdafd00-e37a-424e-a524-b551cd09052d/resource/f24b813b-f7ca-44fa-98e8-62efb35e72c5/download/2024_aforament_descripcio.csv",
    csvValueUrl:
      "https://opendata-ajuntament.barcelona.cat/data/dataset/a7a093f1-56ea-4766-a4ba-d6abad68d41d/resource/5b2c39d8-2f51-4fc5-9478-a479b77f9a48/download/2024_aforament_detall_valor.csv",
    odsIdField: "Id_aforament", odsLatField: "Latitud", odsLonField: "Longitud",
    volumeFields: ["Valor_IMD"], csvDayTypeField: "Codi_tipus_dia", csvDayTypeValue: "2",
    geometry: "point", sourceLabel: "barcelona_aforaments_imd",
    coverageSource: "Open Data BCN — Aforaments de mobilitat (IMD laborables 2024)",
  },
  // ---- Norway Trafikkdata GraphQL ----
  {
    slug: "oslo", code: "oslo_metro",
    bbox: { latMin: 59.83, latMax: 60.00, lonMin: 10.65, lonMax: 10.85 },
    kind: "graphql_oslo", url: "https://trafikkdata-api.atlas.vegvesen.no/", graphqlCounty: 3,
    geometry: "point", sourceLabel: "vegvesen_adt",
    coverageSource: "Statens vegvesen — Trafikkdata ÅDT",
  },
];

// ----------------------------------------------------------------------------

type Counter = { lat: number; lon: number; aadt: number; year: number };

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

function pickVolume(props: Record<string, unknown>, fields: string[]): number | null {
  for (const f of fields) {
    const v = props[f];
    const n = typeof v === "string" ? Number(v.replace(",", ".")) : (v as number);
    if (n != null && Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

function pickYear(props: Record<string, unknown>, field: string | undefined): number {
  if (field && props[field] != null) {
    const y = Number(props[field]);
    if (Number.isFinite(y) && y > 1990 && y < 2100) return Math.round(y);
  }
  return new Date().getUTCFullYear();
}

/** Densify a polyline (lon/lat vertices) into ~DENSIFY_STEP_M-spaced points. */
function densify(vertices: Array<[number, number]>): Array<[number, number]> {
  if (vertices.length === 0) return [];
  const out: Array<[number, number]> = [vertices[0]!];
  for (let i = 1; i < vertices.length; i++) {
    const [lon1, lat1] = vertices[i - 1]!;
    const [lon2, lat2] = vertices[i]!;
    const d = distMeters(lat1, lon1, lat2, lon2);
    const steps = Math.floor(d / DENSIFY_STEP_M);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      out.push([lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t]);
    }
    out.push([lon2, lat2]);
  }
  return out;
}

/** Turn one feature (vertices + volume + year) into counters, densifying lines. */
function featureToCounters(
  vertices: Array<[number, number]>,
  aadt: number,
  year: number,
  geometry: "point" | "line",
  bbox: BBox,
): Counter[] {
  const pts = geometry === "line" ? densify(vertices) : vertices;
  const out: Counter[] = [];
  for (const [lon, lat] of pts) {
    if (lat < bbox.latMin || lat > bbox.latMax || lon < bbox.lonMin || lon > bbox.lonMax) continue;
    out.push({ lat, lon, aadt, year });
  }
  return out;
}

// ---- per-kind fetch → counters ----------------------------------------------

type RawFeature = { vertices: Array<[number, number]>; props: Record<string, unknown> };

function parseGeoJsonFeatures(json: any): RawFeature[] {
  const feats = json?.features ?? [];
  const out: RawFeature[] = [];
  for (const f of feats) {
    const g = f?.geometry;
    if (!g) continue;
    const props = f.properties ?? {};
    if (g.type === "Point") {
      out.push({ vertices: [g.coordinates as [number, number]], props });
    } else if (g.type === "LineString") {
      out.push({ vertices: g.coordinates as Array<[number, number]>, props });
    } else if (g.type === "MultiLineString") {
      for (const line of g.coordinates as Array<Array<[number, number]>>) out.push({ vertices: line, props });
    } else if (g.type === "MultiPoint") {
      for (const p of g.coordinates as Array<[number, number]>) out.push({ vertices: [p], props });
    }
  }
  return out;
}

function parseEsriFeatures(json: any): RawFeature[] {
  const feats = json?.features ?? [];
  const out: RawFeature[] = [];
  for (const f of feats) {
    const g = f?.geometry;
    const props = f.attributes ?? {};
    if (!g) continue;
    if (typeof g.x === "number" && typeof g.y === "number") {
      out.push({ vertices: [[g.x, g.y]], props });
    } else if (Array.isArray(g.paths)) {
      for (const path of g.paths as Array<Array<[number, number]>>) out.push({ vertices: path, props });
    }
  }
  return out;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": "tis-aadt-fetcher/1.0", Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url.slice(0, 160)}`);
  return res.json();
}

async function fetchArcgis(cfg: Cfg): Promise<RawFeature[]> {
  const b = cfg.bbox;
  const envelope = `${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}`;
  const out: RawFeature[] = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({
      where: cfg.where ?? "1=1",
      outFields: "*",
      outSR: "4326",
      f: "json",
      geometry: envelope,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });
    const json = await fetchJson(`${cfg.url}/query?${qs.toString()}`);
    const feats = parseEsriFeatures(json);
    out.push(...feats);
    const n = json?.features?.length ?? 0;
    if (n < pageSize) break;
    offset += pageSize;
    if (offset > 200_000) break;
  }
  return out;
}

async function fetchWfs(cfg: Cfg): Promise<RawFeature[]> {
  const out: RawFeature[] = [];
  const pageSize = 3000;
  let startIndex = 0;
  const v2 = (cfg.wfsVersion ?? "2.0.0") === "2.0.0";
  for (;;) {
    const params: Record<string, string> = {
      service: "WFS",
      version: cfg.wfsVersion ?? "2.0.0",
      request: "GetFeature",
      outputFormat: cfg.wfsOutputFormat ?? "application/json",
      srsName: "EPSG:4326",
    };
    if (v2) {
      params.typeNames = cfg.typeName!;
      params.count = String(pageSize);
      params.startIndex = String(startIndex);
    } else {
      params.typeName = cfg.typeName!;
      params.maxFeatures = String(pageSize);
      params.startIndex = String(startIndex);
    }
    const qs = new URLSearchParams(params);
    const json = await fetchJson(`${cfg.url}?${qs.toString()}`);
    const feats = parseGeoJsonFeatures(json);
    out.push(...feats);
    const n = json?.features?.length ?? 0;
    if (n < pageSize) break;
    startIndex += pageSize;
    if (startIndex > 200_000) break;
  }
  return out;
}

async function fetchOgcApi(cfg: Cfg): Promise<RawFeature[]> {
  const out: RawFeature[] = [];
  const limit = 1000;
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ f: "json", limit: String(limit), offset: String(offset) });
    const json = await fetchJson(`${cfg.url}?${qs.toString()}`);
    const feats = parseGeoJsonFeatures(json);
    out.push(...feats);
    const n = json?.features?.length ?? 0;
    if (n < limit) break;
    offset += limit;
    if (offset > 200_000) break;
  }
  return out;
}

/** Opendatasoft: page records over a date window, average the 24-col daily sum per detector. */
async function fetchOdsHourlySum(cfg: Cfg): Promise<Counter[]> {
  const cols = cfg.odsHourlyCols!;
  const byId = new Map<string, { lat: number; lon: number; sum: number; days: number }>();
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (cfg.odsWhere) qs.set("where", cfg.odsWhere);
    const json = await fetchJson(`${cfg.url}?${qs.toString()}`);
    const results = json?.results ?? [];
    for (const r of results) {
      const lat = Number(r[cfg.odsLatField!]);
      const lon = Number(r[cfg.odsLonField!]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      let daily = 0;
      for (const c of cols) {
        const v = Number(r[c]);
        if (Number.isFinite(v)) daily += v;
      }
      if (daily <= 0) continue;
      const id = String(r[cfg.odsIdField!] ?? `${lat},${lon}`);
      const prev = byId.get(id);
      if (prev) {
        prev.sum += daily;
        prev.days += 1;
      } else {
        byId.set(id, { lat, lon, sum: daily, days: 1 });
      }
    }
    if (results.length < pageSize) break;
    offset += pageSize;
    if (offset > 100_000) break;
  }
  return [...byId.values()].map((v) => ({
    lat: v.lat,
    lon: v.lon,
    aadt: Math.round(v.sum / v.days),
    year: 2024,
  }));
}

async function fetchOsloGraphql(cfg: Cfg): Promise<Counter[]> {
  const pointsQuery = `{ trafficRegistrationPoints(searchQuery:{countyNumbers:[${cfg.graphqlCounty}]}) { id location { coordinates { latLon { lat lon } } } } }`;
  const pjson = await fetchJson(cfg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: pointsQuery }),
  });
  const rawPoints: Array<{ id: string; lat: number; lon: number }> = [];
  for (const p of pjson?.data?.trafficRegistrationPoints ?? []) {
    const ll = p?.location?.coordinates?.latLon;
    if (ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lon)) {
      if (ll.lat < cfg.bbox.latMin || ll.lat > cfg.bbox.latMax || ll.lon < cfg.bbox.lonMin || ll.lon > cfg.bbox.lonMax) continue;
      rawPoints.push({ id: p.id, lat: ll.lat, lon: ll.lon });
    }
  }
  console.log(`  ${rawPoints.length} VEHICLE points in bbox; fetching ÅDT...`);

  const counters: Counter[] = [];
  const CONC = 8;
  for (let i = 0; i < rawPoints.length; i += CONC) {
    const batch = rawPoints.slice(i, i + CONC);
    const settled = await Promise.all(
      batch.map(async (pt) => {
        const q = `{ trafficData(trafficRegistrationPointId:"${pt.id}"){ volume { average { daily { byYear { year total { volume { average } } } } } } } }`;
        try {
          const j = await fetchJson(cfg.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: q }),
          });
          const years = j?.data?.trafficData?.volume?.average?.daily?.byYear ?? [];
          let best: { year: number; adt: number } | null = null;
          for (const y of years) {
            const adt = y?.total?.volume?.average;
            if (adt != null && Number.isFinite(adt) && (!best || y.year > best.year)) best = { year: y.year, adt: Math.round(adt) };
          }
          return best ? { lat: pt.lat, lon: pt.lon, aadt: best.adt, year: best.year } : null;
        } catch {
          return null;
        }
      }),
    );
    for (const c of settled) if (c) counters.push(c);
  }
  return counters;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "tis-aadt-fetcher/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${url.slice(0, 160)}`);
  return res.text();
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const rec: Record<string, string> = {};
    header.forEach((h, j) => { rec[h] = (cells[j] ?? "").trim(); });
    out.push(rec);
  }
  return out;
}

/** Join a coords CSV (url) to a daily-value CSV (csvValueUrl) on odsIdField, averaging the value. */
async function fetchCsvJoin(cfg: Cfg): Promise<Counter[]> {
  const coords = new Map<string, { lat: number; lon: number }>();
  for (const r of parseCsv(await fetchText(cfg.url))) {
    const id = r[cfg.odsIdField!]?.trim();
    const lat = Number(r[cfg.odsLatField!]);
    const lon = Number(r[cfg.odsLonField!]);
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    coords.set(id, { lat, lon });
  }
  const field = cfg.volumeFields![0]!;
  const agg = new Map<string, { sum: number; n: number }>();
  for (const r of parseCsv(await fetchText(cfg.csvValueUrl!))) {
    if (cfg.csvDayTypeField && r[cfg.csvDayTypeField] !== cfg.csvDayTypeValue) continue;
    const id = r[cfg.odsIdField!]?.trim();
    const v = Number(r[field]);
    if (!id || !Number.isFinite(v) || v <= 0) continue;
    const a = agg.get(id) ?? { sum: 0, n: 0 };
    a.sum += v;
    a.n += 1;
    agg.set(id, a);
  }
  const b = cfg.bbox;
  const out: Counter[] = [];
  for (const [id, a] of agg) {
    const c = coords.get(id);
    if (!c) continue;
    if (c.lat < b.latMin || c.lat > b.latMax || c.lon < b.lonMin || c.lon > b.lonMax) continue;
    out.push({ lat: c.lat, lon: c.lon, aadt: Math.round(a.sum / a.n), year: 2024 });
  }
  return out;
}

async function fetchCounters(cfg: Cfg): Promise<Counter[]> {
  if (cfg.kind === "ods_hourly_sum") return fetchOdsHourlySum(cfg);
  if (cfg.kind === "graphql_oslo") return fetchOsloGraphql(cfg);
  if (cfg.kind === "csv_join") return fetchCsvJoin(cfg);
  let feats: RawFeature[];
  if (cfg.kind === "arcgis") feats = await fetchArcgis(cfg);
  else if (cfg.kind === "wfs") feats = await fetchWfs(cfg);
  else feats = await fetchOgcApi(cfg);

  const counters: Counter[] = [];
  for (const f of feats) {
    const aadt = pickVolume(f.props, cfg.volumeFields ?? []);
    if (aadt == null) continue;
    const year = pickYear(f.props, cfg.yearField);
    counters.push(...featureToCounters(f.vertices, aadt, year, cfg.geometry, cfg.bbox));
  }
  return counters;
}

// ---- snap + write -----------------------------------------------------------

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };

function snapWeighted(
  counters: Counter[],
  signals: Array<[number, number, number]>,
  source: string,
): Record<string, AadtRec> {
  const out: Record<string, AadtRec> = {};
  for (const [osmId, sLat, sLon] of signals) {
    const within: Array<{ aadt: number; d: number; year: number }> = [];
    for (const c of counters) {
      const d = distMeters(sLat, sLon, c.lat, c.lon);
      if (d <= SNAP_RADIUS_M) within.push({ aadt: c.aadt, d, year: c.year });
    }
    if (within.length === 0) continue;
    within.sort((a, b) => a.d - b.d);
    let aadt: number;
    if (within.length === 1) {
      aadt = within[0]!.aadt;
    } else {
      let wSum = 0;
      let wTot = 0;
      for (const w of within) {
        const eff = Math.max(w.d, 5);
        const wt = 1 / (eff * eff);
        wSum += w.aadt * wt;
        wTot += wt;
      }
      aadt = Math.round(wSum / wTot);
    }
    out[String(osmId)] = { aadt, year: within[0]!.year, kFactor: 9, distM: Math.round(within[0]!.d), source };
  }
  return out;
}

function rewriteCoverage(code: string, pct: number, sourceText: string): boolean {
  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const pattern = new RegExp(
    `(\\{ code: "${code}",[^}]*?)aadtPct:\\s*[0-9.]+,([^}]*?)aadtSource:\\s*"[^"]*",([^}]*?)aadtQuality:\\s*"[^"]*",`,
  );
  if (!pattern.test(coverage)) {
    console.log(`  ! coverage pattern miss for ${code} — update manually`);
    return false;
  }
  coverage = coverage.replace(
    pattern,
    `$1aadtPct: ${pct},$2aadtSource: "${sourceText}",$3aadtQuality: "measured",`,
  );
  writeFileSync(COVERAGE_PATH, coverage);
  return true;
}

async function runCity(cfg: Cfg, dry: boolean): Promise<void> {
  console.log(`\n=== ${cfg.slug} (${cfg.kind}) ===`);
  const counters = await fetchCounters(cfg);
  console.log(`  ${counters.length} counter points in bbox`);
  if (counters.length === 0) {
    console.log(`  ✗ no counters — skipping`);
    return;
  }

  const sigPath = path.resolve(DATA_DIR, `${cfg.slug}-signals.json`);
  const signals = (JSON.parse(readFileSync(sigPath, "utf8")) as Array<[number, number, number, ...unknown[]]>).map(
    ([id, lat, lon]) => [id, lat, lon] as [number, number, number],
  );

  const measured = snapWeighted(counters, signals, cfg.sourceLabel);
  const nMeasured = Object.keys(measured).length;
  const pct = Math.round((nMeasured / signals.length) * 1000) / 10;
  const distinctAadt = [...new Set(Object.values(measured).map((m) => m.aadt))];
  const median = distinctAadt.length
    ? [...Object.values(measured).map((m) => m.aadt)].sort((a, b) => a - b)[Math.floor(nMeasured / 2)]
    : 0;
  console.log(`  snapped ${nMeasured}/${signals.length} = ${pct}%  (median AADT ~${median})`);

  if (dry) {
    console.log(`  [dry] would write ${nMeasured} measured entries; coverage flip=${pct >= MIN_MEASURED_PCT}`);
    return;
  }

  const aadtPath = path.resolve(DATA_DIR, `${cfg.slug}-aadt.json`);
  const existing = JSON.parse(readFileSync(aadtPath, "utf8")) as Record<string, AadtRec>;
  const merged: Record<string, AadtRec> = {};
  for (const [k, v] of Object.entries(existing)) if (v.source === "synthetic_osm_class") merged[k] = v;
  for (const [k, v] of Object.entries(measured)) merged[k] = v;
  writeFileSync(aadtPath, JSON.stringify(merged));
  console.log(`  wrote ${cfg.slug}-aadt.json: ${Object.keys(merged).length} total (measured ${nMeasured})`);

  if (pct >= MIN_MEASURED_PCT) {
    const text = `${cfg.coverageSource} (IDW @150m, ${counters.length} pts)`;
    if (rewriteCoverage(cfg.code, pct, text)) console.log(`  ✓ ${cfg.code}: aadtPct=${pct}% quality=measured`);
  } else {
    console.log(`  ⊙ ${pct}% < ${MIN_MEASURED_PCT}% — overlay written, coverage left synthetic`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const all = args.includes("--all");
  const slugs = args.filter((a) => !a.startsWith("--"));
  const targets = all ? CONFIGS : CONFIGS.filter((c) => slugs.includes(c.slug));
  if (targets.length === 0) {
    console.error(`No matching slug. Available: ${CONFIGS.map((c) => c.slug).join(", ")}`);
    process.exit(1);
  }
  for (const cfg of targets) {
    try {
      await runCity(cfg, dry);
    } catch (e) {
      console.error(`  ✗ ${cfg.slug} failed: ${(e as Error).message}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
