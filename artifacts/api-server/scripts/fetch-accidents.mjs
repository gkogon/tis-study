// Fetch real Atlanta-metro crash data (2019-2023) from the Atlanta Regional
// Commission's public ArcGIS feature service, plus NHTSA FARS Georgia hourly
// distribution. Snap each crash to its nearest signal within 100m using a
// grid-hash spatial index and bake aggregates into atlanta-accidents.json.
//
// Usage: node artifacts/api-server/scripts/fetch-accidents.mjs
//
// Output schema (atlanta-accidents.json):
// {
//   meta: { fetchedAt, sourceCollisions, sourceFARS, totalCrashes,
//           snappedCrashes, snappedPct, signalsWithData, dateRange },
//   perSignal: { [osmId]: [crashes, fatal, seriousInj, severityScoreSum] },
//   hourly: number[24],   // global hour-of-day distribution (FARS-derived)
//   dow:    number[7],    // global day-of-week distribution (1=Sun..7=Sat from FARS)
//   monthly:number[12]    // global month distribution
// }

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIGNALS_PATH = resolve(__dirname, "../src/data/atlanta-signals.json");
const OUT_PATH = resolve(__dirname, "../src/data/atlanta-accidents.json");

const COLLISIONS_URL =
  "https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/Regional_High_Injury_Network_WFL1/FeatureServer/0/query";
const FARS_URL =
  "https://services3.arcgis.com/xpR2E2r2KmCE5hF3/arcgis/rest/services/FatalMotorVehicleAccidents/FeatureServer/0/query";

const BATCH = 2000;
const CONCURRENCY = 3;
const SNAP_RADIUS_M = 100;
const CHECKPOINT_PATH = resolve(__dirname, "../src/data/.atlanta-accidents-progress.json");
const CHECKPOINT_EVERY_BATCHES = 25;

// ---------- spatial index over the signal set ----------

function loadSignals() {
  const raw = JSON.parse(readFileSync(SIGNALS_PATH, "utf8"));
  // SignalTuple v2: [osm_id, lat, lon, name|null, roadClass]
  return raw.map((t) => ({ id: t[0], lat: t[1], lon: t[2] }));
}

// ~111m per 0.001 degrees of latitude; longitude varies but at ~33.7°N it's ~93m per 0.001°.
// A 0.001° cell is roughly 100x90m which is ideal for our 100m snap radius.
const CELL = 0.001;

function cellKey(lat, lon) {
  return `${Math.floor(lat / CELL)}|${Math.floor(lon / CELL)}`;
}

function buildIndex(signals) {
  const grid = new Map(); // cellKey -> array of signal indices
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    const k = cellKey(s.lat, s.lon);
    let bucket = grid.get(k);
    if (!bucket) {
      bucket = [];
      grid.set(k, bucket);
    }
    bucket.push(i);
  }
  return grid;
}

// Haversine distance in meters
function distM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestSignal(grid, signals, lat, lon, maxM) {
  if (lat == null || lon == null) return -1;
  const cy = Math.floor(lat / CELL);
  const cx = Math.floor(lon / CELL);
  let best = -1;
  let bestD = maxM;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = grid.get(`${cy + dy}|${cx + dx}`);
      if (!bucket) continue;
      for (const idx of bucket) {
        const s = signals[idx];
        const d = distM(lat, lon, s.lat, s.lon);
        if (d < bestD) {
          bestD = d;
          best = idx;
        }
      }
    }
  }
  return best;
}

// ---------- batch fetcher with concurrency ----------

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": "atlanta-traffic-preprocess/1.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json();
}

async function fetchCollisionCount() {
  const u = `${COLLISIONS_URL}?where=1%3D1&returnCountOnly=true&f=json`;
  const j = await fetchJSON(u);
  return j.count;
}

function buildCollisionUrl(offset) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "Lat,Long,Crash_Year,KABCO,ServerityScore,F__Serious_Injuries,F__of_Fatalities_per_Crash",
    f: "json",
    resultRecordCount: String(BATCH),
    resultOffset: String(offset),
    returnGeometry: "false",
    orderByFields: "OBJECTID",
  });
  return `${COLLISIONS_URL}?${params}`;
}

