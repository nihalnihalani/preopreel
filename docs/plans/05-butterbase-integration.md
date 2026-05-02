# Plan 05 — Butterbase Integration (Persistence + Auth + Storage Backbone)

> **Owner:** Butterbase Dev (Phase 3 of the 5-day build)
> **Status:** Planning. No code yet. Wired through Atlas before Phase 3 day 1.
> **Scope:** Butterbase becomes the source of truth for everything except SSE trace events (which stay in Redis at `pre:trace:{forge_run_id}`). Replaces the DigitalOcean Spaces + Supabase fallback line item in README §11 for the demo path; DO Spaces remains as a CDN edge optionally fronting Butterbase Storage signed URLs.
> **Promo:** $20 credit via `BUTTERBASE0502` (ALL CAPS). Hackathon submission attribution code: `butterbase0502` (lowercase) — set in project metadata.
> **Why now:** Phase 3 wires `replay.ts` (Invariant 3) and the `CriticHud` realtime path (Invariant 1). Both want a managed Postgres + Storage + Realtime substrate. Butterbase ships all three behind one MCP server, so Claude Code can provision the schema by natural-language prompt during the build session — the schema in §B becomes a single MCP `apply_migration` call.

---

## A. MCP Setup

### A.1 `.mcp.json` (project root)

The project does not yet have a `.mcp.json`. Create one with the Butterbase server registered. The exact contents to land in Phase 3 day 1:

```json
{
  "mcpServers": {
    "butterbase": {
      "command": "npx",
      "args": [
        "-y",
        "@smithery/cli@latest",
        "run",
        "butterbase/butterbase",
        "--key",
        "${BUTTERBASE_API_KEY}",
        "--profile",
        "${BUTTERBASE_PROJECT_ID}"
      ],
      "env": {
        "BUTTERBASE_API_KEY": "${BUTTERBASE_API_KEY}",
        "BUTTERBASE_PROJECT_ID": "${BUTTERBASE_PROJECT_ID}"
      }
    }
  }
}
```

Notes:

- The Smithery server URL is `https://smithery.ai/servers/butterbase/butterbase`. Smithery hosts a thin CLI wrapper so Claude Code can spawn the MCP transport over stdio without a local install.
- `BUTTERBASE_API_KEY` is the project's service-role key (see §A.3). It is sensitive. Never commit `.mcp.json` with the key inlined — always reference the env var with `${...}`.
- `BUTTERBASE_PROJECT_ID` is the Butterbase project handle, used by the MCP server to scope every tool call.
- **Open question for Atlas:** confirm the exact Smithery package coordinate (`butterbase/butterbase`) and whether the Butterbase team also publishes a non-Smithery MCP entry (`@butterbase/mcp` or similar) we should prefer for offline dev. Verify on Phase 3 day 1 by running `npx -y @smithery/cli@latest list | grep butterbase`.

### A.2 Obtaining `BUTTERBASE_API_KEY` + `BUTTERBASE_PROJECT_ID`

Phase 3 day 1, in order:

1. Sign up at `https://butterbase.dev/signup` (or whatever the canonical signup is — verify; the Smithery listing should link to it).
2. In the dashboard, **Billing → Promo Codes** — apply `BUTTERBASE0502` (ALL CAPS). $20 credit lands.
3. **Settings → Project Metadata** — set the hackathon submission attribution code `butterbase0502` (lowercase) in the field labeled "Hackathon Submission" (or equivalent — verify field name). This is how Butterbase attributes the project to the Beta Hacks submission for sponsor scoring.
4. Create a new project: name `preopreel`, region `us-east-1` (closest to the Computer History Museum demo network).
5. **Settings → API Keys** — copy:
   - **Service Role Key** → `BUTTERBASE_API_KEY` (server-side only, never shipped to the browser)
   - **Anon Key** → `BUTTERBASE_ANON_KEY` (public; used by the no-signup demo path in `apps/web`)
   - **Project URL** → `BUTTERBASE_PROJECT_URL` (e.g., `https://<project>.butterbase.app`)
   - **Project ID** → `BUTTERBASE_PROJECT_ID`
6. **Storage → Buckets** — create `preopreel-renders` (public read with signed URLs, see §C).

### A.3 `claude mcp add` (one-line registration)

After `.mcp.json` is committed, register the server with Claude Code's local MCP runtime:

```bash
claude mcp add butterbase \
  --transport stdio \
  --command "npx -y @smithery/cli@latest run butterbase/butterbase --key ${BUTTERBASE_API_KEY} --profile ${BUTTERBASE_PROJECT_ID}"
```

**Open question for Atlas:** `claude mcp add` syntax has shifted across Claude Code releases. Verify the exact command on Phase 3 day 1 with `claude mcp --help`. If `--transport stdio` is not the right flag name in our installed version, fall back to editing `~/.claude/mcp_servers.json` directly (it mirrors `.mcp.json` shape).

### A.4 `.env.example` additions

Append to `.env.example` (do not commit a real `.env`):

```bash
# ─── Butterbase (persistence + auth + storage) ───────
BUTTERBASE_PROJECT_URL=https://<project>.butterbase.app
BUTTERBASE_PROJECT_ID=
BUTTERBASE_API_KEY=                       # service role; server-side only
BUTTERBASE_ANON_KEY=                      # public anon; used by /forge demo path
BUTTERBASE_STORAGE_BUCKET=preopreel-renders
BUTTERBASE_REGION=us-east-1               # match the Butterbase project region
BUTTERBASE_REALTIME_URL=                  # auto-derived from PROJECT_URL; override for self-hosted
```

