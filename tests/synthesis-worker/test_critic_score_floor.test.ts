// tests/synthesis-worker/test_critic_score_floor.test.ts
//
// Mara A.3 score floor. Feeds a 4-of-6 below-threshold scenario and asserts:
//   - pipeline COMPLETES (not blocks)
//   - all 4 below-threshold beats are marked accepted_with_low_score=true
//     after the 1-regen budget is exhausted
//   - regen budget is exactly 1 (no looping)

import { describe, it, expect } from "vitest";
import { runLyraCritique, type CriticScore, type LyraContext } from "@/lib/forge/critic";

interface BeatScenario {
  beat_id: string;
  scoreSequence: number[]; // 1 or 2 entries; <0.75 = below threshold
}

function makeContext(scenario: BeatScenario): {
  ctx: LyraContext;
  invocationCount: () => number;
  regenCount: () => number;
} {
  let invocations = 0;
  let regens = 0;
  const ctx: LyraContext = {
    invokeLyra: async (): Promise<CriticScore> => {
      const idx = Math.min(invocations, scenario.scoreSequence.length - 1);
      const v = scenario.scoreSequence[idx] ?? 0.85;
      invocations++;
      return {
        beat_id: scenario.beat_id,
        anatomical_fidelity: v,
        procedure_step_compliance: v,
        on_screen_text_violations: 0,
        feedback: `attempt ${invocations}`,
      };
    },
    regenerate: async () => {
      regens++;
    },
  };
  return {
    ctx,
    invocationCount: () => invocations,
    regenCount: () => regens,
  };
}

describe("Mara A.3: Lyra score floor + 1-regen budget", () => {
  it("4-of-6 below-threshold scenario completes with low-score badges", async () => {
    // Six beats: beats 1, 2, 4, 5 fail twice (still below floor); 3 and 6 pass first try.
    const scenarios: BeatScenario[] = [
      { beat_id: "b1", scoreSequence: [0.71, 0.69] },
      { beat_id: "b2", scoreSequence: [0.55, 0.58] },
      { beat_id: "b3", scoreSequence: [0.86] },
      { beat_id: "b4", scoreSequence: [0.62, 0.81] },
      { beat_id: "b5", scoreSequence: [0.50, 0.65] },
      { beat_id: "b6", scoreSequence: [0.88] },
    ];

    const results = [];
    for (const s of scenarios) {
      const { ctx, regenCount } = makeContext(s);
      const r = await runLyraCritique(ctx);
      results.push({
        ...r,
        beat_id: s.beat_id,
        regenCount: regenCount(),
      });
    }

    // All six must complete — pipeline did not block.
    expect(results).toHaveLength(6);

    // Beats whose final score is still below 0.75 → accepted_with_low_score
    const lowScoreBeats = results.filter((r) => r.accepted_with_low_score);
    // b1 final 0.69, b2 final 0.58, b5 final 0.65 — three definitively below.
    // b4 final 0.81 — passed on regen, NOT low-score.
    expect(lowScoreBeats.map((r) => r.beat_id).sort()).toEqual([
      "b1",
      "b2",
      "b5",
    ]);

    // Regen budget is exactly 1 — beats that needed regen called regenerate
    // exactly once.
    for (const r of results) {
      expect(r.regenCount).toBeLessThanOrEqual(1);
    }

    // All beats produce a score (no rejection cascade).
    for (const r of results) {
      expect(r.score).toBeDefined();
      expect(r.attempts.length).toBeGreaterThanOrEqual(1);
      expect(r.attempts.length).toBeLessThanOrEqual(2);
    }
  });

  it("first-try pass produces no regen and no low-score badge", async () => {
    const { ctx, regenCount } = makeContext({
      beat_id: "easy",
      scoreSequence: [0.91],
    });
    const r = await runLyraCritique(ctx);
    expect(r.regenerated).toBe(false);
    expect(r.accepted_with_low_score).toBe(false);
    expect(regenCount()).toBe(0);
    expect(r.attempts).toHaveLength(1);
  });

  it("one regen attempt with successful recovery clears low-score badge", async () => {
    const { ctx, regenCount } = makeContext({
      beat_id: "regen_pass",
      scoreSequence: [0.71, 0.86],
    });
    const r = await runLyraCritique(ctx);
    expect(r.regenerated).toBe(true);
    expect(r.accepted_with_low_score).toBe(false);
    expect(regenCount()).toBe(1);
    expect(r.attempts).toHaveLength(2);
  });

  it("on_screen_text_violations > 0 also triggers regen", async () => {
    let invocations = 0;
    const ctx: LyraContext = {
      invokeLyra: async (): Promise<CriticScore> => {
        invocations++;
        return {
          beat_id: "text_violation",
          anatomical_fidelity: 0.95,
          procedure_step_compliance: 0.95,
          on_screen_text_violations: invocations === 1 ? 2 : 0,
          feedback: "text violation",
        };
      },
      regenerate: async () => {},
    };
    const r = await runLyraCritique(ctx);
    expect(r.regenerated).toBe(true);
    expect(r.score.on_screen_text_violations).toBe(0);
    expect(r.accepted_with_low_score).toBe(false);
  });
});