async function fetchBatch(offset, attempt = 1) {
  try {
    const j = await fetchJSON(buildCollisionUrl(offset));
    return j.features || [];
  } catch (e) {
    if (attempt >= 4) throw e;
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return fetchBatch(offset, attempt + 1);
  }
}

async function runWithConcurrency(items, n, worker, onProgress) {
  let i = 0;
  let done = 0;
  const results = new Array(items.length);
  async function pump() {
    while (i < items.length) {
      const my = i++;
      results[my] = await worker(items[my], my);
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: n }, pump));
  return results;
}

// ---------- main ----------

async function main() {
  console.log("Loading signals...");
  const signals = loadSignals();
  console.log(`  ${signals.length} signals.`);
  const grid = buildIndex(signals);
  console.log(`  ${grid.size} grid cells indexed.`);

  console.log("\nFetching ARC Collisions count...");
  const total = await fetchCollisionCount();
  console.log(`  ${total} collisions in source dataset.`);

  // Build a fingerprint of the source configuration. If anything material
  // about the source changes (URL, batch size, snap radius, total record
  // count, signal set), the prior checkpoint is stale and unsafe to reuse.
  const sigFingerprint = createHash("sha1")
    .update(`${signals.length}|${grid.size}`)
    .digest("hex")
    .slice(0, 12);
  const fingerprint = JSON.stringify({
    v: 2,
    collisionsUrl: COLLISIONS_URL,
    farsUrl: FARS_URL,
    batch: BATCH,
    snapRadiusM: SNAP_RADIUS_M,
    total,
    sigFingerprint,
  });

  // Per-signal accumulators: [crashes, fatal, seriousInj, severityScoreSum]
  const perSignal = new Map();
  let snapped = 0;
  let unsnapped = 0;
  let badCoords = 0;
  const yearCounts = new Map();
  const completedOffsets = new Set();

  // Resume from a partial checkpoint if it matches the current fingerprint.
  try {
    const ck = JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8"));
    if (ck.fingerprint !== fingerprint) {
      console.log(`  ignoring stale checkpoint (fingerprint mismatch — source dataset changed)`);
      try { unlinkSync(CHECKPOINT_PATH); } catch { /* ignore */ }
    } else {
      for (const [k, v] of Object.entries(ck.perSignal)) perSignal.set(Number(k), v);
      snapped = ck.snapped; unsnapped = ck.unsnapped; badCoords = ck.badCoords;
      for (const o of ck.completedOffsets) completedOffsets.add(o);
      for (const [y, n] of ck.yearCounts) yearCounts.set(y, n);
      console.log(`  resuming from checkpoint: ${completedOffsets.size} batches done, ${snapped} snapped`);
    }
  } catch {
    // no checkpoint — fresh run
  }

  function saveCheckpoint() {
    const obj = {
      fingerprint,
      perSignal: Object.fromEntries(perSignal),
      snapped, unsnapped, badCoords,
      completedOffsets: [...completedOffsets],
      yearCounts: [...yearCounts.entries()],
    };
    writeFileSync(CHECKPOINT_PATH, JSON.stringify(obj));
  }

  const offsets = [];
  for (let o = 0; o < total; o += BATCH) {
    if (!completedOffsets.has(o)) offsets.push(o);
  }

  const startedAt = Date.now();
  let lastLog = startedAt;
  let batchesSinceCheckpoint = 0;
  await runWithConcurrency(offsets, CONCURRENCY, async (offset) => {
    const features = await fetchBatch(offset);
    for (const f of features) {
      const a = f.attributes;
      const lat = a.Lat;
      const lon = a.Long;
      if (typeof lat !== "number" || typeof lon !== "number" || lat === 0 || lon === 0) {
        badCoords++;
        continue;
      }
      const idx = nearestSignal(grid, signals, lat, lon, SNAP_RADIUS_M);
      if (idx < 0) {
        unsnapped++;
        continue;
      }
      snapped++;
      const sig = signals[idx];
      let acc = perSignal.get(sig.id);
      if (!acc) {
        acc = [0, 0, 0, 0];
        perSignal.set(sig.id, acc);
      }
      acc[0] += 1;
      acc[1] += a.F__of_Fatalities_per_Crash || 0;
      acc[2] += a.F__Serious_Injuries || 0;
      acc[3] += a.ServerityScore || 0;
      const y = a.Crash_Year;
      if (y) yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
    }
    completedOffsets.add(offset);
    batchesSinceCheckpoint++;
    if (batchesSinceCheckpoint >= CHECKPOINT_EVERY_BATCHES) {
      saveCheckpoint();
      batchesSinceCheckpoint = 0;
    }
  }, (done, totalBatches) => {
    const now = Date.now();
    if (now - lastLog > 3000 || done === totalBatches) {
      const pct = ((done / totalBatches) * 100).toFixed(1);
      const elapsed = ((now - startedAt) / 1000).toFixed(0);
      console.log(`  batch ${done}/${totalBatches} (${pct}%) — snapped ${snapped} so far — ${elapsed}s elapsed`);
      lastLog = now;
    }
  });
  saveCheckpoint();

  console.log(`\nCollisions snapped: ${snapped}`);
  console.log(`Unsnapped (>${SNAP_RADIUS_M}m from any signal): ${unsnapped}`);
  console.log(`Bad / missing coords: ${badCoords}`);
  console.log(`Signals with crash data: ${perSignal.size}`);
  console.log(`Years observed:`, [...yearCounts.entries()].sort((a,b)=>a[0]-b[0]));

  // ---------- FARS hourly/dow/monthly distribution (Georgia only) ----------
  console.log("\nFetching NHTSA FARS GA distribution...");
  const farsUrl =
    `${FARS_URL}?where=STATE%3D13&outFields=HOUR,DAY_WEEK,MONTH,YEAR&returnGeometry=false&f=json&resultRecordCount=5000`;
  const fars = await fetchJSON(farsUrl);
  const farsFeatures = fars.features || [];
  console.log(`  ${farsFeatures.length} FARS Georgia records (2019-2023).`);

  const hourly = new Array(24).fill(0);
  const dow = new Array(7).fill(0); // index 0 = Sunday (DAY_WEEK 1)
  const monthly = new Array(12).fill(0);
  for (const f of farsFeatures) {
    const a = f.attributes;
    if (typeof a.HOUR === "number" && a.HOUR >= 0 && a.HOUR <= 23) hourly[a.HOUR]++;
    if (typeof a.DAY_WEEK === "number" && a.DAY_WEEK >= 1 && a.DAY_WEEK <= 7) dow[a.DAY_WEEK - 1]++;
    if (typeof a.MONTH === "number" && a.MONTH >= 1 && a.MONTH <= 12) monthly[a.MONTH - 1]++;
  }
  console.log(`  hourly:`, hourly);
  console.log(`  dow:   `, dow);
  console.log(`  monthly:`, monthly);

  // ---------- write output ----------
  const perSignalObj = {};
  for (const [k, v] of perSignal.entries()) perSignalObj[k] = v;

  const out = {
    meta: {
      fetchedAt: new Date().toISOString(),
      sourceCollisions: "ARC Regional High Injury Network — Collisions2019to2023",
      sourceFARS: "NHTSA FARS Georgia (state=13) 2019-2023",
      totalCrashes: total,
      snappedCrashes: snapped,
      snappedPct: Math.round((snapped / total) * 1000) / 10,
      unsnappedCrashes: unsnapped,
      badCoords,
      signalsWithData: perSignal.size,
      snapRadiusMeters: SNAP_RADIUS_M,
      dateRange: "2019-2023",
      farsRecords: farsFeatures.length,
    },
    perSignal: perSignalObj,
    hourly,
    dow,
    monthly,
  };

  writeFileSync(OUT_PATH, JSON.stringify(out));
  const sizeMb = (Buffer.byteLength(JSON.stringify(out)) / 1024 / 1024).toFixed(2);
  console.log(`\nWrote ${OUT_PATH} (${sizeMb} MB).`);

  // Successful full run — clear the checkpoint so the next run starts clean.
  try { unlinkSync(CHECKPOINT_PATH); } catch { /* ignore */ }
  console.log("Done.");
}

main().catch((e) => {
  console.error("Preprocess failed:", e);
  process.exit(1);
});
