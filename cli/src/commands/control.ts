import { CrUri } from "@cloudreve/sdk/files";
import { davOptions } from "@cloudreve/sdk/webdav";
import { parseShareLink, shareSourceUri } from "@cloudreve/sdk/shares";
import { ListTaskCategory } from "@cloudreve/sdk/jobs";
import type { Context } from "../composition.js";
import { CliError } from "../output/errors.js";
import { arg, flag, numberFlag, stringArrayFlag } from "../input.js";
import { remote } from "../paths.js";
import { secrets } from "./auth.js";

function uri(c: Context, index = 0) {
  return remote(arg(c.inv, index), String(c.inv.flags.cwd ?? "/my/")).toString();
}

export async function share_list(c: Context): Promise<unknown> {
  const options = {
    next_page_token: c.inv.flags.cursor as string | undefined,
    page_size: numberFlag(c.inv, "page-size"),
    order_direction: c.inv.flags["order-direction"] as string | undefined,
  };

  if (c.inv.flags.owner) {
    const shares = c.inv.flags.guest
      ? (await c.publicBackend()).shares
      : (await c.backend()).shares;

    return shares.publicList(flag(c.inv, "owner"), options, c.signal);
  }

  if (c.inv.flags.guest) {
    throw new CliError("usage", "Guest listing requires --owner");
  }

  return (await c.backend()).shares.list(options, c.signal);
}

export async function share_view(c: Context): Promise<unknown> {
  return (await c.backend()).shares.info(arg(c.inv, 0), c.signal);
}

export async function link_list(c: Context): Promise<unknown> {
  return (await (await c.backend()).files.info(uri(c), c.signal)).extended_info?.direct_links ?? [];
}

export async function account_capacity(c: Context): Promise<unknown> {
  return (await c.backend()).account.capacity();
}

export async function unlock(c: Context): Promise<unknown> {
  const secret = await secrets(c);

  if (!secret.token) {
    throw new CliError("usage", "Provide lock token with --secrets-stdin");
  }

  await c.confirm("Force unlock the supplied lock token");

  return (await c.backend()).files.unlock([secret.token], c.signal);
}

export async function share_create(c: Context, update = false): Promise<unknown> {
  const secret = await secrets(c);

  const existing = update
    ? await (await c.backend()).shares.info(arg(c.inv, 0), c.signal)
    : undefined;

  let target = existing ? "" : uri(c, 0);

  if (existing) {
    const source = new CrUri(shareSourceUri(existing));

    if (
      source.fs() !== "my" ||
      source.password() ||
      (source.id() && source.id() !== c.connection().accountId)
    ) {
      throw new CliError("share", "Existing share source belongs to another account", 1);
    }

    target = CrUri.my.join(...source.elements()).toString();

    if (c.inv.args[1] !== undefined) {
      const supplied = remote(c.inv.args[1], String(c.inv.flags.cwd ?? "/my/"), true);

      if (supplied.fs() !== "my" || CrUri.my.join(...supplied.elements()).toString() !== target) {
        throw new CliError(
          "usage",
          "An existing share cannot be rebound to a different source; omit the legacy path to use its current source",
        );
      }
    }
  }

  const boolean = (key: string, previous?: boolean) =>
    typeof c.inv.flags[key] === "boolean" ? Boolean(c.inv.flags[key]) : (previous ?? false);

  return {
    url: await (
      await c.backend()
    ).shares.save(
      {
        uri: target,
        downloads: numberFlag(c.inv, "downloads"),
        expire: numberFlag(c.inv, "expire"),
        is_private: boolean("private", existing?.is_private),
        share_view: boolean("share-view", existing?.share_view),
        show_readme: boolean("show-readme", existing?.show_readme),
        password: secret.password,
      },
      update ? arg(c.inv, 0) : undefined,
    ),
  };
}

export async function share_revoke(c: Context): Promise<unknown> {
  const ids = [...new Set(c.inv.args)];

  if (!ids.length) {
    throw new CliError("usage", "Select at least one share");
  }

  await c.confirm(`Revoke shares ${ids.join(", ")}`);

  const shares = (await c.backend()).shares;

  return ids.length === 1 ? shares.revoke(ids[0]!, c.signal) : shares.revokeMany(ids, c.signal);
}

export async function link_create(c: Context): Promise<unknown> {
  if (!(await (await c.backend()).shares.directAllowed())) {
    throw new CliError("capability", "Server does not permit direct links", 1);
  }

  return (await c.backend()).shares.direct(uri(c));
}

export async function link_revoke(c: Context): Promise<unknown> {
  await c.confirm(`Revoke direct link ${arg(c.inv, 0)}`);

  return (await c.backend()).shares.revokeDirect(arg(c.inv, 0));
}

export async function account_view(c: Context): Promise<unknown> {
  return (await c.backend()).account.me(c.signal);
}

