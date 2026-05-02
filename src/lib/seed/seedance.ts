// src/lib/seed/seedance.ts
//
// Seedance 2.0 wrapper. Three call shapes:
//  - seedanceI2V         — image-to-video (with prev-beat continuity ref)
//  - seedanceT2VWithRef  — text-to-video with Seedream keyframe ref
//  - seedanceExtend      — chained extend for beats >5s
//
// ★ Invariant 2 sub-rule: every call must include image_refs.length >= 1.
// Naked T2V is forbidden — wrapper throws SeedanceInvariantError on entry.
//
// Polling loop: 2s base, 8s backoff cap, 180s overall cap.
// MAX_CONCURRENT_LANES semaphore via p-limit.
// Every call goes through withReplay (Invariant 3) with codec="mp4".

import pLimit from "p-limit";
import { withReplay, hashCacheKey } from "@/lib/forge/replay";
import { next as nextKey, rotate } from "@/lib/forge/keyRotation";
import {
  VIDEO_MODEL,
  VIDEO_EXTEND_MODEL,
  SEEDANCE_BASE_URL,
  type SeedModelId,
} from "@/lib/seed/models";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SeedancePayload {
  beatId: string;
  prompt: string;
  /** ≥1 — Seedream keyframe + optional anatomy entity refs. */
  image_refs: string[];
  /** Prev-beat last-frame URL for continuity (I2V). Optional. */
  video_ref?: string;
  duration_s: number;
  model?: SeedModelId;
  aspect_ratio?: "16:9" | "9:16";
}

export interface SeedanceSegment {
  request_id: string;
  video_url: string;
  last_frame_url: string;
  duration_s: number;
}

export interface SeedanceResult {
  request_id: string;
  video_url: string;
  last_frame_url: string;
  duration_s: number;
  cost_estimate_usd: number;
  segments: SeedanceSegment[];
}

export class SeedanceInvariantError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SeedanceInvariantError";
  }
}

export class SeedanceJobError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SeedanceJobError";
  }
}

// ─── Concurrency gate ──────────────────────────────────────────────────────

