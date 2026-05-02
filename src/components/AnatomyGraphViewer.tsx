"use client";

// AnatomyGraphViewer — live JSON tree of the AnatomyGraph as it builds.
//
// Plan 04 §A.2.2: the 0:18–0:28 demo beat.
//   - subscribes to /api/forge/{id}/stream filtered to stage === "2c"
//   - merges partial graph events into local state
//   - flashes newly-arrived nodes for 800ms (stream-in animation)
//   - confidence chip per landmark, color-banded per Mara C.4
//     (band + label both come from the server; no client recomputation
//     of the human-readable label)
//
// When the run is complete, the component still renders the final graph
// from the cached query, no flashing.

import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Activity } from "lucide-react";
import type { Landmark, AnatomyGraph } from "@/lib/forge/anatomyGraph";
import { useEventStream, type ConnectionState } from "@/lib/sse/useEventStream";
import { forgeUrls } from "@/lib/api/client";

interface AnatomyGraphViewerProps {
  forgeRunId: string | null;
  /** Optional initial graph fetched server-side / from cache. */
  initialGraph?: AnatomyGraph | null;
  /** Stop the SSE subscription; true once status is terminal. */
  paused?: boolean;
}

/**
 * SSE event shape emitted by the worker for stage 2c.
 * The worker streams partial AnatomyGraph patches as Gem extracts each
 * landmark; we reduce them into a single AnatomyGraph for the tree.
 */
interface AnatomyEvent {
  stage: "2c";
  forgeRunId: string;
  /** Sequence number for ordering; higher = newer (Mara A.4). */
  seq?: number;
  /** Either a new landmark or a relationship; never both. */
  landmark?: Landmark;
  relationship?: AnatomyGraph["relationships"][number];
  /** When set, replaces the patient/procedure header. */
  header?: Pick<AnatomyGraph, "patient" | "procedure">;
  /** Server-derived confidence label (Mara C.4). */
  confidenceLabel?: string;
}

