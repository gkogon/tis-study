import {
  loadSignals,
  loadAccidents,
  loadRoadNetwork,
  zoneFor,
  distanceMiles,
  mulberry32,
  ATL_CENTER_LAT,
  ATL_CENTER_LON,
  ROAD_CLASS_NAMES,
} from "./atlanta-data";
import { getRecentActivityMultipliers, getSpatialActivityMultipliers } from "./atlanta-history";
import { resolveSignalNames } from "./atlanta-signal-naming";

export type Severity = "low" | "moderate" | "high" | "critical";

export type ApproachMovements = {
  thru: number;
  left: number;
  right: number;
};

export type MovementBreakdown = {
  northbound: ApproachMovements;
  southbound: ApproachMovements;
  eastbound: ApproachMovements;
  westbound: ApproachMovements;
  totalThrough: number;
  totalLeft: number;
  totalRight: number;
  totalTurning: number; // left + right
  total: number; // all movements
};

export type IntersectionSummary = {
  id: string;
  name: string;
  zone: string;
  roadClass: string;
  latitude: number;
  longitude: number;
  totalVolume: number;
  turningVolume: number;
  inefficiencyScore: number;
  avgDelaySeconds: number;
  severity: Severity;
};

export type Intersection = IntersectionSummary & {
  signalTiming: {
    nsGreen: number;
    ewGreen: number;
    protectedLeft: number;
    allRed: number;
    cycleLength: number;
  };
  trafficVolume: {
    north: number;
    south: number;
    east: number;
    west: number;
    total: number;
  };
  movementBreakdown: MovementBreakdown;
  worstMovement: {
    label: string;
    phase: "Protected Left" | "N/S Green" | "E/W Green";
    vcRatio: number;
  };
};

function severityFromScore(score: number): Severity {
  // Bands intentionally relaxed (was 70/50/30) so most signals don't get
  // dumped into the high/critical buckets at peak hour.
  if (score >= 78) return "critical";
  if (score >= 60) return "high";
  if (score >= 38) return "moderate";
  return "low";
}

const HOURLY_FACTORS = [
  0.18, 0.12, 0.09, 0.08, 0.12, 0.28, 0.55, 0.92, 1.0, 0.78, 0.6, 0.65,
  0.7, 0.68, 0.62, 0.7, 0.85, 1.0, 0.95, 0.72, 0.55, 0.42, 0.32, 0.24,
];

function hourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

// Per-class RUSH-HOUR volume baselines (vehicles per hour entering the
// intersection from all approaches). Calibrated to AM/PM peak conditions:
// a motorway-frontage signal in midtown sees ~5,000 vph during peak; a quiet
// residential cut-through sees ~900 vph. Snapped from each signal's nearest
// OSM road class so a GA-400 frontage light gets a very different model than
// a neighborhood collector.
const BASE_VOLUME_BY_CLASS = [5100, 4050, 2850, 1650, 900];
// Movement split (thru/left/right) per road class. Highway-frontage lights see
// outsized lefts feeding ramps; residential lights see more rights into
// neighborhoods. Each row sums to 1.0.
const MOVEMENT_SPLIT_BY_CLASS: ReadonlyArray<readonly [number, number, number]> = [
  [0.60, 0.22, 0.18], // motorway
  [0.65, 0.20, 0.15], // trunk
  [0.67, 0.18, 0.15], // primary
  [0.70, 0.16, 0.14], // secondary
  [0.72, 0.14, 0.14], // other
];

// Saturation-flow capacity (vehicles per hour per lane) per movement type.
// HCM-ish defaults — through is the cleanest, lefts pay a turning penalty,
// rights get RTOR credit but lose to ped/conflict frictions.
const SAT_FLOW = { thru: 1900, left: 1800, right: 1500 } as const;

function movementVc(
  demandVph: number,
  greenSeconds: number,
  cycleSeconds: number,
  satFlowVphLane: number,
  lanes: number,
): number {
  const greenRatio = greenSeconds / cycleSeconds;
  const capacityVph = greenRatio * satFlowVphLane * lanes;
  if (capacityVph <= 0) return 2;
  return demandVph / capacityVph;
}

function websterDelay(
  greenSeconds: number,
  cycleSeconds: number,
  vc: number,
): number {
  const g = greenSeconds / cycleSeconds;
  const cappedVc = Math.min(vc, 1.4);
  const denom = 1 - Math.min(g * Math.min(cappedVc, 0.95), 0.99);
  const uniform = (0.5 * cycleSeconds * Math.pow(1 - g, 2)) / denom;
  return uniform + cappedVc * 18;
}

type TimingOverride = {
  nsGreen: number;
  ewGreen: number;
  protectedLeft: number;
  allRed: number;
};

