import { fileURLToPath } from "node:url";
import {
  nodeConfig,
  modernJavaScript,
  structuralSpacing,
  createTypedConfig,
} from "@cloudreve/quality/eslint";

export default [
  ...nodeConfig,
  modernJavaScript,
  structuralSpacing,
  createTypedConfig(fileURLToPath(new URL(".", import.meta.url))),
  {
    files: ["src/commands/**/*.ts", "src/program.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          globals: [
            "process",
            "console",
            "fetch",
            "XMLHttpRequest",
            "Bun",
            "Deno",
            "require",
            "eval",
            "Function",
          ],
          checkGlobalObject: true,
          globalObjects: ["global"],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='request']",
          message: "Command handlers use SDK resource operations.",
        },
        {
          selector: "CallExpression[callee.property.value='request']",
          message: "Command handlers use SDK resource operations.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@cloudreve/sdk/protocol",
              importNames: ["request"],
              message: "Command handlers use SDK resources, not raw request primitives.",
            },
          ],
          patterns: [
            {
              group: ["node:*", "../platform/*", "../../platform/*"],
              message: "Commands receive platform ports from composition.",
            },
          ],
        },
      ],
    },
  },
];
