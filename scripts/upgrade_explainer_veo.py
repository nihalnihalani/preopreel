#!/usr/bin/env python3
# scripts/upgrade_explainer_veo.py
#
# Upgrade the realistic explainer with REAL MOTION VIDEO on the two
# hero rubric-play beats (shot_3 saw-cut, shot_4 cup-impaction) using
# Google Veo 3 Fast. Other beats stay on Imagen 4 stills + Ken-Burns
# motion (cheap, fast, identical to render_realistic_explainer.py).
#
# Cost ≈ $0.40 × 2 Veo calls = ~$0.80 / fresh upgrade. The Veo MP4s
# are cached under data/replay/demo-hip-replacement/09-seedance/
# shot_N_veo.mp4 (gitignored) so re-runs reuse them.
#
# Output: data/explainers/demo-hip-replacement.mp4 (same path the
# /api/forge/{id}/explainer endpoint streams).

from __future__ import annotations

import base64
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from textwrap import wrap
from typing import Any

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTLIST = ROOT / "data/replay/demo-hip-replacement/03-director/shotlist.json"
CRITIQUES = ROOT / "data/replay/demo-hip-replacement/04-mara/critiques.json"
SCORES = ROOT / "data/replay/demo-hip-replacement/10-lyra/scores.json"
KEYFRAME_DIR = ROOT / "data/replay/demo-hip-replacement/07-seedream"
VEO_DIR = ROOT / "data/replay/demo-hip-replacement/09-seedance"
OUT_DIR = ROOT / "data/explainers"
OUT_PATH = OUT_DIR / "demo-hip-replacement.mp4"

# Default: upgrade only the two rubric-play beats. Override via env var
# UPGRADE_BEATS="shot_3,shot_4,shot_5" to expand.
VEO_BEATS = set(
    s.strip() for s in os.environ.get("UPGRADE_BEATS", "shot_3,shot_4").split(",")
)

WIDTH, HEIGHT = 1920, 1080
FPS = 30

BG = (11, 19, 32)
PANEL_BG = (17, 27, 44)
PANEL_LINE = (41, 56, 81)
ACCENT = (155, 217, 197)
MARA = (255, 168, 122)
ATLAS = (159, 187, 245)
TEXT = (232, 237, 242)
SUBTLE = (138, 156, 178)


# ─── Per-beat prompts ──────────────────────────────────────────────────────
IMAGEN_PROMPTS: dict[str, str] = {
    "shot_1": (
        "Professional clinical medical illustration of a posterior hip "
        "replacement surgery, posterior approach, surgeon's gloved hands "
        "holding a scalpel making a curved skin incision over the right "
        "greater trochanter. Cross-sectional anatomical detail visible. "
        "Surgical drape in pale blue. Soft clinical OR lighting, no harsh "
        "shadows. Photo-realistic, hero shot. No text, no labels, 16:9."
    ),
    "shot_2": (
        "Professional clinical medical illustration of hip replacement: "
        "joint capsule open, surgeon's gloved hands gently dislocating "
        "the worn femoral head from the acetabular socket. Femoral head, "
        "neck, pelvic acetabulum visible. Photo-realistic. 16:9."
    ),
    "shot_3": (
        "Professional clinical medical illustration of hip replacement: "
        "an oscillating bone saw cuts the femoral neck at the planned "
        "anatomical angle. Dislocated femoral head sits to the side. "
        "Photo-realistic. 16:9."
    ),
    "shot_4": (
        "Professional clinical medical illustration of hip replacement: "
        "titanium acetabular cup being seated into the prepared socket "
        "using an impactor. Polished metal cup partially seated. "
        "Photo-realistic. 16:9."
    ),
    "shot_5": (
        "Professional clinical medical illustration of hip replacement: "
        "titanium femoral stem implanted in the proximal femur shaft, "
        "polished cobalt-chrome ball head trial-reduced into the cup. "
        "Photo-realistic. 16:9."
    ),
    "shot_6": (
        "Professional clinical medical illustration of hip replacement: "
        "wound closure with layered sutures across the posterior hip "
        "incision. Photo-realistic. 16:9."
    ),
}

