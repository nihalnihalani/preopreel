"use client";

// ExplainerPlayer — full-screen MP4 player with chapter markers per beat.
//
// Plan 04 §A.2.5:
//   - native <video controls playsInline> against /api/forge/{id}/explainer
//     (which 302s to a freshly-minted signed URL — Mara E.3)
//   - chapter markers per ShotList.beats[]; click a chapter to seek
//   - auto-plays in demo mode when `autoPlay` is set
//
// The player is the 0:28–0:50 demo beat. Synthetic-phantom badge stays
// visible in the chrome (plan 04 risk: full-screen hiding the label).

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Maximize2 } from "lucide-react";
import type { ShotList } from "@/lib/forge/shotList";
import { forgeUrls } from "@/lib/api/client";
import { DemoBadge } from "@/components/DemoBadge";

interface ExplainerPlayerProps {
  forgeRunId: string;
  shotList?: ShotList | null;
  autoPlay?: boolean;
  /** When true, the player fills the viewport. */
  fullscreen?: boolean;
  /** When the run isn't done yet, render a friendly placeholder. */
  ready: boolean;
}

export function ExplainerPlayer({
  forgeRunId,
  shotList,
  autoPlay,
  fullscreen,
  ready,
}: ExplainerPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const url = forgeUrls.explainer(forgeRunId);

  // Beat boundaries in seconds, derived from cumulative beat durations.
  const beatBoundaries = (() => {
    if (!shotList) return [];
    let acc = 0;
    return shotList.beats.map((b) => {
      const start = acc;
      acc += b.durationS;
      return { id: b.id, start, end: acc, beat: b };
    });
  })();

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onMeta = () => setDuration(v.duration);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    if (!playing) void v.play();
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const requestFullscreen = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.requestFullscreen) void v.requestFullscreen();
  };

  if (!ready) {
    return (
      <section className="surface-card grid h-full place-items-center rounded-xl p-8">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full border border-critic-lyra/30 bg-critic-lyra/10">
            <span className="ring-pulse h-2 w-2 rounded-full bg-critic-lyra" />
          </span>
          <p className="text-sm text-clinical-300">
            Explainer rendering — Stage 12 (Remotion). Streams live once the
            critic loop accepts the final beat.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={[
        "surface-card relative flex flex-col overflow-hidden rounded-xl",
        fullscreen ? "h-screen" : "h-full",
      ].join(" ")}
      aria-label="Pre-operative explainer player"
    >
      {/* Persistent demo badge in chrome — plan 04 risk: full-screen
          must not hide the synthetic-phantom label. */}
      <div className="absolute right-3 top-3 z-10">
        <DemoBadge variant="compact" />
      </div>

      <div className="relative flex-1 bg-black">
        <video
          ref={videoRef}
          src={url}
          autoPlay={autoPlay}
          playsInline
          preload="auto"
          controls={false}
          className="h-full w-full object-contain"
        >
          {shotList?.beats.map((b) => (
            <track
              key={b.id}
              kind="captions"
              srcLang="en"
              src={`#beat-${b.id}`}
              label={`Beat ${b.id}`}
            />
          ))}
        </video>
      </div>

      {/* Custom controls bar */}
      <div className="border-t border-ink-700/60 bg-ink-950/95 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            className="grid h-9 w-9 place-items-center rounded-full bg-critic-lyra text-ink-950 hover:bg-critic-lyra/90"
          >
            {playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </button>
          <div className="flex-1">
            <ChapterTrack
              beats={beatBoundaries}
              currentTime={currentTime}
              duration={duration}
              onSeek={seekTo}
            />
          </div>
          <span className="font-mono text-xs tabular-nums text-clinical-300">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <button
            type="button"
            onClick={requestFullscreen}
            aria-label="Enter fullscreen"
            className="rounded p-1.5 text-clinical-300 hover:bg-ink-800 hover:text-clinical-100"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
        {beatBoundaries.length > 0 && (
          <CurrentBeatLine
            current={beatBoundaries.find(
              (b) => currentTime >= b.start && currentTime < b.end,
            )}
          />
        )}
      </div>
    </section>
  );
}

function ChapterTrack({
  beats,
  currentTime,
  duration,
  onSeek,
}: {
  beats: { id: string; start: number; end: number; beat: ShotList["beats"][number] }[];
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
}) {
  if (duration <= 0 || beats.length === 0) {
    return <div className="h-1.5 w-full rounded bg-ink-800" />;
  }
  return (
    <div className="relative h-2 w-full rounded bg-ink-800">
      {/* Progress fill */}
      <div
        className="absolute inset-y-0 left-0 rounded bg-critic-lyra/70"
        style={{ width: `${(currentTime / duration) * 100}%` }}
      />
      {/* Chapter markers */}
      {beats.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onSeek(b.start)}
          aria-label={`Seek to beat ${b.id}`}
          className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-clinical-100/40 hover:bg-clinical-100"
          style={{ left: `${(b.start / duration) * 100}%` }}
          title={`${b.id} · ${b.beat.cameraAngle}`}
        />
      ))}
    </div>
  );
}

function CurrentBeatLine({
  current,
}: {
  current?: { id: string; beat: ShotList["beats"][number] };
}) {
  if (!current) return null;
  return (
    <div className="mt-2 flex items-center gap-2 text-xs">
      <span className="font-mono text-[10px] uppercase tracking-wider text-clinical-300">
        Now
      </span>
      <span className="font-mono text-clinical-300">{current.id}</span>
      <span className="text-clinical-300">·</span>
      <span className="line-clamp-1 text-clinical-100">
        {current.beat.narratorLine}
      </span>
    </div>
  );
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}
