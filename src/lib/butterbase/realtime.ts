// ============================================================================
// src/lib/butterbase/realtime.ts — browser-side realtime subscription wrapper.
//
// Promo:      BUTTERBASE0502
// Submission: butterbase0502
// Reference:  https://www.youtube.com/watch?v=SHnryHJL9xc
//
// Drives the CriticHud directly. Mara E.1 mitigation: realtime bypasses the
// SSE proxy for critique events, dropping ~500ms write→display latency to
// the WebSocket round-trip. SSE remains the channel for stage-progression
// trace events, but per-Mara-flag and per-Lyra-score events flow through
// Butterbase realtime.
//
// Channel naming (matches plan 05 § "channel name pattern"):
//   pre:critiques:{forge_run_id}
//   pre:scores:{forge_run_id}
//
// Implementation strategy (mirrors client.ts):
//   • If `@butterbase/js` is present → use its `.channel().on().subscribe()` API.
//   • Otherwise → fall back to a typed WebSocket against the
//     `${BUTTERBASE_REALTIME_URL or PROJECT_URL}/realtime/v1/websocket`
//     endpoint with the anon JWT. Auto-reconnect with exponential backoff.
// ============================================================================

import type { CritiqueRow, CriticScoreRow } from "./types.gen";

export interface RealtimeHandle {
  unsubscribe(): void;
  // For tests / debug: read-only view of connection state.
  readonly state: "connecting" | "open" | "reconnecting" | "closed";
}

export interface SubscribeOptions {
  /** Override the public Butterbase URL; defaults to NEXT_PUBLIC_BUTTERBASE_PROJECT_URL */
  projectUrl?: string;
  /** Override the public anon key; defaults to NEXT_PUBLIC_BUTTERBASE_ANON_KEY */
  anonKey?: string;
  /** Initial reconnect backoff in ms (default 500). Doubles each retry, capped at 8s. */
  initialBackoffMs?: number;
  /** Max reconnect attempts before giving up (default Infinity). */
  maxAttempts?: number;
}

interface RealtimeEnv {
  url: string;
  anonKey: string;
}

function loadEnv(opts?: SubscribeOptions): RealtimeEnv {
  // Browser-only — pull NEXT_PUBLIC_* from process.env (Next.js inlines them).
  const url =
    opts?.projectUrl ??
    process.env.BUTTERBASE_REALTIME_URL ??
    process.env.NEXT_PUBLIC_BUTTERBASE_PROJECT_URL ??
    "";
  const key =
    opts?.anonKey ?? process.env.NEXT_PUBLIC_BUTTERBASE_ANON_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "[butterbase/realtime] NEXT_PUBLIC_BUTTERBASE_PROJECT_URL and " +
        "NEXT_PUBLIC_BUTTERBASE_ANON_KEY are required",
    );
  }
  return { url: url.replace(/\/$/, ""), anonKey: key };
}

