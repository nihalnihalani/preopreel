# Plan 03 — Zod Schemas + Persona Modules

> **Owner:** Schema + Personas Dev
> **Phase:** 3 (foundations — blocks Stages 3, 4, 5, 7, 9, 10, 11, 12)
> **Status:** plan-only; no code lands until this plan is approved by Atlas (Lead)
> **Invariants touched:** 1 (critic loop), 4 (audit trail). Both are *load-bearing* in this plan.

This plan covers two slices of the Phase-3 foundation:

1. **All Zod schemas** that cross stage boundaries — `ForgeRun`, `Citation`, `AnatomyGraph`, `ShotList`, `Critique`, `CriticScore`, `Deliverable`, `AuditEntry`. These are the typed-contract layer that lets every persona round-trip without freeform JSON.
2. **All six persona modules** — `atlas-surgical`, `tavi`, `exa`, `gem`, `lyra`, `mara`. Production system prompts, few-shots, integration contracts. Treat the prompts as final; competitive edge is that the personas behave like personas.

Sequential dependency (CLAUDE.md §"Sequential Dependencies"): `seed/models.ts` → `seed/ark.ts` + `replay.ts` → **this plan** → `personas/atlas-surgical.ts` → ... → demo.

---

## Section A — Zod Schemas

All schemas live under `src/lib/forge/`. Every export is a `z.object(...)` plus an inferred `z.infer<typeof X>` type alias. Strict mode (`.strict()`) where the contract is closed; passthrough only where a sponsor SDK appends fields we don't control. **No naked `z.any()` ever** — invariant 4 (audit trail) requires we know every field's provenance.

### A.1 `src/lib/forge/types.ts` — top-level types

This file holds everything that isn't pinned to a single stage: run-state, status enum, citation primitive. It is imported by every other schema file.

```ts
import { z } from "zod";

// ─── ForgeRunStatus ─────────────────────────────────────────────
// Stage names mirror CLAUDE.md §"Synthesis Core Loop". One enum value
// per stage that the worker can pause inside; "done" and "failed" are
// terminal. No transitions back to "pending" once running.
export const ForgeRunStatus = z.enum([
  "pending",
  "parsing",            // Stage 1 (intake + PDF parse)
  "researching",        // Stage 2 (Tavi + Exa + Gem + pdf-parse)
  "directing",          // Stage 3 (Atlas drafts ShotList)
  "critiquing",         // Stage 4 (Mara pre-render Critique[])
  "bibling",            // Stage 5 (anatomy bible refs)
  "renderingKeyframes", // Stage 7 (Seedream Tier-0 anchors)
  "renderingVideo",     // Stage 9 (Seedance per beat)
  "scoring",            // Stage 10 (Lyra vision-critic)
  "narrating",          // Stage 11 (Seed Speech + opt OmniHuman)
  "composing",          // Stage 12 (Remotion render)
  "done",
  "failed",
]);
export type ForgeRunStatus = z.infer<typeof ForgeRunStatus>;

// ─── DemoMode ─────────────────────────────────────────────
// Mirrors invariant 3. Used by replay.ts, the worker, and the HUD.
export const DemoMode = z.enum(["live", "replay", "hybrid"]);
export type DemoMode = z.infer<typeof DemoMode>;

// ─── DurationsMs ─────────────────────────────────────────────
// Per-stage wall-clock duration, ms. Keys are ForgeRunStatus values
// (excluding terminal states). Optional because not every run reaches
// every stage (bail on Mara block-severity, etc.).
export const DurationsMs = z.object({
  parsing: z.number().int().nonnegative().optional(),
  researching: z.number().int().nonnegative().optional(),
  directing: z.number().int().nonnegative().optional(),
  critiquing: z.number().int().nonnegative().optional(),
  bibling: z.number().int().nonnegative().optional(),
  renderingKeyframes: z.number().int().nonnegative().optional(),
  renderingVideo: z.number().int().nonnegative().optional(),
  scoring: z.number().int().nonnegative().optional(),
  narrating: z.number().int().nonnegative().optional(),
  composing: z.number().int().nonnegative().optional(),
}).strict();
export type DurationsMs = z.infer<typeof DurationsMs>;

// ─── CostUsd ─────────────────────────────────────────────
// Per-stage USD spend; same shape as DurationsMs. Cost HUD reads this.
export const CostUsd = z.object({
  parsing: z.number().nonnegative().optional(),
  researching: z.number().nonnegative().optional(),
  directing: z.number().nonnegative().optional(),
  critiquing: z.number().nonnegative().optional(),
  bibling: z.number().nonnegative().optional(),
  renderingKeyframes: z.number().nonnegative().optional(),
  renderingVideo: z.number().nonnegative().optional(),
  scoring: z.number().nonnegative().optional(),
  narrating: z.number().nonnegative().optional(),
  composing: z.number().nonnegative().optional(),
}).strict();
export type CostUsd = z.infer<typeof CostUsd>;

// ─── ForgeRun ─────────────────────────────────────────────
// The top-level run record. Stored in Redis at pre:run:{id} and
// written to the SSE stream. Status + stage are duplicated on purpose:
// "stage" is the granular cursor; "status" is the coarse state machine.
export const ForgeRun = z.object({
  id: z.string().uuid(),                          // canonical ForgeRun id
  createdAt: z.string().datetime({ offset: true }), // ISO 8601 with TZ
  status: ForgeRunStatus,
  stage: ForgeRunStatus,                          // current stage cursor
  demoMode: DemoMode,
  durationsMs: DurationsMs,
  costUsd: CostUsd,
  error: z.string().nullable(),                   // null until status="failed"
}).strict();
export type ForgeRun = z.infer<typeof ForgeRun>;

// ─── Citation ─────────────────────────────────────────────
// Invariant 4. Every claim that touches user-visible output (overlay,
// narrator_line, audit PDF row) carries one of these.
//
// sourceType:
//   procedure_plan     — surgeon's PDF; pointer like "§2.3" or "p.4 ¶2"
//   pmid               — peer-reviewed protocol; pointer like "PMID:12345"
//   curated_protocol   — entry id in data/surgical-protocols-references.json
//
// excerpt: ≤300 chars copied verbatim from the source so reviewers can
// match-without-clicking. NOT a paraphrase.
export const SourceType = z.enum([
  "procedure_plan",
  "pmid",
  "curated_protocol",
]);
export type SourceType = z.infer<typeof SourceType>;

export const Citation = z.object({
  sourceType: SourceType,
  pointer: z.string().min(1).max(80),
  excerpt: z.string().min(1).max(300),
}).strict().refine(
  (c) => {
    // sourceType-specific pointer format checks. Loose by design — Tavi
    // can return slightly malformed PMIDs and we'd rather warn than block.
    if (c.sourceType === "pmid") return /^PMID:\d{1,9}$/i.test(c.pointer);
    if (c.sourceType === "procedure_plan") return /^(§|p\.)/.test(c.pointer);
    if (c.sourceType === "curated_protocol") return /^[a-z0-9_-]+$/.test(c.pointer);
    return true;
  },
  { message: "pointer format does not match sourceType" },
);
export type Citation = z.infer<typeof Citation>;
```

**Invariants enforced**

