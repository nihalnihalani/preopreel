// Schema module — ShotList (Atlas Stage 3 output).
// Refinements: total beat duration ∈ [60, 90]s, beat ids unique,
// every beat has ≥1 citation (Invariant 4), beat count ∈ [4, 10].
import { z } from "zod";
import { Citation } from "@/lib/forge/types";

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
// citations[] are inline Citation objects (Invariant 4)
export const ShotBeat = z
  .object({
    id: z.string().min(1).max(48), // "beat-03-acetabular-reaming"
    durationS: z.number().min(2).max(15), // ≤5 → straight T2V; >5 → seedance-extend
    procedureStepId: z.string().min(1).max(64),
    anatomicalFocus: z.array(z.string().min(1).max(64)).min(1).max(6),
    cameraAngle: CameraAngle,
    narratorLine: z.string().min(1).max(300),
    citations: z.array(Citation).min(1).max(4), // ≥1 — Invariant 4
    mood: BeatMood,
  })
  .strict();
export type ShotBeat = z.infer<typeof ShotBeat>;

// ─── ShotList ─────────────────────────────────────────────
// logline is the 1-sentence elevator pitch shown at the top of the
// audit PDF and used as the demo HUD's title. ≤180 chars.
//
// Total duration constraint: 60..90s (README §1).
// Beat count: 4..10 (loose; demo case is 6).
export const ShotList = z
  .object({
    logline: z.string().min(1).max(180),
    beats: z.array(ShotBeat).min(4).max(10),
  })
  .strict()
  .superRefine((sl, ctx) => {
    // total duration sum constraint (60..90s)
    const total = sl.beats.reduce((s, b) => s + b.durationS, 0);
    if (total < 60 || total > 90) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["beats"],
        message: `total duration ${total}s outside [60, 90]s`,
      });
    }
    // beat ids unique
    const seen = new Set<string>();
    sl.beats.forEach((b, i) => {
      if (seen.has(b.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", i, "id"],
          message: `duplicate beat id: ${b.id}`,
        });
      }
      seen.add(b.id);
      // belt-and-suspenders: at least one citation per beat (Invariant 4)
      if (b.citations.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats", i, "citations"],
          message: "every beat must carry ≥1 citation (Invariant 4)",
        });
      }
    });
  });
export type ShotList = z.infer<typeof ShotList>;