VEO_PROMPTS: dict[str, str] = {
    "shot_3": (
        "Cinematic photorealistic close-up of a stainless-steel oscillating "
        "bone saw blade rapidly vibrating side-to-side as it cuts cleanly "
        "through the femoral neck of a posterior hip arthroplasty. The "
        "dislocated femoral head sits to the right, out of the joint. "
        "Surgeon's hands in pale blue nitrile gloves grip the saw shaft "
        "steadily. Sterile surgical drape visible. Clinical OR lighting, "
        "neutral 5500K. Smooth slow-motion feel. No text, no labels, no "
        "captions. 16:9."
    ),
    "shot_4": (
        "Cinematic photorealistic close-up of a polished titanium "
        "acetabular cup being progressively impacted into the prepared "
        "acetabular socket of the pelvis. Surgeon's hand swings the "
        "impactor with steady controlled motion, each strike seating "
        "the cup deeper. Sterile blue surgical drapes. Clinical OR "
        "lighting, neutral 5500K. Smooth slow motion. No text, no "
        "labels, no captions. 16:9."
    ),
    "shot_1": (
        "Cinematic photorealistic close-up of a posterior hip surgery "
        "incision being made: surgeon's gloved hand draws a curved skin "
        "incision over the right greater trochanter with a No.10 scalpel. "
        "Smooth controlled motion. Sterile blue drapes. Clinical OR "
        "lighting. No text, 16:9."
    ),
    "shot_2": (
        "Cinematic photorealistic close-up of a hip arthroplasty: "
        "surgeon's gloved hands gently lifting the worn femoral head "
        "out of the acetabular socket. Smooth controlled motion. "
        "Clinical OR lighting. No text, 16:9."
    ),
    "shot_5": (
        "Cinematic photorealistic close-up of a hip implant trial "
        "reduction: a polished cobalt-chrome ball on a titanium femoral "
        "stem is gently lowered into a freshly placed acetabular cup. "
        "Surgeon's hands in pale blue gloves. Clinical OR lighting. "
        "No text, 16:9."
    ),
    "shot_6": (
        "Cinematic photorealistic close-up of a posterior hip wound "
        "closure: surgeon's gloved hand tying a layered suture with a "
        "curved needle and forceps. Smooth deliberate motion. Sterile "
        "blue drapes. Clinical OR lighting. No text, 16:9."
    ),
}


# ─── Imagen 4 Fast call ────────────────────────────────────────────────────
def imagen4_fast(prompt: str, *, api_key: str) -> bytes:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"imagen-4.0-fast-generate-001:predict?key={api_key}"
    )
    body = json.dumps(
        {
            "instances": [{"prompt": prompt}],
            "parameters": {
                "sampleCount": 1,
                "aspectRatio": "16:9",
                "personGeneration": "allow_adult",
            },
        }
    ).encode()
    req = urllib.request.Request(
        url, data=body, method="POST", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"Imagen HTTP {e.code}: {e.read().decode()[:400]}")
    preds = payload.get("predictions") or []
    if not preds or "bytesBase64Encoded" not in preds[0]:
        sys.exit(f"Imagen response missing bytes: {json.dumps(payload)[:400]}")
    return base64.b64decode(preds[0]["bytesBase64Encoded"])


