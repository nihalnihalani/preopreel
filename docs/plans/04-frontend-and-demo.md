# Plan 04 — Frontend + Remotion + Demo Ops

> Owner: **Frontend + Demo Dev** (PreOpReel team)
> Scope: `apps/web/` (alt. `src/app/`), `src/remotion/`, `scripts/`, `data/fixtures/demo-hip-replacement/`
> Status: planning only — no code yet
> Reads: `README.md` §4 (Live Demo) + §13 (File Map); `CLAUDE.md` §Demo Theater + §Demo Day + §Operational Moves; Invariants 1, 3, 4 are load-bearing for this scope

---

## 0. Operating Constraints (read first)

These constrain every choice below; cite by number when reviewing PRs.

- **C-0** Stage 12 output is 1080p H.264 MP4, 30fps, 16:9, ≤90s wall-clock to render at 1080p. Anything that pushes past 90s is rejected.
- **C-1** No signup, click-to-use. `/` routes a "Try the demo case" CTA straight into `/forge` with the synthetic-phantom hip-replacement fixture pre-staged. PRs adding auth gates on the demo path do not merge.
- **C-2** Critic HUD is on-camera at 0:50–1:00. It MUST read live `pre:critique:*` and `pre:critic:*` Redis writes via SSE — never animation theater. Stop the worker mid-render → HUD freezes mid-update. (Invariant 1.)
- **C-3** Audit-trail PDF export is on-camera at 1:00–1:10. Every claim cited; no exceptions. (Invariant 4.)
- **C-4** Synthetic phantom is labeled on screen. Never hide that it's synthetic; lean into it.
- **C-5** Demo path is hermetic in `DEMO_MODE=replay`. Frontend must work end-to-end against the replay cache with zero outbound non-Seed calls. (Invariant 3.)
- **C-6** Backup video pushed by 5 PM demo day. The recorder script must produce an exact 2:00 screencast of the locked beats and auto-commit.
- **C-7** Dark mode default — looks better on stage. Light mode is not in scope for May 2.
- **C-8** Vertical sibling rule: nothing surgical-specific in `src/remotion/components/` shared utilities. Surgical bits live in `src/remotion/components/surgical/` only. SafetyReel sibling reuses everything else.

---

## Section A — Frontend (Next.js 16 App Router)

### A.1 Routing

App Router under `apps/web/src/app/` (canonical) with a thin re-export at `src/app/` for the convention noted in the README §13 file map. Single source of truth: `apps/web/`.

**Route map:**

| Route | File | Render mode | Purpose |
| --- | --- | ---: | --- |
| `/` | `apps/web/src/app/page.tsx` | RSC, static | Landing. Hero card, "Try the demo case" CTA, "Upload your own" secondary CTA. No signup. CTA primary action: client-side route push to `/forge?seed=demo-hip-replacement`. |
| `/forge` | `apps/web/src/app/forge/page.tsx` | RSC shell + client islands | Main upload + synthesis HUD. Three panels: Upload (left, 320px), AnatomyGraphViewer (center, fluid), CriticHud (right, 480px). On `?seed=demo-hip-replacement`, auto-POST to `/api/forge` with the fixture and redirect to `/forge/{id}`. |
| `/forge/[id]` | `apps/web/src/app/forge/[id]/page.tsx` | RSC shell + client SSE | Bookmarkable run page. Server-fetches `GET /api/forge/{id}` for initial state; client subscribes to `/api/forge/{id}/stream` if `status ∈ {pending, running}`. If `status === done`, renders static deliverable card with links to `/receipt` and `/explainer`. |
| `/forge/[id]/receipt` | `apps/web/src/app/forge/[id]/receipt/page.tsx` | RSC shell + client viewer | Audit-trail PDF preview + download. Embeds `GET /api/forge/{id}/receipt` via `<embed type="application/pdf">` with `react-pdf` fallback. |
| `/forge/[id]/explainer` | `apps/web/src/app/forge/[id]/explainer/page.tsx` | RSC shell + client player | Full-screen MP4 playback. `<video>` source = `GET /api/forge/{id}/explainer.mp4`; chapter markers per `ShotList.beats[]`. |
| `/api/healthz` | (proxied from `apps/api`) | — | Liveness probe; surfaced in `Navbar.tsx` as a green/amber dot reflecting Seed availability + DEMO_MODE. |

**Notes on App Router idioms (Next.js 16):**
- Use `loading.tsx` per route segment for skeleton states (especially `/forge/[id]/loading.tsx` showing the 12-stage scaffold greyed out).
- Use `error.tsx` per route segment with a "fall back to backup video" link wired to `/backup`.
- `force-dynamic` on `/forge/[id]` (SSE-driven). Cache Components / `use cache` are explicitly off for this surface — too dynamic.
- `metadata` export per page (OG image = the demo MP4 thumbnail).

**`/backup`** route (hidden, not in nav): renders `docs/demo-backup.mp4` full-screen. One-keystroke fallback on stage if everything else fails.

### A.2 Components (`apps/web/src/components/`)

Folder layout:

```
apps/web/src/components/
├── PreOpUpload.tsx
├── AnatomyGraphViewer.tsx
├── CriticHud.tsx
├── ReceiptViewer.tsx
├── ExplainerPlayer.tsx
├── Navbar.tsx
├── primitives/                 # shadcn/ui re-exports
│   ├── button.tsx
│   ├── card.tsx
│   ├── badge.tsx
│   ├── progress.tsx
│   ├── scroll-area.tsx
│   ├── tabs.tsx
│   └── tooltip.tsx
└── hud/
    ├── StageRail.tsx           # 12-stage left rail, drives off SSE
    ├── PersonaPills.tsx        # Atlas / Tavi / Exa / Gem / Lyra / Mara live status
    ├── CostMeter.tsx           # cumulative $ per stage (Layer 2)
    └── ConfidenceChip.tsx      # shared 0..1 chip with band tooltip
```

#### A.2.1 `PreOpUpload.tsx`

