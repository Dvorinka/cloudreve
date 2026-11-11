import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

it("keeps development and hosted workflows independent of act", () => {
  const tasks = readFileSync("mise.toml", "utf8");

  expect(tasks).toMatch(/\[tasks\.check\]\s+run = "bun run check"/);
  expect(tasks.split("[settings]")[0]).not.toMatch(/^act\s*=/m);
  const hook = readFileSync("lefthook.yml", "utf8");

  expect(hook).toContain('glob: "cli/**"');
  expect(hook).toContain("run: mise -C cli run check");

  // Vendored into the monorepo: the standalone-repo .github tree is stripped
  // and hosted coverage lives in the root CI workflow instead.
  expect(existsSync(".github")).toBe(false);

  const workflow = readFileSync("../.github/workflows/ci.yml", "utf8");

  expect(workflow).toMatch(/cli:\s*\n\s*- 'cli\/\*\*'/);
  expect(workflow).toMatch(/^ {2}cli:$/m);
  expect(workflow).toContain("working-directory: cli");
  expect(workflow).toContain("bun run check");

  expect(workflow).not.toMatch(/\bact\b/);
  expect(existsSync("scripts/ci/act.sh")).toBe(false);
  expect(existsSync("scripts/ci/check.sh")).toBe(false);
});
