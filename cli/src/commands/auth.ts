import {
  CLI_OAUTH_CLIENT,
  createCliOAuthAuthorizationUrl,
  type PasswordLoginResponse,
  parseCredentialLink,
  validateServerVersion,
  normalizeServerUrl,
  parseOAuthAuthorizationLink,
} from "@cloudreve/sdk/session";
import type { Context } from "../composition.js";
import { endpoint, validateProfileName } from "../connection.js";
import { CliError } from "../output/errors.js";
import { arg, flag, numberFlag } from "../input.js";

export async function profileList(c: Context) {
  return { selected: c.config.selected, profiles: c.config.profiles };
}

export async function profileAdd(c: Context) {
  const name = arg(c.inv, 0);

  validateProfileName(name);

  const store = c.inv.flags["credential-store"] ?? c.credentials.defaultStore();

  if (!["file", "keychain", "native"].includes(String(store))) {
    throw new CliError("usage", "Unknown credential store");
  }

  await c.updateConfig((config) => {
    if (config.profiles[name]) {
      throw new CliError("profile", "Profile already exists");
    }

    config.profiles[name] = {
      id: c.bytes.uniqueId(),
      endpoint: endpoint(flag(c.inv, "server")),
      credentialStore: store as "file" | "keychain" | "native",
    };

    config.selected ??= name;

    return config;
  });

  return { profile: name };
}

export async function profileUse(c: Context) {
  const name = arg(c.inv, 0);

  await c.updateConfig((config) => {
    if (!config.profiles[name]) {
      throw new CliError("profile", "Unknown profile");
    }

    config.selected = name;

    return config;
  });

  return { profile: name };
}

export async function profileRemove(c: Context) {
  const name = arg(c.inv, 0);
  const profile = c.config.profiles[name];

  if (!profile) {
    throw new CliError("profile", "Unknown profile");
  }

  const expected = { ...profile };

  const matches = (current: typeof expected | undefined) =>
    current?.id === expected.id &&
    current?.endpoint === expected.endpoint &&
    current?.accountId === expected.accountId &&
    current?.credentialStore === expected.credentialStore &&
    current?.authContext === expected.authContext &&
    current?.loginRevision === expected.loginRevision;

  await c.confirm(`Remove profile ${name}`);

  if (!matches((await c.state.config()).profiles[name])) {
    throw new CliError("profile", "Connection changed during removal");
  }

  const logout = await c.captureLogout(name);

  if (!matches((await c.state.config()).profiles[name])) {
    throw new CliError("profile", "Connection changed during removal");
  }

  let revocationFailure: unknown;

  try {
    await logout?.();
  } catch (error) {
    if ((error as { phase?: string })?.phase !== "revocation") {
      throw error;
    }

    revocationFailure = error;
  }

  await c.updateConfig((config) => {
    if (!matches(config.profiles[name])) {
      throw new CliError("profile", "Connection changed during removal");
    }

    delete config.profiles[name];

    if (config.selected === name) {
      delete config.selected;
    }

    return config;
  });

  if (revocationFailure) {
    throw new CliError(
      "revocation",
      "Profile removed locally; server revocation was not confirmed",
      1,
      { profile: name, removed: true, revoked: false },
    );
  }

  return { profile: name };
}

export async function secrets(c: Context): Promise<Record<string, string>> {
  if (!c.inv.flags["secrets-stdin"]) {
    return {};
  }

  const raw = await c.io.input(32768);

  try {
    const value = JSON.parse(raw.toString());

    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.values(value).some((v) => typeof v !== "string")
    ) {
      throw new Error();
    }

    return value;
  } catch {
    throw new CliError("input", "--secrets-stdin expects a JSON object of strings");
  }
}

export async function authStatus(c: Context) {
  const accounts = await Promise.all(
    Object.entries(c.config.profiles).map(async ([name, p]) => {
      const authenticated = p.accountId
        ? (await c.session(name)).getSnapshot().status === "authenticated"
        : false;

      return {
        name,
        endpoint: p.endpoint,
        accountId: p.accountId,
        email: p.email,
        authentication: p.authContext ?? "password",
        authenticated,
        active: c.config.selected === name && authenticated,
        selectedForInvocation: c.name === name,
      };
    }),
  );

  const selected = accounts.find((account) => account.selectedForInvocation);

  return {
    profile: selected?.name,
    endpoint: selected?.endpoint,
    accountId: selected?.accountId,
    authentication: selected?.authentication ?? "password",
    authenticated: selected?.authenticated ?? false,
    accounts,
  };
}

export async function authSwitch(c: Context) {
  const name = arg(c.inv, 0);
  const profile = c.config.profiles[name];

  if (!profile) {
    throw new CliError(
      "account",
      "Unknown saved account; add it with cr auth login --name NAME --server URL",
    );
  }

  if (!profile.accountId || (await c.session(name)).getSnapshot().status !== "authenticated") {
    throw new CliError(
      "authentication",
      `Account ${name} is signed out; run cr auth login --name ${name}`,
      4,
    );
  }

  await c.updateConfig((config) => {
    const current = config.profiles[name];

    if (
      !current ||
      current.id !== profile.id ||
      current.accountId !== profile.accountId ||
      current.endpoint !== profile.endpoint ||
      current.credentialStore !== profile.credentialStore ||
      current.authContext !== profile.authContext ||
      current.loginRevision !== profile.loginRevision
    ) {
      throw new CliError("account", "Saved account changed during selection; retry auth switch");
    }

    config.selected = name;

    return config;
  });

  return {
    profile: name,
    endpoint: profile.endpoint,
    accountId: profile.accountId,
  };
}

