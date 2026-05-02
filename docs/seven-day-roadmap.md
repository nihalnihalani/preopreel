# PreOpReel — 7-Day Iteration Plan (Post-Hackathon)

**Purpose:** the Beta Super Hackathon rubric weights *Continuity* at **20%**
with the explicit red flag *"Throwaway hacks; no roadmap."* This document
is the artifact that earns the 20%. Slide 3 of the deck pulls its talking
points from §1.

**Time horizon:** May 2 (demo day) → May 9 (week-1 end). After the
hackathon ends, this is what ships in the first 7 days, in order.

---

## 1. The week-one hill

> **Land 2 design partner ASCs and produce 1 personalized explainer end-to-end
> against a real surgeon's procedure plan, with the receipt PDF passing the
> ASC's legal review.**

That single outcome:
- Validates the audit-trail (Invariant 4) against a real legal team.
- Produces the case study we use for outbound from week 2.
- Forces the bug surface that demo-mode-replay hides.

Everything below is in service of that hill.

---

## 2. The day-by-day

### Day 1 — May 3 (Saturday)

| | What ships | Owner | Why |
| --- | --- | --- | --- |
| AM | **Patient-outcome study writeup template** — empty, ready to fill | Lead | Need a deliverable for design-partner pitch on Mon |
| AM | **Two warm intros to ortho-surgeon network** (founder's contacts) | Lead | Pipeline for §3 design-partner work |
| PM | **Live mode burn-in** — run prewarm against actual Z.AI + Seedance | Vision | Replay-mode hides 80% of integration bugs; week 1 needs live |
| PM | **Cost trace** — record per-stage Z.AI + Seedance + Butterbase spend | Vision | Pricing wedge in `gtm-moat.md` §4 needs real numbers |

### Day 2 — May 4 (Sunday)

| | What ships | Owner | Why |
| --- | --- | --- | --- |
| AM | **Knee replacement procedure plan** (synthetic, AAOS-cited) | Schema | Second procedure type unblocks the "library" pitch |
| AM | **`AnatomyGraph` knee variant** — Zod schema + 6 landmark fixtures | Schema | Same engine, different procedure proves the moat |
| PM | **Receipt PDF — render against knee case end-to-end** | Schema | Validates audit-trail across procedure types |
| PM | **Demo video v2** — record knee + hip side-by-side | Frontend | Concrete artifact for design-partner email |

### Day 3 — May 5 (Monday)

| | What ships | Owner | Why |
| --- | --- | --- | --- |
| AM | **Outbound email v1 to 5 ortho-network surgeons** | Lead | Open the design-partner top-of-funnel |
| AM | **Live `apps/web` deploy on Butterbase** (`https://preopreel.butterbase.dev`) | Frontend | Sharable URL for the outreach email |
| PM | **HCAHPS-comparable patient-survey design** | Lead | Needed before any design-partner runs the study |
| PM | **First design-partner discovery call** | Lead | Validate problem before building deeper |

### Day 4 — May 6 (Tuesday)

| | What ships | Owner | Why |
| --- | --- | --- | --- |
| AM | **Cardiac-cath stub procedure plan** (3rd procedure) | Schema | Three procedures = "this isn't a hip-replacement toy" |
| AM | **`AnatomyGraph` cardiac variant** | Schema | Same |
| PM | **Live render in cardiac-cath replay** — Lyra scores honest numbers | Vision | Cardiac is where anatomical hallucination is most dangerous; force the test |
| PM | **Second discovery call** | Lead | Move funnel |

### Day 5 — May 7 (Wednesday)

| | What ships | Owner | Why |
| --- | --- | --- | --- |
| AM | **Demo-partner #1 onboarded** — they upload their first procedure plan PDF | Lead + Schema | The week-one hill; if no partner Wed AM, we re-prioritize Thu/Fri to outbound |
| PM | **Plan-PDF parser hardening** — bug-fix on whatever the real surgeon's plan breaks | Schema | The real PDFs are messier than the synthetic phantom |
| PM | **Compliance review prep** — receipt PDF reviewed against ASC legal checklist | Lead | Block on this for billing |

### Day 6 — May 8 (Thursday)

| | What ships | Owner | Why |
| --- | --- | --- | --- |
| AM | **First real-patient-data explainer rendered** (HIPAA-compliant; design partner's actual plan) | All | The week-one milestone |
| PM | **Surgeon walks through the explainer with us** — qualitative feedback | Lead | What does Mara *not* catch that the surgeon catches? |
| PM | **Bug fixes from the walkthrough** | Personas | Mara's category enum likely needs an extension |

### Day 7 — May 9 (Friday)

| | What ships | Owner | Why |
| --- | --- | --- | --- |
| AM | **Patient-outcome study writeup v0** — n=1, qualitative | Lead | The hill |
| AM | **Demo-partner #2 onboarded** | Lead | Second case unlocks the writeup template |
| PM | **Outbound email v2** — case study attached, sent to next 25 ASCs | Lead | Week-2 funnel |
| PM | **Public retro post** — what we learned, what surprised us | Lead | Hashtag `#betahacks` per handbook social-prize rules |

---

## 3. Week-2 north star (preview)

End of week 2 (May 16):
- 2 design partners running the explainer in their pre-op clinic
- 5 explainers rendered against real plans (mix of hip/knee/cardiac)
- 25-cold outbound email funnel with 2 reply-yes scheduled discovery calls
- $0 paid; all relationship-driven

Month-1 milestone (May 30):
- 1 design partner converted to paid pilot at $5k/mo
- 3 procedure types live (hip + knee + cardiac)
- HCAHPS delta data on 50+ patient-equivalents

---

## 4. Cuts (we will *not* do these in week 1)

These are the throwaway-hack temptations we explicitly reject:

| Cut | Why |
| --- | --- |
| **Spanish translation** | Cardiac cath procedure library has more leverage; defer Spanish to month 3 |
| **Mobile responsive polish** | Patient watches on a tablet in pre-op holding; mobile is week-3 |
| **Auth + multi-tenancy** | Two design partners run on shared instance; auth is week-2 if we sign a 3rd |
| **OmniHuman surgeon greeting** | Was Layer-2 in the hackathon; uncanny risk in production is too high |
| **A web-form for surgeons to upload** | Email + Butterbase Storage upload-URL is fine for n=2 partners |

---

## 5. The runway math

We don't need a seed round in week 1. Two design partners on $0 + a personal
ARK key + a $20 Butterbase promo credit = enough to validate the
GTM hypothesis. Burn after that:

| Cost line | Estimate |
| --- | --- |
| Z.AI tokens | ~$80/mo at 10 explainers/wk |
| Seedance video | ~$200/mo |
| Butterbase | $20 (first month free w/ promo) → $50/mo |
| Domain + Vercel | $30/mo |
| **Total** | **~$300/mo** through week 4 |

Any "yes" from a design partner who pays $5k/mo flips this from
self-funded to break-even. That's the runway shape.

---

## 6. What we tell judges in the deck

> *"Week 1 we land two design partner ASCs and produce one personalized
> explainer end-to-end against a real surgeon's procedure plan, with the
> receipt PDF passing the ASC's legal review. Week 4 we have three
> procedure types live and one paying pilot. Month 6 we hit $40k MRR
> across 8 ASCs and start the seed round. Continuity isn't a vibe —
> it's the day-by-day on the next page."*

---

## 7. Living document discipline

This file is updated in two cases:

1. **End of every day** — what shipped vs. plan, in the
   `## YYYY-MM-DD — Day N` style of `CHANGELOG.md`. If a milestone
   slipped, write down why.
2. **End of every week** — re-baseline the next 7 days against what
   shipped. Slip ≠ failure; pretending it didn't happen ≠ continuity.

If this file is more than 7 days stale, the team is no longer
practicing continuity, and the rubric red flag has come true.
