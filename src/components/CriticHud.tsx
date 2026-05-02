"use client";

// CriticHud — three-panel critic HUD. The Invariant 1 rubric play.
//
// Plan 04 §A.2.3 + master plan §3 row A.4 + Mara G.1 (tooltip on score):
//   Left:    scrolling Mara critique list (subscribes to SSE stage===4 and
//            seeds from /api/forge/{id}/critique on first paint).
//   Middle:  Lyra reject/regen card with the score-evolution graph for the
//            rejected beat. Shows attempt-by-attempt scores so judges see
//            the regen sequence happening.
//   Right:   per-beat score table (subscribes to SSE stage===10 and seeds
//            from /api/forge/{id}/critic). Shows accepted_with_low_score
//            "honest" badges (Mara A.3). Hover any score → tooltip with
//            Lyra's `feedback` string (Mara G.1).
//
// Visually rich on purpose — this is the 0:50–1:00 demo beat.

import { useEffect, useMemo, useRef, useState } from "react";
import { ShieldAlert, RefreshCw, Eye, Info } from "lucide-react";
import type { Critique, CriticScore } from "@/lib/forge/critique";
import {
  useCritiques,
  useCriticScores,
  forgeUrls,
} from "@/lib/api/client";
import { useEventStream, type ConnectionState } from "@/lib/sse/useEventStream";

const FIDELITY_THRESHOLD = 0.75;

interface CriticHudProps {
  forgeRunId: string | null;
  paused?: boolean;
}

interface CriticEvent {
  stage: "4" | "10";
  forgeRunId: string;
  seq?: number;
  critique?: Critique;
  score?: CriticScore;
}

