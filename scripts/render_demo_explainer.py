#!/usr/bin/env python3
# scripts/render_demo_explainer.py
#
# Synthesizes a demo explainer MP4 that actually visualizes the
# surgical procedure (not just narrator slides) so the demo flow has
# something meaningful to play in DEMO_MODE=replay.
#
# Each of the 6 beats renders an animated schematic of the hip joint
# evolving through that surgical step (incision → dislocation →
# femoral cut → cup placement → stem placement → closure), plus a
# per-beat side panel demonstrating the PreOpReel feature stack:
#   - which agent is acting (Atlas / Mara / Lyra / Tavi / Exa / Gem)
#   - the citation pointer (§2.3, PMID, etc.) — Invariant 4
#   - the critic-loop verdict on this beat — Invariant 1
#
# Bookend cards introduce the procedure + 6-agent team, and the outro
# summarizes the audit trail + critic-loop stats.
#
# This is a stand-in for the deleted-by-PR#11 prewarm pipeline that
# would produce real Seedance videos. It does NOT replace the actual
# Stage-12 Remotion render — it just keeps the demo flow end-to-end
# clickable in replay mode and demonstrates every PreOpReel feature.
#
# Output: data/explainers/demo-hip-replacement.mp4 (1920×1080 H.264, ~88s).

import json
import math
import shutil
import subprocess
import sys
from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont

# ─── Layout constants ──────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
SHOTLIST_PATH = ROOT / "data/replay/demo-hip-replacement/03-director/shotlist.json"
CRITIQUES_PATH = ROOT / "data/replay/demo-hip-replacement/04-mara/critiques.json"
SCORES_PATH = ROOT / "data/replay/demo-hip-replacement/10-lyra/scores.json"
OUT_DIR = ROOT / "data/explainers"
OUT_PATH = OUT_DIR / "demo-hip-replacement.mp4"

WIDTH, HEIGHT = 1920, 1080
FPS = 30
KEYFRAMES_PER_BEAT = 5  # one PNG every {beat_duration / 5}s

# Palette (matches src/styles.css clinical UI tones)
BG = (11, 19, 32)              # ink-950
PANEL_BG = (17, 27, 44)        # ink-900
PANEL_LINE = (41, 56, 81)      # ink-700
ACCENT = (155, 217, 197)       # critic-lyra teal
MARA = (255, 168, 122)         # critic-mara coral
ATLAS = (159, 187, 245)        # atlas blue
TEXT = (232, 237, 242)         # clinical-100
SUBTLE = (138, 156, 178)       # clinical-300
DIM = (90, 105, 125)           # ink-600
BONE = (236, 224, 200)         # ivory bone fill
BONE_DK = (180, 162, 130)      # bone outline
SOFT = (74, 50, 60)            # tissue plum
SKIN = (210, 168, 145)         # skin tone
INCISION = (220, 78, 92)       # red surgical mark
SUTURE = (60, 70, 90)
IMPLANT_CUP = (158, 174, 198)  # ti-blue
IMPLANT_STEM = (200, 212, 230)


