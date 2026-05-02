// src/lib/seed/ark.ts
//
// Seed 2.0 Pro wrapper. Used by THREE personas via three system prompts:
// - Atlas (Director, Stage 3) — writes ShotList
// - Mara (Devil's Advocate, Stage 4) — writes Critique[]
// - Lyra (Vision Critic, Stage 10) — writes CriticScore (multimodal)
//
// The wrapper is persona-agnostic; persona modules supply system prompt + Zod
// schema. JSON-mode strict → json_object → safeParse fallback chain.
// Every call goes through withReplay (Invariant 3).

import OpenAI from "openai";
import { z } from "zod";
import { withReplay, hashCacheKey } from "@/lib/forge/replay";
import { next as nextKey, rotate } from "@/lib/forge/keyRotation";
import {
  DIRECTOR_MODEL,
  SEED_BASE_URL,
  type SeedModelId,
} from "@/lib/seed/models";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ArkContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } };

export type ArkPersona = "atlas" | "mara" | "lyra";

export interface ArkChatOptions<T> {
  /** Stage tag for replay key + SSE trace ("stage_3_director" etc.). */
  stage: string;
  persona: ArkPersona;
  systemPrompt: string;
  userContent: ArkContentPart[];
  model?: SeedModelId;
  /** Zod schema. If provided → JSON-mode strict, with safeParse fallback. */
  schema?: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  /** Extra entropy mixed into the replay cache key (e.g., beat_id). */
  cacheKeyExtra?: string;
  /** Override the AsyncLocalStorage forge_run_id for replay routing. */
  forgeRunId?: string;
}

export class ArkConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ArkConfigError";
  }
}

export class ArkSchemaError extends Error {
  constructor(
    msg: string,
    public readonly raw1: string,
    public readonly raw2: string,
  ) {
    super(msg);
    this.name = "ArkSchemaError";
  }
}

export class ArkUpstreamError extends Error {
  constructor(
    public readonly status: number,
    msg: string,
  ) {
    super(msg);
    this.name = "ArkUpstreamError";
  }
}

// ─── Vision input type alias (used by stage 10) ───────────────────────────

export interface ArkVisionFrame {
  /** Data URL (data:image/png;base64,…) or absolute https URL. */
  url: string;
  detail?: "low" | "high";
}

// ─── Vision convenience wrapper ────────────────────────────────────────────

export interface ArkVisionOptions<T> {
  stage: string;
  frames: ArkVisionFrame[];
  prompt: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  model?: SeedModelId;
  cacheKeyExtra?: string;
  forgeRunId?: string;
}

export async function arkVision<T>(opts: ArkVisionOptions<T>): Promise<T> {
  const userContent: ArkContentPart[] = opts.frames.map((f) => ({
    type: "image_url" as const,
    image_url: { url: f.url, detail: f.detail ?? "high" },
  }));
  userContent.push({ type: "text", text: opts.prompt });
  return arkChat<T>({
    stage: opts.stage,
    persona: "lyra",
    systemPrompt: opts.systemPrompt,
    userContent,
    schema: opts.schema,
    model: opts.model,
    cacheKeyExtra: opts.cacheKeyExtra,
    forgeRunId: opts.forgeRunId,
  });
}

// ─── Internal: build OpenAI-compatible client ─────────────────────────────

function makeClient(): OpenAI {
  const apiKey = nextKey("ark");
  if (!apiKey) {
    throw new ArkConfigError(
      "ARK_API_KEY missing. Set ARK_API_KEY (and optional _2/_3).",
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: SEED_BASE_URL,
    timeout: 45_000,
  });
}

function temperatureFor(persona: ArkPersona, override: number | undefined): number {
  if (override !== undefined) return override;
  // Mara A.2: temperature delta to Atlas (0.3 director vs 0.7 critic) helps
  // diversify the adversarial pair away from groupthink.
  if (persona === "atlas") return 0.3;
  if (persona === "mara") return 0.7;
  return 0.2; // lyra
}

// ─── Convert Zod schema to JSON Schema (lightweight) ──────────────────────
//
// We avoid pulling in zod-to-json-schema as a dep — instead we emit a very
// loose JSON Schema and rely on the model's JSON-mode + safeParse on our end.
// This is intentional: the SCHEMA on disk is Zod (Schema Dev's source of truth).
function schemaHint<T>(schema: z.ZodType<T>): string {
  // Emit the Zod string description if present; fall back to "JSON object".
  // Used as a system-prompt suffix in the json_object fallback path.
  const desc = schema.description;
  return desc ? `Output strictly matches: ${desc}` : "Output a JSON object.";
}

// ─── Live call ─────────────────────────────────────────────────────────────

interface RawArkResponse {
  content: string;
  raw: unknown;
}

