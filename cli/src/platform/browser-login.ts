import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CliError } from "../output/errors.js";

export interface BrowserLoginOptions {
  redirectUri: string;
  signal: AbortSignal;
  timeoutMs?: number;
  authorizeUrl(input: {
    state: string;
    challenge: string;
    redirectUri: string;
  }): string | Promise<string>;
  open(url: string): Promise<void>;
}

export async function browserLogin(
  options: BrowserLoginOptions,
): Promise<{ code: string; verifier: string; redirectUri: string }> {
  let redirect: URL;

  try {
    redirect = new URL(options.redirectUri);
  } catch {
    throw new CliError(
      "usage",
      "Provide a registered loopback HTTP redirect URI with an explicit port",
    );
  }

  if (
    redirect.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(redirect.hostname) ||
    !redirect.port ||
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    ["code", "state", "error", "error_description"].some((key) => redirect.searchParams.has(key))
  ) {
    throw new CliError(
      "usage",
      "Provide a registered loopback HTTP redirect URI without credentials, fragments or OAuth result parameters",
    );
  }

  let redirectUri = options.redirectUri;

  const timeout = options.timeoutMs ?? 120_000;

  if (!Number.isInteger(timeout) || timeout <= 0 || timeout > 2_147_483_647) {
    throw new CliError("usage", "Browser timeout must be a positive number of milliseconds");
  }

  const cancelled = () => new CliError("cancelled", "Browser sign-in cancelled", 130);

  if (options.signal.aborted) {
    throw cancelled();
  }

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  let settled = false;
  let resolve!: (value: { code: string; verifier: string; redirectUri: string }) => void;
  let reject!: (error: unknown) => void;

  const outcome = new Promise<{
    code: string;
    verifier: string;
    redirectUri: string;
  }>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  const fail = (error: unknown) => {
    if (!settled) {
      settled = true;
      reject(error);
    }
  };

  const abort = () => fail(cancelled());

  const server = createServer(
    { maxHeaderSize: 8192, headersTimeout: 10_000, requestTimeout: 10_000 },
    (request, response) => {
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Connection", "close");

      const invalid = (status = 400) => {
        response.writeHead(status).end("This callback was not accepted.");
      };

      if (settled) {
        invalid(410);

        return;
      }

      if (request.method !== "GET") {
        invalid(405);

        return;
      }

      let callback: URL;

      try {
        callback = new URL(request.url!, redirect);
      } catch {
        invalid();

        return;
      }

      const received = Buffer.from(callback.searchParams.get("state") ?? "");

      if (
        request.headers.host?.toLowerCase() !== redirect.host.toLowerCase() ||
        callback.origin !== redirect.origin ||
        callback.pathname !== redirect.pathname ||
        callback.searchParams.getAll("state").length !== 1 ||
        received.length !== Buffer.byteLength(state) ||
        !timingSafeEqual(received, Buffer.from(state)) ||
        [...new Set(redirect.searchParams.keys())].some(
          (key) =>
            JSON.stringify(callback.searchParams.getAll(key)) !==
            JSON.stringify(redirect.searchParams.getAll(key)),
        )
      ) {
        invalid();

        return;
      }

      if (callback.searchParams.has("error") && !callback.searchParams.has("code")) {
        response.writeHead(400).end("Sign-in was not completed. Return to your terminal.");
        fail(new CliError("authentication", "Browser sign-in was declined", 4));

        return;
      }

      const code = callback.searchParams.get("code");

      if (
        !code ||
        !code.trim() ||
        callback.searchParams.getAll("code").length !== 1 ||
        callback.searchParams.has("error")
      ) {
        invalid();

        return;
      }

      settled = true;
      response.end("Sign-in received. Return to your terminal.");
      resolve({ code, verifier, redirectUri });
    },
  );

  server.once("error", fail);

  const timer = setTimeout(
    () => fail(new CliError("timeout", "Browser sign-in timed out", 1)),
    timeout,
  );

  options.signal.addEventListener("abort", abort, { once: true });

  try {
    server.listen(
      Number(redirect.port),
      redirect.hostname === "[::1]" ? "::1" : "127.0.0.1",
      () => {
        if (settled) {
          server.close();

          return;
        }

        if (redirect.port === "0") {
          redirect.port = String((server.address() as AddressInfo).port);
          redirectUri = redirect.href;
        }

        void (async () => {
          const target = new URL(
            await options.authorizeUrl({
              state,
              challenge,
              redirectUri,
            }),
          );

          if (settled) {
            return;
          }

          if (
            !["http:", "https:"].includes(target.protocol) ||
            target.username ||
            target.password ||
            target.searchParams.get("state") !== state ||
            target.searchParams.get("code_challenge") !== challenge ||
            target.searchParams.get("code_challenge_method") !== "S256" ||
            target.searchParams.get("redirect_uri") !== redirectUri
          ) {
            throw new CliError("usage", "Authorization URL does not bind the browser transaction");
          }

          await options.open(target.href);
        })().catch(fail);
      },
    );

    return await outcome;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);

    await new Promise<void>((done) => {
      const force = setTimeout(() => server.closeAllConnections(), 250);

      force.unref();

      server.close(() => {
        clearTimeout(force);
        done();
      });

      server.closeIdleConnections();
    });
  }
}
