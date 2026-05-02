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

// BytePlus ARK uses an OpenAI-compatible images API:
//   POST /images/generations  -> { data: [{ url }] }
// The pinned keyframe model accepts {model, prompt, size, seed?, image?}.
// Refs are merged into the prompt as a clause; the v4 endpoint does not
// take a separate refs[] array. Anatomical/style refs are still surfaced
// to keep the cache key stable.
interface SeedreamApiResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
  error?: { message?: string };
}

function pickSize(aspect: "16:9" | "9:16"): string {
  return aspect === "16:9" ? "1920x1080" : "1080x1920";
}

async function liveGenerate(
  opts: SeedreamKeyframeOptions,
  prompt: string,
  model: SeedModelId,
): Promise<SeedreamResult> {
  const apiKey = nextKey("ark");
  const aspect = opts.aspect_ratio ?? "16:9";
  const size = pickSize(aspect);
  // Only pass refs that the upstream image API can actually fetch. Stub URLs
  // from dev fixtures (example.invalid, replay://) get dropped; otherwise
  // Seedream returns 400 InvalidParameter for the unreachable host.
  const isFetchable = (u: string | undefined): u is string =>
    !!u &&
    /^https?:\/\//.test(u) &&
    !/example\.invalid|replay:\/\/|localhost|127\.0\.0\.1/.test(u);
  const firstRef =
    [opts.anatomical_refs?.[0]?.url, opts.style_refs?.[0]?.url].find(isFetchable);
  const body: Record<string, unknown> = {
    model,
    prompt,
    size,
    response_format: "url",
  };
  if (typeof opts.seed === "number") body.seed = opts.seed;
  if (firstRef) body.image = firstRef;
  const res = await fetch(`${SEED_BASE_URL}/images/generations`, {
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
  const imageUrl = j.data?.[0]?.url ?? "";
  let bytes = new Uint8Array(0);
  if (imageUrl) {
    const img = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (img.ok) bytes = new Uint8Array(await img.arrayBuffer());
  } else if (j.data?.[0]?.b64_json) {
    bytes = Buffer.from(j.data[0].b64_json, "base64");
  }
  const [wStr, hStr] = size.split("x");
  const w = Number.parseInt(wStr ?? "1920", 10);
  const h = Number.parseInt(hStr ?? "1080", 10);
  return {
    bytes,
    meta: {
      width: w,
      height: h,
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
