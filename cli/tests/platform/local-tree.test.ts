import type * as FsPromises from "node:fs/promises";
import { mkdtemp, realpath, mkdir, writeFile, symlink, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { scanLocalTree, assertLocalEntry } from "../../src/platform/local-tree.js";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof FsPromises>();

  return { ...fs, readdir: vi.fn(fs.readdir), lstat: vi.fn(fs.lstat) };
});

const roots: string[] = [];

async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), "cr-tree-"));

  roots.push(root);

  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("enumerates nested trees deterministically without reading bytes and preserves empty directories", async () => {
  const root = await fixture();

  await mkdir(join(root, "z-empty"));
  await mkdir(join(root, "a-dir"));
  await writeFile(join(root, "z.txt"), "last");
  await writeFile(join(root, "a.txt"), "first");
  await writeFile(join(root, "a-dir", "世界.txt"), "nested");

  const tree = await scanLocalTree(root);

  expect(tree.root).toBe(root);

  expect(tree.entries.map((x) => [x.relative, x.kind, x.size])).toEqual([
    ["a-dir", "directory", undefined],
    ["a-dir/世界.txt", "file", 6],
    ["z-empty", "directory", undefined],
    ["a.txt", "file", 5],
    ["z.txt", "file", 4],
  ]);

  for (const entry of tree.entries) {
    await assertLocalEntry(tree, entry);
  }

  expect((await scanLocalTree(join(root, "z-empty"))).entries).toEqual([]);
});

it("rejects root, intermediate, file and directory symlinks", async () => {
  const root = await fixture();
  const target = await fixture();

  await mkdir(join(target, "child"));
  await symlink(target, join(root, "link"), "dir");
  await expect(scanLocalTree(join(root, "link"))).rejects.toThrow("symlinks");
  await expect(scanLocalTree(join(root, "link", "child"))).rejects.toThrow("symlinks");
  await expect(scanLocalTree(root)).rejects.toThrow("symlinks");
  await rm(join(root, "link"));
  await writeFile(join(target, "file"), "outside");
  await symlink(join(target, "file"), join(root, "file"));
  await expect(scanLocalTree(root)).rejects.toThrow("symlinks");
});

it("rejects non-directory roots, special objects and names invalid remotely", async () => {
  const root = await fixture();
  const path = join(root, "file");

  await writeFile(path, "x");
  await expect(scanLocalTree(path)).rejects.toThrow("root must be a directory");
  await expect(scanLocalTree(join(path, "child"))).rejects.toThrow("symlinks");
  await rm(path);

  if (process.platform !== "win32") {
    execFileSync("mkfifo", [path]);
    await expect(scanLocalTree(root)).rejects.toThrow("symlinks");
    await rm(path);
  }

  await writeFile(join(root, " space "), "x");
  await expect(scanLocalTree(root)).rejects.toThrow();
  await rm(join(root, " space "));

  if (process.platform !== "win32") {
    await writeFile(join(root, "bad\\name"), "x");
    await expect(scanLocalTree(root)).rejects.toThrow();
  }
});

it("honors cancellation before and during enumeration", async () => {
  const root = await fixture();
  const controller = new AbortController();

  controller.abort(new Error("stop"));
  await expect(scanLocalTree(root, { signal: controller.signal })).rejects.toThrow("stop");

  const { readdir } = await import("node:fs/promises");
  const original = await vi.importActual<typeof FsPromises>("node:fs/promises");
  const during = new AbortController();

  await writeFile(join(root, "file"), "x");

  vi.mocked(readdir).mockImplementationOnce(async (...args: Parameters<typeof readdir>) => {
    const result = await original.readdir(...args);

    during.abort(new Error("cancelled scan"));

    return result;
  });

  await expect(scanLocalTree(root, { signal: during.signal })).rejects.toThrow("cancelled scan");
});

it("revalidates identities and containment before subsequent consumption", async () => {
  const root = await fixture();
  const path = join(root, "file");

  await writeFile(path, "before");

  const tree = await scanLocalTree(root);
  const entry = tree.entries[0]!;

  await expect(
    assertLocalEntry(tree, { ...entry, path: join(root, "..", "outside") }),
  ).rejects.toThrow();

  await expect(assertLocalEntry(tree, { ...entry, relative: "wrong" })).rejects.toThrow();
  await writeFile(path, "after changed bytes");
  await expect(assertLocalEntry(tree, entry)).rejects.toThrow("unchanged");
  await rm(path);
  await mkdir(path);
  await expect(assertLocalEntry(tree, entry)).rejects.toThrow("unchanged");
});

it("rejects root replacement during enumeration", async () => {
  const root = await fixture();
  const { readdir } = await import("node:fs/promises");

  vi.mocked(readdir).mockImplementationOnce(async () => {
    await rename(root, root + "-old");
    roots.push(root + "-old");
    await mkdir(root);

    return [];
  });

  await expect(scanLocalTree(root)).rejects.toThrow("unchanged");
});

it("rejects root additions even before directory metadata changes", async () => {
  const root = await fixture();
  const { readdir, lstat } = await import("node:fs/promises");
  const original = await vi.importActual<typeof FsPromises>("node:fs/promises");
  const snapshot = await original.lstat(root);

  vi.mocked(lstat).mockImplementation(async (...args: Parameters<typeof lstat>) =>
    String(args[0]) === root ? snapshot : original.lstat(...args),
  );

  vi.mocked(readdir).mockImplementationOnce(async () => {
    await writeFile(join(root, "late"), "not enumerated");

    return [];
  });

  await expect(scanLocalTree(root)).rejects.toThrow("unchanged");

  vi.mocked(lstat).mockImplementation(original.lstat);

  const tree = await scanLocalTree(root);

  await rename(root, root + "-old");
  roots.push(root + "-old");
  await mkdir(root);
  await expect(assertLocalEntry(tree, tree.entries[0]!)).rejects.toThrow("unchanged");
});

it("rejects same-size directory renames after entries have been inspected", async () => {
  const root = await fixture();
  const { readdir } = await import("node:fs/promises");
  const original = await vi.importActual<typeof FsPromises>("node:fs/promises");

  await writeFile(join(root, "before"), "data");

  vi.mocked(readdir).mockImplementationOnce((...args) => original.readdir(...args));

  vi.mocked(readdir).mockImplementationOnce(async (...args) => {
    await rename(join(root, "before"), join(root, "after"));

    return original.readdir(...args);
  });

  await expect(scanLocalTree(root)).rejects.toThrow("unchanged");
});
