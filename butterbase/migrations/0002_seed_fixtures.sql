-- ============================================================================
-- 0002_seed_fixtures.sql — synthetic-phantom hip-replacement demo seed
--
-- Promo: BUTTERBASE0502 — Submission: butterbase0502
-- Reference: https://www.youtube.com/watch?v=SHnryHJL9xc
-- Plan: docs/plans/05-butterbase-integration.md §F.2
--
-- Pre-loads the canonical demo run so:
--   • The CriticHud (Invariant 1) has data even before any worker runs.
--   • prewarm_demo.py is idempotent (rerun → identical end state).
--   • The deliberate Mara warn (advice_creep on shot_3) and the Lyra
--     Beat-3 reject/regen pair (0.71 → 0.86) are present in the database
--     so the 0:50–1:00 demo beat shows real reject/regen receipts.
--
-- Demo run id: 00000000-0000-0000-0000-000000000001 (canonical phantom hip)
-- ============================================================================

-- ─── forge_runs ─────────────────────────────────────────────────────────
INSERT INTO forge_runs (
  id, status, stage, demo_mode, durations_ms, cost_usd,
  explainer_mp4_url, audit_trail_pdf_url
) VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'completed',
  'composing',
  'replay',
  '{"parsing":220,"researching":1809,"directing":920,"critiquing":410,"renderingKeyframes":6200,"renderingVideo":38400,"scoring":1100,"composing":8200}'::jsonb,
  '{"directing":0.012,"critiquing":0.004,"renderingKeyframes":0.18,"renderingVideo":0.62,"scoring":0.012,"narrating":0.008,"total":0.84}'::jsonb,
  'preopreel-renders/explainers/00000000-0000-0000-0000-000000000001.mp4',
  'preopreel-renders/audit/00000000-0000-0000-0000-000000000001.pdf'
) ON CONFLICT (id) DO NOTHING;

-- ─── procedure_plans ────────────────────────────────────────────────────
INSERT INTO procedure_plans (forge_run_id, pdf_url, parsed_json)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'preopreel-renders/uploads/00000000-0000-0000-0000-000000000001/plan.pdf',
  jsonb_build_object(
    'procedure_name',  'Total Hip Arthroplasty (Posterior Approach)',
    'cpt_code',        '27130',
    'sections', jsonb_build_array(
      jsonb_build_object('id','§1',  'title','Pre-Op Fasting',           'text','NPO from midnight; clear liquids until 2h pre-op.'),
      jsonb_build_object('id','§2.1','title','Patient Positioning',      'text','Lateral decubitus, operative side up; pelvis stabilized.'),
      jsonb_build_object('id','§2.3','title','Acetabular Preparation',   'text','Reaming under fluoroscopy; trial cup; final press-fit.'),
      jsonb_build_object('id','§3',  'title','Femoral Stem Insertion',   'text','Broach to size; final stem cementless; reduce hip.'),
      jsonb_build_object('id','§4',  'title','Closure',                  'text','Layered closure; sterile dressing; weight-bearing as tolerated POD-1.')
    )
  )
WHERE NOT EXISTS (
  SELECT 1 FROM procedure_plans
   WHERE forge_run_id = '00000000-0000-0000-0000-000000000001'::uuid
);

