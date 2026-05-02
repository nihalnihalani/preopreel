// Schema module — AnatomyGraph (Gem Stage 2c output).
// Mara D.4 mitigation: ConfidenceBand REJECTS lo === hi (no fake-degenerate
// bands like {0.7, 0.7}); refinement also enforces lo <= hi. The AnatomyGraph
// superRefine enforces a closed graph (every relationship endpoint exists in
// landmarks[]).
import { z } from "zod";

// ─── Sex ─────────────────────────────────────────────
// Biological for surgical relevance (anatomical defaults), not identity.
export const Sex = z.enum(["male", "female", "intersex", "unknown"]);
export type Sex = z.infer<typeof Sex>;

// ─── Patient ─────────────────────────────────────────────
// Synthetic phantom on the demo path; real anonymized scans in deploy.
// Comorbidities is a free-text list bounded to ≤8 items.
export const Patient = z
  .object({
    id: z.string().min(1).max(64), // e.g. "synthetic-phantom-001"
    age: z.number().int().min(0).max(120),
    sex: Sex,
    bmi: z.number().min(8).max(80), // physiologically plausible
    comorbidities: z.array(z.string().min(1).max(120)).max(8),
  })
  .strict();
export type Patient = z.infer<typeof Patient>;

// ─── SurgicalStep ─────────────────────────────────────────────
// Atomic unit of the procedure plan. Atlas may not emit a beat that
// references a SurgicalStep id not present here. Mara enforces this
// pre-render (category: "scope_creep" or "anatomical_invention").
export const SurgicalStep = z
  .object({
    id: z.string().min(1).max(64), // "step-04-acetabular-reaming"
    ordinal: z.number().int().min(1).max(64), // 1-indexed plan order
    description: z.string().min(1).max(400),
    // pointer back into the surgeon's PDF — every step traces home.
    sourcePointer: z.string().min(1).max(80), // "§3.2" or "p.5 ¶1"
  })
  .strict();
export type SurgicalStep = z.infer<typeof SurgicalStep>;

// ─── Procedure ─────────────────────────────────────────────
// approach is a free-text string ("posterior", "anterior", "lateral");
// cptCode follows AMA CPT format (4–5 numeric or trailing letter).
export const Procedure = z
  .object({
    id: z.string().min(1).max(64), // "hip-replacement-posterior"
    name: z.string().min(1).max(120), // "Total Hip Arthroplasty"
    approach: z.string().min(1).max(80),
    cptCode: z.string().regex(/^\d{4,5}[A-Za-z]?$/),
    surgicalSteps: z.array(SurgicalStep).min(1).max(40),
  })
  .strict();
export type Procedure = z.infer<typeof Procedure>;

// ─── ConfidenceBand ─────────────────────────────────────────────
// Honesty > theater. Every landmark Gem extracts gets a band; the
// HUD overlays it as a visible band, not a hidden number.
//
// MARA D.4 MITIGATION: reject lo === hi outright. A degenerate band is
// either a fake confidence (Gem outputting {0.7, 0.7} as a vibe) or a
// schema bug (default values not overridden). Either way, it is not
// honest uncertainty and we surface it as a parse error.
export const ConfidenceBand = z
  .object({
    lo: z.number().min(0).max(1),
    hi: z.number().min(0).max(1),
  })
  .strict()
  .refine((b) => b.lo <= b.hi, { message: "lo must be <= hi" })
  .refine((b) => b.lo !== b.hi, {
    message:
      "confidence band must be non-degenerate (lo !== hi); identical bounds are not honest uncertainty (Mara D.4)",
  });
export type ConfidenceBand = z.infer<typeof ConfidenceBand>;

// ─── AnatomicalSystem ─────────────────────────────────────────────
// Coarse buckets — narrow enough that Lyra's vision critic can route
// per-system ref images, broad enough to cover the procedure library.
export const AnatomicalSystem = z.enum([
  "musculoskeletal",
  "cardiovascular",
  "nervous",
  "respiratory",
  "digestive",
  "urogenital",
  "integumentary",
  "endocrine",
  "lymphatic",
  "ophthalmic",
  "ent",
  "other",
]);
export type AnatomicalSystem = z.infer<typeof AnatomicalSystem>;

// ─── Landmark ─────────────────────────────────────────────
// id is stable across regenerations of the same plan (deterministic
// hash of label + system); label is human-readable for overlays.
export const Landmark = z
  .object({
    id: z.string().min(1).max(64), // "lm-acetabulum-right"
    label: z.string().min(1).max(80), // "Right Acetabulum"
    anatomicalSystem: AnatomicalSystem,
    confidenceBand: ConfidenceBand,
  })
  .strict();
export type Landmark = z.infer<typeof Landmark>;

// ─── RelationshipKind ─────────────────────────────────────────────
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
export type RelationshipKind = z.infer<typeof RelationshipKind>;

// ─── Relationship ─────────────────────────────────────────────
// Used by Atlas to phrase narratorLines that talk about *how* one
// landmark relates to another. Lyra uses these to verify the rendered
// scene shows the relationship correctly (anatomical_fidelity score).
export const Relationship = z
  .object({
    sourceLandmarkId: z.string().min(1).max(64),
    targetLandmarkId: z.string().min(1).max(64),
    relation: RelationshipKind,
  })
  .strict();
export type Relationship = z.infer<typeof Relationship>;

// ─── AnatomyGraph ─────────────────────────────────────────────
// Closed-graph superRefine: every relationship endpoint exists in
// landmarks[]. Without this, Atlas can phrase a narrator_line about
// a relationship whose endpoints don't exist — Mara would catch it
// post-hoc, but a parser-level catch is cheaper.
export const AnatomyGraph = z
  .object({
    patient: Patient,
    procedure: Procedure,
    landmarks: z.array(Landmark).min(1).max(60),
    relationships: z.array(Relationship).max(200),
  })
  .strict()
  .superRefine((g, ctx) => {
    const ids = new Set(g.landmarks.map((l) => l.id));
    g.relationships.forEach((r, i) => {
      if (!ids.has(r.sourceLandmarkId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relationships", i, "sourceLandmarkId"],
          message: `unknown landmark id: ${r.sourceLandmarkId}`,
        });
      }
      if (!ids.has(r.targetLandmarkId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["relationships", i, "targetLandmarkId"],
          message: `unknown landmark id: ${r.targetLandmarkId}`,
        });
      }
    });
  });
export type AnatomyGraph = z.infer<typeof AnatomyGraph>;
