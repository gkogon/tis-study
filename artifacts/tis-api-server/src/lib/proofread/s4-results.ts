/**
 * §4 Results — the plausibility ceiling, in the three places it can be breached.
 *
 * implausibleVolumeDisclosures (lib/tis-engine-core/src/volume-plausibility.ts)
 * judges INTERSECTION rows only, and its Math.max drops a row whose currentVc
 * is absent (Math.max(undefined, 8.68) is NaN) — so a legacy record reports
 * clean at any v/c. These clauses read a v/c only when it is a finite number
 * (`numeric`), so absent, null and non-numeric values are neither judged nor
 * silently counted as 0, and they add the two scopes the guard never covered:
 * per-approach and design-year.
 *
 * Three rules every clause in this file follows, because later clauses copy them:
 *  - A row is JUDGED only if a usable value was read from it. The "N of M"
 *    denominator counts judged rows; rows that could not be read are reported
 *    as "Not judged" in the finding, and a clause that judged nothing is
 *    `not-run` — never `ran` clean.
 *  - Every readPath is literal (`${bucket.at}[${i}].${field}`) and names the
 *    field the value came from, so it resolves in the saved payload to the
 *    value recorded beside it.
 *  - The ceiling is an INTERSECTION v/c constant. Applied to anything else it is
 *    a screen, and the finding's source label and text say so.
 *  - A clause that judged only part of what the record carries says so at the top
 *    level too — `note` on its coverage entry — not just inside a finding, so a
 *    clean result cannot hide what was never looked at.
 *
 * `numeric` (types.ts) is the reading guard: Number(null) is 0 and Number("n/a")
 * is NaN, and either slips past a threshold test.
 */
import { PLAUSIBLE_MAX_INTERSECTION_VC, SCREENING_MAX_DELAY_SEC, delayToLos } from "@workspace/tis-engine-core";
import type { Clause, ProofreadFinding, ProofreadType, ReadPath, RowBucket, StudyRecord } from "./types.ts";
import { judgedNote, numeric, rowBuckets } from "./types.ts";
import { authoredProse } from "./prose.ts";

const CEIL = PLAUSIBLE_MAX_INTERSECTION_VC;
const ENGINE_FILE = "lib/tis-engine-core/src/signal-delay.ts";

// Built from CEIL so a label can never state a different ceiling than the one applied.
const SOURCE_INTERSECTION = `${ENGINE_FILE} — PLAUSIBLE_MAX_INTERSECTION_VC = ${CEIL}`;
const SOURCE_APPROACH =
  `${ENGINE_FILE} — PLAUSIBLE_MAX_INTERSECTION_VC (${CEIL}), authored for intersection v/c; ` +
  `applied here to per-approach v/c on the approach's own lane capacity as a screen`;
const SOURCE_DESIGN =
  `${ENGINE_FILE} — PLAUSIBLE_MAX_INTERSECTION_VC (${CEIL}), authored for current and opening-year no-project intersection v/c; ` +
  `applied here to design-year scenarios as a screen`;

const REMEDY =
  "Obtain measured turning-movement counts for these locations and analyze them with observed lane geometry and signal timing (HCS/Synchro) rather than the screening capacity used here.";
const REMEDY_DISCLOSE =
  "State in the study that the design-year Build delay, LOS and queue for these locations are beyond the screening model's validity, and analyze them with observed lane geometry and signal timing (HCS/Synchro) if the design-year results are relied on.";

const CAUSES =
  "Either the background volume is a limited-access count matched to a surface street, or the volume is a " +
  "legitimately high arterial volume the screening capacity understates.";

type Reading = { vc: number; field: "currentVc" | "existingVc" };

/** Highest no-project v/c on a row or approach and the field it came from, or null if neither field is numeric. */
function noProjectVc(unit: any): Reading | null {
  let best: Reading | null = null;
  for (const field of ["currentVc", "existingVc"] as const) {
    const v = unit?.[field];
    if (numeric(v) && (best === null || v > best.vc)) best = { vc: v, field };
  }
  return best;
}

