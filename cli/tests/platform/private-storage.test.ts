import { mkdtemp, mkdir, readFile, rename, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { windowsPrivacy } from "../../src/platform/private-permissions.js";
import { State } from "../../src/platform/state.js";
import { destination, removePartial } from "../../src/platform/files.js";

vi.mock("../../src/platform/private-permissions.js", () => ({
  windowsPrivacy: vi.fn(async () => {}),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(windowsPrivacy).mockClear();
});

it("protects new Windows state directories and verifies existing files once per owner instance", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");

  const root = await mkdtemp(join(tmpdir(), "cr-private-state-"));
  const directory = join(root, "new");
  const state = new State(directory);

  try {
    await state.write("new.json", { value: 1 });
    expect(windowsPrivacy).toHaveBeenCalledWith(directory, true, true);
    await state.read("new.json", null);
    await state.write("new.json", { value: 2 });
    expect(windowsPrivacy).toHaveBeenCalledTimes(1);
    await writeFile(join(directory, "old.json"), "3");
    expect(await state.read("old.json", 0)).toBe(3);
    expect(await state.read("old.json", 0)).toBe(3);
    expect(windowsPrivacy).toHaveBeenCalledWith(join(directory, "old.json"));
    expect(windowsPrivacy).toHaveBeenCalledTimes(2);
    await rename(directory, directory + "-old");
    await mkdir(directory);
    await writeFile(join(directory, "new.json"), "4");
    expect(await state.read("new.json", 0)).toBe(4);
    expect(windowsPrivacy).toHaveBeenCalledWith(directory, false, true);
    expect(windowsPrivacy).toHaveBeenCalledTimes(4);
    await mkdir(join(root, "existing"));
    await new State(join(root, "existing")).write("value", null);
    expect(windowsPrivacy).toHaveBeenCalledWith(join(root, "existing"), false, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("protects empty partials before writes and removes them when ACL setup fails", async () => {
  vi.spyOn(process, "platform", "get").mockReturnValue("win32");

  const root = await mkdtemp(join(tmpdir(), "cr-private-partial-"));
  const path = join(root, "target");

  try {
    const sink = await destination(path, false);

    expect(windowsPrivacy).toHaveBeenCalledWith(sink.partial, true);
    await sink.append(new TextEncoder().encode("private"));
    await sink.close();
    expect(await readFile(sink.partial, "utf8")).toBe("private");

    const resumed = await destination(path, false, sink.partial);

    await resumed.close();
    expect(windowsPrivacy).toHaveBeenCalledWith(sink.partial);
    await removePartial(path, sink.partial);
    vi.mocked(windowsPrivacy).mockRejectedValueOnce(Error("ACL unavailable"));
    await expect(destination(path, false)).rejects.toThrow("ACL unavailable");

    const partial = vi.mocked(windowsPrivacy).mock.calls.at(-1)![0];

    await expect(stat(partial)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
