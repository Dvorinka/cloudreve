import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

/** Async execution keeps the fixture's TCP bridge responsive while the CLI runs. */
export function commands({
  bin,
  binary = false,
  temp,
  config,
  requiredCommands,
  requiredVariants,
}) {
  const invocations = [];
  const proofs = [];
  const transcripts = [];
  const secrets = new Set();
  const navigationOrigins = new Set();
  const children = new Set();

  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

  const safe = (value) => {
    let result = String(value);

    for (const secret of secrets) {
      if (secret) {
        result = result.split(secret).join("[redacted]");
      }
    }

    return result
      .replace(/https?:\/\/[^\s"<>]+/g, (value) => {
        try {
          const url = new URL(value);
          const path = url.searchParams.get("path");
          const open = url.searchParams.get("open");

          const safeUri = (value) => {
            const uri = new URL(value);

            return (
              uri.protocol === "cloudreve:" &&
              ["my", "trash", "shared_with_me", "share"].includes(uri.hostname) &&
              !uri.password &&
              !uri.hash &&
              !uri.port &&
              [...uri.searchParams.keys()].every((key) => key === "name")
            );
          };

          if (
            navigationOrigins.has(url.origin) &&
            url.pathname === "/home" &&
            !url.username &&
            !url.password &&
            !url.hash &&
            path &&
            safeUri(path) &&
            [...url.searchParams.keys()].every((key) => ["path", "open"].includes(key)) &&
            (!open || /^[a-zA-Z0-9_-]+$/.test(open) || safeUri(open))
          ) {
            return "https://cloud.example.test" + url.pathname + url.search;
          }
        } catch {
          /* Every unrecognized URL remains private. */
        }

        return "[URL]";
      })
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]");
  };

  async function run(path, args = [], options = {}) {
    const actual = [...path.split(" "), ...args, "--config-dir", config, "--no-prompt"];

    if (options.profile !== false) {
      actual.push("--profile", options.profile ?? "primary");
    }

    if (options.json !== false) {
      actual.push("--json");
    }

    const env = { ...process.env, CLOUDREVE_CONFIG_DIR: config };

    if (options.tty) {
      env.TERM = "xterm-256color";
      delete env.NO_COLOR;

      if (options.noColor) {
        env.NO_COLOR = "1";
      }
    }

    const executable = binary ? bin : process.execPath;
    const commandArgs = binary ? actual : [bin, ...actual];

    const child = spawn(
      options.tty ? "python3" : executable,
      options.tty
        ? [
            fileURLToPath(new URL("./terminal-capture.py", import.meta.url)),
            String(options.columns ?? 100),
            executable,
            ...commandArgs,
          ]
        : commandArgs,
      {
        cwd: temp,
        env,
        detached: !!options.tty,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const terminate = () => {
      if (options.tty) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") {
            throw error;
          }
        }
      } else {
        child.kill("SIGKILL");
      }
    };

    children.add(terminate);
    options.onStart?.(child);

    const stdout = [];
    const stderr = [];

    let size = 0;
    let timedOut = false;
    let inputError;

    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeout ?? 120000);

    child.stdout.on("data", (chunk) => {
      options.onStdout?.(chunk);
      size += chunk.length;

      if (size > 32 * 1024 * 1024) {
        inputError = new Error("CLI output exceeds bounded receipt budget");
        terminate();
      } else {
        stdout.push(chunk);
      }
    });

    child.stderr.on("data", (chunk) => {
      size += chunk.length;

      if (size > 32 * 1024 * 1024) {
        inputError = new Error("CLI output exceeds bounded receipt budget");
        terminate();

        return;
      }

      stderr.push(chunk);

      try {
        options.dynamicInput?.(chunk.toString(), child.stdin);
      } catch (error) {
        inputError = error;
        terminate();
      }
    });

    if (!options.dynamicInput) {
      child.stdin.end(options.input);
    }

    child.stdin.on("error", () => {});

    const status = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    }).finally(() => {
      clearTimeout(timer);
      children.delete(terminate);
    });

    const out = Buffer.concat(stdout);
    const err = Buffer.concat(stderr).toString();

    invocations.push({
      path,
      variant: options.variant ?? "default",
      status,
      stdoutSha256: hash(out),
      stdoutBytes: out.length,
      stderr: safe(err),
      timedOut,
    });

    if (options.json === false && options.capture !== false) {
      const text = out.toString("utf8");

      const binary =
        !Buffer.from(text).equals(out) || out.some((byte) => byte < 9 || (byte > 13 && byte < 27));

      transcripts.push({
        path,
        variant: options.variant ?? "default",
        status,
        argv: actual.map(safe),
        terminal: options.tty ? { columns: options.columns ?? 100, color: !options.noColor } : null,
        stdout: binary ? null : safe(text),
        stderr: safe(err),
        binary,
        stdoutBytes: out.length,
        stdoutSha256: hash(out),
        input: options.input === undefined ? undefined : "[stdin supplied; contents omitted]",
      });
    }

    if (inputError) {
      throw inputError;
    }

    assert(!timedOut, `${path} timed out`);

    if (options.expect === "nonzero") {
      assert.notEqual(status, 0, `${path} unexpectedly succeeded`);
    } else {
      assert.equal(status, options.expect ?? 0, `${path}: ${safe(err)}`);
    }

    let data;

    if (options.json !== false && options.parseJson !== false && status === 0 && out.length) {
      const parsed = JSON.parse(out.toString());

      assert.equal(parsed.schemaVersion, 1);
      data = parsed.data;
    }

    return { data, stdout: out, stderr: err, status };
  }

  function prove(path, variant = "default", detail) {
    assert(
      invocations.some((item) => item.path === path && item.variant === variant),
      `No invocation for ${path}/${variant}`,
    );

    assert(detail, "A proof must describe its actual oracle");
    proofs.push({ path, variant, detail: safe(detail) });
  }

  function complete() {
    const missing = requiredCommands.filter((path) => !proofs.some((item) => item.path === path));

    const variants = requiredVariants.filter(
      (value) => !proofs.some((item) => item.path === value.path && item.variant === value.variant),
    );

    assert.deepEqual(missing, [], "Missing real command proofs");
    assert.deepEqual(variants, [], "Missing simplified variant proofs");

    return { invocations, proofs };
  }

  return {
    run,
    prove,
    complete,
    invocations,
    proofs,
    transcripts,
    secret: (...values) => values.forEach((value) => secrets.add(value)),
    navigation: (endpoint) => navigationOrigins.add(new URL(endpoint).origin),
    stop: () => {
      for (const terminate of children) {
        terminate();
      }
    },
    safe,
  };
}
