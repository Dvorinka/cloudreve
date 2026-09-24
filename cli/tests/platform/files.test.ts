import type * as FsPromises from "node:fs/promises";
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>();

  return { ...original, stat: vi.fn(original.stat) };
});

import {
  destination,
  downloadUrl,
  downloadPath,
  removePartial,
  source,
  textInput,
} from "../../src/platform/files.js";

it("streams seekable chunks and multipart without buffering whole files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-bytes-"));
  const p = join(dir, "file");

  await writeFile(p, Buffer.from([0, 1, 255, 2]));

  const s = await source(p);

  expect(s.size).toBe(4);
  expect(s.fingerprint).toHaveLength(64);

  let loaded = 0;
  const chunk = await s.chunk(1, 3, undefined, (n) => (loaded = n));

  expect(loaded).toBe(2);
  expect([...new Uint8Array(await (chunk.body as Blob).arrayBuffer())]).toEqual([1, 255]);

  const form = chunk.multipart?.({ key: "value" }, "test", "image/png") as FormData;

  expect(form.get("key")).toBe("value");
  expect((form.get("file") as File).name).toBe("test");
  await chunk.dispose();
  await expect(s.chunk(0, 1, {} as never, () => {})).rejects.toThrow();
  await expect(source(dir)).rejects.toThrow("regular");
  await rm(dir, { recursive: true });
});

it("writes atomically, refuses collision, preserves partial and resumes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-dest-"));
  const p = join(dir, "out");

  const d = await destination(p, false);

  expect(d.size()).toBe(0);
  await d.append(new Uint8Array([1, 2]));
  expect(d.size()).toBe(2);
  await d.close();
  await d.close();
  await expect(readFile(p)).rejects.toThrow();

  const resumed = await destination(p, false, d.partial);

  expect(resumed.size()).toBe(2);
  await resumed.append(new Uint8Array([3, 4]));
  expect([...(await readFile(d.partial))]).toEqual([1, 2, 3, 4]);
  await resumed.reset();
  expect(resumed.size()).toBe(0);
  await resumed.append(new Uint8Array([9]));
  await resumed.finish();
  expect([...(await readFile(p))]).toEqual([9]);
  await expect(destination(p, false)).rejects.toThrow("exists");

  const overwrite = await destination(p, true);

  await overwrite.append(new Uint8Array([3]));
  await overwrite.close();
  await overwrite.finish();
  expect([...(await readFile(p))]).toEqual([3]);
  await removePartial(p, p + ".cloudreve-00000000-0000-0000-0000-000000000000.part");
  await expect(removePartial(p, dir)).rejects.toThrow();
  await rm(dir, { recursive: true });
});

it("accepts explicit UTF-8 input and rejects invalid binary/oversized data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-text-"));
  const p = join(dir, "text");

  await writeFile(p, "hello");
  expect(await textInput(p, 10, async () => Buffer.alloc(0))).toBe("hello");
  expect(await textInput("-", 10, async () => Buffer.from("stdin"))).toBe("stdin");

  for (const bytes of [Buffer.from([0]), Buffer.from([255]), Buffer.alloc(20, 1)]) {
    await expect(textInput("-", 10, async () => bytes)).rejects.toThrow();
  }

  await rm(dir, { recursive: true });
});

it("refuses unowned and symlink partial files before writes or deletion", async () => {
  const { symlink, chmod } = await import("node:fs/promises");
  const { assertPartialName, downloadPath } = await import("../../src/platform/files.js");

  const dir = await mkdtemp(join(tmpdir(), "cr-partial-"));
  const target = join(dir, "target");
  const other = join(dir, "other");
  const owned = target + ".cloudreve-00000000-0000-0000-0000-000000000000.part";

  await writeFile(other, "do not touch", { mode: 0o600 });
  expect(() => assertPartialName(target, other)).toThrow("owned");
  await expect(destination(target, false, other)).rejects.toThrow("owned");
  await expect(removePartial(target, other)).rejects.toThrow("owned");
  await symlink(other, owned);
  await expect(destination(target, false, owned)).rejects.toThrow("private");
  await expect(removePartial(target, owned)).rejects.toThrow("private");
  expect((await readFile(other)).toString()).toBe("do not touch");
  await rm(owned);
  await writeFile(owned, "partial", { mode: 0o644 });

  if (process.platform !== "win32") {
    await expect(destination(target, false, owned)).rejects.toThrow("private");
    await chmod(owned, 0o600);
  }

  await removePartial(target, owned);
  expect(await downloadPath(dir, "name")).toBe(join(dir, "name"));
  expect(await downloadPath(target, "name")).toBe(target);
  await expect(downloadPath(join(dir, "missing") + "/", "name")).rejects.toThrow("Trailing");
  expect(await downloadPath(other, "name")).toBe(other);
  await rm(dir, { recursive: true });
});

