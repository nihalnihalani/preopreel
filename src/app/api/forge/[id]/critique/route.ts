// GET /api/forge/{id}/critique — Mara's pre-render critiques.
//
// Joined `critiques` rows from Butterbase, Zod-validated, returned as
// Critique[]. Falls back to the replay fixture under
// data/replay/{id}/04-mara/critiques.json when Butterbase isn't wired.

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { Critique } from "@/lib/forge/critique";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function fromButterbase(id: string): Promise<unknown[] | null> {
  if ((process.env.DEMO_MODE ?? "replay") === "replay") return null;
  try {
    const mod = (await import("@/lib/butterbase/client").catch(() => null)) as
      | { getCritiques?: (id: string) => Promise<unknown[]> }
      | null;
    if (mod?.getCritiques) return await mod.getCritiques(id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[api/forge/critique] butterbase fetch failed: ${msg}`);
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
      "04-mara",
      "critiques.json",
    );
    const buf = await fs.readFile(path, "utf-8");
    const json: unknown = JSON.parse(buf);
    if (Array.isArray(json)) return json;
    // Fixture is wrapped: { forge_run_id, persona, critiques: [...] }.
    if (json && typeof json === "object" && "critiques" in json) {
      const inner = (json as { critiques: unknown }).critiques;
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
  // Strip fields outside the strict Critique schema so .safeParse passes;
  // fixtures carry extras (e.g. source_pointer_required) for human review.
  const KNOWN = [
    "shot_id",
    "severity",
    "category",
    "excerpt",
    "reason",
    "suggested_revision",
  ] as const;
  const validated: unknown[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const stripped: Record<string, unknown> = {};
    for (const k of KNOWN) if (k in o) stripped[k] = o[k];
    const parsed = Critique.safeParse(stripped);
    if (parsed.success) validated.push(parsed.data);
  }
  return NextResponse.json(validated);
}
