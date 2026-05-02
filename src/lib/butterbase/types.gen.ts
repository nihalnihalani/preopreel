// ============================================================================
// src/lib/butterbase/types.gen.ts — hand-written DB row types (Phase 3).
//
// Promo: BUTTERBASE0502 — Submission: butterbase0502
// Reference: https://www.youtube.com/watch?v=SHnryHJL9xc
//
// In Phase 4, replace this with `npx butterbase gen types` output. For now
// these are kept aligned by hand to butterbase/migrations/0001_initial_schema.sql.
// Drift is caught by `tests/butterbase/test_persist.test.ts` round-tripping
// through pg-mem (or direct pg in CI).
// ============================================================================

// ─── Enums ────────────────────────────────────────────────────────────────
export type ForgeRunStatusRow =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ForgeRunDemoModeRow = "live" | "replay" | "hybrid";

export type CritiqueSeverityRow = "block" | "warn" | "info";

export type CritiqueCategoryRow =
  | "advice_creep"
  | "uncited_claim"
  | "ambiguity"
  | "scope_creep"
  | "anatomical_invention"
  | "population_assumption"
  | "imperative_overreach"
  | "cited_but_irrelevant";

export type CitationSourceRow = "procedure_plan" | "pmid" | "curated_protocol";

export type ReplayCodecRow = "json" | "mp4" | "png" | "wav" | "pdf";

// ─── Row types ────────────────────────────────────────────────────────────
export interface ForgeRunRow {
  id: string;
  status: ForgeRunStatusRow;
  stage: string;
  demo_mode: ForgeRunDemoModeRow;
  durations_ms: Record<string, number>;
  cost_usd: Record<string, number>;
  error: string | null;
  explainer_mp4_url: string | null;
  audit_trail_pdf_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProcedurePlanRow {
  id: string;
  forge_run_id: string;
  pdf_url: string;
  parsed_json: unknown;
  uploaded_at: string;
}

export interface PatientDemographicsRow {
  id: string;
  forge_run_id: string;
  age: number;
  sex: "female" | "male" | "intersex" | "unspecified";
  bmi: number | null;
  comorbidities: string[];
  synthetic_phantom: boolean;
}

export interface AnatomyGraphRow {
  id: string;
  forge_run_id: string;
  graph_json: unknown;
  confidence_distribution: Record<string, number>;
  created_at: string;
}

export interface ShotListRow {
  id: string;
  forge_run_id: string;
  version: number;
  shot_list_json: unknown;
  created_by: "atlas" | "atlas-after-mara";
  created_at: string;
}

export interface CritiqueRow {
  id: string;
  forge_run_id: string;
  shot_id: string;
  severity: CritiqueSeverityRow;
  category: CritiqueCategoryRow;
  excerpt: string;
  reason: string;
  suggested_revision: string | null;
  persona: "mara";
  created_at: string;
}

export interface CriticScoreRow {
  id: string;
  forge_run_id: string;
  beat_id: string;
  regen_attempt: number;
  anatomical_fidelity: number;
  procedure_step_compliance: number;
  on_screen_text_violations: number;
  feedback: string;
  accepted: boolean;
  accepted_with_low_score: boolean;
  persona: "lyra";
  created_at: string;
}

export interface AuditCitationRow {
  id: string;
  forge_run_id: string;
  claim_id: string;
  narrator_excerpt: string;
  source_type: CitationSourceRow;
  pointer: string;
  confidence_lo: number | null;
  confidence_hi: number | null;
}

export interface ReplayFixtureRow {
  id: string;
  stage: string;
  key: string;
  codec: ReplayCodecRow;
  bytes: Buffer | null;
  storage_url: string | null;
  created_at: string;
}

export interface OmnihumanConsentRow {
  id: string;
  surgeon_id: string;
  photo_storage_url: string;
  consent_signed_at: string;
}

// ─── Joined view used by the receipt page ────────────────────────────────
export interface ForgeRunWithDetails extends ForgeRunRow {
  procedure_plan: ProcedurePlanRow | null;
  patient_demographics: PatientDemographicsRow | null;
  anatomy_graph: AnatomyGraphRow | null;
  shot_lists: ShotListRow[];
  critiques: CritiqueRow[];
  critic_scores: CriticScoreRow[];
  audit_citations: AuditCitationRow[];
  // Lazily-minted signed URLs (Mara E.3 mitigation).
  explainer_signed_url: string | null;
  audit_signed_url: string | null;
}

// ─── Storage bucket layout (single source of truth for path keys) ────────
export const BUCKET_NAME = "preopreel-renders";
export const BUCKET_LAYOUT = {
  explainers: (forgeRunId: string): string =>
    `explainers/${forgeRunId}.mp4`,
  audit: (forgeRunId: string): string => `audit/${forgeRunId}.pdf`,
  keyframes: (forgeRunId: string, beatId: string): string =>
    `keyframes/${forgeRunId}/${beatId}.png`,
  uploads: (forgeRunId: string, filename = "plan.pdf"): string =>
    `uploads/${forgeRunId}/${filename}`,
  replay: (forgeRunId: string, stage: string, key: string, ext: string): string =>
    `replay/${forgeRunId}/${stage}/${key}.${ext}`,
} as const;
