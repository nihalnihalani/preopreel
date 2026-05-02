// src/remotion/components/surgical/ConfidenceBand.tsx
//
// Mara C.4: BOTH `band` AND `label` come from the server. No
// client-side recomputation of either value — this prevents the
// "High Confidence" label from drifting away from the underlying band.
//
// Color logic per Mara C.4: red (<0.75 mid), amber (0.75–0.85), green
// (≥0.85). Opacity scales inversely to confidence so we see uncertainty
// where it matters and fade the band where we don't need to.

import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

interface ConfidenceBandProps {
  band: { lo: number; hi: number };  // server-derived
  label: string;                     // server-derived (Mara C.4)
  bbox: { x: number; y: number; w: number; h: number };
}

export const ConfidenceBand: React.FC<ConfidenceBandProps> = ({
  band,
  label,
  bbox,
}) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });

  const mid = (band.lo + band.hi) / 2;
  const tone =
    mid < 0.75 ? "#c9384a" : mid < 0.85 ? "#d49a3a" : "#3aa792";
  // Less opacity when confidence is high; we hide the band when we're sure.
  const opacity = Math.max(0.18, Math.min(0.5, 0.5 - 0.32 * mid));

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: bbox.x,
          top: bbox.y,
          width: bbox.w,
          height: bbox.h,
          borderRadius: 8,
          background: tone,
          opacity: fadeIn * opacity,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: bbox.x + 10,
          top: bbox.y + 10,
          padding: "4px 8px",
          borderRadius: 4,
          background: "rgba(15,20,27,0.85)",
          color: tone,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 11,
          opacity: fadeIn,
          letterSpacing: 0.4,
        }}
      >
        {label} · {band.lo.toFixed(2)}–{band.hi.toFixed(2)}
      </div>
    </AbsoluteFill>
  );
};
