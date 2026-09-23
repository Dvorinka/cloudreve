import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createProgram } from "../../src/program.js";

it("reports the package release version", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));

  expect(createProgram().version()).toBe(`cr ${manifest.version}`);
});
