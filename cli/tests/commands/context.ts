import { CrUri } from "@cloudreve/sdk/files";
import { vi } from "vitest";
import type { Context } from "../../src/composition.js";
import { parse } from "../../src/program.js";

export function context(argv: string[] = []) {
  const data: Record<string, unknown> = {};

  const file = {
    id: "f",
    name: "a",
    path: "cloudreve://my/a",
    type: 0,
    size: 1,
    primary_entity: "v",
    created_at: "",
    updated_at: "",
  };

  const files = {
    iterate: vi.fn(async function* (..._args: unknown[]) {
      yield file;
    }),
    listStream: vi.fn(async function* (
      ...args: unknown[]
    ): AsyncGenerator<{ type: "list"; directory: unknown } | { type: "file"; files: unknown[] }> {
      yield { type: "list", directory: await files.list(...args) };
    }),
    urls: vi.fn(async (..._args: unknown[]) => ["https://storage.test/fixture"]),
    infoIfExists: vi.fn(async (..._args: unknown[]) => file),
    resolveDestination: vi.fn(async (..._args: unknown[]) => ({
      uri: "cloudreve://my/destination/a",
      parent: "cloudreve://my/destination",
    })),
    copyTo: vi.fn(async (..._args: unknown[]) => ({
      uri: "cloudreve://my/b",
      operation: "move",
    })),
    info: vi.fn(async () => file),
    list: vi.fn(async (..._args: unknown[]) => ({
      files: [file],
      pagination: { page: 0, page_size: 100, total_items: 1 },
      props: {},
      storage_policy: { id: "p", type: "local" },
    })),
    create: vi.fn(async () => file),
    rename: vi.fn(),
    move: vi.fn(),
    delete: vi.fn(),
    restore: vi.fn(),
    emptyTrash: vi.fn(),
    readText: vi.fn(async () => ({ entity: "v" })),
    saveText: vi.fn(async () => file),
    metadata: vi.fn(),
    unlock: vi.fn(),
    customProperties: vi.fn(async () => []),
    events: vi.fn(async function* () {
      yield { type: "subscribed" };
      yield { type: "event", data: { uri: "cloudreve://my/a" } };
    }),
    promoteVersion: vi.fn(),
    deleteVersion: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
    patchView: vi.fn(),
    fullTextSearch: vi.fn(async () => ({ hits: [], total: 0 })),
    viewers: vi.fn(async () => []),
    viewerSession: vi.fn(async () => ({
      session: { access_token: "fixture-token", id: "session" },
    })),
    archiveUrl: vi.fn(async () => "https://example.test/archive"),
  };

  const service = () => ({
    list: vi.fn(async () => []),
    info: vi.fn(async (): Promise<Record<string, unknown>> => ({
      source_uri: "cloudreve://my/",
      source_type: 0,
      name: "a",
    })),
    resolve: vi.fn(async () => ({})),
    capacity: vi.fn(async () => ({ used: 1, total: 10 })),
    userInfo: vi.fn(async () => ({ id: "user" })),
    get: vi.fn(async () => ({})),
    save: vi.fn(async () => ({})),
    revoke: vi.fn(),
    directAllowed: vi.fn(async () => true),
    direct: vi.fn(async () => []),
    revokeDirect: vi.fn(),
    me: vi.fn(async () => ({ id: "a" })),
    settings: vi.fn(async () => ({})),
    rename: vi.fn(),
    password: vi.fn(),
    patchSettings: vi.fn(),
    initTwoFactor: vi.fn(async () => "fixture-secret"),
    setTwoFactor: vi.fn(),
    beginPasskeyRegistration: vi.fn(async () => ({
      publicKey: { challenge: "challenge" },
    })),
    finishPasskeyRegistration: vi.fn(async () => ({ id: "passkey" })),
    deletePasskey: vi.fn(),
    revokeGrant: vi.fn(),
    pins: vi.fn(async () => []),
    publicList: vi.fn(async () => ({ shares: [] })),
    revokeMany: vi.fn(),
    createDownload: vi.fn(async () => [{ id: "job" }]),
    oauthApplication: vi.fn(async () => ({ id: "app" })),
    consentOAuth: vi.fn(async () => ({ code: "code", state: "state" })),
    searchUsers: vi.fn(async () => []),
    avatar: vi.fn(),
    archive: vi.fn(),
    archiveFiles: vi.fn(),
    cancel: vi.fn(),
    selectFiles: vi.fn(),
  });

  const b = {
    session: {
      getSnapshot: vi.fn(() => ({ status: "authenticated" })),
      logout: vi.fn(),
      captureLogout: vi.fn(async (name: string) => () => c.logout(name)),
    },
    files,
    shares: service(),
    webdav: service(),
    account: service(),
    jobs: service(),
    uploads: {
      create: vi.fn(async (..._args: unknown[]) => ({
        accountId: "a",
        endpoint: "https://example.test",
        provider: "local",
        parts: [],
        session: {
          session_id: "s",
          uri: "cloudreve://my/a",
          expires: 1,
          chunk_size: 1,
          upload_urls: [],
          credential: "",
          completeURL: "",
          callback_secret: "",
        },
        spec: { uri: "cloudreve://my/a", size: 1, policy_id: "p" },
        completed: false,
      })),
      run: vi.fn(async (job, _source, save) => {
        await save({ ...job, completed: true });

        return { ...job, completed: true };
      }),
      cancel: vi.fn(),
    },
    downloads: {
      prepare: vi.fn(async () => ({
        accountId: "a",
        endpoint: "https://example.test",
        entity: "v",
        name: "a",
        size: 1,
        uri: "cloudreve://my/a",
        completed: false,
      })),
      run: vi.fn(async (job, sink, save) => {
        await sink.append(new Uint8Array([1]));
        await sink.close();
        await save({ ...job, completed: true });

        return { ...job, completed: true };
      }),
    },
  };

  const publicClient = {
    files,
    shares: service(),
    account: service(),
    downloads: {
      prepare: vi.fn(async (uri: string) => ({
        scope: "guest" as const,
        endpoint: "https://example.test",
        uri: new CrUri(uri).withPassword("").toString(),
        entity: "v",
        name: "a",
        size: 1,
        completed: false,
      })),
      run: vi.fn(async (job, sink, save) => {
        await sink.append(new Uint8Array([1]));
        await sink.close();
        await save({ ...job, completed: true });

        return { ...job, completed: true };
      }),
    },
  };

  let stdout = "";
  let stderr = "";

  const state = {
    config: vi.fn(async () => c.config),
    transaction: vi.fn(async (name: string, fallback: unknown, update: (value: any) => unknown) => {
      const result = await update(data[name] ?? fallback);

      data[name] = structuredClone(result);

      return result;
    }),
    read: vi.fn((name, fallback) => data[name] ?? fallback),
    write: vi.fn((name, value) => {
      data[name] = structuredClone(value);
    }),
  };

  const profile = {
    endpoint: "https://example.test",
    credentialStore: "file",
    accountId: "a",
  };

  const c = {
    runtime: () => ({ node: "v24.5.0", platform: "darwin", arch: "arm64" }),
    runOwner: { id: "run", pid: 123 },
    isRunning: vi.fn(() => false),
    inv: parse(argv),
    io: {
      write: vi.fn(async (v) => {
        stdout += typeof v === "string" ? v : Buffer.from(v).toString();
      }),
      diagnostic: vi.fn(async (v) => {
        stderr += v;
      }),
      input: vi.fn(async () => Buffer.from("{}")),
      secret: vi.fn(async () => "password"),
      confirm: vi.fn(async () => true),
    },
    signal: new AbortController().signal,
    state,
    config: { version: 1, selected: "test", profiles: { test: profile } },
    name: "test",
    connection: () => profile,
    session: vi.fn(async () => b.session),
    ensureSupported: vi.fn(async () => ({ version: "4.18.0", isPro: false })),
    backend: vi.fn(() => b),
    publicBackend: vi.fn(() => publicClient),
    reader: () => (c.inv.flags.guest ? publicClient.files : b.files),
    sharePassword: undefined as string | undefined,
    credentials: {
      defaultStore: () => "native",
      get: vi.fn(() => ({ accessToken: "a" })),
      save: vi.fn(),
    },
    editText: vi.fn(async (text: string) => text),
    localTree: { scanLocalTree: vi.fn(), assertLocalEntry: vi.fn() },
    bytes: {
      assertPartialName: vi.fn(),
      downloadUrl: vi.fn(async () => ({
        bytes: 1,
        sha256: "hash",
        local: "/tmp/archive.zip",
      })),
      downloadPath: vi.fn(async (p: string, _name: string) => p),
      uniqueId: () => "transfer-id",
      localPath: (p: string) => p,
      localBasename: (p: string) => p.split("/").at(-1)!,
      source: vi.fn(async () => ({
        size: 1,
        path: "/tmp/a",
        fingerprint: "a".repeat(64),
      })),
      destination: vi.fn(async () => ({
        partial: "/tmp/partial",
        size: () => 0,
        append: vi.fn(),
        close: vi.fn(),
        finish: vi.fn(),
      })),
      textInput: vi.fn(
        async (_path: string, _max: number, _stdin: () => Promise<Buffer>) => "text",
      ),
      removePartial: vi.fn(),
    },
    transport: vi.fn(),
    auth: vi.fn(),
    signIn: vi.fn(),
    signInOAuth: vi.fn(async () => ({ id: "a", nickname: "Account" })),
    browserLogin: vi.fn(async (options: any) => {
      await options.authorizeUrl({
        state: "owned-state",
        challenge: "owned-challenge",
        redirectUri: options.redirectUri,
      });

      return {
        code: "code",
        verifier: "verifier",
        redirectUri: options.redirectUri,
      };
    }),
    logout: vi.fn(),
    captureLogout: vi.fn(async (name: string) => () => c.logout(name)),
    updateConfig: vi.fn(async (update: (config: any) => unknown) => {
      const result = await update(c.config);

      Object.assign(c.config, result);

      return result;
    }),
    confirm: vi.fn(),
    dispose: vi.fn(),
  };

  return {
    c: c as unknown as Context,
    b,
    publicClient,
    raw: c,
    data,
    file,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}
