// apps/synthesis-worker/persist.ts
//
// Butterbase write wrappers — thin adapters over @/lib/butterbase/client.
//
// Mara E.1 mitigation: critique + critic_score writes are FIRE-AND-FORGET
// (Promise.allSettled with setImmediate deferral). This avoids 500ms write
// latency stacking up on the critic-HUD beat (0:50–1:00) — the SSE trace
// covers the gap so the HUD sees state immediately. All other writes
// (forge_runs status, audit_citations) are awaited.
//
// Status semantics: stages emit a wide `ForgeRunStatus` enum ("parsing",
// "directing", "renderingVideo", etc.) which is the *stage cursor*, not
// the row-level status. The DB has a narrow `ForgeRunStatusRow` (queued |
// running | completed | failed | cancelled). We map terminal labels
// ("done", "failed", "cancelled") to the row enum and route everything
// else as `running` with the stage label tracked separately.

import type { ForgeRunStatus, ForgeRun } from "@/lib/forge/types";
import type { ForgeRunStatusRow } from "@/lib/butterbase/types.gen";
import {
  persistForgeRun,
  updateForgeRunStage,
  updateForgeRunStatus,
  persistShotList as bbPersistShotList,
  persistAnatomyGraph as bbPersistAnatomyGraph,
  persistCritique,
  persistCriticScore,
  persistAuditCitation,
} from "@/lib/butterbase/client";

// ─── Status mapping ────────────────────────────────────────────────────────

function rowStatusFor(stage: ForgeRunStatus): ForgeRunStatusRow {
  switch (stage) {
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "pending":
      return "queued";
    default:
      return "running";
  }
}

// ─── Awaited writes (durable state) ────────────────────────────────────────

export async function persistForgeRunStart(
  forgeRunId: string,
  patch: Partial<ForgeRun> = {},
): Promise<void> {
  try {
    await persistForgeRun({ id: forgeRunId, ...patch });
  } catch (err) {
    console.warn("[persist:forge_run_start] failed", err);
  }
}

/**
 * Called from each stage to advance the cursor. The wide `stage` arg is
 * mapped to (row.status, row.stage). Terminal states ("done"/"failed")
 * also write to the row-level status; intermediate states stay "running"
 * while the stage label advances.
 */
export async function persistForgeRunStatus(
  forgeRunId: string,
  stage: ForgeRunStatus,
  extra?: { error?: string },
): Promise<void> {
  try {
    await updateForgeRunStage(forgeRunId, stage);
    const rowStatus = rowStatusFor(stage);
    if (rowStatus !== "running") {
      await updateForgeRunStatus(forgeRunId, rowStatus, extra?.error);
    }
  } catch (err) {
    console.warn(`[persist:forge_run_status:${stage}] failed`, err);
  }
}

export async function persistStageBoundary(
  forgeRunId: string,
  stage: string,
  durationMs?: number,
  costUsd?: number,
): Promise<void> {
  try {
    await updateForgeRunStage(forgeRunId, stage, durationMs, costUsd);
  } catch (err) {
    console.warn(`[persist:stage:${stage}] failed`, err);
  }
}

/**
 * Stage 03 writes `{ v: 1, shotList }` (Atlas draft); a future stage 04
 * redraft would write `{ v: 2, shotList }` (atlas-after-mara). Map the
 * version to the row's `created_by` enum.
 */
export async function persistShotList(
  forgeRunId: string,
  payload: { v?: number; shotList?: unknown } & Record<string, unknown>,
): Promise<void> {
  const v = typeof payload.v === "number" ? payload.v : 1;
  const inner = payload.shotList ?? payload;
  const createdBy: "atlas" | "atlas-after-mara" =
    v === 2 ? "atlas-after-mara" : "atlas";
  try {
    await bbPersistShotList(forgeRunId, inner, createdBy);
  } catch (err) {
    console.warn("[persist:shot_list] failed", err);
  }
}

export async function persistAnatomyGraph(
  forgeRunId: string,
  graph: Record<string, unknown>,
): Promise<void> {
  try {
    await bbPersistAnatomyGraph(forgeRunId, graph as never);
  } catch (err) {
    console.warn("[persist:anatomy_graph] failed", err);
  }
}

/**
 * No-op stub. There is no `beats` table in the current Butterbase schema —
 * per-beat metadata reaches the HUD via SSE trace events (see Stage 9) and
 * is encoded in shot_lists + critic_scores rows. Kept as a stub so callers
 * can be promoted to real persistence without changing call sites once a
 * `beats` table lands.
 */
export async function persistBeat(
  _forgeRunId: string,
  _beat: Record<string, unknown>,
): Promise<void> {
  // intentionally empty — see jsdoc above
}

export async function persistAuditEntry(
  forgeRunId: string,
  entry: Record<string, unknown>,
): Promise<void> {
  try {
    await persistAuditCitation(forgeRunId, entry);
  } catch (err) {
    console.warn("[persist:audit_citation] failed", err);
  }
}

// ─── Fire-and-forget writes (Mara E.1) ────────────────────────────────────

function deferredFireAndForget(
  fn: () => Promise<unknown>,
  label: string,
): void {
  setImmediate(() => {
    Promise.allSettled([fn()]).then((results) => {
      for (const r of results) {
        if (r.status === "rejected") {
          console.warn(`[persist:${label}] write failed (fire-and-forget)`, r.reason);
        }
      }
    });
  });
}

/**
 * Persist Mara critiques for a ShotList — fire-and-forget. The HUD reads
 * via Butterbase realtime; the SSE trace event covers the gap.
 *
 * Accepts the loose `CriticCritique` shape from src/lib/forge/critic.ts
 * (category: string) — `persistCritique` handles narrowing internally.
 */
export function persistCritiquesAsync(
  forgeRunId: string,
  critiques: ReadonlyArray<unknown>,
): void {
  deferredFireAndForget(async () => {
    await Promise.allSettled(
      critiques.map((c) => persistCritique(forgeRunId, c)),
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
  attempts: ReadonlyArray<unknown>,
  acceptedWithLowScore: boolean,
): void {
  deferredFireAndForget(async () => {
    await Promise.allSettled(
      attempts.map((s, i) => {
        const isFinal = i === attempts.length - 1;
        const score = isFinal && acceptedWithLowScore
          ? { ...(s as object), accepted: true, acceptedWithLowScore: true }
          : s;
        return persistCriticScore(forgeRunId, beatId, score, i + 1);
      }),
    );
  }, "critic_scores");
}
