// apps/synthesis-worker/stages/04-devils-advocate.ts
//
// Stage 4 — Mara (Devil's Advocate) ★ Invariant 1.
// Pre-render critic gate. 1-round cap. Critiques + score floor logic
// live in @/lib/forge/critic; this stage wires the persona invocation
// to that primitive.

import { z } from "zod";
import { arkChat } from "@/lib/seed/ark";
import { zaiChat } from "@/lib/seed/zai";
import {
  runMaraCritique,
  type CriticCritique,
  type MaraContext,
} from "../criticLoop";
import { emitTrace } from "../sse";
import { persistForgeRunStatus, persistCritiquesAsync } from "../persist";
import type { ShotList } from "./03-director";

const CritiqueSchema: z.ZodType<CriticCritique> = z.object({
  shot_id: z.string(),
  severity: z.enum(["block", "warn", "info"]),
  category: z.string(),
  excerpt: z.string().max(200),
  reason: z.string().max(200),
  suggested_revision: z.string().optional(),
});

const CritiqueArraySchema = z.array(CritiqueSchema);

// Tolerant inbound shape — Z.AI / GLM-5.1 frequently returns:
//   { shot_id, category, critique }
// or
//   { shotId, severity, message }
// We accept any shape with shot_id + at least one of {critique,reason,message}
// and normalize to the strict CritiqueSchema.
const RawCritiqueItem = z
  .object({
    shot_id: z.union([z.string(), z.number()]).optional(),
    shotId: z.union([z.string(), z.number()]).optional(),
    beat_id: z.union([z.string(), z.number()]).optional(),
    severity: z.string().optional(),
    category: z.string().optional(),
    excerpt: z.string().optional(),
    reason: z.string().optional(),
    critique: z.string().optional(),
    message: z.string().optional(),
    text: z.string().optional(),
    suggested_revision: z.string().optional(),
    suggestedRevision: z.string().optional(),
    revision: z.string().optional(),
  })
  .passthrough();

const ALLOWED_CATEGORIES = new Set([
  "advice_creep",
  "uncited_claim",
  "ambiguity",
  "scope_creep",
  "anatomical_invention",
  "population_assumption",
  "imperative_overreach",
  "cited_but_irrelevant",
]);

function normalizeCritiqueItem(r: z.infer<typeof RawCritiqueItem>): CriticCritique {
  const shot_id = String(r.shot_id ?? r.shotId ?? r.beat_id ?? "");
  const sevRaw = (r.severity ?? "warn").toLowerCase();
  const severity: CriticCritique["severity"] =
    sevRaw === "block" || sevRaw === "warn" || sevRaw === "info"
      ? (sevRaw as CriticCritique["severity"])
      : "warn";
  const category = ALLOWED_CATEGORIES.has(r.category ?? "")
    ? (r.category as string)
    : "ambiguity";
  const reason = (r.reason ?? r.critique ?? r.message ?? r.text ?? "").slice(0, 200);
  const excerpt = (r.excerpt ?? reason).slice(0, 200);
  const out: CriticCritique = {
    shot_id,
    severity,
    category,
    excerpt,
    reason,
  };
  const rev = r.suggested_revision ?? r.suggestedRevision ?? r.revision;
  if (rev) out.suggested_revision = rev;
  return out;
}

const TolerantCritiqueArraySchema: z.ZodType<CriticCritique[]> = z
  .union([
    z.array(RawCritiqueItem).transform((arr) => arr.map(normalizeCritiqueItem)),
    z
      .object({ critiques: z.array(RawCritiqueItem) })
      .transform((o) => o.critiques.map(normalizeCritiqueItem)),
    z
      .object({ items: z.array(RawCritiqueItem) })
      .transform((o) => o.items.map(normalizeCritiqueItem)),
    z
      .object({ results: z.array(RawCritiqueItem) })
      .transform((o) => o.results.map(normalizeCritiqueItem)),
  ]) as z.ZodType<CriticCritique[]>;

