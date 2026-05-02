// Persona test — Atlas Director.
// Feeds the synthetic-phantom hip-replacement plan; asserts the resulting
// ShotList has 5–7 beats, total duration ∈ [60, 90]s, every narratorLine
// has ≥1 citation, and no banned phrasings appear.
//
// Runs in DEMO_MODE=replay (tests/setup.ts). The replay shim returns a
// fixture for the persona invocation; if the fixture doesn't exist
// yet, the test stubs the lazy imports so build doesn't fail before
// the Vision Dev's files exist.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildImperativeAllowlistBlock,
  type ImperativeAllowlistItem,
} from "@/lib/forge/personas/atlas-surgical";
import type { ShotList } from "@/lib/forge/shotList";
import { ShotList as ShotListSchema } from "@/lib/forge/shotList";
import type {
  Patient,
  Procedure,
  AnatomyGraph,
} from "@/lib/forge/anatomyGraph";
import type { Citation } from "@/lib/forge/types";

// ─── Banned phrasings (C7) ────────────────────────────────────────
const BANNED_PHRASINGS = [
  /\byou should\b/i,
  /\bconsider\b/i,
  /\bwe recommend\b/i,
  /\byou might want to\b/i,
  /\bmake sure you\b/i,
  /\btry to\b/i,
  /\bbe sure to\b/i,
];

// ─── Synthetic phantom inputs (built inline so this test does not
//     depend on data/fixtures owned by Frontend Dev) ───────────────
const DEMO_PATIENT: Patient = {
  id: "synthetic-phantom-001",
  age: 65,
  sex: "female",
  bmi: 28,
  comorbidities: ["hypertension", "type-2 diabetes"],
};

const DEMO_PROCEDURE: Procedure = {
  id: "hip-replacement-posterior",
  name: "Total Hip Arthroplasty",
  approach: "posterior",
  cptCode: "27130",
  surgicalSteps: [
    {
      id: "step-01-incision",
      ordinal: 1,
      description: "Posterior incision over greater trochanter, ~10cm.",
      sourcePointer: "§2.3",
    },
    {
      id: "step-02-capsulotomy",
      ordinal: 2,
      description: "Capsulotomy preserving short external rotators.",
      sourcePointer: "§2.4",
    },
    {
      id: "step-03-femoral-head-removal",
      ordinal: 3,
      description: "Femoral neck osteotomy and femoral head removal.",
      sourcePointer: "§3.1",
    },
    {
      id: "step-04-acetabular-reaming",
      ordinal: 4,
      description: "Sequential acetabular reaming to subchondral bone.",
      sourcePointer: "§3.2",
    },
    {
      id: "step-05-implant-placement",
      ordinal: 5,
      description: "Acetabular shell + femoral stem placement.",
      sourcePointer: "§4.1",
    },
    {
      id: "step-06-closure",
      ordinal: 6,
      description: "Layered closure of capsule, fascia, and skin.",
      sourcePointer: "§5.1",
    },
  ],
};

const DEMO_ANATOMY_GRAPH: AnatomyGraph = {
  patient: DEMO_PATIENT,
  procedure: DEMO_PROCEDURE,
  landmarks: [
    {
      id: "lm-acetabulum-right",
      label: "Right Acetabulum",
      anatomicalSystem: "musculoskeletal",
      confidenceBand: { lo: 0.84, hi: 0.96 },
    },
    {
      id: "lm-femoral-head-right",
      label: "Right Femoral Head",
      anatomicalSystem: "musculoskeletal",
      confidenceBand: { lo: 0.86, hi: 0.97 },
    },
    {
      id: "lm-greater-trochanter-right",
      label: "Right Greater Trochanter",
      anatomicalSystem: "musculoskeletal",
      confidenceBand: { lo: 0.78, hi: 0.92 },
    },
    {
      id: "lm-sciatic-nerve",
      label: "Sciatic Nerve",
      anatomicalSystem: "nervous",
      confidenceBand: { lo: 0.51, hi: 0.62 },
    },
  ],
  relationships: [
    {
      sourceLandmarkId: "lm-femoral-head-right",
      targetLandmarkId: "lm-acetabulum-right",
      relation: "contains",
    },
  ],
};

