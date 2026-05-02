// src/lib/seed/models.ts
//
// SINGLE SOURCE OF TRUTH for BytePlus Seed model IDs.
// Per Invariant 2 (CLAUDE.md), no other file in this repo may embed these strings.
// A pre-tool-use hook + CI grep enforce this. If you find yourself wanting to
// import a literal model id elsewhere, import from this file instead.
//
// Mara C.2 mitigation: dynamic-string templates that build a model id are
// also forbidden. Tests in tests/synthesis-worker/test_replay_branch.test.ts
// + scripts/check_invariants.ts enforce both literal and template-substring forms.

export const SEED_MODELS = {
  /** Atlas (Director). */
  director: "seed-2.0-pro",
  /** Mara (Devil's Advocate) — same model, different system prompt + temperature. */
  vision_critic: "seed-2.0-pro",
  /** Seedream Tier-0 keyframe anchor. NEVER skipped — Invariant 2 sub-rule. */
  keyframes: "seedream-5.0-lite",
  /** Seedance per-beat I2V / T2V-with-ref. Naked T2V is forbidden. */
  video: "seedance-2.0",
  /** Seedance long-beat chained generation (>5s). request_id chaining. */
  video_extend: "seedance-2.0-extend",
  /** Seed Speech narration. Bounded to plan corpus by Mara/Lyra. */
  speech: "seed-speech-2.0",
  /** OmniHuman optional surgeon greeting (≤8s, opt-in). Layer-2 only. */
  presenter: "omnihuman-1.5",
} as const;

export type SeedModelKey = keyof typeof SEED_MODELS;
export type SeedModelId = (typeof SEED_MODELS)[SeedModelKey];

// Individual exports — re-exports for ergonomic destructuring at call sites.
export const DIRECTOR_MODEL = SEED_MODELS.director;
export const VISION_CRITIC_MODEL = SEED_MODELS.vision_critic;
export const KEYFRAMES_MODEL = SEED_MODELS.keyframes;
export const VIDEO_MODEL = SEED_MODELS.video;
export const VIDEO_EXTEND_MODEL = SEED_MODELS.video_extend;
export const SPEECH_MODEL = SEED_MODELS.speech;
export const PRESENTER_MODEL = SEED_MODELS.presenter;

// Region + base URL come from env at boot. Wrappers import from here so the
// env-resolution order is documented in one place.
export const SEED_REGION: string = process.env.ARK_REGION ?? "ap-southeast";
export const SEED_BASE_URL: string =
  process.env.ARK_BASE_URL ?? "https://ark.ap-southeast.bytepluses.com/api/v3";
export const SEEDANCE_BASE_URL: string =
  process.env.SEEDANCE_BASE_URL ?? SEED_BASE_URL;

// ─── LLM_MODELS — non-Seed LLM providers ───────────────────────────────────
//
// The handbook mandates LLM = Z.AI (BigModel). The hackathon-issued ZAI_API_KEY
// is "exclusively for the glm 5.1 model" per Beta University Discord (5/1).
// Atlas / Mara / Lyra route through src/lib/seed/zai.ts, which reads
// process.env.ZAI_MODEL with this default. SEED_MODELS above stays untouched
// so the legacy ARK fallback (USE_LEGACY_PROVIDERS=1) and the four media
// surfaces (Seedance / Seedream / Speech / OmniHuman) keep their pins.
export const LLM_MODELS = {
  /** Atlas (Director) — Z.AI handbook stack. */
  director_zai: "glm-5.1",
  /** Mara (Devil's Advocate) — same model, different system prompt + temperature. */
  devils_advocate_zai: "glm-5.1",
  /** Lyra (Vision Critic) — multimodal. glm-5.1 is multimodal. */
  vision_critic_zai: "glm-5.1",
} as const;

export type LlmModelKey = keyof typeof LLM_MODELS;
export type LlmModelId = (typeof LLM_MODELS)[LlmModelKey];

export const ZAI_BASE_URL: string =
  process.env.ZAI_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4";
export const ZAI_MODEL: string = process.env.ZAI_MODEL ?? LLM_MODELS.director_zai;
