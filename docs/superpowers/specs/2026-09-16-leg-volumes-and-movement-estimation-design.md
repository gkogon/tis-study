# Leg volumes from the network, turning movements by balancing, link volumes by CSV

**Date:** 2026-09-16
**Branch:** `worktree-leg-volumes`
**Prompted by:** D.E. Wooster & Associates (design partner, Pittsburgh) asking on the
2026-09-16 call how the product "granulates macro data on the turn movements".

## 1. Why

A study intersection today receives **one** background volume: the AADT of the
segment the signal snapped to, times the region's K-factor. That is the major
road's two-way design hour. It is then split across the four approaches by
`approachVolumeShares()` (`row-math.ts:137`) — a seeded ±15% jitter on a
**30/25/25/20** base that has nothing to do with what each leg carries. The
minor street at McKnight Road & Johnanna Drive is loaded with 20–25% of McKnight
Road's volume regardless of Johnanna Drive's own count. Within each approach the
turning-movement diagrams then apply a flat **15/70/15** L/T/R split
(`pdf-export.ts:9034`) and the signal-timing resolver a **10/80/10** one
(`webster-timing.ts:104`) for the protected-left inference.

So "macro to micro" is broken at two levels — **leg** (approach totals) and
**movement** (L/T/R within an approach) — and both are disclosed on every
worksheet as screening assumptions. A firm that collects its own counts reads
those lines first. The road network the engine already builds carries a
class, a capacity and an AADT-seeded base volume **per link**
(`network-assignment.ts:221-262`), so the leg level is largely a lookup the
engine already performs once per signal, done once per leg instead. With
entering and exiting volumes known on every leg, the movement level becomes a
standard balancing problem — the method behind NCHRP 255 / NCHRP 765
project-level refinement.

This spec adds three things, in the product owner's words: **our own
estimation by default, an off switch, and a CSV of link volumes.**

## 2. Scope

In:

- A pure engine-core module, `lib/tis-engine-core/src/leg-volumes.ts`:
  `resolveLegVolumes()` and `estimateMovements()`.
- Request field `legVolumes?: "network" | "screening"` (default `"network"`).
- Request field `linkVolumes?: LinkVolumeInput[]` — structured records parsed
  server-side from a CSV, never the raw file (same rule as `utdfIntersections`).
- `POST /tis-api/link-volumes/parse` — CSV in, structured records + per-row
  rejections out.
- Snapping of link-volume records onto graph legs, with a match summary on the
  report (`linkVolumeMatchSummary`, mirroring `utdfMatchSummary`).
- Row-math consumption through the existing measured-record path (approach
  shares, L/T/R lane groups, `leftVph` for timing), under a new source label.
- Worksheet provenance line, appendix-intro and methodology clause swaps,
  `/tis` UI toggle + CSV upload, match summary before Generate.
- Regression checks in the `check:*` convention; identity guard extended.

Out (deliberately):

- NCHRP 765 refinement against regional-model link volumes (a second input
  source and a base-year calibration; nothing in the pilot asks for it).
- A firm-level count library that persists CSV rows across studies. The
  per-study attachment mirrors UTDF; a library is a later PR once a firm shows
  it re-uses counts.
- Per-intersection manual entry on the study map.
- Directional (D-factor) inference from the network. Without a directional
  count each leg is split 50/50 and says so.
- `turn:lanes` seeding. The road tuple carries `lanes`, `maxspeed`, `oneway` —
  no turn-lane tags — so a turn-bay-aware seed has no data to read.

## 3. The three modes, one resolver

```
legVolumes: "network"  (default)   each leg from its own network AADT
legVolumes: "screening"            today's 30/25/25/20 + 15/70/15, byte-identical
linkVolumes: [...]                 CSV rows override matched legs in EITHER mode
```

