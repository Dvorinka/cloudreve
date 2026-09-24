import { EntityType } from "@cloudreve/sdk/files";
import type { Context } from "../composition.js";
import { arg, numberFlag, stringArrayFlag } from "../input.js";
import { remote, resolveOperand } from "../paths.js";
import { watchLine } from "../output/streaming.js";
import { webLocations } from "../output/links.js";
import { safe } from "../output/format.js";
import { CliError } from "../output/errors.js";

const uri = (c: Context, index = 0) =>
  remote(arg(c.inv, index), String(c.inv.flags.cwd ?? "/my/")).toString();

export async function versionPromote(c: Context) {
  return (await c.backend()).files.promoteVersion(uri(c), arg(c.inv, 1), c.signal);
}

export async function versionDelete(c: Context) {
  await c.confirm(`Delete version ${arg(c.inv, 1)}`);

  return (await c.backend()).files.deleteVersion(uri(c), arg(c.inv, 1), c.signal);
}

export async function search(c: Context) {
  const offset = numberFlag(c.inv, "offset") ?? 0;
  const result = await (await c.backend()).files.fullTextSearch(arg(c.inv, 0), offset, c.signal);

  return {
    ...result,
    offset,
    nextOffset:
      result.hits.length && offset + result.hits.length < result.total
        ? offset + result.hits.length
        : null,
  };
}

export async function createDownload(c: Context) {
  let sources: string[] | undefined;

  if (c.inv.flags["sources-stdin"]) {
    const text = (await c.io.input(262144)).toString();

    sources = stringArrayFlag(
      { command: c.inv.command, args: [], flags: { sources: text } },
      "sources",
    );
  }

  const torrent = c.inv.flags.torrent;

  if (!!sources === !!torrent) {
    throw new CliError("usage", "Choose URL sources on stdin or one remote torrent path");
  }

  return (await c.backend()).jobs.createDownload(
    {
      src: sources,
      src_file: torrent
        ? remote(String(torrent), String(c.inv.flags.cwd ?? "/my/")).toString()
        : undefined,
      dst: uri(c),
    },
    c.signal,
  );
}

export async function watch(c: Context) {
  const count = numberFlag(c.inv, "count");

  if (count === 0) {
    throw new CliError("usage", "--count must be positive");
  }

  const clientId = String(c.inv.flags["client-id"] ?? c.bytes.uniqueId());
  let observed = 0;

  for await (const event of (await c.backend()).files.events(uri(c), clientId, {
    signal: c.signal,
    timeoutMs: numberFlag(c.inv, "timeout"),
  })) {
    const data = safe({ clientId, ...event });

    await c.io.write(
      c.inv.flags.json
        ? JSON.stringify({ schemaVersion: 1, data }) + "\n"
        : watchLine(webLocations(data, c.config.profiles[c.name] ?? {})),
    );

    if (count !== undefined && ++observed >= count) {
      break;
    }
  }
}

export async function archiveDownload(c: Context) {
  if (c.inv.args.length < 2) {
    throw new CliError("usage", "Supply archive sources followed by local:DESTINATION");
  }

  const target = resolveOperand(c.inv.args.at(-1)!);

  if (target.kind !== "local") {
    throw new CliError("usage", "Archive download requires local:DESTINATION");
  }

  const sources = archiveSources(c, c.inv.args.slice(0, -1));
  const local = await c.bytes.downloadPath(target.path, "archive.zip");
  const files = c.inv.flags.guest ? (await c.publicBackend()).files : (await c.backend()).files;
  const url = await files.archiveUrl(sources, c.signal);

  return c.bytes.downloadUrl(url, local, !!c.inv.flags.overwrite, c.transport, c.signal);
}

export async function versionList(c: Context) {
  return (
    (await (await c.backend()).files.info(uri(c), c.signal)).extended_info?.entities?.filter(
      (entity) => entity.type === EntityType.version,
    ) ?? []
  );
}

export function archiveSources(c: Context, paths: string[]) {
  if (!paths.length) {
    throw new CliError("usage", "Select at least one archive source");
  }

  return paths.map((path) => {
    const parsed = remote(path, String(c.inv.flags.cwd ?? "/my/"));

    return c.sharePassword && parsed.fs() === "share"
      ? parsed.withPassword(c.sharePassword).toString()
      : parsed.toString();
  });
}
