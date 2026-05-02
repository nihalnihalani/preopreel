// Persona module — also used at build-time as a Claude Code subagent. Same prompt at build time and runtime.
//
// Exa — Neural Search Researcher. Like Tavi, this is a typed query
// builder + result filter wrapping the Exa neural search API. NOT a
// chat persona; the SYSTEM_PROMPT below is a query-construction
// policy comment, not a chat system prompt.
//
// Output: StyleReference[] (URLs + thumbnails). NEVER a Citation —
// Exa drives Seedream visual style, never narration provenance.
import { z } from "zod";

// ─── POLICY (verbatim, plan 03 §B.6) ──────────────────────────────
export const SYSTEM_PROMPT = `Exa — Neural Search Researcher Policy

ROLE
  Find similar-procedure visualization references for visual style
  match. Drives Seedream keyframe generation. NEVER cited in
  narration; never used for protocol values.

INPUTS
  query: { procedureName: string, approach: string,
           styleHints?: string[] }

OUTPUT
  StyleReference[]:
    {
      url: string (the source page),
      thumbnailUrl: string (image URL, 16:9 preferred),
      title: string (≤120 chars),
      similarityScore: number 0..1 (Exa-reported)
    }

QUERY CONSTRUCTION RULES

  Q1. Use Exa's neural mode (not keyword) — we want semantic
      neighbors, not exact-match text.
  Q2. Construct query as: "<procedureName> <approach> surgical
      animation style" (no medical-protocol terms).
  Q3. Filter to image-bearing results (Exa supports
      include_domains and useAutoprompt).
  Q4. Top 8 results.

RESULT FILTER

  F1. Reject any result that appears to be a real surgical video
      (we want animations / illustrations / diagrams as style refs,
      not real-OR footage — Seedance trained on real surgery would
      drift toward gore).
  F2. Reject results without a thumbnail URL.
  F3. Sort by similarityScore descending.

CACHE
  C1. Same on-disk cache pattern as Tavi:
      data/grounding-cache/exa/{sha1(query)}.json.
  C2. TTL: 30 days (style references are stable).

USAGE BOUNDARY (CRITICAL)
  Exa results inform STYLE only. The narrator script never cites
  an Exa result. The audit PDF never cites an Exa result. Exa drives
  Stage 7 (Seedream keyframes) and Stage 8 (prompt compiler) via
  visual reference URLs — that is its only seat at the table.`;

// ─── Typed query / result schemas ──────────────────────────────────
export const ExaQuery = z
  .object({
    procedureName: z.string().min(1).max(160),
    approach: z.string().min(1).max(80),
    styleHints: z.array(z.string().min(1).max(80)).max(8).optional(),
  })
  .strict();
export type ExaQuery = z.infer<typeof ExaQuery>;

export const StyleReference = z
  .object({
    url: z.string().url(),
    thumbnailUrl: z.string().url(),
    title: z.string().min(1).max(120),
    similarityScore: z.number().min(0).max(1),
  })
  .strict();
export type StyleReference = z.infer<typeof StyleReference>;

const MAX_RESULTS = 8;

// ─── Heuristics for filtering "real surgical video" (F1) ──────────
const REAL_SURGERY_DOMAINS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
];
const REAL_SURGERY_KEYWORDS = [
  "live surgery",
  "real surgery",
  "actual procedure",
  "or footage",
  "operating room footage",
];

export function looksLikeRealSurgicalVideo(
  url: string,
  title: string,
): boolean {
  const u = url.toLowerCase();
  const t = title.toLowerCase();
  if (REAL_SURGERY_DOMAINS.some((d) => u.includes(d))) {
    // YouTube/Vimeo are mostly real-surgery footage in this context;
    // allow only if the title mentions "animation" / "illustration".
    if (!/animation|illustration|diagram|3d|cgi/.test(t)) return true;
  }
  return REAL_SURGERY_KEYWORDS.some((k) => t.includes(k));
}

