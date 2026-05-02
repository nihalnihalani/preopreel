"use client";

// API client — typed wrappers around /api/forge/... endpoints, exposed
// as TanStack Query hooks for React.
//
// Plan 04 §A.5 surface:
//   useForgeRun(id)         — GET /api/forge/{id}
//   useCritiques(id)        — GET /api/forge/{id}/critique
//   useCriticScores(id)     — GET /api/forge/{id}/critic
//   useStartForgeRun()      — POST /api/forge (multipart or fixture query)
//   useRegenBeat()          — POST /api/forge/{id}/regen?beat=N
//
// All response bodies are validated against Zod schemas from src/lib/forge/.
// Error handling: throws ForgeApiError with {status, code} so consumers
// can branch on 4xx vs 5xx.

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ForgeRun } from "@/lib/forge/types";
import { Critique, CriticScore } from "@/lib/forge/critique";

// ─── Errors ────────────────────────────────────────────────────────────

export class ForgeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ForgeApiError";
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let code = "unknown_error";
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      if (body.code) code = body.code;
      if (body.message) detail = body.message;
    } catch {
      // ignore JSON parse failures
    }
    throw new ForgeApiError(res.status, code, detail);
  }
  return (await res.json()) as T;
}

// ─── URL helpers ───────────────────────────────────────────────────────

const BASE = ""; // same-origin in both dev and prod

export const forgeUrls = {
  start: () => `${BASE}/api/forge`,
  run: (id: string) => `${BASE}/api/forge/${encodeURIComponent(id)}`,
  stream: (id: string) => `${BASE}/api/forge/${encodeURIComponent(id)}/stream`,
  critique: (id: string) =>
    `${BASE}/api/forge/${encodeURIComponent(id)}/critique`,
  critic: (id: string) =>
    `${BASE}/api/forge/${encodeURIComponent(id)}/critic`,
  receipt: (id: string) =>
    `${BASE}/api/forge/${encodeURIComponent(id)}/receipt`,
  explainer: (id: string) =>
    `${BASE}/api/forge/${encodeURIComponent(id)}/explainer`,
  regen: (id: string, beat: number) =>
    `${BASE}/api/forge/${encodeURIComponent(id)}/regen?beat=${beat}`,
} as const;

// ─── useForgeRun ───────────────────────────────────────────────────────

export function useForgeRun(
  id: string | null | undefined,
): UseQueryResult<ForgeRun, ForgeApiError> {
  return useQuery({
    queryKey: ["forge-run", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await fetch(forgeUrls.run(id!), { cache: "no-store" });
      const json = await jsonOrThrow<unknown>(res);
      const parsed = ForgeRun.safeParse(json);
      if (!parsed.success) {
        throw new ForgeApiError(
          500,
          "schema_drift",
          `ForgeRun schema parse failed: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    },
    refetchInterval: (q: { state: { data?: ForgeRun } }) => {
      const data = q.state.data;
      if (!data) return 2000;
      // Once terminal, stop polling — SSE + realtime drives updates.
      return data.status === "done" || data.status === "failed" ? false : 2000;
    },
  });
}

// ─── useCritiques (Mara) ───────────────────────────────────────────────

export function useCritiques(
  id: string | null | undefined,
): UseQueryResult<Critique[], ForgeApiError> {
  return useQuery({
    queryKey: ["critiques", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await fetch(forgeUrls.critique(id!), { cache: "no-store" });
      const json = await jsonOrThrow<unknown>(res);
      const parsed = Critique.array().safeParse(json);
      if (!parsed.success) {
        throw new ForgeApiError(
          500,
          "schema_drift",
          `Critique[] schema parse failed: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    },
    staleTime: 5_000,
  });
}

// ─── useCriticScores (Lyra) ────────────────────────────────────────────

export function useCriticScores(
  id: string | null | undefined,
): UseQueryResult<CriticScore[], ForgeApiError> {
  return useQuery({
    queryKey: ["critic-scores", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await fetch(forgeUrls.critic(id!), { cache: "no-store" });
      const json = await jsonOrThrow<unknown>(res);
      const parsed = CriticScore.array().safeParse(json);
      if (!parsed.success) {
        throw new ForgeApiError(
          500,
          "schema_drift",
          `CriticScore[] schema parse failed: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    },
    staleTime: 5_000,
  });
}

// ─── useStartForgeRun ──────────────────────────────────────────────────

export interface StartForgeInput {
  /** When set, the API loads the named fixture from data/fixtures/. */
  fixture?: "hip-replacement";
  /** Otherwise, multipart upload of plan.pdf + patient.json. */
  body?: FormData;
}

export interface StartForgeResult {
  forgeRunId: string;
}

export function useStartForgeRun(): UseMutationResult<
  StartForgeResult,
  ForgeApiError,
  StartForgeInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartForgeInput) => {
      let url = forgeUrls.start();
      let body: BodyInit | undefined;
      if (input.fixture) {
        url = `${url}?fixture=${encodeURIComponent(input.fixture)}`;
      } else if (input.body) {
        body = input.body;
      }
      const res = await fetch(url, {
        method: "POST",
        body,
      });
      // Accept 200 or 202 — the API returns 202 on accept-and-process.
      if (!(res.ok || res.status === 202)) {
        await jsonOrThrow(res); // throws ForgeApiError
      }
      const json = (await res.json()) as { forge_run_id?: string };
      if (!json.forge_run_id) {
        throw new ForgeApiError(
          500,
          "missing_id",
          "Server did not return forge_run_id",
        );
      }
      return { forgeRunId: json.forge_run_id };
    },
    onSuccess: ({ forgeRunId }: StartForgeResult) => {
      // Pre-warm the run query cache so the destination route renders fast.
      queryClient.invalidateQueries({ queryKey: ["forge-run", forgeRunId] });
    },
  });
}

// ─── useRegenBeat ──────────────────────────────────────────────────────

export interface RegenBeatInput {
  forgeRunId: string;
  beat: number;
}

export function useRegenBeat(): UseMutationResult<
  { ok: true },
  ForgeApiError,
  RegenBeatInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ forgeRunId, beat }: RegenBeatInput) => {
      const res = await fetch(forgeUrls.regen(forgeRunId, beat), {
        method: "POST",
      });
      await jsonOrThrow(res);
      return { ok: true as const };
    },
    onSuccess: (_data: { ok: true }, vars: RegenBeatInput) => {
      queryClient.invalidateQueries({
        queryKey: ["critic-scores", vars.forgeRunId],
      });
    },
  });
}
