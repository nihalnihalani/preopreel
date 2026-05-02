// src/lib/seed/omnihuman.ts
//
// OmniHuman 1.5 wrapper — SCAFFOLDED ONLY for Layer-1.
//
// Mara F.1: cut from the 2-min Layer-1 demo. Synthetic phantom + AI-generated
// surgeon = double-uncanny; trust signal collapses. Default behavior: throw
// OmnihumanLayer2Error unless ENABLE_OMNIHUMAN === "1".
//
// When unlocked for Layer-2, the wrapper will:
//   - submit photo + voUrl to OmniHuman 1.5
//   - poll for completion (≤8s clip)
//   - return uncannyScore so the worker can decide to cut to title card
//   - go through withReplay (Invariant 3)

import { withReplay, hashCacheKey } from "@/lib/forge/replay";
import { next as nextKey, rotate } from "@/lib/forge/keyRotation";
import { PRESENTER_MODEL, SEED_BASE_URL, type SeedModelId } from "@/lib/seed/models";

export interface OmniHumanRequest {
  /** Stage tag for replay key. Default: "stage_11b_omnihuman". */
  stage?: string;
  surgeonPhotoUrl: string;
  voUrl: string;
  durationCapS?: number;
  consentFlag: boolean;
  model?: SeedModelId;
  forgeRunId?: string;
}

export interface OmniHumanResult {
  bytes: Uint8Array;
  meta: {
    mp4Url: string;
    durationS: number;
    /** 0..1; >0.55 ⇒ worker should cut to title card. Layer-2 heuristic. */
    uncannyScore?: number;
    cost_estimate_usd: number;
  };
}

export class OmnihumanLayer2Error extends Error {
  constructor() {
    super(
      "OmniHuman 1.5 is scaffolded only. Set ENABLE_OMNIHUMAN=1 to opt in for Layer-2. " +
        "Mara F.1 cut from Layer-1 demo: synthetic phantom + AI surgeon = double-uncanny.",
    );
    this.name = "OmnihumanLayer2Error";
  }
}

export class OmniHumanConsentError extends Error {
  constructor() {
    super("OmniHuman: consentFlag must be true for the surgeon greeting.");
    this.name = "OmniHumanConsentError";
  }
}

export class OmniHumanDurationError extends Error {
  constructor(durS: number) {
    super(`OmniHuman: clip ${durS}s exceeds 8s cap`);
    this.name = "OmniHumanDurationError";
  }
}

// ─── Live call (only reachable with ENABLE_OMNIHUMAN=1) ───────────────────

interface OmniHumanApiResponse {
  mp4_url?: string;
  duration_s?: number;
  uncanny_score?: number;
}

async function liveGenerate(
  req: OmniHumanRequest,
  model: SeedModelId,
): Promise<OmniHumanResult> {
  const apiKey = nextKey("ark");
  const body = {
    model,
    photo_url: req.surgeonPhotoUrl,
    audio_url: req.voUrl,
    duration_cap_s: req.durationCapS ?? 8,
  };
  const res = await fetch(`${SEED_BASE_URL}/omnihuman/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      rotate("ark", res.status === 429 ? "429" : res.status === 401 ? "401" : "403");
    } else if (res.status >= 500) {
      rotate("ark", "5xx");
    }
    throw new Error(`OmniHuman ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const j = (await res.json()) as OmniHumanApiResponse;
  if (j.duration_s !== undefined && j.duration_s > 8) {
    throw new OmniHumanDurationError(j.duration_s);
  }
  let bytes = new Uint8Array(0);
  if (j.mp4_url) {
    const v = await fetch(j.mp4_url, { signal: AbortSignal.timeout(60_000) });
    if (v.ok) bytes = new Uint8Array(await v.arrayBuffer());
  }
  return {
    bytes,
    meta: {
      mp4Url: j.mp4_url ?? "",
      durationS: j.duration_s ?? 0,
      uncannyScore: j.uncanny_score,
      cost_estimate_usd: 0.25,
    },
  };
}

// ─── Public ────────────────────────────────────────────────────────────────

/**
 * Generate OmniHuman 1.5 talking-head clip. Throws OmnihumanLayer2Error
 * unless ENABLE_OMNIHUMAN=1. Worker decides cut-to-title-card on uncanny.
 */
export async function omnihumanGenerate(
  req: OmniHumanRequest,
): Promise<OmniHumanResult> {
  if (process.env.ENABLE_OMNIHUMAN !== "1") {
    throw new OmnihumanLayer2Error();
  }
  if (!req.consentFlag) throw new OmniHumanConsentError();

  const model = req.model ?? PRESENTER_MODEL;
  const cacheKey = hashCacheKey({
    photo: req.surgeonPhotoUrl,
    voUrl: req.voUrl,
    durationCapS: req.durationCapS ?? 8,
    model,
  });
  return withReplay<OmniHumanResult>({
    stage: req.stage ?? "stage_11b_omnihuman",
    key: cacheKey,
    codec: "mp4",
    forgeRunId: req.forgeRunId,
    live: () => liveGenerate(req, model),
  });
}
