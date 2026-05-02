// apps/synthesis-worker/stages/03-director.ts
//
// Stage 3 — Director. Atlas (Seed 2.0 Pro) drafts the ShotList from
// IntakeResult + ResearchBundle. The Schema Dev's ShotListSchema lives
// at @/lib/forge/shotList — we duck-type here to compile in parallel.

import { z } from "zod";
import { arkChat } from "@/lib/seed/ark";
import { zaiChat } from "@/lib/seed/zai";
import { emitTrace } from "../sse";
import { persistForgeRunStatus, persistShotList } from "../persist";
import type { Stage1Result } from "./01-intake";
import type { Stage2Result } from "./02-research";

export interface ShotListBeat {
  beat_id: string;
  procedure_step_id: string;
  procedure_step: string;
  anatomical_focus: string[];
  camera_angle: string;
  narrator_line: string;
  duration_s: number;
}

export interface ShotList {
  logline: string;
  beats: ShotListBeat[];
}

// Tolerant beat schema — Z.AI / GLM-5.1 sometimes returns camelCase or
// alternate field names. We accept the most common shapes and normalize
// downstream via `normalizeShotList()`.
const BeatRaw = z
  .object({
    beat_id: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    procedure_step_id: z.union([z.string(), z.number()]).optional(),
    procedureStepId: z.union([z.string(), z.number()]).optional(),
    step_id: z.union([z.string(), z.number()]).optional(),
    procedure_step: z.string().optional(),
    procedureStep: z.string().optional(),
    description: z.string().optional(),
    anatomical_focus: z.array(z.string()).optional(),
    anatomicalFocus: z.array(z.string()).optional(),
    landmarks: z.array(z.string()).optional(),
    camera_angle: z.string().optional(),
    cameraAngle: z.string().optional(),
    narrator_line: z.string().optional(),
    narratorLine: z.string().optional(),
    narration: z.string().optional(),
    duration_s: z.number().optional(),
    durationS: z.number().optional(),
    duration: z.number().optional(),
  })
  .passthrough();

const ShotListRaw = z
  .object({
    logline: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    beats: z.array(BeatRaw).optional(),
    shots: z.array(BeatRaw).optional(),
    segments: z.array(BeatRaw).optional(),
  })
  .passthrough();

function normalizeShotList(raw: unknown): ShotList {
  const parsed = ShotListRaw.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`stage_3_director: response not an object with beats[]: ${parsed.error.message}`);
  }
  const r = parsed.data;
  const logline = r.logline ?? r.title ?? r.summary ?? "Pre-operative explainer";
  const rawBeats = r.beats ?? r.shots ?? r.segments ?? [];
  if (rawBeats.length === 0) {
    throw new Error("stage_3_director: response has no beats[] / shots[] / segments[]");
  }
  const beats: ShotListBeat[] = rawBeats.map((b, i) => {
    const beat_id = String(b.beat_id ?? b.id ?? `b${i + 1}`);
    const procedure_step_id = String(
      b.procedure_step_id ?? b.procedureStepId ?? b.step_id ?? `${i + 1}`,
    );
    const procedure_step =
      b.procedure_step ?? b.procedureStep ?? b.description ?? `Step ${i + 1}`;
    const anatomical_focus =
      b.anatomical_focus ?? b.anatomicalFocus ?? b.landmarks ?? [];
    const camera_angle = b.camera_angle ?? b.cameraAngle ?? "medium_oblique";
    const narrator_line =
      b.narrator_line ?? b.narratorLine ?? b.narration ?? procedure_step;
    let duration_s = b.duration_s ?? b.durationS ?? b.duration ?? 8;
    if (duration_s < 0.5) duration_s = 0.5;
    if (duration_s > 15) duration_s = 15;
    return {
      beat_id,
      procedure_step_id,
      procedure_step,
      anatomical_focus,
      camera_angle,
      narrator_line: narrator_line.slice(0, 500),
      duration_s,
    };
  });
  return { logline: logline.slice(0, 300), beats };
}