The four required keys (`PROJECT_URL`, `PROJECT_ID`, `API_KEY`, `ANON_KEY`) gate Butterbase initialization in `src/lib/butterbase/client.ts`. Missing any of them throws at module load — fail fast, don't silently degrade.

---

## B. Schema (Postgres tables provisioned via Butterbase MCP)

All ten tables live in `butterbase/migrations/0001_initial_schema.sql`. Butterbase RLS uses Postgres' standard `CREATE POLICY` syntax with two built-in roles (`anon` and `service_role`) — same shape as Supabase. Service role bypasses RLS; anon is enforced.

Conventions:
- All `id` columns are `uuid DEFAULT gen_random_uuid()`.
- All `forge_run_id` columns are `uuid REFERENCES forge_runs(id) ON DELETE CASCADE`.
- All tables have RLS enabled.
- Timestamps are `timestamptz DEFAULT now()`.

### B.1 `forge_runs`

The root row. One per `/api/forge` ingest. Status transitions through the 12 stages.

```sql
CREATE TYPE forge_run_status AS ENUM (
  'queued', 'running', 'completed', 'failed', 'cancelled'
);

CREATE TYPE forge_run_demo_mode AS ENUM (
  'live', 'replay', 'hybrid'
);

CREATE TABLE forge_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  status                 forge_run_status NOT NULL DEFAULT 'queued',
  stage                  text NOT NULL DEFAULT 'intake',
  demo_mode              forge_run_demo_mode NOT NULL DEFAULT 'live',
  durations_ms           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { "stage_1": 412, "stage_2c": 1209, ... }
  cost_usd               jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { "stage_3": 0.012, "stage_9": 0.84, ... }
  error                  text,
  explainer_mp4_url      text,                                  -- signed URL, 7d TTL
  audit_trail_pdf_url    text                                   -- signed URL, 7d TTL
);

CREATE INDEX idx_forge_runs_created_at ON forge_runs (created_at DESC);
CREATE INDEX idx_forge_runs_status     ON forge_runs (status);

ALTER TABLE forge_runs ENABLE ROW LEVEL SECURITY;

-- anon: SELECT own row by id (no list)
CREATE POLICY forge_runs_anon_select ON forge_runs
  FOR SELECT TO anon
  USING (true);   -- id is a uuid; lookup-by-id is the only practical access pattern

-- service_role bypasses RLS; explicit policy for documentation:
CREATE POLICY forge_runs_service_all ON forge_runs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

**Note on the `anon SELECT USING (true)` shape:** the demo path is no-signup, click-to-use. Anyone with a `forge_run_id` (an unguessable uuid) can read the row. This is the same threat model Stripe uses for unauthenticated checkout sessions — uuid is the capability. Post-MVP per-clinic auth (§E.2) adds a `clinic_id` column and tightens this policy.

### B.2 `procedure_plans`

The parsed surgeon procedure plan (Stage 1 + Stage 2d output).

```sql
CREATE TABLE procedure_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id    uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  pdf_url         text NOT NULL,                          -- bucket path, signed on read
  parsed_json     jsonb NOT NULL,                         -- typed ProcedurePlan (Zod-validated server-side)
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_procedure_plans_forge_run_id ON procedure_plans (forge_run_id);

ALTER TABLE procedure_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY procedure_plans_anon_select ON procedure_plans
  FOR SELECT TO anon
  USING (forge_run_id IS NOT NULL);

CREATE POLICY procedure_plans_service_all ON procedure_plans
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

### B.3 `patient_demographics`

Synthetic phantom card per ForgeRun. **`synthetic_phantom = true` is enforced at the application layer for the demo path**, but we keep the column nullable-false with a default of `true` so the demo case never accidentally persists with `false`.

```sql
CREATE TABLE patient_demographics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id       uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  age                int NOT NULL CHECK (age >= 0 AND age <= 130),
  sex                text NOT NULL CHECK (sex IN ('female', 'male', 'intersex', 'unspecified')),
  bmi                numeric(5,2) CHECK (bmi >= 10 AND bmi <= 80),
  comorbidities      text[] NOT NULL DEFAULT ARRAY[]::text[],
  synthetic_phantom  boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_patient_demographics_forge_run_id ON patient_demographics (forge_run_id);

ALTER TABLE patient_demographics ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_demographics_anon_select ON patient_demographics
  FOR SELECT TO anon USING (true);

CREATE POLICY patient_demographics_service_all ON patient_demographics
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### B.4 `anatomy_graphs`

Stage 2c output (Gem). One row per ForgeRun.

```sql
CREATE TABLE anatomy_graphs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id             uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  graph_json               jsonb NOT NULL,                  -- typed AnatomyGraph (Zod)
  confidence_distribution  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { "p50": 0.82, "p10": 0.61, "below_threshold_count": 2 }
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_anatomy_graphs_forge_run_id ON anatomy_graphs (forge_run_id);

ALTER TABLE anatomy_graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY anatomy_graphs_anon_select ON anatomy_graphs
  FOR SELECT TO anon USING (true);

CREATE POLICY anatomy_graphs_service_all ON anatomy_graphs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### B.5 `shot_lists`

Stage 3 + Stage 4 output. Two rows per ForgeRun in the common case: `version = 1, created_by = 'atlas'` then `version = 2, created_by = 'atlas-after-mara'`. This is the receipt for "Mara's critique caused a measurable diff" — judges can pull the audit row and see both versions.

