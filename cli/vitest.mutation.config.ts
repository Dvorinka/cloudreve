import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/commands/transfers.test.ts", "tests/commands/files.test.ts"],
  },
});
