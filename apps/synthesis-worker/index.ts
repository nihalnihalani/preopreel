// apps/synthesis-worker/index.ts
//
// 12-stage orchestrator entry point. Loads the queue, registers the handler,
// and wires graceful shutdown. Every job runs inside a forgeRunId
// AsyncLocalStorage scope so Seed wrappers + replay.ts resolve the id
// without explicit threading (plan 02 §7.4).

import { withForgeRunContext } from "@/lib/tracing/als";
import { load as loadKeyRot, persist as persistKeyRot } from "@/lib/forge/keyRotation";
import { logger } from "@/lib/logging/logger";
import { closeSse, emitTrace } from "./sse";
import { enqueue, shutdown as shutdownQueue, worker } from "./queue";
import { persistForgeRunStatus } from "./persist";

import { runStage1 } from "./stages/01-intake";
import { runStage2 } from "./stages/02-research";
import { runStage3 } from "./stages/03-director";
import { runStage4 } from "./stages/04-devils-advocate";
import { runStage5 } from "./stages/05-anatomy-bible";
import { runStage6 } from "./stages/06-cinema-lens";
import { runStage7 } from "./stages/07-storyboard";
import { runStage8 } from "./stages/08-prompt-compiler";
import { runStage9 } from "./stages/09-seedance";
import { runStage10 } from "./stages/10-vision-critic";
import { runStage11 } from "./stages/11-narration";
import { runStage12 } from "./stages/12-composition";

// ─── Pipeline ──────────────────────────────────────────────────────────────

/** Run a single stage with structured logging bracketing it. */
async function runStageLogged<T>(
  stageName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  logger.stageStart(stageName);
  try {
    const result = await fn();
    logger.stageEnd(stageName, Date.now() - t0);
    return result;
  } catch (err) {
    logger.stageError(stageName, err, Date.now() - t0);
    throw err;
  }
}

async function runPipeline(forgeRunId: string): Promise<void> {
  const pipelineT0 = Date.now();
  logger.event({
    event: "stage_start",
    stage: "pipeline",
    msg: "pipeline_start",
    meta: { forge_run_id: forgeRunId },
  });
  await emitTrace({
    forgeRunId,
    stage: "pipeline_start",
    message: "synthesis starting",
  });
  try {
    const intake = await runStageLogged("01-intake", () =>
      runStage1({ forgeRunId }),
    );
    const research = await runStageLogged("02-research", () =>
      runStage2({ forgeRunId, intake }),
    );
    const shotListRaw = await runStageLogged("03-director", () =>
      runStage3({ forgeRunId, intake, research }),
    );
    const critiqued = await runStageLogged("04-devils-advocate", () =>
      runStage4({ forgeRunId, shotList: shotListRaw }),
    );
    const bible = await runStageLogged("05-anatomy-bible", () =>
      runStage5({
        forgeRunId,
        shotList: critiqued.shotList,
        research,
      }),
    );
    const lensed = await runStageLogged("06-cinema-lens", () =>
      runStage6({ forgeRunId, shotList: critiqued.shotList }),
    );
    const keyframes = await runStageLogged("07-storyboard", () =>
      runStage7({ forgeRunId, lensed, bible, research }),
    );
    const payloads = await runStageLogged("08-prompt-compiler", () =>
      runStage8({ forgeRunId, lensed, keyframes, bible }),
    );
    const beats = await runStageLogged("09-seedance", () =>
      runStage9({ forgeRunId, payloads }),
    );
    const accepted = await runStageLogged("10-vision-critic", () =>
      runStage10({ forgeRunId, beats, lensed, bible }),
    );
    const audio = await runStageLogged("11-narration", () =>
      runStage11({ forgeRunId, accepted }),
    );
    await runStageLogged("12-composition", () =>
      runStage12({ forgeRunId, accepted, audio }),
    );

    await persistForgeRunStatus(forgeRunId, "done");
    logger.stageEnd("pipeline", Date.now() - pipelineT0, {
      forge_run_id: forgeRunId,
    });
    await emitTrace({
      forgeRunId,
      stage: "pipeline_end",
      message: "synthesis complete",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.stageError("pipeline", err, Date.now() - pipelineT0);
    await persistForgeRunStatus(forgeRunId, "failed", { error: msg });
    await emitTrace({
      forgeRunId,
      stage: "pipeline_failed",
      message: msg,
    });
    throw err;
  }
}

async function jobHandler(forgeRunId: string): Promise<void> {
  return withForgeRunContext(forgeRunId, () => runPipeline(forgeRunId));
}

// ─── Public API for callers (API route + tests) ───────────────────────────

export async function runSynthesis(forgeRunId: string): Promise<void> {
  return jobHandler(forgeRunId);
}

export async function enqueueSynthesis(forgeRunId: string): Promise<void> {
  return enqueue(forgeRunId);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────

let bootstrapped = false;
export function bootstrapWorker(): void {
  if (bootstrapped) return;
  bootstrapped = true;
  worker(jobHandler);
  void loadKeyRot();
  process.on("SIGTERM", () => {
    void gracefulShutdown();
  });
  process.on("SIGINT", () => {
    void gracefulShutdown();
  });
}

async function gracefulShutdown(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[worker] graceful shutdown");
  await shutdownQueue(30_000);
  await persistKeyRot();
  await closeSse();
}

// Bootstrap when run directly (`tsx apps/synthesis-worker/index.ts`).
const isDirect =
  typeof process !== "undefined" &&
  process.argv.length > 1 &&
  process.argv[1] !== undefined &&
  process.argv[1].includes("synthesis-worker");
if (isDirect) bootstrapWorker();
