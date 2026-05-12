-- Local dev DDL — mirrors lib/db/src/schema/*.ts.
-- Run on a fresh local Postgres: psql tis_dev -f scripts/local-schema.sql
-- On Replit, prefer `pnpm --filter @workspace/db push` — this file is a
-- local-only convenience because drizzle-kit can't run on macOS arm64
-- under our workspace config (esbuild darwin binary is excluded).

-- =============== auth ===============
CREATE TABLE IF NOT EXISTS sessions (
  sid      VARCHAR PRIMARY KEY,
  sess     JSONB NOT NULL,
  expire   TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions (expire);

CREATE TABLE IF NOT EXISTS users (
  id                          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  email                       VARCHAR UNIQUE,
  first_name                  VARCHAR,
  last_name                   VARCHAR,
  profile_image_url           VARCHAR,
  password_hash               VARCHAR,
  password_reset_token        VARCHAR,
  password_reset_expires_at   TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Phase-13 migration ALTER for an existing users table.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash             VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token      VARCHAR;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

-- =============== firms ===============
CREATE TABLE IF NOT EXISTS firms (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        TEXT NOT NULL,
  slug                        VARCHAR(64) NOT NULL UNIQUE,
  logo_url                    TEXT,
  stripe_customer_id          VARCHAR,
  stripe_subscription_id      VARCHAR,
  plan_tier                   VARCHAR(32) NOT NULL DEFAULT 'trial',
  subscription_status         VARCHAR(32),
  seat_limit                  INTEGER NOT NULL DEFAULT 3,
  study_limit                 INTEGER NOT NULL DEFAULT 3,
  studies_used_this_period    INTEGER NOT NULL DEFAULT 0,
  current_period_start        TIMESTAMPTZ,
  current_period_end          TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS firm_members (
  firm_id              UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id              VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role                 VARCHAR(16) NOT NULL DEFAULT 'member',
  invited_by_user_id   VARCHAR,
  joined_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (firm_id, user_id)
);
CREATE INDEX IF NOT EXISTS "IDX_firm_members_user" ON firm_members (user_id);

CREATE TABLE IF NOT EXISTS firm_invites (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id              UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  email                VARCHAR NOT NULL,
  role                 VARCHAR(16) NOT NULL DEFAULT 'member',
  token                VARCHAR NOT NULL UNIQUE,
  invited_by_user_id   VARCHAR NOT NULL,
  expires_at           TIMESTAMPTZ NOT NULL,
  accepted_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_firm_invites_firm" ON firm_invites (firm_id);

-- =============== legacy tis_usage (unused, kept for compat) ===============
CREATE TABLE IF NOT EXISTS tis_usage (
  user_id              VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  completed_count      INTEGER NOT NULL DEFAULT 0,
  last_generated_at    TIMESTAMPTZ,
  stripe_customer_id   VARCHAR,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============== tis_projects (= generic studies history) ===============
CREATE TABLE IF NOT EXISTS tis_projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  firm_id             UUID REFERENCES firms(id) ON DELETE CASCADE,
  study_type          VARCHAR(32) NOT NULL DEFAULT 'tis',
  project_name        TEXT NOT NULL,
  land_use_code       VARCHAR(16) NOT NULL,
  land_use_size       TEXT,
  site_lat            TEXT,
  site_lon            TEXT,
  request_payload     JSONB NOT NULL,
  result_payload      JSONB NOT NULL,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_tis_projects_user_created"  ON tis_projects (user_id, created_at);
CREATE INDEX IF NOT EXISTS "IDX_tis_projects_firm_created"  ON tis_projects (firm_id, created_at);
-- Adds study_type to a pre-existing tis_projects table (no-op if column already exists).
ALTER TABLE tis_projects ADD COLUMN IF NOT EXISTS study_type VARCHAR(32) NOT NULL DEFAULT 'tis';

-- =============== monitoring_enrollments / monitoring_reports ===============
CREATE TABLE IF NOT EXISTS monitoring_enrollments (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id                UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  project_id             UUID REFERENCES tis_projects(id) ON DELETE SET NULL,
  label                  TEXT NOT NULL,
  site_lat               TEXT NOT NULL,
  site_lon               TEXT NOT NULL,
  forecast_snapshot      JSONB NOT NULL,
  status                 VARCHAR(16) NOT NULL DEFAULT 'active',
  enrolled_by_user_id    VARCHAR NOT NULL,
  enrolled_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_open_date     TIMESTAMPTZ,
  last_report_at         TIMESTAMPTZ,
  notes                  TEXT
);
CREATE INDEX IF NOT EXISTS "IDX_monitoring_firm" ON monitoring_enrollments (firm_id);
CREATE INDEX IF NOT EXISTS "IDX_monitoring_project" ON monitoring_enrollments (project_id);

CREATE TABLE IF NOT EXISTS monitoring_reports (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id          UUID NOT NULL REFERENCES monitoring_enrollments(id) ON DELETE CASCADE,
  period_start           TIMESTAMPTZ NOT NULL,
  period_end             TIMESTAMPTZ NOT NULL,
  payload                JSONB NOT NULL,
  generated_by_user_id   VARCHAR REFERENCES users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_monitoring_reports_enrollment" ON monitoring_reports (enrollment_id, created_at);

-- =============== traffic_snapshots (existing) ===============
CREATE TABLE IF NOT EXISTS traffic_snapshots (
  id                          SERIAL PRIMARY KEY,
  captured_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  incident_count              INTEGER NOT NULL DEFAULT 0,
  snapped_to_signal_count     INTEGER NOT NULL DEFAULT 0,
  payload                     JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_traffic_snapshots_captured" ON traffic_snapshots (captured_at);

-- =============== intersection_calibration (existing) ===============
CREATE TABLE IF NOT EXISTS intersection_calibration (
  intersection_id           TEXT PRIMARY KEY,
  delay_multiplier          DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  sample_count              INTEGER NOT NULL DEFAULT 0,
  last_observed_delay_sec   DOUBLE PRECISION,
  notes                     TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT intersection_calibration_multiplier_range
    CHECK (delay_multiplier > 0 AND delay_multiplier <= 10),
  CONSTRAINT intersection_calibration_sample_count_nonneg
    CHECK (sample_count >= 0),
  CONSTRAINT intersection_calibration_observed_nonneg
    CHECK (last_observed_delay_sec IS NULL OR last_observed_delay_sec >= 0)
);