- `ForgeRun.id` is a valid UUID — keys in Redis cannot collide with arbitrary strings.
- `ForgeRun.error` is non-undefined; explicit `null` is required when not failed (forces the worker to set it).
- `ForgeRun.status === "failed" ⇒ error !== null` — enforced at the worker layer in a separate type-guard (Zod refinement omitted because the worker may briefly write `failed` before the error message is populated; we don't want a Zod parse error in that race).
- `Citation.excerpt ≤ 300 chars` — fits one row of the audit-trail PDF without overflow.
- `Citation.pointer` shape per `sourceType` — keeps the audit PDF parseable by `verify_audit_trail.py`.

**Example values (pass)**

```ts
// 1) brand-new run, just enqueued
{
  id: "0f5e8a3a-2c1f-4f4f-9c3a-8c1d2b9e1aaa",
  createdAt: "2026-05-02T17:31:07.000-07:00",
  status: "pending", stage: "pending",
  demoMode: "replay",
  durationsMs: {}, costUsd: {}, error: null,
}

// 2) mid-render
{
  id: "11111111-2222-3333-4444-555555555555",
  createdAt: "2026-05-02T17:32:00.000-07:00",
  status: "renderingVideo", stage: "renderingVideo",
  demoMode: "hybrid",
  durationsMs: { parsing: 220, researching: 4180, directing: 9100, critiquing: 1700, bibling: 6300, renderingKeyframes: 12500 },
  costUsd: { directing: 0.08, critiquing: 0.04, renderingKeyframes: 0.32 },
  error: null,
}

// 3) Citation pointing into the surgeon's PDF
{ sourceType: "procedure_plan", pointer: "§2.3", excerpt: "Posterior approach via 8–10cm incision over greater trochanter." }
```

---

### A.2 `src/lib/forge/anatomyGraph.ts` — `AnatomyGraph`

Output of Gem (Stage 2c). Consumed by Atlas (Stage 3 ShotList drafting), Lyra (Stage 5 anatomy bible + Stage 10 vision critic), and the audit PDF generator.

```ts
import { z } from "zod";

// ─── Patient ─────────────────────────────────────────────
// Synthetic phantom on the demo path; real anonymized scans in deploy.
// Sex is biological for surgical relevance (anatomical defaults), not
// identity. Comorbidities is a free-text list bounded to ≤8 items.
export const Sex = z.enum(["male", "female", "intersex", "unknown"]);

export const Patient = z.object({
  id: z.string().min(1).max(64),                  // synthetic-phantom-001
  age: z.number().int().min(0).max(120),
  sex: Sex,
  bmi: z.number().min(8).max(80),                  // physiologically plausible
  comorbidities: z.array(z.string().min(1).max(120)).max(8),
}).strict();
export type Patient = z.infer<typeof Patient>;

// ─── SurgicalStep ─────────────────────────────────────────────
// Atomic unit of the procedure plan. Atlas may not emit a beat that
// references a SurgicalStep id not present here. Mara enforces this
// pre-render (category: "scope_creep" or "anatomical_invention").
export const SurgicalStep = z.object({
  id: z.string().min(1).max(64),                   // "step-04-acetabular-reaming"
  ordinal: z.number().int().min(1).max(64),         // 1-indexed plan order
  description: z.string().min(1).max(400),
  // pointer back into the surgeon's PDF — every step traces home.
  sourcePointer: z.string().min(1).max(80),         // "§3.2" or "p.5 ¶1"
}).strict();
export type SurgicalStep = z.infer<typeof SurgicalStep>;

// ─── Procedure ─────────────────────────────────────────────
// approach is a free-text string ("posterior", "anterior", "lateral");
// cptCode follows AMA CPT format (5 numeric or trailing letter).
export const Procedure = z.object({
  id: z.string().min(1).max(64),                    // "hip-replacement-posterior"
  name: z.string().min(1).max(120),                  // "Total Hip Arthroplasty"
  approach: z.string().min(1).max(80),
  cptCode: z.string().regex(/^\d{4,5}[A-Za-z]?$/),
  surgicalSteps: z.array(SurgicalStep).min(1).max(40),
}).strict();
export type Procedure = z.infer<typeof Procedure>;

// ─── ConfidenceBand ─────────────────────────────────────────────
// Honesty > theater. Every landmark Gem extracts gets a band; the
// HUD overlays it as a visible band, not a hidden number.
export const ConfidenceBand = z.object({
  lo: z.number().min(0).max(1),
  hi: z.number().min(0).max(1),
}).strict().refine((b) => b.lo <= b.hi, { message: "lo must be <= hi" });
export type ConfidenceBand = z.infer<typeof ConfidenceBand>;

// ─── AnatomicalSystem ─────────────────────────────────────────────
// Coarse buckets — narrow enough that Lyra's vision critic can route
// per-system ref images, broad enough to cover the procedure library.
export const AnatomicalSystem = z.enum([
  "musculoskeletal", "cardiovascular", "nervous", "respiratory",
  "digestive", "urogenital", "integumentary", "endocrine",
  "lymphatic", "ophthalmic", "ent", "other",
]);

// ─── Landmark ─────────────────────────────────────────────
// id is stable across regenerations of the same plan (deterministic
// hash of label + system); label is human-readable for overlays.
export const Landmark = z.object({
  id: z.string().min(1).max(64),                    // "lm-acetabulum-right"
  label: z.string().min(1).max(80),                  // "Right Acetabulum"
  anatomicalSystem: AnatomicalSystem,
  confidenceBand: ConfidenceBand,
}).strict();
export type Landmark = z.infer<typeof Landmark>;

// ─── Relationship ─────────────────────────────────────────────
// Used by Atlas to phrase narrator_lines that talk about *how* one
// landmark relates to another ("the femoral head sits inside the
// acetabulum"). Lyra uses these to verify the rendered scene shows
// the relationship correctly (anatomical_fidelity score).
export const RelationshipKind = z.enum([
  "adjacent_to",
  "passes_through",
  "anchors",
  "supplies",
  "drains",
  "innervates",
  "covers",
  "contains",
]);

export const Relationship = z.object({
  sourceLandmarkId: z.string().min(1).max(64),
  targetLandmarkId: z.string().min(1).max(64),
  relation: RelationshipKind,
}).strict();
export type Relationship = z.infer<typeof Relationship>;

// ─── AnatomyGraph ─────────────────────────────────────────────
// The full typed graph. Refinement: every Relationship's source/target
// landmark id must exist in landmarks[] (closed graph).
export const AnatomyGraph = z.object({
  patient: Patient,
  procedure: Procedure,
  landmarks: z.array(Landmark).min(1).max(60),
  relationships: z.array(Relationship).max(200),
}).strict().superRefine((g, ctx) => {
  const ids = new Set(g.landmarks.map((l) => l.id));
  g.relationships.forEach((r, i) => {
    if (!ids.has(r.sourceLandmarkId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["relationships", i, "sourceLandmarkId"], message: "unknown landmark id" });
    }
    if (!ids.has(r.targetLandmarkId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["relationships", i, "targetLandmarkId"], message: "unknown landmark id" });
    }
  });
});
export type AnatomyGraph = z.infer<typeof AnatomyGraph>;
```

**Invariants enforced**

- Closed graph: every relationship endpoint exists in `landmarks[]`.
- `bmi ∈ [8, 80]`, `age ∈ [0, 120]` — physiologically plausible (cuts off Gem hallucination).
- `landmarks.length ∈ [1, 60]` — ≥1 because a graph with no landmarks is never useful; ≤60 because Lyra can't ref-image more than that without per-shot timeout.
- `confidenceBand.lo ≤ hi`.
- `cptCode` regex matches AMA format.
- `surgicalSteps.length ≥ 1` and each step has a `sourcePointer`.

**Example values (pass)**

```ts
// 1) demo case — synthetic phantom posterior hip replacement
{
  patient: { id: "synthetic-phantom-001", age: 65, sex: "female", bmi: 28, comorbidities: ["hypertension", "type-2 diabetes"] },
  procedure: {
    id: "hip-replacement-posterior", name: "Total Hip Arthroplasty",
    approach: "posterior", cptCode: "27130",
    surgicalSteps: [
      { id: "step-01-incision", ordinal: 1, description: "Posterior incision over greater trochanter, ~10cm.", sourcePointer: "§2.3" },
      { id: "step-02-capsulotomy", ordinal: 2, description: "Capsulotomy preserving short external rotators where possible.", sourcePointer: "§2.4" },
    ],
  },
  landmarks: [
    { id: "lm-acetabulum-right", label: "Right Acetabulum", anatomicalSystem: "musculoskeletal", confidenceBand: { lo: 0.84, hi: 0.96 } },
    { id: "lm-femoral-head-right", label: "Right Femoral Head", anatomicalSystem: "musculoskeletal", confidenceBand: { lo: 0.86, hi: 0.97 } },
  ],
  relationships: [
    { sourceLandmarkId: "lm-femoral-head-right", targetLandmarkId: "lm-acetabulum-right", relation: "contains" },
  ],
}

// 2) tiny-but-valid case (single step, single landmark)
{
  patient: { id: "p-002", age: 42, sex: "male", bmi: 24.5, comorbidities: [] },
  procedure: { id: "carpal-tunnel-release", name: "Carpal Tunnel Release", approach: "open", cptCode: "64721", surgicalSteps: [{ id: "step-1", ordinal: 1, description: "Transverse carpal ligament release.", sourcePointer: "§1.1" }] },
  landmarks: [{ id: "lm-median-nerve", label: "Median Nerve", anatomicalSystem: "nervous", confidenceBand: { lo: 0.7, hi: 0.85 } }],
  relationships: [],
}
```

---

### A.3 `src/lib/forge/shotList.ts` — `ShotList`

Output of Atlas (Stage 3). Consumed by Mara (Stage 4 critique), Lyra (Stage 5 bible + Stage 7 keyframes), the prompt compiler (Stage 8), and the narrator (Stage 11).

```ts
import { z } from "zod";
import { Citation } from "./types";

// ─── CameraAngle ─────────────────────────────────────────────
// Bounded set so the cinema-lens taxonomy (Stage 6) can map angle →
// suffix deterministically. New angles require updating the lens table.
export const CameraAngle = z.enum([
  "wide_establishing",
  "medium_oblique",
  "close_anatomical",
  "macro_instrument",
  "patient_pov",
  "surgeon_pov",
  "cross_section",
  "exploded_view",
]);
export type CameraAngle = z.infer<typeof CameraAngle>;

// ─── BeatMood ─────────────────────────────────────────────
// Two values only. Anything more emotive (alarm, urgency, concern)
// crosses the line into advice-creep — Mara would block it.
export const BeatMood = z.enum(["calm", "neutral"]);
export type BeatMood = z.infer<typeof BeatMood>;

// ─── ShotBeat ─────────────────────────────────────────────
// One Seedance-renderable unit. Total ShotList duration must sum to
// 60..90s; enforced by the parent ShotList superRefine.
//
// procedureStepId is FK into AnatomyGraph.procedure.surgicalSteps[].id
// anatomicalFocus is FK array into AnatomyGraph.landmarks[].id
// citations[] are inline Citation objects (audit invariant 4)
export const ShotBeat = z.object({
  id: z.string().min(1).max(48),                    // "beat-03-acetabular-reaming"
  durationS: z.number().min(2).max(15),             // ≤5 → straight T2V; >5 → seedance-extend
  procedureStepId: z.string().min(1).max(64),
  anatomicalFocus: z.array(z.string().min(1).max(64)).min(1).max(6),
  cameraAngle: CameraAngle,
  narratorLine: z.string().min(1).max(300),
  citations: z.array(Citation).min(1).max(4),       // ≥1 — invariant 4
  mood: BeatMood,
}).strict();
export type ShotBeat = z.infer<typeof ShotBeat>;

// ─── ShotList ─────────────────────────────────────────────
// logline is the 1-sentence elevator pitch shown at the top of the
// audit PDF and used as the demo HUD's title. ≤180 chars.
//
// Total duration constraint: 60..90s (README §1).
// Beat count: 4..10 (loose; demo case is 6).
export const ShotList = z.object({
  logline: z.string().min(1).max(180),
  beats: z.array(ShotBeat).min(4).max(10),
}).strict().superRefine((sl, ctx) => {
  const total = sl.beats.reduce((s, b) => s + b.durationS, 0);
  if (total < 60 || total > 90) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["beats"], message: `total duration ${total}s outside 60..90s` });
  }
  // beat ids must be unique
  const ids = new Set<string>();
  sl.beats.forEach((b, i) => {
    if (ids.has(b.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["beats", i, "id"], message: "duplicate beat id" });
    ids.add(b.id);
  });
});
export type ShotList = z.infer<typeof ShotList>;
```

**Invariants enforced**

- `logline ≤ 180 chars`.
- Total beat duration ∈ `[60, 90]`s — README §1 contract.
- Beat count ∈ `[4, 10]` — under 4, the explainer can't carry information; over 10, individual beats become too short to render coherently.
- `narratorLine ≤ 300 chars` — fits in one Seed Speech segment without truncation.
- `citations.length ≥ 1` per beat — invariant 4 (no narrator line without provenance).
- `anatomicalFocus.length ≥ 1` — every beat must focus on something extractable from the AnatomyGraph.
- Beat ids unique within the ShotList.

**Example values (pass)**

```ts
// 1) abbreviated demo case (3 of 6 beats shown)
{
  logline: "A calm, plain-language walkthrough of your posterior hip replacement, step by step.",
  beats: [
    {
      id: "beat-01-overview",
      durationS: 10,
      procedureStepId: "step-01-incision",
      anatomicalFocus: ["lm-acetabulum-right", "lm-femoral-head-right"],
      cameraAngle: "wide_establishing",
      narratorLine: "Today we'll be replacing the worn surface of your right hip joint, using the posterior approach your surgeon described.",
      citations: [{ sourceType: "procedure_plan", pointer: "§2.3", excerpt: "Posterior approach via 8–10cm incision over greater trochanter." }],
      mood: "calm",
    },
    {
      id: "beat-02-incision",
      durationS: 12,
      procedureStepId: "step-01-incision",
      anatomicalFocus: ["lm-greater-trochanter-right"],
      cameraAngle: "medium_oblique",
      narratorLine: "An incision is made along the back of the hip, about 10 centimeters long, over the bony point you can feel on the side.",
      citations: [{ sourceType: "procedure_plan", pointer: "§2.3", excerpt: "Posterior approach via 8–10cm incision over greater trochanter." }],
      mood: "neutral",
    },
    {
      id: "beat-03-reaming",
      durationS: 15,
      procedureStepId: "step-04-acetabular-reaming",
      anatomicalFocus: ["lm-acetabulum-right"],
      cameraAngle: "close_anatomical",
      narratorLine: "Your surgeon shapes the cup-side of the joint to fit the new ceramic socket precisely.",
      citations: [{ sourceType: "procedure_plan", pointer: "§3.2", excerpt: "Sequential acetabular reaming to subchondral bone." }, { sourceType: "pmid", pointer: "PMID:34567890", excerpt: "Anatomic acetabular reaming preserves bone stock." }],
      mood: "neutral",
    },
  ],
}

// 2) minimal valid 4-beat carpal-tunnel example (durations 15+15+15+15 = 60s)
// (omitted for brevity — same shape, single landmark, single citation per beat)
```

---

### A.4 `src/lib/forge/critique.ts` — `Critique` + `CriticScore`

Mara's pre-render output (`Critique[]`, one per flagged shot) and Lyra's post-render output (`CriticScore[]`, one per beat). Schemas match README §3.1 / §3.2 verbatim. Persisted at `pre:critique:{forge_run_id}` and `pre:critic:{forge_run_id}`; both feed `CriticHud.tsx`.

```ts
import { z } from "zod";

// ─── CritiqueSeverity ─────────────────────────────────────────────
// block — Atlas MUST apply suggested_revision or redraft the shot.
// warn  — Atlas SHOULD revise but may proceed if the line is correct.
// info  — Mara is noting something for the audit trail; no action.
export const CritiqueSeverity = z.enum(["block", "warn", "info"]);
export type CritiqueSeverity = z.infer<typeof CritiqueSeverity>;

// ─── CritiqueCategory ─────────────────────────────────────────────
// Frozen set per README §3.1. New categories require a Mara prompt
// update and a critic-loop-reviewer pass (CLAUDE.md §"Critic-Path Gate").
export const CritiqueCategory = z.enum([
  "advice_creep",          // "you should", "consider", "we recommend"
  "uncited_claim",         // narrator_line with no traceable Citation
  "ambiguity",             // ≥2 reasonable interpretations
  "scope_creep",           // outside this patient's procedure plan
  "anatomical_invention",  // mentions a structure not in AnatomyGraph
]);
export type CritiqueCategory = z.infer<typeof CritiqueCategory>;

// ─── Critique (Mara's output) ─────────────────────────────────────
// shot_id is the ShotBeat.id Mara is critiquing. excerpt and reason
// are both ≤200 chars (README §3.1 verbatim). suggested_revision is
// optional but Mara is *encouraged* to provide one — Atlas applies it
// directly when severity === "block".
export const Critique = z.object({
  shot_id: z.string().min(1).max(48),
  severity: CritiqueSeverity,
  category: CritiqueCategory,
  excerpt: z.string().min(1).max(200),
  reason: z.string().min(1).max(200),
  suggested_revision: z.string().min(1).max(300).optional(),
}).strict();
export type Critique = z.infer<typeof Critique>;

// ─── CriticScore (Lyra's output) ──────────────────────────────────
// Per-beat post-render scoring. Decision rule lives in critic.ts:
//   min(anatomical_fidelity, procedure_step_compliance) < 0.75
//   OR on_screen_text_violations > 0
//   ⇒ regenerate (1 budget per beat).
// feedback is the rebuild-prompt seed for the regen.
export const CriticScore = z.object({
  beat_id: z.string().min(1).max(48),
  anatomical_fidelity: z.number().min(0).max(1),
  procedure_step_compliance: z.number().min(0).max(1),
  on_screen_text_violations: z.number().int().min(0).max(20),
  feedback: z.string().min(1).max(120),
}).strict();
export type CriticScore = z.infer<typeof CriticScore>;
```

**Invariants enforced**

- `Critique.excerpt`, `Critique.reason` both `≤200` — fits the HUD sidebar without scroll-truncation.
- `Critique.severity` and `category` are enums, not free-text — keeps the HUD groupable and the persona output testable.
- `CriticScore.{anatomical_fidelity, procedure_step_compliance} ∈ [0, 1]`.
- `CriticScore.on_screen_text_violations ≥ 0` (must be 0 to pass — invariant 4 glyph-soup gate).
- `CriticScore.feedback ≤ 120` chars (README §3.2 verbatim) — short enough to inline into the next Seedance prompt.

**Example values (pass)**

```ts
// 1) Mara catches advice_creep on the demo case (block-severity)
{ shot_id: "beat-04-implant", severity: "block", category: "advice_creep",
  excerpt: "You should consider walking with the cane for at least six weeks after surgery.",
  reason: "Recommendation phrasing 'you should consider' crosses from explanation to advice.",
  suggested_revision: "Your surgeon will tell you when to start walking with a cane and for how long." }

// 2) Mara catches uncited_claim (warn)
{ shot_id: "beat-02-incision", severity: "warn", category: "uncited_claim",
  excerpt: "Posterior incisions heal faster than anterior incisions.",
  reason: "Comparative claim has no procedure-plan or PMID pointer in citations[]." }

// 3) Lyra accepts a clean shot
{ beat_id: "beat-01-overview", anatomical_fidelity: 0.92, procedure_step_compliance: 0.88, on_screen_text_violations: 0, feedback: "Clean composition; pelvis orientation matches AnatomyGraph." }

// 4) Lyra rejects shot 3 (the demo regen moment)
{ beat_id: "beat-03-reaming", anatomical_fidelity: 0.71, procedure_step_compliance: 0.79, on_screen_text_violations: 0, feedback: "Acetabulum mis-oriented; reamer angled wrong relative to pelvis." }
```

---

### A.5 `src/lib/forge/deliverable.ts` — `Deliverable`

The terminal output of a successful run. Returned from `GET /api/forge/{id}` once `status === "done"`.

```ts
import { z } from "zod";
import { CriticScore } from "./critique";

// ─── Deliverable ─────────────────────────────────────────────
// All URLs are signed CDN URLs (DigitalOcean Spaces) or Supabase
// fallback URLs. omnihumanIntroUrl is optional (Layer 2; cut if uncanny).
// totalCostUsd is the sum of ForgeRun.costUsd values, denormalized for
// the deliverable card UI.
// criticTrace[] is the full Lyra score history including any regen
// attempts — judges see the regen sequence in the HUD.
// regenCount is the total number of beat-regenerations across the run.
export const Deliverable = z.object({
  explainerMp4Url: z.string().url(),
  auditTrailPdfUrl: z.string().url(),
  omnihumanIntroUrl: z.string().url().optional(),
  durationS: z.number().min(60).max(90),
  regenCount: z.number().int().min(0).max(20),
  totalCostUsd: z.number().nonnegative(),
  criticTrace: z.array(CriticScore).min(1).max(40),
}).strict();
export type Deliverable = z.infer<typeof Deliverable>;
```

**Invariants enforced**

- `durationS ∈ [60, 90]` — must match `ShotList` total duration; demo-day length contract.
- All URLs are well-formed.
- `criticTrace.length ≥ 1` — even a clean run produces at least one Lyra score per beat (and we have ≥4 beats, so practically ≥4).
- `regenCount ≤ 20` — defensive ceiling; in practice ≤ beats.length × `MAX_REGEN_PER_BEAT`.

**Example values (pass)**

```ts
// 1) clean run, no regen
{
  explainerMp4Url: "https://cdn.preopreel.com/runs/0f5e.../explainer.mp4",
  auditTrailPdfUrl: "https://cdn.preopreel.com/runs/0f5e.../audit.pdf",
  durationS: 78,
  regenCount: 0,
  totalCostUsd: 1.42,
  criticTrace: [
    { beat_id: "beat-01-overview", anatomical_fidelity: 0.92, procedure_step_compliance: 0.88, on_screen_text_violations: 0, feedback: "Clean." },
    /* ... 5 more ... */
  ],
}

// 2) demo case with the visible regen
{
  explainerMp4Url: "https://cdn.preopreel.com/runs/demo-hip/explainer.mp4",
  auditTrailPdfUrl: "https://cdn.preopreel.com/runs/demo-hip/audit.pdf",
  omnihumanIntroUrl: "https://cdn.preopreel.com/runs/demo-hip/intro.mp4",
  durationS: 84,
  regenCount: 1,
  totalCostUsd: 1.78,
  criticTrace: [
    /* clean beats 1,2 */
    { beat_id: "beat-03-reaming", anatomical_fidelity: 0.71, procedure_step_compliance: 0.79, on_screen_text_violations: 0, feedback: "Acetabulum mis-oriented." },
    { beat_id: "beat-03-reaming", anatomical_fidelity: 0.86, procedure_step_compliance: 0.91, on_screen_text_violations: 0, feedback: "Improved orientation; accept." },
    /* ... beats 4,5,6 ... */
  ],
}
```

---

### A.6 `src/lib/forge/audit.ts` — `AuditEntry`

One row of the audit-trail PDF. The PDF generator iterates `AuditEntry[]` and renders one row per entry. `verify_audit_trail.py` reads the same shape from Redis (`pre:audit:{forge_run_id}`) and asserts every claim has a citation.

```ts
import { z } from "zod";
import { Citation } from "./types";
import { ConfidenceBand } from "./anatomyGraph";

// ─── AuditEntry ─────────────────────────────────────────────
// claimId is a deterministic hash of (beat_id + sentence_index) so the
// same claim across regens deduplicates in the PDF.
// criticPasses lists the critic stage names that accepted this claim,
// e.g. ["mara", "lyra"]. Empty array means the claim made it to the
// audit *without* passing a critic — that's a pre-merge gate (a CI
// check refuses to publish such an audit).
export const CriticName = z.enum(["mara", "lyra"]);
export type CriticName = z.infer<typeof CriticName>;

export const AuditEntry = z.object({
  claimId: z.string().min(8).max(64),                // sha1 hex (or shorter)
  narratorLineExcerpt: z.string().min(1).max(300),    // mirrors ShotBeat.narratorLine
  citation: Citation,
  criticPasses: z.array(CriticName).min(1).max(2),    // ≥1 enforced
  confidenceBand: ConfidenceBand,
}).strict();
export type AuditEntry = z.infer<typeof AuditEntry>;
```

**Invariants enforced**

- `criticPasses.length ≥ 1` — invariant 1 (no claim ships without at least one critic pass).
- `narratorLineExcerpt ≤ 300` chars — same envelope as `ShotBeat.narratorLine`.
- `citation` is a fully-formed `Citation` (so the audit row is never orphaned).
- `confidenceBand.lo ≤ hi` (inherited from `ConfidenceBand`).

**Example values (pass)**

```ts
// 1) PDF row for the overview beat
{
  claimId: "a1b2c3d4e5f6a7b8",
  narratorLineExcerpt: "Today we'll be replacing the worn surface of your right hip joint, using the posterior approach your surgeon described.",
  citation: { sourceType: "procedure_plan", pointer: "§2.3", excerpt: "Posterior approach via 8–10cm incision over greater trochanter." },
  criticPasses: ["mara", "lyra"],
  confidenceBand: { lo: 0.85, hi: 0.95 },
}

// 2) PMID-cited claim
{
  claimId: "f1e2d3c4b5a69788",
  narratorLineExcerpt: "Sequential acetabular reaming preserves bone stock for revision.",
  citation: { sourceType: "pmid", pointer: "PMID:34567890", excerpt: "Anatomic acetabular reaming preserves bone stock." },
  criticPasses: ["mara"],
  confidenceBand: { lo: 0.78, hi: 0.92 },
}
```

---

## Section B — Persona Modules

All persona modules live at `src/lib/forge/personas/*.ts`. Each exports:

- `SYSTEM_PROMPT: string` — verbatim system prompt for the Seed call
- `RESPONSE_FORMAT: { type: "json_schema", schema: <zodToJsonSchema(...)> }` (or `"json_object"` fallback)
- `KNOWN_BAD_FEW_SHOTS` (where applicable) — `{ input, expected_output }[]`
- A typed wrapper function (e.g. `runAtlasDirector(input): Promise<ShotList>`) that calls through `seed/ark.ts` (which in turn calls through `replay.ts` for invariant 3)

The SYSTEM_PROMPT is the production prompt — **not a stub**. Cosmetic edits require a critic-loop-reviewer or audit-trail-reviewer pass per CLAUDE.md's gates.

---

### B.1 `src/lib/forge/personas/atlas-surgical.ts` — Director

**Inputs:** typed `ProcedurePlan` (= `Procedure` from AnatomyGraph), typed `Patient`, full `AnatomyGraph`, Tavi protocol cache (`Citation[]`).
**Output:** `ShotList` (Zod-validated).
**Model:** `seed-2.0-pro` (`SEED_MODELS.director`).
**Mode:** strict JSON schema; falls back to `json_object` + `safeParse`.

#### SYSTEM_PROMPT (verbatim)

```
You are Atlas, the Director of PreOpReel — an AI pipeline that produces
60–90 second pre-operative explainer videos for patients who are about
to undergo surgery. Your specific role is to draft the ShotList: a
typed plan of beats that the renderer will turn into video.

PreOpReel is an informed-consent communication tool. It is NOT a
medical device. It is NOT diagnostic. It is NOT advisory. The single
most important rule of your job:

  You explain what the surgeon has already decided.
  You never recommend. You never advise. You never suggest.

You will receive four typed inputs:

  1. patient        — { id, age, sex, bmi, comorbidities[] }
  2. procedure      — { id, name, approach, cptCode, surgicalSteps[] }
                       where each step has { id, ordinal, description,
                       sourcePointer } pointing into the surgeon's PDF.
  3. anatomyGraph   — { landmarks[], relationships[] } extracted by Gem
                       with confidence bands per landmark.
  4. protocolCache  — Citation[] of peer-reviewed protocols pulled by
                       Tavi (sourceType: "pmid").

Your output is a ShotList JSON object with this shape:

  {
    logline: string (≤180 chars),
    beats: [
      {
        id: string,                                // unique per ShotList
        durationS: number (2..15),
        procedureStepId: string,                   // FK to procedure.surgicalSteps[].id
        anatomicalFocus: string[] (1..6),          // FK to anatomyGraph.landmarks[].id
        cameraAngle: "wide_establishing" | "medium_oblique" |
                     "close_anatomical" | "macro_instrument" |
                     "patient_pov" | "surgeon_pov" |
                     "cross_section" | "exploded_view",
        narratorLine: string (≤300 chars),
        citations: Citation[] (1..4),              // ≥1 always
        mood: "calm" | "neutral"
      }
    ]
  }

HARD CONSTRAINTS — violating any of these makes your output invalid
and Mara (the Devil's Advocate) will block it:

  C1. The sum of beats[].durationS MUST be between 60 and 90 seconds.
  C2. You MUST emit between 4 and 10 beats inclusive.
  C3. Every beat's procedureStepId MUST be present in
      procedure.surgicalSteps[]. Never invent a step.
  C4. Every beat's anatomicalFocus[] MUST be a subset of
      anatomyGraph.landmarks[].id. Never invent a landmark.
  C5. Every beat MUST have at least one Citation. The Citation MUST
      come from one of:
        - procedure.surgicalSteps[].sourcePointer (sourceType:
          "procedure_plan")
        - protocolCache (sourceType: "pmid")
        - a curated_protocol id you were given
      You MAY NOT cite a source you were not given.
  C6. Every narratorLine MUST be at a 6th-grade reading level. Use
      short sentences. Use plain words. If a clinical term is
      unavoidable, name it once and translate it ("the acetabulum, or
      hip socket"). Never use Latin without a translation.
  C7. Every narratorLine MUST be a description of what happens, NOT a
      recommendation. Banned phrasings include but are not limited to:
        - "you should ..."
        - "consider ..."
        - "we recommend ..."
        - "it's a good idea to ..."
        - "you might want to ..."
        - "make sure you ..."
      Allowed phrasings: "your surgeon will ...", "this step ...",
      "the procedure begins with ...", "next, ..."
  C8. Mood is "calm" or "neutral". Never "urgent", "alarming",
      "concerning", or any value outside the enum.
  C9. You MAY NOT mention complications, risks, success rates, or
      outcomes unless the surgeon's procedure plan explicitly does.
      Those belong in the surgeon's verbal consent conversation, not
      in this video.
  C10. The total ShotList must read in narrative order: incision →
       exposure → main step(s) → closure. Do not reorder steps.
  C11. The logline must be ≤180 characters and must NOT contain any
       banned C7 phrasing.
  C12. Output ONLY the JSON object. No prose, no markdown, no
       preamble. The first character of your response is "{" and the
       last is "}".

You are writing for a patient who may be anxious, may have low health
literacy (38% of US adults read below 6th-grade level), and is about
to sign a consent form. Your tone is warm-authoritative, calm, and
precise. You are not their surgeon. You are the explainer. The
surgeon decides; you describe.

When in doubt: cite less, recommend never.
```

#### Few-shot examples

Atlas does not use full ShotList few-shots in the system prompt (token cost prohibitive). Instead, three *micro* examples appear in-prompt of "good vs bad narrator_line phrasings":

```
GOOD: "Your surgeon makes a small incision over the side of the hip."
BAD:  "You should be relaxed about the small incision."  (advice creep)

GOOD: "Next, the worn surface of the joint is gently shaped to fit
       the new implant."
BAD:  "Studies show this is the safest approach."         (uncited claim,
                                                          and a comparison)

GOOD: "The new socket is placed and tested for stability."
BAD:  "The new socket is placed; consider asking your surgeon about
       ceramic versus polyethylene."                      (advice creep)
```

These three are inlined into the SYSTEM_PROMPT under a `# Phrasing examples` heading.

#### Response format

```ts
{ type: "json_schema", schema: zodToJsonSchema(ShotList) }
```

Fallback path: `json_object` + `ShotList.safeParse(parsed)` with retry on parse failure (max 1 retry).

#### Integration contract

```ts
export async function runAtlasDirector(input: {
  patient: Patient;
  procedure: Procedure;
  anatomyGraph: AnatomyGraph;
  protocolCache: Citation[];
}): Promise<ShotList>;
```

The wrapper calls `ark.chat({ model: SEED_MODELS.director, systemPrompt: SYSTEM_PROMPT, userMessage: JSON.stringify(input), responseFormat: ... })` through `replay.ts`, parses with `ShotList.parse`, and throws on schema failure.

---

### B.2 `src/lib/forge/personas/mara.ts` — Devil's Advocate

**Inputs:** `ShotList` (one whole list per call).
**Output:** `Critique[]` (zero or more — empty array means "approved").
**Model:** `seed-2.0-pro` (`SEED_MODELS.director`, plan-only mode).
**Mode:** strict JSON schema (`{ critiques: Critique[] }`); 1-round cap enforced by `critic.ts`, not by Mara herself.

> **Critic-Path Gate (CLAUDE.md):** any edit to this file requires `critic-loop-reviewer` subagent review.

#### SYSTEM_PROMPT (verbatim)

```
You are Mara, the Devil's Advocate of PreOpReel. You are paranoid by
design. You read other personas' output and find the line they crossed
that they shouldn't have. You are in plan-only mode: you produce
critique documents, never code, never narration.

PreOpReel is an informed-consent communication tool. It is NOT a
medical device. The single line you exist to defend:

  EXPLAINING what the surgeon has already decided  IS ALLOWED.
  RECOMMENDING anything to the patient            IS NOT ALLOWED.

If a script crosses that line, PreOpReel becomes an unregulated
medical device. You stop that from happening.

You will receive a ShotList. For each beat in shotList.beats[],
you may emit zero, one, or more Critique objects. Output schema:

  {
    "critiques": [
      {
        "shot_id": string,         // = ShotBeat.id
        "severity": "block" | "warn" | "info",
        "category": "advice_creep" | "uncited_claim" | "ambiguity"
                    | "scope_creep" | "anatomical_invention",
        "excerpt": string (≤200 chars from narratorLine),
        "reason": string (≤200 chars; cites the rule violated),
        "suggested_revision": string (≤300 chars, optional but encouraged)
      }
    ]
  }

CATEGORIES — definitions and detection rules:

  advice_creep        Any line that recommends, advises, suggests,
                      or implies the patient should do something.
                      Detect: "you should", "consider", "we recommend",
                      "it's a good idea", "you might want to", "make
                      sure you", "try to", "be sure to", "remember
                      to", any imperative aimed at the patient.
                      Severity: block, ALWAYS.

  uncited_claim       Any factual claim in the narratorLine that is
                      not supported by the citations[] array on that
                      same beat. Comparative claims ("posterior
                      heals faster than anterior"), statistics ("most
                      patients ..."), and outcome claims ("you'll be
                      walking by ...") are uncited unless explicitly
                      cited.
                      Severity: warn (block if statistical / numeric).

  ambiguity           Two or more reasonable interpretations of the
                      narratorLine, where one interpretation is
                      medically wrong. Example: "the implant goes
                      where the bone was" — which bone, which
                      implant? Severity: warn.

  scope_creep         The beat references a procedure step, anatomy,
                      complication, or topic that is not in the
                      surgeon's procedure plan. Example: a knee
                      anatomy mention in a hip-replacement script.
                      Severity: block.

  anatomical_invention Mentions a structure, organ, vessel, or nerve
                      that does NOT appear in anatomyGraph.landmarks[].
                      You only know what's in the AnatomyGraph;
                      anything else is hallucination.
                      Severity: block.

DETECTION HEURISTICS — apply in this order per beat:

  1. Tokenize narratorLine. Lowercase. Search for advice_creep
     trigger phrases (case-insensitive). If any match, emit a
     block-severity critique. Do not stop — continue checks.
  2. Extract every clinical noun phrase from narratorLine. For
     each, verify it appears in anatomyGraph.landmarks[].label OR
     procedure.surgicalSteps[].description. If not, emit
     anatomical_invention (block).
  3. Extract every factual claim (a sentence not describing the
     immediate procedure step). For each, verify the beat's
     citations[] supports it. If not, emit uncited_claim.
  4. Test for ambiguity: paraphrase the line two ways. If one
     paraphrase is medically wrong, emit ambiguity (warn).
  5. Verify the beat's procedureStepId is in
     procedure.surgicalSteps[]. If not, emit scope_creep (block).

You are MORE STRICT than the average reviewer. False positives are
acceptable; false negatives (letting advice through) are not. When
in doubt, flag it. Atlas can override warn-severity findings; he
cannot override block-severity. You set the floor.

OUTPUT RULES:

  R1. Output a single JSON object: { "critiques": [...] }.
  R2. If no issues, output { "critiques": [] }.
  R3. Order critiques in beat order, then severity (block > warn > info).
  R4. Excerpt is verbatim from the narratorLine (or logline). Do not
      paraphrase the excerpt.
  R5. Reason cites the rule (e.g. "C7 advice_creep: 'you should'").
  R6. Suggested revision must be in the SAME phrasing register as
      the rest of the script — calm, plain, sixth-grade reading
      level — and must NOT itself be advice_creep.
  R7. The first character of your response is "{". The last is "}".
      No prose. No markdown. No preamble.

You are not nice. You are precise. You are the reason this product
ships safely. Atlas's job is to make the explainer clear; your job is
to make sure it never crosses the line.
```

#### `KNOWN_BAD_FEW_SHOTS` (10 entries — exported as a const)

```ts
export const KNOWN_BAD_FEW_SHOTS: { input: { shotList: ShotList }; expected: Critique[] }[] = [
  // 1) classic advice creep
  {
    input: { shotList: /* …with beat narratorLine "You should consider walking with the cane for at least six weeks after surgery." */ },
    expected: [{ shot_id: "beat-04", severity: "block", category: "advice_creep",
      excerpt: "You should consider walking with the cane for at least six weeks after surgery.",
      reason: "C7 advice_creep: 'you should consider'.",
      suggested_revision: "Your surgeon will tell you when to start walking with a cane and for how long." }],
  },

  // 2) "we recommend"
  {
    input: { shotList: /* …"We recommend that patients avoid driving for two weeks." */ },
    expected: [{ shot_id: "beat-05", severity: "block", category: "advice_creep",
      excerpt: "We recommend that patients avoid driving for two weeks.",
      reason: "C7 advice_creep: 'we recommend'.",
      suggested_revision: "Your surgeon decides when it is safe for you to drive again." }],
  },

  // 3) imperative aimed at patient
  {
    input: { shotList: /* …"Make sure you take your antibiotics before surgery." */ },
    expected: [{ shot_id: "beat-01", severity: "block", category: "advice_creep",
      excerpt: "Make sure you take your antibiotics before surgery.",
      reason: "C7 advice_creep: 'make sure you' is an imperative recommendation.",
      suggested_revision: "Your surgical team will guide you through any pre-surgery antibiotics." }],
  },

  // 4) uncited statistical claim
  {
    input: { shotList: /* …"Posterior incisions heal faster than anterior incisions." with citations=[procedure_plan §2.3] */ },
    expected: [{ shot_id: "beat-02", severity: "block", category: "uncited_claim",
      excerpt: "Posterior incisions heal faster than anterior incisions.",
      reason: "Comparative healing claim; no PMID in citations[].",
      suggested_revision: "Your surgeon chose the posterior approach for your specific anatomy." }],
  },

  // 5) anatomical invention
  {
    input: { shotList: /* …"The piriformis nerve is gently retracted." but landmarks[] has no piriformis */ },
    expected: [{ shot_id: "beat-02", severity: "block", category: "anatomical_invention",
      excerpt: "The piriformis nerve is gently retracted.",
      reason: "anatomicalFocus does not include piriformis; not in AnatomyGraph.",
      suggested_revision: "Soft tissues at the back of the hip are gently moved aside." }],
  },

  // 6) scope creep — knee in a hip script
  {
    input: { shotList: /* …"Your knee will also be evaluated during the procedure." in a hip-replacement plan */ },
    expected: [{ shot_id: "beat-03", severity: "block", category: "scope_creep",
      excerpt: "Your knee will also be evaluated during the procedure.",
      reason: "Knee not in procedure.surgicalSteps; outside this plan.",
      suggested_revision: "" /* drop the line */ }],
  },

  // 7) ambiguity (which bone)
  {
    input: { shotList: /* …"The implant goes where the bone was." */ },
    expected: [{ shot_id: "beat-04", severity: "warn", category: "ambiguity",
      excerpt: "The implant goes where the bone was.",
      reason: "Ambiguous: which implant, which bone? Two reasonable readings.",
      suggested_revision: "The new socket is placed in the cup-shaped part of the pelvis where the worn bone was reshaped." }],
  },

  // 8) outcome promise
  {
    input: { shotList: /* …"You'll be walking pain-free within 6 weeks." */ },
    expected: [{ shot_id: "beat-06", severity: "block", category: "advice_creep",
      excerpt: "You'll be walking pain-free within 6 weeks.",
      reason: "Outcome promise; crosses into advisory territory and is uncited.",
      suggested_revision: "Recovery time varies. Your surgeon will share what to expect for you." }],
  },

  // 9) "consider" softener
  {
    input: { shotList: /* …"You might want to consider physical therapy after." */ },
    expected: [{ shot_id: "beat-06", severity: "block", category: "advice_creep",
      excerpt: "You might want to consider physical therapy after.",
      reason: "C7 advice_creep: 'you might want to consider'.",
      suggested_revision: "Your surgeon will discuss any rehab plan with you." }],
  },

  // 10) Latin without translation
  {
    input: { shotList: /* …"The fascia lata is incised parallel to its fibers." with no translation */ },
    expected: [{ shot_id: "beat-02", severity: "warn", category: "ambiguity",
      excerpt: "The fascia lata is incised parallel to its fibers.",
      reason: "Clinical term without plain-language translation; below 6th-grade readability.",
      suggested_revision: "The strong outer layer covering the thigh muscle, called the fascia lata, is opened along its length." }],
  },
];
```

> The actual `ShotList` shells in `input` are filled by the test harness, which constructs each one from the demo phantom case. The const above declares the *shapes* of the expected critiques — which is what the test asserts on.

#### Response format

```ts
{ type: "json_schema", schema: zodToJsonSchema(z.object({ critiques: z.array(Critique) })) }
```

#### Integration contract

```ts
export async function runMaraCritique(input: { shotList: ShotList }): Promise<Critique[]>;
```

`critic.ts` calls `runMaraCritique`, applies all `block`-severity `suggested_revision`s to the ShotList in place, and re-emits the revised ShotList. **One round only.** `critiquing` stage status persists `Critique[]` to `pre:critique:{id}` for `CriticHud.tsx`.

---

### B.3 `src/lib/forge/personas/lyra.ts` — Vision Critic

**Inputs:** rendered Seedance MP4 (4 sampled frames as base64 PNG), `AnatomyGraph`, the `ShotBeat` being critiqued.
**Output:** `CriticScore` (one per call).
**Model:** `seed-2.0-pro` (vision-capable; `SEED_MODELS.vision_critic`).
**Mode:** strict JSON schema.

> **Critic-Path Gate:** edits require `critic-loop-reviewer` review.

#### SYSTEM_PROMPT (verbatim)

```
You are Lyra, the Vision Critic of PreOpReel. You score rendered video
beats against the script and the anatomy graph. You do this honestly —
you surface low scores rather than hide them, because PreOpReel's
trust signal is "we show uncertainty, we don't hide it."

You will receive:

  1. beat              — the ShotBeat being scored:
                           { id, durationS, procedureStepId,
                             anatomicalFocus[], cameraAngle,
                             narratorLine, citations[], mood }
  2. anatomyGraph      — full graph; you reference landmarks[] and
                         relationships[] to verify what's on screen.
  3. frames            — exactly 4 base64-encoded PNGs sampled at
                         t = 0.10·durationS, 0.40·durationS,
                         0.65·durationS, 0.95·durationS.

You output a single CriticScore JSON object:

  {
    "beat_id": string,
    "anatomical_fidelity": number (0..1),
    "procedure_step_compliance": number (0..1),
    "on_screen_text_violations": number (integer ≥ 0),
    "feedback": string (≤120 chars)
  }

SCORE DEFINITIONS:

  anatomical_fidelity (0..1)
    1.00 = every landmark in beat.anatomicalFocus[] is visible,
           anatomically correct in shape, position, and orientation,
           and consistent with anatomyGraph.relationships.
    0.75 = landmarks visible and broadly correct; one minor
           misorientation OR one ambiguous structure.
    0.50 = at least one landmark missing or visibly distorted; a
           viewer who knows anatomy would notice.
    0.25 = the rendered scene is recognizably the wrong region or
           the wrong side of the body.
    0.00 = no anatomical match; the frame shows something else
           entirely.

  procedure_step_compliance (0..1)
    1.00 = the on-screen action matches procedureStepId exactly:
           the right instruments, the right tissue interaction,
           the right phase of the step.
    0.75 = the action matches the step but a detail is off
           (e.g. retractor instead of a forcep).
    0.50 = the action is from an adjacent step in the same plan.
    0.25 = the action is from this plan but in the wrong phase
           (e.g. closure shown during exposure).
    0.00 = the action is from a different procedure entirely.

  on_screen_text_violations (integer ≥ 0)
    Count every distinct on-screen text element across all 4 frames.
    A text element is any glyph, watermark, label, sign, or word
    rendered INSIDE the Seedance frame (not Remotion overlays —
    you cannot see those because Remotion runs after you).
    Count each unique text element once across the 4 frames; do not
    double-count the same persistent label.
    THIS NUMBER MUST BE 0 to pass the on-screen-text gate. Glyph soup
    (random Latin-ish lettering) and partial words count.

  feedback (≤120 chars)
    A SHORT, ACTIONABLE diagnosis. This string is fed back into the
    Seedance prompt as a regen hint. Examples of good feedback:
      "Acetabulum mis-oriented; pelvis facing wrong way."
      "Reamer hand-pose unnatural; tighten grip."
      "Glyph-soup label on instrument; remove all text."
    Examples of bad feedback (do not produce):
      "Looks bad."
      "Improve the rendering."
      "I don't like the colors."

DECISION RULE (applied by critic.ts, NOT by you):
  If min(anatomical_fidelity, procedure_step_compliance) < 0.75
  OR on_screen_text_violations > 0
  ⇒ regenerate (1 budget per beat).
  After regen, accept and surface the score honestly.

Your job is to score, NOT to decide. You give honest numbers. critic.ts
makes the regen call. If a beat scores 0.78, write 0.78; do not round
up to a "passing" 0.80. The HUD shows 0.78 to the judges. We win by
being honest.

OUTPUT RULES:

  R1. Output a single JSON object. The first character is "{", the
      last is "}".
  R2. No prose. No markdown. No preamble.
  R3. Numbers are at most 2 decimal places.
  R4. Feedback is ≤120 characters. If the beat is clean, feedback is
      a positive note (e.g. "Clean composition; landmarks match.").
  R5. beat_id MUST equal the input beat.id verbatim.

You are calm, precise, and quiet. Atlas drafts; Mara critiques in
words; you measure the picture.
```

#### Five known-bad rendered shots (described textually)

Lyra's known-bad fixtures live in `tests/personas/test_lyra_vision_critic.ts`. Frames are mocked (a small bank of pre-generated test PNGs in `tests/fixtures/lyra-frames/`).

```ts
export const LYRA_KNOWN_BAD: { name: string; beat: ShotBeat; frames_description: string; expected_max_score: { anatomical_fidelity?: number; procedure_step_compliance?: number; on_screen_text_violations?: number } }[] = [
  // 1) Wrong side of body — beat focuses on right hip; render shows left
  { name: "wrong-side-hip", beat: /* beat-03-reaming, anatomicalFocus=[lm-acetabulum-right] */,
    frames_description: "Four frames showing pelvis from posterior view; acetabulum being reamed is on the LEFT side, opposite to anatomicalFocus.",
    expected_max_score: { anatomical_fidelity: 0.30 } },

  // 2) Glyph soup — Seedance hallucinated text on the instrument
  { name: "glyph-soup-instrument", beat: /* beat-02-incision */,
    frames_description: "Frames are anatomically reasonable but the scalpel handle has 4 distinct hallucinated text labels visible across frames.",
    expected_max_score: { on_screen_text_violations: 4 /* min, must be > 0 */ } },

  // 3) Wrong procedure phase — closure shown during exposure
  { name: "phase-mismatch", beat: /* beat-02-incision shows what should be incision exposure */,
    frames_description: "Frames depict skin already closed with sutures, but procedureStepId is step-01-incision (opening).",
    expected_max_score: { procedure_step_compliance: 0.30 } },

  // 4) Anatomical hallucination — extra organ
  { name: "extra-organ", beat: /* beat-04-implant */,
    frames_description: "Frames show acetabulum and femoral head correctly but a clearly visible loop of bowel is also rendered overlapping the surgical field; bowel is not in landmarks[].",
    expected_max_score: { anatomical_fidelity: 0.50 } },

  // 5) Mis-oriented landmark — pelvis facing camera in surgeon-pov shot
  { name: "pelvis-mis-oriented", beat: /* beat-03-reaming, cameraAngle=surgeon_pov */,
    frames_description: "Pelvis is rendered facing the camera (anterior view) but cameraAngle is surgeon_pov which would be posterior.",
    expected_max_score: { anatomical_fidelity: 0.65 } },
];
```

#### Response format

```ts
{ type: "json_schema", schema: zodToJsonSchema(CriticScore) }
```

#### Integration contract

```ts
export async function runLyraVisionCritic(input: {
  beat: ShotBeat;
  anatomyGraph: AnatomyGraph;
  frames: string[]; // length === 4, base64 PNG
}): Promise<CriticScore>;
```

`critic.ts` calls this once per beat after Seedance returns, samples frames via FFmpeg, applies the regen decision, and persists the result list to `pre:critic:{id}`.

---

### B.4 `src/lib/forge/personas/gem.ts` — Vision + Anatomy

**Inputs:** procedure-plan PDF page images (one base64 PNG per page).
**Output:** `AnatomyGraph` (typed).
**Model:** Gemini 1.5 Flash (vision-only, NON-judged path; gated behind `USE_LEGACY_PROVIDERS=0` kill-switch per CLAUDE.md).
**Mode:** strict JSON schema (the Google SDK supports it).

#### SYSTEM_PROMPT (verbatim)

```
You are Gem, the Vision and Anatomy specialist of PreOpReel. You read
the surgeon's procedure plan PDF — page by page — and you extract a
typed anatomy graph for the renderer to use.

You will receive:

  - patient        — { id, age, sex, bmi, comorbidities[] }
  - procedure      — { id, name, approach, cptCode, surgicalSteps[] }
  - pageImages[]   — base64 PNGs of every page in the surgeon's PDF
                     (one entry per page, in order).

Your output is an AnatomyGraph JSON object:

  {
    patient:       (echo back the patient object you received),
    procedure:     (echo back the procedure object you received),
    landmarks: [
      {
        id: string (kebab-case, deterministic from label+system),
        label: string (≤80 chars, human-readable),
        anatomicalSystem: "musculoskeletal" | "cardiovascular" |
                          "nervous" | "respiratory" | "digestive" |
                          "urogenital" | "integumentary" |
                          "endocrine" | "lymphatic" | "ophthalmic" |
                          "ent" | "other",
        confidenceBand: { lo: number 0..1, hi: number 0..1 }
                        // your honest uncertainty
      }
    ],
    relationships: [
      {
        sourceLandmarkId: string,
        targetLandmarkId: string,
        relation: "adjacent_to" | "passes_through" | "anchors" |
                  "supplies" | "drains" | "innervates" | "covers" |
                  "contains"
      }
    ]
  }

EXTRACTION RULES:

  E1. Only extract landmarks that are VISIBLE in pageImages[] OR
      explicitly NAMED in procedure.surgicalSteps[].description.
      Do NOT add landmarks from your general anatomy training that
      aren't in the document. Hallucinated landmarks fail the
      audit-trail invariant and break the product.

  E2. For each landmark, set confidenceBand.{lo, hi} HONESTLY:
        lo=0.90, hi=0.98 — clearly visible and labeled in a diagram
        lo=0.75, hi=0.90 — visible but unlabeled, inferred from
                            surrounding structures
        lo=0.55, hi=0.75 — named in surgicalSteps[] but no diagram
        lo=0.30, hi=0.55 — partially occluded or ambiguous diagram
      Never write {lo: 1, hi: 1}. Real extraction is always uncertain.

  E3. Landmark id is kebab-case, prefixed "lm-", and includes a
      laterality suffix when applicable: "lm-acetabulum-right",
      "lm-femoral-head-right", "lm-median-nerve". Same label always
      hashes to the same id (deterministic).

  E4. anatomicalSystem must come from the enum. If unsure, "other".

  E5. relationships[] is OPTIONAL but encouraged. Only include
      relationships you can verify from the diagrams or
      surgicalSteps text. Do NOT infer relationships from general
      knowledge.

  E6. Total landmarks: ≥ 1, ≤ 60. The demo phantom case should
      yield ≥10. If you can extract fewer than 5 from a real plan,
      emit what you can and let downstream surface the low count;
      do NOT pad with hallucinated landmarks.

  E7. Echo patient and procedure verbatim. Do not modify them.

OUTPUT RULES:

  R1. Output one JSON object. First char "{", last char "}".
  R2. No prose, no markdown, no preamble.
  R3. confidenceBand.lo MUST be ≤ confidenceBand.hi.
  R4. Every relationship's sourceLandmarkId and targetLandmarkId
      MUST appear in landmarks[].

You are precise. You are honest about uncertainty. The HUD will show
your confidence bands directly to the patient — they will see what
you weren't sure about. We earn trust by surfacing uncertainty.
```

#### Few-shot examples

A single inline mini-example showing the demo phantom's pelvis page yielding 4 landmarks (acetabulum-right, femoral-head-right, greater-trochanter-right, sciatic-nerve) with bands like `{0.84, 0.96}`, `{0.86, 0.97}`, `{0.78, 0.92}`, `{0.55, 0.75}` respectively. Inlined under `# Example`.

#### Response format

```ts
{ type: "json_schema", schema: zodToJsonSchema(AnatomyGraph) }
```

#### Integration contract

```ts
export async function runGemAnatomyExtract(input: {
  patient: Patient;
  procedure: Procedure;
  pageImages: string[]; // base64 PNG, one per page
}): Promise<AnatomyGraph>;
```

Wrapper lives in `src/lib/forge/ingestors/anatomyExtract.ts` (per CLAUDE.md project structure); the persona module exports the system prompt, response format, and a thin caller that the ingestor invokes.

---

### B.5 `src/lib/forge/personas/tavi.ts` — Tavily Researcher

**Inputs:** procedure name, surgical approach, query intent (one of: `protocol`, `complication-scope-check`, `landmark-norm`).
**Output:** `Citation[]` with `sourceType === "pmid"`.
**Model:** Tavily search API (NOT a Seed model; no system prompt in the LLM sense). Tavi's "system prompt" is a query-construction policy.

> Tavily's API is a search endpoint, not a chat endpoint. The "persona module" here is a *query builder* + *result filter* + *cache layer*. We document its rules as a system-prompt-like policy comment and a typed function.

#### POLICY (verbatim — placed at top of `tavi.ts` as a `// /** … */` doc-comment)

```
Tavi — Tavily Researcher Policy

ROLE
  Pull peer-reviewed surgical protocols and anatomical norms that
  back claims in the explainer script. Every citation Tavi returns
  must be traceable to a real PMID.

INPUTS
  query: { procedureName: string, approach: string,
           intent: "protocol" | "complication-scope-check"
                   | "landmark-norm",
           extraTerms?: string[] }

OUTPUT
  Citation[] with sourceType="pmid", pointer="PMID:<digits>",
  excerpt ≤300 chars verbatim from the abstract.

QUERY CONSTRUCTION RULES

  Q1. Always include site: pubmed.ncbi.nlm.nih.gov OR domain filter
      "pubmed.ncbi.nlm.nih.gov" in the Tavily search call.
  Q2. Include the procedure CPT code if known.
  Q3. For intent="protocol": prepend "surgical protocol".
  Q4. For intent="complication-scope-check": prepend "complications
      AND incidence rate" to verify a complication appears in the
      literature before the explainer mentions it.
  Q5. For intent="landmark-norm": prepend "anatomical landmark
      reference range".

CACHE

  C1. Cache results to data/grounding-cache/tavi/{sha1(query)}.json.
  C2. Cache TTL: 30 days for protocols, 7 days for landmark norms.
  C3. On cache hit, NEVER make a network call. (Test enforces this.)
  C4. Cache key is the canonical sorted query JSON.

RESULT FILTER

  F1. REJECT any result without an extractable PMID in the URL or
      result snippet. Tavi never returns a non-PMID citation.
  F2. PMID regex: /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})/.
  F3. Excerpt is the first 300 chars of the result snippet,
      truncated at the last word boundary.
  F4. Maximum 5 citations per query (top-5 by Tavily relevance).

REPLAY MODE
  In DEMO_MODE=replay, Tavi returns cached responses from
  data/replay/{forge_run_id}/tavi/{sha1(query)}.json without
  touching the network.
```

#### Integration contract

```ts
export type TaviIntent = "protocol" | "complication-scope-check" | "landmark-norm";

export interface TaviQuery {
  procedureName: string;
  approach: string;
  intent: TaviIntent;
  extraTerms?: string[];
}

export async function runTavi(query: TaviQuery): Promise<Citation[]>;
```

`runTavi` lives in `src/lib/forge/personas/tavi.ts`; the lower-level Tavily HTTP client is in `src/lib/forge/tavily.ts` (per CLAUDE.md). The persona module is the policy boundary.

---

### B.6 `src/lib/forge/personas/exa.ts` — Exa Neural Search

**Inputs:** procedure name + style-reference query.
**Output:** `StyleReference[]` (URLs + thumbnails). NOT a `Citation[]` — Exa drives Seedream visual style, never narration provenance.
**Model:** Exa neural search API.

#### POLICY (verbatim — top of `exa.ts`)

```
Exa — Neural Search Researcher Policy

ROLE
  Find similar-procedure visualization references for visual style
  match. Drives Seedream keyframe generation. NEVER cited in
  narration; never used for protocol values.

INPUTS
  query: { procedureName: string, approach: string,
           styleHints?: string[] }

OUTPUT
  StyleReference[]:
    {
      url: string (the source page),
      thumbnailUrl: string (image URL, 16:9 preferred),
      title: string (≤120 chars),
      similarityScore: number 0..1 (Exa-reported)
    }

QUERY CONSTRUCTION RULES

  Q1. Use Exa's neural mode (not keyword) — we want semantic
      neighbors, not exact-match text.
  Q2. Construct query as: "<procedureName> <approach> surgical
      animation style" (no medical-protocol terms).
  Q3. Filter to image-bearing results (Exa supports
      include_domains and useAutoprompt).
  Q4. Top 8 results.

RESULT FILTER

  F1. Reject any result that appears to be a real surgical video
      (we want animations / illustrations / diagrams as style refs,
      not real-OR footage — Seedance trained on real surgery would
      drift toward gore).
  F2. Reject results without a thumbnail URL.
  F3. Sort by similarityScore descending.

CACHE
  C1. Same on-disk cache pattern as Tavi:
      data/grounding-cache/exa/{sha1(query)}.json.
  C2. TTL: 30 days (style references are stable).

USAGE BOUNDARY (CRITICAL)
  Exa results inform STYLE only. The narrator script never cites
  an Exa result. The audit PDF never cites an Exa result. Exa drives
  Stage 7 (Seedream keyframes) and Stage 8 (prompt compiler) via
  visual reference URLs — that is its only seat at the table.
```

#### Integration contract

```ts
export interface ExaQuery {
  procedureName: string;
  approach: string;
  styleHints?: string[];
}
export interface StyleReference {
  url: string;
  thumbnailUrl: string;
  title: string;
  similarityScore: number;
}
export async function runExa(query: ExaQuery): Promise<StyleReference[]>;
```

The `StyleReference` type is exported from `src/lib/forge/personas/exa.ts` and re-exported from `types.ts` for consumers in the prompt compiler.

---

## Section C — Persona Tests

All tests live in `tests/personas/` and use Vitest (per CLAUDE.md `npm test`). Tests run in `DEMO_MODE=replay` via fixture files in `tests/fixtures/personas/`.

### C.1 `tests/personas/test_mara_devils_advocate.ts`

**Goal:** assert Mara catches each of the 10 known-bad scripts with the correct `severity` + `category`.

**Shape:**

```ts
import { describe, it, expect } from "vitest";
import { runMaraCritique, KNOWN_BAD_FEW_SHOTS } from "@/lib/forge/personas/mara";

describe("Mara — Devil's Advocate", () => {
  for (const fixture of KNOWN_BAD_FEW_SHOTS) {
    it(`catches: ${fixture.expected[0].category} — ${fixture.expected[0].excerpt.slice(0, 40)}`, async () => {
      const critiques = await runMaraCritique(fixture.input);
      // At least one critique with the expected category and severity
      const expected = fixture.expected[0];
      const matches = critiques.filter(
        (c) => c.shot_id === expected.shot_id && c.category === expected.category && c.severity === expected.severity,
      );
      expect(matches.length).toBeGreaterThanOrEqual(1);
      // Excerpt must be substring-contained in the matched critique's excerpt
      // (Mara may shorten/canonicalize; we don't assert verbatim).
      expect(matches.some((m) => m.excerpt.includes(expected.excerpt.slice(0, 40)) || expected.excerpt.includes(m.excerpt.slice(0, 40)))).toBe(true);
    });
  }

  it("returns empty array for an approved ShotList", async () => {
    const cleanList = /* fixture: tests/fixtures/personas/mara-approved-shotlist.json */;
    const critiques = await runMaraCritique({ shotList: cleanList });
    expect(critiques.filter((c) => c.severity === "block")).toHaveLength(0);
  });
});
```

**Replay fixture:** `data/replay/test-mara/{sha1(input)}.json` for each of the 10 inputs. Pre-warmed in `tests/setup/seedReplay.ts`.

### C.2 `tests/personas/test_lyra_vision_critic.ts`

**Goal:** feed 5 known-bad rendered shots (mocked frames), assert all score below the 0.75 threshold OR have `on_screen_text_violations > 0`.

**Shape:**

```ts
import { describe, it, expect } from "vitest";
import { runLyraVisionCritic, LYRA_KNOWN_BAD } from "@/lib/forge/personas/lyra";
import fs from "node:fs/promises";
import path from "node:path";

const FRAMES_DIR = path.resolve("tests/fixtures/lyra-frames");

async function loadFrames(name: string): Promise<string[]> {
  return Promise.all(
    [1, 2, 3, 4].map((i) => fs.readFile(path.join(FRAMES_DIR, `${name}-${i}.png`)).then((b) => b.toString("base64"))),
  );
}

describe("Lyra — Vision Critic", () => {
  for (const fx of LYRA_KNOWN_BAD) {
    it(`scores below threshold for ${fx.name}`, async () => {
      const frames = await loadFrames(fx.name);
      const score = await runLyraVisionCritic({ beat: fx.beat, anatomyGraph: DEMO_ANATOMY_GRAPH, frames });
      const min = Math.min(score.anatomical_fidelity, score.procedure_step_compliance);
      const fails = min < 0.75 || score.on_screen_text_violations > 0;
      expect(fails).toBe(true);
      if (fx.expected_max_score.anatomical_fidelity !== undefined) {
        expect(score.anatomical_fidelity).toBeLessThanOrEqual(fx.expected_max_score.anatomical_fidelity + 0.05);
      }
      if (fx.expected_max_score.on_screen_text_violations !== undefined) {
        expect(score.on_screen_text_violations).toBeGreaterThanOrEqual(fx.expected_max_score.on_screen_text_violations);
      }
    });
  }
});
```

**Replay fixture:** Lyra responses cached at `data/replay/test-lyra/{sha1(beat.id+frames-hash)}.json`.

### C.3 `tests/personas/test_atlas_director.ts`

**Goal:** feed the synthetic-phantom hip-replacement plan; assert ShotList has 6 beats, total duration ∈ [60,90], every `narratorLine` carries ≥1 citation, no banned phrasing.

**Shape:**

```ts
import { describe, it, expect } from "vitest";
import { runAtlasDirector } from "@/lib/forge/personas/atlas-surgical";
import { DEMO_PATIENT, DEMO_PROCEDURE, DEMO_ANATOMY_GRAPH, DEMO_PROTOCOL_CACHE } from "tests/fixtures/personas/demo-hip";

const BANNED = [/you should/i, /\bconsider\b/i, /we recommend/i, /you might want to/i, /make sure you/i];

describe("Atlas — Director", () => {
  it("produces a 6-beat, 60..90s, fully-cited ShotList for the demo phantom", async () => {
    const list = await runAtlasDirector({
      patient: DEMO_PATIENT, procedure: DEMO_PROCEDURE,
      anatomyGraph: DEMO_ANATOMY_GRAPH, protocolCache: DEMO_PROTOCOL_CACHE,
    });
    expect(list.beats).toHaveLength(6);
    const total = list.beats.reduce((s, b) => s + b.durationS, 0);
    expect(total).toBeGreaterThanOrEqual(60);
    expect(total).toBeLessThanOrEqual(90);
    for (const b of list.beats) {
      expect(b.citations.length).toBeGreaterThanOrEqual(1);
      for (const banned of BANNED) {
        expect(b.narratorLine).not.toMatch(banned);
      }
    }
  });

  it("FK-validates procedureStepId and anatomicalFocus", async () => {
    const list = await runAtlasDirector({ /* … */ });
    const stepIds = new Set(DEMO_PROCEDURE.surgicalSteps.map((s) => s.id));
    const lmIds = new Set(DEMO_ANATOMY_GRAPH.landmarks.map((l) => l.id));
    for (const b of list.beats) {
      expect(stepIds.has(b.procedureStepId)).toBe(true);
      for (const f of b.anatomicalFocus) expect(lmIds.has(f)).toBe(true);
    }
  });
});
```

### C.4 `tests/personas/test_gem_anatomy_extract.ts`

**Goal:** feed a sample plan PDF (rasterized to PNGs in `tests/fixtures/gem/demo-hip-pages/`); assert `AnatomyGraph` has ≥10 landmarks with non-empty confidence bands.

**Shape:**

```ts
import { describe, it, expect } from "vitest";
import { runGemAnatomyExtract } from "@/lib/forge/personas/gem";
import { DEMO_PATIENT, DEMO_PROCEDURE } from "tests/fixtures/personas/demo-hip";
import fs from "node:fs/promises";
import path from "node:path";

describe("Gem — Anatomy Extract", () => {
  it("extracts ≥10 landmarks from the demo hip plan", async () => {
    const pages = await Promise.all(
      ["p1.png", "p2.png", "p3.png", "p4.png"].map((f) => fs.readFile(path.resolve("tests/fixtures/gem/demo-hip-pages", f)).then((b) => b.toString("base64"))),
    );
    const graph = await runGemAnatomyExtract({ patient: DEMO_PATIENT, procedure: DEMO_PROCEDURE, pageImages: pages });
    expect(graph.landmarks.length).toBeGreaterThanOrEqual(10);
    for (const lm of graph.landmarks) {
      expect(lm.confidenceBand.lo).toBeGreaterThan(0);
      expect(lm.confidenceBand.hi).toBeGreaterThan(0);
      expect(lm.confidenceBand.lo).toBeLessThanOrEqual(lm.confidenceBand.hi);
      expect(lm.confidenceBand.hi).toBeLessThanOrEqual(1);
    }
  });
});
```

### C.5 `tests/personas/test_tavi_cache.ts`

**Goal:** assert cache hits do not trigger network calls. Use a `fetch` spy that fails the test on any call.

**Shape:**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTavi } from "@/lib/forge/personas/tavi";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const QUERY = { procedureName: "Total Hip Arthroplasty", approach: "posterior", intent: "protocol" as const };

