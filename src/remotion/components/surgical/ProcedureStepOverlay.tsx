// src/remotion/components/surgical/ProcedureStepOverlay.tsx
//
// Top-left badge: "Step 3 of 7 — Posterior approach". Drives off
// `beat.procedureStepId`. Slides in over 12 frames; persists; slides out
// at beat end.

import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

interface ProcedureStepOverlayProps {
  stepId: string;
  beatIdx: number; // 1-based ordinal extracted from stepId
  totalSteps?: number;
  label?: string;
}

export const ProcedureStepOverlay: React.FC<ProcedureStepOverlayProps> = ({
  stepId,
  beatIdx,
  totalSteps = 7,
  label,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const enter = interpolate(frame, [0, 12], [-32, 0], {
    extrapolateRight: "clamp",
  });
  const exitStart = Math.max(0, durationInFrames - 12);
  const exit = interpolate(frame, [exitStart, durationInFrames], [0, -32], {
    extrapolateLeft: "clamp",
  });
  const x = enter + exit;

  const alpha = interpolate(
    frame,
    [0, 12, exitStart, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp", extrapolateLeft: "clamp" },
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          top: 32,
          left: 32 + x,
          padding: "8px 14px",
          borderRadius: 8,
          background: "rgba(15, 20, 27, 0.85)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(159,179,200,0.16)",
          color: "#e8eef5",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 14,
          opacity: alpha,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontWeight: 700,
            color: "#3aa792",
          }}
        >
          Step {beatIdx} / {totalSteps}
        </span>
        <span style={{ color: "rgba(232,238,245,0.4)" }}>·</span>
        <span style={{ fontWeight: 500 }}>
          {label ?? stepId.replace(/^step-\d+-/, "").replace(/-/g, " ")}
        </span>
      </div>
    </AbsoluteFill>
  );
};
