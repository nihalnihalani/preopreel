#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# generate_phantom_plan.py
#
# PreOpReel — synthetic-phantom procedure plan PDF generator.
#
# Owner: Demo Ops Dev (Phase 3, slice C/D of docs/plans/04-frontend-and-demo.md).
# Promo code: BUTTERBASE0502  (ALL CAPS, applied in Butterbase Billing → Promo Codes)
# Submission code: butterbase0502 (lowercase, set in Settings → Project Metadata)
#
# Generates data/fixtures/demo-hip-replacement/plan.pdf — 6 pages, every numbered
# section a §N.M pointer matching expected.shotlist.json citations. Idempotent:
# if the PDF already exists with the same content hash, the script exits 0
# without rewriting.
#
# Dependencies (NOT installed by this script — document only, per repo rules):
#   - reportlab >= 4.0   (chosen as the lightest pure-Python option that ships
#                         A4/letter, basic typography, and headers/footers
#                         without a system browser like weasyprint requires)
#   pip install reportlab
#
# Python: 3.11+
# Exit codes:
#   0 — PDF written, or no-op because hash matched
#   1 — reportlab not installed
#   2 — write failure / IO error
# ─────────────────────────────────────────────────────────────────────────────

from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_DIR = REPO_ROOT / "data" / "fixtures" / "demo-hip-replacement"
PDF_PATH = FIXTURE_DIR / "plan.pdf"
HASH_PATH = FIXTURE_DIR / "plan.pdf.sha256"


# ─── Plan content (kept in this file so the PDF is reproducible bit-for-bit) ──
@dataclass(frozen=True)
class Section:
    pointer: str         # "§5.3"
    title: str
    body: str


COVER = {
    "title": "Procedure Plan — Total Hip Arthroplasty (Posterior Approach)",
    "surgeon": "Dr. M. Chen, MD (synthetic)",
    "date": "2026-04-30",
    "watermark": "SYNTHETIC PHANTOM — NOT A REAL PATIENT",
    "cpt": "CPT 27130",
    "duration": "Expected duration: 90 minutes",
}

PATIENT_SECTIONS = [
    Section("§2.1", "Demographics", "65 y/o male, BMI 28.4, height 178 cm, weight 90 kg."),
    Section("§2.2", "Comorbidities", "Controlled hypertension; mild osteoarthritis of left knee."),
    Section("§2.3", "Labs & Allergies", "CBC, CMP, INR within reference range. NKDA. ASA II."),
]

ANATOMY_SECTIONS = [
    Section("§3.1", "Acetabulum (right)",
            "Bony socket of the pelvis articulating with the femoral head."),
    Section("§3.2", "Femoral head",
            "Spherical proximal end of the femur seated in the acetabulum."),
    Section("§3.3", "Greater trochanter",
            "Lateral bony prominence — primary reference for osteotomy angle."),
    Section("§3.4", "Lesser trochanter",
            "Medial reference for stem position and leg-length restoration."),
    Section("§3.5", "Sciatic nerve",
            "Posterior to the joint capsule; protected during posterior approach."),
    Section("§3.6", "Posterior capsule",
            "Posterior joint capsule, repaired at closure to reduce dislocation risk."),
    Section("§3.7", "Short external rotators",
            "Piriformis, gemelli, obturator internus — released and reattached."),
]

APPROACH_SECTIONS = [
    Section("§4.1", "Position",
            "Lateral decubitus, operative side up, secured with hip positioner."),
    Section("§4.2", "Incision",
            "Curved incision centered over the greater trochanter, extending posteriorly."),
    Section("§4.3", "Layered exposure",
            "Through skin, subcutaneous tissue, fascia lata, and gluteus maximus split."),
]

