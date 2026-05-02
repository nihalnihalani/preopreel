// tests/synthesis-worker/test_keyframe_anchoring.test.ts
//
// ★ Invariant 2 sub-rule. Every Seedance call must include image_refs.length >= 1.
// We check three angles:
//   1. compileSeedancePrompt throws when keyframeRef is empty.
//   2. seedanceI2V/T2VWithRef throw SeedanceInvariantError on []
//   3. compileSeedancePrompt outputs always have image_refs.length >= 1
//      across a representative spread of beat shapes.

import { describe, it, expect } from "vitest";
import { compileSeedancePrompt } from "@/lib/forge/compileSeedancePrompt";
import {
  seedanceI2V,
  seedanceT2VWithRef,
  SeedanceInvariantError,
  type SeedancePayload,
} from "@/lib/seed/seedance";

const baseAnatomy = {
  entities: [
    {
      id: "femur_head",
      name: "Femoral head",
      refImages: ["https://e/femur1.png", "https://e/femur2.png"],
    },
    {
      id: "pelvis_acetabular",
      name: "Acetabular cup region",
      refImages: ["https://e/pelvis1.png"],
    },
  ],
};

describe("Invariant 2 sub-rule: keyframe anchoring", () => {
  it("compileSeedancePrompt throws when keyframeRef is empty and no entity refs", () => {
    expect(() =>
      compileSeedancePrompt({
        beat: {
          beat_id: "b1",
          procedure_step: "incision",
          narrator_line: "We will make a 4-inch incision.",
          duration_s: 3,
          anatomical_focus: [],
        },
        keyframeRef: "",
        anatomyGraph: { entities: [] },
        lensSuffix: ", 24mm",
      }),
    ).toThrow(SeedanceInvariantError);
  });

  it("compileSeedancePrompt always returns image_refs.length >= 1 with a keyframe", () => {
    for (const angle of ["wide_anatomical", "close_up", "macro_surgical"]) {
      const payload = compileSeedancePrompt({
        beat: {
          beat_id: `b_${angle}`,
          procedure_step: "step",
          narrator_line: "narrator",
          duration_s: 3.5,
          camera_angle: angle,
          anatomical_focus: ["femur_head"],
        },
        keyframeRef: "https://kf/beat.png",
        anatomyGraph: baseAnatomy,
        lensSuffix: ", 24mm",
      });
      expect(payload.image_refs.length).toBeGreaterThanOrEqual(1);
      expect(payload.image_refs[0]).toBe("https://kf/beat.png");
    }
  });

  it("seedanceT2VWithRef throws SeedanceInvariantError on empty image_refs", async () => {
    const bad: SeedancePayload = {
      beatId: "b1",
      prompt: "test",
      image_refs: [],
      duration_s: 3,
    };
    await expect(seedanceT2VWithRef(bad)).rejects.toBeInstanceOf(
      SeedanceInvariantError,
    );
  });

  it("seedanceI2V throws SeedanceInvariantError on empty image_refs", async () => {
    const bad: SeedancePayload = {
      beatId: "b1",
      prompt: "test",
      image_refs: [],
      video_ref: "https://prev/last.png",
      duration_s: 3,
    };
    await expect(seedanceI2V(bad)).rejects.toBeInstanceOf(
      SeedanceInvariantError,
    );
  });
});
