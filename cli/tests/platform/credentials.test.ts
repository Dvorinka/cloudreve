import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it, expect, vi } from "vitest";
import { Credentials, accountKey } from "../../src/platform/credentials.js";
import { State } from "../../src/platform/state.js";

const launch = vi.hoisted(() => vi.fn());

vi.mock("../../src/platform/private-permissions.js", () => ({
  windowsPrivacy: vi.fn(async () => {}),
}));

vi.mock("node:child_process", () => ({ execFile: launch, fork: vi.fn() }));

const tokens = {
  accessToken: "a",
  refreshToken: "r",
  accessExpiresAt: 123,
  refreshExpiresAt: 456,
};

it("protects async file credentials and validates token records without destructive fallback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-creds-"));
  const s = new State(dir);
  const c = new Credentials(s);

  try {
    expect(await c.get("p", "file")).toBeNull();
    await c.save("p", "file", tokens);
    expect(await c.get("p", "file")).toEqual(tokens);
    await c.save("p", "file", null);
    expect(await c.get("p", "file")).toBeNull();
    await s.write("p.credentials.json", {});
    await expect(c.get("p", "file")).rejects.toMatchObject({ status: 4 });
    await expect(c.record("../bad", "file")).rejects.toThrow("key");

    const controller = new AbortController();

    controller.abort();
    await expect(c.put("p", "file", tokens, controller.signal)).rejects.toThrow();
    expect(accountKey("https://a.test/", "a")).toBe(accountKey("https://a.test", "a"));
    expect(accountKey("https://a.test", "a")).not.toBe(accountKey("https://a.test", "b"));
  } finally {
    await rm(dir, { recursive: true });
  }
});

it("bounds asynchronous Keychain calls and supplies secrets through stdin, never argv", async () => {
  let result: { error: any; stdout: string; stderr: string } = {
    error: null,
    stdout: JSON.stringify(tokens),
    stderr: "",
  };

  const end = vi.fn();

  launch.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options: unknown,
      callback: (e: any, out: string, err: string) => void,
    ) => {
      queueMicrotask(() => callback(result.error, result.stdout, result.stderr));

      return { stdin: { end } };
    },
  );

  const c = new Credentials(new State("/tmp/test-keychain"), "darwin");

  expect(await c.get("p", "keychain")).toEqual(tokens);
  await c.save("p", "keychain", tokens);
  expect(launch.mock.calls.at(-1)?.[1]).toEqual(["-i"]);

  expect(launch.mock.calls.at(-1)?.[2]).toMatchObject({
    timeout: 15000,
    maxBuffer: 131072,
  });

  expect(JSON.stringify(launch.mock.calls.at(-1)?.slice(0, 3))).not.toContain("accessToken");
  expect(end.mock.calls.at(-1)?.[0]).toContain("accessToken");
  await c.save("p", "keychain", null);
  result = { error: { code: 44 }, stdout: "", stderr: "" };
  expect(await c.record("p", "keychain")).toBeNull();
  await c.save("p", "keychain", null);
  await expect(c.save("p", "keychain", tokens)).rejects.toThrow("Keychain");
  result = { error: { code: 1 }, stdout: "", stderr: "" };
  await expect(c.get("p", "keychain")).rejects.toThrow();
  result = { error: null, stdout: "", stderr: "error saving" };
  await expect(c.save("p", "keychain", tokens)).rejects.toThrow("save");

  await expect(new Credentials(new State("/tmp"), "linux").get("p", "keychain")).rejects.toThrow(
    "unavailable",
  );
});

it.each([
  ["darwin", "keychain"],
  ["linux", "native"],
  ["win32", "native"],
] as const)("selects the %s credential vault", (platform, store) => {
  expect(new Credentials(new State("unused"), platform).defaultStore()).toBe(store);
});