function buildIntersection(
  osmId: number,
  lat: number,
  lon: number,
  name: string | null | undefined,
  roadClassCode: number,
  timingOverride?: TimingOverride,
): Intersection {
  const rand = mulberry32(osmId);
  const r2 = rand();
  const r3 = rand();
  const r4 = rand();
  const r5 = rand();
  const r6 = rand();
  const r7 = rand();
  const _skip = rand(); // keep PRNG sequence stable with prior version
  void _skip;

  // Density falls off with distance from CBD; sqrt-style decay so close-in
  // signals stay dense and the curve doesn't crater past 10 miles.
  const distMi = distanceMiles(lat, lon, ATL_CENTER_LAT, ATL_CENTER_LON);
  const densityFactor = Math.max(0.25, 1 - Math.sqrt(distMi) / 6);

  const cls = Math.min(Math.max(roadClassCode, 0), 4);
  const isMajor = cls <= 1; // motorway or trunk
  const isMinor = cls >= 3;
  const baseHourlyVolume = BASE_VOLUME_BY_CLASS[cls]!;
  const totalHourlyVolume = Math.max(
    180,
    Math.round(baseHourlyVolume * densityFactor * (0.75 + r2 * 0.5)),
  );

  // Approach volumes (vehicles entering from each cardinal direction).
  const nsShare = 0.4 + r3 * 0.2;
  const nsTotal = Math.round(totalHourlyVolume * nsShare);
  const ewTotal = totalHourlyVolume - nsTotal;
  const north = Math.round(nsTotal * (0.45 + r4 * 0.1));
  const south = nsTotal - north;
  const east = Math.round(ewTotal * (0.45 + r5 * 0.1));
  const west = ewTotal - east;

  // Per-class movement split (thru/left/right). Add small per-approach jitter
  // so all four approaches don't share identical splits.
  const baseSplit = MOVEMENT_SPLIT_BY_CLASS[cls]!;
  function splitApproach(
    volume: number,
    leftJitter: number,
    rightJitter: number,
  ): ApproachMovements {
    let thruShare = baseSplit[0];
    let leftShare = baseSplit[1] + (leftJitter - 0.5) * 0.06;
    let rightShare = baseSplit[2] + (rightJitter - 0.5) * 0.06;
    // Keep shares sane and renormalize.
    leftShare = Math.max(0.08, leftShare);
    rightShare = Math.max(0.08, rightShare);
    const sum = thruShare + leftShare + rightShare;
    thruShare /= sum;
    leftShare /= sum;
    rightShare /= sum;
    const left = Math.round(volume * leftShare);
    const right = Math.round(volume * rightShare);
    const thru = Math.max(0, volume - left - right);
    return { thru, left, right };
  }
  const nb = splitApproach(north, r6, rand());
  const sb = splitApproach(south, r7, rand());
  const eb = splitApproach(east, rand(), rand());
  const wb = splitApproach(west, rand(), rand());

  const totalThrough = nb.thru + sb.thru + eb.thru + wb.thru;
  const totalLeft = nb.left + sb.left + eb.left + wb.left;
  const totalRight = nb.right + sb.right + eb.right + wb.right;
  const totalTurning = totalLeft + totalRight;

  // Signal timing scaled to road class. Always advance the PRNG (3 calls)
  // even when overriding so demand splits stay deterministic if used later.
  const baseNs = isMajor ? 80 + Math.floor(rand() * 20) : isMinor ? 40 + Math.floor(rand() * 15) : 60 + Math.floor(rand() * 15);
  const baseEw = isMajor ? 50 + Math.floor(rand() * 15) : isMinor ? 30 + Math.floor(rand() * 12) : 45 + Math.floor(rand() * 12);
  const baseLeft = isMajor ? 18 + Math.floor(rand() * 10) : isMinor ? 8 + Math.floor(rand() * 6) : 12 + Math.floor(rand() * 8);
  const nsGreen = timingOverride?.nsGreen ?? baseNs;
  const ewGreen = timingOverride?.ewGreen ?? baseEw;
  const protectedLeft = timingOverride?.protectedLeft ?? baseLeft;
  const allRed = timingOverride?.allRed ?? 4;
  const cycleLength = nsGreen + ewGreen + protectedLeft + allRed;

  // Per-approach lane counts (one direction). Major roads get 2 thru lanes
  // and dual left-turn pockets; minor roads get a single thru lane.
  const thruLanesPerApproach = isMajor ? 2 : isMinor ? 1 : 2;
  const leftLanesPerApproach = isMajor ? 2 : 1;
  const rightLanesPerApproach = 1;

  // For grouped movements (NS/EW pairs), capacity must count both approaches
  // since they discharge concurrently on their own lanes:
  //   - Through and right groups: NS green serves both NB and SB, each with
  //     its own set of lanes ⇒ effective lane count = 2 × per-approach.
  //   - Left group: NS and EW lefts SHARE the protected-left phase (split
  //     ~50/50 in a typical leading-leading or split-phase setup), so each
  //     pair gets half the green BUT serves both NB and SB lefts on their
  //     own pockets. The /2 (phase share) and ×2 (two approaches) cancel,
  //     so we just use per-approach lane count with the full protectedLeft.
  const thruLanesGrouped = thruLanesPerApproach * 2;
  const rightLanesGrouped = rightLanesPerApproach * 2;
  const leftLanesGrouped = leftLanesPerApproach;

  // Through movements get the full main-phase green for their direction
  // (NS approaches use nsGreen, EW approaches use ewGreen).
  const nsThruVc = movementVc(nb.thru + sb.thru, nsGreen, cycleLength, SAT_FLOW.thru, thruLanesGrouped);
  const ewThruVc = movementVc(eb.thru + wb.thru, ewGreen, cycleLength, SAT_FLOW.thru, thruLanesGrouped);

  // Left turns: see comment above on phase sharing.
  const nsLeftVc = movementVc(nb.left + sb.left, protectedLeft, cycleLength, SAT_FLOW.left, leftLanesGrouped);
  const ewLeftVc = movementVc(eb.left + wb.left, protectedLeft, cycleLength, SAT_FLOW.left, leftLanesGrouped);

  // Right turns can move on their own through phase + RTOR during cross
  // green, so they get effectively (own_green + 0.5*cross_green).
  const nsRightEffectiveGreen = nsGreen + 0.5 * ewGreen;
  const ewRightEffectiveGreen = ewGreen + 0.5 * nsGreen;
  const nsRightVc = movementVc(nb.right + sb.right, nsRightEffectiveGreen, cycleLength, SAT_FLOW.right, rightLanesGrouped);
  const ewRightVc = movementVc(eb.right + wb.right, ewRightEffectiveGreen, cycleLength, SAT_FLOW.right, rightLanesGrouped);

  // Identify the worst-performing movement so the recommendation knows
  // which phase to lengthen.
  const movementCandidates: Array<{
    label: string;
    phase: "Protected Left" | "N/S Green" | "E/W Green";
    vc: number;
    volume: number;
  }> = [
    { label: "N/S Through", phase: "N/S Green", vc: nsThruVc, volume: nb.thru + sb.thru },
    { label: "E/W Through", phase: "E/W Green", vc: ewThruVc, volume: eb.thru + wb.thru },
    { label: "N/S Left", phase: "Protected Left", vc: nsLeftVc, volume: nb.left + sb.left },
    { label: "E/W Left", phase: "Protected Left", vc: ewLeftVc, volume: eb.left + wb.left },
    { label: "N/S Right", phase: "N/S Green", vc: nsRightVc, volume: nb.right + sb.right },
    { label: "E/W Right", phase: "E/W Green", vc: ewRightVc, volume: eb.right + wb.right },
  ];
  let worst = movementCandidates[0]!;
  for (const m of movementCandidates) {
    if (m.vc > worst.vc) worst = m;
  }

  // Volume-weighted v/c — captures the average condition rather than just
  // the bottleneck.
  const totalMovementVolume = movementCandidates.reduce((s, m) => s + m.volume, 0) || 1;
  const weightedVc =
    movementCandidates.reduce((s, m) => s + m.vc * m.volume, 0) / totalMovementVolume;

  // Volume-weighted Webster's delay across the six movement groups.
  const weightedDelay =
    movementCandidates.reduce((s, m) => {
      const greenForPhase =
        m.phase === "Protected Left"
          ? protectedLeft
          : m.phase === "N/S Green"
          ? nsGreen
          : ewGreen;
      // Right-on-red gets the effective extra green credit.
      const effGreen = m.label.endsWith("Right")
        ? greenForPhase + 0.5 * (m.phase === "N/S Green" ? ewGreen : nsGreen)
        : greenForPhase;
      return s + websterDelay(effGreen, cycleLength, m.vc) * m.volume;
    }, 0) / totalMovementVolume;

  // Normalization breakpoints — relaxed so the model only flags signals
  // that are genuinely pegged at or near saturation, not just elevated:
  //   - worst v/c ≤ 0.30 → 0 pts; worst v/c ≥ 1.00 → full 50 pts
  //   - weighted v/c ≤ 0.20 → 0 pts; weighted v/c ≥ 0.80 → full 30 pts
  //   - cross-volume penalty saturates at 2,500 vph (was 2,000)
  // Combined with the relaxed severity bands (≥78 critical, ≥60 high),
  // this lets ordinary peak-hour signals settle into low/moderate and
  // reserves the high/critical bands for actual bottlenecks.
  const normWorst = Math.max(0, Math.min(1, (worst.vc - 0.30) / 0.7));
  const normWeighted = Math.max(0, Math.min(1, (weightedVc - 0.20) / 0.6));
  const crossPenalty = Math.min(totalHourlyVolume / 2500, 1);
  const inefficiencyScore =
    Math.round(
      Math.min(
        100,
        Math.max(0, normWorst * 50 + normWeighted * 30 + crossPenalty * 20),
      ) * 10,
    ) / 10;

  const zone = zoneFor(lat, lon);
  const finalName = name ?? namelessLabel(lat, lon, distMi);

  return {
    id: `ATL-${osmId}`,
    name: finalName,
    zone,
    roadClass: ROAD_CLASS_NAMES[cls]!,
    latitude: lat,
    longitude: lon,
    totalVolume: totalHourlyVolume,
    turningVolume: totalTurning,
    inefficiencyScore,
    avgDelaySeconds: Math.round(weightedDelay * 10) / 10,
    severity: severityFromScore(inefficiencyScore),
    signalTiming: { nsGreen, ewGreen, protectedLeft, allRed, cycleLength },
    trafficVolume: { north, south, east, west, total: totalHourlyVolume },
    movementBreakdown: {
      northbound: nb,
      southbound: sb,
      eastbound: eb,
      westbound: wb,
      totalThrough,
      totalLeft,
      totalRight,
      totalTurning,
      total: totalHourlyVolume,
    },
    worstMovement: {
      label: worst.label,
      phase: worst.phase,
      vcRatio: Math.round(worst.vc * 100) / 100,
    },
  };
}

