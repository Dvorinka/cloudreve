import { spawn } from "node:child_process";
import { CliError } from "../output/errors.js";

/** An explicit foreground executable owns inherited terminal I/O until it exits. */
export async function executeTool(
  executable: string,
  args: readonly string[],
  { signal }: { signal: AbortSignal },
): Promise<void> {
  signal.throwIfAborted();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      stdio: "inherit",
    });

    let failed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const abort = () => {
      child.kill("SIGTERM");

      // An editor/player may ignore graceful termination; still wait for close.
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      killTimer.unref();
    };

    signal.addEventListener("abort", abort, { once: true });

    child.once("error", () => {
      failed = true;
    });

    child.once("close", (code, termination) => {
      signal.removeEventListener("abort", abort);
      clearTimeout(killTimer);

      if (signal.aborted) {
        reject(signal.reason);
      } else if (failed) {
        reject(new CliError("external-tool", "Could not start external tool", 1));
      } else if (code !== 0) {
        reject(
          new CliError(
            "external-tool",
            `External tool exited with ${termination ? `signal ${termination}` : `status ${code}`}`,
            1,
          ),
        );
      } else {
        resolve();
      }
    });
  });
}
