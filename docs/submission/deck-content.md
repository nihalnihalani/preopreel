# PreOpReel — Submission Deck Content

> **Beta Super Hackathon · Computer History Museum · 2026-05-02**
> **Submission code: `butterbase0502`** · **Promo: `BUTTERBASE0502`**
>
> Paste the markdown for each slide directly into Google Slides. The
> handbook is strict: **exactly 3 slides**, video embedded (not a broken
> link), file access set to **"Anyone can view"**. Non-compliant
> submissions may not be reviewed.

---

## Slide 1 — Team Introduction

**Title (top, large):** *PreOpReel — The 90-second pre-op explainer your surgeon never had time to make.*

**Three columns / three cards. One per teammate. Photo on top, text below.**

### Nihal Nihalani — Founder
- Cornell-CS · AI agents + dev tools + SRE expertise
- Currently shipping AI agents at scale; pursuing O-1A
- **Team-problem fit:** has spent two years building meta-agentic pipelines (Understudy, Telestudio); the critic-loop pattern in PreOpReel is a direct port from that work

### yhinai (collaborator) — Builder
- Co-builder · GitHub: github.com/yhinai
- Deep stack across vision pipelines + Postgres
- **Team-problem fit:** owns the 12-stage worker; built the Lyra vision-critic loop that turns 0.71 into 0.86 on stage

### charliegillet (collaborator) — Builder
- Co-builder · GitHub: github.com/charliegillet
- Frontend systems + ML interaction design
- **Team-problem fit:** owns the CriticHud — the rubric play. Designed the live reject/regen choreography judges see at 0:50–1:00 of the demo

**Footer (small):** *Built on BytePlus Seed 2.0 · Seedream 5.0 · Seedance 2.0 · Seed Speech 2.0 · Z.AI · Butterbase. Submission `butterbase0502`.*

---

## Slide 2 — Product Overview

**One-line description (top, biggest text):**
*"Drop a procedure plan PDF. 90 seconds later, your patient watches a personalized, audit-trailed, anatomically-grounded explainer."*

**Layout: two columns.**

### Left column — The problem (3 bullets)
- **38% of US adults read below a 6th-grade level.** Consent forms read at 12th grade.
- **Patients forget 40–80% of medical info immediately after the consultation.**
- **Inadequate-consent malpractice claims average $580K per settlement** (ProAssurance, 2024).
- The state of the art today is a printed PDF, a YouTube link, or a 5-minute hallway conversation. **No one personalizes per patient.**

### Right column — Our solution (3 bullets)
- **6-agent team** drafts → critiques → renders → re-critiques the explainer. The judged path runs **Atlas (Seed 2.0 Pro)** as Director and **Mara (Z.AI / GLM-4-Plus)** as the Devil's Advocate — *different model families disagreeing*, which is what a critic is for.
- **Tier-0 Seedream anchoring** before every Seedance call → no anatomical hallucination. **Lyra vision-critic** scores every shot post-render and triggers a regen budget when below threshold. Judges see this happen on screen at 0:50–1:00.
- **Audit-trail PDF** — every script claim cites procedure-plan §2.3 or PMID. Communication tool, not a medical device.

**Below the columns — one screenshot of the CriticHud + audit PDF preview side by side.** (Use a screen-grab from the running app at `/forge?demo=hip-replacement` showing Mara's advice-creep flag on the left and Lyra's Beat-3 reject/regen on the right.)

**Footer (small):** *Buyer: surgical malpractice carriers (TAM ~$4B/yr). Wedge: $99 per explainer vs. $5K–$25K bespoke. Built and deployed on Butterbase — submission `butterbase0502`.*

---

## Slide 3 — Demo

**Title:** *Live demo (pre-rendered) — 2 minutes*

**Body — embed the demo video. ⚠ The handbook is strict here: video must be EMBEDDED, not a hyperlink. Set the slide to play the video on click; set sharing to "Anyone with the link can view".**

**Suggested host:** YouTube unlisted with "Anyone with the link" + embedded via Insert → Video → By URL. Backup host: Google Drive with public-link sharing.

**Caption under the video (small, one line):**
*"This is the synthetic-phantom hip-replacement demo. The CriticHud at 0:50 is reading real Redis writes from the actual ForgeRun — no animation theater. Beat 3 is deliberately scored 0.71 on first attempt to show Lyra reject + regen. Audit-trail PDF exports at 1:00."*

**Footer (small):** *Public repo: https://github.com/nihalnihalani/preopreel · Live URL: (insert Butterbase deploy URL once live) · Submission `butterbase0502`.*

---

## Submission checklist (handbook §"Submission Checklist")

- [ ] Exactly 3 slides — no extras (page setup: 16:9 widescreen)
- [ ] Video embedded, not a link — test the embed by viewing in incognito
- [ ] Slide deck file access set to **"Anyone can view"** (Share → General → Anyone with the link → Viewer)
- [ ] Demo video access set to **"Anyone can view"** (YouTube: Visibility → Unlisted; or Drive → Anyone with the link)
- [ ] Submitted via Butterbase before **1:00 PM** (rolling late window 1–2 PM, no demo-slot guarantee)
- [ ] Submission code field: `butterbase0502` (lowercase, exactly)

## What you still need to fill in by 1:00 PM

- [ ] Three teammate photos (slide 1)
- [ ] Live Butterbase deploy URL (slide 2 footer + slide 3 footer)
- [ ] Recorded 2-min demo video URL (slide 3)
- [ ] Repo flipped to public so the slide-3 link works for judges
