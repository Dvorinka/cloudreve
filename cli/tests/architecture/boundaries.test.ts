import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("enforces the actual import graph", () => {
  execFileSync(
    "node",
    [
      "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
      "src",
      "--config",
      ".dependency-cruiser.cjs",
    ],
    { stdio: "pipe" },
  );
});

it("rejects actual forbidden command-to-platform edges including type imports", () => {
  const root = mkdtempSync(join(tmpdir(), "cr-arch-"));

  try {
    mkdirSync(join(root, "src", "commands"), { recursive: true });
    mkdirSync(join(root, "src", "platform"));

    writeFileSync(
      join(root, "src", "platform", "files.ts"),
      "export interface Bytes {size:number}",
    );

    writeFileSync(
      join(root, "src", "commands", "bad.ts"),
      'import type {Bytes} from "../platform/files.js"; export type Bad = Bytes;',
    );

    cpSync("tsconfig.json", join(root, "tsconfig.json"));
    cpSync(".dependency-cruiser.cjs", join(root, ".dependency-cruiser.cjs"));

    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/dependency-cruiser/bin/dependency-cruise.mjs"),
        "src",
        "--config",
        ".dependency-cruiser.cjs",
      ],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("commands-no-platform-imports");
  } finally {
    rmSync(root, { recursive: true });
  }
});

it(
  "uses scope-aware ESLint policies for forbidden command globals and imports",
  async () => {
    const { ESLint } = await import("eslint");

    const eslint = new ESLint({
      overrideConfigFile: resolve("eslint.config.mjs"),
    });

    for (const source of [
      "process.exit(1);",
      'globalThis.fetch("https://invalid.test");',
      'global.fetch("https://invalid.test");',
      'client.request("/wire");',
      'client["request"]("/wire");',
      'import {request} from "@cloudreve/sdk/protocol";request();',
      'import fs from "node:fs";fs.readFileSync("x");',
    ]) {
      for (const filePath of ["src/commands/files.ts", "src/program.ts"]) {
        const [result] = await eslint.lintText(source, { filePath });

        expect(result?.messages.some((m) => m.ruleId?.startsWith("no-restricted-"))).toBe(true);
      }
    }

    const [result] = await eslint.lintText(
      "export function local(process: string) {return process;}",
      { filePath: "src/commands/files.ts" },
    );

    expect(result?.messages.filter((m) => m.ruleId === "no-restricted-globals")).toEqual([]);
  },
  process.platform === "win32" ? 30000 : 15000,
);

it("pins Foundation and SDK dependencies to published releases", async () => {
  const { readFileSync } = await import("node:fs");
  const metadata = JSON.parse(readFileSync("package.json", "utf8"));

  for (const name of ["@cloudreve/quality", "@cloudreve/testkit", "@cloudreve/sdk"]) {
    const reference = metadata.devDependencies?.[name] ?? metadata.dependencies?.[name];

    const installed = JSON.parse(
      readFileSync(resolve("node_modules", name, "package.json"), "utf8"),
    );

    expect(reference).toMatch(
      /^https:\/\/github\.com\/cloudreve\/(foundation|sdk)\/releases\/download\/v\d+\.\d+\.\d+\/cloudreve-[a-z]+-\d+\.\d+\.\d+\.tgz$/,
    );

    expect(reference).toContain(`/v${installed.version}/`);
    expect(installed.name).toBe(name);
  }
});

it("formatter ignores generated clones while checking owned source", () => {
  const root = mkdtempSync(join(tmpdir(), "cr-format-"));

  try {
    cpSync(".prettierignore", join(root, ".prettierignore"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/good.ts"), "export const value = 1;\n");

    for (const folder of [".artifacts", ".runtime", "dist", "coverage", "vendor"]) {
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, folder, "invalid.ts"), "export const = ;");
    }

    const command = [resolve("node_modules/prettier/bin/prettier.cjs"), "--check", "."];

    expect(spawnSync(process.execPath, command, { cwd: root }).status).toBe(0);
    writeFileSync(join(root, "src/bad.ts"), "export const = ;");
    expect(spawnSync(process.execPath, command, { cwd: root }).status).not.toBe(0);
  } finally {
    rmSync(root, { recursive: true });
  }
});
