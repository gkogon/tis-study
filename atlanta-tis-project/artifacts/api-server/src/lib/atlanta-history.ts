// Persisted day-over-day history of "predicted top-risk signals" vs "signals
// that actually saw a live incident today". The file is the source of truth
// for two things:
//
//   1. The accuracy KPI on /tomorrow ("X% of today's incidents fell on
//      predicted high-risk signals; 7-day rolling average Y%").
//   2. A small "recent activity" multiplier that the prediction model applies
//      to signals that have repeatedly shown live incidents in recent days —
//      this is the feedback loop that lets future predictions self-refine.
//
// Storage is a single JSON file under src/data. We keep the most recent
// HISTORY_RETENTION_DAYS entries and rewrite on every snapshot. Because the
// snapshot footprint is tiny (<10KB per day), this is fine for our scale.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./logger";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = resolve(__dirname, "../data/atlanta-prediction-history.json");
const HISTORY_RETENTION_DAYS = 30;
const RECENT_ACTIVITY_WINDOW_DAYS = 7;

export type DaySnapshot = {
  date: string; // YYYY-MM-DD (America/New_York)
  observedAt: string; // ISO timestamp of last update
  predictedTopRiskOsmIds: number[]; // signals model flagged as top-N risk for this date
  topNUsed: number;
  actualIncidentSignalCounts: Record<string, number>; // osmId -> # incidents seen today on that signal
  actualIncidentTotal: number; // total live incidents in metro today (incl. unsnapped)
  hits: number; // # actual-incident signals that ARE in predictedTopRiskOsmIds
  hitRatePct: number; // hits / actualSnappedSignals
  precisionPct: number; // hits / predictedTopRiskOsmIds.length (how concentrated our top-N actually was)
};

type HistoryFile = {
  version: 1;
  days: DaySnapshot[];
};

// ---------- file IO ----------

function readHistory(): HistoryFile {
  try {
    const raw = readFileSync(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as HistoryFile;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.days)) return parsed;
  } catch {
    // file does not exist or is corrupt — start fresh
  }
  return { version: 1, days: [] };
}

function writeHistory(h: HistoryFile): void {
  try {
    mkdirSync(dirname(HISTORY_PATH), { recursive: true });
    writeFileSync(HISTORY_PATH, JSON.stringify(h));
  } catch (e) {
    logger.warn({ err: e, path: HISTORY_PATH }, "history: write failed");
  }
}

// ---------- public API ----------

export function getHistory(): DaySnapshot[] {
  return readHistory().days;
}

/**
 * Upsert today's snapshot. If an entry for `date` already exists, we update
 * it in place (so multiple calls during the same day refresh the live counts
 * without losing history). The retention window is enforced after the upsert.
 */
export function recordSnapshot(snapshot: DaySnapshot): DaySnapshot[] {
  const h = readHistory();
  const i = h.days.findIndex((d) => d.date === snapshot.date);
  if (i >= 0) h.days[i] = snapshot;
  else h.days.push(snapshot);
  // Sort newest-first and trim
  h.days.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (h.days.length > HISTORY_RETENTION_DAYS) {
    h.days = h.days.slice(0, HISTORY_RETENTION_DAYS);
  }
  writeHistory(h);
  return h.days;
}

export type AccuracySummary = {
  today: DaySnapshot | null;
  recentDays: DaySnapshot[]; // up to 7 days
  rollingHitRatePct: number; // mean hitRate across recentDays (excluding today if 0)
  rollingPrecisionPct: number;
};

export function getAccuracySummary(todayDate: string): AccuracySummary {
  const days = getHistory();
  const today = days.find((d) => d.date === todayDate) ?? null;
  // Use the 7 most recent NON-today days for the rolling stat
  const recent = days
    .filter((d) => d.date !== todayDate)
    .slice(0, RECENT_ACTIVITY_WINDOW_DAYS);
  let hr = 0, pr = 0, n = 0;
  for (const d of recent) {
    if (d.actualIncidentTotal > 0) {
      hr += d.hitRatePct;
      pr += d.precisionPct;
      n++;
    }
  }
  return {
    today,
    recentDays: recent,
    rollingHitRatePct: n > 0 ? Math.round((hr / n) * 10) / 10 : 0,
    rollingPrecisionPct: n > 0 ? Math.round((pr / n) * 10) / 10 : 0,
  };
}

