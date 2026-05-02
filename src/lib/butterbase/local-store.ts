// src/lib/butterbase/local-store.ts — JSON-file-backed local DB for offline/replay mode.
// Hackathon-grade: single file, no new dependencies, <80 lines.
// Persists to data/local-db/runs.json. Writes are atomic (tmpfile + rename).

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ForgeRun } from "@/lib/forge/types";

const DB_PATH = join(process.cwd(), "data", "local-db", "runs.json");
const DB_DIR  = join(process.cwd(), "data", "local-db");

interface LocalDb {
  runs: Record<string, ForgeRun>;
}

// In-process write serialization: new writes queue behind the previous one.
let _lock: Promise<void> = Promise.resolve();

function withLock(fn: () => Promise<void>): Promise<void> {
  const next = _lock.then(fn, fn); // run even if previous write failed
  _lock = next.then(() => undefined, () => undefined); // swallow so lock never stalls
  return next;
}

export async function readLocal(): Promise<LocalDb> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf-8");
    return JSON.parse(raw) as LocalDb;
  } catch {
    return { runs: {} };
  }
}

async function _write(state: LocalDb): Promise<void> {
  await fs.mkdir(DB_DIR, { recursive: true });
  const tmp = join(tmpdir(), `preopreel-runs-${randomUUID()}.json`);
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf-8");
  await fs.rename(tmp, DB_PATH);
}

export function writeLocal(state: LocalDb): Promise<void> {
  return withLock(() => _write(state));
}

export async function getLocalRun(id: string): Promise<ForgeRun | null> {
  const db = await readLocal();
  return db.runs[id] ?? null;
}

export function upsertLocalRun(row: ForgeRun): Promise<void> {
  return withLock(async () => {
    const db = await readLocal();
    db.runs[row.id] = row;
    await _write(db);
  });
}
