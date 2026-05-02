// src/lib/seed/seedream.ts
//
// Seedream 5.0 Lite wrapper — Tier-0 keyframe anchor (Invariant 2 sub-rule).
// Generates the per-beat keyframe that every Seedance call references in
// image_refs. Without this, Seedance is unanchored and invents organs.
//
// Every call goes through withReplay (Invariant 3) with codec="png".

import { withReplay, hashCacheKey } from "@/lib/forge/replay";
import { next as nextKey, rotate } from "@/lib/forge/keyRotation";
import { KEYFRAMES_MODEL, SEED_BASE_URL, type SeedModelId } from "@/lib/seed/models";

export interface SeedreamRefImage {
  url: string;
  weight?: number;
  /** Optional label — anatomical entity name for entity-bible refs. */
  entity?: string;
}

export interface SeedreamKeyframeOptions {
  /** Stage tag for replay key. Default: "stage_7_seedream". */
  stage?: string;
  /** Beat id used as a cache-key salt. */
  beatId: string;
  /** Compiled prompt: procedure_step + lens suffix + anatomy clauses. */
  prompt: string;
  /** Anatomy entity references (1–3 per anatomical region). */
  anatomical_refs?: SeedreamRefImage[];
  /** Style references from Exa neural search. */
  style_refs?: SeedreamRefImage[];
  aspect_ratio?: "16:9" | "9:16";
  seed?: number;
  model?: SeedModelId;
  forgeRunId?: string;
}

export interface SeedreamResult {
  /** Raw PNG bytes — what callers want. */
  bytes: Uint8Array;
  /** Metadata persisted alongside the bytes. */
  meta: {
    width: number;
    height: number;
    prompt_used: string;
    cost_estimate_usd: number;
    /** CDN URL when uploaded; empty in replay mode. */
    url?: string;
  };
}

export class SeedreamError extends Error {
  constructor(
    public readonly status: number,
    msg: string,
  ) {
    super(msg);
    this.name = "SeedreamError";
  }
}

// ─── Prompt assembly (deterministic) ───────────────────────────────────────

function assemblePrompt(opts: SeedreamKeyframeOptions): string {
  const parts: string[] = [opts.prompt];
  if (opts.anatomical_refs && opts.anatomical_refs.length > 0) {
    const labels = opts.anatomical_refs
      .map((r) => r.entity ?? "anatomy")
      .filter((s, i, a) => a.indexOf(s) === i);
    parts.push(`Anatomy: ${labels.join(", ")}.`);
  }
  if (opts.style_refs && opts.style_refs.length > 0) {
    parts.push("Style refs: see image inputs.");
  }
  parts.push(
    "Lighting: clinical OR overhead, neutral 5500K, no harsh shadows.",
  );
  parts.push(
    `Aspect: ${opts.aspect_ratio ?? "16:9"}, hero-shot, no text overlays, no glyphs.`,
  );
  return parts.join("\n");
}

// ─── Live call ─────────────────────────────────────────────────────────────

interface SeedreamApiResponse {
  image_url?: string;
  width?: number;
  height?: number;
}

async function liveGenerate(
  opts: SeedreamKeyframeOptions,
  prompt: string,
  model: SeedModelId,
): Promise<SeedreamResult> {
  const apiKey = nextKey("ark");
  const refs = [
    ...(opts.anatomical_refs ?? []).map((r) => ({ url: r.url, weight: r.weight ?? 1.0 })),
    ...(opts.style_refs ?? []).map((r) => ({ url: r.url, weight: r.weight ?? 0.6 })),
  ];
  const body = {
    model,
    prompt,
    refs,
    aspect_ratio: opts.aspect_ratio ?? "16:9",
    seed: opts.seed,
  };
  const res = await fetch(`${SEED_BASE_URL}/seedream/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      rotate("ark", res.status === 429 ? "429" : res.status === 401 ? "401" : "403");
    } else if (res.status >= 500) {
      rotate("ark", "5xx");
    }
    throw new SeedreamError(
      res.status,
      `Seedream ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
  const j = (await res.json()) as SeedreamApiResponse;
  const imageUrl = j.image_url ?? "";
  let bytes = new Uint8Array(0);
  if (imageUrl) {
    const img = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (img.ok) bytes = new Uint8Array(await img.arrayBuffer());
  }
  return {
    bytes,
    meta: {
      width: j.width ?? 1920,
      height: j.height ?? 1080,
      prompt_used: prompt,
      cost_estimate_usd: 0.02,
      url: imageUrl,
    },
  };
}

// ─── Public ────────────────────────────────────────────────────────────────

/**
 * Generate a Seedream Tier-0 keyframe. Returns raw PNG bytes plus a metadata
 * sidecar — the same shape replay.ts expects for codec="png".
 */
export async function seedreamKeyframe(
  opts: SeedreamKeyframeOptions,
): Promise<SeedreamResult> {
  const model = opts.model ?? KEYFRAMES_MODEL;
  const prompt = assemblePrompt(opts);
  const cacheKey = hashCacheKey({
    beatId: opts.beatId,
    prompt,
    anatomical_refs: opts.anatomical_refs ?? [],
    style_refs: opts.style_refs ?? [],
    aspect_ratio: opts.aspect_ratio ?? "16:9",
    seed: opts.seed ?? null,
    model,
  });
  return withReplay<SeedreamResult>({
    stage: opts.stage ?? "stage_7_seedream",
    key: cacheKey,
    codec: "png",
    forgeRunId: opts.forgeRunId,
    live: () => liveGenerate(opts, prompt, model),
  });
}
