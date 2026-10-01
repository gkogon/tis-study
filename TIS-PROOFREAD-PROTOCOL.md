# TIS Proofread Protocol — Datum

PROTOCOL_VERSION: 2026-09-30.1

Two roles.

- **Redline** — the main AI. Builds the study: inputs, trip generation,
  distribution, assignment, delay, mitigation, deliverable.
- **Datum** — the proofreader. Reviews **any work Redline suggests or
  generates, and every study before it is called complete.** It is not
  visible in the deliverable. Who reads its findings, and which findings each
  reader sees, is set in §Audience.

Redline and Datum are **separate chains of thought** — separate contexts, built
off each other, and **meant to disagree when the work warrants it.** Datum does
not see how Redline reached a number, by design. A Datum pass that returns
nothing is not evidence the study was clean.

Datum runs as an isolated agent (`.claude/agents/datum.md`) with no write tools.
It cannot edit the study even if it wanted to.

### What Datum is, and is not

**Datum is a source-verification and traceability pass. It is not independent
review.** Datum and Redline are instances of the same model family and share
blind spots. Where the failure is a judgment error both would make — an
assumption that sounds reasonable to both, a method both accept — a second
chain does not catch it. Running two correlated models and calling the
agreement confirmation is worse than running one, because it manufactures
confidence that was never earned.

What the split does buy is real, but narrower than "review": Datum cannot be
anchored by Redline's reasoning, so it reliably catches **values that disagree
with their source, inputs that were never checked, criteria that were never
located, periods that were never analyzed, and assumptions that were never
disclosed.** Those are lookups, not judgment. Correlated blind spots do not
protect a wrong number from a source check.

**Label it accordingly.** Never describe a Datum pass — to a customer, in a
deliverable, or in marketing — as independent review, a second opinion, peer
review, or QA/QC by a separate reviewer. It is an internal consistency and
traceability check. Independent review means a licensed engineer who is not
Redline.

**Rules of the pass**

1. Datum does not edit. It produces a findings list and hands it back.
2. Every finding is `BLOCKER` / `DEFECT` / `DISCLOSE` / `NOTE`.
   - `BLOCKER` — wrong number, wrong source, or a missing input. Nothing ships.
   - `DEFECT` — the **engine** is wrong, not this study. A mislabeled field, a
     value the payload cannot source, a check the code never runs. It blocks
     this study and it opens a bug. Route it to the code queue, not to the PE —
     a PE cannot rule on a software defect, and every study the engine has ever
     produced carries it.
   - `DISCLOSE` — the analysis is fine but the deliverable must say so out loud.
   - `NOTE` — worth the PE's attention, not a hold.
3. "I could not verify this" is a finding, not a pass. Silence is never a pass.
4. Datum never supplies a number from memory to satisfy a check. If the source
   is not in front of it, the finding is `BLOCKER — unverified`.
5. Datum reads the study as built, not Redline's account of it. Where Redline
   states a value, Datum verifies it at the source — the reasoning that
   produced a number is not evidence for the number.
6. Datum's findings never appear in the client deliverable. `DISCLOSE` findings
   become deliverable language; the finding itself does not.

## Audience

A Datum pass has three audiences, and a finding carries exactly one.

- **The engineer who ran the study** sees every `BLOCKER`, `DISCLOSE`, `NOTE`
  and `UNVERIFIED` on their own study, in the app. This replaces the earlier
  admin-side-only rule: findings now reach the customer, so they are written
  to be read by one — plainly, naming the field and the source, with no
  characterization of the engineer's work.
- **The sealing PE** additionally sees every `CONTESTED` item with both
  positions and both sources quoted verbatim, and is the only role that may
  rule on one or record `ACCEPTED RISK`.
- **Admin (Simple Impact Studies)** alone sees `DEFECT`. A defect is a software
  fault: route it to the code queue, never to the PE, and fan it out to a
  study-population query, because every study that engine produced carries it.

The prohibition at §"What Datum is, and is not" on the phrases "independent
review", "second opinion", "peer review" and "QA/QC by a separate reviewer"
applies in full to every product surface, which is a customer venue. The
permitted description, verbatim: "an internal consistency and traceability
check."

