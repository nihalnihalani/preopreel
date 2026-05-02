// ============================================================================
// butterbase/apply.ts — idempotent migration runner
//
// Promo:      BUTTERBASE0502  (ALL CAPS)
// Submission: butterbase0502  (lowercase)
// Reference:  https://www.youtube.com/watch?v=SHnryHJL9xc
//
// Applies every *.sql file under butterbase/migrations/ in lexicographic
// order, skipping files already recorded in the `_migrations` ledger table.
// Connects via `BUTTERBASE_PROJECT_URL` (Postgres connection string) using
// `BUTTERBASE_API_KEY` as the service-role secret. The Butterbase project
// exposes a Postgres connection string under Settings → Database — same DSN
// shape as Supabase (postgres://postgres:[KEY]@db.<project>.butterbase.dev:5432/postgres).
//
// Usage:   npm run bb:migrate
//          npm run bb:migrate -- --dry-run
//          npm run bb:migrate -- --only 0002_seed_fixtures
// ============================================================================

import { Client } from "pg";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Args {
  dryRun: boolean;
  only: string | null;
  down: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { dryRun: false, only: null, down: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--dry-run") a.dryRun = true;
    else if (x === "--only") a.only = argv[++i] ?? null;
    else if (x === "--down") a.down = argv[++i] ?? null;
  }
  return a;
}

function buildConnectionString(): string {
  // Order of preference:
  //   1. BUTTERBASE_DATABASE_URL — full DSN with credentials baked in.
  //   2. BUTTERBASE_PROJECT_URL + BUTTERBASE_API_KEY — derive postgres://.
  const direct = process.env.BUTTERBASE_DATABASE_URL;
  if (direct && direct.length > 0) return direct;

  const projectUrl = process.env.BUTTERBASE_PROJECT_URL ?? "";
  const apiKey = process.env.BUTTERBASE_API_KEY ?? "";
  if (!projectUrl || !apiKey) {
    throw new Error(
      "[bb:migrate] missing BUTTERBASE_PROJECT_URL or BUTTERBASE_API_KEY. " +
        "Apply promo BUTTERBASE0502 in the Butterbase dashboard, then copy " +
        "the service-role key + project URL from Settings → API Keys.",
    );
  }
  // Strip protocol and any trailing path; keep only the host segment.
  const host = projectUrl
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  // Butterbase's Postgres DSN convention (Supabase-shape):
  //   postgres://postgres:[SERVICE_ROLE_KEY]@db.<project-host>:5432/postgres
  // Caller can override entirely via BUTTERBASE_DATABASE_URL.
  const encodedKey = encodeURIComponent(apiKey);
  return `postgres://postgres:${encodedKey}@db.${host}:5432/postgres?sslmode=require`;
}

async function ensureLedger(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      checksum    text
    );
  `);
}

async function appliedSet(client: Client): Promise<Set<string>> {
  const r = await client.query<{ name: string }>(
    "SELECT name FROM _migrations",
  );
  return new Set(r.rows.map((x) => x.name));
}

async function listMigrations(): Promise<{ name: string; file: string }[]> {
  const dir = path.join(__dirname, "migrations");
  const entries = await fs.readdir(dir);
  return entries
    .filter((e) => e.endsWith(".sql") && !e.endsWith(".down.sql"))
    .sort()
    .map((file) => ({
      name: path.basename(file, ".sql"),
      file: path.join(dir, file),
    }));
}

async function applyOne(
  client: Client,
  m: { name: string; file: string },
  dryRun: boolean,
): Promise<void> {
  const sql = await fs.readFile(m.file, "utf8");
  const checksum = simpleChecksum(sql);
  if (dryRun) {
    console.log(`[bb:migrate] would apply ${m.name} (${sql.length} bytes, sha=${checksum})`);
    return;
  }
  console.log(`[bb:migrate] applying ${m.name} ...`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO _migrations (name, checksum)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET applied_at = now(), checksum = EXCLUDED.checksum`,
      [m.name, checksum],
    );
    await client.query("COMMIT");
    console.log(`[bb:migrate] ✓ ${m.name}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw new Error(`[bb:migrate] failed on ${m.name}: ${(e as Error).message}`);
  }
}

async function applyDown(
  client: Client,
  name: string,
  dryRun: boolean,
): Promise<void> {
  const file = path.join(__dirname, "migrations", `${name}.down.sql`);
  let sql: string;
  try {
    sql = await fs.readFile(file, "utf8");
  } catch {
    throw new Error(`[bb:migrate] no down migration for ${name}`);
  }
  if (dryRun) {
    console.log(`[bb:migrate] would rollback ${name}`);
    return;
  }
  console.log(`[bb:migrate] rolling back ${name} ...`);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("DELETE FROM _migrations WHERE name = $1", [name]);
    await client.query("COMMIT");
    console.log(`[bb:migrate] ✓ rolled back ${name}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

function simpleChecksum(s: string): string {
  // Non-cryptographic; just an integrity tag in the ledger so a manually
  // tweaked migration is detectable.
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dsn = buildConnectionString();
  const client = new Client({ connectionString: dsn });

  console.log(
    "[bb:migrate] PreOpReel Butterbase migration runner (BUTTERBASE0502 / butterbase0502)",
  );
  await client.connect();
  try {
    await ensureLedger(client);

    if (args.down) {
      await applyDown(client, args.down, args.dryRun);
      return;
    }

    const all = await listMigrations();
    const done = await appliedSet(client);
    const todo = all.filter((m) => !done.has(m.name));
    const filtered = args.only
      ? todo.filter((m) => m.name === args.only)
      : todo;

    if (filtered.length === 0) {
      console.log(
        "[bb:migrate] nothing to do (all migrations already applied).",
      );
      return;
    }

    for (const m of filtered) {
      await applyOne(client, m, args.dryRun);
    }

    console.log(`[bb:migrate] done. ${filtered.length} applied.`);
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
