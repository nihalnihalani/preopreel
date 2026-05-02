# PreOpReel — Demo Runbook (2 minutes, locked)

**Stage date:** 2026-05-02 — Computer History Museum, Mountain View
**Submission code:** `butterbase0502` (lowercase) — Promo: `BUTTERBASE0502` (ALL CAPS)
**Owner during stage:** Demo Ops Dev (operator) + Lead (presenter)
**Default DEMO_MODE on stage:** `replay` (hermetic — Mara F.3)

This runbook is operator-facing. It exists so a non-author teammate can drive
the demo from a cold start without reading the master plan during a live demo.

---

## T-1h — Pre-stage (in venue, lights up)

Run these in order. Each step has a clear go/no-go signal.

```bash
# 1. Lock the demo to hermetic replay (the only stage path).
./scripts/demo_mode_switch.sh replay
# expect: [ok] DEMO_MODE=replay written to .env.local

# 2. Run the four-invariant check.
npm run check:invariants
# expect: all four green; if Invariant 4 fails, audit-trail PDF will not export

# 3. Probe Butterbase auth (Mara B.5 mitigation).
npm run probe:butterbase
# expect: [PASS] healthz  ~80ms / [PASS] pg.select_1_from_forge_runs ~120ms

# 4. Verify the prewarmed cache hashes (Invariant 3).
python scripts/prewarm_demo.py --verify
# expect: All N fixtures match manifest. (zero red)

# 5. Open the staged tab.
#    chrome://newtab → http://localhost:3000/forge?demo=hip-replacement
#    Confirm AnatomyGraphViewer populates within 10s, CriticHud panel opens.
```

If any of (1)-(4) fail, **do not switch to live**. Use the backup video plan
(see Recovery Moves below).

---

## Stage opening — the locked 2 minutes

Default tab is pre-staged: `http://localhost:3000/forge?demo=hip-replacement`.
The "Synthetic Phantom Demo Case" badge is visible top-right (honesty > theater).

| Beat | Time | What the operator does | What the audience sees | Fixture surface |
| ---: | --- | --- | --- | --- |
| 1 | **0:00** | Speak the hook line ("Surgeons spend 8 minutes per patient explaining a procedure. Patients remember 60 seconds.") | Stat card | none |
| 2 | **0:08** | Click *Try the demo case* | UI screencast — drag becomes auto-load of `plan.pdf` + `patient.json` | `data/fixtures/demo-hip-replacement/` |
| 3 | **0:18** | Point at the AnatomyGraphViewer | JSON tree growing live — Atlas + Gem labels appear over anatomy fields | `02c-gem/anatomy_graph.json` |
| 4 | **0:28** | Click *Watch explainer* (full-screen MP4) | 22-second pre-rendered hip-replacement walkthrough; procedure-step overlays + confidence bands visible | `09-seedance/shot_*.mp4` |
| 5 | **0:50** ★ | Exit full-screen, focus CriticHud | **Lyra Beat-3 reject (0.71) → regen → accept (0.86)** — the Invariant-1 wow moment | `10-lyra/scores.json` |
| 6 | **1:00** ★ | Click *Open audit trail* | Audit-trail PDF preview — every claim cites §N.M / PMID / Tavi / Exa | `12-render/audit.json` |
| 7 | **1:10** | Scroll to architecture mermaid | 6-agent team mermaid + Seed lineup pill (Seed 2.0 + Seedream 5.0 + Seedance 2.0 + Seed Speech 2.0) | static |
| 8 | **1:30** | Scroll to vision section | hip → knee → cardiac → ENT → ophthalmic three-up grid | static |
| 9 | **1:50** | Closer line + GitHub URL | End card | static |
| 10 | **2:00** | Stop | — | — |

The two ★ beats are the rubric play. Practice transitions 5 → 6 — they read
back-to-back.

---

## 60-second rehearsed answer to "What does Mara catch that a single LLM call wouldn't?"

> *"A single LLM produces text and you trust it because nothing's looking at it.
> We have two critics. Mara reads every narrator line **before** render and asks
> a single question: did this just cross from explaining the surgeon's plan into
> recommending something the patient should do? Watch the warn flag on shot_4 —
> our narrator said 'you should expect the joint to feel different at first.'
> Mara categorized that as `advice_creep`, not `uncited_claim` — the difference
> matters: the claim is plausibly correct, but it's a stance the surgeon didn't
> assert. So Atlas swaps the line. Then Lyra runs **after** render and scores
> the rendered video against the AnatomyGraph. On Beat 3 — the femoral neck
> osteotomy — anatomical fidelity scored 0.71. We have a one-regen budget per
> beat: regenerate, score 0.86, accept. Both events are stored in Butterbase
> and visible in the HUD. A single LLM call has no notion of 'cross from
> explanation into recommendation' and no notion of 'this rendered shot drifted
> from the plan.' Two specialized critics with different temperatures, different
> prompts, and visible reject/regen on stage — that's the difference."*

Practice this twice before stage. Aim for 55-65 seconds.

---

## Recovery Moves (when something goes wrong)

| Failure mode | Likelihood | Recovery |
| --- | --- | --- |
| **Wi-Fi dies on stage** | low (we are in replay) | No-op — replay is hermetic. Keep going. |
| **Butterbase down** | low | Page already in Phantom mode (HUD reads from local fixtures, not realtime). Continue. |
| **HUD freezes mid-render** | moderate (Mara B.7) | The page has a heartbeat ("reconnecting…" badge). If frozen >5s, operator cmd-R reload during a transition beat (between 1:30 and 1:50 is least bad). |
| **Mara approves everything (no warn flag)** | low — but if it happens | POST `/api/forge/{id}/regen` for `shot_4` to force the warn re-emit; CriticHud picks it up via Butterbase realtime. |
| **Live MP4 won't full-screen** | low | Backup file path — open `docs/demo-backup.mp4` from OS preview; one keystroke fallback. |
| **Total stage failure** | last resort | **Backup video at `docs/demo-backup.mp4`** is the floor. Pre-validated by `scripts/verify_backup_video.py` against `docs/demo-backup.fingerprint.json` (Mara B.9). |

The backup video should already be open in OS preview in a hidden Spaces desktop.
One Mission Control swipe brings it on screen.

---

## T-0 post-demo (immediate, before leaving stage)

1. Note any judge questions for the post-mortem.
2. **File 2 BytePlus issues** per Mara G recommendation — track candidates in
   `docs/sponsor-feedback.md`. Real friction we hit, real fixes we'd want.
3. **Submit the project** with code `butterbase0502` (lowercase) in the
   Butterbase Settings → Project Metadata → Submission Code field.
4. Update `CHANGELOG.md` with the `## 2026-05-02 — Demo Day` final entry.
