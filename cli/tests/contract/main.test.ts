import * as transportPort from "../../src/platform/transport.js";
import { credentialGenerationKey } from "../../src/platform/session-store.js";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it, vi, beforeEach, afterEach } from "vitest";
import { compose } from "../../src/composition.js";
import { dispatch, run } from "../../src/main.js";
import { parse } from "../../src/program.js";
import { Credentials, accountKey } from "../../src/platform/credentials.js";
import { State } from "../../src/platform/state.js";
import { context } from "../commands/context.js";

const originalTransport = transportPort.transport;

beforeEach(() => {
  vi.spyOn(transportPort, "transport").mockImplementation((url, init) =>
    new URL(String(url)).pathname === "/api/v4/site/ping"
      ? Promise.resolve(new Response(JSON.stringify({ code: 0, data: "4.18.0" })))
      : originalTransport(url, init),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

function host() {
  const h = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    env: {
      CLOUDREVE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "cr-main-")),
    } as NodeJS.ProcessEnv,
  });

  let stdout = "";
  let stderr = "";

  h.stdout.on("data", (b) => (stdout += b));
  h.stderr.on("data", (b) => (stderr += b));

  return {
    h: h as unknown as NodeJS.Process,
    out: () => stdout,
    err: () => stderr,
    cleanup: () => rmSync(h.env.CLOUDREVE_CONFIG_DIR!, { recursive: true }),
  };
}

it("renders human profile output and errors without JSON or terminal injection", async () => {
  const x = host();

  try {
    x.h.env.NO_COLOR = "";

    expect(
      await run(
        [
          "profile",
          "add",
          "work",
          "--server",
          "https://example.test",
          "--credential-store",
          "file",
        ],
        x.h,
      ),
    ).toBe(0);

    expect(await run(["profile", "list"], x.h)).toBe(0);
    expect(x.out()).toContain("work");
    expect(x.out()).toContain("example.test");
    expect(x.out()).not.toMatch(/"profiles"|"schemaVersion"/);
    expect(await run(["bad\u001b[2J"], x.h)).toBe(2);
    expect(x.err()).toMatch(/error/i);
    expect(x.err()).toContain("bad");
    expect(x.err()).not.toContain("\u001b");
  } finally {
    x.cleanup();
  }
});

it("runs offline help/version/usage without writing configuration", async () => {
  for (const args of [[], ["--help"], ["--version"], ["help", "auth"]]) {
    const x = host();

    expect(await run(args, x.h)).toBe(0);
    expect(x.err()).toBe("");
    expect(x.out()).toMatch(/cr|Cloudreve/);
    x.cleanup();
  }

  for (const args of [
    ["unknown", "--json"],
    ["ls", "--unknown"],
    ["cat", "x", "--json"],
    ["edit", "/my/x", "--editor", "must-not-run", "--json"],
    ["music", "playlist", "play", "id", "--player", "must-not-run", "--json"],
  ]) {
    const x = host();

    expect(await run(args, x.h)).toBe(2);
    expect(x.out()).toBe("");

    if (args.includes("--json")) {
      expect(JSON.parse(x.err()).error.kind).toBe("usage");
    }

    x.cleanup();
  }
});

it("runs local profile lifecycle and authentication-required process statuses", async () => {
  const x = host();

  expect(
    await run(
      [
        "profile",
        "add",
        "p",
        "--server",
        "https://example.test",
        "--credential-store",
        "file",
        "--json",
      ],
      x.h,
    ),
  ).toBe(0);

  expect(await run(["stat", "/my/a", "--no-prompt"], x.h)).toBe(4);
  expect(await run(["auth", "status", "--json"], x.h)).toBe(0);
  expect(x.err()).toContain("Sign in");
  x.cleanup();
});