function bearing(lat: number, lon: number): string {
  const dLat = lat - ATL_CENTER_LAT;
  const dLon = lon - ATL_CENTER_LON;
  const angle = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round(((angle + 360) % 360) / 45) % 8;
  return dirs[idx]!;
}

function namelessLabel(lat: number, lon: number, distMi: number): string {
  if (distMi < 0.6) return `Signal near Five Points (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
  return `Signal ${distMi.toFixed(1)}mi ${bearing(lat, lon)} of CBD (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
}

let signalTuples: ReturnType<typeof loadSignals> | null = null;
let intersections: Intersection[] | null = null;
let summaries: IntersectionSummary[] | null = null;
let byId: Map<string, Intersection> | null = null;
let optimizedIntersections: Intersection[] | null = null;
let optimizedById: Map<string, Intersection> | null = null;

function ensureLoaded(): void {
  if (intersections && summaries && byId && signalTuples) return;
  signalTuples = loadSignals();
  // Resolve "Street A & Street B" cross-street names by snapping each signal
  // to its two nearest named roads. Falls back to the OSM-provided name when
  // present (rare — only ~5 signals carry one) and finally to a coordinate
  // label inside buildIntersection.
  const namesByOsm = resolveSignalNames(signalTuples, loadRoadNetwork());
  intersections = signalTuples.map((tuple) => {
    const [osmId, lat, lon, name, roadClass] = tuple;
    const resolvedName = name ?? namesByOsm.get(osmId) ?? null;
    return buildIntersection(osmId, lat, lon, resolvedName, roadClass ?? 4);
  });
  summaries = intersections.map(toSummary);
  byId = new Map(intersections.map((i) => [i.id, i]));
}

function ensureOptimizedLoaded(): void {
  ensureLoaded();
  if (optimizedIntersections && optimizedById) return;
  const namesByOsm = resolveSignalNames(signalTuples!, loadRoadNetwork());
  optimizedIntersections = signalTuples!.map((tuple, idx) => {
    const orig = intersections![idx]!;
    const newTiming = optimizeTimingFor(orig);
    const [osmId, lat, lon, name, roadClass] = tuple;
    const resolvedName = name ?? namesByOsm.get(osmId) ?? null;
    return buildIntersection(osmId, lat, lon, resolvedName, roadClass ?? 4, newTiming);
  });
  optimizedById = new Map(optimizedIntersections.map((i) => [i.id, i]));
}

// Apply the same logic as `getRecommendationFor` but to EVERY signal so we
// can simulate a "what if we re-timed the entire metro" scenario. Stretches
// the bottleneck phase based on severity; lengthens the cycle to
// accommodate. Engineering caps prevent unrealistically long greens or
// cycles.
function optimizeTimingFor(i: Intersection): TimingOverride {
  const t = i.signalTiming;
  if (i.severity === "low") {
    // Already operating fine — leave the timing alone.
    return { nsGreen: t.nsGreen, ewGreen: t.ewGreen, protectedLeft: t.protectedLeft, allRed: t.allRed };
  }

  const targetPhase = i.worstMovement.phase;
  let bump: number;
  let cap: number;
  if (i.severity === "critical") {
    bump = targetPhase === "Protected Left" ? 12 : 14;
    cap = targetPhase === "Protected Left" ? 38 : 110;
  } else if (i.severity === "high") {
    bump = targetPhase === "Protected Left" ? 8 : 10;
    cap = targetPhase === "Protected Left" ? 32 : 100;
  } else {
    // moderate
    bump = 4;
    cap = targetPhase === "Protected Left" ? 28 : 90;
  }

  let nsGreen = t.nsGreen;
  let ewGreen = t.ewGreen;
  let protectedLeft = t.protectedLeft;
  // Engineering minimums — never starve a movement below pedestrian-clearance
  // territory.
  const MIN_MAIN = 25;

  // If the target phase is already at/above its safety cap, the algorithm
  // has nothing more to give — leave timing unchanged. (Without this guard,
  // Math.min(current+bump, cap) can produce a NEGATIVE actualBump when the
  // baseline already exceeds the cap, which would inadvertently SHRINK the
  // bottlenecked phase and GROW the opposite one via the steal logic.)
  if (targetPhase === "Protected Left") {
    const newPL = Math.min(t.protectedLeft + bump, cap);
    const actualBump = Math.max(0, newPL - t.protectedLeft);
    if (actualBump === 0) {
      return { nsGreen, ewGreen, protectedLeft, allRed: t.allRed };
    }
    protectedLeft = t.protectedLeft + actualBump;
    // Steal up to half the bump from the LARGER main-phase green (it has
    // more slack). The remainder lengthens the cycle. This keeps Webster
    // uniform delay in check while still giving lefts more capacity.
    const steal = Math.floor(actualBump / 2);
    if (nsGreen >= ewGreen && nsGreen - steal >= MIN_MAIN) {
      nsGreen -= steal;
    } else if (ewGreen - steal >= MIN_MAIN) {
      ewGreen -= steal;
    }
  } else if (targetPhase === "N/S Green") {
    const newNs = Math.min(t.nsGreen + bump, cap);
    const actualBump = Math.max(0, newNs - t.nsGreen);
    if (actualBump === 0) {
      return { nsGreen, ewGreen, protectedLeft, allRed: t.allRed };
    }
    nsGreen = t.nsGreen + actualBump;
    const steal = Math.floor(actualBump / 2);
    if (ewGreen - steal >= MIN_MAIN) ewGreen -= steal;
  } else {
    const newEw = Math.min(t.ewGreen + bump, cap);
    const actualBump = Math.max(0, newEw - t.ewGreen);
    if (actualBump === 0) {
      return { nsGreen, ewGreen, protectedLeft, allRed: t.allRed };
    }
    ewGreen = t.ewGreen + actualBump;
    const steal = Math.floor(actualBump / 2);
    if (nsGreen - steal >= MIN_MAIN) nsGreen -= steal;
  }
  return { nsGreen, ewGreen, protectedLeft, allRed: t.allRed };
}

function toSummary(i: Intersection): IntersectionSummary {
  return {
    id: i.id,
    name: i.name,
    zone: i.zone,
    roadClass: i.roadClass,
    latitude: i.latitude,
    longitude: i.longitude,
    totalVolume: i.totalVolume,
    turningVolume: i.turningVolume,
    inefficiencyScore: i.inefficiencyScore,
    avgDelaySeconds: i.avgDelaySeconds,
    severity: i.severity,
  };
}

export function getIntersectionSummaries(): IntersectionSummary[] {
  ensureLoaded();
  return summaries!;
}

export function getIntersectionById(id: string): Intersection | undefined {
  ensureLoaded();
  return byId!.get(id);
}

function aggregateSummary(all: Intersection[]) {
  const totalDailyVehicles = all.reduce(
    (sum, i) => sum + i.trafficVolume.total * 14,
    0,
  );
  const totalTurningMovementsPerHour = all.reduce(
    (sum, i) => sum + i.movementBreakdown.totalTurning,
    0,
  );
  const totalThroughMovementsPerHour = all.reduce(
    (sum, i) => sum + i.movementBreakdown.totalThrough,
    0,
  );
  const averageInefficiency =
    all.reduce((sum, i) => sum + i.inefficiencyScore, 0) / all.length;
  const averageDelaySeconds =
    all.reduce((sum, i) => sum + i.avgDelaySeconds, 0) / all.length;
  const counts = { low: 0, moderate: 0, high: 0, critical: 0 };
  for (const i of all) counts[i.severity] += 1;
  let worst = all[0]!;
  for (const i of all) {
    if (i.inefficiencyScore > worst.inefficiencyScore) worst = i;
  }
  return {
    intersectionCount: all.length,
    totalDailyVehicles,
    totalTurningMovementsPerHour,
    totalThroughMovementsPerHour,
    averageInefficiency: Math.round(averageInefficiency * 10) / 10,
    averageDelaySeconds: Math.round(averageDelaySeconds * 10) / 10,
    criticalCount: counts.critical,
    highCount: counts.high,
    moderateCount: counts.moderate,
    lowCount: counts.low,
    worstIntersectionId: worst.id,
    worstIntersectionName: worst.name,
    worstIntersectionScore: worst.inefficiencyScore,
  };
}

function aggregateRankings(all: Intersection[], limit = 30) {
  return [...all]
    .sort((a, b) => b.inefficiencyScore - a.inefficiencyScore)
    .slice(0, limit)
    .map((i) => ({
      id: i.id,
      name: i.name,
      zone: i.zone,
      inefficiencyScore: i.inefficiencyScore,
      avgDelaySeconds: i.avgDelaySeconds,
      turningVolume: i.movementBreakdown.totalTurning,
      worstMovement: i.worstMovement.label,
      protectedLeftSeconds: i.signalTiming.protectedLeft,
      severity: i.severity,
    }));
}

function aggregateZones(all: Intersection[]) {
  const groups = new Map<string, Intersection[]>();
  for (const i of all) {
    const list = groups.get(i.zone) ?? [];
    list.push(i);
    groups.set(i.zone, list);
  }
  return Array.from(groups.entries())
    .map(([zone, list]) => ({
      zone,
      intersectionCount: list.length,
      avgInefficiency:
        Math.round(
          (list.reduce((s, i) => s + i.inefficiencyScore, 0) / list.length) *
            10,
        ) / 10,
      totalTurningMovements: list.reduce(
        (s, i) => s + i.movementBreakdown.totalTurning,
        0,
      ),
      totalVolume: list.reduce((s, i) => s + i.trafficVolume.total, 0),
      avgDelaySeconds:
        Math.round(
          (list.reduce((s, i) => s + i.avgDelaySeconds, 0) / list.length) * 10,
        ) / 10,
    }))
    .sort((a, b) => b.totalTurningMovements - a.totalTurningMovements);
}

function aggregateTurnDistribution(all: Intersection[]) {
  let through = 0;
  let left = 0;
  let right = 0;
  for (const i of all) {
    through += i.movementBreakdown.totalThrough;
    left += i.movementBreakdown.totalLeft;
    right += i.movementBreakdown.totalRight;
  }
  const n = all.length;
  return [
    { movement: "through", label: "Through", totalVehicles: through, avgPerIntersection: Math.round((through / n) * 10) / 10 },
    { movement: "left", label: "Left Turn", totalVehicles: left, avgPerIntersection: Math.round((left / n) * 10) / 10 },
    { movement: "right", label: "Right Turn", totalVehicles: right, avgPerIntersection: Math.round((right / n) * 10) / 10 },
  ];
}

function aggregateSignalTiming(all: Intersection[], limit = 25) {
  return [...all]
    .sort((a, b) => b.inefficiencyScore - a.inefficiencyScore)
    .slice(0, limit)
    .map((i) => ({
      id: i.id,
      name: i.name,
      nsGreen: i.signalTiming.nsGreen,
      ewGreen: i.signalTiming.ewGreen,
      protectedLeft: i.signalTiming.protectedLeft,
      allRed: i.signalTiming.allRed,
      cycleLength: i.signalTiming.cycleLength,
    }));
}

function aggregatePeakHour(all: Intersection[]) {
  const totalThrough = all.reduce((s, i) => s + i.movementBreakdown.totalThrough, 0);
  const totalTurning = all.reduce((s, i) => s + i.movementBreakdown.totalTurning, 0);
  return HOURLY_FACTORS.map((factor, hour) => ({
    hour,
    label: hourLabel(hour),
    throughVehicles: Math.round(totalThrough * factor),
    turningVehicles: Math.round(totalTurning * factor),
    congestionIndex: Math.round(factor * 100 * 10) / 10,
  }));
}

export function getTrafficSummary() {
  ensureLoaded();
  return aggregateSummary(intersections!);
}
export function getInefficiencyRankings(limit = 30) {
  ensureLoaded();
  return aggregateRankings(intersections!, limit);
}
export function getZoneBreakdown() {
  ensureLoaded();
  return aggregateZones(intersections!);
}
export function getTurnDistribution() {
  ensureLoaded();
  return aggregateTurnDistribution(intersections!);
}
export function getSignalTimingDistribution(limit = 25) {
  ensureLoaded();
  return aggregateSignalTiming(intersections!, limit);
}
export function getPeakHourLoad() {
  ensureLoaded();
  return aggregatePeakHour(intersections!);
}

// Build a complete "what if every signal was retimed to our suggestion"
// scenario bundle. The exact same scoring algorithm runs against the new
// timing, so the comparison is apples-to-apples.
export function getOptimizedScenario() {
  ensureLoaded();
  ensureOptimizedLoaded();
  const baseline = aggregateSummary(intersections!);
  const optimized = aggregateSummary(optimizedIntersections!);
  // Build per-signal before/after diff. Slim payload (~12 numbers per signal)
  // — over 7,393 signals this is roughly 600KB raw, ~70KB gzipped.
  const signalChanges = intersections!.map((before, idx) => {
    const after = optimizedIntersections![idx]!;
    const tBefore = before.signalTiming;
    const tAfter = after.signalTiming;
    return {
      id: before.id,
      latitude: before.latitude,
      longitude: before.longitude,
      totalVolume: before.totalVolume,
      severityBefore: before.severity,
      severityAfter: after.severity,
      scoreBefore: before.inefficiencyScore,
      scoreAfter: after.inefficiencyScore,
      worstVcBefore: Math.round(before.worstMovement.vcRatio * 100) / 100,
      worstVcAfter: Math.round(after.worstMovement.vcRatio * 100) / 100,
      worstMovementBefore: before.worstMovement.label,
      worstMovementAfter: after.worstMovement.label,
      nsGreenBefore: tBefore.nsGreen,
      nsGreenAfter: tAfter.nsGreen,
      ewGreenBefore: tBefore.ewGreen,
      ewGreenAfter: tAfter.ewGreen,
      protectedLeftBefore: tBefore.protectedLeft,
      protectedLeftAfter: tAfter.protectedLeft,
      cycleLengthBefore: tBefore.cycleLength,
      cycleLengthAfter: tAfter.cycleLength,
    };
  });

  return {
    summary: optimized,
    intersections: optimizedIntersections!.map(toSummary),
    signalChanges,
    rankings: aggregateRankings(optimizedIntersections!, 30),
    turnDistribution: aggregateTurnDistribution(optimizedIntersections!),
    zoneBreakdown: aggregateZones(optimizedIntersections!),
    signalTiming: aggregateSignalTiming(optimizedIntersections!, 25),
    peakHourLoad: aggregatePeakHour(optimizedIntersections!),
    comparison: {
      avgInefficiencyBefore: baseline.averageInefficiency,
      avgInefficiencyAfter: optimized.averageInefficiency,
      avgDelayBefore: baseline.averageDelaySeconds,
      avgDelayAfter: optimized.averageDelaySeconds,
      criticalBefore: baseline.criticalCount,
      criticalAfter: optimized.criticalCount,
      highBefore: baseline.highCount,
      highAfter: optimized.highCount,
      moderateBefore: baseline.moderateCount,
      moderateAfter: optimized.moderateCount,
      lowBefore: baseline.lowCount,
      lowAfter: optimized.lowCount,
      worstScoreBefore: baseline.worstIntersectionScore,
      worstScoreAfter: optimized.worstIntersectionScore,
      // Number of signals that moved out of the high or critical severity bands.
      bottlenecksEliminated:
        baseline.criticalCount + baseline.highCount -
        optimized.criticalCount - optimized.highCount,
      // Network-wide v/c-weighted reduction in worst-movement saturation.
      // Positive means real capacity recovered at the binding constraint.
      avgWorstVcReductionPct: (() => {
        let beforeSum = 0;
        let afterSum = 0;
        for (let i = 0; i < intersections!.length; i++) {
          beforeSum += intersections![i]!.worstMovement.vcRatio;
          afterSum += optimizedIntersections![i]!.worstMovement.vcRatio;
        }
        const beforeAvg = beforeSum / intersections!.length;
        const afterAvg = afterSum / intersections!.length;
        return Math.round(((beforeAvg - afterAvg) / beforeAvg) * 1000) / 10;
      })(),
    },
  };
}

export function getHourlyLoadFor(intersection: Intersection) {
  const through = intersection.movementBreakdown.totalThrough;
  const turning = intersection.movementBreakdown.totalTurning;
  const peak = intersection.inefficiencyScore;
  return HOURLY_FACTORS.map((factor, hour) => ({
    hour,
    label: hourLabel(hour),
    throughVehicles: Math.round(through * factor),
    turningVehicles: Math.round(turning * factor),
    congestionIndex: Math.round(peak * factor * 10) / 10,
  }));
}

export function getRecommendationFor(i: Intersection) {
  const cycle = i.signalTiming.cycleLength;
  const worst = i.worstMovement;
  const currentLeft = i.signalTiming.protectedLeft;
  const currentNs = i.signalTiming.nsGreen;
  const currentEw = i.signalTiming.ewGreen;

  let targetPhase: "Protected Left" | "N/S Green" | "E/W Green" = worst.phase;
  let currentPhaseSeconds = currentLeft;
  let suggestedPhaseSeconds = currentLeft;
  let suggestedCycle = cycle;
  let rationale = "";

  // Phase-current readout
  if (targetPhase === "N/S Green") currentPhaseSeconds = currentNs;
  else if (targetPhase === "E/W Green") currentPhaseSeconds = currentEw;
  else currentPhaseSeconds = currentLeft;

  if (i.severity === "critical") {
    const bump = targetPhase === "Protected Left" ? 12 : 14;
    const cap = targetPhase === "Protected Left" ? 38 : 110;
    suggestedPhaseSeconds = Math.min(currentPhaseSeconds + bump, cap);
    suggestedCycle = cycle + Math.max(4, suggestedPhaseSeconds - currentPhaseSeconds - 4);
    rationale =
      `Worst movement is ${worst.label} at v/c ${worst.vcRatio.toFixed(2)} ` +
      `(saturated). Extending the ${targetPhase.toLowerCase()} phase from ` +
      `${currentPhaseSeconds}s to ${suggestedPhaseSeconds}s and stretching the ` +
      `cycle by ${suggestedCycle - cycle}s should clear the queue and ` +
      `meaningfully reduce delay.`;
  } else if (i.severity === "high") {
    const bump = targetPhase === "Protected Left" ? 8 : 10;
    const cap = targetPhase === "Protected Left" ? 32 : 100;
    suggestedPhaseSeconds = Math.min(currentPhaseSeconds + bump, cap);
    suggestedCycle = cycle + Math.max(2, Math.floor(bump / 2));
    rationale =
      `${worst.label} is operating near saturation (v/c ${worst.vcRatio.toFixed(2)}). ` +
      `A ${suggestedPhaseSeconds - currentPhaseSeconds}s extension to the ` +
      `${targetPhase.toLowerCase()} phase and a small cycle bump should restore ` +
      `reliable progression.`;
  } else if (i.severity === "moderate") {
    suggestedPhaseSeconds = currentPhaseSeconds + 4;
    suggestedCycle = cycle;
    rationale =
      `${worst.label} is the bottleneck (v/c ${worst.vcRatio.toFixed(2)}). ` +
      `Adding ${suggestedPhaseSeconds - currentPhaseSeconds}s of ` +
      `${targetPhase.toLowerCase()} time without lengthening the cycle should ` +
      `remove the constraint.`;
  } else {
    rationale = `Operating within acceptable bounds. No timing change recommended; monitor for demand growth.`;
  }

  const ratio =
    suggestedPhaseSeconds > currentPhaseSeconds
      ? (suggestedPhaseSeconds - currentPhaseSeconds) / currentPhaseSeconds
      : 0;
  const estimatedDelayReductionSeconds =
    Math.round(i.avgDelaySeconds * ratio * 0.55 * 10) / 10;

  return {
    intersectionId: i.id,
    intersectionName: i.name,
    targetPhase,
    targetMovement: worst.label,
    currentPhaseSeconds,
    suggestedPhaseSeconds,
    currentCycleLength: cycle,
    suggestedCycleLength: suggestedCycle,
    estimatedDelayReductionSeconds,
    rationale,
  };
}

export function getRecommendations(limit = 30) {
  ensureLoaded();
  return intersections!
    .filter((i) => i.severity === "critical" || i.severity === "high")
    .sort((a, b) => b.inefficiencyScore - a.inefficiencyScore)
    .slice(0, limit)
    .map(getRecommendationFor);
}

// =============================================================================
// PREDICTION MODEL — historical patterns + accident data → next-day forecast
// =============================================================================

export type RiskTier = "none" | "low" | "moderate" | "high" | "severe";

export type SignalAccidentRisk = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  crashes: number;
  fatal: number;
  seriousInjuries: number;
  severityScore: number;
  riskTier: RiskTier;
};

