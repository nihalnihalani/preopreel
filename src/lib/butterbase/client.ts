// ============================================================================
// src/lib/butterbase/client.ts — typed Butterbase wrapper (server-side).
//
// Promo:      BUTTERBASE0502  (ALL CAPS — applied at Billing → Promo Codes)
// Submission: butterbase0502  (lowercase — Settings → Project Metadata)
// Reference:  https://www.youtube.com/watch?v=SHnryHJL9xc
//
// Strategy:
//   • If `@butterbase/js` resolves at runtime, use the SDK (typed REST + realtime).
//   • Otherwise fall back to direct `pg` calls via pg-fallback.ts (Butterbase
//     exposes a Postgres connection string under Settings → Database).
//   • The accessor surface below is the SAME either way; the worker, API
//     routes, and audit-PDF generator depend only on this file.
//
// Mara mitigations baked in here:
//   • E.1 — `persistCritique` / `persistCriticScore` are awaitable but the
//          worker call sites use Promise.allSettled so a slow Butterbase
//          write never blocks the SSE trace stream. Latency budget owned at
//          the call site, not here.
//   • E.3 — `mintSignedUrl()` is the lazy minter. Never cache a signed URL
//          longer than the request that consumes it.
// ============================================================================

import type {
  ForgeRunRow,
  ForgeRunWithDetails,
  ProcedurePlanRow,
  PatientDemographicsRow,
  AnatomyGraphRow,
  ShotListRow,
  CritiqueRow,
  CriticScoreRow,
  AuditCitationRow,
  ReplayCodecRow,
  ForgeRunStatusRow,
  ForgeRunDemoModeRow,
  CritiqueSeverityRow,
  CritiqueCategoryRow,
  CitationSourceRow,
} from "./types.gen";
import { BUCKET_LAYOUT } from "./types.gen";
import {
  query,
  insertRow,
  updateRow,
  withTransaction,
} from "./pg-fallback";
import {
  uploadBytes as storageUploadBytes,
  signedUrl as storageSignedUrl,
  downloadBytes as storageDownloadBytes,
} from "./storage";
import type { Critique, CriticScore } from "@/lib/forge/critique";
import type { AuditEntry } from "@/lib/forge/audit";
import type { ShotList } from "@/lib/forge/shotList";
import type { ForgeRun } from "@/lib/forge/types";
import { getLocalRun, upsertLocalRun, pushLocal, getLocalDetails } from "./local-store";

// Best-effort local-store fallback used by every persist* below. Returns
// true if the failure was the expected "no database configured" error
// (caller should swallow); rethrows otherwise.
function isNoDbError(err: unknown): boolean {
  return err instanceof Error && err.name === "NoButterbaseDatabaseUrlError";
}

// Domain alias — the worker calls this an AuditCitation in plan 05; the
// authoritative Zod schema names it AuditEntry. We accept either shape via
// duck-typing in `persistAuditCitation` below.
export type AuditCitation = AuditEntry;

// ─── SDK detection ────────────────────────────────────────────────────────
// The SDK package is "@butterbase/js" per plan 05 day-1 resolution. Detect
// via dynamic import so a missing package doesn't break the worker.
type ButterbaseSdk = unknown;
let _sdk: ButterbaseSdk | null = null;
let _sdkChecked = false;

async function tryLoadSdk(): Promise<ButterbaseSdk | null> {
  if (_sdkChecked) return _sdk;
  _sdkChecked = true;
  try {
    // Optional dependency — the package isn't on npm yet (verified 2026-05-02).
    // Hide the specifier behind a variable so Turbopack/webpack don't try to
    // statically resolve it; the pg fallback covers everything we need.
    const sdkSpecifier = ["@butter", "base/js"].join("");
    // Runtime-only import; specifier is intentionally dynamic so the
    // bundler skips static resolution.
    const mod = await import(/* webpackIgnore: true */ /* @vite-ignore */ sdkSpecifier);
    _sdk = mod;
    return _sdk;
  } catch {
    _sdk = null;
    return null;
  }
}

// Expose for tests; not part of the public surface.
export async function _isSdkAvailable(): Promise<boolean> {
  return (await tryLoadSdk()) !== null;
}

