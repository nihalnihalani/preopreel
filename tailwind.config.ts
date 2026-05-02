import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/remotion/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // "Clinical but not sterile" — warm grays, deep teal, clean white
        ink: { 950: "#0a0e14", 900: "#0f141b", 800: "#1a212c", 700: "#2a3340" },
        clinical: { 100: "#e8eef5", 300: "#9fb3c8", 500: "#486581", 700: "#243b53" },
        critic: { mara: "#c9384a", lyra: "#3aa792", accept: "#7ba055", warn: "#d49a3a" },
        seed: { 500: "#6b7eff" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "stream-in": "stream-in 0.4s ease-out",
      },
      keyframes: {
        "stream-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