```sql
CREATE TABLE shot_lists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id    uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  version         int NOT NULL DEFAULT 1,
  shot_list_json  jsonb NOT NULL,                            -- typed ShotList (Zod)
  created_by      text NOT NULL CHECK (created_by IN ('atlas', 'atlas-after-mara')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (forge_run_id, version)
);

CREATE INDEX idx_shot_lists_forge_run_id ON shot_lists (forge_run_id);

ALTER TABLE shot_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY shot_lists_anon_select ON shot_lists
  FOR SELECT TO anon USING (true);

CREATE POLICY shot_lists_service_all ON shot_lists
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### B.6 `critiques`

**One row per Mara flag.** Replaces the Redis `pre:critique:{forge_run_id}` list as the source of truth. Redis remains as the SSE-driving cache; the database row is the durable audit record.

```sql
CREATE TYPE critique_severity AS ENUM ('block', 'warn', 'info');

CREATE TYPE critique_category AS ENUM (
  'advice_creep',
  'uncited_claim',
  'ambiguity',
  'scope_creep',
  'anatomical_invention'
);

CREATE TABLE critiques (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id         uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  shot_id              text NOT NULL,
  severity             critique_severity NOT NULL,
  category             critique_category NOT NULL,
  excerpt              text NOT NULL CHECK (length(excerpt) <= 200),
  reason               text NOT NULL CHECK (length(reason) <= 200),
  suggested_revision   text,
  persona              text NOT NULL DEFAULT 'mara' CHECK (persona = 'mara'),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_critiques_forge_run_id        ON critiques (forge_run_id);
CREATE INDEX idx_critiques_forge_run_severity  ON critiques (forge_run_id, severity);

ALTER TABLE critiques ENABLE ROW LEVEL SECURITY;

CREATE POLICY critiques_anon_select ON critiques
  FOR SELECT TO anon USING (true);

CREATE POLICY critiques_service_all ON critiques
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### B.7 `critic_scores`

**One row per Lyra evaluation per beat per regen attempt.** A beat that fails first eval and passes after regen has two rows: `regen_attempt = 0` (rejected) and `regen_attempt = 1` (accepted). The receipt page shows both — that's the Invariant-1 wow moment in tabular form.

```sql
CREATE TABLE critic_scores (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id                uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  beat_id                     text NOT NULL,
  regen_attempt               int  NOT NULL DEFAULT 0 CHECK (regen_attempt >= 0 AND regen_attempt <= 1),
  anatomical_fidelity         numeric(4,3) NOT NULL CHECK (anatomical_fidelity >= 0 AND anatomical_fidelity <= 1),
  procedure_step_compliance   numeric(4,3) NOT NULL CHECK (procedure_step_compliance >= 0 AND procedure_step_compliance <= 1),
  on_screen_text_violations   int NOT NULL DEFAULT 0 CHECK (on_screen_text_violations >= 0),
  feedback                    text NOT NULL CHECK (length(feedback) <= 120),
  accepted                    boolean NOT NULL,
  persona                     text NOT NULL DEFAULT 'lyra' CHECK (persona = 'lyra'),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (forge_run_id, beat_id, regen_attempt)
);

CREATE INDEX idx_critic_scores_forge_run_id ON critic_scores (forge_run_id);
CREATE INDEX idx_critic_scores_forge_beat   ON critic_scores (forge_run_id, beat_id);

ALTER TABLE critic_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY critic_scores_anon_select ON critic_scores
  FOR SELECT TO anon USING (true);

CREATE POLICY critic_scores_service_all ON critic_scores
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### B.8 `audit_citations`

Powers the `GET /api/forge/{id}/receipt` audit-trail PDF (Invariant 4). Every claim → source pointer.

```sql
CREATE TYPE citation_source AS ENUM (
  'procedure_plan',
  'pmid',
  'curated_protocol'
);

CREATE TABLE audit_citations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forge_run_id       uuid NOT NULL REFERENCES forge_runs(id) ON DELETE CASCADE,
  claim_id           text NOT NULL,
  narrator_excerpt   text NOT NULL,
  source_type        citation_source NOT NULL,
  pointer            text NOT NULL,                  -- "§2.3" | "PMID:30429547" | "curated:hip-posterior-v1"
  confidence_lo      numeric(4,3) CHECK (confidence_lo >= 0 AND confidence_lo <= 1),
  confidence_hi      numeric(4,3) CHECK (confidence_hi >= 0 AND confidence_hi <= 1),
  CHECK (confidence_lo IS NULL OR confidence_hi IS NULL OR confidence_lo <= confidence_hi)
);

CREATE INDEX idx_audit_citations_forge_run_id  ON audit_citations (forge_run_id);
CREATE INDEX idx_audit_citations_source_type   ON audit_citations (source_type);

ALTER TABLE audit_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_citations_anon_select ON audit_citations
  FOR SELECT TO anon USING (true);

CREATE POLICY audit_citations_service_all ON audit_citations
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

### B.9 `replay_fixtures`

The persistence layer for `withReplay()` (Invariant 3). **Service-role only**: the anon role never reads or writes here — these are upstream cached responses, not user-visible state.

