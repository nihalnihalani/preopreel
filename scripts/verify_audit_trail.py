#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# verify_audit_trail.py
#
# PreOpReel — Invariant 4 CI gate (Mara C.4 mitigation: covers Tavi, Exa, Gem,
# Butterbase pointer formats — not just procedure-plan §-pointers).
#
# Walks every data/replay/{forge_run_id}/04-mara/*.json and 10-lyra/*.json plus
# the matching expected.shotlist.json, and verifies that every narrator_line
# carries at least one citation pointer that matches the format regex for its
# source_type. Prints a structured report (PASS/FAIL counts) and exits non-zero
# on any failure.
#
# Owner: Demo Ops Dev (Phase 3, Section C of docs/plans/04-frontend-and-demo.md).
# Promo: BUTTERBASE0502 (ALL CAPS) / Submission: butterbase0502 (lowercase).
#
# Dependencies: stdlib only (Python 3.11+).
# Exit codes:
#   0  — all narrator_lines have a properly-formatted citation
#   1  — fixture(s) missing
#   2  — at least one citation failure
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# Citation-pointer regex per source_type (Mara C.4 mitigation).
POINTER_REGEX: dict[str, re.Pattern[str]] = {
    "procedure_plan_section": re.compile(r"^§\d+(\.\d+)*$"),
    "pmid":                   re.compile(r"^PMID:\d{1,9}$"),
    "tavi":                   re.compile(r"^Tavi#[A-Za-z0-9_./-]+$"),
    "exa":                    re.compile(r"^Exa#[A-Za-z0-9_./-]+$"),
    "anatomy_graph":          re.compile(r"^AnatomyGraph#[A-Za-z0-9_./-]+$"),
    "butterbase":             re.compile(r"^butterbase://[A-Za-z0-9_/.-]+$"),
    "curated_ref_id":         re.compile(r"^ref-[a-z0-9-]{4,}$"),
}


def _load_json(p: Path) -> dict | list | None:
    if not p.exists():
        return None
    return json.loads(p.read_text())


def _validate_pointer(source_type: str, pointer: str) -> tuple[bool, str]:
    rx = POINTER_REGEX.get(source_type)
    if rx is None:
        return False, f"unknown source_type '{source_type}'"
    if not rx.match(pointer):
        return False, f"pointer '{pointer}' does not match {rx.pattern} for {source_type}"
    return True, ""


def _verify_run(run_dir: Path, fixture_dir: Path, *,
                run_id: str) -> tuple[int, int, list[dict]]:
    """Returns (pass_count, fail_count, failures[])."""
    failures: list[dict] = []
    passes = 0

    # Shotlist source: prefer the replay copy (03-director/shotlist.json),
    # fall back to expected.shotlist.json fixture.
    shotlist = (
        _load_json(run_dir / "03-director" / "shotlist.json")
        or _load_json(fixture_dir / "expected.shotlist.json")
    )
    if shotlist is None:
        return 0, 0, [{"run_id": run_id, "issue": "no shotlist found"}]

    # Critique + scores fixtures (sanity check: must exist).
    critique = (
        _load_json(run_dir / "04-mara" / "critiques.json")
        or _load_json(fixture_dir / "expected.critique.json")
    )
    scores = (
        _load_json(run_dir / "10-lyra" / "scores.json")
        or _load_json(fixture_dir / "expected.scores.json")
    )

    if critique is None:
        failures.append({"run_id": run_id, "issue": "missing 04-mara/*.json critique data"})
    if scores is None:
        failures.append({"run_id": run_id, "issue": "missing 10-lyra/*.json scores data"})

    beats = shotlist.get("beats", [])
    for beat in beats:
        beat_id = beat.get("id", "<unknown>")
        narrator = beat.get("narrator_line", "")
        cites = beat.get("citations", []) or []
        if not narrator:
            continue  # nothing to cite
        if not cites:
            failures.append({
                "run_id": run_id, "beat_id": beat_id,
                "issue": "narrator_line has no citations",
                "narrator_line": narrator[:120],
            })
            continue
        any_valid = False
        for c in cites:
            ok, why = _validate_pointer(c.get("source_type", ""), c.get("pointer", ""))
            if ok:
                any_valid = True
            else:
                failures.append({
                    "run_id": run_id, "beat_id": beat_id, "issue": "bad pointer",
                    "detail": why, "citation": c,
                })
        if any_valid:
            passes += 1

    return passes, len(failures), failures


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(
        description="Verify audit-trail citation completeness across replay fixtures."
    )
    p.add_argument(
        "--replay-root", default=str(REPO_ROOT / "data" / "replay"),
        help="Root containing per-run replay subdirs (default: data/replay).",
    )
    p.add_argument(
        "--fixture-root", default=str(REPO_ROOT / "data" / "fixtures"),
        help="Root containing per-run fixture subdirs (default: data/fixtures).",
    )
    p.add_argument(
        "--json", action="store_true",
        help="Emit machine-readable JSON report on stdout.",
    )
    args = p.parse_args(argv)

    replay_root = Path(args.replay_root)
    fixture_root = Path(args.fixture_root)
    if not replay_root.exists():
        sys.stderr.write(f"ERROR: replay root not found: {replay_root}\n")
        return 1

    runs = [d for d in sorted(replay_root.iterdir()) if d.is_dir()]
    if not runs:
        sys.stderr.write(f"ERROR: no run subdirs in {replay_root}\n")
        return 1

    overall_pass = 0
    overall_fail = 0
    all_failures: list[dict] = []
    per_run_summary: list[dict] = []

    for run_dir in runs:
        run_id = run_dir.name
        fixture_dir = fixture_root / run_id
        passes, fails, failures = _verify_run(run_dir, fixture_dir, run_id=run_id)
        overall_pass += passes
        overall_fail += fails
        all_failures.extend(failures)
        per_run_summary.append({
            "run_id": run_id, "passing_beats": passes, "failures": fails,
        })

    report = {
        "promo_code": "BUTTERBASE0502",
        "submission_code": "butterbase0502",
        "summary": {
            "passing_beats": overall_pass,
            "failures": overall_fail,
            "ok": overall_fail == 0,
        },
        "per_run": per_run_summary,
        "failures": all_failures,
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        for r in per_run_summary:
            mark = "PASS" if r["failures"] == 0 else "FAIL"
            print(f"[{mark}] {r['run_id']:30s} "
                  f"passing={r['passing_beats']}  failures={r['failures']}")
        if all_failures:
            print()
            print(f"FAIL: {overall_fail} citation issue(s):")
            for f in all_failures:
                print(f"  - {f}")
        else:
            print(f"\nOK: all {overall_pass} narrator_lines have valid citations.")

    return 0 if overall_fail == 0 else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
