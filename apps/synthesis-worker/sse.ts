// apps/synthesis-worker/sse.ts
//
// Versioned SSE trace event emitter. Every event has a monotonically
// increasing `version` per forge_run so the HUD can ignore out-of-order
// arrivals (Mara A.4 mitigation).
//
// Events are written to Redis stream `pre:trace:{forge_run_id}`. The
// /api/forge/{id}/stream route consumes the stream and pipes to EventSource.

import Redis from "ioredis";
import { logger } from "@/lib/logging/logger";

export interface TraceEvent {
  forge_run_id: string;
  stage: string;
  message: string;
  ts: number;
  duration_ms?: number;
  persona?: "atlas" | "tavi" | "exa" | "gem" | "lyra" | "mara";
  /** Monotonic per-forge_run sequence — HUD ignores out-of-order. */
  version: number;
  data?: Record<string, unknown>;
}

let redis: Redis | null = null;
const versionByRun = new Map<string, number>();

function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
  }
  return redis;
}

function nextVersion(forgeRunId: string): number {
  const v = (versionByRun.get(forgeRunId) ?? 0) + 1;
  versionByRun.set(forgeRunId, v);
  return v;
}

export interface EmitOpts {
  forgeRunId: string;
  stage: string;
  message: string;
  duration_ms?: number;
  persona?: TraceEvent["persona"];
  data?: Record<string, unknown>;
}

/**
 * Emit a versioned trace event. Best-effort — Redis errors are swallowed
 * so the worker doesn't crash on a transient connection blip.
 */
export async function emitTrace(opts: EmitOpts): Promise<void> {
  const event: TraceEvent = {
    forge_run_id: opts.forgeRunId,
    stage: opts.stage,
    message: opts.message,
    ts: Date.now(),
    version: nextVersion(opts.forgeRunId),
    ...(opts.duration_ms !== undefined && { duration_ms: opts.duration_ms }),
    ...(opts.persona !== undefined && { persona: opts.persona }),
    ...(opts.data !== undefined && { data: opts.data }),
  };
  // Mirror to the structured logger so SSE + log file stay aligned.
  logger.event({
    event: "sse_emit",
    stage: opts.stage,
    ...(opts.persona && { persona: opts.persona }),
    msg: opts.message,
    ...(opts.duration_ms !== undefined && { duration_ms: opts.duration_ms }),
    meta: { version: event.version, ...(opts.data && { data: opts.data }) },
  });
  try {
    const stream = `pre:trace:${opts.forgeRunId}`;
    await getRedis().xadd(stream, "*", "event", JSON.stringify(event));
    await getRedis().expire(stream, 3600);
  } catch (err) {
    logger.warn("sse trace emit failed (best-effort)", { err: String(err) });
  }
}

/** Test/utility helper — clear the per-run version counter. */
export function resetVersion(forgeRunId: string): void {
  versionByRun.delete(forgeRunId);
}

/** Drain the Redis client on shutdown. */
export async function closeSse(): Promise<void> {
  if (redis) {
    try {
      await redis.quit();
    } catch {
      /* ignore */
    }
    redis = null;
  }
}
