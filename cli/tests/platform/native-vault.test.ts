import { it, expect, vi } from "vitest";
import { nativeOperation, serve, serveNativeVault } from "../../src/platform/native-vault.js";

const state = vi.hoisted(() => new Map<string, string>());

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    constructor(
      private service: string,
      private key: string,
    ) {}

    getPassword() {
      if (this.key === "denied") {
        throw Error("vault locked");
      }

      const v = state.get(this.service + this.key);

      if (v === undefined) {
        throw Error("No entry");
      }

      return v;
    }

    setPassword(v: string) {
      if (v === "denied") {
        throw Error("vault locked");
      }

      state.set(this.service + this.key, v);
    }

    deletePassword() {
      if (this.key === "denied") {
        throw Error("vault locked");
      }

      if (!state.delete(this.service + this.key)) {
        throw Error("No entry");
      }
    }
  },
}));

it("adapts native read/write/delete and distinguishes missing entries from vault failures", async () => {
  const input = { service: "test", key: "entry" };

  expect(await nativeOperation(input)).toBeNull();
  await nativeOperation({ ...input, value: "private" });
  expect(await nativeOperation(input)).toBe("private");
  await nativeOperation({ ...input, value: null });
  await nativeOperation({ ...input, value: null });
  await expect(nativeOperation({ ...input, key: "denied" })).rejects.toThrow("locked");
  await expect(nativeOperation({ ...input, key: "denied", value: null })).rejects.toThrow("locked");
  await expect(nativeOperation({ ...input, value: "denied" })).rejects.toThrow("locked");

  await expect(
    nativeOperation(input, async () => {
      throw Error("binding unavailable");
    }),
  ).rejects.toThrow("unavailable");
});

it("worker replies never expose a native exception or secret", async () => {
  const port = { postMessage: vi.fn() };

  await serve(port, { service: "test", key: "a", value: "private" });
  expect(port.postMessage).toHaveBeenLastCalledWith({ ok: true, value: null });
  await serve(port, { service: "test", key: "a", value: "denied" });
  expect(port.postMessage).toHaveBeenLastCalledWith({ ok: false, bindingLoaded: true });

  await serve(port, { service: "test", key: "a" }, async () => {
    throw Error("binding unavailable");
  });

  expect(port.postMessage).toHaveBeenLastCalledWith({ ok: false, bindingLoaded: false });
});

it("registers private vault IPC only for the hidden worker invocation", async () => {
  const host = {
    argv: ["runtime", "binary", "--cloudreve-native-vault"],
    once: vi.fn(),
    send: vi.fn(),
  };

  expect(serveNativeVault({ ...host, send: undefined } as unknown as NodeJS.Process)).toBe(false);

  expect(
    serveNativeVault({
      ...host,
      argv: ["runtime", "binary", "--help"],
    } as unknown as NodeJS.Process),
  ).toBe(false);

  expect(serveNativeVault(host as unknown as NodeJS.Process)).toBe(true);
  expect(host.once).toHaveBeenCalledWith("message", expect.any(Function));

  const listener = host.once.mock.calls[0]![1] as (input: unknown) => void;

  listener({ service: "test", key: "missing" });
  await vi.waitFor(() => expect(host.send).toHaveBeenCalledWith({ ok: true, value: null }));
});
