// src/lib/audit/pdf.ts
//
// Audit-trail PDF generator using `pdf-lib`. Pure-JS, no native deps.
//
// Plan 04 §B.4 + master plan §3 row C (Mara G.2 sparkline):
//   - Cover page: forge_run_id, demo case label, generation timestamp,
//     total duration, regen count.
//   - One page per claim: excerpt, citation pointer, confidence band,
//     critic that accepted, mini confidence-band visualization.
//   - Final summary page: citation-density sparkline, score
//     distribution histogram, provenance attestation block.
//
// Output: Uint8Array (callers can write to disk, upload to Butterbase
// Storage, or stream as response body).

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import type { AuditEntry } from "@/lib/forge/audit";

// ─── Public API ────────────────────────────────────────────────────────

export interface AuditPdfHeader {
  forgeRunId: string;
  createdAt: string; // ISO 8601
  isSyntheticPhantom: boolean;
  totalDurationS: number;
  regenCount: number;
  totalCostUsd?: number;
}

export interface AuditPdfInput {
  header: AuditPdfHeader;
  entries: AuditEntry[];
}

export async function buildAuditPdf(
  input: AuditPdfInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`PreOpReel — Audit Trail · ${input.header.forgeRunId.slice(0, 8)}`);
  doc.setAuthor("PreOpReel · Synthesis Worker");
  doc.setSubject("Citation-bound audit trail (Invariant 4)");
  doc.setProducer("preopreel/audit/pdf.ts (pdf-lib)");
  doc.setCreator("PreOpReel");
  doc.setCreationDate(new Date(input.header.createdAt));

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
    monoBold: await doc.embedFont(StandardFonts.CourierBold),
  };

  drawCoverPage(doc, fonts, input);
  for (let i = 0; i < input.entries.length; i++) {
    drawClaimPage(doc, fonts, input.entries[i]!, i + 1, input.entries.length, input.header);
  }
  drawSummaryPage(doc, fonts, input);

  return await doc.save();
}

// ─── Layout constants ──────────────────────────────────────────────────

const PAGE = { w: 612, h: 792 } as const; // US Letter
const MARGIN = { x: 56, top: 72, bottom: 56 } as const;

const COLORS = {
  ink: rgb(0.04, 0.06, 0.08),
  body: rgb(0.13, 0.16, 0.2),
  muted: rgb(0.46, 0.51, 0.57),
  rule: rgb(0.78, 0.81, 0.85),
  teal: rgb(0.227, 0.655, 0.573),     // critic.lyra
  amber: rgb(0.831, 0.604, 0.227),    // critic.warn
  red: rgb(0.788, 0.220, 0.290),      // critic.mara
  green: rgb(0.482, 0.627, 0.333),    // critic.accept
  seed: rgb(0.42, 0.494, 1.0),        // seed.500
} as const satisfies Record<string, RGB>;

interface FontSet {
  regular: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
  monoBold: PDFFont;
}

// ─── Cover page ────────────────────────────────────────────────────────

function drawCoverPage(
  doc: PDFDocument,
  f: FontSet,
  input: AuditPdfInput,
): void {
  const page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN.top;

  // Wordmark + tagline
  page.drawText("PreOpReel", {
    x: MARGIN.x,
    y,
    size: 28,
    font: f.bold,
    color: COLORS.ink,
  });
  y -= 28;
  page.drawText("AI Pre-Operative Patient Explainer · Audit Trail", {
    x: MARGIN.x,
    y,
    size: 11,
    font: f.regular,
    color: COLORS.muted,
  });
  y -= 36;

  // Synthetic phantom banner
  if (input.header.isSyntheticPhantom) {
    drawBanner(page, f, "SYNTHETIC PHANTOM — DEMO CASE", MARGIN.x, y, COLORS.amber);
    y -= 30;
  }

  // Title
  y -= 18;
  page.drawText("Audit Trail Receipt", {
    x: MARGIN.x,
    y,
    size: 22,
    font: f.bold,
    color: COLORS.ink,
  });
  y -= 22;

  page.drawText(
    "Every claim on screen traces back to the surgeon's plan, a peer-reviewed PMID, " +
      "or a curated protocol. Invariant 4.",
    {
      x: MARGIN.x,
      y,
      size: 10,
      font: f.regular,
      color: COLORS.body,
      maxWidth: PAGE.w - 2 * MARGIN.x,
      lineHeight: 14,
    },
  );
  y -= 40;

  // Run summary box
  const boxY = y - 140;
  page.drawRectangle({
    x: MARGIN.x,
    y: boxY,
    width: PAGE.w - 2 * MARGIN.x,
    height: 140,
    borderColor: COLORS.rule,
    borderWidth: 0.75,
    color: rgb(0.97, 0.97, 0.97),
  });

  let infoY = y - 22;
  drawKv(page, f, "Forge run", input.header.forgeRunId, MARGIN.x + 16, infoY);
  infoY -= 18;
  drawKv(
    page,
    f,
    "Generated",
    new Date(input.header.createdAt).toISOString(),
    MARGIN.x + 16,
    infoY,
  );
  infoY -= 18;
  drawKv(
    page,
    f,
    "Duration",
    `${input.header.totalDurationS.toFixed(1)} s`,
    MARGIN.x + 16,
    infoY,
  );
  infoY -= 18;
  drawKv(
    page,
    f,
    "Regen attempts",
    String(input.header.regenCount),
    MARGIN.x + 16,
    infoY,
  );
  infoY -= 18;
  drawKv(
    page,
    f,
    "Total claims",
    String(input.entries.length),
    MARGIN.x + 16,
    infoY,
  );
  if (typeof input.header.totalCostUsd === "number") {
    infoY -= 18;
    drawKv(
      page,
      f,
      "Cost",
      `$${input.header.totalCostUsd.toFixed(3)}`,
      MARGIN.x + 16,
      infoY,
    );
  }

  // Footer
  page.drawText(
    "Informed-consent communication tool. Not a medical device. " +
      "Built on Butterbase. Submission code: butterbase0502.",
    {
      x: MARGIN.x,
      y: MARGIN.top - 20,
      size: 8,
      font: f.regular,
      color: COLORS.muted,
      maxWidth: PAGE.w - 2 * MARGIN.x,
      lineHeight: 11,
    },
  );
}

