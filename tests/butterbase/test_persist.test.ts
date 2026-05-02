// ============================================================================
// tests/butterbase/test_persist.test.ts — Butterbase round-trip tests.
//
// Promo:      BUTTERBASE0502
// Submission: butterbase0502
// Reference:  https://www.youtube.com/watch?v=SHnryHJL9xc
//
// Strategy: hand-rolled in-memory pg-shaped store. Mocks the pg.Pool so
// `pg-fallback.ts` operates against an in-memory `Map<table, rows[]>` with
// just enough SQL pattern-matching to round-trip persistForgeRun →
// updateForgeRunStage → getForgeRun.
//
// Phase 4: replace with pg-mem for full SQL fidelity. For Phase 3 the goal
// is to prove the call surface is consistent and the field plucking from
// the worker's domain types lands in the right columns.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { QueryResult, QueryResultRow } from "pg";

// ─── In-memory pg.Pool mock ─────────────────────────────────────────────
// Using `any` here to satisfy pg's QueryResultRow constraint without
// per-call generics; the real type discipline lives in client.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InMemRow = Record<string, any>;

class FakePool {
  store: Map<string, InMemRow[]> = new Map();
  // Keep a log of (sql, params) pairs so individual tests can assert on calls.
  calls: { text: string; params: unknown[] }[] = [];

  constructor() {
    [
      "forge_runs",
      "procedure_plans",
      "patient_demographics",
      "anatomy_graphs",
      "shot_lists",
      "critiques",
      "critic_scores",
      "audit_citations",
      "replay_fixtures",
      "omnihuman_consents",
    ].forEach((t) => this.store.set(t, []));
  }

  rowsFor(table: string): InMemRow[] {
    let arr = this.store.get(table);
    if (!arr) {
      arr = [];
      this.store.set(table, arr);
    }
    return arr;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    this.calls.push({ text, params });
    const sql = text.trim();
    const upper = sql.toUpperCase();

    // ─── INSERT INTO <table> (...) VALUES ($1,...) RETURNING ... ───
    if (upper.startsWith("INSERT INTO")) {
      const m = sql.match(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)(.*)$/is);
      if (m) {
        const table = m[1]!;
        const cols = m[2]!.split(",").map((c) => c.trim());
        const tail = m[4] ?? "";
        const row: InMemRow = {};
        cols.forEach((c, i) => {
          row[c] = params[i];
        });
        if (!row.id) row.id = `uuid-${Math.random().toString(36).slice(2, 10)}`;
        if (!row.created_at) row.created_at = new Date().toISOString();
        if (table === "forge_runs" && !row.updated_at) {
          row.updated_at = new Date().toISOString();
        }

        // ON CONFLICT support (handles shot_lists upsert + WHERE NOT EXISTS via insertRow always inserts)
        if (/ON\s+CONFLICT/i.test(tail)) {
          // Find conflict columns; for shot_lists it's (forge_run_id, version).
          const conflictMatch = tail.match(/ON\s+CONFLICT\s*\(([^)]*)\)/i);
          if (conflictMatch) {
            const ckeys = conflictMatch[1]!.split(",").map((s) => s.trim());
            const arr = this.rowsFor(table);
            const existing = arr.find((r) => ckeys.every((k) => r[k] === row[k]));
            if (existing) {
              // DO UPDATE: best-effort merge.
              if (/DO\s+UPDATE/i.test(tail)) Object.assign(existing, row);
              const returning = parseReturning(tail);
              const projected = project(existing, returning);
              return makeResult([projected]) as QueryResult<T>;
            }
          }
        }
        this.rowsFor(table).push(row);
        const returning = parseReturning(tail);
        const projected = project(row, returning);
        return makeResult([projected]) as QueryResult<T>;
      }
    }

    // ─── UPDATE <table> SET col=$N, ... WHERE col=$M ───
    if (upper.startsWith("UPDATE")) {
      const m = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)$/is);
      if (m) {
        const table = m[1]!;
        const setExpr = m[2]!;
        const whereExpr = m[3]!;
        const sets = parseAssignList(setExpr);
        const wheres = parseAssignList(whereExpr, " AND ");
        const arr = this.rowsFor(table);
        let count = 0;
        for (const r of arr) {
          if (matches(r, wheres, params)) {
            for (const [col, idxOrLit] of sets) {
              if (typeof idxOrLit === "number") r[col] = params[idxOrLit - 1];
              else if (idxOrLit && typeof idxOrLit === "string") {
                // jsonb_set(...) — best effort: skip; tests don't read these.
              }
            }
            if (table === "forge_runs") r.updated_at = new Date().toISOString();
            count++;
          }
        }
        return makeResult([], count) as QueryResult<T>;
      }
    }

    // ─── SELECT * FROM <table> WHERE ... [LIMIT N] ───
    if (upper.startsWith("SELECT")) {
      const tableMatch = sql.match(/FROM\s+(\w+)/i);
      const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s*$)/is);
      if (tableMatch) {
        const table = tableMatch[1]!;
        const arr = this.rowsFor(table);
        const wheres = whereMatch ? parseAssignList(whereMatch[1]!, " AND ") : [];
        const filtered = wheres.length
          ? arr.filter((r) => matches(r, wheres, params))
          : arr.slice();
        // Order-by support (very limited).
        const obMatch = sql.match(/ORDER\s+BY\s+([^L]+?)(?:\s+LIMIT|\s*$)/is);
        if (obMatch) {
          const cols = obMatch[1]!
            .split(",")
            .map((c) => c.trim().split(/\s+/));
          filtered.sort((a, b) => {
            for (const [col, dir] of cols) {
              const ax = a[col!] as string | number | undefined;
              const bx = b[col!] as string | number | undefined;
              if (ax === bx) continue;
              const lt = (ax ?? 0) < (bx ?? 0);
              const sign = (dir ?? "ASC").toUpperCase() === "DESC" ? -1 : 1;
              return (lt ? -1 : 1) * sign;
            }
            return 0;
          });
        }
        const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
        const limited = limitMatch
          ? filtered.slice(0, parseInt(limitMatch[1]!, 10))
          : filtered;
        return makeResult(limited) as QueryResult<T>;
      }
    }

    // ─── BEGIN / COMMIT / ROLLBACK — no-op ───
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) {
      return makeResult([]) as QueryResult<T>;
    }

    // Unknown SQL — return empty.
    return makeResult([]) as QueryResult<T>;
  }

  async connect(): Promise<{
    query: FakePool["query"];
    release: () => void;
  }> {
    return {
      query: this.query.bind(this),
      release: () => undefined,
    };
  }

  on(): void {
    /* noop */
  }

  async end(): Promise<void> {
    /* noop */
  }
}

