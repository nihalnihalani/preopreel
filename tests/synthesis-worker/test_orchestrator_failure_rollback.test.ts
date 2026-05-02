// tests/synthesis-worker/test_orchestrator_failure_rollback.test.ts
//
// Simulate Stage 9 failure mid-pipeline. Assert no partial Butterbase rows
// persist for the failed run. We mock the persist module to count writes
// and the seedance wrapper to throw.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the persist module BEFORE importing the worker ───
const persistedRows: Array<{ table: string; row: Record<string, unknown> }> = [];
let lastStatus: { status: string; extra?: Record<string, unknown> } | null = null;

vi.mock("@worker/persist", () => ({
  persistForgeRunStart: vi.fn(async () => {}),
  persistForgeRunStatus: vi.fn(
    async (_id: string, status: string, extra?: Record<string, unknown>) => {
      lastStatus = { status, ...(extra && { extra }) };
    },
  ),
  persistBeat: vi.fn(async (_id: string, row: Record<string, unknown>) => {
    persistedRows.push({ table: "beats", row });
  }),
  persistAuditCitation: vi.fn(async () => {}),
  persistShotList: vi.fn(async (_id: string, row: Record<string, unknown>) => {
    persistedRows.push({ table: "shot_lists", row });
  }),
  persistAnatomyGraph: vi.fn(async (_id: string, row: Record<string, unknown>) => {
    persistedRows.push({ table: "anatomy_graphs", row });
  }),
  persistCritiquesAsync: vi.fn(),
  persistCriticScoresAsync: vi.fn(),
}));

// Mock SSE so we don't try to talk to Redis.
vi.mock("@worker/sse", () => ({
  emitTrace: vi.fn(async () => {}),
  resetVersion: vi.fn(),
  closeSse: vi.fn(async () => {}),
}));

// Force Stage 9 to throw by mocking the seedance wrapper.
vi.mock("@/lib/seed/seedance", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seed/seedance")>(
    "@/lib/seed/seedance",
  );
  return {
    ...actual,
    seedanceI2V: vi.fn(async () => {
      throw new Error("Stage 9 deliberate failure");
    }),
    seedanceT2VWithRef: vi.fn(async () => {
      throw new Error("Stage 9 deliberate failure");
    }),
  };
});

// Force Stage 7 to return placeholder keyframes so we reach Stage 9.
vi.mock("@/lib/seed/seedream", () => ({
  seedreamKeyframe: vi.fn(async () => ({
    bytes: new Uint8Array([0]),
    meta: {
      width: 1920,
      height: 1080,
      prompt_used: "p",
      cost_estimate_usd: 0,
      url: "https://kf/test.png",
    },
  })),
}));

// Stub arkChat so Stage 3 returns a ShotList; Stage 4 returns empty critiques.
// We dispatch by stage tag in the options object.
vi.mock("@/lib/seed/ark", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arkChat: vi.fn(async (opts: any) => {
    if (typeof opts?.stage === "string" && opts.stage.startsWith("stage_4")) {
      return [];
    }
    return {
      logline: "test",
      beats: [
        {
          beat_id: "b1",
          procedure_step_id: "step_1",
          procedure_step: "incision",
          anatomical_focus: ["femur_head"],
          camera_angle: "close_up",
          narrator_line: "We make an incision.",
          duration_s: 3,
        },
      ],
    };
  }),
  arkVision: vi.fn(),
  arkChatStream: vi.fn(),
}));

import { runSynthesis } from "@worker/index";

describe("orchestrator failure rollback", () => {
  beforeEach(() => {
    persistedRows.length = 0;
    lastStatus = null;
    process.env.DEMO_MODE = "live";
  });

  it("Stage 9 failure marks run as failed and does not persist beats", async () => {
    await expect(
      runSynthesis("00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow();

    // The run status was flipped to "failed" with the error.
    expect(lastStatus).not.toBeNull();
    expect(lastStatus?.status).toBe("failed");
    expect(String(lastStatus?.extra?.error ?? "")).toMatch(/Stage 9/);

    // No Stage-9 beat rows landed (the failure happened before persistBeat).
    const beatRows = persistedRows.filter((r) => r.table === "beats");
    expect(beatRows).toHaveLength(0);
  });
});
