"use client";

// ReceiptViewer — renders the audit-trail PDF inline.
//
// Plan 04 §A.2.4: the 1:00–1:10 demo beat (Invariant 4).
//   - Inline preview via <embed>; react-pdf used as the fallback when
//     embed is blocked (Safari / strict CSP).
//   - Sidebar lists every claim with a citation pointer + the critic
//     that accepted it.
//   - Mara G.2: includes a citation-density sparkline at the top.
//
// The PDF endpoint /api/forge/{id}/receipt 302s to a freshly minted
// signed URL (see api/forge/[id]/receipt/route.ts).

import { useState } from "react";
import { Download, FileSearch, AlertCircle } from "lucide-react";
import type { AuditEntry } from "@/lib/forge/audit";
import { forgeUrls } from "@/lib/api/client";

interface ReceiptViewerProps {
  forgeRunId: string;
  /** Pre-fetched server-side; may be empty until status === done. */
  entries?: AuditEntry[];
}

export function ReceiptViewer({ forgeRunId, entries = [] }: ReceiptViewerProps) {
  const [embedFailed, setEmbedFailed] = useState(false);
  const pdfUrl = forgeUrls.receipt(forgeRunId);

  const claimsCount = entries.length;
  const citationsCount = entries.length; // 1 citation per AuditEntry by schema
  const acceptedByMara = entries.filter((e) =>
    e.criticPasses.includes("mara"),
  ).length;
  const acceptedByLyra = entries.filter((e) =>
    e.criticPasses.includes("lyra"),
  ).length;

  return (
    <section className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      {/* PDF viewer (left) */}
      <div className="surface-card flex h-full flex-col overflow-hidden rounded-xl">
        <header className="flex items-center justify-between border-b border-ink-700/40 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-clinical-300">
              Audit Trail · Invariant 4
            </h2>
            <p className="mt-0.5 text-base font-medium text-clinical-100">
              One page per claim · every claim cited
            </p>
          </div>
          <a
            href={pdfUrl}
            download={`preopreel-${forgeRunId.slice(0, 8)}-audit.pdf`}
            className="inline-flex items-center gap-1.5 rounded border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-xs font-medium text-clinical-100 hover:border-critic-lyra/40"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download
          </a>
        </header>
        <div className="flex-1 bg-ink-950">
          {!embedFailed ? (
            <embed
              src={pdfUrl}
              type="application/pdf"
              width="100%"
              height="100%"
              className="h-full w-full"
              onError={() => setEmbedFailed(true)}
            />
          ) : (
            <PdfFallback url={pdfUrl} />
          )}
        </div>
      </div>

      {/* Sidebar (right) */}
      <aside className="surface-card flex h-full flex-col overflow-hidden rounded-xl">
        <header className="border-b border-ink-700/40 px-4 py-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-clinical-300">
            Claims
          </h3>
          <CitationDensitySparkline entries={entries} />
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <Stat label="Claims" value={claimsCount} />
            <Stat label="Citations" value={citationsCount} />
            <Stat label="Mara passes" value={acceptedByMara} />
            <Stat label="Lyra passes" value={acceptedByLyra} />
          </dl>
        </header>
        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="p-4 text-xs text-clinical-300">
              <FileSearch className="mb-2 h-4 w-4" aria-hidden="true" />
              No audit entries yet. The PDF is generated when the run completes.
            </div>
          ) : (
            <ul className="divide-y divide-ink-700/40 text-xs">
              {entries.map((e) => (
                <li key={e.claimId} className="px-4 py-3">
                  <p className="line-clamp-2 font-mono text-[11px] leading-relaxed text-clinical-100">
                    “{e.narratorLineExcerpt}”
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded border border-critic-lyra/40 bg-critic-lyra/5 px-1.5 py-0.5 font-mono text-[10px] text-critic-lyra">
                      {e.citation.sourceType} · {e.citation.pointer}
                    </span>
                    {e.criticPasses.map((p) => (
                      <span
                        key={p}
                        className={[
                          "rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                          p === "mara"
                            ? "border-critic-mara/40 bg-critic-mara/10 text-critic-mara"
                            : "border-critic-accept/40 bg-critic-accept/10 text-critic-accept",
                        ].join(" ")}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </section>
  );
}

// Mara G.2: citation-density sparkline. One bar per claim; height
// represents the breadth of confidence (hi - lo) so judges see the
// dispersion visually rather than reading numbers.
function CitationDensitySparkline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return null;
  const W = 280;
  const H = 28;
  const barW = Math.max(2, Math.floor(W / Math.max(entries.length, 1)) - 1);
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-[10px] text-clinical-300">
        <span>Citation density</span>
        <span>{entries.length} claims</span>
      </div>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Citation density sparkline"
        className="rounded border border-ink-700/40 bg-ink-900/40"
      >
        {entries.map((e, i) => {
          const x = i * (barW + 1);
          const span = e.confidenceBand.hi - e.confidenceBand.lo;
          const h = Math.max(2, span * (H - 4));
          const y = H - h - 2;
          const tone =
            e.confidenceBand.lo + span / 2 >= 0.8
              ? "#7ba055"
              : e.confidenceBand.lo + span / 2 >= 0.6
                ? "#d49a3a"
                : "#c9384a";
          return (
            <rect
              key={e.claimId}
              x={x}
              y={y}
              width={barW}
              height={h}
              fill={tone}
              opacity={0.85}
            >
              <title>
                {e.narratorLineExcerpt.slice(0, 60)} — band {e.confidenceBand.lo.toFixed(2)}–{e.confidenceBand.hi.toFixed(2)}
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-clinical-300">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-clinical-100">
        {value}
      </dd>
    </>
  );
}

function PdfFallback({ url }: { url: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="surface-card max-w-md rounded-lg p-6 text-center">
        <AlertCircle className="mx-auto mb-3 h-6 w-6 text-critic-warn" />
        <p className="mb-2 text-sm font-semibold text-clinical-100">
          Inline preview blocked
        </p>
        <p className="mb-4 text-xs text-clinical-300">
          Your browser blocks embedded PDFs. The audit trail is available as a download.
        </p>
        <a
          href={url}
          download
          className="inline-flex items-center gap-1.5 rounded bg-critic-lyra px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-critic-lyra/90"
        >
          <Download className="h-3.5 w-3.5" />
          Download audit PDF
        </a>
      </div>
    </div>
  );
}
