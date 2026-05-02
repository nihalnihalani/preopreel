// src/lib/tracing/als.ts
//
// AsyncLocalStorage for forge_run_id propagation.
//
// Resolution per master plan §6 + plan 02 §7.4: AsyncLocalStorage at the
// worker boundary; explicit param at the API boundary. The worker enters
// the context via withForgeRunContext at job start; every Seed wrapper
// (and replay.ts) resolves the id via getCurrentForgeRunId.
//
// Why ALS over explicit threading: avoids polluting every wrapper signature
// with a forgeRunId prop. The trade-off is "magic" reads — confined to the
// worker and replay.ts, not exposed to UI/API code.

import { AsyncLocalStorage } from "node:async_hooks";

export interface ForgeRunContext {
  forgeRunId: string;
}

export const forgeRunStore = new AsyncLocalStorage<ForgeRunContext>();

/**
 * Run `fn` inside a forge-run context. The worker calls this once at the top
 * of `runSynthesis(forgeRunId)`; every subsequent Seed call inside that scope
 * resolves the id without explicit threading.
 */
export function withForgeRunContext<T>(
  forgeRunId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return forgeRunStore.run({ forgeRunId }, fn);
}

/**
 * Read the current forge_run_id. Returns undefined when called outside a
 * worker scope (e.g., from API request handlers — those should pass the id
 * explicitly).
 */
export function getCurrentForgeRunId(): string | undefined {
  return forgeRunStore.getStore()?.forgeRunId;
}

/**
 * Read the current forge_run_id and throw if missing. Used by replay.ts
 * when the caller didn't supply one explicitly.
 */
export function requireCurrentForgeRunId(): string {
  const id = getCurrentForgeRunId();
  if (!id) {
    throw new Error(
      "No forge_run_id in AsyncLocalStorage scope. " +
        "Wrap calls with withForgeRunContext(id, fn) or pass forgeRunId explicitly.",
    );
  }
  return id;
}