# 7 surgical steps — each gets its own page; pointers map 1:1 to shotlist citations.
STEP_SECTIONS = [
    Section("§5.1", "Skin incision and exposure",
            "Curved skin incision; layered dissection to expose the posterior hip capsule."),
    Section("§5.2", "Capsulotomy and dislocation",
            "T-shaped capsulotomy; controlled posterior dislocation of the femoral head."),
    Section("§5.3", "Femoral neck osteotomy",
            "Oscillating-saw osteotomy at planned angle relative to the greater trochanter."),
    Section("§5.4", "Acetabular reaming and cup placement",
            "Sequential reaming; press-fit acetabular component placed at planned inclination/anteversion."),
    Section("§5.5", "Femoral canal preparation",
            "Sequential broaching of the femoral canal to size."),
    Section("§5.6", "Femoral component and trial reduction",
            "Stem inserted; trial head used to confirm stability, length, and offset."),
    Section("§5.7", "Closure with posterior capsular repair",
            "Capsule and short external rotators repaired through bone tunnels; layered closure."),
]

NOTES_SECTIONS = [
    Section("§6.1", "Posterior precautions",
            "Avoid hip flexion >90°, adduction past midline, and internal rotation for 6 weeks."),
    Section("§6.2", "Weight-bearing",
            "Weight-bearing as tolerated with assistive device; progress per therapy."),
    Section("§6.3", "Anticipated blood loss",
            "Expected blood loss ~250 mL; tranexamic acid per protocol."),
    Section("§6.4", "References",
            "AAOS Clinical Practice Guideline for Total Hip Arthroplasty (PMID:34567890); "
            "Posterior capsular repair reduces dislocation risk (PMID:28456712)."),
]


