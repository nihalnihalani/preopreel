// src/lib/forge/tavily.ts
//
// Tavily HTTP wrapper for the Tavi persona (peer-reviewed surgical
// protocol search). Routes through withReplay() per Invariant 3 so
// the demo runs in replay mode without network calls.

import { withReplay } from "@/lib/forge/replay";

export interface TavilySearchInput {
  query: string;
  includeDomains: string[];
  maxResults: number;
}

export interface TavilyRawResponse {
  query: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
    pmid?: string;
    doi?: string;
  }>;
}

const TAVILY_BASE_URL = process.env.TAVILY_BASE_URL ?? "https://api.tavily.com";

function cacheKey(input: TavilySearchInput): string {
  // Deterministic key for replay; stripped of volatile fields.
  return [
    input.query.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 60),
    input.includeDomains.sort().join(","),
    `n${input.maxResults}`,
  ].join("/");
}

export async function tavilySearch(
  input: TavilySearchInput,
): Promise<TavilyRawResponse> {
  return withReplay({
    stage: "02a-tavi",
    key: cacheKey(input),
    codec: "json",
    live: async () => {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        throw new Error("TAVILY_API_KEY missing — Tavi cannot run live");
      }
      const res = await fetch(`${TAVILY_BASE_URL}/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: input.query,
          include_domains: input.includeDomains,
          max_results: input.maxResults,
          search_depth: "advanced",
        }),
      });
      if (!res.ok) {
        throw new Error(`Tavily ${res.status}: ${await res.text()}`);
      }
      return (await res.json()) as TavilyRawResponse;
    },
  });
}