-- ─── patient_demographics ───────────────────────────────────────────────
INSERT INTO patient_demographics (
  forge_run_id, age, sex, bmi, comorbidities, synthetic_phantom
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  65, 'female', 28.0, ARRAY['hypertension','controlled_t2dm']::text[], true
WHERE NOT EXISTS (
  SELECT 1 FROM patient_demographics
   WHERE forge_run_id = '00000000-0000-0000-0000-000000000001'::uuid
);

-- ─── anatomy_graphs (one landmark deliberately low-confidence per Mara D.4) ─
INSERT INTO anatomy_graphs (forge_run_id, graph_json, confidence_distribution)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  jsonb_build_object(
    'nodes', jsonb_build_array(
      jsonb_build_object('id','femur_head', 'label','Femoral head',     'confidence_band',jsonb_build_object('lo',0.83,'hi',0.92)),
      jsonb_build_object('id','acetabulum', 'label','Acetabular cup',   'confidence_band',jsonb_build_object('lo',0.79,'hi',0.88)),
      jsonb_build_object('id','greater_troch','label','Greater trochanter','confidence_band',jsonb_build_object('lo',0.51,'hi',0.62)),
      jsonb_build_object('id','sciatic_nv', 'label','Sciatic nerve',    'confidence_band',jsonb_build_object('lo',0.74,'hi',0.85))
    ),
    'edges', jsonb_build_array(
      jsonb_build_object('from','femur_head','to','acetabulum','rel','articulates_with')
    )
  ),
  jsonb_build_object('p10',0.55,'p50',0.81,'p90',0.90,'below_threshold_count',1)
WHERE NOT EXISTS (
  SELECT 1 FROM anatomy_graphs
   WHERE forge_run_id = '00000000-0000-0000-0000-000000000001'::uuid
);

-- ─── shot_lists (v1 pre-Mara, v2 post-Mara) ─────────────────────────────
INSERT INTO shot_lists (forge_run_id, version, shot_list_json, created_by)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid, 1,
  jsonb_build_object(
    'logline','A 90-second walkthrough of your hip replacement procedure.',
    'beats', jsonb_build_array(
      jsonb_build_object('id','shot_1','procedure_step_id','§1',  'narrator_line','You will fast from midnight before surgery.'),
      jsonb_build_object('id','shot_2','procedure_step_id','§2.1','narrator_line','You will lie on your side; the surgical team will position you.'),
      jsonb_build_object('id','shot_3','procedure_step_id','§2.3','narrator_line','You should consider asking your surgeon about cup positioning.'),
      jsonb_build_object('id','shot_4','procedure_step_id','§3',  'narrator_line','The surgeon will fit a metal stem into your femur.'),
      jsonb_build_object('id','shot_5','procedure_step_id','§4',  'narrator_line','You can begin walking on the same day with assistance.')
    )
  ),
  'atlas'
WHERE NOT EXISTS (
  SELECT 1 FROM shot_lists
   WHERE forge_run_id = '00000000-0000-0000-0000-000000000001'::uuid
     AND version = 1
);

INSERT INTO shot_lists (forge_run_id, version, shot_list_json, created_by)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid, 2,
  jsonb_build_object(
    'logline','A 90-second walkthrough of your hip replacement procedure.',
    'beats', jsonb_build_array(
      jsonb_build_object('id','shot_1','procedure_step_id','§1',  'narrator_line','You will fast from midnight before surgery.'),
      jsonb_build_object('id','shot_2','procedure_step_id','§2.1','narrator_line','You will lie on your side; the surgical team will position you.'),
      jsonb_build_object('id','shot_3','procedure_step_id','§2.3','narrator_line','Your surgeon will prepare the acetabular cup using fluoroscopy guidance.'),
      jsonb_build_object('id','shot_4','procedure_step_id','§3',  'narrator_line','The surgeon will fit a metal stem into your femur.'),
      jsonb_build_object('id','shot_5','procedure_step_id','§4',  'narrator_line','You can begin walking on the same day with assistance.')
    )
  ),
  'atlas-after-mara'
WHERE NOT EXISTS (
  SELECT 1 FROM shot_lists
   WHERE forge_run_id = '00000000-0000-0000-0000-000000000001'::uuid
     AND version = 2
);

-- ─── critiques (Mara's deliberate advice_creep warn on shot_3) ──────────
INSERT INTO critiques (
  forge_run_id, shot_id, severity, category, excerpt, reason,
  suggested_revision, persona
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'shot_3', 'warn', 'advice_creep',
  'You should consider asking your surgeon about cup positioning.',
  'Crosses from explaining to recommending. Patient guidance must come from the surgeon, not the explainer.',
  'Your surgeon will prepare the acetabular cup using fluoroscopy guidance.',
  'mara'
WHERE NOT EXISTS (
  SELECT 1 FROM critiques
   WHERE forge_run_id = '00000000-0000-0000-0000-000000000001'::uuid
     AND shot_id = 'shot_3'
);

-- ─── critic_scores: Beat 3 reject (0.71) → regen accept (0.86) ──────────
INSERT INTO critic_scores (
  forge_run_id, beat_id, regen_attempt,
  anatomical_fidelity, procedure_step_compliance, on_screen_text_violations,
  feedback, accepted, accepted_with_low_score, persona
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'shot_3', 0, 0.710, 0.840, 0,
  'Acetabular reaming visualized too distally; cup orientation reads as anteverted beyond plan.',
  false, false, 'lyra'
WHERE NOT EXISTS (
  SELECT 1 FROM critic_scores
   WHERE forge_run_id = '00000000-0000-0000-0000-000000000001'::uuid
     AND beat_id = 'shot_3'
     AND regen_attempt = 0
);

INSERT INTO critic_scores (
  forge_run_id, beat_id, regen_attempt,
  anatomical_fidelity, procedure_step_compliance, on_screen_text_violations,
  feedback, accepted, accepted_with_low_score, persona
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'shot_3', 1, 0.860, 0.910, 0,
  'Cup orientation now matches plan. Reamer depth corrected.',
  true, false, 'lyra'
WHERE NOT EXISTS (
  SELECT 1 FROM critic_scores
   WHERE forge_run_id = '00000000-0000-0000-0000-000000000001'::uuid
     AND beat_id = 'shot_3'
     AND regen_attempt = 1
);

-- A second beat that is accepted on the first try, for HUD variety.
INSERT INTO critic_scores (
  forge_run_id, beat_id, regen_attempt,
  anatomical_fidelity, procedure_step_compliance, on_screen_text_violations,
  feedback, accepted, accepted_with_low_score, persona
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'shot_4', 0, 0.890, 0.910, 0,
  'Stem placement matches procedure-plan §3.',
  true, false, 'lyra'
WHERE NOT EXISTS (
  SELECT 1 FROM critic_scores
   WHERE forge_run_id = '00000000-0000-0000-0000-000000000001'::uuid
     AND beat_id = 'shot_4'
     AND regen_attempt = 0
);

-- ─── audit_citations (Invariant 4) ──────────────────────────────────────
INSERT INTO audit_citations (
  forge_run_id, claim_id, narrator_excerpt, source_type, pointer,
  confidence_lo, confidence_hi
)
SELECT * FROM (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid,'claim_1','You will fast from midnight before surgery.',                  'procedure_plan','§1',     0.95::numeric, 0.99::numeric),
  ('00000000-0000-0000-0000-000000000001'::uuid,'claim_2','You will lie on your side; the surgical team will position you.','procedure_plan','§2.1',   0.90::numeric, 0.95::numeric),
  ('00000000-0000-0000-0000-000000000001'::uuid,'claim_3','Your surgeon will prepare the acetabular cup using fluoroscopy guidance.','procedure_plan','§2.3',0.88::numeric, 0.94::numeric),
  ('00000000-0000-0000-0000-000000000001'::uuid,'claim_4','The surgeon will fit a metal stem into your femur.',           'procedure_plan','§3',     0.92::numeric, 0.97::numeric),
  ('00000000-0000-0000-0000-000000000001'::uuid,'claim_5','You can begin walking on the same day with assistance.',       'pmid',          'PMID:30429547', 0.80::numeric, 0.91::numeric)
) AS v(forge_run_id, claim_id, narrator_excerpt, source_type, pointer, confidence_lo, confidence_hi)
WHERE NOT EXISTS (
  SELECT 1 FROM audit_citations a
   WHERE a.forge_run_id = v.forge_run_id
     AND a.claim_id = v.claim_id
);

-- ─── Migration ledger ──────────────────────────────────────────────────
INSERT INTO _migrations (name) VALUES ('0002_seed_fixtures')
  ON CONFLICT (name) DO NOTHING;
