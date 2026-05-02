# Butterbase — PreOpReel Persistence Backbone

> Promo: **`BUTTERBASE0502`** (ALL CAPS) — apply at Billing → Promo Codes for $20 credit.
> Submission: **`butterbase0502`** (lowercase) — set in Settings → Project Metadata for hackathon attribution.
> Setup video reference: <https://www.youtube.com/watch?v=SHnryHJL9xc>

This directory holds the Butterbase migration files, the migration runner (`apply.ts`), and this operator runbook. Butterbase is the source of truth for everything in PreOpReel **except** SSE trace events (those stay in Redis at `pre:trace:{forge_run_id}`).

## What's here

| File | Purpose |
| --- | --- |
| `migrations/0001_initial_schema.sql` | All 10 tables, 6 ENUMs, indexes, RLS policies. |
| `migrations/0001_initial_schema.down.sql` | Drops everything 0001 creates, in reverse FK order. |
| `migrations/0002_seed_fixtures.sql` | Synthetic-phantom hip-replacement demo data — Mara warn on shot_3, Lyra Beat-3 reject (0.71) → regen (0.86). |
| `apply.ts` | Idempotent runner. Applies migrations via direct `pg` client. |
| `README.md` | This file. |

## Day-1 operator runbook

Follow these in order. Each step has explicit verification.

### 1. Sign up + apply promo + set submission code

1. Go to <https://butterbase.dev/signup>.
2. **Billing → Promo Codes** → enter `BUTTERBASE0502` (ALL CAPS). Verify the dashboard shows `+$20.00 credit`.
3. **Settings → Project Metadata** → set the "Hackathon Submission" field to `butterbase0502` (lowercase). If the field isn't named that, look for "Project Tag" / "Attribution Code" / "Promo Reference"; if none exist, contact support — the code must be attributable for sponsor scoring.
4. Create a project: name `preopreel`, region `us-east-1` (closest to Computer History Museum demo network).
5. **Settings → API Keys** → copy:
   - **Service Role Key** → put in `.env` as `BUTTERBASE_API_KEY` (server-only, never browser).
   - **Anon Key** → `BUTTERBASE_ANON_KEY` (public; safe in `NEXT_PUBLIC_*`).
   - **Project URL** → `BUTTERBASE_PROJECT_URL`.
   - **Project ID** → `BUTTERBASE_PROJECT_ID`.
6. **Storage → Buckets** → create `preopreel-renders` (signed-URL access; no public listing).

### 2. Install the Butterbase MCP server

After your `.env` has the four keys above, register the Butterbase MCP server with Claude Code:

```bash
claude mcp add butterbase \
  --transport stdio \
  --command "npx -y butterbase-mcp"
```

Verify it loaded:

```bash
claude mcp list | grep butterbase
```

The repo also commits a `.mcp.json` at the project root that registers the same server with the same env-var references, so any teammate who opens the repo picks it up automatically.

> **Open question (resolve day 1):** the canonical Butterbase MCP package is `butterbase-mcp` per current docs. If it's renamed (e.g. `@butterbase/mcp`), update both `.mcp.json` and the `claude mcp add` line above. Setup video walks through both shapes: <https://www.youtube.com/watch?v=SHnryHJL9xc>

### 3. Apply the migrations

```bash
npm run bb:migrate
```

What this does:

- Connects via `BUTTERBASE_DATABASE_URL` (preferred) or derives a Postgres DSN from `BUTTERBASE_PROJECT_URL` + `BUTTERBASE_API_KEY`.
- Reads `_migrations` ledger; skips already-applied migrations.
- Wraps each `*.sql` file in a transaction; rolls back on error.
- Runs `0001_initial_schema.sql` (10 tables + RLS), then `0002_seed_fixtures.sql` (demo run `00000000-0000-0000-0000-000000000001`).

Useful flags:

```bash
npm run bb:migrate -- --dry-run                 # show what would run
npm run bb:migrate -- --only 0002_seed_fixtures # apply just the seed
npm run bb:migrate -- --down 0002_seed_fixtures # roll back the seed
```

### 4. Verify in the dashboard

In the Butterbase dashboard:

- **Tables** → see all 10 tables with the right column counts.
- **Policies** → each user-facing table has an `anon SELECT` policy + a `service_role ALL` policy; `replay_fixtures` and `omnihuman_consents` have a service-role-only policy.
- **Indexes** → every `forge_run_id` column has an index; `replay_fixtures(stage, key)` is unique.
- **Table Editor → forge_runs** → row `00000000-0000-0000-0000-000000000001` exists, `status='completed'`, `demo_mode='replay'`.
- **Table Editor → critiques** → one row, `shot_id='shot_3'`, `severity='warn'`, `category='advice_creep'`.
- **Table Editor → critic_scores** → two rows for `beat_id='shot_3'`: `regen_attempt=0` (rejected, 0.71) and `regen_attempt=1` (accepted, 0.86). Plus one row for `beat_id='shot_4'` accepted at 0.89.

### 5. Probe from the project root

```bash
npm run probe:butterbase
```

This runs `scripts/probe_butterbase.ts` — pings the project URL and performs one row read against `forge_runs`. Use this at T-30 demo-day check (Mara B.5 mitigation).

## RLS model

| Table | anon | service_role |
| --- | --- | --- |
| `forge_runs` | SELECT (uuid is the capability) | ALL |
| `procedure_plans` | SELECT (joined by forge_run_id) | ALL |
| `patient_demographics` | SELECT | ALL |
| `anatomy_graphs` | SELECT | ALL |
| `shot_lists` | SELECT | ALL |
| `critiques` | SELECT (drives realtime CriticHud) | ALL |
| `critic_scores` | SELECT (drives realtime CriticHud) | ALL |
| `audit_citations` | SELECT (drives audit-trail PDF) | ALL |
| `replay_fixtures` | (no policy → denied) | ALL |
| `omnihuman_consents` | (no policy → denied) | ALL |

The browser only ever reads with the anon key. All writes happen server-side in `apps/synthesis-worker` and the API routes, using the service-role key.

## Realtime channel naming

Two channels are subscribed to by `CriticHud.tsx`:

- `pre:critiques:{forge_run_id}` — Mara critique INSERTs
- `pre:scores:{forge_run_id}` — Lyra critic-score INSERTs

These are filtered Postgres logical-decoding subscriptions; see `src/lib/butterbase/realtime.ts`.

## Storage buckets

One bucket, five prefixes:

```
preopreel-renders/
├── explainers/{forge_run_id}.mp4         # signed URL, 1h TTL (lazy minted per request — Mara E.3 mitigation)
├── audit/{forge_run_id}.pdf              # signed URL, 1h TTL
├── keyframes/{forge_run_id}/{beat_id}.png
├── uploads/{forge_run_id}/plan.pdf
└── replay/{forge_run_id}/{stage}/{key}.{ext}
```

`explainers/*` and `audit/*` are reachable from the browser via the API routes `/api/forge/{id}/explainer` and `/api/forge/{id}/receipt`, both of which 302-redirect to a freshly minted signed URL. We never embed a long-lived signed URL in HTML — that's the Mara E.3 fix.

## Demo-day checklist (this directory's slice)

- [ ] T-12h: `npm run bb:migrate` ran clean, dashboard shows all 10 tables + seed data.
- [ ] T-30: `npm run probe:butterbase` returns OK with timing.
- [ ] On stage: `/forge/00000000-0000-0000-0000-000000000001` loads, CriticHud shows the seeded Mara warn + Lyra reject/regen.

## Troubleshooting

**`bb:migrate` fails with `ECONNREFUSED`** → Butterbase project might be paused. Hit the dashboard and verify status. If the DSN derivation in `apply.ts` doesn't match your project, set `BUTTERBASE_DATABASE_URL` directly from Settings → Database.

**`anon SELECT` returns empty even though service-role can see the row** → RLS policy was created on the wrong role. Check Policies tab; both `forge_runs_anon_select` and `forge_runs_service_all` must exist.

**Realtime not firing** → Butterbase needs logical decoding enabled on the publication. `0001_initial_schema.sql` doesn't manage publications (Butterbase manages them); if a row INSERT doesn't propagate, check Settings → Realtime → Publications and ensure `critiques` and `critic_scores` are in the published set.

**Migrations apply twice** → `apply.ts` is idempotent via the `_migrations` ledger. If you re-applied by hand, delete the row from `_migrations` and re-run.
