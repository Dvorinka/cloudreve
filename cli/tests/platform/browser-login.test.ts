import { createServer, request as httpRequest } from "node:http";
import { createConnection, type AddressInfo } from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { browserLogin, type BrowserLoginOptions } from "../../src/platform/browser-login.js";

async function redirect() {
  const server = createServer();

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const port = (server.address() as AddressInfo).port;

  await new Promise<void>((done) => server.close(() => done()));

  return `http://127.0.0.1:${port}/callback?nonce=fixed`;
}

function authorize(input: { state: string; challenge: string; redirectUri: string }) {
  const url = new URL("https://fixture.test/session/authorize");

  url.search = new URLSearchParams({
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    redirect_uri: input.redirectUri,
  }).toString();

  return url.href;
}

function callback(target: string) {
  const source = new URL(target);
  const url = new URL(source.searchParams.get("redirect_uri")!);

  url.searchParams.set("state", source.searchParams.get("state")!);
  url.searchParams.set("code", "fixture-code");

  return url;
}

function send(url: URL, options: { method?: string; host?: string; path?: string } = {}) {
  return new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      url,
      {
        method: options.method ?? "GET",
        headers: options.host ? { Host: options.host } : {},
        ...(options.path ? { path: options.path } : {}),
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      },
    );

    req.on("error", reject);
    req.end();
  });
}

function options(uri: string, open: BrowserLoginOptions["open"]): BrowserLoginOptions {
  return {
    redirectUri: uri,
    signal: new AbortController().signal,
    authorizeUrl: authorize,
    open,
  };
}

it("binds state, PKCE, host, method, path and fixed query values before accepting a code", async () => {
  let challenge = "";

  const result = await browserLogin(
    options(await redirect(), async (target) => {
      challenge = new URL(target).searchParams.get("code_challenge")!;

      const good = callback(target);
      const wrongState = new URL(good);

      wrongState.searchParams.set("state", "wrong");
      expect(await send(wrongState)).toBe(400);

      const sameLength = new URL(good);

      sameLength.searchParams.set("state", "x".repeat(good.searchParams.get("state")!.length));
      expect(await send(sameLength)).toBe(400);
      expect(await send(good, { host: "evil.test" })).toBe(400);
      expect(await send(good, { method: "POST" })).toBe(405);
      expect(await send(good, { path: "/wrong" })).toBe(400);

      const wrongNonce = new URL(good);

      wrongNonce.searchParams.set("nonce", "other");
      expect(await send(wrongNonce)).toBe(400);

      const duplicateState = new URL(good);

      duplicateState.searchParams.append("state", "other");
      expect(await send(duplicateState)).toBe(400);

      const duplicate = new URL(good);

      duplicate.searchParams.append("code", "other");
      expect(await send(duplicate)).toBe(400);

      const mixed = new URL(good);

      mixed.searchParams.set("error", "access_denied");
      expect(await send(mixed)).toBe(400);

      const empty = new URL(good);

      empty.searchParams.set("code", "");
      expect(await send(empty)).toBe(400);
      expect(await send(good)).toBe(200);
    }),
  );

  expect(result.code).toBe("fixture-code");
  expect(result.verifier).toMatch(/^[\w-]{43}$/);
  expect(createHash("sha256").update(result.verifier).digest("base64url")).toBe(challenge);
});

it("reports a valid-state denial without echoing provider descriptions", async () => {
  await expect(
    browserLogin(
      options(await redirect(), async (target) => {
        const url = callback(target);

        url.searchParams.delete("code");
        url.searchParams.set("error", "access_denied");
        url.searchParams.set("error_description", "sensitive provider text");
        expect(await send(url)).toBe(400);
      }),
    ),
  ).rejects.toMatchObject({
    kind: "authentication",
    status: 4,
    message: "Browser sign-in was declined",
  });
});

it("cancels a pending builder, releases the registered port and never opens late", async () => {
  const uri = await redirect();
  const controller = new AbortController();
  const open = vi.fn(async () => {});

  let resolve!: (value: string) => void;
  let start!: () => void;

  const started = new Promise<void>((done) => {
    start = done;
  });

  let target = "";

  const result = browserLogin({
    ...options(uri, open),
    signal: controller.signal,
    authorizeUrl: (input) => {
      target = authorize(input);
      start();

      return new Promise<string>((done) => {
        resolve = done;
      });
    },
  });

  await started;
  controller.abort();

  await expect(result).rejects.toMatchObject({
    kind: "cancelled",
    status: 130,
  });

  resolve(target);
  await new Promise((done) => setTimeout(done, 0));
  expect(open).not.toHaveBeenCalled();

  const server = createServer();

  server.listen(Number(new URL(uri).port), "127.0.0.1");
  await once(server, "listening");
  await new Promise<void>((done) => server.close(() => done()));
});

it("times out, handles opener/build failures, and rejects a URL missing transaction binding", async () => {
  await expect(
    browserLogin({
      ...options(await redirect(), async () => {}),
      timeoutMs: 15,
    }),
  ).rejects.toMatchObject({ kind: "timeout" });

  await expect(
    browserLogin(
      options(await redirect(), async () => {
        throw Error("launcher failed");
      }),
    ),
  ).rejects.toThrow("launcher failed");

  await expect(
    browserLogin({
      ...options(await redirect(), async () => {}),
      authorizeUrl: () => {
        throw Error("builder failed");
      },
    }),
  ).rejects.toThrow("builder failed");

  await expect(
    browserLogin({
      ...options(await redirect(), async () => {}),
      authorizeUrl: () => "https://fixture.test/",
    }),
  ).rejects.toMatchObject({ kind: "usage" });
});