// ─── Per-claim pages ───────────────────────────────────────────────────

function drawClaimPage(
  doc: PDFDocument,
  f: FontSet,
  entry: AuditEntry,
  n: number,
  total: number,
  header: AuditPdfHeader,
): void {
  const page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN.top;

  // Header strip
  page.drawText(`PreOpReel · Audit Trail · Run ${header.forgeRunId.slice(0, 8)}`, {
    x: MARGIN.x,
    y,
    size: 9,
    font: f.regular,
    color: COLORS.muted,
  });
  page.drawText(new Date(header.createdAt).toLocaleDateString(), {
    x: PAGE.w - MARGIN.x - 90,
    y,
    size: 9,
    font: f.regular,
    color: COLORS.muted,
  });
  y -= 14;
  page.drawLine({
    start: { x: MARGIN.x, y },
    end: { x: PAGE.w - MARGIN.x, y },
    thickness: 0.5,
    color: COLORS.rule,
  });
  y -= 26;

  // Title
  page.drawText(`Claim ${n} of ${total}`, {
    x: MARGIN.x,
    y,
    size: 22,
    font: f.bold,
    color: COLORS.ink,
  });
  y -= 14;
  page.drawText(`claim_id: ${entry.claimId}`, {
    x: MARGIN.x,
    y,
    size: 8,
    font: f.mono,
    color: COLORS.muted,
  });
  y -= 32;

  // Excerpt
  drawSectionLabel(page, f, "Narrator line", MARGIN.x, y);
  y -= 16;
  const excerptHeight = drawWrappedText(
    page,
    f.regular,
    `"${entry.narratorLineExcerpt}"`,
    MARGIN.x,
    y,
    PAGE.w - 2 * MARGIN.x,
    11,
    14,
    COLORS.body,
  );
  y -= excerptHeight + 18;

  // Citation
  drawSectionLabel(page, f, "Citation", MARGIN.x, y);
  y -= 16;
  drawKv(page, f, "Source type", entry.citation.sourceType, MARGIN.x, y);
  y -= 16;
  drawKv(page, f, "Pointer", entry.citation.pointer, MARGIN.x, y);
  y -= 16;
  // Source excerpt (verbatim from the cited material)
  drawKv(page, f, "Excerpt", "", MARGIN.x, y);
  y -= 14;
  const srcH = drawWrappedText(
    page,
    f.mono,
    entry.citation.excerpt,
    MARGIN.x + 8,
    y,
    PAGE.w - 2 * MARGIN.x - 8,
    9,
    12,
    COLORS.body,
  );
  y -= srcH + 18;

  // Confidence band
  drawSectionLabel(page, f, "Confidence", MARGIN.x, y);
  y -= 16;
  drawConfidenceBar(
    page,
    MARGIN.x,
    y - 12,
    PAGE.w - 2 * MARGIN.x,
    entry.confidenceBand.lo,
    entry.confidenceBand.hi,
  );
  y -= 16;
  page.drawText(
    `Band ${entry.confidenceBand.lo.toFixed(2)} – ${entry.confidenceBand.hi.toFixed(2)}`,
    {
      x: MARGIN.x,
      y: y - 8,
      size: 9,
      font: f.mono,
      color: COLORS.muted,
    },
  );
  y -= 28;

  // Accepted by
  drawSectionLabel(page, f, "Accepted by", MARGIN.x, y);
  y -= 16;
  let chipX: number = MARGIN.x;
  for (const c of entry.criticPasses) {
    chipX = drawChip(
      page,
      f,
      c.toUpperCase(),
      chipX,
      y - 6,
      c === "mara" ? COLORS.red : COLORS.green,
    );
    chipX += 6;
  }

  // Footer
  page.drawText(`Page ${n + 1} of ${total + 2}`, {
    x: PAGE.w - MARGIN.x - 70,
    y: MARGIN.top - 20,
    size: 8,
    font: f.regular,
    color: COLORS.muted,
  });
  page.drawText(
    header.isSyntheticPhantom
      ? "Synthetic phantom demo case"
      : "Production patient",
    {
      x: MARGIN.x,
      y: MARGIN.top - 20,
      size: 8,
      font: f.regular,
      color: header.isSyntheticPhantom ? COLORS.amber : COLORS.muted,
    },
  );
}

