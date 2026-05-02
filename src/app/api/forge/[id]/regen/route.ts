// POST /api/forge/{id}/regen?beat=N
//
// Manual one-shot regen — overrides the 1-regen budget for demo
// recovery. Useful on stage if Lyra accepts a beat with a low score
// and we want to retry once on demand.
//
// Calls into the worker queue's `regenBeat(forgeRunId, beat)` if the
// worker is wired; otherwise no-op + 202.

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;
  const url = new URL(req.url);
  const beatStr = url.searchParams.get("beat");
  if (!beatStr) {
    return NextResponse.json(
      { code: "missing_beat", message: "Provide ?beat=N." },
      { status: 400 },
    );
  }
  const beat = Number(beatStr);
  if (!Number.isInteger(beat) || beat < 0 || beat > 50) {
    return NextResponse.json(
      { code: "bad_beat", message: "Beat must be a non-negative integer ≤ 50." },
      { status: 400 },
    );
  }

  try {
    const mod = (await import("@worker/queue").catch(() => null)) as
      | { regenBeat?: (forgeRunId: string, beat: number) => Promise<void> }
      | null;
    if (mod?.regenBeat) await mod.regenBeat(id, beat);
  } catch (err) {
    console.warn("[api/forge/regen] enqueue failed (non-fatal):", err);
  }

  return NextResponse.json({ ok: true, forgeRunId: id, beat }, { status: 202 });
}