type Offender = { label: string; vc: number; path: string; note?: string; companion?: ReadPath };
type Tally = { judged: number; skipped: number; periods: number };
type Unit = { label: string; at: string; src: any };

/** Walk every unit, judging those a no-project v/c can be read from. `periods` counts buckets that contributed a judged unit. */
function scanNoProject(buckets: RowBucket[], expand: (b: RowBucket, row: any, i: number) => Unit[]) {
  const tally: Tally = { judged: 0, skipped: 0, periods: 0 };
  const offenders: Offender[] = [];
  for (const b of buckets) {
    let here = 0;
    b.rows.forEach((row, i) => {
      for (const u of expand(b, row, i)) {
        const read = noProjectVc(u.src);
        if (!read) {
          tally.skipped++;
          continue;
        }
        tally.judged++;
        here++;
        if (read.vc > CEIL) offenders.push({ label: u.label, vc: read.vc, path: `${u.at}.${read.field}` });
      }
    });
    if (here > 0) tally.periods++;
  }
  offenders.sort((a, b) => b.vc - a.vc);
  return { tally, offenders };
}

/** "N of M <noun>". Rows are counted once per analysis period, so a multi-period study says so rather than reading as a count of intersections. */
const countPhrase = (n: number, t: Tally, noun: string) =>
  `${n} of ${t.judged} ${noun}` + (t.periods > 1 ? ` (counted once per analysis period, across ${t.periods} periods)` : "");

const notJudged = (skipped: number, noun: string, fields: string) =>
  skipped > 0 ? ` Not judged: ${skipped} ${noun} with no numeric ${fields}.` : "";

function named(offenders: Offender[]): string {
  const list = offenders.slice(0, 5).map((o) => `${o.label} (v/c ${o.vc.toFixed(2)}${o.note ?? ""})`).join("; ");
  return list + (offenders.length > 5 ? `, and ${offenders.length - 5} more` : "");
}

function build(a: {
  clauseId: string;
  title: string;
  type: ProofreadType;
  detail: string;
  sourceLabel: string;
  remedy: string;
  offenders: Offender[];
}): ProofreadFinding {
  const readPaths: ReadPath[] = a.offenders.flatMap((o) => [{ path: o.path, value: o.vc }, ...(o.companion ? [o.companion] : [])]);
  return {
    clauseId: a.clauseId,
    section: 4,
    type: a.type,
    title: a.title,
    detail: a.detail,
    sourceLabel: a.sourceLabel,
    readPaths,
    remedy: a.remedy,
    audience: "engineer",
  };
}

export const vcPlausibilityIntersection: Clause = {
  id: "vcPlausibilityIntersection",
  section: 4,
  title: "Intersection no-project v/c within the plausibility ceiling",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    if (buckets.length === 0) return { status: "not-run", reason: "no affectedIntersections on the record" };
    const { tally, offenders } = scanNoProject(buckets, (b, r, i) => [{ label: `${r?.name} [${b.period}]`, at: `${b.at}[${i}]`, src: r }]);
    if (tally.judged === 0) return { status: "not-run", reason: "no row carries a numeric currentVc/existingVc" };
    const note = judgedNote(tally.judged, tally.judged + tally.skipped, "study intersections", "carried no numeric currentVc/existingVc");
    if (offenders.length === 0) return { status: "ran", findings: [], note };
    return {
      status: "ran",
      note,
      findings: [
        build({
          clauseId: "vcPlausibilityIntersection",
          title: "Implausible background volume at study intersections",
          type: "BLOCKER",
          detail:
            `${countPhrase(offenders.length, tally, "study intersections")} report a no-project v/c above ${CEIL}, ` +
            `which no at-grade signalized location can operate at: ${named(offenders)}. ` +
            `${CAUSES} The delay, LOS and queue values reported here are not defensible under either cause.` +
            notJudged(tally.skipped, "study intersections", "currentVc/existingVc"),
          sourceLabel: SOURCE_INTERSECTION,
          remedy: REMEDY,
          offenders,
        }),
      ],
    };
  },
};

