// src/lib/forge/replay.ts
//
// ★ Invariant 3 chokepoint. Every outbound Seed/Tavi/Exa/Gem/Butterbase call
// goes through `withReplay`. Modes:
//   - live   → call live(), persist response, return
//   - replay → load cached fixture or throw MissingFixtureError
//   - hybrid → race live() vs setTimeout(HYBRID_LIVE_BUDGET_S * 1000),
//              fall back to cached on timeout / quota / 5xx
//
// Cache layout: data/replay/{forge_run_id}/{stage}/{key}.{ext}
// - codec=json → {key}.json (utf-8)
// - codec=mp4  → {key}.mp4 + {key}.json sidecar
// - codec=png  → {key}.png + {key}.json sidecar
// - codec=wav  → {key}.wav + {key}.json sidecar
//
// forge_run_id resolution: explicit opts.forgeRunId > AsyncLocalStorage > throw.
//
// Mara C.4 mitigation: this file is the canonical chokepoint. The ts-morph
// wide scan in tests/synthesis-worker/test_replay_branch.test.ts asserts every
// network-touching exported async fn under src/lib/{seed,forge/ingestors,butterbase}/
// references `withReplay(`.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { getCurrentForgeRunId } from "@/lib/tracing/als";
import { logger } from "@/lib/logging/logger";
import type { DemoMode } from "@/lib/forge/types";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ReplayCodec = "json" | "mp4" | "png" | "wav";

export interface WithReplayOpts<T> {
  /** Stage tag — e.g. "stage_9_seedance". Used as a directory under the run id. */
  stage: string;
  /** Deterministic cache key — typically a sha256 of canonical inputs. */
  key: string;
  /** Codec governs on-disk format and deserialization. */
  codec: ReplayCodec;
  /** Live network call. Only invoked in live + hybrid modes. */
  live: () => Promise<T>;
  /** Optional override; defaults to the AsyncLocalStorage forge_run_id. */
  forgeRunId?: string;
}

export class MissingFixtureError extends Error {
  constructor(
    public readonly stage: string,
    public readonly key: string,
    public readonly path: string,
  ) {
    super(
      `Missing replay fixture for stage=${stage} key=${key} at ${path}. ` +
        `In replay mode every outbound call must be pre-warmed via prewarm_demo.py.`,
    );
    this.name = "MissingFixtureError";
  }
}

export class ReplayContextError extends Error {
  constructor(stage: string) {
    super(
      `withReplay(${stage}) needs a forge_run_id. Provide opts.forgeRunId or ` +
        `wrap the call in withForgeRunContext(id, fn).`,
    );
    this.name = "ReplayContextError";
  }
}

class HybridTimeoutError extends Error {
  constructor() {
    super("hybrid live budget exceeded");
    this.name = "HybridTimeoutError";
  }
}

// ─── Mode + budget resolution ──────────────────────────────────────────────

function getDemoMode(): DemoMode {
  const raw = (process.env.DEMO_MODE ?? "replay").toLowerCase();
  if (raw === "live" || raw === "replay" || raw === "hybrid") return raw;
  return "replay";
}

function getHybridBudgetMs(): number {
  const raw = process.env.HYBRID_LIVE_BUDGET_S ?? "8";
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 8000;
}

function getReplayRoot(): string {
  return process.env.REPLAY_ROOT ?? join(process.cwd(), "data", "replay");
}

// ─── Path helpers ──────────────────────────────────────────────────────────

const codecExt: Record<ReplayCodec, string> = {
  json: "json",
  mp4: "mp4",
  png: "png",
  wav: "wav",
};

function fixturePaths(
  forgeRunId: string,
  stage: string,
  key: string,
  codec: ReplayCodec,
): { primary: string; sidecar: string | null } {
  const dir = join(getReplayRoot(), forgeRunId, stage);
  const primary = join(dir, `${key}.${codecExt[codec]}`);
  const sidecar = codec === "json" ? null : join(dir, `${key}.json`);
  return { primary, sidecar };
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true });
}

// ─── Hash helper for callers ───────────────────────────────────────────────

const VOLATILE_KEYS = new Set([
  "request_id",
  "id",
  "timestamp",
  "ts",
  "created_at",
  "updated_at",
]);

const VOLATILE_QS_RE = /[?&](X-Amz-Signature|X-Amz-Date|Expires|Signature)=/i;

function canonicalize(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return input.replace(VOLATILE_QS_RE, "");
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(canonicalize);
  const out: Record<string, unknown> = {};
  const obj = input as Record<string, unknown>;
  for (const k of Object.keys(obj).sort()) {
    if (VOLATILE_KEYS.has(k)) continue;
    out[k] = canonicalize(obj[k]);
  }
  return out;
}

/**
 * Stable sha256 over canonical-JSON. Strips volatile fields (request_id,
 * timestamps) and signed-URL query params so the same beat hashes the same
 * across runs.
 */
export function hashCacheKey(input: unknown): string {
  const json = JSON.stringify(canonicalize(input));
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

// ─── Codec serialization ───────────────────────────────────────────────────

async function persist<T>(
  primary: string,
  sidecar: string | null,
  codec: ReplayCodec,
  value: T,
): Promise<void> {
  await ensureDir(primary);
  if (codec === "json") {
    await fs.writeFile(primary, JSON.stringify(value, null, 2), "utf8");
    return;
  }
  // Binary codecs expect { bytes: Buffer | Uint8Array, meta?: object } shape OR
  // a raw Buffer/Uint8Array. We accept both.
  const v = value as
    | { bytes: Buffer | Uint8Array; meta?: Record<string, unknown> }
    | Buffer
    | Uint8Array;
  let bytes: Buffer | Uint8Array;
  let meta: Record<string, unknown> = {};
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    bytes = v;
  } else if (v && typeof v === "object" && "bytes" in v) {
    bytes = v.bytes;
    meta = v.meta ?? {};
  } else {
    throw new Error(
      `replay.persist: codec ${codec} expects Buffer/Uint8Array or {bytes, meta}; got ${typeof v}`,
    );
  }
  await fs.writeFile(primary, bytes);
  if (sidecar) {
    await fs.writeFile(
      sidecar,
      JSON.stringify({ codec, byteLength: bytes.byteLength, meta }, null, 2),
      "utf8",
    );
  }
}

