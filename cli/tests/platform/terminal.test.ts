import type * as Prompts from "@inquirer/prompts";
import { password, confirm } from "@inquirer/prompts";

vi.mock("@inquirer/prompts", async (original) => {
  const mod = await original<typeof Prompts>();

  return { ...mod, password: vi.fn(mod.password), confirm: vi.fn(mod.confirm) };
});

import { PassThrough, Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { terminal, writeTo, presentation } from "../../src/platform/terminal.js";

it("uses terminal capabilities without adding color or layouts to pipes", () => {
  const output = new PassThrough();

  expect(presentation(output, {})).toEqual({ width: 80, color: false });
  Object.assign(output, { isTTY: true, columns: 120 });
  expect(presentation(output, {})).toEqual({ width: 120, color: true });
  expect(presentation(output, { NO_COLOR: "" }).color).toBe(false);
  expect(presentation(output, { TERM: "dumb" }).color).toBe(false);

  for (const [columns, width] of [
    [10, 20],
    [1000, 240],
    [0, 80],
    [NaN, 80],
    [2.5, 80],
  ]) {
    Object.assign(output, { columns });
    expect(presentation(output, {}).width).toBe(width);
  }

  const io = terminal(new PassThrough(), output, new PassThrough(), false, undefined, {
    NO_COLOR: "1",
  });

  expect(io.presentation).toEqual({ width: 80, color: false });
});

function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();

  let out = "";
  let err = "";

  output.on("data", (b) => (out += b));
  error.on("data", (b) => (err += b));

  return { input, output, error, out: () => out, err: () => err };
}

it("separates output and never reads unsolicited stdin", async () => {
  const s = streams();
  const io = terminal(s.input, s.output, s.error, false);

  await io.write("data");
  await io.diagnostic("notice");
  expect(s.out()).toBe("data");
  expect(s.err()).toBe("notice");
  await expect(io.secret("password")).rejects.toThrow("unavailable");
  await expect(io.confirm("yes")).rejects.toThrow("unavailable");
  s.input.end("bytes");
  expect((await io.input(5)).toString()).toBe("bytes");

  const t = streams();

  t.input.end("too long");
  await expect(terminal(t.input, t.output, t.error, false).input(1)).rejects.toThrow("limit");
});

it("routes maintained prompt components exclusively to allowed terminal streams", async () => {
  const s = streams();

  Object.assign(s.input, { isTTY: true });
  Object.assign(s.output, { isTTY: true });
  Object.assign(s.error, { isTTY: true });

  const signal = new AbortController().signal;
  const io = terminal(s.input, s.output, s.error, true, signal);

  vi.mocked(password).mockResolvedValueOnce("ac");
  expect(await io.secret("Password")).toBe("ac");

  expect(password).toHaveBeenLastCalledWith(
    { message: "Password" },
    { input: s.input, output: s.error, signal },
  );

  vi.mocked(confirm).mockResolvedValueOnce(true);
  expect(await io.confirm("Proceed")).toBe(true);

  expect(confirm).toHaveBeenLastCalledWith(
    { message: "Proceed", default: false },
    { input: s.input, output: s.error, signal },
  );

  vi.mocked(password).mockRejectedValueOnce(
    Object.assign(new Error("closed"), { name: "ExitPromptError" }),
  );

  await expect(io.secret("Password")).rejects.toMatchObject({ status: 130 });
  vi.mocked(password).mockRejectedValueOnce(new Error("device failure"));
  await expect(io.secret("Password")).rejects.toThrow("device failure");
  expect(s.out()).toBe("");
});

it("propagates broken output pipe", async () => {
  const stream = new Writable({
    write(_b, _e, cb) {
      cb(Object.assign(new Error("closed"), { code: "EPIPE" }));
    },
  });

  stream.on("error", () => {});
  await expect(writeTo(stream, "x")).rejects.toMatchObject({ code: "EPIPE" });
});

it("cancels explicit stdin and restores hidden prompts on process abort", async () => {
  const s = streams();
  const controller = new AbortController();
  const io = terminal(s.input, s.output, s.error, false, controller.signal);

  const reading = io.input(10);

  controller.abort();
  await expect(reading).rejects.toThrow("cancelled");
  await expect(io.input(10)).rejects.toThrow("cancelled");

  const p = streams();

  Object.assign(p.input, { isTTY: true, setRawMode: vi.fn() });
  Object.assign(p.output, { isTTY: true });
  Object.assign(p.error, { isTTY: true });

  const signal = new AbortController();
  const prompt = terminal(p.input, p.output, p.error, true, signal.signal);

  const readingSecret = prompt.secret("Password");

  setImmediate(() => signal.abort());
  await expect(readingSecret).rejects.toThrow("cancelled");

  await expect(prompt.secret("Password")).rejects.toThrow("cancelled");
});

it("cancels a backpressured output write instead of waiting indefinitely", async () => {
  const controller = new AbortController();
  const stream = new Writable({ write() {} });

  const pending = writeTo(stream, "data", controller.signal);

  controller.abort();
  await expect(pending).rejects.toThrow("cancelled");
  expect(stream.destroyed).toBe(true);
  await expect(writeTo(stream, "next", controller.signal)).rejects.toThrow("cancelled");
});

it("closes the prompt abort race while initial diagnostic output is pending", async () => {
  const s = streams();
  const controller = new AbortController();

  Object.assign(s.input, { isTTY: true, setRawMode: vi.fn() });
  Object.assign(s.output, { isTTY: true });
  Object.assign(s.error, { isTTY: true });
  s.error.once("data", () => controller.abort());

  await expect(
    terminal(s.input, s.output, s.error, true, controller.signal).secret("Password"),
  ).rejects.toThrow("cancelled");
});
