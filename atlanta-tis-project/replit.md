# Atlanta Traffic Analysis and Prediction

An application to analyze and visualize traffic efficiency, predict future congestion, and simulate optimization strategies for the Atlanta metropolitan area.

## Run & Operate

- **Run Dev Server**: `pnpm dev`
- **Build**: `pnpm build`
- **Typecheck**: `pnpm typecheck`
- **Codegen (API)**: `pnpm orval` (generates types and hooks from OpenAPI spec)
- **DB Push**: `pnpm drizzle-kit push:pg` (schema migrations)

**Required Environment Variables**:
- `GDOT_511_API_KEY`: API key for GDOT 511 v2.
- `SESSION_SECRET`: Server-side secret for the TIS auth session cookie (`tis_sid`).
- `REPL_ID`, `ISSUER_URL`, `REPLIT_DOMAINS`: Replit Auth (OIDC) — auto-provided by the runtime.
- `ADMIN_EMAILS` (optional, comma-sep): Email allow-list for `/admin` and `/tis-api/leads/list`.

> **Stripe billing was removed** until the user completes Stripe verification + adds banking info. Auth still gates `/tis-api/generate`, but every signed-in user gets unlimited generations. To restore: re-add `stripe` + `stripe-replit-sync` deps in `tis-api-server` and `scripts`, restore `lib/stripe-billing.ts` / `lib/stripe-client.ts` / `routes/billing.ts` / `routes/stripe-webhook.ts` / `pages/pricing.tsx` / `pages/checkout-success.tsx` from git history (commit `b637804` or earlier), re-mount the webhook router before `express.json()` in `app.ts`, and re-add the `/billing/*` paths + `Entitlement` / `CheckoutSession*` schemas to `lib/tis-api-spec/openapi.yaml`.

## Stack

- **Monorepo**: pnpm workspaces
- **Runtime**: Node.js 24
- **Language**: TypeScript 5.9
- **API Framework**: Express 5
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Validation**: Zod (v4) & drizzle-zod
- **API Codegen**: Orval
- **Build Tool**: esbuild (CJS bundle)
- **UI Framework**: React + Vite
- **Mapping**: react-leaflet@5
- **Charting**: Recharts
- **Tables**: TanStack Table

## Where things live

- **API Server**: `artifacts/api-server/src`
- **Frontend Dashboard**: `artifacts/atlanta-traffic/src`
- **Database Schema**: `artifacts/api-server/src/db/schema.ts`
- **API Contracts (OpenAPI)**: `lib/api-spec/openapi.yaml`
- **TIS API Server**: `artifacts/tis-api-server/src` (mounted at `/tis-api/*`, port 8090). Routes: `GET /healthz`, `GET /land-uses`, `POST /generate`, `POST /leads`. Pulls intersection inventory from the analyzer at `ANALYZER_API_URL` (default `http://localhost:8080`) on first request and caches it for the process lifetime.
- **TIS Frontend**: `artifacts/atlanta-tis/src` (mounted at `/tis/`). Pages: `/` (Home), `/pricing`, `/for-firms`, `/tis`. Uses `@workspace/tis-api-client-react`.
- **TIS API Spec**: `lib/tis-api-spec/openapi.yaml` → generates `@workspace/tis-api-zod` and `@workspace/tis-api-client-react`. Codegen: `pnpm --filter @workspace/tis-api-spec run codegen`.
- **For-Firms landing**: `artifacts/atlanta-tis/src/pages/for-firms.tsx` (engineering-firm marketing pitch)
- **Trial-request form**: `artifacts/atlanta-tis/src/components/trial-request-form.tsx` (POSTs to `/tis-api/leads`)
- **Firm branding (localStorage)**: `artifacts/atlanta-tis/src/lib/firm-branding.ts` + `components/firm-settings-modal.tsx`
- **TIS branded cover page**: `artifacts/atlanta-tis/src/components/tis-cover-page.tsx`
- **TIS citations system**: `artifacts/atlanta-tis/src/lib/tis-citations.ts` + `components/citation-ref.tsx`
- **TIS methodology appendix**: `artifacts/atlanta-tis/src/components/tis-methodology-appendix.tsx` (Appendix A)
- **TIS limitations & assumptions**: `artifacts/atlanta-tis/src/components/tis-limitations.tsx` (Appendix B)
- **TIS Logic**: `artifacts/tis-api-server/src/lib/tis.ts` (Phase 1: per-period trip gen, approach split via bearing-similarity, HCM 19-50 queue, weather/growth multipliers, Monte-Carlo sensitivity)
- **Lead Capture Data**: `artifacts/tis-api-server/data/atlanta-leads.json`
- **Prediction History**: `artifacts/api-server/data/prediction-history.json`
- **Traffic Analysis Logic**: `artifacts/api-server/src/lib/atlanta-analysis.ts` (analyzer only — TIS moved to `tis-api-server`)
- **Signal Cross-Street Naming**: `artifacts/api-server/src/lib/atlanta-signal-naming.ts` (snaps signals to nearest two named roads; output cached at startup)
- **Roads Inventory (OSM dump)**: `artifacts/api-server/src/data/atlanta-roads.json` (regenerate with `pnpm --filter @workspace/scripts run fetch-roads`)
- **Traffic Flow Logic**: `artifacts/api-server/src/lib/atlanta-traffic-flow.ts`
- **Parking Logic**: `artifacts/api-server/src/lib/atlanta-parking.ts` (snapshot cache + per-archetype occupancy curves)
- **Parking Inventory (OSM dump)**: `artifacts/api-server/src/data/atlanta-parking.json` (regenerate with `pnpm --filter @workspace/scripts run fetch-parking`)

