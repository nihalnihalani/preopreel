# 06 — Mara: Devil's Advocate Critique

> Author: Mara (Devil's Advocate persona, plan-only).
> Audience: Atlas (merging the team plans), Lyra, Vision+Synthesis, Schema+Personas, Frontend+Demo, Butterbase.
> Status: critique only. I do not propose fixes for everything; the team mitigates.
> Demo day: 2026-05-02, ~12 hours from this writing.

This document anticipates the worst failure modes of PreOpReel as designed and surfaces every assumption that could blow up on stage. It is intentionally surgical and unfriendly. If it reads like a release blocker, that is the point — better to land here than at the venue.

---

## Section A — The Critic Loop Itself

The pitch hinges on the critic loop being **real, visible, and load-bearing**. Here is where the credibility breaks.

### A.1 — What if Mara approves everything?

Ten known-bad scripts at boot is **insufficient**. The 10 are coverage of the *named* categories (`advice_creep`, `uncited_claim`, `ambiguity`, `scope_creep`, `anatomical_invention`) — at best two examples per category. That is not a critic; that is a regex with a fancier syntax tree.

Categories that will slip through:

- **Subjunctive advice** — "many patients find it helpful to…" parses as a description of a population, not a recommendation, but it functionally instructs. None of the 10 known-bad starts cover this.
- **Compressed conditional advice** — "if you smoke, expect a slower recovery" is an implicit recommendation to stop smoking. Not in the few-shot.
- **Comparative framing** — "the posterior approach has fewer dislocations than the anterior" is a clinical claim presented as neutral comparison; in informed-consent contexts it nudges. Not in the few-shot.
- **Reassurance creep** — "this is a very routine procedure" is a confidence assertion with no citation. Will pass `uncited_claim` if Mara only checks for absence of plan-section refs, not presence of stance.
- **Anatomical hedging that sounds factual** — "the femoral artery typically runs lateral to the nerve" — "typically" is a citation-shaped fig leaf. Mara cannot tell.
- **Tense slippage** — Director writes future tense ("the surgeon will…") but a beat slides into imperative ("breathe slowly during induction"). Imperative directed at the patient is advice. Not in the few-shot.
- **Procedure-step omission** — Mara is checking what *is* in the script for advice; she has no test for what is *missing*. A walkthrough that skips the "you'll feel pressure during reaming" beat is just as much a consent failure as one that recommends.
- **ESL narrator drift** — see D.2.
- **Cultural / religious pre-op constraints** — "remove all jewelry" reads neutral but ignores that some patients cannot remove certain items for religious reasons. No few-shot for this.

**Atlas+Mara groupthink risk:** both run Seed 2.0 Pro with the same base model, same provider region, same training distribution. Mara's "different system prompt" is a stylistic mask, not a different epistemology. When Atlas hallucinates an anatomical structure, Mara is statistically likely to find that structure plausible. The classic adversarial-pair failure mode: the critic shares the generator's blind spots.

The mitigation that will be missing: there is no **negative-control test** in the build plan that proves Mara catches things Atlas alone wouldn't. The "Mara catches more than a single LLM" claim (A.4) is currently un-evidenced.

### A.2 — What if Lyra rejects everything?

The math is brittle. Six beats × `min(scores) < 0.75` decision rule × 1 regen budget. If Seedance is having a bad day (thermal throttling on ModelArk, model-version swap mid-day, region shift), and 4/6 beats fail Lyra:

- Beat 1: fail @ 0.71 → regen → fail @ 0.69 → **accept @ 0.69, surface honestly**
- Beat 3: fail @ 0.62 → regen → accept @ 0.81 → ok
- Beat 4: fail @ 0.70 → regen → accept @ 0.78 → ok
- Beat 5: fail @ 0.55 → regen → fail @ 0.58 → **accept @ 0.58, surface honestly**

On-stage outcome: **the explainer plays with two beats stamped 0.69 and 0.58 in the HUD, while the narrator is voicing "this is the rendered shot of your femoral head"**. Two of six beats below threshold is not "honesty over theater" — it is "the product visibly failed during the moment we claim is the rubric play."

The README (§3.3) frames this as a feature: "we *show* uncertainty rather than hide it." That works at 0.78. It does not work at 0.58. There is **no defined floor below which the team cuts to a still image instead of accepting**. Without a floor, Lyra rejecting everything produces a public, repeated 0.58 in front of judges.

Worse: the demo case is pre-warmed via replay, so the in-stage Lyra reject/regen is *scripted* (the replay fixture has known scores). If the team has not also decided what happens in `live` and `hybrid` mode, the floor question is unanswered for any deviation from the canonical replay path.

The 1-regen budget is also under-justified. Why 1? Cost? Time? Both? At demo time we are in `replay`, so cost is zero. The budget exists for live runs — but the live floor is what we just identified as undefined. The two issues compound.

### A.3 — What if the critic HUD is just animated theater?

The README §3.5 makes a strong claim: the HUD reads real Redis writes (`pre:critique:*`, `pre:critic:*`); stop the worker and the HUD freezes. This is the right design, but it's **fragile in three places** that are not specified anywhere I can see:

1. **Atomicity of the worker write + HUD subscribe.** If the worker writes the critique to Redis *after* it has already advanced the run state to "stage 5", the HUD's stage indicator and the critique list are out of sync. The HUD can show "Stage 5: Anatomy Bible" while Mara's critique for Stage 4 is still streaming in. Looks like lag; reads like a bug.
2. **Realtime delivery model.** The plan says BullMQ (optional) + Redis. Are we publishing on a Redis pub/sub channel? Streaming the Redis stream? Long-polling? Each has different consistency. **None is specified.** If we are using Butterbase realtime (Section E), this becomes a Butterbase-consistency question, not a Redis one — but the README still says Redis. Pick one.
3. **HUD client-side reordering.** SSE events arrive over the wire in order, but if the HUD does any client-side sorting by `beat_id`, a late-arriving Mara critique for shot 1 will appear *above* an already-displayed shot 3 critique, looking like Mara woke up and re-flagged something already accepted. Judges will read this as instability.

**Required consistency model**, not currently specified: **monotonic per-`forge_run_id`** (every event for a given run is ordered by emit time, and the HUD never moves an event backward in the visible list). The simplest implementation is a monotonically increasing event sequence number stamped by the worker, with the HUD only appending. **There is no plan for this.**

### A.4 — Judge asks: "what does Mara catch that a single LLM call wouldn't?"

The 60-second answer the team should rehearse — and which currently has **no supporting evidence in the repo plan**:

> "Three things. First, separation of concerns: the Director is incentivized to produce coherent narrative; Mara is incentivized to find rule violations. We've measured 14 categories of script-level failure on our 30-script eval set [DOES NOT EXIST YET], and the single-LLM baseline catches 6 of them on its first pass. Mara catches 12. Second, structured veto: Mara emits typed `Critique` documents with severity levels, so Atlas knows which revisions are *blocking* and which are *informational* — a single LLM gives you a paragraph; Mara gives you a list Atlas can act on programmatically. Third, the audit trail: every Mara critique is persisted to `pre:critique:{forge_run_id}` so a malpractice attorney can later reconstruct *what the system flagged and what the surgeon-approver overrode* — that is a defensible-design property a single LLM call cannot give you."

**Three claims in there are currently aspirational, not real.** The 30-script eval does not exist. The "Mara catches 12, baseline catches 6" number is fictional. The malpractice-attorney audit-trail story is a positioning claim, not a wired feature. If a judge presses on any of those numbers, the demo collapses.

**The team needs to either build a tiny eval set (10–15 scripts, before stage call) or rehearse a different answer that does not depend on numbers we can't prove.**

---

## Section B — Demo-Day Failure Modes

For each: blast radius / root-cause likelihood / mitigation that must exist before stage call / fallback if mitigation fails.

### B.1 — ModelArk region returns 5xx for the entire 2 minutes

- **Blast radius:** all Seed calls fail. In `replay` mode, this is irrelevant. In `hybrid` mode, every stage hits its `HYBRID_LIVE_BUDGET_S` and falls back to replay — which means an extra ~8s per stage of dead air on stage. Six stages × 8s = 48 seconds of demo time bleeding into model-timeout-then-replay-recovery.
- **Likelihood:** moderate. ModelArk has had multi-region 5xx events historically. A 2-minute window is roughly 1–3% probability on any given day.
- **Mitigation that must exist:** stage flag is `replay`, not `hybrid`. The CLAUDE.md rule is correct: flip to `hybrid` only if Wi-Fi RTT to ARK is verified <100ms. **Default `replay` is the right call.**
- **Fallback if mitigation fails:** backup video at `docs/demo-backup.mp4`. (See B.9 for what kills *that*.)

### B.2 — Wi-Fi at venue is <100ms RTT to ARK but rate-limits at 30 RPM

- **Blast radius:** in `hybrid` mode, Seedance generations queue and 6 beats × ~3 calls/beat (keyframe + video + critic) = 18 calls. 18 calls / 30 RPM = 36s minimum. Add jitter and we're at 50s. The "live" portion of the demo bleeds into the architecture beat.
- **Likelihood:** high. Conference Wi-Fi is consistently rate-limited.
- **Mitigation:** stage flag `replay`, not `hybrid`. Pre-warm cache must contain every call the demo path makes (no cache miss).
- **Fallback:** backup video.

### B.3 — Pre-warmed replay fixture for demo case has gone stale

- **Blast radius:** the replay returns yesterday's response, which encoded yesterday's model behavior. If the schema or response shape changed (e.g., Seedance output URL format changed), the worker raises a parse error, and the HUD shows a worker crash on stage.
- **Likelihood:** low *if* `prewarm_demo.py` ran the night before. Moderate if the team relies on a >24h-old cache.
- **Mitigation:** `prewarm_demo.py --verify` dry-renders end-to-end, last run no later than T-12h. The CLAUDE.md says "9 PM the night before" — that is correct in spirit but **leaves no buffer for re-warming if verify fails**. Add: re-warm by T-3h if verify shows any drift.
- **Fallback:** backup video. Note: the backup video itself was generated from a *different* prewarm. If the current cache fails verify, the backup video is fine — but the team must not try to "fix and re-warm" in the green room. That path leads to demo failure.

### B.4 — Remotion render takes 95s instead of 60s

- **Blast radius:** the live demo scripts a 22-second pre-rendered MP4 in the 0:28–0:50 beat. **It is pre-rendered.** A 95s render time only matters in the live segment if anything is being rendered live. Reading the demo runbook: there is no live render in the 2-minute window. Render time is a pre-demo issue, not a stage issue.
- **Likelihood:** moderate for a Layer-2 cold render; irrelevant for Layer-1 demo.
- **Mitigation:** confirm the 22-second MP4 is bytes-on-disk, not a Remotion-Studio live preview. **Verify by playing it from the OS preview, not from the dev server, in stage rehearsal.**
- **Fallback:** see B.7 (HUD freeze) and B.9 (backup video).

### B.5 — Butterbase MCP authentication fails after the lights dim

- **Blast radius:** the persistence layer is dead. New ForgeRuns cannot be created, but the *existing* pre-warmed demo case is in cache. If the `/forge/[id]` page does any blocking auth-protected fetch on render, the page never loads. The HUD subscribes to Butterbase realtime, so it shows blank.
- **Likelihood:** moderate. Butterbase auth tokens have TTLs; a token expiring during a 2-minute window is a real failure mode.
- **Mitigation:** **service-role key, not user JWT, for the demo session.** Pre-validate in the T-30 checklist (CLAUDE.md has the checklist; the auth-pre-validate item is missing — add it). Cache the signed URL for the explainer MP4 to a static path before stage call.
- **Fallback:** backup video. Note: the backup video must not depend on Butterbase signed URLs — it should be a literal MP4 file in the repo at `docs/demo-backup.mp4`.

### B.6 — Audit-trail PDF has a layout bug not caught in dry-run

- **Blast radius:** the 1:00–1:10 beat shows the PDF preview. If the layout is broken (citations rendered off-page, footer truncated, glyph-soup in the section headers), the trust signal flips to anti-trust signal: "they have a citation system but it can't render."
- **Likelihood:** high. PDF rendering is famously brittle across environments. The headless renderer in CI is not the same as the one on the demo laptop.
- **Mitigation:** generate the demo-case PDF on the **actual demo laptop** during T-30 checklist. Diff against the committed `docs/audit-trail-sample.pdf`. The committed sample IS the source of truth for what judges expect.
- **Fallback:** show the static `docs/audit-trail-sample.pdf` instead of the live export. Have it open in a PDF viewer in a separate tab.

### B.7 — CriticHud freezes mid-render

- **Blast radius:** worst on-stage outcome short of total failure. The critic HUD is the rubric play — if it freezes, judges remember "their critic loop crashed live."
- **Likelihood:** moderate. SSE connections drop on Wi-Fi flicker. React reconciliation can stall on large state updates if the HUD is unmemoized.
- **Mitigation:** (a) HUD must have a heartbeat; if no event for 3s, show a soft "still working…" affordance, never just freeze. (b) `pre:critique:*` and `pre:critic:*` must be backfilled into the page on initial load (don't rely on realtime *only*). (c) Test on a flaky network (Network Link Conditioner: 200ms latency, 1% loss) before stage call.
- **Fallback:** the operator quietly reloads the page during a pre-scripted "transition" beat. There is **no transition beat in the runbook that allows this** — add one or accept the failure mode.

### B.8 — Judge asks: "what if it's an emergency procedure with no plan?"

- **Blast radius:** the answer "we don't support that" is fine, but the *delivery* of the answer is what matters. If the team fumbles, the perception is "this team hasn't thought about scope."
- **Likelihood:** high. This is a category of question every healthcare demo gets.
- **Mitigation:** rehearsed answer: *"PreOpReel is for elective and scheduled procedures with a written plan — that is the 80% of surgical volume where the patient has time to consent. Emergency procedures have a different consent regime (implied consent, surrogate consent) and are explicitly out of scope. The audit-trail invariant requires a procedure-plan document; without one, Mara would block every shot."*
- **Fallback:** none needed if the answer is rehearsed.

### B.9 — Backup video at `docs/demo-backup.mp4` itself has a glitch

- **Blast radius:** terminal. If the backup is bad and the live path is bad, the demo is a slide deck.
- **Likelihood:** moderate-to-high if the backup is recorded once and never re-validated. The CLAUDE.md says "by 5 PM demo day" but does not say "verified by 6 PM by a non-author teammate."
- **Mitigation:** the backup video must be (a) recorded by 5 PM, (b) viewed end-to-end by at least one teammate who did not record it, (c) confirmed to play from the demo laptop's *offline* file system (no streaming dependency).
- **Fallback:** there is no fallback to the fallback. The team must accept this is the floor.

### B.10 — "Click-to-use" demo fixture loads but synthesis worker is down

- **Blast radius:** the upload page accepts the drag, the "/forge/{id}" page renders, but no SSE events arrive. The HUD shows a perpetual "Stage 1: Intake" with no progression. Judges see a stuck pipeline.
- **Likelihood:** moderate. The synthesis worker is a separate process; if it crashes silently on stage call (memory leak from previous dry-runs, port collision after laptop sleep/wake), nothing on the web UI tells the operator.
- **Mitigation:** (a) `/api/healthz` must include a "synthesis worker last-heartbeat" probe, and the upload page must call it on mount. (b) Operator preflight: hit `/api/healthz` in the T-30 checklist and confirm worker green. (c) Restart the worker before stage call regardless of whether it was running, to clear memory state from dry-runs.
- **Fallback:** backup video.

---

## Section C — Invariant Compliance Audit

For each invariant, the **least-defended** part of the plan and the test that catches it.

### C.1 — Critic loop (Invariant 1): how could a teammate accidentally bypass Mara or Lyra?

The most likely bypass: **a new persona writing user-visible text without going through Mara**. Right now the Mara-required path is enforced by code review ("PRs that bypass Mara must not merge") and by the critic-loop-reviewer subagent. There is **no compile-time or test-time gate**. A teammate adding a "patient FAQ" beat in a side branch could ship narrator text that never sees Mara.

Specifically vulnerable surfaces:

- A "tooltip" or "info pill" added to a Remotion component — text is in the component, never in the script, never crosses Mara.
- A `ConfidenceBand` label that says "high confidence" — that is a stance assertion, computed client-side from a number, with no Mara review.
- A new agent (say, a future "Pricing" persona) drafting a price-display string.

**Test that catches it:** `tests/personas/test_user_visible_text_routed_through_mara.ts`. The test enumerates every Remotion component prop and every API response field that ends up on screen, and asserts that each has either (a) a citation pointer (Invariant 4 — see C.4) or (b) a unit test proving the producing path called Mara. Without this, the invariant is honor-system.

### C.2 — Seed pinning (Invariant 2): how could a model ID leak outside `models.ts`?

The pre-tool-use grep hook in `.claude/settings.json` blocks edits embedding `seed-*`/`seedream-*`/`seedance-*` IDs in non-`models.ts` files. This catches the obvious case. It does not catch:

1. **Import aliasing.** A teammate writes `import { SEED_MODELS as M } from "..."; const x = M.video;` and then later replaces `M.video` with a string literal in a refactor. The grep on `seedance-*` still passes if the string is `"seedance-2.0"` — but does it? Yes, the grep is for the literal pattern. So this case is caught. Move on.
2. **Dynamic strings.** A teammate writes `` const id = `seedance-${version}` `` where `version = "2.0"`. Grep does not match (the literal is `seedance-${version}` not `seedance-2.0`). **The hook misses this.**
3. **Third-party SDK re-export.** If a Seed SDK exports a constant `MODEL_ID = "seedance-2.0"`, a teammate could `import { MODEL_ID } from "@byteplus/seed-sdk"` and pass it to a wrapper. The grep does not scan `node_modules`. The model ID is used outside `models.ts` (it lives in the SDK), and our `models.ts` is no longer the single source of truth. The actual rule is "we use the SDK's pin, not ours."
4. **Comment / docstring leak.** A teammate puts `// uses seedance-2.0` in a non-`models.ts` file. The grep matches. False positive — but per the rule, the PR doesn't merge. Annoying but correct.
5. **JSON / YAML config files.** Replay fixtures contain model IDs in their cached responses. These should be in `data/replay/` which the grep doesn't scan (the grep is `src/`). If a teammate moves a fixture into `src/`, it leaks. Low likelihood.

**Test that catches the dynamic-string case (C.2.2):** `tests/synthesis-worker/test_no_dynamic_model_id.ts`. AST-level scan (TypeScript compiler API) for any string-template expression containing `seed`, `seedance`, `seedream`, `omnihuman` as a substring of any literal segment. Lives in `tests/synthesis-worker/` because that's where Seed wrappers live.

### C.3 — Hermetic replay (Invariant 3): which stages might still hit the network in `replay` mode?

The chokepoint is `src/lib/forge/replay.ts`. The invariant assumes every outbound call routes through the wrapper. Risks:

1. **Tavi cache miss in `replay` mode.** If the Tavi cache (`data/grounding-cache/`) does not have a hit for the demo case's queries, `tavily.ts` will hit the live Tavily API, even in `replay` mode, unless it's wrapped in `withReplay`. The plan does not say `tavily.ts` is wrapped. **It probably isn't.**
2. **Exa neural search.** Same risk. Exa is in §Sponsor map as "DEEP" but `replay.ts` is described as wrapping Seed calls only.
3. **Gemini 1.5 Flash for vision-only landmark extraction.** Stage 2c. If the demo case has a fresh PDF that wasn't pre-processed, Gem hits Gemini live. The "non-judged path" exception in CLAUDE.md does NOT exempt it from the hermetic-replay invariant — Invariant 3 says "every outbound call." The team is leaning on a non-existent exemption.
4. **Butterbase realtime subscription.** Subscribing to Butterbase from the browser is an outbound call. The HUD does this on every page load. In `replay` mode, the worker is feeding Butterbase from a fixture, but the *subscription itself* is still live. If Butterbase auth fails (B.5), `replay` mode does not save us.
5. **Storage signed URL fetch.** The explainer MP4 is fetched from a storage URL in the browser. Even in `replay`, this is a live fetch (the file exists in storage, but the fetch is not replayed).
6. **Pdf-parse and other "deterministic" libs.** `pdf-parse` is offline. Fine. But if any ingestor calls a remote font CDN for layout (some PDF libs do), that's a network leak.

**Test that catches it:** `tests/synthesis-worker/test_replay_branch.ts` already exists in the plan, and the description says it covers "every outbound call has a replay branch." Verify it actually enumerates Tavi, Exa, Gem, AND Butterbase — not just Seed wrappers. If it only covers Seed, the test name is misleading and the invariant is not actually enforced. **Read the test before believing the test.**

### C.4 — Audit trail (Invariant 4): how could on-screen text be rendered without a citation pointer?

The risk surface is **client-computed text**. Every `ConfidenceBand`, `AnatomicalLabel`, `ProcedureStepOverlay`, `CitationFooter` accepts data props from the API. If any of those components do client-side string composition — `${score}% confidence` or `step ${n} of ${total}` — that text is on screen but the citation pointer was never in the data path.

Specifically vulnerable:

- **`ConfidenceBand` — the label "High Confidence" / "Medium Confidence" / "Low Confidence"** is presumably a function of the numeric score, computed in the component. **That label is a stance assertion**, and there is no citation. A judge taking a screenshot of "High Confidence" on an anatomical structure has captured an uncited claim.
- **Pluralization** — "1 procedure step" vs "2 procedure steps" computed in the component. Trivial, but if a teammate adds "of which 1 is critical" the "critical" is an assertion.
- **Aria-labels and alt-text** — accessibility text is on-screen-text-equivalent for screen readers. If alt-text is auto-generated, it bypasses the citation requirement.
- **Error states** — "Could not load anatomy graph" rendered as fallback text. Not a medical claim, but it is on-screen text without a citation pointer. Pedantic but the invariant says *every* on-screen claim. Add an exclusion for system-status text or be principled.

**Test that catches it:** `tests/remotion/test_no_uncited_text.ts`. Lives in `tests/remotion/` (or `tests/components/`). For each Remotion + React component that renders text, the test renders the component with a stub data prop missing the citation pointer, and asserts the component throws (or renders an explicit "[uncited]" placeholder). This forces the citation to be in the data path.

**Honesty caveat:** this test is hard to write. The team should be prepared to argue the invariant covers *medical-claim* text only, not UI chrome. **That argument has to be in the README and in the demo narration** or a judge will find a screenshot that breaks the claim.

---

## Section D — Persona-Prompt Risks

### D.1 — Atlas-surgical's "never recommend, only explain"

The bright-line rule is unstable in edge cases. The README treats it as binary. It isn't.

Gray-zone outputs that the system prompt as written will produce:

- **Pre-operative fasting** — "you will not eat or drink after midnight." This is the surgeon's order. It is also a *recommendation* to the patient (do not eat). The rule "only explain what the surgeon decided" papers over this — the surgeon decided the fasting, but the *patient* is the one acting. Mara will or will not block this depending on whether her few-shot includes imperative-tense beats.
- **Post-operative weight-bearing** — "you will not put weight on the leg for 6 weeks." Same structure.
- **Medication discontinuation** — "stop taking blood thinners 5 days before surgery." Same.
- **What to bring** — "bring a list of your current medications." Operational but advisory.
- **Symptoms requiring a call** — "call us if you have a fever above 38.5°C." Diagnostic threshold being communicated. Mara *should* block this — it is closest to medical advice — but it is also *exactly* what the surgeon's plan says.

The system prompt needs an **explicit allowlist** of imperative phrasings tied to plan-section pointers. Without it, Atlas will either be too permissive (B.1 above leaks) or too restrictive (every fasting instruction gets blocked, demo fails). **No allowlist is in the plan.**

### D.2 — Mara's known-bad few-shots — ESL drift, cultural, religious

The 10 known-bad scripts are presumably written in clean English by a native speaker. They will not cover:

- **ESL narrator drift.** Seed Speech 2.0 voice presets are listed as warm-female / warm-male / neutral / soft. None are flagged as accented. If the narrator is a calm clinician with a non-American accent, certain phrasings that read fine in text will sound advisory in audio. Mara reads text only.
- **Patient ESL.** The script is in English. If a patient's first language is not English, "you will not eat" can read as imperative-strong vs. imperative-soft depending on cultural register. Mara is not language-aware.
- **Cultural pre-op constraints.** Removal of religious items, gender-of-clinician preferences, dietary halal/kosher considerations during recovery. The script either assumes them away (advice creep) or omits them (consent failure). Both are Mara-vetoable; neither is in the few-shot.
- **Religious-objection scope.** Blood transfusion refusal (Jehovah's Witness scenarios), end-of-life directives during high-risk procedures. The pitch ("informed consent") is exactly the surface where these matter, and the few-shot does not engage with them at all.

Mara's category enum (`advice_creep | uncited_claim | ambiguity | scope_creep | anatomical_invention`) **has no category for "patient-population assumption."** That gap is a Mara-blind-spot, full stop.

### D.3 — Lyra's `anatomical_fidelity` from 4 sampled frames

The score claims to measure whether the rendered shot matches the AnatomyGraph. From 4 sampled frames over a (say) 5-second clip at 30fps = 150 frames, that is 2.7% sampling. For:

- **Hand-only shots / close-ups** — if the camera is on a surgical instrument and an anatomical landmark (femur, joint capsule) is off-frame, the 4 samples may all be off-frame. `anatomical_fidelity` is then computed against… what? The component doesn't apply, so does Lyra return 1.0 (vacuously true) or 0.5 (no signal)? **The plan does not specify.** A vacuous 1.0 is dishonest theater (HUD shows green when there's no signal); a 0.5 gets regen'd unnecessarily.
- **Motion-blurred frames** — Seedance 2.0 camera moves can produce blur; landmarks that are visible to a human may not be detected by Seed 2.0 Pro Vision in a frame. False negatives.
- **Cuts and fades** — if a beat starts with a fade-in, the first sampled frame may be 80% black. Vision critic gets one less data point.
- **What is "anatomical correctness"?** The model is being asked to verify that the rendered femur matches the AnatomyGraph's femur. The AnatomyGraph contains *structured* data (entity, relationships, geometry). The vision critic compares pixels to that structure. **There is no pose estimator in the pipeline** — the comparison is implicit, model-internal, and unaudited. Lyra's "0.71" is a vibe, dressed up as a number.

The team needs to either (a) define what "anatomical correctness" means operationally (e.g., "does the render contain a femur in the lateral position relative to the acetabulum at any sampled frame"), or (b) admit Lyra's score is qualitative and stop calling it `anatomical_fidelity` to two decimal places.

### D.4 — Gem's `confidence_band` extraction

Pose-extraction confidence from Gemini 1.5 Flash on a procedure-plan diagram is **not a real number from a calibrated model**. Vision LLMs do not output well-calibrated confidence; they output token logprobs that have to be massaged into a 0..1 score. The likely failure mode: every band is in `{0.7, 0.8, 0.9}` because that is what Gemini's prose tends to say ("I'm fairly confident…", "I'm quite confident…", "I'm very confident…").

**The HUD will then show three bars, all in the green-yellow zone, regardless of input.** That is theater, not honesty.

The honest version: the confidence-band display should have at least one demo case where a band is `0.4` or below (a region of the diagram is genuinely ambiguous), and the team should rehearse the narration around it: *"Gem is flagging the surgical-approach diagram is unclear here — that's why the confidence band is shorter."*

If every band is `0.7`–`0.9`, the trust-signal play backfires on close inspection. (A judge zooming into a screenshot will notice all bands are roughly the same.)

---

## Section E — Butterbase Integration Risks

### E.1 — 500ms write latency spike and HUD lag

The plan says Mara critiques and Lyra scores are persisted to Butterbase, and the HUD subscribes to Butterbase realtime. If Butterbase has a 500ms write latency spike during the 0:50–1:00 critic beat:

- The worker writes Mara's critique. 500ms passes.
- The worker advances to Lyra. 500ms passes per write × 6 beats × ~3 writes per beat = 9 seconds added.
- The HUD's realtime subscription receives events 500ms late (additional latency on top of write latency).

**On-stage outcome: the HUD lags the narrator by ~1–2 seconds.** Not catastrophic, but visible. The narrator says "and Lyra rejects shot 3" while the HUD is still showing shot 2.

Mitigation: the HUD must have a "play back from cache" mode where it reads the entire `criticTrace[]` from a single Butterbase query at page load and **animates through it on a fixed 2-second tick**, ignoring realtime entirely. This trades hermetic-correctness for demo-stability. **The plan does not specify which mode the HUD uses on stage.** Pick one.

### E.2 — Realtime "see your own write" race

Butterbase realtime: when the worker writes to `critic_scores`, does the worker's *own* subscribe see that write? Postgres-LISTEN-based realtime systems sometimes fire to all subscribers including the writer; some don't. If the worker subscribes to its own writes (it shouldn't, but if any code does), there's a feedback loop risk.

More relevant: the HUD subscriber sees the worker's writes. The HUD also issues its own writes (e.g., user clicks "regen" — maybe). If there's any UI write that triggers a realtime event consumed by the same UI, you get a render loop. **This is a known footgun.** The plan does not specify a one-direction data flow.

**Required guarantee, not stated:** writes are *worker-only*; the HUD is read-only via realtime + initial query. UI actions (manual regen) hit `POST /api/forge/{id}/regen` which the worker processes — the UI never writes directly to `critic_scores` or `critiques`.

### E.3 — Storage signed URL rotation between page render and click

The `/forge/{id}` page renders a `<video>` tag with a signed URL for the explainer MP4. Signed URLs have TTLs (usually 1 hour). If the user lands on the page, watches the HUD beat, and only at 1:00 clicks play on the video — and the URL expires between render and click — the video shows "401 Unauthorized" or just doesn't load.

For a 2-minute demo this is not a real risk (TTL >> demo length). For a *judge replaying the video later* (which they will, post-demo), this is a real risk. The page they are looking at was rendered live during demo; an hour later, the URL is dead.

Mitigation: **server-side signed-URL minting on every page request**, not on initial page generation. Every `/forge/{id}` HTTP response computes a fresh signed URL. Cheap. Correct. Plan does not specify.

### E.4 — Demo cost vs. $20 BUTTERBASE0502 credit

PreOpReel's demo is `replay`, so Butterbase reads/writes are minimal during the live 2 minutes. But:

- **Pre-warming**: every dry-run writes ForgeRun + critique + critic + audit data. If the team does 5–10 dry-runs across the 5 build days plus 3 stage rehearsals, that is ~15 ForgeRuns × ~40 writes per run = 600 writes. Within Butterbase free tier presumably. Confirm.
- **Storage egress**: the explainer MP4 is ~50–100 MB at 1080p / 90s. Per dry-run download for verification + per stage-rehearsal playback + the live demo + judge replay = maybe 20 GB egress. **This is the budget risk, not writes.**

Egress at typical CDN pricing (~$0.08/GB) = $1.60 for 20 GB. Within the $20 credit. If the team enables a "shareable link" for the explainer MP4 and 50 judges click it, 50 × 100 MB = 5 GB additional. Still within budget.

**The dry-run policy needs to specify: do not enable public-share on the demo MP4 until after the demo concludes.** Otherwise pre-demo PR for the project burns the credit before stage call.

Other Butterbase cost considerations not addressed:
- Realtime subscription connection-minutes are usually billed. 5 dry-runs × 90 seconds × 1 subscriber = 7.5 minutes. Tiny.
- Database row count: ~600 rows. Tiny.
- Auth-session minutes: depends on session TTL.

**Net**: $20 is plenty IF the team does not enable any public-discovery surface before demo day. Set the budget plan to: keep storage private until 2026-05-02 14:00 PT (post-demo), then enable.

---

## Section F — Scope-Creep Catches

### F.1 — OmniHuman surgeon greeting

- **Status in plan:** "optional / opt-in" Layer-2 (README §3.5, CLAUDE.md). Has cut criterion (uncanny-valley check).
- **Recommendation:** **CUT for the 2-min demo.** Reasoning: (a) the demo case is a *synthetic phantom patient* — there is no real surgeon to greet, so OmniHuman is generating a fake-surgeon-greeting-a-fake-patient, which is double-uncanny. (b) The 0:00–0:08 hook is statistic-driven, not greeting-driven, so OmniHuman has no time slot in the runbook. (c) Trust signal vs. novel signal — CLAUDE.md says trust > novel. A real-surgeon greeting on a real-patient case is the killer demo *for a customer*, not for hackathon judges.
- **Time saved:** 4–8 hours of integration + uncanny-valley verification. Spend on: (1) Mara's eval set (Section A.4), (2) `ConfidenceBand` low-band demo case (Section D.4), (3) Backup video re-record buffer (Section B.9).

### F.2 — Cost HUD

- **Status in plan:** Layer-2 ("per-stage Seed token spend").
- **Recommendation:** **CUT for the 2-min demo.** The CriticHud is the rubric play. A second HUD competes for screen-time and visual hierarchy in the 0:50–1:00 beat, the most important 10 seconds of the entire pitch. ROI framing belongs in the GitHub README, not in the demo overlay.
- **Time saved:** 2–3 hours. Spend on: HUD heartbeat + reload-recovery (Section B.7).

### F.3 — Hybrid mode

- **Status in plan:** "live + budget timeout falls back to replay."
- **Recommendation:** **KEEP the implementation, CUT the on-stage use.** Hybrid is good infrastructure for development (catch live-call regressions), but on stage, defaulting to `replay` and only flipping to `hybrid` if Wi-Fi RTT verifies <100ms is the right call. Do NOT demonstrate hybrid on stage. Do NOT mention it in narration. The judge cannot tell `replay` from `hybrid` from `live` from the audience; the operator should not gamble on something they can't perceive the difference of.
- **Time saved:** 0 hours (keep implementation). Mental energy saved: high.

### F.4 — Multi-API-key rotation

- **Status in plan:** CareReel pattern, "operational signal."
- **Recommendation:** **KEEP for Layer 1, but only as a defensive layer.** It costs nothing on the demo path (we're in `replay`); it costs implementation time once and pays back in dry-run reliability across the build week. The "operational signal to judges" framing is weak — judges do not read your `keyRotation.ts` source. The real value is dry-run survivability.
- **Time saved:** 0 hours; the work has to happen for dry-runs to be repeatable. Reframe internally: this is *dev-loop* infra, not *demo-day* infra.

---

## Section G — The "Best-In-Class" Gap

The user noted the critic loop is the rubric-aligned addition that puts PreOpReel above competitors. Three concrete additions, each <2 hours, each visible in the 2-minute demo:

### G.1 — Live "explain this regen" tooltip in the CriticHud (~90 minutes)

When Lyra rejects shot 3 at 0.71, the HUD currently shows the score and the regen happens. **Add a 2-line tooltip showing Lyra's `feedback` field** ("femur appears medial to acetabulum; expected lateral") next to the rejected score. This is one extra DOM element, the data is already there (`feedback` is in the schema), and it makes the critic loop *legible*. Right now a judge sees a number change; with the tooltip, they see *why*. **This is the difference between "they have a critic loop" and "I just watched their critic loop reason about anatomy in real time."**

### G.2 — "Citation density" sparkline in the audit-trail PDF preview (~60 minutes)

The 1:00–1:10 beat shows the audit-trail PDF. Add a top-of-page sparkline: claims-per-section as a tiny bar chart. *Every* section is non-zero. The visual reads as "every claim is sourced." This is one extra render in the PDF generator (chart-as-SVG) and it converts a static citation list into a measurable trust signal. No competitor has this.

### G.3 — `SHOW_INVARIANT_CHECKS=1` debug mode in the CriticHud (~90 minutes)

Add a keyboard shortcut (e.g., `?`) that toggles a developer overlay showing all four invariants as live indicators: critic-loop ✓, seed-pinning ✓, replay-mode active, audit-trail complete (N/N claims cited). **Show this for 5 seconds in the demo at 1:25, just before the architecture diagram.** Narrate: "every output enforces four invariants — here they are, live." This is rubric-bait for Agentic Execution: it visualizes the *discipline* of the team, not just the output. ~90 minutes for the toggle + four indicators.

---

## Section H — Open Questions for Atlas

Atlas merges the plans. These block parallel execution. Atlas must answer before Phase 3 starts.

- **Q1 (A.1):** Is there a Mara eval set beyond the 10 few-shot scripts? If yes, where is it / who builds it / what's the size? If no, what is the rehearsed answer to "what does Mara catch that one LLM doesn't"?
- **Q2 (A.2):** What is the floor below which Lyra's score forces a cut to a still image instead of `accept-and-surface`? Is it 0.5? 0.6? Undefined?
- **Q3 (A.3):** What is the realtime delivery model for `pre:critique:*` and `pre:critic:*` — Redis Streams + SSE, Redis pub/sub, Butterbase realtime, or all three? Pick one chokepoint.
- **Q4 (A.3):** Is there a monotonic per-`forge_run_id` event sequence number, or do we accept reorder risk in the HUD?
- **Q5 (B.5):** Is the demo session using a Butterbase service-role key or a user JWT? What is the auth-pre-validate step in the T-30 checklist?
- **Q6 (B.7):** Does the CriticHud have a heartbeat / reload-recovery affordance? If not, who owns it? Frontend or Demo?
- **Q7 (C.1):** Does `tests/personas/test_user_visible_text_routed_through_mara.ts` exist? If not, who writes it before stage call?
- **Q8 (C.3):** Does `tests/synthesis-worker/test_replay_branch.ts` enumerate Tavi, Exa, Gem, AND Butterbase, or just Seed wrappers?
- **Q9 (C.4):** Is `ConfidenceBand` in scope for citation-pointer enforcement, or is UI chrome exempt? The README/CLAUDE.md needs an explicit line.
- **Q10 (D.1):** Is there an explicit imperative-tense allowlist in `atlas-surgical.ts`? If not, fasting / weight-bearing / medication beats will be inconsistently handled.
- **Q11 (D.3):** What does Lyra return for hand-only shots / close-ups where AnatomyGraph landmarks are off-frame — vacuous 1.0 or 0.5 with feedback?
- **Q12 (D.4):** Is at least one demo-case `confidence_band` deliberately below 0.6 to demonstrate honesty-over-theater? If all are 0.7–0.9, the trust signal is theater.
- **Q13 (E.1):** Does the CriticHud play back from cache on page load (animated) or is it pure realtime? Pick.
- **Q14 (E.3):** Is the explainer MP4 signed-URL minted server-side on every page request, or once at page generation?
- **Q15 (F.1):** Is OmniHuman surgeon greeting in or out for the 2-minute demo?
- **Q16 (G):** Are any of the three "best-in-class" additions in scope, or is the team locked on the v7 plan?
- **Q17 (B.9):** Who is the non-author teammate validating `docs/demo-backup.mp4` before stage call?
- **Q18 (Cross-cutting):** Who owns the T-30 checklist execution? CLAUDE.md lists the items but not the owner. If it's "whoever has hands free," it doesn't get done.

---

## File written

Absolute path: `/Users/nihalnihalani/Desktop/Github/preopreel/docs/plans/06-mara-critique.md`

---

## Verdict — if I had to pick one thing for the team to fix before Phase 3

1. **The Lyra score floor (Section A.2 / Q2) is the single most likely on-stage failure.** Define a floor below which Lyra cuts to a still image, or accept that two beats stamped 0.58 will play on stage.
2. **Mara has no eval set (Section A.1, A.4) — the "what does Mara catch?" question collapses without one.** Build a 10-script eval before stage call OR rehearse the answer that does not depend on numbers.
3. **The CriticHud has no heartbeat / reload-recovery (Section B.7) — a 3-second SSE drop becomes a visible freeze on the rubric beat.** Add a heartbeat affordance and test on a flaky network before stage.
4. **The replay invariant probably does not cover Tavi/Exa/Gem/Butterbase (Section C.3 / Q8) — read `test_replay_branch.ts` before believing the test.** If it only covers Seed, the hermetic claim is false.
5. **The backup video has no second-eyes validation (Section B.9 / Q17) — if the backup is bad and the live path is bad, the demo is a slide deck.** Assign a non-author teammate to validate by 6 PM demo day. This is the cheapest, highest-leverage mitigation in this entire document.

— Mara
