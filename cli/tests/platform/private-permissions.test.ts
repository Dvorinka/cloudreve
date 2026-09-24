import { execFile } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { windowsPrivacy } from "../../src/platform/private-permissions.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

it("uses literal JSON input and fails closed when Windows ACL verification fails", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");

  const end = vi.fn();
  let failed = false;

  vi.mocked(execFile).mockImplementation((_file: any, _args: any, _options: any, callback: any) => {
    queueMicrotask(() => callback(failed ? Error("unsafe permissions") : null));

    return { stdin: { end } } as any;
  });

  const path = 'C:\\private\\quote"; Write-Host injected';

  await windowsPrivacy(path, true, true);

  const [executable, args, options] = vi.mocked(execFile).mock.calls[0]!;

  expect(String(executable)).toMatch(/System32.*WindowsPowerShell.*powershell\.exe$/);
  expect(JSON.stringify(args)).not.toContain("injected");
  expect(options).toMatchObject({ timeout: 15000, windowsHide: true });
  expect(JSON.parse(end.mock.calls[0]![0])).toEqual({ path, protect: true, directory: true });
  failed = true;
  await expect(windowsPrivacy(path)).rejects.toThrow("private data");
});

it("does not invoke Windows tooling on POSIX systems", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("linux");
  vi.mocked(execFile).mockClear();
  await windowsPrivacy("/tmp/unused");
  expect(execFile).not.toHaveBeenCalled();
});
