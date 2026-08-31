/**
 * FHWA TMAS — national continuous-count-station hourly volumes.
 *
 * WHY THIS SOURCE. A 2026-08-31 survey of state open-data portals found the
 * same wall the signal-timing survey hit: states publish AADT *summaries*, not
 * hourly bins. NJ's feed is AADT-only and stale since 2024-03; Maryland's is
 * AADT-only; Connecticut's is a non-tabular map layer. Hourly data is the
 * exception (NYC DOT, FDOT) — or it comes through TMAS, where every state
 * highway agency reports its continuous-count stations to FHWA. 49 states
 * report, which is one adapter for every market this product serves.
 *
 * TWO SOURCES, JOINED. The volume dataset has no coordinates; the NTAD stations
 * layer has no volumes.
 *   volume   data.transportation.gov / kv7k-jsg5 (Socrata, one dataset per year)
 *   stations NTAD_Travel_Monitoring_Analysis_System_Stations (ArcGIS)
 *
 * ⚠️ THE JOIN LOOKS BROKEN AND ISN'T. Exact string match yields ZERO overlap:
 * the volume set zero-pads station_id to six characters ("001001") and the
 * stations layer does not ("1001", "36006", "MC1507"). Normalising leading
 * zeros on both sides matched 173 of 175 Oregon stations. Verified empirically
 * before this script was written; do not "simplify" it back to ===.
 *
 * ⚠️ SCALE. One Georgia station is 69,432 rows for 2023 (2 directions x 4 lanes
 * x ~8,700 hours), and Georgia has 231 stations — 16M rows for one state. Two
 * bounds keep this sane:
 *   1. Only stations inside a served region's bounds are kept (1,187 of 1,928
 *      across the ten target states).
 *   2. Only a THREE-DAY midweek window is ingested, and lanes are summed
 *      server-side by Socrata. That is not a shortcut — a 48-to-72-hour midweek
 *      count is exactly how short-term traffic counts are conventionally taken,
 *      so `sampleDays` stays honest at 3 and every printed peak is a real
 *      measured hour rather than a synthesised average.
 *
 * WINDOW. Tue/Wed/Thu 2023-10-03..05. Day-of-week coding was verified against
 * the real calendar (1=Sun … 7=Sat), not assumed.
 *
 * ⚠️ TIMEZONE. Bins are written as true UTC derived from each station's LOCAL
 * time. The reader buckets local hours with a per-region zone
 * (atrTimeZoneForRegion) — without that, a California 08:00 peak read in
 * Eastern lands at 11:00 and misses the AM window entirely.
 *
 * ⚠️ NEW JERSEY reports no TMAS volume (FIPS 34 returns zero rows) even though
 * NJ stations appear in the stations layer. It is excluded here rather than
 * silently returning nothing.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-atr-tmas.ts --dry
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-atr-tmas.ts --state=GA
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-atr-tmas.ts
 */
import { type InsertAtrCount } from "@workspace/db";
import { REGIONS } from "../../artifacts/tis-api-server/src/lib/regions";
import { BATCH_INSERT_SIZE, upsertAtrBatch } from "./lib/atr-upsert";

export const TMAS_SOURCE = "fhwa_tmas";

/** Ten states in scope. NJ deliberately absent — see the header. */
const STATE_FIPS: Record<string, string> = {
  GA: "13", FL: "12", TX: "48", CA: "06", NY: "36",
  PA: "42", MD: "24", NC: "37", SC: "45",
};

/** Where a state's own feed is fresher, TMAS is redundant. */
const SKIP_HAVE_BETTER_FEED: Record<string, string> = {
  NY: "nyc_dot_atr covers NYC through 2026-02; TMAS's latest year is 2023",
  FL: "fdot_tda is a rolling 365-day window; TMAS's latest year is 2023",
};

const STATIONS_URL =
  "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/"
  + "NTAD_Travel_Monitoring_Analysis_System_Stations/FeatureServer/0/query";
const VOLUME_HOST = "https://data.transportation.gov/resource/kv7k-jsg5.json";

