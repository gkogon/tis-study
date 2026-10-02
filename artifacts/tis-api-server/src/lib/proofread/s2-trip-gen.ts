/**
 * §2 Trip generation — the printed rate must reproduce the printed total, and
 * the pass-by basis must be named.
 *
 * §2a stands: never verify a rate against ITE Trip Generation. There is no
 * license. The only source for a rate is the tagged `source` string on the
 * land use in LAND_USES, which is what variableSource prints.
 *
 * Every value is read only if it is a finite number (`numeric`): Number(null)
 * is 0, so a null rate would "reproduce" no total and a null pass-by would read
 * as "none applied".
 */
import { LAND_USES } from "@workspace/tis-engine-core";
import type { Clause, ProofreadFinding, StudyRecord } from "./types.ts";
import { judgedNote, numeric } from "./types.ts";
import { clauses } from "./prose.ts";

/**
 * The engine prints `Math.round(rate * size)` of the unrounded registry rate (tis.ts), and |x - Math.round(x)|
 * is never above 0.5, so a total that reproduces is within half a trip — exactly half at a .5 tie, which
 * rounds up (5662.5 prints 5663). Anything wider would let an off-by-one total through, and an off-by-one
 * total is the kind of error a reviewer finds by recomputing the line.
 */
const ROUNDING = 0.5;

const PAIRS: Array<[rateKey: string, totalKey: string, label: string]> = [
  ["pmRate", "pmPeakTrips", "PM peak"],
  ["amRate", "amPeakTrips", "AM peak"],
  ["dailyRate", "dailyTrips", "Daily"],
];

export const rateReproducesTotal: Clause = {
  id: "rateReproducesTotal",
  section: 2,
  title: "Printed rates reproduce the printed trip totals",
  run(rec: StudyRecord) {
    const tg = rec.result.tripGeneration as unknown as Record<string, unknown> | undefined;
    if (!tg || typeof tg !== "object") return { status: "not-run", reason: "no tripGeneration on the record" };
    if (!PAIRS.some(([rate]) => numeric(tg[rate]))) return { status: "not-run", reason: "payload carries no numeric rate fields" };
    const size = tg.size;
    if (!numeric(size)) return { status: "not-run", reason: "tripGeneration.size absent or not a number" };
    const findings: ProofreadFinding[] = [];
    let judged = 0;
    for (const [rateKey, totalKey, label] of PAIRS) {
      const rate = tg[rateKey];
      const printed = tg[totalKey];
      // A pair is judged only if a number sits on both sides. A rate with no printed total beside it was not looked at.
      if (!numeric(rate) || !numeric(printed)) continue;
      judged++;
      const expected = rate * size;
      if (Math.abs(expected - printed) <= ROUNDING) continue;
      findings.push({
        clauseId: "rateReproducesTotal",
        section: 2,
        type: "BLOCKER",
        title: `${label} trips do not reproduce from the printed rate`,
        detail:
          `${label}: rate ${rate} x size ${size} is ${expected.toFixed(1)} trips, but the study prints ` +
          `${printed}. One of the two is wrong, and a reviewer will recompute this line first.`,
        sourceLabel: `result.tripGeneration.variableSource — ${String(tg.variableSource ?? "(absent)")}`,
        readPaths: [
          { path: `result.tripGeneration.${rateKey}`, value: rate },
          { path: "result.tripGeneration.size", value: size },
          { path: `result.tripGeneration.${totalKey}`, value: printed },
        ],
        remedy: "Reconcile the rate, the size and the total. Verify the rate against the tagged source string, never against ITE.",
        audience: "engineer",
      });
    }
    if (judged === 0) return { status: "not-run", reason: "no rate has a numeric printed total beside it" };
    const skipped = PAIRS.length - judged;
    const notJudged = ` Not judged: ${skipped} of ${PAIRS.length} rate/total pairs with no numeric rate beside a numeric printed total.`;
    return {
      status: "ran",
      findings: skipped > 0 ? findings.map((f) => ({ ...f, detail: f.detail + notJudged })) : findings,
      note: judgedNote(judged, PAIRS.length, "rate/total pairs", "carried no numeric rate beside a numeric printed total"),
    };
  },
};

/**
 * A pass-by reduction must be stated. The test is a CLAUSE that gives a pass-by percentage — not the word
 * "pass-by", which the engine writes into the sensitivity finding that closes every study with rows
 * ("…internal capture and pass-by credit variants; and a ±0.5%/yr…"). The engine's own sentence when it
 * applies a credit ("Pass-by credit 30% and internal-capture credit 0% applied at the PM peak…") passes.
 */
const PASS_BY = /pass[-\s]?by/i;
const PERCENT = /\d+(\.\d+)?\s*%/;

export const passByBasisNamed: Clause = {
  id: "passByBasisNamed",
  section: 2,
  title: "A pass-by reduction states its basis",
  run(rec: StudyRecord) {
    const code = String((rec.result.tripGeneration as { landUseCode?: unknown } | undefined)?.landUseCode ?? rec.request.landUseCode ?? "");
    const lu = LAND_USES.find((l) => l.code === code);
    if (!lu) return { status: "not-run", reason: `land use ${code || "(absent)"} not in the registry` };
    // The engine records what it actually applied (clamped) as
    // result.passByPctApplied. Re-deriving it from LAND_USES would diverge from
    // the study the moment a default is edited — in a finding whose only job is
    // traceability. LAND_USES is still the source of the `source` string.
    const applied = rec.result.passByPctApplied as unknown;
    if (!numeric(applied)) return { status: "not-run", reason: "payload predates result.passByPctApplied, or it is not a number" };
    if (applied === 0) return { status: "ran", findings: [] };
    if (clauses(rec).some((c) => PASS_BY.test(c) && PERCENT.test(c))) return { status: "ran", findings: [] };
    const requested = rec.request.passByPct as unknown;
    const fromRequest = numeric(requested);
    return {
      status: "ran",
      findings: [
        {
          clauseId: "passByBasisNamed",
          section: 2,
          type: "DISCLOSE",
          title: "Pass-by reduction applied without stating it",
          detail:
            `A pass-by reduction of ${applied}% is in effect for land use ${code}` +
            `${fromRequest ? " (supplied by the request)" : " (the land-use default)"}, ` +
            `but no finding in the study states the pass-by percentage. A trip reduction the reader cannot see is a trip reduction a reviewer will disallow.`,
          sourceLabel: `lib/tis-engine-core/src/land-uses.ts — ${lu.code} passByPctPm ${lu.passByPctPm}, source "${lu.source}"`,
          // Paths in the saved record only. The registry default is in the source label; it is not a payload path.
          readPaths: [
            { path: "result.passByPctApplied", value: applied },
            ...(fromRequest ? [{ path: "request.passByPct", value: requested as number }] : []),
          ],
          remedy: "State the pass-by percentage and its source in the trip-generation section.",
          audience: "engineer",
        },
      ],
    };
  },
};
