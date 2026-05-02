// tests/logging/test_logger.test.ts
//
// Smoke tests for the structured logger. Validates:
//   1) child loggers inherit forge_run_id from AsyncLocalStorage,
//   2) fnEntry / fnExit / fnError produce the expected JSON shape,
//   3) redactMeta strips secrets (ARK_API_KEY, *_SECRET, Authorization).
//
// We don't snapshot pino's pretty output — instead we read the per-run
// NDJSON file the logger writes side-by-side. That's the file ops folks
// will actually use during a post-mortem.

import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withForgeRunContext } from "@/lib/tracing/als";

// Force a tmp log dir for tests so we don't litter data/logs.
const tmpLogDir = mkdtempSync(join(tmpdir(), "preopreel-logs-"));
process.env.LOG_DIR = tmpLogDir;
process.env.LOG_LEVEL = "debug";
// Force JSON output (skip pino-pretty transport) so the test process
// doesn't need to spawn the worker thread. NODE_ENV is read-only in
// Node's TS lib so we go through `process.env` as a writable record.
(process.env as Record<string, string>).NODE_ENV = "production";

// Import AFTER env mutation so the logger picks up LOG_DIR / LOG_LEVEL.
const loggerModule = await import("@/lib/logging/logger");
const { logger, redactMeta, readNdjson, flushLogs, withLogging } =
  loggerModule;

async function readRunLines(
  forgeRunId: string,
): Promise<Record<string, unknown>[]> {
  await flushLogs();
  // Tiny extra delay because appendFile is fire-and-forget.
  await new Promise((r) => setTimeout(r, 30));
  return readNdjson(forgeRunId);
}

beforeAll(async () => {
  await fs.mkdir(tmpLogDir, { recursive: true });
});

afterAll(async () => {
  // Best-effort cleanup; fine if files already gone.
  try {
    await fs.rm(tmpLogDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("logger — ALS forge_run_id propagation", () => {
  it("child logger inherits forge_run_id from withForgeRunContext", async () => {
    const id = "test-run-als-1";
    await withForgeRunContext(id, async () => {
      const child = logger.child({ stage: "smoke", persona: "atlas" });
      child.info("ping");
    });
    const lines = await readRunLines(id);
    expect(lines.length).toBeGreaterThan(0);
    const last = lines[lines.length - 1] as Record<string, unknown>;
    expect(last.forge_run_id).toBe(id);
    expect(last.stage).toBe("smoke");
    expect(last.persona).toBe("atlas");
    expect(last.event).toBe("info");
  });
});

describe("logger — fnEntry/fnExit/fnError shape", () => {
  it("emits fn_entry then fn_exit with duration_ms on success", async () => {
    const id = "test-run-fn-success";
    await withForgeRunContext(id, async () => {
      await withLogging(logger.child({ stage: "x" }), "doThing", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return "ok";
      });
    });
    const lines = await readRunLines(id);
    const events = lines.map((l) => l.event);
    expect(events).toContain("fn_entry");
    expect(events).toContain("fn_exit");
    const exit = lines.find((l) => l.event === "fn_exit") as Record<
      string,
      unknown
    >;
    expect(exit.fn).toBe("doThing");
    expect(typeof exit.duration_ms).toBe("number");
    expect(exit.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("emits fn_error with error.message on throw", async () => {
    const id = "test-run-fn-error";
    await expect(
      withForgeRunContext(id, async () => {
        await withLogging(
          logger.child({ stage: "x" }),
          "doFail",
          async () => {
            throw new Error("boom");
          },
        );
      }),
    ).rejects.toThrow("boom");

    const lines = await readRunLines(id);
    const errLine = lines.find((l) => l.event === "fn_error") as Record<
      string,
      unknown
    >;
    expect(errLine).toBeDefined();
    expect((errLine.error as { message: string }).message).toBe("boom");
    expect(typeof errLine.duration_ms).toBe("number");
  });
});

describe("logger — redaction", () => {
  it("redactMeta strips ARK_API_KEY value", () => {
    const out = redactMeta({
      ARK_API_KEY: "sk-secret-xyz",
      ok: "visible",
    }) as Record<string, unknown>;
    expect(out.ARK_API_KEY).toBe("[REDACTED]");
    expect(out.ok).toBe("visible");
  });

  it("redactMeta strips any *_KEY / *_SECRET / *_TOKEN suffix", () => {
    const out = redactMeta({
      OPENAI_KEY: "abc",
      DB_SECRET: "shhh",
      MY_TOKEN: "t",
      AUTHORIZATION: "Bearer foo",
      label: "kept",
    }) as Record<string, unknown>;
    expect(out.OPENAI_KEY).toBe("[REDACTED]");
    expect(out.DB_SECRET).toBe("[REDACTED]");
    expect(out.MY_TOKEN).toBe("[REDACTED]");
    expect(out.AUTHORIZATION).toBe("[REDACTED]");
    expect(out.label).toBe("kept");
  });

  it("redactMeta walks nested objects", () => {
    const out = redactMeta({
      outer: { ARK_API_KEY: "x", inner: { TAVILY_API_KEY: "y", n: 1 } },
    }) as { outer: { ARK_API_KEY: string; inner: { TAVILY_API_KEY: string; n: number } } };
    expect(out.outer.ARK_API_KEY).toBe("[REDACTED]");
    expect(out.outer.inner.TAVILY_API_KEY).toBe("[REDACTED]");
    expect(out.outer.inner.n).toBe(1);
  });
});
