#!/usr/bin/env bash
# run.sh — kill anything on :3000 / :3001 and start PreOpReel dev on :3000.
set -euo pipefail

cd "$(dirname "$0")"

for PORT in 3000 3001; do
  PIDS="$(lsof -ti tcp:${PORT} 2>/dev/null || true)"
  if [[ -n "${PIDS}" ]]; then
    echo "[run.sh] killing pid(s) on :${PORT}: ${PIDS}"
    kill -9 ${PIDS} 2>/dev/null || true
  else
    echo "[run.sh] :${PORT} clear"
  fi
done

# Tiny grace period so the OS releases the socket.
sleep 1

echo "[run.sh] starting Next dev on :3000"
exec npx next dev --turbopack --port 3000
