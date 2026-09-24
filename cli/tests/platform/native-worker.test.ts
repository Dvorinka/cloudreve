import type * as ChildProcess from "node:child_process";
import { fork, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { it, expect, vi } from "vitest";
import { Credentials } from "../../src/platform/credentials.js";
import { State } from "../../src/platform/state.js";

const setup = vi.hoisted(() => ({ instances: [] as any[], reply: "success" }));

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof ChildProcess>();

  return {
    ...actual,
    spawn: vi.fn(),
    fork: () => {
      const worker = new (class extends EventEmitter {
        options: any;

        send(input: unknown, callback: (error: Error | null) => void) {
          this.options = { workerData: input };

          queueMicrotask(() => {
            callback(setup.reply === "channel" ? Error("closed channel") : null);

            if (setup.reply === "success") {
              this.emit("message", { ok: true, value: '{"value":"private"}' });
              this.emit("error", Error("late event"));
            } else if (setup.reply === "empty") {
              this.emit("message", { ok: true });
            } else if (setup.reply === "failure") {
              this.emit("message", { ok: false });
            } else if (setup.reply === "error") {
              this.emit("error", Error("binding"));
            } else if (setup.reply === "exit") {
              this.emit("exit", 1);
            }
          });
        }

        kill() {
          this.emit("exit", 0);

          return true;
        }
      })();

      setup.instances.push(worker);

      return worker;
    },
  };
});

it("bounds worker operations and preserves native errors without plaintext fallback", async () => {
  const c = new Credentials(new State("/tmp/native-worker"));

  setup.reply = "success";
  expect(await c.record("a", "native")).toEqual({ value: "private" });
  await c.put("a", "native", { value: "private" });
  expect(setup.instances.at(-1).options.workerData.value).toBe('{"value":"private"}');

  for (const result of ["failure", "error", "exit", "channel"]) {
    setup.reply = result;
    await expect(c.record("a", "native")).rejects.toThrow("Native credential");
  }

  setup.reply = "empty";
  expect(await c.record("missing", "native")).toBeNull();

  setup.reply = "wait";

  const controller = new AbortController();
  const pending = c.record("a", "native", controller.signal);

  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  await expect(c.record("a", "native", controller.signal)).rejects.toThrow();
  vi.useFakeTimers();

  const timeout = c.record("a", "native");
  const assertion = expect(timeout).rejects.toThrow("timed out");

  await vi.advanceTimersByTimeAsync(15001);
  await assertion;
  vi.useRealTimers();
});

it("self-dispatches compiled vault calls without requiring a JavaScript runtime or worker file", async () => {
  vi.stubGlobal("__CLOUDREVE_STANDALONE__", true);
  vi.mocked(spawn).mockImplementation(() => fork("unused"));
  setup.reply = "success";

  try {
    const credentials = new Credentials(new State("/tmp/compiled-vault"));

    expect(await credentials.record("a", "native")).toEqual({ value: "private" });

    expect(spawn).toHaveBeenCalledWith(process.execPath, ["--cloudreve-native-vault"], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
  } finally {
    vi.unstubAllGlobals();
  }
});
