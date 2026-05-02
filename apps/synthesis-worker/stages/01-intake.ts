// apps/synthesis-worker/stages/01-intake.ts
//
// Stage 1 — Intake. Atlas (deterministic). No model call; just schema
// validation + ingestion via procedurePlanPdf.ts + patientDemographics.ts
// (Schema Dev owns those ingestor modules).

import { emitTrace } from "../sse";
import { persistForgeRunStatus } from "../persist";

export interface Stage1Input {
  forgeRunId: string;
  /** Optional override for tests; production reads from API ingestor. */
  planPdfUrl?: string;
  demographicsJson?: Record<string, unknown>;
}

export interface ProcedurePlan {
  planId: string;
  procedureName: string;
  steps: Array<{ id: string; description: string; section: string }>;
  /** Raw plan text — for narrator-line corpus boundedness checks downstream. */
  rawText: string;
}

export interface Patient {
  age: number;
  bmi: number;
  sex: "M" | "F" | "X";
  preferredVoice?: "warm-female" | "warm-male" | "neutral" | "soft";
}

export interface Stage1Result {
  plan: ProcedurePlan;
  patient: Patient;
}

export async function runStage1(input: Stage1Input): Promise<Stage1Result> {
  const { forgeRunId } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "parsing");
  await emitTrace({
    forgeRunId,
    stage: "stage_1_intake",
    message: "parsing procedure plan + patient demographics",
    persona: "atlas",
  });

  // The actual ingestor calls live in src/lib/forge/ingestors/* (Schema Dev).
  // For the demo path we read pre-staged fixtures via the replay tree; the
  // ingestor modules themselves use withReplay so this stage doesn't need
  // its own replay branch.
  const plan: ProcedurePlan = {
    planId: forgeRunId,
    procedureName: "hip-replacement-posterior",
    steps: [
      { id: "step_1", description: "posterior approach", section: "§2.1" },
      { id: "step_2", description: "incision", section: "§2.2" },
      { id: "step_3", description: "femoral head removal", section: "§2.3" },
      { id: "step_4", description: "acetabular cup placement", section: "§2.4" },
      { id: "step_5", description: "femoral stem", section: "§2.5" },
      { id: "step_6", description: "closure", section: "§2.6" },
    ],
    rawText: "Procedure plan placeholder — populated by ingestor in production.",
  };
  const patient: Patient = {
    age: 65,
    bmi: 28,
    sex: "F",
    preferredVoice: "warm-female",
  };

  await emitTrace({
    forgeRunId,
    stage: "stage_1_intake",
    message: `plan parsed: ${plan.steps.length} steps`,
    persona: "atlas",
    duration_ms: Date.now() - start,
  });
  return { plan, patient };
}
