// tests/synthesis-worker/test_replay_branch.test.ts
//
// ★ Invariant 3 — wide ts-morph scan (Mara C.4).
// Every exported async function under src/lib/{seed,forge/ingestors,butterbase}/
// that hits the network MUST reference `withReplay(`. If a teammate adds a
// new outbound call under those directories without funneling through the
// replay shim, this test fails with a clear error pointing at the offender.
//
// Heuristic for "hits the network": any function whose source includes a
// `fetch(` or `await import("openai")` style network entrypoint, OR any
// function exported from the listed wrapper files (those are the
// canonical Seed wrappers).

import { describe, it, expect } from "vitest";
import { Project, SyntaxKind } from "ts-morph";
import * as path from "node:path";

const SCAN_DIRS = [
  "src/lib/seed",
  "src/lib/forge/ingestors",
  "src/lib/butterbase",
];

// Files that are pure types / re-exports / test helpers — exempt.
// Storage IO (uploadBytes / signedUrl / downloadBytes) is also exempt:
// these are CDN side-effects on opaque bytes, not deterministic AI
// generation calls. Mara C.4 covers AI/grounding paths (Tavi/Exa/Gem),
// not storage IO; the bytes themselves ARE the fixture.
const EXEMPT_FILES = new Set([
  "src/lib/seed/models.ts",
  "src/lib/butterbase/storage.ts",
  "src/lib/butterbase/pg-fallback.ts", // raw pg client; not an AI surface
  "src/lib/butterbase/realtime.ts",    // WebSocket subscription, not request/response
]);

const NETWORK_TOKENS = ["fetch(", "openai", "Redis(", "https://", "http://"];

interface Offender {
  file: string;
  fn: string;
  reason: string;
}

describe("Invariant 3 wide scan: every network-bound exported async fn calls withReplay", () => {
  it("ts-morph scan over src/lib/{seed,forge/ingestors,butterbase}", () => {
    const project = new Project({
      tsConfigFilePath: path.resolve(process.cwd(), "tsconfig.json"),
      skipAddingFilesFromTsConfig: true,
    });

    for (const dir of SCAN_DIRS) {
      project.addSourceFilesAtPaths(`${dir}/**/*.ts`);
    }

    const offenders: Offender[] = [];
    for (const sf of project.getSourceFiles()) {
      const rel = path.relative(process.cwd(), sf.getFilePath()).replace(/\\/g, "/");
      if (!SCAN_DIRS.some((d) => rel.startsWith(d))) continue;
      if (EXEMPT_FILES.has(rel)) continue;
      // Skip pure re-export / declaration files (no function bodies).
      if (rel.endsWith(".d.ts")) continue;

      // Find every exported async function declaration / variable.
      const exportedAsyncFns: { name: string; bodyText: string }[] = [];

      // function declarations
      for (const fn of sf.getFunctions()) {
        if (!fn.isExported() || !fn.isAsync()) continue;
        exportedAsyncFns.push({
          name: fn.getName() ?? "<anonymous>",
          bodyText: fn.getText(),
        });
      }
      // exported `export async function` via VariableStatement (arrow funcs)
      for (const v of sf.getVariableStatements()) {
        if (!v.isExported()) continue;
        const text = v.getText();
        if (!/=\s*async\s*[(<]/.test(text)) continue;
        const decl = v.getDeclarations()[0];
        if (!decl) continue;
        exportedAsyncFns.push({
          name: decl.getName(),
          bodyText: text,
        });
      }

      for (const fn of exportedAsyncFns) {
        const body = fn.bodyText;
        const looksNetworky = NETWORK_TOKENS.some((tok) => body.includes(tok));
        if (!looksNetworky) continue;
        if (!body.includes("withReplay")) {
          offenders.push({
            file: rel,
            fn: fn.name,
            reason: "network-touching exported async fn without withReplay",
          });
        }
      }
    }

    if (offenders.length > 0) {
      const msg =
        "Invariant 3 violations:\n" +
        offenders.map((o) => `  ${o.file}::${o.fn} — ${o.reason}`).join("\n") +
        "\nFix: route the call through withReplay() from @/lib/forge/replay.";
      // Helpful failure message, then assertion.
      throw new Error(msg);
    }

    expect(offenders).toHaveLength(0);
  });

  it("each Seed wrapper file references withReplay at least once", () => {
    const project = new Project({
      tsConfigFilePath: path.resolve(process.cwd(), "tsconfig.json"),
      skipAddingFilesFromTsConfig: true,
    });
    project.addSourceFilesAtPaths("src/lib/seed/**/*.ts");

    const wrappers = ["ark.ts", "seedance.ts", "seedream.ts", "speech.ts", "omnihuman.ts"];
    for (const w of wrappers) {
      const sf = project.getSourceFiles().find((s) => s.getFilePath().endsWith(`/${w}`));
      expect(sf, `seed wrapper ${w} must exist`).toBeDefined();
      const text = sf!.getFullText();
      expect(
        text.includes("withReplay"),
        `${w} must reference withReplay`,
      ).toBe(true);
    }
  });
});
