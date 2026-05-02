// apps/synthesis-worker/stages/05-anatomy-bible.ts
//
// Stage 5 — Anatomy Bible. Lyra extracts entity portraits and calls
// Seedream once per entity (1–3 ref images). Output is wired into
// AnatomyEntity.refImages so Stage 7 keyframe assembly can reference them.

import { seedreamKeyframe } from "@/lib/seed/seedream";
import { emitTrace } from "../sse";
import { persistForgeRunStatus } from "../persist";
import type { ShotList } from "./03-director";
import type { AnatomyGraph, AnatomyEntity, Stage2Result } from "./02-research";

export interface Stage5Input {
  forgeRunId: string;
  shotList: ShotList;
  research: Stage2Result;
}

export interface Stage5Result {
  graph: AnatomyGraph;
}

export async function runStage5(input: Stage5Input): Promise<Stage5Result> {
  const { forgeRunId, shotList, research } = input;
  const start = Date.now();
  await persistForgeRunStatus(forgeRunId, "bibling");
  await emitTrace({
    forgeRunId,
    stage: "stage_5_anatomy_bible",
    message: "building anatomy bible (entity portraits)",
    persona: "lyra",
  });

  // Subset entities by what the ShotList actually focuses on.
  const focused = new Set<string>();
  for (const b of shotList.beats) for (const f of b.anatomical_focus) focused.add(f);

  const enriched: AnatomyEntity[] = [];
  for (const entity of research.anatomy.entities) {
    if (!focused.has(entity.id) && focused.size > 0) {
      enriched.push(entity);
      continue;
    }
    try {
      const portrait = await seedreamKeyframe({
        stage: "stage_5_anatomy_bible",
        beatId: `entity_${entity.id}`,
        prompt: `Anatomical reference portrait of ${entity.name} (entity_id=${entity.id}). ` +
          "Single anatomical structure isolated, neutral background, " +
          "anatomy textbook clarity.",
        style_refs: research.exa.map((s) => ({ url: s.url, weight: s.weight })),
      });
      // Persist locally for tests; in production the URL would come from
      // a CDN upload. Replay mode returns bytes only.
      enriched.push({
        ...entity,
        refImages: [
          ...(entity.refImages ?? []),
          // Synthetic placeholder — Schema Dev's storage upload writes a real URL.
          `replay://stage_5_anatomy_bible/${forgeRunId}/${entity.id}.png`,
        ],
      });
      await emitTrace({
        forgeRunId,
        stage: "stage_5_anatomy_bible",
        message: `entity portrait: ${entity.name}`,
        persona: "lyra",
        data: { entity_id: entity.id, bytes: portrait.bytes.byteLength },
      });
    } catch (err) {
      // Don't hard-stop on a single entity failure; log and continue.
      await emitTrace({
        forgeRunId,
        stage: "stage_5_anatomy_bible",
        message: `entity portrait failed: ${entity.id} (${(err as Error).message})`,
        persona: "lyra",
      });
      enriched.push(entity);
    }
  }

  await emitTrace({
    forgeRunId,
    stage: "stage_5_anatomy_bible",
    message: `anatomy bible complete: ${enriched.length} entities`,
    persona: "lyra",
    duration_ms: Date.now() - start,
  });
  return {
    graph: { entities: enriched, landmarks: research.anatomy.landmarks },
  };
}
