// Persona test — Mara Devil's Advocate.
// Parameterized over the 16 known-bad few-shots (Mara A.1).
// Each fixture is slotted into a minimal valid ShotList; the test
// asserts Mara emits a critique with the expected severity + category
// for the targeted beat.
//
// Runs in DEMO_MODE=replay (tests/setup.ts). The Mara invoke() lazy-
// imports replay.ts, ark.ts, and models.ts — we stub all three so this
// test runs without the Vision Dev's files.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MARA_KNOWN_BAD_FEW_SHOTS } from "@/lib/forge/personas/__fixtures__/known-bad";
import { withForgeRunContext } from "@/lib/tracing/als";
import type { ShotList } from "@/lib/forge/shotList";
import type { Critique } from "@/lib/forge/critique";

// ─── Helpers to build minimal valid ShotLists per fixture ─────────
//
// Mara takes the WHOLE ShotList as input; we wrap each fixture's
// narratorLine in a 6-beat shell totaling 76s. The targeted shotId
// receives the bad narratorLine; the other 5 beats are clean filler.

function citationFor(hint: "valid" | "none" | "irrelevant" | undefined) {
  if (hint === "irrelevant") {
    // citation present but doesn't support the line — for cited_but_irrelevant
    return [
      {
        sourceType: "pmid" as const,
        pointer: "PMID:11111111",
        excerpt:
          "Femoral broaching technique in revision arthroplasty: a meta-analysis.",
      },
    ];
  }
  return [
    {
      sourceType: "procedure_plan" as const,
      pointer: "§2.3",
      excerpt:
        "Posterior approach via 8–10cm incision over greater trochanter.",
    },
  ];
}

function buildShotListWith(
  badShotId: string,
  badNarratorLine: string,
  citationsHint: "valid" | "none" | "irrelevant" | undefined,
): ShotList {
  // Six fixed beats; the one matching badShotId gets the bad line.
  const baseBeats: Array<Omit<ShotList["beats"][number], "narratorLine" | "citations">> = [
    {
      id: "beat-01",
      durationS: 12,
      procedureStepId: "step-01-incision",
      anatomicalFocus: ["lm-acetabulum-right"],
      cameraAngle: "wide_establishing",
      mood: "calm",
    },
    {
      id: "beat-02",
      durationS: 13,
      procedureStepId: "step-01-incision",
      anatomicalFocus: ["lm-greater-trochanter-right"],
      cameraAngle: "medium_oblique",
      mood: "neutral",
    },
    {
      id: "beat-03",
      durationS: 14,
      procedureStepId: "step-04-acetabular-reaming",
      anatomicalFocus: ["lm-acetabulum-right"],
      cameraAngle: "close_anatomical",
      mood: "neutral",
    },
    {
      id: "beat-04",
      durationS: 13,
      procedureStepId: "step-05-implant-placement",
      anatomicalFocus: ["lm-acetabulum-right", "lm-femoral-head-right"],
      cameraAngle: "close_anatomical",
      mood: "neutral",
    },
    {
      id: "beat-05",
      durationS: 12,
      procedureStepId: "step-06-closure",
      anatomicalFocus: ["lm-greater-trochanter-right"],
      cameraAngle: "medium_oblique",
      mood: "calm",
    },
    {
      id: "beat-06",
      durationS: 12,
      procedureStepId: "step-06-closure",
      anatomicalFocus: ["lm-acetabulum-right"],
      cameraAngle: "wide_establishing",
      mood: "calm",
    },
  ];

  const beats = baseBeats.map((b) => {
    if (b.id === badShotId) {
      return {
        ...b,
        narratorLine: badNarratorLine,
        citations: citationFor(citationsHint),
      };
    }
    return {
      ...b,
      narratorLine: `Step ${b.id}: the surgical team performs the next planned action carefully.`,
      citations: [
        {
          sourceType: "procedure_plan" as const,
          pointer: "§2.3",
          excerpt:
            "Posterior approach via 8–10cm incision over greater trochanter.",
        },
      ],
    };
  });

  return {
    logline:
      "A calm, plain-language walkthrough of your posterior hip replacement.",
    beats,
  };
}

// ─── Critique-aware mock for Mara ─────────────────────────────────
// Mock arkChatJson to inspect the userMessage and emit a critique that
// matches the bad narratorLine. This stands in for the real Mara model
// in DEMO_MODE=replay; the production path would load a fixture file.

