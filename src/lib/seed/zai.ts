// src/lib/seed/zai.ts
//
// Z.AI / BigModel wrapper. Drop-in replacement for the LLM surface of ark.ts
// — Atlas (Director), Mara (Devil's Advocate), Lyra (Vision Critic) — when
// the handbook-mandated "LLM: Z.AI" stack is required.
//
// Per Beta University Discord (5/1 6:50 PM): the issued ZAI_API_KEY is
// "exclusively for the glm 5.1 model" — never call any other model id with it.
// We therefore ignore opts.model in favor of process.env.ZAI_MODEL ("glm-5.1")
// and fail loudly if a caller tries to override.
//
// API shape mirrors ark.ts:
//   zaiChat<T>({ stage, persona, systemPrompt, userContent, schema?, ... })
//   zaiVision<T>({ stage, frames, prompt, schema, systemPrompt, ... })
//
// Every call routes through withReplay (Invariant 3). JSON-mode strict →
// json_object → safeParse fallback chain (same as ark.ts). Keys rotate via
// `keyRotation.ts` (provider="zai") on 429/5xx/401/403.

import OpenAI from "openai";
import { z } from "zod";
import { withReplay, hashCacheKey } from "@/lib/forge/replay";
import { next as nextKey, rotate } from "@/lib/forge/keyRotation";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ZaiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" } };

export type ZaiPersona = "atlas" | "mara" | "lyra";

export interface ZaiChatOptions<T> {
  stage: string;
  persona: ZaiPersona;
  systemPrompt: string;
  userContent: ZaiContentPart[];
  /** Reserved — Z.AI hackathon key only authorizes glm-5.1; ignored. */
  model?: string;
  schema?: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
  cacheKeyExtra?: string;
  forgeRunId?: string;
}

export class ZaiConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ZaiConfigError";
  }
}

export class ZaiSchemaError extends Error {
  constructor(
    msg: string,
    public readonly raw1: string,
    public readonly raw2: string,
  ) {
    super(msg);
    this.name = "ZaiSchemaError";
  }
}

export class ZaiUpstreamError extends Error {
  constructor(
    public readonly status: number,
    msg: string,
  ) {
    super(msg);
    this.name = "ZaiUpstreamError";
  }
}

// ─── Vision input + convenience wrapper ────────────────────────────────────

export interface ZaiVisionFrame {
  url: string;
  detail?: "low" | "high";
}

export interface ZaiVisionOptions<T> {
  stage: string;
  frames: ZaiVisionFrame[];
  prompt: string;
  schema: z.ZodType<T>;
  systemPrompt: string;
  cacheKeyExtra?: string;
  forgeRunId?: string;
}

export async function zaiVision<T>(opts: ZaiVisionOptions<T>): Promise<T> {
  const userContent: ZaiContentPart[] = opts.frames.map((f) => ({
    type: "image_url" as const,
    image_url: { url: f.url, detail: f.detail ?? "high" },
  }));
  userContent.push({ type: "text", text: opts.prompt });
  return zaiChat<T>({
    stage: opts.stage,
    persona: "lyra",
    systemPrompt: opts.systemPrompt,
    userContent,
    schema: opts.schema,
    cacheKeyExtra: opts.cacheKeyExtra,
    forgeRunId: opts.forgeRunId,
  });
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function getModel(): string {
  return process.env.ZAI_MODEL ?? "glm-5.1";
}

function getBaseUrl(): string {
  return process.env.ZAI_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4";
}

function makeClient(): OpenAI {
  const apiKey = nextKey("zai") ?? process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new ZaiConfigError(
      "ZAI_API_KEY missing. Set ZAI_API_KEY in .env (handbook-issued key).",
    );
  }
  return new OpenAI({ apiKey, baseURL: getBaseUrl(), timeout: 45_000 });
}

function temperatureFor(persona: ZaiPersona, override: number | undefined): number {
  if (override !== undefined) return override;
  // Same Mara A.2 split as ark.ts so the adversarial pair stays diverse.
  if (persona === "atlas") return 0.3;
  if (persona === "mara") return 0.7;
  return 0.2; // lyra
}

function schemaHint<T>(schema: z.ZodType<T>): string {
  const desc = schema.description;
  return desc ? `Output strictly matches: ${desc}` : "Output a JSON object.";
}

interface RawZaiResponse {
  content: string;
  raw: unknown;
}

async function doLiveCall<T>(
  client: OpenAI,
  opts: ZaiChatOptions<T>,
  responseFormat:
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: unknown } }
    | undefined,
  systemPromptOverride?: string,
): Promise<RawZaiResponse> {
  const model = getModel();
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
      rotate("zai", reason);
      throw new ZaiUpstreamError(status, `ZAI ${status}: ${(err as Error).message}`);
    }
    throw err;
  }
}

// ─── Public: zaiChat ───────────────────────────────────────────────────────

export async function zaiChat<T = string>(opts: ZaiChatOptions<T>): Promise<T> {
  if (opts.model && opts.model !== getModel()) {
    // Hard guard: hackathon key only authorizes glm-5.1.
    throw new ZaiConfigError(
      `zaiChat: opts.model=${opts.model} is forbidden — Z.AI hackathon key only authorizes ${getModel()}.`,
    );
  }
  const cacheKey = hashCacheKey({
    persona: opts.persona,
    sys: opts.systemPrompt,
    user: opts.userContent,
    model: getModel(),
    extra: opts.cacheKeyExtra ?? null,
  });

  return withReplay<T>({
    stage: opts.stage,
    key: cacheKey,
    codec: "json",
    forgeRunId: opts.forgeRunId,
    live: async () => {
      const client = makeClient();

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
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: unknown }).status)
            : 0;
        if (status >= 400 && status < 500 && status !== 429) {
          // Schema-unsupported on Z.AI for some payloads — retry json_object.
        } else if (err instanceof ZaiUpstreamError) {
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
        throw new ZaiSchemaError(
          `zaiChat[${opts.persona}/${opts.stage}]: invalid JSON in fallback response`,
          firstRaw,
          r2.content,
        );
      }
      const safe2 = opts.schema.safeParse(parsed2);
      if (safe2.success) return safe2.data;
      throw new ZaiSchemaError(
        `zaiChat[${opts.persona}/${opts.stage}]: safeParse failed in both attempts: ${safe2.error.message}`,
        firstRaw,
        r2.content,
      );
    },
  });
}
