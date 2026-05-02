// src/lib/butterbase/local-store.ts — JSON-file-backed local DB for offline/replay mode.
// Hackathon-grade: single file, no new dependencies, <80 lines.
// Persists to data/local-db/runs.json. Writes are atomic (tmpfile + rename).

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ForgeRun } from "@/lib/forge/types";
import type {
  ProcedurePlanRow,
  PatientDemographicsRow,
  AnatomyGraphRow,
  ShotListRow,
  CritiqueRow,
  CriticScoreRow,
  AuditCitationRow,
} from "./types.gen";

const DB_PATH = join(process.cwd(), "data", "local-db", "runs.json");
const DB_DIR  = join(process.cwd(), "data", "local-db");

interface LocalDb {
  runs: Record<string, ForgeRun>;
  procedurePlans: ProcedurePlanRow[];
  patientDemographics: PatientDemographicsRow[];
  anatomyGraphs: AnatomyGraphRow[];
  shotLists: ShotListRow[];
  critiques: CritiqueRow[];
  criticScores: CriticScoreRow[];
  auditCitations: AuditCitationRow[];
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
    const parsed = JSON.parse(raw) as Partial<LocalDb>;
    return {
      runs: parsed.runs || {},
      procedurePlans: parsed.procedurePlans || [],
      patientDemographics: parsed.patientDemographics || [],
      anatomyGraphs: parsed.anatomyGraphs || [],
      shotLists: parsed.shotLists || [],
      critiques: parsed.critiques || [],
      criticScores: parsed.criticScores || [],
      auditCitations: parsed.auditCitations || [],
    };
  } catch {
    return {
      runs: {},
      procedurePlans: [],
      patientDemographics: [],
      anatomyGraphs: [],
      shotLists: [],
      critiques: [],
      criticScores: [],
      auditCitations: [],
    };
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

export function pushLocal<K extends keyof Omit<LocalDb, "runs">>(
  collection: K,
  row: LocalDb[K][number]
): Promise<void> {
  return withLock(async () => {
    const db = await readLocal();
    const arr = db[collection] as any[];
    
    // For shotLists, we replace the existing version if it exists
    if (collection === "shotLists") {
      const sl = row as unknown as ShotListRow;
      const idx = arr.findIndex(
        (x) => x.forge_run_id === sl.forge_run_id && x.version === sl.version
      );
      if (idx >= 0) arr[idx] = row;
      else arr.push(row);
    } else {
      arr.push(row);
    }
    
    await _write(db);
  });
}

export async function getLocalDetails(id: string) {
  const db = await readLocal();
  return {
    procedure_plan: db.procedurePlans.find((x) => x.forge_run_id === id) ?? null,
    patient_demographics: db.patientDemographics.find((x) => x.forge_run_id === id) ?? null,
    anatomy_graph: [...db.anatomyGraphs].reverse().find((x) => x.forge_run_id === id) ?? null,
    shot_lists: db.shotLists.filter((x) => x.forge_run_id === id).sort((a, b) => a.version - b.version),
    critiques: db.critiques.filter((x) => x.forge_run_id === id).sort((a, b) => (a.created_at || "").localeCompare(b.created_at || "")),
    critic_scores: db.criticScores.filter((x) => x.forge_run_id === id).sort((a, b) => {
      if (a.beat_id === b.beat_id) return a.regen_attempt - b.regen_attempt;
      return a.beat_id.localeCompare(b.beat_id);
    }),
    audit_citations: db.auditCitations.filter((x) => x.forge_run_id === id).sort((a, b) => a.claim_id.localeCompare(b.claim_id)),
  };
}
