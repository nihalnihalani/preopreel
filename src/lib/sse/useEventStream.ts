"use client";

// useEventStream — client hook over native EventSource.
//
// Mara B.7 mitigation surface:
//   - heartbeat detection (warn if no message for 6s; the server emits
//     `: heartbeat\n\n` every 3s)
//   - auto-reconnect with exponential backoff (1s, 2s, 4s, 8s cap)
//   - a visible "reconnecting…" badge state surfaced via the returned
//     ConnectionState so consumers can paint it
//
// Generic — works for any JSON-shaped SSE stream. The optional `filter`
// predicate gates which events bubble up to onEvent. Useful when the
// AnatomyGraphViewer wants only stage===2c, the CriticHud wants
// stage===4 || stage===10, etc.
//
// Returns `{ status, lastEventAt, isStale, reconnectAttempt }` so the
// caller can render heartbeat-aware UI without re-implementing it per
// component.

import { useEffect, useRef, useState } from "react";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "stale" // open but no event for >STALE_THRESHOLD_MS
  | "reconnecting"
  | "closed";

export interface UseEventStreamArgs<T> {
  /** SSE endpoint URL. Pass empty/null to disable. */
  url: string | null | undefined;
  /** Per-event handler. Called only for events that pass `filter`. */
  onEvent: (event: T) => void;
  /** Optional predicate. Returning false drops the event silently. */
  filter?: (event: T) => boolean;
  /** Stop the stream when true (e.g., status === "done" or "failed"). */
  paused?: boolean;
  /** Mara B.7 — ms after which the connection is considered stale.
      Default 6000ms (server heartbeats every 3s; 2× allows one drop). */
  staleThresholdMs?: number;
  /** Initial reconnect delay; doubles up to maxDelayMs. */
  initialDelayMs?: number;
  /** Cap on backoff. */
  maxDelayMs?: number;
}

export interface UseEventStreamState {
  status: ConnectionState;
  lastEventAt: number | null;
  isStale: boolean;
  reconnectAttempt: number;
}

const DEFAULT_STALE_MS = 6000; // Mara B.7
const DEFAULT_INITIAL_DELAY = 1000;
const DEFAULT_MAX_DELAY = 8000;

export function useEventStream<T>(
  args: UseEventStreamArgs<T>,
): UseEventStreamState {
  const {
    url,
    onEvent,
    filter,
    paused = false,
    staleThresholdMs = DEFAULT_STALE_MS,
    initialDelayMs = DEFAULT_INITIAL_DELAY,
    maxDelayMs = DEFAULT_MAX_DELAY,
  } = args;

  const [state, setState] = useState<UseEventStreamState>({
    status: "idle",
    lastEventAt: null,
    isStale: false,
    reconnectAttempt: 0,
  });

  // Refs so reconnect logic survives re-renders and we can clean up
  // synchronously in StrictMode double-invoke / unmount.
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const lastEventAtRef = useRef<number>(0);
  const reconnectAttemptRef = useRef<number>(0);
  const onEventRef = useRef(onEvent);
  const filterRef = useRef(filter);

  // Keep the latest callbacks without re-triggering the connect effect.
  useEffect(() => {
    onEventRef.current = onEvent;
    filterRef.current = filter;
  }, [onEvent, filter]);

  useEffect(() => {
    if (!url || paused) {
      cleanup();
      setState((s) => ({ ...s, status: "idle" }));
      return cleanup;
    }

    let disposed = false;

    function connect() {
      if (disposed) return;
      cleanup();

      const attempt = reconnectAttemptRef.current;
      setState((s) => ({
        ...s,
        status: attempt > 0 ? "reconnecting" : "connecting",
        reconnectAttempt: attempt,
      }));

      const es = new EventSource(url!);
      esRef.current = es;

      es.onopen = () => {
        if (disposed) return;
        reconnectAttemptRef.current = 0;
        lastEventAtRef.current = Date.now();
        setState({
          status: "open",
          lastEventAt: lastEventAtRef.current,
          isStale: false,
          reconnectAttempt: 0,
        });
      };

      es.onmessage = (ev: MessageEvent<string>) => {
        if (disposed) return;
        lastEventAtRef.current = Date.now();
        // Update lastEventAt + clear stale flag; keep status open
        // (any non-open status flips back here on a real message).
        setState((s) => ({
          ...s,
          status: "open",
          lastEventAt: lastEventAtRef.current,
          isStale: false,
        }));

        if (!ev.data) return;
        // Heartbeat lines arrive as comments (": heartbeat") which the
        // EventSource API discards before onmessage fires — so any
        // payload here is a real event.
        let payload: T;
        try {
          payload = JSON.parse(ev.data) as T;
        } catch {
          return;
        }
        if (filterRef.current && !filterRef.current(payload)) return;
        try {
          onEventRef.current(payload);
        } catch (err) {
          console.error("[useEventStream] onEvent threw:", err);
        }
      };

      es.onerror = () => {
        if (disposed) return;
        // EventSource will auto-reconnect, but its backoff is opaque
        // and on some browsers it gives up after a few attempts. We
        // implement explicit backoff so the UX is predictable.
        es.close();
        esRef.current = null;
        reconnectAttemptRef.current += 1;
        const delay = Math.min(
          initialDelayMs * 2 ** (reconnectAttemptRef.current - 1),
          maxDelayMs,
        );
        setState((s) => ({
          ...s,
          status: "reconnecting",
          reconnectAttempt: reconnectAttemptRef.current,
        }));
        reconnectTimerRef.current = setTimeout(connect, delay);
      };
    }

    // Mara B.7 — staleness watchdog. Fires every 1s; if no event for
    // staleThresholdMs (default 6s = 2× the 3s server heartbeat), flips
    // status to "stale" so the UI can paint a "reconnecting…" badge.
    heartbeatIntervalRef.current = setInterval(() => {
      if (disposed) return;
      const last = lastEventAtRef.current;
      if (!last) return;
      const elapsed = Date.now() - last;
      const stale = elapsed > staleThresholdMs;
      setState((s) => {
        if (stale === s.isStale) return s;
        return {
          ...s,
          isStale: stale,
          status: stale && s.status === "open" ? "stale" : s.status,
        };
      });
    }, 1000);

    connect();

    function cleanup() {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    }

    return () => {
      disposed = true;
      cleanup();
      setState((s) => ({ ...s, status: "closed" }));
    };
  }, [url, paused, staleThresholdMs, initialDelayMs, maxDelayMs]);

  return state;
}
