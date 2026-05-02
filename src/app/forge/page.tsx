// app/forge/page.tsx — main HUD shell.
//
// Plan 04 §A.1:
//   - Three-panel layout: PreOpUpload (left) + AnatomyGraphViewer (center)
//     + CriticHud (right).
//   - Below the panels: ExplainerPlayer collapsed until ready.

"use client";

import { useRouter } from "next/navigation";
import { PreOpUpload } from "@/components/PreOpUpload";
import { AnatomyGraphViewer } from "@/components/AnatomyGraphViewer";
import { CriticHud } from "@/components/CriticHud";

export default function ForgePage() {
  const router = useRouter();

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
