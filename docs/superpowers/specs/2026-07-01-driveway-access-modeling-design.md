# Driveway Access Modeling — Design Spec

> **Date:** 2026-07-01 · **Status:** Approved design, pre-implementation.
> **Feature:** Let a user place a development's driveways on a map, set each driveway's
> allowed turning movements, and have those restrictions reroute project trips through the
> road network so the affected intersections' volumes and LOS change accordingly.

## 1. Summary & goals

A real Traffic Impact Study lays the proposed building out on a map with **driveways** (site
access points), each with an access type (full movement, right-in/right-out, etc.). The
project's trips enter and exit through those driveways, and access restrictions push forbidden
movements onto the network (e.g. a right-in/right-out driveway forces left-turn demand to
U-turn at the nearest signal), which changes that intersection's operations.

Today the TIS engine models the site as a **single point with one implicit access**
(`trip-loading.ts`: "every project trip enters and exits at the SITE") and has no driveway
concept. This feature adds it.

**Goals**
- Place/select driveways for a site and set each one's allowed movements.
- Route project trips through driveways on the actual road graph, with per-driveway turn
  restrictions enforced and forbidden movements rerouted (U-turns) onto the network.
- Feed the rerouted volumes into per-intersection `addedTrips → v/c → delay → LOS` so
  driveway access actually changes study results.
- Render the site-access figure + driveway table in the report.

**Non-goals (explicitly out of scope for this feature)**
- Driveway-level LOS / turn-lane storage / signal-warrant *at the driveway itself* (the
  deferred "driveway LOS" gap — a later feature; this feature produces the input it needs).
- A full site-plan / building-footprint editor. We model access points, not the building.
- Network-wide one-way and turn-restriction fidelity — gated on the external analyzer
  service supplying that data (see §9). The engine is built to use it when available and
  degrades gracefully (undirected) until then.

## 2. Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Driveway input | **Auto-detect candidate access points** near the site, user **selects / edits / repositions** |
| Effect depth | **Reroute onto the network** — forbidden movements change the affected intersection's LOS |
| Access vocabulary | **Presets + custom** — standard access types, with an advanced per-movement expand |
| Reroute engine | **Full graph routing** — driveways as real graph nodes, restrictions enforced during path search |
| Region scope | **Global** (driveways are a general TIS concept, not FL-gated) |

## 3. Data model & API

Add `driveways` to `TisRequest` in `lib/tis-api-spec/openapi.yaml`, then `pnpm run codegen`
(regenerates the React client types **and** the backend zod validators — same pipeline as the
existing `tripProfile` field). Absent `driveways` ⇒ current single-site behavior, unchanged.

```ts
driveways?: Array<{
  id: string;                    // client-generated stable id
  latitude: number;              // -90..90, 4dp (round4, matches site coords)
  longitude: number;             // -180..180, 4dp
  label?: string;                // "Driveway A" / fronting street; auto-filled
  accessType: "full" | "riro" | "three_quarter" | "entrance_only" | "exit_only" | "custom";
  movements: {                   // allowed movements, RELATIVE TO THE FRONTING STREET
    inLeft: boolean;             // left turn INTO the site from the fronting street
    inRight: boolean;            // right turn in
    outLeft: boolean;            // left turn OUT onto the fronting street
    outRight: boolean;           // right turn out
  };
}>;
```

`accessType` presets expand to `movements` (the server is authoritative; the client mirrors
for UI):

| preset | inLeft | inRight | outLeft | outRight |
|---|:-:|:-:|:-:|:-:|
| `full` | ✓ | ✓ | ✓ | ✓ |
| `riro` (right-in/right-out) | | ✓ | | ✓ |
| `three_quarter` (RIRO + left-in) | ✓ | ✓ | | ✓ |
| `entrance_only` | ✓ | ✓ | | |
| `exit_only` | | | ✓ | ✓ |
| `custom` | user-set four toggles | | | |

