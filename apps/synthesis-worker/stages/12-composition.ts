// apps/synthesis-worker/stages/12-composition.ts
//
// Stage 12 — Composition + Render. Lyra invokes Remotion to mux the
// per-beat MP4s + WAV narration + overlays into a single 1080p H.264 file.
// No Seed call here — local rendering only. The actual Remotion programmatic
// render lives in @/lib/render (Frontend Dev's module).

import { emitTrace } from "../sse";
import { persistForgeRunStatus } from "../persist";
import type { AcceptedBeat } from "./10-vision-critic";
import type { NarrationTrack } from "./11-narration";

export interface Stage12Input {
  forgeRunId: string;
  accepted: AcceptedBeat[];
  audio: NarrationTrack[];
}

export interface Stage12Result {
  /** MP4 URL — replay path or storage URL post-upload. */
  mp4_url: string;
  duration_s: number;
  cost_usd: number;
}

export async function runStage12(
  input: Stage12Input,
): Promise<Stage12Result> {
  const { forgeRunId, accepted, audio } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "composing");
  await emitTrace({
    forgeRunId,
    stage: "stage_12_remotion",
    message: `Remotion compose: ${accepted.length} beats, ${audio.length} narration tracks`,
    persona: "lyra",
  });

  // Frontend Dev owns @/lib/render; we dynamic-import to keep this stage
  // compileable before that lands.
  type RenderFn = (args: {
    forgeRunId: string;
    beats: AcceptedBeat[];
    audio: NarrationTrack[];
  }) => Promise<{ mp4_url: string; duration_s: number; cost_usd: number }>;

  let renderFn: RenderFn | null = null;
  try {
    const mod = (await import("@/lib/render")) as {
      renderPreOpExplainer?: RenderFn;
    };
    renderFn = mod.renderPreOpExplainer ?? null;
  } catch {
    /* not landed yet */
  }

  const totalDuration = accepted.reduce(
    (s, b) => s + b.finalRender.result.duration_s,
    0,
  );
  let result: Stage12Result;
  if (renderFn) {
    result = await renderFn({ forgeRunId, beats: accepted, audio });
  } else {
    // Fixture path — replay/dev mode produces a synthetic result. Real
    // render lands when Frontend Dev's render module is wired.
    result = {
      mp4_url: `replay://stage_12_remotion/${forgeRunId}/final.mp4`,
      duration_s: totalDuration,
      cost_usd: 0,
    };
  }

  await emitTrace({
    forgeRunId,
    stage: "stage_12_remotion",
    message: `render complete: ${result.duration_s}s`,
    persona: "lyra",
    duration_ms: Date.now() - start,
    data: { mp4_url: result.mp4_url, duration_s: result.duration_s },
  });
  return result;
}
