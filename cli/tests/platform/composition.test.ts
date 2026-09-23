import * as transportPort from "../../src/platform/transport.js";
import {
  credentialGenerationKey,
  persistLogin,
  revocationKey,
} from "../../src/platform/session-store.js";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { compose } from "../../src/composition.js";
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

async function current(x: Awaited<ReturnType<typeof fixture>>, key: string) {
  const head = await x.state.read<{ generation: string } | null>(key + ".identity.json", null);

  return head ? x.credentials.record(credentialGenerationKey(key, head.generation), "file") : null;
}

const tokens = {
  accessToken: "access",
  refreshToken: "refresh",
  accessExpiresAt: Date.now() + 100000,
  refreshExpiresAt: Date.now() + 1000000,
};

const login = {
  user: { id: "a", nickname: "Name" },
  token: {
    access_token: "access",
    refresh_token: "refresh",
    access_expires: "2030-01-01",
    refresh_expires: "2031-01-01",
  },
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "cr-binding-"));
  const state = new State(dir);

  await state.write("config.json", {
    version: 1,
    selected: "p",
    profiles: {
      p: {
        id: "stable",
        endpoint: "https://cloudreve.test",
        accountId: "a",
        credentialStore: "file",
      },
      other: {
        endpoint: "https://cloudreve.test",
        accountId: "b",
        credentialStore: "file",
      },
    },
  });

  const c = await compose(
    parse(["auth", "status", "--config-dir", dir]),
    context().c.io,
    new AbortController().signal,
  );

  return { dir, state, c, credentials: new Credentials(state) };
}

it("keeps a stable facade and persists logout tombstones without touching a newer login", async () => {
  let revocations = 0;

  const x = await fixture();
  const key = accountKey("https://cloudreve.test", "a");

  const server = setupServer(
    http.delete("https://cloudreve.test/api/v4/session/token", async ({ request }) => {
      expect(await request.json()).toMatchObject({
        refresh_token: "refresh",
      });

      revocations++;

      return HttpResponse.json({ code: 0 });
    }),
  );

  server.listen({ onUnhandledRequest: "error" });

  try {
    await x.credentials.put(key, "file", { generation: "old", tokens });

    const client = await x.c.backend();

    expect(await x.c.backend()).toBe(client);
    expect(client.session.getSnapshot().status).toBe("authenticated");
    expect(x.c.isRunning(process.pid)).toBe(true);
    expect(x.c.isRunning(999999999)).toBe(false);
    await x.c.logout();
    expect(revocations).toBe(1);
    expect(await x.state.read(revocationKey(key, "old"), false)).toBe(true);

    expect(await current(x, key)).toEqual({
      generation: "old",
      tokens: null,
    });

    await persistLogin(x.state, x.credentials, x.c.connection(), "a", {
      generation: "new",
      tokens,
    });

    await x.c.logout();

    expect(await current(x, key)).toEqual({
      generation: "new",
      tokens,
    });

    await x.c.logout("other");
    await x.c.logout("missing");
  } finally {
    server.close();
    await x.c.dispose();
    await rm(x.dir, { recursive: true });
  }
});

it("migrates legacy credentials once and never revives them through an existing tombstone", async () => {
  const x = await fixture();
  const key = accountKey("https://cloudreve.test", "a");

  try {
    await x.credentials.save("p", "file", tokens);

    await x.credentials.put(key, "file", {
      generation: "signed-out",
      tokens: null,
    });

    const client = await x.c.backend();

    expect(client.session.getSnapshot().status).toBe("signedOut");
    expect(await x.credentials.get("p", "file")).toBeNull();
    await expect(client.account.me()).rejects.toThrow();
  } finally {
    await x.c.dispose();
    await rm(x.dir, { recursive: true });
  }
});

