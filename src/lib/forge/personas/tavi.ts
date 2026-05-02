// Persona module — also used at build-time as a Claude Code subagent. Same prompt at build time and runtime.
//
// Tavi — Tavily Researcher. NOT a chat persona — this is a typed query
// builder + result filter + cache layer wrapping the Tavily search API.
// The "system prompt" below is a query-construction policy comment, not
// a chat system prompt. We document it as a const for parity with the
// other personas (so build-time subagents can read it) but the runtime
// path never sends it to a Seed model.
//
// Output: Citation[] with sourceType === "pmid".
import { z } from "zod";
import type { Citation } from "@/lib/forge/types";
import { Citation as CitationSchema } from "@/lib/forge/types";

// ─── POLICY (verbatim, plan 03 §B.5) ──────────────────────────────
// Stored as a const so build-time subagents and runtime tooling read
// the SAME text. Never sent to a Seed chat endpoint — Tavily is a
// search API.
export const SYSTEM_PROMPT = `Tavi — Tavily Researcher Policy

ROLE
  Pull peer-reviewed surgical protocols and anatomical norms that
  back claims in the explainer script. Every citation Tavi returns
  must be traceable to a real PMID.

INPUTS
  query: { procedureName: string, approach: string,
           intent: "protocol" | "complication-scope-check"
                   | "landmark-norm",
           extraTerms?: string[] }

OUTPUT
  Citation[] with sourceType="pmid", pointer="PMID:<digits>",
  excerpt ≤300 chars verbatim from the abstract.

QUERY CONSTRUCTION RULES

  Q1. Always include site: pubmed.ncbi.nlm.nih.gov OR domain filter
      "pubmed.ncbi.nlm.nih.gov" in the Tavily search call.
  Q2. Include the procedure CPT code if known.
  Q3. For intent="protocol": prepend "surgical protocol".
  Q4. For intent="complication-scope-check": prepend "complications
      AND incidence rate" to verify a complication appears in the
      literature before the explainer mentions it.
  Q5. For intent="landmark-norm": prepend "anatomical landmark
      reference range".

CACHE

  C1. Cache results to data/grounding-cache/tavi/{sha1(query)}.json.
  C2. Cache TTL: 30 days for protocols, 7 days for landmark norms.
  C3. On cache hit, NEVER make a network call. (Test enforces this.)
  C4. Cache key is the canonical sorted query JSON.

RESULT FILTER

  F1. REJECT any result without an extractable PMID in the URL or
      result snippet. Tavi never returns a non-PMID citation.
  F2. PMID regex: /pubmed\\.ncbi\\.nlm\\.nih\\.gov\\/(\\d{1,9})/.
  F3. Excerpt is the first 300 chars of the result snippet,
      truncated at the last word boundary.
  F4. Maximum 5 citations per query (top-5 by Tavily relevance).

REPLAY MODE
  In DEMO_MODE=replay, Tavi returns cached responses from
  data/replay/{forge_run_id}/tavi/{sha1(query)}.json without
  touching the network.`;

// ─── Typed query schema ────────────────────────────────────────────
export const TaviIntent = z.enum([
  "protocol",
  "complication-scope-check",
  "landmark-norm",
]);
export type TaviIntent = z.infer<typeof TaviIntent>;

export const TaviQuery = z
  .object({
    procedureName: z.string().min(1).max(160),
    approach: z.string().min(1).max(80),
    intent: TaviIntent,
    extraTerms: z.array(z.string().min(1).max(80)).max(8).optional(),
  })
  .strict();
export type TaviQuery = z.infer<typeof TaviQuery>;

// ─── Query builder (deterministic) ─────────────────────────────────
const PUBMED_DOMAIN = "pubmed.ncbi.nlm.nih.gov";

export function buildTavilyQueryString(q: TaviQuery, cptCode?: string): string {
  const parts: string[] = [];
  switch (q.intent) {
    case "protocol":
      parts.push("surgical protocol");
      break;
    case "complication-scope-check":
      parts.push("complications AND incidence rate");
      break;
    case "landmark-norm":
      parts.push("anatomical landmark reference range");
      break;
  }
  parts.push(q.procedureName);
  parts.push(q.approach);
  if (cptCode) parts.push(`CPT ${cptCode}`);
  if (q.extraTerms?.length) parts.push(...q.extraTerms);
  parts.push(`site:${PUBMED_DOMAIN}`);
  return parts.join(" ");
}

