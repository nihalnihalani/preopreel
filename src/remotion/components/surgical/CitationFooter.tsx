// src/remotion/components/surgical/CitationFooter.tsx
//
// Bottom strip: "Source: Procedure Plan §2.3 · NIH PMID:12345678 · Critic Lyra: 0.86".
// Drives off `beat.citations` + `beat.criticScore`. 56px tall, full width,
// fast-read font.

import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Citation } from "@/lib/forge/types";
import type { CriticScore } from "@/lib/forge/critique";

interface CitationFooterProps {
  citations: Citation[];
  criticScore?: CriticScore;
  isSyntheticPhantom: boolean;
}

const FOOTER_HEIGHT = 56;

export const CitationFooter: React.FC<CitationFooterProps> = ({
  citations,
  criticScore,
  isSyntheticPhantom,
}) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });

  const formatCitation = (c: Citation): string => {
    if (c.sourceType === "pmid") return c.pointer;
    if (c.sourceType === "procedure_plan") return `Plan ${c.pointer}`;
    return c.pointer;
  };

  const minScore = criticScore
    ? Math.min(
        criticScore.anatomical_fidelity,
        criticScore.procedure_step_compliance,
      )
    : null;

  const honest = criticScore?.accepted_with_low_score === true;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: FOOTER_HEIGHT,
          background:
            "linear-gradient(180deg, rgba(15,20,27,0) 0%, rgba(15,20,27,0.85) 25%, rgba(10,14,20,0.95) 100%)",
          display: "flex",
          alignItems: "center",
          padding: "0 32px",
          gap: 16,
          opacity: fadeIn,
          fontFamily: "JetBrains Mono, monospace",
          fontSize: 14,
          color: "rgba(232,238,245,0.85)",
        }}
      >
        <span style={{ color: "#9fb3c8", fontWeight: 600 }}>SOURCE</span>

        {citations.slice(0, 3).map((c, i) => (
          <span key={`${c.sourceType}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {i > 0 && <span style={{ color: "rgba(232,238,245,0.3)" }}>·</span>}
            <span>{formatCitation(c)}</span>
          </span>
        ))}

        <span style={{ flex: 1 }} />

        {minScore !== null && (
          <span
            style={{
              padding: "3px 10px",
              borderRadius: 6,
              border: `1px solid ${
                honest
                  ? "#d49a3a"
                  : minScore >= 0.85
                    ? "#3aa792"
                    : minScore >= 0.75
                      ? "#d49a3a"
                      : "#c9384a"
              }66`,
              color: honest
                ? "#d49a3a"
                : minScore >= 0.85
                  ? "#3aa792"
                  : minScore >= 0.75
                    ? "#d49a3a"
                    : "#c9384a",
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            CRITIC LYRA · {minScore.toFixed(2)}
            {honest && " · honest"}
          </span>
        )}

        {isSyntheticPhantom && (
          <span
            style={{
              padding: "3px 10px",
              borderRadius: 999,
              background: "rgba(212,154,58,0.15)",
              color: "#d49a3a",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            phantom
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
};
