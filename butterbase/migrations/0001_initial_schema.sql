-- ============================================================================
-- 0001_initial_schema.sql — PreOpReel Butterbase persistence backbone
--
-- Owner:        Butterbase Dev (PreOpReel team, Phase 3)
-- Promo code:   BUTTERBASE0502   (ALL CAPS — applied at Billing → Promo Codes)
-- Submission:   butterbase0502   (lowercase — Settings → Project Metadata)
-- Reference:    https://www.youtube.com/watch?v=SHnryHJL9xc
-- Plan:         docs/plans/05-butterbase-integration.md §B
--
-- Provisions the 10 PreOpReel tables, 4 ENUMs, indexes, and RLS policies.
-- Everything except SSE trace events lives here. Realtime channels for
-- `critiques` and `critic_scores` drive the CriticHud (Invariant 1).
--
-- RLS roles (Butterbase / Supabase pattern):
--   anon         — public, no signup. Lookup-by-uuid only on user-facing tables.
--   service_role — server-side. Bypasses RLS; explicit policies for documentation.
--
-- This migration is idempotent at the table-level via IF NOT EXISTS guards.
-- ============================================================================

-- ─── Extensions ───────────────────────────────────────────────────────────
-- gen_random_uuid() lives in pgcrypto on stock Postgres; Butterbase preinstalls
-- it but we keep the CREATE EXTENSION call defensive.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── ENUMs ────────────────────────────────────────────────────────────────
-- Mirrors src/lib/forge/types.ts ForgeRunStatus subset — the Postgres enum is
-- intentionally coarser than the TypeScript one (which carries per-stage
-- granularity); the granular cursor lives in `forge_runs.stage` (text).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forge_run_status') THEN
    CREATE TYPE forge_run_status AS ENUM (
      'queued', 'running', 'completed', 'failed', 'cancelled'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'forge_run_demo_mode') THEN
    CREATE TYPE forge_run_demo_mode AS ENUM ('live', 'replay', 'hybrid');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'critique_severity') THEN
    CREATE TYPE critique_severity AS ENUM ('block', 'warn', 'info');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'critique_category') THEN
    -- Mara's category set is union-extended per Mara A.1 mitigation
    -- (population_assumption, imperative_overreach, cited_but_irrelevant
    --  are the three Mara-extension categories on top of the original 5).
    CREATE TYPE critique_category AS ENUM (
      'advice_creep',
      'uncited_claim',
      'ambiguity',
      'scope_creep',
      'anatomical_invention',
      'population_assumption',
      'imperative_overreach',
      'cited_but_irrelevant'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'citation_source') THEN
    CREATE TYPE citation_source AS ENUM (
      'procedure_plan', 'pmid', 'curated_protocol'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'replay_codec') THEN
    CREATE TYPE replay_codec AS ENUM ('json', 'mp4', 'png', 'wav', 'pdf');
  END IF;
END$$;

-- ============================================================================
-- B.1  forge_runs — root row, one per /api/forge ingest
-- ============================================================================
CREATE TABLE IF NOT EXISTS forge_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status                forge_run_status NOT NULL DEFAULT 'queued',
  stage                 text NOT NULL DEFAULT 'intake',
  demo_mode             forge_run_demo_mode NOT NULL DEFAULT 'live',
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

ALTER TABLE forge_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forge_runs_anon_select   ON forge_runs;
DROP POLICY IF EXISTS forge_runs_service_all   ON forge_runs;

-- anon: lookup-by-uuid pattern; uuid is the capability (Stripe checkout shape)
CREATE POLICY forge_runs_anon_select ON forge_runs
  FOR SELECT TO anon USING (true);

CREATE POLICY forge_runs_service_all ON forge_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- B.2  procedure_plans — surgeon-uploaded PDF + parsed JSON
-- ============================================================================
CREATE TABLE IF NOT EXISTS procedure_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id  uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  pdf_url       text NOT NULL,
  parsed_json   jsonb NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_procedure_plans_forge_run_id ON procedure_plans (forge_run_id);

