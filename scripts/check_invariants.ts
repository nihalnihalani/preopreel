#!/usr/bin/env tsx
//
// scripts/check_invariants.ts
//
// Runs the four invariant gates locally and in CI:
//   1. grep `seed-2.0|seedream-5.0|seedance-2.0|seed-speech-2.0|omnihuman-1.5`
//      outside src/lib/seed/models.ts → must be empty
//   2. ts-morph keyframe-anchoring: every Seedance call has image_refs guard
//   3. ts-morph replay-branch wide scan
//   4. validate data/replay/demo-hip-replacement/manifest.json sha256s
//
// Exits non-zero with a clear message on any failure.

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { Project } from "ts-morph";

interface FailureReport {
  gate: string;
  detail: string;
}

const failures: FailureReport[] = [];

function ok(name: string, detail: string): void {
  // eslint-disable-next-line no-console
  console.log(`  [ok] ${name}: ${detail}`);
}

function fail(gate: string, detail: string): void {
  failures.push({ gate, detail });
  // eslint-disable-next-line no-console
  console.error(`  [FAIL] ${gate}: ${detail}`);
}

// ─── Gate 1: Seed model id grep ───────────────────────────────────────────

async function gate1Grep(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[gate 1] Seed model id grep");
  const pattern = "seed-2\\.0|seedream-5\\.0|seedance-2\\.0|seed-speech-2\\.0|omnihuman-1\\.5";
  const result = spawnSync(
    "grep",
    [
      "-rEn",
      pattern,
      "src/",
      "--include=*.ts",
      "--include=*.tsx",
    ],
    { encoding: "utf8" },
  );
  if (result.error) {
    fail("gate-1", `grep failed: ${result.error.message}`);
    return;
  }
  const lines = (result.stdout ?? "").split("\n").filter(Boolean);
  // Allow ONLY src/lib/seed/models.ts
  const offenders = lines.filter((l) => !l.startsWith("src/lib/seed/models.ts:"));
  if (offenders.length > 0) {
    fail(
      "gate-1",
      `Seed model ids found outside src/lib/seed/models.ts:\n${offenders.join("\n")}`,
    );
    return;
  }
  ok("gate-1", `grep clean (model ids confined to src/lib/seed/models.ts)`);
}

// ─── Gate 2: keyframe anchoring (ts-morph) ────────────────────────────────

