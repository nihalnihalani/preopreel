# Project Rules for Claude Code

## Project Overview

**PreOpReel** — A meta-agentic video pipeline. Drop a surgeon's procedure-plan PDF and a patient demographics card into a web form; PreOpReel synthesizes a 60–90 second personalized, anatomically-grounded, audit-trailed pre-operative explainer the patient watches before signing consent. Treat this repo as hackathon-grade software with production-shaped pieces (audit-trail PDF, citation-bound narration, vision-critic gating), not a finished medical product.

**Hackathon:** Beta Super Hackathon | 2026-05-02 | 2nd Floor, Computer History Museum, Mountain View
**Track:** Track 2 — AI Content Automation. Fallback: Track 1 — AI Video Agents (Vertical).
**Submission format (per the participant handbook):** Butterbase MCP submission with code `butterbase0502` (lowercase). **Exactly 3 slides** (Team intro / Product overview / Demo with embedded video ≤2 minutes). File access "Anyone can view". 1 PM submission deadline; 1–2 PM late window with no demo-slot guarantee. Pitch is 3 minutes, Q&A is none, **no live demos** — only the submitted video plays at Demo Day.
**Tagline:** *"The 90-second animated explainer your surgeon never had time to make."*
**Judging weights (handbook-authoritative — overrides any 40/40/20 phrasing in older docs):**

| Dimension | Weight | Winning Standard | Red Flag |
| --- | ---: | --- | --- |
| Tech Execution | 30% | Deep API integration; autonomous agentic reasoning | Shallow UI wrappers; hardcoded logic |
| GTM & Moat | 25% | Laser-focused vertical; clear SaaS distribution | "Video AI for everyone"; no moat |
| Continuity | 20% | Scalable build; clear 7-day iteration plan | Throwaway hacks; no roadmap |
| UX Innovation | 15% | Novel low-friction interaction paradigms | Clunky config; high manual effort |
| Demo Impact | 10% | High-signal pitch; functional outcome on tape | Fluff; failed video |

**What this rubric implies for scope priorities:** Tech Execution still rewards the agentic critic loop (Invariant 1). But **GTM-Moat (25%) + Continuity (20%) = 45%** of the score and are largely *deck-resident* — see `docs/gtm-moat.md` and `docs/seven-day-roadmap.md` for the artifacts that earn those points. Demo Impact is only 10%, so over-polishing the 2-min video past "clearly working + clearly agentic" has diminishing returns.

**Primary references:**
- [README.md](./README.md) — public pitch + technical spec (12-stage pipeline, agent team, sponsor map, file map, risk register)
- `docs/plans/2026-05-02-winning-vertical-v7.md` *(in the parent `seed-agents-challenge` monorepo)* — authoritative vertical-lock plan
- `docs/plans/2026-04-28-seed-pivot.md` — original Seed-stack pivot spec
- `docs/telestudio_architecture_v5_fusion.mermaid` — shared architecture (PreOpReel + SafetyReel diverge only in Stage 1 schema and persona prompts)

**Read all four before any non-trivial change.**

### Architecture

A six-agent team (Atlas / Tavi / Exa / Gem / Lyra / Mara) drives a 12-stage pipeline that maps a surgeon's procedure plan + patient card to a signed, audit-trailed, vision-critiqued explainer MP4. The **same six personas exist at build-time and runtime** — build-time uses `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, runtime instantiates them as functions in `src/lib/forge/personas/*.ts`.

- **Director / Planner**: Atlas — Seed 2.0 Pro, surgical-investigator persona, Zod-typed `ShotList`
- **Web research**: Tavi — Tavily API for peer-reviewed surgical protocols (PMID-cited)
- **Neural search**: Exa — similar-procedure visualization references
- **Vision + anatomy extraction**: Gem — Gemini 1.5 Flash over the procedure plan's diagrams; emits typed `AnatomyGraph` with confidence bands
- **Continuity + Vision Critic**: Lyra — Seed 2.0 Pro Vision over each Seedance clip; scores `anatomical_fidelity`, `procedure_step_compliance`, `on_screen_text_violations`
- **Devil's Advocate / pre-render critic**: Mara — Seed 2.0 Pro, plan-only mode; flags any line that crosses from *explaining* the surgeon's plan to *recommending* (the device/communication-tool boundary)
- **Storyboard keyframes**: Seedream 5.0 Lite — first-frame anatomical anchors (Tier-0)
- **Generation**: Seedance 2.0 — I2V / T2V-with-ref only; multi-reference identity locking; `seedance-v2.0-extend` for beats > 5s
- **Narration**: Seed Speech 2.0 — calm-clinician preset; bounded to procedure-plan + anatomy-bible + cited-protocols corpus
- **Optional surgeon greeting**: OmniHuman 1.5 — ≤8s lip-sync from a still + Seed Speech VO (opt-in only, cut to title card if uncanny)
- **Composition + render**: Remotion — procedure-step overlays, anatomical labels, confidence bands, citation footer; 1080p H.264 MP4

### Project Structure