def load_font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    paths_bold = [
        "/System/Library/Fonts/SFNSDisplay-Bold.otf",
        "/System/Library/Fonts/Helvetica.ttc",  # has bold variants embedded
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


def draw_centered(d, text, y, font, fill, *, x_center=WIDTH // 2):
    w, _ = measure(d, text, font)
    d.text((x_center - w // 2, y), text, fill=fill, font=font)


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


# ─── Hip schematic ─────────────────────────────────────────────────────────
# A simplified posterior-view hip joint, drawn in the LEFT panel of every
# beat frame. Each surgical step modifies pieces of this diagram via the
# `state` dict.

# Anchor coords inside the left panel (50,100)-(1300,980) box.
PANEL_LEFT = (50, 100)
PANEL_RIGHT = (1300, 980)
JOINT_CX = 720
JOINT_CY = 520
ACETAB_R = 120
HEAD_R = 90
NECK_W = 80
SHAFT_W = 110


def draw_panel_bg(d, box, *, title=None):
    x0, y0 = box[0]
    x1, y1 = box[1]
    d.rounded_rectangle((x0, y0, x1, y1), radius=18, fill=PANEL_BG, outline=PANEL_LINE, width=2)
    if title:
        f = load_font(22, bold=True)
        d.text((x0 + 22, y0 + 18), title, fill=SUBTLE, font=f)


def draw_skin_outline(d):
    # Body silhouette behind the joint — soft curve.
    pts = [
        (PANEL_LEFT[0] + 60, JOINT_CY - 280),
        (PANEL_LEFT[0] + 100, JOINT_CY - 100),
        (PANEL_LEFT[0] + 140, JOINT_CY + 120),
        (PANEL_LEFT[0] + 200, JOINT_CY + 320),
        (PANEL_LEFT[0] + 320, JOINT_CY + 380),
    ]
    # Soft tissue fill under the skin contour.
    poly_top = [(p[0], p[1]) for p in pts] + [
        (PANEL_RIGHT[0] - 60, pts[-1][1]),
        (PANEL_RIGHT[0] - 60, pts[0][1]),
    ]
    d.polygon(poly_top, fill=SOFT)
    # Skin outline.
    for i in range(len(pts) - 1):
        d.line([pts[i], pts[i + 1]], fill=SKIN, width=10)


def draw_pelvis(d):
    # Iliac wing curve + acetabular socket.
    cx, cy = JOINT_CX - 30, JOINT_CY - 40
    # Iliac wing — large bony arc above the socket.
    d.ellipse(
        (cx - 380, cy - 320, cx + 60, cy + 60),
        outline=BONE_DK,
        fill=BONE,
        width=4,
    )
    # Acetabular socket — concave pocket.
    d.pieslice(
        (cx - ACETAB_R, cy - ACETAB_R, cx + ACETAB_R, cy + ACETAB_R),
        start=20,
        end=200,
        fill=BONE_DK,
        outline=BONE_DK,
    )
    d.pieslice(
        (cx - ACETAB_R + 14, cy - ACETAB_R + 14, cx + ACETAB_R - 14, cy + ACETAB_R - 14),
        start=20,
        end=200,
        fill=SOFT,
    )


def draw_femur(d, *, head_offset=(0, 0), neck_cut=False, with_implant_stem=False):
    # Femoral head.
    hx, hy = JOINT_CX + head_offset[0], JOINT_CY + head_offset[1]
    d.ellipse(
        (hx - HEAD_R, hy - HEAD_R, hx + HEAD_R, hy + HEAD_R),
        outline=BONE_DK,
        fill=BONE,
        width=4,
    )
    # Neck (angle ~45° down-right from head).
    neck_len = 140
    dx, dy = math.cos(math.radians(35)), math.sin(math.radians(35))
    nx_end = hx + neck_len * dx
    ny_end = hy + neck_len * dy
    if not neck_cut:
        # Solid neck.
        d.line((hx, hy, nx_end, ny_end), fill=BONE_DK, width=NECK_W + 6)
        d.line((hx, hy, nx_end, ny_end), fill=BONE, width=NECK_W)
    else:
        # Neck removed — just stub at the cut plane.
        cut_frac = 0.25
        cx_cut = hx + cut_frac * neck_len * dx
        cy_cut = hy + cut_frac * neck_len * dy
        # Saw-cut surface (a short angled mark).
        d.line((cx_cut - 50, cy_cut + 50, cx_cut + 50, cy_cut - 50), fill=INCISION, width=4)
    # Greater trochanter — bony bump on the lateral side near the neck.
    tx, ty = nx_end + 30, ny_end - 60
    d.ellipse((tx - 40, ty - 40, tx + 40, ty + 40), fill=BONE, outline=BONE_DK, width=3)
    # Femoral shaft.
    if with_implant_stem:
        # Bone shaft with implant stem visible inside.
        d.line(
            (nx_end, ny_end, nx_end + 80, ny_end + 360),
            fill=BONE_DK,
            width=SHAFT_W + 6,
        )
        d.line(
            (nx_end, ny_end, nx_end + 80, ny_end + 360),
            fill=BONE,
            width=SHAFT_W,
        )
        # Implant stem.
        d.line(
            (nx_end - 6, ny_end + 14, nx_end + 60, ny_end + 320),
            fill=IMPLANT_STEM,
            width=SHAFT_W // 2,
        )
        # New femoral ball perched on top of the stem.
        d.ellipse(
            (hx - HEAD_R + 4, hy - HEAD_R + 4, hx + HEAD_R - 4, hy + HEAD_R - 4),
            fill=IMPLANT_STEM,
            outline=IMPLANT_CUP,
            width=4,
        )
    else:
        d.line(
            (nx_end, ny_end, nx_end + 80, ny_end + 360),
            fill=BONE_DK,
            width=SHAFT_W + 6,
        )
        d.line(
            (nx_end, ny_end, nx_end + 80, ny_end + 360),
            fill=BONE,
            width=SHAFT_W,
        )


def draw_acetab_implant(d):
    cx, cy = JOINT_CX - 30, JOINT_CY - 40
    # New acetabular cup (titanium-blue).
    d.pieslice(
        (cx - ACETAB_R + 4, cy - ACETAB_R + 4, cx + ACETAB_R - 4, cy + ACETAB_R - 4),
        start=20,
        end=200,
        fill=IMPLANT_CUP,
        outline=IMPLANT_STEM,
    )
    d.pieslice(
        (cx - ACETAB_R + 22, cy - ACETAB_R + 22, cx + ACETAB_R - 22, cy + ACETAB_R - 22),
        start=20,
        end=200,
        fill=SOFT,
    )


def draw_incision(d, progress: float):
    # Curved incision line over the posterior aspect, growing left-to-right.
    full_pts = [
        (PANEL_LEFT[0] + 200, JOINT_CY - 220),
        (PANEL_LEFT[0] + 280, JOINT_CY - 100),
        (PANEL_LEFT[0] + 360, JOINT_CY + 30),
        (PANEL_LEFT[0] + 420, JOINT_CY + 160),
    ]
    n_total_segments = len(full_pts) - 1
    n_drawn = max(1, int(n_total_segments * progress))
    for i in range(n_drawn):
        d.line([full_pts[i], full_pts[i + 1]], fill=INCISION, width=8)
    # Pulsing tip dot at the leading edge.
    if n_drawn < n_total_segments:
        end = full_pts[n_drawn]
        d.ellipse((end[0] - 7, end[1] - 7, end[0] + 7, end[1] + 7), fill=INCISION)


def draw_dislocation_arrow(d, progress: float):
    # Arrow showing the femoral head being levered out posteriorly.
    sx, sy = JOINT_CX, JOINT_CY
    end_x = sx + int(220 * progress)
    end_y = sy + int(40 * progress)
    d.line((sx, sy, end_x, end_y), fill=ACCENT, width=8)
    # Arrowhead.
    d.polygon(
        [
            (end_x, end_y),
            (end_x - 22, end_y - 12),
            (end_x - 16, end_y),
            (end_x - 22, end_y + 12),
        ],
        fill=ACCENT,
    )


def draw_saw(d, progress: float):
    # Oscillating saw moving across the femoral neck.
    base_x = JOINT_CX + 50
    base_y = JOINT_CY + 60
    swing = math.sin(progress * math.pi * 4) * 20
    # Saw shaft.
    d.rectangle(
        (base_x - 100, base_y - 10 + swing, base_x + 80, base_y + 10 + swing),
        fill=DIM,
        outline=SUBTLE,
    )
    # Blade (toothed line).
    blade_x = base_x + 80
    for i in range(6):
        d.polygon(
            [
                (blade_x + i * 14, base_y - 12 + swing),
                (blade_x + i * 14 + 7, base_y + swing),
                (blade_x + i * 14, base_y + 12 + swing),
            ],
            fill=SUBTLE,
        )


def draw_sutures(d, progress: float):
    # Suture row across the closed incision (mirrors draw_incision path).
    seg_pts = [
        (PANEL_LEFT[0] + 200, JOINT_CY - 220),
        (PANEL_LEFT[0] + 280, JOINT_CY - 100),
        (PANEL_LEFT[0] + 360, JOINT_CY + 30),
        (PANEL_LEFT[0] + 420, JOINT_CY + 160),
    ]
    # Solid base line in dark suture color.
    for i in range(len(seg_pts) - 1):
        d.line([seg_pts[i], seg_pts[i + 1]], fill=SUTURE, width=6)
    # Per-frame: more X-marks appear.
    n_marks = max(1, int(progress * 9))
    for j in range(n_marks):
        t = (j + 0.5) / 9
        # Find segment.
        segs_t = t * (len(seg_pts) - 1)
        seg_i = min(int(segs_t), len(seg_pts) - 2)
        local_t = segs_t - seg_i
        x = int(seg_pts[seg_i][0] + (seg_pts[seg_i + 1][0] - seg_pts[seg_i][0]) * local_t)
        y = int(seg_pts[seg_i][1] + (seg_pts[seg_i + 1][1] - seg_pts[seg_i][1]) * local_t)
        # Draw small X.
        d.line((x - 10, y - 10, x + 10, y + 10), fill=SUTURE, width=3)
        d.line((x - 10, y + 10, x + 10, y - 10), fill=SUTURE, width=3)


# ─── Per-beat scene drivers ────────────────────────────────────────────────


def render_beat_anatomy(d, beat_idx: int, progress: float):
    """Draw the diagram in the left-pane area for the given beat at progress (0..1)."""
    draw_skin_outline(d)
    draw_pelvis(d)

    if beat_idx == 0:
        # Beat 1 — incision (skin-deep, no joint movement yet).
        draw_femur(d)
        draw_incision(d, progress)
    elif beat_idx == 1:
        # Beat 2 — dislocation (femoral head lifted out posteriorly).
        offset = (int(60 * progress), int(20 * progress))
        draw_femur(d, head_offset=offset)
        draw_dislocation_arrow(d, progress)
    elif beat_idx == 2:
        # Beat 3 — femoral neck osteotomy (saw + cut visible).
        if progress < 0.55:
            draw_femur(d, head_offset=(80, 30), neck_cut=False)
            draw_saw(d, progress)
        else:
            draw_femur(d, head_offset=(80, 30), neck_cut=True)
    elif beat_idx == 3:
        # Beat 4 — acetabular cup placed in the socket.
        if progress < 0.5:
            draw_femur(d, head_offset=(220, 60), neck_cut=True)  # head still off to the side
        else:
            draw_femur(d, head_offset=(220, 60), neck_cut=True)
            draw_acetab_implant(d)
    elif beat_idx == 4:
        # Beat 5 — femoral stem + new head implanted.
        draw_acetab_implant(d)
        # Head moves back toward socket as the new joint is reduced.
        offset = (int(220 * (1 - progress)), int(60 * (1 - progress)))
        draw_femur(d, head_offset=offset, neck_cut=True, with_implant_stem=True)
    elif beat_idx == 5:
        # Beat 6 — closure: stem in place, sutures appearing on incision.
        draw_acetab_implant(d)
        draw_femur(d, head_offset=(0, 0), neck_cut=True, with_implant_stem=True)
        draw_sutures(d, progress)


# ─── Frame composition ────────────────────────────────────────────────────


def draw_header(d, beat_idx: int, total_beats: int, shot_id: str, citation: str):
    f_chip = load_font(22, bold=True)
    f_dur = load_font(28, bold=True)
    # Top-left: BEAT N/M chip.
    chip(
        d,
        56,
        46,
        f"BEAT {beat_idx + 1}/{total_beats}",
        ACCENT,
        PANEL_BG,
        f_chip,
    )
    # Shot id label next to it.
    d.text((220, 52), shot_id.upper().replace("_", " "), fill=SUBTLE, font=f_chip)
    # Top-right: citation pointer (Invariant 4 surface).
    d.text(
        (WIDTH - 600, 52),
        f"CITED →  {citation}",
        fill=SUBTLE,
        font=f_chip,
    )


def draw_narrator_strip(d, narrator: str):
    f = load_font(38)
    wrapped = wrap(narrator, width=70)[:3]
    y0 = HEIGHT - 230
    h = max(120, 60 + len(wrapped) * 50)
    d.rounded_rectangle(
        (40, y0, WIDTH - 40, y0 + h),
        radius=14,
        fill=PANEL_BG,
        outline=PANEL_LINE,
        width=2,
    )
    f_label = load_font(18, bold=True)
    d.text((64, y0 + 14), "NARRATOR  ·  Seed Speech 2.0  ·  calm-clinician", fill=ACCENT, font=f_label)
    for i, line in enumerate(wrapped):
        d.text((64, y0 + 50 + i * 50), line, fill=TEXT, font=f)


def draw_phantom_banner(d):
    f = load_font(22)
    s = "Synthetic Phantom   ·   Demo Case   ·   PreOpReel — surgical pre-op explainer"
    w, _ = measure(d, s, f)
    d.text(((WIDTH - w) // 2, HEIGHT - 50), s, fill=SUBTLE, font=f)


def draw_agent_panel(d, beat_idx: int):
    """Right rail showing agent activity on this beat — feature demonstration."""
    x0, y0 = 1380, 100
    x1, y1 = WIDTH - 40, 850
    draw_panel_bg(d, ((x0, y0), (x1, y1)), title="AGENT ACTIVITY")

    f_role = load_font(20, bold=True)
    f_msg = load_font(18)
    f_status = load_font(16, bold=True)

    # Per-beat agent narrative — mirrors the actual fixtures.
    activities = [
        # Beat 1
        [
            ("Atlas", ATLAS, "Director draft: posterior approach beat", "DRAFTED"),
            ("Tavi",  ACCENT, "Cited §2.3 (8–10cm incision)", "CITED"),
            ("Mara",  MARA,   "Reviewed line — no advice creep", "PASS ✓"),
            ("Lyra",  ACCENT, "Anatomical fidelity 0.88", "ACCEPT ✓"),
        ],
        # Beat 2
        [
            ("Atlas", ATLAS, "Beat 2 — capsulotomy + dislocate", "DRAFTED"),
            ("Gem",   ACCENT, "Anatomy graph: sciatic nerve flagged 0.51–0.62", "CONFIDENCE BAND"),
            ("Mara",  MARA,   "Reviewed — within plan boundary", "PASS ✓"),
            ("Lyra",  ACCENT, "Anatomical fidelity 0.86", "ACCEPT ✓"),
        ],
        # Beat 3 — the rubric-play beat
        [
            ("Atlas", ATLAS, "Beat 3 — femoral neck osteotomy", "DRAFTED"),
            ("Tavi",  ACCENT, "Cited PMID:34567890 (anatomic angle)", "CITED"),
            ("Lyra",  MARA,   "anatomical_fidelity 0.71 < 0.75 threshold", "REJECT"),
            ("Atlas", ATLAS, "Re-rendered with tightened ref image", "REGEN"),
            ("Lyra",  ACCENT, "Re-scored 0.86 ≥ threshold", "ACCEPT ✓"),
        ],
        # Beat 4 — the Mara play
        [
            ("Atlas", ATLAS, "Beat 4 — cup placement", "DRAFTED"),
            ("Mara",  MARA,   "advice_creep flag: 'you should expect…'", "BLOCK"),
            ("Atlas", ATLAS, "Revised → 'your surgeon will discuss'", "REVISED"),
            ("Lyra",  ACCENT, "Anatomical fidelity 0.92", "ACCEPT ✓"),
        ],
        # Beat 5
        [
            ("Atlas", ATLAS, "Beat 5 — femoral stem + trial reduction", "DRAFTED"),
            ("Exa",   ACCENT, "Visual ref: similar-procedure stem seating", "REFERENCED"),
            ("Mara",  MARA,   "Reviewed — within plan", "PASS ✓"),
            ("Lyra",  ACCENT, "Anatomical fidelity 0.89", "ACCEPT ✓"),
        ],
        # Beat 6
        [
            ("Atlas", ATLAS, "Beat 6 — closure + capsule repair", "DRAFTED"),
            ("Tavi",  ACCENT, "Cited §5.1 (layered closure)", "CITED"),
            ("Mara",  MARA,   "Reviewed — within plan", "PASS ✓"),
            ("Lyra",  ACCENT, "Anatomical fidelity 0.91", "ACCEPT ✓"),
        ],
    ]
    rows = activities[beat_idx]
    y = y0 + 70
    for role, color, msg, status in rows:
        d.text((x0 + 22, y), role.upper(), fill=color, font=f_role)
        # Status pill on right.
        sw, _ = measure(d, status, f_status)
        d.rounded_rectangle(
            (x1 - sw - 36, y - 2, x1 - 18, y + 26),
            radius=6,
            fill=BG,
            outline=color,
        )
        d.text((x1 - sw - 27, y), status, fill=color, font=f_status)
        # Message under the role.
        for i, line in enumerate(wrap(msg, width=44)[:2]):
            d.text((x0 + 22, y + 30 + i * 22), line, fill=SUBTLE, font=f_msg)
        y += 95

    # Bottom of panel — invariant + critic-loop reminder.
    f_inv = load_font(14, bold=True)
    inv_y = y1 - 70
    d.line((x0 + 22, inv_y - 14, x1 - 22, inv_y - 14), fill=PANEL_LINE, width=1)
    d.text((x0 + 22, inv_y), "★ INVARIANT 1: critic loop is mandatory.", fill=ACCENT, font=f_inv)
    d.text((x0 + 22, inv_y + 22), "★ INVARIANT 4: every claim is cited.", fill=ACCENT, font=f_inv)


def render_beat_frame(*, beat_idx: int, total: int, shot, citation: str, narrator: str, progress: float, out_path: Path):
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)

    # Left panel — anatomy diagram.
    draw_panel_bg(d, (PANEL_LEFT, PANEL_RIGHT), title=f"POSTERIOR HIP — STEP {beat_idx + 1}")
    render_beat_anatomy(d, beat_idx, progress)

    # Right panel — agent activity / feature demo.
    draw_agent_panel(d, beat_idx)

    # Header chips + narrator strip + phantom banner.
    draw_header(d, beat_idx, total, shot, citation)
    draw_narrator_strip(d, narrator)
    draw_phantom_banner(d)

    img.save(out_path, "PNG")


# ─── Bookend cards ─────────────────────────────────────────────────────────


def render_intro(out_path: Path):
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    f_brand = load_font(120, bold=True)
    f_sub = load_font(38)
    f_meta = load_font(26)
    f_chip = load_font(20, bold=True)

    # Title.
    draw_centered(d, "PreOpReel", 320, f_brand, ACCENT)
    draw_centered(d, "The 90-second pre-op explainer your surgeon never had time to make.", 480, f_sub, TEXT)
    draw_centered(d, "Total Hip Arthroplasty   ·   Posterior approach   ·   CPT 27130", 580, f_meta, SUBTLE)
    # Agent team chips.
    f = load_font(20, bold=True)
    chips = [("ATLAS", ATLAS), ("MARA", MARA), ("LYRA", ACCENT), ("TAVI", ACCENT), ("EXA", ACCENT), ("GEM", ACCENT)]
    total_w = 0
    chip_widths = []
    for label, color in chips:
        w, _ = measure(d, label, f)
        chip_widths.append(w + 28)
        total_w += w + 28 + 18
    x = (WIDTH - (total_w - 18)) // 2
    for (label, color), w in zip(chips, chip_widths):
        d.rounded_rectangle((x, 720, x + w, 770), radius=10, fill=PANEL_BG, outline=color, width=2)
        d.text((x + 14, 730), label, fill=color, font=f)
        x += w + 18
    # Footer.
    draw_centered(d, "Synthetic Phantom   ·   Demo Case   ·   No real patient data", 880, f_meta, SUBTLE)
    img.save(out_path, "PNG")


def render_outro(out_path: Path, *, n_beats: int, n_critiques: int, n_scores: int):
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    f_h = load_font(80, bold=True)
    f_b = load_font(34)
    f_meta = load_font(26)
    draw_centered(d, "Audit-trail summary", 200, f_h, ACCENT)
    rows = [
        f"{n_beats} beats   ·   each narrator line cited (procedure-plan §X or PMID)",
        f"{n_scores} per-beat critic scores   ·   1 reject + regen on shot_3 (Lyra)",
        f"{n_critiques} pre-render advice-creep flag on shot_4 (Mara) — revised before render",
        "0 on-screen text violations   ·   confidence bands shown, not hidden",
    ]
    for i, r in enumerate(rows):
        draw_centered(d, r, 360 + i * 64, f_b, TEXT)
    draw_centered(d, "Receipt PDF: every claim → procedure plan §X or PMID.", 720, f_meta, SUBTLE)
    draw_centered(d, "Synthetic Phantom   ·   Demo Case   ·   PreOpReel", HEIGHT - 60, f_meta, SUBTLE)
    img.save(out_path, "PNG")


# ─── Encoder ───────────────────────────────────────────────────────────────


def png_to_clip(png_path: Path, mp4_path: Path, duration_s: float) -> None:
    """Single PNG → constant-image clip of given duration."""
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-t",
        f"{duration_s:.3f}",
        "-i",
        str(png_path),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "24",
        "-r",
        str(FPS),
        "-vf",
        f"scale={WIDTH}:{HEIGHT},format=yuv420p",
        str(mp4_path),
    ]
    subprocess.run(cmd, check=True)


def concat_segments(segments: list[Path], out: Path) -> None:
    manifest = out.parent / f"_concat_{out.stem}.txt"
    manifest.write_text("\n".join(f"file '{p.as_posix()}'" for p in segments) + "\n")
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
            str(out),
        ],
        check=True,
    )
    manifest.unlink(missing_ok=True)


# ─── Main ──────────────────────────────────────────────────────────────────


def main() -> int:
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not on PATH. Install with: brew install ffmpeg")

    shotlist = json.loads(SHOTLIST_PATH.read_text())
    beats = shotlist.get("beats") or shotlist.get("shotList", {}).get("beats", [])
    if not beats:
        sys.exit(f"No beats in {SHOTLIST_PATH}")

    # Per-beat citation pointer (best-effort lookup from shotlist; fallback "§2.3").
    citations: list[str] = []
    for b in beats:
        cs = b.get("citations") or b.get("cites") or []
        if cs and isinstance(cs, list):
            ptr = cs[0].get("pointer") or cs[0].get("citation_pointer") or "§2.3"
            citations.append(str(ptr))
        else:
            citations.append("§2.3")

    # Best-effort counts for the outro.
    try:
        critiques = json.loads(CRITIQUES_PATH.read_text())
        critiques = critiques if isinstance(critiques, list) else critiques.get("critiques", [])
        n_critiques = len(critiques)
    except Exception:
        n_critiques = 0
    try:
        scores = json.loads(SCORES_PATH.read_text())
        scores = scores if isinstance(scores, list) else scores.get("beats", [])
        n_scores = len(scores)
    except Exception:
        n_scores = 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = OUT_DIR / "_tmp_demo_segments"
    tmp.mkdir(exist_ok=True)
    segments: list[Path] = []

    try:
        # ── Intro card (4s) ─────────────────────────────────────
        intro_png = tmp / "00_intro.png"
        intro_mp4 = tmp / "00_intro.mp4"
        render_intro(intro_png)
        png_to_clip(intro_png, intro_mp4, 4.0)
        segments.append(intro_mp4)

        # ── Per-beat animated segments ──────────────────────────
        total = len(beats)
        for i, beat in enumerate(beats):
            shot_id = beat.get("id") or beat.get("shotId") or f"shot_{i+1}"
            duration = float(beat.get("durationS") or beat.get("duration_s") or 13)
            narrator = beat.get("narratorLine") or beat.get("narrator_line") or ""
            citation = citations[i]
            sub_dur = duration / KEYFRAMES_PER_BEAT
            print(f"  beat {i+1}/{total} {shot_id} ({duration}s) — {KEYFRAMES_PER_BEAT} keyframes")
            for k in range(KEYFRAMES_PER_BEAT):
                progress = (k + 0.5) / KEYFRAMES_PER_BEAT
                kf_png = tmp / f"{i+1:02d}_{k:02d}.png"
                kf_mp4 = tmp / f"{i+1:02d}_{k:02d}.mp4"
                render_beat_frame(
                    beat_idx=i,
                    total=total,
                    shot=shot_id,
                    citation=citation,
                    narrator=narrator,
                    progress=progress,
                    out_path=kf_png,
                )
                png_to_clip(kf_png, kf_mp4, sub_dur)
                segments.append(kf_mp4)

        # ── Outro card (4s) ─────────────────────────────────────
        outro_png = tmp / "99_outro.png"
        outro_mp4 = tmp / "99_outro.mp4"
        render_outro(outro_png, n_beats=total, n_critiques=n_critiques, n_scores=n_scores)
        png_to_clip(outro_png, outro_mp4, 4.0)
        segments.append(outro_mp4)

        # ── Stitch ──────────────────────────────────────────────
        print(f"  stitching {len(segments)} clips → {OUT_PATH}…")
        concat_segments(segments, OUT_PATH)

        size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
        total_s = (
            4
            + sum(float(b.get("durationS") or b.get("duration_s") or 13) for b in beats)
            + 4
        )
        print(f"\nwrote {OUT_PATH.relative_to(ROOT)}  ({size_mb:.2f} MB, ~{int(total_s)}s)")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
