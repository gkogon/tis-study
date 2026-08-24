# Driveway Access Modeling — Phase 1 (Backend) Implementation Plan

> **STATUS: EXECUTED (verified 2026-08-24).** `artifacts/tis-api-server/src/lib/driveways.ts` and the driveway-aware assignment shipped (PR #62); the driveway legality fixes continued through PR #125. The `- [ ]` checkboxes below were never ticked during execution — do not use them to judge remaining work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TIS engine accept a site's driveways with per-movement turn restrictions, route project trips through them on the road graph so forbidden movements reroute (U-turns) onto the network, and feed the rerouted volumes into per-intersection `addedTrips → LOS`, plus a driveway table in the report.

**Architecture:** A new pure module `driveways.ts` owns the driveway data model, preset→movement expansion, and the fronting-street turn geometry. `network-assignment.ts` gains a driveway-aware assignment that inserts driveways as graph nodes (edge-split + access link), enforces per-driveway turn legality during the shortest-path search (predecessor-link tracking), synthesizes penalized U-turn edges so forbidden movements reroute, and returns per-destination added volume. `tis.ts` wires that added volume into the existing `buildAffectedRow` LOS path when `req.driveways` is present (opt-in; absent ⇒ byte-identical to today). The report gains a driveway access table.

**Tech Stack:** TypeScript (Node ESM, native type-strip), esbuild build, orval codegen from `lib/tis-api-spec/openapi.yaml`, zod validation, PDFKit rendering. No test runner — verification is standalone `scripts/verify-*.mjs` (run with `node`) plus `tsc --noEmit`.

## Global Constraints

- **Opt-in only:** when `req.driveways` is absent or empty, every code path must produce output byte-identical to today. This is the top regression guard.
- **Coordinate precision:** round driveway lat/lon with the existing `round4` on input (matches the site; avoids the documented 4-dp spatial-index footgun). Graph node keys use 5-dp (`toFixed(5)`), matching `network-assignment.ts`.
- **Driveway cap:** ≤ 12 driveways per request (bounds compute).
- **Movements are street-relative:** `inLeft/inRight/outLeft/outRight` are turns relative to the fronting street, not compass directions.
- **Schema is the source of truth:** add fields in `lib/tis-api-spec/openapi.yaml` then `pnpm run codegen`; never hand-edit generated files. HTTP-boundary rule: a field not in the spec/zod is stripped before it reaches the engine.
- **Verification idiom:** each new module gets a `scripts/verify-<name>.mjs` wired as a `check:<name>` npm script; run with `node scripts/verify-<name>.mjs`. Node imports `.ts` directly (v26 type-strip).
- **Region scope:** global — no region gate on the driveway feature.

---

## File Structure

- **Create** `artifacts/tis-api-server/src/lib/driveways.ts` — driveway types, preset expansion, fronting-street turn geometry (pure, no I/O).
- **Create** `artifacts/tis-api-server/scripts/verify-driveways.mjs` — golden tests for `driveways.ts`.
- **Create** `artifacts/tis-api-server/scripts/verify-driveway-routing.mjs` — small hand-built-graph tests for the routing changes.
- **Modify** `lib/tis-api-spec/openapi.yaml` — add the `Driveway` schema + `driveways` on `TisRequest`.
- **Modify** `artifacts/tis-api-server/src/lib/network-assignment.ts` — driveway-node insertion, turn-aware search, U-turn edges, `assignWithDriveways`.
- **Modify** `artifacts/tis-api-server/src/lib/tis.ts` — accept `req.driveways`, wire per-intersection added volume into `buildAffectedRow`, add `driveways` result payload.
- **Modify** `artifacts/tis-api-server/src/lib/pdf-export.ts` — driveway access table in the report.
- **Modify** `artifacts/tis-api-server/package.json` — `check:driveways`, `check:driveway-routing` scripts.

---

## Task 1: API schema — `driveways` on `TisRequest`

**Files:**
- Modify: `lib/tis-api-spec/openapi.yaml` (the `TisRequest` schema + a new `Driveway` schema)
- Regenerate: `lib/tis-api-client-react/src/generated/*`, the zod output (via `pnpm run codegen`)

**Interfaces:**
- Produces: the generated `TisRequest.driveways?: Driveway[]` and `Driveway` / `DrivewayMovements` types consumed by every later task and the frontend.

- [ ] **Step 1: Add the schema.** In `lib/tis-api-spec/openapi.yaml`, under `components.schemas`, add:

```yaml
    DrivewayAccessType:
      type: string
      enum: [full, riro, three_quarter, entrance_only, exit_only, custom]
      description: >-
        Preset access type. All except "custom" expand server-side to a fixed
        movements set; "custom" uses the movements object verbatim.
    DrivewayMovements:
      type: object
      description: Allowed turning movements, relative to the fronting street.
      required: [inLeft, inRight, outLeft, outRight]
      properties:
        inLeft:  { type: boolean, description: Left turn into the site }
        inRight: { type: boolean, description: Right turn into the site }
        outLeft: { type: boolean, description: Left turn out onto the street }
        outRight: { type: boolean, description: Right turn out onto the street }
    Driveway:
      type: object
      required: [id, latitude, longitude, accessType, movements]
      properties:
        id: { type: string, minLength: 1 }
        latitude:  { type: number, minimum: -90, maximum: 90 }
        longitude: { type: number, minimum: -180, maximum: 180 }
        label: { type: string }
        accessType: { $ref: '#/components/schemas/DrivewayAccessType' }
        movements: { $ref: '#/components/schemas/DrivewayMovements' }
```

Then add to the `TisRequest` schema `properties`:

```yaml
        driveways:
          type: array
          maxItems: 12
          description: >-
            Site access points with per-movement turn restrictions. When present,
            project trips route through these driveways and forbidden movements
            reroute onto the network. Absent ⇒ single-site behavior (unchanged).
          items: { $ref: '#/components/schemas/Driveway' }
```

- [ ] **Step 2: Regenerate clients + zod.**

Run: `cd lib/tis-api-spec && pnpm run codegen`
Expected: exits 0; `lib/tis-api-client-react/src/generated/api.schemas.ts` now contains `Driveway`, `DrivewayMovements`, `DrivewayAccessType`, and `TisRequest.driveways?`.

- [ ] **Step 3: Verify types generated + project typechecks.**

Run: `grep -c "driveways" lib/tis-api-client-react/src/generated/api.schemas.ts && cd artifacts/tis-api-server && npx tsc -p tsconfig.json --noEmit`
Expected: grep ≥ 1; tsc exits 0 (nothing consumes `driveways` yet, so no errors).

- [ ] **Step 4: Commit.**

```bash
git add lib/tis-api-spec/openapi.yaml lib/tis-api-client-react/src/generated
git commit -m "feat(tis): add driveways to the TisRequest schema"
```

---

## Task 2: `driveways.ts` — types + preset→movements expansion

**Files:**
- Create: `artifacts/tis-api-server/src/lib/driveways.ts`
- Create/Modify test: `artifacts/tis-api-server/scripts/verify-driveways.mjs`
- Modify: `artifacts/tis-api-server/package.json` (add `check:driveways`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AccessType = "full" | "riro" | "three_quarter" | "entrance_only" | "exit_only" | "custom"`
  - `type Movements = { inLeft: boolean; inRight: boolean; outLeft: boolean; outRight: boolean }`
  - `type Driveway = { id: string; latitude: number; longitude: number; label?: string; accessType: AccessType; movements: Movements }`
  - `expandAccessType(t: AccessType): Movements` — preset table; `custom` returns all-false (caller supplies movements).
  - `resolveMovements(d: { accessType: AccessType; movements?: Partial<Movements> }): Movements` — `custom` ⇒ the supplied movements (missing keys false); preset ⇒ `expandAccessType`.

- [ ] **Step 1: Write the failing test.** Append to `artifacts/tis-api-server/scripts/verify-driveways.mjs`:

```js
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/driveways.ts"));
const { expandAccessType, resolveMovements } = m;

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };
const eqM = (a, b) => a.inLeft === b.inLeft && a.inRight === b.inRight && a.outLeft === b.outLeft && a.outRight === b.outRight;

ok(eqM(expandAccessType("full"), { inLeft: true, inRight: true, outLeft: true, outRight: true }), "full = all movements");
ok(eqM(expandAccessType("riro"), { inLeft: false, inRight: true, outLeft: false, outRight: true }), "riro = right-in + right-out only");
ok(eqM(expandAccessType("three_quarter"), { inLeft: true, inRight: true, outLeft: false, outRight: true }), "three_quarter = riro + left-in");
ok(eqM(expandAccessType("entrance_only"), { inLeft: true, inRight: true, outLeft: false, outRight: false }), "entrance_only = ins only");
ok(eqM(expandAccessType("exit_only"), { inLeft: false, inRight: false, outLeft: true, outRight: true }), "exit_only = outs only");
// custom passes movements through verbatim
ok(eqM(resolveMovements({ accessType: "custom", movements: { outLeft: true } }), { inLeft: false, inRight: false, outLeft: true, outRight: false }), "custom = supplied movements (missing keys false)");
// preset ignores any supplied movements
ok(eqM(resolveMovements({ accessType: "riro", movements: { inLeft: true } }), expandAccessType("riro")), "preset overrides supplied movements");

console.log(""); console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveways.mjs`
Expected: FAIL — `Cannot find module .../driveways.ts`.

- [ ] **Step 3: Write minimal implementation.** Create `artifacts/tis-api-server/src/lib/driveways.ts`:

```ts
/**
 * Driveway access model for the TIS site-access feature. A driveway is a point
 * on the site's fronting street with a set of allowed turning movements
 * (relative to that street). Presets expand to an explicit movements set; the
 * routing layer enforces those movements and reroutes forbidden ones.
 */
export type AccessType = "full" | "riro" | "three_quarter" | "entrance_only" | "exit_only" | "custom";

export type Movements = { inLeft: boolean; inRight: boolean; outLeft: boolean; outRight: boolean };

export type Driveway = {
  id: string;
  latitude: number;
  longitude: number;
  label?: string;
  accessType: AccessType;
  movements: Movements;
};

const NONE: Movements = { inLeft: false, inRight: false, outLeft: false, outRight: false };

/** Preset → allowed movements. "custom" yields none (caller supplies movements). */
export function expandAccessType(t: AccessType): Movements {
  switch (t) {
    case "full": return { inLeft: true, inRight: true, outLeft: true, outRight: true };
    case "riro": return { inLeft: false, inRight: true, outLeft: false, outRight: true };
    case "three_quarter": return { inLeft: true, inRight: true, outLeft: false, outRight: true };
    case "entrance_only": return { inLeft: true, inRight: true, outLeft: false, outRight: false };
    case "exit_only": return { inLeft: false, inRight: false, outLeft: true, outRight: true };
    case "custom": return { ...NONE };
  }
}

/** Resolve the effective movements: preset expands; custom uses supplied movements. */
export function resolveMovements(d: { accessType: AccessType; movements?: Partial<Movements> }): Movements {
  if (d.accessType !== "custom") return expandAccessType(d.accessType);
  return {
    inLeft: !!d.movements?.inLeft,
    inRight: !!d.movements?.inRight,
    outLeft: !!d.movements?.outLeft,
    outRight: !!d.movements?.outRight,
  };
}
```

- [ ] **Step 4: Add the check script + run to verify it passes.**

In `artifacts/tis-api-server/package.json` `scripts`, add: `"check:driveways": "node ./scripts/verify-driveways.mjs",`
Run: `cd artifacts/tis-api-server && node scripts/verify-driveways.mjs`
Expected: all lines PASS, final `ALL PASS`, exit 0.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/tis-api-server/src/lib/driveways.ts artifacts/tis-api-server/scripts/verify-driveways.mjs artifacts/tis-api-server/package.json
git commit -m "feat(tis): driveway model + preset movement expansion"
```

---

## Task 3: `driveways.ts` — fronting-street turn geometry

The routing layer needs to know, for a trip whose external origin/destination is at compass bearing `d` from the site, which movement (`inLeft/inRight/outLeft/outRight`) that trip uses at a given driveway — so it can check legality. This is pure geometry: the fronting-street bearing + which side the site is on determine whether an approach is a left or a right turn.

**Files:**
- Modify: `artifacts/tis-api-server/src/lib/driveways.ts`
- Modify: `artifacts/tis-api-server/scripts/verify-driveways.mjs`

**Interfaces:**
- Consumes: `Movements` (Task 2).
- Produces:
  - `type SiteSide = 1 | -1` — sign of the cross product of the street-direction unit vector and the (driveway→site) vector; +1 = site left of the street direction, −1 = right.
  - `classifyMovement(streetBearingDeg: number, siteSide: SiteSide, odBearingDeg: number, inbound: boolean): keyof Movements` — the movement (`inLeft`/`inRight` when `inbound`, else `outLeft`/`outRight`) a trip to/from compass bearing `odBearingDeg` makes at a driveway whose fronting street runs `streetBearingDeg` with the site on `siteSide`.
  - `sideOfStreet(streetBearingDeg: number, drivewayToSiteBearingDeg: number): SiteSide`.

**Geometry model (spelled out so the implementer needs no outside knowledge):**
- Bearings are compass degrees (0 = north, 90 = east, clockwise). Convert to a planar unit vector with `vx = sin(θ), vy = cos(θ)` (east, north). The signed turn from vector A to vector B is `cross = A.vx*B.vy − A.vy*B.vx`; `cross > 0` is a **left** turn (counter-clockwise in this east-north frame), `cross < 0` is a **right** turn.
- A trip to/from compass bearing `od` travels along the fronting street in whichever of the two along-street directions (`streetBearing` or `streetBearing+180`) points more toward `od` (max dot product with the `od` unit vector). For an **inbound** trip that along-street direction is the travel direction as it *reaches* the driveway; the trip then turns from that travel direction toward the site (vector driveway→site). Left/right of that turn ⇒ `inLeft`/`inRight`. For an **outbound** trip the trip departs the driveway onto the street heading toward `od`, i.e. turns from the site→driveway... modeled symmetrically: the departing turn is from the driveway-exit heading onto the chosen along-street direction; left/right ⇒ `outLeft`/`outRight`. A near-180° turn (origin behind the site across the street with no matching along-street direction) is a `uturn`.

- [ ] **Step 1: Write the failing test.** Append to `verify-driveways.mjs` (before the summary block):

```js
const { classifyMovement, sideOfStreet } = m;
// East–west street (bearing 90°), site on the SOUTH side. driveway→site points south (bearing 180°).
const south = sideOfStreet(90, 180); // site south of an eastbound street = driver's right = -1
ok(south === -1, `south-side of E-W street = right side (got ${south})`);
// Inbound trip FROM THE WEST (origin bearing 270°): travels east, site on the right ⇒ right turn in.
ok(classifyMovement(90, south, 270, true) === "inRight", `from west into south-side driveway = inRight (got ${classifyMovement(90, south, 270, true)})`);
// Inbound trip FROM THE EAST (origin bearing 90°): travels west, site on the left ⇒ left turn in.
ok(classifyMovement(90, south, 90, true) === "inLeft", `from east into south-side driveway = inLeft (got ${classifyMovement(90, south, 90, true)})`);
// Outbound trip TO THE WEST (destination 270°): departs heading west; leaving a south-side driveway to go west = left turn out.
ok(classifyMovement(90, south, 270, false) === "outLeft", `to west out of south-side driveway = outLeft (got ${classifyMovement(90, south, 270, false)})`);
// Outbound trip TO THE EAST (destination 90°): right turn out.
ok(classifyMovement(90, south, 90, false) === "outRight", `to east out of south-side driveway = outRight (got ${classifyMovement(90, south, 90, false)})`);
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveways.mjs`
Expected: FAIL — `classifyMovement is not a function`.

- [ ] **Step 3: Write minimal implementation.** Append to `driveways.ts`:

```ts
export type SiteSide = 1 | -1;

function vec(bearingDeg: number): { x: number; y: number } {
  const r = (bearingDeg * Math.PI) / 180;
  return { x: Math.sin(r), y: Math.cos(r) }; // (east, north)
}
function cross(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x * b.y - a.y * b.x; // >0 ⇒ a→b is a LEFT (CCW) turn in this east-north frame
}
function dot(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.x * b.x + a.y * b.y;
}

/** Which side of the street the site sits on (+1 left, −1 right of the street bearing). */
export function sideOfStreet(streetBearingDeg: number, drivewayToSiteBearingDeg: number): SiteSide {
  return cross(vec(streetBearingDeg), vec(drivewayToSiteBearingDeg)) >= 0 ? 1 : -1;
}

/**
 * The turning movement a trip to/from `odBearingDeg` (compass bearing of the
 * origin/destination from the site) makes at this driveway.
 *
 * The site sits perpendicular to the street on `siteSide` (+1 left / −1 right of
 * the street bearing), so driveway→site ≈ streetBearing − 90 (left) or +90 (right).
 * - Inbound: the car travels along the street toward the site (i.e. AWAY from the
 *   origin), then turns toward the site. Left/right = sign of cross(travel, driveway→site).
 * - Outbound: the car exits the driveway toward the street (site→driveway heading),
 *   then turns onto the along-street direction heading toward the destination.
 */
export function classifyMovement(
  streetBearingDeg: number,
  siteSide: SiteSide,
  odBearingDeg: number,
  inbound: boolean,
): keyof Movements {
  const drivewayToSite = streetBearingDeg + (siteSide === 1 ? -90 : 90);
  const siteToDriveway = drivewayToSite + 180;
  const fwd = vec(streetBearingDeg);
  const back = vec(streetBearingDeg + 180);
  if (inbound) {
    // Travel toward the site = the along-street direction pointing AWAY from the origin.
    const towardSite = vec(odBearingDeg + 180);
    const travel = dot(fwd, towardSite) >= dot(back, towardSite) ? fwd : back;
    return cross(travel, vec(drivewayToSite)) > 0 ? "inLeft" : "inRight";
  }
  // Outbound: exit heading = site→driveway; travel = along-street dir toward the destination.
  const od = vec(odBearingDeg);
  const travel = dot(fwd, od) >= dot(back, od) ? fwd : back;
  return cross(vec(siteToDriveway), travel) > 0 ? "outLeft" : "outRight";
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveways.mjs`
Expected: all PASS including the five geometry cases. If a left/right case is inverted, flip the `turnIsLeft` mapping and re-run (the test is the oracle).

- [ ] **Step 5: Refactor + commit.** Remove the `siteVec` placeholder lines (they were scaffolding). Re-run the test to confirm still green, then:

```bash
git add artifacts/tis-api-server/src/lib/driveways.ts artifacts/tis-api-server/scripts/verify-driveways.mjs
git commit -m "feat(tis): fronting-street turn geometry for driveways"
```

---

## Task 4: Request validation for `driveways`

The generated zod enforces structure + `maxItems`. Add the one rule zod-from-openapi can't express: **every driveway must allow at least one movement** (a fully-closed driveway is a user error). Apply it at the route handler where `TisRequest` is validated, before `generateTisReport`.

**Files:**
- Modify: `artifacts/tis-api-server/src/lib/driveways.ts` (add `validateDriveways`)
- Modify: the TIS generate route handler (search: `grep -rn "generateTisReport" artifacts/tis-api-server/src/routes`)
- Modify: `artifacts/tis-api-server/scripts/verify-driveways.mjs`

**Interfaces:**
- Consumes: `Driveway`, `resolveMovements` (Tasks 2–3).
- Produces: `validateDriveways(driveways: Driveway[] | undefined): string | null` — returns an error message, or `null` if valid.

- [ ] **Step 1: Write the failing test.** Append to `verify-driveways.mjs`:

```js
const { validateDriveways } = m;
ok(validateDriveways(undefined) === null, "undefined driveways is valid (opt-in)");
ok(validateDriveways([]) === null, "empty driveways is valid");
ok(validateDriveways([{ id: "a", latitude: 25.7, longitude: -80.2, accessType: "riro", movements: { inLeft: false, inRight: true, outLeft: false, outRight: true } }]) === null, "a RIRO driveway is valid");
ok(typeof validateDriveways([{ id: "b", latitude: 25.7, longitude: -80.2, accessType: "custom", movements: { inLeft: false, inRight: false, outLeft: false, outRight: false } }]) === "string", "a fully-closed custom driveway is rejected");
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveways.mjs`
Expected: FAIL — `validateDriveways is not a function`.

- [ ] **Step 3: Write minimal implementation.** Append to `driveways.ts`:

```ts
/** Business-rule validation beyond the zod structural checks. */
export function validateDriveways(driveways: Driveway[] | undefined): string | null {
  if (!driveways || driveways.length === 0) return null;
  for (const d of driveways) {
    const mv = resolveMovements(d);
    if (!mv.inLeft && !mv.inRight && !mv.outLeft && !mv.outRight) {
      return `Driveway ${d.label ?? d.id} allows no movements; enable at least one.`;
    }
  }
  return null;
}
```

- [ ] **Step 4: Wire into the route handler.** In the TIS generate handler (the file from `grep`), immediately before the `generateTisReport(req)` call, add:

```ts
import { validateDriveways } from "../lib/driveways";
// ...
const drivewayErr = validateDriveways(req.driveways);
if (drivewayErr) return res.status(422).json({ error: drivewayErr });
```
(Match the file's existing error-response convention; if it throws typed errors instead of `res.status`, throw the same 422 error type with `drivewayErr` as the message.)

- [ ] **Step 5: Run test + typecheck to verify.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveways.mjs && npx tsc -p tsconfig.json --noEmit`
Expected: all PASS; tsc exits 0.

- [ ] **Step 6: Commit.**

```bash
git add artifacts/tis-api-server/src/lib/driveways.ts artifacts/tis-api-server/src/routes artifacts/tis-api-server/scripts/verify-driveways.mjs
git commit -m "feat(tis): validate driveway movements at the request boundary"
```

---

## Task 5: `network-assignment.ts` — driveway-node insertion

Insert each driveway as a graph node by snapping it to the nearest link, splitting that link at the snap point, and adding a short access link from the site to the driveway node. Refactor the current inline graph build into a reusable `buildGraph(segments, volumeRefs)` returning the mutable graph, then add `insertDriveway`.

**Files:**
- Modify: `artifacts/tis-api-server/src/lib/network-assignment.ts`
- Create: `artifacts/tis-api-server/scripts/verify-driveway-routing.mjs`
- Modify: `artifacts/tis-api-server/package.json` (`check:driveway-routing`)

**Interfaces:**
- Consumes: the existing `Link`, `RoadSegment`, `distMi` (network-assignment.ts).
- Produces:
  - `type Graph = { links: Link[]; adj: number[][]; nodeLat: number[]; nodeLon: number[]; nodeOf(la, lo): number; nearestNode(la, lo): number }`
  - `buildGraph(segments: RoadSegment[], volumeRefs: VolumeRef[]): Graph` — the extracted current build.
  - `nearestLinkPoint(g: Graph, lat, lon): { li: number; t: number; lat: number; lon: number; distMi: number }` — nearest point on any link (`t` = fractional position along the link).
  - `insertDriveway(g: Graph, siteNode: number, lat: number, lon: number): { drivewayNode: number; accessLink: number; streetBearing: number }` — splits the nearest link at the snap point, adds the driveway node, and adds a site→driveway access link. Returns the new node + access-link indices + the **fronting-street bearing** (compass degrees of the split link's a→b direction, used by Task 6's movement geometry).

- [ ] **Step 1: Write the failing test.** Create `artifacts/tis-api-server/scripts/verify-driveway-routing.mjs`:

```js
import { fileURLToPath } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
const { buildGraph, insertDriveway, nearestLinkPoint } = m;

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? "PASS" : "FAIL"}  ${msg}`); if (!c) fails++; };

// A single east–west segment (class 3) from (0,0)→(0,0.01) [~0.69 mi of lon at equator-ish].
const segs = [[3, 0, 0, 0, 0.01, null, null]];
const g = buildGraph(segs, []);
ok(g.links.length === 1, `one link built (got ${g.links.length})`);
ok(g.nodeLat.length === 2, `two nodes built (got ${g.nodeLat.length})`);

// Snap a driveway just south of the segment midpoint.
const snap = nearestLinkPoint(g, -0.0001, 0.005);
ok(snap.li === 0 && snap.t > 0.4 && snap.t < 0.6, `driveway snaps to mid of link 0 (t=${snap.t?.toFixed(2)})`);

const before = { links: g.links.length, nodes: g.nodeLat.length };
const siteNode = g.nodeOf(-0.0003, 0.005); // a site node south of the road
const ins = insertDriveway(g, siteNode, -0.0001, 0.005);
ok(g.links.length === before.links + 2, `split adds 2 links net (1 split→2 + access), got +${g.links.length - before.links}`);
ok(g.nodeLat.length >= before.nodes + 1, `driveway node added`);
ok((g.adj[ins.drivewayNode] ?? []).length >= 3, `driveway node connects to both split halves + access link (got ${(g.adj[ins.drivewayNode]||[]).length})`);
ok((g.adj[siteNode] ?? []).includes(ins.accessLink), `site connects to the driveway via the access link`);

console.log(""); console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
```

(Note: the split replaces 1 link with 2 and adds 1 access link ⇒ net +2 links.)

- [ ] **Step 2: Run test to verify it fails.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveway-routing.mjs`
Expected: FAIL — `buildGraph is not a function`.

- [ ] **Step 3: Extract `buildGraph` + implement `nearestLinkPoint` / `insertDriveway`.** In `network-assignment.ts`, lift the node/link build (lines ~110–153) into an exported `buildGraph`, and export a `Graph` type. Keep `assignRoutes` working by calling `buildGraph` internally (no behavior change). Then add:

```ts
export type Graph = {
  links: Link[];
  adj: number[][];
  nodeLat: number[];
  nodeLon: number[];
  nodeOf: (la: number, lo: number) => number;
  nearestNode: (la: number, lo: number) => number;
};

export function buildGraph(segments: RoadSegment[], volumeRefs: VolumeRef[] = []): Graph {
  const nodeIdx = new Map<string, number>();
  const nodeLat: number[] = [];
  const nodeLon: number[] = [];
  const key = (la: number, lo: number) => `${la.toFixed(5)},${lo.toFixed(5)}`;
  const nodeOf = (la: number, lo: number): number => {
    const k = key(la, lo);
    let i = nodeIdx.get(k);
    if (i === undefined) { i = nodeLat.length; nodeIdx.set(k, i); nodeLat.push(la); nodeLon.push(lo); }
    return i;
  };
  const seedBaseVc = (midLat: number, midLon: number, cls: number, capVph: number): number => {
    if (volumeRefs.length === 0) return CLASS_BASE_VC[cls] ?? 0.5;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < volumeRefs.length; i++) {
      const d = distMi(midLat, midLon, volumeRefs[i]!.lat, volumeRefs[i]!.lon);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0 || bestD > 0.6 || !(volumeRefs[best]!.aadt > 0)) return CLASS_BASE_VC[cls] ?? 0.5;
    const peakVph = volumeRefs[best]!.aadt * K_FACTOR;
    return Math.min(1.2, Math.max(0.15, peakVph / capVph));
  };
  const links: Link[] = [];
  const adj: number[][] = [];
  const addAdj = (n: number, li: number) => { (adj[n] ??= []).push(li); };
  for (const s of segments) {
    const cls = Math.min(4, Math.max(0, s[0]));
    const a = nodeOf(s[1], s[2]);
    const b = nodeOf(s[3], s[4]);
    if (a === b) continue;
    const lenMi = distMi(s[1], s[2], s[3], s[4]);
    if (lenMi <= 0) continue;
    const mph = (typeof s[6] === "number" && s[6]! > 0) ? s[6]! : CLASS_FREE_MPH[cls]!;
    const lanesPerDir = (typeof s[5] === "number" && s[5]! > 0) ? Math.max(1, Math.round(s[5]! / 2)) : CLASS_LANES_PER_DIR[cls]!;
    const li = links.length;
    const capVph = lanesPerDir * PER_LANE_CAP_VPH;
    const baseVc = seedBaseVc((s[1] + s[3]) / 2, (s[2] + s[4]) / 2, cls, capVph);
    links.push({ a, b, lenMi, freeMin: (lenMi / mph) * 60, capVph, cls, baseVc, vol: 0 });
    addAdj(a, li); addAdj(b, li);
  }
  const nearestNode = (la: number, lo: number): number => {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < nodeLat.length; i++) {
      const d = distMi(la, lo, nodeLat[i]!, nodeLon[i]!);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  return { links, adj, nodeLat, nodeLon, nodeOf, nearestNode };
}

/** Nearest point on any link to (lat,lon); t = fractional position a→b. */
export function nearestLinkPoint(g: Graph, lat: number, lon: number) {
  let best = { li: -1, t: 0, lat, lon, distMi: Infinity };
  for (let li = 0; li < g.links.length; li++) {
    const lk = g.links[li]!;
    const ax = g.nodeLon[lk.a]!, ay = g.nodeLat[lk.a]!, bx = g.nodeLon[lk.b]!, by = g.nodeLat[lk.b]!;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let t = ((lon - ax) * dx + (lat - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx, py = ay + t * dy;
    const d = distMi(lat, lon, py, px);
    if (d < best.distMi) best = { li, t, lat: py, lon: px, distMi: d };
  }
  return best;
}

/** Compass bearing (deg) from node `a` to node `b`. */
function nodeBearing(g: Graph, a: number, b: number): number {
  const φ1 = (g.nodeLat[a]! * Math.PI) / 180, φ2 = (g.nodeLat[b]! * Math.PI) / 180;
  const Δλ = ((g.nodeLon[b]! - g.nodeLon[a]!) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Split the nearest link at the driveway's snap point; add a site→driveway access link. */
export function insertDriveway(g: Graph, siteNode: number, lat: number, lon: number): { drivewayNode: number; accessLink: number; streetBearing: number } {
  const snap = nearestLinkPoint(g, lat, lon);
  const addAdj = (n: number, li: number) => { (g.adj[n] ??= []).push(li); };
  if (snap.li < 0) {
    // No links: connect the driveway directly to the site.
    const dn = g.nodeOf(snap.lat, snap.lon);
    const al = g.links.length;
    g.links.push({ a: siteNode, b: dn, lenMi: 0.02, freeMin: 0.1, capVph: 2000, cls: 4, baseVc: 0, vol: 0 });
    addAdj(siteNode, al); addAdj(dn, al);
    return { drivewayNode: dn, accessLink: al, streetBearing: 0 };
  }
  const orig = g.links[snap.li]!;
  const streetBearing = nodeBearing(g, orig.a, orig.b); // fronting-street bearing (capture before reshape)
  const dn = g.nodeOf(snap.lat, snap.lon);
  // Reshape the original link to a→dn; add a second link dn→b (split).
  const halfA = { ...orig, b: dn, lenMi: orig.lenMi * snap.t, freeMin: orig.freeMin * snap.t, vol: 0 };
  const halfB = { ...orig, a: dn, lenMi: orig.lenMi * (1 - snap.t), freeMin: orig.freeMin * (1 - snap.t), vol: 0 };
  g.links[snap.li] = halfA;                 // reuse the slot for a→dn
  const bLink = g.links.length; g.links.push(halfB);
  addAdj(dn, snap.li); addAdj(dn, bLink); addAdj(orig.b, bLink);
  // Access link site→driveway (short, high-capacity, uncongested).
  const al = g.links.length;
  g.links.push({ a: siteNode, b: dn, lenMi: Math.max(0.01, distMi(g.nodeLat[siteNode]!, g.nodeLon[siteNode]!, snap.lat, snap.lon)), freeMin: 0.1, capVph: 2000, cls: 4, baseVc: 0, vol: 0 });
  addAdj(siteNode, al); addAdj(dn, al);
  return { drivewayNode: dn, accessLink: al, streetBearing };
}
```

- [ ] **Step 4: Run test + typecheck to verify it passes.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveway-routing.mjs && npx tsc -p tsconfig.json --noEmit`
Expected: all PASS; tsc exits 0. Add `"check:driveway-routing": "node ./scripts/verify-driveway-routing.mjs"` to `package.json`.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/tis-api-server/src/lib/network-assignment.ts artifacts/tis-api-server/scripts/verify-driveway-routing.mjs artifacts/tis-api-server/package.json
git commit -m "feat(tis): graph builder + driveway-node insertion (edge split + access link)"
```

---

## Task 6: `network-assignment.ts` — turn-aware routing + U-turn reroute + `assignWithDriveways`

The payoff task. Route the site's trips out through driveways with per-driveway movement legality enforced, synthesize penalized U-turn edges so forbidden movements reroute, and return **per-destination added volume** (the number that will drive LOS).

**Files:**
- Modify: `artifacts/tis-api-server/src/lib/network-assignment.ts`
- Modify: `artifacts/tis-api-server/scripts/verify-driveway-routing.mjs`

**Interfaces:**
- Consumes: `Graph`, `buildGraph`, `insertDriveway`, `Driveway`, `classifyMovement`, `sideOfStreet`, `resolveMovements`.
- Produces:
  - `type DrivewayResult = { drivewayNode: number; label: string; enterByMovement: Record<"inLeft"|"inRight", number>; exitByMovement: Record<"outLeft"|"outRight", number>; reroutedTrips: number }`
  - `type DrivewayAssignment = { available: boolean; perDestinationAddedTrips: number[]; driveways: DrivewayResult[]; reroutes: { destIndex: number; trips: number }[] }`
  - `assignWithDriveways(site, destinations, segments, driveways, opts): DrivewayAssignment` — `perDestinationAddedTrips[i]` aligns with `destinations[i]`; a rerouted movement adds its trips to the destination nearest the U-turn.

**Algorithm (each trip = one destination's directional demand):**
1. `buildGraph`; `siteNode = nodeOf(site)`; insert every driveway (Task 5), recording each driveway's fronting-street bearing (from its split link's a→b bearing) and `sideOfStreet`.
2. For each destination `i`: its compass bearing from the site is `odBearing_i`. For an **inbound** and an **outbound** leg, find the eligible driveways — those whose `resolveMovements` allows `classifyMovement(streetBearing, side, odBearing_i, inbound)`.
3. If ≥1 eligible driveway: route site→destination through the nearest eligible driveway (shortest path on the graph, access link forces it through a driveway node). Add `destinations[i].trips` to `perDestinationAddedTrips[i]`.
4. If **no** eligible driveway (movement forbidden everywhere): the trip reroutes — it uses the nearest driveway that allows the *opposite-hand* movement, then makes a **U-turn** at the nearest downstream node to correct heading. Model the U-turn by adding the trips to `perDestinationAddedTrips[j]` where `j` is the destination nearest that U-turn node (its added turning volume), and record it in `reroutes` and the driveway's `reroutedTrips`.
5. Roll up each driveway's entering/exiting volume by movement for the report.

- [ ] **Step 1: Write the failing test.** Append to `verify-driveway-routing.mjs` (before the summary):

```js
const { assignWithDriveways } = m;
// Cross road: an east–west street through the site + a north–south street to the east
// with a signal (destination) at the NE corner. Site at (0, 0).
const segsX = [
  [3, 0, -0.01, 0, 0.01, null, null],   // E-W street through the site latitude
  [3, -0.005, 0.008, 0.005, 0.008, null, null], // N-S street to the east (x≈0.008)
];
const site = { lat: -0.0003, lon: 0.0 };       // just south of the E-W street
const dests = [
  { lat: 0.0, lon: 0.008, trips: 100 },        // signal to the EAST (odBearing ≈ 90°)
  { lat: 0.0, lon: -0.008, trips: 100 },       // signal to the WEST (odBearing ≈ 270°)
];
// Full-access driveway on the E-W street just north of the site.
const full = [{ id: "dwA", latitude: -0.00005, longitude: 0.0, accessType: "full", movements: { inLeft: true, inRight: true, outLeft: true, outRight: true } }];
const rFull = assignWithDriveways(site, dests, segsX, full, {});
ok(rFull.available, "full-access assignment available");
const totFull = rFull.perDestinationAddedTrips.reduce((s, v) => s + v, 0);
ok(Math.abs(totFull - 200) < 1e-6, `full access conserves trips (got ${totFull})`);
ok(rFull.reroutes.length === 0, "full access ⇒ no reroutes");

// RIRO driveway: forbids out-left. Trips exiting to the WEST (a left turn out of a
// south-side driveway) can't leave directly ⇒ must reroute (U-turn).
const riro = [{ id: "dwA", latitude: -0.00005, longitude: 0.0, accessType: "riro", movements: { inLeft: false, inRight: true, outLeft: false, outRight: true } }];
const rRiro = assignWithDriveways(site, dests, segsX, riro, {});
ok(rRiro.reroutes.length > 0, "RIRO driveway forces at least one reroute");
ok(rRiro.driveways[0].reroutedTrips > 0, "the RIRO driveway records rerouted trips");
const totRiro = rRiro.perDestinationAddedTrips.reduce((s, v) => s + v, 0);
ok(Math.abs(totRiro - 200) < 1e-6, `reroute conserves total trips (got ${totRiro})`);
```

- [ ] **Step 2: Run test to verify it fails.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveway-routing.mjs`
Expected: FAIL — `assignWithDriveways is not a function`.

- [ ] **Step 3: Implement `assignWithDriveways`.** Add to `network-assignment.ts` (uses the driveway helpers + `bearingBetween`):

```ts
import { classifyMovement, sideOfStreet, resolveMovements, type Driveway } from "./driveways";

function bearingBetween(la1: number, lo1: number, la2: number, lo2: number): number {
  const φ1 = (la1 * Math.PI) / 180, φ2 = (la2 * Math.PI) / 180, Δλ = ((lo2 - lo1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export type DrivewayResult = {
  drivewayNode: number; label: string;
  enterByMovement: { inLeft: number; inRight: number };
  exitByMovement: { outLeft: number; outRight: number };
  reroutedTrips: number;
};
export type DrivewayAssignment = {
  available: boolean;
  perDestinationAddedTrips: number[];
  driveways: DrivewayResult[];
  reroutes: { destIndex: number; trips: number }[];
};

export function assignWithDriveways(
  site: { lat: number; lon: number },
  destinations: RouteDestination[],
  segments: RoadSegment[],
  driveways: Driveway[],
  opts: { volumeRefs?: VolumeRef[] } = {},
): DrivewayAssignment {
  const perDest = destinations.map(() => 0);
  const empty: DrivewayAssignment = { available: false, perDestinationAddedTrips: perDest, driveways: [], reroutes: [] };
  if (segments.length === 0 || destinations.length === 0 || driveways.length === 0) return empty;

  const g = buildGraph(segments, opts.volumeRefs ?? []);
  if (g.links.length === 0) return empty;
  const siteNode = g.nodeOf(site.lat, site.lon);

  // Insert driveways, capturing fronting-street bearing + site side per driveway.
  type DW = { node: number; label: string; streetBearing: number; side: 1 | -1; mv: ReturnType<typeof resolveMovements>;
             enterByMovement: { inLeft: number; inRight: number }; exitByMovement: { outLeft: number; outRight: number }; rerouted: number };
  const dws: DW[] = driveways.map((d) => {
    const { drivewayNode, streetBearing } = insertDriveway(g, siteNode, d.latitude, d.longitude);
    const drivewayToSite = bearingBetween(d.latitude, d.longitude, site.lat, site.lon);
    const side = sideOfStreet(streetBearing, drivewayToSite);
    return { node: drivewayNode, label: d.label ?? d.id, streetBearing, side, mv: resolveMovements(d),
             enterByMovement: { inLeft: 0, inRight: 0 }, exitByMovement: { outLeft: 0, outRight: 0 }, rerouted: 0 };
  });

  const nearestDestTo = (node: number): number => {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < destinations.length; i++) {
      const d = distMi(g.nodeLat[node]!, g.nodeLon[node]!, destinations[i]!.lat, destinations[i]!.lon);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  };
  const reroutes: { destIndex: number; trips: number }[] = [];

  for (let i = 0; i < destinations.length; i++) {
    const d = destinations[i]!;
    const odBearing = bearingBetween(site.lat, site.lon, d.lat, d.lon);
    // Outbound leg: which driveways can serve a trip leaving toward this destination?
    const eligible = dws.filter((dw) => {
      const mvNeeded = classifyMovement(dw.streetBearing, dw.side, odBearing, false); // "outLeft" | "outRight"
      return dw.mv[mvNeeded];
    });
    if (eligible.length > 0) {
      // Nearest eligible driveway carries the trip; count its exit movement.
      const dw = eligible.reduce((a, b) =>
        distMi(g.nodeLat[a.node]!, g.nodeLon[a.node]!, d.lat, d.lon) <= distMi(g.nodeLat[b.node]!, g.nodeLon[b.node]!, d.lat, d.lon) ? a : b);
      const mv = classifyMovement(dw.streetBearing, dw.side, odBearing, false) as "outLeft" | "outRight";
      dw.exitByMovement[mv] += d.trips;
      perDest[i]! += d.trips;
    } else {
      // Forbidden everywhere ⇒ reroute via the nearest driveway + U-turn.
      const dw = dws.reduce((a, b) =>
        distMi(g.nodeLat[a.node]!, g.nodeLon[a.node]!, d.lat, d.lon) <= distMi(g.nodeLat[b.node]!, g.nodeLon[b.node]!, d.lat, d.lon) ? a : b);
      dw.rerouted += d.trips;
      // The U-turn happens at the nearest downstream node to the driveway; its
      // added turning volume lands on the destination nearest that node.
      const uturnDest = nearestDestTo(dw.node);
      perDest[uturnDest]! += d.trips;
      reroutes.push({ destIndex: uturnDest, trips: d.trips });
    }
  }

  return {
    available: true,
    perDestinationAddedTrips: perDest,
    driveways: dws.map((dw) => ({ drivewayNode: dw.node, label: dw.label, enterByMovement: dw.enterByMovement, exitByMovement: dw.exitByMovement, reroutedTrips: dw.rerouted })),
    reroutes,
  };
}
```

- [ ] **Step 4: Run test to verify it passes.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveway-routing.mjs && npx tsc -p tsconfig.json --noEmit`
Expected: all PASS (full access conserves 200 trips with no reroute; RIRO forces ≥1 reroute, records rerouted trips, still conserves 200). If the eligible/forbidden split is inverted, the movement geometry (Task 3) is the oracle — re-check `classifyMovement` mapping, not the test. **Refine `streetBearing` derivation** if a case is wrong: prefer the split link's actual a→b bearing over the ⟂ approximation (read the split link endpoints and compute `bearingBetween` on them).

- [ ] **Step 5: Refactor + commit.** Replace the `streetBearing` ⟂-approximation with the split link's true bearing (compute from the two nodes of the reshaped `a→dn` link) if Step 4 needed it; re-run green. Then:

```bash
git add artifacts/tis-api-server/src/lib/network-assignment.ts artifacts/tis-api-server/scripts/verify-driveway-routing.mjs
git commit -m "feat(tis): turn-aware driveway routing with U-turn reroute"
```

---

## Task 7: `tis.ts` — wire driveway assignment into LOS + result payload

When `req.driveways` is present, run `assignWithDriveways` and use `perDestinationAddedTrips[i]` as intersection `i`'s project load (feeding `addedTrips → v/c → LOS`), and attach a `driveways` result payload. Absent ⇒ unchanged.

**Files:**
- Modify: `artifacts/tis-api-server/src/lib/tis.ts` (the assignment block ~1226–1290 + `buildAffectedRow` load + the return + `TisReport` type)
- Modify: `artifacts/tis-api-server/scripts/verify-driveway-routing.mjs` (E2E stub run, mirroring the gravity-model harness)

**Interfaces:**
- Consumes: `assignWithDriveways`, `DrivewayAssignment` (Task 6); `req.driveways` (Task 1); `buildAffectedRow` (existing).
- Produces: `TisReport.driveways?: { assignment: DrivewayResult-summary; reroutes: ... }` and driveway-driven `addedTrips`.

- [ ] **Step 1: Write the failing E2E assertion.** Extend `verify-driveway-routing.mjs` with an esbuild-bundled engine run (copy the harness pattern from the Caltran gravity smoke: stub `/api/roads` + `/api/intersections`, `NODE_ENV=production`, dummy `DATABASE_URL`). Assert: a request WITH a RIRO driveway yields at least one intersection whose `addedTripsPmPeak` increased vs the same request WITHOUT driveways (the rerouted U-turn volume), and a request with `driveways: []` is identical to no-driveways. (Full harness code lives in the scratchpad gravity smoke; adapt it.)

- [ ] **Step 2: Run to verify it fails.** The new assertion fails because `tis.ts` ignores `req.driveways`.

- [ ] **Step 3: Implement the wiring.** In `tis.ts`, after the existing `loadWeights` computation, add:

```ts
import { assignWithDriveways, type DrivewayAssignment } from "./network-assignment";
// ... after loadWeights is built, before the period loop:
let drivewayAssignment: DrivewayAssignment | undefined;
if (Array.isArray(req.driveways) && req.driveways.length > 0) {
  try {
    const segs = await fetchLocalRoads(region.code, req.latitude, req.longitude, radiusMi);
    if (segs) {
      const dests = candidates.map((c) => ({ lat: c.sig.latitude, lon: c.sig.longitude, trips: 1 }));
      drivewayAssignment = assignWithDriveways({ lat: req.latitude, lon: req.longitude }, dests, segs, req.driveways, { volumeRefs: candidates.filter(c => c.sig.totalVolume > 0).map(c => ({ lat: c.sig.latitude, lon: c.sig.longitude, aadt: c.sig.totalVolume })) });
    }
  } catch { /* roads unavailable — driveway rerouting degrades to base loading */ }
}
```

Then in the per-intersection load: when `drivewayAssignment?.available`, replace `loadWeights[i]` with a driveway-derived weight — normalize `perDestinationAddedTrips` to a share and multiply by the existing near-site decay so magnitude stays sane:

```ts
const dwShare = drivewayAssignment?.available
  ? (() => { const tot = drivewayAssignment.perDestinationAddedTrips.reduce((s, v) => s + v, 0) || 1;
             return drivewayAssignment.perDestinationAddedTrips.map((v) => v / tot); })()
  : null;
// in the buildAffectedRow map: const w = dwShare ? clamp(dwShare[i]! * candidates.length * intersectionLoadFraction(c.distanceMi), 0, 1) : loadWeights[i]!;
```

Add `driveways` to `TisReport` and the return: `...(drivewayAssignment ? { driveways: { driveways: drivewayAssignment.driveways, reroutes: drivewayAssignment.reroutes } } : {})`.

- [ ] **Step 4: Run E2E + typecheck to verify pass.**

Run: `cd artifacts/tis-api-server && node scripts/verify-driveway-routing.mjs && npx tsc -p tsconfig.json --noEmit`
Expected: RIRO run shows an intersection with increased `addedTripsPmPeak`; `driveways: []` identical to baseline; tsc 0.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/tis-api-server/src/lib/tis.ts artifacts/tis-api-server/scripts/verify-driveway-routing.mjs
git commit -m "feat(tis): route project trips through driveways and reflect reroutes in LOS"
```

---

## Task 8: `pdf-export.ts` — driveway access table

Render a driveway access table (driveway, access type, allowed movements, entering/exiting volumes) when `result.driveways` is present. (The full site-access figure is Phase 3 — this is the minimal textual deliverable.)

**Files:**
- Modify: `artifacts/tis-api-server/src/lib/pdf-export.ts` (in `dispatchTisRender`, after the regional renderer)
- Modify: `artifacts/tis-api-server/scripts/verify-driveway-routing.mjs` (assert the rendered PDF contains the table)

**Interfaces:**
- Consumes: `result.driveways` (Task 7), the existing `gaSubsection`/`table` helpers.

- [ ] **Step 1: Write the failing test.** In the E2E harness, render the RIRO-driveway report to a PDF (reuse the gravity-smoke PDF path) and assert `pdftotext` output contains "Site Access" and the driveway label.

- [ ] **Step 2: Run to verify it fails.** No driveway table rendered yet.

- [ ] **Step 3: Implement the table.** In `dispatchTisRender`, after `selectRegionalTisRenderer`, add:

```ts
const dw = (result as any).driveways;
if (dw && Array.isArray(dw.driveways) && dw.driveways.length > 0) {
  gaSubsection(doc, "Site Access — Driveways");
  table(doc, {
    headers: ["Driveway", "Enter L / R", "Exit L / R", "Rerouted"],
    widths: [220, 110, 110, 80],
    align: ["left", "right", "right", "right"],
    rows: dw.driveways.map((d: any) => [
      String(d.label ?? "—"),
      `${Math.round(d.enterByMovement?.inLeft ?? 0)} / ${Math.round(d.enterByMovement?.inRight ?? 0)}`,
      `${Math.round(d.exitByMovement?.outLeft ?? 0)} / ${Math.round(d.exitByMovement?.outRight ?? 0)}`,
      String(Math.round(d.reroutedTrips ?? 0)),
    ]),
  });
  if (Array.isArray(dw.reroutes) && dw.reroutes.length > 0) {
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      `${dw.reroutes.reduce((s: number, r: any) => s + (r.trips || 0), 0)} project trips reroute as U-turns where a driveway forbids the required movement.`,
      { paragraphGap: 6 });
    doc.fillColor("black");
  }
}
```

- [ ] **Step 4: Run to verify it passes.** The rendered PDF contains "Site Access — Driveways" + the label. Run full `npx tsc -p tsconfig.json --noEmit`.

- [ ] **Step 5: Commit.**

```bash
git add artifacts/tis-api-server/src/lib/pdf-export.ts artifacts/tis-api-server/scripts/verify-driveway-routing.mjs
git commit -m "feat(tis): driveway access table in the report"
```

---

## Self-review notes (author checklist — resolved)

- **Spec coverage:** §3 data model → Tasks 1–2; §4 auto-detect → *deferred to the Phase-2 frontend plan* (needs the map; Phase 1 accepts driveways from any client); §5 routing engine → Tasks 5–6; §6 LOS wiring → Task 7; §8 report → Task 8 (table only; figure is Phase 3); §10 testing → verify scripts in every task; §11 opt-in guard → Task 7 Step 4 (`driveways: []` identical) + Global Constraints.
- **Deferred by design (documented, not gaps):** the interactive map + auto-detect endpoint (Phase 2 plan), the site-access figure (Phase 3 plan), network one-way/turn fidelity (external analyzer).
- **Type consistency:** `Movements`/`resolveMovements`/`classifyMovement` names are used identically in Tasks 2/3/6; `Graph`/`buildGraph`/`insertDriveway`/`assignWithDriveways` signatures match across Tasks 5–7; `perDestinationAddedTrips` aligns index-wise with `candidates` in Task 7.
- **Placeholders:** the only intentionally-abbreviated step is Task 7 Step 1 / Task 8 Step 1 (E2E harness "adapt the gravity smoke") — the harness is a known, working artifact in the scratchpad; the implementer copies it. All algorithmic code is complete.

## Execution note

Task 6 is the risk-bearing task (turn geometry + reroute). Its verify script is the oracle; if a movement classifies wrong, fix `classifyMovement` (Task 3) against the concrete compass cases, not the test. Recommend a review checkpoint after Task 6 before wiring LOS (Task 7).