```sql
CREATE TYPE replay_codec AS ENUM ('json', 'mp4', 'png', 'wav', 'pdf');

CREATE TABLE replay_fixtures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage       text NOT NULL,                     -- 'seedance', 'seedream', 'ark.director', etc.
  key         text NOT NULL,                     -- sha256 hash of input payload (deterministic)
  codec       replay_codec NOT NULL,
  bytes       bytea,                              -- inline if < 64 KiB
  storage_url text,                               -- signed URL into preopreel-renders/replay/...
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stage, key)
);

CREATE INDEX idx_replay_fixtures_stage_key ON replay_fixtures (stage, key);

ALTER TABLE replay_fixtures ENABLE ROW LEVEL SECURITY;

-- Explicit deny for anon; only service_role can touch.
CREATE POLICY replay_fixtures_service_only ON replay_fixtures
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

Either `bytes` or `storage_url` is non-null; never both. Threshold = 64 KiB. JSON fixtures are inline; mp4/png/wav are storage-backed.

### B.10 `omnihuman_consents`

Surgeon-photo consent ledger. **Post-MVP** — no UI in Layer 1. Provisioned in 0001 for forward-compat so the migration is a no-op when Layer 2 lands.

```sql
CREATE TABLE omnihuman_consents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  surgeon_id          text NOT NULL,                          -- post-MVP auth maps to clinic JWT sub
  photo_storage_url   text NOT NULL,
  consent_signed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_omnihuman_consents_surgeon_id ON omnihuman_consents (surgeon_id);

ALTER TABLE omnihuman_consents ENABLE ROW LEVEL SECURITY;

