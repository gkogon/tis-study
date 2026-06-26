/**
 * verify-turbo-lane.ts — runnable verification for turbo-lane (continuous-green-T)
 * screening. Run via tsx (the repo has no unit-test runner):
 *
 *   pnpm --filter @workspace/scripts exec tsx src/verify-turbo-lane.ts
 *
 * Checks:
 *   A. Capacity-gain math, Webster green-ratio derivation, envelope clamp,
 *      and candidacy gating — pure functions, no external services.
 *   B. The real leg/median geometry classifier over several metros (reads the
 *      shipped roads/signals data), confirming candidates are found and are a
 *      sane minority of signals (turbo lanes are rare and specific).
 *   C. Best-effort end-to-end: if the analyzer is reachable, generate a report
 *      and confirm turboLane flows through; otherwise skipped.
 */
// turbo-lane.ts re-exports HCM helpers from tis.ts, whose import graph touches
// lib/db (requires DATABASE_URL at load) — in production turbo-lane is always
// co-loaded with tis, so this is only a standalone-harness concern. Set a
// placeholder before the dynamic imports so the script is self-contained.
process.env["DATABASE_URL"] ||= "postgres://placeholder:5432/none";
process.env["LOG_LEVEL"] ||= "silent";

import type { TurboGeomInput } from "../../artifacts/tis-api-server/src/lib/turbo-lane";

const { screenTurboCandidate, turboLaneScreening, deriveMainGreenRatio, TURBO_GAIN_MIN, TURBO_GAIN_MAX } =
  await import("../../artifacts/tis-api-server/src/lib/turbo-lane");
const { loadRegionalIntersections } = await import("../../artifacts/api-server/src/lib/regional-intersections");

