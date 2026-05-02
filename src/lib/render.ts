// src/lib/render.ts
//
// Programmatic Remotion render. Called by Stage 12 of the synthesis
// worker. Plan 04 §B.3:
//   - bundle Root.tsx
//   - selectComposition("PreOpExplainer")
//   - renderMedia({ codec: "h264", crf: 18, audioCodec: "aac" })
//   - upload to Butterbase Storage; return signed URL.
//
// In dev / replay-only environments, skips the upload and writes to
// `data/explainers/{forgeRunId}.mp4` so the local API route can stream
// it.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { cpus, tmpdir } from "node:os";
import type { ShotList } from "@/lib/forge/shotList";
import type { CriticScore } from "@/lib/forge/critique";

export interface RenderExplainerInput {
  forgeRunId: string;
  shotList: ShotList;
  criticScores?: CriticScore[];
  surgeonName?: string;
  isSyntheticPhantom?: boolean;
  /** Where the per-beat MP4 / WAV fixtures live, relative to public/. */
  beatVideoBaseDir?: string;
}

export interface RenderExplainerResult {
  storageKey: string;
  signedUrl: string;
  bytesWritten: number;
  durationMs: number;
}

/**
 * Renders the explainer MP4. Returns storageKey + signedUrl when
 * Butterbase Storage is configured; otherwise writes to disk and
 * returns a `file://` URL.
 */
export async function renderExplainer(
  input: RenderExplainerInput,
): Promise<RenderExplainerResult> {
  const t0 = Date.now();
  const {
    forgeRunId,
    shotList,
    criticScores = [],
    surgeonName = "Dr. K. Chen, MD (synthetic)",
    isSyntheticPhantom = true,
    beatVideoBaseDir = "",
  } = input;

  // Lazy-import remotion modules — they pull in chromium-headless and
  // shouldn't load when this file is imported by the API surface.
  const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([
    import("@remotion/bundler"),
    import("@remotion/renderer"),
  ]);

  const entry = join(process.cwd(), "src", "remotion", "Root.tsx");
  const outDir = join(process.cwd(), "data", "explainers");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${forgeRunId}.mp4`);

  const bundleLocation = await bundle({
    entryPoint: entry,
    onProgress: (p) => {
      if (p % 20 === 0) console.log(`[render] bundle ${p}%`);
    },
    webpackOverride: (config) => config,
  });

  const inputProps = {
    forgeRunId,
    shotList,
    criticScores,
    surgeonName,
    isSyntheticPhantom,
    beatVideoBaseDir,
  };

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "PreOpExplainer",
    inputProps,
  });

  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outPath,
    inputProps,
    pixelFormat: "yuv420p",
    crf: 18,
    audioCodec: "aac",
    audioBitrate: "192k",
    concurrency: Math.min(4, Math.max(1, Math.floor(cpus().length / 2))),
  });

  const stat = await fs.stat(outPath);

  // Try uploading to Butterbase Storage.
  let storageKey = `explainers/${forgeRunId}.mp4`;
  let signedUrl = `file://${outPath}`;
  try {
    const mod = (await import("@/lib/butterbase/storage").catch(() => null)) as
      | {
          uploadExplainer?: (id: string, path: string) => Promise<string>;
          signedExplainerUrl?: (id: string) => Promise<string>;
        }
      | null;
    if (mod?.uploadExplainer) {
      storageKey = await mod.uploadExplainer(forgeRunId, outPath);
    }
    if (mod?.signedExplainerUrl) {
      signedUrl = await mod.signedExplainerUrl(forgeRunId);
    }
  } catch (err) {
    console.warn("[render] storage upload failed; using local path:", err);
  }

  return {
    storageKey,
    signedUrl,
    bytesWritten: stat.size,
    durationMs: Date.now() - t0,
  };
}

// Re-export a small convenience for ad-hoc CLI tests.
export const __TEST_ONLY__ = { tmpdir };
