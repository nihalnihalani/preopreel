import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/test_*.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: { reporter: ["text", "html"] },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@worker": path.resolve(__dirname, "./apps/synthesis-worker"),
      "@bb": path.resolve(__dirname, "./butterbase"),
    },
  },
});
