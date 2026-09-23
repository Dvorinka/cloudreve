import { version } from "./version.js";
import type { CommandUnknownOpts as AnyCommand } from "@commander-js/extra-typings";
import { Command, Option, CommanderError } from "@commander-js/extra-typings";
import type { Context } from "./composition.js";
import type { Invocation } from "./input.js";
import { CliError } from "./output/errors.js";
import * as files from "./commands/files.js";
import * as auth from "./commands/auth.js";
import * as control from "./commands/control.js";
import * as security from "./commands/security.js";
import * as explorer from "./commands/explorer.js";
import { diagnostics } from "./commands/diagnostics.js";
import { temporaryUrl } from "./commands/urls.js";
import { validateTimezone } from "./output/timezone.js";
import {
  transferList,
  transferForget,
  transferResume,
  transferRetry,
  transferCancel,
} from "./commands/transfers.js";

export { arg, flag, numberFlag } from "./input.js";

export type { Invocation } from "./input.js";

export type Action = (context: Context) => Promise<unknown>;

export interface ParsedInvocation extends Invocation {
  execute?: Action;
  stream?: boolean;
  discloseUrls?: boolean;
  helpText?: string;
}

const integer = (input: string) => {
  const value = Number(input);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CliError("usage", "Expected a nonnegative integer");
  }

  return String(value);
};

