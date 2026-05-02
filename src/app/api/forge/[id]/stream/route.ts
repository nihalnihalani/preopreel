// GET /api/forge/{id}/stream
//
// Server-Sent Events trace stream.
//
// Plan 04 + Mara B.7 (HUD freeze mitigation):
//   - Reads from Redis stream `pre:trace:{id}` via ioredis XREAD blocking.
//   - HEARTBEAT every 3s — `: heartbeat\n\n` SSE comment line so the
//     EventSource doesn't drop the connection mid-render.
//   - Auto-closes the stream when the worker emits `{event: "done"}` or
//     `{event: "failed"}`.
//
// Buffering rules:
//   - Cache-Control: no-cache, no-transform — defeats Vercel/edge proxy
//     buffering.
//   - Content-Type: text/event-stream
//   - Connection: keep-alive
//
// Fallback: when Redis isn't configured (dev / DEMO_MODE=replay without
// a worker), we replay events from `data/replay/{id}/sse.jsonl` at the
// timestamps they were originally emitted. This makes the demo
// reproducible offline.

import { type NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const HEARTBEAT_MS = 3000; // Mara B.7
const ENC = new TextEncoder();

interface SseEvent {
  /** Optional event id; sent as `id:` line. */
  seq?: number;
  /** JSON-serializable payload; sent as `data:` line. */
  payload: unknown;
  /** When set, the stream ends after this event. */
  terminal?: boolean;
}

function encodeSse(ev: SseEvent): Uint8Array {
  const lines: string[] = [];
  if (typeof ev.seq === "number") lines.push(`id: ${ev.seq}`);
  lines.push(`data: ${JSON.stringify(ev.payload)}`);
  lines.push("", ""); // blank line terminator
  return ENC.encode(lines.join("\n"));
}

function encodeHeartbeat(): Uint8Array {
  return ENC.encode(": heartbeat\n\n");
}

/**
 * Replay stream from disk. Reads `data/replay/{id}/sse.jsonl`, emits
 * lines as SSE events spaced by their relative timestamp. Used when no
 * Redis is available (dev / replay-only).
 */
async function* replaySseFromFile(
  forgeRunId: string,
): AsyncGenerator<SseEvent, void, unknown> {
  const path = join(process.cwd(), "data", "replay", forgeRunId, "sse.jsonl");
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf-8");
  } catch {
    // Final synthetic "done" so the client doesn't hang forever.
    yield {
      seq: 0,
      payload: { event: "done", forgeRunId, stage: "12" },
      terminal: true,
    };
    return;
  }
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  let seq = 0;
  let prevTs = 0;
  for (const line of lines) {
    let parsed: { ts?: number } & Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
    const delay = prevTs > 0 ? Math.min(Math.max(ts - prevTs, 0), 1500) : 0;
    if (delay > 0) await sleep(delay);
    prevTs = ts;
    seq += 1;
    yield {
      seq,
      payload: { ...parsed, forgeRunId },
      terminal: parsed.event === "done" || parsed.event === "failed",
    };
  }
  // Belt-and-suspenders: always send a terminal event.
  yield {
    seq: seq + 1,
    payload: { event: "done", forgeRunId, stage: "12" },
    terminal: true,
  };
}

/**
 * Live stream from Redis pre:trace:{id}. Lazy-imports ioredis so the
 * route still compiles when ioredis is missing in a constrained env.
 */
async function* liveSseFromRedis(
  forgeRunId: string,
  redisUrl: string,
): AsyncGenerator<SseEvent, void, unknown> {
  let Redis: typeof import("ioredis").Redis;
  try {
    const mod = (await import("ioredis")) as typeof import("ioredis");
    Redis = mod.Redis;
  } catch {
    // Fall back to file replay if ioredis isn't available.
    yield* replaySseFromFile(forgeRunId);
    return;
  }

  const client = new Redis(redisUrl, { lazyConnect: true });
  const key = `pre:trace:${forgeRunId}`;
  let lastId = "0";
  let seq = 0;

  try {
    await client.connect();
    while (true) {
      // XREAD with 2.5s block — slightly less than the 3s heartbeat so
      // we always get a chance to emit heartbeats on idle.
      const res = (await client.xread(
        "BLOCK",
        2500,
        "STREAMS",
        key,
        lastId,
      )) as [string, [string, string[]][]][] | null;
      if (!res) {
        // idle — let the heartbeat ticker handle it
        yield { payload: { event: "idle" } } as never;
        continue;
      }
      for (const [, entries] of res) {
        for (const [entryId, fields] of entries) {
          lastId = entryId;
          seq += 1;
          // ioredis XREAD returns flat [k, v, k, v, ...]; reconstitute.
          const obj: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) {
            obj[fields[i]!] = fields[i + 1]!;
          }
          let payload: unknown = obj;
          if (typeof obj.json === "string") {
            try {
              payload = JSON.parse(obj.json);
            } catch {
              // keep raw obj
            }
          }
          const terminal =
            (typeof payload === "object" &&
              payload !== null &&
              "event" in payload &&
              ((payload as { event?: string }).event === "done" ||
                (payload as { event?: string }).event === "failed")) ||
            false;
          yield { seq, payload, terminal };
          if (terminal) {
            await client.quit().catch(() => undefined);
            return;
          }
        }
      }
    }
  } catch (err) {
    console.warn("[api/forge/stream] redis read failed:", err);
    await client.quit().catch(() => undefined);
    // Fall back to disk replay so the demo path stays alive.
    yield* replaySseFromFile(forgeRunId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(
  _req: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const { id } = await params;
  const redisUrl = process.env.REDIS_URL;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Mara B.7: every 3s, send `: heartbeat\n\n` even if no event has
      // landed. This is what makes `useEventStream` realize the
      // connection is alive.
      const heartbeatTimer = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encodeHeartbeat());
        } catch {
          clearInterval(heartbeatTimer);
        }
      }, HEARTBEAT_MS);

      // Pump events from the underlying source.
      const gen = redisUrl
        ? liveSseFromRedis(id, redisUrl)
        : replaySseFromFile(id);

      try {
        for await (const ev of gen) {
          if (closed) break;
          // Skip the synthetic "idle" yield used by the redis path.
          if (
            ev.payload &&
            typeof ev.payload === "object" &&
            "event" in ev.payload &&
            (ev.payload as { event?: string }).event === "idle"
          ) {
            continue;
          }
          try {
            controller.enqueue(encodeSse(ev));
          } catch {
            break;
          }
          if (ev.terminal) break;
        }
      } catch (err) {
        console.warn("[api/forge/stream] generator error:", err);
      } finally {
        clearInterval(heartbeatTimer);
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Defeat Next/Vercel response buffering (plan 04 §G risk).
      "X-Accel-Buffering": "no",
    },
  });
}