```text
preopreel/
├── CLAUDE.md                          # this file — rules layer
├── README.md                          # public pitch + spec
├── CHANGELOG.md                       # daily-shipping log (CareReel pattern; one section per day)
├── architecture.md                    # symlink/copy of docs/telestudio_architecture_v5_fusion.mermaid (post-bootstrap)
├── package.json                       # name: "preopreel"; Next.js 16 + Remotion + assistant-ui
├── next.config.ts
├── remotion.config.ts
├── .claude/                           # Claude Code settings (hooks enforcing invariants — see §Invariants)
├── .env.example                       # documented env shape — never commit secrets
├── apps/
│   ├── web/                           # Next.js 16 App Router — patient-facing UI
│   ├── api/                           # Next.js API routes — /api/forge entry
│   └── synthesis-worker/              # 12-stage pipeline orchestrator (see §Synthesis Core Loop)
├── src/
│   ├── app/
│   │   ├── api/forge/route.ts         # Surgical-vertical entry
│   │   └── forge/page.tsx             # Single-page UI; no signup, click-to-use
│   ├── components/
│   │   ├── PreOpUpload.tsx            # Patient + procedure intake
│   │   ├── AnatomyGraphViewer.tsx     # Live JSON tree (Stage 2c output)
│   │   └── CriticHud.tsx              # Live vision-critic HUD (Stage 10)
│   ├── lib/
│   │   ├── seed/                      # Seed model wrappers — see understudy §Invariants for pinning rule
│   │   │   ├── ark.ts                 # Seed 2.0 Pro / Lite (Director, Devil's Advocate, Vision Critic)
│   │   │   ├── seedance.ts            # Seedance 2.0 (T2V/I2V, extend)
│   │   │   ├── seedream.ts            # Seedream 5.0 Lite (keyframes — Tier-0 anchor)
│   │   │   ├── speech.ts              # Seed Speech 2.0
│   │   │   └── omnihuman.ts           # OmniHuman 1.5 (opt-in only)
│   │   ├── forge/
│   │   │   ├── anatomyGraph.ts        # AnatomyGraph schema (Zod)
│   │   │   ├── shotList.ts            # ShotList schema (Zod) — Director output contract
│   │   │   ├── critique.ts            # Critique schema (Zod) — Mara + Lyra output contract
│   │   │   ├── ingestors/
│   │   │   │   ├── procedurePlanPdf.ts        # PDF → typed plan
│   │   │   │   ├── patientDemographics.ts     # Card → typed patient
│   │   │   │   └── anatomyExtract.ts          # Gem vision over plan diagrams
│   │   │   ├── anatomyReasoner.ts             # Anatomical norms + confidence bands
│   │   │   ├── tavily.ts                       # Tavi client + grounding cache
│   │   │   ├── exa.ts                          # Exa client
│   │   │   ├── personas/                       # build-time AND runtime personas
│   │   │   │   ├── atlas-surgical.ts           # Director (surgeon persona)
│   │   │   │   ├── tavi.ts
│   │   │   │   ├── exa.ts
│   │   │   │   ├── gem.ts
│   │   │   │   ├── lyra.ts                     # vision critic
│   │   │   │   └── mara.ts                     # devil's advocate (plan-only)
│   │   │   ├── lens/                           # Open-Generative-AI port (MIT, attribution in LICENSES.md)
│   │   │   ├── compileSeedancePrompt.ts        # Stage 8 prompt compiler
│   │   │   ├── critic.ts                       # Stage 10 vision-critic loop
│   │   │   ├── replay.ts                       # DEMO_MODE=replay shim — every outbound call must call through this
│   │   │   ├── keyRotation.ts                  # multi-API-key failover (CareReel pattern)
│   │   │   └── types.ts                        # ForgeRun, AnatomyGraph, ShotList, Critique
│   └── remotion/
│       ├── compositions/
│       │   └── PreOpExplainer.tsx              # Top-level Remotion composition
│       └── components/surgical/
│           ├── ProcedureStepOverlay.tsx
│           ├── AnatomicalLabel.tsx
│           ├── ConfidenceBand.tsx
│           └── CitationFooter.tsx
├── data/
│   ├── grounding-cache/               # Tavi peer-review cache (deterministic across runs)
│   ├── replay/                        # DEMO_MODE=replay fixtures (per ForgeRun id)
│   └── fixtures/
│       └── demo-hip-replacement/      # synthetic phantom patient + procedure plan + expected explainer
├── scripts/
│   ├── prewarm_demo.py                # seeds replay cache + warms LangCache + checks Seed availability
│   ├── demo_mode_switch.sh            # flip DEMO_MODE across services atomically
│   ├── record_backup_video.sh         # ★ run by 5 PM demo day — pushes to repo (see §Demo Day)
│   └── verify_audit_trail.py          # validates every script claim cites plan §X or PMID
├── tests/
│   ├── conftest.py
│   ├── personas/
│   │   ├── test_atlas_director.ts             # Director persona bounded by procedure-plan invariant
│   │   ├── test_mara_devils_advocate.ts       # Catches "you should" / "consider" / advice creep
│   │   └── test_lyra_vision_critic.ts         # Below-threshold reject + 1 regen budget
│   ├── synthesis-worker/
│   │   ├── test_anatomy_graph.ts
│   │   ├── test_shot_list_zod.ts
│   │   ├── test_keyframe_anchoring.ts         # Invariant: every Seedance call has a Seedream ref
│   │   └── test_replay_branch.ts              # Invariant: every outbound call has a DEMO_MODE=replay path
│   ├── ingestors/
│   │   └── test_procedure_plan_pdf.ts
│   └── e2e/
│       └── test_demo_smoke.ts                  # End-to-end synthesis in replay mode
├── docs/
│   ├── demo-runbook.md                         # 2-minute beat-by-beat
│   ├── audit-trail-sample.pdf                  # public sample export (see §Operational Moves)
│   └── prompts/
│       ├── atlas-surgical-director.md
│       ├── mara-devils-advocate.md
│       └── lyra-vision-critic.md
└── infra/
    ├── do-app-platform/                        # DigitalOcean App Platform spec
    └── do-spaces/                              # CDN bucket policy
```

Don't pre-create empty folders. Scaffold each phase as needed.

### Key Technical Decisions (Invariants)

**These four are non-negotiable. A PR that violates any of them must not merge. Hooks in `.claude/settings.json` enforce them at edit-time where possible.**

#### Invariant 1 — Critic Loop Is Mandatory ★

**The single most important architectural invariant in this repo.** Every winning archetype in this hackathon — Reelify, CrashForensics, CareReel, Forge — has a visible critic agent that gates output before the human sees it. The handbook rubric weights *Tech Execution* at **30%** and explicitly rewards "autonomous agentic reasoning"; the critic loop is how PreOpReel earns those points. PreOpReel runs **two critic stages**, both visible in the recorded demo:

