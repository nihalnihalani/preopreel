# PreOpReel — End-to-End Architecture (Mermaid)

> Canonical system diagram. Critic gates explicit (red, thick-bordered).
> Butterbase substrate at the bottom. `withReplay` shim as a chokepoint.
> Read top-to-bottom. Mirrors `docs/plans/00-master-plan.md` §7.

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
        APIStream["/api/forge/{id}/stream<br/>GET SSE w/ heartbeat"]
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

## Highlights

- **Two critic gates** (Stage 4 Mara · Stage 10 Lyra) are red and
  thick-bordered. They are the rubric play (Invariant 1 — 40% of judging).
- **`withReplay()` chokepoint** sits between the worker and ModelArk;
  the demo runs in `replay` mode reading filesystem + Butterbase Storage
  fixtures.
- **Tier-0 keyframe anchoring** (Stage 7) is highlighted blue —
  Invariant 2's sub-rule means every Stage-9 Seedance call is I2V or
  T2V-with-ref. Naked T2V is rejected at compile-time by
  `compileSeedancePrompt`.
- **Butterbase substrate** holds 10 tables, the rendered MP4 + audit PDF
  in Storage, and realtime channels feeding the CriticHud directly
  (bypassing the SSE proxy for the demo's most latency-sensitive surface).
- **Redis Stream is SSE-only** — `pre:trace:{forge_run_id}` carries
  versioned trace events to the AnatomyGraphViewer; everything else
  lives in Butterbase.