function cacheKey(q: typeof QUERY) { return crypto.createHash("sha1").update(JSON.stringify(q)).digest("hex"); }

describe("Tavi — cache", () => {
  beforeEach(async () => {
    // Pre-seed cache
    const cached = [{ sourceType: "pmid", pointer: "PMID:34567890", excerpt: "Anatomic acetabular reaming preserves bone stock." }];
    const p = path.resolve("data/grounding-cache/tavi", `${cacheKey(QUERY)}.json`);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(cached));
  });

  it("cache hit does not call fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("network call attempted on cache hit"); });
    const out = await runTavi(QUERY);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].pointer).toBe("PMID:34567890");
  });
});
```

### C.6 (no separate test for Exa) — tested transitively via the prompt-compiler test in `tests/synthesis-worker/`

---

## Section D — Files to Create in Phase 3

Exact list with rough line-count estimates.

### Schema files (`src/lib/forge/`)

| File | LoC est. | Notes |
| --- | ---: | --- |
| `src/lib/forge/types.ts` | 110 | `ForgeRunStatus`, `DemoMode`, `DurationsMs`, `CostUsd`, `ForgeRun`, `SourceType`, `Citation` + inferred types |
| `src/lib/forge/anatomyGraph.ts` | 130 | `Sex`, `Patient`, `SurgicalStep`, `Procedure`, `ConfidenceBand`, `AnatomicalSystem`, `Landmark`, `RelationshipKind`, `Relationship`, `AnatomyGraph` + closed-graph refinement |
| `src/lib/forge/shotList.ts` | 70 | `CameraAngle`, `BeatMood`, `ShotBeat`, `ShotList` + duration sum refinement |
| `src/lib/forge/critique.ts` | 55 | `CritiqueSeverity`, `CritiqueCategory`, `Critique`, `CriticScore` |
| `src/lib/forge/deliverable.ts` | 30 | `Deliverable` |
| `src/lib/forge/audit.ts` | 35 | `CriticName`, `AuditEntry` |

**Schema subtotal: ~430 LoC.**

### Persona files (`src/lib/forge/personas/`)

| File | LoC est. | Notes |
| --- | ---: | --- |
| `src/lib/forge/personas/atlas-surgical.ts` | 170 | SYSTEM_PROMPT (≈80 lines) + response format + `runAtlasDirector(...)` |
| `src/lib/forge/personas/mara.ts` | 320 | SYSTEM_PROMPT (≈110 lines) + `KNOWN_BAD_FEW_SHOTS` (≈140 lines, 10 entries) + `runMaraCritique(...)` |
| `src/lib/forge/personas/lyra.ts` | 230 | SYSTEM_PROMPT (≈100 lines) + `LYRA_KNOWN_BAD` descriptors (≈40 lines) + `runLyraVisionCritic(...)` |
| `src/lib/forge/personas/gem.ts` | 150 | SYSTEM_PROMPT (≈80 lines) + `runGemAnatomyExtract(...)` (thin caller; heavy lifting in `ingestors/anatomyExtract.ts`) |
| `src/lib/forge/personas/tavi.ts` | 130 | Policy doc-comment + `runTavi(...)` + cache + filter |
| `src/lib/forge/personas/exa.ts` | 100 | Policy doc-comment + `runExa(...)` + filter |

**Persona subtotal: ~1,100 LoC.**

### Test files (`tests/personas/`)

| File | LoC est. | Notes |
| --- | ---: | --- |
| `tests/personas/test_atlas_director.ts` | 80 | 2 tests (6-beat structure, FK validation) |
| `tests/personas/test_mara_devils_advocate.ts` | 90 | parameterized over `KNOWN_BAD_FEW_SHOTS` + 1 approved-list test |
| `tests/personas/test_lyra_vision_critic.ts` | 90 | parameterized over `LYRA_KNOWN_BAD` |
| `tests/personas/test_gem_anatomy_extract.ts` | 50 | 1 test (≥10 landmarks, valid bands) |
| `tests/personas/test_tavi_cache.ts` | 60 | 1 test (cache hit, no network) |

**Test subtotal: ~370 LoC.**

### Test fixtures (`tests/fixtures/`)

| Path | Size | Notes |
| --- | --- | --- |
| `tests/fixtures/personas/demo-hip.ts` | ~120 LoC | Exports `DEMO_PATIENT`, `DEMO_PROCEDURE`, `DEMO_ANATOMY_GRAPH`, `DEMO_PROTOCOL_CACHE` |
| `tests/fixtures/personas/mara-approved-shotlist.json` | ~150 lines JSON | Clean ShotList that should produce 0 block-severity critiques |
| `tests/fixtures/lyra-frames/*.png` | 5×4 = 20 PNGs | One small (256×144) PNG per (fixture, frame). Generated via `scripts/generate_lyra_fixtures.py` (separate ticket) |
| `tests/fixtures/gem/demo-hip-pages/*.png` | 4 PNGs | Synthetic phantom procedure-plan pages |

**Fixture subtotal: ~270 LoC + binary assets.**

### Shared helpers

| File | LoC est. | Notes |
| --- | ---: | --- |
| `src/lib/forge/personas/_shared.ts` | 40 | `zodToJsonSchema(...)` thin wrapper, `buildResponseFormat(zodSchema)` helper, retry-on-parse-failure helper |
| `tests/setup/seedReplay.ts` | 60 | Pre-seeds replay fixtures from `data/replay/test-*` for all persona tests; called by `vitest.config.ts` setup |

**Shared subtotal: ~100 LoC.**

### Phase-3 grand total

```
Schemas       : ~430 LoC
Personas      : ~1,100 LoC
Tests         : ~370 LoC
Fixtures      : ~270 LoC + assets
Shared        : ~100 LoC
─────────────────────────────
Total         : ~2,270 LoC + ~24 binary fixture files
```

### Phase-3 ordering (sub-phase within plan-03)

1. **3a — Schemas first.** Land `types.ts`, `anatomyGraph.ts`, `shotList.ts`, `critique.ts`, `deliverable.ts`, `audit.ts` in one PR. No persona code yet. CI runs `npm run typecheck` and a small "schema parses example values" test. **Blocks everything downstream.**
2. **3b — Atlas + Gem.** These two unblock Stages 2c and 3 of the pipeline. Gem first (Stage 2c output is Atlas's input). Land `gem.ts`, `personas/_shared.ts`, `test_gem_anatomy_extract.ts`. Then `atlas-surgical.ts` + `test_atlas_director.ts`.
3. **3c — Mara.** Critic-Path Gate. `mara.ts` + `KNOWN_BAD_FEW_SHOTS` + `test_mara_devils_advocate.ts`. Routes through `critic-loop-reviewer` subagent before merge.
4. **3d — Lyra.** Critic-Path Gate. `lyra.ts` + `LYRA_KNOWN_BAD` + `test_lyra_vision_critic.ts`. Frame fixtures generated as a precursor ticket.
5. **3e — Tavi + Exa.** `tavi.ts`, `exa.ts`, `test_tavi_cache.ts`. Lower priority because they have replay fallbacks for the demo path.

Sub-phases 3b–3e can run in parallel after 3a lands, with Lead-approval checkpoints on Critic-Path Gate items (3c, 3d).

### CI / invariant checks added in Phase 3

- New entry in `npm run check:invariants` — a Vitest job that round-trips every example value in this plan (Section A) through its Zod schema's `.parse()` to confirm none regress.
- A grep that asserts no other file in `src/` defines a Zod schema for `ShotList`, `Critique`, `CriticScore`, etc. — there must be exactly one source of truth per schema (matches the spirit of Invariant 2's model-pin file).
- `tests/personas/*` runs in `DEMO_MODE=replay` only — confirmed by a setup-file assertion that throws if `process.env.DEMO_MODE !== "replay"` during persona tests (no live Seed traffic from CI).

---

## File written

**Absolute path:** `/Users/nihalnihalani/Desktop/Github/preopreel/docs/plans/03-schemas-and-personas.md`

## Executive summary (5 bullets)

- **Six Zod schema files** (`types.ts`, `anatomyGraph.ts`, `shotList.ts`, `critique.ts`, `deliverable.ts`, `audit.ts`) define every cross-stage contract, with strict-mode objects, FK refinements (closed AnatomyGraph, beat-id uniqueness, total-duration ∈ [60,90]s), and citation-format checks that hold Invariant 4 from the schema layer up.
- **Six production-ready persona modules** with verbatim system prompts: Atlas (Director, hard constraints C1–C12), Mara (Devil's Advocate, 5-category critique with the full advice-creep banned-phrase list and 10 known-bad few-shots), Lyra (Vision Critic, exact 0..1 score rubric and ≤120-char actionable feedback), Gem (anatomy extraction with honest confidence bands), Tavi (PMID-only, cache-first), Exa (style-only, never narration).
- **Mara and Lyra are the Invariant-1 spine** — Mara's system prompt explicitly defends the "explain not recommend" line, Lyra's explicitly defends honest scoring (0.78 stays 0.78). Both files trigger the Critic-Path Gate; the plan wires test fixtures (10 known-bad scripts + 5 known-bad rendered shots) directly to the personas they test.
- **Five persona tests** cover the verifiable claims: Atlas produces a valid 6-beat 60–90s ShotList with FK-clean references and no banned phrasing; Mara catches all 10 known-bad scripts with the right severity+category; Lyra scores all 5 known-bad shots below threshold; Gem extracts ≥10 landmarks with non-degenerate confidence bands; Tavi cache-hit triggers zero network calls (`fetch` spy throws).
- **Phase-3 is ~2,270 LoC + ~24 binary fixtures**, sequenced in five sub-phases (3a schemas → 3b Atlas+Gem → 3c Mara → 3d Lyra → 3e Tavi+Exa) with Lead approval gates on every critic-path PR; landing 3a unblocks every downstream stage, and the schemas + persona prompts together let Phase-4 wire the worker without any cross-stage type ambiguity.
