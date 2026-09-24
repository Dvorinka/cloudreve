import { dispatch as auth, dispatch as profiles } from "../../src/main.js";
import { expect, it, vi } from "vitest";
import { secrets, authStatus, authSwitch, authLogout } from "../../src/commands/auth.js";
import { context } from "./context.js";

it("manages explicit connection profiles without backend calls", async () => {
  for (const args of [
    ["profile", "list"],
    ["profile", "add", "new", "--server", "https://example.test"],
    ["profile", "add", "new", "--server", "https://example.test", "--credential-store", "file"],
    ["profile", "add", "new", "--server", "https://example.test", "--credential-store", "native"],
    ["profile", "use", "test"],
    ["profile", "remove", "test", "--yes"],
  ]) {
    const { c, b } = context(args);

    await profiles(c);
    expect(b.files.info).not.toHaveBeenCalled();

    if (args[1] === "add" && !args.includes("--credential-store")) {
      expect(c.config.profiles.new?.credentialStore).toBe("native");
    }
  }

  for (const args of [
    ["profile", "add", "test", "--server", "https://example.test"],
    ["profile", "add", "new", "--server", "https://example.test", "--credential-store", "bad"],
    ["profile", "use", "unknown"],
  ]) {
    await expect(async () => profiles(context(args).c)).rejects.toThrow();
  }

  const x = context(["profile", "remove", "test", "--yes"]);

  x.raw.config.selected = "other";
  await profiles(x.c);
  expect(x.raw.config.selected).toBe("other");
});

it("accepts only a JSON string map for secret stdin", async () => {
  expect(await secrets(context().c)).toEqual({});

  for (const input of ["bad", "null", "[]", '{"a":1}']) {
    const x = context(["auth", "login", "--secrets-stdin"]);

    x.raw.io.input.mockResolvedValue(Buffer.from(input));
    await expect(secrets(x.c)).rejects.toThrow();
  }
});

const session = {
  user: { id: "a", nickname: "n" },
  token: {
    access_token: "access",
    refresh_token: "refresh",
    access_expires: "2030-01-01",
    refresh_expires: "2031-01-01",
  },
};

function setup(argv: string[]) {
  const x = context(argv);

  const a = {
    prepare: vi.fn(async () => ({ passwordEnabled: true })),
    password: vi.fn(async () => ({ kind: "authenticated", session })),
    otp: vi.fn(async () => session),
    config: vi.fn(async () => ({})),
    cliOAuthApplication: vi.fn(async () => ({ id: "cli", name: "Cloudreve CLI" })),
    exchangeOAuthToken: vi.fn(async () => ({
      access_token: "access",
      refresh_token: "refresh",
    })),
    importRefreshToken: vi.fn(async () => session),
  };

  x.raw.auth.mockReturnValue(a);

  return { ...x, a };
}

it("handles sign-in status and logout", async () => {
  for (const cmd of ["status", "logout"]) {
    const x = setup(["auth", cmd]);

    await auth(x.c);

    if (cmd === "logout") {
      expect(x.raw.logout).toHaveBeenCalled();
    }
  }
});

