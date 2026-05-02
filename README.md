# PreOpReel — AI Pre-Operative Patient Explainer

> **The 90-second animated explainer your surgeon never had time to make.**
> A multi-agent pipeline on the BytePlus Seed stack that turns a surgeon's procedure plan + patient demographics into a personalized, auditable, anatomically-grounded video the patient watches before consenting.

Submission: **Beta University AI Lab — Seed Agents Challenge** (Track 2: Content Automation, fallback Track 1: AI Video Agents). Demo Day: **2026-05-02**, Computer History Museum, Mountain View.

---

## 1. The Problem

- **38% of US adults read below a 6th-grade level**, but informed consent forms average a 12th-grade reading level (Joint Commission, 2024).
- **Patients forget 40–80% of medical information immediately after the consultation** (NIH, *J R Soc Med*).
- **Malpractice claims citing inadequate informed consent average $580K per settlement** (ProAssurance, *2024 Closed Claims Survey*).
- The current state of "patient prep" is a printed PDF, a YouTube link, or a five-minute hallway conversation. Patients sign because they trust the surgeon, not because they understand the procedure.

YouTube has generic videos. Hospitals have static booklets. Specialty clinics film bespoke explainers for $5,000–$25,000 per procedure type and use the same one for every patient. **No one personalizes a pre-op explainer to *this* patient — their anatomy, age, comorbidities, the specific surgical approach.**

## 2. The Solution

Drag the surgeon's procedure plan PDF + patient demographics card into a web form. 90 seconds later, you get a personalized, animated, narrated explainer:

- Anatomical walkthrough of *this patient's* procedure (not a generic body)
- Surgeon's name, voice-cloned greeting via OmniHuman *(optional, opt-in)*
- Each step cited back to the surgeon's written plan with line references
- Confidence-banded anatomical visualizations (we *show* uncertainty, not hide it)
- Audit-trail PDF export — every claim in the script traces to either the procedure plan or a peer-reviewed protocol
- Patient watches; they ask better questions; consent is genuine

**Positioning:** informed-consent **communication tool**, not a medical device. Not diagnostic. Not advisory. The script is bounded — the AI never recommends, only explains what the surgeon already decided.

## 3. Live Demo (the locked 2 minutes)

| Time | Beat | Visual |
| --- | --- | --- |
| 0:00–0:08 | Hook: *"Surgeons spend 8 minutes per patient explaining a procedure. Patients remember 60 seconds. We make those 60 seconds personalized."* | Stat card |
| 0:08–0:18 | Drag procedure-plan PDF (hip replacement, posterior approach, 65yo, BMI 28) + 3 photos in | UI screencast |
| 0:18–0:28 | `AnatomyGraph` builds live — Atlas/Gem labels appear over anatomy fields | JSON tree growing |
| 0:28–0:50 | **Pre-rendered**: 22-second personalized hip-replacement walkthrough with procedure-step overlays + confidence bands | Final MP4 fullscreen |
| 0:50–1:00 | Critic HUD slo-mo: Lyra rejects shot 3 (anatomical fidelity 0.71 < threshold), regen at 0.86 | HUD overlay |
| 1:00–1:10 | Audit PDF export: every script claim cites procedure-plan §2.3 or NIH protocol PMID | PDF preview |
| 1:10–1:30 | Architecture: 6-agent team mermaid + Seed 2.0 / Seedream / Seedance / Seed Speech / OmniHuman lineup | Mermaid diagram |
| 1:30–1:50 | Vision: hip → knee → cardiac → ENT → ophthalmic. Same engine. Procedure library expands. | Three-up grid |
| 1:50–2:00 | Tagline + GitHub URL | End card |

Demo case is a **synthetic phantom patient** clearly labeled as such. We never use real patient data on stage — that's both an ethical and a HIPAA constraint, and we lean into it.

## 4. Why This Is Different

| Alternative | Why we beat it |
| --- | --- |
| **Generic YouTube explainers** | Not personalized to *this* patient's anatomy, surgical approach, or demographics |
| **Hospital booklets** | Static; can't account for patient-specific procedure variations |
| **Bespoke surgical-animation studios** ($5K–$25K/video) | We're $99/explainer; auto-generated; specific to the patient's procedure plan |
| **CareReel** *(Beta Hacks finalist)* | CareReel is *retrospective* (cancer journey memorial). PreOpReel is *prospective* (pre-op explainer). Same emotional vertical, different time direction — extends a validated archetype rather than colliding with it |
| **CrashForensics** *(Beta Hacks finalist)* | CrashForensics reconstructs vehicular incidents from evidence. PreOpReel renders procedure plans into patient-facing comms. Different inputs, different audience, different defensibility need |

