import * as v from "valibot";
import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import atomicWrite from "write-file-atomic";
import { endpoint } from "../connection.js";
import { CliError } from "../output/errors.js";
import { windowsPrivacy } from "./private-permissions.js";

export interface Connection {
  id?: string;
  endpoint: string;
  accountId?: string;
  authContext?: string;
  loginRevision?: string;
  email?: string;
  credentialStore: "keychain" | "file" | "native";
}

export interface Config {
  version: 1;
  selected?: string;
  profiles: Record<string, Connection>;
}

const activeLease = new AsyncLocalStorage<AbortSignal>();

export class State {
  readonly directory: string;
  private prepared?: { identity: string; verified: Promise<void> };
  private verified = new Set<string>();

  get signal() {
    return activeLease.getStore();
  }

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  private path(name: string): string {
    if (!/^[\w.-]{1,180}$/.test(name) || name === "." || name === "..") {
      throw new CliError("state", "Invalid state key");
    }

    return join(this.directory, name);
  }

  private async prepare(): Promise<void> {
    const created = await mkdir(this.directory, { recursive: true, mode: 0o700 });

    const info = await lstat(this.directory);

    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    ) {
      throw new CliError("config", "Config directory must be private (mode 700)");
    }

    if (process.platform === "win32") {
      const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;

      if (this.prepared?.identity !== identity) {
        this.verified.clear();

        this.prepared = {
          identity,
          verified: windowsPrivacy(this.directory, created !== undefined, true),
        };
      }

      await this.prepared.verified;
    }
  }

  async read<T>(name: string, fallback: T): Promise<T> {
    activeLease.getStore()?.throwIfAborted();

    const path = this.path(name);

    try {
      const info = await lstat(path);

      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        (process.platform !== "win32" && (info.mode & 0o077) !== 0)
      ) {
        throw new CliError("config", "State must be a regular private file (mode 600)");
      }

      if (process.platform === "win32") {
        await this.prepare();

        if (!this.verified.has(path)) {
          await windowsPrivacy(path);
          this.verified.add(path);
        }
      }

      if (info.size > 16 * 1024 * 1024) {
        throw new CliError("state", "Saved state exceeds size limit");
      }

      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return fallback;
      }

      throw error;
    }
  }

  async write(name: string, value: unknown): Promise<void> {
    await this.prepare();

    const path = this.path(name);

    try {
      const info = await lstat(path);

      if (!info.isFile() || info.isSymbolicLink()) {
        throw new CliError("state", "State destination must be a regular file");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    activeLease.getStore()?.throwIfAborted();

    const content = JSON.stringify(value) + "\n";

    if (Buffer.byteLength(content) > 16 * 1024 * 1024) {
      throw new CliError("state", "Saved state exceeds size limit");
    }

    await atomicWrite(path, content, {
      mode: 0o600,
      fsync: true,
    });

    this.verified.add(path);
  }

  async exclusive<T>(name: string, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.prepare();

    const inherited = activeLease.getStore();

    const path = this.path(name);
    const controller = new AbortController();

    const combined = AbortSignal.any([
      controller.signal,
      ...(inherited ? [inherited] : []),
      ...(signal ? [signal] : []),
    ]);

    const deadline = performance.now() + 15000;
    let release: (() => Promise<void>) | undefined;

    while (!release) {
      combined.throwIfAborted();

      try {
        release = await lockfile.lock(path, {
          realpath: false,
          stale: 10000,
          update: 2000,
          retries: 0,
          onCompromised: (error) => controller.abort(error),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ELOCKED") {
          throw error;
        }

        if (performance.now() >= deadline) {
          throw new CliError("busy", "Timed out waiting for state transaction", 1);
        }

        await delay(20, undefined, { signal: combined });
      }
    }

    try {
      return await activeLease.run(combined, async () => {
        combined.throwIfAborted();

        const result = await operation();

        combined.throwIfAborted();

        return result;
      });
    } finally {
      if (combined.aborted) {
        await release().catch(() => {});
      } else {
        await release();
      }
    }
  }

  async transaction<T>(
    name: string,
    fallback: T,
    update: (value: T) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.exclusive(
      name,
      async () => {
        const value = await update(await this.read(name, fallback));

        await this.write(name, value);

        return value;
      },
      signal,
    );
  }

  async config(): Promise<Config> {
    return validateConfig(await this.read("config.json", { version: 1, profiles: {} }));
  }
}

const ProfileSchema = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/));

const ConnectionSchema = v.looseObject({
  id: v.optional(v.pipe(v.string(), v.minLength(1))),
  endpoint: v.string(),
  accountId: v.optional(v.pipe(v.string(), v.minLength(1))),
  email: v.optional(v.string()),
  loginRevision: v.optional(v.pipe(v.string(), v.minLength(1))),
  authContext: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(16384))),
  credentialStore: v.picklist(["keychain", "file", "native"]),
});

const ConfigSchema = v.looseObject({
  version: v.literal(1),
  selected: v.optional(ProfileSchema),
  profiles: v.pipe(
    v.unknown(),
    v.check((value) => typeof value === "object" && value !== null && !Array.isArray(value)),
    v.record(ProfileSchema, ConnectionSchema),
  ),
});

export function validateConfig(value: unknown): Config {
  const result = v.safeParse(ConfigSchema, value);

  if (!result.success) {
    throw new CliError("config", "Invalid configuration");
  }

  for (const profile of Object.values(result.output.profiles)) {
    profile.endpoint = endpoint(profile.endpoint);
  }

  return result.output;
}

export { endpoint, validateProfileName } from "../connection.js";