export async function account_settings(c: Context): Promise<unknown> {
  const settings = await (await c.backend()).account.settings(c.signal);

  return {
    version_retention_enabled: settings.version_retention_enabled,
    version_retention_ext: settings.version_retention_ext,
    version_retention_max: settings.version_retention_max,
    share_links_in_profile: settings.share_links_in_profile,
  };
}

export async function account_password(c: Context): Promise<unknown> {
  const secret = await secrets(c);

  await (
    await c.backend()
  ).account.password(
    secret.current ?? (await c.io.secret("Current password")),
    secret.next ?? (await c.io.secret("New password")),
  );

  try {
    await c.logout();
  } catch (error) {
    if ((error as { phase?: string })?.phase !== "revocation") {
      throw error;
    }

    return {
      changed: true,
      signedOut: true,
      warnings: ["Password changed and local credentials cleared; server token revocation failed"],
    };
  }

  return { changed: true, signedOut: true };
}

export async function webdav_list(c: Context): Promise<unknown> {
  return (await c.backend()).webdav.list(c.inv.flags.cursor as string | undefined, c.signal);
}

export async function webdav_view(c: Context): Promise<unknown> {
  const value = await (await c.backend()).webdav.get(arg(c.inv, 0), c.signal);

  return { ...value, ...davOptions(value) };
}

export async function webdav_create(c: Context, update = false): Promise<unknown> {
  const webdav = (await c.backend()).webdav;
  const existing = update ? davOptions(await webdav.get(arg(c.inv, 0), c.signal)) : undefined;

  const boolean = (key: string, previous?: boolean) =>
    typeof c.inv.flags[key] === "boolean" ? Boolean(c.inv.flags[key]) : (previous ?? false);

  return webdav.save(
    {
      uri: uri(c, update ? 1 : 0),
      name: flag(c.inv, "name"),
      readonly: boolean("readonly", existing?.readonly),
      proxy: boolean("proxy", existing?.proxy),
      disable_sys_files: boolean("disable-sys-files", existing?.disable_sys_files),
    },
    update ? arg(c.inv, 0) : undefined,
  );
}

export async function webdav_revoke(c: Context): Promise<unknown> {
  await c.confirm(`Revoke WebDAV account ${arg(c.inv, 0)}`);

  return (await c.backend()).webdav.revoke(arg(c.inv, 0));
}

export async function job_list(c: Context): Promise<unknown> {
  const category = String(c.inv.flags.category ?? "general");

  if (!Object.values(ListTaskCategory).includes(category as ListTaskCategory)) {
    throw new CliError("usage", "Invalid job category");
  }

  return (await c.backend()).jobs.list(
    category as ListTaskCategory,
    c.inv.flags.cursor as string | undefined,
    c.signal,
  );
}

export async function job_view(c: Context): Promise<unknown> {
  return (await c.backend()).jobs.get(
    arg(c.inv, 0),
    String(c.inv.flags.type ?? "general"),
    c.signal,
  );
}

export async function job_cancel(c: Context): Promise<unknown> {
  await c.confirm(`Cancel job ${arg(c.inv, 0)}`);

  return (await c.backend()).jobs.cancel(
    await (await c.backend()).jobs.get(arg(c.inv, 0), "remote_download", c.signal),
  );
}

export async function job_select(c: Context): Promise<unknown> {
  const selected = flag(c.inv, "indices").split(",").map(Number);

  if (selected.some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new CliError("usage", "Indices must be nonnegative integers");
  }

  return (await c.backend()).jobs.selectFiles(
    await (await c.backend()).jobs.get(arg(c.inv, 0), "remote_download", c.signal),
    selected,
  );
}

export async function archive_list(c: Context): Promise<unknown> {
  return (await c.backend()).jobs.archiveFiles(
    uri(c),
    c.inv.flags.encoding as string | undefined,
    c.signal,
  );
}

export async function archive_create(c: Context, extract = false): Promise<unknown> {
  const members = stringArrayFlag(c.inv, "members-json");

  if (!extract && members) {
    throw new CliError("usage", "--members-json applies only to archive extract");
  }

  const secret = await secrets(c);

  return (await c.backend()).jobs.archive(
    {
      src: [uri(c)],
      dst: uri(c, 1),
      encoding: c.inv.flags.encoding as string | undefined,
      password: secret.password,
      file_mask: members,
    },
    extract,
  );
}

export async function share_open(c: Context) {
  if (c.inv.flags["link-stdin"] && c.inv.args.length) {
    throw new CliError("usage", "Choose a share ID or --link-stdin");
  }

  const parsed = c.inv.flags["link-stdin"]
    ? parseShareLink((await c.io.input(32768)).toString().trim(), c.connection().endpoint)
    : { id: arg(c.inv, 0), password: (await secrets(c)).password };

  const shares = c.inv.flags.guest ? (await c.publicBackend()).shares : (await c.backend()).shares;

  return shares.resolve(parsed.id, parsed.password, c.signal);
}