export const vcPlausibilityApproach: Clause = {
  id: "vcPlausibilityApproach",
  section: 4,
  title: "Approach no-project v/c within the plausibility ceiling",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    const { tally, offenders } = scanNoProject(buckets, (b, r, i) =>
      (Array.isArray(r?.approaches) ? r.approaches : []).map((a: any, j: number) => ({
        label: `${r?.name} ${a?.direction} [${b.period}]`,
        at: `${b.at}[${i}].approaches[${j}]`,
        src: a,
      })),
    );
    if (tally.judged + tally.skipped === 0) return { status: "not-run", reason: "no approach detail on the record" };
    if (tally.judged === 0) return { status: "not-run", reason: "no approach carries a numeric currentVc/existingVc" };
    const note = judgedNote(tally.judged, tally.judged + tally.skipped, "study approaches", "carried no numeric currentVc/existingVc");
    if (offenders.length === 0) return { status: "ran", findings: [], note };
    return {
      status: "ran",
      note,
      findings: [
        build({
          clauseId: "vcPlausibilityApproach",
          title: "Implausible background volume on study approaches",
          type: "BLOCKER",
          detail:
            `${countPhrase(offenders.length, tally, "study approaches")} report a no-project v/c above ${CEIL}. ` +
            `That ceiling was authored for intersection v/c; it is applied here to per-approach v/c, computed on each ` +
            `approach's own lane capacity, as a screen rather than a proven limit: ${named(offenders)}. ` +
            `${CAUSES} The delay, LOS and queue values reported for these approaches are not defensible as estimates under either cause.` +
            notJudged(tally.skipped, "study approaches", "currentVc/existingVc"),
          sourceLabel: SOURCE_APPROACH,
          remedy: REMEDY,
          offenders,
        }),
      ],
    };
  },
};

/**
 * Design-year, split by what the breach says about the study:
 *  - designNoBuildVc over the ceiling → BLOCKER. No project trips are in that
 *    number, so the background volume is what is wrong.
 *  - designBuildVc over the ceiling while designNoBuildVc is NOT → DISCLOSE.
 *    Build carries the project's own trips; this is a capacity story, not a
 *    data defect, but the delay, LOS and queue for the row are still beyond the
 *    model's validity and cannot be presented as estimates.
 *  - designBuildVc over when designNoBuildVc is over too → already the BLOCKER
 *    above; not reported a second time.
 */
