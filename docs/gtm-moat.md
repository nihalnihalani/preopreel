# PreOpReel — GTM & Moat

**Purpose:** Beta Super Hackathon judges weight *GTM & Moat* at **25%** with the
explicit red flag *"Video AI for everyone"; no moat.* This document is the
artifact that earns the 25%. Slide 2 of the deck pulls its one-liner from §1.

---

## 1. The one-line framing

> **PreOpReel is the surgical-consent video layer for ambulatory surgery centers.**
> A pre-op patient explainer that's personalized to the procedure and the
> patient — generated from the same plan PDF the surgeon already wrote, with
> every claim cited back to that plan or a peer-reviewed protocol.

We are **not** a horizontal "video AI for everyone." We are pre-operative
patient education for one specialty at a time, starting with **orthopedic
joint replacement**.

---

## 2. The wedge — orthopedic joint replacement, not "all of healthcare"

We pick **total hip and knee replacement** as the wedge for four reasons that
compound:

| Why ortho first | What it gives us |
| --- | --- |
| **High procedural volume** | ~1.5M total joint replacements/yr in the US (CMS, 2024). One implementable procedure type yields enough patient-flow to test retention. |
| **Standardized protocols** | AAOS publishes posterior-approach and direct-anterior protocols as PMID-citable references. Every claim Atlas drafts has a real source. |
| **Bundled-payment alignment** | CJR / BPCI bundles incentivize ASCs to reduce 30-day readmissions; a patient who *understands* the procedure follows the post-op weight-bearing plan. The buyer has a P&L reason to deploy us. |
| **Outpatient-shift tailwind** | CMS removed total knee from the inpatient-only list in 2018 and total hip in 2020. Volume is migrating from hospital to ASC, where the surgeon owns the consent conversation and the time-savings of automated explainers compounds. |

After ortho lands, the same engine ships next for **cardiac catheterization**,
then **ENT (ear/nose/throat)**, then **ophthalmic** (cataract, LASIK). Same
12-stage pipeline, different `AnatomyGraph` schemas and persona prompts. See
`docs/seven-day-roadmap.md` for sequencing.

---

## 3. Why this is a moat, not a feature

A horizontal "video AI" startup will replicate the surface in a weekend. Our
moat is in three layers that take time + domain access to build:

### 3.1 The audit trail (Invariant 4)

Every script claim cites either (a) a numbered §N.M of the surgeon's procedure
plan PDF, (b) a Tavi-cached PMID, or (c) a curated entry in
`data/surgical-protocols-references.json`. The receipt PDF that exports with
every video is the artifact that gets us past the hospital legal review. A
horizontal generator can't produce this — they don't have the citation graph.

### 3.2 The vision critic (Invariant 1)

Lyra (post-render) scores anatomical fidelity, procedure-step compliance, and
on-screen-text violations against the `AnatomyGraph`. Mara (pre-render)
catches advice creep — every line that crosses from *explaining* into
*recommending*. **Without these gates, a video AI is a regulated medical
device.** We are an informed-consent communication tool. The gates are the
positioning.

A competitor who omits the critic loop ships a product that requires FDA
Class II review. We don't. That's a 12-18 month head start, structurally.

### 3.3 The procedure library

Each new procedure type ships with a typed `AnatomyGraph` schema, a curated
PMID corpus, and a persona-prompt set. Hip + knee + cardiac + ENT +
ophthalmic = ~70% of US ambulatory surgery volume. The library is the
defensible asset; building it requires surgeon partners willing to
contribute plan templates, which requires distribution that requires the
library. Two-sided cold-start, but once we land 5 ASCs, the rest follow.

---

## 4. Who buys

**Primary buyer:** Ambulatory Surgery Center (ASC) administrators in
ortho-heavy markets. Decision criteria: 30-day readmission rate (CMS bundled
payments), patient-experience scores (HCAHPS), and consent-form completion
rate.

**Secondary buyer:** Specialty hospital systems with ortho service lines —
HSS, Rothman, OrthoCarolina. They already produce in-house patient
education; we replace a $200k/year video production line with a $30k/year
SaaS subscription.