it("rejects malformed durable records and prevents delayed login rebinding a replaced profile", async () => {
  const x = await fixture();
  const key = accountKey("https://cloudreve.test", "a");

  try {
    await x.credentials.put(key, "file", {});
    await expect(x.c.backend()).rejects.toThrow("Invalid saved credentials");
    await x.c.dispose();

    await x.c.updateConfig((config) => {
      config.profiles.p!.id = "replacement";

      return config;
    });

    const older = await compose(
      parse(["auth", "login", "--config-dir", x.dir]),
      context().c.io,
      new AbortController().signal,
    );

    await x.state.transaction("config.json", await x.state.config(), (config) => {
      config.profiles.p!.id = "newer";

      return config;
    });

    const before = await current(x, key);

    await expect(older.signIn(login)).rejects.toThrow("changed during");
    expect(await current(x, key)).toEqual(before);
    expect((await x.state.config()).profiles.p?.id).toBe("newer");
    await older.dispose();
  } finally {
    await rm(x.dir, { recursive: true });
  }
});

it("accepts a fresh credential-link login without inventing an email", async () => {
  const x = await fixture();

  try {
    await x.c.signIn(login);
    expect(x.c.connection().email).toBeUndefined();

    expect(
      (
        (await current(x, accountKey("https://cloudreve.test", "a"))) as {
          generation: string;
        }
      ).generation,
    ).not.toBe("signed-out");
  } finally {
    await x.c.dispose();
    await rm(x.dir, { recursive: true });
  }
});

it("persists OAuth login through the same generation store after SDK account identification", async () => {
  const x = await fixture();

  const server = setupServer(
    http.get("https://cloudreve.test/api/v4/site/config/basic", ({ request }) => {
      expect(request.headers.get("authorization")).toBe("Bearer oauth-access");

      return HttpResponse.json({
        code: 0,
        data: {
          user: { id: "a", nickname: "OAuth", email: "oauth@example.test" },
        },
      });
    }),
  );

  server.listen({ onUnhandledRequest: "error" });

  const response = {
    access_token: "oauth-access",
    refresh_token: "oauth-refresh",
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token_expires_in: 7200,
    scope: "profile",
  };

  try {
    expect(await x.c.signInOAuth(response, "fixture-client")).toMatchObject({
      id: "a",
      nickname: "OAuth",
    });

    expect(
      await current(
        x,
        accountKey("https://cloudreve.test", "a", "file", x.c.config.profiles.p!.authContext),
      ),
    ).toMatchObject({
      tokens: { accessToken: "oauth-access", refreshToken: "oauth-refresh" },
    });

    const oauthContext = x.c.connection().authContext;

    expect(oauthContext).toBe("oauth:fixture-client:profile");

    const oauthKey = accountKey("https://cloudreve.test", "a", "file", oauthContext);
    const oauthRecord = await current(x, oauthKey);

    await x.c.signIn(login);
    expect(x.c.connection().authContext).toBeUndefined();

    const passwordKey = accountKey("https://cloudreve.test", "a");
    const passwordRecord = await current(x, passwordKey);

    expect(passwordRecord).toMatchObject({ tokens: { accessToken: "access" } });
    expect(await current(x, oauthKey)).toEqual(oauthRecord);

    const put = vi
      .spyOn(Credentials.prototype, "put")
      .mockRejectedValueOnce(new Error("vault unavailable"));

    await expect(x.c.signInOAuth(response, "fixture-client")).rejects.toThrow("vault unavailable");
    put.mockRestore();
    expect(x.c.connection().authContext).toBeUndefined();
    expect(await current(x, passwordKey)).toEqual(passwordRecord);
    expect(await current(x, oauthKey)).toEqual(oauthRecord);
    await x.c.signInOAuth({ ...response, scope: "write read read" }, "other-client");
    expect(x.c.connection().authContext).toBe("oauth:other-client:read write");

    const normalizedKey = accountKey(
      "https://cloudreve.test",
      "a",
      "file",
      x.c.connection().authContext,
    );

    await x.c.signInOAuth({ ...response, scope: " read   write " }, "other-client");

    expect(accountKey("https://cloudreve.test", "a", "file", x.c.connection().authContext)).toBe(
      normalizedKey,
    );

    expect(normalizedKey).not.toBe(oauthKey);

    expect(
      accountKey("https://cloudreve.test", "a", "keychain", x.c.connection().authContext),
    ).not.toBe(normalizedKey);

    expect(await current(x, passwordKey)).toEqual(passwordRecord);

    server.use(
      http.get("https://cloudreve.test/api/v4/site/config/basic", () =>
        HttpResponse.json({ code: 0, data: {} }),
      ),
    );

    await expect(x.c.signInOAuth(response, "fixture-client")).rejects.toThrow("no readable");
  } finally {
    server.close();
    await x.c.dispose();
    await rm(x.dir, { recursive: true, force: true });
  }
});

