// scripts/seed_local_db.ts
//
// Seed the local Postgres with the demo-hip-replacement fixture so the
// API routes can read from the DB instead of falling through to disk.
// Run after the migration is applied:
//
//   BUTTERBASE_DATABASE_URL=postgres://localhost:5432/preopreel \
//     npx tsx scripts/seed_local_db.ts
//
// Idempotent: clears + re-inserts the demo run on every invocation. Other
// forge_runs are untouched.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

const DEMO_ID = "demo-hip-replacement";
// forge_runs.id is `text` (per the devil's advocate counter-proposal); the
// slug doubles as the primary key so the routes that receive it as a path
// param ("/api/forge/demo-hip-replacement/...") look up the row directly.
const DEMO_RUN_UUID = DEMO_ID;

const REPLAY = join(process.cwd(), "data", "replay", DEMO_ID);

interface MaraEnvelope {
  critiques: Array<{
    shot_id: string;
    severity: "block" | "warn" | "info";
    category: string;
    excerpt: string;
    reason: string;
    suggested_revision?: string;
  }>;
}

interface LyraEnvelope {
  beats: Array<{
    beat_id: string;
    attempt: number;
    anatomical_fidelity: number;
    procedure_step_compliance: number;
    on_screen_text_violations: number;
    feedback: string;
    verdict: "accept" | "regen";
  }>;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await fs.readFile(path, "utf8")) as T;
}

async function main(): Promise<void> {
  const dsn =
    process.env.BUTTERBASE_DATABASE_URL ??
    "postgres://localhost:5432/preopreel";
  console.log(`[seed] connecting to ${dsn}`);
  const pool = new Pool({ connectionString: dsn, ssl: false });

  try {
    // Clear in dependency order.
    console.log("[seed] clearing existing demo rows…");
    await pool.query(`DELETE FROM forge_runs WHERE id = $1`, [DEMO_RUN_UUID]);
    // CASCADE handles critiques / critic_scores / audit_citations / etc.

    // Insert the parent run.
    console.log("[seed] inserting forge_runs row…");
    await pool.query(
      `INSERT INTO forge_runs (id, status, stage, demo_mode, durations_ms, cost_usd)
       VALUES ($1, 'completed', 'composing', 'replay',
               $2::jsonb, $3::jsonb)`,
      [
        DEMO_RUN_UUID,
        JSON.stringify({
          parsing: 1200,
          researching: 4500,
          directing: 3200,
          critiquing: 1800,
          renderingVideo: 18500,
          scoring: 4200,
          composing: 6000,
        }),
        JSON.stringify({
          directing: 0.04,
          critiquing: 0.02,
          renderingVideo: 0.78,
          scoring: 0.06,
        }),
      ],
    );

    // Insert critiques.
    console.log("[seed] inserting critiques…");
    const mara = await readJson<MaraEnvelope>(
      join(REPLAY, "04-mara", "critiques.json"),
    );
    for (const c of mara.critiques) {
      await pool.query(
        `INSERT INTO critiques
           (forge_run_id, shot_id, severity, category,
            excerpt, reason, suggested_revision, persona)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'mara')`,
        [
          DEMO_RUN_UUID,
          c.shot_id,
          c.severity,
          c.category,
          c.excerpt.slice(0, 200),
          c.reason.slice(0, 200),
          c.suggested_revision ?? null,
        ],
      );
    }
    console.log(`[seed]   wrote ${mara.critiques.length} critique row(s)`);

    // Insert critic scores.
    console.log("[seed] inserting critic_scores…");
    const lyra = await readJson<LyraEnvelope>(
      join(REPLAY, "10-lyra", "scores.json"),
    );
    for (const b of lyra.beats) {
      const accepted = b.verdict === "accept";
      await pool.query(
        `INSERT INTO critic_scores
           (forge_run_id, beat_id, regen_attempt,
            anatomical_fidelity, procedure_step_compliance,
            on_screen_text_violations, feedback, accepted,
            accepted_with_low_score, persona)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'lyra')`,
        [
          DEMO_RUN_UUID,
          b.beat_id,
          b.attempt - 1, // schema uses 0-indexed regen_attempt
          b.anatomical_fidelity,
          b.procedure_step_compliance,
          b.on_screen_text_violations,
          b.feedback.slice(0, 240),
          accepted,
        ],
      );
    }
    console.log(`[seed]   wrote ${lyra.beats.length} critic_score row(s)`);

    // Verify counts.
    const c1 = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM critiques WHERE forge_run_id = $1`,
      [DEMO_RUN_UUID],
    );
    const c2 = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM critic_scores WHERE forge_run_id = $1`,
      [DEMO_RUN_UUID],
    );
    console.log(
      `[seed] verified: critiques=${c1.rows[0]?.n} critic_scores=${c2.rows[0]?.n}`,
    );
    console.log(`[seed] demo forge_run_id (UUID): ${DEMO_RUN_UUID}`);
    console.log(`[seed] done`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
