import { requireServerVersion } from "./compatibility.js";
import { browserLogin, type BrowserLoginOptions } from "./platform/browser-login.js";
import { openBrowser } from "./platform/browser.js";
import { credentialSession, persistLogin } from "./platform/session-store.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createClient,
  createPublicClient,
  type PublicClient,
  type CloudreveClient,
} from "@cloudreve/sdk/client";
import {
  Authentication,
  validateServerVersion,
  tokensFromPassword,
  tokensFromOAuth,
  type OAuthTokenResponse,
  type PasswordLoginResponse,
  type SessionRecord,
} from "@cloudreve/sdk/session";
import {
  State,
  validateConfig,
  endpoint,
  validateProfileName,
  type Config,
  type Connection,
} from "./platform/state.js";
import { Credentials, accountKey } from "./platform/credentials.js";
import { transport } from "./platform/transport.js";
import * as bytes from "./platform/files.js";
import * as localTree from "./platform/local-tree.js";
import { editText } from "./platform/editor.js";
import type { Terminal } from "./platform/terminal.js";
import { CliError } from "./output/errors.js";
import type { Invocation } from "./input.js";

/** Bind one invocation to its selected account, platform services, and cancellation signal. */
export async function compose(
  inv: Invocation,
  io: Terminal,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
) {
  const state = new State(
    String(
      inv.flags["config-dir"] ??
        env.CLOUDREVE_CONFIG_DIR ??
        join(homedir(), ".config", "cloudreve"),
    ),
  );

  const credentials = new Credentials(state);

  let config = await state.config();

  if (Object.values(config.profiles).some((p) => !p.id)) {
    config = await state.transaction(
      "config.json",
      config,
      (value) => {
        const current = validateConfig(value);

        for (const p of Object.values(current.profiles)) {
          p.id ??= randomUUID();
        }

        return current;
      },
      signal,
    );
  }

  const login = inv.command === "auth login";
  const explicitProfile = inv.flags.profile ?? env.CLOUDREVE_PROFILE;

  const name = String(
    (login ? inv.flags.name : undefined) ??
      explicitProfile ??
      config.selected ??
      (login || !Object.keys(config.profiles).length ? "default" : ""),
  );

  let pending: Connection | undefined;

  if (login) {
    validateProfileName(name);

    const existing = config.profiles[name];

    if (existing && inv.flags.server && endpoint(String(inv.flags.server)) !== existing.endpoint) {
      throw new CliError(
        "profile",
        "Saved account belongs to a different server; use --name with a new name",
      );
    }

    if (!existing) {
      const origin = inv.flags.server ?? config.profiles[config.selected ?? ""]?.endpoint;

      if (!origin) {
        throw new CliError("usage", "Provide --server https://cloud.example for the first login");
      }

      const store =
        inv.flags["credential-store"] ??
        config.profiles[config.selected ?? ""]?.credentialStore ??
        credentials.defaultStore();

      if (!["file", "native", "keychain"].includes(String(store))) {
        throw new CliError("usage", "Unknown credential store");
      }

      pending = {
        id: randomUUID(),
        endpoint: endpoint(String(origin)),
        credentialStore: store as Connection["credentialStore"],
      };
    } else if (
      inv.flags["credential-store"] &&
      inv.flags["credential-store"] !== existing.credentialStore
    ) {
      throw new CliError(
        "profile",
        "Saved account uses a different credential store; use --name with a new name",
      );
    }
  }

  const connection = () => {
    const p = config.profiles[name] ?? pending;

    if (!p) {
      throw new CliError(
        "profile",
        "No active account; run cr auth login --server https://cloud.example or cr auth switch NAME",
      );
    }

    return p;
  };

  const versions = new Map<string, ReturnType<typeof validateServerVersion>>();

  async function ensureSupported(feature?: "trash-empty", endpoint = connection().endpoint) {
    let found = versions.get(endpoint);

    if (!found) {
      found = validateServerVersion(endpoint, (url, init) =>
        transport(url, {
          ...init,
          signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
        }),
      );

      versions.set(endpoint, found);
    }

    return requireServerVersion(await found, feature);
  }

  const clients = new Map<string, Promise<CloudreveClient>>();

  async function bound(profileName: string, p: Connection) {
    if (!p.accountId) {
      throw new CliError("authentication", "Sign in using cr auth login", 4);
    }

    const binding = await credentialSession(state, credentials, profileName, p, signal);

    const created = await createClient({
      accountId: p.accountId,
      endpoint: p.endpoint,
      generation: binding.generation,
      store: binding.store,
      exclusive: binding.exclusive,
      transport: async (url, init) => {
        await ensureSupported(undefined, p.endpoint);

        return transport(url, init);
      },
      timeoutMs: 30000,
    });

    if (signal.aborted) {
      created.session.invalidate();
    }

    signal.addEventListener("abort", () => created.session.invalidate(), {
      once: true,
    });

    return created;
  }

  const localClient = (profileName = name) => {
    let client = clients.get(profileName);

    if (!client) {
      const p = config.profiles[profileName];

      if (!p) {
        throw new CliError("profile", "Unknown saved account");
      }

      client = bound(profileName, p);
      clients.set(profileName, client);
    }

    return client;
  };

  const session = async (profileName = name) => (await localClient(profileName)).session;

  const backend = async () => {
    if (!connection().accountId) {
      return localClient();
    }

    await ensureSupported();

    return localClient();
  };

  let publicClient: PublicClient | undefined;

  const publicBackend = async () => {
    await ensureSupported();

    return (publicClient ??= createPublicClient({
      endpoint: connection().endpoint,
      transport,
      signal,
    }));
  };

  const reader = async () =>
    inv.flags.guest ? (await publicBackend()).files : (await backend()).files;

  const sharePassword = inv.flags["share-password-stdin"]
    ? (await io.input(32768)).toString().replace(/\r?\n$/, "")
    : undefined;

  if (inv.flags["share-password-stdin"] && !sharePassword) {
    throw new CliError("input", "Share password must not be empty");
  }

  async function updateConfig(update: (value: Config) => Config | Promise<Config>) {
    config = await state.transaction(
      "config.json",
      { version: 1, profiles: {} },
      (value) => update(validateConfig(value)),
      signal,
    );

    return config;
  }

  async function saveLogin(
    accountId: string,
    tokens: NonNullable<SessionRecord["tokens"]>,
    email?: string,
    authContext?: string,
  ) {
    const p = { ...connection() };
    const creating = pending !== undefined;
    const key = accountKey(p.endpoint, accountId, p.credentialStore, authContext);

    const record: SessionRecord = {
      generation: randomUUID(),
      tokens,
    };

    await state.exclusive(
      "auth-" + key,
      async () => {
        await updateConfig(async (value) => {
          const current = value.profiles[name];

          if (creating ? current !== undefined : !current || !sameConnection(current, p)) {
            throw new CliError("profile", "Connection changed during authentication");
          }

          if (p.accountId && p.accountId !== accountId) {
            throw new CliError(
              "account",
              "This saved account belongs to a different user; add the other user with auth login --name NAME",
            );
          }

          if (
            !p.accountId &&
            Object.values(value.profiles).some(
              (other) =>
                other.accountId === accountId &&
                accountKey(other.endpoint, accountId, other.credentialStore, other.authContext) ===
                  key,
            )
          ) {
            throw new CliError(
              "account",
              "Account already saved; use cr auth switch NAME to select it",
            );
          }

          await persistLogin(state, credentials, { ...p, authContext }, accountId, record, signal);

          const saved = current ?? (value.profiles[name] = p);

          saved.accountId = accountId;
          saved.loginRevision = record.generation;

          if (authContext) {
            saved.authContext = authContext;
          } else {
            delete saved.authContext;
          }

          if (email) {
            saved.email = email;
          }

          if (inv.flags.name || !explicitProfile) {
            value.selected = name;
          }

          return value;
        });
      },
      signal,
    );

    pending = undefined;
  }

  async function signIn(response: PasswordLoginResponse, email?: string) {
    await saveLogin(response.user.id, tokensFromPassword(response.token), email);
  }

  async function signInOAuth(response: OAuthTokenResponse, clientId: string) {
    const config = await new Authentication(
      connection().endpoint,
      transport,
      signal,
    ).configForToken(response.access_token, signal);

    if (!config.user) {
      throw new CliError("authentication", "OAuth token has no readable Cloudreve account", 4);
    }

    await saveLogin(
      config.user.id,
      tokensFromOAuth(response),
      config.user.email,
      "oauth:" +
        clientId +
        ":" +
        [...new Set(response.scope.split(/\s+/).filter(Boolean))].sort().join(" "),
    );

    return config.user;
  }

  async function captureLogout(profileName = name) {
    const p = config.profiles[profileName];

    if (!p?.accountId) {
      return;
    }

    const current = await localClient(profileName);

    return () => current.session.logout({ revoke: true });
  }

  async function logout(profileName = name) {
    await (
      await captureLogout(profileName)
    )?.();
  }

  return {
    runOwner: { id: randomUUID(), pid: process.pid },
    isRunning(pid: number) {
      try {
        process.kill(pid, 0);

        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          return false;
        }

        throw error;
      }
    },
    inv,
    io,
    signal,
    state,
    get config() {
      return config;
    },
    name,
    connection,
    ensureSupported,
    backend,
    session,
    publicBackend,
    reader,
    sharePassword,
    credentials,
    bytes,
    localTree,
    editText,
    runtime: () => ({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    }),
    transport,
    auth: (p: Pick<Connection, "endpoint">) => new Authentication(p.endpoint, transport, signal),
    updateConfig,
    signIn,
    signInOAuth,
    browserLogin: (options: Omit<BrowserLoginOptions, "open" | "signal">, browser?: string) =>
      browserLogin({
        ...options,
        signal,
        open: async (url) => {
          await io.diagnostic(`Authorize in a browser on this computer:\n${url}\n`);

          if (inv.flags.open !== false) {
            await openBrowser(url, signal, browser);
          }
        },
      }),
    logout,
    captureLogout,
    async confirm(label: string) {
      if (!inv.flags.yes && !(await io.confirm(label))) {
        throw new CliError("confirmation", "Confirmation declined");
      }
    },
    async dispose() {
      publicClient?.dispose();

      for (const client of clients.values()) {
        try {
          (await client).session.invalidate();
        } catch {
          /* Failed initialization has no live resources. */
        }
      }
    },
  };
}

export type Context = Awaited<ReturnType<typeof compose>>;

function sameConnection(a: Connection, b: Connection) {
  return (
    a.id === b.id &&
    a.endpoint === b.endpoint &&
    a.accountId === b.accountId &&
    a.credentialStore === b.credentialStore &&
    a.authContext === b.authContext &&
    a.loginRevision === b.loginRevision
  );
}
