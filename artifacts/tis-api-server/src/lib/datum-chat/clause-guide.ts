/**
 * What Datum knows about each proofread clause before it has read a study: why
 * the clause fires, what clears it, and which request fields bear on it.
 *
 * Written once, from the clause-to-input map (read from the clause files on
 * 2026-10-20) and the design spec's "What can be fixed" table. It lives beside
 * the chat, not beside the clauses, so a change to a clause's behaviour has to
 * be carried over here on purpose. verify-datum-chat.mjs pins the keys to
 * ALL_CLAUSES, so a clause added there without an entry here fails the check.
 *
 * There is no entry for losMatchesDelay. It is a DEFECT for the software team,
 * withheld from engineers, so the chat never sees it.
 *
 * Two facts shape most entries. Prose helpers (lib/proofread/prose.ts) search
 * `result.findings` only, never `methodology`, and no request field carries
 * free text into `result.findings`, so no input exists that "adds disclosure
 * text". And most findings that fire on a study made today fire because it was
 * saved by an older engine, so the honest fix is a re-run with no new value.
 *
 * Pure, like lib/proofread/: no db, logger or fetch, importable under plain
 * `node`. No text in this file may use the words the product forbids (see
 * constraints in the plan); verify-datum-chat.mjs scans for them.
 */
import type { RevisableField } from "./contract.ts";

export type Fixability = "rerun" | "partial" | "explain";

export type ClauseGuideEntry = {
  /** Why the clause fires, in the terms of the study's own fields. */
  why: string;
  /** What clears it, honestly: including when nothing the chat can do will. */
  clears: string;
  /** The request fields that bear on it. Empty when no input causes or clears it. */
  inputs: RevisableField[] | [];
  /** rerun: a re-run on the current engine clears it. partial: depends on the data. explain: nothing in the chat clears it. */
  fixable: Fixability;
};

/** What each `fixable` value means to the chat, stated once so the pack and the prompt cannot disagree. */
export const FIXABLE_MEANING: Readonly<Record<Fixability, string>> = Object.freeze({
  rerun: "Re-running the study on the current engine clears it, and needs no new value from the engineer.",
  partial:
    "A re-run with different inputs may lower or clear it, depending on the data. The real remedy is partly outside the chat, so say what the chat cannot do.",
  explain: "Nothing in the chat clears it. Explain why it fired and what would have to change outside the chat.",
});

/**
 * What the engine grows a study at when the request carries no growth rate
 * (tis.ts: override, then the measured regional rate, then a screening
 * default). The measured rate exists only for the regions wired in
 * lib/tis-engine-core/src/regional-growth-rates.ts; everywhere else the
 * screening default applies and the result carries no growthSource. The one
 * wording of that fact: the guide, the prompt and the re-run tool all use it,
 * and verify-datum-chat.mjs reads the figure from tis.ts, so a change to the
 * engine's default fails the check instead of leaving three texts wrong.
 */
export const GROWTH_FALLBACK_WORDS = "the measured regional rate where one exists for the region, and the 1.5% screening default where it does not";

/** The inputs that set a signal's capacity, which v/c and delay are computed from. */
const CAPACITY_INPUTS: RevisableField[] = ["signalTimingOverrides", "signalTiming", "realLaneGeometry", "legVolumes", "weather"];

const entry = (e: ClauseGuideEntry): ClauseGuideEntry => Object.freeze({ ...e, inputs: Object.freeze([...e.inputs]) as unknown as RevisableField[] });

const VC_WHAT_CLEARS =
  "Measured turning-movement counts with observed lane geometry and signal timing are the real remedy, and whether the figure falls below 2.5 depends on that data. " +
  "Datum can switch the engine to its fuller methods when asked to fix it (computed signal timing, network leg volumes, real lane geometry), and can apply the engineer's own timing sheet (cycle, phases, splits) as a signal-timing override, taking the signal's coordinates from the study's own row. " +
  "It cannot bring in measured counts: point the engineer to the generator's UTDF or Synchro import. " +
  "The engine's own DATA QUALITY paragraph in the findings does not clear the finding. " +
  "A volume that came from a bad AADT match to the road is an inventory problem, not a value to retype.";