def _build_pdf(target: Path) -> bytes:
    """Render the plan to bytes using reportlab. Returns the bytes (so we can hash)."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            PageBreak,
            Paragraph,
            SimpleDocTemplate,
            Spacer,
        )
    except ModuleNotFoundError:
        sys.stderr.write(
            "ERROR: reportlab is not installed.\n"
            "       pip install reportlab >= 4.0\n"
        )
        sys.exit(1)

    import io

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.9 * inch,
        rightMargin=0.9 * inch,
        topMargin=0.9 * inch,
        bottomMargin=0.9 * inch,
        title="Procedure Plan — Total Hip Arthroplasty",
        author="PreOpReel (synthetic)",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title", parent=styles["Title"], fontSize=20, leading=24, spaceAfter=10
    )
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=16, leading=20, spaceAfter=8)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, leading=15, spaceAfter=6)
    body = ParagraphStyle("Body", parent=styles["BodyText"], fontSize=10.5, leading=14)
    watermark = ParagraphStyle(
        "Watermark", parent=styles["BodyText"], fontSize=10, leading=12,
        textColor="#a31515",
    )
    pointer = ParagraphStyle(
        "Pointer", parent=styles["BodyText"], fontSize=9, leading=11,
        textColor="#666",
    )

    flowables: list = []

    # ── Page 1 — Cover ──
    flowables.append(Paragraph(COVER["title"], title_style))
    flowables.append(Spacer(1, 0.2 * inch))
    flowables.append(Paragraph(f"<b>Surgeon:</b> {COVER['surgeon']}", body))
    flowables.append(Paragraph(f"<b>Date:</b> {COVER['date']}", body))
    flowables.append(Paragraph(f"<b>{COVER['cpt']}</b>", body))
    flowables.append(Paragraph(COVER["duration"], body))
    flowables.append(Spacer(1, 0.4 * inch))
    flowables.append(Paragraph(f"<b>{COVER['watermark']}</b>", watermark))
    flowables.append(Spacer(1, 0.3 * inch))
    flowables.append(Paragraph(
        "This document is part of the PreOpReel synthetic-phantom demo case "
        "(promo code BUTTERBASE0502 / submission butterbase0502). No real patient data is used. "
        "Section pointers (§N.M) map 1:1 to the citations in expected.shotlist.json.",
        pointer,
    ))
    flowables.append(PageBreak())

    # ── Page 2 — Patient summary ──
    flowables.append(Paragraph("Patient Summary", h1))
    for sec in PATIENT_SECTIONS:
        flowables.append(Paragraph(f"{sec.pointer} &nbsp; {sec.title}", h2))
        flowables.append(Paragraph(sec.body, body))
        flowables.append(Spacer(1, 0.08 * inch))
    flowables.append(PageBreak())

    # ── Page 3 — Anatomical reference ──
    flowables.append(Paragraph("Anatomical Reference (Posterior Right Hip)", h1))
    flowables.append(Paragraph(
        "Text-only landmark list. Diagrams omitted from the synthetic phantom plan; "
        "Gem (Gemini 1.5 Flash) extracts the AnatomyGraph from this list directly.",
        pointer,
    ))
    flowables.append(Spacer(1, 0.1 * inch))
    for sec in ANATOMY_SECTIONS:
        flowables.append(Paragraph(f"{sec.pointer} &nbsp; {sec.title}", h2))
        flowables.append(Paragraph(sec.body, body))
        flowables.append(Spacer(1, 0.06 * inch))
    flowables.append(PageBreak())

    # ── Page 4 — Approach ──
    flowables.append(Paragraph("Surgical Approach — Posterior", h1))
    for sec in APPROACH_SECTIONS:
        flowables.append(Paragraph(f"{sec.pointer} &nbsp; {sec.title}", h2))
        flowables.append(Paragraph(sec.body, body))
        flowables.append(Spacer(1, 0.08 * inch))
    flowables.append(PageBreak())

    # ── Pages 5..11 — One per surgical step ──
    for sec in STEP_SECTIONS:
        flowables.append(Paragraph(f"{sec.pointer} — {sec.title}", h1))
        flowables.append(Paragraph(sec.body, body))
        flowables.append(Spacer(1, 0.2 * inch))
        flowables.append(Paragraph(
            "Patient-facing narrator line should cite this section "
            f"({sec.pointer}); Mara blocks any line that drifts into recommending.",
            pointer,
        ))
        flowables.append(PageBreak())

    # ── Page 12 — Surgeon notes ──
    flowables.append(Paragraph("Surgeon Notes & References", h1))
    for sec in NOTES_SECTIONS:
        flowables.append(Paragraph(f"{sec.pointer} &nbsp; {sec.title}", h2))
        flowables.append(Paragraph(sec.body, body))
        flowables.append(Spacer(1, 0.08 * inch))
    flowables.append(Spacer(1, 0.2 * inch))
    flowables.append(Paragraph(f"<b>{COVER['watermark']}</b>", watermark))

    doc.build(flowables)
    return buf.getvalue()


def main() -> int:
    if not FIXTURE_DIR.exists():
        FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    new_bytes = _build_pdf(PDF_PATH)
    new_hash = hashlib.sha256(new_bytes).hexdigest()

    # Idempotency: skip if the existing PDF has the same content hash.
    if PDF_PATH.exists() and HASH_PATH.exists():
        old_hash = HASH_PATH.read_text().strip()
        if old_hash == new_hash:
            print(f"[skip] {PDF_PATH.relative_to(REPO_ROOT)} unchanged "
                  f"(sha256={new_hash[:12]}…)")
            return 0

    try:
        PDF_PATH.write_bytes(new_bytes)
        HASH_PATH.write_text(new_hash + "\n")
    except OSError as e:
        sys.stderr.write(f"ERROR: failed to write {PDF_PATH}: {e}\n")
        return 2

    print(json.dumps({
        "wrote": str(PDF_PATH.relative_to(REPO_ROOT)),
        "bytes": len(new_bytes),
        "sha256": new_hash,
        "pages": 12,  # 1 cover + 1 patient + 1 anatomy + 1 approach + 7 steps + 1 notes
        "promo": "BUTTERBASE0502",
        "submission": "butterbase0502",
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