export function CriticHud({ forgeRunId, paused }: CriticHudProps) {
  // Server-component-fetched seed data + live SSE stream merge.
  const critiquesQ = useCritiques(forgeRunId);
  const scoresQ = useCriticScores(forgeRunId);

  const [liveCritiques, setLiveCritiques] = useState<Critique[]>([]);
  const [liveScores, setLiveScores] = useState<CriticScore[]>([]);
  const lastSeqRef = useRef(0);

  const url = forgeRunId ? forgeUrls.stream(forgeRunId) : null;
  const sse = useEventStream<CriticEvent>({
    url,
    paused,
    filter: (e) => e?.stage === "4" || e?.stage === "10",
    onEvent: (ev) => {
      // Mara A.4 — drop out-of-order events.
      if (typeof ev.seq === "number") {
        if (ev.seq < lastSeqRef.current) return;
        lastSeqRef.current = ev.seq;
      }
      if (ev.critique) {
        const incoming = ev.critique;
        setLiveCritiques((prev) => {
          // Append; don't sort — preserve emit order to avoid the
          // "Mara woke up and re-flagged shot 1 above shot 3" bug
          // (Mara A.3.3).
          if (
            prev.some(
              (c: Critique) =>
                c.shot_id === incoming.shot_id &&
                c.excerpt === incoming.excerpt,
            )
          ) {
            return prev;
          }
          return [...prev, incoming];
        });
      }
      if (ev.score) {
        const incoming = ev.score;
        setLiveScores((prev) => {
          // Upsert by (beat_id + attempt) — never overwrite history.
          const key = `${incoming.beat_id}#${incoming.attempt ?? 0}`;
          const i = prev.findIndex(
            (s: CriticScore) => `${s.beat_id}#${s.attempt ?? 0}` === key,
          );
          if (i === -1) return [...prev, incoming];
          const next: CriticScore[] = prev.slice();
          next[i] = incoming;
          return next;
        });
      }
    },
  });

  // Merge seed + live, deduplicated.
  const critiques = useMemo<Critique[]>(() => {
    const seed = critiquesQ.data ?? [];
    const seen = new Set(seed.map((c) => `${c.shot_id}::${c.excerpt}`));
    const merged = seed.slice();
    for (const c of liveCritiques) {
      const k = `${c.shot_id}::${c.excerpt}`;
      if (!seen.has(k)) {
        seen.add(k);
        merged.push(c);
      }
    }
    return merged;
  }, [critiquesQ.data, liveCritiques]);

  const scores = useMemo<CriticScore[]>(() => {
    const seed = scoresQ.data ?? [];
    const all = [...seed];
    for (const s of liveScores) {
      const k = `${s.beat_id}#${s.attempt ?? 0}`;
      const i = all.findIndex(
        (x) => `${x.beat_id}#${x.attempt ?? 0}` === k,
      );
      if (i === -1) all.push(s);
      else all[i] = s;
    }
    return all;
  }, [scoresQ.data, liveScores]);

  // Pick the most-recent rejected beat for the middle panel.
  const rejectedBeat = useMemo(() => findRejectedBeat(scores), [scores]);

  return (
    <section
      className="surface-card flex h-full flex-col rounded-xl"
      aria-label="Critic HUD — Mara critiques and Lyra scores"
    >
      <header className="flex items-start justify-between gap-3 border-b border-ink-700/40 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-clinical-300">
            Stage 4 + 10 · Critic loop
          </h2>
          <p className="mt-1 text-base font-medium text-clinical-100">
            Mara critiques · Lyra reject / regen
          </p>
        </div>
        <ConnectionPill state={sse.status} stale={sse.isStale} />
      </header>

      {/* Three-panel grid — equal-ish columns; middle is wider per plan. */}
      <div className="grid flex-1 grid-cols-1 divide-x divide-ink-700/40 overflow-hidden lg:grid-cols-[1fr_1.2fr_1fr]">
        <MaraPanel critiques={critiques} loading={critiquesQ.isLoading} />
        <RegenPanel rejectedBeat={rejectedBeat} scores={scores} />
        <ScoreTablePanel scores={scores} loading={scoresQ.isLoading} />
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

// ─── Left: Mara critique stream ────────────────────────────────────────

function MaraPanel({
  critiques,
  loading,
}: {
  critiques: Critique[];
  loading: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new critique (newest at bottom; preserves
  // emit order to avoid the Mara A.3.3 instability).
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [critiques.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-700/40 px-4 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-critic-mara">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          Mara · Devil's Advocate
        </span>
        <span className="font-mono text-[10px] text-clinical-300">
          {critiques.length} flag{critiques.length === 1 ? "" : "s"}
        </span>
      </div>
      <div ref={ref} className="flex-1 space-y-2 overflow-y-auto p-3">
        {loading && critiques.length === 0 && <SkeletonRow />}
        {critiques.length === 0 && !loading && (
          <EmptyHint
            text="No flags yet. Mara reviews each beat as the Director drafts it."
          />
        )}
        {critiques.map((c, i) => (
          <CritiqueCard key={`${c.shot_id}-${i}`} critique={c} />
        ))}
      </div>
    </div>
  );
}

function CritiqueCard({ critique }: { critique: Critique }) {
  const [open, setOpen] = useState(false);

  const sevTone =
    critique.severity === "block"
      ? "border-critic-mara/50 bg-critic-mara/10 text-critic-mara"
      : critique.severity === "warn"
        ? "border-critic-warn/50 bg-critic-warn/10 text-critic-warn"
        : "border-clinical-300/30 bg-ink-900/40 text-clinical-300";

  return (
    <article className="surface-card animate-[stream-in_0.4s_ease-out] rounded-lg p-3 text-xs">
      <header className="mb-1.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span
            className={[
              "rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase",
              sevTone,
            ].join(" ")}
          >
            {critique.severity}
          </span>
          <span className="font-mono text-[10px] text-clinical-300">
            {critique.category}
          </span>
        </span>
        <span className="font-mono text-[10px] text-clinical-300">
          {critique.shot_id}
        </span>
      </header>
      <p className="mb-1.5 line-clamp-3 font-mono text-[11px] leading-relaxed text-clinical-100">
        “{critique.excerpt}”
      </p>
      <p className="text-[11px] text-clinical-300">{critique.reason}</p>
      {critique.suggested_revision && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="mt-1.5 text-[10px] font-medium text-critic-lyra hover:underline"
        >
          {open ? "hide" : "view"} suggested revision →
        </button>
      )}
      {open && critique.suggested_revision && (
        <p className="mt-1.5 rounded border border-critic-lyra/30 bg-critic-lyra/5 p-2 font-mono text-[11px] text-critic-lyra">
          “{critique.suggested_revision}”
        </p>
      )}
    </article>
  );
}

// ─── Middle: regen sequence card ───────────────────────────────────────

function RegenPanel({
  rejectedBeat,
  scores,
}: {
  rejectedBeat: string | null;
  scores: CriticScore[];
}) {
  const beatScores = useMemo(() => {
    if (!rejectedBeat) return [];
    return scores
      .filter((s) => s.beat_id === rejectedBeat)
      .sort((a, b) => (a.attempt ?? 0) - (b.attempt ?? 0));
  }, [rejectedBeat, scores]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-700/40 px-4 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-critic-lyra">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Lyra · Reject / Regen
        </span>
        {rejectedBeat && (
          <span className="font-mono text-[10px] text-clinical-300">
            beat {rejectedBeat}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {!rejectedBeat ? (
          <EmptyHint
            text="No rejects yet. When Lyra scores a beat below 0.75, you'll see the regen sequence here."
          />
        ) : (
          <RegenSequence beatScores={beatScores} />
        )}
      </div>
    </div>
  );
}

function RegenSequence({ beatScores }: { beatScores: CriticScore[] }) {
  if (beatScores.length === 0) return null;
  const final = beatScores[beatScores.length - 1]!;
  const acceptedHonest = final.accepted_with_low_score === true;

  return (
    <div className="space-y-3">
      {/* Score-evolution sparkline */}
      <ScoreEvolutionChart attempts={beatScores} />

      {/* Step-by-step timeline */}
      <ol className="relative space-y-3 border-l border-ink-700 pl-5">
        {beatScores.map((s, i) => {
          const minScore = Math.min(
            s.anatomical_fidelity,
            s.procedure_step_compliance,
          );
          const rejected = minScore < FIDELITY_THRESHOLD;
          const isFinal = i === beatScores.length - 1;
          const verdict = rejected && !isFinal ? "REJECT · regen" : isFinal && acceptedHonest ? "ACCEPT (honest)" : isFinal ? "ACCEPT" : "REJECT · regen";
          const tone = rejected
            ? "border-critic-mara bg-critic-mara/10 text-critic-mara"
            : acceptedHonest && isFinal
              ? "border-critic-warn bg-critic-warn/10 text-critic-warn"
              : "border-critic-accept bg-critic-accept/10 text-critic-accept";
          return (
            <li key={i} className="relative">
              <span
                className={[
                  "absolute -left-[26px] grid h-4 w-4 place-items-center rounded-full border-2",
                  rejected
                    ? "border-critic-mara bg-ink-900"
                    : acceptedHonest && isFinal
                      ? "border-critic-warn bg-ink-900"
                      : "border-critic-accept bg-ink-900",
                ].join(" ")}
                aria-hidden="true"
              >
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full",
                    rejected
                      ? "bg-critic-mara"
                      : acceptedHonest && isFinal
                        ? "bg-critic-warn"
                        : "bg-critic-accept",
                  ].join(" ")}
                />
              </span>
              <div className="flex items-center justify-between text-xs">
                <span className="font-mono text-clinical-300">
                  attempt {(s.attempt ?? 0) + 1}
                </span>
                <span
                  className={[
                    "rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase",
                    tone,
                  ].join(" ")}
                >
                  {verdict}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                <ScoreCell
                  label="anat"
                  value={s.anatomical_fidelity}
                  feedback={s.feedback}
                />
                <ScoreCell
                  label="step"
                  value={s.procedure_step_compliance}
                  feedback={s.feedback}
                />
                <ScoreCell
                  label="text"
                  isCount
                  value={s.on_screen_text_violations}
                  feedback={s.feedback}
                />
              </div>
              <p className="mt-1.5 line-clamp-2 text-[11px] italic text-clinical-300">
                {s.feedback}
              </p>
            </li>
          );
        })}
      </ol>

      {acceptedHonest && (
        <div className="rounded border border-critic-warn/40 bg-critic-warn/10 p-2 text-[11px] text-critic-warn">
          <strong>Accepted with low score</strong> — regen budget exhausted; final score below threshold. Surfaced honestly per Mara A.3.
        </div>
      )}
    </div>
  );
}

// Mini sparkline showing min(anat, step) per attempt.
function ScoreEvolutionChart({ attempts }: { attempts: CriticScore[] }) {
  if (attempts.length < 1) return null;
  const W = 240;
  const H = 60;
  const PAD = 6;
  const xs = attempts.map(
    (_, i) =>
      PAD + (i * (W - 2 * PAD)) / Math.max(attempts.length - 1, 1),
  );
  const ys = attempts.map((s) => {
    const v = Math.min(s.anatomical_fidelity, s.procedure_step_compliance);
    return H - PAD - v * (H - 2 * PAD);
  });
  const path = xs
    .map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`)
    .join(" ");
  const thresholdY = H - PAD - FIDELITY_THRESHOLD * (H - 2 * PAD);
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Score evolution across regen attempts"
      className="rounded border border-ink-700/60 bg-ink-900/40"
    >
      <line
        x1={PAD}
        x2={W - PAD}
        y1={thresholdY}
        y2={thresholdY}
        stroke="rgba(201,56,74,0.55)"
        strokeDasharray="3 3"
        strokeWidth={1}
      />
      <text
        x={W - PAD - 2}
        y={thresholdY - 3}
        textAnchor="end"
        className="fill-critic-mara font-mono"
        fontSize={9}
      >
        0.75 floor
      </text>
      <path d={path} fill="none" stroke="#3aa792" strokeWidth={1.5} />
      {xs.map((x, i) => (
        <circle
          key={i}
          cx={x}
          cy={ys[i]}
          r={3}
          className={
            Math.min(
              attempts[i]!.anatomical_fidelity,
              attempts[i]!.procedure_step_compliance,
            ) < FIDELITY_THRESHOLD
              ? "fill-critic-mara"
              : "fill-critic-accept"
          }
        />
      ))}
    </svg>
  );
}

function ScoreCell({
  label,
  value,
  feedback,
  isCount,
}: {
  label: string;
  value: number;
  feedback?: string;
  isCount?: boolean;
}) {
  // Mara G.1: hover any score → tooltip with Lyra feedback string.
  const ok = isCount ? value === 0 : value >= FIDELITY_THRESHOLD;
  const tone = ok
    ? "border-critic-accept/40 bg-critic-accept/10 text-critic-accept"
    : "border-critic-mara/40 bg-critic-mara/10 text-critic-mara";

  return (
    <span
      className={[
        "group relative flex items-center justify-between gap-1 rounded border px-1.5 py-1 font-mono tabular-nums",
        tone,
      ].join(" ")}
      title={feedback ?? ""}
    >
      <span className="text-clinical-300">{label}</span>
      <span>{isCount ? value : value.toFixed(2)}</span>
    </span>
  );
}

// ─── Right: per-beat score table ───────────────────────────────────────

function ScoreTablePanel({
  scores,
  loading,
}: {
  scores: CriticScore[];
  loading: boolean;
}) {
  // For the right panel, show the FINAL accepted score per beat (highest
  // attempt index), but mark the row when it's accepted_with_low_score.
  const final = useMemo(() => {
    const m = new Map<string, CriticScore>();
    for (const s of scores) {
      const a = s.attempt ?? 0;
      const cur = m.get(s.beat_id);
      if (!cur || (cur.attempt ?? 0) < a) m.set(s.beat_id, s);
    }
    return Array.from(m.values()).sort((a, b) =>
      a.beat_id.localeCompare(b.beat_id),
    );
  }, [scores]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-ink-700/40 px-4 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-clinical-300">
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          Per-beat scores
        </span>
        <span className="font-mono text-[10px] text-clinical-300">
          {final.length} beat{final.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && final.length === 0 && (
          <div className="p-3">
            <SkeletonRow />
          </div>
        )}
        {!loading && final.length === 0 ? (
          <div className="p-3">
            <EmptyHint text="Lyra scores each rendered beat at Stage 10. Wait for the first beat to land." />
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-ink-900/95 backdrop-blur">
              <tr className="text-left text-[10px] uppercase tracking-wider text-clinical-300">
                <th className="px-3 py-2">Beat</th>
                <th className="px-2 py-2 text-right">Anat</th>
                <th className="px-2 py-2 text-right">Step</th>
                <th className="px-2 py-2 text-right">Txt</th>
                <th className="px-3 py-2 text-right">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {final.map((s) => (
                <ScoreRow key={s.beat_id} score={s} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ScoreRow({ score }: { score: CriticScore }) {
  const minScore = Math.min(
    score.anatomical_fidelity,
    score.procedure_step_compliance,
  );
  const honest = score.accepted_with_low_score === true;
  const passing = !honest && minScore >= FIDELITY_THRESHOLD && score.on_screen_text_violations === 0;

  return (
    <tr
      className={[
        "border-t border-ink-700/30 transition-colors",
        honest ? "bg-critic-warn/5" : passing ? "" : "bg-critic-mara/5",
      ].join(" ")}
    >
      <td className="px-3 py-2 font-mono text-clinical-100">
        <span className="flex items-center gap-1.5">
          {score.beat_id}
          {honest && (
            <span
              className="rounded border border-critic-warn/40 bg-critic-warn/10 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-critic-warn"
              title="Accepted with low score (regen budget exhausted, surfaced honestly per Mara A.3)"
            >
              honest
            </span>
          )}
        </span>
      </td>
      <ScoreTd
        v={score.anatomical_fidelity}
        feedback={score.feedback}
      />
      <ScoreTd
        v={score.procedure_step_compliance}
        feedback={score.feedback}
      />
      <td
        className={[
          "px-2 py-2 text-right font-mono tabular-nums",
          score.on_screen_text_violations > 0
            ? "text-critic-mara"
            : "text-clinical-300",
        ].join(" ")}
      >
        {score.on_screen_text_violations}
      </td>
      <td className="px-3 py-2 text-right">
        <span
          className={[
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase",
            honest
              ? "border-critic-warn/40 bg-critic-warn/10 text-critic-warn"
              : passing
                ? "border-critic-accept/40 bg-critic-accept/10 text-critic-accept"
                : "border-critic-mara/40 bg-critic-mara/10 text-critic-mara",
          ].join(" ")}
        >
          {honest ? "low" : passing ? "ok" : "fail"}
        </span>
      </td>
    </tr>
  );
}

function ScoreTd({ v, feedback }: { v: number; feedback?: string }) {
  // Mara G.1: tooltip with Lyra feedback on hover.
  const ok = v >= FIDELITY_THRESHOLD;
  return (
    <td
      className={[
        "px-2 py-2 text-right font-mono tabular-nums",
        ok ? "text-clinical-100" : "text-critic-mara",
      ].join(" ")}
      title={feedback ?? ""}
    >
      {v.toFixed(2)}
    </td>
  );
}

// ─── Shared helpers ────────────────────────────────────────────────────

function findRejectedBeat(scores: CriticScore[]): string | null {
  // Find a beat that has more than one attempt — that means it was
  // regenerated. Fall back to the first beat below threshold.
  const byBeat = new Map<string, CriticScore[]>();
  for (const s of scores) {
    if (!byBeat.has(s.beat_id)) byBeat.set(s.beat_id, []);
    byBeat.get(s.beat_id)!.push(s);
  }
  for (const [beatId, list] of byBeat.entries()) {
    if (list.length > 1) return beatId;
  }
  for (const s of scores) {
    const min = Math.min(
      s.anatomical_fidelity,
      s.procedure_step_compliance,
    );
    if (min < FIDELITY_THRESHOLD) return s.beat_id;
  }
  return null;
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
        : "border-clinical-300/40 bg-clinical-300/10 text-clinical-300";
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
      <Info className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-3/4 animate-pulse rounded bg-ink-700/60" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-ink-700/60" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-ink-700/60" />
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="text-balance text-center text-xs text-clinical-300">
      {text}
    </p>
  );
}
