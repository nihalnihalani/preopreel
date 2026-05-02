#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# prewarm_demo.py
#
# PreOpReel — replay-cache pre-population orchestrator.
#
# Owner: Demo Ops Dev (Phase 3, Section C of docs/plans/04-frontend-and-demo.md).
# Promo: BUTTERBASE0502 (ALL CAPS)  /  Submission: butterbase0502 (lowercase).
#
# Modes:
#   (default)      — seed data/replay/demo-hip-replacement/{stage}/{key}.{ext}
#                    from data/fixtures/demo-hip-replacement/expected.*.json,
#                    plus tiny placeholder bytes for binary fixtures (1s black
#                    MP4, 1×1 PNG, 1s silent WAV) so the worker can complete
#                    end-to-end without live API access.
#   --verify       — re-run in replay mode: re-hash every fixture and compare
#                    against manifest.json sha256. Print PASS/FAIL per file.
#   --cost-estimate — print rough USD estimate of a `live` run, so we know
#                    whether the BUTTERBASE0502 promo + ARK trial credits cover it.
#
# Layout (matches Vision Dev's withReplay shim):
#   data/replay/{forge_run_id}/{stage}/{key}.{ext}
#   data/replay/{forge_run_id}/manifest.json   ← sha256 of every file
#
# Dependencies: stdlib only (Python 3.11+).
# Exit codes:
#   0 — success (seed wrote, --verify passed, or --cost-estimate printed)
#   1 — fixture missing or unreadable
#   2 — manifest mismatch on --verify
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
import time
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "data" / "fixtures" / "demo-hip-replacement"
REPLAY_DIR = REPO_ROOT / "data" / "replay" / "demo-hip-replacement"
RUN_ID = "demo-hip-replacement"


# ─── Stage layout — keys are deterministic so the worker can look them up ────
@dataclass(frozen=True)
class StageMap:
    stage: str            # subdir under replay/{run}/
    key: str              # filename (without extension)
    ext: str              # "json" | "mp4" | "png" | "wav"
    source: str           # "fixture:expected.shotlist" | "placeholder:mp4_1s_black"
    cost_estimate_usd: float = 0.0


