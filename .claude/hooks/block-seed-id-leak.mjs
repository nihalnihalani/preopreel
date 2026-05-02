#!/usr/bin/env node
// Invariant 2 — refuse Edit/Write that would embed a Seed model ID
// outside the single source of truth: src/lib/seed/models.ts
//
// Receives Claude Code hook payload on stdin. Exit 0 = allow; exit 2 = block (blocks the tool call).

import { readFileSync } from "node:fs";

const SEED_ID_PATTERN =
  /\b(seed-2\.0-(?:pro|lite)|seedream-5\.0-lite|seedance-2\.0(?:-extend)?|seed-speech-2\.0|omnihuman-1\.5)\b/i;

const SOURCE_OF_TRUTH = "src/lib/seed/models.ts";

const payloadRaw = readFileSync(0, "utf8");
let payload;
try {
  payload = JSON.parse(payloadRaw);
} catch {
  process.exit(0);
}

const params = payload?.tool_input ?? payload?.params ?? {};
const file = params.file_path ?? params.target_file ?? "";
const text = params.new_string ?? params.content ?? "";

if (!text || file.endsWith(SOURCE_OF_TRUTH) || file.includes("docs/") || file.includes("/plans/")) {
  process.exit(0);
}

if (SEED_ID_PATTERN.test(text)) {
  process.stderr.write(
    `[invariant-2] Refusing edit: Seed model id detected in '${file}'. ` +
      `Import from ${SOURCE_OF_TRUTH} instead.\n`,
  );
  process.exit(2);
}

process.exit(0);
