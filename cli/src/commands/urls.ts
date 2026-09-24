import { archiveSources } from "./explorer.js";
import type { Context } from "../composition.js";
import { arg } from "../input.js";
import { remote } from "../paths.js";
import { CliError } from "../output/errors.js";

/** Explicitly returns a temporary capability URL; command wiring enables URL disclosure. */
export async function temporaryUrl(c: Context): Promise<{ url: string }> {
  c.signal.throwIfAborted();

  const { flags } = c.inv;

  if (
    [flags.preview, flags["primary-site"], flags.download, flags.archive].filter(Boolean).length >
      1 ||
    (flags["primary-site"] && flags.fresh) ||
    (flags.archive && (flags.fresh || flags.entity))
  ) {
    throw new CliError("usage", "Choose one URL mode; --fresh is unavailable with --primary-site");
  }

  if (!flags.archive && c.inv.args.length !== 1) {
    throw new CliError("usage", "Multiple URL sources require --archive");
  }

  const path = remote(arg(c.inv, 0), String(flags.cwd ?? "/my/"));
  const uri = c.sharePassword ? path.withPassword(c.sharePassword).toString() : path.toString();

  const reader = await c.reader();
  const entity = flags.entity as string | undefined;

  const urls = flags.archive
    ? [await reader.archiveUrl(archiveSources(c, c.inv.args), c.signal)]
    : flags["primary-site"]
      ? [await reader.viewerUrl(uri, entity, c.signal)]
      : await reader.urls([uri], !flags.preview, entity, !!flags.fresh, c.signal);

  if (urls.length !== 1 || !urls[0]) {
    throw new CliError("operation", "Server did not return exactly one file URL", 1);
  }

  return { url: urls[0] };
}
