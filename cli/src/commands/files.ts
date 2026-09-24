import { validateDirectLink } from "@cloudreve/sdk/shares";
import {
  CrUri,
  childUri,
  type FileEntry,
  type ListOptions,
  type SearchParams,
  type Directory,
  MAX_TEXT_BYTES,
  nextPage,
  validateName,
  tagPatches,
  customPropertyPatch,
} from "@cloudreve/sdk/files";
import type { Context } from "../composition.js";
import { CliError } from "../output/errors.js";
import { entry as view } from "../output/format.js";
import { fileHeader, fileRow, renderHuman } from "../output/human.js";
import { timestampFormatter } from "../output/timezone.js";
import { arg, flag, numberFlag, stringArrayFlag } from "../input.js";
import { remote, resolveOperand, roots } from "../paths.js";
import { download, upload } from "./transfers.js";

export async function infoOrMissing(c: Context, uri: string): Promise<FileEntry | undefined> {
  return (await c.backend()).files.infoIfExists(uri);
}

export async function destination(c: Context, operand: string, sourceName: string): Promise<CrUri> {
  const o = resolveOperand(operand, String(c.inv.flags.cwd ?? "/my/"));

  if (o.kind !== "remote") {
    throw new CliError("path", "Destination requires a remote path");
  }

  return new CrUri(
    (
      await (
        await c.backend()
      ).files.resolveDestination(sourceName, o.uri.toString(), o.trailingSlash)
    ).uri,
  );
}

interface Cursor {
  version: 1;
  context: string;
  options: ListOptions;
  offset: number;
}

