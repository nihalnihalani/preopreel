// src/remotion/compositions/PreOpExplainer.tsx
//
// Plan 04 §B.1.1 + master plan §5: top-level Remotion composition.
// Reads ShotList from props, sequences beats with <Sequence>; intro
// 3s, outro 2s, beats from the ShotList in between.
//
// Resolution is explicit landscape per plan 04 §B.1.1 — NOT portrait.

import { z } from "zod";
import { AbsoluteFill, Sequence, Audio, Video, staticFile } from "remotion";
import { ShotList } from "@/lib/forge/shotList";
import { CriticScore } from "@/lib/forge/critique";
import { BeatLayer } from "@/remotion/components/surgical/BeatLayer";
import { IntroCard } from "@/remotion/components/surgical/IntroCard";

// ─── Props schema ──────────────────────────────────────────────────────

export const propsSchema = z.object({
  forgeRunId: z.string().min(1),
  shotList: ShotList,
  criticScores: z.array(CriticScore).default([]),
  surgeonName: z.string().default("Dr. K. Chen, MD (synthetic)"),
  isSyntheticPhantom: z.boolean().default(true),
  // Optional — when present, rendered MP4 fixtures live under /static
  // and the BeatLayer plays them as the underlay.
  beatVideoBaseDir: z.string().default(""),
});

export type PreOpExplainerProps = z.infer<typeof propsSchema>;

// ─── Defaults (used by Remotion Studio preview) ────────────────────────

export const defaultProps: PreOpExplainerProps = {
  forgeRunId: "demo-hip-replacement",
  surgeonName: "Dr. K. Chen, MD (synthetic)",
  isSyntheticPhantom: true,
  beatVideoBaseDir: "",
  shotList: {
    logline:
      "A 90-second walkthrough of your hip-replacement procedure, " +
      "personalized for your anatomy and your surgeon's plan.",
    beats: [
      {
        id: "beat-01",
        durationS: 8,
        procedureStepId: "step-01-incision",
        anatomicalFocus: ["lm-greater-trochanter", "lm-skin"],
        cameraAngle: "wide_establishing",
        narratorLine:
          "Your surgeon will begin with a curved skin incision over the greater trochanter.",
        citations: [
          {
            sourceType: "procedure_plan",
            pointer: "§5.1",
            excerpt: "Skin incision and exposure",
          },
        ],
        mood: "calm",
      },
      {
        id: "beat-02",
        durationS: 10,
        procedureStepId: "step-02-capsulotomy",
        anatomicalFocus: ["lm-posterior-capsule"],
        cameraAngle: "medium_oblique",
        narratorLine:
          "Next, the joint capsule is opened to expose the femoral head.",
        citations: [
          {
            sourceType: "procedure_plan",
            pointer: "§5.2",
            excerpt: "Capsulotomy and dislocation",
          },
        ],
        mood: "neutral",
      },
    ],
  },
  criticScores: [],
};

// ─── Composition ───────────────────────────────────────────────────────

const FPS = 30;
const INTRO_FRAMES = 90;
const OUTRO_FRAMES = 60;

export const PreOpExplainer: React.FC<PreOpExplainerProps> = (props) => {
  const { shotList, criticScores, surgeonName, isSyntheticPhantom, beatVideoBaseDir } = props;

  let cursor = INTRO_FRAMES;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0e14" }}>
      {/* Intro card */}
      <Sequence from={0} durationInFrames={INTRO_FRAMES} layout="none">
        <IntroCard
          surgeonName={surgeonName}
          procedureName={shotList.logline}
          isSyntheticPhantom={isSyntheticPhantom}
        />
      </Sequence>

      {/* Beats */}
      {shotList.beats.map((beat) => {
        const frames = Math.round(beat.durationS * FPS);
        const start = cursor;
        cursor += frames;
        const score = criticScores.find((s) => s.beat_id === beat.id);
        return (
          <Sequence
            key={beat.id}
            from={start}
            durationInFrames={frames}
            layout="none"
          >
            <BeatLayer
              beat={beat}
              criticScore={score}
              isSyntheticPhantom={isSyntheticPhantom}
              videoSrc={
                beatVideoBaseDir
                  ? staticFile(`${beatVideoBaseDir}/${beat.id}.mp4`)
                  : null
              }
              audioSrc={
                beatVideoBaseDir
                  ? staticFile(`${beatVideoBaseDir}/${beat.id}.wav`)
                  : null
              }
            />
          </Sequence>
        );
      })}

      {/* Outro card — minimal end card */}
      <Sequence
        from={cursor}
        durationInFrames={OUTRO_FRAMES}
        layout="none"
      >
        <AbsoluteFill
          style={{
            backgroundColor: "#0a0e14",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "#e8eef5",
            fontFamily: "Inter, system-ui, sans-serif",
          }}
        >
          <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: -1 }}>
            PreOpReel
          </div>
          <div
            style={{
              marginTop: 12,
              fontSize: 16,
              color: "#9fb3c8",
              maxWidth: 800,
              textAlign: "center",
            }}
          >
            Personalized · audited · explained.
          </div>
          {isSyntheticPhantom && (
            <div
              style={{
                marginTop: 20,
                padding: "6px 14px",
                borderRadius: 999,
                border: "1px solid rgba(212,154,58,0.6)",
                color: "#d49a3a",
                fontSize: 12,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              Synthetic phantom · demo case
            </div>
          )}
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

// Re-exports for libraries that need the underlying video/audio
// elements.
export { Audio, Video };
