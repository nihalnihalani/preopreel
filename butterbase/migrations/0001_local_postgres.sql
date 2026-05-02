-- ============================================================================
-- 0001_local_postgres.sql — vanilla Postgres 16 migration for local dev.
--
-- Identical table shapes to butterbase/migrations/0001_initial_schema.sql but
-- WITHOUT the Butterbase-specific bits that vanilla Postgres can't satisfy:
--   • no RLS policies (no `anon` / `service_role` roles on local Postgres)
--   • no ENUMs (use text + CHECK; matches the JSON DSL we used against the
--     hosted Butterbase project so the same client.ts queries work either way)
--
-- The pg-fallback path in src/lib/butterbase/pg-fallback.ts hits this DB when
-- BUTTERBASE_DATABASE_URL points at it. client.ts queries match the column
-- names verbatim. Keep this file in lockstep with types.gen.ts.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── forge_runs ───────────────────────────────────────────────────────────
-- id is `text` (not uuid) so the demo path's literal slug
-- 'demo-hip-replacement' is a legal value alongside randomUUID()-minted
-- ids from real uploads. Adopted per the devil's advocate counter-proposal
-- (2026-05-02 review): keeps the persistence layer single-source-of-truth,
-- avoids a slug→uuid mapping shim, and matches the routes' incoming id.
CREATE TABLE IF NOT EXISTS forge_runs (
  id                    text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  status                text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','running','completed','failed','cancelled')),
  stage                 text NOT NULL DEFAULT 'intake',
  demo_mode             text NOT NULL DEFAULT 'replay'
                        CHECK (demo_mode IN ('live','replay','hybrid')),
  durations_ms          jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_usd              jsonb NOT NULL DEFAULT '{}'::jsonb,
  error                 text,
  explainer_mp4_url     text,
  audit_trail_pdf_url   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forge_runs_created_at ON forge_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forge_runs_status     ON forge_runs (status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at_now()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forge_runs_updated_at ON forge_runs;
CREATE TRIGGER trg_forge_runs_updated_at
  BEFORE UPDATE ON forge_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

-- ─── procedure_plans ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS procedure_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id  text NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  pdf_url       text NOT NULL,
  parsed_json   jsonb NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_procedure_plans_forge_run_id ON procedure_plans (forge_run_id);

-- ─── patient_demographics ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS patient_demographics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id       text NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  age                int  NOT NULL CHECK (age >= 0 AND age <= 130),
  sex                text NOT NULL CHECK (sex IN ('female','male','intersex','unspecified','unknown')),
  bmi                numeric(5,2) CHECK (bmi >= 10 AND bmi <= 80),
  comorbidities      text[] NOT NULL DEFAULT ARRAY[]::text[],
  synthetic_phantom  boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_patient_demographics_forge_run_id ON patient_demographics (forge_run_id);

-- ─── anatomy_graphs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anatomy_graphs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id             text NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  graph_json               jsonb NOT NULL,
  confidence_distribution  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_anatomy_graphs_forge_run_id ON anatomy_graphs (forge_run_id);

-- ─── shot_lists ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shot_lists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id    text NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  version         int  NOT NULL DEFAULT 1 CHECK (version >= 1),
  shot_list_json  jsonb NOT NULL,
  created_by      text NOT NULL CHECK (created_by IN ('atlas','atlas-after-mara')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (forge_run_id, version)
);
CREATE INDEX IF NOT EXISTS idx_shot_lists_forge_run_id ON shot_lists (forge_run_id);

-- ─── critiques (Mara) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS critiques (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id        text NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  shot_id             text NOT NULL,
  severity            text NOT NULL CHECK (severity IN ('block','warn','info')),
  category            text NOT NULL CHECK (category IN (
                        'advice_creep','uncited_claim','ambiguity','scope_creep',
                        'anatomical_invention','population_assumption',
                        'imperative_overreach','cited_but_irrelevant')),
  excerpt             text NOT NULL CHECK (length(excerpt) <= 200),
  reason              text NOT NULL CHECK (length(reason) <= 200),
  suggested_revision  text,
  persona             text NOT NULL DEFAULT 'mara' CHECK (persona = 'mara'),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_critiques_forge_run_id        ON critiques (forge_run_id);
CREATE INDEX IF NOT EXISTS idx_critiques_forge_run_severity  ON critiques (forge_run_id, severity);

-- ─── critic_scores (Lyra) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS critic_scores (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id                text NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  beat_id                     text NOT NULL,
  regen_attempt               int  NOT NULL DEFAULT 0 CHECK (regen_attempt >= 0),
  anatomical_fidelity         numeric(4,3) NOT NULL CHECK (anatomical_fidelity >= 0 AND anatomical_fidelity <= 1),
  procedure_step_compliance   numeric(4,3) NOT NULL CHECK (procedure_step_compliance >= 0 AND procedure_step_compliance <= 1),
  on_screen_text_violations   int NOT NULL DEFAULT 0 CHECK (on_screen_text_violations >= 0),
  feedback                    text NOT NULL CHECK (length(feedback) <= 240),
  accepted                    boolean NOT NULL,
  accepted_with_low_score     boolean NOT NULL DEFAULT false,
  persona                     text NOT NULL DEFAULT 'lyra' CHECK (persona = 'lyra'),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (forge_run_id, beat_id, regen_attempt)
);
CREATE INDEX IF NOT EXISTS idx_critic_scores_forge_run_id ON critic_scores (forge_run_id);
CREATE INDEX IF NOT EXISTS idx_critic_scores_forge_beat   ON critic_scores (forge_run_id, beat_id);

-- ─── audit_citations ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_citations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id       text NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  claim_id           text NOT NULL,
  narrator_excerpt   text NOT NULL,
  source_type        text NOT NULL CHECK (source_type IN ('procedure_plan','pmid','curated_protocol')),
  pointer            text NOT NULL,
  confidence_lo      numeric(4,3) CHECK (confidence_lo >= 0 AND confidence_lo <= 1),
  confidence_hi      numeric(4,3) CHECK (confidence_hi >= 0 AND confidence_hi <= 1),
  CHECK (confidence_lo IS NULL OR confidence_hi IS NULL OR confidence_lo <= confidence_hi)
);
CREATE INDEX IF NOT EXISTS idx_audit_citations_forge_run_id  ON audit_citations (forge_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_citations_source_type   ON audit_citations (source_type);

-- ─── _migrations ledger ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _migrations (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  checksum    text
);
INSERT INTO _migrations (name) VALUES ('0001_local_postgres')
  ON CONFLICT (name) DO NOTHING;