export const vcPlausibilityDesignYear: Clause = {
  id: "vcPlausibilityDesignYear",
  section: 4,
  title: "Design-year v/c within the plausibility ceiling",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    const noBuildT: Tally = { judged: 0, skipped: 0, periods: 0 };
    const buildT: Tally = { judged: 0, skipped: 0, periods: 0 };
    const blockers: Offender[] = [];
    const discloses: Offender[] = [];
    let unpaired = false;
    for (const b of buckets) {
      let nbHere = 0;
      let bHere = 0;
      b.rows.forEach((r: any, i: number) => {
        const nb = r?.designNoBuildVc;
        const bd = r?.designBuildVc;
        if (numeric(nb)) { noBuildT.judged++; nbHere++; } else noBuildT.skipped++;
        if (numeric(bd)) { buildT.judged++; bHere++; } else buildT.skipped++;
        if (numeric(nb) && nb > CEIL) {
          blockers.push({ label: `${r?.name} Design No-Build [${b.period}]`, vc: nb, path: `${b.at}[${i}].designNoBuildVc` });
        } else if (numeric(bd) && bd > CEIL) {
          // Build-only breach. The No-Build value is part of what the DISCLOSE claim rests on, so it is a read path too.
          if (!numeric(nb)) unpaired = true;
          discloses.push({
            label: `${r?.name} Design Build [${b.period}]`,
            vc: bd,
            path: `${b.at}[${i}].designBuildVc`,
            note: numeric(nb) ? `; design No-Build ${nb.toFixed(2)}` : "; no design No-Build reported",
            companion: numeric(nb) ? { path: `${b.at}[${i}].designNoBuildVc`, value: nb } : undefined,
          });
        }
      });
      if (nbHere > 0) noBuildT.periods++;
      if (bHere > 0) buildT.periods++;
    }
    if (noBuildT.judged + buildT.judged === 0) return { status: "not-run", reason: "no row carries a numeric designNoBuildVc/designBuildVc" };
    blockers.sort((a, b) => b.vc - a.vc);
    discloses.sort((a, b) => b.vc - a.vc);
    const findings: ProofreadFinding[] = [];
    if (blockers.length > 0) {
      findings.push(
        build({
          clauseId: "vcPlausibilityDesignYear",
          title: "Implausible design-year No-Build volume",
          type: "BLOCKER",
          detail:
            `${countPhrase(blockers.length, noBuildT, "design-year No-Build scenarios")} report a v/c above ${CEIL}. ` +
            `That ceiling was authored for current and opening-year no-project intersection v/c; it is applied here to the ` +
            `design-year No-Build scenario as a screen rather than a proven limit: ${named(blockers)}. ` +
            `${CAUSES} The design-year delay, LOS and queue reported for these rows are not defensible under either cause.` +
            notJudged(noBuildT.skipped, "design-year No-Build scenarios", "designNoBuildVc"),
          sourceLabel: SOURCE_DESIGN,
          remedy: REMEDY,
          offenders: blockers,
        }),
      );
    }
    if (discloses.length > 0) {
      findings.push(
        build({
          clauseId: "vcPlausibilityDesignYear",
          title: "Design-year Build volume beyond the screening model",
          type: "DISCLOSE",
          detail:
            `${countPhrase(discloses.length, buildT, "design-year Build scenarios")} report a v/c above ${CEIL} while the same ` +
            `row's design No-Build v/c does not: ${named(discloses)}. ` +
            `That ceiling was authored for current and opening-year no-project intersection v/c; it is applied here to the ` +
            `Build scenario as a screen. The breach appears only once the project's trips are added over the design horizon, ` +
            `so the design-year delay, LOS and queue reported for these rows sit beyond the screening model's validity and ` +
            `must be disclosed as such rather than presented as estimates.` +
            (unpaired ? " Where no design No-Build is reported, that attribution cannot be confirmed." : "") +
            notJudged(buildT.skipped, "design-year Build scenarios", "designBuildVc"),
          sourceLabel: SOURCE_DESIGN,
          remedy: REMEDY_DISCLOSE,
          offenders: discloses,
        }),
      );
    }
    const note =
      [
        judgedNote(noBuildT.judged, noBuildT.judged + noBuildT.skipped, "design-year No-Build scenarios", "carried no numeric designNoBuildVc"),
        judgedNote(buildT.judged, buildT.judged + buildT.skipped, "design-year Build scenarios", "carried no numeric designBuildVc"),
      ]
        .filter(Boolean)
        .join(" | ") || undefined;
    return { status: "ran", findings, note };
  },
};

const LOS_PAIRS: Array<[delayKey: string, losKey: string]> = [
  ["currentDelaySec", "currentLos"],
  ["existingDelaySec", "existingLos"],
  ["futureDelaySec", "futureLos"],
  ["designNoBuildDelaySec", "designNoBuildLos"],
  ["designBuildDelaySec", "designBuildLos"],
];

const rowName = (r: any): string => String(r?.name ?? "(unnamed)");

/** How many offenders a finding names before saying "and N more"; the count and the list use the same number. */
const LOS_NAMED = 5;
const CLAMP_NAMED = 3;

/**
 * A row's LOS letter must be the letter its own delay maps to.
 *
 * The engine derives the letter from the UNROUNDED delay and then prints the delay to 0.1 s
 * (row-math.ts: `delayToLos(delay)` beside `round1(delay)`), so a printed delay one tick from a band edge can
 * legitimately sit beside either neighbouring letter — real payloads in the repo do exactly that. A letter is
 * flagged only if it is wrong across the whole rounding interval, otherwise this files a DEFECT accusing the
 * engine of losing a value it never lost.
 *
 * A pair is judged only if a number sits beside a letter. One side present and the other null, a string or
 * missing is "reported but not judged" — Number(null) is 0, which maps to LOS A and would manufacture a DEFECT.
 *
 * One finding for the whole record, not one per pair: it is one fault, and what the admin needs is its extent.
 */
