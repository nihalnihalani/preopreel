import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
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