export function createProgram(
  invoke: (inv: ParsedInvocation) => unknown = () => {},
  output: (text: string) => void = () => {},
) {
  const root = new Command()
    .name("cr")
    .description("Cloudreve CLI — remote filesystem and account controls")
    .version(`cr ${version}`)
    .exitOverride()
    .configureOutput({ writeOut: output, writeErr: () => {} })
    .configureHelp({ showGlobalOptions: true })
    .addHelpText(
      "afterAll",
      "\nRemote paths use /my/, /trash/, /shared_with_me/ or /share/ID/.\ncp local operands require local:. Diagnostics use stderr; cat outputs raw bytes.",
    )
    .option("--profile <name>", "Connection profile")
    .option("--config-dir <directory>", "Private configuration directory")
    .option("--cwd <path>", "Remote working directory", "/my/")
    .option("--json", "Versioned structured output")
    .option(
      "--timezone <iana-name>",
      "Format human metadata timestamps in this timezone; JSON is unchanged",
      validateTimezone,
    )
    .option("--show-lock-tokens", "Explicitly include bearer lock handles in JSON errors")
    .option("--no-prompt", "Disable interactive prompts");

  const bind = (command: AnyCommand, action: Action, stream = false, discloseUrls = false) => {
    command.allowExcessArguments(false).action(function (this: AnyCommand) {
      const flags: Invocation["flags"] = {};

      for (const [k, v] of Object.entries(this.optsWithGlobals())) {
        if (k === "prompt") {
          flags["no-prompt"] = !v;
        } else {
          flags[k.replace(/[A-Z]/g, (x) => "-" + x.toLowerCase())] = v as string | boolean;
        }
      }

      const names: string[] = [this.name()];

      for (let parent = this.parent; parent?.parent; parent = parent.parent) {
        names.unshift(parent.name());
      }

      const result = invoke({
        command: names.join(" "),
        args: this.processedArgs.flat().filter((v): v is string => typeof v === "string"),
        flags,
        execute: action,
        stream,
        discloseUrls,
      });

      if (result instanceof Promise) {
        return result.then(() => {});
      }
    });

    return command;
  };

  const leaf = <S extends string>(name: S, description: string) =>
    root.command(name).description(description);

  bind(
    leaf("ls [path]", "List a complete directory or remote namespaces")
      .option("--limit <count>", "Bound listing and return continuation", integer)
      .option("--cursor <token>", "Resume this listing")
      .addOption(new Option("--search <name>", "Filter names").conflicts("namesJson"))
      .addOption(
        new Option("--names-json <names>", "JSON array of name patterns").conflicts("search"),
      )
      .option("--name-any", "Match any name pattern")
      .option("--match-any", "Match any search condition")
      .option("--metadata-json <filters>", "JSON [{key,value,exact?}] tag/custom-property filters")
      .option("--guest", "Use anonymous share access without account credentials")
      .option("--share-password-stdin", "Read a transient share password from stdin")
      .option("--ignore-case", "Case-insensitive name search")
      .addOption(new Option("--type <type>", "Filter entry type").choices(["file", "folder"]))
      .addOption(
        new Option("--category <category>", "Filter configured file category").choices([
          "image",
          "video",
          "audio",
          "document",
        ]),
      )
      .option("--size-min <bytes>", "Minimum byte size", integer)
      .option("--size-max <bytes>", "Maximum byte size", integer)
      .option("--created-after <seconds>", "Created at or after Unix time", integer)
      .option("--created-before <seconds>", "Created at or before Unix time", integer)
      .option("--updated-after <seconds>", "Updated at or after Unix time", integer)
      .option("--updated-before <seconds>", "Updated at or before Unix time", integer)
      .option("--order-by <field>", "Sort field")
      .option("--order-direction <direction>", "Sort direction"),
    files.listing,
    true,
  );

  bind(
    leaf("url <paths...>", "Issue a temporary file URL; capability URL is printed explicitly")
      .option("--download", "Counted download URL (default)")
      .option("--preview", "Uncounted preview URL")
      .option("--primary-site", "Primary-site preview URL")
      .option("--archive", "Temporary ZIP URL; current entities only")
      .option("--fresh", "Bypass cached download/preview URL")
      .option("--entity <id>", "Retained entity version")
      .option("--guest", "Anonymous share access")
      .option("--share-password-stdin", "Read transient share password"),
    temporaryUrl,
    false,
    true,
  );

  bind(
    leaf("stat <path>", "Inspect remote metadata")
      .option("--guest", "Anonymous share access")
      .option("--share-password-stdin", "Read transient share password"),
    files.stat,
  );

  bind(leaf("mkdir <path>", "Create one remote directory"), (c) => files.create(c, true));

  bind(leaf("touch <path>", "Create an absent empty file without changing existing content"), (c) =>
    files.create(c),
  );

  bind(
    leaf("cat <path>", "Stream remote bytes to stdout; incompatible with JSON")
      .option("--guest", "Anonymous share access")
      .option("--share-password-stdin", "Read transient share password")
      .hook("preAction", (_command, action) => {
        if (action.optsWithGlobals().json) {
          throw new CliError("usage", "cat writes raw bytes and cannot use --json");
        }
      }),
    files.cat,
    true,
  );

  bind(
    leaf("write <path>", "Replace bounded UTF-8 text using version conflicts").requiredOption(
      "--input <file-or-dash>",
      "File containing text, or - for explicit stdin",
    ),
    files.write,
  );

  bind(
    leaf(
      "edit <path>",
      "Edit bounded UTF-8 text in an explicit external editor and save with a version precondition",
    )
      .requiredOption(
        "--editor <executable>",
        "Foreground editor executable; file path is passed as one argument",
      )
      .hook("preAction", (_command, action) => {
        if (action.optsWithGlobals().json) {
          throw new CliError("usage", "edit inherits terminal I/O and cannot use --json");
        }
      }),
    files.edit,
  );

  bind(
    leaf(
      "cp <source> <destination>",
      "Copy remotely, upload local:SOURCE or download to local:DESTINATION",
    )
      .option("--guest", "Anonymous share download to local destination")
      .option("--link-stdin", "Read a supported public direct URL; use - as source")
      .option("--share-password-stdin", "Read transient share password; resume requires it again")
      .option("--recursive", "Copy a remote directory or upload a local directory tree")
      .option("--overwrite", "Permit local replacement or version-guarded upload replacement"),
    (c) => files.copy(c),
  );

  bind(leaf("mv <source> <destination>", "Move or rename a remote entry"), (c) =>
    files.copy(c, true),
  );

  bind(
    leaf("rm <path>", "Trash an entry; permanent removal requires explicit intent")
      .option("--recursive", "Permit directory removal")
      .option("--permanent", "Permanently delete")
      .option("--yes", "Confirm permanent deletion"),
    files.remove,
  );

  bind(leaf("restore <path>", "Restore a trash entry"), files.restore);

  bind(
    leaf("unlock", "Force unlock using an explicitly supplied bearer lock token")
      .requiredOption("--secrets-stdin", "Read {token} JSON from stdin")
      .option("--yes", "Confirm force unlock"),
    control.unlock,
  );

  bind(
    root
      .command("server")
      .description("Inspect a server without authentication")
      .command("info [origin]")
      .description("Check API version and edition")
      .option("--auth", "Include authentication capabilities"),
    auth.serverInfo,
  );

  const profile = root.command("profile").description("Manage local connection profiles");

  bind(
    profile
      .command("add <name>")
      .description("Add a connection")
      .requiredOption("--server <origin>", "HTTP(S) origin")
      .addOption(
        new Option("--credential-store <store>", "Credential storage").choices([
          "keychain",
          "file",
          "native",
        ]),
      ),
    auth.profileAdd,
  );

  bind(profile.command("list").description("List connections"), auth.profileList);
  bind(profile.command("use <name>").description("Select default connection"), auth.profileUse);

  bind(
    profile
      .command("remove <name>")
      .description("Remove connection")
      .option("--yes", "Confirm removal"),
    auth.profileRemove,
  );

  const authentication = root.command("auth").description("Authenticate the selected profile");

  bind(
    authentication
      .command("login")
      .description("Authenticate with a password, credential link or browser")
      .option("--name <name>", "Save and activate a named account")
      .option("--server <url>", "Cloudreve server for a new account")
      .option(
        "--credential-store <store>",
        "Credential storage for a new account: keychain, native or file",
      )
      .addOption(
        new Option("--browser", "Use browser OAuth (the default login method)").conflicts([
          "passwordStdin",
          "credentialStdin",
          "email",
        ]),
      )
      .option("--no-open", "Print the OAuth URL for a browser on this computer")
      .addOption(
        new Option(
          "--authorize-url <url>",
          "Custom registered loopback OAuth authorization URL",
        ).conflicts(["email", "passwordStdin", "credentialStdin"]),
      )
      .option("--browser-command <executable>", "Custom browser executable")
      .option("--timeout <milliseconds>", "Browser callback timeout", integer)
      .option("--email <email>", "Account email")
      .addOption(
        new Option("--password-stdin", "Read password from stdin").conflicts([
          "credentialStdin",
          "secretsStdin",
        ]),
      )
      .addOption(
        new Option("--credential-stdin", "Read credential link from stdin").conflicts([
          "passwordStdin",
          "secretsStdin",
        ]),
      )
      .addOption(
        new Option("--secrets-stdin", "Read password/OTP/captcha JSON from stdin").conflicts([
          "passwordStdin",
          "credentialStdin",
        ]),
      ),
    auth.authLogin,
  );

  bind(
    authentication.command("status").description("List saved accounts and the active account"),
    auth.authStatus,
  );

  bind(
    authentication.command("logout [name]").description("Sign out one saved account"),
    auth.authLogout,
  );

  bind(
    authentication.command("switch <name>").description("Activate a saved signed-in account"),
    auth.authSwitch,
  );

  const share = root.command("share").description("Manage outgoing shares");

  bind(
    share
      .command("list")
      .description("List own shares or a public owner's shares")
      .option("--owner <id>", "Public owner ID")
      .option("--guest", "Read a public owner without sign-in")
      .option("--cursor <token>", "Next page")
      .option("--page-size <count>", "Page size", integer)
      .addOption(
        new Option("--order-direction <direction>", "Sort direction").choices(["asc", "desc"]),
      ),
    control.share_list,
  );

  bind(
    share
      .command("view <id>")
      .description("Inspect share")
      .option("--show-password", "Explicitly reveal the stored share password"),
    control.share_view,
  );

  for (const update of [false, true]) {
    bind(
      share
        .command(update ? "update <id> [path]" : "create <path>")
        .description(
          update
            ? "Update limits/view options; existing privacy/password changes are unsupported on Community"
            : "Create a share",
        )
        .addOption(
          new Option("--downloads <count>", "Download limit; 0 is unlimited")
            .argParser(integer)
            .makeOptionMandatory(update),
        )
        .addOption(
          new Option("--expire <seconds>", "Expiry from now; 0 never expires")
            .argParser(integer)
            .makeOptionMandatory(update),
        )
        .option("--private", "Private share")
        .option("--no-private", "Make share public")
        .option("--share-view", "Share view")
        .option("--no-share-view", "Disable share view")
        .option("--show-readme", "Show README")
        .option("--no-show-readme", "Hide README")
        .option("--secrets-stdin", "Read password JSON"),
      (c) => control.share_create(c, update),
      false,
      true,
    );
  }

  bind(
    share
      .command("revoke <ids...>")
      .description("Revoke one or more shares")
      .option("--yes", "Confirm revocation"),
    control.share_revoke,
  );

  bind(
    share
      .command("open [id]")
      .description("Inspect or unlock a share ID or short link")
      .addOption(
        new Option("--link-stdin", "Read a short share link privately").conflicts("secretsStdin"),
      )
      .option("--secrets-stdin", "Read {password} for a share ID")
      .option("--guest", "Anonymous share access"),
    control.share_open,
  );

  bind(
    leaf("diagnostics", "Inspect sanitized runtime and account state without tokens").option(
      "--online",
      "Verify authenticated server access",
    ),
    diagnostics,
  );

  const link = root.command("link").description("Manage direct links");

  bind(
    link.command("create <path>").description("Create direct links"),
    control.link_create,
    false,
    true,
  );

  bind(
    link
      .command("revoke <id>")
      .description("Revoke direct link")
      .option("--yes", "Confirm revocation"),
    control.link_revoke,
  );

  bind(
    link
      .command("list <path>")
      .description("List existing direct links; URLs can be copied from stdout"),
    control.link_list,
    false,
    true,
  );

  const account = root.command("account").description("Manage the remote account");

  bind(account.command("view").description("Inspect account"), control.account_view);

  bind(
    account.command("capacity").description("Inspect storage usage and quota"),
    control.account_capacity,
  );

  bind(account.command("settings").description("Inspect settings"), control.account_settings);

  bind(
    account
      .command("password")
      .description("Change password")
      .option("--secrets-stdin", "Read current/next password JSON"),
    control.account_password,
  );

  bind(
    account
      .command("configure")
      .description("Patch selected account preferences")
      .addOption(
        new Option("--retain-versions <state>", "Retain file history").choices(["on", "off"]),
      )
      .option("--version-extensions-json <extensions>", "JSON extension array, [] clears it")
      .option("--version-limit <count>", "Maximum retained versions", integer)
      .addOption(
        new Option("--public-shares <visibility>", "Shares visible on public profile").choices([
          "public",
          "all",
          "none",
        ]),
      ),
    security.configure,
  );

  const twoFactor = account.command("two-factor").description("Manage account second factor");

  for (const enabled of [true, false]) {
    bind(
      twoFactor
        .command(enabled ? "enable" : "disable")
        .description(enabled ? "Enable second factor" : "Disable second factor")
        .option("--secrets-stdin", "Read {code} JSON")
        .option("--enroll", "Initialize enrollment before reading the code")
        .option("--show-secret", "Explicitly disclose a fresh enrollment secret on stderr"),
      (c) => security.twoFactorSet(c, enabled),
    );
  }

  const passkeys = account
    .command("passkey")
    .description("Manage authenticators registered with this account");

  bind(passkeys.command("list").description("List registered passkeys"), security.passkeyList);

  bind(
    passkeys
      .command("delete <id>")
      .description("Remove one registered passkey")
      .option("--yes", "Confirm deletion"),
    security.passkeyDelete,
  );

  const grants = account.command("grant").description("Manage OAuth application grants");

  bind(grants.command("list").description("List authorized applications"), security.grantList);

  bind(
    grants
      .command("revoke <id>")
      .description("Revoke one application's grant")
      .option("--yes", "Confirm revocation"),
    security.grantRevoke,
  );

  const dav = root.command("webdav").description("Manage WebDAV access");

  bind(
    dav.command("list").description("List access accounts").option("--cursor <token>", "Next page"),
    control.webdav_list,
  );

  bind(
    dav
      .command("view <id>")
      .description("Inspect access account")
      .option("--show-password", "Explicitly reveal the password"),
    control.webdav_view,
  );

  for (const update of [false, true]) {
    bind(
      dav
        .command(update ? "update <id> [path]" : "create <path>")
        .description(update ? "Update access" : "Create access")
        .requiredOption("--name <name>", "Display name")
        .option("--readonly", "Read only")
        .option("--no-readonly", "Allow writes")
        .option("--proxy", "Use proxy")
        .option("--no-proxy", "Disable proxy")
        .option("--disable-sys-files", "Exclude system files")
        .option("--no-disable-sys-files", "Include system files"),
      (c) => control.webdav_create(c, update),
    );
  }

  bind(
    dav.command("revoke <id>").description("Revoke access").option("--yes", "Confirm revocation"),
    control.webdav_revoke,
  );

  const job = root.command("job").description("Inspect worker jobs");

  bind(
    job
      .command("list")
      .description("List jobs")
      .addOption(
        new Option("--category <category>", "Job category").choices([
          "general",
          "downloading",
          "downloaded",
        ]),
      )
      .option("--cursor <token>", "Next page"),
    control.job_list,
  );

  bind(
    job.command("view <id>").description("Inspect job").option("--type <type>", "Job type"),
    control.job_view,
  );

  bind(
    job
      .command("cancel <id>")
      .description("Cancel remote download")
      .option("--yes", "Confirm cancellation"),
    control.job_cancel,
  );

  bind(
    job
      .command("select <id>")
      .description("Select remote-download members")
      .requiredOption("--indices <indices>", "Comma-separated indexes"),
    control.job_select,
  );

  const archive = root.command("archive").description("Manage archive workflows");

  bind(
    archive
      .command("list <path>")
      .description("List archive members")
      .option("--encoding <encoding>", "Filename encoding"),
    control.archive_list,
  );

  for (const extract of [false, true]) {
    bind(
      archive
        .command(extract ? "extract <source> <destination>" : "create <source> <destination>")
        .description(extract ? "Extract archive" : "Create archive")
        .option("--members-json <paths>", "JSON array of archive member names to extract")
        .option("--encoding <encoding>", "Filename encoding")
        .option("--secrets-stdin", "Read password JSON"),
      (c) => control.archive_create(c, extract),
    );
  }

  const versions = root.command("version").description("Manage file history");

  bind(
    versions.command("promote <path> <version>").description("Make a retained version current"),
    explorer.versionPromote,
  );

  bind(
    versions
      .command("delete <path> <version>")
      .description("Delete one retained version")
      .option("--yes", "Confirm history deletion"),
    explorer.versionDelete,
  );

  bind(
    leaf("search <query>", "Search indexed content; results are explicitly paged").option(
      "--offset <count>",
      "Result offset",
      integer,
    ),
    explorer.search,
  );

  bind(
    job
      .command("create <destination>")
      .description("Create remote URL/torrent download jobs")
      .addOption(
        new Option("--sources-stdin", "Read JSON URL array without credentials in argv").conflicts(
          "torrent",
        ),
      )
      .addOption(
        new Option("--torrent <path>", "Existing remote torrent file").conflicts("sourcesStdin"),
      ),
    explorer.createDownload,
  );

  bind(
    leaf(
      "watch <path>",
      "Receive directory events until server EOF or interruption; JSON emits one envelope per line",
    )
      .option(
        "--count <records>",
        "Stop after records, including subscription/keep-alive frames",
        integer,
      )
      .option("--client-id <uuid>", "Reuse a reconnect identity")
      .option("--timeout <milliseconds>", "Total connection timeout; 0 disables it", integer),
    explorer.watch,
    true,
  );

  bind(
    archive
      .command("download <paths...>")
      .option("--guest", "Anonymous share archive; requires server capability")
      .option("--share-password-stdin", "Read transient password for selected shares")
      .description("Download exact SOURCE... selection; final operand is local:DESTINATION")
      .option("--overwrite", "Replace an existing local file"),
    explorer.archiveDownload,
  );

  bind(
    versions.command("list <path>").description("List retained file-content versions"),
    explorer.versionList,
  );

  const metadata = root.command("metadata").description("Manage custom metadata");

  bind(
    metadata.command("schema").description("Inspect server-defined custom property types"),
    async (c) => (await c.backend()).files.customProperties(),
  );

  bind(metadata.command("view <path>").description("Inspect metadata"), files.metadataView);

  bind(
    metadata
      .command("set <path>")
      .description("Set one property")
      .requiredOption("--key <key>", "Property key")
      .requiredOption("--value <value>", "Property value"),
    (c) => files.metadata(c),
  );

  bind(
    metadata
      .command("remove <path>")
      .description("Remove one property")
      .requiredOption("--key <key>", "Property key"),
    (c) => files.metadata(c, true),
  );

  const tag = root.command("tag").description("Manage tags");

  bind(
    tag
      .command("add <path>")
      .description("Add a colored tag")
      .requiredOption("--name <name>", "Tag name")
      .requiredOption("--color <color>", "Hex color"),
    (c) => files.tag(c),
  );

  bind(
    tag
      .command("rename <path>")
      .description("Rename a tag in one metadata mutation")
      .requiredOption("--original <name>", "Previous tag name")
      .requiredOption("--name <name>", "New tag name")
      .requiredOption("--color <color>", "Hex color"),
    (c) => files.tag(c),
  );

  bind(
    tag
      .command("remove <path>")
      .description("Remove a tag")
      .requiredOption("--name <name>", "Tag name"),
    (c) => files.tag(c, true),
  );

  bind(
    root
      .command("trash")
      .description("Manage trash")
      .command("empty")
      .description("Permanently empty trash")
      .option("--yes", "Confirm permanent deletion"),
    files.emptyTrash,
  );

  const transfers = root.command("transfer").description("Inspect resumable local transfers");

  bind(
    transfers
      .command("list")
      .description("List local transfers")
      .option("--guest", "List guest-scope records"),
    transferList,
  );

  bind(
    transfers
      .command("retry [ids...]")
      .description("Retry explicit failed IDs or all failed jobs; paused jobs are excluded")
      .option("--all-failed", "Select all failed jobs in this profile and scope")
      .option("--guest", "Retry anonymous share jobs")
      .option(
        "--share-password-stdin",
        "Read one transient password for the selected protected shares",
      ),
    transferRetry,
  );

  bind(
    transfers
      .command("forget <id>")
      .description("Remove a finished/cancelled transfer record; preserve file bytes")
      .option("--guest", "Forget a guest-scope record"),
    transferForget,
  );

  bind(
    transfers
      .command("resume <id>")
      .description("Resume a transfer")
      .option("--guest", "Resume a guest download")
      .option("--share-password-stdin", "Read the share password again"),
    transferResume,
  );

  bind(
    transfers
      .command("cancel <id>")
      .description("Cancel a transfer")
      .option("--guest", "Cancel a guest download")
      .option("--yes", "Confirm cancellation"),
    transferCancel,
  );

  return root;
}