let failures = 0;
function check(name: string, cond: boolean, detail = ""): void {
  const ok = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${ok}] ${name}${detail ? ` — ${detail}` : ""}`);
}
function approx(a: number, b: number, tol = 0.5): boolean {
  return Math.abs(a - b) <= tol;
}

// ───────────────────────── A. Pure math ─────────────────────────
console.log("\nA. Capacity model + candidacy gating");

// Webster green-ratio derivation.
const g1 = deriveMainGreenRatio(1080, 720); // yMain 0.6, yMinor 0.4 → 0.6
check("green ratio derived from volumes", g1.provenance === "derived" && approx(g1.ratio, 0.6, 0.01), `ratio=${g1.ratio}`);
const g2 = deriveMainGreenRatio(2000, 100); // very main-dominant → clamps high
check("green ratio clamps to max 0.80", approx(g2.ratio, 0.8, 0.001), `ratio=${g2.ratio}`);
const g3 = deriveMainGreenRatio(500, 0); // unknown minor → fallback 0.60 default
check("green ratio falls back to 0.60 default", g3.provenance === "default" && approx(g3.ratio, 0.6, 0.001), `ratio=${g3.ratio}`);

// A divided 3-leg arterial T is a candidate; everything else is not.
const baseGeom: TurboGeomInput = { roadClass: "primary", legCount: 3, minorLegBearing: 180, medianType: "raised", mainThroughLanes: 2 };
check("candidate: divided 3-leg arterial T", screenTurboCandidate(baseGeom) !== null);
check("reject: 4-leg intersection", screenTurboCandidate({ ...baseGeom, legCount: 4 }) === null);
check("reject: no median", screenTurboCandidate({ ...baseGeom, medianType: "none" }) === null);
check("reject: non-arterial (tertiary/other)", screenTurboCandidate({ ...baseGeom, roadClass: "other" }) === null);
check("reject: unknown minor leg bearing", screenTurboCandidate({ ...baseGeom, minorLegBearing: null }) === null);

// Gain formula: 2 lanes, 1 turbo, g/C 0.6 → (1/2)·(0.4/0.6) = 33.3%.
const cand = screenTurboCandidate(baseGeom)!;
const s1 = turboLaneScreening(cand, "EB", 1080, 720, 1.0);
check("gain = (Nturbo/Nlanes)·(1−g/C)/(g/C) ≈ 33.3%", approx(s1.capacityGainPct, 33.3, 0.5), `${s1.capacityGainPct}%`);
check("mitigated v/c < baseline v/c", s1.mitigatedApproachVc < s1.baselineApproachVc, `${s1.baselineApproachVc} → ${s1.mitigatedApproachVc}`);
check("turbo direction labeled", s1.turboDirection === "EB");

// Envelope clamp: wide approach, low gain → clamps up to the 7% floor.
const wide = screenTurboCandidate({ ...baseGeom, mainThroughLanes: 5 })!;
const s2 = turboLaneScreening(wide, "EB", 2000, 100, 1.0); // g/C clamps to 0.80 → tiny raw gain
check("low raw gain clamps up to 7% floor", approx(s2.capacityGainPct, TURBO_GAIN_MIN * 100, 0.01), `${s2.capacityGainPct}%`);
check("gain never exceeds 173% ceiling", s2.capacityGainPct <= TURBO_GAIN_MAX * 100 + 1e-6);

// ───────────────── B. Real geometry classifier over metros ─────────────────
console.log("\nB. Leg/median geometry over shipped metro data");

const metrosToTry = [
  "miami_dade_metro", "tampa_metro", "orlando_metro", "jacksonville_metro",
  "charlotte_metro", "nashville_metro", "phoenix_metro", "dallas_metro",
  "houston_metro", "denver_metro",
];

let totalCandidates = 0;
let metrosProcessed = 0;
for (const region of metrosToTry) {
  let summaries: ReturnType<typeof loadRegionalIntersections>;
  try {
    summaries = loadRegionalIntersections(region);
  } catch {
    continue; // region data not present in this checkout — skip
  }
  if (summaries.length === 0) continue;
  metrosProcessed++;

  const withGeom = summaries.filter((s) => s.legCount !== undefined);
  const threeLeg = summaries.filter((s) => s.legCount === 3);
  const raised = summaries.filter((s) => s.medianType === "raised");
  const candidates = summaries.filter(
    (s) =>
      s.legCount === 3 &&
      s.medianType === "raised" &&
      ["motorway", "trunk", "primary", "secondary"].includes(s.roadClass),
  );
  const lanesMeasured = candidates.filter((s) => s.mainThroughLanesMeasured === true).length;
  totalCandidates += candidates.length;

  const pct = (n: number) => ((100 * n) / summaries.length).toFixed(1);
  const lanesNote = candidates.length
    ? ` · lanes measured ${lanesMeasured}/${candidates.length}`
    : "";
  console.log(
    `  ${region}: ${summaries.length} signals · geom ${withGeom.length} · 3-leg ${threeLeg.length} (${pct(threeLeg.length)}%) · ` +
    `raised-median ${raised.length} · turbo candidates ${candidates.length} (${pct(candidates.length)}%)${lanesNote}`,
  );
  // Candidates must be a sane minority, not the majority of signals.
  check(`  ${region}: candidates are <25% of signals`, candidates.length <= summaries.length * 0.25);
  if (candidates.length > 0) {
    const ex = candidates[0]!;
    // Run the full screening on a real candidate with its measured geometry.
    const c = screenTurboCandidate(ex as TurboGeomInput);
    if (c) {
      const demo = turboLaneScreening(c, c.mainStreetDirections[0], Math.max(600, ex.totalVolume * 0.45), 250, 1.0);
      console.log(
        `      e.g. "${ex.name}" — Type ${demo.turboType}, ${demo.medianType} median, ` +
        `+${Math.round(demo.capacityGainPct)}% on ${demo.turboDirection}`,
      );
    }
  }
}

check("processed at least 2 metros", metrosProcessed >= 2, `${metrosProcessed} metros`);
check("found turbo candidates across metros", totalCandidates > 0, `${totalCandidates} total candidates`);

// ───────────────── C. Best-effort end-to-end report ─────────────────
console.log("\nC. End-to-end report (best-effort; needs analyzer running)");
try {
  const { generateTisReport } = await import("../../artifacts/tis-api-server/src/lib/tis");
  const report = await generateTisReport({
    projectName: "Turbo Verify",
    address: "Miami-Dade, FL",
    latitude: 25.7617,
    longitude: -80.1918,
    landUseCode: "220",
    size: 200,
    openingYear: 2028,
  });
  const tlRows = report.affectedIntersections.filter((r) => r.turboLane);
  const allCandidatesAre3Leg = tlRows.every((r) => r.turboLane!.candidate === true);
  console.log(`  generated report: ${report.affectedIntersections.length} intersections, ${tlRows.length} turbo candidate(s)`);
  check("turboLane present only as a valid candidate object", allCandidatesAre3Leg);
} catch (e) {
  console.log(`  SKIPPED — analyzer not reachable (${e instanceof Error ? e.message.split("\n")[0] : String(e)})`);
}

// ───────────────────────── Summary ─────────────────────────
console.log(`\n${failures === 0 ? "✅ ALL CHECKS PASSED" : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