const DEMO_PROTOCOL_CACHE: Citation[] = [
  {
    sourceType: "pmid",
    pointer: "PMID:34567890",
    excerpt: "Anatomic acetabular reaming preserves bone stock for revision.",
  },
];

const DEMO_ALLOWLIST: ImperativeAllowlistItem[] = []; // none for this fixture

// ─── Mock ShotList output (6 beats, 76s total) ────────────────────
const MOCK_SHOTLIST: ShotList = {
  logline:
    "A calm, plain-language walkthrough of your posterior hip replacement, step by step.",
  beats: [
    {
      id: "beat-01-overview",
      durationS: 10,
      procedureStepId: "step-01-incision",
      anatomicalFocus: ["lm-acetabulum-right", "lm-femoral-head-right"],
      cameraAngle: "wide_establishing",
      narratorLine:
        "Today your surgeon replaces the worn surface of your right hip joint, using the posterior approach.",
      citations: [
        {
          sourceType: "procedure_plan",
          pointer: "§2.3",
          excerpt:
            "Posterior approach via 8–10cm incision over greater trochanter.",
        },
      ],
      mood: "calm",
    },
    {
      id: "beat-02-incision",
      durationS: 12,
      procedureStepId: "step-01-incision",
      anatomicalFocus: ["lm-greater-trochanter-right"],
      cameraAngle: "medium_oblique",
      narratorLine:
        "An incision is made along the back of the hip, about 10 centimeters long, over the bony point on the side.",
      citations: [
        {
          sourceType: "procedure_plan",
          pointer: "§2.3",
          excerpt:
            "Posterior approach via 8–10cm incision over greater trochanter.",
        },
      ],
      mood: "neutral",
    },
    {
      id: "beat-03-reaming",
      durationS: 15,
      procedureStepId: "step-04-acetabular-reaming",
      anatomicalFocus: ["lm-acetabulum-right"],
      cameraAngle: "close_anatomical",
      narratorLine:
        "Your surgeon shapes the cup-side of the joint to fit the new ceramic socket precisely.",
      citations: [
        {
          sourceType: "procedure_plan",
          pointer: "§3.2",
          excerpt: "Sequential acetabular reaming to subchondral bone.",
        },
        {
          sourceType: "pmid",
          pointer: "PMID:34567890",
          excerpt:
            "Anatomic acetabular reaming preserves bone stock for revision.",
        },
      ],
      mood: "neutral",
    },
    {
      id: "beat-04-implant",
      durationS: 13,
      procedureStepId: "step-05-implant-placement",
      anatomicalFocus: ["lm-acetabulum-right", "lm-femoral-head-right"],
      cameraAngle: "close_anatomical",
      narratorLine:
        "The new socket is placed and tested for stability against the new femoral head.",
      citations: [
        {
          sourceType: "procedure_plan",
          pointer: "§4.1",
          excerpt: "Acetabular shell + femoral stem placement.",
        },
      ],
      mood: "neutral",
    },
    {
      id: "beat-05-closure",
      durationS: 14,
      procedureStepId: "step-06-closure",
      anatomicalFocus: ["lm-greater-trochanter-right"],
      cameraAngle: "medium_oblique",
      narratorLine:
        "The layers of tissue are closed carefully, one by one, ending with the skin.",
      citations: [
        {
          sourceType: "procedure_plan",
          pointer: "§5.1",
          excerpt: "Layered closure of capsule, fascia, and skin.",
        },
      ],
      mood: "calm",
    },
    {
      id: "beat-06-recovery",
      durationS: 12,
      procedureStepId: "step-06-closure",
      anatomicalFocus: ["lm-acetabulum-right"],
      cameraAngle: "wide_establishing",
      narratorLine:
        "After the procedure, your surgical team monitors your recovery in the post-anesthesia care unit.",
      citations: [
        {
          sourceType: "procedure_plan",
          pointer: "§5.1",
          excerpt: "Layered closure of capsule, fascia, and skin.",
        },
      ],
      mood: "calm",
    },
  ],
};