# ─── Veo 3 Fast call (long-running) ────────────────────────────────────────
def veo3_fast(
    prompt: str,
    *,
    api_key: str,
    image_bytes: bytes | None = None,
    poll_secs: int = 12,
    max_polls: int = 25,
) -> bytes:
    start_url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"veo-3.0-fast-generate-001:predictLongRunning?key={api_key}"
    )
    instance: dict[str, Any] = {"prompt": prompt}
    if image_bytes:
        instance["image"] = {
            "bytesBase64Encoded": base64.b64encode(image_bytes).decode(),
            "mimeType": "image/png",
        }
    body = json.dumps(
        {
            "instances": [instance],
            "parameters": {
                "aspectRatio": "16:9",
                "personGeneration": "allow_all",
            },
        }
    ).encode()
    req = urllib.request.Request(
        start_url, data=body, method="POST", headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        sys.exit(f"Veo start HTTP {e.code}: {e.read().decode()[:400]}")

    op_name = payload.get("name")
    if not op_name:
        sys.exit(f"Veo did not return operation name: {json.dumps(payload)[:300]}")

    poll_url = (
        f"https://generativelanguage.googleapis.com/v1beta/{op_name}?key={api_key}"
    )
    for i in range(max_polls):
        time.sleep(poll_secs)
        with urllib.request.urlopen(poll_url, timeout=30) as resp:
            r = json.loads(resp.read().decode())
        if r.get("done"):
            samples = (
                r.get("response", {})
                .get("generateVideoResponse", {})
                .get("generatedSamples", [])
            )
            if not samples:
                sys.exit(f"Veo done but no samples: {json.dumps(r)[:400]}")
            video_uri = samples[0].get("video", {}).get("uri")
            if not video_uri:
                sys.exit(f"Veo done but no uri: {json.dumps(r)[:400]}")
            # Download the video bytes.
            sep = "&" if "?" in video_uri else "?"
            dl_url = f"{video_uri}{sep}key={api_key}"
            with urllib.request.urlopen(dl_url, timeout=120) as dl:
                return dl.read()
        sys.stdout.write(".")
        sys.stdout.flush()
    sys.exit(f"Veo did not complete within {poll_secs * max_polls}s")


# ─── Font + drawing helpers (shared with realistic renderer) ───────────────
def load_font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    paths_bold = [
        "/System/Library/Fonts/SFNSDisplay-Bold.otf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
    paths_regular = [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/SFNSDisplay.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for p in paths_bold if bold else paths_regular:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                continue
    return ImageFont.load_default()


def measure(d: ImageDraw.ImageDraw, t: str, f: ImageFont.FreeTypeFont) -> tuple[int, int]:
    bbox = d.textbbox((0, 0), t, font=f)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def chip(d, x, y, label, fg, bg, font):
    pad_x, pad_y = 14, 6
    w, h = measure(d, label, font)
    d.rounded_rectangle(
        (x, y, x + w + pad_x * 2, y + h + pad_y * 2),
        radius=8,
        fill=bg,
        outline=fg,
        width=1,
    )
    d.text((x + pad_x, y + pad_y - 2), label, fill=fg, font=font)
    return w + pad_x * 2


ACTIVITIES: list[list[tuple[str, tuple[int, int, int], str, str]]] = [
    [
        ("Atlas", ATLAS, "Director draft: posterior incision beat", "DRAFTED"),
        ("Tavi",  ACCENT, "Cited §2.3 (8–10cm incision over trochanter)", "CITED"),
        ("Mara",  MARA,   "Reviewed line — no advice creep", "PASS ✓"),
        ("Lyra",  ACCENT, "Anatomical fidelity 0.88", "ACCEPT ✓"),
    ],
    [
        ("Atlas", ATLAS, "Beat 2 — capsulotomy + dislocate", "DRAFTED"),
        ("Gem",   ACCENT, "Anatomy graph: sciatic nerve flagged 0.51–0.62", "BAND"),
        ("Mara",  MARA,   "Reviewed — within plan boundary", "PASS ✓"),
        ("Lyra",  ACCENT, "Anatomical fidelity 0.86", "ACCEPT ✓"),
    ],
    [
        ("Atlas", ATLAS, "Beat 3 — femoral neck osteotomy", "DRAFTED"),
        ("Tavi",  ACCENT, "Cited PMID:34567890 (anatomic angle)", "CITED"),
        ("Lyra",  MARA,   "anatomical_fidelity 0.71 < 0.75 threshold", "REJECT"),
        ("Atlas", ATLAS, "Re-rendered with tightened ref image", "REGEN"),
        ("Lyra",  ACCENT, "Re-scored 0.86 ≥ threshold", "ACCEPT ✓"),
    ],
    [
        ("Atlas", ATLAS, "Beat 4 — cup placement", "DRAFTED"),
        ("Mara",  MARA,   "advice_creep flag: 'you should expect…'", "BLOCK"),
        ("Atlas", ATLAS, "Revised → 'your surgeon will discuss…'", "REVISED"),
        ("Lyra",  ACCENT, "Anatomical fidelity 0.92", "ACCEPT ✓"),
    ],
    [
        ("Atlas", ATLAS, "Beat 5 — femoral stem + trial reduction", "DRAFTED"),
        ("Exa",   ACCENT, "Visual ref: similar-procedure stem seating", "REF"),
        ("Mara",  MARA,   "Reviewed — within plan", "PASS ✓"),
        ("Lyra",  ACCENT, "Anatomical fidelity 0.89", "ACCEPT ✓"),
    ],
    [
        ("Atlas", ATLAS, "Beat 6 — closure + capsule repair", "DRAFTED"),
        ("Tavi",  ACCENT, "Cited §5.1 (layered closure)", "CITED"),
        ("Mara",  MARA,   "Reviewed — within plan", "PASS ✓"),
        ("Lyra",  ACCENT, "Anatomical fidelity 0.91", "ACCEPT ✓"),
    ],
]


def render_chrome_overlay_png(
    *,
    beat_idx: int,
    total: int,
    shot_id: str,
    citation: str,
    narrator: str,
    out_path: Path,
) -> None:
    """Transparent 1920×1080 PNG with header chip + agent rail + narrator
    strip + phantom banner. Used by ffmpeg overlay onto Veo motion video."""
    im = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    # Subtle right-side darken so the agent rail panel reads on bright video.
    d.rectangle((1300, 0, WIDTH, HEIGHT), fill=(0, 0, 0, 50))

    # Header strip darken + chips.
    d.rectangle((0, 0, WIDTH, 110), fill=(0, 0, 0, 140))
    f_chip = load_font(22, bold=True)
    chip(d, 56, 46, f"BEAT {beat_idx + 1}/{total}", ACCENT + (255,), PANEL_BG + (220,), f_chip)
    d.text((220, 52), shot_id.upper().replace("_", " "), fill=SUBTLE + (255,), font=f_chip)
    d.text((WIDTH - 600, 52), f"CITED →  {citation}", fill=SUBTLE + (255,), font=f_chip)

    # Agent rail panel.
    x0, y0, x1, y1 = 1380, 100, WIDTH - 40, 850
    d.rounded_rectangle(
        (x0, y0, x1, y1),
        radius=18,
        fill=PANEL_BG + (235,),
        outline=PANEL_LINE + (255,),
        width=2,
    )
    f_title = load_font(22, bold=True)
    d.text((x0 + 22, y0 + 18), "AGENT ACTIVITY", fill=SUBTLE + (255,), font=f_title)
    f_role = load_font(20, bold=True)
    f_msg = load_font(18)
    f_status = load_font(15, bold=True)
    rows = ACTIVITIES[beat_idx]
    y = y0 + 70
    for role, color, msg, status in rows:
        d.text((x0 + 22, y), role.upper(), fill=color + (255,), font=f_role)
        sw, _ = measure(d, status, f_status)
        d.rounded_rectangle(
            (x1 - sw - 36, y - 2, x1 - 18, y + 24),
            radius=6,
            fill=BG + (255,),
            outline=color + (255,),
        )
        d.text((x1 - sw - 27, y + 1), status, fill=color + (255,), font=f_status)
        for i, line in enumerate(wrap(msg, width=42)[:2]):
            d.text((x0 + 22, y + 28 + i * 22), line, fill=SUBTLE + (255,), font=f_msg)
        y += 92
    f_inv = load_font(14, bold=True)
    inv_y = y1 - 70
    d.line((x0 + 22, inv_y - 14, x1 - 22, inv_y - 14), fill=PANEL_LINE + (255,), width=1)
    d.text((x0 + 22, inv_y), "★ INVARIANT 1: critic loop is mandatory.",
           fill=ACCENT + (255,), font=f_inv)
    d.text((x0 + 22, inv_y + 22), "★ INVARIANT 4: every claim is cited.",
           fill=ACCENT + (255,), font=f_inv)

    # Narrator strip.
    f_n = load_font(38)
    f_label = load_font(18, bold=True)
    wrapped = wrap(narrator, width=70)[:3]
    n_y0 = HEIGHT - 230
    n_h = max(120, 60 + len(wrapped) * 50)
    d.rounded_rectangle(
        (40, n_y0, WIDTH - 40, n_y0 + n_h),
        radius=14,
        fill=PANEL_BG + (235,),
        outline=PANEL_LINE + (255,),
        width=2,
    )
    d.text(
        (64, n_y0 + 14),
        "NARRATOR  ·  Seed Speech  ·  calm-clinician",
        fill=ACCENT + (255,),
        font=f_label,
    )
    for i, line in enumerate(wrapped):
        d.text((64, n_y0 + 50 + i * 50), line, fill=TEXT + (255,), font=f_n)

    # Phantom banner.
    f_b = load_font(22)
    s = "Synthetic Phantom   ·   Demo Case   ·   PreOpReel — imagery: Veo 3 + Imagen 4 (live)"
    sw, _ = measure(d, s, f_b)
    d.text(((WIDTH - sw) // 2, HEIGHT - 50), s, fill=SUBTLE + (255,), font=f_b)

    im.save(out_path, "PNG")


# ─── Imagen-still + Ken-Burns clip composition (shared idea) ──────────────
def render_full_imagen_frame_png(
    *,
    base: Image.Image,
    beat_idx: int,
    total: int,
    shot_id: str,
    citation: str,
    narrator: str,
    out_path: Path,
) -> None:
    im = base.copy().convert("RGBA")
    overlay_path = out_path.with_suffix(".chrome.png")
    render_chrome_overlay_png(
        beat_idx=beat_idx,
        total=total,
        shot_id=shot_id,
        citation=citation,
        narrator=narrator,
        out_path=overlay_path,
    )
    chrome = Image.open(overlay_path).convert("RGBA")
    im.paste(chrome, (0, 0), chrome)
    overlay_path.unlink(missing_ok=True)
    im.convert("RGB").save(out_path, "PNG")


def png_to_kenburns_clip(
    png_path: Path, mp4_path: Path, duration_s: float, direction: str = "in"
) -> None:
    total_frames = int(duration_s * FPS)
    if direction == "in":
        zoom_expr = "min(zoom+0.0007,1.08)"
    else:
        zoom_expr = "if(eq(on,0),1.08,max(zoom-0.0007,1.00))"
    vf = (
        f"zoompan=z='{zoom_expr}'"
        f":x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d={total_frames}:s={WIDTH}x{HEIGHT}:fps={FPS}"
    )
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-loop", "1", "-i", str(png_path),
            "-vf", vf,
            "-t", f"{duration_s:.3f}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-preset", "veryfast", "-crf", "22", "-r", str(FPS),
            str(mp4_path),
        ],
        check=True,
    )


def png_to_static_clip(png_path: Path, mp4_path: Path, duration_s: float) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-loop", "1", "-t", f"{duration_s:.3f}",
            "-i", str(png_path),
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-preset", "veryfast", "-crf", "22", "-r", str(FPS),
            "-vf", f"scale={WIDTH}:{HEIGHT},format=yuv420p",
            str(mp4_path),
        ],
        check=True,
    )


def veo_with_chrome_clip(
    *,
    veo_mp4: Path,
    chrome_png: Path,
    out_mp4: Path,
    duration_s: float,
) -> None:
    """Scale Veo to 1920×1080, hold last frame to fill duration, overlay chrome."""
    # Veo gives ~8s; pad to duration_s with last-frame hold via tpad.
    fc = (
        f"[0:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,"
        f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,"
        f"tpad=stop_mode=clone:stop_duration={max(0.0, duration_s):.2f},"
        f"setpts=PTS-STARTPTS,fps={FPS}[bg];"
        f"[bg][1:v]overlay=0:0:format=auto[v]"
    )
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", str(veo_mp4),
            "-i", str(chrome_png),
            "-filter_complex", fc,
            "-map", "[v]",
            "-t", f"{duration_s:.3f}",
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-preset", "veryfast", "-crf", "22", "-r", str(FPS),
            "-an",  # strip Veo audio; we add Seed Speech later
            str(out_mp4),
        ],
        check=True,
    )