// Permissive Zod schema for zaiChat — we accept any object shape and
// normalize after. This avoids zaiChat throwing on shape variants we
// can recover from.
const ShotListSchema: z.ZodType<ShotList> = ShotListRaw.transform(normalizeShotList) as z.ZodType<ShotList>;

const ATLAS_FALLBACK_PROMPT = `You are Atlas, the Director of PreOpReel. You explain the surgeon's plan to the patient. NEVER recommend, advise, or suggest — only describe.

Return ONLY a JSON object with this EXACT shape (snake_case keys, no other fields):

{
  "logline": "string ≤180 chars, plain language, 6th-grade level",
  "beats": [
    {
      "beat_id": "b1",
      "procedure_step_id": "step id from the plan, e.g. 4.1",
      "procedure_step": "short description of what happens in this step",
      "anatomical_focus": ["landmark1", "landmark2"],
      "camera_angle": "wide_establishing | medium_oblique | close_anatomical | macro_instrument | cross_section",
      "narrator_line": "≤300 chars, calm, no 'you should' / 'consider' / 'recommend'",
      "duration_s": 8
    }
  ]
}

Hard rules:
- Emit 4–8 beats; sum of duration_s between 60 and 90.
- Every duration_s is a number between 2 and 15.
- Every narrator_line describes what the surgeon DOES; never advises the patient.
- Output ONLY the JSON object. First char "{", last char "}". No markdown fences, no preamble.`;

export interface Stage3Input {
  forgeRunId: string;
  intake: Stage1Result;
  research: Stage2Result;
}

export async function runStage3(input: Stage3Input): Promise<ShotList> {
  const { forgeRunId, intake, research } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "directing");
  await emitTrace({
    forgeRunId,
    stage: "stage_3_director",
    message: "Atlas drafting ShotList",
    persona: "atlas",
  });

  const userText = JSON.stringify({
    plan: intake.plan,
    patient: intake.patient,
    pmids: research.tavi,
    anatomy: research.anatomy,
  });

  // Lazy-load the verbatim system prompt from Schema Dev's persona module
  // when available; fall back to the local placeholder.
  let systemPrompt = ATLAS_FALLBACK_PROMPT;
  try {
    const mod = (await import("@/lib/forge/personas/atlas-surgical")) as {
      SYSTEM_PROMPT?: string;
      ATLAS_SURGICAL_PROMPT?: string;
    };
    // The lib persona uses camelCase ShotList; the worker schema uses
    // snake_case. Keep the local prompt (which spells out snake_case keys
    // explicitly) instead of importing the full persona prompt unless an
    // explicit ATLAS_SURGICAL_PROMPT alias is exported.
    if (mod.ATLAS_SURGICAL_PROMPT) systemPrompt = mod.ATLAS_SURGICAL_PROMPT;
  } catch {
    /* persona module not yet landed — use fallback */
  }

  // Handbook stack: LLM = Z.AI (glm-5.1). Legacy ARK path behind
  // USE_LEGACY_PROVIDERS=1 (also see personas/atlas-surgical.ts:invoke()).
  const useLegacy = process.env.USE_LEGACY_PROVIDERS === "1";
  const shotList = useLegacy
    ? await arkChat<ShotList>({
        stage: "stage_3_director",
        persona: "atlas",
        systemPrompt,
        userContent: [{ type: "text", text: userText }],
        schema: ShotListSchema,
      })
    : await zaiChat<ShotList>({
        stage: "stage_3_director",
        persona: "atlas",
        systemPrompt,
        userContent: [{ type: "text", text: userText }],
        schema: ShotListSchema,
      });

  await persistShotList(forgeRunId, { v: 1, shotList });
  await emitTrace({
    forgeRunId,
    stage: "stage_3_director",
    message: `ShotList drafted: ${shotList.beats.length} beats`,
    persona: "atlas",
    duration_ms: Date.now() - start,
  });
  return shotList;
}
