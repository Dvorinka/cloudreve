import { it, expect, vi } from "vitest";
import { mkdtemp, writeFile, readFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("open", () => ({ default: vi.fn(async () => {}) }));
import open from "open";
import { openBrowser } from "../../src/platform/browser.js";

it("validates browser targets and delegates the OS default without a shell", async () => {
  const signal = new AbortController().signal;

  for (const url of ["file:///tmp/a", "https://user:secret@example.test"]) {
    await expect(openBrowser(url, signal)).rejects.toThrow("credential-free");
  }

  await openBrowser("https://example.test/auth", signal);

  expect(open).toHaveBeenCalledWith("https://example.test/auth", {
    wait: false,
  });

  const aborted = new AbortController();

  aborted.abort();
  await expect(openBrowser("https://example.test/auth", aborted.signal)).rejects.toThrow();

  await expect(
    openBrowser("https://example.test/auth", signal, "/nonexistent/cloudreve-browser"),
  ).rejects.toThrow();
});

it.skipIf(process.platform === "win32")(
  "passes a URL as one literal argument and cancels only its owned custom browser process",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "cr-browser-"));
    const script = join(dir, "browser");
    const output = join(dir, "output");

    await writeFile(
      script,
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({url:process.argv[2],pid:process.pid}));setInterval(()=>{},1000);`,
    );

    await chmod(script, 0o700);

    const controller = new AbortController();

    try {
      const url = "https://example.test/auth?literal=$(not-a-command)&value=one";

      await openBrowser(url, controller.signal, script);

      let result: { url: string; pid: number } | undefined;

      for (let i = 0; i < 300; i++) {
        try {
          result = JSON.parse(await readFile(output, "utf8"));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      expect(result?.url).toBe(url);
      controller.abort();

      let ended = false;

      for (let i = 0; i < 300; i++) {
        try {
          process.kill(result!.pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } catch {
          ended = true;
          break;
        }
      }

      expect(ended).toBe(true);
    } finally {
      controller.abort();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
