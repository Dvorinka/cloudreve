import { createHash, randomUUID } from "node:crypto";
import * as v from "valibot";
import { SessionRecordSchema, type SessionRecord, type SessionStore } from "@cloudreve/sdk/session";
import { decode } from "@cloudreve/sdk/protocol";
import { CliError } from "../output/errors.js";
import { type Credentials, accountKey } from "./credentials.js";
import { validateConfig, type Config, type State, type Connection } from "./state.js";

const HeadSchema = v.object({
  version: v.literal(1),
  generation: v.pipe(v.string(), v.minLength(1)),
});

const hash = (key: string, generation: string) =>
  createHash("sha256")
    .update(JSON.stringify([key, generation]))
    .digest("hex");

export const credentialGenerationKey = (key: string, generation: string) =>
  "generation-" + hash(key, generation);

export const revocationKey = (key: string, generation: string) =>
  "revoked-" + hash(key, generation) + ".json";

export async function persistLogin(
  state: State,
  credentials: Credentials,
  profile: Connection,
  accountId: string,
  record: SessionRecord,
  signal?: AbortSignal,
): Promise<void> {
  const key = accountKey(profile.endpoint, accountId, profile.credentialStore, profile.authContext);

  await credentials.put(
    credentialGenerationKey(key, record.generation),
    profile.credentialStore,
    record,
    signal,
  );

  await state.write(key + ".identity.json", {
    version: 1,
    generation: record.generation,
  });
}

export async function credentialSession(
  state: State,
  credentials: Credentials,
  profileName: string,
  profile: Connection,
  signal?: AbortSignal,
) {
  if (!profile.accountId) {
    throw new CliError("authentication", "Sign in using cr auth login", 4);
  }

  const key = accountKey(
    profile.endpoint,
    profile.accountId,
    profile.credentialStore,
    profile.authContext,
  );

  const headFile = key + ".identity.json";
  const lock = "auth-" + key;

  const head = async () => {
    const value = await state.read(headFile, null);

    if (value === null) {
      return null;
    }

    const result = v.safeParse(HeadSchema, value);

    if (!result.success) {
      throw new CliError("state", "Invalid credential identity record", 1);
    }

    return result.output;
  };

  const revoked = async (generation: string) => {
    const value = await state.read(revocationKey(key, generation), false);

    if (typeof value !== "boolean") {
      throw new CliError("state", "Invalid revocation marker", 1);
    }

    return value;
  };

  const read = async (): Promise<SessionRecord> => {
    const current = await head();

    if (!current) {
      throw new CliError("state", "Credential identity record missing", 1);
    }

    if (await revoked(current.generation)) {
      return { generation: current.generation, tokens: null };
    }

    const record = decode(
      SessionRecordSchema,
      await credentials.record(
        credentialGenerationKey(key, current.generation),
        profile.credentialStore,
        signal,
      ),
      "Invalid saved credentials",
    );

    if (record.generation !== current.generation) {
      throw new CliError("state", "Credential generation mismatch", 1);
    }

    return (await revoked(current.generation)) ? { ...record, tokens: null } : record;
  };

  const store: SessionStore & {
    invalidate(generation: string): Promise<void>;
  } = {
    read,
    async write(record) {
      const current = await head();

      if (!current || current.generation !== record.generation) {
        throw new CliError("authentication", "Credential generation changed", 4);
      }

      if (record.tokens && (await revoked(record.generation))) {
        throw new CliError("authentication", "Credential generation was revoked", 4);
      }

      await credentials.put(
        credentialGenerationKey(key, record.generation),
        profile.credentialStore,
        record,
        signal,
      );
    },
    invalidate: (generation) => state.write(revocationKey(key, generation), true),
  };

  const initial = await state.exclusive(
    lock,
    async () => {
      if (await head()) {
        return read();
      }

      const initialize = async () => {
        const previous = await credentials.record(key, profile.credentialStore, signal);

        const legacy =
          previous === null
            ? await credentials.get(profileName, profile.credentialStore, signal)
            : null;

        const record: SessionRecord =
          previous === null
            ? { generation: randomUUID(), tokens: legacy }
            : decode(SessionRecordSchema, previous, "Invalid saved credentials");

        await persistLogin(state, credentials, profile, profile.accountId!, record, signal);
        await credentials.save(profileName, profile.credentialStore, null, signal);

        if (previous !== null) {
          await credentials.put(key, profile.credentialStore, null, signal);
        }

        return read();
      };

      if (!profile.id) {
        return initialize();
      }

      let migrated: SessionRecord | undefined;

      await state.transaction<Config>(
        "config.json",
        { version: 1, profiles: {} },
        async (value) => {
          const config = validateConfig(value);
          const current = config.profiles[profileName];

          if (
            !current ||
            current.id !== profile.id ||
            current.endpoint !== profile.endpoint ||
            current.accountId !== profile.accountId ||
            current.credentialStore !== profile.credentialStore ||
            current.authContext !== profile.authContext
          ) {
            throw new CliError("profile", "Connection changed during credential migration");
          }

          migrated = await initialize();

          return config;
        },
        signal,
      );

      return migrated!;
    },
    signal,
  );

  return {
    store,
    generation: initial.generation,
    exclusive: <T>(operation: () => Promise<T>, cancellation?: AbortSignal) =>
      state.exclusive(lock, operation, cancellation),
  };
}
