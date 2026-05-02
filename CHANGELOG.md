# CHANGELOG — PreOpReel

Daily-shipping log per the CareReel pattern (CLAUDE.md §Operational Moves).
One section per day; one bullet per file group landed. Newest at the top.

Promo code: `BUTTERBASE0502` (ALL CAPS) — Submission: `butterbase0502` (lowercase).

---

## 2026-05-02 — Day 1 (Phase 3 implementation, demo day)

- chore(plans): six-plan synthesis locked into `docs/plans/00-master-plan.md`; mermaid + 12-stage pipeline + four invariants ratified
- feat(fixtures): synthetic-phantom demo case wired (`data/fixtures/demo-hip-replacement/{patient,procedure,expected.shotlist,expected.critique,expected.scores,expected.audit}.json`)
- feat(scripts): procedure plan PDF generator (`scripts/generate_phantom_plan.py` — reportlab, idempotent, §N.M pointers map 1:1 to shotlist citations)
- feat(scripts): replay-cache prewarm + verify + cost-estimate (`scripts/prewarm_demo.py`); per-stage layout + `manifest.json` sha256s
- feat(scripts): demo-mode switcher with `--i-know-what-im-doing` safety on `live` (Mara B.4)
- feat(scripts): backup-video recorder + frame-fingerprint emitter (Mara B.9 mitigation; `scripts/record_backup_video.sh` + `scripts/verify_backup_video.py`)
- feat(scripts): audit-trail verifier covering Tavi/Exa/Gem/Butterbase pointer formats (Mara C.4 mitigation)
- feat(scripts): Butterbase health + `SELECT 1 FROM forge_runs` probe (Mara B.5 mitigation; `scripts/probe_butterbase.ts`)
- docs(demo): `docs/demo-runbook.md` — beat-by-beat 2-min runbook + 60-second "what does Mara catch" rehearsal + recovery moves
- docs(butterbase): `docs/butterbase-runbook.md` — day-1 checklist with promo code, MCP setup, migrations, YouTube reference

## 2026-05-01 — Day 0 (planning + scaffold)

- chore(scaffold): repo bootstrap — `package.json`, `next.config.ts`, `remotion.config.ts`, `tsconfig.json`, `tailwind.config.ts`, `vitest.config.ts`, `.env.example`, `.gitignore`, `.mcp.json`
- docs(plans): six-plan upstream — `00-master-plan.md`, `01-master-architecture.md`, `02-vision-and-synthesis.md`, `03-schemas-and-personas.md`, `04-frontend-and-demo.md`, `05-butterbase-integration.md`, `06-mara-critique.md` (5,895 lines)
- docs(rules): `CLAUDE.md` rules layer locked — four invariants, agent-team strategy, demo-day hard rules, sponsor integration map
- chore(structure): directory tree pre-created — `src/{app,components,lib,remotion}`, `apps/synthesis-worker/`, `butterbase/migrations/`, `data/{replay,fixtures,grounding-cache,explainers}`, `scripts/`, `tests/`
