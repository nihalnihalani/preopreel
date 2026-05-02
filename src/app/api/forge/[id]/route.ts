// GET /api/forge/{id}
//
// Returns a typed `ForgeRun` row joined with the last-known stage event.
// Optionally includes the resolved ShotList when ?include=shotlist (used
// by the explainer page for chapter markers).
//
// Source of truth is Butterbase. In dev / replay-mode without Butterbase
// configured, we fall back to reading the cached fixture under
// data/replay/{id}/.

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { ForgeRun, ForgeRunStatus } from "@/lib/forge/types";
import type { ShotList } from "@/lib/forge/shotList";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function fetchFromButterbase(id: string): Promise<ForgeRun | null> {
  try {
    const mod = (await import("@/lib/butterbase/client").catch(() => null)) as
      | { getForgeRun?: (id: string) => Promise<ForgeRun | null> }
      | null;
    if (mod?.getForgeRun) return await mod.getForgeRun(id);
  } catch (err) {
    if (err instanceof Error && err.name === "NoButterbaseDatabaseUrlError") {
      return null;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[api/forge/[id]] butterbase fetch failed: ${msg}`);
  }
  return null;
}

async function fetchFromLocalStore(id: string): Promise<ForgeRun | null> {
  try {
    const { getLocalRun } = await import("@/lib/butterbase/local-store");
    return await getLocalRun(id);
  } catch {
    return null;
  }
}

async function fetchFromReplay(id: string): Promise<ForgeRun | null> {
  // Best-effort: when running in replay mode, the prewarm script writes
  // a tiny `run.json` under data/replay/{id}/. If present, parse and
  // return it. This keeps the UI demoable without a Butterbase row.
  try {
    const path = join(process.cwd(), "data", "replay", id, "run.json");
    const buf = await fs.readFile(path, "utf-8");
    return JSON.parse(buf) as ForgeRun;
  } catch {
    return null;
  }
}

async function fetchShotList(id: string): Promise<ShotList | null> {
  try {
    const path = join(
      process.cwd(),
      "data",
      "replay",
      id,
      "03-director",
      "shotlist.json",
    );
    const buf = await fs.readFile(path, "utf-8");
    return JSON.parse(buf) as ShotList;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  const url = new URL(req.url);
  const include = url.searchParams.get("include");

  let run = await fetchFromButterbase(id);
  if (!run) run = await fetchFromLocalStore(id);
  if (!run) run = await fetchFromReplay(id);

  if (!run) {
    // For the demo fixture id, fabricate a minimal "pending" row so the
    // UI can render its skeleton. The SSE stream + critique/critic
    // endpoints will populate it from replay fixtures.
    if (id === "demo-hip-replacement") {
      run = {
        id,
        createdAt: new Date().toISOString(),
        status: "pending" as ForgeRunStatus,
        stage: "pending" as ForgeRunStatus,
        demoMode: (process.env.DEMO_MODE ?? "live") as ForgeRun["demoMode"],
        durationsMs: {},
        costUsd: {},
        error: null,
      };
    } else {
      return NextResponse.json(
        { code: "not_found", message: `Run ${id} not found.` },
        { status: 404 },
      );
    }
  }

  if (include === "shotlist") {
    const shotList = await fetchShotList(id);
    return NextResponse.json({ ...run, shotList });
  }

  return NextResponse.json(run);
}
