/**
 * Fetch measured AADT for Berlin from the Senate's "Verkehrsdetektion"
 * archive hosted at https://api.viz.berlin.de/daten/verkehrsdetektion/
 * (Azure Blob backing storage at mdhopendata.blob.core.windows.net).
 *
 * Two artifacts feed this:
 *   1. Stammdaten_Verkehrsdetektion_2022_07_20.xlsx — counter master list
 *      with WGS84 lon/lat per detector, plus the MQ_ID15 (cross-section
 *      ID) that groups multiple-lane detectors at the same point.
 *   2. {year}/alte_qualitaetssicherung/Messquerschnitte/mq_hr_{year}_{mm}.csv.gz
 *      — hourly aggregated cross-section flow (q_kfz_mq_hr = all
 *      motor vehicles per hour). Public, dl-de-by-2.0 license.
 *
 * AADT estimation:
 *   - For a sample month (default Oct 2024, ~1.2 MB gzipped), sum
 *     q_kfz_mq_hr per mq_name across the month → monthly totals.
 *   - Annual estimate = monthly_total / days_in_month (= avg daily).
 *     Berlin doesn't publish per-counter AADT directly so a single-
 *     month proxy is the closest thing to an apples-to-apples
 *     comparison with the other measured-AADT cities.
 *
 * Output: berlin-aadt.json overlays the synthetic baseline with
 * source: "berlin_senat_2024_10" for snapped signals.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-berlin-aadt.ts
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

const STAMM_URL =
  "https://mdhopendata.blob.core.windows.net/verkehrsdetektion/Stammdaten_Verkehrsdetektion_2022_07_20.xlsx";
const MONTH_YEAR = "2024";
const MONTH_NUM = "10"; // October 2024
const DAYS_IN_MONTH = 31;
const HOURS_FILE_URL = `https://mdhopendata.blob.core.windows.net/verkehrsdetektion/${MONTH_YEAR}/alte_qualitaetssicherung/Messquerschnitte/mq_hr_${MONTH_YEAR}_${MONTH_NUM}.csv.gz`;

const SNAP_RADIUS_M = 150;

const BERLIN_BBOX = { latMin: 52.34, latMax: 52.68, lonMin: 13.08, lonMax: 13.76 };

type CounterRec = { mqId: string; lat: number; lon: number };
type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };

async function downloadToTmp(url: string, filename: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "berlin-aadt-"));
  const outPath = path.join(dir, filename);
  console.log(`  fetching ${url}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  console.log(`    → ${outPath} (${buf.length} bytes)`);
  return outPath;
}

function parseStammXlsx(filePath: string): CounterRec[] {
  // Use Python's openpyxl (shipped with macOS dev tools) — avoid a TS
  // xlsx dep just for one file. Output: JSON to stdout.
  const py = `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.active
out = []
header = None
for i, row in enumerate(ws.iter_rows(values_only=True)):
    if i == 0:
        header = list(row)
        continue
    rec = dict(zip(header, row))
    # MQ_KURZNAME (e.g. "TE001") is what the hourly CSV uses as mq_name;
    # MQ_ID15 is the long-form 15-digit ID, not in the hourly archive.
    mq = rec.get('MQ_KURZNAME')
    lon = rec.get('LÄNGE (WGS84)')
    lat = rec.get('BREITE (WGS84)')
    if mq and isinstance(lon,(int,float)) and isinstance(lat,(int,float)):
        out.append({"mqId": str(mq), "lat": lat, "lon": lon})
sys.stdout.write(json.dumps(out))
`;
  const result = spawnSync("python3", ["-c", py, filePath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`python parse failed: ${result.stderr}`);
  const arr = JSON.parse(result.stdout) as Array<{ mqId: string; lat: number; lon: number }>;
  // Dedupe to one entry per MQ_ID15 (multiple lane detectors share location).
  const byId = new Map<string, CounterRec>();
  for (const r of arr) if (!byId.has(r.mqId)) byId.set(r.mqId, r);
  return [...byId.values()].filter(
    (r) =>
      r.lat >= BERLIN_BBOX.latMin &&
      r.lat <= BERLIN_BBOX.latMax &&
      r.lon >= BERLIN_BBOX.lonMin &&
      r.lon <= BERLIN_BBOX.lonMax,
  );
}

async function parseHourlyGzip(filePath: string): Promise<Map<string, number>> {
  // Aggregate q_kfz_mq_hr per mq_name across the whole month.
  // gunzip → CSV stream; semicolon delimiter, German number format.
  console.log("  decompressing + aggregating monthly hourly file...");
  const py = `
import sys, gzip, csv
totals = {}
hours = {}
with gzip.open(sys.argv[1], 'rt', encoding='utf-8') as fh:
    reader = csv.DictReader(fh, delimiter=';')
    for row in reader:
        mq = row.get('mq_name','').strip()
        q = row.get('q_kfz_mq_hr','').strip()
        qual = row.get('qualitaet','1').strip()
        if not mq or not q: continue
        try:
            qf = float(qual.replace(',','.'))
            if qf < 0.75: continue
            v = float(q.replace(',','.'))
        except ValueError:
            continue
        if v < 0: continue
        totals[mq] = totals.get(mq, 0.0) + v
        hours[mq] = hours.get(mq, 0) + 1
out = {mq: {"sum": totals[mq], "hours": hours[mq]} for mq in totals}
import json
sys.stdout.write(json.dumps(out))
`;
  const result = spawnSync("python3", ["-c", py, filePath], { encoding: "utf8", maxBuffer: 200 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`python aggregate failed: ${result.stderr}`);
  const data = JSON.parse(result.stdout) as Record<string, { sum: number; hours: number }>;
  const aadtMap = new Map<string, number>();
  for (const [mq, v] of Object.entries(data)) {
    if (v.hours < 24 * 7) continue; // need at least a week of good data
    // AADT proxy: scale full month → AADT (monthly veh count ÷ days_in_month)
    // Adjust for partial coverage: actualDays = hours/24
    const actualDays = v.hours / 24;
    if (actualDays < 7) continue;
    const aadt = Math.round(v.sum / actualDays);
    aadtMap.set(mq, aadt);
  }
  console.log(`  ${aadtMap.size} cross-sections with AADT proxy from ${MONTH_YEAR}-${MONTH_NUM}`);
  return aadtMap;
}

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

async function main(): Promise<void> {
  const slug = "berlin";
  console.log("Fetching Stammdaten...");
  const stammPath = await downloadToTmp(STAMM_URL, "stamm.xlsx");
  const counters = parseStammXlsx(stammPath);
  console.log(`  ${counters.length} distinct MQs in Berlin bbox`);

  console.log("Fetching hourly archive...");
  const hourlyPath = await downloadToTmp(HOURS_FILE_URL, `mq_hr_${MONTH_YEAR}_${MONTH_NUM}.csv.gz`);
  const aadtById = await parseHourlyGzip(hourlyPath);

  // Merge counter geometry + AADT
  const points: Array<{ lat: number; lon: number; aadt: number }> = [];
  for (const c of counters) {
    const a = aadtById.get(c.mqId);
    if (a == null) continue;
    points.push({ lat: c.lat, lon: c.lon, aadt: a });
  }
  console.log(`Counters with both geometry + AADT: ${points.length}`);

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
        year: parseInt(MONTH_YEAR, 10),
        kFactor: 9,
        distM: Math.round(best.d),
        source: `berlin_senat_${MONTH_YEAR}_${MONTH_NUM}`,
      };
      snapped++;
    }
  }
  console.log(`Snapped ${snapped} / ${signals.length} = ${(snapped / signals.length * 100).toFixed(1)}%`);

  // Merge with synthetic fallback
  const merged: Record<string, AadtRec> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (v.source === "synthetic_osm_class") merged[k] = v;
  }
  for (const [k, v] of Object.entries(measured)) merged[k] = v;
  writeFileSync(aadtPath, JSON.stringify(merged));
  console.log(`Wrote ${aadtPath} — ${Object.keys(merged).length} total (measured ${snapped}, synthetic ${Object.keys(merged).length - snapped})`);

  // Update metro-coverage.ts
  const measuredPct = Math.round((snapped / signals.length) * 1000) / 10;
  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const pattern = /(\{ code: "berlin_metro",[^}]*?)aadtPct:\s*[0-9.]+,([^}]*?)aadtSource:\s*"[^"]*",\s*aadtQuality:\s*"[^"]*",/;
  if (pattern.test(coverage)) {
    coverage = coverage.replace(
      pattern,
      `$1aadtPct: ${measuredPct},$2aadtSource: "Berlin Senat Verkehrsdetektion (hourly cross-section archive, ${MONTH_YEAR}-${MONTH_NUM})", aadtQuality: "measured",`,
    );
    writeFileSync(COVERAGE_PATH, coverage);
    console.log(`Updated berlin_metro: aadtPct=${measuredPct}%, quality=measured`);
  } else {
    console.log("! pattern miss");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
