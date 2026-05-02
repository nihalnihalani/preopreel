// GET /api/forge/{id}/explainer — 302 → freshly signed Butterbase URL.
//
// Mara E.3 mitigation: the signed URL is minted PER REQUEST so it can't
// expire between page-load and click. The browser hits this route, gets
// a 302 to a short-lived (e.g., 60s) signed URL, and follows it to
// download the MP4.
//
// In dev / replay-mode without Butterbase storage, we stream the local
// MP4 from data/explainers/{id}.mp4 directly with proper byte-range
// support so the <video> element can seek without a 206-capable origin.

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs, createReadStream, type Stats } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function signedUrl(id: string): Promise<string | null> {
  try {
    const mod = (await import("@/lib/butterbase/storage").catch(() => null)) as
      | { signedExplainerUrl?: (id: string) => Promise<string> }
      | null;
    if (mod?.signedExplainerUrl) return await mod.signedExplainerUrl(id);
  } catch (err) {
    console.warn("[api/forge/explainer] sign failed:", err);
  }
  return null;
}

async function streamLocal(
  id: string,
  rangeHeader: string | null,
): Promise<Response> {
  const path = join(process.cwd(), "data", "explainers", `${id}.mp4`);
  let stat: Stats;
  try {
    stat = await fs.stat(path);
  } catch {
    return NextResponse.json(
      { code: "not_found", message: "Explainer not yet rendered." },
      { status: 404 },
    );
  }
  const size = stat.size;

  // Honor byte-range requests for <video> seeking.
  if (rangeHeader) {
    const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : size - 1;
      const chunk = end - start + 1;
      const node = createReadStream(path, { start, end });
      const web = Readable.toWeb(node) as unknown as ReadableStream;
      return new Response(web, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(chunk),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=60",
        },
      });
    }
  }

  const node = createReadStream(path);
  const web = Readable.toWeb(node) as unknown as ReadableStream;
  return new Response(web, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=60",
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse | Response> {
  const { id } = await params;

  // Mara E.3 — try to mint a fresh signed URL.
  const url = await signedUrl(id);
  if (url) {
    return NextResponse.redirect(url, 302);
  }

  // Fall back to streaming the local file (dev / hermetic replay path).
  return streamLocal(id, req.headers.get("range"));
}
