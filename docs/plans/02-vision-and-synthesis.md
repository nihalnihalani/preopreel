# Plan 02 — Vision + Synthesis Implementation

> Owner: Vision + Synthesis Dev
> Phase: 3 (post-Phase-2 schema land)
> Scope: `src/lib/seed/*`, `src/lib/forge/replay.ts`, `src/lib/forge/keyRotation.ts`, `apps/synthesis-worker/*`, replay fixtures for demo, tests under `tests/synthesis-worker/`.
> Authority: this plan is binding; deviations require Lead (Atlas) plan-approval per CLAUDE.md §Plan Approval.
> Invariants in scope: Inv-1 (critic), Inv-2 (Seed pin + keyframe anchor), Inv-3 (DEMO_MODE replay).

This plan is the contract I (Vision+Synthesis Dev) execute against. It is dense by design. Sections map 1:1 to the user's brief.

---

## 0. Pre-conditions (what Phase 2 must land first)

Before I start coding in Phase 3, the following must exist (Schema Dev / Personas Dev own these):

- `src/lib/forge/types.ts` — `ForgeRun`, `Beat`, `Patient`, `ProcedurePlan` types.
- `src/lib/forge/shotList.ts` — Zod `ShotListSchema` (logline, beats[].procedure_step_id, anatomical_focus, camera_angle, narrator_line, duration_s).
- `src/lib/forge/critique.ts` — Zod `CritiqueSchema` (Mara) + `CriticScoreSchema` (Lyra). See CLAUDE.md §Critic Loop Schemas.
- `src/lib/forge/anatomyGraph.ts` — Zod `AnatomyGraphSchema` (entities, landmarks[], confidence bands).
- `src/lib/forge/personas/{atlas-surgical,mara,lyra}.ts` — system prompts as exported strings (NOT yet wired to ark).
- `data/surgical-protocols-references.json` — curated PMID/protocol pointers (citation source-of-truth).
- Butterbase migration with `forge_runs`, `beats`, `critiques`, `critic_scores`, `audit_citations` tables.

If any of these are missing at Phase-3 start I block and surface it as a `TaskCreate` blocker rather than stub them.

---

## 1. `src/lib/seed/models.ts` — single source of truth

Per Invariant 2, this is the **only** file in the repo allowed to embed Seed model IDs. A pre-tool-use hook in `.claude/settings.json` greps for `seed-2\.0|seedream-5|seedance-2|seed-speech|omnihuman-1` outside this file and blocks the edit. The CI grep (`npm run check:invariants`) reinforces it.

**Verbatim file body** (~25 lines):

```ts
// src/lib/seed/models.ts
//
// SINGLE SOURCE OF TRUTH for BytePlus Seed model IDs.
// Per Invariant 2 (CLAUDE.md), no other file in this repo may embed these strings.
// A pre-tool-use hook + CI grep enforce this. If you find yourself wanting to import
// a literal model id elsewhere, import from this file instead.

export const SEED_MODELS = {
  /** Atlas (Director) + Mara (Devil's Advocate). Different system prompts, same model. */
  director: "seed-2.0-pro",
  /** Lyra (Vision Critic). Same model, multimodal request shape. */
  vision_critic: "seed-2.0-pro",
  /** Seedream Tier-0 keyframe anchor. NEVER skipped — Invariant 2 sub-rule. */
  keyframes: "seedream-5.0-lite",
  /** Seedance per-beat I2V / T2V-with-ref. Naked T2V is forbidden. */
  video: "seedance-2.0",
  /** Seedance long-beat chained generation (>5s). request_id chaining. */
  video_extend: "seedance-v2.0-extend",
  /** Seed Speech narration. Bounded to plan corpus by Mara/Lyra. */
  speech: "seed-speech-2.0",
  /** OmniHuman optional surgeon greeting (≤8s, opt-in). */
  presenter: "omnihuman-1.5",
} as const;

export type SeedModelKey = keyof typeof SEED_MODELS;
export type SeedModelId = typeof SEED_MODELS[SeedModelKey];

// Individual exports — re-exports for ergonomic destructuring at call sites.
// (Wrappers in this directory may import { DIRECTOR_MODEL } from "./models".)
export const DIRECTOR_MODEL = SEED_MODELS.director;
export const VISION_CRITIC_MODEL = SEED_MODELS.vision_critic;
export const KEYFRAMES_MODEL = SEED_MODELS.keyframes;
export const VIDEO_MODEL = SEED_MODELS.video;
export const VIDEO_EXTEND_MODEL = SEED_MODELS.video_extend;
export const SPEECH_MODEL = SEED_MODELS.speech;
export const PRESENTER_MODEL = SEED_MODELS.presenter;
```

**Notes:**
- `as const` lock so the union type narrows to literals.
- `video_extend` is exported here too even though README calls it a sub-rule, because the hook grep includes `seedance-v2`. Centralizing it keeps the grep clean.
- No runtime logic. This file is data only.

---

## 2. `src/lib/seed/ark.ts` — Seed 2.0 Pro wrapper (Director / Mara / Lyra)

Used by **three personas via three system prompts**. The wrapper is persona-agnostic; the persona modules supply the system prompt and Zod schema.

### 2.1 Endpoint + auth

- Endpoint: `process.env.ARK_BASE_URL` (default `https://ark.ap-southeast.bytepluses.com/api/v3`), OpenAI-compatible.
- Path: `POST /chat/completions`.
- Auth header: `Authorization: Bearer ${rotatedKey}` where `rotatedKey` comes from `keyRotation.next("ark")`. Keyless fallback: if no rotated key, fall back to `process.env.ARK_API_KEY`. If still empty, throw `ArkConfigError`.
- All requests use `fetch` with explicit `signal: AbortSignal.timeout(45_000)`; the wrapper does not import the `openai` SDK (heavy, drift risk).

### 2.2 Public API

```ts
export interface ArkChatOptions<T> {
  forgeRunId: string;
  stage: string;                 // SSE/replay key (e.g., "stage_3_director")
  persona: "atlas" | "mara" | "lyra";
  systemPrompt: string;          // owned by persona module
  userContent: ArkContentPart[]; // text or multimodal
  model?: SeedModelId;           // defaults to SEED_MODELS.director
  schema?: z.ZodType<T>;         // if provided → JSON-mode + safeParse
  stream?: boolean;              // Director only
  temperature?: number;          // default 0.2 for critics, 0.4 for director
  maxTokens?: number;            // default 4096
  cacheKeyExtra?: string;        // adds entropy to replay cache key
}

export type ArkContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low"|"high" } };

export async function arkChat<T = string>(opts: ArkChatOptions<T>): Promise<T>;
export async function arkChatStream(opts: Omit<ArkChatOptions<string>, "schema">): AsyncIterable<string>;
```

### 2.3 JSON-mode structured-output path

When `opts.schema` is provided:

1. First attempt: send `response_format: { type: "json_schema", json_schema: { name: persona, schema: zodToJsonSchema(opts.schema), strict: true } }`. Use `zod-to-json-schema` (npm).
2. Parse `choices[0].message.content` as JSON; run `opts.schema.safeParse(parsed)`. On success, return.
3. **Fallback** if the strict-schema call returns 4xx with code `unsupported_response_format` OR if `safeParse` fails: retry once with `response_format: { type: "json_object" }` and a system-prompt suffix injecting the JSON Schema as plain text. Re-run `safeParse`. On second failure, throw `ArkSchemaError` with both raw outputs attached.

### 2.4 Streaming path (Director only)

- Set `stream: true`. Read SSE chunks, accumulate `delta.content`.
- Yield each delta via `AsyncIterable<string>` so the synthesis worker can emit per-token trace events for the demo HUD ("Atlas is drafting beat 3…").
- No streaming for Mara or Lyra — their outputs are structured and gating downstream stages, so partial reads are not useful.

