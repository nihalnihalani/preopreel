import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Worker pulls in Remotion + esbuild + native compositors that Turbopack
  // can't statically resolve. Keep them as runtime require()s.
  serverExternalPackages: [
    "@remotion/renderer",
    "@remotion/bundler",
    "@remotion/compositor-darwin-arm64",
    "@remotion/compositor-darwin-x64",
    "@remotion/compositor-linux-arm64-gnu",
    "@remotion/compositor-linux-arm64-musl",
    "@remotion/compositor-linux-x64-gnu",
    "@remotion/compositor-linux-x64-musl",
    "@remotion/compositor-win32-x64-msvc",
    "esbuild",
    "pg",
    "ioredis",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
  },
  typedRoutes: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.butterbase.dev" },
      { protocol: "https", hostname: "*.butterbase.app" },
    ],
  },
  // Next 16 defaults to Turbopack. Empty turbopack config silences the
  // mixed-config warning when the webpack hook is also present (used
  // only by `next build --webpack`); native .node modules are routed
  // through Turbopack's built-in loader without extra config.
  turbopack: {},
  webpack: (cfg) => {
    cfg.module.rules.push({ test: /\.node$/, loader: "node-loader" });
    return cfg;
  },
};

export default config;