Resolution order per leg: **CSV row on this leg → network AADT (network mode
only) → class default (network mode only) → screening share.** A junction that
never resolved to a graph node (today's `movementSource: "octant"` rows) has no
legs to resolve; it keeps the screening shares in both modes and is labeled.

## 4. Engine core: `leg-volumes.ts`

Pure TypeScript, no DB, no I/O — testable like `webster-timing.ts`.

### 4.1 Types

```ts
export type LegSource = "csv" | "network_aadt" | "class_default" | "screening";

export type LegVolume = {
  dir: Direction;              // approach direction of travel (NB = traffic heading north INTO the node)
  enteringVph: number;         // toward the junction
  exitingVph: number | null;   // away from the junction; null = unknown (screening mode, or a one-way-in leg)
  oneWay: "in" | "out" | null; // one-way link: only one of the two is physical
  source: LegSource;
  aadt?: number;               // when source is network_aadt
  distMi?: number;             // distance from leg midpoint to the AADT record
};

export type LegVolumes = Record<Direction, LegVolume | null>;  // null = no leg on that side (T-intersection)

export type MovementEstimate = {
  /** matrix[from][to] in vph, from/to ∈ Direction; diagonal (U-turn) always 0 */
  matrix: Record<Direction, Record<Direction, number>>;
  /** per-approach L/T/R shares, Σ = 1 per approach with a leg */
  shares: Record<Direction, { L: number; T: number; R: number }>;
  leftVph: Record<Direction, number>;
  totalEnteringVph: number;
  diagnostics: {
    method: "ipf" | "seed_only";     // seed_only when no exit column was constrained
    iterations: number;
    maxResidualVph: number;          // largest |row or column residual| at exit
    imbalancePct: number;            // |Σexit − Σenter| / Σenter before normalization
    exitsNormalized: boolean;
    constrainedExits: number;        // how many exit columns had a volume
  };
};
```

### 4.2 `resolveLegVolumes(junction, inputs, mode): LegVolumes`

`junction` is what the analyzer already knows for a path-resolved signal: its
graph node and the incident links (each with `dir`, `cls`, endpoints, and the
bearing from the node). `inputs` carries the region's K, the AADT volume refs,
and the snapped CSV records for this node.

1. **Assign each incident link to an approach direction** by the bearing from
   the node to the link's far end, quantized to the nearest of N/E/S/W. The
   leg whose far end lies north of the node is the **SB approach** (traffic
   travels south into the node) and its exit is northbound. Two links
   quantizing to the same direction (a skewed five-leg): keep the one with
   the higher class, drop the other, and record `legsDropped` on the row
   diagnostic — a five-leg junction is out of scope for the 4×4 matrix, and
   pretending otherwise fabricates a movement.
2. **CSV first.** A snapped record on this link with a direction sets
   `enteringVph` (toward the node) or `exitingVph` (away), source `csv`. A
   `both` record sets each to half. A record with a period other than the
   study's analysis period is converted by the engine's existing
   `PERIOD_VOLUME_FACTOR` table; `daily` is converted by K.
3. **Network AADT** (network mode, legs the CSV did not cover): the AADT
   record nearest the **link's midpoint**, within 0.3 mi, and class-compatible
   under the same rule the analyzer applies when it snaps a signal to a
   segment (a surface street never inherits a freeway's number — #197).
   `enteringVph = exitingVph = aadt × K × 0.5`. One-way link: the physical
   direction gets `aadt × K`, the other 0, `oneWay` set.
4. **Class default** (network mode, no record within reach): the engine's
   existing per-class base (`CLASS_BASE_VC[cls] × capVph`, the same seed the
   route assignment uses), split 50/50, source `class_default`.
5. **Screening mode**: every leg gets `enteringVph = junctionTotal ×
   approachVolumeShares(signalId)[dir]`, `exitingVph` undefined, source
   `screening`. Downstream this reproduces today's arithmetic exactly.

Junction total in network mode is Σ entering over present legs. In screening
mode it stays the signal's `totalVolume` (AADT × K), untouched.

### 4.3 `estimateMovements(legs, geometry): MovementEstimate`

**Seed matrix.** For each ordered pair (from, to):

| Case | Seed |
|---|---|
| from == to (U-turn) | 0 — the engine already folds U-turns into left |
| `to` leg absent (T-intersection) | 0 |
| `to` leg is one-way *into* the node, or `from` leg is one-way *out* | 0 |
| four-leg, straight across | 0.70 |
| four-leg, left | 0.15 |
| four-leg, right | 0.15 |
| T, stem approach → the two through-road legs | 0.50 / 0.50 |
| T, through-road approach → opposite through-road leg | 0.85 |
| T, through-road approach → stem | 0.15 |

The seed is renormalized per row over the non-zero cells, then scaled by the
row's `enteringVph`. Today's 15/70/15 survives only as the prior for a
four-leg junction with nothing better known.

**Balancing (Furness / IPF).** Row targets = `enteringVph`. Column targets =
`exitingVph` for legs that have one (`csv`, `network_aadt`, `class_default`);
a leg without an exit volume is an unconstrained column. Before iterating, if
every constrained column exists and `|Σexit − Σenter| / Σenter > 0.05`, scale
the exit targets to Σenter — entering is the better-measured side of a count
and the row totals are what the capacity math consumes — and set
`exitsNormalized`. Then alternate: scale each row to its target, scale each
constrained column to its target, until the largest residual is ≤ 0.5 vph or
50 iterations. With zero constrained columns the result is the seed
(`method: "seed_only"`).

**Output.** `shares[d]` maps the row into L/T/R by the geometric relation of
`to` to `from`, in node bearings: with the approach leg at bearing β from the
node, through is the leg at β+180°, **left is the leg at β+90°** and right the
leg at β−90° (a northbound approach enters from the leg at 180°; its left
exit is the west leg at 270°, its right the east leg at 90°). On a T the
stem's two exits are its L and R. `leftVph[d]` is the left cell in vph. `matrix` is kept so the worksheet can print the 4×4
and a reviewer can check Σin = Σout by hand.

**Invariants** (asserted in the check script): every row sums to its
`enteringVph` ± 0.5; every constrained column sums to its target ± 0.5 after
normalization; the diagonal is 0; a T-intersection has exactly one all-zero
row and column; a one-way-in leg has an all-zero column; shares per approach
sum to 1; screening mode yields `shares` = {0.15, 0.70, 0.15} everywhere and
`leftVph = 0.10 × entering` — the two constants the renderer and timing use
today.

## 5. Server: `link-volumes.ts` and the parse route

### 5.1 CSV contract

Header row required; column order free; names case-insensitive.

| Column | Required | Values |
|---|---|---|
| `lat`, `lon` | one of {lat+lon, road+from+to} | decimal degrees, WGS84 |
| `road` | ↑ | street name as signed |
| `from`, `to` | ↑ | the two cross streets bounding the segment |
| `direction` | yes | `NB`, `SB`, `EB`, `WB`, `both` |
| `period` | yes | `am`, `pm`, `sat`, `daily` |
| `volume` | yes | non-negative number; vph for hourly periods, vpd for `daily` |
| `source` | no | free text, printed in the match summary |

Rejections carry the 1-based line number and one of: `missing_location`,
`bad_direction`, `bad_period`, `bad_volume`, `duplicate` (same location +
direction + period twice — last one wins, earlier rows rejected as duplicate).
The route returns `{ records, rejected, summary }` and never writes anything;
the client keeps `records` and sends them with the study request.

### 5.2 Snapping

For each record: candidate links = graph links whose nearest point to
(lat, lon) is within **150 m**; when `road` is given, prefer candidates whose
way name matches (case-insensitive, punctuation-stripped, `St`/`Street` etc.
normalized by the existing name-matching helper), and use `from`/`to` to pick
among same-name candidates by distance to those cross streets when `lat/lon`
is absent. Ties → nearest. The winning link's `dir` is checked against the
record's `direction`: a one-way link that cannot carry that direction rejects
the record as `direction_impossible`.

The record then lands on the link's leg at **both** adjacent junction nodes:
at the node the direction travels toward it is `enteringVph`; at the node it
travels away from it is `exitingVph`. This is how one tube count on McKnight
Road between two signals informs both worksheets.

`linkVolumeMatchSummary` on the report: `{ records, matched, unmatched:
[{ line, reason, road?, lat?, lon? }], legsFed }`. Printed in the appendix
intro when present. Presence-gated: studies without link volumes carry no
field and render byte-identically.

## 6. Row-math consumption

`buildAffectedRow` already has one branch for "a measured record attached"
(`measured.shares`, lane groups from `measured.volumes`, `utdfCycleLenS`) and
one for "nothing attached" (`approachVolumeShares`, one critical lane, default
left share). The estimate enters through the first branch as a
`MeasuredLike` record with `source: "estimate"`:

- `volShares` ← `legs[d].enteringVph / totalEnteringVph`.
- `totalVph` ← `totalEnteringVph` (network mode) — replaces `sig.totalVolume`
  as `designHourVolumeVph`.
- Lane groups ← `shares[d]` (L/T/R) exactly as `utdf.volumes` feeds them
  today; storage/lanes fields absent, so the lane-group capacity keeps OSM
  through lanes or the one-lane default — the estimate never invents a bay.
- Timing resolver ← `leftVph[d]`, so the protected-left cross product uses an
  estimated left instead of 10% of the approach.
- `volumeSource` ← `"network_estimate"` | `"link_csv"` (any leg from CSV) —
  alongside the existing `"utdf_tmc"` / `"synchro_pdf_tmc"`. A UTDF or
  Synchro record on the same junction **wins outright** (measured beats
  estimated); the estimate is not blended in.
- Screening mode leaves both branches exactly as they are.

The row carries `legVolumes` (the four `LegVolume`s) and
`movementEstimate.diagnostics` so the renderer and the intersection explorer
can print provenance without recomputing.

## 7. What the reader sees

- **Worksheet provenance line**, above the per-approach table, one of:
  - *Leg volumes: 4 of 4 from network AADT (50/50 directional assumption;
    nearest record ≤ 0.3 mi). Turning movements: balanced estimate (Furness
    /IPF, 7 iterations, residual 0.3 vph).*
  - *Leg volumes: 2 of 4 from client link counts (CSV), 2 from network
    AADT. Turning movements: balanced estimate…*
  - Screening mode prints **nothing new** — the worksheets already disclose
    the 15/70/15 split and the appendix intro the approach-share basis, and
    printing a line would break the byte-identity guarantee in §8. Legacy
    payloads likewise print nothing new.
- **Turning-movement diagrams** draw `matrix` in network mode; the 15/70/15
  caption becomes the resolved wording. Below the diagrams, the 4×4 matrix as
  a small table so the node balance is checkable by hand.
- **Appendix intro** and the **§3 methodology** paragraph: a
  `FLAT_LEG_CLAUSE` → `RESOLVED_LEG_CLAUSE` swap, the pattern
  `tisMethodologyForRegion` already uses for signal timing. The resolved
  clause states the per-leg AADT source, the 50/50 assumption, the balancing
  method with the NCHRP 255/765 lineage, and that measured counts supersede
  it at submittal.
- **`/tis` UI:** a "Leg volumes" segmented control (Network estimate /
  Screening split) beside the signal-timing one; a "Link volumes (CSV)" file
  input beside the Synchro import. The parse route's result (accepted rows /
  rejected rows with line numbers) is shown before Generate and must be
  acknowledged when any row was rejected. **Snapping happens at generate
  time** — it needs the study's road graph, which is built per region during
  the run, exactly as `utdfMatchSummary` is produced — so the matched /
  unmatched leg summary appears with the study result and in the appendix
  intro, not before Generate. The public `/demo` runs network mode with no
  CSV.
- **Intersection explorer** Lanes tab: the leg source per approach.

## 8. Guards and rollout

- `legVolumes: "screening"` + no `linkVolumes` ⇒ byte-identical output.
  Pinned: `verify-theme-default-identity` gains a screening-mode render of
  each fixture next to its default render.
- Stored payloads without the new fields render byte-identically: every new
  renderer element is presence-gated on `legVolumes` / `movementEstimate` /
  `linkVolumeMatchSummary`.
- Network mode raises junction totals at most signals (a four-leg junction's
  total becomes the sum of four legs' entering volumes rather than one road's
  two-way design hour: McKnight & Johnanna ≈ 3,400 vph vs 2,700 today). More
  LOS E/F, not fewer. The regenerated Allegheny sample is therefore
  regenerated **once more** when this ships, and the design partner gets one
  sentence saying what moved and why.
- No new external calls; no new data assets. The AADT refs and the graph are
  already in memory for every study.
- Performance: IPF on a 4×4 matrix is negligible; the per-leg nearest-AADT
  search reuses the existing `distMi` scan over volume refs (already done per
  link in `buildGraph`), so it is folded into that pass rather than repeated.

## 9. Testing

`check:leg-volumes` (`artifacts/tis-api-server/scripts/verify-leg-volumes.mjs`,
engine-core only, no DB):

1. Hand-worked balancing example reproduced: a four-leg junction with
   entering (600, 400, 300, 200) and exiting (550, 450, 280, 220) converges,
   every row and column within 0.5 vph, and the printed matrix matches the
   spreadsheet in the script header.
2. T-intersection: stem row has zero through; the absent leg's row and
   column are all-zero; shares still sum to 1 on the three present rows.
3. One-way-in leg: its column is all-zero, its row balances.
4. Missing exits on two legs: those columns unconstrained; the constrained
   two hit target; rows still hit target.
5. Imbalance > 5%: exits normalized, flag set, rows still exact.
6. Convergence bound: a pathological seed terminates at 50 iterations with a
   finite residual, never NaN.
7. Screening mode: shares = 15/70/15 and left = 10% of entering on every
   approach — the constants the renderer and timing rely on today.
8. Five-leg junction: one leg dropped, `legsDropped = 1`, no NaN.
9. Direction assignment: legs whose far ends lie N/E/S/W of the node map to
   SB/WB/NB/EB approaches respectively.

`check:link-volumes` (`verify-link-volumes.mjs`):

1. Each rejection reason fires with the right 1-based line number.
2. `daily` → hourly by the region's K; `both` → 50/50; `am` on a PM study
   converts by `PERIOD_VOLUME_FACTOR`.
3. On a fixture graph (three collinear signals on one road plus a crossing
   street), a record between signals 1 and 2 feeds signal 1's exit and
   signal 2's entry on the correct approach; `road` narrows candidates;
   `direction_impossible` fires on a one-way link.
4. `linkVolumeMatchSummary` counts agree with the records.

Identity guard: screening-mode renders pinned alongside default renders; a
legacy fixture payload renders unchanged.

End-to-end: one live demo run of the McKnight Road site after deploy; the
worksheet for McKnight & Johnanna shows the provenance line, a balanced
matrix, and a junction total in the 3,300–3,500 vph range. Documented in the
PR, not asserted here.

## 10. Rollout order

1. Engine-core module + `check:leg-volumes` (pure; mergeable alone, wired to
   nothing — the `webster-timing.ts` precedent).
2. Row-math wiring under `legVolumes` with the screening escape hatch;
   identity guard extended; renderer provenance + clause swap.
3. CSV parse route + snapping + `check:link-volumes`; `/tis` upload and
   match summary.
4. Regenerate the Allegheny sample; one line to the design partner.

Each step is its own PR; 1–2 can land before the 2026-09-30 readout, 3 with
it or after, depending on whether the design partner's CSV arrives.