it("persists only a complete password/OTP/imported session", async () => {
  const x = setup(["auth", "login", "--email", "a@example.test", "--password-stdin"]);

  x.raw.io.input.mockResolvedValue(Buffer.from("secret\n"));
  await auth(x.c);

  expect(x.a.password).toHaveBeenCalledWith("a@example.test", "secret", {
    captcha: undefined,
    ticket: undefined,
  });

  expect(x.raw.signIn).toHaveBeenCalledWith(
    expect.objectContaining({
      token: expect.objectContaining({ access_token: "access" }),
    }),
    "a@example.test",
  );

  const otp = setup(["auth", "login", "--email", "a@example.test", "--secrets-stdin"]);

  otp.raw.io.input.mockResolvedValue(Buffer.from('{"password":"p","otp":"123456"}'));

  otp.a.password.mockResolvedValue({
    kind: "otp",
    sessionId: "challenge",
  } as never);

  await auth(otp.c);
  expect(otp.a.otp).toHaveBeenCalledWith("challenge", "123456");

  const interactive = setup(["auth", "login", "--email", "a@example.test"]);

  interactive.a.password.mockResolvedValue({
    kind: "otp",
    sessionId: "challenge",
  } as never);

  await auth(interactive.c);
  expect(interactive.raw.io.secret).toHaveBeenCalledTimes(2);

  const imported = setup(["auth", "login", "--credential-stdin"]);

  imported.raw.io.input.mockResolvedValue(
    Buffer.from("https://example.test/?refresh_token=secret"),
  );

  await auth(imported.c);
  expect(imported.a.importRefreshToken).toHaveBeenCalledWith("secret");
  imported.raw.io.input.mockResolvedValue(Buffer.from("https://other.test/?refresh_token=secret"));
  await expect(auth(imported.c)).rejects.toThrow("different");

  const disabled = setup(["auth", "login", "--email", "a@example.test"]);

  disabled.a.prepare.mockResolvedValue({ passwordEnabled: false });
  await expect(auth(disabled.c)).rejects.toThrow("disabled");
  expect(disabled.raw.signIn).not.toHaveBeenCalled();
});

it("does not let secret-stdin challenge data override the selected account email", async () => {
  const x = setup(["auth", "login", "--email", "chosen@example.test", "--secrets-stdin"]);

  x.raw.io.input.mockResolvedValue(
    Buffer.from(
      '{"password":"pass","email":"other@example.test","captcha":"answer","ticket":"challenge"}',
    ),
  );

  await auth(x.c);

  expect(x.a.password).toHaveBeenCalledWith("chosen@example.test", "pass", {
    captcha: "answer",
    ticket: "challenge",
  });
});

it("never deletes or logs out a replacement profile across confirmation and logout awaits", async () => {
  for (const phase of ["confirm", "capture", "logout"]) {
    const x = context(["profile", "remove", "test", "--yes"]);
    const original = x.raw.config.profiles.test;

    const replace = () => {
      x.raw.config.profiles.test = {
        ...original,
        id: "replacement",
      } as typeof original;
    };

    const revoke = vi.fn(async () => {
      if (phase === "logout") {
        replace();
      }
    });

    if (phase === "confirm") {
      x.raw.confirm.mockImplementation(async () => replace());
    }

    x.raw.captureLogout.mockImplementation(async () => {
      if (phase === "capture") {
        replace();
      }

      return revoke;
    });

    await expect(profiles(x.c)).rejects.toThrow("changed during removal");
    expect((x.raw.config.profiles.test as unknown as { id: string }).id).toBe("replacement");

    if (phase !== "logout") {
      expect(revoke).not.toHaveBeenCalled();
    }
  }
});

it("preserves a reauthenticated account when an older profile removal resumes", async () => {
  const x = context(["profile", "remove", "test", "--yes"]);

  x.raw.captureLogout.mockResolvedValue(async () => {
    x.raw.config.profiles.test = {
      ...x.raw.config.profiles.test,
      loginRevision: "fresh-login",
    } as typeof x.raw.config.profiles.test;
  });

  await expect(profiles(x.c)).rejects.toThrow("changed during removal");

  expect(x.raw.config.profiles.test).toMatchObject({
    loginRevision: "fresh-login",
  });
});

it("inspects a server via the real SDK without profile credentials", async () => {
  const x = context(["server", "info", "https://example.test", "--json"]);

  x.raw.transport.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: "4.18.0" })));
  await auth(x.c);

  expect(JSON.parse(x.stdout()).data).toEqual({
    version: "4.18.0",
    isPro: false,
  });

  expect(x.raw.transport.mock.calls[0]?.[1]).toMatchObject({
    signal: x.c.signal,
    redirect: "error",
  });

  expect(x.raw.auth).not.toHaveBeenCalled();
});

