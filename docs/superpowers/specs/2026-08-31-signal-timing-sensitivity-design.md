# Signal-timing sensitivity and the PR #168 wiring decision

**Date:** 2026-08-31
**Status:** Analysis complete — recommendation is DEFER WIRING until after the 2026-10-01 decision.
**Scope:** Quantifies the flat `G_OVER_C = 0.45` assumption, and settles what wiring
`webster-timing.ts` (PR #168) would do to shipped output.

## 1. The question

A screening TIS assumes a signal timing it does not know. `signal-delay.ts` fixes four
constants for every approach of every signal in every metro:

    CYCLE_LEN = 90      G_OVER_C = 0.45     SATURATION_FLOW_VPH = 1800     CRITICAL_MOVEMENT_FRACTION = 0.45

Approach capacity is `SATURATION_FLOW_VPH × G_OVER_C = 810 vph`. Capacity is therefore
**proportional to g/C**, which makes the green ratio the dominant term in every LOS letter.
Note also that a measured UTDF cycle length sharpens only the Webster `d1` term —
`vcToDelay`'s own comment states capacity is deliberately not re-derived from it. So
importing real timing does **not** currently fix the capacity assumption.

## 2. How sensitive is the LOS letter to g/C?

Sweeping g/C over candidate bands and recording where the letter moves
(exact port of `vcToDelay` / `delayToLos`, `calMul = 1.0`):

| band | % of the 10–1400 vph approach range where the letter moves |
|---|---|
| 0.35–0.55 (narrow) | 77% |
| 0.30–0.60 (moderate) | 85% |
| 0.20–0.65 (credible) | 93% |

At 500 vph the letter spans five levels: F at g/C 0.20, C at 0.45, A at 0.65. The band is a
3.25× capacity swing, so this is arithmetic, not a modelling subtlety.

**Consequence:** a per-intersection "timing-sensitive" flag is not viable. A flag that fires
on 77–93% of approaches carries no information. The original design for this feature is dead.

## 3. What wiring PR #168 actually does

`webster-timing.ts` (already written, already on this branch, wired into nothing) derives
per-phase green ratios from approach volumes via Webster optimum cycle + the Critical
Movement Method, sourced to FHWA-HOP-07-006 (a US Government work — public domain, no
HCM licensing exposure). It guards saturation at `Y ≥ 0.85` and floors each phase at
`MIN_PHASE_GREEN_S`.

Grid: 121 intersections × 4 approaches, NS/EW critical volumes 100–1000 vph.

    saturation-guard fallbacks (unchanged):  15 intersections
    LOS letter changes:                      336/424  (79%)
      minor approach got worse:              146      <- capacity bias corrected
      major approach got better:             188

Balanced intersections barely move — derived g/C lands near 0.42 against the 0.45 default.
Unbalanced ones swing hard and correctly: at NS 800 / EW 200 the heavy axis goes D→A (it
receives the green) and the light axis B→C (it waits).

## 4. The result that drives the recommendation

LOS letters are a reporting unit. **Mitigation triggers are the decision unit.** Testing
whether adding project trips pushes an approach from ≤ D to ≥ E, across 692 approach-scenarios
at +5% / +10% / +20% growth:

    flat and wired AGREE:    644  (93.1%)
    flat MISSED a trigger:     0
    flat FALSE-ALARMED:       48  (7%)

**The flat model never under-predicts mitigation in this grid; it over-predicts it.** Because
understated minor-approach capacity makes approaches cross thresholds *earlier*, the flat
assumption is conservative — it recommends mitigation that the better model says is
unnecessary. That is the professionally safe direction to be wrong in.

*Limit on this claim:* the grid grows all approaches uniformly. Real project trips load
asymmetrically through a driveway. This is strong evidence over a wide grid, not a proof.

## 5. Recommendation

**Defer wiring until after 2026-10-01.**

- Wiring is a **quality** improvement (truer letters, 7% fewer false alarms), not a safety fix.
  The current output errs conservative, so nothing in flight is unsafe to send.
- It changes 79% of LOS letters, which invalidates every regenerated sample PDF and every
  pinned fixture. That re-verification cost lands squarely on the sell sprint.
- The feature freeze to 10-01 already covers this.

**When it is wired, ship the provenance with it.** `SignalTiming.basis`
(`"webster" | "measured" | "screening-default"`) is the honest disclosure the abandoned
sensitivity flag was reaching for: the report states per intersection how its timing was
derived. That is a credibility feature and it is already built.

## 6. Follow-ups

- Asymmetric-loading check: rerun §4 loading a single approach (driveway-style) rather than
  growing all four, to test whether the zero-missed-trigger result survives.
- Decide whether a measured UTDF cycle should also re-derive capacity, not just `d1`.
  Currently it does not, so a measured import buys less than a reader would assume.
- No approach-role model exists (`Direction` is bare NB/SB/EB/WB); `webster-timing.ts` infers
  the major axis from volume, which is sufficient and needs no new modelling.

## 7. Reproduction

Analysis scripts are scratch, not committed. Both modules load directly under Node 26 type
stripping — copy `signal-delay.ts` and `webster-timing.ts` out of this branch, rewrite the
extensionless import as `./signal-delay.ts`, and import them. No `node_modules` required.
