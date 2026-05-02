#!/usr/bin/env python3
# scripts/render_demo_explainer.py
#
# Synthesizes a placeholder demo explainer MP4 from
# data/replay/demo-hip-replacement/03-director/shotlist.json so the
# /api/forge/{id}/explainer route + <video> player on the run page have
# something to serve while the real Stage-12 Remotion render is offline.
#
# Strategy: PIL renders one 1920x1080 PNG per shot (text overlay); ffmpeg
# stretches each PNG to a {duration}s clip and concats into a single MP4.
# This avoids ffmpeg's drawtext filter (homebrew's build often ships
# without libfreetype).
#
# This is a stand-in for the deleted-by-PR#11 npm run prewarm pipeline.
# It does NOT replace the real Stage-12 explainer — it just keeps the
# demo flow end-to-end clickable in DEMO_MODE=replay.
#
# Output: data/explainers/demo-hip-replacement.mp4 (1920x1080 H.264, ~78s).

import json
import shutil
import subprocess
import sys
from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTLIST_PATH = ROOT / "data/replay/demo-hip-replacement/03-director/shotlist.json"
OUT_DIR = ROOT / "data/explainers"
OUT_PATH = OUT_DIR / "demo-hip-replacement.mp4"

WIDTH, HEIGHT = 1920, 1080
FPS = 30
BG = (11, 19, 32)        # ink-950
ACCENT = (155, 217, 197) # critic-lyra teal
TEXT = (232, 237, 242)   # clinical-100
SUBTLE = (107, 122, 143) # clinical-300


def load_font(size: int) -> ImageFont.FreeTypeFont:
    # macOS ships these by default; fall back to PIL default (bitmap, ugly).
    candidates = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def measure(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def render_shot_png(
    *,
    idx: int,
    shot_id: str,
    duration: int,
    narrator: str,
    out_path: Path,
) -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    header_font = load_font(38)
    big_font = load_font(56)
    badge_font = load_font(28)

    # Top-left header — shot id + beat counter.
    header = f"BEAT {idx + 1}/6   ·   {shot_id.upper().replace('_', ' ')}"
    draw.text((80, 70), header, fill=ACCENT, font=header_font)

    # Top-right — duration.
    dur_text = f"{duration}s"
    dw, _ = measure(draw, dur_text, header_font)
    draw.text((WIDTH - 80 - dw, 70), dur_text, fill=SUBTLE, font=header_font)

    # Center — narrator line, wrapped.
    wrapped = wrap(narrator, width=42)[:5]
    spacing = 78
    total_h = len(wrapped) * spacing
    y = (HEIGHT - total_h) // 2
    for line in wrapped:
        lw, _ = measure(draw, line, big_font)
        draw.text(((WIDTH - lw) // 2, y), line, fill=TEXT, font=big_font)
        y += spacing

    # Thin accent rule above the badge.
    draw.line([(80, HEIGHT - 130), (WIDTH - 80, HEIGHT - 130)], fill=SUBTLE, width=1)

    # Bottom — synthetic-phantom honesty badge.
    badge = "Synthetic Phantom   ·   Demo Case   ·   PreOpReel"
    bw, _ = measure(draw, badge, badge_font)
    draw.text(((WIDTH - bw) // 2, HEIGHT - 90), badge, fill=SUBTLE, font=badge_font)

    img.save(out_path, "PNG")


def png_to_mp4(png_path: Path, mp4_path: Path, duration: int) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-t",
        str(duration),
        "-i",
        str(png_path),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "26",
        "-r",
        str(FPS),
        "-vf",
        f"scale={WIDTH}:{HEIGHT},format=yuv420p",
        str(mp4_path),
    ]
    subprocess.run(cmd, check=True)


def main() -> int:
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not on PATH. Install with: brew install ffmpeg")

    shotlist = json.loads(SHOTLIST_PATH.read_text())
    beats = shotlist.get("beats") or shotlist.get("shotList", {}).get("beats", [])
    if not beats:
        sys.exit(f"No beats in {SHOTLIST_PATH}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp_dir = OUT_DIR / "_tmp_demo_segments"
    tmp_dir.mkdir(exist_ok=True)
    try:
        segment_paths: list[Path] = []
        for i, beat in enumerate(beats):
            shot_id = beat.get("id") or beat.get("shotId") or f"shot_{i+1}"
            duration = int(beat.get("durationS") or beat.get("duration_s") or 13)
            narrator = (
                beat.get("narratorLine") or beat.get("narrator_line") or ""
            )
            png = tmp_dir / f"{i:02d}_{shot_id}.png"
            mp4 = tmp_dir / f"{i:02d}_{shot_id}.mp4"
            render_shot_png(
                idx=i,
                shot_id=shot_id,
                duration=duration,
                narrator=narrator,
                out_path=png,
            )
            print(f"  {shot_id} ({duration}s) → encoding…")
            png_to_mp4(png, mp4, duration)
            segment_paths.append(mp4)

        manifest = tmp_dir / "concat.txt"
        manifest.write_text(
            "\n".join(f"file '{p.as_posix()}'" for p in segment_paths) + "\n"
        )
        print(f"  stitching → {OUT_PATH}…")
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(manifest),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(OUT_PATH),
            ],
            check=True,
        )
        size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
        total_s = sum(int(b.get("durationS") or b.get("duration_s") or 13) for b in beats)
        print(f"\nwrote {OUT_PATH.relative_to(ROOT)}  ({size_mb:.2f} MB, {total_s}s)")
        return 0
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