# Stage assignment per the master plan §5 (Final File Tree → data/replay/...).
STAGES: list[StageMap] = [
    # ── Research fan-out ──────────────────────────────────────────────────
    StageMap("02a-tavi", "protocols", "json",
             "synthesized:tavi_protocols", cost_estimate_usd=0.02),
    StageMap("02b-exa", "visual_refs", "json",
             "synthesized:exa_visual_refs", cost_estimate_usd=0.02),
    StageMap("02c-gem", "anatomy_graph", "json",
             "synthesized:gem_anatomy_graph", cost_estimate_usd=0.05),
    StageMap("02d-pdf", "parsed_plan", "json",
             "synthesized:pdf_parse", cost_estimate_usd=0.0),

    # ── Director + critic ────────────────────────────────────────────────
    StageMap("03-director", "shotlist", "json",
             "fixture:expected.shotlist", cost_estimate_usd=0.30),
    StageMap("04-mara", "critiques", "json",
             "fixture:expected.critique", cost_estimate_usd=0.20),

    # ── Anatomy bible + lens (deterministic) + storyboard keyframes ──────
    StageMap("05-anatomy-bible", "bible", "json",
             "synthesized:anatomy_bible", cost_estimate_usd=0.40),
    StageMap("06-cinema-lens", "lens_suffix", "json",
             "synthesized:lens_taxonomy", cost_estimate_usd=0.0),
    StageMap("07-seedream", "shot_1", "png", "placeholder:png_1x1", cost_estimate_usd=0.06),
    StageMap("07-seedream", "shot_2", "png", "placeholder:png_1x1", cost_estimate_usd=0.06),
    StageMap("07-seedream", "shot_3", "png", "placeholder:png_1x1", cost_estimate_usd=0.06),
    StageMap("07-seedream", "shot_4", "png", "placeholder:png_1x1", cost_estimate_usd=0.06),
    StageMap("07-seedream", "shot_5", "png", "placeholder:png_1x1", cost_estimate_usd=0.06),
    StageMap("07-seedream", "shot_6", "png", "placeholder:png_1x1", cost_estimate_usd=0.06),

    # ── Prompt compiler (deterministic) ──────────────────────────────────
    StageMap("08-compiler", "compiled_prompts", "json",
             "synthesized:compiled_prompts", cost_estimate_usd=0.0),

    # ── Seedance generation (Beat 3 has 2 attempts — the on-stage regen) ──
    StageMap("09-seedance", "shot_1", "mp4", "placeholder:mp4_1s_black", cost_estimate_usd=0.40),
    StageMap("09-seedance", "shot_2", "mp4", "placeholder:mp4_1s_black", cost_estimate_usd=0.44),
    StageMap("09-seedance", "shot_3_attempt_1", "mp4", "placeholder:mp4_1s_black", cost_estimate_usd=0.48),
    StageMap("09-seedance", "shot_3_attempt_2", "mp4", "placeholder:mp4_1s_black", cost_estimate_usd=0.48),
    StageMap("09-seedance", "shot_4", "mp4", "placeholder:mp4_1s_black", cost_estimate_usd=0.56),
    StageMap("09-seedance", "shot_5", "mp4", "placeholder:mp4_1s_black", cost_estimate_usd=0.56),
    StageMap("09-seedance", "shot_6", "mp4", "placeholder:mp4_1s_black", cost_estimate_usd=0.56),

    # ── Lyra vision-critic scores ─────────────────────────────────────────
    StageMap("10-lyra", "scores", "json", "fixture:expected.scores", cost_estimate_usd=0.25),

    # ── Speech narration (one WAV per beat) ───────────────────────────────
    StageMap("11-speech", "shot_1", "wav", "placeholder:wav_1s_silence", cost_estimate_usd=0.04),
    StageMap("11-speech", "shot_2", "wav", "placeholder:wav_1s_silence", cost_estimate_usd=0.04),
    StageMap("11-speech", "shot_3", "wav", "placeholder:wav_1s_silence", cost_estimate_usd=0.04),
    StageMap("11-speech", "shot_4", "wav", "placeholder:wav_1s_silence", cost_estimate_usd=0.04),
    StageMap("11-speech", "shot_5", "wav", "placeholder:wav_1s_silence", cost_estimate_usd=0.04),
    StageMap("11-speech", "shot_6", "wav", "placeholder:wav_1s_silence", cost_estimate_usd=0.04),

    # ── Final composition input (audit trail surface) ─────────────────────
    StageMap("12-render", "audit", "json", "fixture:expected.audit", cost_estimate_usd=0.0),
]


# ─── Placeholder binary generators (stdlib only) ─────────────────────────────
def _placeholder_png_1x1() -> bytes:
    """Smallest possible valid PNG: 1×1 transparent black pixel."""
    sig = b"\x89PNG\r\n\x1a\n"

    def _chunk(t: bytes, data: bytes) -> bytes:
        return (
            len(data).to_bytes(4, "big") + t + data
            + zlib.crc32(t + data).to_bytes(4, "big")
        )

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)  # 1×1, 8-bit RGBA
    raw = b"\x00\x00\x00\x00\x00"  # filter byte + 4 RGBA zeros
    idat = zlib.compress(raw, 9)
    return sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def _placeholder_wav_1s_silence() -> bytes:
    """1 second of silence at 8kHz 16-bit mono — minimum viable WAV."""
    sample_rate = 8000
    n_samples = sample_rate
    data = b"\x00\x00" * n_samples  # 16-bit signed silence
    byte_rate = sample_rate * 2
    return (
        b"RIFF" + (36 + len(data)).to_bytes(4, "little") + b"WAVE"
        + b"fmt " + (16).to_bytes(4, "little")
        + (1).to_bytes(2, "little")          # PCM
        + (1).to_bytes(2, "little")          # mono
        + sample_rate.to_bytes(4, "little")
        + byte_rate.to_bytes(4, "little")
        + (2).to_bytes(2, "little")          # block align
        + (16).to_bytes(2, "little")         # bits per sample
        + b"data" + len(data).to_bytes(4, "little") + data
    )