-- Surgeon-scoped (post-MVP). For now: service-only.
CREATE POLICY omnihuman_consents_service_only ON omnihuman_consents
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Post-MVP: replace with JWT-scoped policy
-- CREATE POLICY omnihuman_consents_surgeon_self ON omnihuman_consents
--   FOR ALL TO authenticated
--   USING (surgeon_id = auth.jwt() ->> 'sub')
--   WITH CHECK (surgeon_id = auth.jwt() ->> 'sub');
```

---

## C. Storage

### C.1 Bucket layout (`preopreel-renders`)

One bucket. Path-prefixed namespaces. Mirrors what the synthesis worker emits.

| Prefix | Contents | Visibility |
| --- | --- | --- |
| `explainers/{forge_run_id}.mp4` | Final 1080p H.264 explainer MP4 (Stage 12 output) | Signed URL, 7d TTL |
| `audit/{forge_run_id}.pdf` | Audit-trail PDF (every claim cited; Invariant 4 deliverable) | Signed URL, 7d TTL |
| `keyframes/{forge_run_id}/{beat_id}.png` | Seedream Stage 7 keyframes (Tier-0 anchors) | Service-role only |
| `uploads/{forge_run_id}/plan.pdf` | Original surgeon procedure plan upload | Service-role only |
| `replay/{forge_run_id}/{stage}/{key}.{ext}` | Replay-fixture mirror for `withReplay()` (Invariant 3) | Service-role only |

Path conventions are exact — `src/lib/butterbase/client.ts` builds them via a single `bucketPath()` helper so every read/write site agrees.

### C.2 Public-read policy (signed URLs)

- `explainers/*.mp4` and `audit/*.pdf` are **signed-URL accessible**, never public-list. The signed URL is generated lazily, per request, by `getForgeRun(id)` in `src/lib/butterbase/client.ts` (see §D.2). TTL = 7 days.
- All other prefixes (`keyframes/*`, `uploads/*`, `replay/*`) are **service-role only** — never reachable from the browser.
- The Butterbase Storage RLS rule shape mirrors Postgres:

```sql
-- Pseudo-SQL; exact Butterbase Storage policy DSL TBD on Phase 3 day 1.
-- See "open question" below.
CREATE POLICY storage_explainers_anon_signed ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'preopreel-renders' AND name LIKE 'explainers/%');

CREATE POLICY storage_audit_anon_signed ON storage.objects
  FOR SELECT TO anon
  USING (bucket_id = 'preopreel-renders' AND name LIKE 'audit/%');

CREATE POLICY storage_uploads_service ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'preopreel-renders');
```

**Open question for Atlas:** Butterbase Storage may or may not expose Postgres-style policies on `storage.objects`. Some providers (e.g., R2) want a separate IAM policy DSL. Verify on Phase 3 day 1 by inspecting the Butterbase Storage admin UI or asking the MCP server `list_storage_policy_shapes`.

---

## D. Server-Side Client (`src/lib/butterbase/client.ts`)

### D.1 Initialization

A typed singleton wrapping the Butterbase JS SDK. Service-role for server-side; anon for browser-side.

```ts
// src/lib/butterbase/client.ts (sketch — finalize on Phase 3 day 1)
import { createClient, type ButterbaseClient } from "@butterbase/js"; // package name TBD

let _server: ButterbaseClient | null = null;
let _browser: ButterbaseClient | null = null;

export function butterbaseServer(): ButterbaseClient {
  if (_server) return _server;
  const url = requireEnv("BUTTERBASE_PROJECT_URL");
  const key = requireEnv("BUTTERBASE_API_KEY");          // service role — server only
  _server = createClient(url, key, { realtime: { enabled: false } });
  return _server;
}

export function butterbaseBrowser(): ButterbaseClient {
  if (_browser) return _browser;
  const url = requireEnv("NEXT_PUBLIC_BUTTERBASE_PROJECT_URL");
  const key = requireEnv("NEXT_PUBLIC_BUTTERBASE_ANON_KEY");
  _browser = createClient(url, key, { realtime: { enabled: true } });
  return _browser;
}
```

**Open question for Atlas:** confirm the actual NPM package name. Candidates in order of likelihood: `@butterbase/js` (Supabase pattern), `@butterbase/sdk`, `butterbase`. Check `https://www.npmjs.com/~butterbase` and the Smithery server README on Phase 3 day 1. Until confirmed, use `BUTTERBASE_SDK_PACKAGE` as a placeholder in the build config.

### D.2 Typed accessors

All accessors live in `src/lib/butterbase/client.ts` and are imported by the synthesis worker, the API routes, and the receipt-PDF generator.

```ts
// Forge runs
async function persistForgeRun(run: ForgeRun): Promise<{ id: string }>;
async function updateForgeRunStage(id: string, stage: string, durationMs: number): Promise<void>;
async function updateForgeRunStatus(id: string, status: ForgeRunStatus, error?: string): Promise<void>;
async function getForgeRun(id: string): Promise<ForgeRunWithDetails>;   // joins critique + critic_score + audit_citation rows

// Stage outputs
async function persistProcedurePlan(forgeRunId: string, plan: ProcedurePlan, pdfUrl: string): Promise<void>;
async function persistPatientDemographics(forgeRunId: string, card: PatientCard): Promise<void>;
async function persistAnatomyGraph(forgeRunId: string, graph: AnatomyGraph): Promise<void>;
async function persistShotList(
  forgeRunId: string,
  shotList: ShotList,
  createdBy: "atlas" | "atlas-after-mara"
): Promise<{ version: number }>;

// Critic loop (Invariant 1)
async function persistCritique(forgeRunId: string, critique: Critique): Promise<void>;
async function persistCriticScore(
  forgeRunId: string,
  beatId: string,
  score: CriticScore,
  regenAttempt: 0 | 1
): Promise<void>;

// Audit trail (Invariant 4)
async function persistAuditCitation(forgeRunId: string, citation: AuditCitation): Promise<void>;

// Replay fixtures (Invariant 3)
async function getReplayFixture(stage: string, key: string): Promise<Buffer | null>;
async function setReplayFixture(stage: string, key: string, codec: ReplayCodec, bytes: Buffer): Promise<void>;

// Storage (signed URLs returned, never the raw bucket path)
async function uploadExplainerMp4(forgeRunId: string, bytes: Buffer): Promise<{ signedUrl: string; expiresAt: Date }>;
async function uploadAuditPdf(forgeRunId: string, bytes: Buffer): Promise<{ signedUrl: string; expiresAt: Date }>;
async function uploadKeyframe(forgeRunId: string, beatId: string, bytes: Buffer): Promise<{ path: string }>;
async function uploadProcedurePlanPdf(forgeRunId: string, bytes: Buffer): Promise<{ path: string }>;

// Receipt page join — single round-trip for the receipt PDF generator
type ForgeRunWithDetails = ForgeRun & {
  procedure_plan: ProcedurePlanRow;
  patient_demographics: PatientDemographicsRow;
  anatomy_graph: AnatomyGraphRow;
  shot_lists: ShotListRow[];        // both versions
  critiques: CritiqueRow[];
  critic_scores: CriticScoreRow[];  // all regen attempts
  audit_citations: AuditCitationRow[];
};
```

`getForgeRun(id)` is a single Postgres query using `select(... critiques(*), critic_scores(*), audit_citations(*))` Butterbase nested-select syntax (Supabase-shape) — one round trip, joined client-side. It's the only call the receipt-page route makes.

### D.3 Realtime subscription (replaces SSE for critic events)

Butterbase realtime sync over the `critiques` and `critic_scores` tables drives `CriticHud.tsx`. SSE remains the channel for **stage-progression trace events** (timer ticks, persona-status updates), but per-Mara-flag and per-Lyra-score updates flow through Butterbase realtime — fewer moving parts on stage, server-pushed without SSE keep-alive headaches.

```ts
// src/lib/butterbase/realtime.ts (sketch)
export function subscribeCriticHud(forgeRunId: string, on: {
  onCritique:   (row: CritiqueRow)    => void;
  onCriticScore: (row: CriticScoreRow) => void;
}): () => void {
  const client = butterbaseBrowser();
  const channel = client
    .channel(`critic-hud:${forgeRunId}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "critiques",     filter: `forge_run_id=eq.${forgeRunId}` }, (p) => on.onCritique(p.new))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "critic_scores", filter: `forge_run_id=eq.${forgeRunId}` }, (p) => on.onCriticScore(p.new))
    .subscribe();
  return () => { channel.unsubscribe(); };
}
```

**Hard rule:** if Butterbase realtime is unreliable on the demo network, replay mode falls back to a 200ms polling interval against the same tables (still through the Butterbase REST endpoint). Coded in §H risk #2.

### D.4 Edge function — `recordCriticEvent`

Deployed to Butterbase edge functions. Called by the synthesis worker on each Mara/Lyra event. Handles the dual-write atomically: DB row + realtime broadcast in one transaction so the HUD never sees a row before realtime fires (or vice versa).

```ts
// butterbase/functions/recordCriticEvent.ts (deployed via MCP `deploy_edge_function`)
export default async function (req: Request): Promise<Response> {
  const { forgeRunId, kind, payload } = await req.json();
  // kind = "critique" | "critic_score"
  // payload = Critique | CriticScore (Zod-validated server-side)

  const sb = serviceRoleClient();
  await sb.rpc("record_critic_event", { forge_run_id: forgeRunId, kind, payload });
  // The RPC is a single-statement INSERT inside Postgres — Butterbase realtime fires automatically
  // off the WAL replication slot, no manual broadcast needed.
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
```

**Why an edge function and not a direct REST call?** Two reasons. (1) The synthesis worker is in `apps/synthesis-worker` and may run on DigitalOcean App Platform — keeping the Butterbase write atomic with realtime broadcast (one RPC, one WAL event) avoids the worker holding two connections. (2) The edge function is a clean kill-switch: if Butterbase has an outage, the worker logs to Redis as before and the HUD degrades to SSE; no app-code change.

---

## E. Auth Path

### E.1 No auth on demo path (Layer 1 — MUST SHIP)

The `/forge` and `/forge/[id]` routes use **`BUTTERBASE_ANON_KEY` only**. No signup, no waitlist, no email gate. The "Try it" button on the homepage drops the user directly into `/forge` with the synthetic phantom case pre-staged. Matches the CareReel pattern (CLAUDE.md §Operational Moves) and the §15 file-map's `forge/page.tsx` "no signup, click-to-use" annotation.

The anon-key threat model:
- Anyone can **insert nothing** — `forge_runs` only allows service_role INSERT. Browser-side anon clients can SELECT by id.
- The `id` is a uuid, so listing is impractical even if RLS were removed.
- Server-side `/api/forge` POST holds the service-role key, validates the upload, and writes the row. Browser only ever reads.

### E.2 Per-clinic JWT auth (post-MVP — SHOULD NOT SHIP for May 2)

Spec only. Wired in Layer 2 / post-hackathon.

```ts
// Middleware sketch — DO NOT IMPLEMENT for May 2 demo
// apps/web/src/middleware.ts
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path.startsWith("/clinic")) {
    const token = req.cookies.get("bb_session")?.value;
    if (!token) return NextResponse.redirect(new URL("/clinic/signin", req.url));
    // Verify Butterbase JWT signature + expiry; attach surgeon_id to request headers
  }
  return NextResponse.next();
}
```

Auth providers (Layer 2): Butterbase native email-OTP for surgeon onboarding, Google OAuth for clinic SSO. Maps to `omnihuman_consents.surgeon_id` and a future `clinic_id` column on `forge_runs`. **Not in scope for May 2.**

---

## F. Migrations + Idempotency

### F.1 `butterbase/migrations/0001_initial_schema.sql`

All ten tables from §B in one file. Run via the Butterbase MCP tool — likely `butterbase_apply_migration` or `apply_migration`. Verify exact name on Phase 3 day 1 by introspecting the MCP tool list:

```bash
# Inside Claude Code session after .mcp.json loads butterbase
# Check which tool name is registered:
> /mcp tools butterbase
```

**Open question for Atlas:** The Butterbase MCP may expose any of: `apply_migration`, `butterbase_apply_migration`, `db_run_sql`, `execute_sql`. The migration file content is canonical; the tool name is a thin wrapper. If no MCP tool fits, fall back to direct SQL via the `pg` Node client connecting through `BUTTERBASE_PROJECT_URL` (Butterbase exposes a Postgres connection string under Settings → Database).

### F.2 `butterbase/migrations/0002_seed_fixtures.sql`

Pre-loads the synthetic-phantom hip-replacement demo fixture rows so `prewarm_demo.py` is idempotent (rerun = same end state, no duplicate inserts). Uses `INSERT ... ON CONFLICT DO NOTHING` keyed by `(forge_run_id, version)` for `shot_lists` and by `id` for the run itself.

```sql
-- 0002_seed_fixtures.sql (sketch)
INSERT INTO forge_runs (id, status, stage, demo_mode, durations_ms, cost_usd, explainer_mp4_url, audit_trail_pdf_url)
VALUES (
  '00000000-0000-0000-0000-00000d3m0001'::uuid,           -- demo case 1: hip replacement
  'completed',
  'render',
  'replay',
  '{"stage_1": 220, "stage_2c": 1809, "stage_3": 920, "stage_4": 410, "stage_7": 6200, "stage_9": 38400, "stage_10": 1100, "stage_12": 8200}'::jsonb,
  '{"total": 0.84}'::jsonb,
  'https://placeholder/explainer.mp4',
  'https://placeholder/audit.pdf'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO patient_demographics (forge_run_id, age, sex, bmi, comorbidities, synthetic_phantom)
VALUES ('00000000-0000-0000-0000-00000d3m0001', 65, 'female', 28.0, ARRAY['hypertension'], true)
ON CONFLICT DO NOTHING;

-- ... shot_lists, critiques, critic_scores, audit_citations seeded similarly
```

`prewarm_demo.py` invokes this migration plus the file-system replay-fixture seed. Running it twice = same DB state.

### F.3 Rollback strategy

Every migration file has a `down.sql` companion:

- `butterbase/migrations/0001_initial_schema.down.sql` — drops the 10 tables in reverse FK order plus the four `CREATE TYPE` statements.
- `butterbase/migrations/0002_seed_fixtures.down.sql` — `DELETE FROM ... WHERE id IN (demo uuids)`.

Migrations are versioned in a `butterbase_migrations` ledger table the MCP tool maintains automatically (Supabase pattern). Rollback = `apply_migration --down 0002`.

---

## G. Phase 3 Execution Steps (Butterbase Dev — Day 1 of Phase 3)

Numbered, in order. Each step has an explicit verification.

1. **Install Butterbase MCP locally** — write `.mcp.json` per §A.1. Verify by reading the file back: `cat .mcp.json | jq .mcpServers.butterbase.command` returns `"npx"`.

2. **Run `claude mcp add butterbase ...`** — see §A.3 for the command. Verify with `claude mcp list | grep butterbase`. **Open question:** confirm exact CLI flag set.

3. **Create Butterbase project + apply promo + set submission code** — §A.2 steps 1–6. Verify:
   - Dashboard → Billing shows `+$20.00 credit (BUTTERBASE0502)`.
   - Settings → Project Metadata shows `submission: butterbase0502`.
   - Settings → API Keys shows three keys (service, anon, project URL).

4. **Through MCP, request schema provisioning.** In a Claude Code session:
   > "Provision the schema in `butterbase/migrations/0001_initial_schema.sql` on the `preopreel` Butterbase project. Use the `apply_migration` tool. Verify all ten tables, four enums, ten indexes, and ten RLS policies are created."

   Verify the migration return value lists each `CREATE TABLE` and `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` line as applied.

5. **Verify via the Butterbase dashboard** — Tables tab shows ten tables with the right column counts; Policies tab shows the RLS policies; Indexes tab shows the indexes. Spot-check `forge_runs.demo_mode` is the enum, not `text`.

6. **Install JS SDK** — `npm install @butterbase/js` (verify package name first; see §D.1 open question). If the package name differs, update this step plus `src/lib/butterbase/client.ts` imports.

7. **Implement `src/lib/butterbase/client.ts`** — typed singleton + all accessors from §D.2. Add `tests/butterbase/test_persist.ts` covering: `persistForgeRun`, `persistCritique`, `persistCriticScore`, `getForgeRun` join shape.

8. **Wire `withReplay()` to Butterbase** — `src/lib/forge/replay.ts` calls `getReplayFixture` / `setReplayFixture` instead of touching `data/replay/*` filesystem cache. The filesystem cache becomes a Layer-2 pre-population mechanism only (writes through to Butterbase on first read). Add `tests/synthesis-worker/test_replay_branch.ts` extension covering the Butterbase code path.

9. **Wire CriticHud realtime subscription** — `src/components/CriticHud.tsx` calls `subscribeCriticHud(forgeRunId, ...)` from `src/lib/butterbase/realtime.ts`. SSE `pre:trace:*` remains for stage-progression updates; critic events flow through realtime. Verify by triggering a manual `INSERT INTO critiques` from the Butterbase dashboard SQL editor and watching the HUD update live.

10. **End-to-end test with the demo fixture** — `npm test -- e2e/test_demo_smoke.ts` — drives a full ForgeRun in `DEMO_MODE=replay`, persists every stage to Butterbase, renders the explainer MP4, generates the audit PDF, and reads `getForgeRun(id)` to verify the receipt page has every join populated. Pass = green; fail = block the PR.

---

## H. Risks & Mitigations

### H.1 Butterbase MCP doesn't expose the exact tool we need

**Risk:** The MCP server may not expose `apply_migration` directly — it might expose only `query_table`, `insert_row`, etc. We need raw SQL DDL access for the schema in §B.

**Mitigation:** Fallback to direct SQL via the `pg` Node client connecting through `BUTTERBASE_PROJECT_URL`. Butterbase, like Supabase, exposes a Postgres connection string under Settings → Database. The migration files in `butterbase/migrations/` are canonical regardless of which path applies them. Add `npm run db:migrate` script that hits whichever channel works.

**Detection:** Phase 3 day 1, step 4 above. If the MCP tool list doesn't include a SQL-DDL tool, switch to the `pg` channel before proceeding to step 5.

### H.2 Butterbase realtime isn't reliable enough for the on-stage demo

**Risk:** Realtime over the Computer History Museum venue Wi-Fi has historically been a coin-flip. WebSocket reconnect storms during a live demo would break the HUD.

**Mitigation, three layers:**

1. **`DEMO_MODE=replay` persists fixtures**, including pre-rendered critic events. The HUD reads from a local cache during the on-stage demo — realtime is a should-ship, not must-ship, on the demo path.
2. **Polling fallback** — if Butterbase realtime fails to connect within 2s, `subscribeCriticHud` falls back to a 200ms polling loop against the same tables via REST. Same data, marginally higher latency.
3. **Backup video** (CLAUDE.md §Demo Day) — recorded by 5 PM demo day with the realtime path frozen. Wi-Fi-died hedge.

### H.3 Storage signed-URL TTL doesn't cover the demo window

**Risk:** A 7-day signed URL generated during prewarm at T-12h would still be valid at demo time, but if the dashboard or dry-run regenerates one with a shorter TTL, it could expire mid-demo.

**Mitigation:** Generate signed URLs **lazily, per request**, inside `getForgeRun(id)`. Never cache a URL longer than the request that consumes it. This means a fresh signed URL per receipt-page render, per MP4 stream-start. TTL stays at 7d as a backstop, but the demo path never relies on the backstop.

### H.4 Promo code already applied or submission code wrong

**Risk:** Someone applies `BUTTERBASE0502` from a different account; or the submission field is named differently in the dashboard than expected.

**Mitigation:**
- **Phase 3 day 1, step 3** has explicit verification: "Dashboard → Billing shows `+$20.00 credit (BUTTERBASE0502)`." If it shows `$0.00` or "code already used", file with Butterbase support immediately and use a fresh account.
- For the submission code, if the field labeled "Hackathon Submission" doesn't exist, look for "Project Tag", "Attribution Code", or "Promo Reference" in Settings. If none of those exist, contact Butterbase support — the code must be attributable for sponsor scoring.

### H.5 Schema drift between Butterbase and `src/lib/forge/types.ts`

**Risk:** The Zod schemas in `src/lib/forge/types.ts` (`ForgeRun`, `Critique`, `CriticScore`, etc.) drift from the Postgres column shapes. A Critique with a new field gets persisted but reading it back loses the field, or vice versa.

**Mitigation:** Generate TypeScript types from the Butterbase schema using `npx butterbase gen types > src/lib/butterbase/database.types.ts` (Supabase pattern; verify exact CLI). Pin the generation step in `package.json` `prebuild`. Deviations between `database.types.ts` and `types.ts` fail typecheck.

### H.6 SDK package name unverified

**Risk:** `@butterbase/js` may not be the actual package name. Build fails on Phase 3 day 1 step 6.

**Mitigation:** Resolve before Phase 3 day 1 by pinging `mcp__plugin_context7_context7__query-docs` for Butterbase SDK docs, or by reading the Smithery server README, or by `npm search butterbase`. If the package is not yet published, fall back to `pg` + `node-fetch` against the REST API; spec a minimal handcrafted client wrapper. Loss of realtime in that fallback would be a §H.2 mitigation trigger.

---

## I. Files to Create in Phase 3 (Exact List + Line-Count Estimates)

| File | Purpose | LOC est. |
| --- | --- | ---: |
| `.mcp.json` | Project-root MCP config registering Butterbase | ~25 |
| `.env.example` (update) | Append the 6 Butterbase env vars from §A.4 | +12 |
| `butterbase/migrations/0001_initial_schema.sql` | All 10 tables, 4 enums, 10 indexes, 10 RLS policies | ~280 |
| `butterbase/migrations/0001_initial_schema.down.sql` | Drop in reverse FK order | ~40 |
| `butterbase/migrations/0002_seed_fixtures.sql` | Synthetic-phantom hip-replacement demo seed | ~120 |
| `butterbase/migrations/0002_seed_fixtures.down.sql` | DELETE the seeded ids | ~25 |
| `butterbase/functions/recordCriticEvent.ts` | Edge function for atomic dual-write | ~60 |
| `src/lib/butterbase/client.ts` | Typed singleton + all accessors from §D.2 | ~340 |
| `src/lib/butterbase/realtime.ts` | `subscribeCriticHud` + polling fallback | ~110 |
| `src/lib/butterbase/database.types.ts` | Generated types (do not edit by hand) | ~250 |
| `src/lib/butterbase/index.ts` | Barrel export | ~15 |
| `tests/butterbase/test_persist.ts` | Round-trip tests for every accessor | ~220 |
| `tests/butterbase/test_replay_fixture.ts` | `withReplay()` against Butterbase storage | ~90 |
| `tests/butterbase/test_realtime_critic.ts` | HUD subscription + polling fallback | ~140 |
| `docs/butterbase-runbook.md` | Phase 3 day 1 playbook + dashboard screenshots | ~200 |
| **Total new** | | **~1,927 LOC** |

Updates to existing files (not new):
- `src/lib/forge/replay.ts` — switch storage backend from filesystem to Butterbase (~40 LOC delta)
- `src/components/CriticHud.tsx` — wire realtime subscription (~30 LOC delta)
- `apps/api/route.ts` (`/api/forge/{id}/receipt`) — call `getForgeRun(id)` (~25 LOC delta)
- `scripts/prewarm_demo.py` — apply 0002 migration + warm fixtures (~50 LOC delta)
- `package.json` — add `db:migrate`, `db:gen-types` scripts; depend on `@butterbase/js` (~10 LOC delta)
- `.gitignore` — confirm `.env*` is ignored (it should already be)
- `CHANGELOG.md` — Day-3 section with Butterbase wiring entries

---

## File Written

**Absolute path:** `/Users/nihalnihalani/Desktop/Github/preopreel/docs/plans/05-butterbase-integration.md`

## Executive Summary (5 bullets)

- **Butterbase replaces DO Spaces + Supabase fallback** as the persistence + auth + storage backbone for everything except SSE trace events (Redis stays). Ten Postgres tables (Section B), one storage bucket with five prefixes (Section C), one edge function for atomic dual-write of critic events (Section D.4), realtime over `critiques` + `critic_scores` driving `CriticHud.tsx` (Invariant 1).
- **Promo + submission codes are explicit, verifiable steps.** `BUTTERBASE0502` (caps, Billing → Promo Codes) gets the $20 credit; `butterbase0502` (lowercase) goes in Settings → Project Metadata for hackathon attribution. Phase 3 day 1 step 3 has check-the-dashboard verification.
- **Three of the four invariants land cleanly on Butterbase:** Invariant 1 (critic loop) via `critiques` + `critic_scores` + realtime; Invariant 3 (hermetic replay) via `replay_fixtures` + storage `replay/{forge_run_id}/...`; Invariant 4 (audit trail) via `audit_citations` + the `getForgeRun` join feeding the receipt PDF. Invariant 2 (Seed pinning) is unaffected — Butterbase is upstream of the model layer.
- **Seven new files (~1,927 LOC) + five small updates.** No code yet — Section I lists them with line-count estimates. Phase 3 day 1 ends when `tests/e2e/test_demo_smoke.ts` passes a full ForgeRun against the live Butterbase project in `DEMO_MODE=replay`.
- **Open questions for Atlas before Phase 3 day 1:** (a) exact Smithery MCP package coordinate (`butterbase/butterbase` assumed); (b) `claude mcp add` flag set in our installed Claude Code version; (c) NPM package name for the JS SDK (`@butterbase/js` vs `@butterbase/sdk` vs `butterbase`); (d) which MCP tool applies SQL DDL (`apply_migration` assumed; `pg` fallback specified); (e) Butterbase Storage policy DSL shape (Postgres-style vs separate IAM). All five are resolvable in the first hour of Phase 3 day 1 by introspecting the running MCP server and dashboard — none of them block the planning work captured here.