export function AnatomyGraphViewer({
  forgeRunId,
  initialGraph,
  paused,
}: AnatomyGraphViewerProps) {
  const [graph, setGraph] = useState<Partial<AnatomyGraph>>(
    initialGraph ?? {},
  );
  // Track recently-arrived landmark ids for the 800ms pulse.
  const [pulsing, setPulsing] = useState<Set<string>>(new Set());
  // Track expansion state per anatomical-system bucket.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const lastSeqRef = useRef(0);

  const url = forgeRunId ? forgeUrls.stream(forgeRunId) : null;

  const sse = useEventStream<AnatomyEvent>({
    url,
    paused,
    filter: (e) => e?.stage === "2c",
    onEvent: (ev) => {
      // Mara A.4: drop out-of-order events. Worker stamps a monotonic
      // sequence number per forge_run_id; if we receive a lower one,
      // it's a replay or jitter — ignore.
      if (typeof ev.seq === "number") {
        if (ev.seq < lastSeqRef.current) return;
        lastSeqRef.current = ev.seq;
      }

      setGraph((prev) => {
        const next: Partial<AnatomyGraph> = { ...prev };
        if (ev.header) {
          next.patient = ev.header.patient;
          next.procedure = ev.header.procedure;
        }
        if (ev.landmark) {
          const list = (next.landmarks ?? []).slice();
          // upsert by id
          const i = list.findIndex((l) => l.id === ev.landmark!.id);
          if (i === -1) list.push(ev.landmark);
          else list[i] = ev.landmark;
          next.landmarks = list;
        }
        if (ev.relationship) {
          const list = (next.relationships ?? []).slice();
          list.push(ev.relationship);
          next.relationships = list;
        }
        return next;
      });

      if (ev.landmark) {
        const id = ev.landmark.id;
        setPulsing((p) => {
          const n = new Set(p);
          n.add(id);
          return n;
        });
        // 800ms pulse, then clear.
        setTimeout(() => {
          setPulsing((p) => {
            if (!p.has(id)) return p;
            const n = new Set(p);
            n.delete(id);
            return n;
          });
        }, 800);
      }
    },
  });

  // Group landmarks by AnatomicalSystem for the tree layout.
  const grouped = useMemo(() => {
    const m = new Map<string, Landmark[]>();
    (graph.landmarks ?? []).forEach((l) => {
      if (!m.has(l.anatomicalSystem)) m.set(l.anatomicalSystem, []);
      m.get(l.anatomicalSystem)!.push(l);
    });
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [graph.landmarks]);

  return (
    <section
      className="surface-card flex h-full flex-col rounded-xl"
      aria-label="Anatomy graph viewer"
    >
      <header className="flex items-start justify-between gap-3 border-b border-ink-700/40 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-clinical-300">
            Stage 2c · Gem · AnatomyGraph
          </h2>
          <p className="mt-1 text-base font-medium text-clinical-100">
            {graph.procedure?.name ?? "Awaiting procedure plan…"}
          </p>
          {graph.patient && (
            <p className="text-xs text-clinical-300">
              Patient {graph.patient.id} · {graph.patient.age}y · {graph.patient.sex} · BMI {graph.patient.bmi.toFixed(1)}
            </p>
          )}
        </div>
        <ConnectionPill state={sse.status} stale={sse.isStale} />
      </header>

      <div className="flex-1 overflow-auto px-5 py-4">
        {grouped.length === 0 ? (
          <EmptyState status={sse.status} />
        ) : (
          <ul className="space-y-3 font-mono text-sm">
            {grouped.map(([system, list]) => {
              const isCollapsed = collapsed.has(system);
              return (
                <li key={system}>
                  <button
                    type="button"
                    onClick={() => {
                      setCollapsed((p) => {
                        const n = new Set(p);
                        if (n.has(system)) n.delete(system);
                        else n.add(system);
                        return n;
                      });
                    }}
                    className="flex items-center gap-1.5 text-clinical-300 hover:text-clinical-100"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                    <span className="uppercase tracking-wider">{system}</span>
                    <span className="text-clinical-300">({list.length})</span>
                  </button>
                  {!isCollapsed && (
                    <ul className="ml-5 mt-2 space-y-1.5 border-l border-ink-700/40 pl-3">
                      {list.map((lm) => (
                        <LandmarkRow
                          key={lm.id}
                          landmark={lm}
                          flashing={pulsing.has(lm.id)}
                        />
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Relationships pane */}
        {graph.relationships && graph.relationships.length > 0 && (
          <div className="mt-6 border-t border-ink-700/40 pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-clinical-300">
              Relationships ({graph.relationships.length})
            </h3>
            <ul className="space-y-1 font-mono text-xs text-clinical-300">
              {graph.relationships.slice(0, 12).map((r, i) => (
                <li key={i}>
                  <span className="text-clinical-100">{r.sourceLandmarkId}</span>
                  <span className="mx-1 text-critic-lyra">{r.relation}</span>
                  <span className="text-clinical-100">{r.targetLandmarkId}</span>
                </li>
              ))}
              {graph.relationships.length > 12 && (
                <li className="text-clinical-300">
                  + {graph.relationships.length - 12} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {sse.isStale && (
        <div
          role="status"
          className="border-t border-critic-warn/40 bg-critic-warn/10 px-5 py-2 text-xs text-critic-warn"
        >
          <span className="blink-amber">●</span> SSE heartbeat lost — reconnecting…
        </div>
      )}
    </section>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function LandmarkRow({
  landmark,
  flashing,
}: {
  landmark: Landmark;
  flashing: boolean;
}) {
  const { lo, hi } = landmark.confidenceBand;
  const mid = (lo + hi) / 2;
  const tone =
    mid < 0.6 ? "mara" : mid < 0.8 ? "warn" : "accept";
  const toneClass =
    tone === "mara"
      ? "border-critic-mara/40 bg-critic-mara/10 text-critic-mara"
      : tone === "warn"
        ? "border-critic-warn/40 bg-critic-warn/10 text-critic-warn"
        : "border-critic-accept/40 bg-critic-accept/10 text-critic-accept";

  return (
    <li
      className={[
        "flex items-center justify-between gap-2 rounded px-2 py-1 transition-colors",
        flashing && "bg-critic-lyra/10 ring-1 ring-critic-lyra/40",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="flex items-center gap-2 truncate text-clinical-100">
        <span className="text-clinical-300">{landmark.id}</span>
        <span className="text-clinical-300">·</span>
        <span className="truncate">{landmark.label}</span>
      </span>
      <span
        className={[
          "shrink-0 rounded border px-1.5 py-0.5 text-[10px] tabular-nums",
          toneClass,
        ].join(" ")}
        title={`Confidence band ${lo.toFixed(2)} – ${hi.toFixed(2)}`}
      >
        {lo.toFixed(2)}–{hi.toFixed(2)}
      </span>
    </li>
  );
}

function ConnectionPill({
  state,
  stale,
}: {
  state: ConnectionState;
  stale: boolean;
}) {
  const tone =
    state === "open" && !stale
      ? "border-critic-accept/40 bg-critic-accept/10 text-critic-accept"
      : state === "reconnecting" || stale
        ? "border-critic-warn/40 bg-critic-warn/10 text-critic-warn"
        : state === "connecting"
          ? "border-clinical-300/40 bg-clinical-300/10 text-clinical-300"
          : "border-ink-700 bg-ink-900 text-clinical-300";

  const label =
    stale && state === "open"
      ? "stale"
      : state === "open"
        ? "live"
        : state;

  return (
    <span
      role="status"
      className={[
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        tone,
      ].join(" ")}
    >
      <Activity className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function EmptyState({ status }: { status: ConnectionState }) {
  const message =
    status === "open" || status === "connecting"
      ? "Gem is reading the procedure plan and extracting anatomical landmarks…"
      : status === "reconnecting"
        ? "Reconnecting to the SSE trace stream…"
        : "Run a forge job to start the AnatomyGraph build.";
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="flex max-w-xs flex-col items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full border border-critic-lyra/30 bg-critic-lyra/10">
          <span className="ring-pulse h-2 w-2 rounded-full bg-critic-lyra" />
        </span>
        <p className="text-sm text-clinical-300">{message}</p>
      </div>
    </div>
  );
}
