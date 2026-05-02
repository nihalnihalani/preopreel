// Schema module — AuditEntry (one row of the audit-trail PDF).
// PDF generator iterates AuditEntry[] and renders one row per entry.
// verify_audit_trail.py reads the same shape and asserts every claim
// has a citation. Invariant 4 enforcement.
import { z } from "zod";
import { Citation } from "@/lib/forge/types";
import { ConfidenceBand } from "@/lib/forge/anatomyGraph";

// ─── CriticName ─────────────────────────────────────────────
// Names of the two critic personas that gate audit entries. New critics
// require an audit-trail-reviewer subagent pass (CLAUDE.md §Audit-Path Gate).
export const CriticName = z.enum(["mara", "lyra"]);
export type CriticName = z.infer<typeof CriticName>;

// ─── AuditEntry ─────────────────────────────────────────────
// claimId is a deterministic hash of (beat_id + sentence_index) so the
// same claim across regens deduplicates in the PDF.
// criticPasses lists the critic stage names that accepted this claim,
// e.g. ["mara", "lyra"]. Empty array means the claim made it to the
// audit *without* passing a critic — that's a pre-merge gate (a CI
// check refuses to publish such an audit).
export const AuditEntry = z
  .object({
    claimId: z.string().min(8).max(64), // sha1 hex (or shorter)
    narratorLineExcerpt: z.string().min(1).max(300), // mirrors ShotBeat.narratorLine
    citation: Citation,
    criticPasses: z.array(CriticName).min(1).max(2), // ≥1 enforced
    confidenceBand: ConfidenceBand,
  })
  .strict();
export type AuditEntry = z.infer<typeof AuditEntry>;
