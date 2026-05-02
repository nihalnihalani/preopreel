# Beta Super Hackathon — Submission Compliance Checklist

> Every line item below maps to an exact requirement in the
> Participant Handbook. Walk through this once before pressing submit.
> **Submission code:** `butterbase0502` · **Promo:** `BUTTERBASE0502`

## Strict format requirements (handbook §"Submission Instructions")

- [ ] **Exactly 3 slides.** Not 2, not 4. Page setup 16:9. Source: `docs/submission/deck-content.md`.
- [ ] **Video is embedded** in slide 3 — not a hyperlink, not "click here", not a Drive icon. Insert → Video → By URL.
- [ ] **All file access set to "Anyone can view".** Test in incognito browser.
- [ ] **Submitted via Butterbase** with submission code `butterbase0502` (lowercase, exactly).
- [ ] **Submitted before 1:00 PM** today. The 1–2 PM late window is rolling, no demo-slot guarantee.

## Demo video constraints (handbook §"Slide 3 — Demo")

- [ ] **Maximum 2:00.** Trim if longer.
- [ ] **Must show working product.** The full 12-stage flow, not just an architecture diagram.
- [ ] **Hosted publicly.** YouTube unlisted with "Anyone with link" works. So does Google Drive with public-link sharing. **NOT a private link** — the most common reason submissions get rejected is broken video links.
- [ ] **Verified via fingerprint.** Run `python3 scripts/verify_backup_video.py docs/demo-backup.mp4` before upload — frame-hash sample at 0:00 / 0:30 / 0:50 / 1:00 / 1:30 / 1:55.

## Stage requirements (handbook §"Final Demo Day")

- [ ] **One team member present** at the museum. Default: Nihal on stage.
- [ ] **Pitch is 3:00 total.** Use `docs/submission/pitch-3min.md` as the script.
- [ ] **No live demos.** The submitted video is the demo. Do not attempt to run the app on stage.
- [ ] **All slides merged into one master deck** (handbook says organizers do this — they need the deck file in advance via Butterbase submission).

## Required tech stack present (handbook §"Required Tech Stack")

- [x] **Video Generation: Seedance 2.0** — `src/lib/seed/seedance.ts` with image_refs guard.
- [x] **LLM: Z.AI** — `src/lib/zai/client.ts` routes Mara through GLM-4-Plus when `ZAI_API_KEY` is set.
- [x] **Deployment: Butterbase** — `.mcp.json` wires the MCP server with promo `BUTTERBASE0502` + submission `butterbase0502`. Live URL deploys via `npm run bb:migrate` then the Butterbase dashboard.

## Bonus path (handbook §"Best Use of Butterbase: $200 credits")

- [ ] **Built and deployed on Butterbase** — earn bonus points + qualify for $200 Butterbase credits.

## Ancillary prizes

### Long-Term Product Potential ($3K, awarded 2026-05-09)
- [ ] Submit traction package on Day 7 per `docs/post-hackathon-7day-plan.md`.
- [ ] Live URL with real-traffic counter.
- [ ] At least one signed pilot LOI.

### Social Media King ($500–$2K)
- [ ] Post on X/LinkedIn during or immediately after the event with **all three hashtags**: `#betahacks #betafund #seedance`. Post a still image of the CriticHud + the video link.

### Most Creative Product ($2K — selected by ByteFund / Beta Fund / Llama Venture)
- [x] **Best use of LLMs (Z.AI)** — Mara on Z.AI GLM-4-Plus is the live judged path.
- [x] **Best use of video generation (Seedance)** — entire engine is built around Seedance 2.0 + Seedream 5.0 anchoring.
- [x] **Novel product or interaction design** — the live critic-HUD with real reject/regen is a novel agentic-UI pattern.

### Audience Choice ($1K–$2K)
- [ ] Vote yourself when the form opens. Recruit yhinai + charliegillet to vote.

## Codes — verify they appear

These should be visible to a judge skimming the repo:

- [x] `BUTTERBASE0502` (caps, promo) — appears in `.mcp.json`, `.env.example`, `LICENSES.md`, `docs/butterbase-runbook.md`, `CLAUDE.md`.
- [x] `butterbase0502` (lowercase, submission) — appears in `.mcp.json`, `LICENSES.md`, every doc above, README footer, CLAUDE.md.
- [x] **YouTube setup ref** — `https://www.youtube.com/watch?v=SHnryHJL9xc` linked from `docs/butterbase-runbook.md`.

## Wifi / venue (handbook §"Infra & Resources")

- [ ] Connect: SSID `BetaAISuperHackathon` · password `betafund`.
- [ ] Discord: join the official channel + `#butterbase-support`. The handbook hides the actual invite behind a hyperlink — find it from the deck on the projector or ask staff.

## Final pre-submit verification (paste into terminal)

```bash
cd /Users/nihalnihalani/Desktop/Github/preopreel
npx tsc --noEmit                     # 0 errors
npx vitest run                       # all 69+ tests green
npx tsx scripts/check_invariants.ts  # all 4 gates green
git status                           # clean working tree
git push origin main                 # pushed to public repo
```

If any of those fails, do not submit until fixed.
