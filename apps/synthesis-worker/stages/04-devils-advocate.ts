// apps/synthesis-worker/stages/04-devils-advocate.ts
//
// Stage 4 — Mara (Devil's Advocate) ★ Invariant 1.
// Pre-render critic gate. 1-round cap. Critiques + score floor logic
// live in @/lib/forge/critic; this stage wires the persona invocation
// to that primitive.

import { z } from "zod";
import { arkChat } from "@/lib/seed/ark";
import {
  runMaraCritique,
  type CriticCritique,
  type MaraContext,
} from "../criticLoop";
import { emitTrace } from "../sse";
import { persistForgeRunStatus, persistCritiquesAsync } from "../persist";
import type { ShotList } from "./03-director";

const CritiqueSchema: z.ZodType<CriticCritique> = z.object({
  shot_id: z.string(),
  severity: z.enum(["block", "warn", "info"]),
  category: z.string(),
  excerpt: z.string().max(200),
  reason: z.string().max(200),
  suggested_revision: z.string().optional(),
});

const CritiqueArraySchema = z.array(CritiqueSchema);

const MARA_FALLBACK_PROMPT =
  "You are Mara, Devil's Advocate. You read the Director's ShotList and " +
  "emit a list of Critique objects. Categories include advice_creep, " +
  "uncited_claim, ambiguity, scope_creep, anatomical_invention, " +
  "population_assumption, imperative_overreach, cited_but_irrelevant. " +
  "Output JSON array. YOU MUST DISAGREE WITH AT LEAST ONE BEAT.";

export interface Stage4Input {
  forgeRunId: string;
  shotList: ShotList;
}

export interface Stage4Result {
  shotList: ShotList;
  critiques: CriticCritique[];
}

export async function runStage4(input: Stage4Input): Promise<Stage4Result> {
  const { forgeRunId, shotList } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "critiquing");
  await emitTrace({
    forgeRunId,
    stage: "stage_4_mara",
    message: "Mara reading ShotList",
    persona: "mara",
  });

  let systemPrompt = MARA_FALLBACK_PROMPT;
  try {
    const mod = (await import("@/lib/forge/personas/mara")) as {
      MARA_DEVILS_ADVOCATE_PROMPT?: string;
    };
    if (mod.MARA_DEVILS_ADVOCATE_PROMPT)
      systemPrompt = mod.MARA_DEVILS_ADVOCATE_PROMPT;
  } catch {
    /* persona not yet landed */
  }

  const ctx: MaraContext = {
    invokeMara: async (current) => {
      const result = await arkChat<CriticCritique[]>({
        stage: "stage_4_mara",
        persona: "mara",
        systemPrompt,
        userContent: [
          { type: "text", text: JSON.stringify({ shotList: current }) },
        ],
        schema: CritiqueArraySchema,
        cacheKeyExtra: JSON.stringify(
          current.beats.map((b) => `${b.shot_id}:${b.narrator_line}`),
        ),
      });
      return result;
    },
    // Atlas redraft is optional — when not provided, runMaraCritique falls
    // back to in-place suggested_revision swaps only. This keeps Stage 4
    // strictly within the 1-round cap (Mara → revision → Mara, no Atlas
    // re-invocation).
  };

  // Convert worker's ShotList to the structurally-typed CriticShotList.
  const adapted = {
    beats: shotList.beats.map((b) => ({
      shot_id: b.beat_id,
      narrator_line: b.narrator_line,
    })),
  };
  const result = await runMaraCritique(adapted, ctx);

  // Apply revisions back to the typed ShotList.
  const revisedById = new Map(
    result.revisedShotList.beats.map((b) => [b.shot_id, b.narrator_line]),
  );
  const revised: ShotList = {
    logline: shotList.logline,
    beats: shotList.beats.map((b) => ({
      ...b,
      narrator_line: revisedById.get(b.beat_id) ?? b.narrator_line,
    })),
  };

  // Mara E.1: critique writes are fire-and-forget.
  persistCritiquesAsync(forgeRunId, result.critiques);

  const blocks = result.critiques.filter((c) => c.severity === "block").length;
  await emitTrace({
    forgeRunId,
    stage: "stage_4_mara",
    message: `Mara: ${result.critiques.length} critiques (${blocks} blocks) in ${result.rounds} round(s)`,
    persona: "mara",
    duration_ms: Date.now() - start,
    data: {
      total: result.critiques.length,
      blocks,
      rounds: result.rounds,
    },
  });

  return { shotList: revised, critiques: result.critiques };
}