### 2.5 Multimodal vision path (Lyra)

- Lyra's user content is built by the worker: 4 frame data-URLs per beat + the matching `ShotList.beat` object as a serialized text block + a citation-graph excerpt.
- **Sample-4-frames-per-beat strategy** (Vision-call):
  - Worker uses ffmpeg (already a Remotion peer dep) to extract frames at `t = duration * [0.10, 0.40, 0.65, 0.90]`.
  - Each frame is base64 PNG, ~512px on the long edge (downscaled to keep request under ARK's 4MB cap).
  - Frames are passed as `{ type: "image_url", image_url: { url: "data:image/png;base64,…", detail: "high" } }`.
- Lyra's schema is `CriticScoreSchema`, JSON-mode strict.
- Frames are extracted in `apps/synthesis-worker/stages/stage10_vision_critic.ts` and passed in; ark.ts is dumb about them.

### 2.6 Replay + key rotation integration

Every call site pattern:

```ts
return withReplay({
  stage: opts.stage,
  key: hashCacheKey({ persona: opts.persona, sys: opts.systemPrompt, user: opts.userContent, model, extra: opts.cacheKeyExtra }),
  codec: "json",
  live: () => doLiveArkCall(opts),
});
```

`doLiveArkCall` wraps the actual `fetch` and:
- Pulls key from `keyRotation.next("ark")`.
- On 429/5xx/401/403, calls `keyRotation.rotate("ark", err.status)` and retries up to **2 times** total.
- After exhaustion, throws `ArkUpstreamError` (which `withReplay` in `hybrid` mode interprets as a fall-back-to-cached signal).

### 2.7 Three persona usage examples

```ts
// Director (stage 3, streaming)
arkChat({ stage: "stage_3_director", persona: "atlas",
          systemPrompt: ATLAS_SURGICAL_PROMPT,
          userContent: [{type:"text", text: planJson}],
          schema: ShotListSchema, stream: true });

// Mara (stage 4)
arkChat({ stage: "stage_4_mara", persona: "mara",
          systemPrompt: MARA_DEVILS_ADVOCATE_PROMPT,
          userContent: [{type:"text", text: shotListJson}],
          schema: z.array(CritiqueSchema) });

// Lyra (stage 10)
arkChat({ stage: `stage_10_lyra_${beatId}`, persona: "lyra",
          systemPrompt: LYRA_VISION_CRITIC_PROMPT,
          userContent: [...frames, { type:"text", text: beatContext }],
          schema: CriticScoreSchema });
```

---

## 3. `src/lib/seed/seedance.ts` — Seedance 2.0 wrapper

### 3.1 Three call shapes

| Shape | Seedance call | When |
|---|---|---|
| **T2V-with-ref** | `seedance-2.0` POST with `text` + `image_refs[]` (≥1) | Beat with no prior frame and a Seedream keyframe |
| **I2V** | `seedance-2.0` POST with `text` + `image_refs[0] = keyframe` + `video_ref` | Beat 2..N with prev-beat continuity |
| **T2V-naked** | **forbidden** — wrapper rejects payloads with `image_refs.length === 0` by throwing `SeedanceInvariantError` | — |
| **Extend** | `seedance-v2.0-extend` POST with `request_id` of prior segment + new prompt | Beats > 5s, chained from prior segment |

**Hard guard at the top of `submit()`:**

```ts
if (!payload.image_refs || payload.image_refs.length === 0) {
  throw new SeedanceInvariantError(
    "Invariant 2 sub-rule: every Seedance call must include ≥1 image_refs (Seedream keyframe). " +
    "Naked T2V is forbidden in this repo."
  );
}
```

Test `tests/synthesis-worker/test_keyframe_anchoring.ts` instantiates the wrapper directly with `image_refs: []` and asserts the throw.

### 3.2 Public API

```ts
export interface SeedancePayload {
  forgeRunId: string;
  beatId: string;
  prompt: string;                    // beat text + cinema_suffix (compiled by Stage 8)
  image_refs: string[];              // ≥1 — keyframe + optional entity refs (URLs or data URIs)
  video_ref?: string;                // prev-beat last-frame URL for continuity
  duration_s: number;                // beat duration; >5 triggers extend
  model?: SeedModelId;               // defaults to VIDEO_MODEL
  aspect_ratio?: "16:9" | "9:16";    // default 16:9
}

export interface SeedanceResult {
  request_id: string;                // for chaining + extend
  video_url: string;                 // signed CDN URL
  last_frame_url: string;            // for next beat's video_ref
  duration_s: number;
  cost_estimate_usd: number;
}

export async function submit(p: SeedancePayload): Promise<SeedanceResult>;
export async function extend(prev: SeedanceResult, prompt: string, duration_s: number): Promise<SeedanceResult>;
```

### 3.3 Long-beat extend

If `duration_s > 5`, `submit()`:
1. Generates a 5s seed segment.
2. Loops `extend()` with the prior `request_id`, prompt unchanged, `duration_s = min(remaining, 5)`.
3. Returns the **last** segment's `video_url` and `last_frame_url`. (Stitching across segments is Remotion's job in Stage 12; the wrapper returns each segment's metadata in `SeedanceResult.segments[]` so the worker has them all.)

Refined return type:

```ts
export interface SeedanceResult {
  ...;
  segments: { request_id: string; video_url: string; last_frame_url: string; duration_s: number }[];
}
```

### 3.4 Request-ID polling loop

ModelArk Seedance is async. Submit returns `{ request_id, status: "queued" }`. Wrapper:

- Polls `GET /requests/{request_id}` every **2.0s**.
- Backoff after 30s elapsed: 4s; after 60s: 8s; cap 10s.
- Total timeout: **180s per segment** (configurable via `SEEDANCE_MAX_WAIT_S`).
- On status `succeeded` → resolve; `failed` → throw `SeedanceJobError`; `cancelled` → throw same.
- Polling emits an SSE trace event every poll with `{stage:"stage_9_seedance", message:"polling", request_id, elapsed_s}` so the HUD shows liveness.

### 3.5 `MAX_CONCURRENT_LANES` semaphore

- Module-scope semaphore implemented as `p-limit` (or hand-rolled `Promise<void>[]`).
- `MAX_CONCURRENT_LANES = parseInt(process.env.MAX_CONCURRENT_LANES) || 3` (matches `.env.example`).
- Both `submit` and `extend` acquire one slot; release on resolve/reject.
- The synthesis worker calls `Promise.all(beats.map(b => seedance.submit(p)))` and the semaphore handles fan-out gating; no per-call queue logic in the worker.

### 3.6 Replay + key rotation

- `submit` and `extend` both wrap their live network call in `withReplay({ codec: "mp4" })`.
- Replay cache stores: the resolved `SeedanceResult` JSON next to the actual MP4 bytes (`{key}.json` + `{key}.mp4`), so `replay` mode can serve URLs that point to local files via a dev static server.
- Key rotation: `keyRotation.next("seedance")` (separate provider key from ark — `SEEDANCE_API_KEY` / `_2`).

---

## 4. `src/lib/seed/seedream.ts` — Seedream 5.0 Lite (Tier-0 anchor)

### 4.1 Inputs

```ts
export interface SeedreamRequest {
  forgeRunId: string;
  beatId: string;
  procedureStep: string;             // narrator_line + procedure_step_id description
  anatomicalLandmarks: AnatomicalLandmark[]; // from AnatomyGraph (Stage 2c)
  styleRefs: { url: string; weight?: number }[]; // from Exa (Stage 2b)
  entityRefs?: { url: string; entity: string }[]; // 1–3 from anatomy bible (Stage 5)
  aspectRatio?: "16:9" | "9:16";     // default 16:9
  patientDemographics?: { age: number; bmi: number; sex: "M"|"F"|"X" };
  seed?: number;                      // deterministic regen
}

export interface SeedreamResult {
  png: Buffer;                        // raw bytes
  url: string;                        // CDN-uploaded after .json side-write
  width: number;
  height: number;
  prompt_used: string;                // for audit
  cost_estimate_usd: number;
}
```

### 4.2 Prompt assembly (deterministic)

The wrapper composes the Seedream prompt from inputs in this exact order — the order matters for Seedream's prompt-weighting:

```
[procedure step description]
Anatomy: [landmark.name × confidence × position]…
Style refs: see image inputs.
Patient: 65yo female, BMI 28, supine on OR table.
Lighting: clinical OR overhead, neutral 5500K, no harsh shadows.
Aspect: 16:9, hero-shot, no text overlays, no glyphs.
```

The "no text overlays, no glyphs" suffix is a glyph-soup defensive — Lyra's `on_screen_text_violations` gate downstream is the hard check, but we also discourage upstream.

### 4.3 Entity-bible carryover

`entityRefs` is the Stage 5 anatomy bible's per-entity reference image set. Per anatomical region, **1 to 3 ref images** are passed (Seedream 5.0 Lite practical cap). Selection is by Lyra in Stage 5 (closest matches to the procedure_step). The wrapper does not re-rank — it trusts what Stage 5 wired up.

### 4.4 Output + replay

- `withReplay({ codec: "png" })` — caches the raw PNG bytes to `data/replay/{forge_run_id}/{stage}/{key}.png` and a `{key}.json` with metadata.
- Upload to DigitalOcean Spaces in `live` mode for the URL; in `replay` mode return a `file://` or local-static URL pointing at the cached bytes.

### 4.5 How Lyra invokes this for Stage 5 (anatomy bible)

Lyra (in stage 5) calls `seedream.generate()` once per anatomical entity (typically 4–8 entities for a hip replacement: pelvis-acetabular cup, femur-femoral head, gluteus medius approach point, sciatic nerve landmark, etc.). Each call uses an "entity portrait" prompt template (see Personas Dev's `lyra.ts`). Output URLs are saved on the `AnatomyGraph` entity nodes for later use in Stage 7.

---

## 5. `src/lib/seed/speech.ts` — Seed Speech 2.0

### 5.1 Voice presets (4)

```ts
export type VoicePreset = "warm-female" | "warm-male" | "neutral" | "soft";
const VOICE_MAP: Record<VoicePreset, string> = {
  "warm-female": "zh_female_warm_clinical_v2",      // ARK voice id, verified at boot
  "warm-male":   "zh_male_warm_clinical_v2",
  "neutral":     "zh_neutral_announcer_v2",
  "soft":        "zh_female_soft_v2",
};
```

(Actual ARK voice IDs determined during Phase 0.6 verification spike; placeholders here.)

### 5.2 Public API

```ts
export interface SpeechRequest {
  forgeRunId: string;
  beatId: string;
  text: string;                       // bounded to plan corpus — see §5.4
  voice: VoicePreset;                 // default "warm-female"
  speed?: number;                     // 0.85..1.15, default 1.0
  pitch?: number;                     // -3..+3 semitones, default 0
}

export interface SpeechResult {
  pcm: Buffer;                        // 24kHz mono PCM s16le
  durationMs: number;
  url: string;                        // CDN URL after upload
  cost_estimate_usd: number;
}

export async function synthesize(req: SpeechRequest): Promise<SpeechResult>;
```

### 5.3 24kHz PCM output

- Request `audio_format: "pcm"`, `sample_rate: 24000`, `channels: 1`.
- ARK returns base64 PCM; wrapper decodes and writes to disk side-by-side with replay JSON metadata.
- 24kHz is FFmpeg-friendly and matches Remotion's audio mux pipeline (no resample on render).

### 5.4 Bounded-text invariant

The wrapper does **not** validate the corpus. That's Lyra's job in Stage 10 (post-render) and Mara's in Stage 4 (pre-render). The wrapper only:

- Asserts `text.length <= 1200` chars (a beat's hard cap; beyond this means ShotList compilation broke upstream).
- Asserts `text.trim().length > 0`.

The boundedness contract is held upstream:
- Mara (Stage 4) rejects narrator lines with `category: "uncited_claim"` before any speech call.
- Lyra (Stage 10) re-checks via `procedure_step_compliance` over rendered frames + audio metadata.

**Note for code review:** the wrapper documents in a header comment that the gate is upstream so a future contributor doesn't accidentally remove the guard "because there is none here". (See file header comment in plan §13.)

### 5.5 Replay

- `withReplay({ codec: "wav" })` — store as 24kHz mono WAV (PCM s16le with WAV header) for human inspection. Metadata JSON has `durationMs`, `text`, `voice`, `cost`.

---

## 6. `src/lib/seed/omnihuman.ts` — OmniHuman 1.5 (optional)

### 6.1 Public API

```ts
export interface OmniHumanRequest {
  forgeRunId: string;
  surgeonPhotoUrl: string;            // single still, opt-in upload
  voUrl: string;                      // Seed Speech output URL (24kHz PCM/WAV)
  durationCapS?: number;              // default 8.0; hard cap
  consentFlag: boolean;               // must be true; throws if false
}

export interface OmniHumanResult {
  mp4Url: string;                     // lip-synced 1080p H.264
  durationS: number;
  uncannyScore?: number;              // 0..1 from Phase-0.6 heuristic; >0.55 ⇒ recommend cut
  cost_estimate_usd: number;
}

export async function generate(req: OmniHumanRequest): Promise<OmniHumanResult>;
```

### 6.2 ≤8s cap

- If `voUrl` audio duration > 8.0s, the wrapper truncates to 8.0s (logs warning) and throws `OmniHumanDurationError` if the truncation would cut mid-word (heuristic: silence detection via the cached PCM buffer; if there's no silence in the last 0.5s of the 8s window, refuse).
- The 8s cap is the README rule; demo-runbook expects this.

### 6.3 Uncanny-valley fallback

- Phase 0.6 verification produces a `uncannyScore` heuristic on a single test still + clip; if the wrapper's resulting `uncannyScore > 0.55`, the worker (NOT the wrapper) decides to cut to a static title card. The wrapper's job is to *report* the score; it doesn't suppress its own output.
- The worker checks `result.uncannyScore` and, if exceeded, drops Stage 11b entirely — Stage 12 Remotion composition then renders a `SurgeonTitleCard` component instead of the talking-head MP4.
- Cut criterion is logged to `ForgeRun.deliverable.criticTrace[]` so the audit-PDF can show "OmniHuman segment dropped: uncanny-valley score 0.62".

### 6.4 Opt-in consent

- `consentFlag: boolean`. If false, the wrapper throws `OmniHumanConsentError` immediately. The UI (`PreOpUpload.tsx`) sets this from a checkbox; the worker passes it through.
- Photo upload privacy is handled at the API layer (signed URL with surgeon-scoped ACL); the wrapper trusts what it gets.

### 6.5 Replay

- `withReplay({ codec: "mp4" })`. Replay fixture for the demo is pre-recorded with consent from a synthetic stock photo (clearly labeled "synthetic" in the demo HUD).

---

## 7. `src/lib/forge/replay.ts` — DEMO_MODE chokepoint (Invariant 3)

### 7.1 Public API

```ts
export type ReplayCodec = "json" | "mp4" | "png" | "wav";
export type DemoMode = "live" | "replay" | "hybrid";

export interface WithReplayOpts<T> {
  stage: string;                // e.g., "stage_9_seedance"
  key: string;                  // hash of inputs (caller-derived OR derived via hashCacheKey)
  live: () => Promise<T>;
  codec: ReplayCodec;
  forgeRunId?: string;          // optional override; defaults to ALS-stored id (see §7.4)
}

export class MissingFixtureError extends Error {}

export async function withReplay<T>(opts: WithReplayOpts<T>): Promise<T>;
export function hashCacheKey(input: unknown): string; // sha256 over canonical-JSON
```

### 7.2 Mode routing

| `process.env.DEMO_MODE` | Behavior |
|---|---|
| `live` | Call `live()`. On success, persist response to `data/replay/{forge_run_id}/{stage}/{key}.{ext}` (+ `.json` metadata if codec ≠ json). Return result. Errors propagate. |
| `replay` | Try to read `data/replay/{forge_run_id}/{stage}/{key}.{ext}`. If found, deserialize per codec and return. If missing, throw `MissingFixtureError`. **Never call `live()`.** |
| `hybrid` | `Promise.race([live(), timeout(HYBRID_LIVE_BUDGET_S)])`. On live success → persist + return. On timeout / quota / 5xx → fall back to cached if it exists, else propagate. Caches successful live responses for the next run. |

### 7.3 Cache key derivation

```ts
export function hashCacheKey(input: unknown): string {
  // 1) Canonical-JSON: sort keys recursively, normalize whitespace, drop volatile fields
  //    (request_id, timestamps, signed-URL query strings).
  // 2) sha256 → hex (truncate to first 16 hex chars for filename ergonomics).
}
```

Volatile-field stripping rule — drop these recursively from any input tree before hashing:
- `request_id`, `id`, `timestamp`, `ts`, `created_at`, `updated_at`
- Any value matching `/[?&](X-Amz-Signature|X-Amz-Date|Expires|Signature)=/`.

Each wrapper passes its own structural inputs (system prompt + user content + model + persona) — the hash is **deterministic** so the same beat hashes the same way across runs, which is what `replay` mode needs.

### 7.4 `forgeRunId` resolution (AsyncLocalStorage)

The worker enters an `AsyncLocalStorage<{ forgeRunId: string }>` context at job start. Every wrapper that omits `forgeRunId` reads it from ALS. This avoids threading the ID through every Seed-call signature.

```ts
// apps/synthesis-worker/context.ts
export const forgeContext = new AsyncLocalStorage<{forgeRunId: string}>();
```

`replay.ts` reads `forgeContext.getStore()?.forgeRunId` and throws `ReplayContextError` if neither path resolves.

### 7.5 Codec-specific persistence

| Codec | On-disk format | Side-write |
|---|---|---|
| `json` | `{key}.json` (utf-8) | none |
| `mp4` | `{key}.mp4` (binary) | `{key}.json` with `{video_url, last_frame_url, segments[], cost}` |
| `png` | `{key}.png` (binary) | `{key}.json` with `{width, height, prompt_used}` |
| `wav` | `{key}.wav` (24kHz mono) | `{key}.json` with `{durationMs, text, voice}` |

### 7.6 hybrid timeout race (no `setTimeout` leak)

```ts
function timeoutPromise<T>(s: number): Promise<T> {
  let to: NodeJS.Timeout;
  const p = new Promise<T>((_, rej) => {
    to = setTimeout(() => rej(new TimeoutError("hybrid live budget exceeded")), s * 1000);
  });
  (p as any).cancel = () => clearTimeout(to);
  return p;
}
```

`Promise.race` cancels the timeout on live-success to avoid lingering timers. (Ditto on live-fail; the cached fallback runs regardless.)

---

## 8. `src/lib/forge/keyRotation.ts` — multi-key failover

### 8.1 Public API

```ts
export type Provider = "ark" | "seedance";

export interface RotationState {
  provider: Provider;
  keys: string[];                 // resolved from env at construction
  index: number;                  // current head
  cooldown: Record<number, number>; // index → unix-ts after which key is usable again
}

export function next(provider: Provider): string;
export function rotate(provider: Provider, reason: "429"|"5xx"|"401"|"403"|"manual"): void;
export function load(): void;     // reads data/keyrot.json into memory
export function persist(): void;  // writes current state to data/keyrot.json
```

### 8.2 Round-robin

- `ark` keys: `[ARK_API_KEY, ARK_API_KEY_2, ARK_API_KEY_3]` (filter empty).
- `seedance` keys: `[SEEDANCE_API_KEY, SEEDANCE_API_KEY_2]` (filter empty).
- `next()` returns `keys[index % keys.length]`; if all in cooldown, return least-recently-cooled (best-effort).

### 8.3 Rotation triggers

| Reason | Action |
|---|---|
| `429` | rotate, set cooldown 60s for the rotated-from key |
| `5xx` | rotate, cooldown 30s |
| `401`/`403` | rotate, cooldown 24h (key is likely revoked) |
| `manual` | rotate, no cooldown |

After rotation, `persist()` writes `data/keyrot.json` with `{ ark: RotationState, seedance: RotationState }` so worker restarts continue from the same index.

### 8.4 Pluggable per-provider

The state is a `Map<Provider, RotationState>`. Adding a new provider (e.g., `tavily`) is a one-line registration:

```ts
register("tavily", { keys: [process.env.TAVILY_API_KEY] });
```

### 8.5 Concurrency

- `data/keyrot.json` writes are debounced (250ms) and protected by a lock-file (`data/keyrot.json.lock`) since the synthesis worker is single-process but Node's async I/O can interleave.
- In-memory state is the source of truth during a process lifetime; the file is best-effort persistence.

---

## 9. `apps/synthesis-worker/index.ts` — orchestrator

### 9.1 Top-level shape

```ts
export async function runSynthesis(forgeRunId: string): Promise<ForgeRun> {
  return forgeContext.run({ forgeRunId }, async () => {
    const tracer = openTracer(forgeRunId); // SSE writer to pre:trace:{id}
    try {
      const intake     = await stage1_intake(forgeRunId, tracer);
      const research   = await stage2_research_fanout(intake, tracer);
      const shotList   = await stage3_director(intake, research, tracer);
      const critiqued  = await stage4_mara(shotList, tracer);
      const bible      = await stage5_anatomy_bible(critiqued, research, tracer);
      const lensed     = await stage6_cinema_lens(critiqued, tracer);
      const keyframes  = await stage7_seedream(lensed, bible, tracer);
      const payloads   = await stage8_prompt_compiler(lensed, keyframes, bible, tracer);
      const beats      = await stage9_seedance(payloads, tracer);
      const accepted   = await stage10_vision_critic(beats, lensed, bible, tracer);
      const audio      = await stage11_narration(accepted, tracer);
      const mp4        = await stage12_remotion(accepted, audio, tracer);
      return await finalize(forgeRunId, mp4, tracer);
    } catch (err) {
      await rollback(forgeRunId, err, tracer);
      throw err;
    } finally {
      tracer.close();
    }
  });
}
```

### 9.2 SSE trace event shape

```ts
interface TraceEvent {
  forge_run_id: string;
  stage: string;          // "stage_3_director" etc.
  message: string;        // human-readable
  ts: number;             // ms since epoch
  duration_ms?: number;   // since stage start (set on stage end)
  persona?: "atlas" | "tavi" | "exa" | "gem" | "lyra" | "mara";
  data?: Record<string, unknown>; // small scalars only — no blobs
}
```

Emitted to Redis stream `pre:trace:{forge_run_id}`. The HUD (`CriticHud.tsx` + `AnatomyGraphViewer.tsx`) consumes via SSE.

### 9.3 Stage-by-stage spec

#### Stage 1 — Intake (Atlas, deterministic)
- **In:** `IntakePayload { planPdfUrl, demographicsJson }` from API.
- **Out:** `IntakeResult { plan: ProcedurePlan, patient: Patient }` (Zod-validated, types from Phase 2).
- **Persona:** Atlas (no model call; just schema validation + ingestion via `procedurePlanPdf.ts` + `patientDemographics.ts`).
- **Trace:** `{stage:"stage_1_intake", message:"plan parsed: 7 procedure steps, hip_replacement", persona:"atlas"}`.
- **Failure:** Zod parse fail → throw `IntakeError`; rollback writes `forge_runs.status="failed"`.

#### Stage 2 — Research fan-out (Tavi / Exa / Gem / pdf-parse, parallel)
- **In:** `IntakeResult`.
- **Out:** `ResearchBundle { tavi: PMIDRefs[], exa: StyleRefs[], anatomy: AnatomyGraph, planText: string }`.
- **Personas:** Tavi (2a), Exa (2b), Gem (2c), deterministic (2d).
- **Parallelism:** `Promise.all` on all four. Each substage emits its own trace event with `persona`.
- **Failure:** Tavi/Exa failures degrade gracefully (empty arrays + warn trace); Gem failure is hard-stop (anatomy graph is required).

#### Stage 3 — Director (Atlas, Seed 2.0 Pro, streaming)
- **In:** `ResearchBundle + IntakeResult`.
- **Out:** `ShotList` (Zod, from `src/lib/forge/shotList.ts`).
- **Persona:** Atlas system prompt = `ATLAS_SURGICAL_PROMPT`.
- **Wrapper:** `arkChat({stream:true, schema: ShotListSchema})`. Streaming deltas emit as trace events ("Atlas drafting beat 3 / 7").
- **Failure:** schema parse fail after both JSON-mode attempts → throw `DirectorError`; no auto-retry (Atlas is deterministic enough).

#### Stage 4 — Mara critic gate (1-round cap) ★ Invariant 1
- **In:** `ShotList`.
- **Out:** revised `ShotList` + `Critique[]` written to Butterbase + Redis `pre:critique:{id}`.
- **Persona:** Mara, system prompt = `MARA_DEVILS_ADVOCATE_PROMPT`.
- **Wrapper:** `arkChat({schema: z.array(CritiqueSchema)})`.
- **Logic:**
  1. Call Mara on the full ShotList; receive `Critique[]`.
  2. Apply every `block`-severity critique:
     - If `suggested_revision` exists → swap that shot's `narrator_line`.
     - Else → kick the whole ShotList back to Atlas for a regeneration of just the flagged shots (single round).
  3. After regen, run Mara **once more on the regenerated shots only** (this is *within* the 1-round cap).
  4. Persist: `critiques` rows + Redis list. HUD reads from Redis.
- **Hard cap:** ShotList passes through Mara at most 2 times. After that, blocks remain blocks and the ShotList ships with severity warnings logged.
- **Failure mode:** Mara returns 0 critiques → trace event `message:"mara approved 7/7 shots"`, proceed.

#### Stage 5 — Anatomy bible (Lyra)
- **In:** revised `ShotList` + `AnatomyGraph` + Exa style refs.
- **Out:** `AnatomyBible { entities: { id, name, refImages: string[1..3], confidence } }` written to Butterbase.
- **Persona:** Lyra (extraction prompt + Seedream calls).
- **Wrappers:** `arkChat()` for entity extraction, then 4–8 `seedream.generate()` calls (one per entity).
- **Trace:** one event per entity with `persona:"lyra"`.

#### Stage 6 — Cinema lens (deterministic)
- **In:** revised `ShotList`.
- **Out:** `LensedShotList` — same beats with appended `cinema_suffix: string` per beat.
- **Persona:** none (lookup against `src/lib/forge/lens/` taxonomy from Open-Generative-AI port).
- **No model call.**

#### Stage 7 — Seedream keyframes (Lyra)
- **In:** `LensedShotList` + `AnatomyBible` + Exa refs.
- **Out:** `Keyframes { beatId → SeedreamResult }`.
- **Wrapper:** `seedream.generate()` per beat.
- **Parallelism:** capped at 3 (lighter than Seedance; 3 is fine and matches the same lane budget).
- **Failure:** any beat keyframe fail → halt (Stage 9 cannot proceed without a keyframe per Invariant 2 sub-rule).

#### Stage 8 — Prompt compiler (Atlas, deterministic)
- **In:** `LensedShotList` + `Keyframes` + `AnatomyBible`.
- **Out:** `SeedancePayload[]` per beat. For beat N>0, `video_ref = beats[N-1].last_frame_url`.
- **Persona:** Atlas (deterministic in `compileSeedancePrompt.ts`).
- **Asserts:** every payload has `image_refs.length >= 1`. (Belt + suspenders to the wrapper guard.)

#### Stage 9 — Seedance fan-out (≤3 lanes) ★ Invariant 2
- **In:** `SeedancePayload[]`.
- **Out:** `BeatRender[] { beatId, video_url, last_frame_url, request_id, segments }`.
- **Wrapper:** `seedance.submit()` (with optional `extend()` chain).
- **Parallelism:** controlled by the wrapper's `MAX_CONCURRENT_LANES` semaphore. The worker calls `Promise.all` and trusts the semaphore.
- **Trace:** start + every poll-tick + completion per beat. The HUD shows lane occupancy.

#### Stage 10 — Vision critic + 1-regen budget (Lyra) ★ Invariant 1
- **In:** `BeatRender[]` + `LensedShotList` + `AnatomyBible`.
- **Out:** `AcceptedBeats[] { beatId, finalRender: BeatRender, critic: CriticScore, regenerated: boolean }`.
- **Persona:** Lyra (vision call via `arkChat` with frame data-URLs).
- **Logic per beat:**
  1. Extract 4 frames (ffmpeg) at relative t = 0.10, 0.40, 0.65, 0.90.
  2. Call Lyra with frames + beat context + AnatomyBible excerpt → `CriticScore`.
  3. If `min(anatomical_fidelity, procedure_step_compliance) < CRITIC_FIDELITY_THRESHOLD (0.75)` OR `on_screen_text_violations > 0`:
     - **Regen budget = 1.** Recompile prompt: `prompt = original + " | feedback: " + critic.feedback`.
     - Re-run Stage 9 single-beat (`seedance.submit()` again).
     - Re-score with Lyra. Persist BOTH scores in `critic_scores` rows.
     - Whatever the second score is, **accept it** and surface it honestly per the README §3.3 "honesty over theater" rule.
  4. Else: accept first try.
- **Persistence:** `critic_scores` rows in Butterbase + Redis `pre:critic:{id}` list (drives `CriticHud.tsx`).
- **Trace:** per-beat `{stage:"stage_10_lyra", persona:"lyra", data:{anatomical_fidelity, procedure_step_compliance, regenerated}}`.

#### Stage 11a — Narration (Atlas)
- **In:** `AcceptedBeats[]` (each with its narrator_line).
- **Out:** `NarrationTrack[] { beatId, audio_url, durationMs }`.
- **Wrapper:** `speech.synthesize()` per beat, voice from patient preference (default warm-female).
- **Parallelism:** unbounded (cheap, fast). Subject to ARK rate limits → key rotation handles.

#### Stage 11b — OmniHuman greeting (optional, opt-in)
- **In:** `surgeonPhotoUrl + voUrl + consentFlag`.
- **Out:** `GreetingClip | null` (null if `consentFlag === false` OR `uncannyScore > 0.55`).
- **Wrapper:** `omnihuman.generate()`. Worker decides cut-to-title-card on uncanny score.

#### Stage 12 — Remotion render (Lyra)
- **In:** all of the above.
- **Out:** `ForgeDeliverable { mp4Url, durationS, criticTrace, costUsd, citations }`.
- **Persona:** Lyra owns Remotion composition (overlays + confidence bands + citation footer).
- **No Seed call.** This stage is local rendering.

### 9.4 Failure handling

- **Per-stage try/catch** in the orchestrator with `tracer.error(stage, err)`.
- **Retry policy:**
  - Stage 3 / 4 / 5 / 10 (model calls): 1 retry with key-rotated key on 429/5xx; on 2nd fail, rollback.
  - Stage 7 / 9: rely on wrapper's internal retry (2 attempts).
- **Rollback:** writes `forge_runs.status = "failed"`, `failure_stage`, `failure_reason`. Surfaces error to API via `ForgeRun.error`.
- **No auto-resume.** Manual restart through `POST /api/forge/{id}/regen?beat=N` for partial recovery.

### 9.5 Persistence layer (Butterbase, NOT Redis except SSE)

Per the brief: write to **Butterbase** for durable state, Redis only for SSE.

| Butterbase table | Written by | Rows per ForgeRun |
|---|---|---|
| `forge_runs` | Stage 1, finalize, rollback | 1 (updated) |
| `beats` | Stage 8 + Stage 10 | N (one per beat) |
| `critiques` | Stage 4 (Mara) | 0..M |
| `critic_scores` | Stage 10 (Lyra) | N..2N (per beat per attempt) |
| `audit_citations` | Stage 4 + Stage 12 | N..M (one per claim) |

| Redis key | Purpose | Lifetime |
|---|---|---|
| `pre:trace:{id}` | SSE stream | 1h TTL after finalize |
| `pre:critique:{id}` | HUD live-read | 1h TTL |
| `pre:critic:{id}` | HUD live-read | 1h TTL |

Schema Dev provides the Butterbase migrations in Phase 2; this plan consumes them.

---

## 10. `apps/synthesis-worker/queue.ts` — minimal job queue

### 10.1 Public API

```ts
export interface SynthesisJob { forgeRunId: string; submittedAt: number; }

export async function enqueue(forgeRunId: string): Promise<void>;
export async function start(): Promise<void>;        // begin consuming
export async function shutdown(graceMs?: number): Promise<void>;
```

### 10.2 In-memory default

- A single `Promise` chain (`runningJob: Promise<void>`); each `enqueue` chains via `.then`.
- Simpler than BullMQ for a hackathon; fine because the synthesis worker is single-process and `MAX_CONCURRENT_LANES` is internal to Stage 9.
- API route triggers `enqueue(forgeRunId)` and immediately returns 202; the worker processes serially.

### 10.3 BullMQ optional flag

```ts
if (process.env.QUEUE_BACKEND === "bullmq") {
  // dynamic-import bullmq, instantiate Queue/Worker with REDIS_URL
  ...
} else {
  // in-memory default
}
```

This is a **stub** for Phase 3 — not wired to actual BullMQ unless we hit a multi-worker need (which we won't for the demo). Documented as a forward path.

### 10.4 `MAX_CONCURRENT_LANES` is **not** the queue concurrency

- The queue is **always single-job** (`maxConcurrency = 1`).
- `MAX_CONCURRENT_LANES` controls the inner Seedance fan-out within Stage 9, owned by `seedance.ts`.
- The worker doesn't even know about `MAX_CONCURRENT_LANES`; the wrapper handles it.

### 10.5 Graceful shutdown

```ts
export async function shutdown(graceMs = 30_000): Promise<void> {
  shuttingDown = true;          // enqueue() rejects new jobs
  await Promise.race([runningJob, sleep(graceMs)]);
  await keyRotation.persist();  // flush rotation state
  await tracer.flush();         // drain SSE buffers
}
```

SIGTERM handler in `apps/synthesis-worker/index.ts` calls `shutdown()`.

---

## 11. Replay-fixture contract — synthetic-phantom hip-replacement demo

The demo case is the synthetic phantom 65yo/BMI-28 hip replacement, posterior approach. Per CLAUDE.md §Demo Theater, the locked 2-min pre-rendered MP4 is **22 seconds of explainer** plus HUD beats. Mapping that to the 12-stage pipeline:

### 11.1 Beat structure (7 beats, ~3.1s avg)

| # | Beat | duration | procedure_step | extend? |
|---|---|---|---|---|
| 1 | "Hi — here's what we'll be doing today." | 2.5s | greeting | n |
| 2 | "Your hip joint, posterior view." | 3.0s | step_1 | n |
| 3 | "We'll make a 4-inch incision here." | 3.5s | step_2 | n |
| 4 | "Removing the femoral head." | 3.5s | step_3 | n |
| 5 | "Placing the acetabular cup." | 3.5s | step_4 | n |
| 6 | "Securing the femoral stem." | 3.0s | step_5 | n |
| 7 | "Closing in layers — recovery starts." | 3.0s | step_6 | n |

Total = 22.0s. No beat exceeds 5s, so Stage 9 extend chain is exercised in a *secondary* fixture (one of the 2 backup cases) but not in the demo case.

### 11.2 Fixture file tree under `data/replay/demo-hip-replacement/`

```
data/replay/demo-hip-replacement/
├── stage_1_intake/
│   └── intake.json                                          # IntakeResult
├── stage_2_research/
│   ├── tavi.json                                            # 5 PMIDs
│   ├── exa.json                                             # 8 style-ref URLs
│   ├── anatomy.json                                         # AnatomyGraph (12 entities)
│   └── plan_text.json
├── stage_3_director/
│   └── shotlist_v1.json                                     # initial draft
├── stage_4_mara/
│   ├── critiques_v1.json                                    # 2 blocks, 1 warn
│   ├── shotlist_v2.json                                     # after Atlas regen
│   └── critiques_v2.json                                    # 0 blocks (clean)
├── stage_5_anatomy_bible/
│   ├── bible.json                                           # 6 entities, 12 ref images
│   ├── entity_pelvis_acetabular.png
│   ├── entity_femur_head.png
│   ├── … (4 more entity refs)
├── stage_6_lens/
│   └── lensed_shotlist.json
├── stage_7_seedream/
│   ├── beat_1.png + beat_1.json
│   ├── … (7 keyframes total)
├── stage_8_compile/
│   └── payloads.json                                        # 7 SeedancePayload
├── stage_9_seedance/
│   ├── beat_1.mp4 + beat_1.json (request_id, last_frame_url, segments[])
│   ├── beat_2.mp4 + beat_2.json
│   ├── beat_3_attempt1.mp4 + beat_3_attempt1.json           # PRE-RECORDED REJECT
│   ├── beat_3_attempt2.mp4 + beat_3_attempt2.json           # accepted regen
│   ├── beat_4..7 single-attempt
├── stage_10_lyra/
│   ├── beat_1.json (af=0.91, psc=0.88, otv=0)
│   ├── beat_2.json (af=0.86, psc=0.84, otv=0)
│   ├── beat_3_attempt1.json (af=0.71, psc=0.78, otv=0) ★    # CRITIC REJECT — demo HUD beat
│   ├── beat_3_attempt2.json (af=0.86, psc=0.85, otv=0)      # ACCEPT
│   ├── beat_4..7.json
├── stage_11a_speech/
│   ├── beat_1.wav + beat_1.json
│   ├── … (7 narration WAVs)
├── stage_11b_omnihuman/
│   └── greeting.mp4 + greeting.json (uncannyScore=0.32, accepted)
└── stage_12_remotion/
    └── final_explainer.mp4                                  # 1080p H.264, 22s, the demo MP4
```

### 11.3 Pre-recorded Mara critiques (Stage 4) — for HUD believability

The judges literally see Mara reject something. Pre-recorded `critiques_v1.json`:

```json
[
  {
    "shot_id": "beat_3",
    "severity": "block",
    "category": "advice_creep",
    "excerpt": "We recommend you ask your surgeon about the smaller incision option.",
    "reason": "Crosses from explaining to recommending. Patient-facing tool must not advise.",
    "suggested_revision": "We'll make a 4-inch incision here, the smaller of two approaches Dr. Chen has chosen for your case."
  },
  {
    "shot_id": "beat_5",
    "severity": "block",
    "category": "uncited_claim",
    "excerpt": "Most surgeons place the cup at 40 degrees of inclination.",
    "reason": "Generic claim with no citation pointer. Replace with plan-specific value from §2.3.",
    "suggested_revision": "Dr. Chen plans a 40-degree cup inclination per the procedure plan §2.3."
  },
  {
    "shot_id": "beat_7",
    "severity": "warn",
    "category": "ambiguity",
    "excerpt": "Closing in layers — recovery starts.",
    "reason": "\"Recovery starts\" is positive but vague. Acceptable; no revision required."
  }
]
```

### 11.4 Pre-recorded Lyra critic scores (Stage 10) — for HUD reject/regen

`beat_3_attempt1.json` is the headliner — judges literally watch Lyra reject this:

```json
{
  "beat_id": "beat_3",
  "anatomical_fidelity": 0.71,
  "procedure_step_compliance": 0.78,
  "on_screen_text_violations": 0,
  "feedback": "Femoral neck angle drifted; acetabular orientation correct. Re-anchor on entity_pelvis."
}
```

Then `beat_3_attempt2.json` shows the post-regen acceptance at 0.86 / 0.85. The HUD's slo-mo at 0:50–1:00 reads exactly these two payloads in sequence.

### 11.5 Two backup cases

`data/replay/demo-knee-acl/` and `data/replay/demo-cataract/` mirror the same tree shape with different beats (5 and 4 beats respectively). One of them exercises a >5s beat to validate `seedance-v2.0-extend` is wired in `replay` mode.

### 11.6 Seeding protocol

`scripts/prewarm_demo.py`:
1. Reads `data/fixtures/demo-hip-replacement/intake.json`.
2. Runs `runSynthesis(forgeRunId="demo-hip-replacement")` in `DEMO_MODE=live`.
3. Each wrapper persists to the on-disk replay tree via `withReplay`.
4. After completion, the script verifies the tree is complete (`stat` every expected file) and writes `data/replay/demo-hip-replacement/.complete` sentinel.
5. Re-running the demo in `DEMO_MODE=replay` reads only the cached files — zero network.

---

## 12. Tests under `tests/synthesis-worker/`

All under Vitest. Each test file ≤120 lines. Brief descriptions:

### 12.1 `test_keyframe_anchoring.ts` — Invariant 2 sub-rule
- **What:** instantiates `seedance.submit()` with `image_refs: []` and asserts `SeedanceInvariantError` thrown.
- **Plus:** scans every fixture in `data/replay/demo-hip-replacement/stage_8_compile/payloads.json` and asserts every `image_refs.length >= 1`.
- **Plus:** static grep test — runs `grep -rn "submit\|seedance\.submit" src/` and ensures no caller passes a literal `[]`.

### 12.2 `test_replay_branch.ts` — Invariant 3
- **What:** statically lists every public function in `src/lib/seed/{ark,seedance,seedream,speech,omnihuman}.ts` (parsed via `ts-morph`) and asserts each one's body contains a call to `withReplay(`.
- **Plus:** runs `runSynthesis()` with `DEMO_MODE=replay` and a deliberately empty replay dir; asserts `MissingFixtureError` is thrown for the first network-bound stage.

### 12.3 `test_key_rotation.ts`
- **What:** stub-fetch returns 429 once, 200 next; asserts `keyRotation.next("ark")` returns key2 after the 429.
- **Plus:** writes a fake `data/keyrot.json`, restarts an in-memory module, asserts `index` survives.
- **Plus:** 401 on key1 sets cooldown 24h; `next()` returns key2 even after 60s.

### 12.4 `test_stage_zod_validation.ts`
- **What:** for each stage that emits a typed object, feed a deliberately malformed input and assert the appropriate Zod error / `ArkSchemaError`.
- Coverage: Stage 1 (intake), Stage 3 (ShotList), Stage 4 (Critique[]), Stage 5 (AnatomyBible), Stage 7 (SeedreamResult), Stage 10 (CriticScore).

### 12.5 `test_critic_loop_budget.ts` — Invariant 1
- **What:** with a fixture that scores 0.71 on first attempt and 0.74 on second attempt (still below threshold), asserts the worker accepts the 0.74 (1-regen budget exhausted) and writes BOTH scores to Butterbase.
- **Plus:** asserts ShotList round-2 Mara critique with another `block` does NOT trigger a third Atlas regen (1-round cap).

### 12.6 `test_seedance_extend_chain.ts`
- **What:** payload with `duration_s = 12s`; asserts `submit()` issues 3 segments via `extend()`, returns last segment's URL, and `result.segments.length === 3`.

### 12.7 `test_omnihuman_uncanny_cut.ts`
- **What:** mocks OmniHuman returning `uncannyScore = 0.62`; asserts the worker drops Stage 11b output and emits trace event `message:"omnihuman dropped: uncanny-valley score 0.62"`.

### 12.8 `test_speech_bounds.ts`
- **What:** `speech.synthesize({text: "x".repeat(1500)})` throws.
- **Plus:** documents (in test comment) that text-corpus boundedness is enforced upstream by Mara, not here.

### 12.9 `test_orchestrator_failure_rollback.ts`
- **What:** force Stage 3 to throw; assert `forge_runs.status == "failed"`, `failure_stage == "stage_3_director"`, and SSE stream emitted error event before close.

### 12.10 `test_models_pin.ts` — Invariant 2
- **What:** runs the same grep as `npm run check:invariants` programmatically; asserts no Seed model literal appears outside `src/lib/seed/models.ts`.

---

## 13. Phase 3 file-creation contract (line-count estimates)

This is my contract with Atlas. I create exactly these files, in this order, with these approximate sizes. If a file blows past +30% of estimate, I stop and re-plan.

| Order | Path | Est. LoC | Notes |
|---:|---|---:|---|
| 1 | `src/lib/seed/models.ts` | 30 | Verbatim §1 above |
| 2 | `src/lib/forge/replay.ts` | 240 | withReplay + hashCacheKey + 3 mode branches + AsyncLocalStorage |
| 3 | `src/lib/forge/keyRotation.ts` | 200 | rotation + persistence + per-provider |
| 4 | `src/lib/seed/ark.ts` | 380 | three personas, JSON-mode + fallback + streaming + multimodal |
| 5 | `src/lib/seed/seedance.ts` | 320 | T2V/I2V/extend + polling + semaphore + invariant guard |
| 6 | `src/lib/seed/seedream.ts` | 220 | prompt assembly + entity-bible carryover |
| 7 | `src/lib/seed/speech.ts` | 180 | 4 voices + 24kHz PCM + WAV write |
| 8 | `src/lib/seed/omnihuman.ts` | 200 | consent + uncanny score + 8s cap |
| 9 | `apps/synthesis-worker/context.ts` | 30 | AsyncLocalStorage |
| 10 | `apps/synthesis-worker/tracer.ts` | 120 | SSE writer + buffered flush |
| 11 | `apps/synthesis-worker/queue.ts` | 140 | in-memory + BullMQ stub + shutdown |
| 12 | `apps/synthesis-worker/index.ts` | 280 | orchestrator (12 stages, top-level shape) |
| 13 | `apps/synthesis-worker/stages/stage1_intake.ts` | 80 | |
| 14 | `apps/synthesis-worker/stages/stage2_research.ts` | 180 | parallel fan-out |
| 15 | `apps/synthesis-worker/stages/stage3_director.ts` | 100 | |
| 16 | `apps/synthesis-worker/stages/stage4_mara.ts` | 220 | critic gate + 1-round cap |
| 17 | `apps/synthesis-worker/stages/stage5_anatomy_bible.ts` | 180 | |
| 18 | `apps/synthesis-worker/stages/stage6_cinema_lens.ts` | 60 | |
| 19 | `apps/synthesis-worker/stages/stage7_seedream.ts` | 100 | |
| 20 | `apps/synthesis-worker/stages/stage8_compile.ts` | 120 | image_refs assembly + assert |
| 21 | `apps/synthesis-worker/stages/stage9_seedance.ts` | 120 | fan-out wrapper |
| 22 | `apps/synthesis-worker/stages/stage10_vision_critic.ts` | 260 | frame extract + critic + regen budget |
| 23 | `apps/synthesis-worker/stages/stage11_narration.ts` | 120 | speech + omnihuman branch |
| 24 | `apps/synthesis-worker/stages/stage12_remotion.ts` | 100 | invokes `src/lib/render.ts` |
| 25 | `apps/synthesis-worker/finalize.ts` | 80 | Butterbase write + deliverable card |
| 26 | `apps/synthesis-worker/rollback.ts` | 50 | |
| 27 | `tests/synthesis-worker/test_keyframe_anchoring.ts` | 100 | |
| 28 | `tests/synthesis-worker/test_replay_branch.ts` | 110 | ts-morph static check |
| 29 | `tests/synthesis-worker/test_key_rotation.ts` | 110 | |
| 30 | `tests/synthesis-worker/test_stage_zod_validation.ts` | 150 | |
| 31 | `tests/synthesis-worker/test_critic_loop_budget.ts` | 130 | |
| 32 | `tests/synthesis-worker/test_seedance_extend_chain.ts` | 90 | |
| 33 | `tests/synthesis-worker/test_omnihuman_uncanny_cut.ts` | 80 | |
| 34 | `tests/synthesis-worker/test_speech_bounds.ts` | 60 | |
| 35 | `tests/synthesis-worker/test_orchestrator_failure_rollback.ts` | 100 | |
| 36 | `tests/synthesis-worker/test_models_pin.ts` | 60 | |

**Total estimated production LoC:** ~3,860
**Total estimated test LoC:** ~990
**Files created:** 36

Phase 3 also **modifies** (not creates) `package.json` (deps: `zod-to-json-schema`, `p-limit`, `ts-morph` for tests, `@types/node` if missing) and `.env.example` (already documented; just verifying alignment).

I will **not** create:
- Replay fixtures themselves (`data/replay/demo-hip-replacement/*`) — that's `prewarm_demo.py`'s job, owned by Demo Dev. I document the contract; Demo Dev fills it.
- Any persona system prompt — owned by Personas Dev.
- Any Zod schema in `src/lib/forge/{shotList,critique,anatomyGraph}.ts` — owned by Schema Dev.
- Remotion components — owned by Frontend Dev / Lyra-track.

---

## 14. Open questions for Atlas (before Phase 3 starts)

1. **AsyncLocalStorage vs explicit-thread `forgeRunId`** — I chose ALS for ergonomics. Alternative is threading `forgeRunId` through every Seed wrapper. ALS is cleaner but adds magic. Approve ALS?
2. **Butterbase vs Redis split** — confirmed: durable state in Butterbase, ephemeral SSE/HUD in Redis. Just sanity-checking against §Data Models in CLAUDE.md which lists `pre:run:{id}` as a Redis hash. I'm reading that as "denormalized cache for HUD reads", with Butterbase as source of truth. Confirm?
3. **Cinema-lens taxonomy** — Phase 2's `src/lib/forge/lens/` port from Open-Generative-AI. Stage 6 depends on it being deterministic + offline. If it's not landed by Phase 3 start, I stub Stage 6 as identity (no suffix) and add a TODO.
4. **OmniHuman uncanny score heuristic** — Phase 0.6 was supposed to produce this. Has it? If not, I default to a permissive `uncannyScore = 0.0` (always accept) and treat the cut criterion as a manual flag in the worker.
5. **Seed Speech voice IDs** — I have placeholders. Can Atlas confirm the actual 4 ARK voice IDs for the 4 presets, or do I run a verification spike?

---

## 15. Risk register (synthesis-side)

| Risk | P | Mitigation |
|---|---|---|
| ARK JSON-mode strict schema unsupported on `seed-2.0-pro` for some prompts | M | Two-tier fallback (strict → json_object → safeParse) baked into `ark.ts` |
| Seedance polling timeout under demo Wi-Fi | H | `DEMO_MODE=replay` is always the stage default; polling timeout is generous (180s) |
| `keyRotation.json` corruption across worker restarts | L | Lock-file + try/catch; on corrupt, reset to `index=0` and log warning |
| `withReplay` cache-key drift (prompt template changes ⇒ all fixtures invalid) | M | Fixture re-prewarm is a single command; CHANGELOG entry on every prompt-template change |
| Stage 10 vision critic itself hallucinates rejections | M | 1-regen cap (we accept and surface) — exactly per "honesty over theater" |
| Frame-extraction (ffmpeg) not on render machine | L | ffmpeg already a Remotion peer dep; confirmed by the build |
| AsyncLocalStorage breaks under BullMQ workers | L | BullMQ is opt-in; default is in-process so ALS holds |
| OmniHuman MP4 too large for replay tree | L | We use a 720p MP4 in replay; Stage 12 upscales / composites in Remotion |

---

## 16. Self-test checklist before marking Phase 3 done

- [ ] `npm run check:invariants` — all four green
- [ ] `npm test -- synthesis-worker/` — all 10 tests green
- [ ] `python scripts/prewarm_demo.py` — completes <10 minutes for hip-replacement case
- [ ] `DEMO_MODE=replay npm run dev` + manual `POST /api/forge` → renders synthetic phantom in <90s wall clock
- [ ] HUD shows Mara's 2 blocks at 0:50 and Lyra's reject-at-0.71/regen-at-0.86 at 0:55–1:00 of the live SSE
- [ ] No model-id literal anywhere except `src/lib/seed/models.ts` (CI grep clean)
- [ ] `kill -SIGTERM $(pgrep -f synthesis-worker)` mid-run flushes `keyrot.json` and SSE buffer cleanly
- [ ] Audit-trail PDF generated post-render contains a citation pointer for every claim (Schema Dev's `verify_audit_trail.py` passes)
- [ ] Backup video script (`record_backup_video.sh`) is wired and produces `docs/demo-backup.mp4` (not my code, but my output is its input — must work)

---

## File written

Absolute path: `/Users/nihalnihalani/Desktop/Github/preopreel/docs/plans/02-vision-and-synthesis.md`

## Executive summary

- **Single source of truth `src/lib/seed/models.ts`** locks 7 model IDs (Atlas/Mara/Lyra share `seed-2.0-pro`; Seedream 5.0 Lite, Seedance 2.0, seedance-v2.0-extend, Seed Speech 2.0, OmniHuman 1.5). Every other Seed file imports from here, enforced by hook + CI grep — Invariant 2.
- **Five Seed wrappers under `src/lib/seed/`** all funnel through `withReplay()` (Invariant 3) and `keyRotation.next()`. `ark.ts` serves three personas via three system prompts; `seedance.ts` hard-rejects naked T2V (`image_refs.length === 0`); `seedream.ts` is the Tier-0 anchor; `speech.ts` documents that bounded-text is upstream-enforced; `omnihuman.ts` reports uncanny score, worker decides cut.
- **`apps/synthesis-worker/index.ts` orchestrates 12 stages** in an `AsyncLocalStorage<{forgeRunId}>` context, with Mara's 1-round critique cap at Stage 4 and Lyra's 1-regen budget at Stage 10 (both Invariant 1). Per-stage SSE trace events (`{stage,message,ts,duration_ms,persona}`) drive the live HUD; durable state lands in Butterbase, Redis only for streams.
- **Demo replay tree** for the synthetic phantom hip-replacement enumerates 7 beats (22s total), pre-recorded Mara critiques (3 entries: 2 blocks + 1 warn), and pre-recorded Lyra reject-at-0.71-then-regen-at-0.86 for beat 3 — exactly the HUD beats the 0:50–1:00 demo slo-mo reads.
- **Phase 3 contract: 36 files, ~3,860 production LoC + ~990 test LoC**, plus 5 open questions for Atlas (ALS, Butterbase/Redis split, lens taxonomy availability, uncanny heuristic, voice IDs). Self-test checklist of 9 items gates Phase 3 completion.
