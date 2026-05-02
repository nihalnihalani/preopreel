// src/lib/forge/critic.ts
//
// Shared critic-loop primitives. Two entry points:
//   - runMaraCritique(shotList, ctx)  → 1-round cap (Mara A.2 + Stage 4)
//   - runLyraCritique(beat, ctx)      → 1-regen budget + score floor (Mara A.3)
//
// The critique/score-floor logic lives here so the worker stages stay thin
// (stage4_mara.ts and stage10_vision_critic.ts call into this).
//
// Score floor (Mara A.3): after the 1 regen attempt is exhausted, accept
// the second score and mark accepted_with_low_score=true so the HUD can
// display the honest badge. We do NOT block the pipeline.

// ─── Duck-typed schemas (Schema Dev owns the real Zod schemas) ────────────
//
// We use structural typing here so this module compiles before Schema Dev
// lands `critique.ts`. Worker stages convert from Schema Dev's Zod-validated
// types to these structural shapes at the call boundary.

export interface CriticShot {
  shot_id: string;
  narrator_line: string;
}

export interface CriticShotList {
  beats: CriticShot[];
}

export interface CriticCritique {
  shot_id: string;
  severity: "block" | "warn" | "info";
  category: string;
  excerpt: string;
  reason: string;
  suggested_revision?: string;
}

export interface CriticScore {
  beat_id: string;
  anatomical_fidelity: number;
  procedure_step_compliance: number;
  on_screen_text_violations: number;
  feedback: string;
}

// ─── Mara critique loop (Stage 4) ──────────────────────────────────────────

export interface MaraContext {
  /** Persona invocation — typically wraps arkChat with Mara's system prompt. */
  invokeMara: (shotList: CriticShotList) => Promise<CriticCritique[]>;
  /** Atlas redraft — applied to block-severity shots when no suggested_revision exists. */
  redraftFromAtlas?: (
    shotList: CriticShotList,
    blockedShotIds: string[],
  ) => Promise<CriticShotList>;
}

export interface MaraResult {
  revisedShotList: CriticShotList;
  critiques: CriticCritique[];
  /** Number of Mara passes invoked (≤2 — initial + 1 round-cap). */
  rounds: number;
}

/**
 * Run Mara's pre-render critique with a strict 1-round cap. Pass 1 collects
 * critiques; we apply suggested_revision in-place for `block` severity, OR
 * kick blocked shots back to Atlas for redraft (single round). Pass 2
 * re-runs Mara on the revised ShotList. Whatever pass 2 returns ships —
 * remaining blocks are surfaced as warnings (per plan 02 §9.3 stage 4).
 */
export async function runMaraCritique(
  shotList: CriticShotList,
  ctx: MaraContext,
): Promise<MaraResult> {
  const round1 = await ctx.invokeMara(shotList);
  const blocks1 = round1.filter((c) => c.severity === "block");
  if (blocks1.length === 0) {
    return { revisedShotList: shotList, critiques: round1, rounds: 1 };
  }

  // Apply suggested_revision in-place; collect ids needing Atlas redraft.
  const revisions = new Map<string, string>();
  const needsRedraft: string[] = [];
  for (const b of blocks1) {
    if (b.suggested_revision) revisions.set(b.shot_id, b.suggested_revision);
    else needsRedraft.push(b.shot_id);
  }

  let revised: CriticShotList = {
    beats: shotList.beats.map((b) =>
      revisions.has(b.shot_id)
        ? { ...b, narrator_line: revisions.get(b.shot_id) ?? b.narrator_line }
        : b,
    ),
  };

  if (needsRedraft.length > 0 && ctx.redraftFromAtlas) {
    revised = await ctx.redraftFromAtlas(revised, needsRedraft);
  }

  // Round-cap: re-invoke Mara once more on the revised shot list. Whatever
  // critiques come back (including remaining blocks) are surfaced — we do
  // NOT loop again.
  const round2 = await ctx.invokeMara(revised);
  return {
    revisedShotList: revised,
    critiques: [...round1, ...round2],
    rounds: 2,
  };
}

// ─── Lyra critique loop (Stage 10) ─────────────────────────────────────────

export interface LyraContext {
  invokeLyra: () => Promise<CriticScore>;
  /** Re-run Seedance for this beat with feedback appended. Returns nothing — feedback is emitted upstream. */
  regenerate: (feedback: string) => Promise<void>;
  /** Critic fidelity threshold. Default 0.75 from CRITIC_FIDELITY_THRESHOLD. */
  threshold?: number;
}

export interface LyraResult {
  score: CriticScore;
  /** All scoring attempts — for HUD/audit honesty. */
  attempts: CriticScore[];
  regenerated: boolean;
  /** Mara A.3 score floor: true when accepted under the 1-regen-budget cap. */
  accepted_with_low_score: boolean;
}

function isBelowThreshold(
  score: CriticScore,
  threshold: number,
): boolean {
  return (
    Math.min(score.anatomical_fidelity, score.procedure_step_compliance) <
      threshold || score.on_screen_text_violations > 0
  );
}

/**
 * Run Lyra on a rendered beat. If below threshold, regenerate ONCE and
 * re-score. Whatever the second score is, accept it and set
 * accepted_with_low_score=true if still below threshold (Mara A.3 floor).
 *
 * The HUD reads `attempts[]` so judges see the honest trace.
 */
export async function runLyraCritique(
  ctx: LyraContext,
): Promise<LyraResult> {
  const threshold =
    ctx.threshold ??
    Number.parseFloat(process.env.CRITIC_FIDELITY_THRESHOLD ?? "0.75");

  const score1 = await ctx.invokeLyra();
  if (!isBelowThreshold(score1, threshold)) {
    return {
      score: score1,
      attempts: [score1],
      regenerated: false,
      accepted_with_low_score: false,
    };
  }

  // 1-regen budget. Recompile + re-render upstream, then re-score.
  await ctx.regenerate(score1.feedback);
  const score2 = await ctx.invokeLyra();

  // Whatever score2 is, accept it. If still below threshold, surface
  // honestly via accepted_with_low_score.
  return {
    score: score2,
    attempts: [score1, score2],
    regenerated: true,
    accepted_with_low_score: isBelowThreshold(score2, threshold),
  };
}
