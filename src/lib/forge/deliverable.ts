// Schema module — Deliverable (terminal output of a successful run).
// Returned from GET /api/forge/{id} once status === "done".
import { z } from "zod";
import { CriticScore } from "@/lib/forge/critique";

// ─── Deliverable ─────────────────────────────────────────────
// All URLs are signed CDN URLs (Butterbase Storage primary; DigitalOcean
// Spaces fallback). omnihumanIntroUrl is optional (Layer 2; cut if uncanny).
// totalCostUsd is the sum of ForgeRun.costUsd values, denormalized for
// the deliverable card UI.
// criticTrace[] is the FULL Lyra score history including any regen
// attempts — judges see the regen sequence in the HUD (Mara A.3:
// honesty over theater; we surface accepted_with_low_score badges).
// regenCount is the total number of beat-regenerations across the run.
export const Deliverable = z
  .object({
    explainerMp4Url: z.string().url(),
    auditTrailPdfUrl: z.string().url(),
    omnihumanIntroUrl: z.string().url().optional(),
    durationS: z.number().min(60).max(90),
    regenCount: z.number().int().min(0).max(20),
    totalCostUsd: z.number().nonnegative(),
    criticTrace: z.array(CriticScore).min(1).max(40),
  })
  .strict();
export type Deliverable = z.infer<typeof Deliverable>;