// ─── Summary page ──────────────────────────────────────────────────────

function drawSummaryPage(
  doc: PDFDocument,
  f: FontSet,
  input: AuditPdfInput,
): void {
  const page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - MARGIN.top;

  page.drawText("Provenance attestation", {
    x: MARGIN.x,
    y,
    size: 22,
    font: f.bold,
    color: COLORS.ink,
  });
  y -= 32;

  // Citation density sparkline (Mara G.2)
  drawSectionLabel(page, f, "Citation density (one bar per claim)", MARGIN.x, y);
  y -= 8;
  drawCitationSparkline(
    page,
    MARGIN.x,
    y - 56,
    PAGE.w - 2 * MARGIN.x,
    48,
    input.entries,
  );
  y -= 72;

  // Score distribution mini-histogram
  drawSectionLabel(page, f, "Confidence distribution", MARGIN.x, y);
  y -= 8;
  drawScoreHistogram(
    page,
    f,
    MARGIN.x,
    y - 64,
    PAGE.w - 2 * MARGIN.x,
    56,
    input.entries,
  );
  y -= 84;

  // Counters
  const sourceCounts = new Map<string, number>();
  const criticCounts = new Map<string, number>();
  for (const e of input.entries) {
    sourceCounts.set(
      e.citation.sourceType,
      (sourceCounts.get(e.citation.sourceType) ?? 0) + 1,
    );
    for (const c of e.criticPasses) {
      criticCounts.set(c, (criticCounts.get(c) ?? 0) + 1);
    }
  }
  drawSectionLabel(page, f, "Sources", MARGIN.x, y);
  y -= 16;
  for (const [k, v] of sourceCounts) {
    drawKv(page, f, k, String(v), MARGIN.x, y);
    y -= 14;
  }
  y -= 8;
  drawSectionLabel(page, f, "Critic passes", MARGIN.x, y);
  y -= 16;
  for (const [k, v] of criticCounts) {
    drawKv(page, f, k, String(v), MARGIN.x, y);
    y -= 14;
  }

  // Disclaimer footer
  page.drawText(
    "Generated on demand. Synthetic phantom on demo path. " +
      "Submission: butterbase0502 · Promo: BUTTERBASE0502.",
    {
      x: MARGIN.x,
      y: MARGIN.top - 20,
      size: 8,
      font: f.regular,
      color: COLORS.muted,
      maxWidth: PAGE.w - 2 * MARGIN.x,
      lineHeight: 11,
    },
  );
}

// ─── Drawing helpers ───────────────────────────────────────────────────

function drawSectionLabel(
  page: PDFPage,
  f: FontSet,
  label: string,
  x: number,
  y: number,
): void {
  page.drawText(label.toUpperCase(), {
    x,
    y,
    size: 8,
    font: f.bold,
    color: COLORS.muted,
  });
}

function drawKv(
  page: PDFPage,
  f: FontSet,
  k: string,
  v: string,
  x: number,
  y: number,
): void {
  page.drawText(k, {
    x,
    y,
    size: 9,
    font: f.bold,
    color: COLORS.ink,
  });
  page.drawText(v, {
    x: x + 100,
    y,
    size: 9,
    font: f.mono,
    color: COLORS.body,
  });
}

