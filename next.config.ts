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
  webpack: (cfg) => {
    cfg.module.rules.push({ test: /\.node$/, loader: "node-loader" });
    return cfg;
  },
};

export default config;