export const losMatchesDelay: Clause = {
  id: "losMatchesDelay",
  section: 4,
  title: "Each reported LOS letter matches its reported delay",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    if (buckets.length === 0) return { status: "not-run", reason: "no affectedIntersections on the record" };
    type Offender = { label: string; delayKey: string; losKey: string; delay: number; los: string; expected: string; at: string };
    const offenders: Offender[] = [];
    let rowsTotal = 0;
    let rowsEmpty = 0;
    let reported = 0;
    let judged = 0;
    for (const b of buckets) {
      b.rows.forEach((r: any, i: number) => {
        rowsTotal++;
        let rowReported = 0;
        for (const [delayKey, losKey] of LOS_PAIRS) {
          const delay = r?.[delayKey];
          const los = r?.[losKey];
          if (delay === undefined && los === undefined) continue; // this scenario is not on the row
          rowReported++;
          reported++;
          if (!numeric(delay) || typeof los !== "string") continue;
          judged++;
          const expected = delayToLos(delay);
          if (expected === los) continue;
          if (delayToLos(delay - 0.05) === los || delayToLos(delay + 0.05) === los) continue;
          offenders.push({ label: `${rowName(r)} [${b.period}]`, delayKey, losKey, delay, los, expected, at: `${b.at}[${i}]` });
        }
        if (rowReported === 0) rowsEmpty++;
      });
    }
    if (judged === 0) return { status: "not-run", reason: "no row carries a numeric delay beside a LOS letter" };
    const pairsNote = judgedNote(judged, reported, "reported delay/LOS pairs", "carried a delay that is not a number or no letter beside it");
    const rowsNote = rowsEmpty > 0 ? `${rowsEmpty} of ${rowsTotal} rows reported no delay/LOS` : undefined;
    const note = [pairsNote, rowsNote].filter(Boolean).join("; ") || undefined;
    if (offenders.length === 0) return { status: "ran", findings: [], note };
    const notJudged =
      (reported > judged ? ` Not judged: ${reported - judged} of ${reported} reported delay/LOS pairs with a delay that is not a number or no letter beside it.` : "") +
      (rowsEmpty > 0 ? ` Not judged: ${rowsEmpty} of ${rowsTotal} rows reported no delay/LOS.` : "");
    const listed = offenders
      .slice(0, LOS_NAMED)
      .map((o) => `${o.label}: ${o.delayKey} ${o.delay} s maps to LOS ${o.expected}, but the row reports ${o.losKey} ${o.los}`)
      .join("; ");
    return {
      status: "ran",
      note,
      findings: [
        {
          clauseId: "losMatchesDelay",
          section: 4,
          type: "DEFECT",
          title: "Reported LOS does not match reported delay",
          detail:
            `${offenders.length} of ${judged} reported delay/LOS pairs carry a letter that its own delay does not map to: ${listed}` +
            `${offenders.length > LOS_NAMED ? `, and ${offenders.length - LOS_NAMED} more` : ""}. ` +
            `A letter that disagrees with its own delay means the value was lost or overwritten between computation and ` +
            `response, so every study this engine produced may carry it.` +
            notJudged,
          sourceLabel: `${ENGINE_FILE} — delayToLos`,
          readPaths: offenders.flatMap((o) => [
            { path: `${o.at}.${o.delayKey}`, value: o.delay },
            { path: `${o.at}.${o.losKey}`, value: o.los },
          ]),
          remedy: "File against the engine: the LOS letter and the delay are computed from one value and must not diverge.",
          audience: "admin",
        },
      ],
    };
  },
};

const DELAY_KEYS = ["currentDelaySec", "existingDelaySec", "futureDelaySec", "designNoBuildDelaySec", "designBuildDelaySec"];
const CLAMP_DISCLOSURE = /clamp|ceiling|capped/i;

