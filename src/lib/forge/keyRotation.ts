// src/lib/forge/keyRotation.ts
//
// Multi-API-key rotation across `ARK_API_KEY[_2|_3]` and `SEEDANCE_API_KEY[_2]`.
// Rotation triggers on 429/5xx/401/403. Persists the current head index to
// data/keyrot.json with a file lock + 250ms debounce so worker restarts
// continue from the same index.
//
// Mara F.4: this is dev-loop infra, not a demo signal. It keeps dry-runs
// reliable across the build week. Default `replay` mode means rotation is
// inactive on stage.

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { logger } from "@/lib/logging/logger";

export type Provider = "ark" | "seedance" | "zai";

export type RotationReason = "429" | "5xx" | "401" | "403" | "manual";

interface RotationState {
  keys: string[];
  index: number;
  /** index → unix-ms after which this key may be re-tried. */
  cooldown: Record<number, number>;
}

const COOLDOWN_MS: Record<RotationReason, number> = {
  "429": 60_000,
  "5xx": 30_000,
  "401": 24 * 60 * 60_000,
  "403": 24 * 60 * 60_000,
  manual: 0,
};

// ─── In-memory store ───────────────────────────────────────────────────────

const state = new Map<Provider, RotationState>();

function envKeys(provider: Provider): string[] {
  if (provider === "ark") {
    return [
      process.env.ARK_API_KEY,
      process.env.ARK_API_KEY_2,
      process.env.ARK_API_KEY_3,
    ].filter((k): k is string => typeof k === "string" && k.length > 0);
  }
  if (provider === "zai") {
    // Beta University Discord (5/1): one issued key for the whole hackathon.
    // No _2/_3 slots — but we honor them if a teammate adds backups locally.
    return [
      process.env.ZAI_API_KEY,
      process.env.ZAI_API_KEY_2,
      process.env.ZAI_API_KEY_3,
    ].filter((k): k is string => typeof k === "string" && k.length > 0);
  }
  return [
    process.env.SEEDANCE_API_KEY,
    process.env.SEEDANCE_API_KEY_2,
    process.env.SEEDANCE_API_KEY_3,
    process.env.SEEDANCE_API_KEY_4,
  ].filter((k): k is string => typeof k === "string" && k.length > 0);
}

function ensureProvider(provider: Provider): RotationState {
  let s = state.get(provider);
  if (!s) {
    s = { keys: envKeys(provider), index: 0, cooldown: {} };
    state.set(provider, s);
  }
  return s;
}

// ─── Persistence ───────────────────────────────────────────────────────────

function getPersistPath(): string {
  return process.env.KEYROT_PATH ?? join(process.cwd(), "data", "keyrot.json");
}

let persistTimer: NodeJS.Timeout | null = null;
let persistLock: Promise<void> = Promise.resolve();

function debouncedPersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistLock = persistLock.then(persistNow).catch(() => {});
  }, 250);
}

async function persistNow(): Promise<void> {
  const path = getPersistPath();
  await fs.mkdir(dirname(path), { recursive: true });
  const lockPath = `${path}.lock`;
  // Best-effort lock; if it exists, skip this tick (next one will retry).
  try {
    const fh = await fs.open(lockPath, "wx");
    await fh.close();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST") return;
    throw err;
  }
  try {
    const snapshot: Record<string, { index: number; cooldown: Record<number, number> }> = {};
    for (const [provider, s] of state.entries()) {
      snapshot[provider] = { index: s.index, cooldown: s.cooldown };
    }
    await fs.writeFile(path, JSON.stringify(snapshot, null, 2), "utf8");
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}

/** Load persisted index/cooldown state; called once at worker boot. */
export async function load(): Promise<void> {
  const path = getPersistPath();
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Record<
      string,
      { index?: number; cooldown?: Record<number, number> }
    >;
    for (const provider of ["ark", "seedance", "zai"] as Provider[]) {
      const s = ensureProvider(provider);
      const persisted = parsed[provider];
      if (!persisted) continue;
      if (typeof persisted.index === "number") {
        s.index = s.keys.length > 0 ? persisted.index % s.keys.length : 0;
      }
      if (persisted.cooldown && typeof persisted.cooldown === "object") {
        s.cooldown = persisted.cooldown;
      }
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return;
    // Corrupt JSON → reset rather than crash.
    for (const provider of ["ark", "seedance", "zai"] as Provider[]) {
      ensureProvider(provider).index = 0;
    }
  }
}

/** Flush rotation state to disk now. Worker shutdown hook calls this. */
export async function persist(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  await persistNow();
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Return the current head key. If all keys are in cooldown, returns the
 * least-recently-cooled key (best effort). Throws if no keys configured.
 */
export function next(provider: Provider): string {
  const s = ensureProvider(provider);
  if (s.keys.length === 0) {
    const envName =
      provider === "ark"
        ? "ARK_API_KEY"
        : provider === "zai"
          ? "ZAI_API_KEY"
          : "SEEDANCE_API_KEY";
    throw new Error(
      `keyRotation: no keys configured for provider="${provider}". ` +
        `Set ${envName} (and optional _2/_3).`,
    );
  }
  const now = Date.now();
  for (let i = 0; i < s.keys.length; i++) {
    const idx = (s.index + i) % s.keys.length;
    const cd = s.cooldown[idx];
    if (!cd || cd <= now) {
      s.index = idx;
      const key = s.keys[idx];
      if (key === undefined) {
        // Should never happen given the bounds check above.
        throw new Error(`keyRotation: key index ${idx} undefined`);
      }
      return key;
    }
  }
  // All keys cooling down — return the one closest to ready.
  let bestIdx = 0;
  let bestCd = Number.POSITIVE_INFINITY;
  for (let i = 0; i < s.keys.length; i++) {
    const cd = s.cooldown[i] ?? 0;
    if (cd < bestCd) {
      bestCd = cd;
      bestIdx = i;
    }
  }
  s.index = bestIdx;
  const key = s.keys[bestIdx];
  if (key === undefined) {
    throw new Error("keyRotation: no key available even after fallback");
  }
  return key;
}

/**
 * Mark current head as failed and advance to the next key. Sets a cooldown
 * on the rotated-from key per the table in plan 02 §8.3.
 */
export function rotate(provider: Provider, reason: RotationReason): void {
  const s = ensureProvider(provider);
  if (s.keys.length === 0) return;
  const failedIdx = s.index;
  const cooldownMs = COOLDOWN_MS[reason];
  if (cooldownMs > 0) {
    s.cooldown[failedIdx] = Date.now() + cooldownMs;
  }
  s.index = (s.index + 1) % s.keys.length;
  debouncedPersist();
  logger.event({
    event: "key_rotated",
    fn: "keyRotation.rotate",
    msg: `key rotated provider=${provider} reason=${reason}`,
    meta: {
      provider,
      reason,
      from_index: failedIdx,
      to_index: s.index,
      cooldown_ms: cooldownMs,
    },
  });
}

/** Test helper — force re-read of env keys. */
export function reset(): void {
  state.clear();
}
