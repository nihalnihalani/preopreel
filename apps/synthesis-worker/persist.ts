// apps/synthesis-worker/persist.ts
//
// Butterbase write wrappers.
//
// Mara E.1 mitigation: critique + critic_score writes are FIRE-AND-FORGET
// (Promise.allSettled with setImmediate deferral). This avoids 500ms write
// latency stacking up on the critic-HUD beat (0:50–1:00) — the SSE trace
// covers the gap so the HUD sees state immediately. All other writes
// (forge_runs status, beats, audit_citations, finalize) are awaited.

import type {
  CriticCritique,
  CriticScore,
} from "@/lib/forge/critic";

// ─── Lazy Butterbase client ────────────────────────────────────────────────
//
// The actual @/lib/butterbase/client module is owned by Butterbase Dev and
// will land in parallel. We dynamic-import so this module compiles even if
// the dependency hasn't been written yet — at runtime the worker validates
// availability.

interface ButterbaseClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insert: (table: string, row: Record<string, unknown>) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update: (table: string, id: string, patch: Record<string, unknown>) => Promise<any>;
}

let bbClient: ButterbaseClient | null = null;

async function getBb(): Promise<ButterbaseClient | null> {
  if (bbClient) return bbClient;
  try {
    // Butterbase Dev's module path. Resolved at runtime.
    const mod = (await import("@/lib/butterbase/client")) as {
      getButterbaseClient?: () => ButterbaseClient;
      default?: ButterbaseClient;
    };
    bbClient =
      mod.getButterbaseClient?.() ?? mod.default ?? null;
    return bbClient;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[persist] butterbase client unavailable", err);
    return null;
  }
}

// ─── Awaited writes (durable state) ────────────────────────────────────────

export async function persistForgeRunStart(
  forgeRunId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const bb = await getBb();
  if (!bb) return;
  await bb.update("forge_runs", forgeRunId, patch);
}

export async function persistForgeRunStatus(
  forgeRunId: string,
  status: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  const bb = await getBb();
  if (!bb) return;
  await bb.update("forge_runs", forgeRunId, {
    status,
    stage: status,
    ...(extra ?? {}),
  });
}

export async function persistBeat(
  forgeRunId: string,
  beat: Record<string, unknown>,
): Promise<void> {
  const bb = await getBb();
  if (!bb) return;
  await bb.insert("beats", { forge_run_id: forgeRunId, ...beat });
}

export async function persistAuditCitation(
  forgeRunId: string,
  citation: Record<string, unknown>,
): Promise<void> {
  const bb = await getBb();
  if (!bb) return;
  await bb.insert("audit_citations", {
    forge_run_id: forgeRunId,
    ...citation,
  });
}

export async function persistShotList(
  forgeRunId: string,
  shotList: Record<string, unknown>,
): Promise<void> {
  const bb = await getBb();
  if (!bb) return;
  await bb.insert("shot_lists", { forge_run_id: forgeRunId, ...shotList });
}

export async function persistAnatomyGraph(
  forgeRunId: string,
  graph: Record<string, unknown>,
): Promise<void> {
  const bb = await getBb();
  if (!bb) return;
  await bb.insert("anatomy_graphs", { forge_run_id: forgeRunId, ...graph });
}

// ─── Fire-and-forget writes (Mara E.1) ────────────────────────────────────

function deferredFireAndForget(
  fn: () => Promise<unknown>,
  label: string,
): void {
  // setImmediate yields to the event loop so the worker stage can continue
  // immediately. Promise.allSettled here is one-element but the shape
  // matches the brief and lets us extend to batched persistence trivially.
  setImmediate(() => {
    Promise.allSettled([fn()]).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") {
          // eslint-disable-next-line no-console
          console.warn(`[persist:${label}] write failed (fire-and-forget)`, r.reason);
        }
      }
    });
  });
}

/**
 * Persist Mara critiques for a ShotList — fire-and-forget. The HUD reads
 * via Butterbase realtime; the SSE trace event covers the gap.
 */
export function persistCritiquesAsync(
  forgeRunId: string,
  critiques: CriticCritique[],
): void {
  deferredFireAndForget(async () => {
    const bb = await getBb();
    if (!bb) return;
    await Promise.allSettled(
      critiques.map((c) =>
        bb.insert("critiques", { forge_run_id: forgeRunId, ...c }),
      ),
    );
  }, "critiques");
}

/**
 * Persist Lyra critic scores — fire-and-forget. We persist EVERY attempt
 * (Mara A.3 honesty), not just the accepted score, so the audit trail
 * shows the regen sequence.
 */
export function persistCriticScoresAsync(
  forgeRunId: string,
  beatId: string,
  attempts: CriticScore[],
  accepted_with_low_score: boolean,
): void {
  deferredFireAndForget(async () => {
    const bb = await getBb();
    if (!bb) return;
    await Promise.allSettled(
      attempts.map((s, i) =>
        bb.insert("critic_scores", {
          forge_run_id: forgeRunId,
          attempt: i + 1,
          accepted_with_low_score: i === attempts.length - 1 && accepted_with_low_score,
          ...s,
          beat_id: beatId,
        }),
      ),
    );
  }, "critic_scores");
}
