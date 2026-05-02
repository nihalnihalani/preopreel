// src/remotion/compositions/SubmissionDeck.tsx
//
// Beta Super Hackathon submission deck. 3 slides × 40s = 120s. 1920×1080.
// Each slide has its own component; `currentFrame` drives which slide is
// visible. Used to render both the deck (PNG per slide) and the
// embedded demo video (MP4) for the 3-slides Google Slides requirement.

import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";

const FPS = 30;
const SLIDE_FRAMES = 40 * FPS; // 40s per slide
export const TOTAL_FRAMES = SLIDE_FRAMES * 3;

const C = {
  bg: "#0B0F19",
  panel: "#121826",
  ink: "#E6EAF2",
  dim: "#9AA3B2",
  accent: "#7CC4FF",
  good: "#5DD39E",
  warn: "#F2C879",
  bad: "#FF7A7A",
};

const baseTextStyle: React.CSSProperties = {
  color: C.ink,
  fontFamily:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  fontWeight: 400,
};

function FadeIn({
  delay = 0,
  duration = 18,
  children,
  style,
}: {
  delay?: number;
  duration?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const f = useCurrentFrame() - delay;
  const op = Math.max(0, Math.min(1, f / duration));
  const ty = (1 - op) * 16;
  return (
    <div style={{ opacity: op, transform: `translateY(${ty}px)`, ...style }}>
      {children}
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...baseTextStyle,
        position: "absolute",
        left: 64,
        right: 64,
        bottom: 36,
        fontSize: 22,
        color: C.dim,
        letterSpacing: 0.2,
      }}
    >
      {children}
    </div>
  );
}

function SlideHeader({ kicker, title }: { kicker: string; title: string }) {
  return (
    <FadeIn delay={4}>
      <div
        style={{
          ...baseTextStyle,
          color: C.accent,
          fontSize: 26,
          letterSpacing: 4,
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          ...baseTextStyle,
          fontSize: 70,
          fontWeight: 700,
          marginTop: 14,
          lineHeight: 1.1,
        }}
      >
        {title}
      </div>
    </FadeIn>
  );
}

function TeammateCard({
  name,
  role,
  bullets,
  delay,
}: {
  name: string;
  role: string;
  bullets: string[];
  delay: number;
}) {
  return (
    <FadeIn
      delay={delay}
      style={{
        background: C.panel,
        borderRadius: 22,
        padding: "32px 30px",
        flex: 1,
        border: `1px solid #1d2433`,
      }}
    >
      <div style={{ ...baseTextStyle, fontSize: 32, fontWeight: 700 }}>{name}</div>
      <div
        style={{
          ...baseTextStyle,
          fontSize: 22,
          color: C.accent,
          marginTop: 4,
          fontWeight: 600,
        }}
      >
        {role}
      </div>
      <ul
        style={{
          ...baseTextStyle,
          fontSize: 20,
          marginTop: 20,
          paddingLeft: 22,
          lineHeight: 1.45,
          color: C.ink,
        }}
      >
        {bullets.map((b, i) => (
          <li key={i} style={{ marginBottom: 10 }}>
            {b}
          </li>
        ))}
      </ul>
    </FadeIn>
  );
}

