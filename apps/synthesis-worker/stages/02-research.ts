// apps/synthesis-worker/stages/02-research.ts
//
// Stage 2 — Research fan-out. Four parallel sub-stages:
//   2a Tavi   : peer-reviewed surgical protocols (PMID-cited)
//   2b Exa    : visual style refs (neural search)
//   2c Gem    : AnatomyGraph + confidence bands (Gemini vision)
//   2d pdf    : deterministic plan-text extraction
//
// Tavi/Exa/Gem are wrapped in withReplay (Mara C.4) — the ingestor modules
// in src/lib/forge/ingestors/* own that wiring. Failures degrade gracefully
// (Tavi/Exa empty → warn; Gem fail → hard stop).

import { emitTrace } from "../sse";
import { persistForgeRunStatus, persistAnatomyGraph } from "../persist";
import type { Stage1Result } from "./01-intake";

export interface PMIDRef {
  pmid: string;
  title: string;
  excerpt: string;
}

export interface StyleRef {
  url: string;
  description: string;
  weight?: number;
}

export interface AnatomyEntity {
  id: string;
  name: string;
  confidence_band: { lo: number; hi: number };
  refImages?: string[];
}

export interface AnatomyGraph {
  entities: AnatomyEntity[];
  landmarks: Array<{ id: string; entity_id: string; position: string; confidence_band: { lo: number; hi: number } }>;
}

export interface Stage2Input {
  forgeRunId: string;
  intake: Stage1Result;
}

export interface Stage2Result {
  tavi: PMIDRef[];
  exa: StyleRef[];
  anatomy: AnatomyGraph;
  planText: string;
}

// ─── Sub-stages (kept inline per the brief) ───────────────────────────────

async function runStage2aTavi(forgeRunId: string): Promise<PMIDRef[]> {
  await emitTrace({
    forgeRunId,
    stage: "stage_2a_tavi",
    message: "peer-reviewed protocol search",
    persona: "tavi",
  });
  // Schema Dev's ingestor wraps Tavily in withReplay. Fixture-driven for demo.
  return [
    { pmid: "PMID:18000001", title: "Posterior approach hip arthroplasty outcomes", excerpt: "Posterior approach has comparable outcomes…" },
    { pmid: "PMID:18000002", title: "Acetabular cup orientation guidelines", excerpt: "40-45° inclination is standard…" },
  ];
}

async function runStage2bExa(forgeRunId: string): Promise<StyleRef[]> {
  await emitTrace({
    forgeRunId,
    stage: "stage_2b_exa",
    message: "neural search for visual style refs",
    persona: "exa",
  });
  return [
    { url: "https://example.invalid/style/01.jpg", description: "OR overhead lighting reference", weight: 0.7 },
  ];
}

async function runStage2cGem(forgeRunId: string): Promise<AnatomyGraph> {
  await emitTrace({
    forgeRunId,
    stage: "stage_2c_gem",
    message: "vision landmark extraction",
    persona: "gem",
  });
  // Mara D.4: ensure at least one band has variance + below 0.6 in fixtures.
  return {
    entities: [
      { id: "pelvis_acetabular", name: "Acetabular cup region", confidence_band: { lo: 0.84, hi: 0.92 } },
      { id: "femur_head", name: "Femoral head", confidence_band: { lo: 0.78, hi: 0.88 } },
      { id: "femur_neck", name: "Femoral neck", confidence_band: { lo: 0.51, hi: 0.62 } },
      { id: "gluteus_medius", name: "Gluteus medius approach point", confidence_band: { lo: 0.70, hi: 0.81 } },
    ],
    landmarks: [
      { id: "lm_1", entity_id: "pelvis_acetabular", position: "lateral", confidence_band: { lo: 0.80, hi: 0.90 } },
    ],
  };
}

async function runStage2dPdf(forgeRunId: string, intake: Stage1Result): Promise<string> {
  await emitTrace({
    forgeRunId,
    stage: "stage_2d_pdf",
    message: "deterministic plan text extraction",
  });
  return intake.plan.rawText;
}

// ─── Stage entry ──────────────────────────────────────────────────────────

export async function runStage2(input: Stage2Input): Promise<Stage2Result> {
  const { forgeRunId, intake } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "researching");

  const [taviR, exaR, anatomyR, planTextR] = await Promise.allSettled([
    runStage2aTavi(forgeRunId),
    runStage2bExa(forgeRunId),
    runStage2cGem(forgeRunId),
    runStage2dPdf(forgeRunId, intake),
  ]);

  // Tavi/Exa degrade to empty; Gem failure is hard-stop (anatomy required).
  const tavi = taviR.status === "fulfilled" ? taviR.value : [];
  const exa = exaR.status === "fulfilled" ? exaR.value : [];
  if (anatomyR.status === "rejected") {
    throw new Error(
      `Stage 2c Gem (anatomy) failed: ${anatomyR.reason}. AnatomyGraph is required.`,
    );
  }
  const anatomy = anatomyR.value;
  const planText = planTextR.status === "fulfilled" ? planTextR.value : "";

  await persistAnatomyGraph(forgeRunId, { graph: anatomy });
  await emitTrace({
    forgeRunId,
    stage: "stage_2_research",
    message: `research complete: ${tavi.length} PMIDs, ${exa.length} style refs, ${anatomy.entities.length} entities`,
    duration_ms: Date.now() - start,
  });
  return { tavi, exa, anatomy, planText };
}
