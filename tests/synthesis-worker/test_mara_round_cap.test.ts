// tests/synthesis-worker/test_mara_round_cap.test.ts
//
// Mara is invoked at most once per ShotList — no infinite loop. The cap is
// 2 invocations total: pass 1 (initial critique), pass 2 (post-revision
// confirmation). Pass 3 is forbidden — remaining blocks ship as warnings.

import { describe, it, expect } from "vitest";
import {
  runMaraCritique,
  type CriticCritique,
  type CriticShotList,
  type MaraContext,
} from "@/lib/forge/critic";

const sampleShotList: CriticShotList = {
  beats: [
    { shot_id: "b1", narrator_line: "We will begin." },
    { shot_id: "b2", narrator_line: "We will continue." },
  ],
};

describe("Mara round cap: at most one redo round per ShotList", () => {
  it("zero blocks → 1 invocation, no revisions", async () => {
    let invocations = 0;
    const ctx: MaraContext = {
      invokeMara: async () => {
        invocations++;
        return [];
      },
    };
    const r = await runMaraCritique(sampleShotList, ctx);
    expect(invocations).toBe(1);
    expect(r.rounds).toBe(1);
    expect(r.revisedShotList.beats).toEqual(sampleShotList.beats);
  });

  it("blocks with suggested_revision → 2 invocations max, in-place swap applied", async () => {
    let invocations = 0;
    const blockingCritique: CriticCritique[] = [
      {
        shot_id: "b1",
        severity: "block",
        category: "advice_creep",
        excerpt: "we will begin",
        reason: "imperative directed at patient",
        suggested_revision: "The procedure begins.",
      },
    ];
    const ctx: MaraContext = {
      invokeMara: async () => {
        invocations++;
        // Round 1 returns a block; round 2 returns clean.
        return invocations === 1 ? blockingCritique : [];
      },
    };
    const r = await runMaraCritique(sampleShotList, ctx);
    expect(invocations).toBe(2);
    expect(r.rounds).toBe(2);
    expect(r.revisedShotList.beats[0]?.narrator_line).toBe("The procedure begins.");
  });

  it("persistent block in round 2 is surfaced, not looped", async () => {
    let invocations = 0;
    const blockingCritique: CriticCritique[] = [
      {
        shot_id: "b1",
        severity: "block",
        category: "advice_creep",
        excerpt: "we will begin",
        reason: "still bad",
        suggested_revision: "Take 1.",
      },
    ];
    const stillBlocking: CriticCritique[] = [
      {
        shot_id: "b1",
        severity: "block",
        category: "advice_creep",
        excerpt: "Take 1.",
        reason: "still imperative",
      },
    ];
    const ctx: MaraContext = {
      invokeMara: async () => {
        invocations++;
        return invocations === 1 ? blockingCritique : stillBlocking;
      },
    };
    const r = await runMaraCritique(sampleShotList, ctx);
    // Hard cap: exactly 2 invocations, never 3.
    expect(invocations).toBe(2);
    expect(r.rounds).toBe(2);
    // Both rounds' critiques surfaced (judge sees the trace).
    expect(r.critiques.length).toBe(2);
  });
});
