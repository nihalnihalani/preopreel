// Known-bad fixtures for Mara's Devil's Advocate. 16 entries (Mara A.1):
//   10 from plan 03 (advice_creep, uncited_claim, ambiguity, scope_creep,
//      anatomical_invention) + 6 added per Mara A.1 to cover the 3 new
//   categories (population_assumption, imperative_overreach,
//   cited_but_irrelevant) and the slip-throughs documented in plan 06 §A.1.
//
// Each entry is a minimal triplet (narratorLine, shotId, expectedSeverity,
// expectedCategory, expectedReasonContains) — the test harness slots the
// narratorLine into the demo phantom ShotList shell. We don't ship full
// ShotList JSON here because the harness must round-trip every line
// through the schema (Citation FK + duration sum etc).
import type { CritiqueSeverity, CritiqueCategory } from "@/lib/forge/critique";

export interface MaraKnownBadFewShot {
  /** Stable name for parameterized test descriptions. */
  name: string;
  /** Verbatim narrator line that should trigger Mara. */
  narratorLine: string;
  /** ShotBeat.id this line is attached to (matches the test harness). */
  shotId: string;
  /** Expected critique severity. */
  expectedSeverity: CritiqueSeverity;
  /** Expected critique category. */
  expectedCategory: CritiqueCategory;
  /** Substring Mara's `reason` should contain (case-insensitive). */
  expectedReasonContains: string;
  /** Optional citations to attach to the beat (default: minimal valid). */
  citationsHint?: "valid" | "none" | "irrelevant";
}

export const MARA_KNOWN_BAD_FEW_SHOTS: MaraKnownBadFewShot[] = [
  // ─── Original 10 (plan 03 §B.2) ─────────────────────────────────
  {
    name: "01-classic-advice-creep",
    narratorLine:
      "You should consider walking with the cane for at least six weeks after surgery.",
    shotId: "beat-04",
    expectedSeverity: "block",
    expectedCategory: "advice_creep",
    expectedReasonContains: "you should",
  },
  {
    name: "02-we-recommend",
    narratorLine: "We recommend that patients avoid driving for two weeks.",
    shotId: "beat-05",
    expectedSeverity: "block",
    expectedCategory: "advice_creep",
    expectedReasonContains: "recommend",
  },
  {
    name: "03-make-sure-imperative",
    narratorLine: "Make sure you take your antibiotics before surgery.",
    shotId: "beat-01",
    expectedSeverity: "block",
    expectedCategory: "advice_creep",
    expectedReasonContains: "make sure",
  },
  {
    name: "04-uncited-comparative",
    narratorLine: "Posterior incisions heal faster than anterior incisions.",
    shotId: "beat-02",
    expectedSeverity: "block",
    expectedCategory: "uncited_claim",
    expectedReasonContains: "comparative",
    citationsHint: "valid",
  },
  {
    name: "05-anatomical-invention",
    narratorLine: "The piriformis nerve is gently retracted.",
    shotId: "beat-02",
    expectedSeverity: "block",
    expectedCategory: "anatomical_invention",
    expectedReasonContains: "anatomyGraph",
  },
  {
    name: "06-scope-creep-knee-in-hip",
    narratorLine: "Your knee will also be evaluated during the procedure.",
    shotId: "beat-03",
    expectedSeverity: "block",
    expectedCategory: "scope_creep",
    expectedReasonContains: "outside",
  },
  {
    name: "07-ambiguity-which-bone",
    narratorLine: "The implant goes where the bone was.",
    shotId: "beat-04",
    expectedSeverity: "warn",
    expectedCategory: "ambiguity",
    expectedReasonContains: "ambiguous",
  },
  {
    name: "08-outcome-promise",
    narratorLine: "You'll be walking pain-free within 6 weeks.",
    shotId: "beat-06",
    expectedSeverity: "block",
    expectedCategory: "advice_creep",
    expectedReasonContains: "outcome",
  },
  {
    name: "09-might-want-to-consider",
    narratorLine: "You might want to consider physical therapy after.",
    shotId: "beat-06",
    expectedSeverity: "block",
    expectedCategory: "advice_creep",
    expectedReasonContains: "consider",
  },
  {
    name: "10-latin-no-translation",
    narratorLine: "The fascia lata is incised parallel to its fibers.",
    shotId: "beat-02",
    expectedSeverity: "warn",
    expectedCategory: "ambiguity",
    expectedReasonContains: "translation",
  },

  // ─── Mara A.1 additions (6 entries) ─────────────────────────────
  // Subjunctive / population claim — plan 06 §A.1
  {
    name: "11-population-assumption-many-patients",
    narratorLine:
      "Many patients find it helpful to walk a little before the surgery.",
    shotId: "beat-01",
    expectedSeverity: "warn",
    expectedCategory: "population_assumption",
    expectedReasonContains: "population",
  },
  // Reassurance creep — plan 06 §A.1 — "this is a routine procedure"
  {
    name: "12-population-assumption-routine",
    narratorLine: "This is a very routine procedure for most patients.",
    shotId: "beat-01",
    expectedSeverity: "warn",
    expectedCategory: "population_assumption",
    expectedReasonContains: "most",
  },
  // Imperative overreach — fasting NOT in allowlist (Mara D.1 / Atlas D.1)
  {
    name: "13-imperative-overreach-fasting",
    narratorLine:
      "Do not eat or drink anything after midnight before your surgery.",
    shotId: "beat-01",
    expectedSeverity: "block",
    expectedCategory: "imperative_overreach",
    expectedReasonContains: "imperative",
  },
  // Imperative overreach — medication, not in allowlist
  {
    name: "14-imperative-overreach-meds",
    narratorLine: "Take your blood thinner as scheduled the morning of surgery.",
    shotId: "beat-01",
    expectedSeverity: "block",
    expectedCategory: "imperative_overreach",
    expectedReasonContains: "imperative",
  },
  // Cited but irrelevant — citation present but doesn't support claim
  {
    name: "15-cited-but-irrelevant",
    narratorLine:
      "The acetabular reaming preserves bone stock for a future revision.",
    shotId: "beat-03",
    expectedSeverity: "warn",
    expectedCategory: "cited_but_irrelevant",
    expectedReasonContains: "support",
    citationsHint: "irrelevant",
  },
  // Tense-slippage imperative — plan 06 §A.1
  {
    name: "16-tense-slippage-induction",
    narratorLine: "Breathe slowly during induction.",
    shotId: "beat-01",
    expectedSeverity: "block",
    expectedCategory: "imperative_overreach",
    expectedReasonContains: "imperative",
  },
];

// Sanity: 16 entries; all 8 categories represented at least once.
export const _MARA_FIXTURE_COUNT = MARA_KNOWN_BAD_FEW_SHOTS.length;
