// Vitest global setup — runs before every test file.
//
// Forces DEMO_MODE=replay during test runs (Invariant 3): no live Seed
// traffic from CI. Stubs the network adapter so any test that
// accidentally bypasses replay throws instead of going to production.
import { afterEach, beforeAll, vi } from "vitest";

// ─── Hermetic DEMO_MODE for all tests (Invariant 3) ───────────────
process.env.DEMO_MODE = "replay";

// Defensive: also unset live API keys so any code path that reads
// them sees `undefined` and refuses to construct a client.
//
// Tests that need a specific key set it explicitly via vi.stubEnv.
const KEYS_TO_NULL = [
  "ARK_API_KEY",
  "ARK_API_KEY_2",
  "ARK_API_KEY_3",
  "SEEDANCE_API_KEY",
  "SEEDANCE_API_KEY_2",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "GEMINI_API_KEY",
];
for (const k of KEYS_TO_NULL) {
  if (process.env[k]) delete process.env[k];
}

// ─── Network adapter stub ─────────────────────────────────────────
// Persona tests should round-trip through the replay shim. If anything
// bypasses replay and reaches the real network, this throws so the
// test fails loudly instead of (a) hitting prod or (b) silently
// passing on a cached response that wasn't actually exercised.
//
// Individual tests (e.g. test_tavi_cache.test.ts) override this stub
// to spy on `fetch` directly and assert it is NOT called.
beforeAll(() => {
  if (typeof globalThis.fetch === "function") {
    const originalFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).__originalFetch__ = originalFetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error(
        "Network call attempted in test (Invariant 3). " +
          "All outbound calls must route through @/lib/forge/replay.withReplay() " +
          "and use a fixture in DEMO_MODE=replay.",
      );
    }) as unknown as typeof fetch;
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});
