// app/layout.tsx — root layout.
//
// Loads Inter + JetBrains Mono variable fonts, forces dark mode for May 2,
// wraps children in TanstackQueryProvider, mounts the global Navbar.
//
// Per plan 04 §A.1: dark mode default, no light-mode toggle. The HTML root
// has the `dark` class hard-coded so server-rendered UI never flashes
// light-mode colors on stage projectors.

import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { TanstackQueryProvider } from "@/components/TanstackQueryProvider";
import { Navbar } from "@/components/Navbar";
import { DebugInvariantPanel } from "@/components/DebugInvariantPanel";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "PreOpReel — AI Pre-Operative Patient Explainer",
  description:
    "The 90-second animated explainer your surgeon never had time to make. " +
    "Anatomically grounded, citation-bound, audited by a critic loop.",
  keywords: [
    "preopreel",
    "pre-operative explainer",
    "surgical patient education",
    "ai video pipeline",
    "audit trail",
    "BytePlus Seed",
    "Butterbase",
  ],
  authors: [{ name: "PreOpReel team" }],
  openGraph: {
    title: "PreOpReel — AI Pre-Operative Patient Explainer",
    description:
      "Drop a procedure plan + patient card. Get a personalized 90-second " +
      "explainer with a citation-bound audit trail.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${jetBrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-ink-950 font-sans text-clinical-100 antialiased">
        <TanstackQueryProvider>
          <Navbar />
          <main className="min-h-[calc(100vh-3.5rem)]">{children}</main>
          {/* Mara G.3: invariant debug panel; hidden unless
              NEXT_PUBLIC_SHOW_INVARIANT_CHECKS=1 in env. Cmd+I toggles. */}
          <DebugInvariantPanel />
        </TanstackQueryProvider>
      </body>
    </html>
  );
}