export async function authLogout(c: Context) {
  const name = c.inv.args[0] ?? c.name;

  if (!c.config.profiles[name]) {
    throw new CliError("account", "Unknown saved account");
  }

  await c.logout(name);

  return { profile: name };
}

export async function authLogin(c: Context) {
  await c.ensureSupported();

  const passwordInput =
    c.inv.flags.email ||
    c.inv.flags["password-stdin"] ||
    c.inv.flags["credential-stdin"] ||
    c.inv.flags["secrets-stdin"];

  if (c.inv.flags.browser || c.inv.flags["authorize-url"] || !passwordInput) {
    return authBrowser(c);
  }

  if (c.inv.flags["browser-command"] || c.inv.flags.timeout || c.inv.flags.open === false) {
    throw new CliError("usage", "Browser options require browser login");
  }

  const p = c.connection();
  const a = c.auth(p);
  const { inv } = c;

  const supplied = await secrets(c);
  let session: PasswordLoginResponse;

  if (inv.flags["credential-stdin"]) {
    const link = parseCredentialLink((await c.io.input(32768)).toString());

    if (link.endpoint !== p.endpoint) {
      throw new CliError("input", "Credential link belongs to a different server");
    }

    session = await a.importRefreshToken(link.refreshToken);
  } else {
    const email = flag(inv, "email");

    const config = await a.config(c.signal);

    if (config.login_captcha && !supplied.captcha) {
      throw new CliError(
        "capability",
        "Password login cannot solve this server's CAPTCHA. Use cr auth login --browser, or supply a CAPTCHA response with --secrets-stdin.",
      );
    }

    const password = inv.flags["password-stdin"]
      ? (await c.io.input(1024)).toString().replace(/\r?\n$/, "")
      : (supplied.password ?? (await c.io.secret("Password")));

    const preparation = await a.prepare(email);

    if (!preparation.passwordEnabled) {
      throw new CliError(
        "capability",
        "Password sign-in is disabled; use auth login --browser or a supported credential link",
      );
    }

    const result = await a.password(email, password, {
      captcha: supplied.captcha,
      ticket: supplied.ticket,
    });

    session =
      result.kind === "authenticated"
        ? result.session
        : await a.otp(result.sessionId, supplied.otp ?? (await c.io.secret("Six-digit OTP")));

    p.email = email;
  }

  await c.signIn(session, p.email);

  return { profile: c.name, account: session.user };
}

export async function serverInfo(c: Context) {
  const origin = normalizeServerUrl(c.inv.args[0] ?? c.connection().endpoint);

  const version = await validateServerVersion(origin, (url, init) =>
    c.transport(url, { ...init, signal: c.signal }),
  );

  return c.inv.flags.auth
    ? { ...version, auth: await c.auth({ endpoint: origin }).config(c.signal) }
    : version;
}

async function authBrowser(c: Context) {
  if (!c.inv.flags["authorize-url"]) {
    if (c.inv.flags["secrets-stdin"]) {
      throw new CliError("usage", "Built-in browser login does not require a client secret");
    }

    const authentication = c.auth(c.connection());

    await authentication.cliOAuthApplication(c.signal);

    const redirect = new URL(CLI_OAUTH_CLIENT.redirectUri);

    redirect.port = "0";

    const callback = await c.browserLogin(
      {
        redirectUri: redirect.href,
        timeoutMs: numberFlag(c.inv, "timeout") ?? 600_000,
        authorizeUrl: (proof) => createCliOAuthAuthorizationUrl(c.connection().endpoint, proof),
      },
      c.inv.flags["browser-command"] as string | undefined,
    );

    const token = await authentication.exchangeOAuthToken(
      {
        clientId: CLI_OAUTH_CLIENT.clientId,
        clientSecret: CLI_OAUTH_CLIENT.clientSecret,
        code: callback.code,
        redirectUri: callback.redirectUri,
        codeVerifier: callback.verifier,
      },
      c.signal,
    );

    return { profile: c.name, account: await c.signInOAuth(token, CLI_OAUTH_CLIENT.clientId) };
  }

  const supplied = await secrets(c);

  if (!supplied.clientSecret) {
    throw new CliError("usage", "Provide clientSecret with --secrets-stdin");
  }

  const input = flag(c.inv, "authorize-url");
  const request = parseOAuthAuthorizationLink(input, c.connection().endpoint);

  const callback = await c.browserLogin(
    {
      redirectUri: request.redirect_uri,
      timeoutMs: numberFlag(c.inv, "timeout"),
      authorizeUrl: ({ state, challenge, redirectUri }) => {
        const url = new URL(input);

        url.search = new URLSearchParams(
          Object.entries({
            ...request,
            state,
            redirect_uri: redirectUri,
            code_challenge: challenge,
            code_challenge_method: "S256",
          }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        ).toString();

        return url.toString();
      },
    },
    c.inv.flags["browser-command"] as string | undefined,
  );

  const token = await c.auth(c.connection()).exchangeOAuthToken(
    {
      clientId: request.client_id,
      clientSecret: supplied.clientSecret,
      redirectUri: callback.redirectUri,
      code: callback.code,
      codeVerifier: callback.verifier,
    },
    c.signal,
  );

  return {
    profile: c.name,
    account: await c.signInOAuth(token, request.client_id),
  };
}