ALTER TABLE procedure_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS procedure_plans_anon_select  ON procedure_plans;
DROP POLICY IF EXISTS procedure_plans_service_all  ON procedure_plans;

CREATE POLICY procedure_plans_anon_select ON procedure_plans
  FOR SELECT TO anon USING (forge_run_id IS NOT NULL);

CREATE POLICY procedure_plans_service_all ON procedure_plans
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- B.3  patient_demographics — synthetic phantom card
--      synthetic_phantom default true: demo case never accidentally false.
-- ============================================================================
CREATE TABLE IF NOT EXISTS patient_demographics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id       uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  age                int  NOT NULL CHECK (age >= 0 AND age <= 130),
  sex                text NOT NULL CHECK (sex IN ('female','male','intersex','unspecified')),
  bmi                numeric(5,2) CHECK (bmi >= 10 AND bmi <= 80),
  comorbidities      text[] NOT NULL DEFAULT ARRAY[]::text[],
  synthetic_phantom  boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_patient_demographics_forge_run_id ON patient_demographics (forge_run_id);

ALTER TABLE patient_demographics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_demographics_anon_select ON patient_demographics;
DROP POLICY IF EXISTS patient_demographics_service_all ON patient_demographics;

CREATE POLICY patient_demographics_anon_select ON patient_demographics
  FOR SELECT TO anon USING (true);

CREATE POLICY patient_demographics_service_all ON patient_demographics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- B.4  anatomy_graphs — Stage 2c (Gem) output
-- ============================================================================
CREATE TABLE IF NOT EXISTS anatomy_graphs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id             uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  graph_json               jsonb NOT NULL,
  confidence_distribution  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anatomy_graphs_forge_run_id ON anatomy_graphs (forge_run_id);

ALTER TABLE anatomy_graphs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anatomy_graphs_anon_select ON anatomy_graphs;
DROP POLICY IF EXISTS anatomy_graphs_service_all ON anatomy_graphs;

CREATE POLICY anatomy_graphs_anon_select ON anatomy_graphs
  FOR SELECT TO anon USING (true);

CREATE POLICY anatomy_graphs_service_all ON anatomy_graphs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- B.5  shot_lists — Stages 3 + 4 output, two versions on the common path
-- ============================================================================
CREATE TABLE IF NOT EXISTS shot_lists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id    uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  version         int  NOT NULL DEFAULT 1 CHECK (version >= 1),
  shot_list_json  jsonb NOT NULL,
  created_by      text NOT NULL CHECK (created_by IN ('atlas','atlas-after-mara')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (forge_run_id, version)
);

CREATE INDEX IF NOT EXISTS idx_shot_lists_forge_run_id ON shot_lists (forge_run_id);

ALTER TABLE shot_lists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shot_lists_anon_select ON shot_lists;
DROP POLICY IF EXISTS shot_lists_service_all ON shot_lists;

CREATE POLICY shot_lists_anon_select ON shot_lists
  FOR SELECT TO anon USING (true);

