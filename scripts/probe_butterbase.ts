// ─────────────────────────────────────────────────────────────────────────────
// probe_butterbase.ts
//
// PreOpReel — Mara B.5 mitigation: T-30 Butterbase auth probe.
// Pings BUTTERBASE_PROJECT_URL/healthz, runs `SELECT 1 FROM forge_runs LIMIT 1`
// via direct `pg` (service role), and prints OK + timing per check.
// Run from the demo-day T-30 checklist.
//
// Owner: Demo Ops Dev (Phase 3, Section C of docs/plans/04-frontend-and-demo.md).
// Promo: BUTTERBASE0502 (ALL CAPS) / Submission: butterbase0502 (lowercase).
//
// Usage:
//   npx tsx scripts/probe_butterbase.ts
//   npm run probe:butterbase   (alias should be wired in package.json)
//
// Dependencies (installed at repo root, NOT by this script):
//   - tsx (npm i -D tsx)
//   - pg  (npm i pg)         — direct Postgres client for the SELECT 1 path
//   - undici / fetch         — built into Node 20+ (used for /healthz)
//
// Env (from .env.local):
//   BUTTERBASE_PROJECT_URL  — e.g. https://xxxxx.butterbase.dev
//   BUTTERBASE_API_KEY      — service-role key (NEVER user JWT for this probe)
//   BUTTERBASE_PG_URL       — postgres://...@xxxxx.butterbase.dev:5432/postgres
//                             (optional; if missing, the SELECT 1 step is skipped
//                              and exit code is 2 — partial probe.)
//
// Exit codes:
//   0 — both checks passed (or healthz passed and PG URL not configured)
//   1 — healthz failed
//   2 — healthz passed, PG check failed (or skipped due to missing config)
//   3 — fatal misconfiguration (no BUTTERBASE_PROJECT_URL)
// ─────────────────────────────────────────────────────────────────────────────

import { setTimeout as sleep } from "node:timers/promises";

type Result = {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
};

const PROMO = "BUTTERBASE0502";
const SUBMISSION = "butterbase0502";

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v : undefined;
}

async function probeHealthz(baseUrl: string): Promise<Result> {
  const url = baseUrl.replace(/\/$/, "") + "/healthz";
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(url, { signal: ctrl.signal, method: "GET" });
    clearTimeout(timer);
    const ms = Date.now() - start;
    if (!res.ok) {
      return { name: "healthz", ok: false, ms, detail: `HTTP ${res.status}` };
    }
    return { name: "healthz", ok: true, ms };
  } catch (e) {
    return {
      name: "healthz",
      ok: false,
      ms: Date.now() - start,
      detail: (e as Error).message,
    };
  }
}

async function probeForgeRunsSelect(pgUrl: string): Promise<Result> {
  const start = Date.now();
  let pgModule: typeof import("pg");
  try {
    pgModule = await import("pg");
  } catch (e) {
    return {
      name: "pg.select_1_from_forge_runs",
      ok: false,
      ms: Date.now() - start,
      detail: `npm package 'pg' not installed: ${(e as Error).message}`,
    };
  }
  const { Client } = pgModule;
  const client = new Client({
    connectionString: pgUrl,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  try {
    await client.connect();
    const r = await client.query("SELECT 1 AS ok FROM forge_runs LIMIT 1");
    const ms = Date.now() - start;
    await client.end().catch(() => {});
    return {
      name: "pg.select_1_from_forge_runs",
      ok: true,
      ms,
      detail: `rows=${r.rowCount}`,
    };
  } catch (e) {
    await client.end().catch(() => {});
    return {
      name: "pg.select_1_from_forge_runs",
      ok: false,
      ms: Date.now() - start,
      detail: (e as Error).message,
    };
  }
}

function fmt(r: Result): string {
  const tag = r.ok ? "PASS" : "FAIL";
  const detail = r.detail ? ` — ${r.detail}` : "";
  return `[${tag}] ${r.name.padEnd(30)} ${String(r.ms).padStart(5)}ms${detail}`;
}

async function main(): Promise<number> {
  // Best-effort dotenv load if it's installed; otherwise rely on shell env.
  try {
    const dotenv = await import("dotenv");
    dotenv.config({ path: ".env.local" });
    dotenv.config({ path: ".env" });
  } catch { /* fine — env may already be in process.env */ }

  const baseUrl = readEnv("BUTTERBASE_PROJECT_URL");
  if (!baseUrl) {
    console.error(
      "ERROR: BUTTERBASE_PROJECT_URL is not set. " +
      "Configure .env.local per the butterbase-runbook.md (promo " + PROMO + ").",
    );
    return 3;
  }

  const pgUrl = readEnv("BUTTERBASE_PG_URL");

  console.log(`PreOpReel Butterbase probe — promo=${PROMO} submission=${SUBMISSION}`);
  console.log(`target: ${baseUrl}`);
  console.log("");

  const healthz = await probeHealthz(baseUrl);
  console.log(fmt(healthz));
  if (!healthz.ok) {
    console.error("\nABORT: /healthz failed; do NOT switch DEMO_MODE=live.");
    return 1;
  }

  await sleep(50); // tiny gap so logs interleave nicely

  let exitCode = 0;
  if (pgUrl) {
    const select = await probeForgeRunsSelect(pgUrl);
    console.log(fmt(select));
    if (!select.ok) exitCode = 2;
  } else {
    console.log(
      "[skip] pg.select_1_from_forge_runs — BUTTERBASE_PG_URL not set " +
      "(probe is partial; T-30 checklist requires both)",
    );
    exitCode = 2;
  }

  console.log("");
  if (exitCode === 0) {
    console.log("OK: Butterbase auth + read path verified for the demo session.");
  } else {
    console.log("PARTIAL: see above. Required for T-30 demo-day green.");
  }
  return exitCode;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error("FATAL:", e);
  process.exit(3);
});
