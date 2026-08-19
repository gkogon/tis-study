# Suffolk County (Long Island) Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Suffolk County coordinates return a real traffic study from `POST /tis-api/demo/generate`, backed by an actual signal and AADT inventory rather than a widened bounding box.

**Architecture:** `new_york_metro` gains three `coverageBoxes` — the current box unchanged, plus two that hug Long Island's shape so the Connecticut shoreline stays out. The signal/road inventory is then extended from the Geofabrik New York PBF (append-only, because `new-york-aadt.json` is keyed by signal tuple id), and NYSDOT AADT is snapped onto the new signals through the existing `supplement: true` path that never rewrites an existing record.

**Tech Stack:** TypeScript (ESM, `tsx`), pnpm workspaces, `osmium` for PBF extraction, ArcGIS FeatureServer REST for NYSDOT AADT, PDFKit for report rendering.

**Spec:** `docs/superpowers/specs/2026-08-18-suffolk-county-coverage-design.md`

## Global Constraints

- **Append-only inventory.** `new-york-signals.json` and `new-york-aadt.json` are keyed by signal tuple id, not array position. Existing tuples keep their index and id. Never reorder, renumber, or rebuild them.
- **The id space is already mixed.** Indices 0…24,003 carry sequential ids `0…24003`; indices 24,004…30,600 carry real OSM node ids (33,978,231 … 14,055,470,957) from the PR #82 New Jersey append. Do not assume sequential ids anywhere.
- **Never run the primary `new-york` AADT config.** It is a full rebuild and would drop the 1,666 `njdot` records. Only `--supplement-only` runs are permitted against `new-york`.
- **Box A is frozen:** `{ latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -73.4 }`. Any change means a coordinate that resolves today moves, which this work must not do.
- **Stage explicit paths.** Never `git add -A` — the worktree carries untracked `.claude-flow/`, `ruvector.db`, and `agentdb.rvf` junk.
- **Branch from `origin/main`.** The local `main` checkout is a known junk drawer.
- **Repo test idiom:** there is no vitest/jest and no `*.test.ts`. Tests are `verify-*.mjs` scripts under `artifacts/tis-api-server/scripts/`, run via `pnpm run check:*`. Follow that pattern; do not introduce a test framework.
- **Report measured numbers, never predicted ones.** Snap rates, signal counts, and accuracy figures go in the PR body only after the pipeline has produced them.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `artifacts/tis-api-server/scripts/verify-long-island-coverage.mjs` | **Create.** The test. Asserts membership, exclusions, precedence, registry invariants, NYSDOT region labeling. | 1, 6 |
| `artifacts/tis-api-server/package.json` | **Modify.** Register `check:long-island-coverage`. | 1 |
| `artifacts/tis-api-server/src/lib/regions.ts` | **Modify.** `new_york_metro` coverage boxes + envelope. | 1 |
| `artifacts/api-server/src/lib/regional-intersections.ts:188` | **Modify.** Mirror the envelope into `REGION_INFO`. | 1 |
| `scripts/src/extend-region-coverage.ts` | **Modify.** Filter on `coverageBoxes` when present; add the `new-york` target. | 2 |
| `artifacts/api-server/src/data/new-york-signals.json` | **Modify (append).** Suffolk signals. | 3 |
| `artifacts/api-server/src/data/new-york-roads.json` | **Modify (append).** Suffolk named ways. | 3 |
| `scripts/src/fetch-aadt-by-signal.ts` | **Modify.** Widen two NY bboxes. | 4 |
| `artifacts/api-server/src/data/new-york-aadt.json` | **Modify (append).** NYSDOT records for the new signals. | 4 |
| `artifacts/tis-api-server/src/lib/pdf-export-ny.ts` | **Modify.** Queens/Nassau region-label line. | 6 |
| `artifacts/atlanta-tis/src/data/metro-coverage.ts:249` | **Modify.** Measured counts. | 7 |
| `scripts/src/smoke-test-multi-region.ts` | **Modify.** Suffolk probes. | 7 |
| `artifacts/atlanta-tis/public/samples/suffolk-county.pdf` | **Create.** Hosted sample. | 8 |

---

## Task 0: Prerequisites

**Files:** none modified.

- [ ] **Step 1: Install dependencies**

The worktree has no `node_modules`. Nothing else in this plan runs without it.

```bash
pnpm install
```

Expected: completes without error; `scripts/node_modules/.bin/tsx` exists afterward.

- [ ] **Step 2: Confirm osmium is present**

```bash
osmium --version
```

Expected: a version banner. If missing: `brew install osmium-tool`.

- [ ] **Step 3: Confirm the branch is based on origin/main**

```bash
git fetch origin main && git log --oneline -1 origin/main
```

Expected: `88e33a7 Add New York county samples: Westchester, Nassau, Monroe, Erie, Onondaga, Albany (#100)` or later. If the branch is behind, `git merge --ff-only origin/main`.

---

## Task 1: Region geometry

**Files:**
- Create: `artifacts/tis-api-server/scripts/verify-long-island-coverage.mjs`
- Modify: `artifacts/tis-api-server/package.json` (scripts block)
- Modify: `artifacts/tis-api-server/src/lib/regions.ts` (`new_york_metro` entry, ~line 962)
- Modify: `artifacts/api-server/src/lib/regional-intersections.ts:188`

