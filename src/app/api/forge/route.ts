// POST /api/forge
//
// Plan 04 §A.5 + master plan §6 step 11.
// Accepts:
//   - multipart with `plan.pdf` + `patient.json` blob, OR
//   - ?fixture=hip-replacement (loads data/fixtures/demo-hip-replacement)
//
// Behavior:
//   1. Parse the inputs.
//   2. Mint a UUID forge_run_id (or use the deterministic demo id when
//      fixture=hip-replacement so replay keys are stable).
//   3. Insert a `forge_runs` row via Butterbase client (stage="pending").
//   4. Enqueue the worker job.
//   5. Return { forge_run_id } + 202.
//
// In demo / dev mode (no Butterbase keys), we degrade gracefully: write
// the row to a local in-memory map and respond. The worker still picks
// it up via the same enqueue function. The actual Butterbase + worker
// modules are written by other devs in parallel; this file imports them
// lazily so the route compiles in isolation.

import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_FIXTURE_ID = "demo-hip-replacement"; // deterministic id

interface StartResult {
  forge_run_id: string;
}

// Best-effort import — if the butterbase client / worker queue aren't
// implemented yet, we still return 202 so the UI can proceed against
// fixture data via the SSE / cached endpoints.
async function safeEnqueue(forgeRunId: string, source: "fixture" | "upload"): Promise<void> {
  try {
    // Dynamic import so a missing module doesn't tank the whole route.
    const mod = (await import("@worker/queue").catch(() => null)) as
      | { enqueue?: (id: string) => Promise<void> }
      | null;
    if (mod?.enqueue) {
      await mod.enqueue(forgeRunId);
    }
  } catch (err) {
    console.warn(`[api/forge] enqueue failed (non-fatal, source=${source}):`, err);
  }
}

async function safeInsertRow(
  forgeRunId: string,
  demoMode: string,
): Promise<void> {
  // Local-store write is unconditional — this is what makes GET /api/forge/{id}
  // succeed for fresh uploads even when Butterbase Postgres is unreachable.
  try {
    const { upsertLocalRun } = await import("@/lib/butterbase/local-store");
    await upsertLocalRun({
      id: forgeRunId,
      createdAt: new Date().toISOString(),
      status: "pending",
      stage: "pending",
      demoMode: (demoMode as "live" | "replay" | "hybrid") ?? "live",
      durationsMs: {},
      costUsd: {},
      error: null,
    });
  } catch (err) {
    console.warn("[api/forge] local-store write failed:", err);
  }
  // Best-effort Postgres mirror via butterbase client. Skipped entirely in
  // replay mode — local-store is the source of truth and Postgres DNS may
  // not resolve in offline / hermetic-demo environments.
  if (demoMode === "replay") return;
  try {
    const mod = (await import("@/lib/butterbase/client").catch(() => null)) as
      | {
          persistForgeRun?: (row: {
            id: string;
            status: string;
            stage: string;
            demoMode: string;
          }) => Promise<string>;
        }
      | null;
    if (mod?.persistForgeRun) {
      await mod.persistForgeRun({
        id: forgeRunId,
        status: "queued",
        stage: "intake",
        demoMode: demoMode as "live" | "replay" | "hybrid",
      });
    }
  } catch (err) {
    if (err instanceof Error && err.name === "NoButterbaseDatabaseUrlError") {
      // Expected when no DB is configured; local store is already written
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[api/forge] butterbase persist failed (non-fatal): ${msg}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const fixture = url.searchParams.get("fixture");
  const demoMode = process.env.DEMO_MODE ?? "live";

  // ─── Fixture branch ──────────────────────────────────────────────
  if (fixture) {
    if (fixture !== "hip-replacement") {
      return NextResponse.json(
        { code: "unknown_fixture", message: `Unknown fixture: ${fixture}` },
        { status: 400 },
      );
    }
    // Use the deterministic id so replay cache keys remain stable across
    // re-clicks on the demo button.
    const forgeRunId = DEMO_FIXTURE_ID;
    await safeInsertRow(forgeRunId, demoMode);
    await safeEnqueue(forgeRunId, "fixture");
    const body: StartResult = { forge_run_id: forgeRunId };
    return NextResponse.json(body, { status: 202 });
  }

  // ─── Multipart upload branch ─────────────────────────────────────
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.startsWith("multipart/form-data")) {
    return NextResponse.json(
      {
        code: "unsupported_media_type",
        message:
          "Send multipart/form-data with plan.pdf + patient.json, or use ?fixture=hip-replacement.",
      },
      { status: 415 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { code: "bad_form", message: "Could not parse multipart body." },
      { status: 400 },
    );
  }

  const plan = form.get("plan.pdf");
  const patient = form.get("patient.json");
  if (!(plan instanceof File) || !(patient instanceof File || typeof patient === "string")) {
    return NextResponse.json(
      {
        code: "missing_fields",
        message: "Both plan.pdf and patient.json are required.",
      },
      { status: 400 },
    );
  }

  // Quick size guard — full validation lives in the worker's Stage 1.
  if (plan.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { code: "too_large", message: "plan.pdf exceeds 10MB." },
      { status: 413 },
    );
  }

  const forgeRunId = randomUUID();
  await safeInsertRow(forgeRunId, demoMode);
  // The worker picks up the job and reads inputs from Butterbase Storage.
  // For now in dev: we leave the bytes in memory; the worker can fetch
  // them via the queue's payload. Best-effort.
  await safeEnqueue(forgeRunId, "upload");

  const body: StartResult = { forge_run_id: forgeRunId };
  return NextResponse.json(body, { status: 202 });
}