export async function listing(c: Context): Promise<void> {
  const cwd = String(c.inv.flags.cwd ?? "/my/");
  const o = resolveOperand(c.inv.args[0] ?? cwd, cwd);
  const json = !!c.inv.flags.json;

  const presentation = {
    ...c.io.presentation,
    timezone: String(c.inv.flags.timezone ?? "UTC"),
  };

  const humanFile = json ? undefined : timestampFormatter(presentation.timezone);

  if (o.kind === "root") {
    await c.io.write(
      json
        ? `${JSON.stringify({ schemaVersion: 1, data: roots.map((r) => ({ ...r, support: "server-dependent" })) })}\n`
        : renderHuman("ls", roots, presentation),
    );

    return;
  }

  if (o.kind !== "remote") {
    throw new CliError("path", "ls requires a remote path");
  }

  let metadata: SearchParams["metadata"];

  if (c.inv.flags["metadata-json"] !== undefined) {
    try {
      const value: unknown = JSON.parse(String(c.inv.flags["metadata-json"]));

      if (
        !Array.isArray(value) ||
        value.some(
          (item) =>
            !item ||
            typeof item !== "object" ||
            typeof item.key !== "string" ||
            !item.key ||
            typeof item.value !== "string" ||
            (item.exact !== undefined && typeof item.exact !== "boolean"),
        )
      ) {
        throw new Error();
      }

      metadata = value;
    } catch {
      throw new CliError(
        "usage",
        "--metadata-json expects [{key,value,exact?}] with string keys/values",
      );
    }
  }

  const filters: SearchParams = {
    metadata,
    useOr: c.inv.flags["match-any"] as boolean | undefined,
    nameOpOr: c.inv.flags["name-any"] as boolean | undefined,
    name:
      stringArrayFlag(c.inv, "names-json") ??
      (c.inv.flags.search === undefined ? undefined : [String(c.inv.flags.search)]),
    category: c.inv.flags.category as string | undefined,
    type: c.inv.flags.type as "file" | "folder" | undefined,
    caseFolding: c.inv.flags["ignore-case"] as boolean | undefined,
    sizeGte: numberFlag(c.inv, "size-min"),
    sizeLte: numberFlag(c.inv, "size-max"),
    createdGte: numberFlag(c.inv, "created-after"),
    createdLte: numberFlag(c.inv, "created-before"),
    updatedGte: numberFlag(c.inv, "updated-after"),
    updatedLte: numberFlag(c.inv, "updated-before"),
  };

  if (
    filters.category !== undefined &&
    Object.entries(filters).some(([key, value]) => key !== "category" && value !== undefined)
  ) {
    throw new CliError(
      "usage",
      "Category presets replace other search conditions; use --category alone or explicit filters",
    );
  }

  for (const [min, max] of [
    [filters.sizeGte, filters.sizeLte],
    [filters.createdGte, filters.createdLte],
    [filters.updatedGte, filters.updatedLte],
  ]) {
    if (min !== undefined && max !== undefined && min > max) {
      throw new CliError("usage", "Search range minimum must not exceed maximum");
    }
  }

  const uri = Object.values(filters).some((value) => value !== undefined)
    ? o.uri.withSearchParams(filters)
    : o.uri;

  const requestedUri = c.sharePassword ? uri.withPassword(c.sharePassword) : uri;
  const limit = numberFlag(c.inv, "limit");

  if (limit === 0) {
    throw new CliError("usage", "--limit must be positive");
  }

  const context = JSON.stringify([
    c.name,
    c.connection().endpoint,
    c.connection().accountId,
    uri.toString(),
    c.inv.flags["order-by"],
    c.inv.flags["order-direction"],
  ]);

  let options: ListOptions = {
    page_size: 100,
    order_by: c.inv.flags["order-by"] as string | undefined,
    order_direction: c.inv.flags["order-direction"] as string | undefined,
  };

  let offset = 0;

  if (c.inv.flags.cursor) {
    try {
      const token = JSON.parse(
        Buffer.from(String(c.inv.flags.cursor), "base64url").toString(),
      ) as Cursor;

      if (
        token.version !== 1 ||
        token.context !== context ||
        !Number.isSafeInteger(token.offset) ||
        token.offset < 0 ||
        !token.options ||
        Object.keys(token.options).some(
          (k) =>
            !["page", "page_size", "next_page_token", "order_by", "order_direction"].includes(k),
        )
      ) {
        throw new Error();
      }

      options = token.options;
      offset = token.offset;
    } catch {
      throw new CliError("cursor", "Invalid cursor or different listing context");
    }
  }

  let count = 0;
  let continuation: string | undefined;
  let first = true;

  const seen = new Set<string>();

  for (;;) {
    const key = JSON.stringify(options);

    if (seen.has(key)) {
      throw new CliError("pagination", "Repeated server pagination", 1);
    }

    seen.add(key);

    let page: Directory | undefined;
    let consumed = 0;
    let batched = false;
    let limited = false;

    stream: for await (const event of (await c.reader()).listStream(
      requestedUri.toString(),
      options,
      c.signal,
    )) {
      if (event.type === "list") {
        page = event.directory;
      }

      const entries = event.type === "file" ? event.files : batched ? [] : event.directory.files;

      if (event.type === "file") {
        batched = true;
      }

      for (const file of entries) {
        if (consumed < offset) {
          consumed++;
          continue;
        }

        if (limit !== undefined && count >= limit) {
          limited = true;
          break stream;
        }

        if (first) {
          await c.io.write(json ? '{"schemaVersion":1,"data":[' : fileHeader(presentation));
        }

        await c.io.write(
          json
            ? (first ? "" : ",") + JSON.stringify(view(file))
            : fileRow(humanFile!(file), presentation),
        );

        first = false;
        count++;
        consumed++;
      }
    }

    if (!limited && !page) {
      throw new CliError("pagination", "Directory stream ended without metadata", 1);
    }

    if (offset > consumed) {
      throw new CliError("cursor", "Directory changed; restart listing");
    }

    const next = page ? nextPage(page.pagination) : undefined;

    if (limited || (limit !== undefined && count >= limit && next)) {
      continuation = Buffer.from(
        JSON.stringify({
          version: 1,
          context,
          options: limited ? options : { ...options, ...next },
          offset: limited ? consumed : 0,
        }),
      ).toString("base64url");

      break;
    }

    if (!next) {
      break;
    }

    options = { ...options, ...next };
    offset = 0;
  }

  const pagination = {
    complete: !continuation,
    ...(continuation ? { cursor: continuation } : {}),
  };

  if (json) {
    if (first) {
      await c.io.write('{"schemaVersion":1,"data":[');
    }

    await c.io.write(`],"pagination":${JSON.stringify(pagination)}}\n`);
  } else if (first) {
    await c.io.write("No entries.\n");
  } else if (continuation) {
    await c.io.diagnostic(`More entries: --cursor ${continuation}\n`);
  }
}

function location(c: Context, mutation = false) {
  const uri = remote(arg(c.inv, 0), String(c.inv.flags.cwd ?? "/my/"), mutation);

  return c.sharePassword ? uri.withPassword(c.sharePassword) : uri;
}

export async function emptyTrash(c: Context) {
  await c.ensureSupported("trash-empty");
  await c.confirm(`Permanently empty trash for ${c.name}`);

  return (await c.backend()).files.emptyTrash();
}

