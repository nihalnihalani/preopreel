// apps/synthesis-worker/queue.ts
//
// Minimal in-memory queue. Processes jobs serially (single-process, single-
// concurrency). MAX_CONCURRENT_LANES is NOT the queue's concurrency — it
// controls the inner Seedance fan-out within Stage 9 (handled by p-limit
// inside src/lib/seed/seedance.ts).
//
// Behind QUEUE_BACKEND=bullmq the file dynamic-imports BullMQ — but for the
// hackathon demo path the in-memory default is sufficient. The BullMQ branch
// is a stub for forward-compat.

export type JobHandler = (forgeRunId: string) => Promise<void>;

interface QueueState {
  handler: JobHandler | null;
  running: Promise<void>;
  queued: string[];
  shuttingDown: boolean;
}

const state: QueueState = {
  handler: null,
  running: Promise.resolve(),
  queued: [],
  shuttingDown: false,
};

/** Enqueue a synthesis job. Returns immediately; processing is async. */
export async function enqueue(forgeRunId: string): Promise<void> {
  if (state.shuttingDown) {
    throw new Error("queue.enqueue: queue is shutting down");
  }
  if (process.env.QUEUE_BACKEND === "bullmq") {
    // Stub — would dynamic-import bullmq here. Unused for the demo path.
    state.queued.push(forgeRunId);
    return;
  }
  state.queued.push(forgeRunId);
  state.running = state.running.then(drain).catch(() => {});
}

async function drain(): Promise<void> {
  while (state.queued.length > 0 && !state.shuttingDown) {
    const next = state.queued.shift();
    if (!next || !state.handler) continue;
    try {
      await state.handler(next);
    } catch (err) {
      // Handler is responsible for its own rollback persistence; swallow
      // here so other queued jobs still drain.
      // eslint-disable-next-line no-console
      console.error("[queue] job failed", next, err);
    }
  }
}

/** Register the worker handler. Must be called before enqueue. */
export function worker(handler: JobHandler): void {
  state.handler = handler;
}

/** MAX_CONCURRENT_LANES exposed for stages that want to read it. */
export function maxConcurrentLanes(): number {
  const raw = process.env.MAX_CONCURRENT_LANES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

/** Graceful shutdown — drain in-flight, then return. */
export async function shutdown(graceMs = 30_000): Promise<void> {
  state.shuttingDown = true;
  await Promise.race([
    state.running,
    new Promise((r) => setTimeout(r, graceMs)),
  ]);
}