function riskTierFor(crashes: number, severityScore: number): RiskTier {
  // Calibrated against the actual ARC distribution (most signals see <5
  // crashes over 5 years; the worst see 100+).
  if (crashes === 0) return "none";
  if (crashes >= 60 || severityScore >= 800) return "severe";
  if (crashes >= 25 || severityScore >= 350) return "high";
  if (crashes >= 8 || severityScore >= 100) return "moderate";
  return "low";
}

function crashSurgeFor(tier: RiskTier): number {
  // Extra delay/score multiplier applied to accident-prone intersections,
  // representing the higher probability of a secondary delay-causing
  // incident on the predicted day. Bumps were softened so the historical
  // crash tier nudges (rather than dominates) the predicted score.
  switch (tier) {
    case "severe": return 0.12;
    case "high":   return 0.06;
    case "moderate": return 0.03;
    case "low":    return 0.01;
    default:       return 0.0;
  }
}

let cachedRiskByOsmId: Map<number, SignalAccidentRisk> | null = null;
let cachedRiskFlat: SignalAccidentRisk[] | null = null;

function ensureRiskLoaded(): void {
  if (cachedRiskByOsmId) return;
  ensureLoaded();
  const ds = loadAccidents();
  cachedRiskByOsmId = new Map();
  cachedRiskFlat = [];
  for (const inter of intersections!) {
    const osmId = Number(inter.id.replace(/^ATL-/, ""));
    const tup = ds?.perSignal[String(osmId)];
    const crashes = tup?.[0] ?? 0;
    const fatal = tup?.[1] ?? 0;
    const seriousInjuries = tup?.[2] ?? 0;
    const severityScore = tup?.[3] ?? 0;
    const tier = riskTierFor(crashes, severityScore);
    const risk: SignalAccidentRisk = {
      id: inter.id,
      name: inter.name,
      latitude: inter.latitude,
      longitude: inter.longitude,
      crashes,
      fatal,
      seriousInjuries,
      severityScore,
      riskTier: tier,
    };
    cachedRiskByOsmId.set(osmId, risk);
    cachedRiskFlat.push(risk);
  }
}

