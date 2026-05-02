// apps/synthesis-worker/stages/03-director.ts
//
// Stage 3 — Director. Atlas (Seed 2.0 Pro) drafts the ShotList from
// IntakeResult + ResearchBundle. The Schema Dev's ShotListSchema lives
// at @/lib/forge/shotList — we duck-type here to compile in parallel.

import { z } from "zod";
import { arkChat } from "@/lib/seed/ark";
import { emitTrace } from "../sse";
import { persistForgeRunStatus, persistShotList } from "../persist";
import type { Stage1Result } from "./01-intake";
import type { Stage2Result } from "./02-research";

export interface ShotListBeat {
  beat_id: string;
  procedure_step_id: string;
  procedure_step: string;
  anatomical_focus: string[];
  camera_angle: string;
  narrator_line: string;
  duration_s: number;
}

export interface ShotList {
  logline: string;
  beats: ShotListBeat[];
}

const ShotListSchema: z.ZodType<ShotList> = z.object({
  logline: z.string().min(1),
  beats: z
    .array(
      z.object({
        beat_id: z.string().min(1),
        procedure_step_id: z.string().min(1),
        procedure_step: z.string().min(1),
        anatomical_focus: z.array(z.string()),
        camera_angle: z.string(),
        narrator_line: z.string().min(1).max(500),
        duration_s: z.number().min(0.5).max(15),
      }),
    )
    .min(1),
});

const ATLAS_FALLBACK_PROMPT =
  "You are Atlas, a surgical-investigator director. You produce shot lists " +
  "that explain the surgeon's procedure plan to a patient. NEVER recommend; " +
  "only explain. Cite plan section ids. Output JSON matching the ShotList schema.";

export interface Stage3Input {
  forgeRunId: string;
  intake: Stage1Result;
  research: Stage2Result;
}

export async function runStage3(input: Stage3Input): Promise<ShotList> {
  const { forgeRunId, intake, research } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "directing");
  await emitTrace({
    forgeRunId,
    stage: "stage_3_director",
    message: "Atlas drafting ShotList",
    persona: "atlas",
  });

  const userText = JSON.stringify({
    plan: intake.plan,
    patient: intake.patient,
    pmids: research.tavi,
    anatomy: research.anatomy,
  });

  // Lazy-load the verbatim system prompt from Schema Dev's persona module
  // when available; fall back to the local placeholder.
  let systemPrompt = ATLAS_FALLBACK_PROMPT;
  try {
    const mod = (await import("@/lib/forge/personas/atlas-surgical")) as {
      ATLAS_SURGICAL_PROMPT?: string;
    };
    if (mod.ATLAS_SURGICAL_PROMPT) systemPrompt = mod.ATLAS_SURGICAL_PROMPT;
  } catch {
    /* persona module not yet landed — use fallback */
  }

  const shotList = await arkChat<ShotList>({
    stage: "stage_3_director",
    persona: "atlas",
    systemPrompt,
    userContent: [{ type: "text", text: userText }],
    schema: ShotListSchema,
  });

  await persistShotList(forgeRunId, { v: 1, shotList });
  await emitTrace({
    forgeRunId,
    stage: "stage_3_director",
    message: `ShotList drafted: ${shotList.beats.length} beats`,
    persona: "atlas",
    duration_ms: Date.now() - start,
  });
  return shotList;
}
