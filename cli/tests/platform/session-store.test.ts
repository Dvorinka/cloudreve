import { it, expect } from "vitest";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  credentialSession,
  credentialGenerationKey,
  persistLogin,
  revocationKey,
} from "../../src/platform/session-store.js";
import { Credentials, accountKey } from "../../src/platform/credentials.js";
import { State, type Connection } from "../../src/platform/state.js";

const tokens = {
  accessToken: "access",
  refreshToken: "refresh",
  accessExpiresAt: 1,
  refreshExpiresAt: 2,
};

const profile: Connection = {
  endpoint: "https://a.test",
  accountId: "a",
  credentialStore: "file",
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "cr-generation-"));
  const state = new State(dir);
  const credentials = new Credentials(state);

  return { dir, state, credentials, key: accountKey(profile.endpoint, "a") };
}

it("migrates legacy tokens once and keeps native writes in generation-specific keys", async () => {
  const x = await fixture();

  try {
    await x.credentials.save("old", "file", tokens);

    const bound = await credentialSession(x.state, x.credentials, "old", profile);
    const first = await bound.store.read();

    expect(first.tokens).toEqual(tokens);
    expect(await x.credentials.get("old", "file")).toBeNull();

    const refreshed = { ...first, tokens: { ...tokens, accessToken: "fresh" } };

    await bound.exclusive(() => bound.store.write(refreshed));
    expect(await bound.store.read()).toEqual(refreshed);
    await bound.store.invalidate(first.generation);
    await expect(bound.store.write(refreshed)).rejects.toThrow("revoked");
    await bound.store.write({ ...first, tokens: null });
    expect((await bound.store.read()).tokens).toBeNull();

    const next = { generation: "next-login", tokens };

    await bound.exclusive(() => persistLogin(x.state, x.credentials, profile, "a", next));
    await x.credentials.put(credentialGenerationKey(x.key, first.generation), "file", refreshed);
    expect(await bound.store.read()).toEqual(next);
    await expect(bound.store.write(refreshed)).rejects.toThrow("changed");
  } finally {
    await rm(x.dir, { recursive: true });
  }
});

it("negative markers revoke immediately without waiting for an outstanding refresh lease", async () => {
  const x = await fixture();

  try {
    const bound = await credentialSession(x.state, x.credentials, "old", profile);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => (entered = resolve));

    const held = bound.exclusive(async () => {
      entered();
      await new Promise<void>((resolve) => (release = resolve));
    });

    await ready;
    await bound.store.invalidate(bound.generation);
    expect((await bound.store.read()).tokens).toBeNull();
    release();
    await held;
  } finally {
    await rm(x.dir, { recursive: true });
  }
});

it("fails closed on corrupt pointers, markers, missing payloads and mismatched generations", async () => {
  const x = await fixture();

  try {
    await expect(
      credentialSession(x.state, x.credentials, "old", {
        ...profile,
        accountId: undefined,
      }),
    ).rejects.toMatchObject({ status: 4 });

    await x.state.write(x.key + ".identity.json", {});

    await expect(credentialSession(x.state, x.credentials, "old", profile)).rejects.toThrow(
      "identity",
    );

    await unlink(join(x.dir, x.key + ".identity.json"));

    const bound = await credentialSession(x.state, x.credentials, "old", profile);

    await x.state.write(revocationKey(x.key, bound.generation), "invalid");
    await expect(bound.store.read()).rejects.toThrow("marker");
    await x.state.write(revocationKey(x.key, bound.generation), false);

    await x.credentials.put(credentialGenerationKey(x.key, bound.generation), "file", {
      generation: "wrong",
      tokens,
    });

    await expect(bound.store.read()).rejects.toThrow("mismatch");
    await unlink(join(x.dir, x.key + ".identity.json"));
    await expect(bound.store.read()).rejects.toThrow("missing");
    await expect(bound.store.write({ generation: "wrong", tokens })).rejects.toThrow("changed");
  } finally {
    await rm(x.dir, { recursive: true });
  }
});

it("rechecks revocation after an in-flight vault read returns", async () => {
  const { vi } = await import("vitest");
  const x = await fixture();

  try {
    await x.credentials.save("old", "file", tokens);

    const bound = await credentialSession(x.state, x.credentials, "old", profile);
    const original = x.credentials.record.bind(x.credentials);

    const spy = vi.spyOn(x.credentials, "record").mockImplementation(async (...args) => {
      const value = await original(...args);

      await bound.store.invalidate(bound.generation);

      return value;
    });

    expect((await bound.store.read()).tokens).toBeNull();
    spy.mockRestore();
  } finally {
    await rm(x.dir, { recursive: true });
  }
});

it("keeps file and native authority independent for profiles with the same endpoint/account", async () => {
  const { vi } = await import("vitest");

  const x = await fixture();
  const vault = new Map<string, unknown>();

  const record = vi
    .spyOn(x.credentials, "record")
    .mockImplementation(async (name, store) => vault.get(store + ":" + name) ?? null);

  const put = vi.spyOn(x.credentials, "put").mockImplementation(async (name, store, value) => {
    vault.set(store + ":" + name, structuredClone(value));
  });

  try {
    await x.credentials.save("file-profile", "file", {
      ...tokens,
      accessToken: "file-token",
    });

    await x.credentials.save("native-profile", "native", {
      ...tokens,
      accessToken: "native-token",
    });

    const file = await credentialSession(x.state, x.credentials, "file-profile", profile);

    const native = await credentialSession(x.state, x.credentials, "native-profile", {
      ...profile,
      credentialStore: "native",
    });

    expect(accountKey(profile.endpoint, "a", "file")).not.toBe(
      accountKey(profile.endpoint, "a", "native"),
    );

    expect((await file.store.read()).tokens?.accessToken).toBe("file-token");
    expect((await native.store.read()).tokens?.accessToken).toBe("native-token");
    await file.store.invalidate(file.generation);
    expect((await file.store.read()).tokens).toBeNull();
    expect((await native.store.read()).tokens?.accessToken).toBe("native-token");

    await file.exclusive(() =>
      persistLogin(x.state, x.credentials, profile, "a", {
        generation: "new-file",
        tokens,
      }),
    );

    expect((await native.store.read()).tokens?.accessToken).toBe("native-token");
  } finally {
    record.mockRestore();
    put.mockRestore();
    await rm(x.dir, { recursive: true });
  }
});

it("does not migrate profile-named credentials after that profile identity is replaced", async () => {
  const x = await fixture();

  try {
    await x.state.write("config.json", {
      version: 1,
      profiles: { old: { ...profile, id: "new-profile" } },
    });

    await x.credentials.save("old", "file", tokens);

    await expect(
      credentialSession(x.state, x.credentials, "old", {
        ...profile,
        id: "old-profile",
      }),
    ).rejects.toThrow("changed during credential migration");

    expect(await x.state.read(x.key + ".identity.json", null)).toBeNull();
    expect(await x.credentials.get("old", "file")).toEqual(tokens);
  } finally {
    await rm(x.dir, { recursive: true });
  }
});