export function getAccidentRiskBundle() {
  ensureRiskLoaded();
  const ds = loadAccidents();
  // Default distributions if dataset hasn't been preprocessed yet — fall back
  // to a reasonable nationwide commute pattern so the prediction model still
  // produces sensible output.
  const defaultHourly = [
    18, 12, 9, 8, 11, 22, 41, 58, 62, 51, 45, 49,
    55, 53, 51, 60, 78, 84, 72, 58, 49, 38, 30, 22,
  ];
  const defaultDow = [125, 105, 102, 105, 108, 130, 135]; // Sun..Sat
  const defaultMonthly = new Array(12).fill(100);
  const meta = ds?.meta ?? {
    sourceCollisions: "(not yet preprocessed)",
    sourceFARS: "(not yet preprocessed)",
    dateRange: "n/a",
    totalCrashes: 0,
    snappedCrashes: 0,
    snappedPct: 0,
    signalsWithData: 0,
    snapRadiusMeters: 100,
    farsRecords: 0,
  };
  const hourly = (ds?.hourly && ds.hourly.length === 24) ? ds.hourly : defaultHourly;
  const dow = (ds?.dow && ds.dow.length === 7) ? ds.dow : defaultDow;
  const monthly = (ds?.monthly && ds.monthly.length === 12) ? ds.monthly : defaultMonthly;
  return {
    meta: {
      sourceCollisions: meta.sourceCollisions,
      sourceFARS: meta.sourceFARS,
      dateRange: meta.dateRange,
      totalCrashes: meta.totalCrashes,
      snappedCrashes: meta.snappedCrashes,
      snappedPct: meta.snappedPct,
      signalsWithData: meta.signalsWithData,
      snapRadiusMeters: meta.snapRadiusMeters,
      farsRecords: meta.farsRecords,
    },
    perSignal: cachedRiskFlat!,
    hourly,
    dow,
    monthly,
  };
}

