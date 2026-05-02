// apps/synthesis-worker/stages/06-cinema-lens.ts
//
// Stage 6 — Cinema Lens. Deterministic — no LLM call. Maps each beat's
// camera_angle to a cinema-lens suffix from src/lib/forge/lens/taxonomy.ts.

import { lensSuffix } from "@/lib/forge/lens/taxonomy";
import { emitTrace } from "../sse";
import type { ShotList, ShotListBeat } from "./03-director";

export interface LensedBeat extends ShotListBeat {
  lens_suffix: string;
}

export interface LensedShotList {
  logline: string;
  beats: LensedBeat[];
}

export interface Stage6Input {
  forgeRunId: string;
  shotList: ShotList;
}

export async function runStage6(input: Stage6Input): Promise<LensedShotList> {
  const { forgeRunId, shotList } = input;
  const start = Date.now();
  const beats: LensedBeat[] = shotList.beats.map((b) => ({
    ...b,
    lens_suffix: lensSuffix(b.camera_angle),
  }));
  await emitTrace({
    forgeRunId,
    stage: "stage_6_cinema_lens",
    message: `lens suffixes applied to ${beats.length} beats`,
    duration_ms: Date.now() - start,
  });
  return { logline: shotList.logline, beats };
}
