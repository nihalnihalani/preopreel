// app/forge/[id]/explainer/page.tsx — full-screen player.
//
// Plan 04 §A.2.5. Server component shell that fetches the ShotList for
// chapter markers and hands it to the client player. The player itself
// streams the MP4 via /api/forge/{id}/explainer (which 302s to a signed
// Butterbase URL — minted lazily per request, Mara E.3).

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ExplainerPlayer } from "@/components/ExplainerPlayer";
import type { ShotList as TShotList } from "@/lib/forge/shotList";
import { ShotList as ShotListSchema } from "@/lib/forge/shotList";

interface ExplainerPageProps {
  params: Promise<{ id: string }>;
}

async function fetchShotList(forgeRunId: string): Promise<TShotList | null> {
  try {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(
      `${base}/api/forge/${encodeURIComponent(forgeRunId)}?include=shotlist`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { shotList?: unknown };
    if (!json.shotList) return null;
    const parsed = ShotListSchema.safeParse(json.shotList);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export default async function ExplainerPage({ params }: ExplainerPageProps) {
  const { id } = await params;
  const shotList = await fetchShotList(id);

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-4 lg:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link
          href={`/forge/${id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900/60 px-3 py-1.5 text-sm font-medium text-clinical-100 hover:border-critic-lyra/40"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <h1 className="text-lg font-semibold tracking-tight text-clinical-100">
          {shotList?.logline ?? "Pre-operative explainer"}
        </h1>
      </div>
      <div className="h-[calc(100vh-120px)] min-h-[480px]">
        <ExplainerPlayer
          forgeRunId={id}
          shotList={shotList}
          ready
          autoPlay
          fullscreen
        />
      </div>
    </div>
  );
}