const MARA_FALLBACK_PROMPT =
  "You are Mara, Devil's Advocate. You read the Director's ShotList and " +
  "emit a list of Critique objects. Categories include advice_creep, " +
  "uncited_claim, ambiguity, scope_creep, anatomical_invention, " +
  "population_assumption, imperative_overreach, cited_but_irrelevant. " +
  "Output JSON array. YOU MUST DISAGREE WITH AT LEAST ONE BEAT.";

export interface Stage4Input {
  forgeRunId: string;
  shotList: ShotList;
}

export interface Stage4Result {
  shotList: ShotList;
  critiques: CriticCritique[];
}

export async function runStage4(input: Stage4Input): Promise<Stage4Result> {
  const { forgeRunId, shotList } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "critiquing");
  await emitTrace({
    forgeRunId,
    stage: "stage_4_mara",
    message: "Mara reading ShotList",
    persona: "mara",
  });

  let systemPrompt = MARA_FALLBACK_PROMPT;
  try {
    const mod = (await import("@/lib/forge/personas/mara")) as {
      MARA_DEVILS_ADVOCATE_PROMPT?: string;
    };
    if (mod.MARA_DEVILS_ADVOCATE_PROMPT)
      systemPrompt = mod.MARA_DEVILS_ADVOCATE_PROMPT;
  } catch {
    /* persona not yet landed */
  }

  const useLegacy = process.env.USE_LEGACY_PROVIDERS === "1";
  const ctx: MaraContext = {
    invokeMara: async (current) => {
      const args = {
        stage: "stage_4_mara" as const,
        persona: "mara" as const,
        systemPrompt,
        userContent: [
          { type: "text" as const, text: JSON.stringify({ shotList: current }) },
        ],
        schema: CritiqueArraySchema,
        cacheKeyExtra: JSON.stringify(
          current.beats.map((b) => `${b.shot_id}:${b.narrator_line}`),
        ),
      };
      if (useLegacy) {
        return arkChat<CriticCritique[]>(args);
      }
      // Z.AI / GLM-5.1 returns variant shapes (missing severity/excerpt/reason,
      // wraps in { critiques: [...] }, etc). The tolerant schema normalizes
      // them to CritiqueSchema before downstream consumers see them.
      return zaiChat<CriticCritique[]>({ ...args, schema: TolerantCritiqueArraySchema });
    },
    // Atlas redraft is optional — when not provided, runMaraCritique falls
    // back to in-place suggested_revision swaps only. This keeps Stage 4
    // strictly within the 1-round cap (Mara → revision → Mara, no Atlas
    // re-invocation).
  };

  // Convert worker's ShotList to the structurally-typed CriticShotList.
  const adapted = {
    beats: shotList.beats.map((b) => ({
      shot_id: b.beat_id,
      narrator_line: b.narrator_line,
    })),
  };
  const result = await runMaraCritique(adapted, ctx);

  // Apply revisions back to the typed ShotList.
  const revisedById = new Map(
    result.revisedShotList.beats.map((b) => [b.shot_id, b.narrator_line]),
  );
  const revised: ShotList = {
    logline: shotList.logline,
    beats: shotList.beats.map((b) => ({
      ...b,
      narrator_line: revisedById.get(b.beat_id) ?? b.narrator_line,
    })),
  };

  // Mara E.1: critique writes are fire-and-forget.
  persistCritiquesAsync(forgeRunId, result.critiques);

  const blocks = result.critiques.filter((c) => c.severity === "block").length;
  await emitTrace({
    forgeRunId,
    stage: "stage_4_mara",
    message: `Mara: ${result.critiques.length} critiques (${blocks} blocks) in ${result.rounds} round(s)`,
    persona: "mara",
    duration_ms: Date.now() - start,
    data: {
      total: result.critiques.length,
      blocks,
      rounds: result.rounds,
    },
  });

  return { shotList: revised, critiques: result.critiques };
}