/**
 * A delay at the screening ceiling is a clamp, not a measurement. The calibration multiplier is applied
 * AFTER the clamp at every call site (row-math.ts: `vcToDelay(...) * calMul`, with calMul clamped to
 * 0.25-5), so the maximum printable delay is SCREENING_MAX_DELAY_SEC x calMul — not 300. A calibrated
 * signal with a multiplier below 1 prints a clamped delay well under 300, which a fixed `>= 300` test misses;
 * one above 1 prints a legitimate 300 that a fixed test calls a clamp.
 *
 * The disclosure is looked for in `findings` only (prose.ts). The engine's methodology boilerplate says
 * "capped at 300 s" on every study but does not say WHICH delays are capped, and a gate it satisfies would
 * never fire.
 */
export const screeningClampDisclosed: Clause = {
  id: "screeningClampDisclosed",
  section: 4,
  title: "Delays reported at the screening ceiling are disclosed as clamped",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    if (buckets.length === 0) return { status: "not-run", reason: "no affectedIntersections on the record" };
    const clamped: Array<{ label: string; delay: number; path: string; remark: string }> = [];
    let rowsTotal = 0;
    let rowsJudged = 0;
    for (const b of buckets) {
      b.rows.forEach((r: any, i: number) => {
        rowsTotal++;
        // Mirror the engine: a numeric multiplier is clamped to 0.25-5; an absent or unusable one is 1.
        const cal = r?.calibration as { delayMultiplier?: unknown; delayMultiplierExact?: unknown } | null | undefined;
        const raw = numeric(cal?.delayMultiplierExact) ? cal?.delayMultiplierExact : cal?.delayMultiplier;
        const mul = numeric(raw) ? Math.min(5, Math.max(0.25, raw)) : 1;
        const ceiling = SCREENING_MAX_DELAY_SEC * mul;
        let readable = false;
        for (const key of DELAY_KEYS) {
          const d = r?.[key];
          if (!numeric(d)) continue;
          readable = true;
          // -0.05 because the payload rounds delay to 0.1 s; 1e-9 so that boundary is not at the mercy of float error.
          if (d >= ceiling - 0.05 - 1e-9) {
            const remark = mul === 1 ? "" : ` (ceiling ${Number(ceiling.toFixed(2))} s at calibration x${Number(mul.toFixed(4))})`;
            clamped.push({ label: `${rowName(r)} ${key} [${b.period}]`, delay: d, path: `${b.at}[${i}].${key}`, remark });
          }
        }
        if (readable) rowsJudged++;
      });
    }
    if (rowsJudged === 0) return { status: "not-run", reason: "no row carries a numeric delay" };
    const note = judgedNote(rowsJudged, rowsTotal, "rows", "carried no numeric delay");
    if (clamped.length === 0) return { status: "ran", findings: [], note };
    if (CLAMP_DISCLOSURE.test(authoredProse(rec))) return { status: "ran", findings: [], note };
    const listed = clamped
      .slice(0, CLAMP_NAMED)
      .map((c) => `${c.label} ${c.delay} s${c.remark}`)
      .join("; ");
    return {
      status: "ran",
      note,
      findings: [
        {
          clauseId: "screeningClampDisclosed",
          section: 4,
          type: "DISCLOSE",
          title: "Delays sit at the screening ceiling without disclosure",
          detail:
            `${clamped.length} reported delay(s) are at or above the ${SCREENING_MAX_DELAY_SEC} s screening ceiling ` +
            `(${listed}${clamped.length > CLAMP_NAMED ? `, and ${clamped.length - CLAMP_NAMED} more` : ""}). At the ceiling the number is a cap, ` +
            `not an estimate, and the study's findings do not say which delays are capped.` +
            (rowsTotal > rowsJudged ? ` Not judged: ${rowsTotal - rowsJudged} of ${rowsTotal} rows carried no numeric delay.` : ""),
          sourceLabel: `${ENGINE_FILE} — SCREENING_MAX_DELAY_SEC = ${SCREENING_MAX_DELAY_SEC} (times the regional calibration multiplier)`,
          readPaths: clamped.map((c) => ({ path: c.path, value: c.delay })),
          remedy: "State in the results section that delays at the ceiling are capped screening values, not estimates of actual delay.",
          audience: "engineer",
        },
      ],
    };
  },
};