## Architecture decisions

- **Monorepo Structure**: Uses pnpm workspaces for better dependency management and code sharing across different services (API, UI).
- **No Database for Core Analysis**: Signal attributes and volumes are deterministically generated using a PRNG seeded by OSM ID, ensuring stable refreshes without a persistent database.
- **In-Memory Caching for Live Traffic**: Traffic flow data is cached in-memory and via HTTP caching (ETag, Last-Modified, Cache-Control) for performance.
- **Atomic File Writes for Lead Capture**: Ensures data integrity during concurrent writes and system crashes by using a promise-chain mutex and atomic temp-file write + rename.
- **Integrated Prediction Feedback Loop**: Prediction model incorporates recency-weighted incident counts, spatial corridor boosts, and live congestion calibration to continuously improve accuracy.
- **Print-Optimized Reporting**: Key reports like "Executive Summary" and "Backtest Credibility" are designed with specific print stylesheets for easy PDF generation.

## Product

- **Traffic Inefficiency Visualization**: Displays signal timing inefficiency at intersections with a 0-100 composite score and severity bands.
- **Traffic Prediction**: Predicts future traffic congestion based on historical data, weather, and events, including hourly forecast variations.
- **Optimization Simulation**: Simulates "After Optimization" scenarios to show the impact of signal timing changes and provides an "Improvement Map."
- **Real-time Traffic Flow**: Visualizes live traffic conditions, incorporating GDOT 511 data and incident impacts.
- **Crash Hotspot Identification**: Highlights crash hotspots and recommends signal timing adjustments.
- **Traffic Impact Study (TIS) — Phase 1 deepened**: Generates screening-level traffic impact studies with:
  - Multi-period analysis (AM peak, PM peak, Saturday midday, daily totals) — toggle which periods run from the form's Advanced section.
  - Approach-level HCM analysis (NB/SB/EB/WB v/c, control delay, LOS, 95th-pct back-of-queue per HCM Eq. 19-50). Click any intersection row in the table to expand.
  - Background growth multiplier on existing volumes to opening-year (default 1.5%/yr, range 0–6%).
  - Weather adjustment per HCM Ch. 11 (clear / light rain / heavy rain / light snow / heavy snow → capacity factor 1.00 / 0.95 / 0.86 / 0.86 / 0.70).
  - Pass-by + internal-capture credits applied at the PM peak (full credit) and 25% credit at other peaks. Defaults pulled from the land-use table (e.g. shopping center 25% pass-by, fast-food 40%, restaurant 35%); user can override per-project.
  - Optional 100-iteration Monte-Carlo sensitivity (Box-Muller perturbations: ±10% trip rate, ±15% existing volume; deterministic seed). Reports P10/P50/P90 of worst-case delay change and probability of any LOS drop / E-F.
  - 8 Project templates organised by category (Residential / Office / Retail / Hospitality) — each preloads the form including advanced settings.