**Validation (zod):** every driveway needs at least one allowed movement; coordinates within
bounds; array capped (e.g. ≤ 12 driveways) to bound compute. Movements are stored explicitly
so the engine never has to re-derive presets.

## 4. Auto-detect candidate access points (backend)

New endpoint **`POST /driveway-candidates`** `{ latitude, longitude, radiusMi? }` →
`{ candidates: Driveway[] }`.

Algorithm: fetch the local road segments (reuse `fetchLocalRoads`), find the road edges whose
nearest point is within ~0.1 mi of the site (the **fronting streets**), and emit one candidate
access point per distinct fronting street — snapped to the nearest point on that street,
labelled with the street name, defaulting to `accessType: "full"`.

**Honesty:** OSM rarely maps private driveways, so these are candidate **access points on the
fronting streets**, not detected private driveways. The UI says so; the user repositions /
edits / adds. If road data is unavailable, return an empty candidate list and let the user
place driveways manually (the map still works).

## 5. Routing engine — `driveways.ts` + `network-assignment.ts`

Today `assignRoutes` (in `network-assignment.ts`) builds an **undirected node-link graph**,
snaps the single site to the nearest node, runs Dijkstra + MSA equilibrium loading, and returns
a corridor summary that is **visualization-only** (never touches LOS). We extend it:

1. **Driveway-node insertion.** For each driveway: snap to the nearest road **edge** (not just
   node), split that edge at the snap point (two sub-edges + a new node), and add a short
   **access link** from the site to the driveway node. The site connects to the network *only*
   through driveway nodes when driveways are present. The snapped edge gives the driveway its
   **fronting-street bearing**, and the site's position relative to that bearing gives the
   driveway's **side of street** — together these map a trip's compass origin/destination to a
   concrete in/out × left/right movement (e.g. on a south-side driveway of an east–west street,
   a trip from the west enters via a right turn, a trip from the east via a left turn), which is
   what the `movements` restrictions are checked against.
2. **Turn enforcement at driveways.** Extend the path search to track the **predecessor link**
   so a movement through a driveway node is validated against that driveway's `movements`. A
   forbidden movement is simply not a legal transition. (Turn enforcement applies at driveway
   nodes; network-interior turns stay unrestricted until the analyzer provides turn data.)
3. **U-turn / reroute edges.** Add synthetic **penalized U-turn edges** at nodes so a movement
   forbidden at every eligible driveway routes to the nearest median/signal and turns around —
   a real path on the graph, not a heuristic. The U-turn's cost reflects the detour distance.
4. **Per-driveway loading.** Split the site's project trips (in vs out, and by the directional
   distribution) and load them through eligible driveways by shortest path under the turn
   constraints. Each driveway accrues entering/exiting volume by movement.
5. **One-way awareness.** Undirected today (graceful degradation). When the analyzer supplies a
   `oneway` flag on segments, build directed edges instead. Documented fidelity limit, not a
   blocker.

**New module `driveways.ts`** owns: preset→movements expansion, driveway-node insertion,
turn-legality checks, U-turn edge synthesis, and the driveway-loading roll-up. `network-
assignment.ts` gains the directed/turn-aware path-search variant. Keep the modules focused so
each is independently testable.

## 6. Wiring into LOS — `tis.ts` (the decisive change)

When `req.driveways` is present:
- run the driveway-aware assignment, which returns, per study intersection, the **added project
  volume including rerouted U-turn movements**;
