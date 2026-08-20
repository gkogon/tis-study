# Suffolk County (Long Island) coverage — design

Date: 2026-08-18
Status: approved, ready for implementation planning

## Problem

`new_york_metro` is bounded at `lonMax: -73.4`, which cuts the eastern edge
just past Nassau County. Suffolk County — ~1.5M people, the entire eastern
two-thirds of Long Island — falls outside every active region.

Verified 2026-08-18: a Hauppauge site (40.8176, -73.0776) returns

```
{"error":"Coordinates (40.8176, -73.0776) fall outside our 300 covered metros.
Try a different site, or see /cities for the full list."}
```

from `POST https://simpleimpactstudies.com/tis-api/demo/generate`. Nassau
(40.7684, -73.5251) is inside the box and works.

This is commercially load-bearing: the NY prospect corpus explicitly includes
Long Island firms (`private/NY-WAVE2-NYC-LI.md`, `private/ny-prospects.xlsx`),
and those prospects cannot currently be shown a study in their own county.
PR #100 (2026-08-18) shipped six hosted NY county samples — Westchester,
Nassau, Monroe, Erie, Onondaga, Albany — and had to skip Suffolk for exactly
this reason.

Same class of gap as Sarasota (#86), Greenville SC (#90), and the Atlanta MSA
29-county fix (#99).

## Audit findings

These drove the design and are recorded here so the implementation does not
re-derive them.

### 1. The signal inventory is clipped to the bbox

`artifacts/api-server/src/data/new-york-signals.json` holds 30,601 signals with
extent **lat 40.2006–41.2000, lon -74.5000 to -73.4002** — the bounding box, to
four decimals. **Zero signals east of -73.4.**

Consequence: widening the box alone reproduces the Atlanta #99 failure mode.
Suffolk would resolve to `new_york_metro`, find no signals, and drop onto the
15-mile nearest-N fallback using Nassau signals 20+ miles away. That is a
*worse* answer than today's honest "not covered". The inventory must be
extended, not just the rectangle.

### 2. NYSDOT AADT in Suffolk is real and dense

Queried live against `Roadways/Traffic_Monitoring/FeatureServer/1` — the same
layer `fetch-aadt-by-signal.ts` already uses for `new-york`:

| Area | AADT segments |
| --- | --- |
| Nassau (baseline — yields 98.1% snap in production) | 12,804 |
| W Suffolk (Huntington / Babylon / Islip) | 7,487 |
| C Suffolk (Brookhaven / Smithtown) | 2,659 |
| East End (Riverhead → Montauk) | 520 |

Within ~2 km of the reported Hauppauge coordinate: **176 segments**, years
2014–2019, on named Suffolk roads — Veterans Memorial Hwy, CR97 Nicolls Rd,
CR19 Patchogue-Holbrook Rd. County roads are present, not just state routes.

The existing snap rate inside the current box corroborates the layer's density:
98.1% across Nassau (3,657 signals), 97.3% in the easternmost 0.1° strip.

Blocker to clear: `scripts/src/fetch-aadt-by-signal.ts:680` hardcodes the NY
pull bbox at `lonMax: -73.4`, so the fetch is clipped identically to the region.

### 3. OSM signal density falls off sharply east of Riverhead

| Longitude band | Signals |
| --- | --- |
| -73.42 → -73.00 (Huntington / Babylon / Islip / Smithtown) | 2,604 |
| -73.00 → -72.60 (Brookhaven) | 636 |
| -72.60 → -72.30 (Riverhead) | 116 |
| -72.30 → -71.85 (East End / Montauk) | 23 |
| **Total** | **3,379** |

The East End's 23 signals are a genuine property of the built environment —
the forks are low-density and largely unsignalized — not a data gap. Coverage
extends there anyway (decision below), with the caveat recorded in §Risks.

### 4. One rectangle cannot describe this

Extending `lonMax` past -73.4 while `latMax` is 41.2 swallows Bridgeport,
Stratford, Milford, New Haven and the entire Connecticut shoreline.
`bridgeport_metro`'s smaller box wins where it overlaps, but New Haven,
Milford, Branford and Guilford would be claimed by `new_york_metro` with zero
inventory — the same defect pointed the other way.

This requires `coverageBoxes`, the mechanism added for the 29-county Atlanta
MSA in #99 and already present in `regions.ts`.

## Decision: widen `new_york_metro`, do not create a separate region

Rejected alternative: a separate `long_island_metro` / `nassau_suffolk` region.
Four reasons.

1. **It would split one MSA across two codes.** Nassau *and* Suffolk are both
   in the New York-Newark-Jersey City MSA (Nassau County-Suffolk County is a
   metro *division* within it). A separate region makes `displayName` a
   misstatement on every Suffolk report.
2. **It would steal Nassau from a working inventory.** Nassau resolves to
   `new_york_metro` today at 98.1% AADT snap. `regionForCoordinate` resolves
   smaller boxes first, so a new LI region would take Nassau away from the
   inventory that currently serves it correctly.
3. **It would regress the PDF.** `pdf-export-ny.ts:193` already emits
   "Region 10 — Long Island" for NYSDOT region labeling, gated on
   `code === "new_york_metro"`. A new region code falls through to
   `{ num: 0, label: "NYSDOT Region (to be confirmed)" }`.
4. **The plumbing is slug-keyed.** Inventory (`new-york-*.json`), calibration
   baseline, and `ny-growth-rates.json` are all keyed to `new-york`. A separate
   region needs a parallel set of every one.

CEQR is unaffected either way — the overlay is gated on the CBDTP cordon
(`getCbdtpStatus`), not on the region.

## Geometry

Three coverage boxes. **Box A is the current box, unchanged** — every
coordinate that resolves today keeps resolving identically.

| Box | latMin | latMax | lonMin | lonMax | Covers |
| --- | --- | --- | --- | --- | --- |
| A (unchanged) | 40.20 | 41.20 | -74.50 | -73.40 | NYC, NJ side, Nassau, lower Westchester |
| B (new) | 40.57 | 41.00 | -73.42 | -72.60 | Huntington, Babylon, Islip, Smithtown, Brookhaven, Riverhead |
| C (new) | 40.78 | 41.20 | -72.65 | -71.85 | North Fork to Orient Point, South Fork to Montauk, Shelter Island |

`bounds` becomes the envelope `{ latMin: 40.2, latMax: 41.2, lonMin: -74.5,
lonMax: -71.85 }`, used only for centroid math
(`nearestRegionForCoordinate`, the api-server zone labeler).

### Why these edges

- **Box B `latMax` 41.00** clears Port Jefferson (40.947) and Wading River
  (40.95) while staying south of Bridgeport (41.179) and Milford (41.222).
- **Box C `latMax` 41.20** is the tight constraint: Orient Point is 41.163,
  Old Saybrook CT is 41.291. That 0.13° gap is what keeps the Connecticut
  shoreline out.
- **Box C `lonMax` -71.85** reaches Montauk Point (41.071, -71.857) and stops
  short of Block Island RI (-71.578) and Westerly RI (-71.828).
- **Seams overlap rather than abut.** A/B overlap 0.02° at ~-73.4, B/C overlap
  0.05° at ~-72.6. Harmless — all three boxes belong to the same region, so
  union membership is unaffected, and overlapping avoids a sliver gap at the
  boundary. Note this means summed area double-counts those slivers slightly;
  the 1.7886 deg² figure is therefore a mild over-estimate, which is the
  conservative direction for precedence.

### Deliberate exclusion: Fishers Island

Fishers Island (41.271, -72.021) is legally part of Southold, Suffolk County,
but sits north of box C's `latMax`. Reaching it would narrow the margin against
Stonington CT (41.336) to 0.04°. It has ~230 residents and zero traffic
signals. Excluded on purpose; recorded as an assertion in the verify script so
the choice is visible rather than accidental.

### Precedence impact

Summed box area goes **1.1000 → 1.7886 deg²**. Larger is the safe direction:
`regionForCoordinate` prefers the smallest area, so a bigger `new_york_metro`
can only lose more contests, never steal one.

Verified computationally against all active regions:

- The only active region overlapping box A is `bridgeport_metro` (0.1800 deg²).
  It wins today and still wins — unchanged.
- No active region has an area between 1.1000 and 1.7886 overlapping box A, so
  **nothing flips**.
- Boxes B and C overlap **no** active region. Suffolk is unclaimed territory.

### Membership assertions

All 20 Suffolk/Nassau targets fall in a box: Hauppauge (the reported
coordinate), Huntington, Babylon, Islip, Smithtown, Patchogue, Stony Brook,
Port Jefferson, Riverhead, Westhampton, Southampton, East Hampton, Montauk,
Montauk Point, Greenport, Orient Point, Shelter Island, Mattituck, Hempstead,
Hicksville.

All 18 out-of-region controls fall in no box: Bridgeport, Stratford, Milford,
New Haven, Branford, Guilford, Madison, Clinton, Old Saybrook, Old Lyme,
Niantic, New London, Groton, Stonington CT; Watch Hill, Westerly, Block Island
RI; Fishers Island NY.

Norwalk CT (41.118, -73.408) is inside box A — as it is today — and resolves to
`bridgeport_metro` on smaller-bbox-wins. Asserted as *resolves to bridgeport*,
not as *outside every box*.

## Implementation phases

### Phase 1 — Region geometry

- `artifacts/tis-api-server/src/lib/regions.ts`: `new_york_metro` gains
  `coverageBoxes: [A, B, C]`; `bounds` widened to the envelope. Comment block
  updated to explain the CT-exclusion constraint and the Fishers Island call.
- `artifacts/api-server/src/lib/regional-intersections.ts:188`: mirror the new
  bounds in `REGION_INFO`.

### Phase 2 — Inventory extension (append-only)

- `scripts/src/extend-region-coverage.ts`:
  - add `"new-york": ["new_york_metro"]` to `STATE_TARGETS`;
  - filter on `coverageBoxes` when present, falling back to `bounds`. Without
    this the envelope pulls in Long Island Sound and the CT-adjacent water.
- Run it. Appends Suffolk signals + named ways from the Geofabrik NY PBF.

  **Append-only invariant.** Existing 30,601 signal tuples keep their index and
  id, because `new-york-aadt.json` is keyed by signal tuple id, not by array
  position.

  The id space is already **mixed**, and the implementation must not assume
  otherwise:

  - indices 0…24,003 carry sequential ids `0…24003` — the original NY-only
    Geofabrik extraction;
  - indices 24,004…30,600 carry 6,597 **real OSM node ids**
    (33,978,231 … 14,055,470,957) — appended by the New Jersey pass in PR #82.

  Verified: no duplicate ids, and no OSM-id tuple falls inside the sequential
  `0…30600` space. Of the 25,130 AADT keys, 1,665 are OSM-id-keyed (matching the
  1,666 `njdot`-sourced records; 23,464 are `nysdot`).

  Suffolk signals therefore append from index 30,601 on with real OSM node ids,
  landing in the *same* id space as the PR #82 block. Collision risk is against
  that block, not the sequential one — the script's 15 m spatial match prevents
  re-appending a node that is already present, and its collision guard bumps any
  id that would still clash. Verified after the run by byte-comparing the first
  30,601 tuples against HEAD.

- `scripts/src/fetch-aadt-by-signal.ts:680`: widen the `new-york` pull bbox
  `lonMax` from -73.4 to -71.85.
- Run `--supplement-only new-york` to snap NYSDOT AADT onto the appended
  signals. Appends new keys only; no existing key rewritten.

### Phase 3 — Calibration

Re-run audit → calibrate → synth → measure, as Sarasota (#86) and Greenville
(#90) did. Expect the `new_york_metro` baseline to shift as measured *n* grows.
Report the resulting region and global KNN accuracy; do not predict them.

### Phase 4 — NYSDOT region labeling

`pdf-export-ny.ts` `nysdotRegion()` currently tests `lon > -73.83` for
"Region 10 — Long Island". The Queens/Nassau line is ≈ -73.70 (north, Elmont /
Floral Park) jogging to ≈ -73.74 (south), so eastern Queens — Jamaica, Queens
Village, Rosedale — is currently mislabeled Region 10 when NYSDOT puts it in
Region 11. Pre-existing bug in the function this work already touches; fixed
here per explicit decision, with assertions on both sides of the line.

### Phase 5 — Verification

- New `artifacts/tis-api-server/scripts/verify-long-island-coverage.mjs` +
  `check:long-island-coverage` in `package.json`, modeled on
  `verify-atlanta-msa-coverage.mjs`. Asserts the membership table above, the
  Norwalk-resolves-to-bridgeport case, the Fishers Island exclusion, the
  Queens/Nassau region-label line, and that Suffolk sites yield studied
  intersections from real signals rather than nearest-N.
- Suffolk probes added to `scripts/src/smoke-test-multi-region.ts`.
- `artifacts/atlanta-tis/src/data/metro-coverage.ts:249`: update
  `signals` / `namedPct` / `aadtPct` to the measured post-append values.

### Phase 6 — Suffolk county sample

Generate `artifacts/atlanta-tis/public/samples/suffolk-county.pdf` via
`scripts/src/render-county-sample.ts`, matching PR #100's parameters (LU 820
shopping center, 85 ksf, opening year 2027, full tier) with the study radius
tuned to land in the 8–20 studied-intersection band the other samples use.
Completes the NY sample set that #100 had to leave incomplete.

Separable: phases 1–5 stand alone if this needs to ship independently.

## Risks and open items

- **AADT snap rate is unmeasured.** Segment density predicts high — somewhere
  between Greenville's 70.8% and Nassau's 98.1% — but the PR must report the
  measured number, not the estimate.
- **East End study quality.** 23 signals across the forks means Montauk and
  Southampton sites lean on unsignalized junctions and, at some radii, the
  nearest-N path. That reflects the real network, but sample PDFs from the
  East End will read thinner than a Hauppauge one. If a fork site cannot
  produce a defensible study, say so in the PR rather than shipping a thin
  sample.
- **The append may add more than Suffolk.** `extend-region-coverage.ts` appends
  any NY signal not spatially matched within 15 m, so OSM nodes added inside
  box A since the original extraction will come along. Strictly additive and
  correct, but the signal-count delta will exceed the ~3,379 Suffolk figure and
  the PR should not present the difference as Suffolk coverage.
- **Growth rates.** `ny-growth-rates.json` already keys "New York City + Long
  Island + Hudson Valley" together, so no new wire is expected. Confirm during
  implementation rather than assuming.

## Verification before claiming done

- `pnpm run check:long-island-coverage` passes.
- `smoke-test-multi-region` passes at its full count, with the Suffolk probes
  added and **no other region's resolution moved**.
- Typecheck clean: `tis-api-server`, `api-server`, `atlanta-tis`.
- Existing checks pass: `check:coverage-warning`, `check:name-dedup`,
  `check:force-include`, `check:driveways`, `check:trip-loading`,
  `check:state-dispatch`.
- Append-only confirmed by byte-comparison against HEAD.
- Post-merge: a Suffolk coordinate returns a real study from
  `POST /tis-api/demo/generate`, and `/samples/suffolk-county.pdf` serves
  `content-type: application/pdf` — a missing file returns HTTP 200 with the
  SPA shell, not a 404, so checking the status code alone is not sufficient.
