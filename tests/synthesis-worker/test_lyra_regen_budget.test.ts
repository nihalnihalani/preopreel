// tests/synthesis-worker/test_lyra_regen_budget.test.ts
//
// Lyra triggers exactly one regen per beat below threshold — never two.

import { describe, it, expect } from "vitest";
import { runLyraCritique, type LyraContext } from "@/lib/forge/critic";

describe("Lyra regen budget: exactly 1 per beat", () => {
  it("below-threshold first attempt + below-threshold second → 1 regen, accept low-score", async () => {
    let regenCalls = 0;
    let invokeCalls = 0;
    const ctx: LyraContext = {
      invokeLyra: async () => {
        invokeCalls++;
        return {
          beat_id: "test",
          anatomical_fidelity: 0.5,
          procedure_step_compliance: 0.5,
          on_screen_text_violations: 0,
          feedback: "still low",
        };
      },
      regenerate: async () => {
        regenCalls++;
      },
    };
    const r = await runLyraCritique(ctx);
    expect(invokeCalls).toBe(2);
    expect(regenCalls).toBe(1);
    expect(r.regenerated).toBe(true);
    expect(r.accepted_with_low_score).toBe(true);
    expect(r.attempts.length).toBe(2);
  });

  it("never invokes regen more than once even if both attempts fail", async () => {
    let regenCalls = 0;
    const ctx: LyraContext = {
      invokeLyra: async () => ({
        beat_id: "test",
        anatomical_fidelity: 0.30,
        procedure_step_compliance: 0.30,
        on_screen_text_violations: 0,
        feedback: "bad",
      }),
      regenerate: async () => {
        regenCalls++;
      },
    };
    await runLyraCritique(ctx);
    expect(regenCalls).toBe(1);
  });

  it("first-attempt pass → zero regens, no low-score badge", async () => {
    let regenCalls = 0;
    const ctx: LyraContext = {
      invokeLyra: async () => ({
        beat_id: "easy",
        anatomical_fidelity: 0.9,
        procedure_step_compliance: 0.9,
        on_screen_text_violations: 0,
        feedback: "ok",
      }),
      regenerate: async () => {
        regenCalls++;
      },
    };
    const r = await runLyraCritique(ctx);
    expect(regenCalls).toBe(0);
    expect(r.regenerated).toBe(false);
    expect(r.accepted_with_low_score).toBe(false);
  });
});
