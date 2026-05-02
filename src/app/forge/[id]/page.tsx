"use client";

// app/forge/[id]/page.tsx — bookmarkable run page.
//
// Plan 04 §A.1:
//   - Same three-panel layout, but driven by a real forge_run_id.
//   - SSE-live while pending; read-only once `done`.
//   - Below the panels: ExplainerPlayer (collapsed until ready) + a row
//     of links to /receipt and /explainer.
//
// The component uses the typed API client + useEventStream wherever the
// child components don't own that responsibility. It defers fetching
// the AnatomyGraph + ShotList to lower-level hooks the children own.

import Link from "next/link";
import { use, useMemo } from "react";
import { ArrowRight, FileText, Film } from "lucide-react";
import { PreOpUpload } from "@/components/PreOpUpload";
import { AnatomyGraphViewer } from "@/components/AnatomyGraphViewer";
import { CriticHud } from "@/components/CriticHud";
import { ExplainerPlayer } from "@/components/ExplainerPlayer";
import { useForgeRun } from "@/lib/api/client";

export default function ForgeRunPage({
  params,
}: {
  // Next.js 16: route params arrive as a Promise.
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const runQ = useForgeRun(id);

  const status = runQ.data?.status ?? "pending";
  const isTerminal = status === "done" || status === "failed";
  const isReady = status === "done";

  const subtitle = useMemo(() => {
    if (runQ.isLoading) return "Loading run…";
    if (status === "done") return "Run complete · explainer + audit ready";
    if (status === "failed") return "Run failed — see error below";
    return `Stage: ${runQ.data?.stage ?? "pending"}`;
  }, [runQ.isLoading, runQ.data?.stage, status]);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      {/* Header row */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-clinical-100 lg:text-3xl">
            Forge run
            <span className="ml-2 font-mono text-base text-clinical-300">
              {id.slice(0, 8)}
            </span>
          </h1>
          <p className="mt-1 text-sm text-clinical-300">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={status} />
          {isReady && (
            <>
              <Link
                href={`/forge/${id}/receipt`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-sm font-medium text-clinical-100 hover:border-critic-lyra/40"
              >
                <FileText className="h-4 w-4" />
                Audit PDF
              </Link>
              <Link
                href={`/forge/${id}/explainer`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-critic-lyra px-3 py-1.5 text-sm font-semibold text-ink-950 hover:bg-critic-lyra/90"
              >
                <Film className="h-4 w-4" />
                Watch explainer
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_480px]">
        <div className="min-h-[640px]">
          {/* Once a run is in flight, the upload panel becomes a passive
              recap of the inputs. The user can start a fresh run here. */}
          <PreOpUpload
            onStarted={() => {
              /* navigation handled inside */
            }}
          />
        </div>
        <div className="min-h-[640px]">
          <AnatomyGraphViewer
            forgeRunId={id}
            paused={isTerminal}
          />
        </div>
        <div className="min-h-[640px]">
          <CriticHud forgeRunId={id} paused={isTerminal} />
        </div>
      </div>

      {/* Explainer player below the panels — collapsed until ready */}
      <div className="mt-6 min-h-[420px]">
        <ExplainerPlayer
          forgeRunId={id}
          ready={isReady}
          autoPlay={false}
        />
      </div>

      {status === "failed" && runQ.data?.error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-critic-mara/40 bg-critic-mara/10 px-4 py-3 text-sm text-critic-mara"
        >
          {runQ.data.error}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "done"
      ? "border-critic-accept/40 bg-critic-accept/10 text-critic-accept"
      : status === "failed"
        ? "border-critic-mara/40 bg-critic-mara/10 text-critic-mara"
        : "border-critic-lyra/40 bg-critic-lyra/10 text-critic-lyra";
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wider",
        tone,
      ].join(" ")}
    >
      <span
        className={[
          "h-1.5 w-1.5 rounded-full",
          status === "done"
            ? "bg-critic-accept"
            : status === "failed"
              ? "bg-critic-mara"
              : "animate-pulse bg-critic-lyra",
        ].join(" ")}
      />
      {status}
    </span>
  );
}
