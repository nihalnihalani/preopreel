// src/lib/forge/exa.ts
//
// Exa HTTP wrapper for the Exa persona (neural-search visual style
// references). Routes through withReplay() per Invariant 3.

import { withReplay } from "@/lib/forge/replay";

export interface ExaSearchInput {
  query: string;
  numResults: number;
  type: "neural" | "keyword";
  useAutoprompt: boolean;
}

export interface ExaRawResponse {
  results: Array<{
    id: string;
    url: string;
    title: string;
    score: number;
    publishedDate?: string;
    author?: string;
    image?: string;
    text?: string;
  }>;
  autopromptString?: string;
}

const EXA_BASE_URL = process.env.EXA_BASE_URL ?? "https://api.exa.ai";

function cacheKey(input: ExaSearchInput): string {
  return [
    input.query.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 60),
    input.type,
    `n${input.numResults}`,
    input.useAutoprompt ? "auto" : "raw",
  ].join("/");
}

export async function exaSearch(
  input: ExaSearchInput,
): Promise<ExaRawResponse> {
  return withReplay({
    stage: "02b-exa",
    key: cacheKey(input),
    codec: "json",
    live: async () => {
      const apiKey = process.env.EXA_API_KEY;
      if (!apiKey) throw new Error("EXA_API_KEY missing — Exa cannot run live");
      const res = await fetch(`${EXA_BASE_URL}/search`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          query: input.query,
          numResults: input.numResults,
          type: input.type,
          useAutoprompt: input.useAutoprompt,
        }),
      });
      if (!res.ok) {
        throw new Error(`Exa ${res.status}: ${await res.text()}`);
      }
      return (await res.json()) as ExaRawResponse;
    },
  });
}
