/**
 * Fetch measured AADT for Madrid from the Ayuntamiento's "Histórico
 * de intensidades por puntos de medida" archive on datos.madrid.es.
 *
 * Two artifacts:
 *   1. PM location CSV (202468-22-intensidad-trafico.csv): WGS84 lon/lat
 *      for ~4,120 puntos de medida (URB = urban arterials, M30 = the
 *      ring road).
 *   2. Historical archive (208627-81-...): 71 MB zip containing a single
 *      large monthly CSV (Madrid only exposes one month at a time via
 *      static HTML — the JS-rendered catalog has more recent months but
 *      requires headless-browser scraping). The shipped snapshot is
 *      Feb 2020. Older than ideal but real measured data — annual
 *      AADT for urban arterials changes ~1–2% per year, so the order
 *      of magnitude is correct even five years later.
 *
 * AADT estimation: per PM id, average the `intensidad` field across
 * all 15-min interval rows for the month and multiply by 24 → daily
 * vehicle count. Crude (Feb has weekday-heavy weighting) but defensible
 * as a calibration baseline.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-madrid-aadt.ts
 */

import { writeFileSync, readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const PM_LOC_URL = "https://datos.madrid.es/egob/catalogo/202468-22-intensidad-trafico.csv";
const HIST_ZIP_URL = "https://datos.madrid.es/egob/catalogo/208627-81-transporte-ptomedida-historico.zip";

const SNAP_RADIUS_M = 150;
const MADRID_BBOX = { latMin: 40.32, latMax: 40.55, lonMin: -3.85, lonMax: -3.55 };

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };

async function download(url: string, file: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "madrid-aadt-"));
  const p = path.join(dir, file);
  console.log(`  fetching ${url}...`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(p, buf);
  console.log(`    → ${p} (${buf.length} bytes)`);
  return p;
}

function parsePmLocations(csvPath: string): Map<string, { lat: number; lon: number }> {
  const py = `
import sys, csv, json
out = {}
with open(sys.argv[1], encoding='latin-1') as fh:
    reader = csv.DictReader(fh, delimiter=';')
    for row in reader:
        pid = row.get('id','').strip()
        try:
            lat = float(row.get('latitud','').replace(',','.'))
            lon = float(row.get('longitud','').replace(',','.'))
        except ValueError:
            continue
        if pid and -180 <= lon <= 180 and -90 <= lat <= 90:
            out[pid] = {"lat": lat, "lon": lon}
sys.stdout.write(json.dumps(out))
`;
  const result = spawnSync("python3", ["-c", py, csvPath], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`pm parse failed: ${result.stderr}`);
  const obj = JSON.parse(result.stdout) as Record<string, { lat: number; lon: number }>;
  const out = new Map<string, { lat: number; lon: number }>();
  for (const [k, v] of Object.entries(obj)) {
    if (
      v.lat >= MADRID_BBOX.latMin &&
      v.lat <= MADRID_BBOX.latMax &&
      v.lon >= MADRID_BBOX.lonMin &&
      v.lon <= MADRID_BBOX.lonMax
    ) {
      out.set(k, v);
    }
  }
  return out;
}

