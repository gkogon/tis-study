# Multi-region expansion playbook

The product launched on the Atlanta MSA but the engineering math
(HCM 6th Ed., ITE 11th Ed., MUTCD) is universal. This doc maps what
has to change to launch the next metro, in priority order, with rough
effort estimates.

The product is engineered around the assumption that most of the
engine is region-agnostic. Region-specific pieces are isolated to:

1. **Jurisdictional copy** — strings in PDFs, methodology notes,
   parking-code citations.
2. **Geographic bounds** — the lat/lon box a project site must fall in.
3. **Live traffic data source** — which state-DOT API the analyzer
   service queries.
4. **Intersection inventory** — the signalized-intersection list the
   screening engine iterates.
5. **Marketing copy** — "Atlanta engineering firms" on home/for-firms.

Categories 1–2 are owned by [`lib/regions.ts`](artifacts/tis-api-server/src/lib/regions.ts).
Category 3 is owned by [`artifacts/api-server`](artifacts/api-server)
(the analyzer service). Categories 4–5 are per-metro work the first
time a region ships.

---

## Order to launch a new metro

### Step 0 — confirm there's a customer (1 day, sales)

Don't build before signal. Get verbal commitment from at least two
firms in the target metro who'd pay Starter+ at launch. Without that,
the per-state DOT integration is overpriced engineering.

### Step 1 — activate the region in code (1–2 hours)

In [`artifacts/tis-api-server/src/lib/regions.ts`](artifacts/tis-api-server/src/lib/regions.ts):

1. Fill in real `bounds` for the metro (Google "Charlotte metro
   bounding box" or use the state DOT's published MSA shapefile).
2. Verify the jurisdictional copy (`dotName`,
   `planningOfficeName`, `parkingCodeCitation`) matches actual local
   ordinances.
3. Flip `active: false` → `active: true`.

That's enough to render PDFs with the right city name and pass the
runtime `regionForCoordinate` check.

### Step 2 — wire the DOT data fetcher (1–2 weeks)

The hardest step. Each state DOT has its own API contract for live
traffic / incident / camera data. The Atlanta integration uses GDOT
511 NaviGAtor v2; comparable APIs for the southeastern states:

| State | DOT API | Notes |
|---|---|---|
| GA | GDOT 511 NaviGAtor v2 | ✅ Wired. API key required. |
| NC | NCDOT TIMS API | Free dev key; comparable feature coverage. |
| TN | TDOT SmartWay API | OAuth-gated; quota lower than GDOT. |
| AL | ALDOT 511 | Lower-quality data; check before launching Birmingham. |
| FL | FDOT FL511 / SunGuide | Multiple feeds (statewide + regional); pick the metro-local one. |
| SC | SCDOT 511 | Limited feed; ok for screening, weak for monitoring. |

In `artifacts/api-server`, add a fetcher module per state. Map
`region.dataSourceId` → fetcher. Keep the response normalized to the
existing `AnalyzerIntersection` shape so the engine sees no change.

### Step 3 — load the intersection inventory (2–4 days per metro)

Each metro needs a one-time data load of signalized intersections:
signal ID, lat/lon, controlling agency, base volumes. Sources:

- State DOT pre-qualified consultant data (sometimes shared on request).
- Each city's open-data portal (City of Atlanta has one; Charlotte
  publishes via Open Charlotte, Nashville via OpenDataNashville).
- Manual scrape from Google Street View as a last resort.

Persist to the same `intersections` table the analyzer uses today, with
a `region_code` column (see Step 4).

### Step 4 — schema migration: add region_code (~30 min, one-time)

Today every firm and every project is implicitly Atlanta. When the
second region ships, add a `region_code` column to `firms` and
`tis_projects`, defaulted to `'atlanta_metro'`. Drizzle migration:

```sql
ALTER TABLE firms
  ADD COLUMN region_code VARCHAR(32) NOT NULL DEFAULT 'atlanta_metro';

ALTER TABLE tis_projects
  ADD COLUMN region_code VARCHAR(32) NOT NULL DEFAULT 'atlanta_metro';
```

Then update `getActiveRegion()` in `lib/regions.ts` to take the firm
(or project) and look up the right region instead of always returning
Atlanta.

### Step 5 — loosen the OpenAPI lat/lon bounds (~15 min)

Currently `openapi.yaml` constrains latitude to 33.4–34.2 and
longitude to -84.9 to -83.9 (the Atlanta box). When the second region
goes live, widen those to a continental-US box (lat 24–49, lon -125
to -66) and let the runtime `regionForCoordinate` check enforce the
actual per-region bounds. Then run `pnpm --filter
@workspace/tis-api-spec run codegen` to regenerate the Zod schemas.

### Step 6 — marketing copy (1–2 days per metro)

Search the frontend for "Atlanta":

```
grep -rn "Atlanta" artifacts/atlanta-tis/src --include="*.tsx"
```

Most occurrences are on `home.tsx`, `for-firms.tsx`, `about.tsx`, and
`pricing.tsx`. Either:

- Make them metro-agnostic ("Southeastern engineering firms"), or
- Build per-metro landing pages with the metro name in URLs:
  `/charlotte`, `/nashville`, etc.

Per-metro landing pages are better for SEO and conversion but cost
more to maintain. Start metro-agnostic for the first 2–3 expansions.

### Step 7 — workspace rename (optional, ~1 day)

The frontend workspace is named `@workspace/atlanta-tis` everywhere.
Cosmetic but distracting. Rename to `@workspace/tis-app` when there's
a calm refactor window.

---

## Regions registered (status snapshot)

| Code | Metro | Status | Blocking item |
|---|---|---|---|
| `atlanta_metro` | Atlanta MSA | ✅ Live | — |
| `charlotte_metro` | Charlotte MSA | Scaffolded only | Bounds + NCDOT fetcher |
| `nashville_metro` | Nashville MSA | Scaffolded only | Bounds + TDOT fetcher |
| `birmingham_metro` | Birmingham MSA | Scaffolded only | Bounds + ALDOT fetcher |
| `jacksonville_metro` | Jacksonville MSA | Scaffolded only | Bounds + FDOT fetcher |
| `knoxville_metro` | Knoxville MSA | Scaffolded only | Bounds + TDOT fetcher (shared) |
| `greenville_metro` | Greenville MSA | Scaffolded only | Bounds + SCDOT fetcher |
| `chattanooga_metro` | Chattanooga MSA | Scaffolded only | Bounds + TDOT fetcher (shared) |

Tennessee metros share `tdot` as the data-source ID, so once the TDOT
fetcher is built, Nashville/Knoxville/Chattanooga all activate
roughly together.

---

## Anti-patterns (don't do this)

- **Hardcoding region strings in copy.** Always reach for
  `getActiveRegion().jurisdiction.<thing>` so the same template
  works for every region.
- **Per-region forks.** No `tis-charlotte.ts`, `tis-nashville.ts`.
  The engine is one file; the region is data.
- **Launching a metro without monitoring data.** If the analyzer's
  state-DOT integration is broken, the post-build verification SKU
  (`/monitoring`) silently degrades and customers churn quietly. Run
  a smoke test before flipping `active: true`.
- **Pricing differently by metro at launch.** Same pricing
  everywhere — geographic price discrimination buys a small revenue
  bump and a lot of customer-confusion overhead. Revisit only after
  $1M ARR.