**Buyer is not the hospital — it's the malpractice insurance carrier subsidizing it as risk reduction.** ProAssurance + The Doctors Company + MedPro write ~$4B/year in surgical malpractice premiums. Even 0.1% of premium reallocated to consent-comms = $4M ARR.

## 5. Agent Team

Six named agents — same lineup at build-time and runtime. Build-time uses `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; runtime instantiates the same personas as functions in `src/lib/forge/personas/*.ts`.

| Name | Role | Model | What this agent owns |
| --- | --- | --- | --- |
| **Atlas** | Lead / Director architect | Opus | The end-to-end ForgeRun. Holds the procedure-plan persona. Drafts the patient-facing script. Coordinates the other agents. |
| **Tavi** | Tavily Researcher | Sonnet | Pulls peer-reviewed surgical protocols + anatomical norms from medical literature. Caches lookups. Always cites source PMID. |
| **Exa** | Exa neural-search Researcher | Sonnet | Finds similar-procedure animation references for visual style match. Returns semantic neighbors of the procedure family. |
| **Gem** | Gemini Vision + Anatomy | Sonnet | Extracts anatomical landmarks from procedure-plan diagrams. Produces typed `AnatomyGraph` (entities, anatomical relationships, surgical-approach geometry). Computes confidence bands. |
| **Lyra** | Continuity + Vision Critic | Sonnet | Maintains the patient-anatomy continuity bible (same body across all shots). Runs Seed 2.0 Pro Vision critic on every Seedance clip — scores anatomical fidelity, procedure-step compliance, on-screen-text violations. |
| **Mara** | **Devil's Advocate** | Opus *(plan-only, never writes code)* | Critiques every shot list before render. Specific job: find anything in the script that *could* be construed as medical advice (vs. explanation). Submit `Critique` markdown documents; Atlas approves or rejects. |

Communication contract: DMs by name (`SendMessage`), tasks via `TaskCreate`/`TaskUpdate`, blockers as broadcasts. Mara's mode is `plan-only` and her PRs are review-only. The HUD on screen during demo render flashes each agent's status — judges literally see Atlas/Tavi/Exa/Gem/Lyra working.

### Why a Devil's Advocate is non-negotiable for this vertical

Medical content has one failure mode: the script crosses the line from *explaining* the surgeon's plan to *recommending* something. That's the difference between a communication tool and an unregulated medical device. Mara's only job is to flag that line. Few-shot her with 10 known-bad scripts during build — anything starting with "you should" or "consider" gets rejected.

## 6. Seed Model Orchestration

Every Seed surface is used, and each one earns its place. Nothing is checkbox-integrated.

### 6.1 Seed 2.0 Pro / Lite — Director, vision critic, structured outputs

- **Stage 1 — Director persona**: parses surgeon's procedure plan PDF (after Gem's pose extract) + patient demographics card. Outputs a `ShotList` (Zod schema) — logline, beats with `procedure_step_id`, `anatomical_focus`, `camera_angle`, `narrator_line`. Bounded by the Director's system prompt: never invent a step not in the plan; never make a recommendation.
- **Stage 4 — Devil's Advocate critique**: Mara's persona is the *same* Seed 2.0 Pro model with a different system prompt — finds medical-advice creep, ambiguity, hallucination risk. One round, hard cap.
- **Stage 5 — Continuity / entity extraction**: extracts the patient's anatomy, the surgeon's approach, the implant/instrument list as typed entities for the bible.
- **Stage 10 — Vision critic** (Seed 2.0 Pro Vision): samples 4 frames from each Seedance clip, scores against the procedure plan + anatomy bible. Returns `{anatomical_fidelity, procedure_step_compliance, on_screen_text_violations, feedback}`.
- **Streaming + JSON mode** via the OpenAI-compatible ModelArk endpoint at `ARK_BASE_URL`. Strict-schema first; fallback to `json_object` + Zod `safeParse`.

### 6.2 Seedream 5.0 Lite — Anatomical keyframes (Tier-0 anchor)

- **Stage 7 — Storyboard keyframes**: per beat, generates a procedure-step keyframe. Inputs: anatomical landmarks from `AnatomyGraph` + procedure-step description + visual style references from Exa. Patient demographics drive size/posture defaults.
- **Aspect ratio:** 16:9 (the patient watches on a tablet). Future 9:16 for mobile.
- **Identity preservation:** the same patient anatomy is locked across shots via 1–3 reference keyframes per anatomical region (entity bible from Stage 5).
- **Why this is non-negotiable:** Seedream first-frame anchoring is what stops Seedance from inventing organs. Every Seedance call is I2V or T2V-with-ref — never naked T2V.

### 6.3 Seedance 2.0 — Procedure walkthrough video

- **Stage 9 — Generation**: per beat, submit a Seedance job with the keyframe + previous-beat last frame + procedure-step description + cinema-suffix prompt (camera/lens/aperture from Open-Generative-AI lens taxonomy).
- **Multi-reference locking:** keyframe (Seedream) + previous beat's last frame (continuity) + optional anatomical reference image. Identity-locks anatomy across cuts.
- **Beats > 5s** use `seedance-v2.0-extend` (request_id chaining) instead of one long T2V call.
- **Concurrency:** capped at `MAX_CONCURRENT_LANES=3` to bound cost during dry runs.
- **Critic gate:** every clip flows through Lyra's Seed 2.0 Pro Vision critic before acceptance. Below `CRITIC_FIDELITY_THRESHOLD=0.75` → one regen with feedback string. After that, accept and surface the score honestly.

### 6.4 Seed Speech 2.0 — Calm clinician narration

- **Stage 11 — Narration**: VO per beat from the Director's narrator-line field. Voice preset: warm-authoritative. Sample rate: 24kHz PCM (FFmpeg-friendly).
- **Bounded script invariant:** narration text is a strict subset of the procedure-plan + anatomy-bible + peer-reviewed-protocols corpus. Lyra's critic rejects any narrator line that doesn't trace back. (Mara's condition.)
- **Voice presets:** four voices to match common patient comfort preferences (warm-female, warm-male, neutral, soft).

### 6.5 OmniHuman 1.5 — Surgeon greeting beat *(optional, Layer 2)*

- **Stage 11b — Surgeon greeting**: ≤8s opening shot. Inputs: a single still photo of the surgeon (with consent) + a Seed Speech narrator clip. Output: lip-synced talking-head MP4.
- **Why this is killer for trust**: a real surgeon saying "Hi, I'm Dr. Chen, this is what we'll be doing today" is the highest-trust content in healthcare. Most surgeons don't have time to record this for every patient. We make it instant.
- **Cut criterion**: if Phase 0.6 verification produces uncanny-valley output, drop to a static title card with VO. Trust signal > novel signal.
- **Privacy:** surgeon photo upload is opt-in, scoped to their own clinic, with an explicit consent checkbox.

## 7. Architecture

```
PROCEDURE PLAN PDF + PATIENT DEMOGRAPHICS
                │
                ▼
   ┌────────────────────────────┐
   │  Stage 1 — Intake          │  Zod-validated patient + procedure schema
   └─────────────┬──────────────┘
                 ▼
   ┌────────────────────────────┐  Tavi (peer-reviewed protocols)
   │  Stage 2 — Research        │  Exa (similar-procedure visualizations)
   │  (parallel fan-out)        │  Gem (anatomical landmark extraction + confidence bands)
   └─────────────┬──────────────┘  PDF parser (procedure plan)
                 ▼
   ┌────────────────────────────┐
   │  Stage 3 — Director        │  Seed 2.0 Pro → ShotList (Zod)
   │  (Atlas: surgeon-persona)  │
   └─────────────┬──────────────┘
                 ▼
   ┌────────────────────────────┐
   │  Stage 4 — Devil's Advocate│  Mara: Seed 2.0 Pro, plan-only critique
   │  (1 round cap)             │  → revised ShotList
   └─────────────┬──────────────┘
                 ▼
   ┌────────────────────────────┐
   │  Stage 5 — Anatomy Bible   │  Lyra: entity extraction + 1–3 ref images per entity
   └─────────────┬──────────────┘
                 ▼
   ┌────────────────────────────┐
   │  Stage 6 — Cinema Lens     │  Deterministic suffix from ported lens taxonomy
   └─────────────┬──────────────┘  (Open-Generative-AI port, MIT)
                 ▼
   ┌────────────────────────────┐
   │  Stage 7 — Seedream Frames │  Seedream 5.0 → per-beat keyframes
   └─────────────┬──────────────┘  with anatomy refs
                 ▼
   ┌────────────────────────────┐
   │  Stage 8 — Prompt Compiler │  prompt = beat + cinema_suffix
   │                            │  image_refs = [keyframe, ...entityRefs]
   │                            │  video_ref = prevBeat.lastFrame
   └─────────────┬──────────────┘
                 ▼
   ┌────────────────────────────┐
   │  Stage 9 — Seedance        │  Seedance 2.0 (T2V/I2V), ≤3 lanes
   │  (parallel)                │  beats >5s → seedance-v2.0-extend
   └─────────────┬──────────────┘
                 ▼
   ┌────────────────────────────┐
   │  Stage 10 — Vision Critic  │  Seed 2.0 Pro Vision → fidelity score
   │  (1 regen budget)          │  → criticTrace[] for HUD
   └─────────────┬──────────────┘
                 ▼
   ┌────────────────────────────┐
   │  Stage 11 — Narration      │  Seed Speech 2.0 (VO)
   │                            │  Stage 11b — OmniHuman greeting (opt-in, ≤8s)
   └─────────────┬──────────────┘
                 ▼
   ┌────────────────────────────┐
   │  Stage 12 — Remotion       │  React composition + render
   │                            │  Procedure-step overlays
   │                            │  Confidence bands
   │                            │  Citation footer
   │                            │  → 1080p H.264 MP4
   └─────────────┬──────────────┘
                 ▼
   AUDITED EXPLAINER MP4 + AUDIT-TRAIL PDF + DELIVERABLE CARD
   (url, duration, regen_count, critic_scores, cost, citations)
```

Mermaid version: `docs/telestudio_architecture_v5_fusion.mermaid` (architecture is shared across PreOpReel and SafetyReel; only personas + Stage 1 schema differ).

## 8. The 12-Stage Pipeline

| # | Stage | Owner | Model | Notes |
| ---: | --- | --- | --- | --- |
| 1 | Intake + procedure-plan parsing | Atlas | — | Zod schema in `lib/forge/intake.ts` |
| 2a | Tavily peer-review search | Tavi | Tavily API | Cached to `data/grounding-cache/` |
| 2b | Exa neural search | Exa | Exa API | Style-reference matching |
| 2c | Gem anatomical landmark extraction | Gem | Gemini 1.5 Flash | Outputs `AnatomyGraph` with confidence |
| 2d | PDF parser | (deterministic) | — | `pdf-parse` |
| 3 | Director — surgeon persona | Atlas | Seed 2.0 Pro | JSON-mode `ShotList` |
| 4 | Devil's Advocate critique | Mara | Seed 2.0 Pro | 1 round cap |
| 5 | Anatomy bible | Lyra | Seed 2.0 Pro + Seedream 5.0 | Entity cards w/ ref images |
| 6 | Cinema lens enrichment | (deterministic) | — | Lens taxonomy lookup |
| 7 | Storyboard keyframes | Lyra | Seedream 5.0 | Per beat |
| 8 | Prompt compiler | Atlas | — | Compose final Seedance payload |
| 9 | Seedance generation | (worker) | Seedance 2.0 | ≤3 parallel; extend for long beats |
| 10 | Vision critic + self-heal | Lyra | Seed 2.0 Pro Vision | 1 regen budget |
| 11a | Narration | Atlas | Seed Speech 2.0 | Bounded to plan corpus |
| 11b | Surgeon greeting *(opt-in)* | Atlas | OmniHuman 1.5 | ≤8s, cut if uncanny |
| 12 | Composition + render | Lyra | Remotion | 1080p H.264 |

## 9. Critic Loop & KPI

The KPI is **anatomical fidelity** — explicit, on-screen, with provenance:

```ts
{
  anatomical_fidelity: 0..1,           // does the rendered shot match the AnatomyGraph?
  procedure_step_compliance: 0..1,      // does the action match the plan's step?
  on_screen_text_violations: int,       // glyph-soup text in frame; must be 0
  feedback: string                      // ≤120 chars, used to rebuild the prompt
}
```

Decision: `min(scores) < 0.75` OR `on_screen_text_violations > 0` ⇒ regenerate. Budget per beat: 1. Final scores written to `ForgeRun.deliverable.criticTrace[]` and shown in the demo HUD.

Per Mara's condition #2, every overlay number is annotated with a confidence band from the upstream pose/extraction stage. We *show* uncertainty rather than hide it. This is the single biggest trust signal we have.

## 10. Tech Stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 App Router + assistant-ui primitives |
| Backend | Next.js API routes + BullMQ (optional) + in-memory queue |
| Render | Remotion (composition + `renderMedia`) |
| Models | BytePlus Seed 2.0 / Seedream 5.0 / Seedance 2.0 / Seed Speech 2.0 / OmniHuman 1.5 — all via ModelArk |
| Grounding | Tavily (web facts), Exa (neural search), Google Gemini 1.5 Flash (vision) |
| Storage | DigitalOcean Spaces (CDN) + Supabase fallback |
| Deploy | DigitalOcean App Platform or Vercel |
| Schema | Zod for every cross-stage contract |
| Lens taxonomy | Ported from `Anil-matcha/Open-Generative-AI` (MIT, attribution in `LICENSES.md`) |

## 11. Build Sequence (5 days)

| Day | Owner | Deliverable |
| ---: | --- | --- |
| 1 | Atlas + Gem | `lib/forge/anatomyGraph.ts` schema + `procedurePlanPdf.ts` ingestor; synthetic-phantom hip-replacement fixture |
| 2 | Gem + Tavi | Anatomical norms via `biomechReasoner.ts` → `anatomyReasoner.ts`; Tavi peer-reviewed-protocol cache |
| 2 | Atlas | Director persona `personas/atlas-surgical.ts` + Zod ShotList |
| 3 | Lyra | Seedream keyframe pipeline + anatomy-entity-bible carryover |
| 3 | Atlas | Prompt compiler with anatomical refs + cinema-suffix |
| 4 | Lyra | Vision critic loop + anatomical-fidelity HUD |
| 4 | Lyra | Remotion components: `ProcedureStepOverlay`, `AnatomicalLabel`, `ConfidenceBand`, `CitationFooter` |
| 5 | Atlas + Gem | Patient-facing UI; calm narrator preset; pre-render the demo case |
| 5 | Mara | Final Critique pass; demo dry-run; **scrub script for any "you should"/"consider" language** |

Mara reviews each day's PR; Atlas merges or kicks back.

## 12. File Map

```
src/
├── app/
│   ├── api/forge/route.ts                        Surgical-vertical entry
│   └── forge/page.tsx                            Single-page UI
├── lib/forge/
│   ├── anatomyGraph.ts                           AnatomyGraph schema
│   ├── ingestors/
│   │   ├── procedurePlanPdf.ts                   PDF → typed plan
│   │   ├── patientDemographics.ts                Card → typed patient
│   │   └── anatomyExtract.ts                     Gem vision over plan diagrams
│   ├── anatomyReasoner.ts                        Anatomical norms + confidence
│   ├── tavily.ts                                 Tavi client + cache
│   ├── exa.ts                                    Exa client
│   ├── personas/
│   │   ├── atlas-surgical.ts                     Director (surgeon persona)
│   │   ├── tavi.ts                               Researcher
│   │   ├── exa.ts                                Researcher
│   │   ├── gem.ts                                Vision + anatomy
│   │   ├── lyra.ts                               Continuity + critic
│   │   └── mara.ts                               Devil's Advocate
│   ├── lens/                                     Open-Gen-AI port (MIT)
│   ├── compileSeedancePrompt.ts                  Final payload compose
│   ├── critic.ts                                 Vision-critic loop
│   └── types.ts                                  ForgeRun, AnatomyGraph, ShotList, Critique
├── components/
│   ├── PreOpUpload.tsx                           Patient + procedure intake
│   ├── AnatomyGraphViewer.tsx                    Live JSON tree
│   └── CriticHud.tsx                             Live HUD
└── remotion/components/surgical/
    ├── ProcedureStepOverlay.tsx
    ├── AnatomicalLabel.tsx
    ├── ConfidenceBand.tsx
    └── CitationFooter.tsx
```

## 13. Risk Register

| Risk | P | Mitigation |
| --- | ---: | --- |
| FDA regulatory framing | Med | Position as informed-consent communication tool, not a device. Disclaimer on every output. Surgeon approves before patient sees. |
| Anatomical hallucination by Seedance | Med | Seedream keyframe anchoring (Tier-0). All Seedance calls are I2V or T2V-with-ref. Critic rejects below 0.75. |
| Demo case sensitivity | Low | Synthetic phantom patient, clearly labeled. Never use real patient data on stage. |
| Mara approves everything | Med | Few-shot her with 10 known-bad scripts and 5 known-bad shot lists during build. |
| OmniHuman uncanny | High | Optional / opt-in. Cut to title card if Phase 0.6 verification fails. |
| Tavily peer-review hallucination | Low | Hard-coded curated `surgical-protocols-references.json`; Tavi only used for *style* lookups, not protocol values |
| Buyer narrative ("malpractice insurer") feels indirect | Med | Lead with patient-comfort impact; back into insurer TAM math; cite ProAssurance closed-claims survey |
| Demo case = synthetic feels manipulative | Low | Lean into it. "This is a synthetic phantom for the demo; live deployment uses anonymized scans." Honesty > theater. |

## 14. Buyer / Pricing

- **Primary buyer:** surgical malpractice insurance carriers (ProAssurance, MedPro, The Doctors Company). Reframe: patient-explainer videos = documented-consent malpractice defense.
- **Secondary buyer:** outpatient surgery centers, surgical telehealth platforms (Hint, Sesame).
- **Pricing:** $99 per explainer (target). Annual subscription tiers for clinics. Volume discounts for insurer pilots.
- **Comparator:** bespoke surgical-animation studios charge $5,000–$25,000 per procedure type. We're 50–250× cheaper and personalized per patient.
- **TAM proxy:** ~50M outpatient surgeries/year in the US × $99 = $5B addressable. Even 0.1% capture = $5M ARR.

## 15. Tech for Good

- **Health-equity gap:** patients with low health literacy face documented worse outcomes (Berkman et al., *Ann Intern Med*). Personalized comprehension support narrows the gap.
- **Anxiety reduction:** pre-op anxiety correlates with longer recovery (Powell et al., *Cochrane Reviews 2023*). Better understanding reduces it.
- **Cost reduction:** consent-comms litigation accounts for ~12% of surgical malpractice claims (PIAA data). Better consent = fewer claims.

This is not a feel-good wrapper. The literature is clear.

## 16. Open Questions

- [ ] Demo case selection — synthetic phantom (we draft) or licensed simulation case?
- [ ] OmniHuman surgeon greeting — record one (with consent) for the demo or skip to Layer 2?
- [ ] Audit-trail PDF — open-source as a sample document for the GitHub readme?
- [ ] Tavily / Exa API keys provisioned?
- [ ] Pricing card for the demo: $99 or $499?

## 17. References

- v7 vertical lock plan: `docs/plans/2026-05-02-winning-vertical-v7.md`
- v6 vertical analysis (now superseded by v7): `docs/plans/2026-05-02-winning-vertical.md`
- v5 architecture plan: `docs/plans/2026-05-02-fusion-multi-agent.md`
- v5 mermaid diagram: `docs/telestudio_architecture_v5_fusion.mermaid`
- Seed pivot plan: `docs/plans/2026-04-28-seed-pivot.md`
- Beta Hacks landing: [https://betahacks.org/](https://betahacks.org/)
- BytePlus ModelArk docs: [https://docs.byteplus.com/en/docs/ModelArk/](https://docs.byteplus.com/en/docs/ModelArk/)
- Open-Generative-AI port source (MIT): [https://github.com/Anil-matcha/Open-Generative-AI](https://github.com/Anil-matcha/Open-Generative-AI)
- ProAssurance 2024 Closed Claims Survey
- Joint Commission, *Health Literacy and Patient Safety* (2024)
- Berkman ND et al., *Low Health Literacy and Health Outcomes: An Updated Systematic Review*, *Ann Intern Med*

## 18. License

Source code: MIT. Lens taxonomy: ported from `Anil-matcha/Open-Generative-AI` under MIT — attribution in `LICENSES.md`.

This README is a project pitch + technical spec. Implementation tracked in `docs/plans/2026-05-02-winning-vertical-v7.md`.
