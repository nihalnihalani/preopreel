// ============================================================================
// src/lib/butterbase/pg-fallback.ts — direct Postgres fallback when the
// `@butterbase/js` SDK is not installed at runtime.
//
// Promo:      BUTTERBASE0502
// Submission: butterbase0502
// Reference:  https://www.youtube.com/watch?v=SHnryHJL9xc
//
// Butterbase exposes a typed PostgREST surface AND a raw Postgres connection
// string under Settings → Database. The pg fallback is the lowest common
// denominator — works against either the Butterbase project DSN or any
// pg-compatible target (test database, pg-mem, etc.). The query helpers here
// stay deliberately small; client.ts builds typed accessors on top.
// ============================================================================

import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

export interface PgConfig {
  connectionString?: string;
  // Connection pool limits. Conservative defaults so worker bursts don't
  // saturate Butterbase's connection limit.
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  ssl?: PoolConfig["ssl"];
}

let _pool: Pool | null = null;

/**
 * Build the Butterbase Postgres DSN. Prefers BUTTERBASE_DATABASE_URL
 * (full DSN) and falls back to BUTTERBASE_PROJECT_URL + BUTTERBASE_API_KEY.
 */
export function butterbasePostgresDsn(): string {
  const direct = process.env.BUTTERBASE_DATABASE_URL ?? "";
  if (direct.length > 0) return direct;

  const projectUrl = process.env.BUTTERBASE_PROJECT_URL ?? "";
  const apiKey = process.env.BUTTERBASE_API_KEY ?? "";
  if (!projectUrl || !apiKey) {
    throw new Error(
      "[butterbase/pg-fallback] BUTTERBASE_PROJECT_URL + BUTTERBASE_API_KEY required " +
        "(or set BUTTERBASE_DATABASE_URL directly). " +
        "Apply promo BUTTERBASE0502 in the dashboard, then copy keys.",
    );
  }
  const host = projectUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `postgres://postgres:${encodeURIComponent(apiKey)}@db.${host}:5432/postgres?sslmode=require`;
}

/**
 * Lazy connection pool singleton.
 * Worker writes use `query()` directly; transactions use `withClient()`.
 */
export function getPgPool(cfg?: PgConfig): Pool {
  if (_pool) return _pool;
  const dsn = cfg?.connectionString ?? butterbasePostgresDsn();
  _pool = new Pool({
    connectionString: dsn,
    max: cfg?.max ?? 8, // bursty worker writes; demo run < 10 concurrent
    idleTimeoutMillis: cfg?.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: cfg?.connectionTimeoutMillis ?? 5_000,
    ssl: cfg?.ssl ?? { rejectUnauthorized: false },
  });
  // Don't crash the worker if the pool emits an idle-client error.
  _pool.on("error", (err) => {
    console.error("[butterbase/pg-fallback] pool error:", err);
  });
  return _pool;
}

/**
 * Override the pool — used by tests to inject a pg-mem pool.
 */
export function setPgPool(pool: Pool | null): void {
  _pool = pool;
}

/**
 * Close the pool. Call from worker shutdown handlers.
 */
export async function closePgPool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

/**
 * Run a one-shot query. The generic `T` parameterizes the row shape.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<QueryResult<T>> {
  const pool = getPgPool();
  return pool.query<T>(text, params as unknown[]);
}

/**
 * Run a function inside a checked-out client; useful for transactions.
 */
export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Transaction wrapper with automatic BEGIN/COMMIT/ROLLBACK.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

/**
 * Minimal INSERT helper. Returns the inserted id when `RETURNING id` works.
 * Not an ORM — covers the 80% shape the worker actually uses.
 */
export async function insertRow<T extends QueryResultRow = QueryResultRow>(
  table: string,
  row: Record<string, unknown>,
  returning: ReadonlyArray<string> = ["id"],
): Promise<T> {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO ${table} (${cols.join(", ")})
               VALUES (${placeholders})
               RETURNING ${returning.join(", ")}`;
  const r = await query<T>(sql, cols.map((c) => row[c]));
  if (r.rows.length === 0) {
    throw new Error(`[butterbase/pg-fallback] insertRow returned no row from ${table}`);
  }
  return r.rows[0]!;
}

/**
 * Minimal UPDATE helper. `where` takes a column→value map ANDed together.
 */
export async function updateRow(
  table: string,
  set: Record<string, unknown>,
  where: Record<string, unknown>,
): Promise<number> {
  const setCols = Object.keys(set);
  const whereCols = Object.keys(where);
  const setSql = setCols.map((c, i) => `${c} = $${i + 1}`).join(", ");
  const whereSql = whereCols
    .map((c, i) => `${c} = $${setCols.length + i + 1}`)
    .join(" AND ");
  const params = [
    ...setCols.map((c) => set[c]),
    ...whereCols.map((c) => where[c]),
  ];
  const sql = `UPDATE ${table} SET ${setSql} WHERE ${whereSql}`;
  const r = await query(sql, params);
  return r.rowCount ?? 0;
}
