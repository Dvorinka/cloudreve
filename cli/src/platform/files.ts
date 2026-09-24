import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createHash, createCipheriv, randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream, openAsBlob } from "node:fs";
import { link, lstat, mkdtemp, open, rename, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { validateName } from "@cloudreve/sdk/files";
import { aesCtrPosition } from "@cloudreve/sdk/transfers";
import { basename, join, resolve } from "node:path";
import type { DownloadDestination, UploadSource } from "@cloudreve/sdk/transfers";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Transport } from "@cloudreve/sdk/protocol";
import { CliError } from "../output/errors.js";
import { windowsPrivacy } from "./private-permissions.js";

// DOM and Node declare different BYOB buffer types for the same Web stream.
function nodeStream(stream: ReadableStream<Uint8Array>) {
  return Readable.fromWeb(stream as unknown as NodeReadableStream);
}

export async function source(
  path: string,
  signal?: AbortSignal,
): Promise<UploadSource & { path: string; fingerprint: string }> {
  const absolute = resolve(path);
  const info = await stat(absolute);

  if (!info.isFile()) {
    throw new CliError(
      "input",
      "Upload requires a regular local file; recursive local transfer is unavailable",
    );
  }

  const blob = await openAsBlob(absolute);
  const hash = createHash("sha256");

  for await (const bytes of createReadStream(absolute, { signal })) {
    hash.update(bytes);
  }

  const fingerprint = hash.digest("hex");
  const after = await stat(absolute);

  if (
    info.dev !== after.dev ||
    info.ino !== after.ino ||
    info.size !== after.size ||
    info.mtimeMs !== after.mtimeMs ||
    info.ctimeMs !== after.ctimeMs
  ) {
    throw new CliError("input", "Local source changed while fingerprinting");
  }

  return {
    path: absolute,
    size: info.size,
    fingerprint,
    async chunk(start, end, encryption, progress, operationSignal) {
      const chunkSignal =
        signal && operationSignal
          ? AbortSignal.any([signal, operationSignal])
          : (operationSignal ?? signal);

      let body = blob.slice(start, end);
      let temporary: string | undefined;

      if (encryption) {
        temporary = await mkdtemp(join(tmpdir(), "cr-encrypted-"));

        try {
          const { counter, skip } = aesCtrPosition(Buffer.from(encryption.iv, "base64"), start);

          const cipher = createCipheriv(
            "aes-256-ctr",
            Buffer.from(encryption.key_plain_text, "base64"),
            counter,
          );

          cipher.update(new Uint8Array(skip));

          const output = join(temporary, "chunk");

          await pipeline(
            nodeStream(body.stream()),
            cipher,
            createWriteStream(output, { flags: "wx", mode: 0o600 }),
            { signal: chunkSignal },
          );

          body = await openAsBlob(output);
        } catch (error) {
          await rm(temporary, { recursive: true, force: true });

          throw error;
        }
      }

      progress(body.size);

      return {
        body,
        multipart(fields, filename, mimeType) {
          const form = new FormData();

          for (const [k, v] of Object.entries(fields)) {
            form.append(k, v);
          }

          form.append("file", body.slice(0, body.size, mimeType), filename);

          return form;
        },
        async dispose() {
          if (temporary) {
            await rm(temporary, { recursive: true, force: true });
          }
        },
      };
    },
  };
}

export async function destination(
  path: string,
  overwrite: boolean,
  partial?: string,
): Promise<DownloadDestination & { partial: string; finish(): Promise<void> }> {
  const absolute = resolve(path);
  const temporary = partial ?? `${absolute}.cloudreve-${randomUUID()}.part`;

  if (partial) {
    assertPartialName(absolute, partial);
    await privatePartial(partial);
  }

  if (!overwrite) {
    try {
      await stat(absolute);

      throw new CliError("collision", "Local destination exists; use --overwrite");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw e;
      }
    }
  }

  const handle = await open(
    temporary,
    partial ? constants.O_RDWR | constants.O_NOFOLLOW : "wx",
    0o600,
  );

  try {
    if (!partial) {
      await windowsPrivacy(temporary, true);
    }
  } catch (error) {
    await handle.close();
    await rm(temporary);

    throw error;
  }

  let size = (await handle.stat()).size;
  let closed = false;

  return {
    partial: temporary,
    size: () => size,
    async reset() {
      await handle.truncate(0);
      size = 0;
    },
    async append(bytes) {
      let offset = 0;

      while (offset < bytes.length) {
        // Explicit offsets let resumed files append and still truncate on Windows.
        const result = await handle.write(bytes, offset, bytes.length - offset, size + offset);

        if (!result.bytesWritten) {
          throw new CliError("io", "Local write made no progress", 1);
        }

        offset += result.bytesWritten;
      }

      size += bytes.length;
    },
    async close() {
      if (!closed) {
        await handle.sync();
        await handle.close();
        closed = true;
      }
    },
    async finish() {
      if (!closed) {
        await handle.sync();
        await handle.close();
        closed = true;
      }

      if (overwrite) {
        await rename(temporary, absolute);
      } else {
        await link(temporary, absolute);
        await unlink(temporary);
      }
    },
  };
}