const WINDOW = { year: 2023, month: 10, days: ["3", "4", "5"] };

/** TMG direction codes. Odd = cardinal, even = the diagonal between them. */
const DIRECTION: Record<string, string> = {
  "1": "NB", "2": "NEB", "3": "EB", "4": "SEB",
  "5": "SB", "6": "SWB", "7": "WB", "8": "NWB",
};

/** IANA zone per state, with the two straddling exceptions handled by region. */
const TZ_BY_STATE: Record<string, string> = {
  CA: "America/Los_Angeles", TX: "America/Chicago",
};
const TZ_BY_REGION: Record<string, string> = {
  el_paso_metro: "America/Denver", pensacola_metro: "America/Chicago",
};

type Station = { id: string; padded: string; lat: number; lon: number; region: string; tz: string };

/** Normalise both ID spellings to a comparable key. See the header warning. */
const normId = (s: string): string => s.trim().replace(/^0+/, "") || "0";

function boundsOf(r: any): { latMin: number; latMax: number; lonMin: number; lonMax: number } {
  const b = r.bounds;
  return { latMin: b.latMin, latMax: b.latMax, lonMin: b.lonMin, lonMax: b.lonMax };
}

/** Served regions for a state, largest-last so a metro wins over a statewide box. */
function regionsForState(state: string): Array<{ code: string; b: ReturnType<typeof boundsOf> }> {
  return (Object.values(REGIONS) as any[])
    .filter((r) => r.stateCode === state)
    .map((r) => ({ code: r.code, b: boundsOf(r) }))
    .sort((a, z) => {
      const area = (x: any) => (x.b.latMax - x.b.latMin) * (x.b.lonMax - x.b.lonMin);
      return area(a) - area(z);
    });
}

async function fetchJson(url: string, attempts = 3): Promise<any> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const j = await r.json();
      // ArcGIS reports failures with HTTP 200 and an error body.
      if (j && typeof j === "object" && "error" in j) {
        throw new Error(`ArcGIS error: ${(j as any).error?.message ?? "unknown"}`);
      }
      return j;
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Stations in a state that fall inside a served region's bounds. */
async function stationsForState(state: string): Promise<Station[]> {
  const url = `${STATIONS_URL}?where=${encodeURIComponent(`state='${state}'`)}`
    + `&outFields=Station_Id,state,latitude,longitude&returnGeometry=false`
    + `&resultRecordCount=2000&f=json`;
  const j = await fetchJson(url);
  const regions = regionsForState(state);
  const out: Station[] = [];
  for (const f of j.features ?? []) {
    const a = f.attributes ?? {};
    const lat = Number(a.latitude);
    const lon = Number(a.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const hit = regions.find((r) =>
      lat >= r.b.latMin && lat <= r.b.latMax && lon >= r.b.lonMin && lon <= r.b.lonMax);
    if (!hit) continue;
    const id = normId(String(a.Station_Id ?? ""));
    if (id === "0") continue;
    out.push({
      id,
      padded: String(a.Station_Id ?? "").trim(),
      lat, lon,
      region: hit.code,
      tz: TZ_BY_REGION[hit.code] ?? TZ_BY_STATE[state] ?? "America/New_York",
    });
  }
  return out;
}

/**
 * Local wall-clock -> UTC instant for an IANA zone, without a tz library.
 * Formats the candidate instant back in the target zone and corrects by the
 * observed error, which converges in one pass for whole-hour offsets.
 */
function localHourToUtc(y: number, mo: number, d: number, hour: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, hour, 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const seen = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour));
  return new Date(guess + (Date.UTC(y, mo - 1, d, hour) - seen));
}