function getMaxLanes(): number {
  const raw = process.env.MAX_CONCURRENT_LANES;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

const limiter = pLimit(getMaxLanes());

// ─── Invariant guard ───────────────────────────────────────────────────────

function guardImageRefs(p: SeedancePayload): void {
  if (!Array.isArray(p.image_refs) || p.image_refs.length === 0) {
    throw new SeedanceInvariantError(
      "Invariant 2 sub-rule: every Seedance call must include ≥1 image_refs " +
        "(Seedream keyframe). Naked T2V is forbidden in this repo.",
    );
  }
}

// ─── Polling ───────────────────────────────────────────────────────────────

const POLL_BASE_MS = 2000;
const POLL_MAX_MS = 8000;
const POLL_OVERALL_MS = 180_000;

interface SeedanceJobStatus {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  request_id: string;
  video_url?: string;
  last_frame_url?: string;
  duration_s?: number;
  error?: string;
}

async function pollUntilDone(
  apiKey: string,
  requestId: string,
): Promise<SeedanceJobStatus> {
  const start = Date.now();
  let waitMs = POLL_BASE_MS;
  while (true) {
    if (Date.now() - start > POLL_OVERALL_MS) {
      throw new SeedanceJobError(
        `Seedance request ${requestId} timed out after ${POLL_OVERALL_MS}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, waitMs));
    waitMs = Math.min(POLL_MAX_MS, Math.floor(waitMs * 1.5));
    const res = await fetch(`${SEEDANCE_BASE_URL}/requests/${requestId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status === 429 || res.status === 401 || res.status === 403) {
        rotate(
          "seedance",
          res.status === 429 ? "429" : res.status === 401 ? "401" : "403",
        );
      } else if (res.status >= 500) {
        rotate("seedance", "5xx");
      }
      // Continue polling — transient.
      continue;
    }
    const body = (await res.json()) as SeedanceJobStatus;
    if (body.status === "succeeded") return body;
    if (body.status === "failed" || body.status === "cancelled") {
      throw new SeedanceJobError(
        `Seedance request ${requestId} ${body.status}: ${body.error ?? "unknown"}`,
      );
    }
  }
}

// ─── Live calls ────────────────────────────────────────────────────────────
//
// liveSubmit / liveExtend return a CachedSegment shape: { bytes, meta }.
// The replay shim's mp4-codec persists `bytes` as `{key}.mp4` and `meta`
// as `{key}.json`; on replay we unpack meta back into a SeedanceSegment.

interface SeedanceSubmitResponse {
  request_id: string;
}

interface CachedSegment {
  bytes: Uint8Array;
  meta: SeedanceSegment & { cost_estimate_usd: number };
}

async function liveSubmit(
  payload: SeedancePayload,
  model: SeedModelId,
): Promise<CachedSegment> {
  const apiKey = nextKey("seedance");
  const body = {
    model,
    prompt: payload.prompt,
    image_refs: payload.image_refs,
    video_ref: payload.video_ref,
    duration_s: Math.min(payload.duration_s, 5),
    aspect_ratio: payload.aspect_ratio ?? "16:9",
  };
  const res = await fetch(`${SEEDANCE_BASE_URL}/seedance/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      rotate(
        "seedance",
        res.status === 429 ? "429" : res.status === 401 ? "401" : "403",
      );
    } else if (res.status >= 500) {
      rotate("seedance", "5xx");
    }
    throw new SeedanceJobError(
      `Seedance submit failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  const submit = (await res.json()) as SeedanceSubmitResponse;
  const status = await pollUntilDone(apiKey, submit.request_id);
  const videoUrl = status.video_url ?? "";
  let mp4Bytes = new Uint8Array(0);
  if (videoUrl) {
    const v = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (v.ok) mp4Bytes = new Uint8Array(await v.arrayBuffer());
  }
  return {
    bytes: mp4Bytes,
    meta: {
      request_id: submit.request_id,
      video_url: videoUrl,
      last_frame_url: status.last_frame_url ?? "",
      duration_s: status.duration_s ?? body.duration_s,
      cost_estimate_usd: 0.05 * body.duration_s,
    },
  };
}

async function liveExtend(
  prevRequestId: string,
  prompt: string,
  durationS: number,
): Promise<CachedSegment> {
  const apiKey = nextKey("seedance");
  const body = {
    model: VIDEO_EXTEND_MODEL,
    request_id: prevRequestId,
    prompt,
    duration_s: durationS,
  };
  const res = await fetch(`${SEEDANCE_BASE_URL}/seedance/extend`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new SeedanceJobError(
      `Seedance extend failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  const submit = (await res.json()) as SeedanceSubmitResponse;
  const status = await pollUntilDone(apiKey, submit.request_id);
  const videoUrl = status.video_url ?? "";
  let mp4Bytes = new Uint8Array(0);
  if (videoUrl) {
    const v = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (v.ok) mp4Bytes = new Uint8Array(await v.arrayBuffer());
  }
  return {
    bytes: mp4Bytes,
    meta: {
      request_id: submit.request_id,
      video_url: videoUrl,
      last_frame_url: status.last_frame_url ?? "",
      duration_s: status.duration_s ?? durationS,
      cost_estimate_usd: 0.05 * durationS,
    },
  };
}

/** Pull a SeedanceSegment out of the {bytes, meta} cached shape. */
function unwrap(cached: CachedSegment): SeedanceSegment & { cost_estimate_usd: number } {
  return cached.meta;
}

// ─── Public entry points ───────────────────────────────────────────────────

/**
 * I2V (image-to-video) with prev-beat continuity. Requires `video_ref`
 * pointing at the previous beat's last frame and `image_refs` containing
 * the Seedream keyframe (Tier-0 anchor).
 */
export async function seedanceI2V(
  payload: SeedancePayload,
): Promise<SeedanceResult> {
  guardImageRefs(payload);
  if (!payload.video_ref) {
    throw new SeedanceInvariantError(
      "seedanceI2V requires video_ref (prev-beat last_frame_url)",
    );
  }
  return runWithExtend(payload);
}

/**
 * T2V-with-ref. Used for the very first beat (no prior frame). image_refs
 * MUST include the Seedream keyframe.
 */
export async function seedanceT2VWithRef(
  payload: SeedancePayload,
): Promise<SeedanceResult> {
  guardImageRefs(payload);
  return runWithExtend(payload);
}

/**
 * Direct extend — chains a new segment off an existing request_id. Used by
 * the worker for >5s beats. Most callers use seedanceI2V/T2VWithRef which
 * call extend internally; this is for explicit chaining tests.
 */
export async function seedanceExtend(
  prev: SeedanceResult,
  prompt: string,
  durationS: number,
): Promise<SeedanceResult> {
  return limiter(async () => {
    const cacheKey = hashCacheKey({
      kind: "extend",
      prev_request_id: prev.request_id,
      prompt,
      durationS,
    });
    const cached = await withReplay<CachedSegment>({
      stage: "stage_9_seedance_extend",
      key: cacheKey,
      codec: "mp4",
      live: () => liveExtend(prev.request_id, prompt, durationS),
    });
    const seg = unwrap(cached);
    return {
      request_id: seg.request_id,
      video_url: seg.video_url,
      last_frame_url: seg.last_frame_url,
      duration_s: seg.duration_s,
      cost_estimate_usd: seg.cost_estimate_usd,
      segments: [...prev.segments, seg],
    };
  });
}

// ─── Internal: submit + extend chain for >5s beats ────────────────────────

async function runWithExtend(
  payload: SeedancePayload,
): Promise<SeedanceResult> {
  return limiter(async () => {
    const model = payload.model ?? VIDEO_MODEL;
    const cacheKey = hashCacheKey({
      kind: "submit",
      beatId: payload.beatId,
      prompt: payload.prompt,
      image_refs: payload.image_refs,
      video_ref: payload.video_ref ?? null,
      duration_s: payload.duration_s,
      aspect_ratio: payload.aspect_ratio ?? "16:9",
      model,
    });

    const cachedFirst = await withReplay<CachedSegment>({
      stage: "stage_9_seedance",
      key: cacheKey,
      codec: "mp4",
      live: () => liveSubmit(payload, model),
    });
    const first = unwrap(cachedFirst);
    let head: SeedanceSegment & { cost_estimate_usd: number } = first;
    const segments: SeedanceSegment[] = [first];

    let remaining = payload.duration_s - 5;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 5);
      const extKey = hashCacheKey({
        kind: "extend",
        prev_request_id: head.request_id,
        prompt: payload.prompt,
        durationS: chunk,
      });
      const cachedExt = await withReplay<CachedSegment>({
        stage: "stage_9_seedance_extend",
        key: extKey,
        codec: "mp4",
        live: () => liveExtend(head.request_id, payload.prompt, chunk),
      });
      const ext = unwrap(cachedExt);
      segments.push(ext);
      head = ext;
      remaining -= chunk;
    }

    return {
      request_id: head.request_id,
      video_url: head.video_url,
      last_frame_url: head.last_frame_url,
      duration_s: payload.duration_s,
      cost_estimate_usd: segments.reduce(
        (s, x) => s + ((x as { cost_estimate_usd?: number }).cost_estimate_usd ?? 0),
        0,
      ),
      segments,
    };
  });
}