// ---------- scenario shapes ----------

// HOURLY_FACTORS (above) is the weekday commute shape and stays the
// reference. Weekend / holiday days use shifted shapes — flatter peaks,
// later morning rise, no commute-shaped AM/PM spikes.
const WEEKEND_SHAPE = [
  0.10, 0.08, 0.06, 0.05, 0.06, 0.10, 0.18, 0.30, 0.45, 0.60, 0.78, 0.88,
  0.92, 0.90, 0.88, 0.85, 0.82, 0.80, 0.72, 0.62, 0.50, 0.40, 0.30, 0.20,
];
const HOLIDAY_SHAPE = [
  0.12, 0.09, 0.07, 0.06, 0.07, 0.10, 0.18, 0.28, 0.42, 0.55, 0.65, 0.72,
  0.78, 0.80, 0.78, 0.75, 0.72, 0.70, 0.62, 0.52, 0.42, 0.34, 0.26, 0.18,
];
// School-zone bumps applied additively when schoolDay flag is set.
const SCHOOL_BUMP = [
  0, 0, 0, 0, 0, 0, 0.04, 0.10, 0.04, 0, 0, 0,
  0, 0, 0.06, 0.10, 0.04, 0, 0, 0, 0, 0, 0, 0,
];

// dow: 0=Sun..6=Sat per JS Date.getDay() in America/New_York
const DOW_MULT = [0.50, 0.92, 1.00, 1.00, 1.00, 1.05, 0.65];
const DOW_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type WeatherCond = "clear" | "light_rain" | "heavy_rain" | "snow";
const WEATHER_MULT: Record<WeatherCond, number> = {
  clear: 1.00,
  light_rain: 1.08,
  heavy_rain: 1.18,
  snow: 1.45,
};

export type EventFlags = {
  falconsHome?: boolean;
  hawksHome?: boolean;
  bravesHome?: boolean;
  gtFootball?: boolean;
  holiday?: boolean;
  schoolDay?: boolean;
};

// Special-event geographic centers — boost any signal within `radiusMi` for
// the event hours by `boost` (e.g. 0.4 = +40% volume during event window).
type EventZone = {
  lat: number; lon: number; radiusMi: number; hours: number[]; boost: number;
};
const EVENT_ZONES: Record<string, EventZone> = {
  // Mercedes-Benz Stadium: kickoff windows for Falcons (Sun 1p / Mon Night)
  falconsHome: { lat: 33.7553, lon: -84.4006, radiusMi: 2.5, hours: [11,12,13,14,15,16,17,18], boost: 0.40 },
  // State Farm Arena: tip-off ~7:30p typical
  hawksHome:   { lat: 33.7573, lon: -84.3963, radiusMi: 2.0, hours: [17,18,19,20,21,22], boost: 0.30 },
  // Truist Park (Cobb): 7p typical, ~1p Sunday
  bravesHome:  { lat: 33.8908, lon: -84.4678, radiusMi: 2.5, hours: [16,17,18,19,20,21,22], boost: 0.35 },
  // Bobby Dodd Stadium: Sat afternoon games
  gtFootball:  { lat: 33.7724, lon: -84.3924, radiusMi: 2.0, hours: [10,11,12,13,14,15,16,17], boost: 0.45 },
};

function eventBoostFor(lat: number, lon: number, hour: number, flags: EventFlags): number {
  let boost = 0;
  for (const key of Object.keys(EVENT_ZONES) as Array<keyof typeof EVENT_ZONES>) {
    if (!flags[key as keyof EventFlags]) continue;
    const z = EVENT_ZONES[key];
    if (!z.hours.includes(hour)) continue;
    const d = distanceMiles(lat, lon, z.lat, z.lon);
    if (d <= z.radiusMi) {
      // Linear falloff within radius
      const falloff = 1 - d / z.radiusMi;
      boost += z.boost * falloff;
    }
  }
  return boost;
}

function parseDateLocal(dateStr: string): Date {
  // Interpret YYYY-MM-DD as a local America/New_York date by parsing as UTC
  // noon. The DOW is invariant to TZ for a noon-UTC value across all of
  // continental US.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`Invalid date: ${dateStr} (expected YYYY-MM-DD)`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Reject impossible calendar values (e.g. 2026-13-40 or Feb 30) — Date.UTC
  // would silently roll these forward.
  if (mo < 1 || mo > 12 || d < 1 || d > 31) {
    throw new Error(`Invalid date: ${dateStr} (out of range)`);
  }
  const date = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new Error(`Invalid date: ${dateStr} (not a real calendar date)`);
  }
  return date;
}

export type PredictedSignal = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  roadClass: string;
  baselineScore: number;
  predictedPeakScore: number;
  predictedPeakHour: number;
  predictedAvgScore: number;
  predictedSeverity: Severity;
  deltaVsBaseline: number;
  crashRiskTier: RiskTier;
  crashSurgePct: number;
  hourly: number[];
};

export type PredictDayInput = {
  date: string;
  weather?: WeatherCond;
  events?: EventFlags;
  // Optional per-hour weather multipliers (length 24, hour 0..23 local).
  // When provided, these REPLACE the discrete `weather` bucket multiplier
  // for each hour — used when continuous NWS/Open-Meteo data is available.
  hourlyWeatherMults?: number[];
};