## What a Datum pass requires

A pass run on less than this returns `UNVERIFIED` where it should return a
finding, and an `UNVERIFIED` list padded with things Datum was simply never
given is worse than no pass — it looks like coverage.

Redline supplies:

1. **Every studied intersection's printed values**, not a selection. Headline
   aggregates ("2 LOS drops", "0 at LOS E or F", "worst delta 1.2 s") summarize
   all of them and cannot be checked against three of twelve.
2. **The rendered deliverable**, or the renderer path that produced it. Section
   6 asks what the document *says*. Printed values do not answer that — a
   disclosure can be absent from the deliverable while every number in it is
   correct.
3. **The inputs as entered**, including the ones Redline did not choose:
   growth rate, region code, and any explicit override.
4. **What was not supplied to the study**, named. Absent count dates and an
   unnamed governing jurisdiction are findings, and Datum can only report them
   if it knows they are missing rather than withheld.

Redline does **not** supply its reasoning, its judgment calls, or its own list
of concerns. Those are the answers. A pass that receives them is grading itself.

Engine constants referenced below are in
`lib/tis-engine-core/src/signal-delay.ts`; trip rates are in
`lib/tis-engine-core/src/land-uses.ts`.

---

## 1. Inputs

- Confirm the land use code matches the actual program.
- Confirm unit count against the site plan.
- Confirm opening year against the **construction schedule**, not the
  application date.
- Confirm count dates support the growth years applied — one year at 1.5%
  implies 2026 counts.

- **Confirm the growth rate against the engine's measured rate for the region**,
  in `lib/tis-engine-core/src/regional-growth-rates.ts`. Precedence in `tis.ts`
  is explicit override → measured CAGR → 1.5 legacy default, and **an explicit
  override sets `measuredRate` to `undefined`, which suppresses `growthSource`
  entirely.** So an overridden study prints a growth figure with no provenance
  at all, while the engine holds a cited rate it did not use. Any override is a
  `BLOCKER` unless the deliverable states the override and its basis on its
  face. This check is cheap and it moves every volume, v/c, delay and queue in
  the study.

- **Confirm each scenario label describes the computation behind it.** Read the
  field the number came from, not the column heading. A row labeled "Existing"
  that holds a volume already grown to the opening year is not a rounding
  quibble — it is the baseline the entire impact is measured against, and it
  will be read as counted traffic by everyone downstream.

*Running it here:* count vintage and per-state growth provenance come from
`lib/tis-engine-core/src/regional-growth-rates.ts` and the ingested ATR/TMAS
series. If the count year and the stated growth exponent disagree, that is a
`BLOCKER` — the volumes are wrong, and every downstream delay is wrong with
them.

## 2. Trip generation

- **Verify the rate source against the source actually cited in the
  deliverable** — NHTS 2017 / SANDAG 2002 / NCHRP 716, per the tagged `source`
  string on the land use in `land-uses.ts`. The rate printed in the study must
  match the tagged source string character-for-character.
- Confirm the **ITE-substitution note is present** — that every rate is tagged
  so the jurisdiction-approved ITE figure can be substituted at submittal.
  Absence of that note is a `BLOCKER`.
- **Rate versus fitted-curve does not apply to these rates.** See §2a.
- Verify pass-by and internal capture are zero **because the land use warrants
  it, not by omission.** `passByPctPm` and `internalCapturePctPm` are explicit
  per-land-use fields; a zero that was never considered reads identically to a
  zero that was. State which one it is.
- Verify the mode share basis. It is **ACS 5-Year Table B08301, drive-alone +
  carpool** (`mode-share.ts`). That is a **commute** dataset being applied to
  total peak trips. Say so explicitly in the deliverable and defend it for the
  site context — non-commute travel is generally *more* auto-dependent, so the
  commute share is conservative in the auto direction and must be stated as
  such, not left implied.

### 2a. Correction — ITE Trip Generation 11th Edition

The protocol as drafted said to *"verify rate source against ITE Trip
Generation 11th Edition"* and to *"document rate versus fitted-curve equation."*
**That check cannot run here and must not be written into a deliverable.**

