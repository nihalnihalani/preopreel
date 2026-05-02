# PreOpReel — Demo Video Shotlist (≤2 minutes, locked)

**Submission date:** 2026-05-02 — Beta Super Hackathon, Computer History Museum
**Submission code:** `butterbase0502` (lowercase) — Promo: `BUTTERBASE0502` (ALL CAPS)
**Format constraint (per handbook):** **No live demos allowed.** Only the
submitted video plays at Demo Day. The recorded MP4 IS the deliverable —
not a backup. Pitch is 3 minutes, video is ≤2 minutes, the remaining 1
minute is for the on-stage talking-head intro of the team and product.

This runbook is the operator-facing recording script. Anyone on the team
should be able to drive the recording from a cold start by reading this
file in order.

---

## T-30 minutes — pre-record checklist

Run these once before pressing record. Each step has a clear go/no-go
signal; if any fails, fix it before recording.

```bash
# 1. Lock to hermetic replay so the on-screen pipeline is deterministic.
./scripts/demo_mode_switch.sh replay
# expect: [ok] DEMO_MODE=replay written to .env.local

# 2. Run the four-invariant check.
npm run check:invariants
# expect: all four green; if Invariant 4 fails, audit-trail PDF will not export

# 3. Verify replay-cache hashes.
python scripts/prewarm_demo.py --verify
# expect: All N fixtures match manifest. (zero red)

# 4. Probe Butterbase.
npm run probe:butterbase
# expect: [PASS] healthz ~80ms / [PASS] forge_runs select_1

# 5. Open the staged tab in Chrome.
#    chrome://newtab → http://localhost:3000/forge?demo=hip-replacement
#    Confirm AnatomyGraphViewer populates within 10s, CriticHud panel opens.
```

If any of (1)–(4) fail, do not record yet. Fix and re-run.

---

## The locked 2-minute shotlist (recorded MP4)

The patient-facing tab is pre-staged at
`http://localhost:3000/forge?demo=hip-replacement` with the
"Synthetic Phantom Demo Case" badge visible top-right (honesty over
theater per Invariant 4).

Use OBS / QuickTime / `./scripts/record_backup_video.sh` to capture
1920×1080 @ 30 fps, screen-only audio off, voiceover off (we narrate over
the recording in post if needed).

| Beat | Time | Recording action | What appears on screen | Fixture surface |
| ---: | --- | --- | --- | --- |
| 1 | **0:00** | Hold on stat card 8s | Stat card: "Surgeons spend 8 minutes per patient explaining a procedure. Patients remember 60 seconds." | static |
| 2 | **0:08** | Click *Try the demo case* | UI screencast — drag becomes auto-load of `plan.pdf` + `patient.json` | `data/fixtures/demo-hip-replacement/` |
| 3 | **0:18** | Pause on AnatomyGraphViewer 10s | JSON tree growing live — Atlas + Gem labels appear over anatomy fields | `02c-gem/anatomy_graph.json` |
| 4 | **0:28** | Click *Watch explainer* (full-screen MP4) | 22-second pre-rendered hip-replacement walkthrough; procedure-step overlays + confidence bands visible | `09-seedance/shot_*.mp4` |
| 5 | **0:50** ★ | Exit full-screen, focus CriticHud | **Lyra Beat-3 reject (0.71) → regen → accept (0.86)** — the Tech-Execution rubric beat | `10-lyra/scores.json` |
| 6 | **1:00** ★ | Click *Open audit trail* | Audit-trail PDF preview — every claim cites §N.M / PMID / Tavi / Exa | `12-render/audit.json` |
| 7 | **1:10** | Scroll to architecture mermaid | 6-agent team mermaid + Z.AI (glm-5.1) + Seedance 2.0 + Seedream 5.0 + Seed Speech 2.0 lineup pill | static |
| 8 | **1:30** | Scroll to vision section | Hip → knee → cardiac → ENT → ophthalmic three-up grid (the wedge from `gtm-moat.md` §2) | static |
| 9 | **1:50** | Closer line + GitHub URL + `#betahacks` | End card with submission code `butterbase0502` and hashtags `#betahacks #betafund #seedance` | static |
| 10 | **2:00** | Stop recording | — | — |

The two ★ beats are the Tech Execution + Audit-Trail rubric play. Practice
transitions 5 → 6 — they read back-to-back and they're the two beats a
casual judge will rewind to verify.

---

## Recording protocol

