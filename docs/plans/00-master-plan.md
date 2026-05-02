# 00 — PreOpReel Master Plan (Synthesized)

**Owner:** Atlas (Lead) — synthesizing inputs from Vision+Synthesis, Schema+Personas, Frontend+Demo, Butterbase, and Mara (Devil's Advocate).
**Status:** Locked. Phase 3 (implementation) starts after this document is committed.
**Demo day:** 2026-05-02 — Computer History Museum, Mountain View.
**Submission codes:** `BUTTERBASE0502` (promo, ALL CAPS) + `butterbase0502` (project submission, lowercase).

---

## 1. Plan Index

This master plan reconciles the six teammate plans below. **Read this first.** Use the per-slice plans as authoritative references for their domains.

| # | Plan | Owner | Lines | Authority over |
| ---: | --- | --- | ---: | --- |
| 01 | Master architecture | Atlas | 1,090 | File tree, build sequence, mermaid base, contracts |
| 02 | Vision + Synthesis | Vision Dev | 1,090 | Seed wrappers, 12-stage worker, replay shim |
| 03 | Schemas + Personas | Schema Dev | 1,829 | All Zod, all persona system prompts (verbatim) |
| 04 | Frontend + Demo | Frontend Dev | 690 | Next.js, Remotion, demo scripts, fixture |
| 05 | Butterbase | Butterbase Dev | 802 | Postgres schema, MCP, client SDK, realtime |
| 06 | Mara critique | Mara | 394 | Risks, blockers, scope cuts, quick wins |

Total upstream planning: **5,895 lines.** Phase-3 LoC budget: **~17,000 production + ~1,800 tests.**

---

## 2. Reconciled Decisions (Conflicts Resolved)

These are the cases where two or more plans differed; this section is the tiebreaker.

| Conflict | Resolution | Why |
| --- | --- | --- |
| Critique + critic_score storage: Redis (Vision Dev draft) vs Butterbase Postgres + realtime (Butterbase Dev) | **Butterbase Postgres + realtime is source of truth. Redis only for SSE trace stream `pre:trace:{id}`** | Realtime sub from Butterbase ↔ HUD is the demo path; cleaner than Redis stream consumer. Mara warns about consistency — addressed via Section 6. |
| Postgres table count: 7 (Atlas) vs 10 (Butterbase Dev) | **10 tables** — Butterbase Dev's full set including `anatomy_graphs`, `shot_lists`, `omnihuman_consents` | More granular = easier RLS later; `omnihuman_consents` scaffolded but unused until Layer-2 |
| `forge_run_id` propagation in worker | **AsyncLocalStorage at worker boundary; explicit param at API boundary** | Worker deals with deep call stacks; API has flat handlers |
| OmniHuman in Layer-1 demo | **CUT** (Mara F.1) | Synthetic phantom + AI-generated surgeon = double-uncanny; trust signal collapses |
| Cost HUD in Layer-1 demo | **CUT** (Mara F.2) | Competes with CriticHud for the 0:50–1:00 rubric beat |
| Hybrid mode on stage | **Code lives, never used on stage** (Mara F.3) | Adds variability when we need determinism; replay is the stage path |
| Multi-API-key rotation positioning | **Dev-loop infra, not demo signal** (Mara F.4) | Useful for prewarm cost control; not a judging surface |
| Replay cache layout: per-key files (Vision) vs manifest+sha256 (Atlas) vs bucket-mirror (Butterbase) | **All three: filesystem `data/replay/{run}/{stage}/{key}.{ext}` + `manifest.json` per stage with sha256s + Butterbase Storage mirror at `replay/{run}/...`** | Filesystem is dev path, manifest is integrity check, Butterbase is prod warm cache |
| Lyra score floor on stage | **Defined: 1 regen budget, then accept and surface honestly** (Mara A.2) | Prevents on-stage cascade failure; "honesty over theater" rule applies |

---

## 3. Mara's Blockers — Mitigations Baked Into Phase 3

Each entry below is now a Phase-3 implementation requirement. The teammate listed owns the work.

| Mara ref | Risk | Mitigation | Owner | File |
| --- | --- | --- | --- | --- |
| A.1 | 10 few-shots insufficient — 8 categories will slip | Mara prompt extends `category` enum with 3 additions: `population_assumption`, `imperative_overreach`, `cited_but_irrelevant`. Few-shots list extended to 16. | Schema | `personas/mara.ts` + `personas/__fixtures__/known-bad.ts` |
| A.2 | Atlas+Mara groupthink (same model) | Mara prompt is *adversarial-by-construction*: temperature delta (0.7 vs Atlas 0.3), explicit `YOU MUST DISAGREE WITH AT LEAST ONE BEAT` instruction, dedicated "things Atlas will get wrong" preamble | Schema | `personas/mara.ts` |
| A.3 | Lyra reject-everything cascade (4/6 beats failing) | **Score floor defined**: 1 regen budget, then accept. `criticTrace[]` records all attempts honestly. HUD shows accepted-with-low-score badge so judges see trust-not-theater. | Vision | `apps/synthesis-worker/criticLoop.ts` |
| A.4 | HUD consistency model unspecified | Worker writes Butterbase row → emits SSE event. SSE event includes `version` field; HUD ignores out-of-order events. | Vision + Frontend | `apps/synthesis-worker/sse.ts` + `components/CriticHud.tsx` |
| B.5 | Butterbase auth missing from T-30 checklist | Add `BUTTERBASE_AUTH_PROBE` to `npm run check:invariants` — pings `/healthz` against the project URL | Butterbase | `scripts/probe_butterbase.ts` |
| B.7 | HUD freezes on 3s SSE drop | EventSource heartbeat every 3s; auto-reconnect on `error`; visible "reconnecting…" badge on lapse | Frontend | `lib/sse/useEventStream.ts` |
| B.9 | Backup video has no second-eyes validation | `record_backup_video.sh` produces `docs/demo-backup.mp4` AND `docs/demo-backup.fingerprint.json` (frame-hash sample at 0:00 / 0:30 / 0:50 / 1:00 / 1:30 / 1:55). CI compares against golden. | Frontend (demo) | `scripts/record_backup_video.sh` + `scripts/verify_backup_video.py` |
| C.4 | Invariant 3 test only covers Seed wrappers, not Tavi/Exa/Gem/Butterbase | ts-morph static check covers `src/lib/{seed,forge/ingestors,butterbase}/` exhaustively. | Vision | `tests/synthesis-worker/test_replay_branch.ts` |
| C.4 | `ConfidenceBand` "High Confidence" labels are client-computed (no citation) | Server-side confidence label derived from band; band itself goes into `audit_citations.confidence_lo/hi`; label is read-only from server | Schema + Frontend | `components/ConfidenceBand.tsx` reads `band` + `label` from API |
| D.4 | Gem confidence bands likely all `{0.7, 0.9}` (vibes) | Zod refinement: `confidence_band` rejects `lo === hi`; Gem prompt requires variance + at least one band `< 0.6` per AnatomyGraph; demo fixture has 1 landmark at `{0.51, 0.62}` | Schema | `lib/forge/anatomyGraph.ts` + `personas/gem.ts` |
| D.1 | Atlas-surgical "never recommend" lacks imperative-tense allowlist | Allowlist in prompt: pre-op fasting, weight-bearing post-op, medication holds — only the 5 surgeon-supplied items in the procedure plan. Anything else = `block` per Mara. | Schema | `personas/atlas-surgical.ts` |
| E.1 | 500ms Butterbase write latency = 1–2s HUD lag | HUD subscribes to Butterbase realtime channel directly (skip server proxy); writes are fire-and-forget from worker (`Promise.allSettled`); SSE trace covers gap | Butterbase + Vision | `apps/synthesis-worker/persist.ts` (no await on critique writes) + `lib/butterbase/realtime.ts` |
| E.3 | Storage signed URL expires between page load and click | URL minted lazily in API route (`/forge/{id}/explainer.mp4` → 302 redirect to fresh signed URL) | Butterbase | `apps/api/forge/[id]/explainer/route.ts` |
| G | Three quick wins under 2hr each | Lyra `feedback` tooltip on HUD, citation-density sparkline in audit PDF, `SHOW_INVARIANT_CHECKS` debug toggle | Frontend | shipped in same PRs as their host components |

---

## 4. Open Questions — Now Resolved

Pulled from each plan's open-question lists. Resolutions are committed (no further escalation needed for Phase 3).

| # | Question | Source | Resolution |
| --- | --- | --- | --- |
| 1 | Smithery MCP package coordinate | Butterbase | Use `@smithery/butterbase` if available; fall back to direct `npx -y butterbase-mcp` if Smithery package not on registry. Verify on Phase-3 day 1. |
| 2 | `claude mcp add` flag set | Butterbase | `claude mcp add butterbase --transport stdio --command "npx -y butterbase-mcp"` (current CLI flag set as of 2026-04). |
| 3 | NPM SDK package name | Butterbase | `@butterbase/js` is the documented public name. If not present at install time, generate a thin REST client against the project URL — Butterbase exposes typed PostgREST. |
| 4 | DDL-applying MCP tool | Butterbase | `butterbase_apply_migration(sql, name)`. Fallback: direct `pg` client to `postgres://...@PROJECT.butterbase.dev:5432/postgres` — service role. |
| 5 | Storage policy DSL | Butterbase | Postgres-style RLS policies on `storage.objects`. Same DSL as the rest of the schema. |
| 6 | AsyncLocalStorage vs explicit threading | Vision | **AsyncLocalStorage at worker; explicit at API.** |
| 7 | Butterbase/Redis split | Vision | **Butterbase = source of truth. Redis = SSE traces only.** |
| 8 | Lens taxonomy availability | Vision | Port from `Anil-matcha/Open-Generative-AI` (MIT) on Phase-3 day 2. ~80 lines TypeScript. Attribution in `LICENSES.md`. |
| 9 | OmniHuman uncanny-score heuristic | Vision | Cut from Layer-1 (Mara F.1). Implementation is `≥ 0.55 → drop` once we add it Layer-2. |
| 10 | 4 Seed Speech voice IDs | Vision | Defaults: `seed-speech-warm-female` for the demo. Verify against ModelArk on day 1. |
| 11 | Mara reject-everything edge case | Mara A.3 | See §3 row A.3 — score floor + accept-with-honest-badge. |
| 12 | What does Mara catch that a single LLM wouldn't? | Mara A.4 | Phase-3 deliverable: `docs/demo-runbook.md` includes the rehearsed 60s answer. |

---

## 5. Final File Tree (Phase 3 Targets)

Synthesized from all six plans. **~110 source files + ~50 fixture binaries.** Files marked ★ are the four-invariant-critical surfaces.

```
preopreel/
├── package.json                     # name: "preopreel"; npm workspaces
├── pnpm-lock.yaml | package-lock.json
├── tsconfig.json
├── tsconfig.base.json
├── next.config.ts
├── remotion.config.ts
├── postcss.config.js
├── tailwind.config.ts
├── vitest.config.ts
├── .env.example
├── .gitignore
├── .mcp.json                        # ★ Butterbase MCP entry
├── CHANGELOG.md                     # daily-shipping log
├── CLAUDE.md                        # rules layer (already exists)
├── README.md                        # public pitch (already exists)
├── LICENSES.md                      # MIT + lens-taxonomy attribution
│
├── .claude/
│   └── settings.json                # ★ pre-tool-use hook blocks Seed-id leakage outside src/lib/seed/models.ts
│
├── docs/
│   ├── plans/                       # this directory
│   │   ├── 00-master-plan.md        # this file
│   │   ├── 01-master-architecture.md
│   │   ├── 02-vision-and-synthesis.md
│   │   ├── 03-schemas-and-personas.md
│   │   ├── 04-frontend-and-demo.md
│   │   ├── 05-butterbase-integration.md
│   │   └── 06-mara-critique.md
│   ├── architecture-mermaid.md      # ★ comprehensive end-to-end mermaid (Section 7 of this doc)
│   ├── demo-runbook.md              # 2-min beat-by-beat + 60s "what does Mara catch" rehearsal
│   ├── demo-backup.mp4              # ★ produced by record_backup_video.sh by 5 PM demo day
│   ├── demo-backup.fingerprint.json # frame-hash samples for verification
│   ├── audit-trail-sample.pdf       # public sample of an audit-trail PDF
│   └── butterbase-runbook.md        # one-pager for Butterbase Dev's day-1 steps
│
├── src/
│   ├── app/                         # Next.js 16 App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx                 # ★ landing — no signup, click-to-use
│   │   ├── globals.css
│   │   ├── forge/
│   │   │   ├── page.tsx             # ★ three-panel HUD (Upload + AnatomyGraphViewer + CriticHud)
│   │   │   └── [id]/
│   │   │       ├── page.tsx         # bookmarkable run page
│   │   │       ├── receipt/page.tsx # ★ audit-trail PDF preview (Invariant 4)
│   │   │       └── explainer/page.tsx # full-screen MP4 player
│   │   └── api/
│   │       ├── forge/
│   │       │   ├── route.ts                  # POST /api/forge — ingest
│   │       │   ├── [id]/route.ts             # GET status
│   │       │   ├── [id]/stream/route.ts      # SSE trace stream
│   │       │   ├── [id]/critique/route.ts    # Mara's critiques (typed list)
│   │       │   ├── [id]/critic/route.ts      # Lyra's per-beat scores
│   │       │   ├── [id]/receipt/route.ts     # audit-trail PDF
│   │       │   ├── [id]/explainer/route.ts   # 302 → signed Butterbase URL
│   │       │   └── [id]/regen/route.ts       # manual regen one beat
│   │       └── healthz/route.ts
│   │
│   ├── components/
│   │   ├── PreOpUpload.tsx          # drag+drop + "Try the demo case" button
│   │   ├── AnatomyGraphViewer.tsx   # ★ live JSON tree (0:18–0:28 demo beat)
│   │   ├── CriticHud.tsx            # ★ three-panel critic HUD (0:50–1:00 — Invariant 1 wow)
│   │   ├── ReceiptViewer.tsx        # audit-trail PDF preview
│   │   ├── ExplainerPlayer.tsx
│   │   ├── Navbar.tsx               # Seed lineup pill
│   │   ├── DemoBadge.tsx            # "Synthetic Phantom Demo Case" label
│   │   └── DebugInvariantPanel.tsx  # SHOW_INVARIANT_CHECKS toggle (Mara G.3)
│   │
│   ├── lib/
│   │   ├── seed/                    # ★ Invariant 2 — only place model IDs live
│   │   │   ├── models.ts            # ★ SEED_MODELS const + individual exports
│   │   │   ├── ark.ts               # Seed 2.0 Pro (Director, Mara, Lyra)
│   │   │   ├── seedance.ts          # Seedance 2.0 (T2V+ref / I2V / extend) + image_refs guard
│   │   │   ├── seedream.ts          # Seedream 5.0 Lite (Tier-0 anchor)
│   │   │   ├── speech.ts            # Seed Speech 2.0 (4 voice presets)
│   │   │   ├── omnihuman.ts         # OmniHuman 1.5 (scaffolded, not in Layer-1)
│   │   │   └── arkClient.test.ts    # smoke test
│   │   │
│   │   ├── forge/
│   │   │   ├── types.ts             # ForgeRun, ForgeRunStatus, Citation, DemoMode
│   │   │   ├── anatomyGraph.ts      # AnatomyGraph + closed-graph superRefine
│   │   │   ├── shotList.ts          # ShotList + 60–90s duration refinement
│   │   │   ├── critique.ts          # Critique + CriticScore (matches README §3.1/§3.2)
│   │   │   ├── deliverable.ts
│   │   │   ├── audit.ts             # AuditEntry + Citation pointer regex per source_type
│   │   │   ├── replay.ts            # ★ Invariant 3 chokepoint: withReplay(stage, key, live)
│   │   │   ├── keyRotation.ts       # multi-API-key fallback
│   │   │   ├── compileSeedancePrompt.ts # Stage 8: enforce image_refs
│   │   │   ├── critic.ts            # Stage 4 (Mara) + Stage 10 (Lyra) loops with score floor
│   │   │   ├── ingestors/
│   │   │   │   ├── procedurePlanPdf.ts
│   │   │   │   ├── patientDemographics.ts
│   │   │   │   └── anatomyExtract.ts        # Gem vision over plan diagrams
│   │   │   ├── personas/                    # ★ build-time AND runtime
│   │   │   │   ├── atlas-surgical.ts        # Director (verbatim system prompt)
│   │   │   │   ├── tavi.ts                  # policy + typed query builder
│   │   │   │   ├── exa.ts                   # policy + typed query builder
│   │   │   │   ├── gem.ts                   # vision + AnatomyGraph
│   │   │   │   ├── lyra.ts                  # post-render vision critic
│   │   │   │   ├── mara.ts                  # ★ pre-render Devil's Advocate
│   │   │   │   └── __fixtures__/
│   │   │   │       ├── known-bad.ts         # Mara's 16 known-bad scripts
│   │   │   │       └── lyra-known-bad.ts    # Lyra's 5 rendered-shot fixtures
│   │   │   └── lens/
│   │   │       └── taxonomy.ts              # ported from Anil-matcha/Open-Generative-AI (MIT)
│   │   │
│   │   ├── butterbase/
│   │   │   ├── client.ts            # ★ typed Butterbase wrapper
│   │   │   ├── realtime.ts          # subscriptions for critiques + critic_scores
│   │   │   ├── storage.ts           # signed URL minter
│   │   │   ├── pg-fallback.ts       # direct pg if MCP unavailable
│   │   │   └── types.gen.ts         # generated Postgres types
│   │   │
│   │   ├── audit/
│   │   │   └── pdf.ts               # pdf-lib generator with citation-density sparkline
│   │   │
│   │   ├── api/
│   │   │   └── client.ts            # typed client for the React UI
│   │   │
│   │   ├── sse/
│   │   │   └── useEventStream.ts    # heartbeat + auto-reconnect
│   │   │
│   │   ├── render.ts                # Remotion programmatic render
│   │   └── tracing/
│   │       └── als.ts               # AsyncLocalStorage for forge_run_id
│   │
│   └── remotion/
│       ├── Root.tsx                 # Remotion compositions registry
│       ├── compositions/
│       │   └── PreOpExplainer.tsx
│       └── components/surgical/
│           ├── BeatLayer.tsx
│           ├── IntroCard.tsx
│           ├── ProcedureStepOverlay.tsx
│           ├── AnatomicalLabel.tsx
│           ├── ConfidenceBand.tsx           # ★ band + label both server-derived
│           └── CitationFooter.tsx
│
├── apps/
│   └── synthesis-worker/
│       ├── index.ts                 # 12-stage orchestrator
│       ├── queue.ts                 # in-memory by default; BullMQ behind flag
│       ├── stages/
│       │   ├── 01-intake.ts
│       │   ├── 02-research.ts       # parallel fan-out: 2a-tavi, 2b-exa, 2c-gem, 2d-pdf
│       │   ├── 03-director.ts
│       │   ├── 04-devils-advocate.ts # ★ Mara loop, 1-round cap
│       │   ├── 05-anatomy-bible.ts
│       │   ├── 06-cinema-lens.ts
│       │   ├── 07-storyboard.ts     # Tier-0 Seedream
│       │   ├── 08-prompt-compiler.ts
│       │   ├── 09-seedance.ts       # ≤ 3 lanes, image_refs enforced
│       │   ├── 10-vision-critic.ts  # ★ Lyra loop, 1-regen budget + score floor
│       │   ├── 11-narration.ts
│       │   └── 12-composition.ts
│       ├── persist.ts               # Butterbase writes (fire-and-forget on critique events)
│       ├── sse.ts                   # versioned trace events to Redis stream
│       └── criticLoop.ts            # shared score-floor + regen-budget logic
│
├── butterbase/
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql  # 10 tables + RLS
│   │   ├── 0001_initial_schema.down.sql
│   │   └── 0002_seed_fixtures.sql   # demo fixture pre-load
│   └── README.md                    # how to apply migrations via MCP or pg
│
├── data/
│   ├── grounding-cache/             # Tavi peer-review cache
│   ├── replay/                      # ★ DEMO_MODE=replay fixtures
│   │   └── demo-hip-replacement/
│   │       ├── 02c-gem/             # AnatomyGraph
│   │       ├── 03-director/         # ShotList
│   │       ├── 04-mara/             # Critiques (1 advice-creep warn)
│   │       ├── 07-seedream/         # Keyframes
│   │       ├── 09-seedance/         # Per-beat MP4s (incl. Beat 3 fail + retry)
│   │       ├── 10-lyra/             # Critic scores (incl. Beat 3 0.71 → 0.86)
│   │       ├── 11-speech/           # Narration WAVs
│   │       ├── 12-render/           # Final composition input
│   │       └── manifest.json        # sha256s of every fixture
│   ├── fixtures/
│   │   └── demo-hip-replacement/
│   │       ├── plan.pdf             # generated by reportlab
│   │       ├── patient.json
│   │       └── expected.{shotlist,critique,scores}.json
│   ├── explainers/                  # local render output
│   ├── keyrot.json                  # key rotation persistence
│   └── osha-references.json         # not used here — kept for sibling parity
│
├── scripts/
│   ├── prewarm_demo.py              # ★ seeds replay cache + verifies < 90s render
│   ├── demo_mode_switch.sh          # atomic DEMO_MODE flip
│   ├── record_backup_video.sh       # ★ 5 PM demo day rule
│   ├── verify_backup_video.py       # frame-hash comparison vs golden
│   ├── verify_audit_trail.py        # ★ Invariant 4 CI gate
│   ├── probe_butterbase.ts          # T-30 Butterbase auth check (Mara B.5)
│   └── generate_phantom_plan.py     # reportlab → demo plan.pdf
│
└── tests/
    ├── conftest.ts
    ├── personas/
    │   ├── test_atlas_director.ts
    │   ├── test_mara_devils_advocate.ts        # ★ all 16 known-bad scripts
    │   ├── test_lyra_vision_critic.ts          # ★ all 5 rendered-shot fixtures
    │   ├── test_gem_anatomy.ts
    │   └── test_tavi_cache.ts
    ├── synthesis-worker/
    │   ├── test_keyframe_anchoring.ts          # ★ Invariant 2 sub-rule
    │   ├── test_replay_branch.ts               # ★ Invariant 3 (ts-morph wide scan)
    │   ├── test_critic_score_floor.ts          # ★ Mara A.3
    │   ├── test_mara_round_cap.ts
    │   ├── test_lyra_regen_budget.ts
    │   ├── test_keyrot.ts
    │   └── test_orchestrator_failure_rollback.ts
    ├── ingestors/
    │   └── test_procedure_plan_pdf.ts
    ├── butterbase/
    │   ├── test_persist.ts
    │   └── test_realtime.ts
    └── e2e/
        └── test_demo_smoke.ts                  # ★ end-to-end in DEMO_MODE=replay
```

---

## 6. Build Sequence (Phase 3, Single Session)

The CLAUDE.md sequential dependencies, expanded with owners and parallelism markers. **‖ = can run in parallel with the previous step.**

| # | Step | Owner | Files | Unblocks |
| ---: | --- | --- | --- | --- |
| 0 | **Project scaffold** — package.json, tsconfig, next.config, remotion.config, .env.example, .gitignore, .mcp.json | Atlas | 12 | All |
| 1 | **`src/lib/seed/models.ts`** + `.claude/settings.json` hook | Vision | 2 | Steps 2–4 |
| 2 ‖ | **All Zod schemas** (`forge/types.ts`, `anatomyGraph.ts`, `shotList.ts`, `critique.ts`, `deliverable.ts`, `audit.ts`) | Schema | 6 | Steps 4–9 |
| 3 ‖ | **Replay shim** (`forge/replay.ts`) + key rotation + AsyncLocalStorage | Vision | 3 | All Seed wrappers |
| 4 | **Seed wrappers** (ark, seedance, seedream, speech, omnihuman) | Vision | 5 | Steps 7–11 |
| 5 ‖ | **Persona modules** with verbatim prompts + fixtures (atlas-surgical, mara, lyra, gem, tavi, exa) | Schema | 6 + 2 fixtures | Steps 7–11 |
| 6 ‖ | **Butterbase MCP setup** + migrations + client + realtime + pg-fallback | Butterbase | 5 + 2 SQL | Steps 7–12 |
| 7 | **Worker orchestrator** + 12 stage files + criticLoop + persist + sse | Vision | 16 | Step 11 |
| 8 ‖ | **Ingestors** (procedurePlanPdf, patientDemographics, anatomyExtract) | Schema | 3 | Step 7 |
| 9 ‖ | **Audit PDF generator** + lens taxonomy port | Schema + Frontend | 2 | Step 12 |
| 10 ‖ | **Remotion compositions + 6 surgical components** | Frontend | 7 | Step 11 |
| 11 ‖ | **Next.js routes + API endpoints + components** (Upload, AnatomyGraphViewer, CriticHud, ReceiptViewer, ExplainerPlayer, Navbar, DemoBadge, DebugInvariantPanel, useEventStream) | Frontend | ~16 | Step 12 |
| 12 ‖ | **Demo fixture** — generate plan.pdf via reportlab + patient.json + expected.* + replay cache snapshots | Frontend (demo) | 50 fixture files | Step 13 |
| 13 | **Tests** — invariant enforcement (keyframe anchoring, replay branch, score floor, round cap, regen budget) + persona unit tests + e2e smoke | All | ~15 test files | Step 14 |
| 14 | **`prewarm_demo.py`** + `demo_mode_switch.sh` + `record_backup_video.sh` + `probe_butterbase.ts` + `verify_backup_video.py` + `verify_audit_trail.py` | Frontend (demo) | 6 scripts | Demo |
| 15 | **Master mermaid + demo-runbook + CHANGELOG** | Atlas | 3 | PR review |
| 16 | **Push to `main`** via PR per CLAUDE.md workflow | Atlas | — | Demo |

**Critical path:** 0 → 1 → 2 → 4 → 5 → 7 → 11 → 13 → 16. Steps marked ‖ run in parallel.

**Session-end target:** all of the above through step 14, runnable as `npm run dev` + `python scripts/prewarm_demo.py` + open `/forge` → "Try the demo case" → full pipeline runs in `DEMO_MODE=replay` → CriticHud shows Mara warn + Lyra reject/regen at Beat 3 → Remotion renders → audit PDF exports.

**Realistic Phase-3 caveats:** the persona prompts and the worker orchestrator are first-class quality. Some peripheral surfaces (OmniHuman, EDFS, multi-key rotation under load, BullMQ swap, Remotion preview-server hot-reload polish) are scaffolded with TODO markers but not exercised on the demo path. This is per Mara's Section F cuts.

---

## 7. Comprehensive End-to-End Mermaid

> Full system. Critic gates explicit (red, thick-bordered). Butterbase substrate at the bottom. Replay shim as a chokepoint diamond. SSE stream as a sidecar. Read top-to-bottom.

```mermaid
flowchart TD
    %% ─── Patient / Surgeon entry ───────────────────────────────
    User([Surgeon or Clinic Staff])
    Patient([Patient — watches output])

    User -- drag plan.pdf + patient card --> UploadUI
    Patient -. watches MP4 + reads audit PDF .-> ExplainerPage

    subgraph Browser["🖥️  Browser — Next.js 16 App Router"]
        UploadUI["/forge — PreOpUpload + 'Try the demo case' button"]
        AnatomyHUD["AnatomyGraphViewer — live JSON tree<br/>★ demo beat 0:18–0:28"]
        CriticHUD["CriticHud — Mara critiques + Lyra scores<br/>★ demo beat 0:50–1:00 — Invariant 1"]
        ReceiptUI["ReceiptViewer — audit-trail PDF<br/>★ demo beat 1:00–1:10 — Invariant 4"]
        ExplainerPage["ExplainerPlayer — full-screen MP4"]

        UploadUI --> AnatomyHUD
        UploadUI --> CriticHUD
        UploadUI --> ReceiptUI
        UploadUI --> ExplainerPage
    end

    %% ─── API ────────────────────────────────────────────────────
    UploadUI -- "POST /api/forge<br/>(multipart: pdf + patient.json)" --> APIIngest

    subgraph API["⚙️  Next.js API routes"]
        APIIngest["/api/forge<br/>POST — enqueue ForgeRun"]
        APIStatus["/api/forge/{id}<br/>GET — status"]
        APIStream["/api/forge/{id}/stream<br/>GET SSE"]
        APIReceipt["/api/forge/{id}/receipt<br/>GET — audit PDF"]
        APIExplainer["/api/forge/{id}/explainer<br/>GET 302 → signed URL"]
        APIRegen["/api/forge/{id}/regen<br/>POST — manual"]
    end

    APIIngest -- "enqueue(forge_run_id)" --> Worker

    %% ─── Worker — 12-stage pipeline ────────────────────────────
    subgraph Worker["🛠️  apps/synthesis-worker — 12-stage orchestrator (AsyncLocalStorage scopes forge_run_id)"]
        S1[Stage 1<br/>Intake — Atlas]
        S2a[Stage 2a<br/>Tavi: PMID-cited<br/>protocols]
        S2b[Stage 2b<br/>Exa: visual<br/>style refs]
        S2c[Stage 2c<br/>Gem: AnatomyGraph<br/>+ confidence bands]
        S2d[Stage 2d<br/>pdf-parse<br/>deterministic]
        S3[Stage 3<br/>Director — Atlas-surgical<br/>Seed 2.0 Pro → ShotList]
        S4{{"★ Stage 4 — Mara<br/>Devil's Advocate<br/>Seed 2.0 Pro<br/>1-round cap"}}
        S5[Stage 5<br/>Anatomy Bible — Lyra<br/>Seed 2.0 Pro + Seedream]
        S6[Stage 6<br/>Cinema Lens<br/>deterministic suffix]
        S7[Stage 7<br/>Storyboard Keyframes — Lyra<br/>★ TIER-0 SEEDREAM ANCHOR — Invariant 2]
        S8[Stage 8<br/>Prompt Compiler — Atlas<br/>image_refs guard]
        S9[Stage 9<br/>Seedance ≤3 lanes<br/>I2V or T2V-with-ref ONLY<br/>extend for >5s]
        S10{{"★ Stage 10 — Lyra<br/>Vision Critic<br/>Seed 2.0 Pro Vision<br/>1-regen budget + score floor"}}
        S11[Stage 11<br/>Narration — Atlas<br/>Seed Speech 2.0]
        S12[Stage 12<br/>Composition + Render<br/>Remotion → 1080p MP4]

        S1 --> S2a & S2b & S2c & S2d
        S2a & S2b & S2c & S2d --> S3
        S3 --> S4
        S4 -- "block-severity revisions" --> S3
        S4 -- "approved ShotList v2" --> S5
        S5 --> S6 --> S7 --> S8 --> S9 --> S10
        S10 -- "min score < 0.75 OR text>0<br/>(1 budget per beat)" --> S9
        S10 -- "accept (incl. accept-with-honest-badge)" --> S11
        S11 --> S12
    end

    %% ─── DEMO_MODE replay shim ─────────────────────────────────
    Replay{{"★ DEMO_MODE shim — withReplay(stage,key,live)<br/>live ▷ call + persist · replay ▷ load fixture · hybrid ▷ race + fall back"}}
    Worker -. every Seed call goes through .-> Replay
    Replay -- "live mode" --> Seed
    Replay -- "replay mode" --> Fixtures

    %% ─── Seed model surface ────────────────────────────────────
    subgraph Seed["☁️  BytePlus ModelArk — judged generation surface"]
        Ark["Seed 2.0 Pro<br/>Director · Mara · Lyra-vision"]
        Seedream["Seedream 5.0 Lite<br/>keyframes ★ Tier-0"]
        Seedance["Seedance 2.0<br/>I2V/T2V-with-ref + extend"]
        Speech["Seed Speech 2.0<br/>warm-clinician narration"]
        Omni["OmniHuman 1.5<br/>(Layer-2, scaffolded)"]
    end
    KeyRot["keyRotation.ts<br/>round-robin ARK_API_KEY[_2|_3]"]
    Seed -. quota / 5xx .-> KeyRot
    KeyRot -. rotated key .-> Seed

    %% ─── Replay fixtures (filesystem) ───────────────────────────
    subgraph Fixtures["📁 data/replay/{forge_run_id}/"]
        F1[02c-gem/AnatomyGraph]
        F2[03-director/ShotList]
        F3[04-mara/Critiques<br/>1× advice_creep warn]
        F4[07-seedream/keyframes/]
        F5[09-seedance/beat_3_attempt1.mp4<br/>+ beat_3_attempt2.mp4<br/>★ deliberate fail+retry]
        F6[10-lyra/scores<br/>beat_3: 0.71 → 0.86]
        F7[11-speech/*.wav]
        F8[manifest.json + sha256]
    end

    %% ─── Butterbase substrate ──────────────────────────────────
    Worker -. "fire-and-forget writes (no await on critique events)" .-> BB

    subgraph BB["🍞 Butterbase — Postgres + Storage + Realtime + Edge<br/>(promo BUTTERBASE0502 · submission butterbase0502)"]
        BB_runs[(forge_runs)]
        BB_plans[(procedure_plans)]
        BB_pat[(patient_demographics)]
        BB_anat[(anatomy_graphs)]
        BB_shot[(shot_lists)]
        BB_crit[(critiques)]
        BB_score[(critic_scores)]
        BB_audit[(audit_citations)]
        BB_repl[(replay_fixtures)]
        BB_omni[(omnihuman_consents)]
        BB_store[/Storage:<br/>preopreel-renders/<br/>explainers · audit · keyframes · uploads · replay/]
        BB_edge["Edge fn: recordCriticEvent<br/>(atomic dual-write)"]
        BB_rt(("Realtime channels<br/>critiques · critic_scores"))
    end

    BB_crit & BB_score -. "publish on insert" .-> BB_rt
    BB_rt -. "WebSocket subscription" .-> CriticHUD

    %% ─── Redis (SSE only) ──────────────────────────────────────
    Worker -- "SSE trace events {versioned}" --> Redis[(Redis Stream<br/>pre:trace:{id} — SSE only)]
    Redis -- "consumed by" --> APIStream
    APIStream -- "EventSource w/ heartbeat + reconnect" --> AnatomyHUD

    %% ─── Render output ────────────────────────────────────────
    S12 -- "renderMedia → mp4 bytes" --> BB_store
    S12 -- "audit PDF (pdf-lib)" --> BB_store
    BB_store -. "lazy signed URL (per request)" .-> APIExplainer
    BB_store -. "lazy signed URL (per request)" .-> APIReceipt

    %% ─── Receipt page reads ────────────────────────────────────
    APIReceipt -- "GET — joins runs + critiques + scores + citations" --> ReceiptUI
    APIExplainer -- "302" --> ExplainerPage

    %% ─── Class styling — critic gates highlighted ─────────────
    classDef critic fill:#7a1f1f,stroke:#ff6b6b,stroke-width:4px,color:#fff
    classDef invariant fill:#1f4f7a,stroke:#6bb6ff,stroke-width:3px,color:#fff
    classDef demo fill:#7a5f1f,stroke:#ffd96b,stroke-width:2px,color:#fff
    class S4,S10 critic
    class Replay,S7 invariant
    class CriticHUD,ReceiptUI demo
```

The mermaid above is the canonical reference. Mirror to `docs/architecture-mermaid.md` in Phase 3 step 15.

---

## 8. Sponsor Integration Map (Final)

Every sponsor earns its place. Nothing checkbox-integrated.

| Sponsor | Role | Visible in demo at |
| --- | --- | --- |
| **Seed 2.0 Pro** | Atlas (Director) + Mara (Critic 1) + Lyra (Critic 2). Three personas, three system prompts, one model. | Stages 3, 4, 10 — narrated in 1:10–1:30 architecture beat |
| **Seedream 5.0 Lite** | Stage 7 keyframe anchor (Tier-0). 1–3 ref images per anatomical entity. | Watermark on the Stage-7 visual frames in CriticHud |
| **Seedance 2.0** | Per-beat I2V or T2V-with-ref. extend for >5s. Naked T2V blocked at compile-time. | The output MP4 itself (0:28–0:50) |
| **Seed Speech 2.0** | Warm-clinician narration, bounded to plan corpus. | Audible in 0:28–0:50 |
| **OmniHuman 1.5** | **Cut from Layer-1** per Mara F.1. Scaffolded for Layer-2. | (Not visible) |
| **Tavily** | Stage 2a — PMID-cited surgical protocols, cached locally. | Citations on every overlay (0:28–0:50) + audit PDF (1:00–1:10) |
| **Exa** | Stage 2b — neural search for visual style refs. | Drives Seedream style |
| **Google Gemini 1.5 Flash** | Stage 2c — vision-only landmark extraction (non-judged path). | AnatomyGraphViewer (0:18–0:28) |
| **Butterbase** | Source of truth for everything except SSE traces. Realtime drives the CriticHud. | Realtime CriticHud writes (0:50–1:00) + audit PDF storage |
| **Remotion** | Composition + render. Surgical overlays carry the citations. | The rendered MP4 (0:28–0:50) |
| **DigitalOcean** | Optional host fallback (Butterbase Storage primary). | (Not visible) |

---

## 9. The Four Invariants — Enforcement Surface

| Invariant | Enforcement | Test | Visible to judge as |
| --- | --- | --- | --- |
| **1. Critic loop mandatory** | `apps/synthesis-worker/criticLoop.ts` — Mara at S4 (1-round cap), Lyra at S10 (1-regen budget + score floor). PRs touching `personas/mara.ts`, `personas/lyra.ts`, `criticLoop.ts`, `CriticHud.tsx`, or `pre:critic:*` schema gated by `critic-loop-reviewer` subagent. | `tests/synthesis-worker/test_critic_score_floor.ts` + `test_mara_round_cap.ts` + `test_lyra_regen_budget.ts` + Mara/Lyra persona tests over fixtures | CriticHud at 0:50–1:00 with real reject/regen |
| **2. Seed pinning + Tier-0 anchoring** | `src/lib/seed/models.ts` is the only place Seed IDs live. `.claude/settings.json` pre-tool-use hook blocks edits embedding Seed IDs elsewhere. `seedance.ts` rejects payloads with `image_refs.length === 0`. | `npm run check:invariants` — grep + ts-morph + `tests/synthesis-worker/test_keyframe_anchoring.ts` | Architecture beat 1:10–1:30 mentions all four Seed models |
| **3. Hermetic DEMO_MODE** | All outbound calls go through `withReplay()` (`src/lib/forge/replay.ts`). `prewarm_demo.py` seeds the cache. `--verify` re-runs in replay and compares hashes against `manifest.json`. | `tests/synthesis-worker/test_replay_branch.ts` (ts-morph wide scan over `src/lib/{seed,forge/ingestors,butterbase}/`) | Demo runs in replay; if Wi-Fi dies, no visible change |
| **4. Citation-bound audit** | Every narrator line carries `Citation[]`; Zod refinement on `Citation.pointer` per `source_type`; `verify_audit_trail.py` parses every replay fixture. PRs touching `audit.ts`, `pdf.ts`, `audit_citations` schema gated by `audit-trail-reviewer`. | `scripts/verify_audit_trail.py` in CI + Mara `category=uncited_claim` few-shots | Audit PDF export at 1:00–1:10 with citation-density sparkline |

---

## 10. Demo Day (2026-05-02) — Final Checklist

Per CLAUDE.md, plus Mara's additions.

### T-24h (2026-05-01 evening)
- [ ] `python scripts/prewarm_demo.py` — full cache for the demo case + 2 backups
- [ ] `npm run check:invariants` — all four green
- [ ] `npm run test` — full suite green
- [ ] Dry-run twice in `DEMO_MODE=replay` + once in `hybrid` (latter only to verify hybrid actually works; not for stage)
- [ ] CHANGELOG.md updated with day-5 entry

### T-12h (2026-05-02 morning)
- [ ] `./scripts/record_backup_video.sh` — produces `docs/demo-backup.mp4` + `docs/demo-backup.fingerprint.json`
- [ ] `python scripts/verify_backup_video.py` — frame-hash comparison vs golden passes
- [ ] PR reviewed + merged + pushed to https://github.com/nihalnihalani/preopreel main
- [ ] Backup video file size reasonable (<100MB)

### T-30 (in venue)
- [ ] `./scripts/demo_mode_switch.sh replay`
- [ ] `npx tsx scripts/probe_butterbase.ts` — auth + one row read passes
- [ ] `npm run check:invariants` — repeat
- [ ] Browser tab open on `/forge` with phantom case pre-staged
- [ ] CriticHud test render shows Mara warn + Lyra Beat-3 reject/regen sequence
- [ ] Audit PDF preview cached
- [ ] Backup video file open in OS preview (one-keystroke fallback)
- [ ] Phone tethering ready as Wi-Fi fallback

### Post-demo
- [ ] CHANGELOG.md `## 2026-05-02 — Demo Day` final entry
- [ ] File 2 GitHub issues against BytePlus per CareReel pattern
- [ ] Submit project with code `butterbase0502` (lowercase)

---

## 11. References

- `01-master-architecture.md` — Atlas's authoritative architecture
- `02-vision-and-synthesis.md` — Vision Dev's detailed Seed wrapper specs
- `03-schemas-and-personas.md` — Schema Dev's verbatim production prompts + Zod
- `04-frontend-and-demo.md` — Frontend Dev's UI + Remotion + demo-ops specs
- `05-butterbase-integration.md` — Butterbase Dev's Postgres schema + MCP setup
- `06-mara-critique.md` — Mara's Devil's Advocate critique (the blockers above)
- `../README.md` — public pitch
- `../CLAUDE.md` — rules layer

**Watch the YouTube reference:** https://www.youtube.com/watch?v=SHnryHJL9xc — Butterbase MCP setup tutorial. Mirror its setup exactly in `.mcp.json`.