// ─── Query builder ─────────────────────────────────────────────────
export function buildExaQueryString(q: ExaQuery): string {
  const parts: string[] = [
    q.procedureName,
    q.approach,
    "surgical animation style",
  ];
  if (q.styleHints?.length) parts.push(...q.styleHints);
  return parts.join(" ");
}

export async function exaCacheKey(q: ExaQuery): Promise<string> {
  const crypto = await import("node:crypto");
  const canonical: Record<string, unknown> = {
    procedureName: q.procedureName,
    approach: q.approach,
    styleHints: q.styleHints ? [...q.styleHints].sort() : [],
  };
  return crypto
    .createHash("sha1")
    .update(JSON.stringify(canonical, Object.keys(canonical).sort()))
    .digest("hex");
}

// ─── Cache I/O ─────────────────────────────────────────────────────
const CACHE_DIR = "data/grounding-cache/exa";

async function readCache(key: string): Promise<StyleReference[] | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  try {
    const p = path.resolve(CACHE_DIR, `${key}.json`);
    const txt = await fs.readFile(p, "utf-8");
    return z.array(StyleReference).parse(JSON.parse(txt));
  } catch {
    return null;
  }
}

async function writeCache(
  key: string,
  refs: StyleReference[],
): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const p = path.resolve(CACHE_DIR, `${key}.json`);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(refs, null, 2));
}

// ─── Integration contract ──────────────────────────────────────────
export interface ExaInvokeInput {
  query: ExaQuery;
}

/**
 * Exa search response shape (loose; SDK / REST may evolve). Typed
 * here so our filter pipeline is testable independently of the HTTP
 * client.
 */
export interface ExaRawResult {
  url?: string;
  title?: string;
  thumbnailUrl?: string;
  score?: number;
}
export interface ExaRawResponse {
  results?: ExaRawResult[];
}

/**
 * Run Exa (neural style search). Returns StyleReference[].
 * The lower-level HTTP call lives in src/lib/forge/exa.ts and MUST
 * route through @/lib/forge/replay.withReplay() (Invariant 3 / Mara C.3).
 * Never produces a Citation; results are visual style refs only.
 */
export async function invoke(input: ExaInvokeInput): Promise<StyleReference[]> {
  const validated = ExaQuery.parse(input.query);
  const cacheKey = await exaCacheKey(validated);

  const cached = await readCache(cacheKey);
  if (cached) return cached;

  // Lazy import — variable specifier so TS doesn't resolve at compile
  // time (the module is owned by a collaborator and may not exist
  // yet).
  const exaPath = "@/lib/forge/exa";
  const exaMod = (await import(/* @vite-ignore */ exaPath)) as {
    exaSearch: (opts: {
      query: string;
      numResults: number;
      type: "neural" | "keyword";
      useAutoprompt: boolean;
    }) => Promise<ExaRawResponse>;
  };
  const { exaSearch } = exaMod;

  const queryString = buildExaQueryString(validated);
  const raw = await exaSearch({
    query: queryString,
    numResults: MAX_RESULTS * 2, // over-fetch; we filter
    type: "neural",
    useAutoprompt: true,
  });

  const refs: StyleReference[] = [];
  for (const r of raw.results ?? []) {
    if (!r.thumbnailUrl) continue; // F2
    if (looksLikeRealSurgicalVideo(r.url ?? "", r.title ?? "")) continue; // F1
    const candidate = {
      url: r.url,
      thumbnailUrl: r.thumbnailUrl,
      title: (r.title ?? "Untitled").slice(0, 120),
      similarityScore: typeof r.score === "number" ? r.score : 0,
    };
    const parsed = StyleReference.safeParse(candidate);
    if (parsed.success) refs.push(parsed.data);
  }
  // F3: sort descending
  refs.sort((a, b) => b.similarityScore - a.similarityScore);
  const top = refs.slice(0, MAX_RESULTS);

  await writeCache(cacheKey, top);
  return top;
}
