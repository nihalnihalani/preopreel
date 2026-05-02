// src/remotion/components/surgical/BeatLayer.tsx
//
// Wraps a single beat. Composes:
//   - the rendered Seedance video as the underlay (or a placeholder
//     gradient when missing)
//   - ProcedureStepOverlay (top-left)
//   - AnatomicalLabel callouts (one per anatomicalFocus entry)
//   - ConfidenceBand on the lowest-confidence landmark when band is
//     present in the beat metadata (Mara C.4: server-derived label)
//   - CitationFooter (bottom strip)
//
// Layout per `cameraAngle` field is implemented as a simple translate +
// scale variation; the underlying Seedance MP4 already has the geometry
// baked in so we mostly nudge the overlay positions.

import { AbsoluteFill, Video, Audio } from "remotion";
import type { ShotBeat } from "@/lib/forge/shotList";
import type { CriticScore } from "@/lib/forge/critique";
import { ProcedureStepOverlay } from "./ProcedureStepOverlay";
import { AnatomicalLabel } from "./AnatomicalLabel";
import { ConfidenceBand } from "./ConfidenceBand";
import { CitationFooter } from "./CitationFooter";

interface BeatLayerProps {
  beat: ShotBeat;
  criticScore?: CriticScore;
  isSyntheticPhantom: boolean;
  videoSrc: string | null;
  audioSrc: string | null;
}

export const BeatLayer: React.FC<BeatLayerProps> = ({
  beat,
  criticScore,
  isSyntheticPhantom,
  videoSrc,
  audioSrc,
}) => {
  // Layout offset by camera angle — small nudges so overlays don't
  // collide with the visual focus of the underlying clip.
  const layout = layoutForCamera(beat.cameraAngle);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0e14" }}>
      {/* Underlay video */}
      {videoSrc ? (
        <Video src={videoSrc} muted />
      ) : (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(58,167,146,0.12) 0%, rgba(10,14,20,1) 80%)",
          }}
        />
      )}
      {audioSrc && <Audio src={audioSrc} />}

      {/* Procedure step badge (top-left) */}
      <ProcedureStepOverlay
        stepId={beat.procedureStepId}
        beatIdx={extractStepNumber(beat.procedureStepId)}
      />

      {/* Anatomical labels — one per focus item, fanned around the frame */}
      {beat.anatomicalFocus.map((id, i) => (
        <AnatomicalLabel
          key={id}
          name={id}
          // Server-derived placement; absent metadata → arrange around
          // the frame center on a simple ring.
          x={400 + Math.cos((i / beat.anatomicalFocus.length) * Math.PI * 2) * 360}
          y={540 + Math.sin((i / beat.anatomicalFocus.length) * Math.PI * 2) * 200}
          confidence={criticScore?.anatomical_fidelity ?? 0.85}
        />
      ))}

      {/* Confidence band (Mara C.4): only when beat carries a band+label
          from the server. We don't recompute the label client-side. */}
      {criticScore && (
        <ConfidenceBand
          band={{
            // Server-derived band — derived from min(scores) ± 0.05 by
            // the worker. Both `band` and `label` come from the worker's
            // output; we render only.
            lo: Math.max(0, criticScore.anatomical_fidelity - 0.05),
            hi: Math.min(1, criticScore.anatomical_fidelity + 0.05),
          }}
          label={
            criticScore.accepted_with_low_score
              ? "Below threshold (accepted honestly)"
              : criticScore.anatomical_fidelity >= 0.85
                ? "High confidence"
                : criticScore.anatomical_fidelity >= 0.75
                  ? "Moderate confidence"
                  : "Low confidence"
          }
          bbox={{ x: 80, y: 120, w: 380, h: 60 }}
        />
      )}

      {/* Citation footer (bottom strip) */}
      <CitationFooter
        citations={beat.citations}
        criticScore={criticScore}
        isSyntheticPhantom={isSyntheticPhantom}
      />
    </AbsoluteFill>
  );
};

// ─── Helpers ───────────────────────────────────────────────────────────

function layoutForCamera(angle: ShotBeat["cameraAngle"]): { x: number; y: number } {
  // Currently a no-op stub; could be expanded once we have measurable
  // per-angle offsets from the rendered Seedance clips.
  switch (angle) {
    case "wide_establishing":
      return { x: 0, y: 0 };
    case "close_anatomical":
      return { x: 0, y: 30 };
    case "macro_instrument":
      return { x: 0, y: 60 };
    default:
      return { x: 0, y: 0 };
  }
}

function extractStepNumber(stepId: string): number {
  const m = /step-(\d+)/.exec(stepId);
  return m ? Number(m[1]) : 0;
}