it("routes every dispatcher family and keeps cat free of result metadata", async () => {
  for (const args of [
    ["ls"],
    ["profile", "list"],
    ["auth", "status"],
    ["transfer", "list"],
    ["stat", "/my/a"],
    ["metadata", "view", "/my/a"],
    ["tag", "remove", "/my/a", "--name", "t"],
    ["account", "view"],
    ["cat", "/my/a"],
  ]) {
    const x = context(args);

    await dispatch(x.c);
    expect(x.raw.io.write).toHaveBeenCalled();

    if (args[0] === "cat") {
      expect(x.stdout()).toBe("\u0001");
    }
  }
});

it("composes account-bound SDK services and invalidates them on cancellation", async () => {
  const x = host();
  const s = new State(x.h.env.CLOUDREVE_CONFIG_DIR!);

  await s.write("config.json", {
    version: 1,
    selected: "p",
    profiles: {
      p: {
        endpoint: "https://example.test",
        credentialStore: "file",
        accountId: "a",
      },
    },
  });

  const cred = new Credentials(s);

  await cred.save("p", "file", {
    accessToken: "a",
    refreshToken: "r",
    accessExpiresAt: Date.now() + 100000,
    refreshExpiresAt: Date.now() + 1000000,
  });

  const ctrl = new AbortController();
  const ctx = await compose(parse(["ls"]), context().c.io, ctrl.signal, x.h.env);

  expect((await ctx.backend()).files.accountId).toBe("a");
  expect((await ctx.backend()).files.accountId).toBe("a");
  ctrl.abort();
  await expect((await ctx.backend()).files.info("cloudreve://my/a")).rejects.toThrow("Session");
  await ctx.dispose();

  const pre = new AbortController();

  pre.abort();

  const p = await compose(parse(["ls"]), context().c.io, pre.signal, x.h.env);

  await expect(async () => (await p.backend()).files.info("cloudreve://my/a")).rejects.toThrow();
  x.cleanup();
});

it("persists SDK refreshed tokens through the platform seam", async () => {
  const x = host();
  const s = new State(x.h.env.CLOUDREVE_CONFIG_DIR!);

  await s.write("config.json", {
    version: 1,
    selected: "p",
    profiles: {
      p: {
        endpoint: "https://example.test",
        credentialStore: "file",
        accountId: "a",
      },
    },
  });

  await new Credentials(s).save("p", "file", {
    accessToken: "a",
    refreshToken: "r",
    accessExpiresAt: 0,
    refreshExpiresAt: Date.now() + 100000,
  });

  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            access_token: "next",
            refresh_token: "next-r",
            access_expires: "2030-01-01",
            refresh_expires: "2031-01-01",
          },
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 0, data: { id: "a", nickname: "name" } })),
    );

  const c = await compose(
    parse(["account", "view"]),
    context().c.io,
    new AbortController().signal,
    x.h.env,
  );

  expect(await (await c.backend()).account.me()).toEqual({
    id: "a",
    nickname: "name",
  });

  expect(
    (
      (await new Credentials(s).record(
        credentialGenerationKey(
          accountKey("https://example.test", "a"),
          (
            await s.read<{ generation: string }>(
              accountKey("https://example.test", "a") + ".identity.json",
              { generation: "missing" },
            )
          ).generation,
        ),
        "file",
      )) as { tokens: { accessToken: string } }
    ).tokens.accessToken,
  ).toBe("next");

  await c.dispose();
  fetch.mockRestore();
  x.cleanup();
});

it("keeps profile precedence and confirmation explicit", async () => {
  const x = host();
  const s = new State(x.h.env.CLOUDREVE_CONFIG_DIR!);

  await s.write("config.json", { version: 1, selected: "saved", profiles: {} });

  const io = context().c.io;

  const c = await compose(parse(["ls", "--profile", "flag"]), io, new AbortController().signal, {
    ...x.h.env,
    CLOUDREVE_PROFILE: "environment",
  });

  expect(c.name).toBe("flag");
  expect(() => c.connection()).toThrow("No active account");
  await c.dispose();

  expect(
    (
      await compose(parse(["ls"]), io, new AbortController().signal, {
        ...x.h.env,
        CLOUDREVE_PROFILE: "environment",
      })
    ).name,
  ).toBe("environment");

  await c.confirm("yes");
  io.confirm = async () => false;
  await expect(c.confirm("no")).rejects.toThrow("declined");
  c.inv.flags.yes = true;
  await c.confirm("yes");
  x.cleanup();
});