it("adds two durable accounts, preserves credentials and selection overrides, and refuses account replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-accounts-"));
  const state = new State(dir);
  const contexts: Awaited<ReturnType<typeof compose>>[] = [];

  const open = async (args: string[]) => {
    const c = await compose(
      parse([...args, "--config-dir", dir]),
      context().c.io,
      new AbortController().signal,
      {},
    );

    contexts.push(c);

    return c;
  };

  try {
    const first = await open([
      "auth",
      "login",
      "--server",
      "https://cloudreve.test",
      "--credential-store",
      "file",
    ]);

    expect(await state.config()).toEqual({ version: 1, profiles: {} });
    await first.signIn(login, "first@example.test");

    const second = await open(["auth", "login", "--name", "work"]);

    expect(Object.keys((await state.config()).profiles)).toEqual(["default"]);
    await second.signIn({ ...login, user: { ...login.user, id: "b" } }, "second@example.test");

    const saved = await state.config();

    expect(saved.selected).toBe("work");

    expect(saved.profiles.default).toMatchObject({
      accountId: "a",
      email: "first@example.test",
    });

    expect(saved.profiles.work).toMatchObject({
      accountId: "b",
      email: "second@example.test",
    });

    const selected = await open(["auth", "status"]);

    expect(selected.name).toBe("work");
    expect((await selected.session("default")).getSnapshot().status).toBe("authenticated");
    expect((await selected.session("work")).getSnapshot().status).toBe("authenticated");

    const override = await open(["auth", "login", "--profile", "default"]);

    await override.signIn(login);
    expect((await state.config()).selected).toBe("work");

    const wrong = await open(["auth", "login", "--name", "default"]);

    await expect(wrong.signIn({ ...login, user: { ...login.user, id: "b" } })).rejects.toThrow(
      "different user",
    );

    const duplicate = await open(["auth", "login", "--name", "duplicate"]);

    await expect(duplicate.signIn(login)).rejects.toThrow("already saved");
    expect((await state.config()).profiles.duplicate).toBeUndefined();

    const another = await open([
      "auth",
      "login",
      "--name",
      "another",
      "--server",
      "https://other.test",
    ]);

    await another.signIn(login);
    expect((await state.config()).selected).toBe("another");
    expect((await another.session()).getSnapshot().status).toBe("authenticated");
  } finally {
    await Promise.all(contexts.map((c) => c.dispose()));
    await rm(dir, { recursive: true, force: true });
  }
});

