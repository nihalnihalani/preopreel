// apps/synthesis-worker/stages/10-vision-critic.ts
//
// Stage 10 — Lyra Vision Critic ★ Invariant 1.
// Per-beat: extract 4 frames, call Lyra with multimodal vision, score,
// and regen ONCE if below threshold. Whatever the second score is, accept.
// Score floor (Mara A.3) marks accepted_with_low_score=true and the HUD
// surfaces it via the honest badge — pipeline does not block.

import { z } from "zod";
import { arkVision } from "@/lib/seed/ark";
import { zaiVision } from "@/lib/seed/zai";
import { seedanceI2V, seedanceT2VWithRef } from "@/lib/seed/seedance";
import {
  runLyraCritique,
  type CriticScore,
  type LyraContext,
  type LyraResult,
} from "../criticLoop";
import { emitTrace } from "../sse";
import {
  persistForgeRunStatus,
  persistCriticScoresAsync,
} from "../persist";
import type { BeatRender } from "./09-seedance";
import type { LensedShotList } from "./06-cinema-lens";
import type { Stage5Result } from "./05-anatomy-bible";

const CriticScoreSchema: z.ZodType<CriticScore> = z.object({
  beat_id: z.string(),
  anatomical_fidelity: z.number().min(0).max(1),
  procedure_step_compliance: z.number().min(0).max(1),
  on_screen_text_violations: z.number().int().nonnegative(),
  feedback: z.string().max(120),
});

const LYRA_FALLBACK_PROMPT =
  "You are Lyra, post-render Vision Critic. Score the rendered beat against " +
  "the AnatomyGraph and ShotList: anatomical_fidelity, procedure_step_compliance " +
  "(both 0..1), on_screen_text_violations (count, must be 0). Provide ≤120-char " +
  "feedback for regen prompts. Output JSON.";

export interface AcceptedBeat {
  beat_id: string;
  finalRender: BeatRender;
  critic: CriticScore;
  attempts: CriticScore[];
  regenerated: boolean;
  accepted_with_low_score: boolean;
}

export interface Stage10Input {
  forgeRunId: string;
  beats: BeatRender[];
  lensed: LensedShotList;
  bible: Stage5Result;
}

// ─── Frame extraction (placeholder — production uses ffmpeg) ──────────────
//
// Worker spec calls for ffmpeg frame sampling at t = duration * [0.10, 0.40,
// 0.65, 0.90]. The actual ffmpeg invocation is left to the demo prewarm
// script (which produces the replay fixtures). At runtime in replay mode,
// the cached arkVision response is keyed on the beat content hash so the
// frames are effectively replayed too.

interface SampledFrame {
  url: string;
}

async function sampleFrames(beat: BeatRender): Promise<SampledFrame[]> {
  // In live mode, the worker would run ffmpeg here. In replay mode this
  // path is short-circuited because arkVision's withReplay returns the
  // cached score before the frames are needed.
  const baseUrl = beat.result.video_url || `replay://${beat.beat_id}`;
  return [
    { url: `${baseUrl}#t=0.1` },
    { url: `${baseUrl}#t=0.4` },
    { url: `${baseUrl}#t=0.65` },
    { url: `${baseUrl}#t=0.9` },
  ];
}

// ─── Stage entry ──────────────────────────────────────────────────────────

