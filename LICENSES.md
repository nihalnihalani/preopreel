# Third-Party Licenses

PreOpReel is licensed under the MIT License (see [LICENSE](./LICENSE)).

## Third-party code included verbatim or with modification

### Cinema Lens Taxonomy

`src/lib/forge/lens/taxonomy.ts` is ported from
**[Anil-matcha/Open-Generative-AI](https://github.com/Anil-matcha/Open-Generative-AI)**
under the MIT License. The taxonomy maps semantic camera-angle keywords
(e.g. `wide_anatomical`, `macro_landmark`) to deterministic prompt
suffixes describing lens / aperture / film-stock cues for Seedance.

Original copyright:

> MIT License — Copyright (c) Anil Matcha
> See https://github.com/Anil-matcha/Open-Generative-AI/blob/main/LICENSE

## Runtime dependencies

All NPM and Python dependencies retain their upstream licenses. Notable
production dependencies:

| Package | License | Used for |
| --- | --- | --- |
| `next` | MIT | App Router |
| `react`, `react-dom` | MIT | UI |
| `remotion`, `@remotion/*` | Remotion ("free for personal/non-commercial; paid otherwise") | Composition + render |
| `zod` | MIT | Schemas |
| `pdf-lib` | MIT | Audit-trail PDF |
| `pdf-parse` | MIT | Procedure-plan ingest |
| `p-limit` | MIT | Worker concurrency |
| `ioredis` | MIT | SSE trace stream |
| `pg` | MIT | Butterbase pg fallback |
| `openai` | Apache-2.0 | OpenAI-compatible client for ModelArk |
| `react-pdf` | MIT | Receipt viewer |
| `tailwindcss` | MIT | Styling |
| `ts-morph` | MIT | Invariant-3 wide-scan static analysis |
| `playwright` | Apache-2.0 | Backup-video recorder |

See `package-lock.json` for the full transitive list.

## Hackathon attributions

- **Beta University AI Lab — Seed Agents Challenge** (2026-05-02). Submission code:
  `butterbase0502`.
- **Butterbase** — Postgres + auth + storage + realtime backbone. Promo applied:
  `BUTTERBASE0502`. Setup reference video:
  https://www.youtube.com/watch?v=SHnryHJL9xc
- **BytePlus ModelArk** — Seed 2.0 / Seedream 5.0 / Seedance 2.0 / Seed Speech 2.0 /
  OmniHuman 1.5.
