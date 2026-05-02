// apps/synthesis-worker/stages/11-narration.ts
//
// Stage 11 — Narration. Atlas owns the corpus boundedness (enforced upstream
// by Mara/Lyra). This stage just calls Seed Speech 2.0 per beat.
// Stage 11b OmniHuman is feature-flagged off for Layer-1 (Mara F.1).

import { seedSpeech, type VoicePreset } from "@/lib/seed/speech";
import { emitTrace } from "../sse";
import { persistForgeRunStatus } from "../persist";
import type { AcceptedBeat } from "./10-vision-critic";

export interface NarrationTrack {
  beat_id: string;
  bytes: Uint8Array;
  durationMs: number;
}

export interface Stage11Input {
  forgeRunId: string;
  accepted: AcceptedBeat[];
  voice?: VoicePreset;
  /** Map beat_id → narrator_line. Worker upstream supplies this. */
  narrationLines?: Record<string, string>;
}

export async function runStage11(
  input: Stage11Input,
): Promise<NarrationTrack[]> {
  const { forgeRunId, accepted, voice = "warm-female" } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "narrating");
  await emitTrace({
    forgeRunId,
    stage: "stage_11_speech",
    message: `Seed Speech: ${accepted.length} beats`,
    persona: "atlas",
  });

  // Narration text is bounded UPSTREAM by Mara's pre-render Critique
  // (advice_creep / uncited_claim). We deliberately don't validate here.
  // Lines come in from the Stage 10 result via the worker's narrationLines
  // map; if absent for a beat we use a deterministic placeholder.
  const tracks: NarrationTrack[] = [];
  for (const beat of accepted) {
    const text =
      input.narrationLines?.[beat.beat_id] ??
      `Beat ${beat.beat_id} narration placeholder.`;
    const result = await seedSpeech({
      beatId: beat.beat_id,
      text,
      voice,
    });
    tracks.push({
      beat_id: beat.beat_id,
      bytes: result.bytes,
      durationMs: result.meta.durationMs,
    });
    await emitTrace({
      forgeRunId,
      stage: "stage_11_speech",
      message: `narration: ${beat.beat_id} (${result.meta.durationMs}ms)`,
      persona: "atlas",
      data: { beat_id: beat.beat_id, ms: result.meta.durationMs },
    });
  }

  await emitTrace({
    forgeRunId,
    stage: "stage_11_speech",
    message: `narration complete (${tracks.length} tracks)`,
    persona: "atlas",
    duration_ms: Date.now() - start,
  });
  return tracks;
}
