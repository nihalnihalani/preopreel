// Schema module — Critique (Mara, pre-render) and CriticScore (Lyra,
// post-render). Schemas match README §3.1 / §3.2 verbatim, extended
// per Mara A.1 mitigation.
//
// Mara A.1 mitigation: CritiqueCategory enum is EXTENDED beyond the
// original 5 categories with three additions surfaced in plan 06:
//   - population_assumption  (e.g., "many patients find it helpful…")
//   - imperative_overreach   (imperative tense aimed at the patient
//                             outside the surgeon-supplied allowlist)
//   - cited_but_irrelevant   (citation present but doesn't actually
//                             support the claim)
// These cover the slip-throughs Mara documented in plan 06 §A.1.
import { z } from "zod";

// ─── CritiqueSeverity ─────────────────────────────────────────────
// block — Atlas MUST apply suggested_revision or redraft the shot.
// warn  — Atlas SHOULD revise but may proceed if the line is correct.
// info  — Mara is noting something for the audit trail; no action.
export const CritiqueSeverity = z.enum(["block", "warn", "info"]);
export type CritiqueSeverity = z.infer<typeof CritiqueSeverity>;

// ─── CritiqueCategory ─────────────────────────────────────────────
// Frozen set per README §3.1, EXTENDED per Mara A.1. New categories
// require a Mara prompt update and a critic-loop-reviewer pass
// (CLAUDE.md §"Critic-Path Gate").
export const CritiqueCategory = z.enum([
  // ─ original 5 (README §3.1) ─
  "advice_creep", // "you should", "consider", "we recommend"
  "uncited_claim", // narrator_line with no traceable Citation
  "ambiguity", // ≥2 reasonable interpretations
  "scope_creep", // outside this patient's procedure plan
  "anatomical_invention", // mentions a structure not in AnatomyGraph
  // ─ Mara A.1 additions (plan 06) ─
  "population_assumption", // "many patients find it helpful…"
  "imperative_overreach", // imperative aimed at patient, outside allowlist
  "cited_but_irrelevant", // Citation attached but doesn't support the claim
]);
export type CritiqueCategory = z.infer<typeof CritiqueCategory>;

// ─── Critique (Mara's output) ─────────────────────────────────────
// shot_id is the ShotBeat.id Mara is critiquing. excerpt and reason
// are both ≤200 chars (README §3.1 verbatim). suggested_revision is
// optional but Mara is encouraged to provide one — Atlas applies it
// directly when severity === "block".
export const Critique = z
  .object({
    shot_id: z.string().min(1).max(48),
    severity: CritiqueSeverity,
    category: CritiqueCategory,
    excerpt: z.string().min(1).max(200),
    reason: z.string().min(1).max(200),
    suggested_revision: z.string().min(1).max(300).optional(),
  })
  .strict();
export type Critique = z.infer<typeof Critique>;

// ─── CriticScore (Lyra's output) ──────────────────────────────────
// Per-beat post-render scoring. Decision rule lives in critic.ts:
//   min(anatomical_fidelity, procedure_step_compliance) < 0.75
//   OR on_screen_text_violations > 0
//   ⇒ regenerate (1 budget per beat).
// feedback is the rebuild-prompt seed for the regen.
//
// Mara A.3 mitigation surface: accepted_with_low_score is set by the
// critic loop (NOT by Lyra) when the regen budget is exhausted and
// the beat is accepted with a min score below threshold. The HUD
// renders an honest badge so judges see trust-not-theater.
export const CriticScore = z
  .object({
    beat_id: z.string().min(1).max(48),
    anatomical_fidelity: z.number().min(0).max(1),
    procedure_step_compliance: z.number().min(0).max(1),
    on_screen_text_violations: z.number().int().min(0).max(20),
    feedback: z.string().min(1).max(120),
    // Mara A.3: optional flag set by critic loop when regen budget
    // exhausted but beat is accepted with a score < threshold.
    // Defaulted false; Lyra never sets this herself.
    accepted_with_low_score: z.boolean().optional(),
    // Attempt index (0 = first render, 1 = post-regen, etc.). Critic
    // trace records every attempt; honesty over theater per CLAUDE.md.
    attempt: z.number().int().min(0).max(5).optional(),
  })
  .strict();
export type CriticScore = z.infer<typeof CriticScore>;