async function doLiveCall<T>(
  client: OpenAI,
  opts: ArkChatOptions<T>,
  responseFormat:
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: unknown } }
    | undefined,
  systemPromptOverride?: string,
): Promise<RawArkResponse> {
  const model = opts.model ?? DIRECTOR_MODEL;
  // The OpenAI SDK's chat/completions accepts the multimodal content shape
  // we're emitting verbatim.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [
    { role: "system", content: systemPromptOverride ?? opts.systemPrompt },
    { role: "user", content: opts.userContent },
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model,
    messages,
    temperature: temperatureFor(opts.persona, opts.temperature),
    max_tokens: opts.maxTokens ?? 4096,
  };
  if (responseFormat) params.response_format = responseFormat;

  try {
    const completion = await client.chat.completions.create(params);
    const content = completion.choices[0]?.message?.content ?? "";
    return { content, raw: completion };
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status: unknown }).status)
        : 0;
    if (status === 429 || status === 401 || status === 403 || (status >= 500 && status < 600)) {
      const reason: "429" | "5xx" | "401" | "403" =
        status === 429 ? "429" : status === 401 ? "401" : status === 403 ? "403" : "5xx";
      rotate("ark", reason);
      throw new ArkUpstreamError(status, `ARK ${status}: ${(err as Error).message}`);
    }
    throw err;
  }
}

// ─── Public: arkChat ───────────────────────────────────────────────────────

export async function arkChat<T = string>(opts: ArkChatOptions<T>): Promise<T> {
  const model = opts.model ?? DIRECTOR_MODEL;
  const cacheKey = hashCacheKey({
    persona: opts.persona,
    sys: opts.systemPrompt,
    user: opts.userContent,
    model,
    extra: opts.cacheKeyExtra ?? null,
  });

  return withReplay<T>({
    stage: opts.stage,
    key: cacheKey,
    codec: "json",
    forgeRunId: opts.forgeRunId,
    live: async () => {
      const client = makeClient();

      // No schema → return raw string content.
      if (!opts.schema) {
        const r = await doLiveCall(client, opts, undefined);
        return r.content as unknown as T;
      }

      // Schema path: try strict json_schema first.
      let firstRaw = "";
      try {
        const r1 = await doLiveCall(client, opts, {
          type: "json_schema",
          json_schema: {
            name: opts.persona,
            strict: true,
            schema: { type: "object" },
          },
        });
        firstRaw = r1.content;
        const parsed1 = JSON.parse(r1.content);
        const safe1 = opts.schema.safeParse(parsed1);
        if (safe1.success) return safe1.data;
      } catch (err) {
        // Fall through to json_object retry on schema-unsupported / parse fails.
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: unknown }).status)
            : 0;
        if (status >= 400 && status < 500 && status !== 429) {
          // Schema-unsupported — retry json_object.
        } else if (err instanceof ArkUpstreamError) {
          throw err;
        }
      }

      // Fallback: json_object + system-prompt hint.
      const hint = schemaHint(opts.schema);
      const r2 = await doLiveCall(
        client,
        opts,
        { type: "json_object" },
        `${opts.systemPrompt}\n\n${hint}\nReturn ONLY valid JSON.`,
      );
      let parsed2: unknown;
      try {
        parsed2 = JSON.parse(r2.content);
      } catch {
        throw new ArkSchemaError(
          `arkChat[${opts.persona}/${opts.stage}]: invalid JSON in fallback response`,
          firstRaw,
          r2.content,
        );
      }
      const safe2 = opts.schema.safeParse(parsed2);
      if (safe2.success) return safe2.data;
      throw new ArkSchemaError(
        `arkChat[${opts.persona}/${opts.stage}]: safeParse failed in both attempts: ${safe2.error.message}`,
        firstRaw,
        r2.content,
      );
    },
  });
}

// ─── Public: arkChatStream ─────────────────────────────────────────────────
//
// Streaming path (Director only). Yields delta strings. Streaming responses
// are NOT replay-cached — the worker accumulates the full string and feeds
// it through arkChat in replay mode. In live mode we emit per-token traces
// for the HUD ("Atlas drafting beat 3…").

export async function* arkChatStream(
  opts: Omit<ArkChatOptions<string>, "schema">,
): AsyncIterable<string> {
  // In replay mode, fall back to the cached non-streamed result and yield
  // it as a single chunk — the HUD doesn't care, since events are replayed.
  if ((process.env.DEMO_MODE ?? "replay") === "replay") {
    const text = await arkChat<string>(opts);
    yield text;
    return;
  }
  const client = makeClient();
  const model = opts.model ?? DIRECTOR_MODEL;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userContent },
    ],
    temperature: temperatureFor(opts.persona, opts.temperature),
    max_tokens: opts.maxTokens ?? 4096,
    stream: true,
  };
  const stream = await client.chat.completions.create(params);
  // The OpenAI SDK returns an AsyncIterable when stream:true.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of stream as any) {
    const delta: string = chunk?.choices?.[0]?.delta?.content ?? "";
    if (delta) yield delta;
  }
}
