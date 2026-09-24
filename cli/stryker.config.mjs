import { readFileSync } from "node:fs";

const lines = readFileSync("src/commands/transfers.ts", "utf8").split("\n");

const guard =
  lines.findIndex((line) => line.includes("t.checkpoint.accountId !== p.accountId")) + 1;

if (!guard) {
  throw Error("Transfer ownership guard moved; review mutation target");
}

const cursor =
  readFileSync("src/commands/files.ts", "utf8")
    .split("\n")
    .findIndex((line) => line.includes("token.context !== context")) + 1;

if (!cursor) {
  throw Error("Cursor context guard moved; review mutation target");
}

export default {
  mutate: [
    `src/commands/transfers.ts:${guard - 1}:0-${guard + 2}:100`,
    `src/commands/files.ts:${cursor}:0-${cursor}:200`,
  ],
  testRunner: "vitest",
  vitest: { configFile: "vitest.mutation.config.ts" },
  coverageAnalysis: "perTest",
  concurrency: 2,
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: ".artifacts/mutation.json" },
  thresholds: { high: 100, low: 100, break: 100 },
  tempDirName: ".artifacts/stryker",
};
