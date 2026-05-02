// apps/synthesis-worker/stages/08-prompt-compiler.ts
//
// Stage 8 — Prompt Compiler. Atlas (deterministic). Compiles per-beat
// SeedancePayloads via @/lib/forge/compileSeedancePrompt — that module
// throws SeedanceInvariantError if image_refs would be empty (belt +
// suspenders to the wrapper guard).

import { compileSeedancePrompt } from "@/lib/forge/compileSeedancePrompt";
import type { SeedancePayload } from "@/lib/seed/seedance";
import { emitTrace } from "../sse";
import type { LensedShotList } from "./06-cinema-lens";
import type { Stage5Result } from "./05-anatomy-bible";
import type { Keyframe } from "./07-storyboard";

export interface Stage8Input {
  forgeRunId: string;
  lensed: LensedShotList;
  keyframes: Keyframe[];
  bible: Stage5Result;
}

export async function runStage8(
  input: Stage8Input,
): Promise<SeedancePayload[]> {
  const { forgeRunId, lensed, keyframes, bible } = input;
  const start = Date.now();
  const keyByBeat = new Map(keyframes.map((k) => [k.beat_id, k]));

  const payloads: SeedancePayload[] = [];
  for (let i = 0; i < lensed.beats.length; i++) {
    const beat = lensed.beats[i];
    if (!beat) continue;
    const kf = keyByBeat.get(beat.beat_id);
    if (!kf) {
      throw new Error(
        `Stage 8: no keyframe for beat ${beat.beat_id}. Stage 7 must produce a keyframe per beat.`,
      );
    }
    const prevLastFrame = i > 0 ? `replay://stage_9_seedance/${forgeRunId}/${lensed.beats[i - 1]?.beat_id ?? ""}.lastframe.png` : undefined;

    const payload = compileSeedancePrompt({
      beat: {
        beat_id: beat.beat_id,
        procedure_step: beat.procedure_step,
        narrator_line: beat.narrator_line,
        duration_s: beat.duration_s,
        camera_angle: beat.camera_angle,
        anatomical_focus: beat.anatomical_focus,
      },
      keyframeRef: kf.ref_url,
      anatomyGraph: bible.graph,
      lensSuffix: beat.lens_suffix,
      prevLastFrameUrl: prevLastFrame,
    });
    payloads.push(payload);
  }

  await emitTrace({
    forgeRunId,
    stage: "stage_8_compile",
    message: `compiled ${payloads.length} Seedance payloads`,
    persona: "atlas",
    duration_ms: Date.now() - start,
  });
  return payloads;
}
