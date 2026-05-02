# Current Issue and Required Fixes

## Status

**All three fixes below have been implemented in this session** — see the
"Implemented in" annotations under each item. This document is kept as a
reference for what was changed and why.

## The Issue

When running the application in `live` mode without a configured
PostgreSQL database (`BUTTERBASE_DATABASE_URL` is not set), the pipeline
completes successfully in the background, but the UI at `/forge/[id]`
fails to display the generated analysis data (Anatomy Graph, Shot List,
Critiques, Critic Scores, etc.).

## Root Cause

The `src/lib/butterbase/client.ts` file acts as the database abstraction
layer. It has a fallback mechanism to write to a local JSON file
(`src/lib/butterbase/local-store.ts`) when Postgres is unavailable.
However, this fallback was incomplete:

1. **Missing Local Writes for Detailed Data:** The functions responsible
   for saving stage outputs (e.g., `persistAnatomyGraph`,
   `persistShotList`, `persistCritique`) attempted to write to Postgres.
   When this failed due to the missing database URL, they caught the
   error but did not save the data to the local store. The data was lost.

2. **Incomplete Local Reads:** The main data retrieval function,
   `getForgeRun`, fell back to `getLocalRun(id)` if Postgres failed.
   However, `getLocalRun` only returned the high-level run status. It did
   not fetch the related detailed data (procedure plan, anatomy graph,
   shot lists, etc.) required by the UI panels.

## Required Improvements

### 1. Update Persist Functions in `client.ts`

Modify the following functions to fall back to `pushLocal` when a
`NoButterbaseDatabaseUrlError` occurs:

- `persistProcedurePlan`
- `persistPatientDemographics`
- `persistAnatomyGraph`
- `persistShotList`
- `persistCritique`
- `persistCriticScore`
- `persistAuditCitation`

**Implemented in:** `src/lib/butterbase/client.ts` — each function now
wraps its `insertRow` / `withTransaction` call in `try/catch`, swallows
`NoButterbaseDatabaseUrlError` via the shared `isNoDbError(err)` helper,
and writes the row to local storage via `pushLocal(<collection>, row)`.

**Pattern used:**

```typescript
try {
  await insertRow("anatomy_graphs", row);
  return;
} catch (err) {
  if (!isNoDbError(err)) {
    console.warn("[butterbase/client] persistAnatomyGraph pg failed:", err);
  }
}
await pushLocal("anatomyGraphs", row as unknown as AnatomyGraphRow);
```

### 2. Update `getForgeRun` in `client.ts`

Modify `getForgeRun` so that when the Postgres lookup misses (or fails
with `NoButterbaseDatabaseUrlError`), the local-store fallback returns
the full joined record using `getLocalDetails(id)`.

**Implemented in:** `src/lib/butterbase/client.ts:getForgeRun` — the
`if (!run)` branch now calls `getLocalDetails(id)` and stitches the
result into a `ForgeRunWithDetails`-shaped object, including
`procedure_plan`, `patient_demographics`, `anatomy_graph`, `shot_lists`,
`critiques`, `critic_scores`, and `audit_citations`.

Additionally, the read accessors `getCritiques`, `getCriticScores`, and
`getAuditEntries` were updated to fall back to `getLocalDetails(...)` on
Postgres failure, so the API routes that drive the HUD also stay
populated.

### 3. Ensure `local-store.ts` is Prepared

Verify that `src/lib/butterbase/local-store.ts` exports `getLocalDetails`
and `pushLocal`, and that the `LocalDb` interface includes arrays for all
the detailed data types.

**Verified:** `src/lib/butterbase/local-store.ts` already contains:

- `LocalDb` interface with `procedurePlans`, `patientDemographics`,
  `anatomyGraphs`, `shotLists`, `critiques`, `criticScores`, and
  `auditCitations` arrays.
- `pushLocal(collection, row)` — write-serialized append (with
  shot-list version-aware upsert).
- `getLocalDetails(id)` — joins all rows for a given `forge_run_id`.

## Related fixes landed in the same session

These were not part of the original diagnosis but were necessary to make
the pipeline reach the stages whose output now persists locally:

1. **Stage 3 (Atlas / Director) — Z.AI tolerant ShotList parser.**
   `apps/synthesis-worker/stages/03-director.ts` now accepts variant
   shapes (`{title, segments[]}`, camelCase, missing fields) and
   normalizes them to the snake-case `ShotList` shape downstream stages
   expect.

2. **Stage 3 / 4 / 10 — Routing through Z.AI.** The handbook stack uses
   Z.AI GLM-5.1 (the ARK key has no access to the pinned director model
   id). Stages 3 (Atlas Director), 4 (Mara Devil's Advocate), and 10
   (Lyra Vision Critic) now call `zaiChat` / `zaiVision` by default; the
   legacy ARK path is gated behind `USE_LEGACY_PROVIDERS=1`.

3. **Stage 4 (Mara) — Tolerant Critique normalizer.** Z.AI returns
   `{shot_id, category, critique}` instead of the strict
   `{shot_id, severity, category, excerpt, reason}`. A normalizer maps
   `critique`/`message`/`text` → `reason`+`excerpt`, defaults severity to
   `warn`, and clamps `category` to the allowed enum.

4. **`next.config.ts` — `serverExternalPackages`.** Remotion compositors,
   esbuild, `pg`, and `ioredis` are now declared as external server
   packages so Turbopack does not try to statically resolve their
   platform-specific native binaries.

5. **`/api/forge` — worker bootstrap on first POST.** The route handler
   now calls `bootstrapWorker()` before enqueuing so the in-memory queue
   has a registered handler when the dev server has just started or
   hot-reloaded.

## How to verify

1. Ensure `BUTTERBASE_DATABASE_URL` is unset (or pointed at an
   unreachable host).
2. `npm run dev` and POST a fresh run:

   ```bash
   curl -X POST http://localhost:3000/api/forge \
     -F "plan.pdf=@data/sample-inputs/plan.pdf" \
     -F "patient.json=@data/sample-inputs/patient.json"
   ```

3. Watch `data/local-db/runs.json` grow as stages complete — the
   `anatomyGraphs`, `shotLists`, `critiques`, `criticScores`, and
   `auditCitations` arrays should each gain entries keyed by the
   returned `forge_run_id`.
4. Open `http://localhost:3000/forge/<id>` and confirm the HUD panels
   populate with the AnatomyGraph, the Director's ShotList, Mara's
   critiques, and Lyra's per-beat scores.
