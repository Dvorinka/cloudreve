import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { executeTool } from "../../src/platform/external-tool.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "cr-tool-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const options = () => ({ signal: new AbortController().signal });

it("passes literal arguments without shell interpolation and waits for successful exit", async () => {
  const output = join(directory, "arguments.json");
  const marker = join(directory, "not-executed");

  const args = ["two words", "quote'\"", `$(touch ${marker})`, "; exit 7", "世界", "", "--flag"];

  await executeTool(
    process.execPath,
    [
      "-e",
      "require('node:fs').writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))",
      output,
      ...args,
    ],
    options(),
  );

  expect(JSON.parse(await readFile(output, "utf8"))).toEqual(args);
  await expect(stat(marker)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects nonzero and failed spawn without exposing argv", async () => {
  await expect(
    executeTool(process.execPath, ["-e", "process.exit(7)", "secret-value"], options()),
  ).rejects.toThrow("status 7");

  await expect(
    executeTool(join(directory, "missing-executable"), ["secret-value"], options()),
  ).rejects.toThrow("Could not start external tool");
});

it.skipIf(process.platform === "win32")("reports POSIX signal termination", async () => {
  await expect(
    executeTool(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], options()),
  ).rejects.toThrow("signal SIGTERM");
});

it("does not launch for an already cancelled invocation", async () => {
  const controller = new AbortController();

  controller.abort(new Error("cancelled before launch"));

  const output = join(directory, "must-not-exist");

  await expect(
    executeTool(
      process.execPath,
      ["-e", "require('node:fs').writeFileSync(process.argv[1], 'wrong')", output],
      { signal: controller.signal },
    ),
  ).rejects.toThrow("cancelled before launch");

  await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([false, true])(
  "waits for owned process exit when cancelling (ignores TERM: %s)",
  async (ignoreTerm) => {
    const controller = new AbortController();
    const ready = join(directory, "ready");

    const task = executeTool(
      process.execPath,
      [
        "-e",
        `${ignoreTerm ? "process.on('SIGTERM', () => {});" : ""}require('node:fs').writeFileSync(process.argv[1], String(process.pid));setInterval(() => {}, 1000)`,
        ready,
      ],
      { signal: controller.signal },
    );

    const outcome = task.then(
      () => null,
      (error: unknown) => error,
    );

    try {
      let pid: number | undefined;

      for (let attempt = 0; attempt < 200 && !pid; attempt++) {
        try {
          pid = Number(await readFile(ready, "utf8"));
        } catch {
          await delay(10);
        }
      }

      expect(pid).toBeGreaterThan(0);
      controller.abort(new Error("cancelled tool"));
      expect(await outcome).toMatchObject({ message: "cancelled tool" });
      expect(() => process.kill(pid!, 0)).toThrow();
    } finally {
      controller.abort();
      await outcome;
    }
  },
);
