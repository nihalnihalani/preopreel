// src/remotion/components/surgical/IntroCard.tsx
//
// 3-second opener. Shows the surgeon name + the synthetic-phantom badge.
// Drives off props.isSyntheticPhantom — never hides the label.

import { AbsoluteFill, interpolate, useCurrentFrame, spring, useVideoConfig } from "remotion";

interface IntroCardProps {
  surgeonName: string;
  procedureName: string;
  isSyntheticPhantom: boolean;
}

export const IntroCard: React.FC<IntroCardProps> = ({
  surgeonName,
  procedureName,
  isSyntheticPhantom,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  const subtitleEntry = spring({
    frame: frame - 12,
    fps,
    config: { stiffness: 90, damping: 14 },
  });

  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(58,167,146,0.18) 0%, rgba(10,14,20,1) 70%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        color: "#e8eef5",
        fontFamily: "Inter, system-ui, sans-serif",
        opacity: fadeIn,
      }}
    >
      {isSyntheticPhantom && (
        <div
          style={{
            marginBottom: 32,
            padding: "8px 18px",
            borderRadius: 999,
            border: "1.5px solid #d49a3a",
            color: "#d49a3a",
            fontSize: 13,
            letterSpacing: 2,
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          Synthetic Phantom · Demo Case
        </div>
      )}

      <div
        style={{
          fontSize: 72,
          fontWeight: 800,
          letterSpacing: -2,
          textAlign: "center",
          maxWidth: 1500,
        }}
      >
        Your pre-operative explainer
      </div>

      <div
        style={{
          marginTop: 20,
          fontSize: 22,
          color: "#9fb3c8",
          maxWidth: 1100,
          textAlign: "center",
          textWrap: "balance",
          opacity: subtitleEntry,
          transform: `translateY(${(1 - subtitleEntry) * 12}px)`,
        }}
      >
        {procedureName}
      </div>

      <div
        style={{
          marginTop: 28,
          fontSize: 16,
          color: "#486581",
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
        }}
      >
        Prepared by {surgeonName}
      </div>

      <div
        style={{
          marginTop: 48,
          fontSize: 12,
          color: "#486581",
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        Informed-consent communication tool · Not a medical device
      </div>
    </AbsoluteFill>
  );
};