export function predictDay(input: PredictDayInput) {
  ensureRiskLoaded();
  const date = parseDateLocal(input.date);
  const dow = date.getUTCDay(); // 0..6, Sun..Sat (UTC noon → same in any US TZ)
  const isWeekend = dow === 0 || dow === 6;
  const events: EventFlags = input.events ?? {};
  const weather: WeatherCond = input.weather ?? "clear";
  const dowMult = DOW_MULT[dow]!;
  const bucketWeatherMult = WEATHER_MULT[weather];
  // Per-hour weather multipliers: prefer caller-supplied continuous data
  // (NWS / Open-Meteo measurements), otherwise fall back to the discrete
  // bucket multiplier applied uniformly across all 24 hours.
  const hourWeatherMults: number[] = input.hourlyWeatherMults
    && input.hourlyWeatherMults.length === 24
    ? input.hourlyWeatherMults
    : new Array<number>(24).fill(bucketWeatherMult);
  // Daily average weather multiplier — used downstream in summary outputs
  // that report a single representative number.
  const weatherMult =
    hourWeatherMults.reduce((s, v) => s + v, 0) / 24;

  // Pick the hour-of-day shape: holiday > weekend > weekday.
  const baseShape =
    events.holiday ? HOLIDAY_SHAPE :
    isWeekend ? WEEKEND_SHAPE :
    HOURLY_FACTORS;

  // Build a 24-hr scenario shape (multiplier vs the existing peak baseline,
  // which corresponds to HOURLY_FACTORS=1.0 at hour 8).
  const shape = baseShape.map((v, h) => {
    let s = v;
    if (events.schoolDay && !events.holiday && !isWeekend) s += SCHOOL_BUMP[h]!;
    return s;
  });

  const signalPositions = intersections!.map((i) => ({
    osmId: Number(i.id.replace(/^ATL-/, "")),
    lat: i.latitude,
    lon: i.longitude,
  }));
  const recentActivityMults = getSpatialActivityMultipliers(signalPositions);

  const totalSignals = intersections!.length;
  const hourlyAgg = new Array(24).fill(0); // sum of scores for averaging
  const hourlyCritical = new Array(24).fill(0);
  const hourlyHigh = new Array(24).fill(0);
  let totalEventBoostSampled = 0;
  let eventSignalCount = 0;

  const out: PredictedSignal[] = new Array(totalSignals);

  for (let idx = 0; idx < totalSignals; idx++) {
    const i = intersections![idx]!;
    const baselineScore = i.inefficiencyScore;
    const worstVc = i.worstMovement.vcRatio;
    // Reconstruct the weighted v/c from the score components is fragile, so
    // approximate weighted v/c as ~0.55 of worst v/c (empirical for the
    // current dataset). The prediction shape matters more than the exact
    // scaler — DOW/weather/events drive most of the signal.
    const weightedVc = worstVc * 0.55;
    const totalVol = i.totalVolume;
    const osmId = Number(i.id.replace(/^ATL-/, ""));
    const risk = cachedRiskByOsmId!.get(osmId);
    const tier: RiskTier = risk?.riskTier ?? "none";
    const surge = crashSurgeFor(tier); // % bump on score for this signal
    // Feedback loop: signals that have repeatedly had live incidents in the
    // last 7 days get a small additional bump (1.00..1.25x). Computed once
    // per predictDay() call below from the persisted history file.
    const recentMult = recentActivityMults.get(osmId) ?? 1.0;

    let peakScore = 0;
    let peakHour = 0;
    let sumScore = 0;
    const hourly: number[] = new Array(24);
    for (let h = 0; h < 24; h++) {
      const eb = eventBoostFor(i.latitude, i.longitude, h, events);
      if (eb > 0) { totalEventBoostSampled += eb; eventSignalCount++; }
      // Effective per-hour multiplier on volume (and therefore on v/c).
      const M = shape[h]! * dowMult * hourWeatherMults[h]! * (1 + eb);
      const wVc = worstVc * M;
      const wgVc = weightedVc * M;
      const vol = totalVol * M;
      // Same relaxed normalization breakpoints as the baseline composite
      // score (see the long-form comment in computeIntersection).
      const normWorst = Math.max(0, Math.min(1, (wVc - 0.30) / 0.7));
      const normWeighted = Math.max(0, Math.min(1, (wgVc - 0.20) / 0.6));
      const crossPenalty = Math.min(vol / 2500, 1);
      let score = Math.max(0, Math.min(100, normWorst * 50 + normWeighted * 30 + crossPenalty * 20));
      // Crash-surge: scale the score upward by the surge fraction. Caps at 100.
      score = Math.min(100, score * (1 + surge) * recentMult);
      score = Math.round(score * 10) / 10;
      hourly[h] = score;
      sumScore += score;
      if (score > peakScore) { peakScore = score; peakHour = h; }
      hourlyAgg[h] += score;
      const sev = severityFromScore(score);
      if (sev === "critical") hourlyCritical[h]++;
      else if (sev === "high") hourlyHigh[h]++;
    }
    const avgScore = Math.round((sumScore / 24) * 10) / 10;
    const peakSeverity = severityFromScore(peakScore);
    out[idx] = {
      id: i.id,
      name: i.name,
      latitude: i.latitude,
      longitude: i.longitude,
      roadClass: i.roadClass,
      baselineScore,
      predictedPeakScore: peakScore,
      predictedPeakHour: peakHour,
      predictedAvgScore: avgScore,
      predictedSeverity: peakSeverity,
      deltaVsBaseline: Math.round((peakScore - baselineScore) * 10) / 10,
      crashRiskTier: tier,
      crashSurgePct: Math.round(surge * 1000) / 10,
      hourly,
    };
  }

  // Network-wide stats
  let critical = 0, high = 0, moderate = 0, low = 0, sumPeak = 0;
  for (const s of out) {
    sumPeak += s.predictedPeakScore;
    if (s.predictedSeverity === "critical") critical++;
    else if (s.predictedSeverity === "high") high++;
    else if (s.predictedSeverity === "moderate") moderate++;
    else low++;
  }

  // Identify the global peak hour
  let peakHourGlobal = 0;
  let peakHourValue = -1;
  for (let h = 0; h < 24; h++) {
    if (hourlyAgg[h] > peakHourValue) { peakHourValue = hourlyAgg[h]; peakHourGlobal = h; }
  }

  // Crash-likelihood-by-hour (FARS-derived) for the hourly-aggregate panel
  const acc = getAccidentRiskBundle();
  const farsHourSum = acc.hourly.reduce((s, v) => s + v, 0) || 1;
  const crashLikelihoodByHour = acc.hourly.map((v) => v / farsHourSum);

  const hourlyOut = hourlyAgg.map((sumScore, h) => ({
    hour: h,
    label: hourLabel(h),
    avgPredictedScore: Math.round((sumScore / totalSignals) * 10) / 10,
    criticalCount: hourlyCritical[h],
    highCount: hourlyHigh[h],
    weatherFactor: weatherMult,
    crashLikelihoodFactor: Math.round(crashLikelihoodByHour[h]! * 1000) / 1000,
  }));

  // Top-30 worst signals by predicted peak
  const topWorst = [...out]
    .sort((a, b) => b.predictedPeakScore - a.predictedPeakScore)
    .slice(0, 30);

  // Pre-emptive recommendations for the top 15 worst
  const recommendations = topWorst.slice(0, 15).map((s) => {
    const peakLabel = hourLabel(s.predictedPeakHour);
    const tierLabel = s.crashRiskTier !== "none"
      ? ` Historical crash risk is ${s.crashRiskTier} (+${s.crashSurgePct.toFixed(0)}% delay surge applied).`
      : "";
    let action: string;
    if (s.predictedSeverity === "critical") {
      action = `Pre-load extended-cycle plan for ${peakLabel} window`;
    } else if (s.predictedSeverity === "high") {
      action = `Activate adaptive plan from ${peakLabel} ±1h`;
    } else {
      action = `Monitor; standby plan ready`;
    }
    return {
      intersectionId: s.id,
      intersectionName: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      predictedPeakHour: s.predictedPeakHour,
      predictedPeakScore: s.predictedPeakScore,
      action,
      rationale:
        `Predicted peak ${s.predictedPeakScore.toFixed(1)} at ${peakLabel} ` +
        `(baseline ${s.baselineScore.toFixed(1)}, Δ${s.deltaVsBaseline >= 0 ? "+" : ""}${s.deltaVsBaseline.toFixed(1)}).` +
        tierLabel,
    };
  });

  let activeEvents = 0;
  for (const k of Object.keys(EVENT_ZONES)) {
    if ((events as Record<string, boolean | undefined>)[k]) activeEvents++;
  }
  const eventMultiplier = activeEvents === 0 ? 1.0 :
    Math.round((1 + (eventSignalCount > 0 ? totalEventBoostSampled / eventSignalCount : 0)) * 100) / 100;

  return {
    meta: {
      date: input.date,
      dayOfWeek: DOW_NAME[dow]!,
      weather,
      events,
      dowMultiplier: dowMult,
      weatherMultiplier: weatherMult,
      eventMultiplier,
      criticalCount: critical,
      highCount: high,
      moderateCount: moderate,
      lowCount: low,
      avgPredictedScore: Math.round((sumPeak / totalSignals) * 10) / 10,
      peakHourGlobal,
    },
    hourly: hourlyOut,
    signals: out,
    topWorst,
    recommendations,
  };
}

