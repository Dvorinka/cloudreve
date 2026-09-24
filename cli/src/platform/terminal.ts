import type { Readable, Writable } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { CliError } from "../output/errors.js";

export interface Terminal {
  presentation?: { width: number; color: boolean };
  write(value: string | Uint8Array): Promise<void>;
  diagnostic(value: string): Promise<void>;
  input(limit: number): Promise<Buffer>;
  secret(label: string): Promise<string>;
  confirm(label: string): Promise<boolean>;
}

export function presentation(
  stream: Writable,
  env: NodeJS.ProcessEnv = process.env,
): { width: number; color: boolean } {
  const tty = stream as WriteStream;

  return {
    width:
      tty.isTTY && Number.isInteger(tty.columns) && tty.columns > 0
        ? Math.max(20, Math.min(240, tty.columns))
        : 80,
    color: !!tty.isTTY && env.NO_COLOR === undefined && env.TERM !== "dumb",
  };
}

export function writeTo(
  stream: Writable,
  value: string | Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new CliError("cancelled", "Output cancelled", 1));
  }

  return new Promise((resolve, reject) => {
    const abort = () => {
      stream.destroy();
      reject(new CliError("cancelled", "Output cancelled", 1));
    };

    signal?.addEventListener("abort", abort, { once: true });

    stream.write(value, (e) => {
      signal?.removeEventListener("abort", abort);

      if (e) {
        reject(e);
      } else {
        resolve();
      }
    });
  });
}

export function terminal(
  stdin: Readable,
  stdout: Writable,
  stderr: Writable,
  prompts: boolean,
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Terminal {
  const allowed =
    prompts &&
    (stdin as ReadStream).isTTY &&
    (stdout as WriteStream).isTTY &&
    (stderr as WriteStream).isTTY;

  async function input(limit: number): Promise<Buffer> {
    if (signal?.aborted) {
      throw new CliError("cancelled", "Input cancelled", 1);
    }

    const abort = () => stdin.destroy(new CliError("cancelled", "Input cancelled", 1));

    signal?.addEventListener("abort", abort, { once: true });

    try {
      const chunks: Buffer[] = [];
      let length = 0;

      for await (const c of stdin) {
        const b = Buffer.from(c);

        length += b.length;

        if (length > limit) {
          throw new CliError("input", "Input exceeds size limit");
        }

        chunks.push(b);
      }

      return Buffer.concat(chunks);
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async function ask(label: string, hidden: boolean): Promise<string | boolean> {
    if (!allowed) {
      throw new CliError(
        "input",
        "Interactive input unavailable; supply the documented stdin option or --yes",
      );
    }

    if (signal?.aborted) {
      throw new CliError("cancelled", "Input cancelled", 1);
    }

    const { password, confirm } = await import("@inquirer/prompts");

    try {
      return hidden
        ? await password({ message: label }, { input: stdin, output: stderr, signal })
        : await confirm(
            { message: label, default: false },
            { input: stdin, output: stderr, signal },
          );
    } catch (error) {
      if (error instanceof Error && ["ExitPromptError", "AbortPromptError"].includes(error.name)) {
        throw new CliError(
          "cancelled",
          "Input cancelled",
          error.name === "ExitPromptError" ? 130 : 1,
        );
      }

      throw error;
    }
  }

  return {
    presentation: presentation(stdout, env),
    write: (v) => writeTo(stdout, v, signal),
    diagnostic: (v) => writeTo(stderr, v),
    input,
    secret: async (label) => String(await ask(label, true)),
    confirm: async (label) => Boolean(await ask(label, false)),
  };
}