/**
 * Returns a per-signal multiplier (typically 1.00..1.25) for the prediction
 * model. Signals that have repeatedly seen live incidents over the last
 * RECENT_ACTIVITY_WINDOW_DAYS get a small bump, which lets tomorrow's
 * forecast learn from today's reality. The multiplier saturates so a single
 * busy day does not blow up future predictions.
 *
 * Math: bonus = min(0.25, 0.05 * sqrt(totalRecentIncidents))
 *   1 incident  → +5%
 *   4 incidents → +10%
 *   9 incidents → +15%
 *   16+         → +20%
 *   25+         → +25% (cap)
 */
export function getRecentActivityMultipliers(): Map<number, number> {
  const days = readHistory().days.slice(0, RECENT_ACTIVITY_WINDOW_DAYS);
  const counts = new Map<number, number>();
  for (const d of days) {
    for (const [osmIdStr, n] of Object.entries(d.actualIncidentSignalCounts)) {
      const id = Number(osmIdStr);
      if (Number.isFinite(id)) counts.set(id, (counts.get(id) ?? 0) + n);
    }
  }
  const out = new Map<number, number>();
  for (const [id, total] of counts) {
    const bonus = Math.min(0.25, 0.05 * Math.sqrt(total));
    out.set(id, 1 + bonus);
  }
  return out;
}

export function clearRecentActivityMultiplierCache(): void {
  // Currently no in-memory cache — the file read is cheap. Hook for future use.
}

// ---- Backtest credibility report ----
//
// Aggregates the entire prediction-history.json into a single, audit-friendly
// report. Designed to be the data source for a printable "sales sheet" we can
// hand to City of Atlanta / DOT procurement showing exactly how the model
// performed day over day. Every number here is derived from the persisted
// snapshots — there is no fudging or smoothing.

export type BacktestDayRow = {
  date: string;
  dow: number; // 0=Sun..6=Sat (UTC noon)
  topN: number;
  actualSnappedSignals: number;
  actualIncidentTotal: number;
  hits: number;
  hitRatePct: number; // hits / actualSnappedSignals
  precisionPct: number; // hits / topN
};

export type DowBreakdownRow = {
  dow: number; // 0..6
  dayName: string;
  daysObserved: number;
  meanHitRatePct: number;
  meanPrecisionPct: number;
};

export type BacktestReport = {
  generatedAt: string;
  windowDays: number; // # days in retention window (=days.length here)
  totalSignalsInModel: number; // denominator for the random-baseline lift
  // ---- aggregate KPIs ----
  daysObserved: number; // days with actualIncidentTotal > 0
  totalPredictedSlots: number; // sum of topNUsed across observed days
  totalObservedIncidentSignals: number; // sum of actualSnappedSignals across observed days
  totalIncidentReports: number; // sum of actualIncidentTotal
  totalHits: number;
  // overall = pooled hit-rate = sum(hits) / sum(actualSnapped)
  overallHitRatePct: number;
  overallPrecisionPct: number; // sum(hits) / sum(topN)
  // central tendency across days (each day weighted equally)
  meanHitRatePct: number;
  medianHitRatePct: number;
  // 95% Wilson CI on the pooled hit-rate
  hitRateCi95LowPct: number;
  hitRateCi95HighPct: number;
  // ---- baseline comparison ----
  // Random-shortlist baseline: if you picked topN signals uniformly at random
  // from the full model, you'd expect topN/totalSignalsInModel of incidents to
  // land on your shortlist by chance. We report avg shortlist size so the
  // baseline is well-defined.
  meanTopN: number;
  randomBaselinePct: number; // (meanTopN / totalSignalsInModel) * 100
  liftMultiplier: number; // overallHitRate / randomBaseline
  // ---- best / worst day ----
  bestDay: BacktestDayRow | null;
  worstDay: BacktestDayRow | null;
  // ---- breakdowns / series ----
  perDay: BacktestDayRow[]; // newest-first, ALL retained days (incl. zero-incident)
  byDayOfWeek: DowBreakdownRow[]; // 0..6, rows omitted if no data
  // ---- methodology ----
  methodology: string[]; // paragraphs, plain text — machine-readable for audit
};

