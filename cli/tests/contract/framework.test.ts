import { expect, it } from "vitest";
import fc from "fast-check";
import { createProgram, parse } from "../../src/program.js";
import { remote } from "../../src/paths.js";
import { dispatch } from "../../src/main.js";
import { context } from "../commands/context.js";

it("uses one declared grammar for strict flags, help, global options and async action binding", async () => {
  for (const args of [
    ["stat", "/my/a", "--limit", "1"],
    ["cp", "a"],
    ["stat", "a", "b"],
    ["auth", "login", "--password-stdin", "--credential-stdin"],
  ]) {
    expect(() => parse(args)).toThrow();
  }

  expect(parse(["--json", "share", "view", "id"]).flags.json).toBe(true);
  expect(parse(["share", "view", "id", "--json"]).flags.json).toBe(true);
  expect(parse(["ls", "--no-prompt"]).flags["no-prompt"]).toBe(true);
  expect(parse(["stat", "--", "--json"]).args).toEqual(["--json"]);

  const calls: string[] = [];

  await createProgram(async (inv) => {
    await Promise.resolve();
    calls.push(inv.command);
  }).parseAsync(["stat", "/my/a"], { from: "user" });

  expect(calls).toEqual(["stat"]);
  await expect(dispatch(context().c)).rejects.toThrow("Missing command action");
});

it("preserves generated Unicode and punctuation path segments", () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom("资料", "%", "?", "#", "é", "😀", " ", "a", "...", "-"), {
        minLength: 1,
        maxLength: 30,
      }),
      (parts) => {
        const name = parts.join("");
        const uri = remote("/my/" + name);

        expect(uri.elements()).toEqual([name]);
        expect(remote(uri.toString()).elements()).toEqual([name]);
      },
    ),
    { numRuns: 300, seed: 14053 },
  );
});

it("rejects generated root traversal independently of path depth", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 40 }), (depth) => {
      const input =
        "/my/" +
        Array(depth).fill("dir").join("/") +
        "/" +
        Array(depth + 1)
          .fill("..")
          .join("/");

      expect(() => remote(input)).toThrow();
    }),
    { numRuns: 100, seed: 4412 },
  );
});