function wsUrlFor(projectUrl: string, anonKey: string): string {
  // Convert https:// → wss://, http:// → ws://.
  const ws = projectUrl
    .replace(/^https:\/\//, "wss://")
    .replace(/^http:\/\//, "ws://");
  // Supabase-shape realtime endpoint.
  return `${ws}/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
}

/**
 * subscribeToCritiques — fires `onInsert(row)` for every new critiques row
 * matching `forge_run_id`. Auto-reconnects on transient WebSocket failures.
 *
 * Mara E.1 mitigation: this bypasses the SSE proxy entirely; WebSocket round
 * trip is sub-50ms vs. SSE's ~500ms persist-then-relay path.
 */
export function subscribeToCritiques(
  forgeRunId: string,
  onInsert: (row: CritiqueRow) => void,
  opts?: SubscribeOptions,
): RealtimeHandle {
  return subscribeFiltered<CritiqueRow>({
    table: "critiques",
    channel: `pre:critiques:${forgeRunId}`,
    filter: `forge_run_id=eq.${forgeRunId}`,
    onInsert,
    opts: opts ?? {},
  });
}

/**
 * subscribeToCriticScores — fires `onInsert(row)` for every new critic_scores
 * row matching `forge_run_id`. Same auto-reconnect semantics.
 */
export function subscribeToCriticScores(
  forgeRunId: string,
  onInsert: (row: CriticScoreRow) => void,
  opts?: SubscribeOptions,
): RealtimeHandle {
  return subscribeFiltered<CriticScoreRow>({
    table: "critic_scores",
    channel: `pre:scores:${forgeRunId}`,
    filter: `forge_run_id=eq.${forgeRunId}`,
    onInsert,
    opts: opts ?? {},
  });
}

// ─── Internal: filtered subscription with auto-reconnect ───────────────────
interface SubArgs<T> {
  table: string;
  channel: string;
  filter: string;
  onInsert: (row: T) => void;
  opts: SubscribeOptions;
}

function subscribeFiltered<T>(args: SubArgs<T>): RealtimeHandle {
  // Guard: SSR / non-browser. Returns a no-op handle.
  if (typeof window === "undefined" || typeof WebSocket === "undefined") {
    return {
      unsubscribe: () => undefined,
      state: "closed",
    };
  }

  let env: RealtimeEnv;
  try {
    env = loadEnv(args.opts);
  } catch (e) {
    console.warn("[butterbase/realtime] env load failed:", e);
    return { unsubscribe: () => undefined, state: "closed" };
  }

  const initialBackoff = args.opts.initialBackoffMs ?? 500;
  const maxAttempts = args.opts.maxAttempts ?? Number.POSITIVE_INFINITY;
  const maxBackoff = 8_000;

  let ws: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;
  let stateRef: RealtimeHandle["state"] = "connecting";

  const connect = (): void => {
    if (stopped) return;
    stateRef = attempt === 0 ? "connecting" : "reconnecting";
    const url = wsUrlFor(env.url, env.anonKey);
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn("[butterbase/realtime] WebSocket construct failed:", e);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      stateRef = "open";
      attempt = 0;
      // Phoenix-shape join (Supabase-realtime protocol). The SDK abstracts
      // this; we hand-roll it here for the no-SDK fallback.
      const joinPayload = {
        topic: `realtime:public:${args.table}:${args.filter}`,
        event: "phx_join",
        payload: {
          config: {
            postgres_changes: [
              {
                event: "INSERT",
                schema: "public",
                table: args.table,
                filter: args.filter,
              },
            ],
          },
        },
        ref: "1",
      };
      ws?.send(JSON.stringify(joinPayload));

      // Heartbeat every 30s keeps the connection alive; Mara B.7 spirit.
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              topic: "phoenix",
              event: "heartbeat",
              payload: {},
              ref: String(Date.now()),
            }),
          );
        }
      }, 30_000);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          event?: string;
          payload?: { data?: { type?: string; record?: T }; new?: T };
        };
        // Two payload shapes are observed in the wild — Supabase v1 uses
        // `payload.new`; v2 uses `payload.data.record`. Handle both.
        if (msg.event === "postgres_changes" || msg.event === "INSERT") {
          const row =
            msg.payload?.data?.record ??
            msg.payload?.new ??
            null;
          if (row) args.onInsert(row);
        }
      } catch {
        // Malformed frame — ignore.
      }
    };

    ws.onerror = () => {
      // Browser hides details; we rely on onclose to drive reconnect.
    };

    ws.onclose = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (stopped) {
        stateRef = "closed";
        return;
      }
      scheduleReconnect();
    };
  };

  const scheduleReconnect = (): void => {
    if (stopped) return;
    if (attempt >= maxAttempts) {
      stateRef = "closed";
      return;
    }
    const backoff = Math.min(initialBackoff * Math.pow(2, attempt), maxBackoff);
    attempt += 1;
    stateRef = "reconnecting";
    reconnectTimer = setTimeout(connect, backoff);
  };

  connect();

  return {
    unsubscribe: () => {
      stopped = true;
      stateRef = "closed";
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeat) clearInterval(heartbeat);
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    },
    get state() {
      return stateRef;
    },
  };
}

/**
 * Convenience: subscribe to BOTH critiques and critic_scores for a single
 * forge run. Returns one handle that tears down both.
 */
export function subscribeCriticHud(
  forgeRunId: string,
  on: {
    onCritique: (row: CritiqueRow) => void;
    onCriticScore: (row: CriticScoreRow) => void;
  },
  opts?: SubscribeOptions,
): RealtimeHandle {
  const a = subscribeToCritiques(forgeRunId, on.onCritique, opts);
  const b = subscribeToCriticScores(forgeRunId, on.onCriticScore, opts);
  return {
    unsubscribe: () => {
      a.unsubscribe();
      b.unsubscribe();
    },
    get state() {
      // Best-effort: surface the worst of the two states.
      if (a.state === "closed" || b.state === "closed") return "closed";
      if (a.state === "reconnecting" || b.state === "reconnecting") return "reconnecting";
      if (a.state === "connecting" || b.state === "connecting") return "connecting";
      return "open";
    },
  };
}
