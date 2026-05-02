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
  try {
    const mod = (await import("@/lib/butterbase/client").catch(() => null)) as
      | { getCritiques?: (id: string) => Promise<unknown[]> }
      | null;
    if (mod?.getCritiques) return await mod.getCritiques(id);
  } catch (err) {
    console.warn("[api/forge/critique] butterbase fetch failed:", err);
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
  // Filter out malformed entries; never crash the UI on schema drift.
  const validated: unknown[] = [];
  for (const item of raw) {
    const parsed = Critique.safeParse(item);
    if (parsed.success) validated.push(parsed.data);
  }
  return NextResponse.json(validated);
}
