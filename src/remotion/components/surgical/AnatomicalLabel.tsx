// src/remotion/components/surgical/AnatomicalLabel.tsx
//
// Animated callout pointing at an anatomical landmark. Drives off
// `beat.anatomicalFocus` (one component instance per focus item).

import { AbsoluteFill, interpolate, useCurrentFrame, spring, useVideoConfig } from "remotion";

interface AnatomicalLabelProps {
  name: string;
  x: number;
  y: number;
  confidence: number;
}

export const AnatomicalLabel: React.FC<AnatomicalLabelProps> = ({
  name,
  x,
  y,
  confidence,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const drawIn = spring({
    frame: frame - 18,
    fps,
    config: { stiffness: 90, damping: 14 },
  });
  const fadeIn = interpolate(frame, [12, 24], [0, 1], { extrapolateRight: "clamp" });

  // Color band per confidence (matches HUD).
  const tone =
    confidence < 0.6
      ? "#c9384a"
      : confidence < 0.8
        ? "#d49a3a"
        : "#3aa792";

  const labelLen = name.length * 9 + 24;
  const labelX = Math.min(1920 - labelLen - 20, x + 80);
  const labelY = Math.max(20, y - 80);

  // Pretty label — strip "lm-" prefix if present.
  const pretty = name.replace(/^lm-/, "").replace(/-/g, " ");

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* Target ring */}
      <div
        style={{
          position: "absolute",
          left: x - 16,
          top: y - 16,
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: `2px solid ${tone}`,
          opacity: fadeIn * 0.8,
          transform: `scale(${0.7 + drawIn * 0.3})`,
          boxShadow: `0 0 0 4px ${tone}1F`,
        }}
      />

      {/* Connector line (SVG so we can stroke + dasharray) */}
      <svg
        style={{ position: "absolute", inset: 0 }}
        width={1920}
        height={1080}
      >
        <line
          x1={x}
          y1={y}
          x2={labelX + 8}
          y2={labelY + 14}
          stroke={tone}
          strokeWidth={1.2}
          strokeDasharray={120}
          strokeDashoffset={(1 - drawIn) * 120}
          opacity={fadeIn}
        />
      </svg>

      {/* Label box */}
      <div
        style={{
          position: "absolute",
          left: labelX,
          top: labelY,
          padding: "5px 10px",
          borderRadius: 6,
          background: "rgba(15,20,27,0.92)",
          border: `1px solid ${tone}66`,
          color: "#e8eef5",
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 14,
          fontWeight: 500,
          opacity: fadeIn,
          textTransform: "capitalize",
          letterSpacing: 0.2,
        }}
      >
        {pretty}
        <span
          style={{
            marginLeft: 8,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 11,
            color: tone,
          }}
        >
          {confidence.toFixed(2)}
        </span>
      </div>
    </AbsoluteFill>
  );
};