// ---------- Today's accident hotspot predictions (signal × hour ranking) ----------
//
// Combines:
//   1) The full predictDay() output for today (so weather + DOW + events +
//      recent-activity feedback are baked in).
//   2) Per-signal historical crash risk tier (ARC + FARS).
//   3) FARS hour-of-day fatal-crash distribution.
//
// Returns the top-N (signal, hour) pairs most likely to host an accident
// today, where likelihood is a unitless score in [0..100]. Past hours are
// excluded by default so the list stays actionable as the day progresses.

export type AccidentHotspot = {
  rank: number;
  intersectionId: string;
  intersectionName: string;
  latitude: number;
  longitude: number;
  hour: number;            // 0..23 in America/New_York
  hourLabel: string;
  likelihood: number;      // 0..100
  predictedScore: number;  // signal stress at that hour (0..100)
  crashRiskTier: RiskTier;
  historicalCrashes: number;
  isPast: boolean;
  rationale: string;
};

export type TodayAccidentPredictions = {
  date: string;
  generatedAt: string;
  weather: WeatherCond;
  weatherSummary: string;
  currentHourLocal: number;
  includesPastHours: boolean;
  topN: number;
  hotspots: AccidentHotspot[];
};

export type TodayAccidentInput = {
  date: string;
  weather: WeatherCond;
  weatherSummary?: string;
  events: EventFlags;
  topN: number;
  includePastHours: boolean;
  currentHourLocal: number;
  hourlyWeatherMults?: number[];
};

// Numeric weight for each crash-risk tier. Tuned so that a "severe" tier
// dominates a "low" tier roughly 7:1 — matching the empirical crash-rate
// ratio between the worst and middle ARC quintiles in our dataset.
function crashRiskWeight(tier: RiskTier): number {
  switch (tier) {
    case "severe":   return 1.00;
    case "high":     return 0.65;
    case "moderate": return 0.35;
    case "low":      return 0.15;
    default:         return 0.05;
  }
}

export function predictTodayAccidents(input: TodayAccidentInput): TodayAccidentPredictions {
  ensureLoaded();
  ensureRiskLoaded();

  const prediction = predictDay({
    date: input.date,
    weather: input.weather,
    events: input.events,
    hourlyWeatherMults: input.hourlyWeatherMults,
  });

  // Normalized FARS hour-of-day fatal-crash share (sums to 1.0 across 24h).
  const acc = getAccidentRiskBundle();
  const farsSum = acc.hourly.reduce((s, v) => s + v, 0) || 1;
  const farsShare = acc.hourly.map((v) => v / farsSum); // length 24

  // Build the (signal × hour) candidate list. Heap-style trim to top-N
  // would be marginally faster, but at 7,393 signals × 24 hours ≈ 178k
  // tuples the full sort is still <50ms and keeps the code simple.
  type Candidate = {
    signalIdx: number;
    hour: number;
    likelihood: number;
    predictedScore: number;
  };
  const candidates: Candidate[] = [];

  for (let i = 0; i < prediction.signals.length; i++) {
    const s = prediction.signals[i]!;
    const w = crashRiskWeight(s.crashRiskTier);
    if (w === 0.05 && s.predictedPeakScore < 30) continue; // prune tiny-risk noise
    for (let h = 0; h < 24; h++) {
      if (!input.includePastHours && h < input.currentHourLocal) continue;
      const stress = s.hourly[h] ?? 0;
      if (stress < 5) continue;
      // Likelihood combines:
      //   * stress score (already weather/dow/event/recent-activity adjusted)
      //   * signal-level historical crash-risk weight
      //   * FARS hour-of-day fatal-crash share, scaled to a [1.0..2.5] band
      //     so the most dangerous hours get a noticeable bump without
      //     completely dominating mid-day spikes. With 24 hours summing to
      //     1.0, an "average" hour has share≈0.0417 (boost ≈ 2.50, clipped
      //     at the cap), and the model differentiates further only above
      //     average — i.e. the cap binds for ~half the day. This is
      //     intentional: late-evening hours where most fatals happen
      //     should consistently saturate, and we want the historical-risk
      //     tier to dominate ranking among saturated hours.
      const farsBoost = 1 + 1.5 * 24 * farsShare[h]!;
      const likelihood = stress * (0.3 + 0.7 * w) * Math.min(farsBoost, 2.5);
      candidates.push({
        signalIdx: i,
        hour: h,
        likelihood,
        predictedScore: stress,
      });
    }
  }

  candidates.sort((a, b) => b.likelihood - a.likelihood);

  // Diversify: cap each unique signal at 2 hours in the top-N so the list
  // doesn't fill up with the same intersection at consecutive hours.
  const perSignalCap = 2;
  const perSignalCount = new Map<number, number>();
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    const used = perSignalCount.get(c.signalIdx) ?? 0;
    if (used >= perSignalCap) continue;
    perSignalCount.set(c.signalIdx, used + 1);
    chosen.push(c);
    if (chosen.length >= input.topN) break;
  }

  // Normalize likelihood to a 0..100 display scale based on the strongest
  // candidate in this run. Keeps the UI readable across days/seasons.
  const maxL = chosen[0]?.likelihood ?? 1;
  const hotspots: AccidentHotspot[] = chosen.map((c, idx) => {
    const s = prediction.signals[c.signalIdx]!;
    const display = Math.round((c.likelihood / maxL) * 1000) / 10;
    return {
      rank: idx + 1,
      intersectionId: s.id,
      intersectionName: s.name,
      latitude: s.latitude,
      longitude: s.longitude,
      hour: c.hour,
      hourLabel: hourLabel(c.hour),
      likelihood: display,
      predictedScore: Math.round(c.predictedScore * 10) / 10,
      crashRiskTier: s.crashRiskTier,
      historicalCrashes: cachedRiskByOsmId!.get(
        Number(s.id.replace(/^ATL-/, "")),
      )?.crashes ?? 0,
      isPast: c.hour < input.currentHourLocal,
      rationale:
        `Stress ${c.predictedScore.toFixed(0)}/100 at ${hourLabel(c.hour)}, ` +
        `${s.crashRiskTier === "none" ? "no" : s.crashRiskTier} historical crash tier, ` +
        `FARS shows ${(farsShare[c.hour]! * 100).toFixed(1)}% of fatal crashes happen at this hour.`,
    };
  });

  return {
    date: input.date,
    generatedAt: new Date().toISOString(),
    weather: input.weather,
    weatherSummary: input.weatherSummary ?? input.weather,
    currentHourLocal: input.currentHourLocal,
    includesPastHours: input.includePastHours,
    topN: input.topN,
    hotspots,
  };
}
