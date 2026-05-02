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
  if ((process.env.DEMO_MODE ?? "live") === "replay") return null;
  try {
    const mod = (await import("@/lib/butterbase/client").catch(() => null)) as
      | { getCriticScores?: (id: string) => Promise<unknown[]> }
      | null;
    if (mod?.getCriticScores) return await mod.getCriticScores(id);
  } catch (err) {
    if (err instanceof Error && err.name === "NoButterbaseDatabaseUrlError") {
      return null;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[api/forge/critic] butterbase fetch failed: ${msg}`);
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
    if (Array.isArray(json)) return json;
    // Fixture is wrapped: { forge_run_id, persona, beats: [...] }.
    if (json && typeof json === "object" && "beats" in json) {
      const inner = (json as { beats: unknown }).beats;
      return Array.isArray(inner) ? inner : [];
    }
    return [];
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
  // Strip fields outside the strict CriticScore schema so .safeParse passes;
  // fixtures carry extras (e.g. verdict) for human review.
  const KNOWN = [
    "beat_id",
    "anatomical_fidelity",
    "procedure_step_compliance",
    "on_screen_text_violations",
    "feedback",
    "accepted_with_low_score",
    "attempt",
  ] as const;
  const validated: unknown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const stripped: Record<string, unknown> = {};
    for (const k of KNOWN) if (k in o) stripped[k] = o[k];
    const parsed = CriticScore.safeParse(stripped);
    if (parsed.success) validated.push(parsed.data);
  }
  return NextResponse.json(validated);
}
