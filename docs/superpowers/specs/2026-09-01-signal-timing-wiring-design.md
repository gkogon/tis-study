# Signal timing: wiring the resolver, consuming Synchro splits

**Date:** 2026-09-01
**Branch:** `feat/webster-signal-timing` (PR #168)
**Supersedes the deferral in:** `2026-08-31-signal-timing-sensitivity-design.md` §5

## 1. Why

Every intersection in every one of the 316 served regions is analyzed at a flat
90 s cycle and g/C 0.45 (`signal-delay.ts:49-53`). Approach capacity is
`SATURATION_FLOW_VPH × G_OVER_C = 810 vph` — identical for a downtown Manhattan
grid signal and a rural Georgia arterial. The 2026-09-01 accuracy baseline
established that volume inputs are now measured and independently corroborated
(AADT 100% real DOT data; D-factor 0.558 vs an assumed 0.55–0.60; growth
cross-validated to 0.13 pt), which leaves **signal timing as the largest
remaining unrealism in delay, LOS and queue output**.

`webster-timing.ts` was written to fix this and wired into nothing. This spec
wires it, and fixes a second defect found while scoping: the Synchro importer
already parses the real splits and the engine discards them.

## 2. What the research settled

A sweep of candidate timing sources, probed directly rather than assumed:

- **Open GIS signal layers carry no timing.** Full field lists pulled from all
  four layers the product already ingests — FDOT statewide TDA, Miami-Dade,
  Raleigh, Charlotte. Zero timing fields. Charlotte's `SIGNAL_PLAN` is a UNC
  path to an internal file share (`\\CHARLOTTE\CoCDFS\...\00819.pdf`), not
  fetchable. Raleigh's `APS_Phase` / `FYA_phase` are phase *numbers*, not
  durations. Open GIS gives locations and names, nothing more.
- **Agency ATSPM portals hold real measured timing but expose no feed.**
  GDOT's (`traffic.dot.ga.gov/ATSPM`) is live and unauthenticated, running the
  UDOT open-source codebase; `GetSignalLocation?signalID=1` returns
  `Luckie St NW @ Merritts Ave`, and its metric list includes Split Monitor
  (2) and Timing and Actuation (17) — programmed splits and measured phase
  durations by time-of-day plan. There is no documented API: charts go through
  a form POST that would need reverse-engineering and would break on any GDOT
  upgrade. Coverage is ATSPM-instrumented agencies only (GA, UT, parts of
  IN/NC), and zero international.
- **Miami-Dade DTPW publishes full controller timing sheets, openly, keyed on
  a field the engine already ingests.** Found via the county's "Traffic Signal
  Documents" Experience app. The documents are served by a plain parameterized
  endpoint:

      https://tssgisdocs.azurewebsites.net/api/values?AssetId={ASSETID}&type=tod     TOD timing report
      https://tssgisdocs.azurewebsites.net/api/values?AssetId={ASSETID}&type=sop     signal operating plan
      https://tssgisdocs.azurewebsites.net/api/values?AssetId={ASSETID}&type=assets  plans
      https://tssgisdocs.azurewebsites.net/api/values?AssetId={ASSETID}&type=charts  detection charts

  `ASSETID` is already pulled by `fetch-city-signals.ts` from
  `TrafficSignals_gdb/FeatureServer/0` — the join key exists today.

  A `type=tod` report carries everything the model needs: cycle length per
  time-of-day plan, green time per phase per plan, the phase→movement mapping
  (PH2=WBT, PH4=NBT, PH5=WBL, PH6=EBT, PH8=SBT on the sampled asset), the
  time-of-day schedule that selects the peak-period plan, plus offsets, yellow
  and red clearance, min initial and vehicle extension.

  Measured on asset 2542 (N Miami Blvd & NE 10 Av), PM plan, cycle 130 s:
  **WBT g/C ≈ 0.80, NBT/SBT g/C ≈ 0.11**. The flat 0.45 understates that major
  approach by ~44% and overstates the minor approaches by roughly 4× — the
  exact bias the 2026-08-31 sensitivity grid predicted, now confirmed against
  a real controller rather than a synthetic sweep.

  **Coverage: 78%** of full traffic signals (`ASSETTYPE=1`), measured on a
  40-signal deterministic spread. The layer holds 6,037 assets, of which
  roughly 60% are `ASSETTYPE=1`; the rest are flashers, beacons and similar.
  The endpoint returns HTTP 200 with an empty body when no document exists, so
  presence must be detected by content (`%PDF` magic plus a size floor), never
  by status code.

- **The universal fallback is still derived.** Webster optimum cycle +
  Critical Movement Method from approach volumes the engine already computes.
  No external dependency, sourced to FHWA-HOP-07-006 (a US Government work —
  public domain, no licensing exposure). It covers the 315 regions that have
  no agency feed, which is nearly all of them.

**Correction to an earlier claim.** `webster-timing.ts:14-27` states that a
2026-08-28 sweep found no open per-intersection timing feed in any served
metro. That is now false: Miami-Dade has one, and it was missed. The comment
must be rewritten rather than left standing, since it is the stated
justification for the module existing.

ATSPM ingest remains **out of scope** here (see §5), as does the Miami-Dade
ingest itself — but the resolver in §4.1 is designed so an agency feed is a
first-class `measured` source rather than something bolted on later.

## 3. The defect in the Synchro path

`utdf-import.ts:72-79` parses `UtdfPhase.splitS` (max green) and `minGreenS`
per phase. `utdf-import.ts:356` skips the `[Lanes]` `Phase1` record — the row
that maps each movement (NBL, NBT, SBL…) to its phase number — with the
comment "real but unconsumed." `routes/tis.ts:178` then reads only
`cycleLengthS` off the parsed record and drops `phases` entirely.

Splits keyed by phase, plus phases keyed by movement, is a complete and
unambiguous measured g/C per approach with no NEMA phase-numbering guesswork.
It is parsed today and thrown away today. That is why importing a Synchro
model currently changes so little: `vcToDelay` takes the cycle into the Webster
`d1` term only and never re-derives capacity, so the imported model moves the
delay number slightly and cannot move the LOS letter.

## 4. Design

### 4.1 One resolver, four tiers

A `resolveSignalTiming()` entry point returns the existing `SignalTiming`
shape. The `basis` union goes from three values to four:

| `basis` | Condition | Cycle | g/C |
|---|---|---|---|
| `measured` | Any source supplying cycle **and** per-phase splits mapped to movements | source cycle | source splits ÷ cycle, per axis |
| `measured-cycle` | A source supplying cycle only | source cycle | Webster splits |
| `webster` | No source; approach volumes present | Webster optimum, clamped 60–120 s | Critical Movement Method |
| `screening-default` | Approach volumes absent, or Y ≥ 0.85 | 90 s | 0.45 |

Precedence is strict and top-down. A real controller value always beats a
computed one; a computed one always beats a flat constant.

**The `measured` tier is defined by what a source provides, not by which
source it is.** Two feed it today and they rank in this order:

1. **A client Synchro upload** (`[Timings].splitS` + `[Lanes].Phase1`) — the
   applicant's own model, which they are accountable for and which reflects
   any scoping agreement with the reviewer.
2. **An ingested agency timing sheet** — Miami-Dade DTPW today, per §2.

Client upload outranks agency feed because the applicant's model is the
document under review; an agency sheet may be years stale (§7) and is the
better default only in the absence of a submitted model.

The resolver therefore takes an **ordered list of timing providers** and
returns the first that resolves, rather than hardcoding UTDF. Adding
Miami-Dade — or GDOT ATSPM later — is then a new provider, not a change to
the resolver, the delay model, or the PDF layer.

`computeSignalTiming()` already implements `measured-cycle` behavior via its
`measuredCycleS` argument (cycle wins, splits computed), so that tier needs no
new math — only the plumbing that currently drops the record.

`measured` and `measured-cycle` are distinguished because they are materially
different claims. The first means the report is using the agency's actual green
splits. The second means it is using the agency's cycle with the engine's
modeled splits. A reviewer is entitled to know which.

Both measured tiers record which source produced them, so the report can name
the agency and the sheet's print date rather than saying only "measured."

### 4.2 Timing is computed once from no-build volumes and held fixed

Resolution happens at `tis.ts:1291`, where `measured`, `utdfCycleLenS` and
`baseVolume` already land. The resulting `SignalTiming` is then reused
unchanged for every scenario: Current, No-Build, Build, Design No-Build,
Design Build.

**This rule is load-bearing.** If timing were recomputed per scenario, Webster
would retime the signal to absorb the project's own trips, and mitigation
triggers would evaporate — the model would silently grant the applicant a
retiming it never asked the agency for. Signal retiming is a *mitigation
measure*, which the reports already state at `pdf-export-states.ts:1392`. It is
not a baseline assumption, and the engine must not apply it as one.

The no-build (background) condition is the correct basis because it is the
condition the operating agency actually timed the signal for.

### 4.3 Capacity re-derives per approach

Per-approach capacity becomes:

    approachCapacityVph(d) = SATURATION_FLOW_VPH × gOverCForApproach(timing, d)

replacing the flat 810 vph at `tis.ts:1431` and `tis.ts:1453-1455`. The
intersection-level figure at `tis.ts:1354-1361` uses the critical (heavier)
axis. Both cycle and g/C are passed into `vcToDelay`, whose signature already
accepts them — no interface change is needed there.

`MIN_PHASE_GREEN_S = 10` against `MAX_CYCLE_S = 120` floors g/C at 0.083, so
capacity floors near 150 vph and cannot collapse to zero. This floor was added
in response to property-based fuzzing that found T-intersections and
single-axis sites producing g/C = 0 and v/c = Infinity.

The 2026-08-31 sensitivity analysis was run with capacity re-derived — its
line 50 reads "capacity bias corrected" — so its headline result (79% of LOS
letters move, 7% of mitigation verdicts move, zero missed triggers, 48 false
alarms) describes this full wiring, capacity included. It is not re-litigated
here, but it *is* re-verified under the new fixed-timing rule; see §6.

### 4.4 Provenance is printed

`basis`, cycle length and per-axis g/C are stamped on each intersection record
and printed per intersection in the deliverable.

The blanket boilerplate at `pdf-export.ts:8421` and `pdf-export.ts:8448`
("Screening delays use a generic signal model (90 s cycle, g/C 0.45, 1,800
pc/h/ln…)") becomes **conditional**: it prints only when that study actually
contains `screening-default` rows. A study where every intersection resolved
to `webster` or `measured` must not carry a disclosure describing a model it
did not use.

### 4.5 False statements corrected

All three are in shipped output or shipped comments and are wrong today:

- `pdf-export-ny.ts:1087` prints, unconditionally in every NY report's
  Appendix A, "calibrated against the controlling DOT 511 / Regional Traffic
  Office data feed." Prod `intersection_calibration` holds 882 rows, **all**
  prefixed `ATL-`; every NY study runs at multiplier 1.0. Rewrite to what is
  true.
- `webster-timing.ts:18` claims "GDOT's ATSPM portal does not expose
  cycle/split." It does — see §2. The accurate and weaker claim is that it
  exposes no documented feed or bulk API.
- `webster-timing.ts:14-27` states that a sweep of every served metro found no
  open per-intersection timing feed. Miami-Dade has one (§2). Since this claim
  is the module's stated justification for existing, it is rewritten to say
  what is actually true: agency feeds exist but are rare, undiscoverable
  through data catalogs, and absent from all but a handful of served metros —
  so a derived model is still required as the universal tier.

## 5. Out of scope

- **The Miami-Dade timing ingest itself.** Fetching ~3,600 `type=tod` PDFs,
  parsing the fixed-format TOD Schedule Report, selecting the peak-period plan
  from the time-of-day schedule, converting green time plus clearance into
  effective green, storing the result and joining it to study intersections is
  its own pipeline and gets its own spec. This spec delivers the provider
  interface it will plug into. Sequencing it separately also keeps the wiring
  shippable on its own.
- ATSPM ingest of any kind (see §2).
- Re-baselining `SATURATION_FLOW_VPH` from 1,800 to HOP-07-006's typical
  1,900. `computeSignalTiming()` already defaults to the engine constant
  specifically so this cannot happen as a side effect. It is a separate
  decision.
- Any approach-role model. `Direction` remains bare NB/SB/EB/WB;
  `webster-timing.ts` infers the major axis from volume, which is sufficient.
- The dead per-intersection "timing-sensitive" flag, killed by the 2026-08-31
  analysis. Not rebuilt.

## 6. Verification

**Unit.** Tier precedence across all four `basis` values. The UTDF
phase → movement → split mapping, including a UTDF that has `[Timings]` splits
but no `[Lanes]` `Phase1` row, which must degrade to `measured-cycle` rather
than crash or guess NEMA numbering. The `Y ≥ 0.85` saturation guard. Provider
ordering, using a stub agency provider alongside a UTDF record, asserting the
client upload wins and that removing it falls through to the agency source —
this proves the §4.1 interface before Miami-Dade is built against it.

**Property.** Capacity is always > 0. g/C always lands within
[0.083, MAX]. Timing is identical across all five scenarios for a given
intersection — the §4.2 rule expressed as an assertion, not a convention.

**Regression.** Re-run the 692-approach-scenario trigger grid under the
fixed-timing rule. The 2026-08-31 grid did not state whether it held timing
fixed across the +5% / +10% / +20% growth steps, and "flat missed zero
triggers" is the claim the decision to proceed rests on. It is re-earned here
rather than inherited.

**Fixtures and samples.** Re-pin the fixtures and regenerate the six sample
PDFs. This churn is expected and was accepted when the work was authorized;
it is the reason the 2026-08-31 doc recommended deferral.

## 7. Risks

- **Sample and fixture invalidation lands on the sell sprint**, before the
  2026-10-01 kill-line decision date. Accepted deliberately.
- **The flat model is conservative**, so this change makes some approaches
  look *better* and will remove mitigation findings from regenerated samples
  (the 48 false alarms). Any sample already sent to a prospect that showed a
  mitigation trigger may not show it after regeneration. Check the sent
  corpus before regenerating anything already in a prospect's hands.
- **The 2026-08-31 grid grew all approaches uniformly.** Real driveway loading
  is asymmetric. The zero-missed-trigger result is strong evidence, not proof;
  the open follow-up to re-run it with one approach loaded driveway-style
  remains open and is not closed by this work.
- **Agency timing sheets go stale, and Miami-Dade says so itself.** The sampled
  asset 2542 sheet carries a print date of 2021-10-04, and the county's own app
  warns that "the files in this application may be outdated," directing users to
  the Traffic Signals and Signs Division public records section (305-679-0004)
  for current documents. Any ingest must capture each sheet's print date, carry
  it through to the report, and print it beside the timing. A five-year-old
  controller sheet presented undated is worse than an honest model default. This
  is also the reason a client's submitted Synchro model outranks the agency feed
  in §4.1.

## 8. Follow-on work this opens

- **Miami-Dade timing ingest** (§5) — first agency provider behind the §4.1
  interface, ~78% coverage of full signals in a metro with a live prospect
  whose employer is the publishing department.
- ~~Sweep for the same pattern elsewhere.~~ **Done 2026-09-01 — see §9.**
  Miami-Dade is an outlier, not the first of a pattern.

## 9. National sweep result: Miami-Dade is an outlier

Run 2026-09-01, three independent methods, to test whether the Miami-Dade
pattern repeats. It does not.

| Method | Scope | Result |
|---|---|---|
| Templated doc URLs in web-map popups | 452 signal-related AGOL items, 406 configs inspected | **1 hit** — Miami-Dade. The other 19 matches were Web AppBuilder `${itemId}` logo boilerplate. |
| Timing / document fields on feature layers | 751 signal feature services, 347 layers flagged, all 71 timing-named fields sampled | **0 hits.** Fields exist but are empty. |
| Feature attachments | 140 attachment-enabled layers, 69 with actual attachments | **1 partial** — TxDOT Houston, below. |

Confirmed empty schema (the field exists, no row is populated): San Mateo
County `Timing_Sheet_Link` 0/140, Menlo Park `Timing_Sheet` 0/42, Colorado
Springs `CYCLELENGT` 0/311. South San Francisco `Timing` is 60/135 populated
but holds control-mode labels ("Local Schedule"), not timings.

Open-data catalogs were checked separately: Socrata returns 1,155 hits for
"signal timing" and every one inspected is a program tracker — Seattle
"Corridors With Optimal Signal Timing", Chicago "Performance Metrics", Austin
"Traffic Signal Re-Timing", NYC "VZV Signal Timing/25MPH Retiming". Project
lists, not plans. ArcGIS Hub and USDOT datahub likewise.

**Partial hits, neither worth a pipeline:**

- **TxDOT Houston** (`WA_2_TxDOT_Houston_Traffic_Signal_Timing_View_Layer`,
  HDR-hosted): 9 `…_Previous Timing_TxDOT.pdf` attachments on a 175-feature
  Esri Field Maps layer — a consultant's corridor retiming study on SH 99 and
  I-10. Real sheets, negligible coverage, and it disappears when the project
  closes. Worth grabbing the 9 files, not worth automating.
- **SPaT logs on USDOT datahub** (Utah pooled-fund study; UDOT/Panasonic, 3
  Orem intersections; Tampa CV Pilot). Real phase-state messages that could be
  aggregated into observed g/C, but they are multi-day research samples at a
  handful of intersections. The Tampa entry — the only served metro — is
  explicitly labelled a sample.

Georgia specifically: no public timing viewer exists. GDOT ATSPM stays the
only route, and an official ask beats a scraper (§2).

**Consequence for this design:** the realistic provider roster is client
Synchro upload, Miami-Dade, and Webster everywhere else. That *confirms* the
§5 decision to spec the Miami-Dade ingest separately rather than building a
generic multi-agency ingest framework — there is no second agency to
generalize from.

⚠️ **Limits of this sweep.** AGOL search does not index agency-hosted ArcGIS
Enterprise portals (e.g. `gisportalny.dot.ny.gov`, `gisms.miamidade.gov`), and
a viewer can build its document URL in runtime JavaScript rather than in the
item config, where none of these methods would see it. "No other feed" means
none found by three methods, not proof of absence.
