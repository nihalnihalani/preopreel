// Known-bad rendered-shot fixtures for Lyra's Vision Critic. 5 entries.
// Each is a textual description of frame data that the test harness
// converts into a small bank of pre-generated PNGs (or feeds Lyra
// directly via replay fixture in DEMO_MODE=replay).
//
// Includes the deliberate Beat-3 fixture (anatomical_fidelity 0.71 →
// 0.86 after regen) per the Frontend Dev's demo choreography. That
// fixture is the on-stage 0:50–1:00 reject/regen sequence.
import type { ShotBeat } from "@/lib/forge/shotList";
import type { CriticScore } from "@/lib/forge/critique";

export interface LyraKnownBad {
  /** Stable name for parameterized test descriptions. */
  name: string;
  /** ShotBeat that is being scored. */
  beat: ShotBeat;
  /** Human-readable description of the rendered frames. */
  framesDescription: string;
  /**
   * Expected score upper bounds (Lyra MUST score at-or-below). Tests assert
   * `score.<key>` ≤ `expectedMaxScore.<key>` + 0.05 tolerance per plan 03.
   */
  expectedMaxScore: Partial<{
    anatomical_fidelity: number;
    procedure_step_compliance: number;
    on_screen_text_violations: number;
  }>;
  /**
   * Expected post-regen score (only set on the deliberate demo fixture).
   * Used by the demo choreography test to verify the Beat-3
   * 0.71 → 0.86 sequence.
   */
  expectedPostRegen?: Pick<
    CriticScore,
    "anatomical_fidelity" | "procedure_step_compliance"
  >;
}

// ─── Minimal Citation/ShotBeat builders for fixtures ──────────────
// (We can't depend on demo-hip fixture file — that's owned by Frontend
// Dev. We construct minimal valid ShotBeats inline.)

const CITATION_PLAN_2_3 = {
  sourceType: "procedure_plan" as const,
  pointer: "§2.3",
  excerpt:
    "Posterior approach via 8–10cm incision over greater trochanter.",
};
const CITATION_PLAN_3_2 = {
  sourceType: "procedure_plan" as const,
  pointer: "§3.2",
  excerpt: "Sequential acetabular reaming to subchondral bone.",
};

const BEAT_INCISION: ShotBeat = {
  id: "beat-02-incision",
  durationS: 12,
  procedureStepId: "step-01-incision",
  anatomicalFocus: ["lm-greater-trochanter-right"],
  cameraAngle: "medium_oblique",
  narratorLine:
    "An incision is made along the back of the hip, about 10 centimeters long.",
  citations: [CITATION_PLAN_2_3],
  mood: "neutral",
};

const BEAT_REAMING: ShotBeat = {
  id: "beat-03-reaming",
  durationS: 15,
  procedureStepId: "step-04-acetabular-reaming",
  anatomicalFocus: ["lm-acetabulum-right"],
  cameraAngle: "close_anatomical",
  narratorLine:
    "Your surgeon shapes the cup-side of the joint to fit the new ceramic socket precisely.",
  citations: [CITATION_PLAN_3_2],
  mood: "neutral",
};

const BEAT_REAMING_POV: ShotBeat = {
  ...BEAT_REAMING,
  cameraAngle: "surgeon_pov",
};

const BEAT_IMPLANT: ShotBeat = {
  id: "beat-04-implant",
  durationS: 12,
  procedureStepId: "step-05-implant-placement",
  anatomicalFocus: ["lm-acetabulum-right", "lm-femoral-head-right"],
  cameraAngle: "close_anatomical",
  narratorLine: "The new socket is placed and tested for stability.",
  citations: [CITATION_PLAN_3_2],
  mood: "neutral",
};

// ─── The 5 fixtures ───────────────────────────────────────────────
export const LYRA_KNOWN_BAD: LyraKnownBad[] = [
  // 1) Wrong side of body — beat focuses on right; render shows left
  {
    name: "wrong-side-hip",
    beat: BEAT_REAMING,
    framesDescription:
      "Four frames showing pelvis from posterior view; acetabulum being reamed is on the LEFT side, opposite to anatomicalFocus (right).",
    expectedMaxScore: { anatomical_fidelity: 0.3 },
  },
  // 2) Glyph soup — Seedance hallucinated text on the instrument
  {
    name: "glyph-soup-instrument",
    beat: BEAT_INCISION,
    framesDescription:
      "Frames are anatomically reasonable but the scalpel handle has 4 distinct hallucinated text labels visible across frames (glyph soup, partial words).",
    expectedMaxScore: { on_screen_text_violations: 4 },
  },
  // 3) THE DEMO FIXTURE — deliberate Beat-3 reject/regen.
  //    Frontend Dev's demo choreography depends on this exact fixture:
  //    first attempt 0.71 anatomical_fidelity → regen → 0.86. The HUD's
  //    0:50–1:00 beat plays this back from replay. The fixture lives
  //    here so the Persona Dev's tests can assert on the same shape
  //    the demo path uses.
  {
    name: "demo-beat-3-reject-then-regen",
    beat: BEAT_REAMING,
    framesDescription:
      "Frames show acetabular reaming but pelvis is mis-oriented (medial/lateral confusion) — first-attempt fixture. Post-regen frames have correct orientation and clean composition.",
    expectedMaxScore: { anatomical_fidelity: 0.74 }, // < 0.75 threshold ⇒ regen (demo: actual 0.71)
    expectedPostRegen: {
      anatomical_fidelity: 0.86,
      procedure_step_compliance: 0.91,
    },
  },
  // 4) Anatomical hallucination — extra organ
  {
    name: "extra-organ-bowel",
    beat: BEAT_IMPLANT,
    framesDescription:
      "Frames show acetabulum and femoral head correctly but a clearly visible loop of bowel is also rendered overlapping the surgical field; bowel is not in landmarks[].",
    expectedMaxScore: { anatomical_fidelity: 0.5 },
  },
  // 5) Mis-oriented landmark — pelvis facing camera in surgeon-pov shot
  {
    name: "pelvis-mis-oriented",
    beat: BEAT_REAMING_POV,
    framesDescription:
      "Pelvis is rendered facing the camera (anterior view) but cameraAngle is surgeon_pov which would be posterior — orientation contradicts camera.",
    expectedMaxScore: { anatomical_fidelity: 0.65 },
  },
];

export const _LYRA_FIXTURE_COUNT = LYRA_KNOWN_BAD.length;