function makeResult<T extends QueryResultRow>(
  rows: T[],
  rowCount?: number,
): QueryResult<T> {
  return {
    command: "SELECT",
    rowCount: rowCount ?? rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function parseReturning(tail: string): string[] {
  const m = tail.match(/RETURNING\s+(.+)$/i);
  if (!m) return [];
  return m[1]!.split(",").map((c) => c.trim());
}

function project(row: InMemRow, cols: string[]): InMemRow {
  if (cols.length === 0) return row;
  const out: InMemRow = {};
  for (const c of cols) out[c] = row[c];
  return out;
}

function parseAssignList(
  expr: string,
  sep = ",",
): Array<[string, number | string | null]> {
  return expr
    .split(sep)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p): [string, number | string | null] => {
      const m = p.match(/^(\w+)\s*=\s*\$(\d+)/);
      if (m) return [m[1]!, parseInt(m[2]!, 10)];
      const m2 = p.match(/^(\w+)\s*=\s*(.+)$/);
      if (m2) return [m2[1]!, m2[2]!];
      return [p, null];
    });
}

function matches(
  row: InMemRow,
  wheres: Array<[string, number | string | null]>,
  params: unknown[],
): boolean {
  for (const [col, idxOrLit] of wheres) {
    if (typeof idxOrLit === "number") {
      const v = params[idxOrLit - 1];
      if (row[col] !== v) return false;
    }
  }
  return true;
}

// ─── Wire the FakePool into pg-fallback ─────────────────────────────────
import { setPgPool } from "@/lib/butterbase/pg-fallback";
import * as bbClient from "@/lib/butterbase/client";

let pool: FakePool;

beforeEach(() => {
  // tests/setup.ts forces DEMO_MODE=replay globally so persona tests don't
  // hit live Seed; here we're round-tripping through the FakePool, so we
  // need the Postgres branch in getForgeRun (which is gated on
  // DEMO_MODE !== "replay"). Restore happens via vi.unstubAllEnvs after
  // each test (vitest auto-cleans stubs).
  vi.stubEnv("DEMO_MODE", "live");
  pool = new FakePool();
  // Cast through unknown — FakePool implements only the surface used by client.ts.
  setPgPool(pool as unknown as Parameters<typeof setPgPool>[0]);
});

