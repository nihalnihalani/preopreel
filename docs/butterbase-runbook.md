# Butterbase Day-1 Runbook

Operator checklist for the Butterbase Dev (and anyone who needs to bootstrap
the project for the first time). Promo + submission codes baked in; do not
omit them.

- **Promo code:** `BUTTERBASE0502` (ALL CAPS) — applied in Billing → Promo Codes
- **Submission code:** `butterbase0502` (lowercase) — set in Settings → Project
  Metadata → Submission Code
- **Reference video:** https://www.youtube.com/watch?v=SHnryHJL9xc — Butterbase
  MCP setup walkthrough. **Watch this end-to-end before step 4 below.** Mirror
  its `.mcp.json` entry exactly.

---

## Day-1 checklist (do these in order)

1. **Sign up at Butterbase.** Create the account that will own the demo project.
   Use the team email so credit-control isn't a single-person SPOF.

2. **Apply the promo code `BUTTERBASE0502`** (ALL CAPS — the form is
   case-sensitive) in **Billing → Promo Codes**. Confirm $20 credit shows
   on the billing dashboard before continuing.

3. **Set the submission code `butterbase0502`** (lowercase) in
   **Settings → Project Metadata → Submission Code**. This is what the
   hackathon judges look up to identify our project.

4. **Install the Butterbase MCP.** From the project root:

   ```bash
   claude mcp add butterbase --transport stdio --command "npx -y butterbase-mcp"
   ```

   Or — if you prefer the declarative path — confirm the entry already in
   `.mcp.json` matches the YouTube reference at
   https://www.youtube.com/watch?v=SHnryHJL9xc and skip the `claude mcp add`
   step.

5. **Create the Butterbase project**, then copy these four values into
   `.env.local` at the repo root:

   ```bash
   BUTTERBASE_PROJECT_URL=https://YOUR-PROJECT.butterbase.dev
   BUTTERBASE_PROJECT_ID=...
   BUTTERBASE_API_KEY=...           # service-role key (Mara B.5: never user JWT for stage)
   BUTTERBASE_ANON_KEY=...
   BUTTERBASE_PG_URL=postgres://...@YOUR-PROJECT.butterbase.dev:5432/postgres
   BUTTERBASE_STORAGE_BUCKET=preopreel-renders
   ```

   Mirror the public-facing values into the `NEXT_PUBLIC_*` keys (see
   `.env.example`).

6. **Apply migrations + seed fixtures.**

   ```bash
   npm run bb:migrate
   ```

   This runs `butterbase/migrations/0001_initial_schema.sql` (10 tables + RLS
   policies) and `butterbase/migrations/0002_seed_fixtures.sql` (the demo case
   row in `forge_runs`).

7. **Verify in the dashboard.**
   - 10 tables visible: `forge_runs`, `procedure_plans`, `patient_demographics`,
     `anatomy_graphs`, `shot_lists`, `critiques`, `critic_scores`,
     `audit_citations`, `replay_fixtures`, `omnihuman_consents`.
   - RLS policies attached to every table (look for "Row Level Security: ON"
     on the schema page).
   - `forge_runs` has one row: `id = 'demo-hip-replacement'`.

8. **Verify the MCP from Claude Code.** In a fresh Claude Code session at the
   repo root, ask:

   > "list Butterbase tables"

   It should hit the MCP and return the 10 tables without prompting for auth.
   If it prompts, the `.mcp.json` entry is wrong — re-watch
   https://www.youtube.com/watch?v=SHnryHJL9xc and fix the command/transport.

9. **Run the T-30 probe** (Mara B.5 mitigation):

   ```bash
   npm run probe:butterbase
   # or:  npx tsx scripts/probe_butterbase.ts
   ```

   Expect both checks to pass:
   ```
   [PASS] healthz                          XXms
   [PASS] pg.select_1_from_forge_runs      XXms
   ```

   If only `healthz` passes, `BUTTERBASE_PG_URL` is missing — fix it before
   stage call. The T-30 demo-day checklist requires both green.

---

## Operational notes

- **Service-role key, not user JWT** for the demo session. User JWTs have TTLs
  and can expire mid-demo (Mara B.5).
- **Storage signed URLs are minted lazily** at request time — `/api/forge/{id}/explainer.mp4`
  302-redirects to a fresh signed URL so a stale URL never reaches the player
  (Mara E.3).
- **Realtime subscription is the HUD path.** The CriticHud subscribes to
  `critiques` and `critic_scores` tables directly — writes from the worker are
  fire-and-forget so the HUD lag is dominated by Butterbase's realtime fanout
  (Mara E.1).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `[FAIL] healthz` | Project URL wrong / project paused | Confirm URL in dashboard; un-pause if needed |
| `[FAIL] pg.select_1...` after `[PASS] healthz` | Service-role key wrong, or `forge_runs` table missing | Re-run `npm run bb:migrate`; rotate the service-role key in Settings → Keys |
| MCP prompts for auth in Claude Code | `.mcp.json` transport mismatch | Re-watch https://www.youtube.com/watch?v=SHnryHJL9xc; the `--transport stdio` flag must match |
| Promo code shows $0 credit | Code typed lowercase | Re-enter as `BUTTERBASE0502` (ALL CAPS — form is case-sensitive) |
| Submission code rejected | Code typed uppercase | Re-enter as `butterbase0502` (lowercase) |
