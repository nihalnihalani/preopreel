-- ============================================================================
-- 0001_initial_schema.down.sql — companion rollback for 0001
--
-- Drops everything 0001 creates, in reverse FK order so CASCADE is unnecessary.
-- Promo: BUTTERBASE0502 — Submission: butterbase0502
-- Reference: https://www.youtube.com/watch?v=SHnryHJL9xc
-- ============================================================================

-- Trigger first (depends on forge_runs).
DROP TRIGGER IF EXISTS trg_forge_runs_updated_at ON forge_runs;
DROP FUNCTION IF EXISTS set_updated_at_now();

-- Tables in reverse FK dependency order.
DROP TABLE IF EXISTS omnihuman_consents;
DROP TABLE IF EXISTS replay_fixtures;
DROP TABLE IF EXISTS audit_citations;
DROP TABLE IF EXISTS critic_scores;
DROP TABLE IF EXISTS critiques;
DROP TABLE IF EXISTS shot_lists;
DROP TABLE IF EXISTS anatomy_graphs;
DROP TABLE IF EXISTS patient_demographics;
DROP TABLE IF EXISTS procedure_plans;
DROP TABLE IF EXISTS forge_runs;

-- ENUMs (after every dependent column is gone).
DROP TYPE IF EXISTS replay_codec;
DROP TYPE IF EXISTS citation_source;
DROP TYPE IF EXISTS critique_category;
DROP TYPE IF EXISTS critique_severity;
DROP TYPE IF EXISTS forge_run_demo_mode;
DROP TYPE IF EXISTS forge_run_status;

-- Migration ledger entry.
DELETE FROM _migrations WHERE name = '0001_initial_schema';