export async function copy(c: Context, move = false) {
  const { inv } = c;
  const cwd = String(inv.flags.cwd ?? "/my/");

  const input = arg(inv, 0);

  if (/^https?:\/\//i.test(input) || inv.flags["link-stdin"]) {
    if (move || inv.flags.recursive || (inv.flags["link-stdin"] && input !== "-")) {
      throw new CliError(
        "usage",
        "A public direct link supports cp to local:DESTINATION only; use - with --link-stdin",
      );
    }

    const target = resolveOperand(arg(inv, 1), cwd);

    if (target.kind !== "local") {
      throw new CliError("usage", "Public direct links require local:DESTINATION");
    }

    await c.ensureSupported();

    const link = validateDirectLink(
      inv.flags["link-stdin"] ? (await c.io.input(32768)).toString().trim() : input,
      c.connection().endpoint,
    );

    return c.bytes.downloadUrl(
      link,
      await c.bytes.downloadPath(target.path, "download"),
      !!inv.flags.overwrite,
      c.transport,
      c.signal,
      true,
    );
  }

  const source = resolveOperand(input, cwd);
  const dest = resolveOperand(arg(inv, 1), cwd);

  if (source.kind === "root" || dest.kind === "root") {
    throw new CliError("path", "Synthetic roots cannot be copied or moved");
  }

  if (source.kind === "local") {
    if (inv.flags.guest) {
      throw new CliError("usage", "Guest mode permits remote-to-local download only");
    }

    if (move || dest.kind === "local") {
      throw new CliError("usage", "Use host tools for local moves or local-to-local copies");
    }

    if (inv.flags.recursive) {
      return uploadTree(c, source.path, arg(inv, 1));
    }

    if (inv.flags.overwrite) {
      if (dest.uri.fs() !== "my" || dest.uri.id() || dest.uri.isSearch()) {
        throw new CliError("path", "Upload overwrite requires the personal namespace");
      }

      let target = dest.uri;
      let existing = await infoOrMissing(c, target.toString());

      if (existing?.type === 1) {
        target = new CrUri(childUri(target.toString(), c.bytes.localBasename(source.path)));
        existing = await infoOrMissing(c, target.toString());
      } else if (dest.trailingSlash) {
        throw new CliError("path", "Trailing slash requires an existing remote directory");
      }

      if (existing) {
        if (existing.type !== 0 || !existing.primary_entity) {
          throw new CliError(
            "collision",
            "Target is a directory or has no confirmed current entity",
          );
        }

        return upload(c, source.path, target, existing.primary_entity);
      }
    }

    return upload(
      c,
      source.path,
      await destination(c, arg(inv, 1), c.bytes.localBasename(source.path)),
    );
  }

  if (source.uri.isRoot() || source.uri.isSearch()) {
    throw new CliError("path", "Cannot copy/move namespace root or query view");
  }

  if (dest.kind === "local") {
    if (move) {
      throw new CliError("usage", "mv supports remote operands only");
    }

    return download(
      c,
      c.sharePassword ? source.uri.withPassword(c.sharePassword) : source.uri,
      dest.path,
    );
  }

  if (inv.flags.guest) {
    throw new CliError("usage", "Guest mode permits remote-to-local download only");
  }

  return (await c.backend()).files.copyTo(source.uri.toString(), dest.uri.toString(), {
    copy: !move,
    requireDirectory: dest.trailingSlash,
    recursive: !!inv.flags.recursive,
  });
}

export async function stat(c: Context) {
  return view(await (await c.reader()).info(location(c).toString()));
}

export async function create(c: Context, folder = false) {
  const b = await c.backend();
  const uri = location(c, true);

  if (!folder) {
    const existing = await infoOrMissing(c, uri.toString());

    if (existing) {
      return view(existing);
    }
  }

  return view(
    await b.files.create(
      uri.parent().toString(),
      uri.elements().at(-1)!,
      folder ? "folder" : "file",
    ),
  );
}

export async function cat(c: Context) {
  const { inv } = c;
  const uri = location(c, false);
  let size = 0;

  const sink = {
    size: () => size,
    async reset() {
      throw new CliError("io", "Cannot rewind stdout", 1);
    },
    async append(bytes: Uint8Array) {
      await c.io.write(bytes);
      size += bytes.length;
    },
    async close() {},
  };

  if (inv.flags.guest) {
    const downloads = (await c.publicBackend()).downloads;

    await downloads.run(
      await downloads.prepare(uri.toString()),
      sink,
      async () => {},
      () => {},
      c.signal,
      { password: c.sharePassword },
    );
  } else {
    const downloads = (await c.backend()).downloads;

    await downloads.run(
      await downloads.prepare(uri.toString()),
      sink,
      async () => {},
      () => {},
      c.signal,
    );
  }
}