export async function textInput(
  path: string,
  limit: number,
  stdin: () => Promise<Buffer>,
): Promise<string> {
  let b: Buffer;

  if (path === "-") {
    b = await stdin();
  } else {
    const handle = await open(path, "r");

    try {
      const info = await handle.stat();

      if (!info.isFile() || info.size > limit) {
        throw new CliError("input", "Text input must be a regular file within 5 MiB");
      }

      b = Buffer.alloc(limit + 1);

      let size = 0;

      while (size < b.length) {
        const part = await handle.read(b, size, b.length - size, null);

        if (!part.bytesRead) {
          break;
        }

        size += part.bytesRead;
      }

      b = b.subarray(0, size);
    } finally {
      await handle.close();
    }
  }

  if (b.length > limit || b.includes(0)) {
    throw new CliError("input", "Text must be UTF-8 without NUL and within 5 MiB");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    throw new CliError("input", "Text must be valid UTF-8");
  }
}

export function assertPartialName(target: string, partial: string): void {
  const prefix = resolve(target) + ".cloudreve-";

  if (
    !partial.startsWith(prefix) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.part$/.test(
      partial.slice(prefix.length),
    )
  ) {
    throw new CliError("state", "Partial file is not owned by this transfer");
  }
}

async function privatePartial(path: string): Promise<void> {
  const info = await lstat(path);

  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    (process.platform !== "win32" && (info.mode & 0o077) !== 0)
  ) {
    throw new CliError("state", "Partial must be a private regular file");
  }

  await windowsPrivacy(path);
}

export async function removePartial(target: string, path: string): Promise<void> {
  assertPartialName(target, path);

  try {
    await privatePartial(path);
    await unlink(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }
  }
}

export async function downloadPath(path: string, name: string): Promise<string> {
  const absolute = resolve(path);

  try {
    if ((await stat(absolute)).isDirectory()) {
      return join(absolute, validateName(name));
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      throw e;
    }

    if (/[\\/]$/.test(path)) {
      throw new CliError("path", "Trailing slash requires an existing local directory");
    }
  }

  return absolute;
}

export const uniqueId = randomUUID;

export const localBasename = basename;

export async function downloadUrl(
  url: string,
  path: string,
  overwrite: boolean,
  storage: Transport,
  signal: AbortSignal,
  followRedirects = false,
) {
  const sink = await destination(path, overwrite);
  let finished = false;

  try {
    let target = url;
    let response: Awaited<ReturnType<Transport>>;

    for (let redirects = 0; ; redirects++) {
      const address = new URL(target);

      if (!["http:", "https:"].includes(address.protocol) || address.username || address.password) {
        throw new CliError("download", "Unsafe download redirect target", 1);
      }

      response = await storage(address.toString(), {
        signal,
        redirect: "manual",
        credentials: "omit",
      });

      const location = response.headers.get("location");

      if (!followRedirects || ![301, 302, 303, 307, 308].includes(response.status) || !location) {
        break;
      }

      await response.body?.cancel();

      if (redirects >= 5) {
        throw new CliError("download", "Too many download redirects", 1);
      }

      target = new URL(location, address).toString();
    }

    if (!response.ok || !response.body) {
      throw new CliError("download", `Download response unavailable (${response.status})`, 1);
    }

    const hash = createHash("sha256");

    await pipeline(
      nodeStream(response.body),
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          sink.append(chunk).then(() => callback(), callback);
        },
      }),
      { signal },
    );

    await sink.finish();
    finished = true;

    return {
      local: resolve(path),
      bytes: sink.size(),
      sha256: hash.digest("hex"),
    };
  } finally {
    await sink.close();

    if (!finished) {
      await removePartial(path, sink.partial);
    }
  }
}
