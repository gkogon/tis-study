# Threat Model

## Project Overview

This project is a pnpm monorepo with two production Express 5 APIs (`artifacts/api-server` at `/api/*` for the analyzer, `artifacts/tis-api-server` at `/tis-api/*` for the Traffic Impact Study product) and two React + Vite dashboards (`artifacts/atlanta-traffic` at `/` for the analyzer, `artifacts/atlanta-tis` at `/tis/` for TIS). The analyzer serves public Atlanta traffic-inefficiency analytics computed from bundled JSON data and deterministic in-memory modeling code. The TIS server exposes screening-level Traffic Impact Studies plus a public lead-capture endpoint that appends to a local JSON file.

**Auth update.** The TIS server has a Replit-Auth (OIDC) session layer (cookie `tis_sid`) gating `/tis-api/generate` so generated reports are bound to a stable identity for project history. Every signed-in user can generate without a paid quota — Stripe billing was removed. There is also a small admin surface (`/admin` + `/tis-api/leads/list`) gated by an `ADMIN_EMAILS` allow-list. The analyzer remains unauthenticated and read-only.

The development-only mockup environment in `artifacts/mockup-sandbox` is not deployed to production and should be ignored unless future architecture changes make it reachable in production.

## Assets

- **Service availability** — the main asset is the availability of the public analytics API and dashboard. Disruption would make the dashboard unusable.
- **Integrity of analytics output** — route responses must accurately reflect the bundled traffic dataset and deterministic calculations. Tampering could mislead users or downstream decisions.
- **Application secrets and deployment configuration** — even though the current production path does not use the database, deployment-time environment variables and server configuration still must not leak through logs or responses.
- **Client trust** — the browser should only receive intended public analytics data and must not be exposed to injected script or unsafe HTML derived from untrusted input.

## Trust Boundaries

- **Browser to API** — all dashboard data crosses from untrusted clients into the Express API. Clients must be treated as untrusted even though the API is currently public and read-only.
- **API to local bundled data** — the server loads JSON traffic datasets from the local filesystem and transforms them into response objects. File access must stay confined to the intended bundled data files.
- **API to deployment environment** — the server consumes runtime configuration from environment variables such as `PORT` and logging settings. Those values must not be disclosed unexpectedly.
- **Browser to third-party tile providers** — the frontend embeds OpenStreetMap/CARTO tiles. This is a read-only external dependency boundary that can affect availability/privacy but does not receive privileged secrets from the app.
- **Production vs dev-only boundary** — `artifacts/mockup-sandbox`, Vite dev-server settings, and other preview tooling are development-only and out of scope for production vulnerability reporting unless production reachability is established.

## Scan Anchors

- **Production entry points**: `artifacts/api-server/src/{index,app}.ts`, `artifacts/tis-api-server/src/{index,app}.ts`, `artifacts/atlanta-traffic/src/{main,App}.tsx`, `artifacts/atlanta-tis/src/{main,App}.tsx`
- **Highest-risk code areas**: `artifacts/api-server/src/routes/atlanta.ts`, `artifacts/api-server/src/lib/atlanta-analysis.ts`, `artifacts/tis-api-server/src/routes/{tis,leads,auth}.ts`, `artifacts/tis-api-server/src/lib/{tis,atlanta-leads,auth,security}.ts`, `artifacts/tis-api-server/src/middlewares/authMiddleware.ts`
- **Public surface**: `/api/atlanta/*` and `/api/healthz` (read-only); `/tis-api/{healthz,land-uses}` (read-only), `/tis-api/leads` (write, append-only, rate-limited 5/10min/IP, honeypot field), `/tis-api/login|callback|logout` (auth)
- **Authenticated surface**: `/tis-api/generate` (auth + 10 req/hour/IP), `/tis-api/auth/user`, `/tis-api/projects*`
- **Admin-only surface (ADMIN_EMAILS allow-list)**: `/tis-api/leads/list`
- **Dev-only areas to ignore by default**: `artifacts/mockup-sandbox/**`, Vite development-only plugins/configuration paths

## Threat Categories

### Tampering

The main tampering risk is unauthorized modification of server-side calculations or response shaping. The application must compute analytics exclusively from bundled server-side data and code; clients must not be able to supply values that change scores, rankings, or recommendations beyond selecting documented read-only resources.

### Information Disclosure

The current production application is intentionally public, but it still must not disclose environment secrets, internal filesystem details, or sensitive headers through logs or HTTP responses. Error handling and logging should avoid exposing cookies, authorization headers, stack traces, or unintended local file paths to clients.

### Denial of Service

Because the application is a public dashboard with unauthenticated GET endpoints, availability is the most relevant risk. Expensive computations, oversized responses, or unbounded repeated processing must remain bounded through caching, precomputation, or other controls so anonymous users cannot cheaply degrade service.

### Elevation of Privilege

The admin surface (`/tis-api/leads/list`, `/admin`) is gated by an `ADMIN_EMAILS` allow-list checked against the authenticated session's verified email claim. Requests must be both authenticated AND email-matched; missing or mismatched emails return 403. There is no in-database `role` column to spoof, and no client-supplied admin signal — promoting/demoting an admin is an env-var change. The TIS auth gate must reject any request that would let an unauthenticated user generate a report. No route or shared library should accidentally introduce code execution, path traversal, arbitrary file reads, or other server-compromise primitives via request parameters or dynamically resolved resources.
