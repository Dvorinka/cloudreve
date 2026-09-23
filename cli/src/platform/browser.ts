import open from "open";
import { spawn } from "node:child_process";
import { CliError } from "../output/errors.js";

export async function openBrowser(
  url: string,
  signal: AbortSignal,
  browser?: string,
): Promise<void> {
  const target = new URL(url);

  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    throw new CliError("usage", "Browser target must be a credential-free HTTP(S) URL");
  }

  signal.throwIfAborted();

  if (!browser) {
    await open(target.href, { wait: false });

    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(browser, [target.href], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    });

    const abort = () => child.kill("SIGTERM");

    signal.addEventListener("abort", abort, { once: true });
    child.once("error", reject);
    child.once("close", () => signal.removeEventListener("abort", abort));

    child.once("spawn", () => {
      if (signal.aborted) {
        abort();
      }

      child.unref();
      resolve();
    });
  });
}
