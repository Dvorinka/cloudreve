import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

it("keeps development and hosted workflows independent of act", () => {
  const tasks = readFileSync("mise.toml", "utf8");

  expect(tasks).toMatch(/\[tasks\.check\]\s+run = "bun run check"/);
  expect(tasks.split("[settings]")[0]).not.toMatch(/^act\s*=/m);
  expect(readFileSync("lefthook.yml", "utf8")).toContain("run: mise run check");

  const workflow = readFileSync(".github/workflows/check.yml", "utf8");

  expect(workflow).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
  expect(workflow).toContain("runs-on: ubuntu-latest");
  expect(workflow).toContain("name: cli-binary-Linux");

  for (const version of ["4.19.1", "4.19.0", "4.18.0"]) {
    expect(workflow).toContain(`version: ${version}`);
  }

  expect(workflow).not.toMatch(/^\s*container:/m);
  expect(workflow).not.toMatch(/\bact\b/);
  expect(readFileSync(".actrc", "utf8")).toContain("-P ubuntu-latest=");
  expect(existsSync(".github/workflows/maintenance.yml")).toBe(false);
  expect(existsSync("scripts/ci/check.sh")).toBe(false);
});
