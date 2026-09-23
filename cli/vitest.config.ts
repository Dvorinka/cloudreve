import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: process.platform === "win32" ? 30000 : 5000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
});