**Interfaces:**
- Consumes: `regionForCoordinate(lat, lon)` and the `REGIONS` record from `regions.ts`; `Region.coverageBoxes?: LatLonBox[]` (already declared, added in PR #99).
- Produces: `new_york_metro.coverageBoxes` — a 3-element `LatLonBox[]` — consumed by Task 2's inventory filter and Task 5's verification.

- [ ] **Step 1: Write the failing test**

Create `artifacts/tis-api-server/scripts/verify-long-island-coverage.mjs`:

```javascript
/**
 * Verify that `new_york_metro` covers Nassau AND Suffolk — the full Long
 * Island half of the New York-Newark-Jersey City MSA — and that it does NOT
 * claim the Connecticut or Rhode Island shoreline across Long Island Sound.
 *
 * The region was one 40.2-41.2 / -74.5..-73.4 box, which stopped just past
 * Nassau. Suffolk (~1.5M people, the eastern two-thirds of the island) fell
 * outside every active region, so a Hauppauge site returned "outside our 300
 * covered metros" while Nassau, one county west, worked. PR #100 shipped six
 * hosted NY county samples and had to skip Suffolk for this reason.
 *
 * The fix is a union of rectangles rather than one wider box, because a box
 * wide enough for Montauk (-71.85) at latMax 41.2 also swallows Bridgeport,
 * Milford and New Haven — each a DIFFERENT metro, and claiming those with an
 * inventory that has no CT signals is the same defect pointed the other way.
 * So this script asserts both directions.
 *
 * Run:  pnpm run check:long-island-coverage
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { register } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
// regions.ts imports ./state-boundaries without an extension (tsc bundler
// mode), which plain node won't resolve.
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { regionForCoordinate, REGIONS } =
  await import(path.resolve(here, "../src/lib/regions.ts"));

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };

const NY = REGIONS["new_york_metro"];

// ── Suffolk + Nassau must resolve to new_york_metro ───────────────────────
// Hauppauge is the coordinate reported as broken on 2026-08-18.
const COVERED = [
  ["Hauppauge (reported)", 40.8176, -73.0776],
  ["Huntington",           40.8681, -73.4257],
  ["Babylon",              40.6957, -73.3257],
  ["Islip",                40.7298, -73.2104],
  ["Smithtown",            40.8559, -73.2007],
  ["Patchogue",            40.7657, -73.0151],
  ["Stony Brook",          40.9257, -73.1409],
  ["Port Jefferson",       40.9470, -73.0698],
  ["Riverhead",            40.9170, -72.6620],
  ["Westhampton",          40.8243, -72.6432],
  ["Southampton",          40.8843, -72.3898],
  ["East Hampton",         40.9634, -72.1848],
  ["Montauk",              41.0359, -71.9445],
  ["Montauk Point",        41.0712, -71.8573],
  ["Greenport",            41.1032, -72.3620],
  ["Orient Point",         41.1631, -72.2384],
  ["Shelter Island",       41.0690, -72.3454],
  ["Mattituck",            40.9931, -72.5342],
  ["Nassau: Hempstead",    40.7062, -73.6187],
  ["Nassau: Hicksville",   40.7684, -73.5251],
];

console.log("── Long Island coverage ──");
for (const [name, lat, lon] of COVERED) {
  const r = regionForCoordinate(lat, lon);
  ok(r?.code === "new_york_metro", `${name} (${lat}, ${lon}) → new_york_metro (got ${r?.code ?? "null"})`);
}

// ── Across the Sound: must NOT be claimed by new_york_metro ───────────────
// Every one of these is in a different metro or no metro at all. Claiming
// them would put a CT/RI site on an inventory with zero CT/RI signals.
const NOT_COVERED = [
  ["Bridgeport CT",    41.1792, -73.1894],
  ["Stratford CT",     41.1845, -73.1332],
  ["Milford CT",       41.2223, -73.0565],
  ["New Haven CT",     41.3083, -72.9279],
  ["Branford CT",      41.2793, -72.8151],
  ["Guilford CT",      41.2890, -72.6817],
  ["Madison CT",       41.2793, -72.5987],
  ["Clinton CT",       41.2784, -72.5276],
  ["Old Saybrook CT",  41.2915, -72.3762],
  ["Old Lyme CT",      41.3159, -72.3395],
  ["Niantic CT",       41.3251, -72.1926],
  ["New London CT",    41.3557, -72.0995],
  ["Groton CT",        41.3501, -72.0784],
  ["Stonington CT",    41.3357, -71.9051],
  ["Watch Hill RI",    41.3098, -71.8584],
  ["Westerly RI",      41.3776, -71.8273],
  ["Block Island RI",  41.1719, -71.5781],
];

console.log("\n── Across Long Island Sound (must not be new_york_metro) ──");
for (const [name, lat, lon] of NOT_COVERED) {
  const r = regionForCoordinate(lat, lon);
  ok(r?.code !== "new_york_metro", `${name} (${lat}, ${lon}) is NOT new_york_metro (got ${r?.code ?? "null"})`);
}

// ── Deliberate exclusion: Fishers Island ──────────────────────────────────
// Legally part of Southold, Suffolk County, but it sits at 41.271 — north of
// box C's latMax. Reaching it would narrow the margin against Stonington CT
// (41.336) to 0.04 deg. ~230 residents, zero traffic signals. Excluded on
// purpose; asserted so the choice stays visible rather than accidental.
console.log("\n── Deliberate exclusions ──");
{
  const r = regionForCoordinate(41.2712, -72.0212);
  ok(r?.code !== "new_york_metro", `Fishers Island NY is deliberately excluded (got ${r?.code ?? "null"})`);
}

// ── Precedence must not move ──────────────────────────────────────────────
// Norwalk sits inside box A (unchanged) and resolves to bridgeport_metro on
// smallest-bbox-wins. Widening new_york_metro's summed area can only make it
// lose more contests, never steal one — this pins that.
console.log("\n── Precedence (unchanged behavior) ──");
{
  const r = regionForCoordinate(41.1177, -73.4082);
  ok(r?.code === "bridgeport_metro", `Norwalk CT still resolves to bridgeport_metro (got ${r?.code ?? "null"})`);
}
for (const [name, lat, lon] of [
  ["Manhattan",   40.7128, -74.0060],
  ["Newark NJ",   40.7357, -74.1724],
  ["White Plains",41.0340, -73.7629],
]) {
  const r = regionForCoordinate(lat, lon);
  ok(r?.code === "new_york_metro", `${name} still resolves to new_york_metro (got ${r?.code ?? "null"})`);
}

// ── Registry invariants ───────────────────────────────────────────────────
console.log("\n── Registry invariants ──");
const boxes = NY.coverageBoxes ?? [];
ok(boxes.length === 3, `new_york_metro declares 3 coverage boxes (got ${boxes.length})`);
const env = NY.bounds;
ok(
  boxes.every(
    (b) =>
      b.latMin >= env.latMin && b.latMax <= env.latMax &&
      b.lonMin >= env.lonMin && b.lonMax <= env.lonMax,
  ),
  "every coverage box sits inside the declared envelope bounds",
);
const boxA = boxes[0];
ok(
  boxA.latMin === 40.2 && boxA.latMax === 41.2 && boxA.lonMin === -74.5 && boxA.lonMax === -73.4,
  "box A is byte-identical to the pre-Suffolk bounds (no covered coordinate moves)",
);
const area = boxes.reduce((s, b) => s + (b.latMax - b.latMin) * (b.lonMax - b.lonMin), 0);
// Must stay ABOVE bridgeport_metro's 0.18 deg² so Stamford/Norwalk keep their
// own inventory, and the growth from 1.10 must not cross any active region
// that new_york_metro currently beats.
const bpt = REGIONS["bridgeport_metro"].bounds;
const bptArea = (bpt.latMax - bpt.latMin) * (bpt.lonMax - bpt.lonMin);
ok(area > bptArea, `summed area ${area.toFixed(4)} deg² yields to bridgeport_metro (${bptArea.toFixed(4)})`);

// No active region may sit in the gap between the OLD area (1.10) and the new
// summed area while overlapping box A — such a region would newly outrank
// new_york_metro and silently move coordinates that resolve today.
const OLD_AREA = 1.10;
const overlaps = (x, y) =>
  x.latMin < y.latMax && x.latMax > y.latMin && x.lonMin < y.lonMax && x.lonMax > y.lonMin;
const flipped = Object.values(REGIONS).filter((r) => {
  if (!r.active || r.code === "new_york_metro") return false;
  const rb = r.coverageBoxes ?? [r.bounds];
  if (!rb.some((b) => overlaps(boxA, b))) return false;
  const a = rb.reduce((s, b) => s + (b.latMax - b.latMin) * (b.lonMax - b.lonMin), 0);
  return a > OLD_AREA && a < area;
});
ok(flipped.length === 0, `no region flips precedence over box A (candidates: ${flipped.map((r) => r.code).join(", ") || "none"})`);

console.log(fails === 0 ? "\nAll Long Island coverage checks passed." : `\n${fails} check(s) failed.`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Register the check**

In `artifacts/tis-api-server/package.json`, add after the `check:atlanta-msa-coverage` line:

```json
    "check:long-island-coverage": "node ./scripts/verify-long-island-coverage.mjs",
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
pnpm --filter @workspace/tis-api-server run check:long-island-coverage
```

Expected: FAIL. All 18 Suffolk coordinates report `→ new_york_metro (got null)`, and `new_york_metro declares 3 coverage boxes (got 0)`. Nassau, Manhattan, Newark, White Plains and every CT/RI control should already PASS — if any of those fails, stop: the harness is wrong, not the region.

- [ ] **Step 4: Add the coverage boxes**

In `artifacts/tis-api-server/src/lib/regions.ts`, replace the `bounds:` line of the `new_york_metro` entry (~line 974) and the comment block above it with:

```typescript
    // Envelope of `coverageBoxes` below. The old single box (40.2–41.2 /
    // -74.5..-73.4) stopped just past Nassau, so Suffolk County — ~1.5M
    // people, the eastern two-thirds of Long Island — fell outside every
    // active region and returned "outside our 300 covered metros".
    //
    // lonMin -74.5 abuts trenton_metro's lonMax exactly (no overlap). The
    // CT corner (Stamford/Norwalk) falls in box A, but regionForCoordinate
    // resolves it to bridgeport_metro (smaller summed area wins), whose
    // inventory carries the CT signals.
    bounds: { latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -71.85 },
    // Long Island as a union of rectangles. One box cannot describe this:
    // a rectangle wide enough for Montauk (-71.85) at latMax 41.2 also
    // swallows Bridgeport (41.179), Milford (41.222) and New Haven (41.308)
    // across the Sound. Boxes B and C hug the island's latitude range
    // instead, which excludes the Connecticut shoreline geometrically.
    // Negative controls are asserted in scripts/verify-long-island-coverage.mjs.
    coverageBoxes: [
      // A — NYC, the NJ side, Nassau, lower Westchester. Byte-identical to
      // the pre-Suffolk bounds so no coordinate that resolves today moves.
      { latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -73.4 },
      // B — western + central Suffolk: Huntington, Babylon, Islip,
      // Smithtown, Brookhaven, Riverhead. latMax 41.00 clears Port
      // Jefferson (40.947) while staying south of Bridgeport (41.179).
      { latMin: 40.57, latMax: 41.00, lonMin: -73.42, lonMax: -72.60 },
      // C — the forks: North Fork to Orient Point, South Fork to Montauk,
      // Shelter Island. latMax 41.20 is the tight constraint — Orient Point
      // is 41.163, Old Saybrook CT is 41.291. That 0.13° gap is what keeps
      // the CT shoreline out. It also excludes Fishers Island (41.271),
      // legally Southold but ~230 residents and zero signals; reaching it
      // would narrow the margin against Stonington CT (41.336) to 0.04°.
      { latMin: 40.78, latMax: 41.20, lonMin: -72.65, lonMax: -71.85 },
    ],
```

- [ ] **Step 5: Mirror the envelope into REGION_INFO**

In `artifacts/api-server/src/lib/regional-intersections.ts:188`, replace:

```typescript
  new_york_metro: { displayName: "New York-Newark-Jersey City MSA", bounds: { latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -73.4 } },
```

with:

```typescript
  // bounds is the ENVELOPE of new_york_metro's three coverage boxes (see
  // regions.ts) — used here only for zone labeling, not for membership.
  new_york_metro: { displayName: "New York-Newark-Jersey City MSA", bounds: { latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -71.85 } },
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm --filter @workspace/tis-api-server run check:long-island-coverage
```

Expected: PASS on every line, ending `All Long Island coverage checks passed.`

- [ ] **Step 7: Typecheck**

```bash
pnpm run typecheck
```

Expected: clean across `tis-api-server`, `api-server`, `atlanta-tis`, `scripts`.

- [ ] **Step 8: Commit**

```bash
git add artifacts/tis-api-server/src/lib/regions.ts \
        artifacts/tis-api-server/scripts/verify-long-island-coverage.mjs \
        artifacts/tis-api-server/package.json \
        artifacts/api-server/src/lib/regional-intersections.ts
git commit -m "new_york_metro: coverage boxes for Nassau + Suffolk"
```

---

## Task 2: Make the inventory extender coverage-box aware

**Files:**
- Modify: `scripts/src/extend-region-coverage.ts` (`STATE_TARGETS` ~line 51; helpers ~line 139-152; `appendSignals` ~line 229; `appendRoads` ~line 268, 301)

**Interfaces:**
- Consumes: `new_york_metro.coverageBoxes` from Task 1.
- Produces: `metroBoxes(code): Bounds[]`, `inAnyBbox(lat, lon, boxes): boolean`, `lineIntersectsAnyBbox(coords, boxes): boolean` — used by both append passes.

**Why:** the script filters PBF features on `REGIONS[metro].bounds`. After Task 1 that is the *envelope*, which spans Long Island Sound and the CT-adjacent water. Filtering on the envelope would append any NY node in that water and, more importantly, would misrepresent what the region claims. It must filter on the union, exactly as `regionForCoordinate` does.

- [ ] **Step 1: Add the box helpers**

In `scripts/src/extend-region-coverage.ts`, immediately after `lineIntersectsBbox` (~line 152), add:

```typescript
/**
 * Membership boxes for a metro: the coverage union when declared, else the
 * single bbox. Mirrors regionForCoordinate — a region with coverageBoxes has
 * a `bounds` that is only the envelope, and the envelope must not decide
 * what gets appended (new_york_metro's spans Long Island Sound).
 */
function metroBoxes(metro: RegionCode): Bounds[] {
  const r = REGIONS[metro]!;
  return r.coverageBoxes ?? [r.bounds];
}

function inAnyBbox(lat: number, lon: number, boxes: Bounds[]): boolean {
  return boxes.some((b) => inBbox(lat, lon, b));
}

function lineIntersectsAnyBbox(coords: number[][], boxes: Bounds[]): boolean {
  return boxes.some((b) => lineIntersectsBbox(coords, b));
}
```

- [ ] **Step 2: Switch appendSignals to the union**

In `appendSignals` (~line 229), replace:

```typescript
  const b = REGIONS[metro]!.bounds;
```

with:

```typescript
  const boxes = metroBoxes(metro);
```

and (~line 238) replace:

```typescript
    if (!inBbox(lat, lon, b)) continue;
```

with:

```typescript
    if (!inAnyBbox(lat, lon, boxes)) continue;
```

- [ ] **Step 3: Switch appendRoads to the union**

In `appendRoads` (~line 268), replace:

```typescript
  const b = REGIONS[metro]!.bounds;
```

with:

```typescript
  const boxes = metroBoxes(metro);
```

and (~line 301) replace:

```typescript
      if (!lineIntersectsBbox(g, b)) continue;
```

with:

```typescript
      if (!lineIntersectsAnyBbox(g, boxes)) continue;
```

- [ ] **Step 4: Add the New York target**

Replace the `STATE_TARGETS` block (~line 51):

```typescript
/** Which state PBFs fill which metros' missing side. */
const STATE_TARGETS: Record<string, RegionCode[]> = {
  "new-jersey": ["new_york_metro", "philadelphia_metro"],
  virginia: ["washington_dc_metro"],
  maryland: ["washington_dc_metro"],
};
```

with:

```typescript
/**
 * Which state PBFs fill which metros' missing side.
 *
 * "new-york" was added 2026-08-18 for Suffolk County: the 2026-05 extraction
 * clipped new-york-signals.json to the then-current bbox (extent matched it
 * to four decimals, zero signals east of -73.4), so the Suffolk coverage
 * boxes added in regions.ts would otherwise claim territory with no
 * inventory — dropping every Suffolk site onto the 15-mile nearest-N
 * fallback, a WORSE answer than the honest "not covered" it replaced.
 */
const STATE_TARGETS: Record<string, RegionCode[]> = {
  "new-jersey": ["new_york_metro", "philadelphia_metro"],
  virginia: ["washington_dc_metro"],
  maryland: ["washington_dc_metro"],
  "new-york": ["new_york_metro"],
};
```

- [ ] **Step 5: Verify the filter change with a dry assertion**

Confirm the union filter accepts Suffolk and rejects Sound water. Run:

```bash
cd scripts && npx tsx -e '
import { REGIONS } from "../artifacts/tis-api-server/src/lib/regions";
const r = REGIONS["new_york_metro"];
const boxes = r.coverageBoxes ?? [r.bounds];
const inAny = (la: number, lo: number) => boxes.some(b => la>=b.latMin&&la<=b.latMax&&lo>=b.lonMin&&lo<=b.lonMax);
const env = r.bounds;
const inEnv = (la: number, lo: number) => la>=env.latMin&&la<=env.latMax&&lo>=env.lonMin&&lo<=env.lonMax;
for (const [n,la,lo] of [["Hauppauge",40.8176,-73.0776],["Montauk",41.0359,-71.9445],["Sound mid-water",41.1,-73.0],["Milford CT",41.2223,-73.0565]] as [string,number,number][]) {
  console.log(n.padEnd(18), "union:", inAny(la,lo), " envelope:", inEnv(la,lo));
}'
```

Expected: Hauppauge and Montauk `union: true`; Sound mid-water and Milford CT `union: false, envelope: true` — proving the union filter is doing work the envelope would not.

- [ ] **Step 6: Typecheck**

```bash
pnpm run typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add scripts/src/extend-region-coverage.ts
git commit -m "extend-region-coverage: filter on coverageBoxes, add new-york target"
```

---

## Task 3: Append the Suffolk signal + road inventory

**Files:**
- Modify (append): `artifacts/api-server/src/data/new-york-signals.json`
- Modify (append): `artifacts/api-server/src/data/new-york-roads.json`

**Interfaces:**
- Consumes: Task 2's `STATE_TARGETS` entry and union filter.
- Produces: signal tuples at indices ≥ 30,601 carrying real OSM node ids, consumed by Task 4's AADT supplement.

- [ ] **Step 1: Record the pre-append baseline**

```bash
node -e '
const s=require("./artifacts/api-server/src/data/new-york-signals.json");
const r=require("./artifacts/api-server/src/data/new-york-roads.json");
console.log("signals",s.length,"ways",r.ways.length);
require("fs").writeFileSync("/tmp/ny-baseline.json",JSON.stringify(s.slice(0,s.length)));
console.log("baseline snapshot written to /tmp/ny-baseline.json");'
```

Expected: `signals 30601 ways <N>`. Note both numbers — the PR body needs the delta.

- [ ] **Step 2: Run the append**

Downloads the New York PBF (~450 MB) to `$GEOFABRIK_DIR` (default `/tmp/geofabrik_pbf`) and appends. Expect several minutes.

```bash
pnpm --filter @workspace/scripts exec tsx src/extend-region-coverage.ts
```

Expected output includes a line like:
`✔ new-york signals: +NNNN from new-york (dup-skipped NNNNN, id bumps 0) → total 3XXXX`

The `dup-skipped` count will be large — the NY PBF contains the whole state, and every signal already inside box A matches an existing tuple within 15 m. **`id bumps` should be 0.** A non-zero value means an appended OSM id collided with the PR #82 block; the guard handled it, but note the count in the PR body.

- [ ] **Step 3: Verify the append-only invariant**

This is the single most important check in the plan. The first 30,601 tuples must be byte-identical to HEAD.

```bash
node -e '
const now=require("./artifacts/api-server/src/data/new-york-signals.json");
const {execSync}=require("child_process");
const head=JSON.parse(execSync("git show HEAD:artifacts/api-server/src/data/new-york-signals.json",{maxBuffer:1<<30}).toString());
const prefix=JSON.stringify(now.slice(0,head.length));
console.log("baseline count:",head.length,"| now:",now.length,"| appended:",now.length-head.length);
console.log("first",head.length,"tuples byte-identical:",prefix===JSON.stringify(head));
const ids=now.map(t=>t[0]);
console.log("duplicate ids:",ids.length-new Set(ids).size);
const appended=now.slice(head.length);
console.log("appended all east of -73.4:",appended.every(t=>t[2]>-73.4));
const east=appended.filter(t=>t[2]>-73.4).length;
console.log("appended in Suffolk longitudes:",east,"of",appended.length);'
```

Expected: `byte-identical: true`, `duplicate ids: 0`. If `byte-identical` is false, **stop and revert** — `new-york-aadt.json` would be silently rewired onto the wrong signals.

Note: `appended all east of -73.4` may be `false`. That is expected and correct — the script appends any NY node not matched within 15 m, so OSM churn inside box A since the 2026-05 snapshot comes along too. Record both counts; the PR body must not present the total delta as Suffolk coverage.

- [ ] **Step 4: Confirm Suffolk towns now have nearby signals**

```bash
node -e '
const s=require("./artifacts/api-server/src/data/new-york-signals.json");
const near=(la,lo,km)=>s.filter(t=>Math.hypot((t[1]-la)*111,(t[2]-lo)*84)<km).length;
for(const [n,la,lo] of [["Hauppauge",40.8176,-73.0776],["Huntington",40.8681,-73.4257],["Islip",40.7298,-73.2104],["Patchogue",40.7657,-73.0151],["Riverhead",40.9170,-72.6620],["Southampton",40.8843,-72.3898],["Montauk",41.0359,-71.9445]])
  console.log(n.padEnd(14),"signals within 2km:",near(la,lo,2),"| 5km:",near(la,lo,5));'
```

Expected: Hauppauge, Huntington, Islip, Patchogue all in the double digits within 5 km. Riverhead lower. Southampton and Montauk may be very low or zero — that is the real network (23 signals across the whole East End), not a failure. Record these numbers.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/data/new-york-signals.json \
        artifacts/api-server/src/data/new-york-roads.json
git commit -m "Append Suffolk County signals + named ways from the NY PBF"
```

---

## Task 4: Snap NYSDOT AADT onto the appended signals

**Files:**
- Modify: `scripts/src/fetch-aadt-by-signal.ts` (primary NY config ~line 680; appended-signal supplement ~line 800)
- Modify (append): `artifacts/api-server/src/data/new-york-aadt.json`

**Interfaces:**
- Consumes: Task 3's appended signal tuples.
- Produces: `AadtRecord` entries keyed by those tuples' OSM ids, `source: "nysdot"`.

**Why a supplement:** the config at ~line 795 already exists with `supplement: true` — it loads the existing file and keeps every record as-is, filling only signals with no record. Its bbox is just clipped at `lonMax: -73.4` like everything else. The primary config at ~line 680 is a **full rebuild** and must never run against `new-york`: it would drop the 1,666 `njdot` records.

- [ ] **Step 1: Widen the appended-signal supplement bbox**

In `scripts/src/fetch-aadt-by-signal.ts`, in the block whose `sourceLabel` is `"NYSDOT Traffic Monitoring (appended-signal supplement)"` (~line 800), replace:

```typescript
    // NY-side signals appended since the 2026-05 PBF snapshot (OSM churn).
    slug: "new-york",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -73.4 },
```

with:

```typescript
    // NY-side signals appended since the 2026-05 PBF snapshot (OSM churn),
    // plus the Suffolk County inventory appended 2026-08-18. lonMax -71.85
    // reaches Montauk Point; NYSDOT's Traffic Monitoring layer is statewide,
    // so the only thing that was ever missing here was the bbox.
    slug: "new-york",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -71.85 },
```

- [ ] **Step 2: Widen the primary config bbox for future rebuilds**

In the block whose `sourceLabel` is `"NYSDOT Traffic Monitoring (per-segment latest)"` (~line 680), replace:

```typescript
    bbox: { latMin: 40.4, latMax: 41.3, lonMin: -74.5, lonMax: -73.4 },
```

with:

```typescript
    // Envelope of new_york_metro's coverage boxes. NOT run as part of the
    // Suffolk wire — this config is a full REBUILD and would drop the njdot
    // supplement records. Widened so a future --all run is not clipped.
    bbox: { latMin: 40.2, latMax: 41.3, lonMin: -74.5, lonMax: -71.85 },
```

- [ ] **Step 3: Record the pre-supplement baseline**

```bash
node -e '
const a=require("./artifacts/api-server/src/data/new-york-aadt.json");
const src={};for(const k of Object.keys(a)){const v=a[k].source;src[v]=(src[v]||0)+1;}
console.log("aadt records:",Object.keys(a).length,"| by source:",JSON.stringify(src));'
```

Expected: `25130 | {"nysdot":23464,"njdot":1666}`.

- [ ] **Step 4: Run the supplement**

```bash
pnpm --filter @workspace/scripts exec tsx src/fetch-aadt-by-signal.ts --supplement-only new-york
```

Expected: a `Supplement mode: 25130 existing records kept as-is` line, then a snap summary. Note the final record count and snap percentage.

- [ ] **Step 5: Verify append-only on the AADT file**

```bash
node -e '
const {execSync}=require("child_process");
const now=require("./artifacts/api-server/src/data/new-york-aadt.json");
const head=JSON.parse(execSync("git show HEAD:artifacts/api-server/src/data/new-york-aadt.json",{maxBuffer:1<<30}).toString());
let changed=0;
for(const k of Object.keys(head)) if(JSON.stringify(head[k])!==JSON.stringify(now[k])) changed++;
console.log("pre-existing records:",Object.keys(head).length,"| mutated:",changed);
console.log("now:",Object.keys(now).length,"| added:",Object.keys(now).length-Object.keys(head).length);
const src={};for(const k of Object.keys(now)){const v=now[k].source;src[v]=(src[v]||0)+1;}
console.log("by source:",JSON.stringify(src));'
```

Expected: **`mutated: 0`**. Anything else violates the append-only invariant — stop and revert. `njdot` must still read 1666.

- [ ] **Step 6: Measure the Suffolk snap rate**

This is the number the PR body must report instead of the spec's estimate.

```bash
node -e '
const s=require("./artifacts/api-server/src/data/new-york-signals.json");
const a=require("./artifacts/api-server/src/data/new-york-aadt.json");
const band=(n,lo,hi)=>{const t=s.filter(x=>x[2]>lo&&x[2]<=hi);const w=t.filter(x=>a[String(x[0])]).length;
  console.log(n.padEnd(30),"signals",String(t.length).padStart(5),"aadt",String(w).padStart(5),t.length?(100*w/t.length).toFixed(1)+"%":"-");};
band("Nassau baseline -73.74..-73.40",-73.74,-73.40);
band("W Suffolk -73.42..-73.00",-73.42,-73.00);
band("C Suffolk -73.00..-72.60",-73.00,-72.60);
band("Riverhead -72.60..-72.30",-72.60,-72.30);
band("East End -72.30..-71.85",-72.30,-71.85);
band("ALL Suffolk -73.42..-71.85",-73.42,-71.85);
console.log("region total:",s.length,"aadt",Object.keys(a).length,(100*Object.keys(a).length/s.length).toFixed(1)+"%");'
```

Expected: Suffolk snap somewhere between Greenville's 70.8% and Nassau's ~98%. Record every band. If any band is below ~60%, say so in the PR body rather than rounding it away.

- [ ] **Step 7: Commit**

```bash
git add scripts/src/fetch-aadt-by-signal.ts \
        artifacts/api-server/src/data/new-york-aadt.json
git commit -m "Snap NYSDOT AADT onto the Suffolk signal inventory"
```

---

## Task 5: Re-run calibration

**Files:**
- Modify: `artifacts/api-server/src/data/per-metro-audit.json`
- Modify: `artifacts/api-server/src/data/per-metro-baseline.json`
- Modify: `artifacts/api-server/src/data/synth-accuracy-knn.json`

**Interfaces:**
- Consumes: Task 4's AADT file.
- Produces: an updated `new_york_metro` baseline entry and KNN synthetic backfill for dark Suffolk signals.

**Why:** Sarasota (#86) and Greenville (#90) both re-ran this after wiring a new inventory. Signals with no measured AADT get a synthetic estimate; without this pass, every dark Suffolk signal has no volume at all.

- [ ] **Step 1: Identify the pipeline entry points**

```bash
ls scripts/src/ | grep -E "audit-measured-aadt-global|calibrate-synthetic-aadt|knn-idw-aadt|compute-aadt-stats"
```

Expected: all four present. The order used by #86/#90 is audit → calibrate → synth → measure.

- [ ] **Step 2: Run the pipeline**

```bash
pnpm --filter @workspace/scripts exec tsx src/audit-measured-aadt-global.ts
pnpm --filter @workspace/scripts exec tsx src/calibrate-synthetic-aadt.ts
pnpm --filter @workspace/scripts exec tsx src/knn-idw-aadt.ts
pnpm --filter @workspace/scripts exec tsx src/compute-aadt-stats.ts
```

Expected: each completes without error. Record the resulting `new_york_metro` KNN accuracy and the global rollup — the global figure held at 90.1% through #86 and #90, so a material drop needs explaining, not shipping.

- [ ] **Step 3: Confirm the growth-rate wire needs no change**

The spec expects none — `ny-growth-rates.json` already keys "New York City + Long Island + Hudson Valley" together.

```bash
cat artifacts/api-server/src/data/ny-growth-rates.json
grep -n "Long Island" scripts/src/fetch-ny-growth-rate.ts
```

Expected: a Long-Island-inclusive key already present. If Suffolk needs its own rate, note it as follow-up — do not wire a new rate in this PR.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/data/per-metro-audit.json \
        artifacts/api-server/src/data/per-metro-baseline.json \
        artifacts/api-server/src/data/synth-accuracy-knn.json
git commit -m "Re-run AADT calibration for the extended New York inventory"
```

---

## Task 6: Fix the NYSDOT Region 10 / Queens boundary

**Files:**
- Modify: `artifacts/tis-api-server/src/lib/pdf-export-ny.ts:193-197`
- Modify: `artifacts/tis-api-server/scripts/verify-long-island-coverage.mjs` (append a section)

**Interfaces:**
- Consumes: `nysdotRegion(lat, lon, region)` from `pdf-export-ny.ts`.
- Produces: `nysdotRegion` becomes an **exported** function so the verify script can exercise the real implementation rather than a copy of its rule. Signature unchanged: `(lat: number, lon: number, region: Region) => NysdotRegion` where `NysdotRegion = { num: number; label: string; planningGroup: string }`.

**Why:** NYSDOT Region 10 is Nassau + Suffolk. The current test is `lon > -73.83`, but the Queens/Nassau line runs near -73.70 (north) to -73.74 (south). Jamaica (-73.7907), St. Albans (-73.7654), Queens Village (-73.7415), Cambria Heights (-73.7357) and Rosedale (-73.7365) are all Queens — NYSDOT Region 11 — and are currently labeled "Region 10 — Long Island".

Verified: `pdf-export-ny.ts` has no module-level side effects and imports cleanly under `ts-loader.mjs`, so the verify script can import it directly.

- [ ] **Step 1: Export the function under test**

In `artifacts/tis-api-server/src/lib/pdf-export-ny.ts:175`, change:

```typescript
function nysdotRegion(lat: number, lon: number, region: Region): NysdotRegion {
```

to:

```typescript
// Exported for scripts/verify-long-island-coverage.mjs — the Queens/Nassau
// line is asserted against the real implementation, not a copy of the rule.
export function nysdotRegion(lat: number, lon: number, region: Region): NysdotRegion {
```

If `NysdotRegion` is declared as a bare `type NysdotRegion = {...}`, export it too:

```typescript
export type NysdotRegion = {
```

- [ ] **Step 2: Add the failing assertions**

Append to `verify-long-island-coverage.mjs`, before the final `console.log`/`process.exit` pair:

```javascript
// ── NYSDOT region labeling (pdf-export-ny.ts nysdotRegion) ────────────────
// Region 10 is Nassau + Suffolk. Region 11 is the five boroughs. The
// Queens/Nassau line runs near -73.70 in the north and -73.74 in the south,
// so a single vertical test cannot be exact — but -73.83 was far enough west
// to put five substantial Queens neighborhoods on Long Island.
console.log("\n── NYSDOT region labeling ──");
const { nysdotRegion } = await import(path.resolve(here, "../src/lib/pdf-export-ny.ts"));
for (const [name, lat, lon, want] of [
  // Queens — must be Region 11.
  ["Jamaica, Queens",        40.7027, -73.7907, 11],
  ["St. Albans, Queens",     40.6901, -73.7654, 11],
  ["Queens Village",         40.7154, -73.7415, 11],
  ["Cambria Heights, Queens",40.6924, -73.7357, 11],
  ["Rosedale, Queens",       40.6659, -73.7365, 11],
  // Nassau + Suffolk — must be Region 10.
  ["Great Neck (Nassau)",    40.7868, -73.7285, 10],
  ["Hempstead (Nassau)",     40.7062, -73.6187, 10],
  ["Hicksville (Nassau)",    40.7684, -73.5251, 10],
  ["Hauppauge (Suffolk)",    40.8176, -73.0776, 10],
  ["Islip (Suffolk)",        40.7298, -73.2104, 10],
  // Hudson Valley — Region 8 still wins above 40.92.
  ["White Plains",           41.0340, -73.7629, 8],
  ["Rye",                    40.9807, -73.6837, 8],
]) {
  const got = nysdotRegion(lat, lon, NY).num;
  ok(got === want, `${name} → NYSDOT Region ${want} (got ${got})`);
}
```

- [ ] **Step 3: Run it to confirm the Queens cases fail**

```bash
pnpm --filter @workspace/tis-api-server run check:long-island-coverage
```

Expected: exactly the five Queens rows FAIL with `→ NYSDOT Region 11 (got 10)`, because `-73.83` still puts them east of the line. Every Nassau, Suffolk and Hudson Valley row should already PASS. If a Suffolk row fails here, Task 1 regressed — stop and investigate before editing.

- [ ] **Step 4: Fix the boundary**

In `artifacts/tis-api-server/src/lib/pdf-export-ny.ts`, replace:

```typescript
    // Region 10 (Long Island) — Nassau + Suffolk. East of Brooklyn
    // (lon > -73.83) below the Westchester line.
    if (lon > -73.83) {
```

with:

```typescript
    // Region 10 (Long Island) — Nassau + Suffolk, below the Westchester
    // line. The Queens/Nassau border runs near -73.70 in the north (Elmont,
    // Floral Park) and -73.74 in the south (Valley Stream), so no single
    // vertical line is exact; -73.73 is the best constant fit. The old
    // -73.83 was far enough west to label Jamaica, St. Albans, Queens
    // Village, Cambria Heights and Rosedale as Long Island when NYSDOT puts
    // all five in Region 11. Residual error is a ~0.015 deg sliver of
    // easternmost Queens (Bellerose, Glen Oaks), which the border genuinely
    // interleaves with Nassau — see the note above: these boxes are rough,
    // accurate enough for prose adaptation, not authoritative.
    if (lon > -73.73) {
```

- [ ] **Step 5: Run the full check**

```bash
pnpm --filter @workspace/tis-api-server run check:long-island-coverage
```

Expected: PASS on every line including all twelve region-label rows.

- [ ] **Step 6: Typecheck**

```bash
pnpm run typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add artifacts/tis-api-server/src/lib/pdf-export-ny.ts \
        artifacts/tis-api-server/scripts/verify-long-island-coverage.mjs
git commit -m "NYSDOT Region 10: move the Long Island line off eastern Queens"
```

---

## Task 7: Mirrors, smoke probes, and the full check suite

**Files:**
- Modify: `artifacts/atlanta-tis/src/data/metro-coverage.ts:249`
- Modify: `scripts/src/smoke-test-multi-region.ts` (~line 90)

**Interfaces:**
- Consumes: measured counts from Tasks 3–5.
- Produces: nothing downstream; this task closes the loop.

- [ ] **Step 1: Compute the current coverage figures**

```bash
node -e '
const s=require("./artifacts/api-server/src/data/new-york-signals.json");
const a=require("./artifacts/api-server/src/data/new-york-aadt.json");
const named=s.filter(t=>t[3]!==null&&String(t[3]).trim()!=="").length;
console.log("signals:",s.length);
console.log("namedPct:",(100*named/s.length).toFixed(1));
console.log("aadtPct:",(100*Object.keys(a).length/s.length).toFixed(1));'
```

Record all three. `namedPct` may drop from 91.9 — appended OSM nodes carry no `name` tag until the cross-street naming pass runs. If it drops materially, note it in the PR body.

- [ ] **Step 2: Update the coverage mirror**

In `artifacts/atlanta-tis/src/data/metro-coverage.ts:249`, replace `signals: 30601, namedPct: 91.9, aadtPct: 82.1` with the three measured values from Step 1. Leave every other field alone.

- [ ] **Step 3: Add Suffolk smoke probes**

In `scripts/src/smoke-test-multi-region.ts`, immediately after the existing `new_york_metro` line (~line 90), add:

```typescript
  // Long Island (2026-08-18): Suffolk was outside every region until the
  // coverage boxes landed. Hauppauge is the coordinate reported as broken.
  { regionCode: "new_york_metro", lat: 40.8176, lon: -73.0776, expectDotIncludes: "NYC" },
  { regionCode: "new_york_metro", lat: 40.9170, lon: -72.6620, expectDotIncludes: "NYC" },
```

Note: `expectDotIncludes` asserts against `region.jurisdiction.dotName`, which is metro-wide ("New York City Department of Transportation (NYC DOT)"). Suffolk's *report* jurisdiction comes from `pdf-export-ny.ts`'s NYSDOT-region logic, which Task 6 covers — these probes assert region resolution, not report copy.

- [ ] **Step 4: Run the smoke test**

```bash
pnpm --filter @workspace/scripts exec tsx src/smoke-test-multi-region.ts
```

Expected: all probes pass, at a total exactly two higher than the run before this change. Capture the before-count by running the smoke test once prior to Step 3 if you did not already. **No other region's resolution may move** — any other probe changing is a regression from the area growth in Task 1.

- [ ] **Step 5: Run the full check suite**

```bash
pnpm run typecheck
pnpm --filter @workspace/tis-api-server run check:long-island-coverage
pnpm --filter @workspace/tis-api-server run check:atlanta-msa-coverage
pnpm --filter @workspace/tis-api-server run check:coverage-warning
pnpm --filter @workspace/tis-api-server run check:name-dedup
pnpm --filter @workspace/tis-api-server run check:force-include
pnpm --filter @workspace/tis-api-server run check:driveways
pnpm --filter @workspace/tis-api-server run check:trip-loading
pnpm --filter @workspace/tis-api-server run check:state-dispatch
```

Expected: every one passes. Fix any failure before proceeding — do not proceed with a red check.

- [ ] **Step 6: Commit**

```bash
git add artifacts/atlanta-tis/src/data/metro-coverage.ts \
        scripts/src/smoke-test-multi-region.ts
git commit -m "Coverage mirror + Suffolk smoke probes"
```

---

## Task 8: Suffolk county sample PDF

**Files:**
- Create: `artifacts/atlanta-tis/public/samples/suffolk-county.pdf`

**Interfaces:**
- Consumes: a saved `/tis-api/demo/generate` response JSON.
- Produces: a hosted sample completing the NY set from PR #100.

**Separable:** Tasks 1–7 ship on their own. Do this only if the coverage work is green.

- [ ] **Step 1: Start the API server**

```bash
pnpm --filter @workspace/tis-api-server run dev
```

Leave it running in a second shell. It builds then serves `dist/index.mjs`.

- [ ] **Step 2: Generate a study at a Suffolk site**

Match PR #100's parameters exactly — LU 820 (shopping center), 85 ksf, opening year 2027, full tier — so the sample is comparable to the other six NY counties. The site is suburban arterial retail on Veterans Memorial Hwy at Hauppauge, the corridor the Task 4 AADT audit confirmed.

```bash
curl -sS -X POST http://localhost:3000/tis-api/demo/generate \
  -H 'content-type: application/json' \
  -d '{"projectName":"Suffolk County Retail Center",
       "address":"Veterans Memorial Hwy, Hauppauge, NY",
       "latitude":40.8176,"longitude":-73.0776,
       "landUseCode":"820","size":85,"openingYear":2027,
       "studyRadiusMi":0.75}' \
  -o /tmp/suffolk.json
```

Adjust the port if the server logs a different one. Confirm the response is a study, not the coverage error:

```bash
head -c 200 /tmp/suffolk.json
```

- [ ] **Step 3: Check the studied-intersection count and naming**

```bash
node -e 'const j=require("/tmp/suffolk.json");
const ints=j.report?.intersections??j.report?.studiedIntersections??[];
console.log("studied intersections:",ints.length);
const names=ints.map(i=>i.name??i.label??"");
console.log(names.slice(0,10).join("\n"));
console.log("unnamed (Signal #):",names.filter(n=>/^Signal #/.test(n)).length,"of",names.length);'
```

Expected: 8–20 studied intersections, the band the other hosted samples use. `deepen-county-samples.ts` documents the convention — target ≥8, one automatic +0.25 mi retry, capped at 1.25 mi — so if the count is low, re-run Step 2 with `studyRadiusMi` bumped by 0.25 (max 1.25).

**The intersection names must be real cross streets.** A high `Signal #` count means the appended ways were not normalized into the 3-tuple shape `regional-signal-naming.ts` reads, and the sample is not shippable — go back to Task 3 rather than shipping a report full of `Signal #12345678`.

- [ ] **Step 4: Render**

`render-county-sample.ts` reads `DATABASE_URL` for firm/branding lookup. Use the same value the server is running with.

```bash
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/scripts exec tsx src/render-county-sample.ts \
  /tmp/suffolk.json artifacts/atlanta-tis/public/samples/suffolk-county.pdf
```

- [ ] **Step 5: QA the PDF**

Match #100's stated bar: 0 garbage tokens, 0 blank pages, NYSDOT cited 24–27×, ITE 22–34×. Confirm the report reads **"Region 10 — Long Island"**, not Region 11 and not "to be confirmed".

```bash
node -e 'console.log(require("fs").statSync("artifacts/atlanta-tis/public/samples/suffolk-county.pdf").size,"bytes")'
```

Expected: roughly 110–190 KB, in line with the other NY samples.

- [ ] **Step 6: Commit**

```bash
git add artifacts/atlanta-tis/public/samples/suffolk-county.pdf
git commit -m "Add Suffolk County sample PDF"
```

---

## Post-merge verification

Run after the PR merges and deploys. **A missing sample file returns HTTP 200 with the SPA shell, not a 404** — so checking the status code alone proves nothing. Check the content type.

- [ ] **Suffolk returns a real study**

```bash
curl -sS -X POST https://simpleimpactstudies.com/tis-api/demo/generate \
  -H 'content-type: application/json' \
  -d '{"latitude":40.8176,"longitude":-73.0776,"landUseCode":"820","size":85,"openingYear":2027}' \
  | head -c 600
```

Expected: a study payload. Specifically **not** the `"fall outside our 300 covered metros"` error.

- [ ] **The sample serves as a PDF**

```bash
curl -sSI https://simpleimpactstudies.com/samples/suffolk-county.pdf | grep -i "^content-type\|^HTTP"
```

Expected: `content-type: application/pdf`. If it reads `text/html`, the file did not deploy — the 200 is the SPA shell.

- [ ] **Nassau did not regress**

```bash
curl -sS -X POST https://simpleimpactstudies.com/tis-api/demo/generate \
  -H 'content-type: application/json' \
  -d '{"latitude":40.7684,"longitude":-73.5251,"landUseCode":"820","size":85,"openingYear":2027}' \
  | head -c 300
```

Expected: a study, as before this work.

---

## PR body checklist

The PR must report **measured** values, not the spec's estimates:

- [ ] Signals appended (total) **and** the Suffolk-only subset — these differ, because OSM churn inside box A comes along with the append. Do not present the total as Suffolk coverage.
- [ ] AADT snap rate per longitude band from Task 4 Step 6.
- [ ] Region and global KNN accuracy from Task 5.
- [ ] `namedPct` before and after.
- [ ] Append-only confirmed: first 30,601 signal tuples byte-identical; 0 pre-existing AADT records mutated; `njdot` still 1666.
- [ ] `id bumps` count from the append (expected 0).
- [ ] Smoke test total, with the explicit statement that no other region's resolution moved.
- [ ] East End honesty: if Montauk/Southampton sites produce thin studies, say so rather than implying uniform Suffolk quality.
