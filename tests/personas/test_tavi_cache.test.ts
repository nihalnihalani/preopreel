// Persona test — Tavi cache hit does not trigger network.
// Pre-seeds the on-disk cache for the demo query, runs invoke(), and
// asserts that fetch is never called.
//
// This is the test that defends Invariant 3 for the Tavi side of the
// pipeline (Mara C.3): if the cache says hit, the network MUST stay
// quiet.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  invoke,
  tavilyCacheKey,
  type TaviQuery,
} from "@/lib/forge/personas/tavi";
import type { Citation } from "@/lib/forge/types";

const DEMO_QUERY: TaviQuery = {
  procedureName: "Total Hip Arthroplasty",
  approach: "posterior",
  intent: "protocol",
};

const CACHE_DIR = path.resolve("data/grounding-cache/tavi");

const CACHED_CITATIONS: Citation[] = [
  {
    sourceType: "pmid",
    pointer: "PMID:34567890",
    excerpt: "Anatomic acetabular reaming preserves bone stock for revision.",
  },
];

let cachePath: string;

beforeEach(async () => {
  // Pre-seed cache
  cachePath = path.resolve(
    CACHE_DIR,
    `${await tavilyCacheKey(DEMO_QUERY)}.json`,
  );
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(CACHED_CITATIONS, null, 2));
});

afterEach(async () => {
  // Cleanup the seeded cache file (don't pollute the repo).
  try {
    await fs.unlink(cachePath);
  } catch {
    // ignore — file may not exist
  }
});

describe("Tavi — cache", () => {
  it("returns cached citations without calling fetch", async () => {
    // tests/setup.ts already replaces fetch with a thrower; here we
    // double-check by spying on the same global.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("Network call attempted on cache hit (Invariant 3)");
      });

    const out = await invoke({ query: DEMO_QUERY });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0]?.pointer).toBe("PMID:34567890");
    expect(out[0]?.sourceType).toBe("pmid");
  });

  it("computed cache key is deterministic for the same query", async () => {
    const k1 = await tavilyCacheKey(DEMO_QUERY);
    const k2 = await tavilyCacheKey({ ...DEMO_QUERY });
    expect(k1).toBe(k2);
  });

  it("cache key changes when intent changes", async () => {
    const kProtocol = await tavilyCacheKey(DEMO_QUERY);
    const kComp = await tavilyCacheKey({
      ...DEMO_QUERY,
      intent: "complication-scope-check",
    });
    expect(kProtocol).not.toBe(kComp);
  });
});