it("bounds local content input before reading a large file and rejects directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-bound-"));
  const p = join(dir, "big");

  await writeFile(p, Buffer.alloc(1024));
  await expect(textInput(p, 10, async () => Buffer.alloc(0))).rejects.toThrow("within");
  await expect(textInput(dir, 10, async () => Buffer.alloc(0))).rejects.toThrow("regular");
  await rm(dir, { recursive: true });
});

it("refuses a same-size source replacement between fingerprinting and upload", async () => {
  const fs = await import("node:fs/promises");

  const dir = await mkdtemp(join(tmpdir(), "cr-snapshot-"));
  const p = join(dir, "source");

  await writeFile(p, "original");

  const real = (await vi.importActual<typeof FsPromises>("node:fs/promises")).stat;
  let calls = 0;

  const spy = vi.mocked(fs.stat).mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
    calls++;

    if (calls === 2) {
      await writeFile(p, "modified");
    }

    return real(...args);
  });

  try {
    await expect(source(p)).rejects.toThrow("changed while fingerprinting");
  } finally {
    spy.mockRestore();
    await rm(dir, { recursive: true });
  }
});

it("streams signed downloads atomically and cleans partials on errors or races", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-url-"));
  const path = join(dir, "archive.zip");

  try {
    const saved = await downloadUrl(
      "https://storage.test/signed",
      path,
      false,
      async () => new Response("abc"),
      new AbortController().signal,
    );

    expect(saved).toMatchObject({
      bytes: 3,
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });

    expect(await readFile(path, "utf8")).toBe("abc");

    await expect(
      downloadUrl(
        "https://storage.test/signed",
        path,
        false,
        async () => new Response("new"),
        new AbortController().signal,
      ),
    ).rejects.toThrow("exists");

    await downloadUrl(
      "https://storage.test/signed",
      path,
      true,
      async () => new Response("new"),
      new AbortController().signal,
    );

    expect(await readFile(path, "utf8")).toBe("new");

    for (const response of [
      new Response("error", { status: 503 }),
      new Response(null),
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("broken"));
          },
        }),
      ),
    ]) {
      await expect(
        downloadUrl(
          "https://storage.test/signed",
          join(dir, "failed"),
          false,
          async () => response,
          new AbortController().signal,
        ),
      ).rejects.toThrow();

      expect(await readdir(dir)).toEqual(["archive.zip"]);
    }

    const race = join(dir, "raced");

    await expect(
      downloadUrl(
        "https://storage.test/signed",
        race,
        false,
        async () => {
          await writeFile(race, "preserved");

          return new Response("bytes");
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow();

    expect(await readFile(race, "utf8")).toBe("preserved");

    const linked = join(dir, "symlink");

    await symlink(path, linked);

    await expect(
      downloadUrl(
        "https://storage.test/signed",
        linked,
        false,
        async () => new Response("bad"),
        new AbortController().signal,
      ),
    ).rejects.toThrow();

    expect(await readFile(path, "utf8")).toBe("new");

    const aborted = new AbortController();

    aborted.abort();

    await expect(
      downloadUrl(
        "https://storage.test/signed",
        join(dir, "aborted"),
        false,
        async () => new Response("bytes"),
        aborted.signal,
      ),
    ).rejects.toThrow();

    expect((await readdir(dir)).some((name) => name.includes(".part"))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("encrypts disk-backed chunk ranges with portable AES counter/skip semantics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-cipher-source-"));
  const path = join(dir, "input");

  try {
    const plain = Uint8Array.from({ length: 97 }, (_, i) => i);

    await writeFile(path, plain);

    const key = new Uint8Array(32).fill(7);
    const iv = new Uint8Array(16).fill(255);

    const reference = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-CTR", counter: iv, length: 128 },
        await crypto.subtle.importKey("raw", key, "AES-CTR", false, ["encrypt"]),
        plain,
      ),
    );

    const input = await source(path);

    for (const start of [0, 3, 17]) {
      const chunk = await input.chunk(
        start,
        70,
        {
          algorithm: "aes-256-ctr",
          key_plain_text: Buffer.from(key).toString("base64"),
          iv: Buffer.from(iv).toString("base64"),
        },
        () => {},
      );

      expect(new Uint8Array(await (chunk.body as Blob).arrayBuffer())).toEqual(
        reference.slice(start, 70),
      );

      expect((chunk.multipart!({}, "cipher.bin") as FormData).get("file")).toBeInstanceOf(File);
      await chunk.dispose();
      await expect((chunk.body as Blob).arrayBuffer()).rejects.toThrow();
    }

    const operation = new AbortController();
    const scoped = await source(path, new AbortController().signal);

    operation.abort();

    await expect(
      scoped.chunk(
        0,
        10,
        {
          algorithm: "aes-256-ctr",
          key_plain_text: Buffer.from(key).toString("base64"),
          iv: Buffer.from(iv).toString("base64"),
        },
        () => {},
        operation.signal,
      ),
    ).rejects.toThrow();

    const controller = new AbortController();
    const cancelled = await source(path, controller.signal);

    controller.abort();

    await expect(
      cancelled.chunk(
        0,
        10,
        {
          algorithm: "aes-256-ctr",
          key_plain_text: Buffer.from(key).toString("base64"),
          iv: Buffer.from(iv).toString("base64"),
        },
        () => {},
      ),
    ).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("rejects remote filename traversal before selecting a local directory target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-contained-"));

  try {
    for (const name of ["../escape", "/absolute", "a\\b", ".."]) {
      await expect(downloadPath(dir, name)).rejects.toThrow();
    }

    expect(await downloadPath(dir, "safe.txt")).toBe(join(dir, "safe.txt"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("follows bounded public redirects without forwarding account credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-redirect-"));
  const path = join(dir, "file");

  try {
    const requests: string[] = [];

    await downloadUrl(
      "https://example.test/f/id/file",
      path,
      false,
      async (url, init) => {
        requests.push(url);
        expect(init?.credentials).toBe("omit");
        expect(init?.headers).toBeUndefined();

        return requests.length === 1
          ? new Response("redirect", {
              status: 302,
              headers: { location: "https://storage.test/file?sign=private" },
            })
          : new Response("bytes");
      },
      new AbortController().signal,
      true,
    );

    expect(requests).toEqual([
      "https://example.test/f/id/file",
      "https://storage.test/file?sign=private",
    ]);

    expect(await readFile(path, "utf8")).toBe("bytes");

    for (const location of ["file:///tmp/private", "https://user:secret@storage.test/file"]) {
      await expect(
        downloadUrl(
          "https://example.test/f/id/file",
          join(dir, "bad"),
          false,
          async () => new Response(null, { status: 302, headers: { location } }),
          new AbortController().signal,
          true,
        ),
      ).rejects.toThrow("Unsafe");
    }

    await expect(
      downloadUrl(
        "https://example.test/f/id/file",
        join(dir, "loop"),
        false,
        async () => new Response(null, { status: 302, headers: { location: "/loop" } }),
        new AbortController().signal,
        true,
      ),
    ).rejects.toThrow("Too many");

    await expect(
      downloadUrl(
        "https://example.test/f/id/file",
        join(dir, "missing"),
        false,
        async () => new Response(null, { status: 302 }),
        new AbortController().signal,
        true,
      ),
    ).rejects.toThrow("unavailable");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