function aggregateHistoryZip(zipPath: string): Map<string, number> {
  const py = `
import sys, zipfile, csv, io
from collections import defaultdict
sums = defaultdict(float)
counts = defaultdict(int)
with zipfile.ZipFile(sys.argv[1]) as zf:
    name = zf.namelist()[0]
    with zf.open(name) as raw:
        for line in io.TextIOWrapper(raw, encoding='latin-1'):
            # rough CSV parse — first 4 fields are id;fecha;tipo_elem;intensidad
            parts = line.rstrip("\\n").split(";")
            if len(parts) < 5 or parts[0] == '"id"':
                continue
            pid = parts[0].strip().strip('"')
            inten = parts[3].strip().strip('"')
            err = parts[7].strip().strip('"') if len(parts) > 7 else "N"
            if err == "S":  # error flag — skip bad readings
                continue
            try:
                v = float(inten)
            except ValueError:
                continue
            if v < 0:
                continue
            sums[pid] += v
            counts[pid] += 1
import json
out = {}
for pid, total in sums.items():
    n = counts[pid]
    if n < 96 * 7:  # at least a week of 15-min readings
        continue
    avg_hourly_extrapolated = total / n  # vph at 15-min granularity
    aadt = round(avg_hourly_extrapolated * 24)
    out[pid] = aadt
sys.stdout.write(json.dumps(out))
`;
  const result = spawnSync("python3", ["-c", py, zipPath], {
    encoding: "utf8",
    maxBuffer: 200 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`history aggregate failed: ${result.stderr}`);
  const obj = JSON.parse(result.stdout) as Record<string, number>;
  return new Map(Object.entries(obj));
}

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

async function main(): Promise<void> {
  const slug = "madrid";

  console.log("Fetching PM locations...");
  const pmPath = await download(PM_LOC_URL, "pm.csv");
  const pmLocs = parsePmLocations(pmPath);
  console.log(`  ${pmLocs.size} PMs in Madrid bbox`);

  console.log("Fetching historical intensity archive (71 MB)...");
  const zipPath = await download(HIST_ZIP_URL, "hist.zip");
  console.log("Aggregating intensities...");
  const aadtById = aggregateHistoryZip(zipPath);
  console.log(`  ${aadtById.size} PMs with AADT proxy from monthly history`);

  // Merge: counter location + AADT
  const points: Array<{ lat: number; lon: number; aadt: number }> = [];
  for (const [pid, loc] of pmLocs) {
    const a = aadtById.get(pid);
    if (a == null) continue;
    points.push({ ...loc, aadt: a });
  }
  console.log(`Points with both geometry + AADT: ${points.length}`);

  // Snap to signals
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  const aadtPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  const signals = JSON.parse(readFileSync(sigPath, "utf8")) as Array<
    [number, number, number, string | null, number]
  >;
  const existing = existsSync(aadtPath)
    ? (JSON.parse(readFileSync(aadtPath, "utf8")) as Record<string, AadtRec>)
    : {};

  let snapped = 0;
  const measured: Record<string, AadtRec> = {};
  for (const [osmId, sLat, sLon] of signals) {
    let best: { p: typeof points[number]; d: number } | null = null;
    for (const p of points) {
      const d = distM(sLat, sLon, p.lat, p.lon);
      if (d > SNAP_RADIUS_M) continue;
      if (!best || d < best.d) best = { p, d };
    }
    if (best) {
      measured[String(osmId)] = {
        aadt: best.p.aadt,
        year: 2020,
        kFactor: 9,
        distM: Math.round(best.d),
        source: "madrid_ayto_2020_02",
      };
      snapped++;
    }
  }
  console.log(`Snapped ${snapped} / ${signals.length} = ${(snapped / signals.length * 100).toFixed(1)}%`);

  const merged: Record<string, AadtRec> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (v.source === "synthetic_osm_class") merged[k] = v;
  }
  for (const [k, v] of Object.entries(measured)) merged[k] = v;
  writeFileSync(aadtPath, JSON.stringify(merged));
  console.log(`Wrote ${aadtPath} — ${Object.keys(merged).length} total (measured ${snapped})`);

  const measuredPct = Math.round((snapped / signals.length) * 1000) / 10;
  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const pattern = /(\{ code: "madrid_metro",[^}]*?)aadtPct:\s*[0-9.]+,([^}]*?)aadtSource:\s*"[^"]*",\s*aadtQuality:\s*"[^"]*",/;
  if (pattern.test(coverage)) {
    coverage = coverage.replace(
      pattern,
      `$1aadtPct: ${measuredPct},$2aadtSource: "Ayuntamiento de Madrid — Histórico de intensidades por puntos de medida (Feb 2020 snapshot)", aadtQuality: "measured",`,
    );
    writeFileSync(COVERAGE_PATH, coverage);
    console.log(`Updated madrid_metro: aadtPct=${measuredPct}%, quality=measured`);
  } else {
    console.log("! pattern miss");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
