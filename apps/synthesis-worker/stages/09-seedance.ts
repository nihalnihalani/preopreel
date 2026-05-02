// apps/synthesis-worker/stages/09-seedance.ts
//
// Stage 9 — Seedance fan-out. ★ Invariant 2.
// The wrapper handles MAX_CONCURRENT_LANES via p-limit, so this stage just
// fires Promise.all over the per-beat payloads.

import {
  seedanceI2V,
  seedanceT2VWithRef,
  type SeedancePayload,
  type SeedanceResult,
} from "@/lib/seed/seedance";
import { emitTrace } from "../sse";
import { persistForgeRunStatus, persistBeat } from "../persist";

export interface BeatRender {
  beat_id: string;
  result: SeedanceResult;
}

export interface Stage9Input {
  forgeRunId: string;
  payloads: SeedancePayload[];
}

export async function runStage9(input: Stage9Input): Promise<BeatRender[]> {
  const { forgeRunId, payloads } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "renderingVideo");
  await emitTrace({
    forgeRunId,
    stage: "stage_9_seedance",
    message: `Seedance fan-out: ${payloads.length} beats`,
  });

  const renders = await Promise.all(
    payloads.map(async (p) => {
      const result = p.video_ref
        ? await seedanceI2V(p)
        : await seedanceT2VWithRef(p);
      await persistBeat(forgeRunId, {
        beat_id: p.beatId,
        request_id: result.request_id,
        video_url: result.video_url,
        last_frame_url: result.last_frame_url,
        duration_s: result.duration_s,
        cost_usd: result.cost_estimate_usd,
      });
      await emitTrace({
        forgeRunId,
        stage: "stage_9_seedance",
        message: `beat ${p.beatId} rendered (${result.duration_s}s)`,
        data: {
          beat_id: p.beatId,
          segments: result.segments.length,
        },
      });
      return { beat_id: p.beatId, result };
    }),
  );

  await emitTrace({
    forgeRunId,
    stage: "stage_9_seedance",
    message: `Seedance complete (${renders.length} beats)`,
    duration_ms: Date.now() - start,
  });
  return renders;
}