// ─── Type bridges from forge/* domain types → DB shape ────────────────────
// These tolerate either snake_case or camelCase domain shapes so the worker
// code can pass either Zod-inferred type or a plain object.
type AnyRecord = Record<string, unknown>;

function pickStr(o: AnyRecord, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickNum(o: AnyRecord, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickBool(o: AnyRecord, ...keys: string[]): boolean | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

// ============================================================================
// Forge runs
// ============================================================================

/**
 * Insert a new ForgeRun row. Returns the row id (uuid).
 * The worker calls this exactly once at intake (Stage 1).
 */
export async function persistForgeRun(
  run: Partial<ForgeRun> & { id?: string },
): Promise<string> {
  const r = run as AnyRecord;
  const id = pickStr(r, "id");
  const status: ForgeRunStatusRow =
    (pickStr(r, "status") as ForgeRunStatusRow) ?? "queued";
  const stage = pickStr(r, "stage") ?? "intake";
  const demoMode: ForgeRunDemoModeRow =
    (pickStr(r, "demoMode", "demo_mode") as ForgeRunDemoModeRow) ?? "live";
  const durations =
    (r.durationsMs as Record<string, number>) ??
    (r.durations_ms as Record<string, number>) ??
    {};
  const cost =
    (r.costUsd as Record<string, number>) ??
    (r.cost_usd as Record<string, number>) ??
    {};
  const error = pickStr(r, "error") ?? null;

  const row: AnyRecord = {
    status,
    stage,
    demo_mode: demoMode,
    durations_ms: JSON.stringify(durations),
    cost_usd: JSON.stringify(cost),
    error,
  };
  if (id) row.id = id;

  try {
    const inserted = await insertRow<{ id: string }>("forge_runs", row, ["id"]);
    return inserted.id;
  } catch (err) {
    if (!(err instanceof Error && err.name === "NoButterbaseDatabaseUrlError")) {
      console.warn("[butterbase/client] persistForgeRun pg failed:", err);
    }
  }

  // Fallback
  const finalId = id || crypto.randomUUID();
  const { upsertLocalRun, getLocalRun } = await import("./local-store");
  const existing = await getLocalRun(finalId) ?? {
    id: finalId,
    createdAt: new Date().toISOString(),
    status: status as ForgeRun["status"],
    stage: stage as ForgeRun["stage"],
    demoMode: demoMode as ForgeRun["demoMode"],
    durationsMs: {},
    costUsd: {},
    error: null,
  };
  await upsertLocalRun({
    ...existing,
    status: status as ForgeRun["status"],
    stage: stage as ForgeRun["stage"],
    demoMode: demoMode as ForgeRun["demoMode"],
    durationsMs: { ...existing.durationsMs, ...durations },
    costUsd: { ...existing.costUsd, ...cost },
    error: error ?? existing.error,
  });
  return finalId;
}

/**
 * insertForgeRun — lightweight insert called from POST /api/forge.
 * Mirrors to local-store unconditionally so GET /api/forge/{id} always
 * finds a row even when Butterbase Postgres is unreachable.
 */
export async function insertForgeRun(row: {
  id: string;
  status: string;
  stage: string;
  demoMode: string;
}): Promise<void> {
  const localRow: ForgeRun = {
    id: row.id,
    createdAt: new Date().toISOString(),
    status: row.status as ForgeRun["status"],
    stage: row.stage as ForgeRun["stage"],
    demoMode: (row.demoMode as ForgeRun["demoMode"]) ?? "live",
    durationsMs: {},
    costUsd: {},
    error: null,
  };
  // Mirror to local store first — this must not be swallowed.
  await upsertLocalRun(localRow);
  // Best-effort Postgres insert; failure is non-fatal (local store is the fallback).
  try {
    await persistForgeRun(localRow);
  } catch (err) {
    console.warn("[butterbase/client] Postgres insertForgeRun failed (local-store ok):", err);
  }
}

/**
 * Update the granular stage cursor + optional duration/cost increment.
 * Used at every stage boundary in the worker.
 */
export async function updateForgeRunStage(
  id: string,
  stage: string,
  durationMs?: number,
  costUsd?: number,
): Promise<void> {
  // We merge into the jsonb columns to preserve previous-stage data.
  const sql = `
    UPDATE forge_runs
       SET stage = $2,
           durations_ms = CASE WHEN $3::text IS NOT NULL
                               THEN jsonb_set(durations_ms, ARRAY[$3], to_jsonb($4::int), true)
                               ELSE durations_ms END,
           cost_usd     = CASE WHEN $3::text IS NOT NULL AND $5::numeric IS NOT NULL
                               THEN jsonb_set(cost_usd,     ARRAY[$3], to_jsonb($5::numeric), true)
                               ELSE cost_usd END
     WHERE id = $1
  `;
  try {
    await query(sql, [
      id,
      stage,
      typeof durationMs === "number" ? stage : null,
      typeof durationMs === "number" ? Math.round(durationMs) : null,
      typeof costUsd === "number" ? costUsd : null,
    ]);
  } catch (err) {
    if (!(err instanceof Error && err.name === "NoButterbaseDatabaseUrlError")) {
      console.warn("[butterbase/client] updateForgeRunStage pg failed:", err);
    }
  }

  // Fallback
  const { upsertLocalRun, getLocalRun } = await import("./local-store");
  const existing = await getLocalRun(id);
  if (existing) {
    if (typeof durationMs === "number") existing.durationsMs[stage as keyof ForgeRun["durationsMs"]] = Math.round(durationMs);
    if (typeof costUsd === "number") existing.costUsd[stage as keyof ForgeRun["costUsd"]] = costUsd;
    existing.stage = stage as ForgeRun["stage"];
    await upsertLocalRun(existing);
  }
}

/**
 * Update terminal-ish state. Use 'completed' / 'failed' / 'cancelled'.
 */
export async function updateForgeRunStatus(
  id: string,
  status: ForgeRunStatusRow,
  error?: string,
): Promise<void> {
  try {
    await updateRow(
      "forge_runs",
      { status, error: error ?? null },
      { id },
    );
  } catch (err) {
    if (!(err instanceof Error && err.name === "NoButterbaseDatabaseUrlError")) {
      console.warn("[butterbase/client] updateForgeRunStatus pg failed:", err);
    }
  }

  // Fallback
  const { upsertLocalRun, getLocalRun } = await import("./local-store");
  const existing = await getLocalRun(id);
  if (existing) {
    existing.status = status as ForgeRun["status"];
    if (error) existing.error = error;
    await upsertLocalRun(existing);
  }
}

/**
 * Set the explainer / audit URLs once Stage 12 has uploaded both. These are
 * storage keys, NOT signed URLs (signed URLs are minted lazily per request).
 */
export async function setForgeRunDeliverables(
  id: string,
  args: { explainerKey?: string; auditKey?: string },
): Promise<void> {
  const set: AnyRecord = {};
  if (args.explainerKey) set.explainer_mp4_url = args.explainerKey;
  if (args.auditKey) set.audit_trail_pdf_url = args.auditKey;
  if (Object.keys(set).length === 0) return;
  try {
    await updateRow("forge_runs", set, { id });
  } catch (err) {
    if (!(err instanceof Error && err.name === "NoButterbaseDatabaseUrlError")) {
      console.warn("[butterbase/client] setForgeRunDeliverables pg failed:", err);
    }
  }

  // Fallback
  const { upsertLocalRun, getLocalRun } = await import("./local-store");
  const existing = await getLocalRun(id);
  if (existing) {
    if (args.explainerKey) (existing as any).explainer_mp4_url = args.explainerKey;
    if (args.auditKey) (existing as any).audit_trail_pdf_url = args.auditKey;
    await upsertLocalRun(existing);
  }
}

// ============================================================================
// Stage outputs
// ============================================================================

export async function persistProcedurePlan(
  forgeRunId: string,
  plan: unknown,
  pdfStorageKey: string,
): Promise<void> {
  const row = {
    forge_run_id: forgeRunId,
    pdf_url: pdfStorageKey,
    parsed_json: JSON.stringify(plan),
  };
  try {
    await insertRow("procedure_plans", row);
    return;
  } catch (err) {
    if (!isNoDbError(err)) {
      console.warn("[butterbase/client] persistProcedurePlan pg failed:", err);
    }
  }
  await pushLocal("procedurePlans", row as unknown as ProcedurePlanRow);
}

export async function persistPatientDemographics(
  forgeRunId: string,
  card: {
    age: number;
    sex: "female" | "male" | "intersex" | "unspecified";
    bmi?: number | null;
    comorbidities?: string[];
    syntheticPhantom?: boolean;
  },
): Promise<void> {
  const row = {
    forge_run_id: forgeRunId,
    age: card.age,
    sex: card.sex,
    bmi: card.bmi ?? null,
    comorbidities: card.comorbidities ?? [],
    synthetic_phantom: card.syntheticPhantom ?? true,
  };
  try {
    await insertRow("patient_demographics", row);
    return;
  } catch (err) {
    if (!isNoDbError(err)) {
      console.warn("[butterbase/client] persistPatientDemographics pg failed:", err);
    }
  }
  await pushLocal("patientDemographics", row as unknown as PatientDemographicsRow);
}

export async function persistAnatomyGraph(
  forgeRunId: string,
  graph: unknown,
  confidenceDistribution?: Record<string, number>,
): Promise<void> {
  const row = {
    forge_run_id: forgeRunId,
    graph_json: JSON.stringify(graph),
    confidence_distribution: JSON.stringify(confidenceDistribution ?? {}),
    created_at: new Date().toISOString(),
  };
  try {
    await insertRow("anatomy_graphs", row);
    return;
  } catch (err) {
    if (!isNoDbError(err)) {
      console.warn("[butterbase/client] persistAnatomyGraph pg failed:", err);
    }
  }
  await pushLocal("anatomyGraphs", row as unknown as AnatomyGraphRow);
}

/**
 * persistShotList — insert version 1 (atlas) or version 2 (atlas-after-mara).
 * The (forge_run_id, version) UNIQUE constraint makes this idempotent on
 * retries: same version + payload returns 0 rows changed.
 */
export async function persistShotList(
  forgeRunId: string,
  shotList: ShotList | unknown,
  createdBy: "atlas" | "atlas-after-mara",
): Promise<{ version: number }> {
  const version = createdBy === "atlas" ? 1 : 2;
  try {
    return await withTransaction(async (client) => {
      const sql = `
        INSERT INTO shot_lists (forge_run_id, version, shot_list_json, created_by)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (forge_run_id, version) DO UPDATE
          SET shot_list_json = EXCLUDED.shot_list_json
        RETURNING version
      `;
      const r = await client.query<{ version: number }>(sql, [
        forgeRunId,
        version,
        JSON.stringify(shotList),
        createdBy,
      ]);
      return { version: r.rows[0]?.version ?? version };
    });
  } catch (err) {
    if (!isNoDbError(err)) {
      console.warn("[butterbase/client] persistShotList pg failed:", err);
    }
  }
  const row = {
    forge_run_id: forgeRunId,
    version,
    shot_list_json: shotList as unknown,
    created_by: createdBy,
    created_at: new Date().toISOString(),
  };
  await pushLocal("shotLists", row as unknown as ShotListRow);
  return { version };
}

// ============================================================================
// Critic loop (Invariant 1)
// ============================================================================

/**
 * persistCritique — fire-and-forget from the worker (call site uses
 * Promise.allSettled). Realtime broadcast happens automatically on INSERT
 * via Butterbase logical decoding on `pre:critiques:{forge_run_id}`.
 */
export async function persistCritique(
  forgeRunId: string,
  critique: Critique | unknown,
): Promise<void> {
  const c = critique as AnyRecord;
  const row = {
    forge_run_id: forgeRunId,
    shot_id: pickStr(c, "shotId", "shot_id") ?? "",
    severity: (pickStr(c, "severity") as CritiqueSeverityRow) ?? "info",
    category: (pickStr(c, "category") as CritiqueCategoryRow) ?? "ambiguity",
    excerpt: pickStr(c, "excerpt") ?? "",
    reason: pickStr(c, "reason") ?? "",
    suggested_revision:
      pickStr(c, "suggestedRevision", "suggested_revision") ?? null,
    persona: "mara" as const,
    created_at: new Date().toISOString(),
  };
  try {
    await insertRow("critiques", row);
    return;
  } catch (err) {
    if (!isNoDbError(err)) {
      console.warn("[butterbase/client] persistCritique pg failed:", err);
    }
  }
  await pushLocal("critiques", row as unknown as CritiqueRow);
}

/**
 * persistCriticScore — Lyra emits these per beat per regen attempt.
 * Realtime channel: `pre:scores:{forge_run_id}`.
 *
 * `acceptedWithLowScore` is the Mara A.3 honesty-over-theater flag — the
 * 1-regen budget burned and we accepted anyway, surfacing the score in the
 * HUD. Default false.
 */
export async function persistCriticScore(
  forgeRunId: string,
  beatId: string,
  score: CriticScore | unknown,
  regenAttempt: number,
): Promise<void> {
  const s = score as AnyRecord;
  const row = {
    forge_run_id: forgeRunId,
    beat_id: beatId,
    regen_attempt: regenAttempt,
    anatomical_fidelity: pickNum(s, "anatomicalFidelity", "anatomical_fidelity") ?? 0,
    procedure_step_compliance:
      pickNum(s, "procedureStepCompliance", "procedure_step_compliance") ?? 0,
    on_screen_text_violations:
      pickNum(s, "onScreenTextViolations", "on_screen_text_violations") ?? 0,
    feedback: pickStr(s, "feedback") ?? "",
    accepted: pickBool(s, "accepted") ?? false,
    accepted_with_low_score:
      pickBool(s, "acceptedWithLowScore", "accepted_with_low_score") ?? false,
    persona: "lyra" as const,
    created_at: new Date().toISOString(),
  };
  try {
    await insertRow("critic_scores", row);
    return;
  } catch (err) {
    if (!isNoDbError(err)) {
      console.warn("[butterbase/client] persistCriticScore pg failed:", err);
    }
  }
  await pushLocal("criticScores", row as unknown as CriticScoreRow);
}

// ============================================================================
// Read accessors (drive the API routes)
// ============================================================================
//
// /api/forge/[id]/{critique,critic,receipt}/route.ts dynamic-import these.
// Names match the route guards (mod?.getCritiques, mod?.getCriticScores,
// mod?.getAuditEntries). Without these exports the routes silently no-op
// the DB path and serve disk fixtures (devil's-advocate B1, 2026-05-02).
// In replay mode we skip Postgres entirely so the offline / no-DB path
// stays clean — same shape as fetchFromButterbase in the [id] route.

function isReplayMode(): boolean {
  return (process.env.DEMO_MODE ?? "live") === "replay";
}

export async function getCritiques(forgeRunId: string): Promise<CritiqueRow[]> {
  if (!isReplayMode()) {
    try {
      const r = await query<CritiqueRow>(
        `SELECT * FROM critiques WHERE forge_run_id = $1 ORDER BY created_at ASC`,
        [forgeRunId],
      );
      if (r.rows.length > 0) return r.rows;
    } catch (err) {
      if (!isNoDbError(err)) {
        console.warn("[butterbase/client] getCritiques pg failed, using local-store:", err);
      }
    }
  }
  const details = await getLocalDetails(forgeRunId);
  return details.critiques as unknown as CritiqueRow[];
}

export async function getCriticScores(
  forgeRunId: string,
): Promise<CriticScoreRow[]> {
  if (!isReplayMode()) {
    try {
      const r = await query<CriticScoreRow>(
        `SELECT * FROM critic_scores
           WHERE forge_run_id = $1
           ORDER BY beat_id, regen_attempt`,
        [forgeRunId],
      );
      if (r.rows.length > 0) return r.rows;
    } catch (err) {
      if (!isNoDbError(err)) {
        console.warn("[butterbase/client] getCriticScores pg failed, using local-store:", err);
      }
    }
  }
  const details = await getLocalDetails(forgeRunId);
  return details.critic_scores as unknown as CriticScoreRow[];
}

export async function getAuditEntries(
  forgeRunId: string,
): Promise<AuditCitationRow[]> {
  if (!isReplayMode()) {
    try {
      const r = await query<AuditCitationRow>(
        `SELECT * FROM audit_citations WHERE forge_run_id = $1 ORDER BY claim_id`,
        [forgeRunId],
      );
      if (r.rows.length > 0) return r.rows;
    } catch (err) {
      if (!isNoDbError(err)) {
        console.warn("[butterbase/client] getAuditEntries pg failed, using local-store:", err);
      }
    }
  }
  const details = await getLocalDetails(forgeRunId);
  return details.audit_citations as unknown as AuditCitationRow[];
}

// ============================================================================
// Audit trail (Invariant 4)
// ============================================================================

export async function persistAuditCitation(
  forgeRunId: string,
  citation: AuditEntry | unknown,
): Promise<void> {
  const c = citation as AnyRecord;

  // The AuditEntry Zod schema (src/lib/forge/audit.ts) carries:
  //   { claimId, narratorLineExcerpt, citation: { sourceType, pointer, excerpt },
  //     confidenceBand: { lo, hi }, ... }
  // The flatter plan-05 shape uses { claim_id, narrator_excerpt, source_type,
  // pointer, confidence_lo, confidence_hi }. Both are accepted.
  const innerCitation = (c.citation as AnyRecord | undefined) ?? {};
  const band = (c.confidenceBand as AnyRecord | undefined) ?? {};

  const sourceType =
    (pickStr(c, "sourceType", "source_type") as CitationSourceRow | null) ??
    (pickStr(innerCitation, "sourceType", "source_type") as
      | CitationSourceRow
      | null) ??
    "procedure_plan";
  const pointer =
    pickStr(c, "pointer") ?? pickStr(innerCitation, "pointer") ?? "";
  const narratorExcerpt =
    pickStr(c, "narratorExcerpt", "narrator_excerpt", "narratorLineExcerpt") ??
    pickStr(innerCitation, "excerpt") ??
    "";
  const confidenceLo =
    pickNum(c, "confidenceLo", "confidence_lo") ??
    pickNum(band, "lo");
  const confidenceHi =
    pickNum(c, "confidenceHi", "confidence_hi") ??
    pickNum(band, "hi");

  const row = {
    forge_run_id: forgeRunId,
    claim_id: pickStr(c, "claimId", "claim_id") ?? "",
    narrator_excerpt: narratorExcerpt,
    source_type: sourceType,
    pointer,
    confidence_lo: confidenceLo,
    confidence_hi: confidenceHi,
  };
  try {
    await insertRow("audit_citations", row);
    return;
  } catch (err) {
    if (!isNoDbError(err)) {
      console.warn("[butterbase/client] persistAuditCitation pg failed:", err);
    }
  }
  await pushLocal("auditCitations", row as unknown as AuditCitationRow);
}

// ============================================================================
// Replay fixtures (Invariant 3)
// ============================================================================

const INLINE_BYTES_THRESHOLD = 64 * 1024; // 64 KiB

/**
 * getReplayFixture — returns the raw bytes for a (stage, key) pair.
 * Reads the inline `bytea` if present; otherwise downloads from storage.
 * Returns `null` on miss.
 */
export async function getReplayFixture(
  stage: string,
  key: string,
): Promise<Buffer | null> {
  const r = await query<{ bytes: Buffer | null; storage_url: string | null }>(
    `SELECT bytes, storage_url FROM replay_fixtures WHERE stage = $1 AND key = $2 LIMIT 1`,
    [stage, key],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.bytes) return Buffer.from(row.bytes);
  if (row.storage_url) {
    return storageDownloadBytes(row.storage_url);
  }
  return null;
}

/**
 * setReplayFixture — upserts a (stage, key) fixture. Inline if < 64 KiB,
 * otherwise uploads to storage at preopreel-renders/replay/<stage>/<key>.<ext>.
 */
export async function setReplayFixture(
  stage: string,
  key: string,
  codec: ReplayCodecRow,
  bytes: Buffer,
): Promise<void> {
  if (bytes.length <= INLINE_BYTES_THRESHOLD) {
    const sql = `
      INSERT INTO replay_fixtures (stage, key, codec, bytes)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (stage, key) DO UPDATE
        SET codec = EXCLUDED.codec,
            bytes = EXCLUDED.bytes,
            storage_url = NULL
    `;
    await query(sql, [stage, key, codec, bytes]);
    return;
  }
  // Big payload — write to storage and store the key.
  const ext = codec; // codec doubles as file extension
  const storageKey = `replay/${stage}/${key}.${ext}`;
  await storageUploadBytes(
    storageKey,
    bytes,
    contentTypeForCodec(codec),
  );
  const sql = `
    INSERT INTO replay_fixtures (stage, key, codec, bytes, storage_url)
    VALUES ($1, $2, $3, NULL, $4)
    ON CONFLICT (stage, key) DO UPDATE
      SET codec = EXCLUDED.codec,
          bytes = NULL,
          storage_url = EXCLUDED.storage_url
  `;
  await query(sql, [stage, key, codec, storageKey]);
}

function contentTypeForCodec(c: ReplayCodecRow): string {
  switch (c) {
    case "json": return "application/json";
    case "mp4":  return "video/mp4";
    case "png":  return "image/png";
    case "wav":  return "audio/wav";
    case "pdf":  return "application/pdf";
  }
}

// ============================================================================
// Storage uploads (return storage key + lazily-minted signed URL)
// ============================================================================

export async function uploadExplainerMp4(
  forgeRunId: string,
  bytes: Buffer,
): Promise<{ storageKey: string; signedUrl: string }> {
  const storageKey = BUCKET_LAYOUT.explainers(forgeRunId);
  await storageUploadBytes(storageKey, bytes, "video/mp4");
  await setForgeRunDeliverables(forgeRunId, { explainerKey: storageKey });
  const signed = await storageSignedUrl(storageKey, 3600);
  return { storageKey, signedUrl: signed };
}

export async function uploadAuditPdf(
  forgeRunId: string,
  bytes: Buffer,
): Promise<{ storageKey: string; signedUrl: string }> {
  const storageKey = BUCKET_LAYOUT.audit(forgeRunId);
  await storageUploadBytes(storageKey, bytes, "application/pdf");
  await setForgeRunDeliverables(forgeRunId, { auditKey: storageKey });
  const signed = await storageSignedUrl(storageKey, 3600);
  return { storageKey, signedUrl: signed };
}

export async function uploadKeyframe(
  forgeRunId: string,
  beatId: string,
  bytes: Buffer,
): Promise<{ storageKey: string }> {
  const storageKey = BUCKET_LAYOUT.keyframes(forgeRunId, beatId);
  await storageUploadBytes(storageKey, bytes, "image/png");
  return { storageKey };
}

export async function uploadProcedurePlanPdf(
  forgeRunId: string,
  bytes: Buffer,
): Promise<{ storageKey: string }> {
  const storageKey = BUCKET_LAYOUT.uploads(forgeRunId, "plan.pdf");
  await storageUploadBytes(storageKey, bytes, "application/pdf");
  return { storageKey };
}

/**
 * mintSignedUrl — Mara E.3 mitigation. Always called per request, never
 * cached longer than the response that consumes it. TTL defaults to 1 hour;
 * the lower bound just covers a slow page render plus user click.
 */
export async function mintSignedUrl(
  storageKey: string,
  ttlSeconds = 3600,
): Promise<string> {
  return storageSignedUrl(storageKey, ttlSeconds);
}

// ============================================================================
// Receipt page join — single round-trip
// ============================================================================

/**
 * getForgeRun — joins forge_runs + procedure_plans + patient_demographics +
 * anatomy_graphs + shot_lists + critiques + critic_scores + audit_citations.
 * Drives the receipt page (`/forge/{id}/receipt`).
 *
 * Signed URLs are minted lazily here (Mara E.3) — never persisted in the
 * `forge_runs` row; only the storage keys are.
 */
export async function getForgeRun(
  id: string,
): Promise<ForgeRunWithDetails | null> {
  // In replay mode skip Postgres entirely; fall through to local-store below.
  let run: ForgeRunRow | undefined;
  if ((process.env.DEMO_MODE ?? "live") !== "replay") {
    try {
      const runR = await query<ForgeRunRow>(
        `SELECT * FROM forge_runs WHERE id = $1 LIMIT 1`,
        [id],
      );
      run = runR.rows[0];
    } catch (err) {
      if (err instanceof Error && err.name === "NoButterbaseDatabaseUrlError") {
        // Expected when no DB is configured; silently fall through to local store
      } else {
        console.warn("[butterbase/client] getForgeRun Postgres failed, trying local-store:", err);
      }
    }
  }
  if (!run) {
    const local = await getLocalRun(id);
    if (!local) return null;
    const details = await getLocalDetails(id);
    return {
      ...(local as unknown as ForgeRunRow),
      procedure_plan: details.procedure_plan,
      patient_demographics: details.patient_demographics,
      anatomy_graph: details.anatomy_graph,
      shot_lists: details.shot_lists,
      critiques: details.critiques,
      critic_scores: details.critic_scores,
      audit_citations: details.audit_citations,
      explainer_signed_url: null,
      audit_signed_url: null,
    } as unknown as ForgeRunWithDetails;
  }

  const [planR, patR, anaR, slR, crR, scR, acR] = await Promise.all([
    query<ProcedurePlanRow>(
      `SELECT * FROM procedure_plans WHERE forge_run_id = $1 ORDER BY uploaded_at ASC LIMIT 1`,
      [id],
    ),
    query<PatientDemographicsRow>(
      `SELECT * FROM patient_demographics WHERE forge_run_id = $1 LIMIT 1`,
      [id],
    ),
    query<AnatomyGraphRow>(
      `SELECT * FROM anatomy_graphs WHERE forge_run_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [id],
    ),
    query<ShotListRow>(
      `SELECT * FROM shot_lists WHERE forge_run_id = $1 ORDER BY version ASC`,
      [id],
    ),
    query<CritiqueRow>(
      `SELECT * FROM critiques WHERE forge_run_id = $1 ORDER BY created_at ASC`,
      [id],
    ),
    query<CriticScoreRow>(
      `SELECT * FROM critic_scores WHERE forge_run_id = $1 ORDER BY beat_id, regen_attempt`,
      [id],
    ),
    query<AuditCitationRow>(
      `SELECT * FROM audit_citations WHERE forge_run_id = $1 ORDER BY claim_id`,
      [id],
    ),
  ]);

  // Lazy signed URLs (Mara E.3).
  let explainerSigned: string | null = null;
  let auditSigned: string | null = null;
  if (run.explainer_mp4_url) {
    try {
      explainerSigned = await mintSignedUrl(run.explainer_mp4_url, 3600);
    } catch (e) {
      console.warn("[butterbase/client] explainer signed URL failed:", e);
    }
  }
  if (run.audit_trail_pdf_url) {
    try {
      auditSigned = await mintSignedUrl(run.audit_trail_pdf_url, 3600);
    } catch (e) {
      console.warn("[butterbase/client] audit signed URL failed:", e);
    }
  }

  return {
    ...run,
    procedure_plan: planR.rows[0] ?? null,
    patient_demographics: patR.rows[0] ?? null,
    anatomy_graph: anaR.rows[0] ?? null,
    shot_lists: slR.rows,
    critiques: crR.rows,
    critic_scores: scR.rows,
    audit_citations: acR.rows,
    explainer_signed_url: explainerSigned,
    audit_signed_url: auditSigned,
  };
}

// ============================================================================
// Re-exports
// ============================================================================
export { BUCKET_LAYOUT } from "./types.gen";
export type {
  ForgeRunRow,
  ForgeRunWithDetails,
  ProcedurePlanRow,
  PatientDemographicsRow,
  AnatomyGraphRow,
  ShotListRow,
  CritiqueRow,
  CriticScoreRow,
  AuditCitationRow,
} from "./types.gen";
