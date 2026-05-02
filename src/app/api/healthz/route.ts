// GET /api/healthz
//
// Liveness + DEMO_MODE + sponsor-service probes (Butterbase, Redis).
// Used by:
//   - the navbar status dot
//   - the DebugInvariantPanel (Mara G.3) for live invariant status
//   - scripts/probe_butterbase.ts during T-30 stage check (Mara B.5)
//
// Each probe is wrapped in a short timeout — never blocks the route on
// a stuck dependency. Returns shape compatible with the
// DebugInvariantPanel's `invariants[]` schema.

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 1500;

interface ProbeOk {
  ok: true;
  detail?: string;
  durationMs: number;
}
interface ProbeErr {
  ok: false;
  detail: string;
  durationMs: number;
}
type ProbeResult = ProbeOk | ProbeErr;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} probe timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

async function probeButterbase(): Promise<ProbeResult> {
  const start = Date.now();
  try {
    const mod = (await import("@/lib/butterbase/client").catch(() => null)) as
      | { ping?: () => Promise<{ ok: boolean }> }
      | null;
    if (!mod?.ping) {
      return { ok: false, detail: "client not present", durationMs: Date.now() - start };
    }
    const res = await withTimeout(mod.ping(), PROBE_TIMEOUT_MS, "butterbase");
    return res.ok
      ? { ok: true, durationMs: Date.now() - start }
      : { ok: false, detail: "ping returned ok=false", durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function probeRedis(): Promise<ProbeResult> {
  const start = Date.now();
  const url = process.env.REDIS_URL;
  if (!url) {
    return { ok: true, detail: "not configured (replay-only)", durationMs: 0 };
  }
  try {
    const { Redis } = await import("ioredis");
    const c = new Redis(url, { lazyConnect: true });
    await withTimeout(c.connect(), PROBE_TIMEOUT_MS, "redis");
    const pong = await withTimeout(c.ping(), PROBE_TIMEOUT_MS, "redis");
    await c.quit().catch(() => undefined);
    return pong === "PONG"
      ? { ok: true, durationMs: Date.now() - start }
      : { ok: false, detail: `unexpected reply: ${pong}`, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

async function probeSeed(): Promise<ProbeResult> {
  const start = Date.now();
  // We don't actually call ModelArk on the healthz path (rate limits).
  // We only verify that the SEED_MODELS pin file is reachable.
  try {
    const mod = await import("@/lib/seed/models");
    const ok =
      typeof mod.SEED_MODELS === "object" &&
      mod.SEED_MODELS !== null &&
      "director" in mod.SEED_MODELS;
    return ok
      ? { ok: true, durationMs: Date.now() - start }
      : { ok: false, detail: "SEED_MODELS missing keys", durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

export async function GET(): Promise<NextResponse> {
  const now = new Date().toISOString();
  const [bb, redis, seed] = await Promise.all([
    probeButterbase(),
    probeRedis(),
    probeSeed(),
  ]);

  // Map probes into the four-invariant shape consumed by the
  // DebugInvariantPanel.
  const invariants = [
    {
      id: 1 as const,
      label: "Critic loop mandatory",
      shortLabel: "Critic",
      ok: true, // structural — verified at PR time
      lastCheckedAt: now,
      detail: "Mara + Lyra personas exported (build-time check)",
    },
    {
      id: 2 as const,
      label: "Seed pinning + Tier-0 anchoring",
      shortLabel: "Seed pin",
      ok: seed.ok,
      lastCheckedAt: now,
      detail: seed.ok ? "SEED_MODELS pinned" : seed.detail,
    },
    {
      id: 3 as const,
      label: "Hermetic DEMO_MODE",
      shortLabel: "Replay",
      ok: true, // verified at PR time via test_replay_branch
      lastCheckedAt: now,
      detail: `DEMO_MODE=${process.env.DEMO_MODE ?? "replay"}`,
    },
    {
      id: 4 as const,
      label: "Citation-bound audit",
      shortLabel: "Audit",
      ok: true, // verified by verify_audit_trail.py in CI
      lastCheckedAt: now,
      detail: "audit schema parses; verify_audit_trail.py CI gate",
    },
  ];

  const overallOk = bb.ok && redis.ok && seed.ok;
  const status = overallOk ? 200 : 503;

  return NextResponse.json(
    {
      ok: overallOk,
      now,
      demoMode: process.env.DEMO_MODE ?? "replay",
      probes: { butterbase: bb, redis, seed },
      invariants,
    },
    { status },
  );
}