// ─── Cache key (sha1 of canonical sorted query JSON) ───────────────
export async function tavilyCacheKey(q: TaviQuery): Promise<string> {
  const crypto = await import("node:crypto");
  const canonical: Record<string, unknown> = {
    procedureName: q.procedureName,
    approach: q.approach,
    intent: q.intent,
    extraTerms: q.extraTerms ? [...q.extraTerms].sort() : [],
  };
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(canonical, Object.keys(canonical).sort()))
    .digest("hex");
}

// ─── PMID extraction + excerpt clipping ────────────────────────────
const PMID_REGEX = /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{1,9})/i;
const MAX_EXCERPT = 300;
const MAX_CITATIONS_PER_QUERY = 5;

export function extractPmid(url: string, snippet?: string): string | null {
  const m = PMID_REGEX.exec(url);
  if (m && m[1]) return m[1];
  if (snippet) {
    const sm = /PMID[:\s]?(\d{1,9})/i.exec(snippet);
    if (sm && sm[1]) return sm[1];
  }
  return null;
}

export function clipExcerpt(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= MAX_EXCERPT) return trimmed;
  const slice = trimmed.slice(0, MAX_EXCERPT);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

// ─── Cache I/O ─────────────────────────────────────────────────────
const CACHE_DIR = "data/grounding-cache/tavi";

async function readCache(key: string): Promise<Citation[] | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  try {
    const p = path.resolve(CACHE_DIR, `${key}.json`);
    const txt = await fs.readFile(p, "utf-8");
    const parsed = JSON.parse(txt);
    return z.array(CitationSchema).parse(parsed);
  } catch {
    return null;
  }
}

async function writeCache(key: string, citations: Citation[]): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const p = path.resolve(CACHE_DIR, `${key}.json`);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(citations, null, 2));
}

// ─── Integration contract ──────────────────────────────────────────
export interface TaviInvokeInput {
  query: TaviQuery;
  /** Optional CPT code to add to the query string per Q2 */
  cptCode?: string;
}

/**
 * Tavily search response shape (loose; SDK / REST may evolve).
 * The actual HTTP call lives in src/lib/forge/tavily.ts (not in this
 * PR's slice). We type the shape we read from it here so our filter
 * pipeline is testable independently.
 */
export interface TavilyRawResult {
  url?: string;
  title?: string;
  snippet?: string;
  content?: string;
}
export interface TavilyRawResponse {
  results?: TavilyRawResult[];
}

/**
 * Run Tavi (Tavily search) for PMID-backed citations. Cache-first;
 * NEVER hits the network on a cache hit (test enforces this in
 * tests/personas/test_tavi_cache.test.ts).
 *
 * The lower-level HTTP call lives in src/lib/forge/tavily.ts and MUST
 * route through @/lib/forge/replay.withReplay() (Invariant 3). This
 * persona module is the policy boundary + cache layer.
 */
export async function invoke(input: TaviInvokeInput): Promise<Citation[]> {
  const validated = TaviQuery.parse(input.query);
  const cacheKey = await tavilyCacheKey(validated);

  // Cache hit short-circuits everything (Q3 / C3).
  const cached = await readCache(cacheKey);
  if (cached) return cached;

  // Live path — lazy-import the HTTP wrapper. The wrapper itself
  // owns the withReplay() routing per Mara C.3 (Invariant 3 covers
  // Tavi too, not just Seed). Import specifier is a variable so TS
  // doesn't try to resolve the (collaborator-owned) module at compile
  // time.
  const tavilyPath = "@/lib/forge/tavily";
  const tav = (await import(/* @vite-ignore */ tavilyPath)) as {
    tavilySearch: (opts: {
      query: string;
      includeDomains: string[];
      maxResults: number;
    }) => Promise<TavilyRawResponse>;
  };
  const { tavilySearch } = tav;

  const queryString = buildTavilyQueryString(validated, input.cptCode);
  const raw = await tavilySearch({
    query: queryString,
    includeDomains: [PUBMED_DOMAIN],
    maxResults: MAX_CITATIONS_PER_QUERY * 2, // over-fetch; we filter
  });

  const citations: Citation[] = [];
  for (const r of raw.results ?? []) {
    const pmid = extractPmid(r.url ?? "", r.snippet ?? r.content ?? "");
    if (!pmid) continue; // F1
    const excerpt = clipExcerpt(r.snippet ?? r.content ?? r.title ?? "");
    if (!excerpt) continue;
    const candidate = {
      sourceType: "pmid" as const,
      pointer: `PMID:${pmid}`,
      excerpt,
    };
    const parsed = CitationSchema.safeParse(candidate);
    if (parsed.success) citations.push(parsed.data);
    if (citations.length >= MAX_CITATIONS_PER_QUERY) break;
  }

  await writeCache(cacheKey, citations);
  return citations;
}
