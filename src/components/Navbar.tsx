// Navbar — top bar.
//
// Per plan 04 §A.2.6:
//   - Left: PreOpReel wordmark + DemoBadge (when on demo path).
//   - Center: Seed lineup pill (Seed 2.0 / Seedream 5.0 / Seedance 2.0 / Seed Speech 2.0).
//   - Right: invariant indicators (4 dots) + DEMO_MODE indicator.
//
// Server component — reads NEXT_PUBLIC_DEMO_MODE at render. The right-side
// invariant indicators are static (the live values come from /api/healthz
// rendered into the DebugInvariantPanel, behind a flag).

import Link from "next/link";
import { DemoBadge } from "@/components/DemoBadge";

const SEED_LINEUP = [
  "Seed 2.0",
  "Seedream 5.0",
  "Seedance 2.0",
  "Seed Speech 2.0",
] as const;

const INVARIANTS = [
  { id: 1, label: "Critic loop" },
  { id: 2, label: "Seed pinning" },
  { id: 3, label: "Hermetic replay" },
  { id: 4, label: "Audit trail" },
] as const;

export function Navbar() {
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE ?? "live";

  return (
    <header className="sticky top-0 z-40 border-b border-ink-700/60 bg-ink-950/80 backdrop-blur supports-[backdrop-filter]:bg-ink-950/60">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-6 px-6">
        {/* ─── Left: wordmark + demo badge ─────────────────────────────── */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 transition-opacity hover:opacity-80"
            aria-label="PreOpReel home"
          >
            <span
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-critic-lyra to-seed-500 font-mono text-sm font-bold text-ink-950"
            >
              PR
            </span>
            <span className="font-semibold tracking-tight text-clinical-100">
              PreOpReel
            </span>
          </Link>
          <DemoBadge variant="compact" />
        </div>

        {/* ─── Center: Seed lineup pill ────────────────────────────────── */}
        <nav
          aria-label="BytePlus Seed model lineup"
          className="hidden items-center gap-2 rounded-full border border-ink-700/70 bg-ink-900/60 px-3 py-1.5 md:flex"
        >
          {SEED_LINEUP.map((m, i) => (
            <span key={m} className="flex items-center gap-2">
              {i > 0 && <span className="text-ink-700">·</span>}
              <span className="text-xs font-medium text-clinical-300">{m}</span>
            </span>
          ))}
        </nav>

        {/* ─── Right: invariant dots + demo mode ────────────────────────── */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 rounded-full border border-ink-700/70 bg-ink-900/40 px-2.5 py-1"
            aria-label="Four invariants"
          >
            {INVARIANTS.map((inv) => (
              <span
                key={inv.id}
                title={`Invariant ${inv.id} — ${inv.label}`}
                className="h-1.5 w-1.5 rounded-full bg-critic-lyra"
                aria-hidden="true"
              />
            ))}
          </div>
          <span
            className="rounded-md border border-ink-700/70 bg-ink-900/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-clinical-300"
            aria-label={`Demo mode: ${demoMode}`}
          >
            {demoMode}
          </span>
        </div>
      </div>
    </header>
  );
}