it("bin entry invokes the same run function with process arguments", async () => {
  const spy = vi.spyOn(await import("../../src/main.js"), "run").mockResolvedValue(0);
  const previous = process.exitCode;

  await import("../../src/bin.js");
  expect(spy).toHaveBeenCalledWith(process.argv.slice(2));
  process.exitCode = previous;
  spy.mockRestore();
});

it("propagates SIGINT/SIGTERM through SDK requests and cleans listeners", async () => {
  for (const [signal, status] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    const x = host();
    const s = new State(x.h.env.CLOUDREVE_CONFIG_DIR!);

    await s.write("config.json", {
      version: 1,
      selected: "p",
      profiles: {
        p: {
          endpoint: "https://example.test",
          credentialStore: "file",
          accountId: "a",
        },
      },
    });

    await new Credentials(s).save("p", "file", {
      accessToken: "a",
      refreshToken: "r",
      accessExpiresAt: Date.now() + 100000,
      refreshExpiresAt: Date.now() + 1000000,
    });

    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_u, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("interrupted")));
          queueMicrotask(() => x.h.emit(signal));
        }),
    );

    expect(await run(["account", "view", "--json"], x.h)).toBe(status);
    expect(x.h.listenerCount(signal)).toBe(0);
    fetch.mockRestore();
    x.cleanup();
  }
});

it("aborts active work on broken stdout without a stack trace", async () => {
  const x = host();
  const s = new State(x.h.env.CLOUDREVE_CONFIG_DIR!);

  await s.write("config.json", {
    version: 1,
    selected: "p",
    profiles: {
      p: {
        endpoint: "https://example.test",
        credentialStore: "file",
        accountId: "a",
      },
    },
  });

  await new Credentials(s).save("p", "file", {
    accessToken: "a",
    refreshToken: "r",
    accessExpiresAt: Date.now() + 100000,
    refreshExpiresAt: Date.now() + 1000000,
  });

  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("closed"), { code: "EPIPE" })),
        );

        queueMicrotask(() =>
          x.h.stdout.emit("error", Object.assign(new Error("closed"), { code: "EPIPE" })),
        );
      }),
  );

  expect(await run(["account", "view"], x.h)).toBe(1);
  expect(x.err()).toBe("");
  fetch.mockRestore();
  x.cleanup();
});

it("propagates explicit lock-token disclosure through the complete error boundary", async () => {
  const { Files } = await import("@cloudreve/sdk/files");

  const error = Object.assign(new Error("locked"), {
    code: 40073,
    data: [{ path: "cloudreve://my/a", token: "private-lock", type: 0 }],
  });

  const operation = vi.spyOn(Files.prototype, "copyTo").mockRejectedValue(error);

  try {
    for (const reveal of [false, true]) {
      const x = host();
      const s = new State(x.h.env.CLOUDREVE_CONFIG_DIR!);

      try {
        await s.write("config.json", {
          version: 1,
          selected: "p",
          profiles: {
            p: {
              endpoint: "https://example.test",
              accountId: "a",
              credentialStore: "file",
            },
          },
        });

        await new Credentials(s).save("p", "file", {
          accessToken: "a",
          refreshToken: "r",
          accessExpiresAt: Date.now() + 100000,
          refreshExpiresAt: Date.now() + 1000000,
        });

        expect(
          await run(
            ["mv", "/my/a", "/my/b", "--json", ...(reveal ? ["--show-lock-tokens"] : [])],
            x.h,
          ),
        ).toBe(1);

        expect(x.out()).toBe("");
        expect(x.err().includes("private-lock")).toBe(reveal);
      } finally {
        x.cleanup();
      }
    }
  } finally {
    operation.mockRestore();
  }
});