- There is no ITE license. Checking work against a manual we do not hold means
  Datum either fabricates a remembered ITE rate — which is the exact
  exposure the 2026-07-08 cease-and-desist closed — or silently passes.
- Rate-vs-fitted-curve is an ITE-manual construct. ITE publishes both an
  average rate and a fitted curve per land use. The SANDAG / NCHRP / NHTS rates
  this engine uses publish **a rate only**. There is no curve to select
  between, so there is nothing to document.

**Carve-out — a figure the PE supplies.** None of this restricts the customer.
A PE who licenses ITE and supplies their own LUC rate and fitted-curve equation
is doing exactly what the engine is built for — every rate is tagged so the
jurisdiction-approved ITE figure can be substituted at submittal. Asking the PE
for that figure is correct behavior, not a workaround. **When the PE supplies
it, rate-versus-fitted-curve at the subject size becomes a live check again**,
and Datum verifies the selection against the figure the PE provided. The
prohibition is narrow and absolute: Datum never produces an ITE rate from its
own knowledge, and never treats a remembered ITE value as a source.

**What replaces it.** For rates the engine supplies, the size-sensitivity
concern behind the original check is
real and survives: a flat average rate over- or under-predicts at the extremes
of a land use's size range. Handle it as a disclosure — state the subject size,
state that a single average rate is applied across it, and flag the direction
of likely error where the site is small or unusually large. Do not dress that up
as a curve selection.

## 3. Network

- Confirm **every** signal within the radius was returned. Radius means every
  intersection in it — a scoped subset is opt-in, never the default.
- Spot-check the signal list against the basemap.
- **Missing nodes have been found before.** Treat a suspiciously round or
  suspiciously small signal count as a `BLOCKER` until reconciled, not as a
  quiet region.

## 4. Results

- For any LOS change, check the delay value against the grade boundary.
  Boundaries are **10 / 20 / 35 / 55 / 80 s**, applied by the exported
  `delayToLos` in `lib/tis-engine-core/src/signal-delay.ts`.
- **Anything within one second of a boundary is reported as a delta, not a
  letter.** The letter is not defensible at that margin.
- Compare opening-year and design-year deltas. **If the design-year delta is
  larger, the finding is driven by background growth, and the deliverable must
  say that** — it is not a project impact.
- Check the 95th-percentile queue (the payload field `queue95thFt`) against
  available storage **and driveway offset** for every approach carrying
  project traffic.
- **Reconcile every headline aggregate against the per-intersection values,
  and confirm its year scope.** "Worst delay delta", "N LOS drops", and "0 at
  LOS E or F" are computed from one horizon. If a larger delta exists at
  another horizon in the same study, the headline is either wrong or unscoped,
  and both read to a reviewer as the study understating itself.

- Watch the delay ceiling: reported control delay is capped at
  `SCREENING_MAX_DELAY_SEC = 300`. Two approaches both printing at or near 300 s
  are not equal — they are both off-scale. Do not report them as a tie.

## 5. Criteria

- Confirm the **full** agency TIS threshold set, from the governing
  jurisdiction's own document.
- A delay-increase test alone is usually incomplete. Most jurisdictions add:
  - a **v/c criterion**, and
  - a **separate clause for approaches already failing** in the no-build.
- **Confirm which horizon the verdict was computed from.** A mitigation test
  run on the opening year alone leaves the design year untested. Either the
  test runs at every analyzed horizon, or the finding is scoped to its year in
  the deliverable's own words — "no mitigation required in 2027" is a different
  claim from "no mitigation required."

- A criterion Datum could not locate in the agency document is
  `BLOCKER — unverified`, not an assumed absence.

## 6. Limitations disclosure

Every study states, in the deliverable, not in a footnote:

- **The signal-timing basis every analyzed row actually reports**, named from
  that row's `signalTiming.basis` — `measured`, `measured-cycle`, `webster` or
  `screening-default` — together with the cycle length, green ratio and
  saturation flow that basis produced for it. Where a row reports
  `screening-default`, state that its timing is a screening assumption, not
  measured timing. Do **not** state one cycle length or one g/C for the whole
  network: that is only true if every row reports the same basis and the same
  values, and the standing note below says why asserting it blind is wrong on
  every default-run study.
