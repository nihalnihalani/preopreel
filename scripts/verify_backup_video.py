#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# verify_backup_video.py
#
# PreOpReel — Mara B.9 mitigation: re-hash frames from docs/demo-backup.mp4 at
# the same timestamps recorded in docs/demo-backup.fingerprint.json and compare.
# Run in CI right after record_backup_video.sh.
#
# Owner: Demo Ops Dev (Phase 3, Section C of docs/plans/04-frontend-and-demo.md).
# Promo: BUTTERBASE0502 (ALL CAPS) / Submission: butterbase0502 (lowercase).
#
# Dependencies (NOT installed by this script — document only):
#   - ffmpeg  (system binary; same one used by record_backup_video.sh)
#   - Python 3.11+ stdlib only
#
# Exit codes:
#   0 — every checkpoint matched
#   1 — fingerprint or video missing
#   2 — at least one checkpoint mismatched (fail loudly so CI sees red)
#   3 — ffmpeg unavailable
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VIDEO_PATH = REPO_ROOT / "docs" / "demo-backup.mp4"
FP_PATH = REPO_ROOT / "docs" / "demo-backup.fingerprint.json"
FRAME_SIZE = "320x180"  # must match record_backup_video.sh


def _have_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def _extract_frame(video: Path, ts: int, out: Path, size: str) -> bool:
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", str(ts), "-i", str(video),
        "-frames:v", "1",
        "-vf", f"scale={size.replace('x', ':')}",
        str(out),
    ]
    return subprocess.call(cmd) == 0


def main() -> int:
    if not _have_ffmpeg():
        sys.stderr.write("ERROR: ffmpeg not found on PATH\n")
        return 3
    if not VIDEO_PATH.exists():
        sys.stderr.write(f"ERROR: missing {VIDEO_PATH}\n")
        return 1
    if not FP_PATH.exists():
        sys.stderr.write(f"ERROR: missing {FP_PATH}\n")
        return 1

    fp = json.loads(FP_PATH.read_text())
    size = fp.get("checkpoint_size", FRAME_SIZE)
    checkpoints = fp["checkpoints"]
    expected_promo = fp.get("promo_code")
    expected_submission = fp.get("submission_code")

    if expected_promo != "BUTTERBASE0502" or expected_submission != "butterbase0502":
        sys.stderr.write(
            f"WARN: fingerprint has unexpected codes "
            f"(promo={expected_promo}, submission={expected_submission})\n"
        )

    failed: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="preopreel-verify-") as tmp_s:
        tmp = Path(tmp_s)
        for cp in checkpoints:
            ts = int(cp["timestamp_seconds"])
            expected = cp["sha256"]
            png = tmp / f"frame_{ts}.png"
            if not _extract_frame(VIDEO_PATH, ts, png, size):
                print(f"[FAIL] t={ts:>3}s — ffmpeg extract failed")
                failed.append({"ts": ts, "reason": "extract_failed"})
                continue
            actual = hashlib.sha256(png.read_bytes()).hexdigest()
            ok = actual == expected
            print(f"[{'PASS' if ok else 'FAIL'}] t={ts:>3}s  "
                  f"expected={expected[:12]}…  actual={actual[:12]}…")
            if not ok:
                failed.append({"ts": ts, "expected": expected, "actual": actual})

    print()
    if failed:
        sys.stderr.write(
            f"FAIL: {len(failed)}/{len(checkpoints)} checkpoints did not match.\n"
            f"      details: {json.dumps(failed)}\n"
        )
        return 2
    print(f"OK: all {len(checkpoints)} checkpoints match the committed fingerprint.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
