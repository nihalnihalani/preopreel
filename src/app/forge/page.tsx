// app/forge/page.tsx — main HUD shell.
//
// Plan 04 §A.1:
//   - Three-panel layout: PreOpUpload (left) + AnatomyGraphViewer (center)
//     + CriticHud (right).
//   - On ?demo=hip-replacement, auto-load the demo fixture and POST to
//     /api/forge immediately, redirecting to /forge/{id}.
//   - Below the panels: ExplainerPlayer collapsed until ready.
//
// This is a client component because the auto-start effect needs the
// search params. The shell layout is composed of server-friendly child
// components where possible.

"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PreOpUpload } from "@/components/PreOpUpload";
import { AnatomyGraphViewer } from "@/components/AnatomyGraphViewer";
import { CriticHud } from "@/components/CriticHud";
import { useStartForgeRun } from "@/lib/api/client";

function ForgePageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const isDemo = sp.get("demo") === "hip-replacement";
  const [autoStarted, setAutoStarted] = useState(false);

  const start = useStartForgeRun();

  // Auto-start the demo fixture on mount when ?demo=hip-replacement.
  useEffect(() => {
    if (!isDemo || autoStarted) return;
    setAutoStarted(true);
    void (async () => {
      try {
        const { forgeRunId } = await start.mutateAsync({
          fixture: "hip-replacement",
        });
        router.replace(`/forge/${forgeRunId}`);
      } catch (err) {
        console.error("[forge] auto-start failed:", err);
      }
    })();
  }, [isDemo, autoStarted]);

  const onStarted = (forgeRunId: string) => {
    router.push(`/forge/${forgeRunId}`);
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-6">
      <div className="mb-6">
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-clinical-100 lg:text-3xl">
          Pre-operative explainer forge
        </h1>
        <p className="mt-1 text-sm text-clinical-300">
          Three panels. Drop the inputs left. Watch Gem build the AnatomyGraph
          center. Watch Mara + Lyra gate the output right.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_480px]">
        <div className="min-h-[640px]">
          <PreOpUpload onStarted={onStarted} demoPrimary={isDemo} />
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

      {isDemo && start.isPending && (
        <div className="mt-6 rounded-lg border border-critic-lyra/40 bg-critic-lyra/10 px-4 py-3 text-sm text-critic-lyra">
          Loading the synthetic phantom hip-replacement demo case…
        </div>
      )}
    </div>
  );
}

export default function ForgePage() {
  return (
    <Suspense fallback={<div className="p-8 text-clinical-300">Loading…</div>}>
      <ForgePageInner />
    </Suspense>
  );
}