/** Volume rows for one state, lanes summed server-side, midweek window only. */
async function volumeForState(state: string): Promise<any[]> {
  const fips = STATE_FIPS[state];
  const where = `state_cd='${fips}' AND year='${WINDOW.year}' AND month='${WINDOW.month}' `
    + `AND day in (${WINDOW.days.map((d) => `'${d}'`).join(",")})`;
  const rows: any[] = [];
  const PAGE = 50_000;
  for (let offset = 0; ; offset += PAGE) {
    const url = `${VOLUME_HOST}?$select=${encodeURIComponent("station_id,direction,day,hours,sum(veh_count) as vol")}`
      + `&$where=${encodeURIComponent(where)}`
      + `&$group=${encodeURIComponent("station_id,direction,day,hours")}`
      + `&$order=${encodeURIComponent("station_id,direction,day,hours")}`
      + `&$limit=${PAGE}&$offset=${offset}`;
    const page = await fetchJson(url);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const only = argv.find((a) => a.startsWith("--state="))?.split("=")[1]?.toUpperCase();
  const includeCovered = argv.includes("--include-covered");

  const states = Object.keys(STATE_FIPS)
    .filter((s) => (only ? s === only : true))
    .filter((s) => (includeCovered || only === s ? true : !SKIP_HAVE_BETTER_FEED[s]));

  console.log(`ingest-atr-tmas: window ${WINDOW.year}-${WINDOW.month} days ${WINDOW.days.join("/")} `
    + `(Tue/Wed/Thu), states=${states.join(",")}, dry=${dry}`);
  for (const [s, why] of Object.entries(SKIP_HAVE_BETTER_FEED)) {
    if (!states.includes(s)) console.log(`  skipping ${s}: ${why}`);
  }

  let grandRows = 0;
  let grandStations = 0;
  for (const state of states) {
    const stations = await stationsForState(state);
    const byId = new Map(stations.map((s) => [s.id, s]));
    process.stdout.write(`  ${state}: ${stations.length} stations in served regions… `);
    if (stations.length === 0) { console.log("nothing to do"); continue; }

    const vol = await volumeForState(state);
    const mapped: InsertAtrCount[] = [];
    let unmatched = 0;
    for (const v of vol) {
      const st = byId.get(normId(String(v.station_id ?? "")));
      if (!st) { unmatched++; continue; }
      const hour = Number(String(v.hours ?? "").split(":")[0]);
      const day = Number(v.day);
      const n = Number(v.vol);
      if (!Number.isFinite(hour) || !Number.isFinite(day) || !Number.isFinite(n) || n < 0) continue;
      mapped.push({
        source: TMAS_SOURCE,
        // Station ids repeat across states ("000001" exists in many), so the
        // segment key MUST carry the state or two states collide on the
        // (source, segment, direction, occurred_at) unique index.
        sourceRequestId: `${state}-${st.id}-${WINDOW.year}${WINDOW.month}${v.day}`,
        sourceSegmentId: `${state}-${st.id}`,
        occurredAt: localHourToUtc(WINDOW.year, WINDOW.month, day, hour, st.tz),
        durationMinutes: 60,
        vol: n,
        // The stations layer carries no road name — only an id, a functional
        // class and a point. A null here left the rendered "Segment" column as
        // an em-dash on every TMAS row, which is useless to a reviewer trying to
        // look the station up. The station id IS the lookup key in FHWA's own
        // published tables, so print that.
        street: `CCS station ${state}-${st.id}`,
        fromStreet: null,
        toStreet: null,
        direction: DIRECTION[String(v.direction)] ?? String(v.direction),
        borough: st.region,
        latitude: st.lat,
        longitude: st.lon,
      });
    }
    console.log(`${vol.length.toLocaleString()} volume rows -> ${mapped.length.toLocaleString()} bins`
      + (unmatched ? ` (${unmatched.toLocaleString()} outside served regions)` : ""));

    for (let i = 0; i < mapped.length; i += BATCH_INSERT_SIZE) {
      await upsertAtrBatch(mapped.slice(i, i + BATCH_INSERT_SIZE), dry);
    }
    grandRows += mapped.length;
    grandStations += new Set(mapped.map((m) => m.sourceSegmentId)).size;
  }

  console.log(`ingest-atr-tmas: stations=${grandStations} rows=${grandRows.toLocaleString()} dry=${dry}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("ingest-atr-tmas FAILED:", e);
  process.exit(1);
});