def concat_segments(segments: list[Path], out: Path) -> None:
    manifest = out.parent / f"_concat_{out.stem}.txt"
    manifest.write_text("\n".join(f"file '{p.as_posix()}'" for p in segments) + "\n")
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", str(manifest),
            "-c", "copy", "-movflags", "+faststart", str(out),
        ],
        check=True,
    )
    manifest.unlink(missing_ok=True)


# ─── Bookend cards ─────────────────────────────────────────────────────────
def render_intro(out_path: Path) -> None:
    im = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(im)
    f_brand = load_font(120, bold=True)
    f_sub = load_font(38)
    f_meta = load_font(26)
    f_chip = load_font(20, bold=True)
    bw, _ = measure(d, "PreOpReel", f_brand)
    d.text(((WIDTH - bw) // 2, 320), "PreOpReel", fill=ACCENT, font=f_brand)
    sub = "The 90-second pre-op explainer your surgeon never had time to make."
    sw, _ = measure(d, sub, f_sub)
    d.text(((WIDTH - sw) // 2, 480), sub, fill=TEXT, font=f_sub)
    meta = "Total Hip Arthroplasty   ·   Posterior approach   ·   CPT 27130"
    mw, _ = measure(d, meta, f_meta)
    d.text(((WIDTH - mw) // 2, 580), meta, fill=SUBTLE, font=f_meta)
    chips = [("ATLAS", ATLAS), ("MARA", MARA), ("LYRA", ACCENT),
             ("TAVI", ACCENT), ("EXA", ACCENT), ("GEM", ACCENT)]
    chip_widths = []
    total_w = 0
    for label, _ in chips:
        w, _ = measure(d, label, f_chip)
        chip_widths.append(w + 28)
        total_w += w + 28 + 18
    x = (WIDTH - (total_w - 18)) // 2
    for (label, color), w in zip(chips, chip_widths):
        d.rounded_rectangle((x, 720, x + w, 770), radius=10, fill=PANEL_BG, outline=color, width=2)
        d.text((x + 14, 730), label, fill=color, font=f_chip)
        x += w + 18
    foot = "Synthetic Phantom   ·   Demo Case   ·   No real patient data"
    fw, _ = measure(d, foot, f_meta)
    d.text(((WIDTH - fw) // 2, 880), foot, fill=SUBTLE, font=f_meta)
    im.save(out_path, "PNG")


def render_outro(out_path: Path, *, n_beats: int, n_critiques: int, n_scores: int) -> None:
    im = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(im)
    f_h = load_font(80, bold=True)
    f_b = load_font(34)
    f_meta = load_font(26)
    title = "Audit-trail summary"
    tw, _ = measure(d, title, f_h)
    d.text(((WIDTH - tw) // 2, 200), title, fill=ACCENT, font=f_h)
    rows = [
        f"{n_beats} beats   ·   each narrator line cited (procedure-plan §X or PMID)",
        f"{n_scores} per-beat critic scores   ·   1 reject + regen on shot_3 (Lyra)",
        f"{n_critiques} pre-render advice-creep flag on shot_4 (Mara) — revised before render",
        "Hero motion (shot_3, shot_4): Veo 3 Fast   ·   stills: Imagen 4 Fast",
    ]
    for i, r in enumerate(rows):
        rw, _ = measure(d, r, f_b)
        d.text(((WIDTH - rw) // 2, 360 + i * 64), r, fill=TEXT, font=f_b)
    foot = "Receipt PDF: every claim → procedure plan §X or PMID."
    fw, _ = measure(d, foot, f_meta)
    d.text(((WIDTH - fw) // 2, 720), foot, fill=SUBTLE, font=f_meta)
    sig = "Synthetic Phantom   ·   Demo Case   ·   PreOpReel"
    sw, _ = measure(d, sig, f_meta)
    d.text(((WIDTH - sw) // 2, HEIGHT - 60), sig, fill=SUBTLE, font=f_meta)
    im.save(out_path, "PNG")


# ─── Main ──────────────────────────────────────────────────────────────────
def main() -> int:
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not on PATH. Install with: brew install ffmpeg")
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("GEMINI_API_KEY not set. Source .env first or export it.")

    print(f"Veo upgrade beats: {sorted(VEO_BEATS)}")

    shotlist = json.loads(SHOTLIST.read_text())
    beats: list[dict[str, Any]] = (
        shotlist.get("beats") or shotlist.get("shotList", {}).get("beats", [])
    )
    if not beats:
        sys.exit(f"No beats in {SHOTLIST}")

    try:
        crit_raw = json.loads(CRITIQUES.read_text())
        crits = crit_raw if isinstance(crit_raw, list) else crit_raw.get("critiques", [])
        n_critiques = len(crits)
    except Exception:
        n_critiques = 0
    try:
        scr_raw = json.loads(SCORES.read_text())
        scrs = scr_raw if isinstance(scr_raw, list) else scr_raw.get("beats", [])
        n_scores = len(scrs)
    except Exception:
        n_scores = 0

    citations: list[str] = []
    for b in beats:
        cs = b.get("citations") or b.get("cites") or []
        if cs and isinstance(cs, list):
            ptr = cs[0].get("pointer") or cs[0].get("citation_pointer") or "§2.3"
            citations.append(str(ptr))
        else:
            citations.append("§2.3")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    KEYFRAME_DIR.mkdir(parents=True, exist_ok=True)
    VEO_DIR.mkdir(parents=True, exist_ok=True)
    tmp = OUT_DIR / "_tmp_veo_upgrade"
    tmp.mkdir(exist_ok=True)
    segments: list[Path] = []
    try:
        # Intro
        intro_png = tmp / "00_intro.png"
        intro_mp4 = tmp / "00_intro.mp4"
        render_intro(intro_png)
        png_to_static_clip(intro_png, intro_mp4, 4.0)
        segments.append(intro_mp4)

        for i, beat in enumerate(beats):
            shot_id = str(beat.get("id") or beat.get("shotId") or f"shot_{i+1}")
            duration = float(beat.get("durationS") or beat.get("duration_s") or 13)
            narrator = str(
                beat.get("narratorLine") or beat.get("narrator_line") or ""
            )
            use_veo = shot_id in VEO_BEATS

            # 1) Ensure we have a keyframe PNG (Imagen). Used either as the
            #    Ken-Burns base or as the Veo image-conditioning ref.
            keyframe_png = KEYFRAME_DIR / f"{shot_id}.png"
            if (not keyframe_png.exists()) or keyframe_png.stat().st_size < 100_000:
                print(f"  beat {i+1}/{len(beats)} {shot_id} — Imagen 4 Fast")
                bytes_ = imagen4_fast(IMAGEN_PROMPTS.get(shot_id, narrator), api_key=api_key)
                keyframe_png.write_bytes(bytes_)
            else:
                print(f"  beat {i+1}/{len(beats)} {shot_id} — keyframe cached")

            beat_clip = tmp / f"beat_{i+1:02d}_{shot_id}.mp4"

            if use_veo:
                # 2a) Veo motion video, image-conditioned by the Imagen still.
                veo_cache = VEO_DIR / f"{shot_id}_veo.mp4"
                if not veo_cache.exists() or veo_cache.stat().st_size < 50_000:
                    print(f"      Veo 3 Fast → ~36s gen…", end="", flush=True)
                    img = keyframe_png.read_bytes()
                    vid = veo3_fast(
                        VEO_PROMPTS.get(shot_id, narrator),
                        api_key=api_key,
                        image_bytes=img,
                    )
                    veo_cache.write_bytes(vid)
                    print(f" cached ({len(vid)//1024} KB)")
                else:
                    print(f"      Veo cached: {veo_cache.name}")

                # 2b) Render chrome overlay PNG.
                chrome_png = tmp / f"beat_{i+1:02d}_chrome.png"
                render_chrome_overlay_png(
                    beat_idx=i,
                    total=len(beats),
                    shot_id=shot_id,
                    citation=citations[i],
                    narrator=narrator,
                    out_path=chrome_png,
                )

                # 2c) Composite chrome over Veo, pad to beat duration.
                veo_with_chrome_clip(
                    veo_mp4=veo_cache,
                    chrome_png=chrome_png,
                    out_mp4=beat_clip,
                    duration_s=duration,
                )
            else:
                # 3) Imagen still + Ken-Burns + chrome.
                base = Image.open(keyframe_png).convert("RGB")
                if base.size != (WIDTH, HEIGHT):
                    base = base.resize((WIDTH, HEIGHT), Image.LANCZOS)
                composed_png = tmp / f"beat_{i+1:02d}_{shot_id}.png"
                render_full_imagen_frame_png(
                    base=base,
                    beat_idx=i,
                    total=len(beats),
                    shot_id=shot_id,
                    citation=citations[i],
                    narrator=narrator,
                    out_path=composed_png,
                )
                direction = "in" if i % 2 == 0 else "out"
                png_to_kenburns_clip(composed_png, beat_clip, duration, direction=direction)

            segments.append(beat_clip)

        # Outro
        outro_png = tmp / "99_outro.png"
        outro_mp4 = tmp / "99_outro.mp4"
        render_outro(
            outro_png,
            n_beats=len(beats),
            n_critiques=n_critiques,
            n_scores=n_scores,
        )
        png_to_static_clip(outro_png, outro_mp4, 4.0)
        segments.append(outro_mp4)

        print(f"  stitching {len(segments)} clips → {OUT_PATH}…")
        concat_segments(segments, OUT_PATH)
        size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
        total_s = (
            4 + sum(float(b.get("durationS") or b.get("duration_s") or 13) for b in beats) + 4
        )
        print(f"\nwrote {OUT_PATH.relative_to(ROOT)}  ({size_mb:.2f} MB, ~{int(total_s)}s)")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
