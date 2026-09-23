import { execFile, fork, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { decode } from "@cloudreve/sdk/protocol";
import { TokensSchema, type Tokens } from "@cloudreve/sdk/session";
import { CliError } from "../output/errors.js";
import type { Connection, State } from "./state.js";

declare const __CLOUDREVE_STANDALONE__: boolean;

/** Keep native vault calls in a killable process, including standalone executables. */
function nativeWorker() {
  const args = ["--cloudreve-native-vault"];
  const stdio: ["ignore", "ignore", "ignore", "ipc"] = ["ignore", "ignore", "ignore", "ipc"];

  return typeof __CLOUDREVE_STANDALONE__ !== "undefined" && __CLOUDREVE_STANDALONE__
    ? spawn(process.execPath, args, { stdio })
    : fork(new URL("../bin.js", import.meta.url), args, {
        execArgv: [],
        stdio,
      });
}

export function accountKey(
  endpoint: string,
  accountId: string,
  store: Connection["credentialStore"] = "file",
  authContext?: string,
): string {
  return (
    "account-" +
    createHash("sha256")
      .update(
        JSON.stringify([
          new URL(endpoint).origin,
          accountId,
          store,
          ...(authContext ? [authContext] : []),
        ]),
      )
      .digest("hex")
  );
}

export class Credentials {
  constructor(
    private state: State,
    private platform = process.platform,
  ) {}

  /** Select the OS credential vault without falling back to plaintext storage. */
  defaultStore(): Connection["credentialStore"] {
    return this.platform === "darwin" ? "keychain" : "native";
  }

  private service() {
    return "org.cloudreve.cli:" + createHash("sha256").update(this.state.directory).digest("hex");
  }

  async record(
    name: string,
    store: Connection["credentialStore"],
    signal?: AbortSignal,
  ): Promise<unknown> {
    this.validate(name);

    signal = this.state.signal
      ? AbortSignal.any([this.state.signal, ...(signal ? [signal] : [])])
      : signal;

    signal?.throwIfAborted();

    if (store === "file") {
      return this.state.read(name + ".credentials.json", null);
    }

    const raw =
      store === "native"
        ? await this.native(name, undefined, signal)
        : await this.keychain(name, undefined, signal);

    return raw === null ? null : JSON.parse(raw);
  }

  async put(
    name: string,
    store: Connection["credentialStore"],
    value: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    this.validate(name);

    signal = this.state.signal
      ? AbortSignal.any([this.state.signal, ...(signal ? [signal] : [])])
      : signal;

    signal?.throwIfAborted();

    if (store === "file") {
      await this.state.write(name + ".credentials.json", value);

      return;
    }

    const serialized = value === null ? null : JSON.stringify(value);

    if (store === "native") {
      await this.native(name, serialized, signal);
    } else {
      await this.keychain(name, serialized, signal);
    }
  }

  async get(
    name: string,
    store: Connection["credentialStore"],
    signal?: AbortSignal,
  ): Promise<Tokens | null> {
    const value = await this.record(name, store, signal);

    if (value === null) {
      return null;
    }

    try {
      return decode(TokensSchema, value, "Invalid saved credentials");
    } catch {
      throw new CliError("credentials", "Invalid saved credentials", 4);
    }
  }

  async save(
    name: string,
    store: Connection["credentialStore"],
    tokens: Tokens | null,
    signal?: AbortSignal,
  ) {
    await this.put(name, store, tokens, signal);
  }

  private validate(name: string) {
    if (!/^[\w-]{1,100}$/.test(name)) {
      throw new CliError("credentials", "Invalid credential key");
    }
  }

  private async keychain(
    name: string,
    secret?: string | null,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (this.platform !== "darwin") {
      throw new CliError(
        "credentials",
        "Native credential storage is unavailable; explicitly choose protected file storage",
      );
    }

    const service = this.service();

    const quote = (value: string) => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

    const args =
      secret === undefined
        ? ["find-generic-password", "-s", service, "-a", name, "-w"]
        : secret === null
          ? ["delete-generic-password", "-s", service, "-a", name]
          : ["-i"];

    const input =
      typeof secret === "string"
        ? `add-generic-password -U -s ${quote(service)} -a ${quote(name)} -w ${quote(secret)}\n`
        : undefined;

    return new Promise((resolve, reject) => {
      const child = execFile(
        "security",
        args,
        {
          encoding: "utf8",
          timeout: 15000,
          killSignal: "SIGKILL",
          maxBuffer: 131072,
          signal,
        },
        (error, stdout, stderr) => {
          if (error) {
            if (error.code === 44 && typeof secret !== "string") {
              resolve(null);

              return;
            }

            reject(
              new CliError("credentials", "macOS Keychain is locked, unavailable, or timed out", 1),
            );

            return;
          }

          if (secret !== undefined && /error|failed/i.test(stderr)) {
            reject(new CliError("credentials", "Unable to save macOS Keychain credential", 1));

            return;
          }

          resolve(secret === undefined ? stdout.trim() : null);
        },
      );

      child.stdin?.end(input);
    });
  }

  private native(
    name: string,
    value?: string | null,
    signal?: AbortSignal,
  ): Promise<string | null> {
    signal?.throwIfAborted();

    return new Promise((resolve, reject) => {
      const worker = nativeWorker();

      let settled = false;

      const finish = (error?: Error, result: string | null = null) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        worker.kill("SIGKILL");

        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      };

      const abort = () =>
        finish(new CliError("credentials", "Native credential operation cancelled", 1));

      const timer = setTimeout(
        () => finish(new CliError("credentials", "Native credential vault timed out", 1)),
        15000,
      );

      signal?.addEventListener("abort", abort, { once: true });

      worker.once("message", (message: { ok: boolean; value?: string | null }) =>
        message.ok
          ? finish(undefined, message.value ?? null)
          : finish(new CliError("credentials", "Native credential vault unavailable or locked", 1)),
      );

      worker.once("error", () =>
        finish(new CliError("credentials", "Native credential binding unavailable", 1)),
      );

      worker.once("exit", (code) => {
        if (!settled) {
          finish(new CliError("credentials", `Native credential worker exited (${code})`, 1));
        }
      });

      worker.send({ service: this.service(), key: name, value }, (error) => {
        if (error) {
          finish(new CliError("credentials", "Native credential channel unavailable", 1));
        }
      });
    });
  }
}