export async function write(c: Context) {
  const { inv } = c;
  const b = await c.backend();
  const uri = location(c, true);

  const text = await c.bytes.textInput(flag(inv, "input"), MAX_TEXT_BYTES, () =>
    c.io.input(MAX_TEXT_BYTES),
  );

  const doc = await b.files.readText(uri.toString(), c.transport, undefined, c.signal);

  return view(await b.files.saveText(doc, text));
}

export async function remove(c: Context) {
  const { inv } = c;
  const b = await c.backend();
  const uri = location(c, true);

  if (uri.fs() === "trash" && !inv.flags.permanent) {
    throw new CliError("usage", "Removing from trash requires --permanent");
  }

  const file = await b.files.info(uri.toString());

  if (file.type === 1 && !inv.flags.recursive) {
    throw new CliError("usage", "Directory removal requires --recursive");
  }

  if (inv.flags.permanent) {
    await c.confirm(`Permanently delete ${arg(inv, 0)}`);
  }

  return b.files.delete([uri.toString()], !!inv.flags.permanent);
}

export async function restore(c: Context) {
  const b = await c.backend();
  const uri = location(c, true);

  if (uri.fs() !== "trash") {
    throw new CliError("usage", "restore requires a trash path");
  }

  return b.files.restore([uri.toString()]);
}

export async function metadataView(c: Context) {
  return (await (await c.backend()).files.info(location(c).toString())).metadata ?? {};
}

export async function metadata(c: Context, remove = false) {
  const backend = await c.backend();
  const key = flag(c.inv, "key");
  const value = remove ? "" : flag(c.inv, "value");

  let patch: { key: string; value?: string; remove?: boolean } = {
    key,
    ...(remove ? { remove: true } : { value }),
  };

  if (key.startsWith("props:")) {
    const property = (await backend.files.customProperties()).find(
      (item) => item.id === key.slice(6),
    );

    if (!property) {
      throw new CliError("capability", "Unknown server custom property", 1);
    }

    patch = customPropertyPatch(property, value, remove);
  }

  return backend.files.metadata([location(c, true).toString()], [patch], c.signal);
}

export async function tag(c: Context, remove = false) {
  return (await c.backend()).files.metadata(
    [location(c, true).toString()],
    tagPatches(
      flag(c.inv, "name"),
      String(c.inv.flags.color ?? ""),
      c.inv.flags.original as string | undefined,
      remove,
    ),
  );
}

async function uploadTree(c: Context, path: string, operand: string) {
  if (c.inv.flags.overwrite) {
    throw new CliError(
      "usage",
      "Recursive upload requires an absent destination; overwrite is not supported",
    );
  }

  const tree = await c.localTree.scanLocalTree(path, { signal: c.signal });
  const name = c.bytes.localBasename(tree.root);

  if (validateName(name) !== name) {
    throw new CliError("input", "Local directory name would change remotely");
  }

  const target = await destination(c, operand, name);
  const files = (await c.backend()).files;

  await files.create(target.parent().toString(), target.elements().at(-1)!, "folder");

  let uploaded = 0;
  let directories = 1;

  for (const entry of tree.entries) {
    await c.localTree.assertLocalEntry(tree, entry, c.signal);

    const uri = entry.relative
      .split("/")
      .reduce((parent, name) => childUri(parent, name), target.toString());

    const parsed = new CrUri(uri);

    if (entry.kind === "directory") {
      await files.create(parsed.parent().toString(), parsed.elements().at(-1)!, "folder");
      directories++;
    } else {
      await upload(c, entry.path, parsed);
      uploaded++;
    }
  }

  return { uri: target.toString(), files: uploaded, directories };
}

export async function edit(c: Context) {
  const files = (await c.backend()).files;

  const document = await files.readText(
    location(c, true).toString(),
    c.transport,
    undefined,
    c.signal,
  );

  const text = await c.editText(document.text, flag(c.inv, "editor"), c.signal);

  if (text === document.text) {
    return { changed: false };
  }

  return view(await files.saveText(document, text, c.signal));
}
