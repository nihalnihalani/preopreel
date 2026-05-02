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

// BytePlus ARK content-generation tasks API:
//   POST /contents/generations/tasks       -> { id }
//   GET  /contents/generations/tasks/{id}  -> { id, status, content?: { video_url } }
// Status values observed: queued | running | succeeded | failed | cancelled.
interface SeedanceJobStatus {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  content?: { video_url?: string; last_frame_url?: string; duration_s?: number };
  error?: { message?: string } | string;
}

async function pollUntilDone(
  apiKey: string,
  taskId: string,
): Promise<SeedanceJobStatus> {
  const start = Date.now();
  let waitMs = POLL_BASE_MS;
  while (true) {
    if (Date.now() - start > POLL_OVERALL_MS) {
      throw new SeedanceJobError(
        `Seedance task ${taskId} timed out after ${POLL_OVERALL_MS}ms`,
      );
    }
    await new Promise((r) => setTimeout(r, waitMs));
    waitMs = Math.min(POLL_MAX_MS, Math.floor(waitMs * 1.5));
    const res = await fetch(
      `${SEEDANCE_BASE_URL}/contents/generations/tasks/${taskId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
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
      const errMsg =
        typeof body.error === "string"
          ? body.error
          : body.error?.message ?? "unknown";
      throw new SeedanceJobError(
        `Seedance task ${taskId} ${body.status}: ${errMsg}`,
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
  id: string;
}

interface CachedSegment {
  bytes: Uint8Array;
  meta: SeedanceSegment & { cost_estimate_usd: number };
}

// The pinned video model takes a content[] array on /contents/generations/tasks.
// Generation parameters (duration / resolution / ratio) are encoded as
// --flag tokens appended to the text prompt — this is the documented v1 shape.
type ContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

function buildContentText(payload: SeedancePayload): ContentItem {
  const aspect = payload.aspect_ratio ?? "16:9";
  const duration = Math.min(payload.duration_s, 5);
  const flags = ` --duration ${duration} --resolution 1080p --ratio ${aspect}`;
  return { type: "text", text: payload.prompt + flags };
}

// BytePlus Seedream returns short-lived signed TOS URLs. Seedance's image
// fetcher cannot consume them (cross-service signature mismatch — 400
// "content[1].image_url is not valid"). We sidestep that by inlining the
// keyframe bytes as a base64 data URI before submitting the task.
async function fetchableImageUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  if (!/^https?:\/\//.test(url)) return url;
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) return url;
  const ct = r.headers.get("content-type") ?? "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${ct};base64,${buf.toString("base64")}`;
}

async function buildContent(payload: SeedancePayload): Promise<ContentItem[]> {
  const items: ContentItem[] = [buildContentText(payload)];
  const firstRef = payload.video_ref ?? payload.image_refs[0];
  if (firstRef) {
    const inlineUrl = await fetchableImageUrl(firstRef);
    items.push({ type: "image_url", image_url: { url: inlineUrl } });
  }
  return items;
}

async function liveSubmit(
  payload: SeedancePayload,
  model: SeedModelId,
): Promise<CachedSegment> {
  const apiKey = nextKey("seedance");
  const body = { model, content: await buildContent(payload) };
  const res = await fetch(
    `${SEEDANCE_BASE_URL}/contents/generations/tasks`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  );
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
  const status = await pollUntilDone(apiKey, submit.id);
  const videoUrl = status.content?.video_url ?? "";
  let mp4Bytes = new Uint8Array(0);
  if (videoUrl) {
    const v = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (v.ok) mp4Bytes = new Uint8Array(await v.arrayBuffer());
  }
  const dur = status.content?.duration_s ?? Math.min(payload.duration_s, 5);
  return {
    bytes: mp4Bytes,
    meta: {
      request_id: submit.id,
      video_url: videoUrl,
      last_frame_url: status.content?.last_frame_url ?? "",
      duration_s: dur,
      cost_estimate_usd: 0.05 * dur,
    },
  };
}

// Extend not natively supported on the pinned v1 video model. We emulate
// extension by chaining I2V calls off the prior segment's last_frame_url —
// runWithExtend below already does this when remaining > 0.
async function liveExtend(
  prevLastFrameUrl: string,
  prompt: string,
  durationS: number,
): Promise<CachedSegment> {
  const payload: SeedancePayload = {
    beatId: `extend-${Date.now()}`,
    prompt,
    image_refs: prevLastFrameUrl ? [prevLastFrameUrl] : [],
    duration_s: durationS,
  };
  if (payload.image_refs.length === 0) {
    throw new SeedanceJobError(
      "Seedance extend: prev segment has no last_frame_url; cannot chain.",
    );
  }
  // Reuse the standard submit path with the prev last frame as the anchor.
  // VIDEO_EXTEND_MODEL is currently aliased to the same model id as VIDEO_MODEL.
  return liveSubmit(payload, VIDEO_EXTEND_MODEL);
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
      prev_last_frame: prev.last_frame_url,
      prompt,
      durationS,
    });
    const cached = await withReplay<CachedSegment>({
      stage: "stage_9_seedance_extend",
      key: cacheKey,
      codec: "mp4",
      live: () => liveExtend(prev.last_frame_url, prompt, durationS),
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

    // The pinned video model does not surface a usable last_frame_url in the
    // task status response, which means we cannot chain extend segments off
    // the prior tail frame. For beats >5s we accept a 5s cap rather than
    // breaking the pipeline. Remotion can ease/repeat to fill the duration
    // at composition time.
    let remaining = payload.duration_s - 5;
    while (remaining > 0 && head.last_frame_url) {
      const chunk = Math.min(remaining, 5);
      const extKey = hashCacheKey({
        kind: "extend",
        prev_last_frame: head.last_frame_url,
        prompt: payload.prompt,
        durationS: chunk,
      });
      const cachedExt = await withReplay<CachedSegment>({
        stage: "stage_9_seedance_extend",
        key: extKey,
        codec: "mp4",
        live: () => liveExtend(head.last_frame_url, payload.prompt, chunk),
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
