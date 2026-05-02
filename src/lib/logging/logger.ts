// src/lib/logging/logger.ts
//
// Singleton structured logger for the PreOpReel pipeline.
// - JSON to stdout in prod; pretty in dev (NODE_ENV !== "production").
// - Level via LOG_LEVEL env (default "info").
// - Always injects `forge_run_id` from AsyncLocalStorage (src/lib/tracing/als.ts)
//   when present, plus `stage` / `persona` from child loggers.
// - Side-channel: appends NDJSON to data/logs/{forge_run_id}.ndjson so
//   post-mortems are trivial. Parent dir is created lazily.
// - Helpers: fnEntry, fnExit, fnError bracket function calls cleanly.
// - Redacts any value whose key ends in _KEY / _SECRET (case-insensitive)
//   and the well-known PreOpReel API-key envs.
//
// This module is deliberately small and side-effect-light. It MUST NOT
// import the rest of the pipeline (no circular imports with replay.ts
// or sse.ts) — only `als.ts`.

import { promises as fsp, mkdirSync, appendFile } from "node:fs";
import { dirname, join } from "node:path";
import pino from "pino";
import type { Logger as PinoLogger } from "pino";
import { getCurrentForgeRunId } from "@/lib/tracing/als";

// ─── Redaction ────────────────────────────────────────────────────────────

/**
 * Pino redaction paths. Wildcards apply to the top level of `meta` and
 * to top-level fields. We also run a runtime redactor over `meta` for
 * arbitrary key suffixes (`_KEY`, `_SECRET`).
 */
const PINO_REDACT_PATHS = [
  "meta.ARK_API_KEY",
  "meta.ARK_API_KEY_2",
  "meta.ARK_API_KEY_3",
  "meta.SEEDANCE_API_KEY",
  "meta.SEEDANCE_API_KEY_2",
  "meta.SEEDANCE_API_KEY_3",
  "meta.SEEDANCE_API_KEY_4",
  "meta.TAVILY_API_KEY",
  "meta.EXA_API_KEY",
  "meta.GEMINI_API_KEY",
  "meta.ZAI_API_KEY",
  "meta.authorization",
  "meta.Authorization",
];

const SECRET_SUFFIXES = ["_KEY", "_SECRET", "_TOKEN", "_PASSWORD"];
const SECRET_KEY_NAMES = new Set([
  "authorization",
  "apikey",
  "api_key",
  "password",
  "secret",
  "token",
]);

const REDACTED = "[REDACTED]";

/** Recursively redact secret-shaped keys from any object. Returns a new value. */
export function redactMeta(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Redact obvious bearer tokens.
    if (/^Bearer\s+/i.test(value)) return REDACTED;
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactMeta(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const lk = k.toLowerCase();
    const upper = k.toUpperCase();
    const isSecret =
      SECRET_KEY_NAMES.has(lk) ||
      SECRET_SUFFIXES.some((s) => upper.endsWith(s));
    out[k] = isSecret ? REDACTED : redactMeta(v, depth + 1);
  }
  return out;
}

// ─── File sink ────────────────────────────────────────────────────────────

function getLogRoot(): string {
  return process.env.LOG_DIR ?? join(process.cwd(), "data", "logs");
}

const ensuredDirs = new Set<string>();
function ensureLogDirSync(dir: string): void {
  if (ensuredDirs.has(dir)) return;
  try {
    mkdirSync(dir, { recursive: true });
    ensuredDirs.add(dir);
  } catch {
    // best-effort; skip file sink if mkdir fails
  }
}

/** Append a single NDJSON line to data/logs/{forge_run_id}.ndjson. Best-effort. */
function appendNdjson(forgeRunId: string, payload: Record<string, unknown>): void {
  if (process.env.LOG_FILE_DISABLED === "1") return;
  const dir = getLogRoot();
  ensureLogDirSync(dir);
  const file = join(dir, `${forgeRunId}.ndjson`);
  const line = `${JSON.stringify(payload)}\n`;
  // Fire-and-forget; do not throw on EIO etc.
  appendFile(file, line, () => {});
}

// ─── Pino base ────────────────────────────────────────────────────────────

const isProd = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? "info";

