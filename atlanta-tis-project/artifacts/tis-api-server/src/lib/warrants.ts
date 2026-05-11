/**
 * MUTCD Chapter 4C — Signal Warrant Analysis engine.
 *
 * Implements four warrants per the 2009 MUTCD with 2024 amendments:
 *   1A — Eight-Hour Vehicular Volume, Condition A (Minimum Volume)
 *   1B — Eight-Hour Vehicular Volume, Condition B (Interruption)
 *    3 — Peak Hour (volume-only proxy from Fig. 4C-3; delay-based
 *        comparison left to the engineer's signal-timing software)
 *    7 — Crash Experience
 *
 * Threshold tables are MUTCD Table 4C-1 (Warrant 1A), Table 4C-2
 * (Warrant 1B), and Figure 4C-3 (Warrant 3 / Peak Hour). The 70%
 * reduction applies when the major street's 85th-percentile speed
 * exceeds 40 mph OR the intersection is in an isolated community
 * of fewer than 10,000 residents.
 */
import type {
  GenerateWarrantsBodyT,
  GenerateWarrantsResponseT,
} from "@workspace/tis-api-zod";

type LaneKey = "1_1" | "2_1" | "2_2" | "1_2";

function laneKey(major: "1" | "2+", minor: "1" | "2+"): LaneKey {
  if (major === "1" && minor === "1") return "1_1";
  if (major === "2+" && minor === "1") return "2_1";
  if (major === "2+" && minor === "2+") return "2_2";
  return "1_2";
}

function laneConfigLabel(major: "1" | "2+", minor: "1" | "2+"): string {
  return `Major ${major} lane${major === "2+" ? "s" : ""} each direction · Minor ${minor} lane${minor === "2+" ? "s" : ""} each direction`;
}

/** MUTCD Table 4C-1 — Warrant 1A (Minimum Vehicular Volume), 100% values. */
const TBL_1A: Record<LaneKey, { major: number; minor: number }> = {
  "1_1": { major: 500, minor: 150 },
  "2_1": { major: 600, minor: 150 },
  "2_2": { major: 600, minor: 200 },
  "1_2": { major: 500, minor: 200 },
};

/** MUTCD Table 4C-2 — Warrant 1B (Interruption of Continuous Traffic), 100% values. */
const TBL_1B: Record<LaneKey, { major: number; minor: number }> = {
  "1_1": { major: 750, minor: 75 },
  "2_1": { major: 900, minor: 75 },
  "2_2": { major: 900, minor: 100 },
  "1_2": { major: 750, minor: 100 },
};

/**
 * MUTCD Fig. 4C-3 — Warrant 3 (Peak Hour). The published figure is a
 * smooth curve relating major-street total volume to minor-approach
 * minimum volume. The screening tier uses two anchor thresholds taken
 * from the published 100% curve at the lane-configuration-specific
 * inflection point. For finer detail, run a delay-based analysis.
 */
const TBL_3: Record<LaneKey, { major: number; minor: number }> = {
  "1_1": { major: 800, minor: 150 },
  "2_1": { major: 1000, minor: 150 },
  "2_2": { major: 1000, minor: 200 },
  "1_2": { major: 800, minor: 200 },
};

function applyReduction<T extends { major: number; minor: number }>(
  thresholds: T,
  apply: boolean,
): T {
  if (!apply) return thresholds;
  return { ...thresholds, major: thresholds.major * 0.7, minor: thresholds.minor * 0.7 };
}

export class WarrantsEngineError extends Error {}