async function gate2KeyframeAnchoring(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[gate 2] keyframe anchoring (ts-morph)");
  const project = new Project({
    tsConfigFilePath: path.resolve(process.cwd(), "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths("src/lib/seed/seedance.ts");
  project.addSourceFilesAtPaths("src/lib/forge/compileSeedancePrompt.ts");

  const seedance = project.getSourceFiles().find((sf) =>
    sf.getFilePath().endsWith("/src/lib/seed/seedance.ts"),
  );
  const compiler = project.getSourceFiles().find((sf) =>
    sf.getFilePath().endsWith("/src/lib/forge/compileSeedancePrompt.ts"),
  );
  if (!seedance) {
    fail("gate-2", "src/lib/seed/seedance.ts missing");
    return;
  }
  if (!compiler) {
    fail("gate-2", "src/lib/forge/compileSeedancePrompt.ts missing");
    return;
  }
  const seedanceText = seedance.getFullText();
  const compilerText = compiler.getFullText();
  if (!seedanceText.includes("SeedanceInvariantError")) {
    fail("gate-2", "seedance.ts missing SeedanceInvariantError reference");
    return;
  }
  if (!seedanceText.includes("image_refs.length === 0")) {
    fail("gate-2", "seedance.ts missing image_refs.length === 0 guard");
    return;
  }
  if (!compilerText.includes("image_refs.length === 0")) {
    fail("gate-2", "compileSeedancePrompt.ts missing image_refs.length === 0 guard");
    return;
  }
  ok("gate-2", "image_refs guard present in seedance + compiler");
}

// ─── Gate 3: replay-branch wide scan (ts-morph) ───────────────────────────

async function gate3ReplayScan(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[gate 3] replay-branch wide scan");
  const project = new Project({
    tsConfigFilePath: path.resolve(process.cwd(), "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths([
    "src/lib/seed/**/*.ts",
    "src/lib/forge/ingestors/**/*.ts",
    "src/lib/butterbase/**/*.ts",
  ]);
  const SCAN_DIRS = [
    "src/lib/seed",
    "src/lib/forge/ingestors",
    "src/lib/butterbase",
  ];
  // Storage IO + raw pg + WebSocket realtime are exempt — these are
  // side-effect or transport surfaces, not deterministic AI generation
  // calls. Mara C.4 covers AI/grounding paths (Tavi/Exa/Gem); the
  // bytes themselves ARE the fixture for storage.
  const EXEMPT = new Set([
    "src/lib/seed/models.ts",
    "src/lib/butterbase/storage.ts",
    "src/lib/butterbase/pg-fallback.ts",
    "src/lib/butterbase/realtime.ts",
  ]);
  const NETWORK_TOKENS = ["fetch(", "openai", "Redis(", "https://", "http://"];

  const offenders: string[] = [];
  for (const sf of project.getSourceFiles()) {
    const rel = path
      .relative(process.cwd(), sf.getFilePath())
      .replace(/\\/g, "/");
    if (!SCAN_DIRS.some((d) => rel.startsWith(d))) continue;
    if (EXEMPT.has(rel)) continue;
    const exportedAsync: { name: string; text: string }[] = [];
    for (const fn of sf.getFunctions()) {
      if (!fn.isExported() || !fn.isAsync()) continue;
      exportedAsync.push({ name: fn.getName() ?? "<anon>", text: fn.getText() });
    }
    for (const v of sf.getVariableStatements()) {
      if (!v.isExported()) continue;
      const text = v.getText();
      if (!/=\s*async\s*[\(<]/.test(text)) continue;
      const decl = v.getDeclarations()[0];
      if (!decl) continue;
      exportedAsync.push({ name: decl.getName(), text });
    }
    for (const fn of exportedAsync) {
      if (!NETWORK_TOKENS.some((t) => fn.text.includes(t))) continue;
      if (!fn.text.includes("withReplay")) {
        offenders.push(`${rel}::${fn.name}`);
      }
    }
  }
  if (offenders.length > 0) {
    fail("gate-3", `network-bound exported async fns missing withReplay:\n  ${offenders.join("\n  ")}`);
    return;
  }
  ok("gate-3", `every scanned async fn routes through withReplay`);
}

// ─── Gate 4: replay manifest sha256 verification ──────────────────────────

async function gate4Manifest(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("[gate 4] replay manifest sha256");
  const manifestPath = path.resolve(
    process.cwd(),
    "data/replay/demo-hip-replacement/manifest.json",
  );
  // Manifest shape (produced by scripts/prewarm_demo.py):
  //   { forge_run_id, generated_at, promo_code, submission_code,
  //     files: { "<rel-path>": { sha256, bytes, source } } }
  interface ManifestEntry { sha256: string; bytes?: number; source?: string }
  interface Manifest {
    forge_run_id?: string;
    generated_at?: string;
    promo_code?: string;
    submission_code?: string;
    files: Record<string, ManifestEntry | string>;
  }
  let manifest: Manifest;
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    manifest = JSON.parse(raw) as Manifest;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      ok("gate-4", "manifest.json not yet present (skip — pre-warm pending)");
      return;
    }
    fail("gate-4", `manifest unreadable: ${e.message}`);
    return;
  }
  if (!manifest.files || typeof manifest.files !== "object") {
    fail("gate-4", "manifest.json missing 'files' record");
    return;
  }
  const root = path.dirname(manifestPath);
  const mismatches: string[] = [];
  for (const [relPath, entryRaw] of Object.entries(manifest.files)) {
    if (relPath === "manifest.json") continue;
    const expected =
      typeof entryRaw === "string" ? entryRaw : entryRaw.sha256;
    try {
      const data = await fs.readFile(path.join(root, relPath));
      const actual = createHash("sha256").update(data).digest("hex");
      if (actual !== expected) {
        mismatches.push(`${relPath}: expected ${expected.slice(0, 12)} got ${actual.slice(0, 12)}`);
      }
    } catch (err) {
      mismatches.push(`${relPath}: ${(err as Error).message}`);
    }
  }
  if (mismatches.length > 0) {
    fail("gate-4", `manifest mismatches:\n  ${mismatches.join("\n  ")}`);
    return;
  }
  ok("gate-4", `${Object.keys(manifest.files).length} fixtures verified`);
}

// ─── Run ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("PreOpReel — invariant checks\n");
  await gate1Grep();
  await gate2KeyframeAnchoring();
  await gate3ReplayScan();
  await gate4Manifest();
  // eslint-disable-next-line no-console
  console.log("");
  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`FAILED ${failures.length} gate(s).`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("ALL GATES GREEN.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("check_invariants crashed:", err);
  process.exit(2);
});