1. **Pre-render critic — Mara (Devil's Advocate)** — Seed 2.0 Pro, plan-only mode. Reads the Director's `ShotList` and emits a typed `Critique` document. Specific job: catch any line that crosses from *explaining* the surgeon's plan to *recommending* something. Few-shot her with 10 known-bad scripts (any line starting with "you should" / "consider" / "recommend") at boot.
2. **Post-render critic — Lyra (Vision Critic)** — Seed 2.0 Pro Vision over each Seedance clip. Scores `{anatomical_fidelity, procedure_step_compliance, on_screen_text_violations, feedback}` against the `AnatomyGraph` + `ShotList`. Decision: `min(scores) < CRITIC_FIDELITY_THRESHOLD` OR `on_screen_text_violations > 0` ⇒ regenerate (1 regen budget per beat). Final scores written to `ForgeRun.deliverable.criticTrace[]` and shown live in `CriticHud.tsx`.

**Rules:**

- A new pipeline stage that produces user-visible output must go through Lyra before acceptance. PRs that bypass the critic must not merge.
- A new persona that drafts user-visible language must be reviewed by Mara before render. PRs that bypass Mara must not merge.
- Critic output is not optional UI — `CriticHud.tsx` is on-camera during the 0:50–1:00 beat of the recorded video.
- "Critic disabled in dev" is fine; "critic disabled in the recorded video" is a release blocker.

**Why:** the rubric. Judges compare us against winning archetypes that all show their work. A planner + executor without a critic looks like a 2024 demo.

#### Invariant 2 — Seed Stack Pinning (Judged Path)

The judged generation surface MUST run on BytePlus Seed models. Pins live in **`src/lib/seed/models.ts`** (single source of truth):

```ts
export const SEED_MODELS = {
  director: "seed-2.0-pro",          // Atlas + Mara: planner + devil's advocate
  vision_critic: "seed-2.0-pro",     // Lyra: vision scoring (multimodal)
  keyframes: "seedream-5.0-lite",    // Seedream: Tier-0 anchor (NEVER skip)
  video: "seedance-2.0",             // Seedance: I2V / T2V-with-ref ONLY
  speech: "seed-speech-2.0",         // narration
  presenter: "omnihuman-1.5",        // optional surgeon greeting (opt-in)
} as const;
```

Import from there — never hardcode a model ID elsewhere. A pre-tool-use hook in `.claude/settings.json` blocks edits that embed `seed-*` / `seedream-*` / `seedance-*` IDs in any other file.

**Tier-0 keyframe-anchoring sub-rule:** **every Seedance call is I2V or T2V-with-ref. Never naked T2V.** Seedream first-frame anchoring is what stops Seedance from inventing organs. A test in `tests/synthesis-worker/test_keyframe_anchoring.ts` greps the prompt-compiler output for `image_refs.length >= 1` on every Seedance payload. PRs that fail this test do not merge.

Third-party LLMs / image / video / TTS providers (Gemini for vision-only landmark extraction, library music) are allowed only in non-judged paths and must be wrapped behind a `USE_LEGACY_PROVIDERS` kill-switch flag.

#### Invariant 3 — Hermetic `DEMO_MODE` Must Work

The `DEMO_MODE` env flag (`live` | `replay` | `hybrid`) swaps live Seed calls for cached replay fixtures keyed by `ForgeRun.id`. **Any new outbound call must add a replay branch in the same PR**, with a test covering it. `scripts/prewarm_demo.py` seeds the replay cache the night before a demo. `replay.ts` is the chokepoint — every Seed wrapper calls through it.

Modes:
- `live` — real Seed calls; for development and pre-demo dry runs
- `replay` — every Seed call is replaced with a cached response from `data/replay/{forge_run_id}/`; for hermetic demo
- `hybrid` — `live` with a `HYBRID_LIVE_BUDGET_S` per-stage timeout; falls back to `replay` on timeout / quota error / network failure

**Hard rule:** never run `DEMO_MODE=live` for the first time on stage. Pre-warm + dry-run the night before.

#### Invariant 4 — Audit Trail Is The Product

Every script claim on screen must trace back to either (a) a numbered section of the surgeon's procedure plan, (b) a Tavi-cached PMID, or (c) a curated entry in `data/surgical-protocols-references.json`. Mara enforces provenance pre-render; Lyra enforces it post-render via the `on_screen_text_violations` gate. The `GET /api/forge/{id}/receipt` endpoint exports the audit-trail PDF — every claim cited. **PRs that produce on-screen text without a citation pointer do not merge.**

This is the difference between a communication tool and an unregulated medical device. Treat it that way.

### Other Technical Decisions (Strong Defaults — Change With Care)

- **Two-vertical sibling.** PreOpReel and SafetyReel share the same engine (`telestudio_architecture_v5_fusion`). Only Stage 1 schema (`AnatomyGraph` vs. `IncidentGraph`) and persona prompts (`atlas-surgical.ts` vs. `atlas-investigator.ts`) differ. **Do not introduce surgical-specific code into shared modules.** If a change benefits both verticals, land it in the shared module; if only one, gate it behind the persona.
- **No mocks on the demo path.** Real Seed calls (or cached replay), real Remotion render, real audit-trail PDF on stage. `COSMO_MOCK`-style flags exist only for offline dev.
- **Pre-warm before demo.** Run `python scripts/prewarm_demo.py` the night before. Cache must include the demo case (synthetic phantom hip replacement) plus 2 backup cases.
- **Density is a goal.** A 90-second explainer should fit in a single Remotion render under 90 seconds wall-clock at 1080p. If a change pushes that envelope, flag it.
- **Bounded narration.** Seed Speech text is a strict subset of plan corpus + anatomy bible + cited protocols. Lyra's critic rejects any narrator line that doesn't trace back. Mara enforces it pre-render.
- **OmniHuman is optional.** Cut to title card if Phase 0.6 verification produces uncanny-valley output. Trust signal > novel signal.

### Synthesis Core Loop (12 Stages)

```
PROCEDURE PLAN PDF + PATIENT DEMOGRAPHICS CARD
                │
                ▼
   Stage 1 — Intake (Atlas)              Zod-validated patient + procedure schema
                ▼
   Stage 2 — Research (parallel fan-out)
       2a Tavi  : peer-reviewed surgical protocols (PMID-cited)
       2b Exa   : similar-procedure visual references
       2c Gem   : anatomical landmarks + confidence bands → AnatomyGraph
       2d (det) : pdf-parse → typed procedure plan
                ▼
   Stage 3 — Director (Atlas, Seed 2.0 Pro)
                                          → ShotList (Zod): logline, beats[].procedure_step_id,
                                            anatomical_focus, camera_angle, narrator_line
                ▼
   Stage 4 — Devil's Advocate (Mara, Seed 2.0 Pro, plan-only)
                                          → Critique markdown; Atlas approves or rejects
                                            (1-round cap)  ★ CRITIC LOOP — INVARIANT 1
                ▼
   Stage 5 — Anatomy Bible (Lyra, Seed 2.0 Pro + Seedream 5.0 Lite)
                                          1–3 ref images per anatomical entity
                ▼
   Stage 6 — Cinema Lens (deterministic)  Suffix from Open-Generative-AI lens taxonomy
                ▼
   Stage 7 — Storyboard Keyframes (Lyra, Seedream 5.0 Lite)
                                          ★ TIER-0 ANCHOR — INVARIANT 2 sub-rule
                ▼
   Stage 8 — Prompt Compiler (Atlas)      prompt = beat + cinema_suffix
                                          image_refs = [keyframe, ...entityRefs]
                                          video_ref  = prevBeat.lastFrame
                ▼
   Stage 9 — Seedance Generation (worker, Seedance 2.0)
                                          ≤ MAX_CONCURRENT_LANES (default 3)
                                          beats > 5s ⇒ seedance-v2.0-extend
                ▼
   Stage 10 — Vision Critic (Lyra, Seed 2.0 Pro Vision)
                                          1 regen budget per beat
                                          ★ CRITIC LOOP — INVARIANT 1
                                          → criticTrace[] for HUD
                ▼
   Stage 11 — Narration (Atlas, Seed Speech 2.0)
                                          bounded to plan corpus
                                          11b OmniHuman 1.5 surgeon greeting (opt-in, ≤8s)
                ▼
   Stage 12 — Composition + Render (Lyra, Remotion)
                                          ProcedureStepOverlay + AnatomicalLabel
                                          + ConfidenceBand + CitationFooter
                                          → 1080p H.264 MP4
                ▼
   AUDITED EXPLAINER MP4 + AUDIT-TRAIL PDF + DELIVERABLE CARD
   (url, duration, regen_count, critic_scores, cost, citations)
```

Every stage emits SSE trace events keyed by `forge_run_id` to a stream consumed by the synthesis HUD. Stages 4 (Mara) and 10 (Lyra) are first-class citizens of that HUD — judges literally see the critic working.

### Critic Loop Schemas (for reviewers + tests)

**Mara — Devil's Advocate (Stage 4) — pre-render Critique:**

```ts
{
  shot_id: string;
  severity: "block" | "warn" | "info";
  category: "advice_creep" | "uncited_claim" | "ambiguity" | "scope_creep" | "anatomical_invention";
  excerpt: string;        // ≤200 chars from the Director's narrator_line
  reason: string;         // ≤200 chars; cites the rule violated
  suggested_revision?: string;
}
```

Atlas applies all `block`-severity revisions or kicks the shot back to redraft.

**Lyra — Vision Critic (Stage 10) — post-render scores:**

```ts
{
  beat_id: string;
  anatomical_fidelity: number;        // 0..1 — does the rendered shot match AnatomyGraph?
  procedure_step_compliance: number;  // 0..1 — does the action match the plan's step?
  on_screen_text_violations: number;  // count; must be 0
  feedback: string;                    // ≤120 chars; used to rebuild the Seedance prompt
}
```

Decision: `min(scores) < CRITIC_FIDELITY_THRESHOLD (0.75)` OR `on_screen_text_violations > 0` ⇒ regenerate. 1-regen budget. After that, accept and surface the score honestly in the HUD (we *show* the score, not hide it — biggest trust signal we have).

### Demo Theater (the locked 2 minutes)

| Time | Beat | Visual |
| --- | --- | --- |
| 0:00–0:08 | Hook: *"Surgeons spend 8 minutes per patient explaining a procedure. Patients remember 60 seconds. We make those 60 seconds personalized."* | Stat card |
| 0:08–0:18 | Drag procedure-plan PDF (hip replacement, posterior approach, 65yo, BMI 28) + 3 photos in | UI screencast |
| 0:18–0:28 | `AnatomyGraph` builds live — Atlas/Gem labels appear over anatomy fields | JSON tree growing |
| 0:28–0:50 | **Pre-rendered**: 22-second personalized hip-replacement walkthrough with procedure-step overlays + confidence bands | Final MP4 fullscreen |
| 0:50–1:00 | **Critic HUD slo-mo: Lyra rejects shot 3 (anatomical fidelity 0.71 < threshold), regen at 0.86** ★ | HUD overlay |
| 1:00–1:10 | Audit PDF export: every script claim cites procedure-plan §2.3 or NIH protocol PMID | PDF preview |
| 1:10–1:30 | Architecture: 6-agent team mermaid + Seed 2.0 / Seedream / Seedance / Seed Speech / OmniHuman lineup | Mermaid diagram |
| 1:30–1:50 | Vision: hip → knee → cardiac → ENT → ophthalmic. Same engine. Procedure library expands. | Three-up grid |
| 1:50–2:00 | Tagline + GitHub URL | End card |

**Demo case** is a synthetic phantom patient labeled as such on screen. We never use real patient data on stage — both an ethical and a HIPAA constraint, and we lean into it. Honesty > theater.

### Sponsor Integration Map

Every Seed surface is used and each one earns its place. Nothing checkbox-integrated.

| Sponsor | Role | Integration depth |
| --- | --- | --- |
| **Seed 2.0 Pro / Lite** | Director (Atlas) + Devil's Advocate (Mara) + Vision Critic (Lyra) — the brain across planner / critic-1 / critic-2 | DEEP — three personas, three system prompts, one model |
| **Seedream 5.0 Lite** | Tier-0 keyframe anchor (Stage 7) + per-entity ref images for the anatomy bible | DEEP — gate on every Seedance call |
| **Seedance 2.0** | Per-beat I2V / T2V-with-ref + extend for long beats | DEEP — judged-output surface |
| **Seed Speech 2.0** | Calm-clinician narration (Stage 11), bounded to plan corpus | DEEP — narration is judged output |
| **OmniHuman 1.5** | Optional surgeon greeting (Stage 11b, ≤8s), opt-in, cut if uncanny | OPTIONAL — Layer 2 |
| **Tavily** | Peer-reviewed surgical-protocol search (cached, PMID-cited) | DEEP — citations on every overlay |
| **Exa** | Neural search for similar-procedure visual references | DEEP — drives Seedream style |
| **Google Gemini 1.5 Flash** | Vision-only landmark extraction (Stage 2c) — non-judged path | NARROW — vision only, never narration |
| **Remotion** | Composition + render (provider-neutral) | DEEP — overlay system carries the audit trail |
| **DigitalOcean** | Spaces (CDN) + App Platform (deploy) | OPS |

### Data Models (`ForgeRun` + Redis Keyspace)

- `pre:run:{forge_run_id}` — hash: ForgeRun state (status, stage, durations, cost)
- `pre:trace:{forge_run_id}` — Stream: SSE trace events (stage, message, ts, duration_ms)
- `pre:replay:{forge_run_id}` — hash: cached Seed responses per stage (powers `DEMO_MODE=replay`)
- `pre:critique:{forge_run_id}` — list of Mara `Critique` documents per shot
- `pre:critic:{forge_run_id}` — list of Lyra vision-critic scores per beat (drives `CriticHud.tsx`)
- `pre:audit:{forge_run_id}` — citation graph: every claim → source pointer (procedure-plan §X | PMID | curated-ref-id)
- `pre:cache:tavi` — Tavily peer-review cache (deterministic across runs)
- `pre:cache:lens` — Cinema-lens taxonomy lookup (deterministic)

### API Surface (`apps/api`)

```
POST   /api/forge                              Ingest plan + patient card; returns forge_run_id + 202
GET    /api/forge/{id}                          Current status + stage + cost
GET    /api/forge/{id}/stream                   SSE stream of trace events (incl. Mara + Lyra)
GET    /api/forge/{id}/critique                 Mara's pre-render critiques (typed list)
GET    /api/forge/{id}/critic                   Lyra's per-beat vision-critic scores
GET    /api/forge/{id}/receipt                  Audit-trail PDF (every claim cited)
GET    /api/forge/{id}/explainer.mp4            The rendered MP4 (signed URL)
GET    /api/healthz                             Liveness + DEMO_MODE + Seed-availability probes
POST   /api/forge/{id}/regen?beat={n}           Manual one-shot regen (overrides 1-regen budget)
```

Every synthesis endpoint appends trace events via the `_log_if_forge_route` middleware in `apps/api/server.ts`.

---

## Git Workflow — Pull Request Required

**MANDATORY:** All changes go through a PR before merging to `main`. Never commit or push directly to `main`. Never force-push.

### Lifecycle (fully automated)

1. Branch from `main`: `git checkout -b <type>/<short-description>`
2. Stage and commit with Conventional Commits messages
3. Push: `git push -u origin <branch>`
4. Open PR: `gh pr create`
5. Self-review with `gh pr diff` against:
   - **Invariant 1** — does the change touch a user-visible output stage? If yes, does it route through Mara (pre-render) and/or Lyra (post-render)?
   - **Invariant 2** — does it add a Seed call? Then it must (a) import the model id from `src/lib/seed/models.ts`, (b) use I2V or T2V-with-ref if it's Seedance, (c) have a corresponding test
   - **Invariant 3** — does it add an outbound call? Then it must have a `DEMO_MODE=replay` branch and a test covering it
   - **Invariant 4** — does it produce on-screen text? Then every claim must have a citation pointer
   - Test coverage, type safety, no hardcoded secrets, no glyph-soup text inside Seedance prompts
6. Fix issues with NEW commits — never `--amend` after a hook failure
7. Approve: `gh pr review --approve -b "Automated review passed: <summary>"`
8. Merge: `gh pr merge --squash --delete-branch`

### Rules

- Never commit to `main`, never force-push
- Never skip hooks (`--no-verify`) — hooks enforce invariants
- One logical change per PR
- PR title follows Conventional Commits
- PR body must include **Summary**, **Test Plan**, and **Invariant Compliance** sections
- Pre-commit failure ⇒ NEW commit (never `--amend`)
- Squash-merge so `main` stays linear

### Critic-Path Gate

Any PR that touches `src/lib/forge/personas/{atlas-surgical,mara,lyra}.ts`, `src/lib/forge/critic.ts`, `src/components/CriticHud.tsx`, or the `pre:critic:*` / `pre:critique:*` Redis prefixes must be reviewed with the **critic-loop-reviewer** subagent before merge. Regressions here are catastrophic — they break Invariant 1 (the rubric play).

### Audit-Path Gate

Any PR that touches `src/lib/forge/types.ts` (citation schema), `data/surgical-protocols-references.json`, `apps/api/route.../receipt.ts`, or the audit-trail PDF generator must be reviewed with the **audit-trail-reviewer** subagent. Regressions here break Invariant 4.

---

## Branching & Commit Conventions

- **Main branch:** `main`
- **Commit format:** [Conventional Commits](https://www.conventionalcommits.org/)
- **Scopes:** `forge`, `personas`, `critic`, `audit`, `seed`, `seedance`, `seedream`, `speech`, `omnihuman`, `ingestors`, `api`, `web`, `remotion`, `lens`, `replay`, `keyrotation`, `infra`, `tests`, `docs`, `demo`
- **Branch naming:** `<type>/<kebab-description>` (e.g., `feat/lyra-anatomical-fidelity-threshold`, `fix/mara-allowlist-explicitly-permitted-phrases`, `docs/audit-trail-sample-pdf`)

---

## Build & Test Commands

```bash
# ─── Install ─────────────────────────────────────────
npm install                              # package-lock.json is the source of truth

# ─── Dev ─────────────────────────────────────────────
npm run dev                              # Next dev on :3000
npm run build                            # Next production build
npm run lint                             # ESLint
npm run typecheck                        # TypeScript strict

# ─── Remotion ────────────────────────────────────────
npx remotion studio                      # Composition preview
npx remotion render PreOpExplainer       # Spot-check render
                                          # Production renders go through src/lib/render.ts

# ─── Tests ───────────────────────────────────────────
npm test                                  # vitest cross-stack
npm test -- personas/                     # critic-loop persona tests
npm test -- synthesis-worker/             # 12-stage pipeline unit tests
npm test -- e2e/                          # end-to-end synthesis (replay mode only)

# ─── Invariant checks (run in CI; can run locally) ──
npm run check:invariants                  # runs the four greps below in sequence

# Invariant 2 — Seed model ids only in src/lib/seed/models.ts
grep -rn "seedance-2\|seedream-5\|seed-2\.0\|seed-speech\|omnihuman-1" src/ \
  --include="*.ts" --include="*.tsx" \
  | grep -v "src/lib/seed/models.ts"      # must be empty

# Invariant 2 sub-rule — every Seedance call has image_refs
npm test -- synthesis-worker/test_keyframe_anchoring.ts

# Invariant 3 — every outbound call has a replay branch
npm test -- synthesis-worker/test_replay_branch.ts

# Invariant 4 — audit-trail completeness
python scripts/verify_audit_trail.py data/replay/demo-hip-replacement/

# ─── Demo prep ───────────────────────────────────────
python scripts/prewarm_demo.py            # seed replay cache + warm Tavi cache + Seed availability check
./scripts/demo_mode_switch.sh replay      # flip DEMO_MODE across services atomically
./scripts/record_backup_video.sh          # ★ run by 5 PM demo day (see §Demo Day)
```

---

## Environment Variables

Documented in `.env.example`; never commit secrets. Multi-API-key rotation supported on every Seed surface (CareReel pattern — see §Operational Moves).

```bash
# ─── REQUIRED ────────────────────────────────────────
# ModelArk (Seed 2.0 / Seedream / Seed Speech / OmniHuman)
ARK_API_KEY=                              # primary
ARK_API_KEY_2=                            # rotated on quota / 5xx
ARK_API_KEY_3=                            # rotated on quota / 5xx
ARK_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
ARK_REGION=ap-southeast

# Seedance 2.0
SEEDANCE_API_KEY=
SEEDANCE_API_KEY_2=
SEEDANCE_BASE_URL=https://ark.ap-southeast.bytepluses.com/api/v3
SEEDANCE_MODEL=seedance-2.0

# Grounding / vision (non-judged path)
TAVILY_API_KEY=
EXA_API_KEY=
GEMINI_API_KEY=                           # vision-only; NEVER used in narration

# ─── REQUIRED (defaults work locally) ────────────────
REDIS_URL=redis://localhost:6379
DEMO_MODE=live                            # live | replay | hybrid
MAX_CONCURRENT_LANES=3
CRITIC_FIDELITY_THRESHOLD=0.75
MAX_REGEN_PER_BEAT=1

# ─── OPTIONAL (prod / CI only) ───────────────────────
DO_SPACES_BUCKET=preopreel-renders
DO_SPACES_KEY=
DO_SPACES_SECRET=
HYBRID_LIVE_BUDGET_S=8.0                  # hybrid mode: live budget before falling back to replay
USE_LEGACY_PROVIDERS=0                    # demo-day kill-switch (Seed-down recovery)
```

---

## Agent Team Strategy

The same six personas exist build-time (Claude Code teams) and runtime (TypeScript modules). Build-time uses `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json`.

### Team Composition

- **Lead** — Atlas. Architecture, interface design, invariant gate-keeping, PR review.
- **Synthesis Dev** — owns `apps/synthesis-worker/`, the 12-stage orchestration, `replay.ts` plumbing.
- **Personas Dev** — owns `src/lib/forge/personas/*.ts` (the build-time AND runtime personas). **Only this teammate edits `mara.ts` and `lyra.ts`.**
- **Schema Dev** — owns `anatomyGraph.ts`, `shotList.ts`, `critique.ts`, citation schema, `data/surgical-protocols-references.json`.
- **Vision Dev** — owns `src/lib/seed/seedance.ts`, `seedream.ts`, the Tier-0 anchor logic, per-beat prompt compilation.
- **Frontend Dev** — owns `apps/web`, `PreOpUpload.tsx`, `AnatomyGraphViewer.tsx`, `CriticHud.tsx`. The HUD is the Invariant-1 demo surface — it is non-negotiable polish.
- **Demo Dev** — owns `scripts/prewarm_demo.py`, `scripts/record_backup_video.sh`, `docs/demo-runbook.md`, replay fixtures, dry-run rehearsal.

### When to Use Teams

- Multi-file features spanning personas, Seed wrappers, API routes, and UI
- Research + implementation in parallel (one teammate verifies the Seed-2.0-Vision response shape, another wires `lyra.ts` to it)
- Code review with competing perspectives (correctness, demo impact, audit-trail risk, persona-prompt drift)

### When NOT to Use Teams

- Phase 0 verification spike (sequential, solo)
- Single-file edits to `src/lib/seed/models.ts` (one teammate, ever)
- Edits to `mara.ts` or `lyra.ts` — Personas Dev only
- **Anything touching the four invariants** — route through Lead with plan approval first

### Communication Rules

- `SendMessage` (type: `message`) for direct teammate communication — refer to teammates by **name**
- `SendMessage` broadcast only for critical blockers (e.g., "ModelArk region returning 5xx, replay mode required")
- `TaskCreate` / `TaskUpdate` / `TaskList` for coordination — teammates self-claim lowest-ID unblocked task
- Mark tasks `completed` only after verification passes (tests green, invariants held)
- `addBlockedBy` for ordering ("CriticHud component depends on `pre:critic:*` Redis schema landing")

### Plan Approval (Risky Work)

Require plan approval before implementation for:
- Edits to `src/lib/seed/models.ts` (Invariant 2)
- Edits to `personas/mara.ts` or `personas/lyra.ts` (Invariant 1)
- New outbound calls without a replay branch (Invariant 3)
- Edits to citation schema or audit-trail PDF generator (Invariant 4)
- Anything that invalidates pre-warmed replay fixtures
- Architectural changes shared with the SafetyReel sibling

Teammate works in read-only mode, submits a plan, Lead approves/rejects, only then implements.

### Sequential Dependencies (Build Order)

1. `src/lib/seed/models.ts` — blocks everything
2. `src/lib/seed/ark.ts` + `replay.ts` + `keyRotation.ts` — blocks all four Seed wrappers
3. `forge/types.ts` (ForgeRun, ShotList, AnatomyGraph, Critique) — blocks personas
4. `personas/atlas-surgical.ts` (Director) — blocks Stage 3
5. `personas/mara.ts` (Devil's Advocate) — blocks Stage 4 → blocks Invariant 1 demo
6. `personas/gem.ts` + `ingestors/anatomyExtract.ts` — blocks Stage 2c
7. `seedream.ts` + Tier-0 anchor logic — blocks Stage 7 → blocks Stage 9
8. `seedance.ts` + `compileSeedancePrompt.ts` — blocks Stage 9
9. `personas/lyra.ts` + `critic.ts` + `CriticHud.tsx` — blocks Stage 10 → blocks Invariant 1 demo
10. `speech.ts` — blocks Stage 11
11. Remotion components (`ProcedureStepOverlay`, `AnatomicalLabel`, `ConfidenceBand`, `CitationFooter`) — blocks Stage 12
12. `prewarm_demo.py` + replay fixtures — blocks hermetic demo
13. `apps/web` upload + HUD — blocks demo recording
14. Backup video — must exist by 5 PM demo day (Demo Day rule)

### Shutdown Protocol

- When all tasks complete, Lead sends `shutdown_request` to each teammate
- Teammates approve after confirming work is committed + merged
- Lead calls `TeamDelete` to clean up

---

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for any non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, **STOP and re-plan** — don't keep pushing
- Use plan mode for verification, not just building
- Write detailed specs upfront for synthesis-pipeline changes (the 12 stages have precise contracts; ambiguity costs hours)

### 2. Subagent Strategy

- Offload codebase research and exploration via the **Explore** agent
- For critic-path reviews, use **critic-loop-reviewer**
- For audit-path reviews, use **audit-trail-reviewer**
- For Seed-pipeline debugging, use **seed-pipeline-tracer** (replay-mode misses, model-pin violations)
- One focused task per subagent

### 3. Verification Before "Done"

Never mark a task complete without proving it works:

- `npm test` passes
- `npm run typecheck` passes
- `npm run lint` passes
- `npm run check:invariants` passes — see §Build & Test
- Pipeline change: render the demo case end-to-end in replay mode and visually inspect the MP4
- Persona change: replay 10 known-bad inputs through `personas/test_*.ts`
- UI change: start `npm run dev`, open the upload flow in a real browser, walk through 0:00–2:00 demo beats
- Critic-path change: confirm `CriticHud.tsx` shows the new score / critique on stage
- Audit-path change: open the receipt PDF and verify every claim has a citation pointer
- Ask: *"Would a hackathon judge be impressed by this in 2 minutes?"*

### 4. Demo-Driven Development

- Every Layer-1 feature must be visible in the 2-minute demo
- Polish > breadth — a flawless 12-stage pipeline with a visible critic loop beats six half-baked features
- The **live Mara critique + Lyra reject-and-regen on stage** is the Invariant-1 wow moment — it MUST work
- The **audit-trail PDF export** is the Invariant-4 wow moment — visible at 1:00–1:10
- The **synthetic phantom labeling** is the trust signal — never hide it, lean into it
- If judges can't tell the 6-agent team apart from a single-agent chain, we lost the Agentic-Execution category — surface each persona in the HUD

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask *"is there a more elegant way?"*
- If a fix feels hacky: *"Knowing everything I know now, implement the elegant solution."*
- Skip for simple, obvious fixes
- Ugly code that works beats clean code that doesn't (hackathon rule)
- **Exception**: never trade elegance for an invariant. A hacky `DEMO_MODE=replay` branch is better than no replay branch.

### 6. Autonomous Bug Fixing

- When given a bug report: fix it. Don't hand-hold.
- Read logs, errors, failing tests — resolve the root cause
- Zero context switching from the user

### 7. Self-Improvement Loop

- After any correction from the user: capture the pattern as a memory
- Write rules for yourself that prevent the same mistake
- Review lessons at session start for relevant context

---

## Task Management

1. **Plan First** — write the plan with checkable items before starting
2. **Verify Plan** — check in with the user on non-trivial work
3. **Track Progress** — mark items complete via `TaskUpdate`
4. **Explain Changes** — high-level summary at each step
5. **Document Results** — review what was built and what changed

---

## Scope Control — Hackathon Rules

### MUST SHIP (Layer 1 — The Demo)

| Feature | Why critical |
| --- | --- |
| **6-agent team running end-to-end** (Atlas / Tavi / Exa / Gem / Lyra / Mara) | The Agentic-Execution rubric play |
| **Critic loop visibly gating output** (Mara pre-render + Lyra post-render with reject/regen) ★ | **The single biggest rubric-aligned addition** (Invariant 1) |
| **Seed-stack fully wired** (Seed 2.0 + Seedream 5.0 + Seedance 2.0 + Seed Speech 2.0) | Hackathon submission requirement |
| **Tier-0 keyframe anchoring** (every Seedance call has Seedream ref) | Invariant 2 sub-rule; the visible-quality lever |
| **Audit-trail PDF export** (every claim cited) | Invariant 4; the trust signal that puts us above competitors |
| **Synthesis HUD with per-persona status + critic scores** | Makes the agentic team legible to judges |
| **Pre-rendered demo MP4** (1920×1080 H.264, 16:9, 30fps) | Submission format requirement |
| **Hermetic `DEMO_MODE=replay`** | Hedges Wi-Fi / quota on stage (Invariant 3) |
| **No-signup, click-to-use upload page** | CareReel pattern; removes judge friction |
| **CHANGELOG.md showing per-day shipping** | CareReel pattern; signals "this team will ship after May 2" |
| **Backup video pushed to repo by 5 PM demo day** ★ | Hard rule (see §Demo Day) |

### SHOULD SHIP (Layer 2 — If Time Permits)

| Feature | Impact |
| --- | --- |
| **OmniHuman surgeon greeting** (≤8s, opt-in, cut if uncanny) | Trust amplifier if quality holds |
| **Cost HUD** — per-stage Seed token spend | ROI framing |
| **Hybrid mode** with `HYBRID_LIVE_BUDGET_S` fallback | Best-of-both on stage |
| **Wall of N agents** for the closer beat | Demo-impact lift |
| **2 GitHub issues filed back to BytePlus** (Seedance / Seedream specifics) | Operational signal (see §Operational Moves) |
| **Confidence-band visualization** explicitly on overlays | Honesty > theater |

### MUST NOT DO

- A general-purpose video editor (the verticalization is the moat — see §Operational Moves)
- Mock data on the demo path (judges notice mocks)
- Naked T2V Seedance calls (Invariant 2 sub-rule)
- Text rendered inside Seedance prompts (glyph-soup risk; use Remotion overlays)
- Real patient data on stage (HIPAA + ethics; synthetic phantom only)
- Auth, multi-tenancy, billing, admin features
- A medical-advice or diagnostic feature (Invariant 4 + Mara's specific veto)
- Mobile responsive polish (the 2-min submission video is the product)
- Pixel-perfect UI work that delays the pipeline going green
- LangChain / LangGraph / agent frameworks — plain TypeScript + the existing queue is enough

### Time Sinks That Feel Productive But Aren't

- Making the upload page pixel-perfect before the pipeline runs end-to-end in replay mode
- Designing the "perfect" Redis key schema instead of shipping the keyspace as documented
- Comprehensive test coverage for code that won't exist in 5 days
- Refactoring synthesis stages before the pipeline is demonstrably working
- "Cleaning up" `personas/mara.ts` without a critic-loop-reviewer sign-off

---

## Operational Moves (Steal CareReel's Winning Patterns)

These are infrastructure choices that signal "this team will ship after May 2." They're cheap to add and they show.

### Multi-API-Key Rotation

`src/lib/forge/keyRotation.ts` is the chokepoint. Every Seed wrapper imports the rotated key from there. Rotation triggers on:
- HTTP 429 (rate limit)
- HTTP 5xx (provider failure)
- HTTP 401/403 (key revoked)
- Per-key per-minute quota threshold (configurable)

State lives in Redis (`pre:keyrot:{provider}`) so rotation persists across worker restarts. This is the pattern CareReel used to survive the demo with a single judge live-running their flow.

### "No Signup, Click to Use" Homepage

`apps/web/src/app/page.tsx` is the public landing. No auth, no waitlist, no email gate. The "Try it" button drops the user directly into `/forge` with a pre-loaded synthetic phantom case. **PRs that add a signup gate to the demo path do not merge.**

### CHANGELOG.md, Daily

`CHANGELOG.md` has one section per day from project start to demo day, formatted like:

```markdown
## 2026-04-30 — Day 3
- feat(personas): mara devil's-advocate scoring, 1-round cap
- feat(critic): lyra anatomical_fidelity threshold + reject/regen budget
- fix(seedance): tier-0 keyframe anchor enforced via test
- chore(replay): seed cache for hip-replacement demo
```

Update at end of each day. Judges who skim the repo see consistent shipping cadence.

### File 2 Issues Back to BytePlus

By demo week, file at least 2 GitHub issues against the `Seed*` SDKs / docs. Real friction we hit, real fixes we'd want. This is a signal to sponsors that we're not a one-off — we engaged with the substrate.

Track candidate issues in `docs/sponsor-feedback.md` as we hit them; file them once we have evidence + minimal repro.

---

## Demo Day (2026-05-02)

### Hard rules

- **By 5 PM demo day** — record the **backup video** via `./scripts/record_backup_video.sh` and **push it to the repo** as `docs/demo-backup.mp4`. **Always.** This is the Wi-Fi-died hedge. PR with it must merge before stage call.
- **Pre-warm by 9 PM the night before** — `python scripts/prewarm_demo.py` seeds the replay cache for the demo case + 2 backups.
- **Dry-run twice in `DEMO_MODE=replay`** + once in `DEMO_MODE=hybrid` before stage call.
- **Never run `DEMO_MODE=live` for the first time on stage.**
- **Stage flag** — flip to `replay` by default, switch to `hybrid` only if the venue Wi-Fi is verified < 100ms RTT to ARK.
- **Backup video must show the same exact 2-minute beats as the locked demo.** Same demo case, same critic regen, same audit-trail PDF.

### Stage checklist (T-30 minutes)

- [ ] `./scripts/demo_mode_switch.sh replay`
- [ ] `npm run check:invariants` — all four green
- [ ] `python scripts/prewarm_demo.py --verify`  — dry-render passes in <90s
- [ ] `git push origin main` — CI green; backup video committed
- [ ] Browser tab open on `/forge` with phantom case pre-staged
- [ ] HUD visible; CriticHud test render shows reject/regen sequence
- [ ] Audit-trail PDF preview cached
- [ ] Backup video file open in OS preview (one-keystroke fallback)

---

## Core Principles

- **Invariants are invariants** — critic loop, Seed pinning + Seedream anchoring, hermetic replay, audit trail. No PR merges without all four.
- **Verticalize, don't generalize** — surgical pre-op explainers, period. The personas + Stage-1 schema diverge from SafetyReel; everything else is shared.
- **Critic loop is the single most important addition** — Mara pre-render + Lyra post-render. The reject/regen sequence on stage is the rubric play. (Item 1.1 in the post-mortem on past finalists.)
- **Demo-driven** — if it doesn't show in 2 min, cut it. The visible critic loop and the audit-trail PDF export are everything.
- **No mocks on the demo path** — real Seed (or cached replay), real Remotion render, real audit PDF.
- **Sponsor integrations are architectural, not checkbox** — Seed 2.0 / Seedream / Seedance / Seed Speech all earn their place. Tavi cites real PMIDs. Gem extracts real anatomical landmarks.
- **Honesty > theater** — synthetic phantom labeled on screen; confidence bands shown not hidden; critic scores surfaced, not suppressed.
- **Density is a goal** — 90s explainer, single render, ≤90s wall-clock at 1080p.
- **Pre-warm the demo** — replay fixtures the night before. Backup video by 5 PM. Always.
- **Quality over speed within the deadline** — a late but undeniable demo beats an on-time but mediocre one. A broken invariant is worse than a missed deadline.

---

## References

- [README.md](./README.md) — public pitch + spec
- `docs/plans/2026-05-02-winning-vertical-v7.md` — vertical-lock plan (parent monorepo)
- `docs/plans/2026-04-28-seed-pivot.md` — original Seed-stack pivot
- `docs/telestudio_architecture_v5_fusion.mermaid` — shared architecture
- Beta Hacks landing — https://betahacks.org/
- BytePlus ModelArk docs — https://docs.byteplus.com/en/docs/ModelArk/
- Open-Generative-AI port (MIT, lens taxonomy attribution) — https://github.com/Anil-matcha/Open-Generative-AI
