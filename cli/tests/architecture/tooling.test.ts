import { ESLint } from "eslint";
import { readFileSync } from "node:fs";
import { resolveConfig } from "prettier";
import { expect, it } from "vitest";

it(
  "checks typed promise safety and modern syntax without narrowing to application folders",
  async () => {
    const eslint = new ESLint();

    const [typed] = await eslint.lintText(
      `export async function example() {
      Promise.resolve(1);
      setTimeout(async () => { await Promise.resolve(); }, 0);
      await 1;
    }`,
      { filePath: "src/compatibility.ts" },
    );

    expect(typed!.messages.map((message) => message.ruleId)).toEqual(
      expect.arrayContaining([
        "@typescript-eslint/no-floating-promises",
        "@typescript-eslint/no-misused-promises",
        "@typescript-eslint/await-thenable",
      ]),
    );

    const [config] = await eslint.lintText('var value = 1; if (value == "1") console.log(value);', {
      filePath: "stryker.config.mjs",
    });

    expect(config!.messages.map((message) => message.ruleId)).toEqual(
      expect.arrayContaining(["no-var", "eqeqeq", "curly"]),
    );

    expect(await resolveConfig("src/main.ts")).toMatchObject({ printWidth: 100, endOfLine: "lf" });

    const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));

    expect(scripts.format).toContain("prettier --write .");
    expect(scripts.lint).toContain("eslint . --max-warnings 0");
    expect(scripts["format:check"]).toContain("ruff format --check .");
    expect(scripts["lint:shell"]).toContain("shellcheck");
    expect(scripts["lint:toml"]).toContain("taplo lint");
  },
  process.platform === "win32" ? 30000 : 15000,
);

it("separates structural boundaries while keeping related short declarations together", async () => {
  const source = `import { join } from "node:path";
import { resolve } from "node:path";
export interface Options { name: string; }
export type Name = string;
export class Example {
  first = "a";
  second = "b";
  constructor() {}
  path() { return join(this.first, this.second); }
  absolute() { return resolve(this.path()); }
}
export function example(options: Options): Name {
  options.name = options.name.trim();
  const first = options.name;
  const second = first.trim();
  const helper = () => second;
  const result = helper();
  // Validate the prepared value.
  if (!result) { throw new Error("Missing name"); }
  return result;
}`;

  const filePath = "src/platform/state.ts";
  const eslint = new ESLint();
  const [original] = await eslint.lintText(source, { filePath });

  expect(original!.messages.map((message) => message.ruleId)).toEqual(
    expect.arrayContaining([
      "@stylistic/padding-line-between-statements",
      "@stylistic/lines-between-class-members",
      "@stylistic/lines-around-comment",
    ]),
  );

  const [fixed] = await new ESLint({ fix: true }).lintText(source, { filePath });

  expect(fixed!.output).toContain('from "node:path";\n\nexport interface');
  expect(fixed!.output).toContain('first = "a";\n  second = "b";\n\n  constructor');
  expect(fixed!.output).toContain("constructor() {}\n\n  path()");
  expect(fixed!.output).toContain("options.name = options.name.trim();\n\n  const first");

  expect(fixed!.output).toContain(
    "const first = options.name;\n  const second = first.trim();\n\n  const helper",
  );

  expect(fixed!.output).toContain("const result = helper();\n\n  // Validate");
  expect(fixed!.output).toContain("}\n\n  return result;");

  const { format } = await import("prettier");

  const formatted = await format(fixed!.output!, {
    ...(await resolveConfig(filePath)),
    filepath: filePath,
  });

  const [checked] = await eslint.lintText(formatted, { filePath });

  expect(checked!.messages.filter((message) => message.ruleId?.startsWith("@stylistic/"))).toEqual(
    [],
  );

  const [secondPass] = await new ESLint({ fix: true }).lintText(formatted, { filePath });

  expect(secondPass!.output).toBeUndefined();
});