1. **Two takes minimum.** First for timing, second for cleanups.
2. **No on-screen text not in the demo case.** No browser tab labels,
   no notification banners, no Slack toasts. Use a fresh Chrome profile
   if needed.
3. **No voiceover during recording.** If we want narration, add it in
   post over the silent capture. Mistakes in voiceover = a re-take of
   the whole video.
4. **Keep the cursor visible.** Judges follow the cursor through the
   click chain; an invisible cursor breaks the agentic-action illusion.
5. **End with a 1-second hold** on the end card before stopping. Avoids
   editor-artifact glitching.

---

## On-stage 1-minute talking-head (the other 1:00 of the 3-min pitch)

**No live demo.** Only the video plays. The remaining 1:00 is split:

- **0:00–0:30 — Team intro + problem framing**
  > "I'm \[name]. I'm an orthopedic surgeon \[partner intro]. We spend
  > 8 minutes per pre-op patient explaining a procedure. Patients
  > remember 60 seconds of it. We made those 60 seconds personalized."
- **0:30–0:60 — Architecture + ask**
  > "Two specialized critic agents — Mara catches advice creep before
  > render, Lyra scores anatomical fidelity post-render. Every script
  > claim cites the surgeon's plan or a peer-reviewed protocol. The
  > audit-trail PDF is what gets us past hospital legal review.
  > Day-1-shippable on the BytePlus Seed stack + Z.AI glm-5.1 + Butterbase."

If the talking head goes long, cut the architecture mention — the video
shows it. Never cut the ask.

---

## 60-second rehearsed "what does Mara catch" answer

Reserved in case a judge asks at the post-pitch reception. Practice
twice; aim for 55–65 seconds.

> *"A single LLM produces text and you trust it because nothing's looking
> at it. We have two critics. Mara reads every narrator line **before**
> render and asks one question: did this just cross from explaining the
> surgeon's plan into recommending something the patient should do? Watch
> the warn flag on shot 4 — our narrator said 'you should expect the joint
> to feel different at first.' Mara categorized that as `advice_creep`,
> not `uncited_claim` — the difference matters: the claim is plausibly
> correct, but it's a stance the surgeon didn't assert. So Atlas swaps the
> line. Then Lyra runs **after** render and scores the rendered video
> against the AnatomyGraph. On Beat 3 — the femoral neck osteotomy —
> anatomical fidelity scored 0.71. We have a one-regen budget per beat:
> regenerate, score 0.86, accept. Both events are stored in Butterbase
> and visible in the HUD. A single LLM call has no notion of 'cross from
> explanation into recommendation' and no notion of 'this rendered shot
> drifted from the plan.' Two specialized critics with different
> temperatures, different prompts, and visible reject/regen on tape —
> that's the difference."*

---

## If the recording reveals a bug

The handbook has a 1 PM hard deadline and a 1–2 PM late window. If a
recording uncovers a bug:

1. **Don't try to fix it in code.** Use a different replay fixture if
   one exists, or skip the affected beat by ending the video at 1:50.
2. **Re-record only the affected segment** if possible (frame-perfect
   transitions are not required for hackathon submission).
3. **Submit on time over submit perfect.** A submitted-by-1 PM video
   with a known rough edge beats a perfect video at 1:30 PM.

---

## Submission protocol (post-recording)

After the video is captured to `docs/demo.mp4`:

```bash
# 1. Verify the file (length, fingerprint).
python scripts/verify_backup_video.py docs/demo.mp4
# expect: duration ~115s, fingerprints match docs/demo.fingerprint.json

# 2. Upload to Google Drive / Slides as embedded video.
#    File access MUST be "Anyone can view" per handbook.

# 3. Build the 3-slide deck (Slide 1: Team / Slide 2: Product / Slide 3: Demo).
#    Pull §4 of gtm-moat.md and §1 of seven-day-roadmap.md verbatim.

# 4. Submit via Butterbase MCP.
#    Tool: mcp__butterbase__prep_and_submit_hackathon_entry
#    Submission code: butterbase0502
#    Slot: app_t2cqnk7y4dgk
#    Deadline: 13:00 PT, 2026-05-02 (late window 13:00–14:00, no demo-slot guarantee)
```

---

## Post-submission checklist

- [ ] CHANGELOG.md `## 2026-05-02 — Demo Day` final entry
- [ ] Public hackathon retro post on social (`#betahacks #betafund #seedance`)
- [ ] File 2 GitHub issues against BytePlus per CareReel pattern
  (sponsor-feedback signal)
- [ ] Day-3 review of any judge comments; update `seven-day-roadmap.md`