def _placeholder_mp4_1s_black() -> bytes:
    """Minimum-viable MP4. We construct a 1-byte payload with a valid 'ftyp' box
    so file(1) detects MP4. The worker's replay shim cares only about bytes-on-disk
    + sha256; downstream Remotion uses a separately staged real MP4 in a live run.
    """
    ftyp = (
        b"\x00\x00\x00\x20"      # box size (32 bytes)
        b"ftyp"                  # box type
        b"isom"                  # major brand
        b"\x00\x00\x02\x00"      # minor version
        b"isomiso2avc1mp41"      # compatible brands
    )
    mdat = (
        b"\x00\x00\x00\x10"      # box size (16 bytes)
        b"mdat"                  # box type
        b"PreOpReelPlc"          # 12-byte placeholder payload
    )
    return ftyp + mdat


def _synthesized_json(stage: str, key: str) -> dict[str, Any]:
    """Tiny but typed JSON surrogates for stages with no fixture file."""
    base = {"forge_run_id": RUN_ID, "stage": stage, "key": key,
            "synthesized_by": "prewarm_demo.py", "synthetic_phantom": True}
    if stage == "02a-tavi":
        return {**base, "protocols": [
            {"pmid": "PMID:34567890", "title": "AAOS CPG — Total Hip Arthroplasty"},
            {"pmid": "PMID:28456712", "title": "Posterior capsular repair reduces dislocation"},
            {"pmid": "PMID:30123456", "title": "Posterior approach hip dislocation technique"},
        ]}
    if stage == "02b-exa":
        return {**base, "visual_refs": [
            {"url": "exa://hip_osteotomy_angle", "license": "CC-BY"},
            {"url": "exa://femoral_stem_insertion", "license": "CC-BY"},
        ]}
    if stage == "02c-gem":
        return {**base, "anatomy_graph": {
            "landmarks": [
                {"id": "acetabulum", "confidence_band": {"lo": 0.84, "hi": 0.93}},
                {"id": "femoral_head", "confidence_band": {"lo": 0.78, "hi": 0.91}},
                {"id": "greater_trochanter", "confidence_band": {"lo": 0.58, "hi": 0.70}},
                {"id": "posterior_capsule", "confidence_band": {"lo": 0.84, "hi": 0.93}},
            ],
        }}
    if stage == "02d-pdf":
        return {**base, "pages": 12, "section_count": 24}
    if stage == "05-anatomy-bible":
        return {**base, "entities": ["femur", "acetabulum", "capsule",
                                     "greater_trochanter", "posterior_capsule"]}
    if stage == "06-cinema-lens":
        return {**base, "suffix": "shallow depth of field, soft surgical lighting"}
    if stage == "08-compiler":
        return {**base, "compiled": [{"shot_id": f"shot_{i}", "image_refs": 1}
                                     for i in range(1, 7)]}
    return base


def _materialize(stage: StageMap) -> bytes:
    if stage.source.startswith("fixture:"):
        name = stage.source.split(":", 1)[1]
        path = FIXTURE_DIR / f"{name}.json"
        if not path.exists():
            sys.stderr.write(f"ERROR: missing fixture {path}\n")
            sys.exit(1)
        return path.read_bytes()
    if stage.source == "placeholder:png_1x1":
        return _placeholder_png_1x1()
    if stage.source == "placeholder:wav_1s_silence":
        return _placeholder_wav_1s_silence()
    if stage.source == "placeholder:mp4_1s_black":
        return _placeholder_mp4_1s_black()
    if stage.source.startswith("synthesized:"):
        return (json.dumps(_synthesized_json(stage.stage, stage.key),
                           indent=2) + "\n").encode("utf-8")
    sys.stderr.write(f"ERROR: unknown source {stage.source}\n")
    sys.exit(1)


