#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# demo_mode_switch.sh
#
# PreOpReel — atomic DEMO_MODE flip across .env.local.
# Refuses `live` unless --i-know-what-im-doing is also passed (Mara B.4 —
# never run live for the first time on stage).
#
# Owner: Demo Ops Dev (Phase 3, Section C of docs/plans/04-frontend-and-demo.md).
# Promo: BUTTERBASE0502 (ALL CAPS) / Submission: butterbase0502 (lowercase).
#
# Usage:
#   ./scripts/demo_mode_switch.sh replay
#   ./scripts/demo_mode_switch.sh hybrid
#   ./scripts/demo_mode_switch.sh live --i-know-what-im-doing
#
# Exit codes:
#   0  — switched successfully
#   1  — bad arg
#   2  — live requested without the safety flag
#   3  — .env.local could not be written atomically
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env.local"
ENV_EXAMPLE="${REPO_ROOT}/.env.example"
NEXT_PID_FILE="${REPO_ROOT}/.next/server.pid"

usage() {
  cat <<USAGE
Usage: $0 <replay|live|hybrid> [--i-know-what-im-doing]

  replay   — hermetic; serve cached fixtures, no outbound calls (DEFAULT for stage)
  hybrid   — live with a per-stage budget; falls back to replay on timeout
  live     — every Seed call hits ModelArk. REQUIRES --i-know-what-im-doing.

Exit:
  0 ok | 1 bad arg | 2 live without safety flag | 3 io error
USAGE
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

MODE="$1"
SAFETY="${2:-}"

case "${MODE}" in
  replay|hybrid|live) ;;
  -h|--help) usage; exit 0 ;;
  *)
    echo "ERROR: invalid mode '${MODE}'" >&2
    usage
    exit 1
    ;;
esac

if [[ "${MODE}" == "live" && "${SAFETY}" != "--i-know-what-im-doing" ]]; then
  cat >&2 <<'BLOCK'
REFUSED: switching to DEMO_MODE=live requires --i-know-what-im-doing.

Mara B.4 — never run DEMO_MODE=live for the first time on stage.
Pre-warm and dry-run twice in replay before flipping live.

If you really want this:
  ./scripts/demo_mode_switch.sh live --i-know-what-im-doing
BLOCK
  exit 2
fi

# ── Bootstrap .env.local from .env.example if missing ────────────────────────
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${ENV_EXAMPLE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    echo "[bootstrap] copied .env.example -> .env.local"
  else
    : > "${ENV_FILE}"
  fi
fi

# ── Atomic rewrite via mktemp + mv ───────────────────────────────────────────
TMP_FILE="$(mktemp "${ENV_FILE}.XXXXXX")"
trap 'rm -f "${TMP_FILE}"' EXIT

# Strip any prior DEMO_MODE / NEXT_PUBLIC_DEMO_MODE lines, then append fresh.
grep -vE '^(DEMO_MODE|NEXT_PUBLIC_DEMO_MODE)=' "${ENV_FILE}" > "${TMP_FILE}" || true
{
  echo "DEMO_MODE=${MODE}"
  echo "NEXT_PUBLIC_DEMO_MODE=${MODE}"
} >> "${TMP_FILE}"

# Atomic replace.
if ! mv "${TMP_FILE}" "${ENV_FILE}"; then
  echo "ERROR: failed to move ${TMP_FILE} -> ${ENV_FILE}" >&2
  exit 3
fi
trap - EXIT

echo "[ok] DEMO_MODE=${MODE} written to .env.local"
echo "[ok] NEXT_PUBLIC_DEMO_MODE=${MODE} written to .env.local"

# ── SIGHUP a running `next dev` if a PID file exists ─────────────────────────
if [[ -f "${NEXT_PID_FILE}" ]]; then
  if PID="$(cat "${NEXT_PID_FILE}")" && [[ -n "${PID}" ]]; then
    if kill -0 "${PID}" 2>/dev/null; then
      kill -HUP "${PID}" || true
      echo "[ok] SIGHUP sent to next dev (pid=${PID})"
    else
      echo "[note] next dev pid=${PID} not running"
    fi
  fi
else
  echo "[note] no next dev pid file at ${NEXT_PID_FILE} — skipping reload"
fi

# ── Friendly tail ────────────────────────────────────────────────────────────
case "${MODE}" in
  replay)
    echo "next:  python scripts/prewarm_demo.py --verify"
    ;;
  hybrid)
    echo "next:  HYBRID_LIVE_BUDGET_S=8.0 npm run dev"
    ;;
  live)
    echo "WARNING: DEMO_MODE=live is set. Verify ARK_API_KEY is present and"
    echo "         BUTTERBASE0502 promo credit is applied before any dry-run."
    ;;
esac

exit 0
