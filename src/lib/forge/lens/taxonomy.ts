// src/lib/forge/lens/taxonomy.ts
//
// Cinema-lens taxonomy lookup. Maps a `cameraAngle` string to a deterministic
// suffix appended to the Seedance prompt at Stage 6.
//
// Ported from: https://github.com/Anil-matcha/Open-Generative-AI (MIT).
// Attribution mirrored in /LICENSES.md and /docs/plans/00-master-plan.md §4.
//
// Stage 6 is deterministic — no LLM call. The suffix system gives each beat
// a consistent visual grammar (focal length + aperture + framing) so the
// Seedream Tier-0 anchor and the Seedance generation share lens semantics.
//
// Default fallback: "wide_anatomical" maps to a neutral 24mm anamorphic
// reference-photo style — safest for medical anatomical context.

export type CameraAngle =
  | "wide_anatomical"
  | "establishing"
  | "close_up"
  | "extreme_close_up"
  | "macro_surgical"
  | "over_shoulder"
  | "low_angle"
  | "high_angle"
  | "dutch_angle"
  | "tracking_dolly"
  | "orbit"
  | "static_locked";

const LENS_SUFFIXES: Record<CameraAngle, string> = {
  // Anatomical reference framing — the default for hero anatomy beats.
  // 24mm anamorphic ≈ wide enough to show context, shallow enough to
  // separate the focal landmark from background tissue.
  wide_anatomical:
    ", 24mm anamorphic, f/2.8, anatomical reference photograph, shallow depth of field",
  // Wider establishing shot for the OR room or full surgical field.
  establishing:
    ", 18mm wide-angle, f/4.0, establishing shot, OR overhead lighting, deep focus",
  // Close-up on a single anatomical landmark or instrument.
  close_up:
    ", 50mm prime, f/1.8, close-up, surgical microscope aesthetic, soft natural falloff",
  // Extreme close-up — used sparingly; tissue texture detail.
  extreme_close_up:
    ", 100mm macro, f/2.0, extreme close-up, surgical detail, razor-thin focus plane",
  // Macro surgical — instrument-on-tissue scale; the most demanding shot type.
  macro_surgical:
    ", 100mm macro, f/4.0, macro surgical, sterile field aesthetic, tight focus on instrument tip",
  // Over-shoulder of the surgeon's POV. Sets the patient framing.
  over_shoulder:
    ", 35mm prime, f/2.8, over-shoulder POV, surgeon's hands in foreground, focus pulled to surgical site",
  // Low-angle — used for "looking up" at hardware (acetabular cup, screws).
  low_angle:
    ", 28mm wide, f/2.8, low angle, hardware emphasized, neutral 5500K lighting",
  // High-angle — bird's-eye view; OR field overview.
  high_angle:
    ", 24mm wide, f/4.0, high angle, top-down OR field, even shadow distribution",
  // Dutch angle — used cautiously; signals motion/dynamic moment.
  dutch_angle:
    ", 35mm prime, f/2.0, dutch tilt, dynamic framing, no patient framing skew",
  // Tracking / dolly — smooth lateral movement along the surgical site.
  tracking_dolly:
    ", 35mm prime, f/2.8, tracking dolly, smooth lateral motion, anatomical horizon stable",
  // Orbit — circular camera path around the focal landmark.
  orbit:
    ", 50mm prime, f/2.8, slow orbit, anatomical landmark centered, parallax reveals depth",
  // Static locked — no camera motion; used for diagrammatic clarity.
  static_locked:
    ", 50mm prime, f/4.0, static locked-off, diagrammatic clarity, even exposure",
};

const DEFAULT_ANGLE: CameraAngle = "wide_anatomical";

/**
 * Look up the cinema-lens suffix for a given camera angle. Falls back to
 * the wide_anatomical default for unrecognized inputs.
 */
export function lensSuffix(angle: string | undefined | null): string {
  if (!angle) return LENS_SUFFIXES[DEFAULT_ANGLE];
  const k = angle as CameraAngle;
  return LENS_SUFFIXES[k] ?? LENS_SUFFIXES[DEFAULT_ANGLE];
}

/** Enumerate all supported angles — used by tests and Stage 6 doc generation. */
export function allCameraAngles(): CameraAngle[] {
  return Object.keys(LENS_SUFFIXES) as CameraAngle[];
}