const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dowFromDate(yyyymmdd: string): number {
  // Use UTC noon to avoid TZ slippage; the date is already YYYY-MM-DD in NY.
  return new Date(`${yyyymmdd}T12:00:00Z`).getUTCDay();
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// Wilson 95% CI for a binomial proportion: p ± 1.96 * sqrt(p(1-p)/n + ...).
// Returns [low, high] in [0,1]. Stable for small n and edge cases (p=0, p=1).
function wilson95(successes: number, trials: number): [number, number] {
  if (trials <= 0) return [0, 0];
  const z = 1.96;
  const p = successes / trials;
  const denom = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

const METHODOLOGY: string[] = [
  "Each day at solar noon Atlanta time, the model produces a top-N shortlist of signalized intersections it believes are most likely to see a reportable incident over the rolling 24 hours. The shortlist is computed from the deployed forecasting pipeline (historical demand baseline × hourly Open-Meteo weather × day-of-week × special-event × per-signal recent-activity feedback), not a backtest-only retraining.",
  "Throughout the day we ingest live incidents from the GDOT NaviGAtor 511 public feed and snap each report to its nearest signalized intersection within 500 meters. A signal is considered 'observed' if at least one incident snapped to it that day.",
  "A 'hit' is a snapped signal that also appears on the day's predicted shortlist. The headline hit-rate is hits ÷ snapped signals (recall on the observed-incident set). Precision is hits ÷ shortlist size. We pool counts across days for the headline number and report the Wilson 95% confidence interval so reviewers can see the statistical noise floor.",
  "The random-shortlist baseline is the expected pooled hit-rate if we had picked the same number of intersections uniformly at random from the full ~7,400-signal network ON EACH DAY (weighted by per-day observed-incident counts so it is directly comparable to the pooled hit-rate). The lift multiplier is our pooled hit-rate divided by that baseline; values above 1.0 mean the model concentrates predictions on signals that actually saw incidents better than chance.",
  "Days where the upstream live feed returned zero items are NOT persisted to history (they would corrupt the rolling stats with false zeros). The window therefore contains only days with at least partial incident coverage.",
];

export function computeBacktestReport(opts: { totalSignalsInModel: number }): BacktestReport {
  const days = getHistory();
  const totalSignals = Math.max(1, opts.totalSignalsInModel);

  const perDay: BacktestDayRow[] = days.map((d) => ({
    date: d.date,
    dow: dowFromDate(d.date),
    topN: d.topNUsed,
    actualSnappedSignals: Object.keys(d.actualIncidentSignalCounts).length,
    actualIncidentTotal: d.actualIncidentTotal,
    hits: d.hits,
    hitRatePct: d.hitRatePct,
    precisionPct: d.precisionPct,
  }));

  // Only days where we actually had incidents to score against count toward
  // recall/precision means. Empty-incident days still appear in the table.
  const scored = perDay.filter((r) => r.actualSnappedSignals > 0 && r.topN > 0);

  let totalHits = 0;
  let totalSnapped = 0;
  let totalSlots = 0;
  let totalIncidentReports = 0;
  for (const d of scored) {
    totalHits += d.hits;
    totalSnapped += d.actualSnappedSignals;
    totalSlots += d.topN;
    totalIncidentReports += d.actualIncidentTotal;
  }

  const meanTopN = scored.length ? totalSlots / scored.length : 0;
  const overallHitRate = totalSnapped > 0 ? totalHits / totalSnapped : 0;
  const overallPrecision = totalSlots > 0 ? totalHits / totalSlots : 0;
  const [ciLow, ciHigh] = wilson95(totalHits, totalSnapped);

  const hitRateValues = scored.map((r) => r.hitRatePct);
  const meanHitRatePct = scored.length
    ? hitRateValues.reduce((s, v) => s + v, 0) / scored.length
    : 0;
  const medianHitRatePct = median(hitRateValues);

  // Random-shortlist baseline weighted by per-day observed-incident counts.
  // This is the expected pooled hit-rate if, ON EACH DAY, we had picked the
  // same topN signals uniformly at random from the network. Mathematically:
  //   E[hits_d] = snapped_d * topN_d / totalSignals
  //   E[pooled hit-rate] = sum(snapped_d * topN_d) / (totalSignals * sum(snapped_d))
  // This is statistically cleaner than `mean(topN) / totalSignals`, which
  // only equals it when snapped_d is constant across days.
  let weightedRandomNumer = 0;
  for (const d of scored) {
    weightedRandomNumer += d.actualSnappedSignals * d.topN;
  }
  const randomBaselinePct = totalSnapped > 0
    ? (weightedRandomNumer / (totalSignals * totalSnapped)) * 100
    : 0;
  const liftMultiplier =
    randomBaselinePct > 0 ? overallHitRate * 100 / randomBaselinePct : 0;

  let bestDay: BacktestDayRow | null = null;
  let worstDay: BacktestDayRow | null = null;
  for (const r of scored) {
    if (!bestDay || r.hitRatePct > bestDay.hitRatePct) bestDay = r;
    if (!worstDay || r.hitRatePct < worstDay.hitRatePct) worstDay = r;
  }

  // DOW breakdown — only over scored days.
  const dowBuckets = new Map<number, { hr: number[]; pr: number[] }>();
  for (const r of scored) {
    const b = dowBuckets.get(r.dow) ?? { hr: [], pr: [] };
    b.hr.push(r.hitRatePct);
    b.pr.push(r.precisionPct);
    dowBuckets.set(r.dow, b);
  }
  const byDayOfWeek: DowBreakdownRow[] = [];
  for (let d = 0; d < 7; d++) {
    const b = dowBuckets.get(d);
    if (!b || b.hr.length === 0) continue;
    byDayOfWeek.push({
      dow: d,
      dayName: DOW_NAMES[d]!,
      daysObserved: b.hr.length,
      meanHitRatePct: round1(b.hr.reduce((s, v) => s + v, 0) / b.hr.length),
      meanPrecisionPct: round1(b.pr.reduce((s, v) => s + v, 0) / b.pr.length),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays: days.length,
    totalSignalsInModel: totalSignals,
    daysObserved: scored.length,
    totalPredictedSlots: totalSlots,
    totalObservedIncidentSignals: totalSnapped,
    totalIncidentReports,
    totalHits,
    overallHitRatePct: round1(overallHitRate * 100),
    overallPrecisionPct: round1(overallPrecision * 100),
    meanHitRatePct: round1(meanHitRatePct),
    medianHitRatePct: round1(medianHitRatePct),
    hitRateCi95LowPct: round1(ciLow * 100),
    hitRateCi95HighPct: round1(ciHigh * 100),
    meanTopN: Math.round(meanTopN),
    randomBaselinePct: round2(randomBaselinePct),
    liftMultiplier: round1(liftMultiplier),
    bestDay,
    worstDay,
    perDay,
    byDayOfWeek,
    methodology: METHODOLOGY,
  };
}

function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// ---- Enhanced spatial + recency-weighted feedback loop ----

export type SignalPosition = { osmId: number; lat: number; lon: number };

const RECENCY_DECAY = 0.82;
const CORRIDOR_RADIUS_M = 800;
const CORRIDOR_CELL = 0.01;
const CORRIDOR_SEARCH = 1;
const DIRECT_MULT_CAP = 0.35;
const CORRIDOR_MULT_CAP = 0.20;
const DIRECT_SCALE = 0.06;
const CORRIDOR_SCALE = 0.04;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

export function getSpatialActivityMultipliers(
  signals: SignalPosition[],
): Map<number, number> {
  const days = readHistory().days.slice(0, RECENT_ACTIVITY_WINDOW_DAYS);
  if (!days.length) return new Map();

  const weightedCounts = new Map<number, number>();
  for (let i = 0; i < days.length; i++) {
    const weight = Math.pow(RECENCY_DECAY, i);
    const d = days[i]!;
    for (const [osmIdStr, n] of Object.entries(d.actualIncidentSignalCounts)) {
      const id = Number(osmIdStr);
      if (Number.isFinite(id)) {
        weightedCounts.set(id, (weightedCounts.get(id) ?? 0) + n * weight);
      }
    }
  }
  if (!weightedCounts.size) return new Map();

  const posById = new Map<number, { lat: number; lon: number }>();
  for (const s of signals) posById.set(s.osmId, { lat: s.lat, lon: s.lon });

  type IncPt = { lat: number; lon: number; osmId: number; wCount: number };
  const grid = new Map<string, IncPt[]>();
  for (const [osmId, wCount] of weightedCounts) {
    const pos = posById.get(osmId);
    if (!pos) continue;
    const key = `${Math.floor(pos.lat / CORRIDOR_CELL)}|${Math.floor(pos.lon / CORRIDOR_CELL)}`;
    let bucket = grid.get(key);
    if (!bucket) { bucket = []; grid.set(key, bucket); }
    bucket.push({ lat: pos.lat, lon: pos.lon, osmId, wCount });
  }

  const out = new Map<number, number>();
  for (const sig of signals) {
    const directCount = weightedCounts.get(sig.osmId) ?? 0;
    let directBonus = 0;
    if (directCount > 0) {
      directBonus = Math.min(DIRECT_MULT_CAP, DIRECT_SCALE * Math.sqrt(directCount));
    }

    const cy = Math.floor(sig.lat / CORRIDOR_CELL);
    const cx = Math.floor(sig.lon / CORRIDOR_CELL);
    let corridorScore = 0;
    for (let dy = -CORRIDOR_SEARCH; dy <= CORRIDOR_SEARCH; dy++) {
      for (let dx = -CORRIDOR_SEARCH; dx <= CORRIDOR_SEARCH; dx++) {
        const bucket = grid.get(`${cy + dy}|${cx + dx}`);
        if (!bucket) continue;
        for (const inc of bucket) {
          if (inc.osmId === sig.osmId) continue;
          const d = haversineM(sig.lat, sig.lon, inc.lat, inc.lon);
          if (d <= CORRIDOR_RADIUS_M) {
            corridorScore += inc.wCount * (1 - d / CORRIDOR_RADIUS_M);
          }
        }
      }
    }

    let corridorBonus = 0;
    if (corridorScore > 0) {
      corridorBonus = Math.min(CORRIDOR_MULT_CAP, CORRIDOR_SCALE * Math.sqrt(corridorScore));
    }

    const totalBonus = directBonus + corridorBonus;
    if (totalBonus > 0) {
      out.set(sig.osmId, 1 + Math.min(DIRECT_MULT_CAP + CORRIDOR_MULT_CAP, totalBonus));
    }
  }

  return out;
}

// ---- Live congestion calibration ----

const CALIBRATION_PATH = resolve(__dirname, "../data/atlanta-calibration.json");
const CALIBRATION_RETENTION_DAYS = 7;

export type CalibrationSnapshot = {
  date: string;
  hour: number;
  capturedAt: string;
  cells: Record<string, { predicted: number; actual: number; n: number }>;
};

type CalibrationFile = {
  version: 1;
  snapshots: CalibrationSnapshot[];
};

function readCalibration(): CalibrationFile {
  try {
    const raw = readFileSync(CALIBRATION_PATH, "utf8");
    const parsed = JSON.parse(raw) as CalibrationFile;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.snapshots)) return parsed;
  } catch { /* missing or corrupt */ }
  return { version: 1, snapshots: [] };
}

function writeCalibration(c: CalibrationFile): void {
  try {
    mkdirSync(dirname(CALIBRATION_PATH), { recursive: true });
    writeFileSync(CALIBRATION_PATH, JSON.stringify(c));
  } catch (e) {
    logger.warn({ err: e, path: CALIBRATION_PATH }, "calibration: write failed");
  }
}

export function recordCalibrationSnapshot(snap: CalibrationSnapshot): void {
  const c = readCalibration();
  const existing = c.snapshots.findIndex(
    (s) => s.date === snap.date && s.hour === snap.hour,
  );
  if (existing >= 0) c.snapshots[existing] = snap;
  else c.snapshots.push(snap);

  c.snapshots.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.hour - b.hour));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CALIBRATION_RETENTION_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  c.snapshots = c.snapshots.filter((s) => s.date >= cutoffStr);

  writeCalibration(c);
}

