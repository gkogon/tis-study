# TIS Proofread Protocol — Datum

Two roles.

- **Redline** — the main AI. Builds the study: inputs, trip generation,
  distribution, assignment, delay, mitigation, deliverable.
- **Datum** — the proofreader, in the shadows. Reviews **any work Redline
  suggests or generates, and every study before it is called complete.**
  Datum is not visible in the deliverable and never addresses the client. Its
  audience is Redline and the PE.

Redline and Datum are **separate chains of thought** — separate contexts, built
off each other, and **meant to disagree when the work warrants it.** Datum does
not see how Redline reached a number, by design. A Datum pass that returns
nothing is not evidence the study was clean.

Datum runs as an isolated agent (`.claude/agents/datum.md`) with no write tools.
It cannot edit the study even if it wanted to.

**Rules of the pass**

1. Datum does not edit. It produces a findings list and hands it back.
2. Every finding is `BLOCKER` / `DISCLOSE` / `NOTE`.
   - `BLOCKER` — wrong number, wrong source, or a missing input. Nothing ships.
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

Engine constants referenced below are in
`artifacts/tis-api-server/src/lib/signal-delay.ts`; trip rates are in
`artifacts/tis-api-server/src/lib/land-uses.ts`.

---

## 1. Inputs

- Confirm the land use code matches the actual program.
- Confirm unit count against the site plan.
- Confirm opening year against the **construction schedule**, not the
  application date.
- Confirm count dates support the growth years applied — one year at 1.5%
  implies 2026 counts.

*Running it here:* count vintage and per-state growth provenance come from
`regional-growth-rates.ts` and the ingested ATR/TMAS series. If the count year
and the stated growth exponent disagree, that is a `BLOCKER` — the volumes are
wrong, and every downstream delay is wrong with them.

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

**What replaces it.** The size-sensitivity concern behind the original check is
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
  Boundaries are **10 / 20 / 35 / 55 / 80 s** (`LOS_THRESHOLDS`).
- **Anything within one second of a boundary is reported as a delta, not a
  letter.** The letter is not defensible at that margin.
- Compare opening-year and design-year deltas. **If the design-year delta is
  larger, the finding is driven by background growth, and the deliverable must
  say that** — it is not a project impact.
- Check the 95th-percentile queue (`queue95Ft`) against available storage **and
  driveway offset** for every approach carrying project traffic.
- Watch the delay ceiling: reported control delay is capped at
  `SCREENING_MAX_DELAY_SEC = 300`. Two approaches both printing at or near 300 s
  are not equal — they are both off-scale. Do not report them as a tie.

## 5. Criteria

- Confirm the **full** agency TIS threshold set, from the governing
  jurisdiction's own document.
- A delay-increase test alone is usually incomplete. Most jurisdictions add:
  - a **v/c criterion**, and
  - a **separate clause for approaches already failing** in the no-build.
- A criterion Datum could not locate in the agency document is
  `BLOCKER — unverified`, not an assumed absence.

## 6. Limitations disclosure

Every study states, in the deliverable, not in a footnote:

- **Cycle length 90 s**, **green ratio g/C 0.45**, **saturation flow 1,800
  vphgpl** — applied flat at every signal. These are screening assumptions, not
  measured timing.
- **No left-turn phasing is modeled.** One critical lane per approach,
  critical-movement fraction 0.45.
- **Reported delay is capped at 300 s.**
- The **analysis period**, and **every period not analyzed.**
- **An absent AM peak is a disclosure item, not a footnote.** Multifamily is
  outbound-dominated in the AM, and the exiting left is the movement most
  likely to govern. A PM-only study on a multifamily site must say plainly
  that the probable governing movement was not analyzed.

### Standing note on the flat g/C

The flat 0.45 g/C drives the LOS letter at most signals. Volume-responsive
timing exists (`webster-timing.ts`) but is **not on the mainline** — it sits on
`feat/webster-signal-timing`, unmerged. Until it ships, the flat assumption is
what produced every letter in every delivered study, and §6 is the only thing
standing between that assumption and an agency reviewer who thinks it was
measured. It is not optional boilerplate.

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

## Output format

```
DATUM FINDINGS — <study id> — <date>

BLOCKER
  [§n] <finding> — <what to change>

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

An empty `BLOCKER` list **and** an empty `CONTESTED` list are the only
condition under which Redline may call a study complete.
