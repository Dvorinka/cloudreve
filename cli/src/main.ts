import { CommanderError } from "commander";
import { type Context, compose } from "./composition.js";
import { CliError, errorResult } from "./output/errors.js";
import { format } from "./output/format.js";
import { type Invocation, createProgram, type ParsedInvocation } from "./program.js";
import { resolveOperand } from "./paths.js";
import { terminal, writeTo, presentation } from "./platform/terminal.js";

/** Execute one parsed command and render non-streaming results. */
export async function dispatch(c: Context): Promise<void> {
  const inv = c.inv as ParsedInvocation;

  if (!inv.execute) {
    throw new CliError("usage", "Missing command action");
  }

  const result = await inv.execute(c);

  if (!inv.stream) {
    await c.io.write(
      format(
        result,
        !!inv.flags.json,
        !!inv.flags["show-password"],
        inv.discloseUrls,
        inv.flags.timezone as string | undefined,
        {
          ...c.io.presentation,
          command: inv.command,
          args: inv.args,
          endpoint: c.config.profiles[c.name]?.endpoint,
          accountId: c.config.profiles[c.name]?.accountId,
        },
      ),
    );
  }
}

/** Reject conflicting input sources before any command side effects. */
export function validate(inv: Invocation): void {
  const count =
    [
      "password-stdin",
      "credential-stdin",
      "secrets-stdin",
      "share-password-stdin",
      "link-stdin",
      "sources-stdin",
    ].filter((k) => inv.flags[k]).length + (inv.flags.input === "-" ? 1 : 0);

  if (count > 1) {
    throw new CliError("usage", "Only one stdin input source can be selected");
  }

  if (inv.flags.cwd) {
    const v = String(inv.flags.cwd);

    if (!v.startsWith("/") || v.startsWith("//") || resolveOperand(v).kind !== "remote") {
      throw new CliError("usage", "--cwd must be an absolute remote directory");
    }
  }
}

/** Run an invocation with cancellation and return its process exit status. */
export async function run(argv: string[], host = process): Promise<number> {
  const controller = new AbortController();
  let signalStatus = 0;

  const int = () => {
    signalStatus = 130;
    controller.abort();
  };

  const term = () => {
    signalStatus = 143;
    controller.abort();
  };

  host.on("SIGINT", int);
  host.on("SIGTERM", term);

  let brokenPipe = false;

  const pipe = (error: NodeJS.ErrnoException) => {
    brokenPipe = error.code === "EPIPE";
    controller.abort();
  };

  host.stdout.on("error", pipe);

  let context: Context | undefined;
  const delimiter = argv.indexOf("--");
  const json = argv.slice(0, delimiter < 0 ? argv.length : delimiter).includes("--json");

  try {
    let helpOutput = "";

    const program = createProgram(
      async (inv) => {
        const io = terminal(
          host.stdin,
          host.stdout,
          host.stderr,
          !inv.flags.json &&
            !inv.flags["no-prompt"] &&
            host.env.CLOUDREVE_NO_PROMPT !== "1" &&
            !["password-stdin", "credential-stdin", "secrets-stdin", "input"].some(
              (key) => inv.flags[key],
            ),
          controller.signal,
          host.env,
        );

        validate(inv);
        context = await compose(inv, io, controller.signal, host.env);
        await dispatch(context);
      },
      (text) => {
        helpOutput += text;
      },
    );

    try {
      await program.parseAsync(argv.length ? argv : ["--help"], {
        from: "user",
      });
    } catch (error) {
      if (!(error instanceof CommanderError && error.exitCode === 0)) {
        throw error;
      }
    }

    if (helpOutput) {
      await writeTo(host.stdout, helpOutput, controller.signal);
    }

    return signalStatus;
  } catch (e) {
    const result = errorResult(
      e instanceof CommanderError ? new CliError("usage", e.message.replace(/^error: /, "")) : e,
      !!context?.inv.flags["show-lock-tokens"],
    );

    if (!brokenPipe && (e as NodeJS.ErrnoException)?.code !== "EPIPE") {
      await new Promise<void>((resolve) =>
        host.stderr.write(
          json
            ? `${JSON.stringify({ schemaVersion: 1, error: result.error })}\n`
            : format(result.error, false, false, false, undefined, {
                ...presentation(host.stderr, host.env),
                command: "error",
                endpoint: context?.config.profiles[context.name]?.endpoint,
                accountId: context?.config.profiles[context.name]?.accountId,
              }),
          () => resolve(),
        ),
      );
    }

    return signalStatus || (brokenPipe ? 1 : result.status);
  } finally {
    await context?.dispose();
    host.off("SIGINT", int);
    host.off("SIGTERM", term);
    host.stdout.off("error", pipe);
  }
}