- **Backtest Credibility Report**: Provides an audit-grade report on the prediction model's accuracy, including pooled hit-rate with confidence interval and lift against a random baseline.
- **Parking Pressure Map (`/parking`)**: Real OSM inventory of ~157 Sandy Springs parking lots (filtered by the actual `admin_level=8` city polygon, not a bbox), each labeled with its nearest restaurant ("Lot near …" within 250m) when no OSM name exists. Modeled fill %, ETA-to-full, archetype rollups (commercial/office/event/p&r/university/airport/mixed), and event-driven surge near 8 Sandy Springs anchor venues (Perimeter Mall, City Springs Performing Arts, Heritage Green, Northside Hospital, Concourse Corporate Center, Mercedes-Benz USA HQ, The Prado, Hammond Park). Demo "force event surge" toggle for sales/exec walkthroughs. No live sensor feed — Tier 3 sensors out of scope (paid).
- **Lead Capture (TIS only)**: `POST /tis-api/leads` on the TIS API server. Source enum: `pricing_page | for_firms_page | trial_request | other`. The analyzer no longer captures leads; its pitch/exec-summary pages use a plain `mailto:` CTA.
- **Engineering-Firm Wedge**: Lives in the standalone `atlanta-tis` artifact at `/tis/`. Pricing page (`/tis/pricing`), firm landing (`/tis/for-firms`), trial request form, branded TIS PDF (firm logo + project metadata + PE stamp), citation overlay, methodology + limitations appendices, ±15% confidence band on every delay-delta projection. Trial requests flow via `/tis-api/leads` for sales-led onboarding.
- **Auth**: TIS generation is gated behind Replit Auth (cookie `tis_sid`, scoped to `/tis-api`). Every signed-in user can generate; no paid tier (Stripe is removed — see env vars section).
- **Admin Console (`/admin`)**: Email allow-list via `ADMIN_EMAILS` (comma-separated). Lists captured leads via `GET /tis-api/leads/list`. Returns 403 to non-admins.

## User preferences

I prefer concise and clear communication. When making changes, prioritize understanding the existing patterns and adhering to them. For complex features, iterative development with frequent check-ins on design choices is preferred. Please ensure that all new features are well-documented, especially regarding their integration points and potential side effects. Do not make changes to the `pnpm-workspace` skill.

## Security posture (Phase 2)

- **Helmet** on both API servers with default secure headers.
- **CORS lockdown**: only `REPLIT_DOMAINS` origins + localhost in dev (`lib/security.ts` shared helper).
- **Rate limiting** on both write surfaces:
  - `POST /tis-api/leads`: 5 req / 10 min / IP.
  - `POST /tis-api/generate`: 10 req / hour / IP.
- **Honeypot field** `website` on the lead form — if non-empty, server silently 200s without persisting.
- **Auth cookie**: `tis_sid`, `httpOnly`, `Secure` in prod, `SameSite=Lax`. Prefixed `tis_` to avoid collision if the analyzer adds auth later.

## Gotchas

