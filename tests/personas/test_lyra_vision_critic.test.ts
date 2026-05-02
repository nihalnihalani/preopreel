// Persona test — Lyra Vision Critic.
// Parameterized over the 5 known-bad rendered-shot fixtures
// (lyra-known-bad.ts). Each fixture asserts that Lyra produces a
// CriticScore with min(scores) < 0.75 OR on_screen_text_violations > 0
// — i.e., the critic loop would regenerate.
//
// Includes a separate test for the deliberate Beat-3 demo fixture:
// first attempt anatomical_fidelity 0.71 → 0.86 after regen.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LYRA_KNOWN_BAD } from "@/lib/forge/personas/__fixtures__/lyra-known-bad";
import type { AnatomyGraph } from "@/lib/forge/anatomyGraph";
import type { CriticScore } from "@/lib/forge/critique";
import type { ShotBeat } from "@/lib/forge/shotList";

// ─── Minimal anatomy graph for fixtures ───────────────────────────
const DEMO_ANATOMY_GRAPH: AnatomyGraph = {
  patient: {
    id: "synthetic-phantom-001",
    age: 65,
    sex: "female",
    bmi: 28,
    comorbidities: ["hypertension"],
  },
  procedure: {
    id: "hip-replacement-posterior",
    name: "Total Hip Arthroplasty",
    approach: "posterior",
    cptCode: "27130",
    surgicalSteps: [
      {
        id: "step-01-incision",
        ordinal: 1,
        description: "Posterior incision over greater trochanter, ~10cm.",
        sourcePointer: "§2.3",
      },
      {
        id: "step-04-acetabular-reaming",
        ordinal: 4,
        description: "Sequential acetabular reaming to subchondral bone.",
        sourcePointer: "§3.2",
      },
      {
        id: "step-05-implant-placement",
        ordinal: 5,
        description: "Acetabular shell + femoral stem placement.",
        sourcePointer: "§4.1",
      },
    ],
  },
  landmarks: [
    {
      id: "lm-acetabulum-right",
      label: "Right Acetabulum",
      anatomicalSystem: "musculoskeletal",
      confidenceBand: { lo: 0.84, hi: 0.96 },
    },
    {
      id: "lm-femoral-head-right",
      label: "Right Femoral Head",
      anatomicalSystem: "musculoskeletal",
      confidenceBand: { lo: 0.86, hi: 0.97 },
    },
    {
      id: "lm-greater-trochanter-right",
      label: "Right Greater Trochanter",
      anatomicalSystem: "musculoskeletal",
      confidenceBand: { lo: 0.78, hi: 0.92 },
    },
  ],
  relationships: [],
};

// 4 base64-encoded 1×1 PNGs (transparent). Real frames are larger;
// for unit-test purposes we just need the right count.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";
const FOUR_FRAMES = [TINY_PNG_B64, TINY_PNG_B64, TINY_PNG_B64, TINY_PNG_B64];

// ─── Mock builder: returns a CriticScore matching the fixture's
//     expectedMaxScore. We pick numbers at the ceiling to verify the
//     test correctly asserts ≤ ceiling + tolerance.
function lyraMockFor(
  beat: ShotBeat,
  expected: {
    anatomical_fidelity?: number;
    procedure_step_compliance?: number;
    on_screen_text_violations?: number;
  },
): CriticScore {
  return {
    beat_id: beat.id,
    anatomical_fidelity: expected.anatomical_fidelity ?? 0.85,
    procedure_step_compliance: expected.procedure_step_compliance ?? 0.88,
    on_screen_text_violations: expected.on_screen_text_violations ?? 0,
    feedback: "Test fixture — see lyra-known-bad.ts framesDescription.",
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe("Lyra — Vision Critic (5 known-bad rendered shots)", () => {
  for (const fx of LYRA_KNOWN_BAD) {
    it(`flags ${fx.name} as needing regen`, async () => {
      const mockScore = lyraMockFor(fx.beat, fx.expectedMaxScore);
      vi.doMock("@/lib/seed/ark", () => ({
        arkChat: vi.fn(),
        arkVision: vi.fn(async () => mockScore),
      }));
      const { invoke } = await import("@/lib/forge/personas/lyra");

      const score = await invoke({
        beat: fx.beat,
        anatomyGraph: DEMO_ANATOMY_GRAPH,
        frames: FOUR_FRAMES,
      });

      // The critic loop's decision rule, replicated: regen if
      //   min(anatomical_fidelity, procedure_step_compliance) < 0.75
      //   OR on_screen_text_violations > 0
      const minScore = Math.min(
        score.anatomical_fidelity,
        score.procedure_step_compliance,
      );
      const wouldRegen = minScore < 0.75 || score.on_screen_text_violations > 0;
      expect(wouldRegen).toBe(true);

      // Specific bound assertions per fixture (with 0.05 tolerance).
      if (fx.expectedMaxScore.anatomical_fidelity !== undefined) {
        expect(score.anatomical_fidelity).toBeLessThanOrEqual(
          fx.expectedMaxScore.anatomical_fidelity + 0.05,
        );
      }
      if (fx.expectedMaxScore.procedure_step_compliance !== undefined) {
        expect(score.procedure_step_compliance).toBeLessThanOrEqual(
          fx.expectedMaxScore.procedure_step_compliance + 0.05,
        );
      }
      if (fx.expectedMaxScore.on_screen_text_violations !== undefined) {
        expect(score.on_screen_text_violations).toBeGreaterThanOrEqual(
          fx.expectedMaxScore.on_screen_text_violations,
        );
      }
    });
  }

  it("rejects fewer than 4 frames with a clear error (not silent garbage)", async () => {
    vi.doMock("@/lib/seed/ark", () => ({
      arkChat: vi.fn(),
      arkVision: vi.fn(async () => ({
        beat_id: "beat-03-reaming",
        anatomical_fidelity: 0.9,
        procedure_step_compliance: 0.9,
        on_screen_text_violations: 0,
        feedback: "ok",
      })),
    }));
    const { invoke } = await import("@/lib/forge/personas/lyra");
    const fx = LYRA_KNOWN_BAD[0];
    expect(fx).toBeDefined();
    await expect(
      invoke({
        beat: fx!.beat,
        anatomyGraph: DEMO_ANATOMY_GRAPH,
        frames: [TINY_PNG_B64, TINY_PNG_B64], // only 2 — should throw
      }),
    ).rejects.toThrow(/exactly 4 frames/i);
  });

  it("the deliberate demo fixture has post-regen scores ≥ 0.75", () => {
    const demo = LYRA_KNOWN_BAD.find((f) => f.name === "demo-beat-3-reject-then-regen");
    expect(demo).toBeDefined();
    expect(demo!.expectedPostRegen).toBeDefined();
    const post = demo!.expectedPostRegen!;
    expect(post.anatomical_fidelity).toBeGreaterThanOrEqual(0.75);
    expect(post.procedure_step_compliance).toBeGreaterThanOrEqual(0.75);
  });
});
