// src/remotion/Root.tsx — Remotion composition registry.
//
// Plan 04 §B.1 + master plan §5 surgical components. The composition is
// 1920×1080 landscape (per plan: NOT portrait), 30fps, H.264.
// `durationInFrames` is calculated dynamically from the ShotList beats
// + intro/outro at calculateMetadata time.

import { Composition, getInputProps } from "remotion";
import { z } from "zod";
import { PreOpExplainer, defaultProps, propsSchema } from "@/remotion/compositions/PreOpExplainer";

// ─── Constants ─────────────────────────────────────────────────────────

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const INTRO_FRAMES = 90; // 3s
const OUTRO_FRAMES = 60; // 2s

// ─── Root ──────────────────────────────────────────────────────────────

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PreOpExplainer"
        component={PreOpExplainer}
        durationInFrames={INTRO_FRAMES + 2340 + OUTRO_FRAMES /* default for studio */}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={defaultProps}
        schema={propsSchema}
        calculateMetadata={async ({ props, defaultProps }) => {
          const merged = { ...defaultProps, ...props };
          // Total duration = intro + sum(beats) + outro, in seconds.
          const beatsSec = merged.shotList.beats.reduce(
            (s: number, b: { durationS: number }) => s + b.durationS,
            0,
          );
          const totalFrames =
            INTRO_FRAMES +
            Math.round(beatsSec * FPS) +
            OUTRO_FRAMES;
          return {
            durationInFrames: totalFrames,
            fps: FPS,
            width: WIDTH,
            height: HEIGHT,
            props: merged,
          };
        }}
      />
    </>
  );
};
