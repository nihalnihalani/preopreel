// app/forge/page.tsx — main HUD shell.
//
// Plan 04 §A.1:
//   - Three-panel layout: PreOpUpload (left) + AnatomyGraphViewer (center)
//     + CriticHud (right).
//   - Below the panels: ExplainerPlayer collapsed until ready.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PreOpUpload } from "@/components/PreOpUpload";
import { AnatomyGraphViewer } from "@/components/AnatomyGraphViewer";
import { CriticHud } from "@/components/CriticHud";

export default function ForgePage() {
  const router = useRouter();
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleErr, setSampleErr] = useState<string | null>(null);

  const onStarted = (forgeRunId: string) => {
    router.push(`/forge/${forgeRunId}`);
  };

  const onRunSample = async () => {
    setSampleBusy(true);
    setSampleErr(null);
    try {
      const r = await fetch("/api/forge?fixture=hip-replacement", {
        method: "POST",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { forge_run_id } = (await r.json()) as { forge_run_id: string };
      onStarted(forge_run_id);
    } catch (err) {
      setSampleErr(err instanceof Error ? err.message : String(err));
      setSampleBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-clinical-100 lg:text-3xl">
            Pre-operative explainer forge
          </h1>
          <p className="mt-1 text-sm text-clinical-300">
            Three panels. Drop the inputs left. Watch Gem build the AnatomyGraph
            center. Watch Mara + Lyra gate the output right.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1 lg:items-end">
          <button
            type="button"
            onClick={onRunSample}
            disabled={sampleBusy}
            className="rounded-lg border border-critic-lyra/50 bg-critic-lyra/10 px-4 py-2 text-sm font-semibold text-clinical-100 transition-all hover:bg-critic-lyra/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sampleBusy ? "Starting sample…" : "Run sample case (hip replacement)"}
          </button>
          {sampleErr && (
            <p className="text-xs text-critic-mara" role="alert">
              {sampleErr}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_480px]">
        <div className="min-h-[640px]">
          <PreOpUpload onStarted={onStarted} />
        </div>
        <div className="min-h-[640px]">
          <AnatomyGraphViewer
            forgeRunId={null}
            paused
          />
        </div>
        <div className="min-h-[640px]">
          <CriticHud forgeRunId={null} paused />
        </div>
      </div>
    </div>
  );
}
