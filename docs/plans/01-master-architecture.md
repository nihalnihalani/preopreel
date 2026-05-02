# 01 — Master Architecture Plan (Atlas, Lead Architect)

> **Audience:** Vision+Synthesis Dev, Schema+Personas Dev, Frontend+Demo Dev, Butterbase Dev, Mara (Devil's Advocate). This is the single build spec for the demo-day deliverable. No prose pitch lives here — that lives in `README.md`.
> **End-of-session deliverable:** runnable scaffold in `DEMO_MODE=replay` mode. Every Seed call returns cached fixtures. Synthesis HUD shows real Mara critiques + Lyra scores. Final 1080p H.264 MP4 renders end-to-end via Remotion. Audit-trail PDF exports.
> **Hard constraint (Invariant 2 from minute one):** model IDs (`seed-2.0-pro`, `seedream-5.0-lite`, `seedance-2.0`, `seed-speech-2.0`, `omnihuman-1.5`, `seedance-v2.0-extend`) appear *only* in `src/lib/seed/models.ts`, this plan, and `README.md`. Anywhere else is a merge-blocking violation.

---

## 0. Index

1. Project layout (concrete final tree)
2. Build sequence (14-step ordered chain, owners, complexity, unblocks)
3. Master mermaid diagram (full system)
4. Module interface contracts (TypeScript)
5. `DEMO_MODE` replay contract (`src/lib/forge/replay.ts`)
6. Butterbase data model (Postgres tables)
7. Four invariants in operational form (per-PR checklist + scripts)
8. Sponsor integration depth (per-sponsor surface + fixtures + on-stage visibility)
9. The 5-day timeline
10. Top-8 risks and mitigations

---

## 1. Project Layout — Final Concrete Tree

Distinguish **four execution surfaces**:

- `src/` — Next.js TypeScript app + shared libraries (UI, schemas, Seed wrappers, persona prompts, replay shim, Butterbase client). Imported by both `apps/web` and `apps/synthesis-worker`.
- `apps/synthesis-worker/` — Node orchestrator process. Runs the 12-stage pipeline. Reads jobs from Butterbase `forge_runs` (status='queued'), writes trace events to Redis Stream `pre:trace:{forge_run_id}`, persists everything else to Butterbase.
- `remotion/` — top-level Remotion compositions + entry. Rendered by `npx remotion render` (CLI) and by the worker's `src/lib/render.ts` (programmatic).
- `scripts/` — Python ops: replay-cache prewarm, audit-trail verifier, demo-mode switch, backup-video recorder.

```text
preopreel/
├── CLAUDE.md                                       # rules layer (already exists)
├── README.md                                        # public pitch (already exists)
├── CHANGELOG.md                                     # one section per day; CareReel pattern
├── LICENSES.md                                      # MIT + Open-Generative-AI port attribution
├── architecture.md                                  # symlink → docs/telestudio_architecture_v5_fusion.mermaid
├── package.json                                     # name: "preopreel"
├── package-lock.json                                # SoT (npm ci on CI)
├── tsconfig.json                                    # strict; paths: @/* → src/*
├── tsconfig.worker.json                             # extends tsconfig.json; outDir: dist/worker
├── next.config.ts                                   # Next 16 App Router; serverExternalPackages: ["@remotion/renderer","pdf-parse"]
├── remotion.config.ts                               # 1920x1080, 30fps, codec H.264
├── vitest.config.ts                                 # ts + tsx + mdx; per-suite include globs
├── eslint.config.mjs                                # flat config; bans hardcoded model IDs (custom rule)
├── .env.example                                     # documented env shape (no secrets)
├── .gitignore                                       # node_modules, .next, dist, data/replay/*.mp4 NOT ignored
├── .nvmrc                                           # 20.x
├── .claude/
│   ├── settings.json                                # CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1; pre-tool-use hooks
│   ├── hooks/
│   │   ├── pre-edit-block-model-ids.sh             # blocks `seed-*|seedance-*|seedream-*|omnihuman-*` outside src/lib/seed/models.ts
│   │   ├── pre-edit-block-direct-main.sh           # blocks commits to main
│   │   └── post-edit-run-typecheck.sh               # touches *.ts → tsc --noEmit on changed package
│   └── agents/
│       ├── critic-loop-reviewer.md                  # subagent for personas/{atlas-surgical,mara,lyra}.ts review
│       ├── audit-trail-reviewer.md
│       └── seed-pipeline-tracer.md
├── apps/
│   ├── web/                                         # Next.js 16 App Router (patient-facing UI)
│   │   ├── src/app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                             # "no signup, click to use" landing → CTA → /forge
│   │   │   └── forge/
│   │   │       ├── page.tsx                         # upload + live HUD; demo-staged with phantom case
│   │   │       └── [id]/page.tsx                    # post-render explainer + audit PDF download
│   │   ├── public/
│   │   │   └── demo/
│   │   │       ├── phantom-hip-replacement.pdf     # synthetic procedure plan fixture
│   │   │       └── phantom-patient-card.json
│   │   └── tsconfig.json                            # extends root
│   ├── api/                                         # Next.js API routes (entry surface)
│   │   ├── server.ts                                # _log_if_forge_route middleware; SSE plumbing
│   │   └── src/app/api/
│   │       ├── forge/route.ts                       # POST  /api/forge          ingest
│   │       ├── forge/[id]/route.ts                  # GET   /api/forge/{id}      status
│   │       ├── forge/[id]/stream/route.ts           # GET   /api/forge/{id}/stream     SSE trace
│   │       ├── forge/[id]/critique/route.ts         # GET   /api/forge/{id}/critique   Mara list
│   │       ├── forge/[id]/critic/route.ts           # GET   /api/forge/{id}/critic     Lyra scores
│   │       ├── forge/[id]/receipt/route.ts          # GET   /api/forge/{id}/receipt    audit-trail PDF
│   │       ├── forge/[id]/explainer.mp4/route.ts    # signed URL or stream proxy
│   │       ├── forge/[id]/regen/route.ts            # POST  manual regen override
│   │       └── healthz/route.ts                     # liveness; reports DEMO_MODE + Seed avail
│   └── synthesis-worker/                            # 12-stage orchestrator process
│       ├── src/
│       │   ├── index.ts                             # boot loop: Butterbase poll → run pipeline
│       │   ├── orchestrator.ts                      # ForgeRun state machine (Stage 1 → 12)
│       │   ├── stages/
│       │   │   ├── stage01-intake.ts
│       │   │   ├── stage02-research.ts             # parallel fan-out (2a/2b/2c/2d)
│       │   │   ├── stage03-director.ts
│       │   │   ├── stage04-mara-critique.ts        # ★ Critic Gate 1 (pre-render)
│       │   │   ├── stage05-anatomy-bible.ts
│       │   │   ├── stage06-cinema-lens.ts          # deterministic
│       │   │   ├── stage07-keyframes.ts
│       │   │   ├── stage08-prompt-compiler.ts
│       │   │   ├── stage09-seedance.ts             # MAX_CONCURRENT_LANES=3
│       │   │   ├── stage10-lyra-critic.ts          # ★ Critic Gate 2 (post-render); 1 regen
│       │   │   ├── stage11-narration.ts            # 11a Speech, 11b OmniHuman (opt-in)
│       │   │   └── stage12-render.ts               # Remotion programmatic render
│       │   ├── trace.ts                             # SSE event publisher (Redis Stream)
│       │   ├── concurrency.ts                       # in-process semaphore (lanes)
│       │   └── render.ts                            # @remotion/renderer wrapper
│       ├── package.json                             # name: "@preopreel/synthesis-worker"
│       └── tsconfig.json                            # extends ../../tsconfig.worker.json
├── src/                                             # shared libs (imported everywhere)
│   ├── lib/
│   │   ├── seed/                                    # ★ Invariant 2 home
│   │   │   ├── models.ts                            # ★ ONLY file with model-ID string literals
│   │   │   ├── ark.ts                               # Seed 2.0 Pro/Lite + Speech (ModelArk OpenAI-compat)
│   │   │   ├── seedance.ts                          # T2V-with-ref / I2V / extend
│   │   │   ├── seedream.ts                          # Tier-0 keyframe + entity refs
│   │   │   ├── speech.ts                            # Seed Speech 2.0 (24kHz PCM)
│   │   │   └── omnihuman.ts                         # OmniHuman 1.5 (opt-in)
│   │   ├── forge/
│   │   │   ├── types.ts                             # ForgeRun, AnatomyGraph, ShotList, Critique, CriticScore, AuditCitation
│   │   │   ├── anatomyGraph.ts                      # Zod schema (Stage 2c output)
│   │   │   ├── shotList.ts                          # Zod schema (Stage 3 output)
│   │   │   ├── critique.ts                          # Zod schema (Stage 4 output)
│   │   │   ├── criticScore.ts                       # Zod schema (Stage 10 output)
│   │   │   ├── auditCitation.ts                     # Zod schema (every claim ↔ source)
│   │   │   ├── ingestors/
│   │   │   │   ├── procedurePlanPdf.ts             # PDF → typed plan (pdf-parse)
│   │   │   │   ├── patientDemographics.ts          # JSON card → typed patient
│   │   │   │   └── anatomyExtract.ts               # Gem vision over plan diagrams
│   │   │   ├── anatomyReasoner.ts                   # anatomical norms + confidence bands
│   │   │   ├── tavily.ts                            # Tavi client + grounding cache (file-backed)
│   │   │   ├── exa.ts                               # Exa client
│   │   │   ├── personas/
│   │   │   │   ├── atlas-surgical.ts                # Director system prompt + draft()
│   │   │   │   ├── tavi.ts                          # Researcher
│   │   │   │   ├── exa.ts                           # Researcher
│   │   │   │   ├── gem.ts                           # Vision + anatomy
│   │   │   │   ├── lyra.ts                          # Vision Critic (Stage 10)
│   │   │   │   └── mara.ts                          # Devil's Advocate (Stage 4) — plan-only mode
│   │   │   ├── lens/                                # Open-Generative-AI port (MIT)
│   │   │   │   ├── taxonomy.ts                      # camera/lens/aperture lookups
│   │   │   │   └── README.md                        # attribution
│   │   │   ├── compileSeedancePrompt.ts             # Stage 8 prompt assembler; enforces image_refs.length>=1
│   │   │   ├── critic.ts                            # Stage 10 loop: score → reject? → 1 regen → accept
│   │   │   ├── replay.ts                            # ★ DEMO_MODE chokepoint: withReplay(stage,key,liveCallFn)
│   │   │   ├── keyRotation.ts                       # multi-API-key failover (CareReel pattern)
│   │   │   ├── butterbase.ts                        # ButterbaseClient (Postgres ORM-lite via supabase-js or pg)
│   │   │   ├── auditPdf.ts                          # PDF generator (every claim cited)
│   │   │   └── render.ts                            # programmatic Remotion render entry
│   │   └── ui/                                      # primitive UI utils (cn, formatters)
│   ├── components/
│   │   ├── PreOpUpload.tsx                          # patient + procedure intake
│   │   ├── AnatomyGraphViewer.tsx                   # live JSON tree (Stage 2c stream)
│   │   ├── CriticHud.tsx                            # ★ on-camera at 0:50–1:00 — Mara left, Lyra right
│   │   ├── ForgeStatus.tsx                          # per-stage status pill row
│   │   ├── DeliverableCard.tsx                      # final url/duration/cost/regen-count summary
│   │   └── persona/
│   │       ├── PersonaBadge.tsx                     # Atlas / Tavi / Exa / Gem / Lyra / Mara
│   │       └── PersonaTrace.tsx                     # active-persona indicator on the HUD
│   └── remotion/                                    # composition source (imported by remotion/index.tsx)
│       ├── compositions/
│       │   └── PreOpExplainer.tsx                   # top-level <Composition>
│       └── components/surgical/
│           ├── ProcedureStepOverlay.tsx
│           ├── AnatomicalLabel.tsx
│           ├── ConfidenceBand.tsx
│           └── CitationFooter.tsx
├── remotion/                                        # Remotion entry root (CLI surface)
│   ├── index.tsx                                    # registerRoot(Root) → renders <PreOpExplainer/>
│   └── Root.tsx                                     # <Composition id="PreOpExplainer" .../>
├── data/
│   ├── grounding-cache/                             # Tavi peer-review cache (deterministic)
│   │   └── .gitkeep
│   ├── replay/                                      # ★ DEMO_MODE=replay fixtures
│   │   └── demo-hip-replacement/                    # forge_run_id namespace
│   │       ├── stage01-intake.json
│   │       ├── stage02-research/
│   │       │   ├── tavi.json
│   │       │   ├── exa.json
│   │       │   ├── gem-anatomy.json
│   │       │   └── pdf-parse.json
│   │       ├── stage03-director.json
│   │       ├── stage04-mara.json
│   │       ├── stage05-anatomy-bible.json
│   │       ├── stage07-keyframes/{beat-01..N}.png
│   │       ├── stage09-seedance/{beat-01..N}.mp4
│   │       ├── stage10-lyra/{beat-01..N}.json
│   │       ├── stage11-speech/{beat-01..N}.wav
│   │       └── stage12-final.mp4
│   ├── fixtures/
│   │   └── demo-hip-replacement/
│   │       ├── procedure-plan.pdf                   # synthetic phantom (synthetic-labeled)
│   │       ├── patient-card.json                    # 65yo, BMI 28, posterior approach
│   │       └── expected-deliverable.json            # asserted final card for e2e test
│   └── surgical-protocols-references.json           # curated PMIDs (Invariant 4 source)
├── scripts/
│   ├── prewarm_demo.py                              # seeds replay cache + Tavi cache + Seed availability probe
│   ├── demo_mode_switch.sh                          # flip DEMO_MODE atomically across services
│   ├── record_backup_video.sh                       # ★ run by 5 PM demo day → docs/demo-backup.mp4
│   ├── verify_audit_trail.py                        # validates every script claim cites plan §X or PMID
│   └── butterbase_provision.sh                      # MCP-driven schema provisioning (Phase 3)
├── tests/
│   ├── conftest.ts                                  # global env stub: DEMO_MODE=replay; in-memory Butterbase
│   ├── personas/
│   │   ├── test_atlas_director.ts                   # Director bounded by procedure-plan invariant
│   │   ├── test_mara_devils_advocate.ts             # 10 known-bad scripts → all flagged
│   │   └── test_lyra_vision_critic.ts               # below-threshold reject + 1-regen budget
│   ├── synthesis-worker/
│   │   ├── test_anatomy_graph.ts
│   │   ├── test_shot_list_zod.ts
│   │   ├── test_keyframe_anchoring.ts               # ★ Invariant 2 sub-rule grep
│   │   └── test_replay_branch.ts                    # ★ Invariant 3: every outbound call has replay
│   ├── ingestors/
│   │   └── test_procedure_plan_pdf.ts
│   ├── invariants/
│   │   ├── test_seed_pinning_grep.ts                # ★ Invariant 2 grep test
│   │   └── test_audit_completeness.ts               # ★ Invariant 4
│   └── e2e/
│       └── test_demo_smoke.ts                       # full 12-stage replay → MP4 + receipt PDF
├── docs/
│   ├── plans/
│   │   ├── 01-master-architecture.md                # ← this file
│   │   ├── 2026-04-28-seed-pivot.md                 # (parent monorepo reference)
│   │   └── 2026-05-02-winning-vertical-v7.md
│   ├── demo-runbook.md                              # 2-minute beat-by-beat
│   ├── demo-backup.mp4                              # ★ committed by 5 PM demo day
│   ├── audit-trail-sample.pdf                       # public sample export
│   ├── sponsor-feedback.md                          # candidate BytePlus issues
│   └── prompts/
│       ├── atlas-surgical-director.md
│       ├── mara-devils-advocate.md
│       └── lyra-vision-critic.md
└── infra/
    ├── do-app-platform/
    │   ├── app.yaml                                 # web + worker services
    │   └── env.template
    ├── do-spaces/
    │   └── bucket-policy.json                       # CDN; signed URL expiry
    └── butterbase/
        ├── schema.sql                               # canonical DDL (mirrored to MCP provision)
        ├── policies.sql                             # RLS (no-auth demo path; per-clinic later)
        └── seed.sql                                 # phantom-hip ForgeRun + replay metadata
```

**Don't pre-create empty folders.** Scaffold each phase as needed. The tree above is the *target*, not the starting state.

---

## 2. Build Sequence — 14 Steps

Source: CLAUDE.md "Sequential Dependencies" section. Each step lists deliverables, owner, complexity (S=≤2hr, M=2–6hr, L=≥6hr), and what unblocks downstream.

| # | Step | Owner | Cx | Deliverables (concrete) | Unblocks |
| ---: | --- | --- | :-: | --- | --- |
| **1** | `src/lib/seed/models.ts` | Atlas (solo) | S | `SEED_MODELS` const object with all six pinned IDs; freeze with `as const`; export `SeedModelKey` union | Steps 2, 7, 8, 10 |
| **2** | `src/lib/seed/ark.ts` + `replay.ts` + `keyRotation.ts` | Vision+Synthesis | M | `ArkClient.chat({model,messages,jsonSchema?})` (OpenAI-compat); `withReplay(stage,key,fn)` shim; key rotation w/ `pre:keyrot:*` Redis state; ALL three Seed wrappers in step 7/8/10 import these | Steps 3, 4, 5, 7, 8, 10 |
| **3** | `src/lib/forge/types.ts` (+ Zod schemas: `anatomyGraph.ts`, `shotList.ts`, `critique.ts`, `criticScore.ts`, `auditCitation.ts`) | Schema+Personas | M | `ForgeRun`, `AnatomyGraph`, `ShotList`, `Critique`, `CriticScore`, `AuditCitation` types + Zod parsers; `forge/types.ts` is the single import surface | Steps 4–14 |
| **4** | `personas/atlas-surgical.ts` (Director) | Schema+Personas | M | System prompt in `docs/prompts/atlas-surgical-director.md`; `Director.draft(plan, anatomy, research) → ShotList` using Seed 2.0 Pro JSON-mode via `ArkClient`; bounded by procedure-plan corpus | Stage 3 (orchestrator) |
| **5** | `personas/mara.ts` (Devil's Advocate) | Schema+Personas | M | System prompt in `docs/prompts/mara-devils-advocate.md`; few-shot 10 known-bad scripts; `Mara.critique(shotList) → Critique[]`; `block` severity = redraft signal | Stage 4 → Invariant 1 demo (Mara HUD pane) |
| **6** | `personas/gem.ts` + `ingestors/anatomyExtract.ts` | Schema+Personas | M | Gemini 1.5 Flash vision over plan diagrams → `AnatomyGraph` with confidence bands; `Gem.extract(planPdfBytes) → AnatomyGraph` | Stage 2c |
| **7** | `seedream.ts` + Tier-0 anchor logic | Vision+Synthesis | M | `Seedream.keyframe({prompt, refs, aspectRatio:"16:9"}) → PngBytes`; `Seedream.entityRefs(anatomyEntity) → PngBytes[1..3]`; ALL outputs are first-frame anchors | Stage 5, 7 → Stage 9 |
| **8** | `seedance.ts` + `compileSeedancePrompt.ts` | Vision+Synthesis | L | `compileSeedancePrompt(beat, anatomyBible, lensSuffix) → SeedancePayload` with **`image_refs.length >= 1` enforced** (throws if not); `Seedance.generate(payload) → Mp4Bytes`; `seedance-v2.0-extend` for beats > 5s; `MAX_CONCURRENT_LANES=3` semaphore in worker | Stage 8, 9 |
| **9** | `personas/lyra.ts` + `critic.ts` + `CriticHud.tsx` | Schema+Personas (lyra/critic) + Frontend (HUD) | L | Lyra: Seed 2.0 Pro Vision sampling 4 frames per beat → `CriticScore`; `critic.ts` decision: `min(scores) < 0.75 \|\| on_screen_text_violations > 0 → regen` (1 budget); HUD: live `criticTrace[]` from Butterbase + Redis | Stage 10 → Invariant 1 demo (Lyra HUD pane) |
| **10** | `speech.ts` | Vision+Synthesis | S | `Speech.synthesize({text, voice:"warm-authoritative"}) → WavBytes` 24kHz PCM; bounded-corpus check in narrator-line wrapper | Stage 11 |
| **11** | Remotion components (`ProcedureStepOverlay`, `AnatomicalLabel`, `ConfidenceBand`, `CitationFooter`) + `PreOpExplainer.tsx` composition + `remotion/Root.tsx` | Frontend+Demo | L | 1080p H.264 30fps composition; programmatic render via `src/lib/forge/render.ts` (`@remotion/renderer`); all overlays carry citation pointers | Stage 12 |
| **12** | `prewarm_demo.py` + replay fixtures (`data/replay/demo-hip-replacement/`) + `demo_mode_switch.sh` | Frontend+Demo (Demo Dev hat) | M | Python ops: live-call once → cache as JSON/MP4/WAV → checksum manifest; `demo_mode_switch.sh replay` flips env atomically | Hermetic demo (Invariant 3) |
| **13** | `apps/web` (Upload + HUD wired to `/api/forge` + SSE) + `apps/api` routes + Butterbase wiring | Frontend+Demo (web) + Butterbase Dev (API persistence) | L | `/forge` page shows live `AnatomyGraphViewer` + `CriticHud` keyed off real `pre:trace:*` events + Butterbase queries; `/api/forge` POST creates `forge_runs` row → worker picks up | Demo recording |
| **14** | Backup video (`scripts/record_backup_video.sh` → `docs/demo-backup.mp4` committed) | Frontend+Demo | S | OBS-driven 2-minute screen capture matching the locked script; pushed to repo by 5 PM demo day | Stage call (release blocker) |

**Parallelization policy:** Steps 1 → 3 are critical-path-serial. Once step 3 is done, **steps 4, 6, 7, 10 fan out in parallel** (different teammates, different files, no overlap). Step 8 waits on 7. Step 9 waits on 8. Step 11 waits on 9. Steps 12 + 13 wait on 11. Step 14 waits on everything.

**End-of-session deliverable check:** by end of this chat session, the team executes through **step 13** at minimum (scaffold runnable in `DEMO_MODE=replay`, HUD shows real Mara critiques + Lyra scores, MP4 renders end-to-end). Step 14 happens demo-day proper.

**Butterbase Dev** runs in parallel from step 3 onward — provisioning `forge_runs`, `critiques`, `critic_scores`, `audit_citations`, `procedure_plans`, `patient_demographics`, `replay_fixtures` (see §6) via MCP. Worker switches from in-memory state to Butterbase reads/writes once tables land (target: end of step 6).

---

## 3. Master Mermaid Diagram

```mermaid
flowchart TD
    %% ─── Patient input layer ────────────────────────────────────
    PT[Patient<br/>browser session]:::user
    UPLD[apps/web /forge<br/>PreOpUpload.tsx]:::ui
    PT -->|drag PDF + JSON card| UPLD

    %% ─── API ingest ─────────────────────────────────────────────
    UPLD -->|POST /api/forge<br/>multipart| API[apps/api<br/>/api/forge/route.ts]:::api
    API -->|insert forge_runs<br/>status=queued| BB[(Butterbase<br/>Postgres)]:::data
    API -->|202 + forge_run_id| UPLD

    %% ─── Worker pickup ──────────────────────────────────────────
    BB -.poll status=queued.-> WK[apps/synthesis-worker<br/>orchestrator.ts]:::worker

    %% ─── DEMO_MODE shim chokepoint ──────────────────────────────
    SHIM{{replay.ts<br/>DEMO_MODE=<br/>live\|replay\|hybrid}}:::shim
    WK -->|every outbound call| SHIM
    FX[(data/replay/<br/>{forge_run_id}/<br/>{stage}/...)]:::data
    SHIM <-.cache hit/miss.-> FX

    %% ─── 12-stage pipeline ──────────────────────────────────────
    WK --> S1[Stage 1<br/>Intake — Atlas<br/>Zod patient+procedure]:::stage
    S1 --> S2{Stage 2<br/>Research fan-out}:::stage
    S2 --> S2A[2a Tavi<br/>Tavily<br/>PMID-cited protocols]:::stage
    S2 --> S2B[2b Exa<br/>neural search<br/>visual refs]:::stage
    S2 --> S2C[2c Gem<br/>Gemini 1.5 Flash<br/>AnatomyGraph + confidence]:::stage
    S2 --> S2D[2d pdf-parse<br/>typed procedure plan]:::stage
    S2A & S2B & S2C & S2D --> S3[Stage 3<br/>Director — Atlas<br/>Seed 2.0 Pro<br/>→ ShotList Zod]:::stage

    %% ─── Critic Gate 1 — Mara ★ pre-render ──────────────────────
    S3 --> S4{{Stage 4 ★ CRITIC GATE 1<br/>Mara — Devil's Advocate<br/>Seed 2.0 Pro plan-only<br/>→ Critique block/warn/info}}:::critic
    S4 -- block severity --> S3
    S4 -- approved --> S5[Stage 5<br/>Anatomy Bible — Lyra<br/>Seedream 5.0 Lite refs]:::stage
    S5 --> S6[Stage 6<br/>Cinema Lens<br/>deterministic taxonomy]:::stage
    S6 --> S7[Stage 7<br/>Storyboard Keyframes — Lyra<br/>Seedream 5.0 Lite<br/>★ Tier-0 anchor]:::stage
    S7 --> S8[Stage 8<br/>Prompt Compiler — Atlas<br/>image_refs.length≥1 enforced]:::stage
    S8 --> S9[Stage 9<br/>Seedance Generation<br/>Seedance 2.0 I2V/T2V-with-ref<br/>≤MAX_CONCURRENT_LANES=3<br/>>5s → seedance-v2.0-extend]:::stage

    %% ─── Critic Gate 2 — Lyra ★ post-render ─────────────────────
    S9 --> S10{{Stage 10 ★ CRITIC GATE 2<br/>Lyra — Vision Critic<br/>Seed 2.0 Pro Vision<br/>4 frames/beat<br/>min<0.75 \|\| text>0 → regen}}:::critic
    S10 -- regen 1 budget --> S9
    S10 -- accepted --> S11[Stage 11a<br/>Narration — Atlas<br/>Seed Speech 2.0<br/>bounded to plan corpus]:::stage
    S11 -. opt-in .-> S11B[Stage 11b<br/>OmniHuman 1.5<br/>≤8s surgeon greeting]:::stage
    S11 & S11B --> S12[Stage 12<br/>Composition + Render — Lyra<br/>Remotion 1080p H.264 30fps<br/>ProcedureStepOverlay<br/>AnatomicalLabel<br/>ConfidenceBand<br/>CitationFooter]:::stage

    %% ─── Outputs ────────────────────────────────────────────────
    S12 --> CDN[(DigitalOcean Spaces<br/>signed CDN URL)]:::data
    S12 --> RECEIPT[/api/forge/{id}/receipt<br/>audit-trail PDF<br/>every claim cited]:::api
    CDN --> VIEW[Patient view<br/>apps/web /forge/{id}<br/>MP4 + DeliverableCard]:::ui
    RECEIPT --> VIEW

    %% ─── HUD live stream (Invariant 1 surface) ──────────────────
    S4 -.SSE pre:trace:*.- HUD[CriticHud.tsx<br/>Mara left + Lyra right<br/>★ on-camera 0:50–1:00]:::ui
    S10 -.SSE pre:trace:*.- HUD
    HUD --> VIEW

    %% ─── Butterbase persistence (substrate) ─────────────────────
    S1 -.persist.-> BB
    S3 -.persist.-> BB
    S4 -.persist critique.-> BB
    S10 -.persist score.-> BB
    S12 -.persist deliverable.-> BB

    %% ─── Butterbase tables (data plane SoT) ─────────────────────
    subgraph BUTTERBASE["Butterbase (Postgres) — source of truth for ForgeRun + critiques + audit"]
        direction LR
        T1[(forge_runs)]
        T2[(critiques<br/>Mara output)]
        T3[(critic_scores<br/>Lyra output)]
        T4[(audit_citations<br/>claim → source)]
        T5[(procedure_plans)]
        T6[(patient_demographics)]
        T7[(replay_fixtures<br/>cache manifest)]
    end
    BB --- BUTTERBASE

    %% ─── Redis (SSE-only after Butterbase pivot) ────────────────
    REDIS[(Redis Stream<br/>pre:trace:{forge_run_id}<br/>SSE only)]:::data
    WK -.publish events.-> REDIS
    REDIS -.SSE.-> HUD
    REDIS -.SSE.-> UPLD

    %% ─── Styling ────────────────────────────────────────────────
    classDef user fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef ui fill:#fff3e0,stroke:#e65100,stroke-width:1px
    classDef api fill:#f3e5f5,stroke:#6a1b9a,stroke-width:1px
    classDef worker fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    classDef stage fill:#fafafa,stroke:#616161,stroke-width:1px
    classDef critic fill:#ffebee,stroke:#c62828,stroke-width:3px,color:#000
    classDef shim fill:#fff8e1,stroke:#f57f17,stroke-width:2px,stroke-dasharray:4 4
    classDef data fill:#ede7f6,stroke:#4527a0,stroke-width:1px
```

**What the diagram makes legible to a judge:**

- The two critic gates are visually distinct (red, thick border) and both feed back into the pipeline (Mara → S3 redraft, Lyra → S9 regen).
- The DEMO_MODE shim is a single chokepoint between worker and every outbound call.
- Butterbase is the data substrate; Redis Stream is the SSE-only live channel.
- HUD is a direct consumer of the same SSE the worker writes — no animation theater.
- Audit trail + signed CDN URL are co-equal final outputs (Invariant 4).

---

## 4. Module Interface Contracts

Every cross-module boundary defined as a TypeScript signature. Teammates implement against these. **Do not change a signature without updating this document and approving the change at lead level.**

### 4.1 Seed wrappers (`src/lib/seed/*`)

```ts
// src/lib/seed/models.ts — ★ ONLY file with model-ID literals
export const SEED_MODELS = {
  director:      "seed-2.0-pro",
  vision_critic: "seed-2.0-pro",
  keyframes:     "seedream-5.0-lite",
  video:         "seedance-2.0",
  video_extend:  "seedance-v2.0-extend",
  speech:        "seed-speech-2.0",
  presenter:     "omnihuman-1.5",
} as const;
export type SeedModelKey = keyof typeof SEED_MODELS;

// src/lib/seed/ark.ts
export interface ArkChatRequest {
  model: typeof SEED_MODELS[Extract<SeedModelKey,"director"|"vision_critic">];
  messages: Array<{ role: "system"|"user"|"assistant"; content: string|MultimodalPart[] }>;
  jsonSchema?: object;        // strict-schema first
  jsonObject?: boolean;       // fallback path
  temperature?: number;
  maxTokens?: number;
}
export interface ArkChatResponse<T = unknown> {
  content: string;
  parsed?: T;                 // when jsonSchema or jsonObject set
  usage: { prompt: number; completion: number; cost_usd: number };
}
export interface ArkClient {
  chat<T = unknown>(req: ArkChatRequest): Promise<ArkChatResponse<T>>;
  vision<T = unknown>(req: ArkChatRequest & { images: ImageRef[] }): Promise<ArkChatResponse<T>>;
}

// src/lib/seed/seedance.ts
export interface SeedancePayload {
  model: typeof SEED_MODELS["video"] | typeof SEED_MODELS["video_extend"];
  prompt: string;
  image_refs: ImageRef[];     // ★ length >= 1 enforced — Invariant 2 sub-rule
  video_ref?: VideoFrameRef;  // last frame of previous beat
  duration_s: number;
  aspect_ratio: "16:9";
}
export interface SeedanceClient {
  generate(p: SeedancePayload): Promise<{ mp4: Buffer; duration_s: number; cost_usd: number }>;
  extend(prevRequestId: string, prompt: string, duration_s: number): Promise<{ mp4: Buffer; cost_usd: number }>;
}

// src/lib/seed/seedream.ts
export interface SeedreamClient {
  keyframe(req: { prompt: string; refs?: ImageRef[]; aspectRatio: "16:9" }): Promise<{ png: Buffer; cost_usd: number }>;
  entityRefs(req: { entity: AnatomyEntity; count: 1|2|3 }): Promise<{ pngs: Buffer[]; cost_usd: number }>;
}

// src/lib/seed/speech.ts
export interface SpeechClient {
  synthesize(req: { text: string; voice: "warm-authoritative"|"warm-female"|"warm-male"|"neutral"|"soft" }): Promise<{ wav: Buffer; sampleRate: 24000; cost_usd: number }>;
}

// src/lib/seed/omnihuman.ts
export interface OmniHumanClient {
  generate(req: { stillImage: Buffer; voiceWav: Buffer; maxDurationS: 8 }): Promise<{ mp4: Buffer; uncannyScore: number; cost_usd: number }>;
}
```

### 4.2 Forge core (`src/lib/forge/*`)

```ts
// src/lib/forge/types.ts (shape excerpt)
export interface ForgeRun {
  id: string;
  status: "queued"|"running"|"succeeded"|"failed";
  stage: 1|2|3|4|5|6|7|8|9|10|11|12;
  procedurePlan: ProcedurePlan;
  patient: PatientDemographics;
  research: { tavi: TaviResult; exa: ExaResult; gem: AnatomyGraph; pdf: ParsedPlan };
  shotList: ShotList;
  critiques: Critique[];          // Mara
  criticScores: CriticScore[];    // Lyra
  deliverable: { mp4Url: string; receiptUrl: string; durationS: number; regenCount: number; costUsd: number; criticTrace: CriticScore[]; citations: AuditCitation[] };
  createdAt: string; updatedAt: string;
}

// src/lib/forge/personas/atlas-surgical.ts
export interface Director {
  draft(input: { plan: ProcedurePlan; patient: PatientDemographics; anatomy: AnatomyGraph; research: { tavi: TaviResult; exa: ExaResult } }): Promise<ShotList>;
  redraft(input: { previous: ShotList; critiques: Critique[] }): Promise<ShotList>;
}

// src/lib/forge/personas/mara.ts ★ Critic 1
export interface DevilsAdvocate {
  critique(shotList: ShotList): Promise<Critique[]>;  // 1-round cap enforced by orchestrator
}

// src/lib/forge/personas/lyra.ts ★ Critic 2
export interface VisionCritic {
  score(input: { beat: ShotListBeat; mp4: Buffer; anatomy: AnatomyGraph }): Promise<CriticScore>;
}

// src/lib/forge/personas/gem.ts
export interface AnatomyExtractor {
  extract(planPdf: Buffer): Promise<AnatomyGraph>;
}

// src/lib/forge/critic.ts
export function runCriticLoop(
  beat: ShotListBeat,
  generate: (feedback?: string) => Promise<Buffer>,
  score: (mp4: Buffer) => Promise<CriticScore>,
  opts?: { threshold?: number; maxRegen?: number }
): Promise<{ mp4: Buffer; finalScore: CriticScore; regens: number }>;

// src/lib/forge/compileSeedancePrompt.ts
export function compileSeedancePrompt(args: {
  beat: ShotListBeat;
  bibleEntityRefs: ImageRef[];
  keyframe: ImageRef;            // ★ MUST be present — throws if absent
  prevLastFrame?: VideoFrameRef;
  lensSuffix: string;
}): SeedancePayload;             // image_refs.length >= 1 invariant satisfied here

// src/lib/forge/replay.ts ★ DEMO_MODE chokepoint — see §5
export function withReplay<T>(stage: StageId, key: ReplayKey, liveCallFn: () => Promise<T>): Promise<T>;

// src/lib/forge/butterbase.ts
export interface ButterbaseClient {
  persistForgeRun(run: ForgeRun): Promise<{ row_id: string }>;
  updateForgeRunStage(id: string, stage: number, patch: Partial<ForgeRun>): Promise<void>;
  insertCritique(forgeRunId: string, c: Critique): Promise<{ row_id: string }>;
  insertCriticScore(forgeRunId: string, s: CriticScore): Promise<{ row_id: string }>;
  insertAuditCitation(forgeRunId: string, c: AuditCitation): Promise<{ row_id: string }>;
  loadForgeRun(id: string): Promise<ForgeRun | null>;
  loadCritiques(forgeRunId: string): Promise<Critique[]>;
  loadCriticScores(forgeRunId: string): Promise<CriticScore[]>;
  loadAuditCitations(forgeRunId: string): Promise<AuditCitation[]>;
  upsertReplayFixture(forgeRunId: string, stage: StageId, key: ReplayKey, blobRef: string): Promise<void>;
  loadReplayFixture(forgeRunId: string, stage: StageId, key: ReplayKey): Promise<{ blobRef: string } | null>;
}

// src/lib/forge/keyRotation.ts
export interface KeyRotator {
  next(provider: "ark"|"seedance"|"tavily"|"exa"|"gemini"): string;
  markFailure(provider: string, key: string, reason: "429"|"5xx"|"401"|"403"|"quota"): void;
}

// src/lib/forge/auditPdf.ts
export function buildAuditTrailPdf(run: ForgeRun, citations: AuditCitation[]): Promise<Buffer>;
```

### 4.3 Worker orchestrator (`apps/synthesis-worker/src/orchestrator.ts`)

```ts
export interface Orchestrator {
  run(forgeRunId: string): Promise<ForgeRun>;        // executes stages 1..12 with critic gates
  resume(forgeRunId: string, fromStage: number): Promise<ForgeRun>;
}
// Each stages/stageNN-*.ts exports:
export interface Stage<In, Out> {
  id: number;
  name: string;
  run(forgeRunId: string, input: In): Promise<Out>;  // calls withReplay() + persists via ButterbaseClient + emits trace event
}
```

### 4.4 API surface (`apps/api/src/app/api/*`)

```ts
// POST /api/forge
type CreateForgeReq = { procedurePlanPdf: File; patientCard: File }; // multipart
type CreateForgeRes = { forge_run_id: string; status: "queued" };

// GET /api/forge/{id}
type GetForgeRes = { id: string; status: ForgeRun["status"]; stage: number; cost_usd: number; updatedAt: string };

// GET /api/forge/{id}/stream — text/event-stream of TraceEvent
type TraceEvent = { ts: string; stage: number; persona: PersonaName; message: string; duration_ms?: number; payload?: unknown };

// GET /api/forge/{id}/critique → Critique[]
// GET /api/forge/{id}/critic   → CriticScore[]
// GET /api/forge/{id}/receipt  → application/pdf (audit-trail PDF)
// GET /api/forge/{id}/explainer.mp4 → 302 to signed Spaces URL
// POST /api/forge/{id}/regen?beat=N → { ok: true, regen_count: number }
```

### 4.5 Frontend HUD components (`src/components/*`)

```ts
// CriticHud.tsx
interface CriticHudProps { forgeRunId: string; }
// Subscribes to GET /api/forge/{id}/stream; renders Mara critiques (left pane) and Lyra scores (right pane);
// freezes mid-update if SSE stops (no animation theater).

// AnatomyGraphViewer.tsx
interface AnatomyGraphViewerProps { forgeRunId: string; }
// Subscribes; draws growing JSON tree as Stage 2c emits entities + confidence bands.

// PreOpUpload.tsx
interface PreOpUploadProps { onCreated: (forgeRunId: string) => void; }
```

---

## 5. `DEMO_MODE` Replay Contract — `src/lib/forge/replay.ts`

The replay shim is the single most important piece of infra for hermetic demo-day (Invariant 3). **Every outbound call from the worker — Seed, Tavily, Exa, Gemini, OmniHuman — must call through it.** A grep test asserts this (§7).

### 5.1 Public API

```ts
// src/lib/forge/replay.ts
export type DemoMode = "live" | "replay" | "hybrid";
export type StageId =
  | "stage01-intake" | "stage02-tavi" | "stage02-exa" | "stage02-gem" | "stage02-pdf"
  | "stage03-director" | "stage04-mara" | "stage05-bible" | "stage07-keyframe"
  | "stage09-seedance" | "stage10-lyra" | "stage11-speech" | "stage11b-omnihuman";

export type ReplayKey = string;  // sha256 hex; see §5.4

export interface ReplayCtx {
  forgeRunId: string;
  mode: DemoMode;                          // from process.env.DEMO_MODE
  budgetMs?: number;                       // hybrid: from HYBRID_LIVE_BUDGET_S
}

export function withReplay<T>(
  stage: StageId,
  key: ReplayKey,
  liveCallFn: () => Promise<T>,
  ctx?: Partial<ReplayCtx>                 // optional override; default reads ALS-bound run id
): Promise<T>;
```

### 5.2 Behavior matrix

| `DEMO_MODE` | Cache hit | Cache miss |
| --- | --- | --- |
| `live`   | call `liveCallFn()`; **also write fixture** (idempotent) | call `liveCallFn()`; write fixture |
| `replay` | return cached fixture | **throw** `ReplayMissError` (loud failure → demo-prep bug) |
| `hybrid` | return cached fixture | run `liveCallFn()` with `budgetMs` timeout → on timeout/quota/network error, **retry from cache** (must exist) or rethrow |

**Hard rule:** `replay` mode never makes a network call. Period. Tested in `tests/synthesis-worker/test_replay_branch.ts`.

### 5.3 Cache directory layout

```text
data/replay/{forge_run_id}/
├── manifest.json                    # checksums + key map
├── stage01-intake/{key}.json
├── stage02-tavi/{key}.json
├── stage02-exa/{key}.json
├── stage02-gem/{key}.json
├── stage02-pdf/{key}.json
├── stage03-director/{key}.json
├── stage04-mara/{key}.json
├── stage05-bible/
│   ├── {key}.json                   # entity bible
│   └── refs/{key}-{idx}.png
├── stage07-keyframe/{beat-{n}-{key}}.png
├── stage09-seedance/{beat-{n}-{key}}.mp4
├── stage10-lyra/{beat-{n}-{key}}.json
├── stage11-speech/{beat-{n}-{key}}.wav
└── stage11b-omnihuman/{key}.mp4
```

`manifest.json` shape:

```json
{
  "forge_run_id": "demo-hip-replacement",
  "created_at": "2026-05-01T21:00:00Z",
  "stages": {
    "stage03-director": { "<key>": { "path": "stage03-director/<key>.json", "sha256": "...", "bytes": 4321 } }
  }
}
```

### 5.4 Hash-based key generation

```ts
function makeReplayKey(input: unknown): ReplayKey {
  const canonical = JSON.stringify(sortKeys(input));   // stable across runs
  return sha256(canonical).slice(0, 32);                // 32 hex chars
}
```

The **input** to `makeReplayKey` is whatever uniquely identifies the call: model id + messages for Seed; prompt + refs digest for Seedance; query for Tavily; etc. Each Seed wrapper computes its own key from the request payload. Wrappers must be deterministic — no timestamps, no `Math.random()`.

### 5.5 Fallback (hybrid mode)

```ts
async function withReplay(stage, key, liveCallFn, ctx) {
  const mode = ctx?.mode ?? (process.env.DEMO_MODE as DemoMode);
  const cached = await loadFromDisk(ctx.forgeRunId, stage, key);

  if (mode === "replay") {
    if (cached) return deserialize<T>(cached);
    throw new ReplayMissError({ stage, key, forgeRunId: ctx.forgeRunId });
  }

  if (mode === "hybrid" && cached) return deserialize<T>(cached);

  // live or hybrid-no-cache
  try {
    const t = mode === "hybrid" ? withTimeout(liveCallFn(), ctx.budgetMs ?? 8000) : liveCallFn();
    const result = await t;
    await writeToDisk(ctx.forgeRunId, stage, key, result);  // cache-on-write
    await butterbase.upsertReplayFixture(ctx.forgeRunId, stage, key, blobPath);
    return result;
  } catch (err) {
    if (mode === "hybrid" && cached) return deserialize<T>(cached);
    throw err;
  }
}
```

`ReplayMissError` is a distinct error type that the worker logs at FATAL with the missing `(stage,key)` pair and the surrounding ForgeRun context. Demo-prep script exits non-zero if any miss is logged.

### 5.6 Population by `prewarm_demo.py`

```python
# scripts/prewarm_demo.py (high-level)
1. Load fixtures/demo-hip-replacement/{procedure-plan.pdf, patient-card.json}.
2. POST /api/forge with DEMO_MODE=live; capture forge_run_id="demo-hip-replacement" (overridable via --id).
3. Wait for status=succeeded (poll GET /api/forge/{id}); fail loudly if any stage > 60s.
4. Walk data/replay/{id}/ — verify manifest.json checksums match disk.
5. Run a second pass with DEMO_MODE=replay against the SAME fixtures; assert byte-identical MP4 (sha256).
6. Probe Seed availability (HEAD ARK_BASE_URL) for the day-of `live` health check; report status.
7. Optionally seed 2 backup cases (cmd-line: --backup hip-anterior, --backup knee-meniscus).
8. Write data/replay/{id}/manifest.json final + commit (NOT MP4s; .gitignore covers blobs but commit JSON manifests + checksums).
```

`./scripts/demo_mode_switch.sh replay` writes `DEMO_MODE=replay` to `apps/web/.env.local` AND `apps/synthesis-worker/.env` AND restarts both processes via PM2 (or `kill -USR2`). Atomic flip.

---

## 6. Butterbase Data Model (Postgres)

Butterbase is the source of truth for `ForgeRun`, critiques, scores, audit graph, and replay-fixture metadata. Redis stays only for the SSE Stream (`pre:trace:{forge_run_id}`). Provisioned via Butterbase MCP in Phase 3 by **Butterbase Dev**; SQL mirrored to `infra/butterbase/schema.sql` for repo-checked SoT.

### 6.1 Tables

```sql
-- forge_runs
CREATE TABLE forge_runs (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  status          text          NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  stage           smallint      NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 12),
  procedure_plan_id uuid        REFERENCES procedure_plans(id),
  patient_id      uuid          REFERENCES patient_demographics(id),
  shot_list       jsonb,        -- ShotList Zod
  research        jsonb,        -- {tavi, exa, gem, pdf}
  deliverable     jsonb,        -- {mp4Url, receiptUrl, durationS, regenCount, costUsd, criticTrace}
  cost_usd        numeric(10,4) NOT NULL DEFAULT 0,
  duration_ms     integer       NOT NULL DEFAULT 0,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  error           text
);
CREATE INDEX forge_runs_status_idx ON forge_runs(status) WHERE status IN ('queued','running');
CREATE INDEX forge_runs_created_at_idx ON forge_runs(created_at DESC);

-- procedure_plans
CREATE TABLE procedure_plans (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  pdf_blob_ref    text          NOT NULL,    -- DO Spaces key
  parsed          jsonb         NOT NULL,    -- typed plan from pdf-parse
  sha256          text          NOT NULL UNIQUE,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- patient_demographics  (synthetic phantom only on demo path)
CREATE TABLE patient_demographics (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  card            jsonb         NOT NULL,    -- {age, sex, bmi, comorbidities[], ...}
  is_synthetic    boolean       NOT NULL DEFAULT true,   -- HIPAA gate
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- critiques  (Mara, Stage 4)
CREATE TABLE critiques (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id    uuid          NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  shot_id         text          NOT NULL,
  severity        text          NOT NULL CHECK (severity IN ('block','warn','info')),
  category        text          NOT NULL CHECK (category IN ('advice_creep','uncited_claim','ambiguity','scope_creep','anatomical_invention')),
  excerpt         text          NOT NULL CHECK (length(excerpt) <= 200),
  reason          text          NOT NULL CHECK (length(reason) <= 200),
  suggested_revision text,
  round_no        smallint      NOT NULL DEFAULT 1 CHECK (round_no = 1),  -- hard cap
  created_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX critiques_forge_run_idx ON critiques(forge_run_id);

-- critic_scores  (Lyra, Stage 10)
CREATE TABLE critic_scores (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id    uuid          NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  beat_id         text          NOT NULL,
  attempt         smallint      NOT NULL DEFAULT 1 CHECK (attempt IN (1,2)),  -- 1-regen budget
  anatomical_fidelity        numeric(4,3) NOT NULL CHECK (anatomical_fidelity BETWEEN 0 AND 1),
  procedure_step_compliance  numeric(4,3) NOT NULL CHECK (procedure_step_compliance BETWEEN 0 AND 1),
  on_screen_text_violations  integer      NOT NULL CHECK (on_screen_text_violations >= 0),
  feedback        text          NOT NULL CHECK (length(feedback) <= 120),
  accepted        boolean       NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX critic_scores_beat_attempt_idx ON critic_scores(forge_run_id, beat_id, attempt);

-- audit_citations  (Invariant 4 — every claim ↔ source)
CREATE TABLE audit_citations (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id    uuid          NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  beat_id         text          NOT NULL,
  claim_text      text          NOT NULL,
  source_type     text          NOT NULL CHECK (source_type IN ('procedure_plan','pmid','curated_ref')),
  source_pointer  text          NOT NULL,    -- e.g. "§2.3" | "PMID:31234567" | "curated:hip-posterior-001"
  created_at      timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX audit_citations_forge_run_idx ON audit_citations(forge_run_id);

-- replay_fixtures  (cache manifest mirror — disk is SoT for blobs; this table indexes them)
CREATE TABLE replay_fixtures (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id    text          NOT NULL,    -- can be label like "demo-hip-replacement"
  stage_id        text          NOT NULL,
  cache_key       text          NOT NULL,    -- 32-hex
  blob_ref        text          NOT NULL,    -- relative path under data/replay/
  sha256          text          NOT NULL,
  bytes           integer       NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (forge_run_id, stage_id, cache_key)
);
```

### 6.2 RLS policies (intent)

- **Demo path:** RLS disabled / permissive (`USING (true)`) — no auth, single-tenant, hackathon scope.
- **Per-clinic later:** add `tenant_id uuid` to all tables, JWT claim `clinic_id`, policy `USING (tenant_id = (auth.jwt() ->> 'clinic_id')::uuid)`. Out of scope for May 2.

`infra/butterbase/policies.sql` ships with the demo-path permissive policies and a commented per-clinic block ready to uncomment post-demo.

### 6.3 What replaces the old Redis keyspace

| Old Redis key (CLAUDE.md) | New home |
| --- | --- |
| `pre:run:{id}` | `forge_runs` row |
| `pre:trace:{id}` | **Stays in Redis Stream** (SSE only) |
| `pre:replay:{id}` | `replay_fixtures` table + `data/replay/{id}/` blobs |
| `pre:critique:{id}` | `critiques` table |
| `pre:critic:{id}` | `critic_scores` table |
| `pre:audit:{id}` | `audit_citations` table |
| `pre:cache:tavi` | `data/grounding-cache/` (file-backed, deterministic) |
| `pre:cache:lens` | static taxonomy in `src/lib/forge/lens/taxonomy.ts` |
| `pre:keyrot:{provider}` | **Stays in Redis** (cross-process state) |

---

## 7. The Four Invariants — Operational Form

Each invariant has: (a) a per-PR review checklist, (b) an automated check in `npm run check:invariants`, (c) a test that asserts it, (d) a judge-visible artifact.

### 7.1 Invariant 1 — Critic Loop Is Mandatory ★

| Aspect | Concrete check |
| --- | --- |
| **Per-PR checklist** | "Does this PR add a stage producing user-visible output? → wire to Lyra (Stage 10)." / "Does this PR add a persona drafting user-visible language? → wire to Mara (Stage 4)." Reviewer must answer yes/no in PR body under `## Invariant Compliance`. |
| **Script** | `npm test -- personas/test_mara_devils_advocate.ts personas/test_lyra_vision_critic.ts` (assertions: 10 known-bad scripts → all flagged by Mara `block`; below-threshold beat → Lyra rejects + 1-regen exits cleanly). |
| **Test (file)** | `tests/personas/test_mara_devils_advocate.ts`, `tests/personas/test_lyra_vision_critic.ts`. |
| **Judge sees** | `CriticHud.tsx` on screen 0:50–1:00 — Mara's flagged shot (left), Lyra's failing scores + regen (right). HUD is keyed off real Butterbase rows + Redis SSE — pause the worker and the HUD freezes. |

### 7.2 Invariant 2 — Seed Stack Pinning + Tier-0 Anchoring

| Aspect | Concrete check |
| --- | --- |
| **Per-PR checklist** | "Does this PR add a Seed call? → import model id from `src/lib/seed/models.ts`." / "Is it a Seedance call? → must pass `image_refs.length>=1` (use `compileSeedancePrompt`)." |
| **Script (grep)** | `grep -rn "seedance-2\|seedream-5\|seed-2\.0\|seed-speech\|omnihuman-1" src/ apps/ --include="*.ts" --include="*.tsx" \| grep -v "src/lib/seed/models.ts"`  — must be empty. Wired into `npm run check:invariants` and a `.claude/hooks/pre-edit-block-model-ids.sh` PreToolUse hook. |
| **Test (file)** | `tests/invariants/test_seed_pinning_grep.ts` (calls grep + asserts empty); `tests/synthesis-worker/test_keyframe_anchoring.ts` (every Seedance payload built by `compileSeedancePrompt` has `image_refs.length>=1`; constructor throws when violated). |
| **Judge sees** | "Same engine, multiple verticals" architecture mermaid (1:10–1:30) with Seed lineup explicitly labeled. |

### 7.3 Invariant 3 — Hermetic `DEMO_MODE` Replay

| Aspect | Concrete check |
| --- | --- |
| **Per-PR checklist** | "Does this PR add an outbound network call? → wrap in `withReplay(stage,key,liveCall)`. → add a fixture under `data/replay/demo-hip-replacement/{stage}/`. → add to `prewarm_demo.py`." |
| **Script** | `npm test -- synthesis-worker/test_replay_branch.ts` (AST/grep test — every `*Client` method invocation across `src/lib/seed/*.ts`, `src/lib/forge/{tavily,exa}.ts`, `src/lib/forge/ingestors/anatomyExtract.ts` is reachable only via `withReplay(...)`). |
| **Test (file)** | `tests/synthesis-worker/test_replay_branch.ts`; `tests/e2e/test_demo_smoke.ts` runs the full pipeline with `DEMO_MODE=replay` and asserts zero network egress (mock `globalThis.fetch` to throw if called). |
| **Judge sees** | Indirect: the demo runs without internet (we can pull the wifi cable mid-pitch — that's the trust signal). Health probe at `/api/healthz` shows `mode: replay`. |

### 7.4 Invariant 4 — Audit Trail Is The Product

| Aspect | Concrete check |
| --- | --- |
| **Per-PR checklist** | "Does this PR produce on-screen text? → every claim has a `source_type + source_pointer` in `audit_citations`." / "Does this PR touch citation schema or audit PDF? → review by `audit-trail-reviewer` subagent." |
| **Script** | `python scripts/verify_audit_trail.py data/replay/demo-hip-replacement/` walks the Stage-3 ShotList narrator lines, the Stage-12 Remotion overlays, and asserts each claim has a row in `audit_citations`. Wired into `npm run check:invariants`. |
| **Test (file)** | `tests/invariants/test_audit_completeness.ts` (in-memory: every `narrator_line` token-spans against `audit_citations` rows). |
| **Judge sees** | `/api/forge/{id}/receipt` PDF preview at 1:00–1:10. Every overlay on the explainer MP4 has a tiny citation footer (`§2.3`, `PMID:31234567`). |

### 7.5 The combined `npm run check:invariants` script

```bash
# package.json scripts entry
"check:invariants": "npm run check:inv2 && npm run check:inv3 && npm run check:inv4 && npm run check:inv1",
"check:inv1": "vitest run tests/personas/test_mara_devils_advocate.ts tests/personas/test_lyra_vision_critic.ts",
"check:inv2": "node scripts/check_seed_pinning.mjs && vitest run tests/synthesis-worker/test_keyframe_anchoring.ts",
"check:inv3": "vitest run tests/synthesis-worker/test_replay_branch.ts tests/e2e/test_demo_smoke.ts",
"check:inv4": "python scripts/verify_audit_trail.py data/replay/demo-hip-replacement/ && vitest run tests/invariants/test_audit_completeness.ts"
```

CI fails fast if any of the four bails. Demo-day stage checklist runs `npm run check:invariants` at T-30.

---

## 8. Sponsor Integration Depth

For each sponsor: API surface, replay fixtures cached, on-stage visibility. **Butterbase replaces the Redis-only data plane** — it is now the source of truth for ForgeRun, critiques, scores, and the audit graph; Redis stays only for SSE trace streams.

### 8.1 Seed 2.0 Pro / Lite (BytePlus ModelArk) — DEEP

| | |
| --- | --- |
| API surface | `POST {ARK_BASE_URL}/chat/completions` (OpenAI-compat). JSON-mode + strict schema first; `json_object` + Zod safeParse fallback. Multimodal vision endpoint same surface with `image_url` parts. |
| Used by | Atlas (Director, Stage 3), Mara (Devil's Advocate, Stage 4), Lyra (Vision Critic, Stage 10) — three personas, one model, three system prompts. |
| Replay fixtures | `data/replay/demo-hip-replacement/stage03-director/{key}.json`, `stage04-mara/{key}.json`, `stage10-lyra/beat-{n}-{key}.json`. |
| Visible on stage | HUD persona badges (Atlas/Mara/Lyra status pills); Mara's critique sidebar; Lyra's per-beat scores. |

### 8.2 Seedream 5.0 Lite — DEEP (Tier-0 anchor, gates every Seedance call)

| | |
| --- | --- |
| API surface | `POST {ARK_BASE_URL}/images/generations` with `model: seedream-5.0-lite`, `aspect_ratio: 16:9`, optional ref images. |
| Used by | Stage 5 (anatomy bible 1–3 refs per entity), Stage 7 (per-beat keyframes). |
| Replay fixtures | `stage05-bible/refs/*.png`, `stage07-keyframe/*.png`. |
| Visible on stage | Storyboard montage in the rendered MP4; keyframes underlying every Seedance clip — "no naked T2V" is the Invariant 2 sub-rule. |

### 8.3 Seedance 2.0 — DEEP (judged-output surface)

| | |
| --- | --- |
| API surface | `POST {SEEDANCE_BASE_URL}/video/generations` with `model: seedance-2.0` (or `seedance-v2.0-extend` for >5s); always with `image_refs[]` (length ≥ 1). |
| Used by | Stage 9, parallel ≤3 lanes. |
| Replay fixtures | `stage09-seedance/beat-{n}-{key}.mp4` (committed checksums; blobs gitignored). |
| Visible on stage | Pre-rendered 22-second hip-replacement walkthrough (0:28–0:50) + Lyra's reject/regen (0:50–1:00). |

### 8.4 Seed Speech 2.0 — DEEP

| | |
| --- | --- |
| API surface | `POST {ARK_BASE_URL}/audio/speech` with `model: seed-speech-2.0`, `voice: warm-authoritative`, format PCM 24kHz. |
| Used by | Stage 11a narration; Stage 11b feeds OmniHuman. |
| Replay fixtures | `stage11-speech/beat-{n}-{key}.wav`. |
| Visible on stage | Calm clinician narration over the explainer MP4. |

### 8.5 OmniHuman 1.5 — OPTIONAL (Layer 2)

| | |
| --- | --- |
| API surface | `POST {ARK_BASE_URL}/video/lipsync` with still + audio. |
| Used by | Stage 11b (≤8s opening surgeon greeting). |
| Replay fixtures | `stage11b-omnihuman/{key}.mp4`. |
| Visible on stage | If Phase-0.6 verification passes, opening shot of explainer; otherwise cut to title card (trust signal > novel signal). |

### 8.6 Tavily — DEEP

| | |
| --- | --- |
| API surface | `POST https://api.tavily.com/search` for peer-reviewed surgical protocols; PMID-cited results. |
| Used by | Stage 2a (Tavi persona), behind `withReplay`. |
| Replay fixtures | `stage02-tavi/{key}.json`; persistent grounding cache in `data/grounding-cache/*.json`. |
| Visible on stage | Citation footer on every overlay (`PMID:...`); audit-trail PDF lists each. |

### 8.7 Exa — DEEP

| | |
| --- | --- |
| API surface | `POST https://api.exa.ai/search` for similar-procedure visual references. |
| Used by | Stage 2b (Exa persona); drives Seedream style suffix. |
| Replay fixtures | `stage02-exa/{key}.json`. |
| Visible on stage | Indirect — informs Seedream keyframe quality. |

### 8.8 Google Gemini 1.5 Flash — NARROW (vision-only, non-judged path)

| | |
| --- | --- |
| API surface | `gemini.generateContent({ model: "gemini-1.5-flash", contents: [pdf, prompt] })`. |
| Used by | Stage 2c (Gem persona) — anatomical landmark extraction with confidence bands. |
| Replay fixtures | `stage02-gem/{key}.json`. |
| Visible on stage | `AnatomyGraphViewer.tsx` — JSON tree growing live (0:18–0:28). |
| **Constraint** | NEVER used for narration. Wrapped behind `USE_LEGACY_PROVIDERS` kill-switch. |

### 8.9 Butterbase — DEEP (data plane SoT)

| | |
| --- | --- |
| API surface | Postgres via Butterbase MCP for provisioning + supabase-js (or `pg`) at runtime. Tables: `forge_runs`, `critiques`, `critic_scores`, `audit_citations`, `procedure_plans`, `patient_demographics`, `replay_fixtures`. |
| Used by | API routes (ingest), worker (every stage persists), HUD (reads), audit-PDF builder. |
| Replay fixtures | N/A — Butterbase itself is hermetic locally (Postgres image in compose for dev; MCP-provisioned cloud for demo). |
| Visible on stage | "Audit-trail PDF" beat (1:00–1:10) — the receipt is built directly from `audit_citations`. The mermaid diagram (1:10–1:30) explicitly shows `(forge_runs, critiques, critic_scores, audit_citations)` as the substrate. |

### 8.10 Remotion — DEEP

| | |
| --- | --- |
| API surface | `@remotion/renderer.renderMedia({ composition: "PreOpExplainer", inputProps: ForgeRun, codec: "h264", crf: 18 })`. |
| Used by | Stage 12 (programmatic from worker). |
| Replay fixtures | `stage12-final.mp4` (golden file; `tests/e2e` asserts byte-identical sha256 across replay runs). |
| Visible on stage | The explainer MP4 itself (0:28–0:50). |

### 8.11 DigitalOcean — OPS

| | |
| --- | --- |
| API surface | Spaces (S3-compat) for MP4 + audit PDF + signed URLs; App Platform `app.yaml` for web + worker services. |
| Used by | `src/lib/forge/render.ts` writes MP4 to `DO_SPACES_BUCKET`; `auditPdf.ts` writes PDF; `/api/forge/{id}/explainer.mp4` returns 302 to signed URL. |
| Replay fixtures | None (storage is post-render, demo plays from local file). |
| Visible on stage | Implicit — the URL the patient watches. |

---

## 9. The 5-Day Timeline

| Day | Date | Owner(s) | Deliverable | Demo-readiness check |
| ---: | --- | --- | --- | --- |
| **1** | 2026-04-28 | Atlas + Schema+Personas | Steps 1–3: `seed/models.ts`, `seed/ark.ts`, `forge/replay.ts`, `forge/keyRotation.ts`, `forge/types.ts` + Zod schemas. Butterbase provisioned (skeleton tables). | `npm run typecheck` green; `npm run check:inv2` green (grep test). |
| **2** | 2026-04-29 | Schema+Personas | Steps 4–6: Atlas Director, Mara persona (10 known-bad fixtures), Gem + anatomyExtract; `personas/atlas-surgical.ts`, `personas/mara.ts`, `personas/gem.ts`. Stage 1–4 wired in worker. | `tests/personas/*` green; Stage 4 emits real Critique to `critiques` table; HUD wireframe shows Mara's pane. |
| **2** | 2026-04-29 | Schema+Personas | `tavi.ts` + grounding cache; curated `surgical-protocols-references.json`. | Stage 2a returns deterministic results in `replay`. |
| **3** | 2026-04-30 | Vision+Synthesis | Steps 7–8: `seedream.ts`, `seedance.ts`, `compileSeedancePrompt.ts`; Stage 5–9 wired. Tier-0 anchor enforced. | `tests/synthesis-worker/test_keyframe_anchoring.ts` green; first end-to-end MP4 (no critic yet). |
| **3** | 2026-04-30 | Frontend+Demo | `apps/web` upload page + `/api/forge` POST + SSE plumbing; `AnatomyGraphViewer.tsx` live tree. | Drag PDF → forge_run_id returned → live JSON tree paints. |
| **4** | 2026-05-01 | Schema+Personas + Frontend | Step 9: `personas/lyra.ts` + `critic.ts` + `CriticHud.tsx`. Stage 10 reject/regen integrated. | `tests/personas/test_lyra_vision_critic.ts` green; HUD shows reject/regen sequence on a synthetic below-threshold beat. |
| **4** | 2026-05-01 | Vision+Synthesis | Step 10: `speech.ts` + bounded-corpus check. Stage 11 wired. | Narrator audio attached to MP4 via Remotion. |
| **4** | 2026-05-01 | Frontend+Demo | Step 11: Remotion components (`ProcedureStepOverlay`, `AnatomicalLabel`, `ConfidenceBand`, `CitationFooter`) + composition. | `npx remotion render` produces a 1080p H.264 MP4 with overlays. |
| **4** | 2026-05-01 | Atlas + Mara | Audit-trail PDF generator + `/api/forge/{id}/receipt`. | `npm run check:inv4` green. |
| **4 (eve)** | 2026-05-01 21:00 | Frontend+Demo | Step 12: `prewarm_demo.py` populates `data/replay/demo-hip-replacement/` (live → cache → replay verify). | Two-pass verify; manifest sha256s match. |
| **5** | 2026-05-02 (AM) | All hands | Step 13 polish: HUD final styling, persona badges, deliverable card, demo-runbook walkthrough. | Two `replay` dry runs + one `hybrid` dry run end-to-end < 90s wall-clock. |
| **5** | 2026-05-02 17:00 | Frontend+Demo | **Step 14:** `./scripts/record_backup_video.sh` → `docs/demo-backup.mp4`; PR + merge to `main`. | Backup video committed; PR merged; CI green. |
| **5** | 2026-05-02 (stage call) | Atlas | Push to `https://github.com/nihalnihalani/preopreel`; T-30 stage checklist run; `demo_mode_switch.sh replay`. | All four invariants green; HUD pre-staged; backup MP4 open in OS preview. |

**Hard gates:**

- **End of Day 1:** `npm run typecheck && npm run check:inv2` — go/no-go on Seed pinning.
- **End of Day 2:** Mara catches all 10 known-bad scripts. If <10/10, stop and root-cause.
- **End of Day 3:** Tier-0 anchor test green. If naked T2V detected anywhere, stop and refactor.
- **End of Day 4:** End-to-end replay produces an MP4 + audit PDF. If not, **cut OmniHuman 11b** (it's Layer 2) before considering anything else.
- **5 PM Day 5:** Backup video in repo. **Non-negotiable.**

---

## 10. Top-8 Risks and Mitigations

Ranked by impact × probability. Each owned by a named teammate with a concrete mitigation already scoped into the timeline.

| # | Risk | Impact | Prob | Owner | Mitigation |
| ---: | --- | :-: | :-: | --- | --- |
| **1** | **Critic loop visibly broken on stage** (Mara passes everything OR Lyra never rejects) — kills the Invariant-1 demo beat (40% of rubric). | High | Med | **Schema+Personas Dev** | Few-shot Mara with 10 known-bad scripts + 5 known-bad shot lists at boot; `tests/personas/test_mara_devils_advocate.ts` asserts 10/10 catches in CI. Lyra has a *pre-seeded below-threshold beat* in the demo case — `data/replay/demo-hip-replacement/stage10-lyra/beat-03-attempt1.json` returns `anatomical_fidelity: 0.71`, forcing the regen on stage. |
| **2** | **Seedance produces glyph-soup or invents organs** — kills video-output-quality 40%. | High | Med | **Vision+Synthesis Dev** | Tier-0 anchor (Seedream keyframe + 1–3 entity refs) on every call; `compileSeedancePrompt` throws if `image_refs.length<1`. Lyra's `on_screen_text_violations > 0` gate forces regen. Pre-rendered hip-replacement clip is the demo asset; we don't generate live on stage. |
| **3** | **`DEMO_MODE=replay` cache miss on stage** — pipeline throws `ReplayMissError` mid-pitch. | High | Low | **Frontend+Demo (Demo Dev hat)** | `prewarm_demo.py` runs night-before and asserts byte-identical second pass; manifest checksum verified at T-30; `demo_mode_switch.sh replay` flips atomically. **Backup video is the absolute hedge** (Step 14). |
| **4** | **Hardcoded model ID slips into a non-`models.ts` file** — Invariant 2 violation; if prod points at the wrong model, Seedance calls fail silently with a deprecated ID. | Med | Med | **Atlas (Lead)** | `.claude/hooks/pre-edit-block-model-ids.sh` PreToolUse hook blocks the edit; ESLint custom rule + `npm run check:inv2` grep in CI; PR template Q `## Invariant 2 Compliance` mandatory. |
| **5** | **Audit-trail incompleteness** — a beat ships with an uncited claim → Invariant 4 violation visible to judges. | High | Low | **Schema+Personas Dev** (citation schema) + **Atlas** (PDF builder) | Mara enforces pre-render (`uncited_claim` category = `block`); Lyra enforces post-render (`on_screen_text_violations`); `verify_audit_trail.py` blocks merge on missing pointer; `tests/invariants/test_audit_completeness.ts` is part of `check:invariants`. |
| **6** | **OmniHuman uncanny on the demo case** — opens explainer with creepy talking head; pollutes trust signal. | Med | High | **Vision+Synthesis Dev** | Layer-2 / opt-in only. Phase 0.6 verification: render the surgeon greeting once in dev; if `uncannyScore > 0.4` (manually scored), **cut to title card with VO**. Default `OMNIHUMAN_ENABLED=false` for the demo unless verified by Day 4 EOD. |
| **7** | **Butterbase MCP provisioning friction** — schema not provisioned in time, worker has no place to write. | Med | Med | **Butterbase Dev** | `infra/butterbase/schema.sql` is the SoT; in-memory `ButterbaseClient` stub ships Day 1 so worker development is unblocked; switch to MCP-provisioned tables by Day 2 EOD. If MCP path fails Day 4, fallback to local Postgres in Docker — interface is identical. |
| **8** | **Wifi dies / ARK region 5xx during live-mode hybrid demo** — fallback to replay misses cache. | Med | Low | **Atlas + Frontend+Demo** | `demo_mode_switch.sh replay` pre-flipped at T-30; `HYBRID_LIVE_BUDGET_S=8.0` cuts off slow live calls and falls back to replay; multi-API-key rotation via `keyRotation.ts` (CareReel pattern, state in Redis). **Backup video** is the final hedge. |

---

## 11. Cross-cutting acceptance criteria (end of session)

The session-end deliverable is a runnable scaffold. Specifically:

- [ ] `npm install && npm run build && npm run typecheck` clean.
- [ ] `npm run check:invariants` all four green.
- [ ] `DEMO_MODE=replay npm run dev` (web) + `DEMO_MODE=replay npm run worker` boots both processes.
- [ ] Drop the phantom hip-replacement PDF + patient card in `apps/web/public/demo/` into `/forge` upload → forge_run_id returned → SSE stream paints AnatomyGraph (Stage 2c) → CriticHud shows Mara's critique sidebar (Stage 4) → Lyra's reject + regen (Stage 10) → DeliverableCard shows MP4 URL + audit-PDF link.
- [ ] `GET /api/forge/{id}/receipt` returns a multi-page PDF where every claim has `§N.N` or `PMID:NNNNNNN`.
- [ ] `data/replay/demo-hip-replacement/stage12-final.mp4` exists, is 1920×1080 H.264 30fps, ≤90s wall-clock to render.
- [ ] No outbound HTTP egress during the e2e replay test (verified by global `fetch` mock).
- [ ] Butterbase rows present for: 1 `forge_runs`, ≥6 `critiques` (one per shot, even info-severity), ≥N `critic_scores` (one per beat per attempt), ≥M `audit_citations` (one per claim).
- [ ] `CHANGELOG.md` has Day-1 through Day-5 sections in chronological order.
- [ ] **`docs/demo-backup.mp4` does NOT need to exist yet** at session end (it's a Day-5 5-PM artifact). But `scripts/record_backup_video.sh` must be a no-arg runnable script that screen-records the locked 2 minutes.

---

## 12. Out-of-scope for this session (do not build)

- Auth, multi-tenancy, billing, admin features
- Mobile responsive polish (the 2-min submission video is the product)
- General-purpose video editor features
- LangChain / LangGraph / agent framework integration
- A second vertical (SafetyReel) — it shares the engine but lives in its own repo
- Pixel-perfect UI work that delays the pipeline going green
- Real patient data of any kind (HIPAA + ethics; synthetic phantom only)

---

## 13. References (read before any non-trivial change)

- `README.md` — public pitch + spec (already exists)
- `CLAUDE.md` — rules layer + invariants (already exists)
- `docs/plans/2026-05-02-winning-vertical-v7.md` (parent monorepo)
- `docs/plans/2026-04-28-seed-pivot.md` (parent monorepo)
- `docs/telestudio_architecture_v5_fusion.mermaid` (shared architecture)
- BytePlus ModelArk docs — https://docs.byteplus.com/en/docs/ModelArk/
- Open-Generative-AI port (MIT, lens taxonomy attribution) — https://github.com/Anil-matcha/Open-Generative-AI

---

*Atlas — Lead Architect. This plan is the contract. Every PR cites the section it satisfies under `## Invariant Compliance`.*