it("binds browser state/PKCE and persists OAuth tokens only after verified exchange", async () => {
  const link =
    "https://example.test/session/authorize?client_id=client&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A54321%2Fcallback&scope=profile&ignored=value";

  const x = setup([
    "auth",
    "login",
    "--browser",
    "--authorize-url",
    link,
    "--secrets-stdin",
    "--browser-command",
    "browser",
    "--timeout",
    "10000",
  ]);

  await expect(auth(x.c)).rejects.toThrow("clientSecret");
  expect(x.raw.browserLogin).not.toHaveBeenCalled();
  x.raw.io.input.mockResolvedValue(Buffer.from('{"clientSecret":"secret"}'));
  await auth(x.c);

  const options = x.raw.browserLogin.mock.calls[0]?.[0];

  const url = new URL(
    await options.authorizeUrl({
      state: "state",
      challenge: "challenge",
      redirectUri: options.redirectUri,
    }),
  );

  expect(url.searchParams.get("state")).toBe("state");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.has("ignored")).toBe(false);

  expect(x.a.exchangeOAuthToken).toHaveBeenCalledWith(
    {
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "http://localhost:54321/callback",
      code: "code",
      codeVerifier: "verifier",
    },
    x.c.signal,
  );

  expect(x.raw.signInOAuth).toHaveBeenCalled();
  expect(x.stdout()).not.toContain("secret");
});

it("combines login capability inspection with server info and rejects stray browser options", async () => {
  const x = setup(["server", "info", "--auth", "--json"]);

  x.raw.transport.mockResolvedValue(new Response(JSON.stringify({ code: 0, data: "4.16.1" })));
  await auth(x.c);
  expect(x.raw.ensureSupported).not.toHaveBeenCalled();
  expect(x.raw.auth).toHaveBeenCalledWith({ endpoint: "https://example.test" });

  expect(JSON.parse(x.stdout()).data).toMatchObject({
    version: "4.16.1",
    isPro: false,
  });

  for (const options of [
    ["--browser-command", "browser"],
    ["--timeout", "1000"],
  ]) {
    const y = context(["auth", "login", "--email", "a@example.test", ...options]);

    await expect(auth(y.c)).rejects.toThrow("browser login");
    expect(y.raw.io.input).not.toHaveBeenCalled();
    expect(y.raw.browserLogin).not.toHaveBeenCalled();
  }
});

it("never removes a profile after failed local credential persistence or replacement during failed revocation", async () => {
  for (const phase of ["persistence", "revocation"]) {
    const x = context(["profile", "remove", "test", "--yes"]);
    const originalId = (x.raw.config.profiles.test as { id?: string }).id;

    x.raw.captureLogout.mockResolvedValue(async () => {
      if (phase === "revocation") {
        Object.assign(x.raw.config.profiles.test, { id: "replacement" });
      }

      throw Object.assign(new Error("cleanup failure"), { phase });
    });

    await expect(auth(x.c)).rejects.toThrow(
      phase === "persistence" ? "cleanup failure" : "changed during removal",
    );

    expect(x.raw.config.profiles.test).toBeDefined();

    expect((x.raw.config.profiles.test as { id?: string }).id).toBe(
      phase === "persistence" ? originalId : "replacement",
    );
  }
});

it("lists every saved account and distinguishes the active account from an invocation override", async () => {
  const x = context(["auth", "status"]);

  (x.raw.config.profiles as any).work = {
    ...x.raw.config.profiles.test,
    accountId: "other",
    email: "other@example.test",
  };

  x.raw.config.selected = "work";

  const result = await authStatus(x.c);

  expect(result).toMatchObject({
    profile: "test",
    authenticated: true,
    accounts: [
      { name: "test", active: false, selectedForInvocation: true },
      { name: "work", active: true, selectedForInvocation: false },
    ],
  });

  x.raw.session.mockResolvedValue({
    getSnapshot: () => ({ status: "signedOut" }),
  } as any);

  expect(await authStatus(x.c)).toMatchObject({
    accounts: [{ active: false }, { active: false }],
  });

  x.raw.config.profiles = {} as any;

  expect(await authStatus(x.c)).toMatchObject({
    authenticated: false,
    accounts: [],
  });
});