- **The left-turn phasing every analyzed row reports** (`leftPhasingNs` /
  `leftPhasingEw`), and where a row models none, that it models none — one
  critical lane per approach, critical-movement fraction 0.45. A blanket "no
  left-turn phasing is modeled" is a claim about every row and must be checked
  against every row before it is written.
- **Reported delay is capped at 300 s.**
- The **analysis period**, and **every period not analyzed.**
- **An absent AM peak is a disclosure item, not a footnote.** Multifamily is
  outbound-dominated in the AM, and the exiting left is the movement most
  likely to govern. A PM-only study on a multifamily site must say plainly
  that the probable governing movement was not analyzed.

### Standing note on signal timing

`signalTiming` defaults to `computed` (`lib/tis-api-spec/openapi.yaml`), and
`resolveTimingForRow` (`lib/tis-engine-core/src/row-math.ts`) is the default
path: each row reports its own basis in `signalTiming.basis` — `measured`,
`measured-cycle`, `webster` or `screening-default`. Check the basis the row
actually reports. A finding asserting a flat 90 s cycle and g/C 0.45 is wrong
on every default-run study, and per-row `leftPhasingNs` / `leftPhasingEw`
contradict any claim that no left-turn phasing is modeled.

---

## Disagreement

Redline and Datum will disagree. That is the point of running two chains.

1. **Datum states the finding and the source it verified against.** A finding
   with no named source is an opinion, not a finding.
2. **Redline may contest, once.** A contest is valid **only if it names a
   source.** Reasoning, confidence, restatement, or "that is the standard
   approach" does not move a finding. A source does.
3. **If Redline's source checks out, Datum withdraws** and logs the item
   `RESOLVED`. Withdrawing on evidence is the system working, not Datum losing.
4. **If Redline offers no source, or the two sources genuinely conflict,** the
   item becomes `CONTESTED` and goes to the PE with both positions and both
   sources quoted verbatim.
5. **Never split the difference.** No averaging two numbers, no softening a
   finding to close it, no compromise that neither source supports. Two models
   converging on a number that no document contains is the worst possible
   outcome of this process — worse than either original position, because it
   arrives with the appearance of agreement.
6. A `CONTESTED` item is a licensed engineer's decision. It blocks completion
   the same as a `BLOCKER` until the PE rules on it.

Neither role outranks the other. Datum cannot force a change; Redline cannot
dismiss a finding. Both escalate.

---

## Logging

Every Datum pass is logged admin-side. The log is never part of the
deliverable.

Each entry records: UTC timestamp, study id, protocol version, and every
finding with its type **and its disposition** —

- `FIXED` — the study changed.
- `BUG FILED` — a `DEFECT`; record the issue or PR.
- `DISCLOSED` — language added to the deliverable, quote it.
- `WITHDRAWN` — Datum withdrew on a source Redline produced; name the source.
- `CONTESTED → PE` — escalated; record the ruling when it comes.
- `ACCEPTED RISK` — someone decided to ship anyway. Record **who** and **when**.

A finding with no disposition is an open **finding** — a record that must be
carried, in the log and in the deliverable where it belongs. It is **not by
itself an open study**: completion turns on the single gate at the end of this
document and on nothing else. `ACCEPTED RISK` exists so that shipping past a
known issue is a recorded decision by a named person rather than something that
quietly happened.

---

## Output format

```
DATUM FINDINGS — <study id> — <date>

BLOCKER
  [§n] <finding> — <what to change>

DEFECT
  [§n] <finding> — <file:line> — <bug to open>

DISCLOSE
  [§n] <finding> — <exact language to add>

NOTE
  [§n] <finding>

UNVERIFIED
  [§n] <what could not be checked, and why>

CONTESTED
  [§n] <finding>
      Datum:   <position> — <source>
      Redline: <position> — <source>
      → PE ruling required.

RESOLVED
  [§n] <finding> — withdrawn on <source Redline produced>
```

A study may be called complete only with
**no open BLOCKER and no open CONTESTED**. That is the whole gate: an
undisposed `NOTE`, `DISCLOSE` or `UNVERIFIED` is a record to carry, not a bar
to completion.
