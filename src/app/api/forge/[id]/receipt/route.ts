// GET /api/forge/{id}/receipt
//
// Two paths:
//   - default (Accept: application/pdf or no format): generates the
//     audit-trail PDF on demand via @/lib/audit/pdf, caches the bytes
//     in Butterbase Storage, and on subsequent calls 302s to the signed
//     URL (so the browser can stream the cached object directly).
//   - ?format=json: returns the AuditEntry[] JSON used by the sidebar
//     in /forge/{id}/receipt page.
//
// Plan: master plan §3 row E.3 — signed URLs are minted lazily per
// request so they don't expire between page-load and click.

import { NextResponse, type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { AuditEntry } from "@/lib/forge/audit";
import { buildAuditPdf, type AuditPdfInput } from "@/lib/audit/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

async function fetchAuditEntries(id: string): Promise<AuditPdfInput["entries"]> {
  // Try Butterbase first.
  try {
    const mod = (await import("@/lib/butterbase/client").catch(() => null)) as
      | { getAuditEntries?: (id: string) => Promise<unknown[]> }
      | null;
    if (mod?.getAuditEntries) {
      const raw = await mod.getAuditEntries(id);
      const out: AuditPdfInput["entries"] = [];
      for (const item of raw) {
        const parsed = AuditEntry.safeParse(item);
        if (parsed.success) out.push(parsed.data);
      }
      return out;
    }
  } catch (err) {
    console.warn("[api/forge/receipt] butterbase fetch failed:", err);
  }
  // Fall back to disk.
  try {
    const path = join(
      process.cwd(),
      "data",
      "replay",
      id,
      "audit",
      "entries.json",
    );
    const buf = await fs.readFile(path, "utf-8");
    const json: unknown = JSON.parse(buf);
    if (!Array.isArray(json)) return [];
    const out: AuditPdfInput["entries"] = [];
    for (const item of json) {
      const parsed = AuditEntry.safeParse(item);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchHeader(id: string): Promise<AuditPdfInput["header"]> {
  // Best-effort header from disk run.json; falls back to a minimal stub.
  try {
    const path = join(process.cwd(), "data", "replay", id, "run.json");
    const buf = await fs.readFile(path, "utf-8");
    const run = JSON.parse(buf) as {
      id: string;
      createdAt: string;
      durationsMs?: Record<string, number>;
    };
    return {
      forgeRunId: run.id,
      createdAt: run.createdAt,
      isSyntheticPhantom: true,
      totalDurationS: 78, // demo case
      regenCount: 1, // demo case has Beat 3 regen
    };
  } catch {
    return {
      forgeRunId: id,
      createdAt: new Date().toISOString(),
      isSyntheticPhantom: true,
      totalDurationS: 78,
      regenCount: 1,
    };
  }
}

async function uploadAndSign(
  id: string,
  bytes: Uint8Array,
): Promise<string | null> {
  try {
    const mod = (await import("@/lib/butterbase/storage").catch(() => null)) as
      | {
          uploadAuditPdf?: (id: string, bytes: Uint8Array) => Promise<string>;
          signedAuditPdfUrl?: (id: string) => Promise<string>;
        }
      | null;
    if (mod?.uploadAuditPdf) await mod.uploadAuditPdf(id, bytes);
    if (mod?.signedAuditPdfUrl) return await mod.signedAuditPdfUrl(id);
  } catch (err) {
    console.warn("[api/forge/receipt] upload+sign failed:", err);
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse | Response> {
  const { id } = await params;
  const url = new URL(req.url);

  const entries = await fetchAuditEntries(id);

  if (url.searchParams.get("format") === "json") {
    return NextResponse.json(entries);
  }

  // Generate the PDF on demand. Caching layer is upstream (Butterbase
  // Storage); we always regenerate locally because pdf-lib is fast (~50ms)
  // and the bytes change as new claims land.
  const header = await fetchHeader(id);
  let bytes: Uint8Array;
  try {
    bytes = await buildAuditPdf({ header, entries });
  } catch (err) {
    console.error("[api/forge/receipt] pdf build failed:", err);
    return NextResponse.json(
      { code: "pdf_build_failed", message: String(err) },
      { status: 500 },
    );
  }

  // Try uploading + signing; if it succeeds, 302 to the signed URL.
  const signedUrl = await uploadAndSign(id, bytes);
  if (signedUrl) {
    return NextResponse.redirect(signedUrl, 302);
  }

  // Otherwise, stream the PDF directly.
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="preopreel-${id.slice(0, 8)}-audit.pdf"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