- Drag-and-drop zone (top): accepts `application/pdf` (procedure plan) up to 10MB.
- Patient demographics card (bottom): structured form fields (age, sex, BMI, comorbidities) **OR** a paste-JSON textarea fallback (validated against the Zod `Patient` schema imported from `src/lib/forge/types.ts`).
- "Try the demo case" button — pre-fills both inputs from `/api/forge?seed=demo-hip-replacement` (server proxies the fixture so the bytes don't ride with the client bundle).
- POST to `/api/forge` (multipart/form-data: `plan.pdf` + `patient.json` blob); on 202, push `/forge/{id}`.
- Synthetic-phantom banner: amber `Badge` reading "SYNTHETIC PHANTOM — DEMO CASE" appears whenever `seed=demo-hip-replacement` is the source. Never hidden; satisfies C-4.
- Validation states: pre-submit Zod parse, inline error chips, disabled submit until both inputs valid.
- Accessibility: keyboard drop alternative ("Choose file"), `aria-live` region for upload progress.

#### A.2.2 `AnatomyGraphViewer.tsx` ★ (demo beat 0:18–0:28)

- Live JSON tree of the `AnatomyGraph` Zod object (Stage 2c output).
- Implementation: hand-rolled tree (no `react-json-tree` runtime cost; ~150 lines). Reasons: (a) we need confidence-band coloring per leaf, (b) we need to flash newly-arrived nodes for 800ms with a soft pulse animation.
- Subscribes via `EventSource` to `/api/forge/{id}/stream` filtered to `stage === "2c"`. On each event, merges the partial graph into local state via a small reducer; expanded paths persist across updates.
- Each landmark node renders: name, confidence chip (0..1, color-banded), source pointer (procedure-plan §X or PMID).
- "Expand all" / "Collapse all" controls; default state expands top 2 levels.
- Empty state: shows the Gem persona pill with a pulsing dot ("Gem is reading the procedure plan…").
- This component is the visible-stream demo beat — judges see `AnatomyGraph` literally building.

#### A.2.3 `CriticHud.tsx` ★ (demo beat 0:50–1:00 — the Invariant-1 wow moment)

Three-panel layout (CSS grid: 1fr 1.2fr 1fr):

- **Left — Mara critiques.** Scrolling list, newest-on-top. Each card: `severity` chip (block/warn/info, color-coded), `category` (advice_creep / uncited_claim / ambiguity / scope_creep / anatomical_invention), `excerpt` (≤200 chars, mono font), `reason`, optional `suggested_revision` collapsible. Subscribes to SSE filtered to `stage === "4"`. Reads from `pre:critique:{forge_run_id}` on initial load via `GET /api/forge/{id}/critique`.
- **Middle — regen sequence card.** Vertical timeline: "Beat 3 rendered → Lyra scores 0.71 → REJECT → regen with feedback → re-render → Lyra scores 0.86 → ACCEPT". Each step is a card; the rejected beat thumbnails are visible (4 sample frames). The regen feedback string is shown verbatim.
- **Right — per-beat score table.** Sticky header. Columns: `beat_id`, `anat_fid`, `step_compl`, `text_violations`, `verdict`. Below-threshold cells render in red; accepted cells in green; the demo case has exactly one row turning red then green. Reads from `pre:critic:{forge_run_id}` via `GET /api/forge/{id}/critic`. Subscribes to SSE filtered to `stage in (10)`.

Honesty rule (per CLAUDE.md §3.3): a 0.78 acceptance is shown as 0.78 — never rounded up, never replaced with a checkmark. ConfidenceChip color band: <0.75 red, 0.75–0.85 amber, ≥0.85 green.

If the worker stops mid-render, the HUD freezes mid-update — proves it's reading real data, not animation. This is non-negotiable polish.

#### A.2.4 `ReceiptViewer.tsx` (demo beat 1:00–1:10)

- Inline PDF preview via `<embed type="application/pdf" src="/api/forge/{id}/receipt" width="100%" height="100%">`.
- Fallback: `react-pdf` `<Document>` + `<Page>` for browsers that block embedded PDFs (Safari is the risk).
- Top bar: "Download PDF" button (`<a href download>`), claim count, citation count, accept-rate.
- Side panel (collapsible): claim list. Each row: `claim_excerpt`, `citation_pointer` (procedure-plan §X | PMID:nnn | curated-ref-id), `accepted_by` (Mara | Lyra | both).
- One-click "Show me an uncited claim" debug button — for stage Q&A, scrolls to the first claim with a citation gap (in the demo there are none, but the button exists to prove the trail is exhaustive).

#### A.2.5 `ExplainerPlayer.tsx` (demo beat 0:28–0:50)

- Native `<video>` element, `controls`, `playsInline`, `muted={false}`, `preload="auto"`.
- `src` = `/api/forge/{id}/explainer.mp4` (signed URL from DO Spaces in prod; local file route in dev).
- Chapter markers per `ShotList.beats[]`: rendered as a custom timeline below the player; clicking a chapter seeks. Each chapter shows the procedure-step label and citation pointer.
- Full-screen toggle: defaults to full-screen entry on `/forge/[id]/explainer`.
- Caption track: `<track kind="captions">` sourced from `narrator_line` per beat (built from the same bounded-narration corpus Seed Speech read).

#### A.2.6 `Navbar.tsx`

- Left: "PreOpReel" wordmark + synthetic-phantom amber badge (demo runs only).
- Center: Seed lineup pill — "Seed 2.0 · Seedream 5.0 · Seedance 2.0 · Seed Speech 2.0". Clickable; opens a tooltip with the SEED_MODELS pin map (read-only mirror of `src/lib/seed/models.ts`).
- Right: `/api/healthz` status dot (green = live, amber = hybrid, blue = replay), DEMO_MODE indicator.

### A.3 Styling

**Stack:** Tailwind v4 + shadcn/ui (Radix primitives). Dark mode default via `next-themes` set to `forcedTheme="dark"` for May 2.

**Inspiration line:** *clinical but not sterile.*

**Design tokens** (Tailwind config `theme.extend`):

- **Color palette** (HSL via shadcn tokens):
  - `--background`: 222 47% 6% (near-black surgical navy)
  - `--foreground`: 210 20% 96% (off-white, easy on stage cameras)
  - `--card`: 222 47% 9%
  - `--border`: 222 32% 18%
  - `--primary`: 188 95% 56% (cyan-teal — clinical, not corporate blue)
  - `--accent`: 28 95% 60% (warm amber — for synthetic-phantom badge + caution)
  - `--success`: 142 71% 45%
  - `--warning`: 38 92% 50%
  - `--destructive`: 0 84% 60% (Lyra below-threshold red)
  - `--muted`: 222 24% 14%
  - `--ring`: 188 95% 56%
- **Type scale** (`Inter Variable` + `JetBrains Mono` for JSON / citations):
  - `text-xs` 12/16, `text-sm` 14/20, `text-base` 16/24, `text-lg` 18/28, `text-xl` 20/28, `text-2xl` 24/32, `text-3xl` 30/36, `text-4xl` 36/40 (hero), `text-5xl` 48/52 (landing hero only).
- **Spacing scale:** Tailwind defaults; component padding standardized at 4 / 6 / 8 increments.
- **Radius:** `--radius: 0.5rem`. Cards 0.75rem. Buttons 0.5rem.
- **Motion:** all transitions 180ms `ease-out`. CriticHud pulse on new event = 800ms one-shot. AnatomyGraph node arrival = 600ms fade + slide.
- **Elevation:** single shadow token `shadow-card: 0 1px 0 hsl(var(--border)) inset, 0 8px 24px -16px hsl(0 0% 0% / 0.4)`.

**Tailwind config file:** `apps/web/tailwind.config.ts` (extending `@repo/ui` if a workspace pkg is added, otherwise local). `globals.css` declares the CSS variables and the `dark` class hook.

**shadcn/ui components to install:** `button`, `card`, `badge`, `progress`, `scroll-area`, `tabs`, `tooltip`, `dialog`, `separator`, `skeleton`, `form` (react-hook-form), `input`, `textarea`, `label`. Initialized via `npx shadcn@latest init` with the New York style and the token map above.

### A.4 State management

- **TanStack Query (`@tanstack/react-query`)** for HTTP — `GET /api/forge/{id}`, `GET /critique`, `GET /critic`, `GET /receipt` (head only), and the `POST /api/forge` mutation. Stale time: 30s for status, Infinity for terminal states. `QueryClientProvider` mounted in `apps/web/src/app/providers.tsx`.
- **Native `EventSource`** for SSE — wrapped in a custom hook `useForgeStream(id)` returning `{ events, status, error, lastEventId }`. The hook reconnects with exponential backoff (1s, 2s, 4s, capped at 8s) and resumes via `Last-Event-ID` header.
- **Zustand only if** a single piece of state must cross routes (e.g., persisted `DEMO_MODE` indicator). Lean: a 30-line store at `apps/web/src/lib/store/demoMode.ts`. No Redux. Most components rely on URL state + Query cache.
- **URL state** via `nuqs` (or hand-rolled `useSearchParams` helpers) for `?seed=`, `?regen=`, `?fullscreen=`.

### A.5 API client (`apps/web/src/lib/api/client.ts`)

Single file; ~250 lines. Typed wrappers around the API surface in `CLAUDE.md §API Surface`. Imports Zod schemas from `src/lib/forge/types.ts` so request/response are validated end-to-end.

```ts
// signature sketch
export const forgeClient = {
  start(input: FormData): Promise<{ forge_run_id: string }>;     // POST /api/forge
  get(id: string): Promise<ForgeRun>;                            // GET /api/forge/{id}
  stream(id: string, onEvent: (e: TraceEvent) => void): () => void; // SSE; returns cancel
  critique(id: string): Promise<Critique[]>;                     // GET /critique
  critic(id: string): Promise<CriticScore[]>;                    // GET /critic
  receiptUrl(id: string): string;                                // GET /receipt (URL only)
  explainerUrl(id: string): string;                              // GET /explainer.mp4
  regen(id: string, beat: number): Promise<{ ok: true }>;        // POST /regen
  health(): Promise<{ ok: true; demo_mode: DemoMode; seed_ok: boolean }>;
};
```

- Errors: thrown `ForgeApiError` with `{ status, code, retryAfter? }`. TanStack Query consumes via `useQuery` retry config (do not retry 4xx).
- `fetch` baseURL: `process.env.NEXT_PUBLIC_API_BASE_URL || ''` (same-origin in dev/prod).
- All response bodies pass through `Schema.parse()` — `safeParse` on the typed paths so a schema drift shows up as a typed error in the UI rather than a render crash.

---

## Section B — Remotion

### B.1 Compositions (`src/remotion/compositions/`)

#### B.1.1 `PreOpExplainer.tsx`

Top-level composition. Properties:

- `width: 1920`, `height: 1080`, `fps: 30`, codec H.264.
- `durationInFrames` computed from `ShotList.totalSeconds * 30` at `calculateMetadata`-time (Remotion 4 API). Bounds: 60–90s (1800–2700 frames).
- Inputs: `forgeRunId: string` and the resolved `ShotList` + `criticTrace` + `narrationManifest` loaded at metadata time from `data/explainers/{id}/manifest.json`.
- Beat sequencing:

```tsx
{shotList.beats.map((beat, i) => (
  <Sequence
    key={beat.id}
    from={beat.startFrame}
    durationInFrames={beat.durationFrames}
    layout="none"
  >
    <BeatLayer beat={beat} criticScore={criticTrace[i]} />
  </Sequence>
))}
```

- `BeatLayer`: video clip (Seedance MP4) + audio (Seed Speech WAV) + overlays (`ProcedureStepOverlay`, `AnatomicalLabel`, `ConfidenceBand`, `CitationFooter`).
- Intro: `<IntroCard durationInFrames={90}>` for 3s.
- Outro: end card with synthetic-phantom disclaimer + GitHub URL (90 frames).

#### B.1.2 `IntroCard.tsx`

3s opener. Animated wordmark, surgeon name from `ShotList.surgeonName`, fallback "PreOpReel — Synthetic Phantom Demo Case" when `ShotList.demo === true`. Procedure title centered. Disclaimer chip: "Informed-consent communication tool. Not a medical device."

### B.2 Components (`src/remotion/components/surgical/`)

All components are pure functions of their props + the current `useCurrentFrame()` value. No imperative animation; use `interpolate`, `spring`, `Easing` from `remotion`. Each ≤120 lines.

#### B.2.1 `ProcedureStepOverlay.tsx`

- Top-left badge. Reads `beat.procedureStepId` and `shotList.procedureSteps[stepId]`.
- Renders: "Step 3 of 7 — Posterior approach". Slides in from the left at `beat.startFrame + 6` over 12 frames; persists; slides out at `beat.endFrame - 12`.
- Style: `bg-card/85 backdrop-blur-sm` rounded badge, 32px tall, mono digit for step number.

#### B.2.2 `AnatomicalLabel.tsx`

- Animated callout pointing at an anatomical region.
- Props: `region: { name: string; x: number; y: number; confidence: number }` from `beat.anatomicalFocus`.
- Renders: line from label to coordinate, label box, and a confidence ring around the target point.
- Animation: `spring()` for the line draw (stiffness 90, damping 14) at frame `beat.startFrame + 18`.
- Identity-locked positioning: coordinates come from `AnatomyGraph` overlay metadata baked into the keyframe — so labels point at the same pixel across regen cycles.

#### B.2.3 `ConfidenceBand.tsx`

- Semi-transparent band overlaid on uncertain landmarks.
- Props: `confidence: number` (0..1), `bbox: { x, y, w, h }`.
- Color: red (<0.75) / amber (0.75–0.85) / green (≥0.85). Opacity = `0.30 - 0.20*confidence` (less opacity for higher confidence — i.e., we hide the band when we're sure, show it when we're not).
- Implements Mara's condition #2: show uncertainty, do not hide it. Comment in source references CLAUDE.md §Invariant 4.

#### B.2.4 `CitationFooter.tsx`

- Bottom strip, 56px tall, full width.
- Reads `beat.citations` (array of `{ kind: "plan"|"pmid"|"ref", pointer: string }`) and `beat.criticScore`.
- Renders, left-to-right: "Source:" label, comma-separated citations, then "Critic Lyra: 0.86" badge.
- Tipo-fast read on stage: 18px mono, line-height 1.2, `text-foreground/80`.
- One row only — if citations overflow, marquee-scroll at 60px/s (Remotion `interpolate` over the beat duration).

#### B.2.5 `IntroCard.tsx`

(Defined in B.1.2.)

### B.3 Render entry (`src/lib/render.ts`)

```ts
export async function renderExplainer(forgeRun: ForgeRun): Promise<Buffer> { ... }
```

- Uses Remotion's `bundle` + `selectComposition` + `renderMedia` programmatically (server-side, not Remotion Studio).
- `inputProps` = `{ forgeRunId: forgeRun.id }`; the composition's `calculateMetadata` resolves the ShotList from disk.
- Codec: `h264`, pixel format `yuv420p`, CRF 18 (visually lossless on a stage projector), audio codec `aac` 192kbps.
- Concurrency: `Math.min(os.cpus().length, 4)` — bounded so we don't starve the synthesis worker on the same box.
- Output: `data/explainers/{forge_run_id}.mp4` for local dev. Production: streamed to DO Spaces via multipart upload, returns a signed URL persisted to `pre:run:{id}.deliverable.url`.
- Telemetry: emits SSE trace events `{ stage: "12", message: "rendered N frames", duration_ms }`.
- Error policy: any render failure leaves the partial MP4 untouched and writes a `render-failed.json` next to it with the stack; the UI's `ExplainerPlayer` falls back to the backup video if `deliverable.url` is null.

### B.4 Audit-trail PDF generator (`src/lib/audit/pdf.ts`)

```ts
export async function buildAuditPdf(forgeRun: ForgeRun): Promise<Buffer> { ... }
```

- Library: `pdf-lib` (no native deps; runs in serverless).
- Layout: one page per claim. Page anatomy:
  - Header: "PreOpReel — Audit Trail · Run {short-id} · {date}".
  - Title block: "Claim {n} of {total}".
  - Body: claim excerpt (verbatim from `narrator_line`, max 280 chars), citation pointer block (`Source: Procedure Plan §2.3` or `Source: NIH PMID 12345678` or `Source: curated-ref-{id}`), accepted-by block (Mara | Lyra | both with timestamps), and a confidence band visualization (small horizontal bar with the same color logic as `ConfidenceBand.tsx`).
  - Footer: page n / N, run id, GitHub URL, "Synthetic phantom demo case" stamp when applicable.
- Cover page: run summary (duration, regen count, total cost, agent participation matrix).
- Final page: "Provenance attestation" — SHA-256 of the rendered MP4 + the ShotList + the AnatomyGraph, plus the timestamps of every Mara/Lyra event.
- Output: `data/explainers/{forge_run_id}.audit.pdf`. Served by `GET /api/forge/{id}/receipt`.
- This is the trust signal that puts PreOpReel above competitors — the PDF is the product surface visible at demo beat 1:00–1:10.

---

## Section C — Demo Ops

### C.1 `scripts/prewarm_demo.py`

**Purpose:** seed the replay cache for the synthetic-phantom hip-replacement case so `DEMO_MODE=replay` produces an identical demo to a live run, then verify the dry render comes in under 90s. Run the night before a demo; re-run on stage with `--verify` at T-30 minutes.

**Steps (verbose):**

1. Load fixture: `data/fixtures/demo-hip-replacement/{plan.pdf, patient.json}` — Zod-parse the patient card; pdf-parse the plan; abort with a typed error if either fails.
2. Generate (or load existing) `forge_run_id = "demo-hip-replacement"` (deterministic id for the demo case so replay keys are stable across reruns).
3. Set `DEMO_MODE=live` for this process only (env override, not on disk).
4. Execute every Seed call once via the synthesis worker's stage runner, in order: 2a (Tavi), 2b (Exa), 2c (Gem), 2d (deterministic), 3 (Atlas Director), 4 (Mara), 5 (Lyra anatomy bible), 6 (lens, deterministic), 7 (Seedream keyframes), 8 (compiler, deterministic), 9 (Seedance), 10 (Lyra critic — including the deliberate one regen), 11a (Seed Speech), 12 (Remotion render).
5. Persist responses: each Seed wrapper, when it sees `PREWARM=1`, writes its raw response into `data/replay/{forge_run_id}/{stage}/{key}.{ext}` keyed by the request hash. The same wrapper, in `replay` mode, looks up by the same hash.
6. Verify the dry render: switch to `DEMO_MODE=replay`, re-run the worker end-to-end, time the wall-clock to MP4. Assert `< 90s`. Print measured time vs. budget.
7. Print a checklist: which fixtures cached (per-stage row with file size + sha256), total Seed cost (sum of per-call cost from the wrapper telemetry), missing artifacts (red rows).
8. Exit code 0 if all stages cached + dry render ≤90s; non-zero otherwise.

**Flags:**

- `--verify` — skip the live execution; only re-run in `replay` mode and compare hashes of every replay artifact against a manifest at `data/replay/{forge_run_id}/manifest.json` (written during the live pass). Used at T-30 minutes before stage.
- `--case <slug>` — defaults to `demo-hip-replacement`; future-proofs for the 2 backup cases (knee, cardiac).
- `--budget-seconds <int>` — overrides the 90s wall-clock budget.
- `--cost-cap <usd>` — abort if estimated Seed spend exceeds N (default 10 USD).
- `--dry-run` — list what would be cached without making calls.

**Output artifacts:**

- `data/replay/demo-hip-replacement/manifest.json` — `{ stage: { key: { file, sha256, bytes, ts } } }`.
- `data/replay/demo-hip-replacement/cost.json` — per-stage USD spend.
- `data/explainers/demo-hip-replacement.mp4` — the dry-rendered MP4.
- `data/explainers/demo-hip-replacement.audit.pdf` — the audit-trail PDF.
- stdout: human-readable checklist (color-coded TTY).

**Implementation file size estimate:** ~280 lines Python.

### C.2 `scripts/demo_mode_switch.sh`

**Purpose:** atomically flip `DEMO_MODE` across the Next.js app and the synthesis worker without restarting both. Used T-30 min and during stage triage.

**Behavior:**

1. Parse arg: `replay | live | hybrid`. Validate.
2. Write `.env.local` (atomic via `mktemp` + `mv`) at repo root with `DEMO_MODE={mode}`. Preserve all other lines.
3. SIGHUP the Next.js dev server PID (read from `.next/server.pid` if present).
4. SIGHUP the synthesis-worker PID (read from `.run/worker.pid`).
5. Curl `/api/healthz` and assert `demo_mode === requested mode`. Retry 3x with 500ms backoff.
6. Print the new mode + Seed availability + a one-line dry-run pointer (`python scripts/prewarm_demo.py --verify`).
7. Exit non-zero on any step failure with a clear remediation hint.

**Safety:** refuses to switch to `live` if `data/replay/demo-hip-replacement/` is missing — prevents the "live first time on stage" footgun. Override with `--force` (which also prints a giant warning).

**File size estimate:** ~80 lines bash.

### C.3 `scripts/record_backup_video.sh`

**Purpose:** record the locked 2-minute demo via Playwright headless Chromium; output `docs/demo-backup.mp4`; auto-commit + push. Hard-required by 5 PM demo day.

**Approach:** thin bash wrapper that drives a Node script `scripts/record_backup_video.mjs` (Playwright + ffmpeg). The bash file is for the team-facing entry point + CI signals.

**Playwright script (exact sequence):**

1. Launch Chromium, viewport 1920×1080, recording enabled at 30fps via `recordVideo`.
2. Navigate to `http://localhost:3000/`. Wait for `text=Try the demo case`.
3. T+0:00 — click "Try the demo case". Hold for the 8s hook beat (the landing card animates the stat card into view).
4. T+0:08 — wait for `/forge` redirect; observe the upload preview pane populating with `plan.pdf` + `patient.json` thumbnails.
5. T+0:18 — wait for `[data-stage="2c"]` SSE marker; scroll the AnatomyGraphViewer to show JSON tree growth for 10 seconds.
6. T+0:28 — click the "Watch explainer" CTA; the ExplainerPlayer goes full-screen with the pre-rendered MP4. Hold 22 seconds.
7. T+0:50 — exit full-screen; bring CriticHud into focus. Use `page.locator('[data-test="critic-hud-regen"]').scrollIntoViewIfNeeded()`; the regen sequence card auto-plays the Lyra reject → regen → accept flow (driven off the cached `pre:critic:*` data).
8. T+1:00 — click "Open audit trail". Receipt page loads; scroll through 3 claim pages.
9. T+1:10 — navigate to `/forge/{id}#architecture`; scroll the architecture mermaid diagram.
10. T+1:30 — scroll to the "Vision" section (hip → knee → cardiac → ENT → ophthalmic three-up grid).
11. T+1:50 — scroll to the end card.
12. T+2:00 — `page.close()`. Stop after exactly 120,000ms ± 200ms (use `setTimeout` + `Date.now()` checkpoint).

**Post-processing:**

- ffmpeg: re-encode H.264 baseline 4.0, 30fps, AAC 192k, two-pass for size; output `docs/demo-backup.mp4`. Target: ≤80 MB so it fits comfortably in the repo.
- Verify duration ∈ [119.5, 120.5] seconds; abort the script otherwise.
- `git add docs/demo-backup.mp4` → commit message `chore(demo): backup video {timestamp}` → `git push origin HEAD`. Use Conventional Commits.
- Post-push: open a PR via `gh pr create --fill` titled `chore(demo): backup video {YYYY-MM-DD}`; CI should pass; auto-merge with `--auto --squash`.

**Failure modes handled:**

- Wi-Fi flake mid-record → retry up to 2x with the worker pre-warmed in `replay` mode.
- Demo path not pre-staged → script aborts before recording with a remediation message ("run prewarm_demo.py first").
- Recording > 80 MB → re-encode at CRF 23.

**File size estimate:** ~60 lines bash + ~220 lines Node.

### C.4 `scripts/verify_audit_trail.py`

**Purpose:** for every shot in `data/replay/{forge_run_id}/`, verify every narrator_line has a citation pointer. Used in CI (Invariant 4 gate).

**Behavior:**

1. Walk `data/replay/` directories (one per forge_run_id).
2. For each, load `shotlist.json` (the persisted Stage 3 output) and `audit.json` (the citation graph derived during the live pass).
3. For every beat, assert: `audit.claims[beat.id]` exists and at least one `citation_pointer` is non-empty and matches one of:
   - `procedure_plan_section`: regex `^§\d+(\.\d+)*$`
   - `pmid`: regex `^PMID:\d{1,9}$`
   - `curated_ref_id`: must exist in `data/surgical-protocols-references.json`.
4. Cross-check: the union of citation pointers in `audit.json` is a subset of the procedure-plan + tavi-cache + curated-refs corpus (no inventions).
5. Emit a typed JSON report to stdout: `{ run_id, beats: [{ id, ok, missing_citations[], invalid_pointers[] }], summary: { total, passing, failing } }`. Non-zero exit if any failure.
6. Pretty-printed TTY output for humans; machine-readable JSON when invoked with `--json`.

**Used in CI:** GitHub Actions step `python scripts/verify_audit_trail.py data/replay/demo-hip-replacement/ --json` — must be `summary.failing === 0` for any PR touching the audit path (CLAUDE.md §Audit-Path Gate).

**File size estimate:** ~140 lines Python.

---

## Section D — Synthetic Phantom Demo Fixture

Path: `data/fixtures/demo-hip-replacement/`. The demo case is a 65-year-old male, BMI 28, total hip arthroplasty via posterior approach, 7 surgical steps. Synthetic phantom — labeled on screen.

### D.1 `plan.pdf` (textual mockup; generated via reportlab in Phase 3)

Contents (single PDF, ~6 pages, generated programmatically so it's reproducible):

- **Page 1 — Cover:** "Procedure Plan · Total Hip Arthroplasty · Posterior Approach". Surgeon name: "Dr. K. Chen, MD (synthetic)". Date: 2026-04-30. Synthetic-phantom watermark.
- **Page 2 — Patient summary:** 65-year-old male, BMI 28, no significant comorbidities, ASA II. Labs (CBC, CMP, INR) normal. Allergies: NKDA.
- **Page 3 — Anatomical landmarks list:** acetabulum (right), femoral head, greater trochanter, lesser trochanter, sciatic nerve, posterior capsule, gluteus maximus, piriformis, short external rotators, hip joint capsule. Each item gets a §-numbered subsection (§3.1, §3.2, …).
- **Page 4 — Surgical approach:** posterior approach, lateral decubitus position, incision from greater trochanter curving posteriorly. §4.1–§4.3.
- **Page 5 — Procedure steps (the 7 the script is built around):**
  1. §5.1 Skin incision and exposure
  2. §5.2 Capsulotomy and dislocation
  3. §5.3 Femoral neck osteotomy
  4. §5.4 Acetabular reaming and cup placement
  5. §5.5 Femoral canal preparation
  6. §5.6 Femoral component insertion and trial reduction
  7. §5.7 Closure and posterior capsular repair
- **Page 6 — Surgeon notes:** anticipated 90-min OR time, expected blood loss 250 mL, post-op weight-bearing as tolerated, posterior precautions for 6 weeks. References: AAOS Clinical Practice Guideline (PMID:34567890).

The reportlab generator script lives at `scripts/generate_demo_plan_pdf.py` (~120 lines) and is invoked once during fixture build; the resulting PDF is committed.

### D.2 `patient.json`

Strictly typed against the Zod `Patient` schema in `src/lib/forge/types.ts`. Sketch:

```json
{
  "id": "phantom-001",
  "synthetic": true,
  "demographics": { "age": 65, "sex": "male", "bmi": 28.1, "height_cm": 178, "weight_kg": 89 },
  "comorbidities": [],
  "allergies": [],
  "asa_class": 2,
  "procedure": {
    "code": "ICD-10-PCS:0SR9019",
    "name": "Total Hip Arthroplasty",
    "approach": "posterior",
    "laterality": "right"
  },
  "surgeon": { "name": "Dr. K. Chen", "synthetic": true },
  "consent_status": "pre-consent",
  "preferences": { "narration_voice": "warm-male" }
}
```

### D.3 `expected.shotlist.json`

What `atlas-surgical.ts` should produce for this case. Used as a snapshot test in `tests/personas/test_atlas_director.ts`.

- 7 beats (one per surgical step) + intro + outro = 9 sequences.
- Total duration 78 seconds (within the 60–90s envelope).
- Each beat has `procedure_step_id`, `anatomical_focus`, `camera_angle`, `narrator_line`, `citations[]`, `confidence_overlay`.
- Logline: "A 90-second walkthrough of your hip-replacement procedure, personalized for your anatomy and your surgeon's plan."

### D.4 `expected.critique.json`

What Mara should produce. Hand-authored to include exactly **one** advice-creep flag for the demo (so the CriticHud has something to show that isn't just zeros).

- 1 entry with `severity: "warn"`, `category: "advice_creep"`, `excerpt: "you may want to consider asking about pain management options"`, `reason: "narrator line uses 'consider' — crosses from explanation into recommendation"`, `suggested_revision: "your surgeon will discuss pain management with you before the procedure"`.
- Atlas applies the suggested revision; the revised ShotList is what Stages 5+ consume.
- 0 `block`-severity entries (we want the demo to flow without a hard rejection at this stage; the hard rejection is reserved for Lyra in Stage 10).

### D.5 `expected.scores.json`

What Lyra should produce per beat. Deliberately one below-threshold score on Beat 3 (Femoral neck osteotomy) to trigger the on-stage regen.

```json
{
  "beats": [
    { "beat_id": "intro", "anatomical_fidelity": 0.94, "procedure_step_compliance": 0.98, "on_screen_text_violations": 0, "feedback": "ok" },
    { "beat_id": "step-1", "anatomical_fidelity": 0.89, "procedure_step_compliance": 0.92, "on_screen_text_violations": 0 },
    { "beat_id": "step-2", "anatomical_fidelity": 0.86, "procedure_step_compliance": 0.91, "on_screen_text_violations": 0 },
    { "beat_id": "step-3-attempt-1", "anatomical_fidelity": 0.71, "procedure_step_compliance": 0.78, "on_screen_text_violations": 0, "feedback": "femoral neck angle drifted; reassert greater-trochanter ref", "verdict": "reject" },
    { "beat_id": "step-3-attempt-2", "anatomical_fidelity": 0.86, "procedure_step_compliance": 0.91, "on_screen_text_violations": 0, "verdict": "accept" },
    { "beat_id": "step-4", "anatomical_fidelity": 0.92, "procedure_step_compliance": 0.94, "on_screen_text_violations": 0 },
    { "beat_id": "step-5", "anatomical_fidelity": 0.90, "procedure_step_compliance": 0.93, "on_screen_text_violations": 0 },
    { "beat_id": "step-6", "anatomical_fidelity": 0.88, "procedure_step_compliance": 0.90, "on_screen_text_violations": 0 },
    { "beat_id": "step-7", "anatomical_fidelity": 0.91, "procedure_step_compliance": 0.95, "on_screen_text_violations": 0 },
    { "beat_id": "outro", "anatomical_fidelity": 0.96, "procedure_step_compliance": 0.97, "on_screen_text_violations": 0 }
  ]
}
```

### D.6 `frames/` (4 sample frames per beat)

Layout: `data/fixtures/demo-hip-replacement/frames/{beat_id}/{0,1,2,3}.png`. ~10 directories × 4 frames = 40 PNGs. Rendered from a placeholder Remotion run during fixture build (script: `scripts/render_demo_frames.ts`). Resolution 1920×1080. Total size on disk: ~40 MB; we accept that for fixture realism.

### D.7 `audio/` (Seed Speech narration WAVs)

Layout: `data/fixtures/demo-hip-replacement/audio/{beat_id}.wav`. 24kHz PCM mono, ~3–10s per beat. Total ~78s = ~3.7 MB. Generated once via the live Seed Speech call during prewarm; checked in so dev environments without ARK keys can still render the demo MP4.

### D.8 Fixture invariants

- Every file Zod-validated by a fixture-loader at build time (`scripts/validate_fixtures.ts`).
- Frames + audio total ≤ 50 MB; tracked by Git LFS once the repo is configured.
- Synthetic-phantom flag appears in patient.json AND on every page of plan.pdf AND in the IntroCard composition.

---

## Section E — Files to Create in Phase 3

Exact list with line-count estimates. Phase 3 is where the implementation lands; this plan is the contract.

### E.1 Frontend (`apps/web/src/`)

| File | LOC est. |
| --- | ---: |
| `app/layout.tsx` (root layout, providers, fonts) | 80 |
| `app/page.tsx` (landing) | 120 |
| `app/forge/page.tsx` (main HUD shell) | 110 |
| `app/forge/loading.tsx` | 40 |
| `app/forge/error.tsx` | 30 |
| `app/forge/[id]/page.tsx` | 130 |
| `app/forge/[id]/loading.tsx` | 30 |
| `app/forge/[id]/error.tsx` | 30 |
| `app/forge/[id]/receipt/page.tsx` | 70 |
| `app/forge/[id]/explainer/page.tsx` | 60 |
| `app/backup/page.tsx` (hidden one-keystroke fallback) | 40 |
| `app/providers.tsx` (TanStack Query, theme) | 50 |
| `app/globals.css` (tokens) | 120 |
| `components/PreOpUpload.tsx` | 260 |
| `components/AnatomyGraphViewer.tsx` | 220 |
| `components/CriticHud.tsx` | 320 |
| `components/ReceiptViewer.tsx` | 140 |
| `components/ExplainerPlayer.tsx` | 160 |
| `components/Navbar.tsx` | 90 |
| `components/hud/StageRail.tsx` | 110 |
| `components/hud/PersonaPills.tsx` | 80 |
| `components/hud/CostMeter.tsx` | 70 |
| `components/hud/ConfidenceChip.tsx` | 50 |
| `components/primitives/*.tsx` (shadcn re-exports, ~10 files) | 40 each / 400 total |
| `lib/api/client.ts` | 250 |
| `lib/hooks/useForgeStream.ts` | 110 |
| `lib/hooks/useForgeRun.ts` | 60 |
| `lib/store/demoMode.ts` (zustand) | 30 |
| `lib/format/citation.ts` (citation pointer formatter) | 60 |
| `tailwind.config.ts` | 120 |
| `next.config.ts` (image domains, MDX, SSE buffering off) | 50 |
| **Subtotal** | **~3,330** |

### E.2 Remotion (`src/remotion/`)

| File | LOC est. |
| --- | ---: |
| `Root.tsx` (composition registration) | 40 |
| `compositions/PreOpExplainer.tsx` | 220 |
| `compositions/BeatLayer.tsx` | 130 |
| `components/surgical/IntroCard.tsx` | 100 |
| `components/surgical/ProcedureStepOverlay.tsx` | 90 |
| `components/surgical/AnatomicalLabel.tsx` | 110 |
| `components/surgical/ConfidenceBand.tsx` | 70 |
| `components/surgical/CitationFooter.tsx` | 100 |
| `components/shared/EndCard.tsx` (vertical-shared outro) | 80 |
| `lib/render.ts` (renderMedia entry) | 180 |
| `lib/audit/pdf.ts` (pdf-lib audit-trail) | 280 |
| `remotion.config.ts` | 30 |
| **Subtotal** | **~1,430** |

### E.3 Demo Ops (`scripts/` + `data/fixtures/`)

| File | LOC est. |
| --- | ---: |
| `scripts/prewarm_demo.py` | 280 |
| `scripts/demo_mode_switch.sh` | 80 |
| `scripts/record_backup_video.sh` | 60 |
| `scripts/record_backup_video.mjs` (Playwright driver) | 220 |
| `scripts/verify_audit_trail.py` | 140 |
| `scripts/generate_demo_plan_pdf.py` (reportlab) | 120 |
| `scripts/render_demo_frames.ts` | 90 |
| `scripts/validate_fixtures.ts` | 80 |
| `data/fixtures/demo-hip-replacement/plan.pdf` (generated) | — |
| `data/fixtures/demo-hip-replacement/patient.json` | 30 |
| `data/fixtures/demo-hip-replacement/expected.shotlist.json` | 220 |
| `data/fixtures/demo-hip-replacement/expected.critique.json` | 30 |
| `data/fixtures/demo-hip-replacement/expected.scores.json` | 70 |
| `data/fixtures/demo-hip-replacement/frames/*` (40 PNGs) | — |
| `data/fixtures/demo-hip-replacement/audio/*` (10 WAVs) | — |
| **Subtotal (code only)** | **~1,420** |

### E.4 Tests (this scope only)

| File | LOC est. |
| --- | ---: |
| `tests/web/test_pre_op_upload.tsx` | 120 |
| `tests/web/test_anatomy_graph_viewer.tsx` | 140 |
| `tests/web/test_critic_hud.tsx` (the demo-day-critical one) | 220 |
| `tests/web/test_receipt_viewer.tsx` | 80 |
| `tests/web/test_explainer_player.tsx` | 80 |
| `tests/remotion/test_intro_card.ts` | 60 |
| `tests/remotion/test_procedure_step_overlay.ts` | 70 |
| `tests/remotion/test_anatomical_label.ts` | 70 |
| `tests/remotion/test_confidence_band.ts` | 60 |
| `tests/remotion/test_citation_footer.ts` | 70 |
| `tests/remotion/test_render_pipeline.ts` | 100 |
| `tests/audit/test_pdf_completeness.ts` | 120 |
| `tests/scripts/test_prewarm_demo.py` | 110 |
| `tests/scripts/test_verify_audit_trail.py` | 100 |
| `tests/e2e/test_demo_path.ts` (Playwright; mirrors record_backup_video) | 220 |
| **Subtotal** | **~1,720** |

### E.5 Docs (this scope only)

| File | LOC est. |
| --- | ---: |
| `docs/demo-runbook.md` (beat-by-beat 2 minutes; commands per beat) | 200 |
| `docs/demo-fixtures.md` (synthetic-phantom rationale + how to add a backup case) | 120 |
| `docs/audit-trail-sample.pdf` (committed export) | — |
| **Subtotal** | **~320** |

### E.6 Grand total for Phase 3 (this scope)

~**8,200 LOC** across ~70 source files + ~50 generated/binary fixture files. Realistic for the 5-day window with the team composition in CLAUDE.md (Frontend Dev + Demo Dev + Vision Dev partial).

---

## F. Build Order (this scope)

This subset of the global build order in CLAUDE.md §Sequential Dependencies. Numbered to slot in.

1. **Day 2 evening** — `apps/web/tailwind.config.ts`, `globals.css`, shadcn primitives, `Navbar.tsx`, `app/layout.tsx`, `app/page.tsx`. Visual shell only; no API yet.
2. **Day 3 morning** — `lib/api/client.ts` + `useForgeStream.ts` + `useForgeRun.ts` against the `/api/forge` mocks. `PreOpUpload.tsx` wired end-to-end against the synthesis worker in `replay` mode (worker delivered Day 2 by Synthesis Dev).
3. **Day 3 afternoon** — `AnatomyGraphViewer.tsx` against real Stage 2c SSE events. `app/forge/page.tsx` + `app/forge/[id]/page.tsx`.
4. **Day 4 morning** — `CriticHud.tsx` against real Stage 4 + Stage 10 events (depends on Personas Dev landing `mara.ts` + `lyra.ts`). The Invariant-1 demo surface — non-negotiable.
5. **Day 4 afternoon** — Remotion components (`IntroCard`, `ProcedureStepOverlay`, `AnatomicalLabel`, `ConfidenceBand`, `CitationFooter`). `BeatLayer` + `PreOpExplainer`.
6. **Day 4 evening** — `lib/render.ts` end-to-end: replay → MP4 in <90s.
7. **Day 5 morning** — `lib/audit/pdf.ts` + `ReceiptViewer.tsx` + `ExplainerPlayer.tsx`. The 1:00–1:10 demo beat.
8. **Day 5 afternoon** — `scripts/prewarm_demo.py`, `demo_mode_switch.sh`, `verify_audit_trail.py`, demo fixture finalization.
9. **Day 5 evening** — `scripts/record_backup_video.sh` produces `docs/demo-backup.mp4`. Pushed by 5 PM.

Hard checkpoint: by end of Day 4, the full demo path runs end-to-end in `replay` mode in a real browser. Day 5 is polish + scripts + backup video. If Day 4 EOD doesn't render the demo, escalate to Lead — likely cut OmniHuman + cost meter to recover.

---

## G. Risk Register (this scope)

| Risk | P | Mitigation |
| --- | ---: | --- |
| `<embed>` PDF preview blocked in Safari | Med | `react-pdf` fallback wired from day one. |
| SSE buffering by Next.js / proxies | High | Set `Cache-Control: no-cache, no-transform` on `/stream`; disable Next response buffering; test on stage Wi-Fi. |
| Remotion render >90s at 1080p | Med | CRF 18 → CRF 20 fallback; pre-render the demo case via prewarm so stage doesn't render live. |
| `pdf-lib` truetype font embed adds 4MB to bundle | Low | Use built-in StandardFonts for body; embed `Inter` only on the cover. |
| Playwright recording drift (browser auto-update) | Med | Pin `@playwright/test` version; cache `playwright install` output in CI; record nightly to catch drift. |
| Backup video > 80MB blocks repo push | Low | ffmpeg two-pass with size cap; abort + re-encode at higher CRF. |
| `CriticHud` reads stale Redis on initial paint | Med | Server-component initial fetch from `/critique` + `/critic` populates first paint; SSE catches up live. |
| Synthetic-phantom label hidden by full-screen video | Low | Persist amber badge in the player chrome; assert in e2e test. |
| Confidence-band over-occlusion at low confidence | Low | Cap opacity at 0.30; test on stage projector before May 2. |
| `data/fixtures` PNG/WAV bloat in git | Med | Track via Git LFS; document in README; `.gitattributes` committed before fixtures. |

---

## H. Acceptance Criteria (Demo Day)

These must all be true by 5 PM 2026-05-02 or we fall back to backup video:

- [ ] `/` → `/forge?seed=demo-hip-replacement` → `/forge/{id}` flow works in `DEMO_MODE=replay` end-to-end.
- [ ] `AnatomyGraphViewer` populates from real Stage 2c SSE events (cached) within 10s of run start.
- [ ] `CriticHud` shows the Mara warn-severity card AND the Lyra reject(0.71)/regen/accept(0.86) sequence on Beat 3, sourced from cached `pre:critique:*` and `pre:critic:*`.
- [ ] `ExplainerPlayer` plays the rendered MP4 full-screen, 1080p, ~78s, with chapter markers and captions.
- [ ] `ReceiptViewer` renders the audit-trail PDF with 1 page per claim; every claim has a citation pointer; download works.
- [ ] `npm run check:invariants` passes: Invariant 1 (critic on-camera), Invariant 3 (replay branches), Invariant 4 (audit trail) all green.
- [ ] `python scripts/prewarm_demo.py --verify` exits 0 with dry render < 90s.
- [ ] `docs/demo-backup.mp4` exists on `main`, exactly 2:00 ± 0.5s.
- [ ] Synthetic-phantom badge visible in Navbar AND in IntroCard AND on every page of audit PDF.
- [ ] Stage rehearsal: 2 dry runs in `replay`, 1 in `hybrid`. All three complete without manual intervention.

---

## File written

Absolute path: `/Users/nihalnihalani/Desktop/Github/preopreel/docs/plans/04-frontend-and-demo.md`

## Executive summary

- **Three-panel `/forge` HUD is the entire frontend surface that matters** — `PreOpUpload` left, `AnatomyGraphViewer` center (the 0:18–0:28 visible-stream beat), `CriticHud` right (the 0:50–1:00 Invariant-1 wow beat); `ReceiptViewer` and `ExplainerPlayer` carry the 1:00–1:10 audit beat and the 0:28–0:50 playback beat respectively, all dark-mode "clinical but not sterile" tokens, TanStack Query + native EventSource for state.
- **Remotion stack is five surgical overlay components plus a `BeatLayer` driven by `Sequence`s**; render entry `src/lib/render.ts` uses `renderMedia` to produce the 1080p H.264 MP4 in <90s wall-clock; audit-trail PDF (`src/lib/audit/pdf.ts`, pdf-lib) emits one page per claim with citation pointer, accepting critic, and confidence band — the trust signal that puts PreOpReel above competitors.
- **Demo ops are four scripts**: `prewarm_demo.py` (seeds replay + verifies <90s render), `demo_mode_switch.sh` (atomic flip across web + worker, refuses unsafe `live` switch), `record_backup_video.sh` + Playwright driver (exact 2:00 screencast, auto-commits to `docs/demo-backup.mp4` by 5 PM rule), and `verify_audit_trail.py` (CI-gating Invariant 4).
- **Synthetic-phantom hip-replacement fixture is fully specified**: 6-page reportlab-generated `plan.pdf`, Zod-typed `patient.json`, snapshot-able `expected.{shotlist,critique,scores}.json` with deliberate 1× advice-creep warn (Mara) and 1× below-threshold Beat 3 (Lyra) so the demo always has something to show — labeled as synthetic on every surface (Navbar badge, IntroCard, every page of the audit PDF).
- **Phase 3 budget: ~8,200 LOC across ~70 files** in 5 days, with a hard checkpoint at end of Day 4 that the full demo path runs end-to-end in replay mode; all four invariants (critic loop on-camera, Seed pinning + Seedream anchoring observed by `lib/render.ts` consumers, hermetic `DEMO_MODE=replay`, exhaustive audit trail) flow into explicit acceptance criteria gating Demo Day.