CREATE POLICY shot_lists_service_all ON shot_lists
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- B.6  critiques — one row per Mara flag (replaces Redis pre:critique:* list)
--      Realtime channel: pre:critiques:{forge_run_id} (Postgres logical decoding).
-- ============================================================================
CREATE TABLE IF NOT EXISTS critiques (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id        uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
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

ALTER TABLE critiques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS critiques_anon_select  ON critiques;
DROP POLICY IF EXISTS critiques_service_all  ON critiques;

CREATE POLICY critiques_anon_select ON critiques
  FOR SELECT TO anon USING (true);

CREATE POLICY critiques_service_all ON critiques
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- B.7  critic_scores — one row per Lyra eval per beat per regen attempt.
--      A failed-then-passed beat has two rows (regen_attempt 0 then 1).
--      `accepted_with_low_score` is the Mara A.3 honesty-over-theater flag:
--      after the 1-regen budget burns, we accept and surface the low score.
--      Realtime channel: pre:scores:{forge_run_id}.
-- ============================================================================
CREATE TABLE IF NOT EXISTS critic_scores (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id                uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
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

ALTER TABLE critic_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS critic_scores_anon_select  ON critic_scores;
DROP POLICY IF EXISTS critic_scores_service_all  ON critic_scores;

CREATE POLICY critic_scores_anon_select ON critic_scores
  FOR SELECT TO anon USING (true);

CREATE POLICY critic_scores_service_all ON critic_scores
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- B.8  audit_citations — Invariant 4 source-of-truth for every claim.
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_citations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id       uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  claim_id           text NOT NULL,
  narrator_excerpt   text NOT NULL,
  source_type        text NOT NULL CHECK (source_type IN ('procedure_plan','pmid','curated_protocol')),
  pointer            text NOT NULL,
  confidence_lo      numeric(4,3) CHECK (confidence_lo >= 0 AND confidence_lo <= 1),
  confidence_hi      numeric(4,3) CHECK (confidence_hi >= 0 AND confidence_hi <= 1),
  -- Mara D.4 mitigation: lo === hi rejected at the Zod layer; lo > hi rejected here.
  CHECK (confidence_lo IS NULL OR confidence_hi IS NULL OR confidence_lo <= confidence_hi)
);

CREATE INDEX IF NOT EXISTS idx_audit_citations_forge_run_id  ON audit_citations (forge_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_citations_source_type   ON audit_citations (source_type);

ALTER TABLE audit_citations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_citations_anon_select ON audit_citations;
DROP POLICY IF EXISTS audit_citations_service_all ON audit_citations;

CREATE POLICY audit_citations_anon_select ON audit_citations
  FOR SELECT TO anon USING (true);

CREATE POLICY audit_citations_service_all ON audit_citations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- B.9  replay_fixtures — Invariant 3 backing store. Service-role only.
--      `bytes` inline if < 64 KiB; otherwise `storage_url` points at
--      preopreel-renders/replay/{stage}/{key}.{ext}.
-- ============================================================================
CREATE TABLE IF NOT EXISTS replay_fixtures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage       text NOT NULL,
  key         text NOT NULL,
  codec       replay_codec NOT NULL,
  bytes       bytea,
  storage_url text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage, key),
  CHECK ((bytes IS NOT NULL) OR (storage_url IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_replay_fixtures_stage_key ON replay_fixtures (stage, key);

ALTER TABLE replay_fixtures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS replay_fixtures_service_only ON replay_fixtures;
DROP POLICY IF EXISTS replay_fixtures_anon_deny    ON replay_fixtures;

-- Service-role only. anon has no policy at all → RLS denies by default.
CREATE POLICY replay_fixtures_service_only ON replay_fixtures
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- B.10  omnihuman_consents — surgeon photo consent ledger.
--       Post-MVP table; Layer-1 (May 2 demo) does NOT use OmniHuman.
-- ============================================================================
CREATE TABLE IF NOT EXISTS omnihuman_consents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surgeon_id         text NOT NULL,
  photo_storage_url  text NOT NULL,
  consent_signed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_omnihuman_consents_surgeon_id ON omnihuman_consents (surgeon_id);

ALTER TABLE omnihuman_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS omnihuman_consents_service_only ON omnihuman_consents;

CREATE POLICY omnihuman_consents_service_only ON omnihuman_consents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- updated_at trigger on forge_runs
-- ============================================================================
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

-- ============================================================================
-- Migration ledger row (apply.ts also writes this; idempotent).
-- ============================================================================
CREATE TABLE IF NOT EXISTS _migrations (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  checksum    text
);

INSERT INTO _migrations (name) VALUES ('0001_initial_schema')
  ON CONFLICT (name) DO NOTHING;