it("switches only authenticated saved accounts and logs out only the named account", async () => {
  const x = context(["auth", "switch", "test"]);

  expect(await authSwitch(x.c)).toMatchObject({
    profile: "test",
    accountId: "a",
  });

  expect(x.raw.config.selected).toBe("test");
  expect(x.raw.session).toHaveBeenCalledWith("test");

  const missing = context(["auth", "switch", "missing"]);

  await expect(auth(missing.c)).rejects.toThrow("Unknown saved account");

  const unsigned = context(["auth", "switch", "test"]);

  (unsigned.raw.config.profiles.test as any).accountId = undefined;
  await expect(auth(unsigned.c)).rejects.toThrow("signed out");

  const expired = context(["auth", "switch", "test"]);

  expired.raw.session.mockResolvedValue({
    getSnapshot: () => ({ status: "signedOut" }),
  } as any);

  await expect(auth(expired.c)).rejects.toThrow("signed out");

  const changed = context(["auth", "switch", "test"]);

  changed.raw.updateConfig.mockImplementation(async (update: any) => {
    const config = structuredClone(changed.raw.config);

    config.profiles.test.accountId = "replacement";

    return update(config);
  });

  await expect(auth(changed.c)).rejects.toThrow("changed during selection");

  const logout = context(["auth", "logout", "test"]);

  expect(await authLogout(logout.c)).toEqual({ profile: "test" });
  expect(logout.raw.logout).toHaveBeenCalledExactlyOnceWith("test");

  await expect(auth(context(["auth", "logout", "missing"]).c)).rejects.toThrow(
    "Unknown saved account",
  );
});

it("defaults to built-in browser login with an assigned loopback redirect", async () => {
  const x = setup(["auth", "login"]);
  const redirectUri = "http://127.0.0.1:49123/callback";

  x.raw.browserLogin.mockImplementation(async (options: any) => {
    expect(options.redirectUri).toBe("http://127.0.0.1:0/callback");

    const url = new URL(
      await options.authorizeUrl({ state: "state", challenge: "a".repeat(43), redirectUri }),
    );

    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);

    return { code: "code", verifier: "verifier", redirectUri };
  });

  await auth(x.c);
  expect(x.a.cliOAuthApplication).toHaveBeenCalled();

  expect(x.a.exchangeOAuthToken).toHaveBeenCalledWith(
    expect.objectContaining({ code: "code", codeVerifier: "verifier", redirectUri }),
    x.c.signal,
  );

  expect(x.raw.signInOAuth).toHaveBeenCalled();

  const unavailable = setup(["auth", "login"]);

  unavailable.a.cliOAuthApplication.mockRejectedValue(new Error("Built-in CLI OAuth unavailable"));
  await expect(auth(unavailable.c)).rejects.toThrow("unavailable");
  expect(unavailable.raw.browserLogin).not.toHaveBeenCalled();

  await expect(auth(setup(["auth", "login", "--browser", "--secrets-stdin"]).c)).rejects.toThrow(
    "does not require",
  );
});

it("explains CAPTCHA limitations before asking for a password", async () => {
  const x = setup(["auth", "login", "--email", "a@example.test"]);

  x.a.config.mockResolvedValue({ login_captcha: true });
  await expect(auth(x.c)).rejects.toThrow("cannot solve");
  expect(x.raw.io.secret).not.toHaveBeenCalled();
  expect(x.a.password).not.toHaveBeenCalled();

  const y = setup(["auth", "login", "--email", "a@example.test", "--secrets-stdin"]);

  y.a.config.mockResolvedValue({ login_captcha: true });

  y.raw.io.input.mockResolvedValue(
    Buffer.from(JSON.stringify({ password: "pass", captcha: "answer", ticket: "ticket" })),
  );

  await auth(y.c);

  expect(y.a.password).toHaveBeenCalledWith("a@example.test", "pass", {
    captcha: "answer",
    ticket: "ticket",
  });
});
