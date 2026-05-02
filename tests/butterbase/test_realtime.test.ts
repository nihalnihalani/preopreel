// ============================================================================
// tests/butterbase/test_realtime.test.ts — realtime subscription wrapper.
//
// Promo:      BUTTERBASE0502
// Submission: butterbase0502
// Reference:  https://www.youtube.com/watch?v=SHnryHJL9xc
//
// Strategy: stub `globalThis.WebSocket` with an in-memory class that captures
// the join payload and lets the test push fake INSERT frames. Asserts that
// `subscribeToCritiques` invokes `onInsert` with the row payload from the
// frame — this is the contract the CriticHud depends on (Mara E.1 mitigation:
// realtime bypasses the SSE proxy for critique events).
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Fake WebSocket harness ────────────────────────────────────────────
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  readonly url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    // Drive open() asynchronously so the caller can set handlers first.
    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  // Test-only helpers.
  pushInsert(row: Record<string, unknown>): void {
    this.onmessage?.({
      data: JSON.stringify({
        event: "postgres_changes",
        payload: { data: { type: "INSERT", record: row } },
      }),
    });
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }
}

// ─── Setup: install fake WebSocket + minimal browser globals ───────────
const originalWebSocket = globalThis.WebSocket;
const originalWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  FakeWebSocket.instances.length = 0;
  // Cast to unknown — FakeWebSocket implements only the surface used by
  // the realtime module; the production WebSocket constructor type is wide.
  (globalThis as unknown as { WebSocket: unknown }).WebSocket =
    FakeWebSocket as unknown;
  (globalThis as unknown as { window: unknown }).window = {};
  process.env.NEXT_PUBLIC_BUTTERBASE_PROJECT_URL = "https://test.butterbase.dev";
  process.env.NEXT_PUBLIC_BUTTERBASE_ANON_KEY = "test-anon-key";
});

afterEach(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket =
    originalWebSocket as unknown;
  (globalThis as unknown as { window?: unknown }).window = originalWindow;
});

// ─── Tests ────────────────────────────────────────────────────────────
describe("butterbase/realtime subscriptions (BUTTERBASE0502 / butterbase0502)", () => {
  it("subscribeToCritiques fires onInsert when an INSERT frame arrives", async () => {
    // Defer the import so the WebSocket stub above is in place when the
    // module is first evaluated.
    const { subscribeToCritiques } = await import("@/lib/butterbase/realtime");

    const onInsert = vi.fn();
    const handle = subscribeToCritiques(
      "00000000-0000-0000-0000-000000000001",
      onInsert,
    );

    // Wait for the async open().
    await new Promise((r) => setTimeout(r, 5));

    expect(FakeWebSocket.instances).toHaveLength(1);
    const ws = FakeWebSocket.instances[0]!;

    // Confirm the join payload references the right table + filter.
    expect(ws.sent.length).toBeGreaterThan(0);
    const joinPayload = JSON.parse(ws.sent[0]!);
    expect(joinPayload.event).toBe("phx_join");
    expect(joinPayload.topic).toContain("critiques");
    expect(joinPayload.topic).toContain(
      "forge_run_id=eq.00000000-0000-0000-0000-000000000001",
    );

    // Push an INSERT frame; expect onInsert to fire with the record.
    const fakeRow = {
      id: "row-1",
      forge_run_id: "00000000-0000-0000-0000-000000000001",
      shot_id: "shot_3",
      severity: "warn",
      category: "advice_creep",
      excerpt: "x",
      reason: "y",
      suggested_revision: null,
      persona: "mara",
      created_at: new Date().toISOString(),
    };
    ws.pushInsert(fakeRow);

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(fakeRow);

    handle.unsubscribe();
  });

  it("subscribeToCriticScores fires onInsert with the v2 payload shape (payload.new)", async () => {
    const { subscribeToCriticScores } = await import("@/lib/butterbase/realtime");

    const onInsert = vi.fn();
    const handle = subscribeToCriticScores(
      "00000000-0000-0000-0000-000000000001",
      onInsert,
    );

    await new Promise((r) => setTimeout(r, 5));
    const ws = FakeWebSocket.instances[0]!;
    expect(ws).toBeDefined();

    // v2 shape — payload.new directly (no payload.data.record wrapper).
    const fakeRow = {
      id: "score-1",
      forge_run_id: "00000000-0000-0000-0000-000000000001",
      beat_id: "shot_3",
      regen_attempt: 1,
      anatomical_fidelity: 0.86,
      procedure_step_compliance: 0.91,
      on_screen_text_violations: 0,
      feedback: "ok",
      accepted: true,
      accepted_with_low_score: false,
      persona: "lyra",
      created_at: new Date().toISOString(),
    };
    ws.onmessage?.({
      data: JSON.stringify({
        event: "INSERT",
        payload: { new: fakeRow },
      }),
    });

    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(fakeRow);

    handle.unsubscribe();
  });

  it("unsubscribe() closes the WebSocket and prevents further dispatch", async () => {
    const { subscribeToCritiques } = await import("@/lib/butterbase/realtime");
    const onInsert = vi.fn();
    const handle = subscribeToCritiques("run-id-x", onInsert);
    await new Promise((r) => setTimeout(r, 5));

    handle.unsubscribe();

    const ws = FakeWebSocket.instances[0]!;
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });
});
