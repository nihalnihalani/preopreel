// tests/synthesis-worker/test_keyrot.test.ts
//
// Simulates a 429 on key1 → assert key2 used next.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { next, rotate, reset, type Provider } from "@/lib/forge/keyRotation";

describe("keyRotation: round-robin on 429/5xx/401/403", () => {
  beforeEach(() => {
    reset();
    vi.stubEnv("ARK_API_KEY", "key-A");
    vi.stubEnv("ARK_API_KEY_2", "key-B");
    vi.stubEnv("ARK_API_KEY_3", "key-C");
    vi.stubEnv("SEEDANCE_API_KEY", "sd-A");
    vi.stubEnv("SEEDANCE_API_KEY_2", "sd-B");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    reset();
  });

  it("starts with the first key", () => {
    expect(next("ark")).toBe("key-A");
  });

  it("429 on key1 → key2 used next", () => {
    expect(next("ark")).toBe("key-A");
    rotate("ark", "429");
    expect(next("ark")).toBe("key-B");
  });

  it("5xx rotates with shorter cooldown than 429", () => {
    expect(next("ark")).toBe("key-A");
    rotate("ark", "5xx");
    expect(next("ark")).toBe("key-B");
  });

  it("401 cooldown is 24h — key1 stays disabled across many calls", () => {
    expect(next("ark")).toBe("key-A");
    rotate("ark", "401");
    for (let i = 0; i < 5; i++) {
      expect(next("ark")).toBe("key-B");
    }
  });

  it("rotation wraps around (A → B → C → A)", () => {
    expect(next("ark")).toBe("key-A");
    rotate("ark", "manual");
    expect(next("ark")).toBe("key-B");
    rotate("ark", "manual");
    expect(next("ark")).toBe("key-C");
    rotate("ark", "manual");
    expect(next("ark")).toBe("key-A");
  });

  it("seedance uses its own provider state independent of ark", () => {
    expect(next("seedance" as Provider)).toBe("sd-A");
    rotate("seedance", "429");
    expect(next("seedance" as Provider)).toBe("sd-B");
    // Ark untouched.
    expect(next("ark")).toBe("key-A");
  });

  it("throws if no keys configured for a provider", () => {
    vi.stubEnv("ARK_API_KEY", "");
    vi.stubEnv("ARK_API_KEY_2", "");
    vi.stubEnv("ARK_API_KEY_3", "");
    reset();
    expect(() => next("ark")).toThrow();
  });
});