async function load<T>(
  primary: string,
  sidecar: string | null,
  codec: ReplayCodec,
  stage: string,
  key: string,
): Promise<T> {
  try {
    if (codec === "json") {
      const raw = await fs.readFile(primary, "utf8");
      return JSON.parse(raw) as T;
    }
    const bytes = await fs.readFile(primary);
    let meta: Record<string, unknown> = {};
    if (sidecar) {
      try {
        const sc = await fs.readFile(sidecar, "utf8");
        const parsed = JSON.parse(sc) as { meta?: Record<string, unknown> };
        meta = parsed.meta ?? {};
      } catch {
        // sidecar optional
      }
    }
    return { bytes, meta } as unknown as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new MissingFixtureError(stage, key, primary);
    }
    throw err;
  }
}

// ─── Hybrid helpers ────────────────────────────────────────────────────────

interface CancelablePromise<T> extends Promise<T> {
  cancel(): void;
}

function timeoutPromise<T>(ms: number): CancelablePromise<T> {
  let to: NodeJS.Timeout | undefined;
  const p = new Promise<T>((_resolve, reject) => {
    to = setTimeout(() => reject(new HybridTimeoutError()), ms);
  }) as CancelablePromise<T>;
  p.cancel = () => {
    if (to) clearTimeout(to);
  };
  // Swallow unhandled-rejection if cancel runs before timeout fires.
  p.catch(() => {});
  return p;
}

function isFallbackEligible(err: unknown): boolean {
  if (err instanceof HybridTimeoutError) return true;
  if (err && typeof err === "object" && "status" in err) {
    const s = Number((err as { status: unknown }).status);
    if (s === 429 || s === 401 || s === 403 || (s >= 500 && s < 600))
      return true;
  }
  if (err && typeof err === "object" && "name" in err) {
    const n = String((err as { name: unknown }).name);
    if (n === "AbortError" || n === "FetchError") return true;
  }
  return false;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Mode-routed Seed/network call wrapper. Every outbound call in this repo
 * must funnel through this function. See file header for invariant scope.
 */
export async function withReplay<T>(opts: WithReplayOpts<T>): Promise<T> {
  const forgeRunId = opts.forgeRunId ?? getCurrentForgeRunId();
  if (!forgeRunId) throw new ReplayContextError(opts.stage);

  const mode = getDemoMode();
  const { primary, sidecar } = fixturePaths(
    forgeRunId,
    opts.stage,
    opts.key,
    opts.codec,
  );

  const log = logger.child({ stage: opts.stage, fn: "withReplay" });
  const t0 = Date.now();
  log.event({
    event: "fn_entry",
    stage: opts.stage,
    fn: "withReplay",
    msg: `withReplay ${opts.stage} mode=${mode}`,
    meta: { key: opts.key, codec: opts.codec, mode },
  });

  if (mode === "replay") {
    try {
      const cached = await load<T>(
        primary,
        sidecar,
        opts.codec,
        opts.stage,
        opts.key,
      );
      log.event({
        event: "cache_hit",
        stage: opts.stage,
        fn: "withReplay",
        duration_ms: Date.now() - t0,
        meta: { key: opts.key, codec: opts.codec, path: primary },
      });
      return cached;
    } catch (err) {
      log.event({
        event: "cache_miss",
        stage: opts.stage,
        fn: "withReplay",
        duration_ms: Date.now() - t0,
        meta: { key: opts.key, codec: opts.codec, path: primary },
      });
      log.fnError("withReplay", err, Date.now() - t0);
      throw err;
    }
  }

  if (mode === "live") {
    try {
      const result = await opts.live();
      await persist(primary, sidecar, opts.codec, result);
      log.fnExit("withReplay", Date.now() - t0);
      return result;
    } catch (err) {
      log.fnError("withReplay", err, Date.now() - t0);
      throw err;
    }
  }

  // hybrid: race live vs timeout, fall back to cached on timeout/quota/5xx
  const budgetMs = getHybridBudgetMs();
  const timer = timeoutPromise<T>(budgetMs);
  try {
    const result = await Promise.race([opts.live(), timer]);
    timer.cancel();
    await persist(primary, sidecar, opts.codec, result);
    log.fnExit("withReplay", Date.now() - t0);
    return result;
  } catch (err) {
    timer.cancel();
    if (isFallbackEligible(err)) {
      log.event({
        event: "retry",
        stage: opts.stage,
        fn: "withReplay",
        msg: "hybrid live failed; falling back to replay",
        meta: { reason: (err as Error)?.name ?? "unknown" },
      });
      try {
        const cached = await load<T>(
          primary,
          sidecar,
          opts.codec,
          opts.stage,
          opts.key,
        );
        log.event({
          event: "cache_hit",
          stage: opts.stage,
          fn: "withReplay",
          duration_ms: Date.now() - t0,
          meta: { key: opts.key, codec: opts.codec, fallback: true },
        });
        return cached;
      } catch (cacheErr) {
        log.fnError("withReplay", cacheErr, Date.now() - t0);
        if (cacheErr instanceof MissingFixtureError) throw err;
        throw cacheErr;
      }
    }
    log.fnError("withReplay", err, Date.now() - t0);
    throw err;
  }
}
