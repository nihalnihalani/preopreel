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

import type { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from "pg";

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
 * Thrown when BUTTERBASE_DATABASE_URL is not configured. Callers should
 * catch this and fall through to fixture / SDK paths silently — it is the
 * expected state when the dashboard's Postgres connection string hasn't
 * been pasted into .env yet.
 */
export class NoButterbaseDatabaseUrlError extends Error {
  constructor() {
    super(
      "BUTTERBASE_DATABASE_URL is not set. Butterbase exposes the Postgres " +
        "connection string under Settings → Database in the dashboard; pg-fallback " +
        "stays disabled until that env var is provided.",
    );
    this.name = "NoButterbaseDatabaseUrlError";
  }
}

/**
 * Build the Butterbase Postgres DSN. Requires BUTTERBASE_DATABASE_URL —
 * we used to derive `db.{api-host}` from BUTTERBASE_PROJECT_URL, but
 * Butterbase's actual DB hostname is per-project and not predictable, so
 * the auto-derivation always failed at DNS lookup. Throw fast instead so
 * the route falls through to disk fixtures without a 1s DNS timeout.
 */
export function butterbasePostgresDsn(): string {
  const direct = process.env.BUTTERBASE_DATABASE_URL ?? "";
  if (direct.length > 0) return direct;
  throw new NoButterbaseDatabaseUrlError();
}

/**
 * Lazy connection pool singleton. `pg` is dynamic-imported so its
 * pg-connection-string SSL deprecation + url.parse() deprecation
 * warnings never fire when the fallback is unconfigured.
 *
 * SSL is auto-disabled when the DSN points at localhost / 127.0.0.1 /
 * sslmode=disable — local Postgres doesn't speak TLS by default and
 * forcing SSL would 500 every request.
 */
export async function getPgPool(cfg?: PgConfig): Promise<Pool> {
  if (_pool) return _pool;
  const dsn = cfg?.connectionString ?? butterbasePostgresDsn();
  const pg = await import("pg");
  const { Pool: PgPool, types: pgTypes } = pg;

  // pg returns NUMERIC columns as strings by default — but our Zod schemas
  // (CriticScore.anatomical_fidelity etc.) expect numbers, so safeParse
  // would silently reject every row. Coerce at the driver level so the
  // typed accessors return clean numbers. Only registered once (idempotent
  // — pgTypes.setTypeParser is global and we gate on _pool above).
  // Caught by the devil's-advocate W1 verification trick (2026-05-02).
  pgTypes.setTypeParser(pgTypes.builtins.NUMERIC, (val: string) =>
    Number.parseFloat(val),
  );

  let ssl: PoolConfig["ssl"];
  if (cfg?.ssl !== undefined) {
    ssl = cfg.ssl;
  } else if (
    /\b(localhost|127\.0\.0\.1|\[::1\])\b/.test(dsn) ||
    /sslmode=disable/.test(dsn)
  ) {
    ssl = false;
  } else {
    ssl = { rejectUnauthorized: false };
  }

  _pool = new PgPool({
    connectionString: dsn,
    max: cfg?.max ?? 8, // bursty worker writes; demo run < 10 concurrent
    idleTimeoutMillis: cfg?.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: cfg?.connectionTimeoutMillis ?? 5_000,
    ssl,
  });
  // Don't crash the worker if the pool emits an idle-client error.
  _pool.on("error", (err: Error) => {
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
  const pool = await getPgPool();
  return pool.query<T>(text, params as unknown[]);
}

/**
 * Run a function inside a checked-out client; useful for transactions.
 */
export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pool = await getPgPool();
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
