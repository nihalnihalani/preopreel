// apps/synthesis-worker/stages/07-storyboard.ts
//
// Stage 7 — Storyboard Keyframes. Lyra owns this; one Seedream call per
// beat. ★ Tier-0 anchor (Invariant 2 sub-rule). Without this, Stage 9
// Seedance has no image_refs and the wrapper throws.
//
// Concurrency: ≤3 in parallel — same lane budget as Seedance fan-out.

import pLimit from "p-limit";
import { seedreamKeyframe, type SeedreamResult } from "@/lib/seed/seedream";
import { emitTrace } from "../sse";
import { persistForgeRunStatus } from "../persist";
import type { LensedShotList } from "./06-cinema-lens";
import type { Stage5Result } from "./05-anatomy-bible";
import type { Stage2Result } from "./02-research";

export interface Keyframe {
  beat_id: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Reference URI for image_refs[0] — replay path or CDN URL. */
  ref_url: string;
}

export interface Stage7Input {
  forgeRunId: string;
  lensed: LensedShotList;
  bible: Stage5Result;
  research: Stage2Result;
}

export async function runStage7(input: Stage7Input): Promise<Keyframe[]> {
  const { forgeRunId, lensed, bible, research } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "renderingKeyframes");
  await emitTrace({
    forgeRunId,
    stage: "stage_7_seedream",
    message: `Tier-0 keyframes: ${lensed.beats.length} beats`,
    persona: "lyra",
  });

  const limiter = pLimit(3);
  const styleRefs = research.exa.map((s) => ({ url: s.url, weight: s.weight }));

  const keyframes = await Promise.all(
    lensed.beats.map((beat) =>
      limiter(async () => {
        const focusEntities = bible.graph.entities.filter((e) =>
          beat.anatomical_focus.includes(e.id),
        );
        const anatomicalRefs = focusEntities.flatMap((e) =>
          (e.refImages ?? []).slice(0, 2).map((url) => ({ url, entity: e.name })),
        );
        const result: SeedreamResult = await seedreamKeyframe({
          beatId: beat.beat_id,
          prompt: `${beat.procedure_step}${beat.lens_suffix}`,
          anatomical_refs: anatomicalRefs,
          style_refs: styleRefs,
        });
        const ref_url =
          result.meta.url ||
          `replay://stage_7_seedream/${forgeRunId}/${beat.beat_id}.png`;
        await emitTrace({
          forgeRunId,
          stage: "stage_7_seedream",
          message: `keyframe: ${beat.beat_id}`,
          persona: "lyra",
          data: { bytes: result.bytes.byteLength, width: result.meta.width },
        });
        return {
          beat_id: beat.beat_id,
          bytes: result.bytes,
          width: result.meta.width,
          height: result.meta.height,
          ref_url,
        };
      }),
    ),
  );

  await emitTrace({
    forgeRunId,
    stage: "stage_7_seedream",
    message: `keyframes complete (${keyframes.length})`,
    persona: "lyra",
    duration_ms: Date.now() - start,
  });
  return keyframes;
}