**Champion inside the buyer:** the patient-experience director or the
chief medical officer's office. The pain point they own is "patients arrive
unprepared, ask the same five questions in pre-op holding, slow throughput."

**Pricing wedge:** $1,200/mo per surgeon, capped at $20k/mo per ASC.
Reference: typical patient-education seat licenses run $40-80/mo per
provider; we sit above that because a personalized video has unit economics
that scale with patient volume, not with seat count. At a 6-surgeon ASC
running 30 cases/wk, the per-explainer cost is ~$10 — comparable to a
printed booklet, but the booklet doesn't cite §3.2 of the surgeon's plan.

---

## 5. Distribution — how the first 5 ASCs sign

Order of moves (post-hackathon):

1. **Two design partner ASCs in week 1–2** — leverage the founder's surgeon
   network (partner is a board-certified orthopedic surgeon — see Slide 1).
   No payment; we build their procedure library in exchange for written
   feedback + a permission to use them as a logo.
2. **Patient-outcome study, weeks 3–8** — partner ASCs run the explainer for
   one arm (every other patient) and track HCAHPS + consent-completion-rate
   deltas. We ship the study writeup as a one-pager.
3. **Outbound to 50 ASCs in ortho-heavy MSAs (Phoenix, Dallas, Tampa)** —
   the writeup + the 30-day readmission story is the cold email. Conversion
   target: 5/50 = 10% sign onto a 30-day pilot.
4. **HSS / Rothman / OrthoCarolina** — direct intro from the hackathon
   network, weeks 8–12.

By month 4 we want **8 paying ASCs at $5k/mo MRR each = $40k MRR**, which
funds the next two procedure libraries (cardiac cath + ENT) and is the
entry shape for a seed round.

---

## 6. The "Why now" line for the deck

> **CMS just moved total joint replacement out of inpatient-only billing.
> Volume migrated to ambulatory surgery centers — where the surgeon owns
> the consent conversation, the patient is awake the morning of the
> procedure, and patient understanding directly affects the 30-day
> readmission penalty.**
>
> Generic patient-education videos can't be cited back to the surgeon's
> specific plan. PreOpReel can. The hospital legal review they require —
> we already pass it, because every claim has a citation pointer.

---

## 7. What we will NOT build

- **Generic patient-education content.** No diabetes-101, no
  what-is-anesthesia explainers. Only specific procedures with surgeon
  plans and curated protocol corpora.
- **A medical-advice product.** Mara's veto enforces this; the company-
  shape would be a regulated medical device.
- **A multi-language sprint in month 1.** Spanish translation matters
  long-term but adds two more weeks of voice / grading work per locale.
  Ship US English, charge a premium, layer Spanish in month 4.
- **A telehealth integration.** That's a different product category and
  different buyer; would dilute the wedge.

---

## 8. Competitive landscape

| Who | What they do | Why we win |
| --- | --- | --- |
| **YouTube health channels** (e.g. Howcast, BMJ Best Practice) | Generic explainers | Not personalized to *this* patient or *this* surgeon's plan. |
| **In-hospital video production** (HSS, Mayo) | Bespoke per-procedure video | $5–25k per procedure type; not personalized per-patient; takes 6 months to produce. |
| **Static PDFs** (the current default) | Printed booklets in pre-op packet | 38% of US adults read below 6th-grade level; static PDFs leave them behind. Our explainers are 6th-grade reading level by Mara constraint. |
| **Generic LLM patient chat** (Hippocratic AI, K Health) | Chat about general health | No procedural plan context; doesn't survive hospital legal review without citations. |
| **A future "video AI for everyone" startup** | Horizontal patient-explainer SaaS | We have a 5-procedure library, a critic loop they'd have to rebuild, and a citation graph they don't have. |

---

## 9. The two-line ask

For the hackathon: **a 1st-place finish funds 2 design partner ASCs through
month 4. A "Most Creative Product" win funds the cardiac procedure library
in month 5.** We don't need a seed round to keep building — we need
distribution feedback from 2 surgeons who'll let us cite their plans.