function Slide1Team() {
  return (
    <AbsoluteFill style={{ background: C.bg, padding: 64 }}>
      <SlideHeader kicker="Beta Super Hackathon · 2026-05-02" title="PreOpReel" />
      <FadeIn delay={14}>
        <div
          style={{
            ...baseTextStyle,
            fontSize: 28,
            color: C.dim,
            marginTop: 12,
            maxWidth: 1500,
            lineHeight: 1.3,
          }}
        >
          The 90-second pre-op explainer your surgeon never had time to make.
        </div>
      </FadeIn>
      <div style={{ display: "flex", gap: 22, marginTop: 56 }}>
        <TeammateCard
          delay={28}
          name="Yahya Alhinai"
          role="Builder · 12-stage worker"
          bullets={[
            "Owns Atlas director + Lyra vision-critic",
            "Vision pipelines + Postgres at scale",
            "yhinai/preopreel core orchestration",
          ]}
        />
        <TeammateCard
          delay={42}
          name="Nihal Nihalani"
          role="Founder · Critic-loop architect"
          bullets={[
            "Cornell CS · meta-agentic systems (Understudy, Telestudio)",
            "Ports the critic-loop pattern into PreOpReel",
            "AI agents + dev tools + SRE",
          ]}
        />
        <TeammateCard
          delay={56}
          name="Charlie Gillet"
          role="Builder · CriticHud + UX"
          bullets={[
            "Owns the 0:50–1:00 reject/regen choreography",
            "Frontend systems + ML interaction design",
            "Live HUD reading real Redis writes",
          ]}
        />
      </div>
      <Footer>
        Built on BytePlus Seed 2.0 · Seedream 4.0 · Seedance 1.0 Pro · Seed
        Speech 2.0 · Z.AI GLM · Butterbase · Submission code{" "}
        <span style={{ color: C.ink, fontWeight: 600 }}>butterbase0502</span>
      </Footer>
    </AbsoluteFill>
  );
}

function Slide2Product() {
  return (
    <AbsoluteFill style={{ background: C.bg, padding: 64 }}>
      <SlideHeader kicker="Product · what it does" title="Drop a procedure plan PDF." />
      <FadeIn delay={12}>
        <div
          style={{
            ...baseTextStyle,
            fontSize: 30,
            color: C.dim,
            marginTop: 6,
            maxWidth: 1700,
            lineHeight: 1.3,
          }}
        >
          90 seconds later, your patient watches a personalized,
          audit-trailed, anatomically-grounded explainer.
        </div>
      </FadeIn>
      <div style={{ display: "flex", gap: 28, marginTop: 50 }}>
        <FadeIn
          delay={26}
          style={{
            flex: 1,
            background: C.panel,
            borderRadius: 22,
            padding: 32,
            border: `1px solid #1d2433`,
          }}
        >
          <div style={{ ...baseTextStyle, fontSize: 26, color: C.bad, fontWeight: 700 }}>
            Problem
          </div>
          <ul
            style={{
              ...baseTextStyle,
              fontSize: 21,
              lineHeight: 1.5,
              marginTop: 16,
              paddingLeft: 22,
            }}
          >
            <li style={{ marginBottom: 10 }}>
              38% of US adults read below 6th-grade level. Consent forms are
              written at 12th grade.
            </li>
            <li style={{ marginBottom: 10 }}>
              Patients forget 40–80% of medical info immediately after
              consultation.
            </li>
            <li style={{ marginBottom: 10 }}>
              Inadequate-consent malpractice claims average{" "}
              <b style={{ color: C.ink }}>$580K per settlement</b>.
            </li>
            <li>
              Today: a printed PDF, a YouTube link, a 5-minute hallway chat.
              No one personalizes per patient.
            </li>
          </ul>
        </FadeIn>
        <FadeIn
          delay={42}
          style={{
            flex: 1,
            background: C.panel,
            borderRadius: 22,
            padding: 32,
            border: `1px solid #1d2433`,
          }}
        >
          <div style={{ ...baseTextStyle, fontSize: 26, color: C.good, fontWeight: 700 }}>
            Our solution
          </div>
          <ul
            style={{
              ...baseTextStyle,
              fontSize: 21,
              lineHeight: 1.5,
              marginTop: 16,
              paddingLeft: 22,
            }}
          >
            <li style={{ marginBottom: 10 }}>
              <b style={{ color: C.ink }}>6-agent team</b> — Atlas (Seed
              2.0/GLM) drafts, Mara (GLM-5.1) critiques, Lyra
              (vision) re-critiques. Different model families disagreeing.
            </li>
            <li style={{ marginBottom: 10 }}>
              <b style={{ color: C.ink }}>Tier-0 Seedream anchoring</b> before
              every Seedance call → no anatomical hallucination. Lyra reject +
              regen on stage at 0:50.
            </li>
            <li>
              <b style={{ color: C.ink }}>Audit-trail PDF</b> — every claim
              cites procedure-plan §2.3 or PMID. Communication tool, not a
              medical device.
            </li>
          </ul>
        </FadeIn>
      </div>
      <Footer>
        Buyer: surgical malpractice carriers (TAM ~$4B/yr) · Wedge: $99 per
        explainer vs $5K–$25K bespoke · Deployed on Butterbase
      </Footer>
    </AbsoluteFill>
  );
}