function makePino(): PinoLogger {
  if (isProd) {
    return pino({
      level,
      redact: { paths: PINO_REDACT_PATHS, censor: REDACTED },
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return pino({
    level,
    redact: { paths: PINO_REDACT_PATHS, censor: REDACTED },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  });
}

const basePino = makePino();

// ─── Public Logger ────────────────────────────────────────────────────────

export type LogEvent =
  | "fn_entry"
  | "fn_exit"
  | "fn_error"
  | "stage_start"
  | "stage_end"
  | "stage_error"
  | "cache_hit"
  | "cache_miss"
  | "key_rotated"
  | "retry"
  | "sse_emit"
  | "info"
  | "warn"
  | "error";

export interface LogContext {
  stage?: string;
  persona?: string;
  fn?: string;
  [k: string]: unknown;
}

export interface LogPayload extends LogContext {
  event: LogEvent;
  msg?: string;
  duration_ms?: number;
  meta?: Record<string, unknown>;
  error?: { message: string; stack?: string; name?: string };
}

const DEFAULT_LEVEL_BY_EVENT: Record<LogEvent, "info" | "warn" | "error" | "debug"> = {
  fn_entry: "debug",
  fn_exit: "debug",
  fn_error: "error",
  stage_start: "info",
  stage_end: "info",
  stage_error: "error",
  cache_hit: "debug",
  cache_miss: "debug",
  key_rotated: "warn",
  retry: "warn",
  sse_emit: "debug",
  info: "info",
  warn: "warn",
  error: "error",
};

function truncate(s: unknown, n = 200): unknown {
  if (typeof s !== "string") return s;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export class Logger {
  private readonly ctx: LogContext;

  constructor(ctx: LogContext = {}) {
    this.ctx = ctx;
  }

  /** Return a new Logger with extra context merged in (stage, persona, fn …). */
  child(extra: LogContext): Logger {
    return new Logger({ ...this.ctx, ...extra });
  }

  private emit(payload: LogPayload): void {
    const forgeRunId = getCurrentForgeRunId();
    const merged: Record<string, unknown> = {
      ts: new Date().toISOString(),
      ...this.ctx,
      ...payload,
    };
    if (forgeRunId) merged.forge_run_id = forgeRunId;
    if (payload.meta) merged.meta = redactMeta(payload.meta);

    const lvl = DEFAULT_LEVEL_BY_EVENT[payload.event] ?? "info";
    // Pino takes (obj, msg).
    basePino[lvl](merged, payload.msg ?? payload.event);

    // File sink — only when we have a forge_run_id to scope by.
    if (forgeRunId) appendNdjson(forgeRunId, merged);
  }

  // ─── Bracketed function calls ──────────────────────────────────────────

  fnEntry(name: string, args?: unknown): void {
    this.emit({
      event: "fn_entry",
      fn: name,
      msg: `→ ${name}`,
      meta:
        args === undefined
          ? undefined
          : { args: truncate(typeof args === "string" ? args : safeJson(args)) },
    });
  }

  fnExit(name: string, durationMs: number, result?: unknown): void {
    this.emit({
      event: "fn_exit",
      fn: name,
      duration_ms: Math.round(durationMs),
      msg: `← ${name} (${Math.round(durationMs)}ms)`,
      meta:
        result === undefined
          ? undefined
          : { result: truncate(typeof result === "string" ? result : safeJson(result)) },
    });
  }

  fnError(name: string, err: unknown, durationMs: number): void {
    const e = err instanceof Error ? err : new Error(String(err));
    this.emit({
      event: "fn_error",
      fn: name,
      duration_ms: Math.round(durationMs),
      msg: `✗ ${name}: ${e.message}`,
      error: { message: e.message, ...(e.stack && { stack: e.stack }), name: e.name },
    });
  }

  // ─── Coarse helpers ────────────────────────────────────────────────────

  stageStart(stage: string, meta?: Record<string, unknown>): void {
    this.emit({ event: "stage_start", stage, msg: `▶ ${stage}`, ...(meta && { meta }) });
  }

  stageEnd(stage: string, durationMs: number, meta?: Record<string, unknown>): void {
    this.emit({
      event: "stage_end",
      stage,
      duration_ms: Math.round(durationMs),
      msg: `■ ${stage} (${Math.round(durationMs)}ms)`,
      ...(meta && { meta }),
    });
  }

  stageError(stage: string, err: unknown, durationMs: number): void {
    const e = err instanceof Error ? err : new Error(String(err));
    this.emit({
      event: "stage_error",
      stage,
      duration_ms: Math.round(durationMs),
      msg: `✗ ${stage}: ${e.message}`,
      error: { message: e.message, ...(e.stack && { stack: e.stack }), name: e.name },
    });
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.emit({ event: "info", msg, ...(meta && { meta }) });
  }
  warn(msg: string, meta?: Record<string, unknown>): void {
    this.emit({ event: "warn", msg, ...(meta && { meta }) });
  }
  error(msg: string, err?: unknown, meta?: Record<string, unknown>): void {
    const e = err instanceof Error ? err : err === undefined ? undefined : new Error(String(err));
    this.emit({
      event: "error",
      msg,
      ...(meta && { meta }),
      ...(e && { error: { message: e.message, ...(e.stack && { stack: e.stack }), name: e.name } }),
    });
  }

  /** Generic event emitter — used by replay.ts / sse.ts. */
  event(payload: LogPayload): void {
    this.emit(payload);
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

export const logger = new Logger();

/** Convenience: child logger pre-bound to a stage. */
export function stageLogger(stage: string, persona?: string): Logger {
  return logger.child({ stage, ...(persona && { persona }) });
}

/** Test helper — flush any in-flight appends. Best-effort. */
export async function flushLogs(): Promise<void> {
  // pino's default sync transport flushes on each line; the file appender
  // is fire-and-forget. We give the event loop one tick to drain.
  await new Promise((r) => setImmediate(r));
}

/** Test helper — read NDJSON for a forge_run_id. */
export async function readNdjson(
  forgeRunId: string,
): Promise<Record<string, unknown>[]> {
  const file = join(getLogRoot(), `${forgeRunId}.ndjson`);
  try {
    const raw = await fsp.readFile(file, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return [];
    throw err;
  }
}

/** Wrap a function so entry/exit/error are logged automatically. */
export async function withLogging<T>(
  log: Logger,
  fnName: string,
  fn: () => Promise<T>,
  args?: unknown,
): Promise<T> {
  const t0 = Date.now();
  log.fnEntry(fnName, args);
  try {
    const result = await fn();
    log.fnExit(fnName, Date.now() - t0);
    return result;
  } catch (err) {
    log.fnError(fnName, err, Date.now() - t0);
    throw err;
  }
}