export function runWarrantsAnalysis(
  body: GenerateWarrantsBodyT,
): GenerateWarrantsResponseT {
  const k = laneKey(body.majorStreet.lanesEachDirection, body.minorStreet.lanesEachDirection);
  const reductionApplied =
    body.applyReductionFactor ?? body.majorStreet.speed85thMph > 40;

  const t1a = applyReduction(TBL_1A[k], reductionApplied);
  const t1b = applyReduction(TBL_1B[k], reductionApplied);
  const t3 = applyReduction(TBL_3[k], reductionApplied);

  const w1a = evaluate8HourWarrant({
    id: "1A",
    name: "Warrant 1A — Eight-Hour Vehicular Volume (Condition A)",
    description: "Minimum vehicular volume on major and minor for 8 hours of an average day.",
    body,
    threshold: t1a,
    hoursRequired: 8,
  });
  const w1b = evaluate8HourWarrant({
    id: "1B",
    name: "Warrant 1B — Eight-Hour Vehicular Volume (Condition B)",
    description:
      "Interruption of continuous traffic: minor-street delay justifies signal. " +
      "Higher major threshold, lower minor threshold than Warrant 1A.",
    body,
    threshold: t1b,
    hoursRequired: 8,
  });
  const w3 = evaluatePeakHourWarrant(body, t3, reductionApplied);
  const w7 = evaluateCrashWarrant(body, t1a, t1b);

  const warrants = [w1a, w1b, w3, w7];
  const anyWarrantMet = warrants.some((w) => w.met);

  return {
    projectName: body.projectName,
    intersection: {
      name: body.intersectionName ?? `${body.majorStreet.name} @ ${body.minorStreet.name}`,
      major: body.majorStreet.name,
      minor: body.minorStreet.name,
      laneConfig: laneConfigLabel(
        body.majorStreet.lanesEachDirection,
        body.minorStreet.lanesEachDirection,
      ),
    },
    reductionApplied,
    warrants,
    anyWarrantMet,
    citations: [
      "MUTCD 2009 / 2024 amendments, Chapter 4C — Traffic Control Signal Needs Studies.",
      "MUTCD Table 4C-1 — Warrant 1A (Minimum Vehicular Volume).",
      "MUTCD Table 4C-2 — Warrant 1B (Interruption of Continuous Traffic).",
      "MUTCD Figure 4C-3 — Warrant 3 (Peak Hour) volume curve, screening approximation.",
      "MUTCD Section 4C.08 — Warrant 7 (Crash Experience).",
    ],
  };
}

function evaluate8HourWarrant(args: {
  id: "1A" | "1B";
  name: string;
  description: string;
  body: GenerateWarrantsBodyT;
  threshold: { major: number; minor: number };
  hoursRequired: number;
}) {
  const breakdown = buildHourBreakdown(args.body, args.threshold);
  const hoursSatisfied = breakdown.filter((h) => h.bothMet).length;
  return {
    id: args.id,
    name: args.name,
    description: args.description,
    met: hoursSatisfied >= args.hoursRequired,
    hoursSatisfied,
    hoursRequired: args.hoursRequired,
    hourBreakdown: breakdown,
    notes:
      hoursSatisfied >= args.hoursRequired
        ? [
            `Both major (${args.threshold.major.toFixed(0)} vph) and minor (${args.threshold.minor.toFixed(0)} vph) thresholds met or exceeded in ${hoursSatisfied} hours.`,
          ]
        : [
            `Only ${hoursSatisfied} of the required ${args.hoursRequired} hours satisfied both thresholds.`,
            hoursSatisfied === 0
              ? "Reconsider whether the intersection geometry warrants a signal at all."
              : `Need ${args.hoursRequired - hoursSatisfied} more qualifying hour(s) for this warrant.`,
          ],
  };
}