- that per-intersection added volume feeds `buildAffectedRow`'s trip load (→ `addedTrips → v/c
  → delay → LOS`), replacing the site-point distance-decay loading for the driveway case.

When `req.driveways` is absent, the current behavior is untouched. The report also gains a
`driveways` result payload (per-driveway volumes by movement + reroute notes) for rendering.

## 7. Frontend — `artifacts/atlanta-tis/src/pages/tis.tsx`

Today the Leaflet map is **results-only**. Add an **interactive map to the input form**:
- site marker + **draggable** candidate-driveway markers (first use of `useMapEvents` /
  draggable `Marker` in the app — build with standard react-leaflet);
- an **"Auto-detect driveways"** button (enabled after geocode) that calls
  `/driveway-candidates` and drops the candidates;
- a per-driveway panel: **access-type preset dropdown** + an **"Advanced"** expand with the
  four movement checkboxes; **add / delete / reposition**;
- driveways stored in form state and attached to the request (`round4` coords, same as site).

Follows the existing collapsible-advanced-section form pattern; lives alongside the (still
unused) `tripProfile` control slot.

## 8. Report — `pdf-export.ts`

- **Site-access figure:** the site with its driveways, each labelled with entering/exiting
  **AM (PM)** volumes — the Caltran site-plan inset style (`18 (17)`, `5 (5)`, …).
- **Driveway access table:** driveway, access type, allowed movements, entering/exiting
  volumes.
- **Reroute notes** at affected intersections: e.g. "+12 left-turns rerouted from Driveway A
  (right-in/right-out) as U-turns at NW 82 Ave."

## 9. Phasing

Built in verifiable slices; each is a shippable PR.

1. **Backend end-to-end (M–L).** `openapi.yaml` schema + `driveways.ts` graph routing + turn
   enforcement + U-turn reroute + LOS wiring in `tis.ts` + a basic driveway table in the
   report. Fully testable through the API with no UI.
2. **Frontend map UX (M).** Form map, auto-detect, select/edit/reposition, access controls.
3. **Report polish (S–M).** The site-access figure with per-driveway volumes.

**Deferred (external dependency):** network-wide one-way + turn-restriction fidelity, gated on
the external analyzer `/roads` endpoint supplying `oneway` + turn data. The engine is built to
consume it; until then the network interior is routed undirected.

## 10. Testing

Repo convention = standalone `scripts/verify-*.mjs` (no test runner). Plan:
- `verify-driveways.mjs` (pure): preset→movements expansion; turn-legality (a RIRO driveway
  rejects in-left/out-left); U-turn edge synthesis; a small hand-built graph where a forbidden
  movement is proven to reroute to the expected node.
- Engine E2E (esbuild-bundled harness, per the gravity-model precedent): a synthetic site with
  driveways; assert (a) full-access driveways ⇒ no reroute and volumes match the no-driveway
  baseline within tolerance; (b) a RIRO driveway ⇒ left demand shows up as added U-turn volume
  at the nearest signal and that signal's LOS degrades; (c) absent `driveways` ⇒ byte-identical
  to today.
- Full `tsc` typecheck; a rendered sample PDF showing the driveway figure/table.

## 11. Risks & guardrails

- **Regression on non-driveway studies.** The driveway path must be strictly opt-in
  (`req.driveways` present). Guardrail: E2E test (c) asserts identical output when absent.
- **Graph quality / sparse roads.** `fetchLocalRoads` is best-effort and can be empty. Guardrail:
  no candidates + manual placement still works; if a driveway can't snap to any edge, fall back
  to connecting it to the nearest node and note reduced fidelity.
- **Compute blow-up.** Edge-splitting + U-turn edges + per-driveway loading on many driveways.
  Guardrail: cap driveways (≤12), bound the graph to the study radius (already done), keep MSA
  iterations small.
- **Over-claiming fidelity.** Undirected network interior + no network turn restrictions.
  Guardrail: the methodology prose states the driveway turn model is enforced at driveways and
  the network is routed undirected pending analyzer turn data.
- **Coordinate precision.** Driveways snapped to 5-dp graph nodes; use the same `round4` on
  input coords as the site to avoid spatial-index precision bugs (documented footgun).

## 12. Open questions (resolved)

- *Which movements does a driveway restrict?* The four street-relative movements (in/out ×
  left/right); presets expand to these; `custom` exposes them directly.
- *Do restrictions change LOS or just the figure?* Change LOS (reroute wired into `addedTrips`).
- *FL-only or global?* Global.
- *Real graph routing or analytic?* Real graph routing (driveways as nodes; restrictions
  enforced in the path search; U-turns as graph edges).
