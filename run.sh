#!/usr/bin/env bash
# run.sh — one-command PreOpReel dev startup.
#
#   1. Free :3000 / :3001 (kill stragglers from prior runs).
#   2. Source .env so the explainer-render decision below sees keys.
#   3. If data/explainers/demo-hip-replacement.mp4 is missing, render it
#      so the Synthesize-explainer button has something to play. Picks
#      the realistic Imagen 4 path when GEMINI_API_KEY is available;
#      falls back to the vector-schematic renderer otherwise.
#   4. exec next dev on :3000.
set -euo pipefail

cd "$(dirname "$0")"

# ─── 1. Free the dev port(s) ──────────────────────────────────────
for PORT in 3000 3001; do
  PIDS="$({ lsof -ti tcp:${PORT} 2>/dev/null || true; } | tr '\n' ' ' | sed 's/ *$//')"
  if [[ -n "${PIDS}" ]]; then
    echo "[run.sh] killing pid(s) on :${PORT}: ${PIDS}"
    kill -9 ${PIDS} 2>/dev/null || true
    sleep 0.3
    PIDS2="$({ lsof -ti tcp:${PORT} 2>/dev/null || true; } | tr '\n' ' ' | sed 's/ *$//')"
    if [[ -n "${PIDS2}" ]]; then
      echo "[run.sh] still listening on :${PORT}: ${PIDS2} — force kill"
      kill -9 ${PIDS2} 2>/dev/null || true
    fi
  else
    echo "[run.sh] :${PORT} clear"
  fi
done

sleep 1

# ─── 2. Source .env into THIS shell so the conditional below works ─
# Next dev loads .env on its own; this is just for the bash check below.
if [[ -f .env ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
fi

# ─── 3. Ensure the demo explainer MP4 exists ──────────────────────
EXPLAINER="data/explainers/demo-hip-replacement.mp4"
if [[ ! -s "${EXPLAINER}" ]]; then
  if [[ -n "${GEMINI_API_KEY:-}" ]]; then
    echo "[run.sh] explainer missing — rendering realistic version (~70s, Imagen 4 Fast)"
    npm run --silent render:explainer:realistic || {
      echo "[run.sh] realistic render failed; falling back to schematic"
      npm run --silent render:explainer
    }
  else
    echo "[run.sh] explainer missing — rendering schematic version (no GEMINI_API_KEY)"
    npm run --silent render:explainer
  fi
else
  echo "[run.sh] explainer present: ${EXPLAINER}"
fi

# ─── 4. Start Next dev ────────────────────────────────────────────
echo "[run.sh] starting Next dev on :3000"
echo "[run.sh] open http://localhost:3000/forge"
echo "[run.sh] demo run: http://localhost:3000/forge/demo-hip-replacement"
exec npx next dev --turbopack --port 3000