let calibCache: { at: number; factors: Map<string, number> } | null = null;
const CALIB_CACHE_TTL_MS = 300_000;

export function getCalibrationFactors(): Map<string, number> {
  if (calibCache && Date.now() - calibCache.at < CALIB_CACHE_TTL_MS) {
    return calibCache.factors;
  }

  const c = readCalibration();
  if (!c.snapshots.length) {
    calibCache = { at: Date.now(), factors: new Map() };
    return calibCache.factors;
  }

  const cellAgg = new Map<string, { sumRatio: number; weight: number }>();
  for (let i = 0; i < c.snapshots.length; i++) {
    const snap = c.snapshots[i]!;
    const ts = new Date(snap.capturedAt).getTime();
    if (!Number.isFinite(ts)) continue;
    const age = Math.max(0, (Date.now() - ts) / 86_400_000);
    const w = Math.pow(0.85, age);
    for (const [key, cell] of Object.entries(snap.cells)) {
      if (!Number.isFinite(cell.predicted) || !Number.isFinite(cell.actual)) continue;
      if (cell.predicted < 5 || cell.n < 3) continue;
      const ratio = cell.actual / cell.predicted;
      if (!Number.isFinite(ratio)) continue;
      const clamped = Math.max(0.75, Math.min(1.4, ratio));
      const agg = cellAgg.get(key);
      if (agg) {
        agg.sumRatio += clamped * w;
        agg.weight += w;
      } else {
        cellAgg.set(key, { sumRatio: clamped * w, weight: w });
      }
    }
  }

  const out = new Map<string, number>();
  for (const [key, agg] of cellAgg) {
    if (agg.weight > 0.5) {
      out.set(key, agg.sumRatio / agg.weight);
    }
  }
  calibCache = { at: Date.now(), factors: out };
  return out;
}