it("refuses unsafe redirect targets, invalid deadlines and pre-cancelled work", async () => {
  const open = vi.fn(async () => {});

  for (const uri of [
    "not-url",
    "https://127.0.0.1:1234/cb",
    "http://evil.test:1234/cb",
    "http://localhost/cb",
    "http://0.0.0.0:0/cb",
    "http://user@localhost:1234/cb",
    "http://:pass@localhost:1234/cb",
    "http://localhost:1234/cb#fragment",
    "http://localhost:1234/cb?state=x",
  ]) {
    await expect(browserLogin(options(uri, open))).rejects.toMatchObject({
      kind: "usage",
    });
  }

  for (const timeoutMs of [0, -1, NaN, Infinity, 2147483648]) {
    await expect(
      browserLogin({ ...options("http://localhost:1234/cb", open), timeoutMs }),
    ).rejects.toMatchObject({ kind: "usage" });
  }

  const controller = new AbortController();

  controller.abort();

  await expect(
    browserLogin({
      ...options("http://localhost:1234/cb", open),
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ kind: "cancelled" });

  expect(open).not.toHaveBeenCalled();
});

it("reports a registered port collision instead of silently changing the redirect", async () => {
  const server = createServer();

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    await expect(
      browserLogin(
        options(`http://127.0.0.1:${(server.address() as AddressInfo).port}/cb`, async () => {}),
      ),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it("does not let an idle socket hold completion open", async () => {
  let socket: ReturnType<typeof createConnection> | undefined;

  await browserLogin(
    options(await redirect(), async (target) => {
      const url = callback(target);

      socket = createConnection(Number(url.port), "127.0.0.1");
      socket.on("error", () => {});
      await once(socket, "connect");
      expect(await send(url)).toBe(200);
    }),
  );

  await new Promise((done) => setTimeout(done, 0));
  expect(socket!.destroyed).toBe(true);
});

it("handles immediate cancellation before listening without launching or leaving a port", async () => {
  const controller = new AbortController();
  const open = vi.fn(async () => {});
  const uri = await redirect();

  const result = browserLogin({
    ...options(uri, open),
    signal: controller.signal,
  });

  controller.abort();
  await expect(result).rejects.toMatchObject({ kind: "cancelled" });
  expect(open).not.toHaveBeenCalled();
});

it("accepts IPv6 loopback callbacks and ignores an opener failure after completion", async () => {
  const probe = createServer();

  probe.listen(0, "::1");
  await once(probe, "listening");

  const port = (probe.address() as AddressInfo).port;

  await new Promise<void>((done) => probe.close(() => done()));

  const result = await browserLogin(
    options(`http://[::1]:${port}/callback`, async (target) => {
      expect(await send(callback(target))).toBe(200);

      throw Error("late opener failure");
    }),
  );

  expect(result.code).toBe("fixture-code");
});

it("rejects malformed absolute targets and missing Host without consuming the transaction", async () => {
  const result = await browserLogin(
    options(await redirect(), async (target) => {
      const good = callback(target);

      expect(await send(good, { path: "http://[" })).toBe(400);

      const response = await new Promise<string>((resolve, reject) => {
        const socket = createConnection(Number(good.port), "127.0.0.1");
        let data = "";

        socket.on("error", reject);

        socket.on("data", (chunk) => {
          data += chunk;
        });

        socket.on("end", () => resolve(data));

        socket.on("connect", () =>
          socket.write(`GET ${good.pathname}${good.search} HTTP/1.0\r\n\r\n`),
        );
      });

      expect(response).toContain("400");

      const blank = new URL(good);

      blank.searchParams.set("code", "   ");
      expect(await send(blank)).toBe(400);
      expect(await send(good)).toBe(200);
    }),
  );

  expect(result.code).toBe("fixture-code");
});

it("preserves the exact registered redirect literal through the transaction", async () => {
  const uri = (await redirect()).replace("127.0.0.1", "LOCALHOST");

  const result = await browserLogin({
    ...options(uri, async (url) => {
      expect(new URL(url).searchParams.get("redirect_uri")).toBe(uri);
      expect(await send(callback(url))).toBe(200);
    }),
    authorizeUrl: (input) => {
      expect(input.redirectUri).toBe(uri);

      return authorize(input);
    },
  });

  expect(result.redirectUri).toBe(uri);
});

it("binds an ephemeral loopback port before constructing authorization and releases it afterward", async () => {
  let target: URL | undefined;

  const result = await browserLogin(
    options("http://127.0.0.1:0/callback", async (authorization) => {
      target = callback(authorization);
      expect(Number(target.port)).toBeGreaterThan(0);
      expect(target.hostname).toBe("127.0.0.1");
      expect(await send(target)).toBe(200);
    }),
  );

  expect(result.redirectUri).toBe(`http://127.0.0.1:${target!.port}/callback`);
  expect(result.code).toBe("fixture-code");
  await expect(send(target!)).rejects.toThrow();
});
