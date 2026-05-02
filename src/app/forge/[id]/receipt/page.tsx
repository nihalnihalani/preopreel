// app/forge/[id]/receipt/page.tsx — audit-trail PDF preview.
//
// Plan 04 §A.2.4. Server component shell that fetches the AuditEntry[]
// from the JSON sibling endpoint and hands them to the client viewer.
//
// The actual PDF is fetched in the iframe via /api/forge/{id}/receipt
// (which 302s to a signed URL).

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ReceiptViewer } from "@/components/ReceiptViewer";
import type { AuditEntry } from "@/lib/forge/audit";
import { AuditEntry as AuditEntrySchema } from "@/lib/forge/audit";

interface ReceiptPageProps {
  params: Promise<{ id: string }>;
}

async function fetchAuditEntries(forgeRunId: string): Promise<AuditEntry[]> {
  // Server-side fetch using the same endpoint pattern; no CORS concerns
  // because we run on the same origin.
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(
      `${base}/api/forge/${encodeURIComponent(forgeRunId)}/receipt?format=json`,
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    const parsed = AuditEntrySchema.array().safeParse(json);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const { id } = await params;
  const entries = await fetchAuditEntries(id);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href={`/forge/${id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-sm font-medium text-clinical-100 hover:border-critic-lyra/40"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to run
        </Link>
        <h1 className="text-lg font-semibold tracking-tight text-clinical-100">
          Audit Trail · <span className="font-mono">{id.slice(0, 8)}</span>
        </h1>
      </div>
      <div className="h-[calc(100vh-180px)] min-h-[600px]">
        <ReceiptViewer forgeRunId={id} entries={entries} />
      </div>
    </div>
  );
}