export async function runStage10(
  input: Stage10Input,
): Promise<AcceptedBeat[]> {
  const { forgeRunId, beats, lensed, bible } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "scoring");
  await emitTrace({
    forgeRunId,
    stage: "stage_10_lyra",
    message: `Lyra scoring ${beats.length} beats`,
    persona: "lyra",
  });

  let systemPrompt = LYRA_FALLBACK_PROMPT;
  try {
    const mod = (await import("@/lib/forge/personas/lyra")) as {
      LYRA_VISION_CRITIC_PROMPT?: string;
    };
    if (mod.LYRA_VISION_CRITIC_PROMPT)
      systemPrompt = mod.LYRA_VISION_CRITIC_PROMPT;
  } catch {
    /* persona module not yet landed */
  }

  const beatById = new Map(lensed.beats.map((b) => [b.beat_id, b]));
  const accepted: AcceptedBeat[] = [];

  for (const render of beats) {
    const lensedBeat = beatById.get(render.beat_id);
    let currentRender = render;

    const buildLyraContext = (attemptIdx: number): LyraContext => ({
      invokeLyra: async () => {
        const frames = await sampleFrames(currentRender);
        const beatContext = {
          beat_id: render.beat_id,
          procedure_step: lensedBeat?.procedure_step ?? "",
          anatomical_focus: lensedBeat?.anatomical_focus ?? [],
          anatomy_excerpt: bible.graph.entities
            .filter((e) => lensedBeat?.anatomical_focus.includes(e.id))
            .map((e) => `${e.name} (${e.id})`)
            .join(", "),
        };
        const visionArgs = {
          stage: `stage_10_lyra_${render.beat_id}_attempt${attemptIdx}`,
          frames: frames.map((f) => ({ url: f.url })),
          prompt: `Score this beat:\n${JSON.stringify(beatContext)}`,
          schema: CriticScoreSchema,
          systemPrompt,
          cacheKeyExtra: `${render.beat_id}_attempt${attemptIdx}`,
        };
        return process.env.USE_LEGACY_PROVIDERS === "1"
          ? arkVision<CriticScore>(visionArgs)
          : zaiVision<CriticScore>(visionArgs);
      },
      regenerate: async (feedback) => {
        // Re-run Stage 9 single-beat with feedback appended to the prompt.
        // Use the original payload shape but append feedback.
        const original = currentRender.result;
        const newPrompt = `${lensedBeat?.procedure_step ?? ""} | feedback: ${feedback}`;
        const payload = {
          beatId: render.beat_id,
          prompt: newPrompt,
          image_refs: [original.last_frame_url || `replay://kf-${render.beat_id}`],
          duration_s: lensedBeat?.duration_s ?? 5,
          ...(currentRender.result.last_frame_url && {
            video_ref: currentRender.result.last_frame_url,
          }),
        };
        const regen = payload.video_ref
          ? await seedanceI2V(payload)
          : await seedanceT2VWithRef(payload);
        currentRender = { beat_id: render.beat_id, result: regen };
        await emitTrace({
          forgeRunId,
          stage: "stage_10_lyra",
          message: `regen beat ${render.beat_id} (feedback: ${feedback.slice(0, 60)})`,
          persona: "lyra",
        });
      },
    });

    // Two-attempt scoring with attempt index threaded through cache keys.
    let attemptCounter = 0;
    const ctx: LyraContext = {
      invokeLyra: () => buildLyraContext(++attemptCounter).invokeLyra(),
      regenerate: (fb) => buildLyraContext(0).regenerate(fb),
    };

    const result: LyraResult = await runLyraCritique(ctx);
    persistCriticScoresAsync(
      forgeRunId,
      render.beat_id,
      result.attempts,
      result.accepted_with_low_score,
    );

    await emitTrace({
      forgeRunId,
      stage: "stage_10_lyra",
      message: `beat ${render.beat_id}: af=${result.score.anatomical_fidelity.toFixed(2)} psc=${result.score.procedure_step_compliance.toFixed(2)} regen=${result.regenerated} low=${result.accepted_with_low_score}`,
      persona: "lyra",
      data: {
        beat_id: render.beat_id,
        anatomical_fidelity: result.score.anatomical_fidelity,
        procedure_step_compliance: result.score.procedure_step_compliance,
        regenerated: result.regenerated,
        accepted_with_low_score: result.accepted_with_low_score,
      },
    });

    accepted.push({
      beat_id: render.beat_id,
      finalRender: currentRender,
      critic: result.score,
      attempts: result.attempts,
      regenerated: result.regenerated,
      accepted_with_low_score: result.accepted_with_low_score,
    });
  }

  await emitTrace({
    forgeRunId,
    stage: "stage_10_lyra",
    message: `Lyra complete: ${accepted.length} beats accepted`,
    persona: "lyra",
    duration_ms: Date.now() - start,
  });
  return accepted;
}