def _file_for(stage: StageMap) -> Path:
    return REPLAY_DIR / stage.stage / f"{stage.key}.{stage.ext}"


def _manifest_path() -> Path:
    return REPLAY_DIR / "manifest.json"


def cmd_seed() -> int:
    REPLAY_DIR.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, Any] = {
        "forge_run_id": RUN_ID,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "promo_code": "BUTTERBASE0502",
        "submission_code": "butterbase0502",
        "files": {},
    }
    total_bytes = 0
    for s in STAGES:
        target = _file_for(s)
        target.parent.mkdir(parents=True, exist_ok=True)
        body = _materialize(s)
        target.write_bytes(body)
        digest = hashlib.sha256(body).hexdigest()
        rel = str(target.relative_to(REPLAY_DIR))
        manifest["files"][rel] = {
            "sha256": digest, "bytes": len(body), "source": s.source,
        }
        total_bytes += len(body)
        print(f"[seed] {rel}  {len(body):>7} B  {digest[:12]}…")
    _manifest_path().write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\nWrote manifest: {_manifest_path().relative_to(REPO_ROOT)}")
    print(f"Total fixtures: {len(STAGES)}  ({total_bytes} bytes)")
    return 0


def cmd_verify() -> int:
    mpath = _manifest_path()
    if not mpath.exists():
        sys.stderr.write(f"ERROR: manifest missing — run prewarm_demo.py first ({mpath})\n")
        return 1
    manifest = json.loads(mpath.read_text())
    failed: list[str] = []
    for rel, meta in manifest["files"].items():
        target = REPLAY_DIR / rel
        if not target.exists():
            print(f"[FAIL] {rel} — missing")
            failed.append(rel)
            continue
        actual = hashlib.sha256(target.read_bytes()).hexdigest()
        ok = actual == meta["sha256"]
        print(f"[{'PASS' if ok else 'FAIL'}] {rel}  expected={meta['sha256'][:12]}… "
              f"actual={actual[:12]}…")
        if not ok:
            failed.append(rel)
    if failed:
        sys.stderr.write(f"\n{len(failed)} mismatched: {failed}\n")
        return 2
    print(f"\nAll {len(manifest['files'])} fixtures match manifest.")
    return 0


def cmd_cost_estimate() -> int:
    """Rough live-run cost. Useful to know whether BUTTERBASE0502 promo
    ($20 credit) + ARK trial credits cover dry-runs."""
    by_stage: dict[str, float] = {}
    for s in STAGES:
        by_stage[s.stage] = by_stage.get(s.stage, 0.0) + s.cost_estimate_usd
    total = sum(by_stage.values())
    print("Per-stage cost estimate (live run, rough order-of-magnitude):\n")
    for st in sorted(by_stage):
        print(f"  {st:24s}  ${by_stage[st]:>5.2f}")
    print(f"\n  {'TOTAL':24s}  ${total:>5.2f}")
    print("\nCoverage:")
    print(f"  BUTTERBASE0502 promo credit:    $20.00")
    print(f"  ARK trial credits (assumed):    ~$10.00")
    print(f"  Headroom for ~{int(30 / max(total, 0.01))} dry-runs at this size.")
    return 0


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="PreOpReel replay-cache prewarmer.")
    p.add_argument("--verify", action="store_true",
                   help="Re-hash fixtures and compare against manifest.json.")
    p.add_argument("--cost-estimate", action="store_true",
                   help="Print rough USD estimate of a `live` run.")
    args = p.parse_args(argv)

    if args.cost_estimate:
        return cmd_cost_estimate()
    if args.verify:
        return cmd_verify()
    return cmd_seed()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
