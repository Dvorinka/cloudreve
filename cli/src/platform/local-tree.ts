import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { validateName } from "@cloudreve/sdk/files";
import { CliError } from "../output/errors.js";

type Identity = {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
};

export type LocalTreeEntry = {
  relative: string;
  path: string;
  kind: "directory" | "file";
  size?: number;
  identity: Identity;
};

export type LocalTree = {
  root: string;
  rootIdentity: Identity;
  entries: LocalTreeEntry[];
};

const identity = ({ dev, ino, size, mtimeMs, ctimeMs }: Identity): Identity => ({
  dev,
  ino,
  size,
  mtimeMs,
  ctimeMs,
});

const unsafe = () =>
  new CliError(
    "input",
    "Local tree requires unchanged regular files and directories without symlinks",
  );

async function inspect(path: string, signal?: AbortSignal) {
  const absolute = resolve(path);
  const root = parse(absolute).root;

  let current = root;

  signal?.throwIfAborted();

  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);

    const info = await lstat(current);

    if (info.isSymbolicLink() || (!info.isDirectory() && current !== absolute)) {
      throw unsafe();
    }

    signal?.throwIfAborted();
  }

  const info = await lstat(absolute);

  if (!info.isFile() && !info.isDirectory()) {
    throw unsafe();
  }

  return info;
}

function contained(root: string, path: string) {
  const value = relative(root, path);

  if (isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`)) {
    throw unsafe();
  }

  return value;
}

export async function assertLocalEntry(
  tree: LocalTree,
  entry: LocalTreeEntry,
  signal?: AbortSignal,
): Promise<void> {
  if (contained(tree.root, entry.path).split(sep).join("/") !== entry.relative) {
    throw unsafe();
  }

  const root = await inspect(tree.root, signal);

  if (
    Object.entries(tree.rootIdentity).some(
      ([key, value]) => identity(root)[key as keyof Identity] !== value,
    )
  ) {
    throw unsafe();
  }

  const info = await inspect(entry.path, signal);

  contained(tree.root, await realpath(entry.path));

  if (
    (info.isDirectory() ? "directory" : "file") !== entry.kind ||
    Object.entries(entry.identity).some(
      ([key, value]) => identity(info)[key as keyof Identity] !== value,
    )
  ) {
    throw unsafe();
  }
}

export async function scanLocalTree(
  root: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<LocalTree> {
  const absolute = resolve(root);
  const info = await inspect(absolute, signal);

  if (!info.isDirectory()) {
    throw new CliError("input", "Local tree root must be a directory");
  }

  const tree: LocalTree = {
    root: await realpath(absolute),
    rootIdentity: identity(info),
    entries: [],
  };

  async function walk(directory: string): Promise<void> {
    signal?.throwIfAborted();

    const children = await readdir(directory, { withFileTypes: true });

    children.sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );

    for (const child of children) {
      if (validateName(child.name) !== child.name) {
        throw unsafe();
      }

      const path = join(directory, child.name);
      const details = await inspect(path, signal);

      contained(tree.root, await realpath(path));

      const entry: LocalTreeEntry = {
        path,
        relative: contained(tree.root, path).split(sep).join("/"),
        kind: details.isDirectory() ? "directory" : "file",
        ...(details.isFile() ? { size: details.size } : {}),
        identity: identity(details),
      };

      tree.entries.push(entry);

      if (entry.kind === "directory") {
        await walk(path);
      }

      await assertLocalEntry(tree, entry, signal);
    }

    // Directory timestamps can lag behind membership changes on Windows.
    const names = new Set(children.map((child) => child.name));
    const current = await readdir(directory);

    if (current.length !== names.size || current.some((name) => !names.has(name))) {
      throw unsafe();
    }
  }

  await walk(tree.root);

  const after = await inspect(absolute, signal);

  if (
    Object.entries(tree.rootIdentity).some(
      ([key, value]) => identity(after)[key as keyof Identity] !== value,
    )
  ) {
    throw unsafe();
  }

  return tree;
}
