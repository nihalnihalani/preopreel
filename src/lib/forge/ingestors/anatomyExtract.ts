// src/lib/forge/ingestors/anatomyExtract.ts
//
// Gemini 1.5 Flash vision wrapper for Stage 2c — extracts anatomical
// landmarks from procedure-plan diagrams. Used by the Gem persona.
// Routes through withReplay() per Invariant 3 so replay mode does
// not hit Gemini.
//
// Vision-only / non-judged path. Never used in narration (Mara D.4).

import { withReplay } from "@/lib/forge/replay";

export interface GeminiVisionJsonOpts {
  systemPrompt: string;
  userPrompt: string;
  imageBytes: Buffer[]; // PDF page rasters
  responseSchema?: unknown; // optional Zod-derived JSON schema
  temperature?: number;
}

export async function runGeminiVisionJson(
  opts: GeminiVisionJsonOpts,
): Promise<unknown> {
  return withReplay({
    stage: "02c-gem",
    key: hashKey(opts),
    codec: "json",
    live: async () => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY missing — Gem cannot run live");
      }
      const url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        "gemini-1.5-flash:generateContent?key=" +
        apiKey;

      const parts: Array<Record<string, unknown>> = [
        { text: opts.systemPrompt + "\n\n" + opts.userPrompt },
      ];
      for (const img of opts.imageBytes) {
        parts.push({
          inline_data: {
            mime_type: "image/png",
            data: img.toString("base64"),
          },
        });
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: opts.temperature ?? 0.2,
            response_mime_type: "application/json",
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`Gemini ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
      return JSON.parse(text);
    },
  });
}

function hashKey(opts: GeminiVisionJsonOpts): string {
  // Deterministic-enough fingerprint: prompt prefix + image count + total bytes.
  const totalBytes = opts.imageBytes.reduce((acc, b) => acc + b.byteLength, 0);
  const head = opts.userPrompt.trim().slice(0, 40).replace(/\s+/g, "-");
  return `${head}/n${opts.imageBytes.length}/b${totalBytes}`;
}