export function parse(argv: string[]): ParsedInvocation {
  let parsed: ParsedInvocation | undefined;
  let output = "";

  const program = createProgram(
    (value) => {
      parsed = value;
    },
    (text) => {
      output += text;
    },
  );

  try {
    program.parse(argv.length ? argv : ["--help"], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      return { command: "", args: [], flags: { help: true }, helpText: output };
    }

    if (error instanceof CommanderError) {
      throw new CliError("usage", error.message.replace(/^error: /, ""));
    }

    throw error;
  }

  if (!parsed) {
    throw new CliError("usage", "Choose a command; run cr --help");
  }

  return parsed;
}

export function help(path: string): string {
  let command: AnyCommand = createProgram();

  for (const name of path.split(" ").filter(Boolean)) {
    const child = command.commands.find((c) => c.name() === name);

    if (!child) {
      throw new CliError("usage", "Unknown command; run cr --help");
    }

    command = child;
  }

  return command.helpInformation();
}

export function commandPaths(): string[] {
  const result: string[] = [];

  const walk = (c: AnyCommand, prefix: string) => {
    for (const child of c.commands) {
      const path = (prefix + " " + child.name()).trim();

      if (child.commands.length) {
        walk(child, path);
      } else {
        result.push(path);
      }
    }
  };

  walk(createProgram(), "");

  return result;
}