it("rejects stale parallel login and duplicate names without moving selection or credentials", async () => {
  const x = await fixture();

  const open = () =>
    compose(
      parse(["auth", "login", "--config-dir", x.dir]),
      context().c.io,
      new AbortController().signal,
      {},
    );

  const first = await open();
  const stale = await open();

  try {
    await first.signIn(login);

    const after = await x.state.config();
    const key = accountKey("https://cloudreve.test", "a");
    const stored = await current(x, key);

    await expect(stale.signIn(login)).rejects.toThrow("changed during authentication");
    expect(await x.state.config()).toEqual(after);
    expect(await current(x, key)).toEqual(stored);

    const args = parse(["auth", "login", "--name", "new", "--config-dir", x.dir]);
    const one = await compose(args, context().c.io, new AbortController().signal, {});
    const two = await compose(args, context().c.io, new AbortController().signal, {});

    try {
      await one.signIn({ ...login, user: { ...login.user, id: "c" } });

      await expect(two.signIn({ ...login, user: { ...login.user, id: "d" } })).rejects.toThrow(
        "changed during authentication",
      );

      expect((await x.state.config()).profiles.new?.accountId).toBe("c");
    } finally {
      await one.dispose();
      await two.dispose();
    }
  } finally {
    await first.dispose();
    await stale.dispose();
    await x.c.dispose();
    await rm(x.dir, { recursive: true, force: true });
  }
});

it("rejects invalid account setup before creating state and leaves failed login slots uncreated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-accounts-invalid-"));

  const open = (args: string[]) =>
    compose(
      parse([...args, "--config-dir", dir]),
      context().c.io,
      new AbortController().signal,
      {},
    );

  try {
    await expect(open(["auth", "login"])).rejects.toThrow("Provide --server");
    await expect(open(["auth", "login", "--name", "../bad"])).rejects.toThrow();

    await expect(
      open(["auth", "login", "--server", "https://cloudreve.test", "--credential-store", "bad"]),
    ).rejects.toThrow("Unknown credential store");

    const c = await open([
      "auth",
      "login",
      "--server",
      "https://cloudreve.test",
      "--credential-store",
      "file",
    ]);

    const put = vi
      .spyOn(Credentials.prototype, "put")
      .mockRejectedValueOnce(new Error("vault unavailable"));

    await expect(c.signIn(login)).rejects.toThrow("vault unavailable");
    put.mockRestore();
    expect(await new State(dir).config()).toEqual({ version: 1, profiles: {} });
    await c.signIn(login);

    await expect(open(["auth", "login", "--server", "https://other.test"])).rejects.toThrow(
      "different server",
    );

    await expect(open(["auth", "login", "--credential-store", "native"])).rejects.toThrow(
      "different credential store",
    );

    await c.dispose();

    const noSelection = await new State(dir).config();

    delete noSelection.selected;
    await new State(dir).write("config.json", noSelection);

    const none = await open(["ls"]);

    expect(() => none.connection()).toThrow("No active account");
    await expect(none.session("missing")).rejects.toThrow("Unknown saved account");
    await none.dispose();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("logs out one saved account without changing the selected account or another credential authority", async () => {
  const x = await fixture();
  const revocations: unknown[] = [];

  const server = setupServer(
    http.delete("https://cloudreve.test/api/v4/session/token", async ({ request }) => {
      revocations.push(await request.json());

      return HttpResponse.json({ code: 0 });
    }),
  );

  server.listen({ onUnhandledRequest: "error" });

  try {
    await x.c.signIn(login);

    const second = await compose(
      parse(["auth", "login", "--name", "other", "--config-dir", x.dir]),
      context().c.io,
      new AbortController().signal,
      {},
    );

    try {
      await second.signIn({
        ...login,
        user: { ...login.user, id: "b" },
        token: { ...login.token, refresh_token: "second-refresh" },
      });

      const firstKey = accountKey("https://cloudreve.test", "a");
      const firstBefore = await current(x, firstKey);

      await second.logout("p");
      expect(revocations).toEqual([{ refresh_token: "refresh" }]);
      expect((await second.session("other")).getSnapshot().status).toBe("authenticated");
      expect((await x.state.config()).selected).toBe("other");

      const firstAfter = await current(x, firstKey);

      expect(firstAfter).toMatchObject({
        generation: (firstBefore as { generation: string }).generation,
        tokens: null,
      });
    } finally {
      await second.dispose();
    }
  } finally {
    server.close();
    await x.c.dispose();
    await rm(x.dir, { recursive: true, force: true });
  }
});