function drawChip(
  page: PDFPage,
  f: FontSet,
  label: string,
  x: number,
  y: number,
  color: RGB,
): number {
  const padX = 6;
  const w = f.bold.widthOfTextAtSize(label, 8) + padX * 2;
  page.drawRectangle({
    x,
    y: y - 4,
    width: w,
    height: 14,
    color: rgb(color.red, color.green, color.blue),
    opacity: 0.15,
    borderColor: color,
    borderOpacity: 0.6,
    borderWidth: 0.6,
  });
  page.drawText(label, {
    x: x + padX,
    y: y,
    size: 8,
    font: f.bold,
    color,
  });
  return x + w;
}

function drawBanner(
  page: PDFPage,
  f: FontSet,
  text: string,
  x: number,
  y: number,
  color: RGB,
): void {
  const w = PAGE.w - 2 * MARGIN.x;
  page.drawRectangle({
    x,
    y: y - 4,
    width: w,
    height: 22,
    color: rgb(color.red, color.green, color.blue),
    opacity: 0.18,
    borderColor: color,
    borderOpacity: 0.7,
    borderWidth: 0.6,
  });
  page.drawText(text, {
    x: x + 10,
    y: y + 3,
    size: 10,
    font: f.bold,
    color,
  });
}

function drawConfidenceBar(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  lo: number,
  hi: number,
): void {
  const h = 12;
  // Track
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(0.93, 0.94, 0.96),
    borderColor: COLORS.rule,
    borderWidth: 0.4,
  });
  // Mid color band
  const mid = (lo + hi) / 2;
  const tone = mid < 0.6 ? COLORS.red : mid < 0.8 ? COLORS.amber : COLORS.green;
  page.drawRectangle({
    x: x + lo * w,
    y,
    width: (hi - lo) * w,
    height: h,
    color: tone,
    opacity: 0.55,
  });
  // Threshold tick at 0.75
  const tx = x + 0.75 * w;
  page.drawLine({
    start: { x: tx, y: y - 2 },
    end: { x: tx, y: y + h + 2 },
    thickness: 0.7,
    color: COLORS.red,
    opacity: 0.6,
  });
}

function drawCitationSparkline(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  entries: AuditEntry[],
): void {
  // Track
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: rgb(0.97, 0.97, 0.97),
    borderColor: COLORS.rule,
    borderWidth: 0.3,
  });
  if (entries.length === 0) return;
  const barW = Math.max(2, w / entries.length - 1);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const span = Math.max(0.05, e.confidenceBand.hi - e.confidenceBand.lo);
    const bh = Math.max(2, span * (h - 4));
    const mid = (e.confidenceBand.lo + e.confidenceBand.hi) / 2;
    const tone = mid < 0.6 ? COLORS.red : mid < 0.8 ? COLORS.amber : COLORS.green;
    page.drawRectangle({
      x: x + i * (barW + 1) + 1,
      y: y + 2,
      width: barW,
      height: bh,
      color: tone,
      opacity: 0.85,
    });
  }
}

function drawScoreHistogram(
  page: PDFPage,
  f: FontSet,
  x: number,
  y: number,
  w: number,
  h: number,
  entries: AuditEntry[],
): void {
  const buckets = [0, 0, 0, 0, 0]; // 0–0.2, 0.2–0.4, 0.4–0.6, 0.6–0.8, 0.8–1
  for (const e of entries) {
    const mid = (e.confidenceBand.lo + e.confidenceBand.hi) / 2;
    const i = Math.min(4, Math.floor(mid * 5));
    buckets[i]! += 1;
  }
  const max = Math.max(...buckets, 1);
  const colW = (w - 8) / 5;
  for (let i = 0; i < 5; i++) {
    const bh = (buckets[i]! / max) * (h - 14);
    const tone = i < 2 ? COLORS.red : i < 4 ? COLORS.amber : COLORS.green;
    page.drawRectangle({
      x: x + 4 + i * colW,
      y,
      width: colW - 4,
      height: bh,
      color: tone,
      opacity: 0.7,
    });
    page.drawText(String(buckets[i]), {
      x: x + 4 + i * colW + colW / 2 - 4,
      y: y + bh + 2,
      size: 8,
      font: f.mono,
      color: COLORS.muted,
    });
    page.drawText(`${(i * 0.2).toFixed(1)}–${((i + 1) * 0.2).toFixed(1)}`, {
      x: x + 4 + i * colW,
      y: y - 9,
      size: 7,
      font: f.regular,
      color: COLORS.muted,
    });
  }
}

function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  fontSize: number,
  lineHeight: number,
  color: RGB,
): number {
  // Naive word-wrap. Handles long lines without mangling the audit
  // trail's verbatim excerpts.
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i]!, {
      x,
      y: y - i * lineHeight,
      size: fontSize,
      font,
      color,
    });
  }
  return lines.length * lineHeight;
}
