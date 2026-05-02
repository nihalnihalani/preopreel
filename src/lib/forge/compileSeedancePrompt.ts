// src/lib/forge/compileSeedancePrompt.ts
//
// Stage 8 — Prompt compiler. Maps (beat, anatomyGraph, lensSuffix) →
// SeedancePayload. Belt-and-suspenders: rejects payloads with
// image_refs.length === 0 BEFORE they reach the wrapper.
//
// The wrapper itself also throws SeedanceInvariantError on empty image_refs,
// but failing here gives a clearer stack trace pointing at the upstream
// caller's compilation step. Mara C.4: this enforces Invariant 2 sub-rule
// at the boundary where prompt assembly happens.

import { SeedanceInvariantError, type SeedancePayload } from "@/lib/seed/seedance";

// ─── Minimal duck-typed inputs ─────────────────────────────────────────────
//
// We intentionally do not import from Schema Dev's modules here — Schema
// Dev is writing those in parallel and we don't want a build-time circular
// dep before they land. We accept structurally-typed inputs and let the
// callers (worker stages) wire up the real Zod-validated types.

export interface CompilerBeat {
  beat_id: string;
  /** Procedure-step description from the ShotList. */
  procedure_step: string;
  /** Narrator line — passed in for context but text is rendered via Remotion. */
  narrator_line: string;
  duration_s: number;
  camera_angle?: string;
  /** Optional anatomical focus list (entity ids referenced in the AnatomyGraph). */
  anatomical_focus?: string[];
}

export interface CompilerEntity {
  id: string;
  name: string;
  /** Reference image URLs from the anatomy bible (1–3 per entity). */
  refImages?: string[];
}

export interface CompilerAnatomyGraph {
  entities: CompilerEntity[];
}

export interface CompileInputs {
  beat: CompilerBeat;
  /** Seedream Tier-0 keyframe URL/data-URI for this beat. REQUIRED. */
  keyframeRef: string;
  /** Anatomy graph for entity-ref lookup (1–3 per entity). */
  anatomyGraph: CompilerAnatomyGraph;
  /** Cinema-lens suffix from Stage 6 (e.g., ", 24mm anamorphic, f/2.8"). */
  lensSuffix: string;
  /** Prev-beat last_frame_url for I2V continuity. Empty for beat 0. */
  prevLastFrameUrl?: string;
  aspect_ratio?: "16:9" | "9:16";
}

/**
 * Compile the prompt + image_refs payload Seedance consumes. Throws
 * SeedanceInvariantError BEFORE the wrapper if image_refs would be empty.
 */
export function compileSeedancePrompt(inputs: CompileInputs): SeedancePayload {
  const { beat, keyframeRef, anatomyGraph, lensSuffix, prevLastFrameUrl } = inputs;

  // image_refs[0] is always the Seedream keyframe (Tier-0 anchor).
  // Subsequent entries are entity refs from the anatomy bible.
  const image_refs: string[] = [];
  if (keyframeRef) image_refs.push(keyframeRef);

  const focusIds = beat.anatomical_focus ?? [];
  for (const eid of focusIds) {
    const ent = anatomyGraph.entities.find((e) => e.id === eid);
    if (!ent || !ent.refImages) continue;
    for (const r of ent.refImages.slice(0, 2)) {
      if (r && !image_refs.includes(r)) image_refs.push(r);
    }
  }

  if (image_refs.length === 0) {
    throw new SeedanceInvariantError(
      `compileSeedancePrompt(beat=${beat.beat_id}): image_refs is empty. ` +
        "Every Seedance call requires the Stage-7 Seedream keyframe at minimum. " +
        "Did Stage 7 fail or did the keyframe URL not propagate?",
    );
  }

  // Prompt = procedure_step + lens suffix. We do NOT include narrator_line
  // here — text rendered inside Seedance prompts produces glyph-soup; all
  // narration lives in Remotion overlays (Lyra's on_screen_text_violations
  // gate enforces this post-render).
  const prompt = `${beat.procedure_step}${lensSuffix}`;

  const payload: SeedancePayload = {
    beatId: beat.beat_id,
    prompt,
    image_refs,
    duration_s: beat.duration_s,
    aspect_ratio: inputs.aspect_ratio ?? "16:9",
  };
  if (prevLastFrameUrl) payload.video_ref = prevLastFrameUrl;
  return payload;
}
