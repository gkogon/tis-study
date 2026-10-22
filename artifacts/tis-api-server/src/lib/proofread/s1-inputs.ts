/**
 * §1 Inputs — growth provenance and the multiplier the engine actually applied.
 *
 * growthSource is the payload's own provenance string: when the request
 * supplied growthRatePct, the engine tags the source as an explicit override
 * naming the measured rate it displaced (GROWTH_OVERRIDE_PREFIX). An override
 * with no such tag is an undisclosed input, which is the §1 BLOCKER.
 *
 * Both clauses read a value only if it is a finite number (`numeric`):
 * Number(null) is 0, and a clause that treated a null growthAppliedPct as 0%
 * would "reproduce" a multiplier of 1 and report a clean study.
 */
import { isGrowthOverride } from "@workspace/tis-engine-core";
import type { Clause, StudyRecord } from "./types.ts";
import { numeric } from "./types.ts";

export const growthOverrideDisclosed: Clause = {
  id: "growthOverrideDisclosed",
  section: 1,
  title: "An explicit growth override is disclosed with the rate it displaced",
  run(rec: StudyRecord) {
    const override = rec.request.growthRatePct as unknown;
    if (override === undefined || override === null) return { status: "not-run", reason: "request supplied no growthRatePct override" };
    // The engine tests `!== undefined`, so 0 is an override. A value that is not a number cannot be judged.
    if (!numeric(override)) return { status: "not-run", reason: "request.growthRatePct is present but is not a number" };
    const source = rec.result.growthSource;
    if (typeof source === "string" && isGrowthOverride(source)) return { status: "ran", findings: [] };
    const hasSource = typeof source === "string" && source.length > 0;
    return {
      status: "ran",
      findings: [
        {
          clauseId: "growthOverrideDisclosed",
          section: 1,
          type: "BLOCKER",
          title: "Growth rate overridden without disclosure",
          detail:
            `The request supplied growthRatePct ${override}, but the study's growthSource ` +
            `${hasSource ? `reads "${source}", which is not tagged as an override` : "is absent"}. ` +
            `A reviewer cannot tell that the applied rate displaced the measured regional rate.`,
          sourceLabel: "lib/tis-engine-core/src/regional-growth-rates.ts — isGrowthOverride / GROWTH_OVERRIDE_PREFIX",
          // Only paths that exist: an absent growthSource is in the detail, not a path that addresses nothing.
          readPaths: [
            { path: "request.growthRatePct", value: override },
            ...(hasSource ? [{ path: "result.growthSource", value: source as string }] : []),
          ],
          remedy: "State the override and its basis in the deliverable, naming the measured rate it replaced.",
          audience: "engineer",
        },
      ],
    };
  },
};

export const growthMultiplierReproduces: Clause = {
  id: "growthMultiplierReproduces",
  section: 1,
  title: "The applied growth multiplier reproduces from the rate and the years",
  run(rec: StudyRecord) {
    const exact = rec.result.growthMultiplierExact as unknown;
    const pct = rec.result.growthAppliedPct as unknown;
    const years = rec.result.growthYears as unknown;
    if (exact === undefined) return { status: "not-run", reason: "payload predates growthMultiplierExact" };
    if (!numeric(exact)) return { status: "not-run", reason: "growthMultiplierExact is present but is not a number" };
    if (!numeric(pct) || !numeric(years)) return { status: "not-run", reason: "growthAppliedPct or growthYears absent or not a number" };
    // growthAppliedPct is the exact (clamped) rate the engine compounded, so this reproduces to floating-point noise.
    const expected = Math.pow(1 + pct / 100, years);
    if (Math.abs(expected - exact) <= 1e-6) return { status: "ran", findings: [] };
    return {
      status: "ran",
      findings: [
        {
          clauseId: "growthMultiplierReproduces",
          section: 1,
          type: "BLOCKER",
          title: "Growth multiplier does not reproduce from the stated rate",
          detail:
            `The study reports ${pct}%/yr over ${years} year(s), which is a multiplier of ` +
            `${expected.toFixed(6)}, but the applied multiplier is ${exact}. Every grown volume in the ` +
            `study rests on this number, so a disagreement here propagates to every scenario.`,
          sourceLabel: "result.growthAppliedPct and result.growthYears, compounded — (1 + pct/100) ^ years",
          readPaths: [
            { path: "result.growthAppliedPct", value: pct },
            { path: "result.growthYears", value: years },
            { path: "result.growthMultiplierExact", value: exact },
          ],
          remedy: "Reconcile the printed rate and horizon with the multiplier the engine applied before submitting.",
          audience: "engineer",
        },
      ],
    };
  },
};