// ============================================================================
// Round-trip suite
// ============================================================================
describe("butterbase/client persist round-trips (BUTTERBASE0502 / butterbase0502)", () => {
  it("persistForgeRun → updateForgeRunStage → getForgeRun returns the same row", async () => {
    const id = "00000000-0000-0000-0000-0000000000aa";
    const newId = await bbClient.persistForgeRun({
      id,
      status: "running",
      stage: "intake",
      demoMode: "replay",
      durationsMs: { parsing: 100 },
      costUsd: { parsing: 0.001 },
      error: null,
      createdAt: new Date().toISOString(),
    } as unknown as Parameters<typeof bbClient.persistForgeRun>[0]);

    expect(newId).toBe(id);
    expect(pool.rowsFor("forge_runs")).toHaveLength(1);
    expect(pool.rowsFor("forge_runs")[0]?.demo_mode).toBe("replay");

    await bbClient.updateForgeRunStage(id, "directing", 920, 0.012);
    const got = await bbClient.getForgeRun(id);
    expect(got).not.toBeNull();
    expect(got?.id).toBe(id);
    expect(got?.demo_mode).toBe("replay");
  });

  it("persistCritique inserts a row with persona='mara' and the right severity", async () => {
    const runId = "00000000-0000-0000-0000-0000000000bb";
    await bbClient.persistForgeRun({ id: runId, status: "running" } as unknown as Parameters<typeof bbClient.persistForgeRun>[0]);
    await bbClient.persistCritique(runId, {
      shotId: "shot_3",
      severity: "warn",
      category: "advice_creep",
      excerpt: "You should consider asking your surgeon...",
      reason: "Crosses from explaining to recommending.",
      suggestedRevision: "Your surgeon will prepare the cup.",
    });
    const rows = pool.rowsFor("critiques");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.persona).toBe("mara");
    expect(rows[0]?.severity).toBe("warn");
    expect(rows[0]?.category).toBe("advice_creep");
  });

  it("persistCriticScore emits one row per regen_attempt", async () => {
    const runId = "00000000-0000-0000-0000-0000000000cc";
    await bbClient.persistForgeRun({ id: runId, status: "running" } as unknown as Parameters<typeof bbClient.persistForgeRun>[0]);

    await bbClient.persistCriticScore(runId, "shot_3", {
      anatomicalFidelity: 0.71,
      procedureStepCompliance: 0.84,
      onScreenTextViolations: 0,
      feedback: "Reaming visualized too distally.",
      accepted: false,
      acceptedWithLowScore: false,
    }, 0);
    await bbClient.persistCriticScore(runId, "shot_3", {
      anatomicalFidelity: 0.86,
      procedureStepCompliance: 0.91,
      onScreenTextViolations: 0,
      feedback: "Cup orientation matches plan.",
      accepted: true,
      acceptedWithLowScore: false,
    }, 1);

    const rows = pool.rowsFor("critic_scores");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.regen_attempt).toBe(0);
    expect(rows[0]?.accepted).toBe(false);
    expect(rows[1]?.regen_attempt).toBe(1);
    expect(rows[1]?.accepted).toBe(true);
  });

  it("setReplayFixture inline + getReplayFixture round-trips bytes", async () => {
    const bytes = Buffer.from(JSON.stringify({ hello: "world" }), "utf8");
    await bbClient.setReplayFixture("ark.director", "fixture-key-1", "json", bytes);
    const back = await bbClient.getReplayFixture("ark.director", "fixture-key-1");
    expect(back).not.toBeNull();
    // FakePool stores Buffer directly; ensure a Buffer was returned.
    expect(Buffer.isBuffer(back)).toBe(true);
    expect(back?.toString("utf8")).toContain("hello");
  });

  it("persistAuditCitation accepts the AuditEntry shape (nested citation/confidenceBand)", async () => {
    const runId = "00000000-0000-0000-0000-0000000000dd";
    await bbClient.persistForgeRun({ id: runId, status: "running" } as unknown as Parameters<typeof bbClient.persistForgeRun>[0]);
    await bbClient.persistAuditCitation(runId, {
      claimId: "claim_1",
      narratorLineExcerpt: "You will fast from midnight before surgery.",
      citation: {
        sourceType: "procedure_plan",
        pointer: "§1",
        excerpt: "NPO from midnight; clear liquids until 2h pre-op.",
      },
      criticPasses: ["mara", "lyra"],
      confidenceBand: { lo: 0.95, hi: 0.99 },
    });
    const rows = pool.rowsFor("audit_citations");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.source_type).toBe("procedure_plan");
    expect(rows[0]?.pointer).toBe("§1");
    expect(rows[0]?.confidence_lo).toBe(0.95);
    expect(rows[0]?.confidence_hi).toBe(0.99);
  });
});
