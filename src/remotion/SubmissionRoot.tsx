// src/remotion/SubmissionRoot.tsx
//
// Standalone Remotion entry for the hackathon submission deck. The main
// Root.tsx pulls in PreOpExplainer + components that use Next.js `@/` path
// aliases, which the Remotion webpack bundler doesn't resolve. This entry
// only registers the SubmissionDeck composition and its 3 still slides.

import { Composition, registerRoot } from "remotion";
import {
  SubmissionDeck,
  SubmissionSlide1,
  SubmissionSlide2,
  SubmissionSlide3,
  TOTAL_FRAMES,
} from "./compositions/SubmissionDeck";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

const Root: React.FC = () => (
  <>
    <Composition
      id="SubmissionDeck"
      component={SubmissionDeck}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Composition
      id="SubmissionSlide1"
      component={SubmissionSlide1}
      durationInFrames={120}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Composition
      id="SubmissionSlide2"
      component={SubmissionSlide2}
      durationInFrames={120}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Composition
      id="SubmissionSlide3"
      component={SubmissionSlide3}
      durationInFrames={120}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  </>
);

registerRoot(Root);