function Slide3Demo() {
  return (
    <AbsoluteFill style={{ background: C.bg, padding: 64 }}>
      <SlideHeader kicker="Demo · live pipeline" title="Synthetic-phantom hip replacement, end-to-end." />
      <FadeIn delay={14}>
        <div
          style={{
            ...baseTextStyle,
            fontSize: 26,
            color: C.dim,
            marginTop: 14,
            maxWidth: 1700,
            lineHeight: 1.4,
          }}
        >
          The CriticHud at 0:50 reads real Redis writes from the actual
          ForgeRun — no animation theater. Beat 3 is deliberately scored 0.71
          on first attempt to show Lyra reject + regen. Audit-trail PDF
          exports at 1:00.
        </div>
      </FadeIn>
      <FadeIn
        delay={32}
        style={{
          marginTop: 50,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 22,
        }}
      >
        {[
          { t: "Stage 4 · Mara", c: C.warn, d: "advice_creep block on shot_3 → Atlas redrafts in 1 round" },
          { t: "Stage 10 · Lyra", c: C.bad, d: "anatomical_fidelity 0.71 < 0.75 → regen → 0.86" },
          { t: "Stage 12 · Audit PDF", c: C.good, d: "every on-screen claim cites plan §X or PMID" },
        ].map((b, i) => (
          <div
            key={i}
            style={{
              background: C.panel,
              borderRadius: 22,
              padding: 28,
              border: `1px solid #1d2433`,
            }}
          >
            <div style={{ ...baseTextStyle, fontSize: 22, color: b.c, fontWeight: 700 }}>
              {b.t}
            </div>
            <div
              style={{
                ...baseTextStyle,
                fontSize: 22,
                color: C.ink,
                marginTop: 12,
                lineHeight: 1.4,
              }}
            >
              {b.d}
            </div>
          </div>
        ))}
      </FadeIn>
      <FadeIn delay={60}>
        <div
          style={{
            ...baseTextStyle,
            fontSize: 28,
            color: C.accent,
            marginTop: 50,
            fontWeight: 600,
          }}
        >
          github.com/nihalnihalani/preopreel · preopreel.butterbase.dev ·
          submission code{" "}
          <span style={{ color: C.ink }}>butterbase0502</span>
        </div>
      </FadeIn>
      <Footer>
        Beta Super Hackathon · 2026-05-02 · Computer History Museum, Mountain
        View
      </Footer>
    </AbsoluteFill>
  );
}

export const SubmissionDeck: React.FC = () => {
  const { fps } = useVideoConfig();
  void fps;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence from={0} durationInFrames={SLIDE_FRAMES}>
        <Slide1Team />
      </Sequence>
      <Sequence from={SLIDE_FRAMES} durationInFrames={SLIDE_FRAMES}>
        <Slide2Product />
      </Sequence>
      <Sequence from={SLIDE_FRAMES * 2} durationInFrames={SLIDE_FRAMES}>
        <Slide3Demo />
      </Sequence>
    </AbsoluteFill>
  );
};

export const SubmissionSlide1: React.FC = () => <Slide1Team />;
export const SubmissionSlide2: React.FC = () => <Slide2Product />;
export const SubmissionSlide3: React.FC = () => <Slide3Demo />;