- **GDOT 511 API Key**: The GDOT 511 v2 API requires an API key (`GDOT_511_API_KEY`) to fetch real-time data.
- **Lead Capture Rate Limiting**: The TIS lead capture endpoint (`POST /tis-api/leads`) currently lacks IP rate limiting and bot-friction measures, which should be added before public exposure.
- **Local Data Persistence**: Lead capture and prediction history data are persisted to local JSON files (`atlanta-leads.json`, `prediction-history.json`) which might not scale for high-volume production environments without further integration into a database.
- **Parking snapshot caching**: All three `/api/atlanta/parking/*` routes are backed by a single per-minute in-memory snapshot (one for `forceSurge=false`, one for `=true`). Iterating the lot set is amortized across all callers in a 60s window — required for the "bounded compute" guarantee in `threat_model.md`.
- **Sandy Springs scope**: Parking inventory uses an Overpass `area["name"="Sandy Springs"]["admin_level"="8"]` filter, NOT a bbox. A naive bbox sweeps in Dunwoody, Chamblee, and Brookhaven (the city polygon is irregular, extending east toward I-285). When refetching, do not "simplify" this back to a rectangle.
- **Parking detail force-surge plumbing**: The `/parking/lots/:id` route reads `forceSurge` from `?forceSurge=true|1` OR an `X-Force-Surge: 1` header. The frontend uses the header path because adding a query param to that operation triggers an orval path+query name collision (`GetParkingLotParams` redeclared). Don't "clean this up" by adding the query to OpenAPI without first fixing the codegen collision. The detail hook ALSO has to override `queryKey` to include `forceSurge` — react-query keys generated by orval are URL-only, so a header alone won't bust the cache when the user toggles demo mode.
- **OSM dedupe key**: When refetching parking inventory, dedupe key MUST be `${type}:${id}` — OSM ids are unique per-type only, NOT globally. See `scripts/src/fetch-atlanta-parking.ts`.
- **Roads fetch limits**: The road network fetcher (`scripts/src/fetch-atlanta-roads.ts`) MUST chunk into ≥8 lat-strips and avoid the `~` regex filter. The single-shot full-metro query and any `way["highway"~"..."]` regex filter both get 406'd by overpass-api.de. Use literal `"highway"="tertiary"` + `"highway"="tertiary_link"` as separate union members. The fetcher only refreshes the `tertiary` class — motorway/trunk/primary/secondary are carried forward from the prior file (residential/unclassified intentionally excluded; they balloon the bundle).
- **Signal naming radii**: `atlanta-signal-naming.ts` uses 80m for "A & B" preferred, 150m fallback. Tightening below 60m drops a lot of legitimate intersections where the OSM polyline doesn't pass exactly through the signal node; loosening past 200m starts naming signals after roads they aren't on.
- **Lead source enum extension requires codegen**: When adding a new `LeadSourceKind`, edit BOTH `lib/tis-api-spec/openapi.yaml` (LeadInput.source enum) AND `artifacts/tis-api-server/src/lib/atlanta-leads.ts` (the `LeadSourceKind` union), then run `pnpm --filter @workspace/tis-api-spec run codegen`.
- **TIS depends on analyzer at runtime**: `tis-api-server` fetches the intersection inventory from the analyzer's `/api/atlanta/intersections` once on first request (via `ANALYZER_API_URL`, default `http://localhost:8080`) and caches it for the process lifetime. If the analyzer is down at first request, TIS generation returns a 4xx with the upstream error.
- **TIS approach-split is deterministic per signal**: `approachVolumeShares()` seeds a mulberry32 PRNG with `hash32(signalId)` so the NB/SB/EB/WB split is stable across reloads and across requests for the same signal. Don't reseed per request — the engineer expects the same approach detail every time they reprint a project.
- **TIS Monte-Carlo seed is fixed** (`0xC0FFEE`): sensitivity output is identical for identical inputs. This is intentional for engineering reproducibility; a "Final" PDF must match the "Draft" PDF when re-run with the same parameters. Don't randomize the seed.
- **Pass-by/internal-capture credit only applies fully at PM peak**: the engine applies 25% of the credit fraction at AM/Sat/Daily (industry rule of thumb that off-peak shopping has less drive-by capture). If you change this, also update the methodology bullet text in `TIS_METHODOLOGY` so the printed report stays consistent with the math.
- **TIS form Advanced section defaults are LU-driven**: pass-by % and internal-capture % inputs default to the selected land-use's `passByPctPm` / `internalCapturePctPm`. Changing the land-use code does NOT auto-clear an explicit user override — user-typed values persist across LU changes. This is a usability tradeoff (engineers re-running variations don't lose their custom credit).
- **`daily` period skips intersection LOS analysis**: HCM control delay isn't defined over a 24-hour window. The `daily` period report carries trip generation only; `affectedIntersections: []` and the `PeriodTabsCard` hides the LOS-impact stat row for that period. Don't try to compute v/c on daily volumes — it's meaningless and would mislead reviewers.
- **Firm-branding logo size cap**: `firm-settings-modal.tsx` rejects logo uploads larger than ~200KB (post-base64) to keep localStorage lean. Bumping this past ~1MB will hit the 5–10MB browser cap fast once a user prints multiple projects per session.
- **TIS citation refs render as plain `<sup>`**: `<CitationRef>` is just a tooltip-bearing superscript — the citation registry in `lib/tis-citations.ts` is the single source of truth. Don't hand-write citation tags in JSX; reference the registry by key so adding/renaming a citation is a one-file change.
- **TIS auth cookie name is `tis_sid`** (not `connect.sid`): the analyzer and TIS run on the same hostname and would otherwise share a session cookie. Don't rename.
- **`ADMIN_EMAILS` allow-list is the only admin signal**: there is no `users.role` column. Promoting/demoting an admin is an env-var change, not a DB change.
- **`tis_usage` table is dormant**: schema kept (with `stripeCustomerId` column) so re-enabling Stripe doesn't need a migration. Currently no code reads or writes it.
- **Cover page prints first via `print:break-after-page`**: `TisCoverPage` is `hidden print:flex` — invisible on screen, full-page on print. The `print:break-after-page` rule needs the matching CSS in the page-level `<style>` block (added to `tis.tsx`). Removing either side breaks the multi-page PDF layout.

## Pointers

- **Drizzle ORM Documentation**: [https://orm.drizzle.team/docs/overview](https://orm.drizzle.team/docs/overview)
- **Zod Documentation**: [https://zod.dev/](https://zod.dev/)
- **Orval Documentation**: [https://orval.dev/](https://orval.dev/)
- **React Leaflet Documentation**: [https://react-leaflet.js.org/](https://react-leaflet.js.org/)
- **Recharts Documentation**: [https://recharts.org/](https://recharts.org/)
- **TanStack Table Documentation**: [https://tanstack.com/table/v8](https://tanstack.com/table/v8)
- **OpenStreetMap Overpass API**: [https://wiki.openstreetmap.org/wiki/Overpass_API](https://wiki.openstreetmap.org/wiki/Overpass_API)
- **GDOT 511 API Reference**: _Populate as you build_
- **HCM 6th Edition Reference**: _Populate as you build_
- **ITE Trip Generation Manual**: _Populate as you build_