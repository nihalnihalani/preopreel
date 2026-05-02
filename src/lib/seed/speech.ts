// src/lib/seed/speech.ts
//
// Seed Speech 2.0 wrapper. 4 voice presets. Returns 24kHz mono WAV bytes.
// Every call goes through withReplay (Invariant 3) with codec="wav".
//
// IMPORTANT — bounded-text invariant: the text-corpus boundedness contract
// (narrator lines ⊂ plan + anatomy bible + cited protocols) is held UPSTREAM
// by Mara (Stage 4 pre-render) and Lyra (Stage 10 post-render).
// This wrapper deliberately does NOT validate the corpus — only length
// sanity checks (≤1200 chars). Do NOT add a content filter here without
// updating Stage 4 and Stage 10 to match. (Mara D.1 mitigation lives in
// atlas-surgical.ts; do not duplicate it.)

import { withReplay, hashCacheKey } from "@/lib/forge/replay";
import { next as nextKey, rotate } from "@/lib/forge/keyRotation";
import { SPEECH_MODEL, SEED_BASE_URL, type SeedModelId } from "@/lib/seed/models";

export type VoicePreset = "warm-female" | "warm-male" | "neutral" | "soft";

const VOICE_MAP: Record<VoicePreset, string> = {
  "warm-female": "zh_female_warm_clinical_v2",
  "warm-male": "zh_male_warm_clinical_v2",
  neutral: "zh_neutral_announcer_v2",
  soft: "zh_female_soft_v2",
};

export interface SeedSpeechOptions {
  /** Stage tag for replay key. Default: "stage_11_speech". */
  stage?: string;
  /** Beat id used as cache-key salt. */
  beatId?: string;
  text: string;
  voice?: VoicePreset;
  /** PCM sample rate. Default 24000 to match Remotion mux pipeline. */
  sampleRate?: number;
  /** 0.85..1.15. Default 1.0. */
  speed?: number;
  /** -3..+3 semitones. Default 0. */
  pitch?: number;
  model?: SeedModelId;
  forgeRunId?: string;
}

export interface SeedSpeechResult {
  /** Raw WAV bytes (PCM s16le with WAV header). */
  bytes: Uint8Array;
  meta: {
    durationMs: number;
    text: string;
    voice: VoicePreset;
    sampleRate: number;
    cost_estimate_usd: number;
  };
}

export class SeedSpeechError extends Error {
  constructor(
    public readonly status: number,
    msg: string,
  ) {
    super(msg);
    this.name = "SeedSpeechError";
  }
}

// ─── PCM → WAV (24kHz mono s16le header) ──────────────────────────────────

function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const dataSize = pcm.byteLength;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  // RIFF chunk descriptor
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  // "fmt " sub-chunk
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  // "data" sub-chunk
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);
  // PCM payload
  const out = new Uint8Array(buf);
  out.set(pcm, 44);
  return out;
}

function writeStr(view: DataView, off: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
}

// ─── Live call ─────────────────────────────────────────────────────────────

interface SeedSpeechApiResponse {
  audio_b64?: string;
  duration_ms?: number;
}

async function liveSynthesize(
  opts: SeedSpeechOptions,
  voice: VoicePreset,
  sampleRate: number,
  model: SeedModelId,
): Promise<SeedSpeechResult> {
  const apiKey = nextKey("ark");
  const body = {
    model,
    text: opts.text,
    voice: VOICE_MAP[voice],
    audio_format: "pcm",
    sample_rate: sampleRate,
    channels: 1,
    speed: opts.speed ?? 1.0,
    pitch: opts.pitch ?? 0,
  };
  const res = await fetch(`${SEED_BASE_URL}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      rotate("ark", res.status === 429 ? "429" : res.status === 401 ? "401" : "403");
    } else if (res.status >= 500) {
      rotate("ark", "5xx");
    }
    throw new SeedSpeechError(
      res.status,
      `Seed Speech ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
  const j = (await res.json()) as SeedSpeechApiResponse;
  const pcm = j.audio_b64
    ? Uint8Array.from(Buffer.from(j.audio_b64, "base64"))
    : new Uint8Array(0);
  const wav = pcmToWav(pcm, sampleRate);
  const durationMs =
    j.duration_ms ?? Math.round((pcm.byteLength / 2 / sampleRate) * 1000);
  return {
    bytes: wav,
    meta: {
      durationMs,
      text: opts.text,
      voice,
      sampleRate,
      cost_estimate_usd: 0.001 * Math.max(1, opts.text.length),
    },
  };
}

// ─── Public ────────────────────────────────────────────────────────────────

/**
 * Synthesize narration for one beat. Returns WAV bytes.
 */
export async function seedSpeech(
  opts: SeedSpeechOptions,
): Promise<SeedSpeechResult> {
  if (!opts.text || opts.text.trim().length === 0) {
    throw new SeedSpeechError(400, "seedSpeech: text is empty");
  }
  if (opts.text.length > 1200) {
    throw new SeedSpeechError(
      400,
      `seedSpeech: text length ${opts.text.length} exceeds 1200-char beat cap`,
    );
  }
  const voice = opts.voice ?? "warm-female";
  const sampleRate = opts.sampleRate ?? 24000;
  const model = opts.model ?? SPEECH_MODEL;
  const cacheKey = hashCacheKey({
    text: opts.text,
    voice,
    sampleRate,
    speed: opts.speed ?? 1.0,
    pitch: opts.pitch ?? 0,
    model,
    beatId: opts.beatId ?? null,
  });
  return withReplay<SeedSpeechResult>({
    stage: opts.stage ?? "stage_11_speech",
    key: cacheKey,
    codec: "wav",
    forgeRunId: opts.forgeRunId,
    live: () => liveSynthesize(opts, voice, sampleRate, model),
  });
}
