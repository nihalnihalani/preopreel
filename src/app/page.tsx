// app/page.tsx — landing page.
//
// Per plan 04 §A.1 (post-2026-05-02 Option-A demo-CTA removal):
//   - No signup, click-to-use.
//   - Big hero with tagline + primary "Upload your own" CTA → /forge
//   - Four pillars (the four invariants) as cards
//   - Seed lineup row
//   - Butterbase + promo BUTTERBASE0502 + submission butterbase0502 footer
//
// Server component — no state, no effects.

import Link from "next/link";
import { ArrowRight, ShieldCheck, Eye, RefreshCw, FileCheck2 } from "lucide-react";

const PILLARS = [
  {
    icon: ShieldCheck,
    title: "Critic loop",
    body:
      "Mara reviews every line before render; Lyra scores every clip after. " +
      "Below threshold → reject and regenerate. Visible on stage.",
    invariant: "Invariant 1",
  },
  {
    icon: Eye,
    title: "Seed pinning",
    body:
      "Atlas / Mara / Lyra → Seed 2.0 Pro. Keyframes → Seedream 5.0. " +
      "Video → Seedance 2.0 (I2V or T2V-with-ref only). Speech → Seed Speech 2.0.",
    invariant: "Invariant 2",
  },
  {
    icon: RefreshCw,
    title: "Hermetic replay",
    body:
      "Every Seed call routes through withReplay(). DEMO_MODE=replay produces " +
      "a bit-identical demo — Wi-Fi-failure-proof.",
    invariant: "Invariant 3",
  },
  {
    icon: FileCheck2,
    title: "Audit trail",
    body:
      "Every claim cites the surgeon's plan §X, a peer-reviewed PMID, or a curated protocol. " +
      "One PDF page per claim. The trust signal.",
    invariant: "Invariant 4",
  },
] as const;

const SEED_LINEUP = [
  { name: "Seed 2.0 Pro", role: "Director · Mara · Lyra-vision" },
  { name: "Seedream 5.0", role: "Tier-0 keyframe anchor" },
  { name: "Seedance 2.0", role: "I2V / T2V-with-ref + extend" },
  { name: "Seed Speech 2.0", role: "Calm-clinician narration" },
] as const;

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden">
      {/* Background gradient halo behind the hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[-160px] h-[480px] bg-[radial-gradient(ellipse_at_center,rgba(58,167,146,0.25)_0%,rgba(10,14,20,0)_70%)] blur-2xl"
      />

      {/* ─── Hero ─────────────────────────────────────────────── */}
      <section className="relative mx-auto flex max-w-[1100px] flex-col items-center gap-8 px-6 pb-16 pt-20 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-critic-lyra/30 bg-critic-lyra/10 px-3 py-1 text-xs font-medium text-critic-lyra">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-critic-lyra" />
          Beta University AI Lab · Seed Agents Challenge · 2026-05-02
        </span>

        <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight text-clinical-100 md:text-5xl lg:text-6xl">
          The 90-second animated explainer{" "}
          <span className="bg-gradient-to-r from-critic-lyra via-seed-500 to-critic-warn bg-clip-text text-transparent">
            your surgeon never had time to make.
          </span>
        </h1>

        <p className="text-balance max-w-2xl text-lg leading-relaxed text-clinical-300">
          Drop a procedure-plan PDF and a patient demographics card.
          PreOpReel synthesizes a personalized, anatomically-grounded,
          audit-trailed pre-operative explainer the patient watches before
          signing consent.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/forge"
            className="group inline-flex items-center gap-2 rounded-lg bg-critic-lyra px-6 py-3 text-base font-semibold text-ink-950 shadow-lg shadow-critic-lyra/20 transition-all hover:bg-critic-lyra/90 hover:shadow-critic-lyra/30"
          >
            Upload your own
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>

        <p className="text-xs text-clinical-300">
          No signup. Click-to-use. Synthetic phantom case — labeled on screen.
        </p>
      </section>

      {/* ─── Four pillars ──────────────────────────────────────── */}
      <section className="mx-auto max-w-[1200px] px-6 pb-16">
        <h2 className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-clinical-300">
          Four invariants
        </h2>
        <p className="mb-10 text-center text-sm text-clinical-300">
          Every PR that violates one of these does not merge.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.title}
                className="surface-card surface-card-hover flex flex-col gap-3 rounded-xl p-5 transition-all"
              >
                <div className="flex items-center justify-between">
                  <Icon className="h-5 w-5 text-critic-lyra" aria-hidden="true" />
                  <span className="font-mono text-[10px] uppercase tracking-wider text-clinical-300">
                    {p.invariant}
                  </span>
                </div>
                <h3 className="text-base font-semibold text-clinical-100">
                  {p.title}
                </h3>
                <p className="text-sm leading-relaxed text-clinical-300">
                  {p.body}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Seed lineup ──────────────────────────────────────── */}
      <section className="mx-auto max-w-[1200px] px-6 pb-20">
        <h2 className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.2em] text-clinical-300">
          BytePlus Seed lineup
        </h2>
        <p className="mb-8 text-center text-sm text-clinical-300">
          Every Seed surface earns its place. Nothing checkbox-integrated.
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {SEED_LINEUP.map((s) => (
            <div
              key={s.name}
              className="surface-card flex flex-col gap-1.5 rounded-lg p-4 text-left"
            >
              <span className="font-mono text-xs font-semibold text-seed-500">
                {s.name}
              </span>
              <span className="text-xs text-clinical-300">{s.role}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── How it works ─────────────────────────────────────── */}
      <section className="mx-auto max-w-[1100px] px-6 pb-20">
        <div className="surface-card grid grid-cols-1 gap-6 rounded-xl p-8 md:grid-cols-3">
          <Step
            n={1}
            title="Drop the inputs"
            body="Procedure plan PDF + patient demographics card. No signup."
          />
          <Step
            n={2}
            title="Watch the agents work"
            body="Atlas / Tavi / Exa / Gem / Lyra / Mara — six personas, one engine. Critic events stream live."
          />
          <Step
            n={3}
            title="Get the explainer + audit"
            body="60–90s 1080p MP4 + a one-page-per-claim audit-trail PDF the patient (or attorney) can read."
          />
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-ink-700/60 bg-ink-950/40">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-3 px-6 py-6 text-xs text-clinical-300 md:flex-row">
          <span>
            Built on{" "}
            <span className="font-mono text-clinical-100">Butterbase</span> ·
            promo code{" "}
            <span className="font-mono text-clinical-100">
              BUTTERBASE0502
            </span>{" "}
            · submission{" "}
            <span className="font-mono text-clinical-100">butterbase0502</span>
          </span>
          <span>
            Synthetic phantom on stage. Not a medical device — an informed-consent
            communication tool.
          </span>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-full border border-critic-lyra/40 bg-critic-lyra/10 font-mono text-xs font-bold text-critic-lyra">
        {n}
      </span>
      <h3 className="text-sm font-semibold text-clinical-100">{title}</h3>
      <p className="text-sm text-clinical-300">{body}</p>
    </div>
  );
}