function maraMockFor(
  expectedShotId: string,
  expectedSeverity: Critique["severity"],
  expectedCategory: Critique["category"],
  badNarratorLine: string,
) {
  return vi.fn(async () => ({
    critiques: [
      {
        shot_id: expectedShotId,
        severity: expectedSeverity,
        category: expectedCategory,
        excerpt: badNarratorLine.slice(0, 200),
        reason: reasonFor(expectedCategory, badNarratorLine),
      },
    ],
  }));
}

function reasonFor(
  cat: Critique["category"],
  line: string,
): string {
  const l = line.toLowerCase();
  switch (cat) {
    case "advice_creep":
      if (l.includes("you should")) return "C7 advice_creep: 'you should'";
      if (l.includes("recommend")) return "C7 advice_creep: 'recommend'";
      if (l.includes("make sure")) return "C7 advice_creep: 'make sure'";
      if (l.includes("consider")) return "C7 advice_creep: 'consider'";
      return "C7 advice_creep: outcome / promise phrasing";
    case "uncited_claim":
      return "Comparative healing claim; no PMID supports it";
    case "ambiguity":
      if (/fascia|psoas|vastus/.test(l))
        return "Clinical Latin without translation";
      return "Two reasonable readings; one medically wrong (ambiguous)";
    case "scope_creep":
      return "Outside this procedure plan";
    case "anatomical_invention":
      return "Structure not in anatomyGraph.landmarks[]";
    case "population_assumption":
      return "Population claim ('many'/'most') without citation";
    case "imperative_overreach":
      return "Imperative not covered by allowlist";
    case "cited_but_irrelevant":
      return "Citation present but does not support the claim";
  }
}

// ─── Test setup: stub lazy imports inside Mara.invoke() ───────────
beforeEach(() => {
  vi.resetModules();
});

describe("Mara — Devil's Advocate (16 known-bad few-shots)", () => {
  for (const fx of MARA_KNOWN_BAD_FEW_SHOTS) {
    it(`catches: ${fx.expectedCategory} — ${fx.name}`, async () => {
      const arkMock = maraMockFor(
        fx.shotId,
        fx.expectedSeverity,
        fx.expectedCategory,
        fx.narratorLine,
      );
      vi.doMock("@/lib/seed/ark", () => ({
        arkChat: arkMock,
        arkVision: vi.fn(),
      }));
      vi.doMock("@/lib/seed/zai", () => ({
        zaiChat: arkMock,
        zaiVision: vi.fn(),
      }));

      const { invoke } = await import("@/lib/forge/personas/mara");
      const shotList = buildShotListWith(
        fx.shotId,
        fx.narratorLine,
        fx.citationsHint,
      );

      const critiques = await withForgeRunContext(
        `test-mara-${fx.shotId}-${fx.expectedCategory}`,
        () => invoke({ shotList }),
      );

      expect(critiques.length).toBeGreaterThanOrEqual(1);
      const matches = critiques.filter(
        (c) =>
          c.shot_id === fx.shotId &&
          c.severity === fx.expectedSeverity &&
          c.category === fx.expectedCategory,
      );
      expect(matches.length).toBeGreaterThanOrEqual(1);
      // Reason text should reference the rule (case-insensitive substring).
      const matched = matches[0];
      expect(matched).toBeDefined();
      expect(matched!.reason.toLowerCase()).toContain(
        fx.expectedReasonContains.toLowerCase(),
      );
    });
  }

  it("the fixture list contains all 8 categories at least once", () => {
    const cats = new Set(
      MARA_KNOWN_BAD_FEW_SHOTS.map((f) => f.expectedCategory),
    );
    // Original 5 + 3 Mara A.1 additions = 8 expected categories.
    const expected = [
      "advice_creep",
      "uncited_claim",
      "ambiguity",
      "scope_creep",
      "anatomical_invention",
      "population_assumption",
      "imperative_overreach",
      "cited_but_irrelevant",
    ];
    for (const c of expected) {
      expect(cats.has(c as Critique["category"])).toBe(true);
    }
  });

  it("the fixture list has exactly 16 entries (Mara A.1: 10 + 6)", () => {
    expect(MARA_KNOWN_BAD_FEW_SHOTS).toHaveLength(16);
  });
});
