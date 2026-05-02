// Schema module — top-level types for ForgeRun, Citation, DemoMode.
// Imported by every other schema file in src/lib/forge/.
// Mara A.1 / Invariant 4 mitigation: Citation pointer regex is source-type
// aware and enforced via .refine() so audit-trail PDFs cannot ship with
// malformed pointers.
import { z } from "zod";

// ─── ForgeRunStatus ─────────────────────────────────────────────
// Stage names mirror CLAUDE.md §"Synthesis Core Loop". One enum value
// per stage that the worker can pause inside; "done" and "failed" are
// terminal. No transitions back to "pending" once running.
export const ForgeRunStatus = z.enum([
  "pending",
  "parsing", // Stage 1 (intake + PDF parse)
  "researching", // Stage 2 (Tavi + Exa + Gem + pdf-parse)
  "directing", // Stage 3 (Atlas drafts ShotList)
  "critiquing", // Stage 4 (Mara pre-render Critique[])
  "bibling", // Stage 5 (anatomy bible refs)
  "renderingKeyframes", // Stage 7 (Seedream Tier-0 anchors)
  "renderingVideo", // Stage 9 (Seedance per beat)
  "scoring", // Stage 10 (Lyra vision-critic)
  "narrating", // Stage 11 (Seed Speech + opt OmniHuman)
  "composing", // Stage 12 (Remotion render)
  "done",
  "failed",
]);
export type ForgeRunStatus = z.infer<typeof ForgeRunStatus>;

// ─── DemoMode ─────────────────────────────────────────────
// Mirrors Invariant 3. Used by replay.ts, the worker, and the HUD.
export const DemoMode = z.enum(["live", "replay", "hybrid"]);
export type DemoMode = z.infer<typeof DemoMode>;

// ─── DurationsMs ─────────────────────────────────────────────
// Per-stage wall-clock duration, ms. Keys are ForgeRunStatus values
// (excluding terminal states). Optional because not every run reaches
// every stage (bail on Mara block-severity, etc.).
export const DurationsMs = z
  .object({
    parsing: z.number().int().nonnegative().optional(),
    researching: z.number().int().nonnegative().optional(),
    directing: z.number().int().nonnegative().optional(),
    critiquing: z.number().int().nonnegative().optional(),
    bibling: z.number().int().nonnegative().optional(),
    renderingKeyframes: z.number().int().nonnegative().optional(),
    renderingVideo: z.number().int().nonnegative().optional(),
    scoring: z.number().int().nonnegative().optional(),
    narrating: z.number().int().nonnegative().optional(),
    composing: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DurationsMs = z.infer<typeof DurationsMs>;

// ─── CostUsd ─────────────────────────────────────────────
// Per-stage USD spend; same shape as DurationsMs. Cost HUD reads this.
export const CostUsd = z
  .object({
    parsing: z.number().nonnegative().optional(),
    researching: z.number().nonnegative().optional(),
    directing: z.number().nonnegative().optional(),
    critiquing: z.number().nonnegative().optional(),
    bibling: z.number().nonnegative().optional(),
    renderingKeyframes: z.number().nonnegative().optional(),
    renderingVideo: z.number().nonnegative().optional(),
    scoring: z.number().nonnegative().optional(),
    narrating: z.number().nonnegative().optional(),
    composing: z.number().nonnegative().optional(),
  })
  .strict();
export type CostUsd = z.infer<typeof CostUsd>;

// ─── ForgeRun ─────────────────────────────────────────────
// The top-level run record. Stored in Butterbase at forge_runs and
// written to the SSE stream. Status + stage are duplicated on purpose:
// "stage" is the granular cursor; "status" is the coarse state machine.
export const ForgeRun = z
  .object({
    // Canonical ForgeRun id. Either a UUID (live uploads) or a slug
    // (deterministic demo runs like "demo-hip-replacement"). The DB
    // column is `text` so slugs double as primary keys for the demo
    // path — see scripts/seed_local_db.ts. Constrain length to match
    // the strict ≤64 char limits used elsewhere in the schema layer.
    id: z.string().min(1).max(64),
    createdAt: z.string().datetime({ offset: true }), // ISO 8601 with TZ
    status: ForgeRunStatus,
    stage: ForgeRunStatus, // current stage cursor
    demoMode: DemoMode,
    durationsMs: DurationsMs,
    costUsd: CostUsd,
    error: z.string().nullable(), // null until status="failed"
  })
  .strict();
export type ForgeRun = z.infer<typeof ForgeRun>;

// ─── SourceType ─────────────────────────────────────────────
// procedure_plan     — surgeon's PDF; pointer like "§2.3" or "p.4 ¶2"
// pmid               — peer-reviewed protocol; pointer like "PMID:12345"
// curated_protocol   — entry id in data/surgical-protocols-references.json
export const SourceType = z.enum(["procedure_plan", "pmid", "curated_protocol"]);
export type SourceType = z.infer<typeof SourceType>;

// ─── Citation ─────────────────────────────────────────────
// Invariant 4. Every claim that touches user-visible output (overlay,
// narrator_line, audit PDF row) carries one of these.
//
// excerpt: ≤300 chars copied verbatim from the source so reviewers can
// match-without-clicking. NOT a paraphrase.
export const Citation = z
  .object({
    sourceType: SourceType,
    pointer: z.string().min(1).max(80),
    excerpt: z.string().min(1).max(300),
  })
  .strict()
  .refine(
    (c) => {
      // sourceType-specific pointer format checks. Tavi can return
      // slightly malformed PMIDs; we still enforce digits-after-colon.
      if (c.sourceType === "pmid") return /^PMID:\d{1,9}$/i.test(c.pointer);
      if (c.sourceType === "procedure_plan")
        return /^(§|p\.)/.test(c.pointer);
      if (c.sourceType === "curated_protocol")
        return /^[a-z0-9_-]+$/.test(c.pointer);
      return true;
    },
    { message: "pointer format does not match sourceType" },
  );
export type Citation = z.infer<typeof Citation>;
