import { it, expect } from "vitest";
import { mkdtemp, chmod, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { State, endpoint, validateProfileName, validateConfig } from "../../src/platform/state.js";

it("reads and atomically replaces private JSON while preserving invalid input for diagnosis", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-state-"));
  const s = new State(dir);

  try {
    expect(await s.config()).toEqual({ version: 1, profiles: {} });

    await s.write("config.json", {
      version: 1,
      profiles: {
        x: { endpoint: "https://example.test", credentialStore: "file" },
      },
    });

    expect((await s.config()).profiles.x?.endpoint).toBe("https://example.test");
    await s.write("value.json", null);
    expect(await s.read("value.json", 1)).toBeNull();

    if (process.platform !== "win32") {
      await chmod(join(dir, "value.json"), 0o644);
      await expect(s.read("value.json", null)).rejects.toThrow("private");
    }

    await symlink(join(dir, "config.json"), join(dir, "linked.json"));
    await expect(s.read("linked.json", null)).rejects.toThrow();
    await expect(s.write("linked.json", {})).rejects.toThrow("regular");
    await expect(s.read("../outside", null)).rejects.toThrow("key");

    if (process.platform !== "win32") {
      await chmod(dir, 0o755);
      await expect(s.write("x", {})).rejects.toThrow("private");
    }
  } finally {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true });
  }
});

it("validates configuration origins, shapes and credential policy", () => {
  expect(endpoint("https://example.test/")).toBe("https://example.test");

  for (const input of [
    "bad",
    "ftp://example.test",
    "https://a:b@example.test",
    "https://example.test/a",
    "https://example.test/?x",
    "https://example.test/#x",
  ]) {
    expect(() => endpoint(input)).toThrow();
  }

  validateProfileName("a-b_1");

  for (const name of ["", "../x", "a".repeat(65)]) {
    expect(() => validateProfileName(name)).toThrow();
  }

  for (const value of [
    null,
    {},
    [],
    { version: 2, profiles: {} },
    { version: 1, profiles: [] },
    { version: 1, profiles: { bad: null } },
    {
      version: 1,
      profiles: { bad: { endpoint: "bad", credentialStore: "file" } },
    },
    {
      version: 1,
      profiles: { bad: { endpoint: "https://a.test", credentialStore: "bad" } },
    },
  ]) {
    expect(() => validateConfig(value)).toThrow();
  }

  expect(
    validateConfig({
      version: 1,
      profiles: {
        p: { endpoint: "https://a.test", credentialStore: "native" },
      },
    }).profiles.p?.credentialStore,
  ).toBe("native");
});

it("serializes short transactions without losing another update and releases after failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-txn-"));
  const s = new State(dir);

  try {
    await Promise.all(
      Array.from({ length: 20 }, () => s.transaction("counter.json", 0, (value) => value + 1)),
    );

    expect(await s.read("counter.json", 0)).toBe(20);

    await expect(
      s.exclusive("test", async () => {
        throw Error("operation failure");
      }),
    ).rejects.toThrow("operation failure");

    await s.exclusive("test", async () => expect(s.signal?.aborted).toBe(false));

    const controller = new AbortController();

    controller.abort();
    await expect(s.exclusive("test", async () => {}, controller.signal)).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true });
  }
});

it("aborts a waiting lease and prevents writes after lease compromise", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-compromise-"));
  const s = new State(dir);

  try {
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => (entered = resolve));
    let release!: () => void;

    const held = s.exclusive("one", async () => {
      entered();
      await new Promise<void>((resolve) => (release = resolve));
    });

    await ready;

    const controller = new AbortController();
    const waiting = s.exclusive("one", async () => {}, controller.signal);

    controller.abort();
    await expect(waiting).rejects.toThrow();
    release();
    await held;

    let active!: () => void;
    const started = new Promise<void>((resolve) => (active = resolve));

    const compromised = s.exclusive("two", async () => {
      active();

      await new Promise<void>((resolve) =>
        s.signal!.addEventListener("abort", () => resolve(), { once: true }),
      );

      await s.write("must-not-exist.json", {});
    });

    await started;
    await rm(join(dir, "two.lock"), { recursive: true });
    await expect(compromised).rejects.toThrow();
    expect(await s.read("must-not-exist.json", null)).toBeNull();
  } finally {
    await rm(dir, { recursive: true });
  }
}, 10000);

it("rejects an oversized saved file before loading it", async () => {
  const { open } = await import("node:fs/promises");

  const dir = await mkdtemp(join(tmpdir(), "cr-state-size-"));
  const path = join(dir, "large.json");

  try {
    const file = await open(path, "wx", 0o600);

    await file.truncate(17 * 1024 * 1024);
    await file.close();
    await expect(new State(dir).read("large.json", null)).rejects.toThrow("size limit");
  } finally {
    await rm(dir, { recursive: true });
  }
});

it("carries parent lease cancellation into nested atomic updates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-nested-"));
  const s = new State(dir);

  try {
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => (entered = resolve));

    const operation = s.exclusive("parent", () =>
      s.exclusive("child", async () => {
        entered();

        await new Promise<void>((resolve) =>
          s.signal!.addEventListener("abort", () => resolve(), { once: true }),
        );

        await s.write("must-not-exist.json", true);
      }),
    );

    await ready;
    await rm(join(dir, "parent.lock"), { recursive: true });
    await expect(operation).rejects.toThrow();
    expect(await s.read("must-not-exist.json", null)).toBeNull();
  } finally {
    await rm(dir, { recursive: true });
  }
}, 10000);

it("refuses an oversized replacement without destroying the prior readable state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-state-write-"));
  const s = new State(dir);

  try {
    await s.write("value.json", { saved: true });
    await expect(s.write("value.json", "x".repeat(17 * 1024 * 1024))).rejects.toThrow("size limit");
    expect(await s.read("value.json", null)).toEqual({ saved: true });
  } finally {
    await rm(dir, { recursive: true });
  }
});