function evaluatePeakHourWarrant(
  body: GenerateWarrantsBodyT,
  threshold: { major: number; minor: number },
  reductionApplied: boolean,
) {
  const breakdown = buildHourBreakdown(body, threshold);
  const matchingHours = breakdown.filter((h) => h.bothMet);
  const met = matchingHours.length >= 1;
  // Surface the peak hour (highest major-street total) in the report.
  const peakHour = [...breakdown].sort((a, b) => b.majorVolume - a.majorVolume)[0];
  const notes: string[] = [];
  if (peakHour) {
    notes.push(
      `Peak hour: ${peakHour.hour}:00 — major ${peakHour.majorVolume} vph, minor ${peakHour.minorVolume} vph.`,
    );
  }
  if (met) {
    notes.push(
      `At least one hour cleared both the major (${threshold.major.toFixed(0)} vph) and minor (${threshold.minor.toFixed(0)} vph) thresholds.`,
    );
  } else {
    notes.push(
      "No single hour cleared both major and minor thresholds from MUTCD Fig. 4C-3.",
    );
  }
  if (reductionApplied) {
    notes.push("70% thresholds applied (major-street speed > 40 mph or low-population community).");
  }
  notes.push(
    "Screening volume-only proxy. A full Warrant 3 analysis also requires a delay-based check against MUTCD Fig. 4C-3 thresholds (4 or 5 vehicle-hours of minor-approach delay).",
  );
  return {
    id: "3" as const,
    name: "Warrant 3 — Peak Hour",
    description: "Volume-only proxy: any single hour of an average day where both thresholds are exceeded.",
    met,
    hoursSatisfied: matchingHours.length,
    hoursRequired: 1,
    hourBreakdown: breakdown,
    notes,
  };
}

function evaluateCrashWarrant(
  body: GenerateWarrantsBodyT,
  t1a: { major: number; minor: number },
  t1b: { major: number; minor: number },
) {
  const crashes = body.crashCount12mo ?? 0;
  const crashCountClear = crashes >= 5;

  // The 80% volume condition: same hour-counting logic but at 80% of
  // either 1A or 1B thresholds.
  const t1a80 = { major: t1a.major * 0.8, minor: t1a.minor * 0.8 };
  const t1b80 = { major: t1b.major * 0.8, minor: t1b.minor * 0.8 };
  const breakdown1a = buildHourBreakdown(body, t1a80);
  const breakdown1b = buildHourBreakdown(body, t1b80);
  const hoursA = breakdown1a.filter((h) => h.bothMet).length;
  const hoursB = breakdown1b.filter((h) => h.bothMet).length;
  const volumeClear = hoursA >= 8 || hoursB >= 8;

  const met = crashCountClear && volumeClear;
  const notes: string[] = [];
  if (!body.crashCount12mo) {
    notes.push(
      "No crash count provided. Warrant 7 cannot be confirmed met without the 12-month crash history.",
    );
  } else {
    notes.push(
      `${crashes} crash(es) in last 12 months — ${crashCountClear ? "≥ 5 threshold satisfied" : "below the 5-crash threshold"}.`,
    );
  }
  notes.push(
    `80%-volume condition: ${hoursA} hours at 80% of Warrant 1A; ${hoursB} hours at 80% of Warrant 1B; need ≥ 8 in either.`,
  );
  notes.push(
    "Full Warrant 7 also requires that the crashes be of types correctable by signal control (right-angle, left-turn) and that less-restrictive remedies have been tried — both engineering-judgement calls beyond this screening tool.",
  );

  return {
    id: "7" as const,
    name: "Warrant 7 — Crash Experience",
    description:
      "≥ 5 signal-correctable crashes in 12 months AND volumes at 80% of Warrant 1A or 1B for 8 hours.",
    met,
    hoursSatisfied: Math.max(hoursA, hoursB),
    hoursRequired: 8,
    // Use whichever set of 80% thresholds yielded more matching hours so
    // the engineer sees their best argument.
    hourBreakdown: hoursA >= hoursB ? breakdown1a : breakdown1b,
    notes,
  };
}

function buildHourBreakdown(
  body: GenerateWarrantsBodyT,
  threshold: { major: number; minor: number },
) {
  return body.hourlyVolumesMajor.map((maj, h) => {
    const min = body.hourlyVolumesMinor[h] ?? 0;
    const majorMet = maj >= threshold.major;
    const minorMet = min >= threshold.minor;
    return {
      hour: h,
      majorVolume: Math.round(maj),
      minorVolume: Math.round(min),
      majorThreshold: Math.round(threshold.major),
      minorThreshold: Math.round(threshold.minor),
      majorMet,
      minorMet,
      bothMet: majorMet && minorMet,
    };
  });
}
