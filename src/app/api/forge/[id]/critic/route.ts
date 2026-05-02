// GET /api/forge/{id}/critic — Lyra's per-beat scores with attempt history.
//
// Returns CriticScore[] including all regen attempts (not just the
// final accepted one). The HUD's middle panel renders the score
// evolution from this list — the rubric play.

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { CriticScore } from "@/lib/forge/critique";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function fromButterbase(id: string): Promise<unknown[] | null> {
  try {
    const mod = (await import("@/lib/butterbase/client").catch(() => null)) as
      | { getCriticScores?: (id: string) => Promise<unknown[]> }
      | null;
    if (mod?.getCriticScores) return await mod.getCriticScores(id);
  } catch (err) {
    console.warn("[api/forge/critic] butterbase fetch failed:", err);
  }
  return null;
}

async function fromReplay(id: string): Promise<unknown[]> {
  try {
    const path = join(
      process.cwd(),
      "data",
      "replay",
      id,
      "10-lyra",
      "scores.json",
    );
    const buf = await fs.readFile(path, "utf-8");
    const json: unknown = JSON.parse(buf);
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  const raw = (await fromButterbase(id)) ?? (await fromReplay(id));
  const validated: unknown[] = [];
  for (const item of raw) {
    const parsed = CriticScore.safeParse(item);
    if (parsed.success) validated.push(parsed.data);
  }
  return NextResponse.json(validated);
}