export const CLAUSE_GUIDE: Readonly<Record<string, ClauseGuideEntry>> = Object.freeze({
  growthOverrideDisclosed: entry({
    why:
      "The request set a growth rate (growthRatePct), but the study's growthSource text does not begin with \"Explicit override\". " +
      "The current engine always writes that prefix, so this appears only on studies saved by an older engine.",
    clears:
      "Re-run on the current engine with the same inputs, which needs no new value. " +
      "Removing the growth override also clears it, because the check then does not run. " +
      `The study then uses ${GROWTH_FALLBACK_WORDS}, so the growth it applies, and the opening-year and design-year figures built on it, may change.`,
    inputs: ["growthRatePct", "removeGrowthOverride"],
    fixable: "rerun",
  }),

  growthMultiplierReproduces: entry({
    why:
      "(1 + growth rate / 100) raised to the number of growth years does not match the printed growthMultiplierExact, by more than 0.000001. " +
      "The current engine derives the rate, the years and the multiplier from the same values, so only studies saved by an older engine show it.",
    clears: "Re-run on the current engine. No input value causes it or clears it.",
    inputs: [],
    fixable: "rerun",
  }),

  rateReproducesTotal: entry({
    why:
      "The trip rate times the land-use size, rounded, differs from the printed trip total by more than half a trip, for the PM peak, the AM peak or the daily total. " +
      "The current engine prints the rounded product, so only studies saved by an older engine show it.",
    clears: "Re-run on the current engine. No input value causes it or clears it.",
    inputs: [],
    fixable: "rerun",
  }),

  passByBasisNamed: entry({
    why:
      "A pass-by reduction was applied (passByPctApplied above 0), but no line of the study's findings text names pass-by together with a percentage. " +
      "The current engine writes a \"Pass-by credit X%\" line whenever pass-by or internal capture is above 0, so only studies saved by an older engine show it.",
    clears:
      "Re-run on the current engine, or set pass-by to 0. There is no field for pass-by source text, so no wording the engineer types can clear it.",
    inputs: ["passByPct"],
    fixable: "rerun",
  }),

  vcPlausibilityIntersection: entry({
    why:
      "A study intersection's no-project v/c is above 2.5, in the current-year figure (currentVc) or the opening-year No-Build figure (existingVc, which also includes growth). " +
      "No signalized intersection at grade can operate at that ratio, so it points to a screening-model limit, not real congestion. " +
      "Capacity is saturation flow times the critical green-to-cycle ratio times the weather factor times the critical lane count.",
    clears:
      `${VC_WHAT_CLEARS} ` +
      "Growth rate and opening year move only the opening-year No-Build figure, and Datum does not choose either value.",
    inputs: [...CAPACITY_INPUTS, "growthRatePct", "openingYear"],
    fixable: "partial",
  }),

  vcPlausibilityApproach: entry({
    why:
      "One approach of a study intersection has a no-project v/c above 2.5, in the current-year figure (currentVc) or the opening-year No-Build figure (existingVc), measured against that approach's own lane capacity. " +
      "The 2.5 ceiling was written for whole intersections, so on an approach it is a screen.",
    clears:
      `${VC_WHAT_CLEARS} ` +
      "Growth rate and opening year move only the opening-year No-Build figure, and Datum does not choose either value.",
    inputs: [...CAPACITY_INPUTS, "growthRatePct", "openingYear"],
    fixable: "partial",
  }),

  vcPlausibilityDesignYear: entry({
    why:
      "A design-year v/c is above 2.5. It is a BLOCKER when the design-year No-Build figure (designNoBuildVc) is over, and a DISCLOSE when only the design-year Build figure (designBuildVc) is over. " +
      "The check reads no prose, so no text clears the DISCLOSE half, and the 20-year design horizon is fixed.",
    clears:
      "The figure moves with the growth rate, the opening year and the capacity inputs. Datum does not choose the numbers: they must come from the engineer's own source. " +
      "The Build figure also depends on project trips (pass-by, internal capture), but size, land use and driveways are locked in the chat. " +
      "Capacity: Datum can switch the engine to its fuller methods when asked to fix it, and can apply the engineer's timing sheet as a signal-timing override. " +
      "Measured counts cannot be brought in here: point the engineer to the generator's UTDF or Synchro import.",
    inputs: ["growthRatePct", "openingYear", "passByPct", "internalCapturePct", ...CAPACITY_INPUTS],
    fixable: "partial",
  }),

  screeningClampDisclosed: entry({
    why:
      "A reported delay is at or above the screening ceiling (300 seconds times the calibration multiplier, clamped between 0.25 and 5), and the findings text never says the delay was clamped, capped or hit a ceiling. " +
      "No line the engine writes into the findings uses those words.",
    clears:
      "Bring the delays below the cap with more capacity or better timing. No text can clear it. " +
      "Datum can switch the engine to its fuller methods when asked to fix it, and can apply the engineer's timing sheet as a signal-timing override.",
    inputs: [...CAPACITY_INPUTS],
    fixable: "partial",
  }),

  criteriaNamed: entry({
    why:
      "The governing agency, jurisdiction.dotName, is not named anywhere in the findings text. " +
      "The engine names the DOT only when an opening-year Build row is LOS E or F, so this appears on every study that has none.",
    clears:
      "Nothing the engineer can change here: the jurisdiction is derived from the study's region. There is no input and no re-run that clears it, so explain it.",
    inputs: [],
    fixable: "explain",
  }),

  periodScopeDisclosed: entry({
    why:
      "A requested analysis period is missing from the period reports and the findings text does not say so. " +
      "When no periods were chosen, the four defaults (AM peak, PM peak, Saturday midday, daily) count as requested. " +
      "The current engine reports every requested period, so only studies saved by an older engine show it.",
    clears: "Re-run on the current engine, or narrow analysisPeriods to the periods the study reports.",
    inputs: ["analysisPeriods"],
    fixable: "rerun",
  }),

  scopeNoteConsistent: entry({
    why:
      "Either some intersections were merged as duplicates, or fewer intersections were studied than lie in the study area, and the findings text never says merged or duplicate. " +
      "The engine writes its coverage note into the methodology text, which this check does not read.",
    clears:
      "Studying fewer intersections than the area holds happens only when scopeStudyIntersections is on, so turning it off clears that half. " +
      "Merges come from inventory de-duplication, and no input changes them.",
    inputs: ["scopeStudyIntersections"],
    fixable: "partial",
  }),
});
