# PreOpReel — 3-Minute Stage Pitch

> Beta Super Hackathon final demo day format (handbook §"Final Demo Day"):
> **3 minutes total per team · No live demos · Only submitted video will be used.**
> The video is the demo; we narrate around it.

The two-minute demo video plays from second 0:30 to 2:30 of our slot. The
30 seconds before and the 30 seconds after are spoken on stage by one
teammate (no Q&A during pitch).

---

## 0:00–0:15 — Hook

> **"38% of US adults read below a 6th-grade level. Inadequate-consent malpractice claims average $580,000 per settlement. The state of the art is a YouTube video and a hallway conversation. We made the 90-second personalized explainer your surgeon never had time to record."**

(Slide 1 visible — team intro.)

---

## 0:15–0:30 — Team-problem fit (one breath)

> **"Three of us. I've spent two years building meta-agentic AI pipelines. yhinai owns the 12-stage worker. charliegillet owns the live critic HUD you're about to see. Today we're showing the surgical pre-op vertical — but the engine is general."**

(Click to slide 2 — product overview — at exactly 0:30.)

---

## 0:30–2:30 — Demo video (2:00 sharp)

The video plays. Narrate over the natural breaks (the audio is clinical
narration; voice over the silences between beats). **DO NOT** narrate
over Mara's flagged critique line at 0:50 or Lyra's reject/regen at 0:55
— those should land on their own.

**0:30 — drag plan PDF** *(silent — let the screencast play)*

**0:40 — when the AnatomyGraphViewer starts streaming:**
> *"Atlas — our Director persona on Seed 2.0 Pro — drafts a script. Gem extracts anatomical landmarks with confidence bands."*

**0:50 — when Mara's advice_creep flag appears on the left of the HUD:**
> *"This is Mara — Devil's Advocate, running on Z.AI GLM-4-Plus. Different model family from the Director. She catches the line where Atlas crossed from explaining to recommending."*

**0:55 — when Lyra's Beat-3 score hits 0.71:**
> *"Lyra is the post-render vision critic. Beat 3 just failed at 0.71 anatomical fidelity. Watch the regen."*

**1:00 — when Beat 3 re-renders at 0.86:**
> *"0.86. We accept. The audit trail just exported."*

**1:00–1:30 — slide 2 architecture mermaid plays in the video:**
> *"12 stages, 6 agents, two critics, fully signed audit trail. Every Seedance call is anchored to a Seedream keyframe — no naked T2V. Every claim cites the procedure plan or a PMID."*

**1:30–2:00 — vision tile (hip → knee → cardiac → ENT):**
> *"Same engine, four verticals. We've already pre-built the AnatomyGraph schema for knee. Cardiac and ENT are persona prompt swaps."*

**2:00–2:30 — end card:** *(silent)*

---

## 2:30–3:00 — Continuity + close

> **"Buyer is the malpractice carrier. ProAssurance, MedPro, The Doctors Company write $4B in surgical premiums a year. Even 0.1% of premium reallocated to consent comms is $4M ARR.**
>
> **"Our 7-day plan is committed: live deploy tomorrow, real surgeon onboarded by Wednesday, three-vertical proof by Friday. The repo is public — `github.com/nihalnihalani/preopreel`. Submission code `butterbase0502`. Built on Butterbase. Thank you."**

(End — total 3:00.)

---

## What we cut from the original 2-minute plan

The handbook said the *deck* gets a 3-min slot but the demo video is *exactly* 2 min embedded. So we lose:
- The "Cost HUD" beat (Mara F.2 — was already cut)
- The OmniHuman surgeon-greeting beat (Mara F.1 — already cut)
- The wall-of-10-agents closer (was the original 2:15–2:55 beat — now compressed into "4 verticals" at 1:30)

What we **kept from the locked 2-min demo** and is now in the embedded video:
- 0:00–0:08 hook stat card
- 0:08–0:18 upload screencast
- 0:18–0:28 AnatomyGraphViewer streaming
- 0:28–0:50 pre-rendered explainer MP4
- 0:50–1:00 ★ critic-HUD reject/regen (the rubric play)
- 1:00–1:10 audit PDF export
- 1:10–1:30 architecture mermaid
- 1:30–1:50 four-vertical grid (was three; bumped to four for handbook tracks)
- 1:50–2:00 tagline + GitHub URL

---

## Recovery moves on stage

The handbook says **only submitted video will be used** — there is no live
demo. So normal "Wi-Fi died" fallbacks don't apply. The risks shift to:

| Risk | Mitigation |
| --- | --- |
| Submitted video has a glitch | The `record_backup_video.sh` produces `docs/demo-backup.mp4` AND `docs/demo-backup.fingerprint.json`. Submitted version is verified by `verify_backup_video.py` against the fingerprint. We submit the verified copy. |
| Slide deck won't open on the venue projector | Bring a copy as PDF on a USB stick + on the laptop. Test on Demo Day morning during the 9–9:30 check-in window. |
| One teammate not present | Handbook says **at least one** must be present. Designate Nihal as on-stage presenter; yhinai + charliegillet on Discord backup. |
| Pitch runs over 3:00 | Cue card on the front of the laptop screen with **0:30 / 1:00 / 2:30 / 3:00** time targets. Hard stop at 3:00 — the next team is called. |

---

## Submission attribution

This pitch ends at 3:00 sharp. The submission code `butterbase0502`
(lowercase) is on the slide-1 footer, slide-2 footer, slide-3 footer,
in the README, in the CLAUDE.md, in the `.mcp.json`, and on every page
of the audit-trail PDF.