// ─── Stub the lazy imports inside invoke() ────────────────────────
// We mock @/lib/seed/ark.arkChat to return MOCK_SHOTLIST directly.
// arkChat() internally routes through withReplay(); we don't need to
// mock replay.ts itself because the schema-validating code path runs
// against arkChat's return value.
beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/lib/seed/ark", () => ({
    arkChat: vi.fn(async () => MOCK_SHOTLIST),
    arkVision: vi.fn(async () => ({})),
  }));
});

describe("Atlas — Director", () => {
  it("produces a 5–7 beat, 60..90s, fully-cited ShotList for the demo phantom", async () => {
    // Re-import after vi.doMock takes effect.
    const { invoke } = await import("@/lib/forge/personas/atlas-surgical");

    const list = await invoke({
      patient: DEMO_PATIENT,
      procedure: DEMO_PROCEDURE,
      anatomyGraph: DEMO_ANATOMY_GRAPH,
      protocolCache: DEMO_PROTOCOL_CACHE,
      imperativeAllowlist: DEMO_ALLOWLIST,
    });

    // Schema parse round-trip (defensive).
    const parsed = ShotListSchema.parse(list);

    // 5–7 beats per task spec.
    expect(parsed.beats.length).toBeGreaterThanOrEqual(5);
    expect(parsed.beats.length).toBeLessThanOrEqual(7);

    // Total duration ∈ [60, 90]s.
    const total = parsed.beats.reduce((s, b) => s + b.durationS, 0);
    expect(total).toBeGreaterThanOrEqual(60);
    expect(total).toBeLessThanOrEqual(90);

    // Every beat has ≥1 citation (Invariant 4).
    for (const b of parsed.beats) {
      expect(b.citations.length).toBeGreaterThanOrEqual(1);
    }

    // No banned phrasings in any narratorLine OR the logline.
    for (const banned of BANNED_PHRASINGS) {
      expect(parsed.logline).not.toMatch(banned);
      for (const b of parsed.beats) {
        expect(b.narratorLine).not.toMatch(banned);
      }
    }
  });

  it("FK-validates procedureStepId and anatomicalFocus", async () => {
    const { invoke } = await import("@/lib/forge/personas/atlas-surgical");
    const list = await invoke({
      patient: DEMO_PATIENT,
      procedure: DEMO_PROCEDURE,
      anatomyGraph: DEMO_ANATOMY_GRAPH,
      protocolCache: DEMO_PROTOCOL_CACHE,
      imperativeAllowlist: DEMO_ALLOWLIST,
    });
    const stepIds = new Set(DEMO_PROCEDURE.surgicalSteps.map((s) => s.id));
    const lmIds = new Set(DEMO_ANATOMY_GRAPH.landmarks.map((l) => l.id));
    for (const b of list.beats) {
      expect(stepIds.has(b.procedureStepId)).toBe(true);
      for (const f of b.anatomicalFocus) {
        expect(lmIds.has(f)).toBe(true);
      }
    }
  });

  it("renders the imperative-allowlist block as expected text", () => {
    const block = buildImperativeAllowlistBlock([
      {
        instruction: "Do not eat or drink after midnight.",
        sourcePointer: "§5.2",
        category: "preop_fasting",
      },
      {
        instruction: "Do not put weight on the leg for 6 weeks.",
        sourcePointer: "§7.1",
        category: "weight_bearing",
      },
    ]);
    expect(block).toContain("preop_fasting");
    expect(block).toContain("§5.2");
    expect(block).toContain("weight_bearing");
    expect(block).toContain("§7.1");
  });

  it("emits an explicit none-marker when the allowlist is empty", () => {
    const block = buildImperativeAllowlistBlock([]);
    expect(block).toContain("none");
  });
});
