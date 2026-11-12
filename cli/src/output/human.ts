import stringWidth from "string-width";
import { displayPath } from "../paths.js";

export interface HumanOptions {
  width?: number;
  color?: boolean;
  args?: string[];
  timezone?: string;
}

type Row = Record<string, unknown>;

const object = (value: unknown): Row =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};

const list = (value: unknown): Row[] => (Array.isArray(value) ? value.map(object) : []);

/** Render hostile filenames as text, never terminal commands or invisible direction changes. */
export function terminalText(value: unknown): string {
  return [...segments.segment(String(value ?? "—"))]
    .map(({ segment }) => {
      const emoji =
        /^(?:\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*)(?:\u200d\p{Extended_Pictographic}[\uFE0F\p{Emoji_Modifier}]*)+$/u.test(
          segment,
        );

      return segment.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (character) => {
        if (character === "\n") {
          return "\\n";
        }

        if (character === "\r") {
          return "\\r";
        }

        if (character === "\t") {
          return "\\t";
        }

        if (character === "\u200d" && emoji) {
          return character;
        }

        return `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`;
      });
    })
    .join("");
}

export function humanBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)) - 1, units.length - 1);

  return `${(value / 1024 ** (index + 1)).toFixed(1)} ${units[index]}`;
}

const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function fitText(value: unknown, width: number): string {
  const text = terminalText(value);

  if (stringWidth(text) <= width) {
    return text;
  }

  let result = "";

  for (const { segment } of segments.segment(text)) {
    if (stringWidth(result + segment) > Math.max(0, width - 1)) {
      break;
    }

    result += segment;
  }

  return width > 0 ? result + "…" : "";
}

const label = (key: string) =>
  terminalText(key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());

function scalar(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (Array.isArray(value)) {
    return value.length ? value.map(scalar).join(", ") : "None";
  }

  if (value && typeof value === "object") {
    return (
      Object.entries(value)
        .map(([key, item]) => `${label(key)}: ${scalar(item)}`)
        .join("; ") || "None"
    );
  }

  return terminalText(value === "" ? "—" : value);
}

function paint(text: string, code: string, options: HumanOptions): string {
  return options.color ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function statusText(header: string, text: string, options: HumanOptions): string {
  if (!/^(status|access)$/i.test(header)) {
    return text;
  }

  const code = /^(completed|public|unlocked)$/i.test(text)
    ? "32"
    : /^(failed|error|expired|canceled)$/i.test(text)
      ? "31"
      : "33";

  return paint(text, code, options);
}

function heading(value: string, options: HumanOptions): string {
  const text = terminalText(value);

  return paint(
    text,
    value === "Error"
      ? "1;31"
      : /^(Signed in|Saved|.* (created|updated|ready|saved)|Moved|Transfer complete)$/.test(value)
        ? "1;32"
        : "1",
    options,
  );
}

export function humanDetails(
  title: string,
  entries: [string, unknown][],
  options: HumanOptions = {},
): string {
  const present = entries
    .filter(([, value]) => value !== undefined)
    .map(([key, value]): [string, unknown] => [terminalText(key), value]);

  const width = Math.max(0, ...present.map(([key]) => stringWidth(key)));

  return `${heading(title, options)}\n${present.map(([key, value]) => `  ${key}${" ".repeat(width - stringWidth(key))}  ${statusText(key, scalar(value), options)}`).join("\n")}\n`;
}

export function humanTable(
  headers: string[],
  rows: unknown[][],
  empty: string,
  options: HumanOptions = {},
): string {
  headers = headers.map(terminalText);

  if (!rows.length) {
    return `${terminalText(empty)}\n`;
  }

  const cells = rows.map((row) => headers.map((_, i) => scalar(row[i])));

  const widths = headers.map((header, i) =>
    Math.max(stringWidth(header), ...cells.map((row) => stringWidth(row[i]!))),
  );

  const available = options.width ?? 100;

  // Preserve identifiers and URLs: narrow terminals use labelled records instead of silently clipping values.
  if (widths.reduce((sum, value) => sum + value, 0) + (headers.length - 1) * 2 > available) {
    return cells
      .map((row) =>
        humanDetails(
          "",
          headers.map((key, i) => [key, row[i]]),
          options,
        ).trimStart(),
      )
      .join("\n");
  }

  const line = (row: string[], styled = false) =>
    row
      .map(
        (cell, i) =>
          (styled ? statusText(headers[i]!, cell, options) : cell) +
          " ".repeat(widths[i]! - stringWidth(cell)),
      )
      .join("  ")
      .trimEnd();

  return `${heading(line(headers), options)}\n${cells.map((row) => line(row, true)).join("\n")}\n`;
}

/** Fixed streaming columns avoid buffering large directories. */
export function fileHeader(options: HumanOptions = {}): string {
  if ((options.width ?? 100) < 58) {
    return heading("TYPE        SIZE  NAME", options) + "\n";
  }

  return `Modified times: ${terminalText(options.timezone ?? "UTC")}\n${heading("TYPE        SIZE  MODIFIED          NAME", options)}\n`;
}

export function fileRow(value: unknown, options: HumanOptions = {}): string {
  const file = object(value);
  const folder = file.type === 1 || file.is_directory === true;
  const name = terminalText(file.name) + (folder ? "/" : "");
  const size = folder ? "—" : humanBytes(file.size);
  const type = folder ? "dir " : file.type === 0 || file.is_directory === false ? "file" : "—   ";
  const timestamp = typeof file.updated_at === "string" ? file.updated_at : "";
  const compact = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.exec(timestamp)?.[0].replace("T", " ");
  const narrow = (options.width ?? 100) < 58;
  const date = narrow ? "" : `${(compact ?? "—").padEnd(16)}  `;

  // Outside the CLI pipeline an unknown timezone/date must remain visible, never silently relabelled UTC.
  const detail =
    timestamp && (narrow || !compact || (!options.timezone && timestamp.includes("[")))
      ? `                Modified: ${terminalText(timestamp)}\n`
      : "";

  return `${type}  ${paint(size.padStart(10), "2", options)}  ${paint(date, "2", options)}${folder && options.color ? `\u001b[34m${name}\u001b[0m` : name}\n${detail ? paint(detail, "2", options) : ""}`;
}

const values = (row: Row, keys: string[]): unknown[] => keys.map((key) => row[key]);

const path = (value: unknown) =>
  typeof value === "string" ? (displayPath(value) ?? value) : value;

const properties = (row: Row, keys: string[]): [string, unknown][] =>
  keys.map((key) => [label(key), key === "uri" || key === "path" ? path(row[key]) : row[key]]);

const success: Record<string, string> = {
  "auth logout": "Signed out.",
  "profile add": "Profile added.",
  "profile use": "Profile selected.",
  "auth switch": "Active account switched.",
  "profile remove": "Profile removed.",
  rm: "Removed.",
  restore: "Restored.",
  "trash empty": "Trash emptied.",
  unlock: "Lock released.",
  "metadata set": "Metadata saved.",
  "metadata remove": "Metadata removed.",
  "tag add": "Tag added.",
  "tag remove": "Tag removed.",
  "tag rename": "Tag renamed.",
  "version delete": "Version deleted.",
  "version promote": "Version promoted.",
  "share revoke": "Share access revoked.",
  "link revoke": "Direct link revoked.",
  "webdav revoke": "WebDAV account revoked.",
  "job cancel": "Cancellation requested.",
  "job select": "Download selection saved.",
  "account passkey delete": "Passkey deleted.",
  "account grant revoke": "Application access revoked.",
  "transfer forget": "Transfer record forgotten.",
};

/** Command presentation is independent of backend envelopes and machine-readable output. */
export function renderHuman(command: string, data: unknown, options: HumanOptions = {}): string {
  const row = object(data);

  const table = (headers: string[], rows: unknown[][], empty: string) =>
    humanTable(headers, rows, empty, options);

  const details = (title: string, entries: [string, unknown][]) =>
    humanDetails(title, entries, options);

  if (success[command]) {
    return `${paint(success[command]!, "32", options)}${row.profile ? ` ${terminalText(row.profile)}` : options.args?.length ? ` ${options.args.map(terminalText).join(" · ")}` : ""}\n`;
  }

  switch (command) {
    case "error":
      return details("Error", [
        ["Message", row.message],
        ["Kind", row.kind],
        ["Request ID", row.correlationId],
        ["Phase", row.phase],
        ["Results", row.outcomes],
        ["Locks", row.locks],
      ]);
    case "ls": {
      const rows = list(data);

      if (rows.some((item) => item.context !== undefined)) {
        return table(
          ["PATH", "CONTENTS"],
          rows.map((item) => values(item, ["path", "context"])),
          "No namespaces.",
        );
      }

      return rows.length
        ? fileHeader(options) + rows.map((item) => fileRow(item, options)).join("")
        : "Directory is empty.\n";
    }

    case "cat":
      return typeof data === "string" ? data : "";
    case "url":
      return `${scalar(row.url)}\n`;
    case "share create":
    case "share update":
      return details(command === "share create" ? "Share created" : "Share updated", [
        ["URL", row.url],
      ]);
    case "profile list":
      return table(
        ["ACTIVE", "PROFILE", "SERVER"],
        Object.entries(object(row.profiles)).map(([name, value]) => [
          name === row.selected ? "*" : "",
          name,
          object(value).endpoint,
        ]),
        "No profiles. Add one with cr profile add.",
      );
    case "auth status":
      return (
        details(
          row.authenticated ? "Signed in" : "Signed out",
          properties(row, ["profile", "endpoint", "accountId", "authentication"]),
        ) +
        (Array.isArray(row.accounts)
          ? table(
              ["ACTIVE", "ACCOUNT", "SERVER", "USER", "SESSION"],
              list(row.accounts).map((account) => [
                account.active ? "*" : "",
                account.name,
                account.endpoint,
                account.email ?? account.accountId,
                account.authenticated ? "Signed in" : "Signed out",
              ]),
              "No saved accounts. Sign in with cr auth login --name NAME --server URL.",
            )
          : "")
      );
    case "auth login":
      return details("Signed in", [
        ["Profile", row.profile],
        ...properties(object(row.account), ["nickname", "email", "id"]),
      ]);
    case "server info":
      return details("Cloudreve server", [
        ["Version", row.version],
        ["Edition", row.isPro ? "Pro" : "Community"],
        ...Object.entries(object(row.auth)).map(([key, value]): [string, unknown] => [
          label(key),
          value,
        ]),
      ]);
    case "diagnostics":
      return details("Diagnostics", [
        ["Runtime", row.runtime],
        ["Profiles", row.configuredProfiles],
        ["Connection", row.online ? "Verified online" : "Not checked"],
        ...properties(object(row.profile), ["name", "endpoint", "accountId", "authentication"]),
      ]);
    case "account view":
      return details("Account", properties(row, ["nickname", "email", "id"]));
    case "account capacity":
      return details("Storage", [
        ["Used", humanBytes(row.used)],
        ["Total", humanBytes(row.total)],
        ["Additional storage", humanBytes(row.storage_pack_total)],
      ]);
    case "account settings":
      return details("Account preferences", [
        ["Keep versions", row.version_retention_enabled],
        ["Extensions", row.version_retention_ext],
        ["Version limit", row.version_retention_max],
        [
          "Profile shares",
          row.share_links_in_profile === "hide_share"
            ? "Hidden"
            : row.share_links_in_profile === "all_share"
              ? "All shares"
              : "Public shares",
        ],
      ]);
    case "account configure":
      return details("Preferences saved", [
        [
          "Updated",
          Array.isArray(row.updated) ? row.updated.map((key) => label(String(key))) : row.updated,
        ],
      ]);
    case "account password":
      return `Password changed. Local credentials cleared.\n${Array.isArray(row.warnings) ? row.warnings.map((warning) => `Warning: ${terminalText(warning)}\n`).join("") : ""}`;
    case "account two-factor enable":
    case "account two-factor disable":
      return `Two-factor authentication ${row.enabled ? "enabled" : "disabled"}.\n`;
    case "account passkey list":
      return table(
        ["ID", "NAME", "CREATED", "LAST USED"],
        list(data).map((item) => values(item, ["id", "name", "created_at", "used_at"])),
        "No passkeys.",
      );
    case "account grant list":
      return table(
        ["APPLICATION", "CLIENT ID", "PERMISSIONS", "LAST USED"],
        list(data).map((item) =>
          values(item, ["client_name", "client_id", "scopes", "last_used_at"]),
        ),
        "No connected applications.",
      );
    case "stat":
    case "mkdir":
    case "touch":
    case "write":
    case "edit":
      if (row.changed === false) {
        return "No changes saved.\n";
      }

      if (!row.name) {
        return "Operation completed; no file details returned.\n";
      }

      return details(
        {
          stat: "File details",
          mkdir: "Directory ready",
          touch: "File ready",
          write: "Saved",
          edit: "Saved",
        }[command]!,
        [
          ["Name", row.name],
          ["Path", row.displayPath ?? path(row.path)],
          ["Browser", row.browser],
          ["Type", row.type === 1 ? "Directory" : row.type === 0 ? "File" : "Unknown"],
          ["Size", humanBytes(row.size)],
          ...properties(row, ["id", "created_at", "updated_at"]),
          ["Contents", row.folder_summary],
          ["Metadata", row.metadata],
        ],
      );
    case "cp":
    case "mv":
    case "archive download":
    case "transfer resume":
      if (!Object.keys(row).length) {
        return "Operation completed; no transfer details returned.\n";
      }

      return details(
        command === "mv" ? "Moved" : "Transfer complete",
        properties(row, [
          "id",
          "status",
          "direction",
          "operation",
          "local",
          "path",
          "bytes",
          "uri",
          "files",
          "directories",
          "sha256",
        ]),
      );
    case "transfer cancel":
      return details("Transfer canceled", properties(row, ["id", "status"]));
    case "transfer list":
      return table(
        ["ID", "DIRECTION", "STATUS", "LOCAL FILE", "FAILURE"],
        list(data).map((item) => values(item, ["id", "direction", "status", "local", "failure"])),
        "No transfers.",
      );
    case "transfer retry":
      return (
        details("Transfers retried", [["Count", row.retried]]) +
        table(
          ["ID", "STATUS"],
          list(row.outcomes).map((item) => values(item, ["id", "status"])),
          "No failed transfers to retry.",
        )
      );
    case "metadata view":
      return table(["PROPERTY", "VALUE"], Object.entries(row), "No metadata.");
    case "metadata schema":
      return table(
        ["KEY", "NAME", "TYPE", "OPTIONS", "MIN", "MAX"],
        list(data).map((item) => [
          `props:${scalar(item.id)}`,
          ...values(item, ["name", "type", "options", "min", "max"]),
        ]),
        "No custom properties configured.",
      );
    case "version list":
      return table(
        ["VERSION", "SIZE", "CREATED"],
        list(data).map((item) => [item.id, humanBytes(item.size), item.created_at]),
        "No previous versions.",
      );
    case "archive list":
      return table(
        ["TYPE", "SIZE", "NAME"],
        list(data).map((item) => [
          item.is_directory ? "dir" : "file",
          item.is_directory ? "—" : humanBytes(item.size),
          `${terminalText(item.name)}${item.is_directory ? "/" : ""}`,
        ]),
        "Archive is empty.",
      );
    case "search":
      return (
        table(
          ["NAME", "PATH", "MATCH"],
          list(row.hits).map((hit) => [
            object(hit.file).name,
            path(object(hit.file).path),
            hit.content,
          ]),
          "No matches.",
        ) +
        details("Search", [
          ["Total matches", row.total],
          ["Next offset", row.nextOffset ?? undefined],
        ])
      );
    case "share list":
      return (
        table(
          ["ID", "NAME", "ACCESS", "DOWNLOADS", "EXPIRES"],
          list(row.shares).map((item) => [
            item.id,
            item.name,
            item.expired ? "Expired" : item.password_protected ? "Password" : "Public",
            item.downloaded,
            item.expires,
          ]),
          "No shares.",
        ) + pagination(row)
      );
    case "share view":
    case "share open":
      return details(row.unlocked === false ? "Share locked" : "Share", [
        ...properties(row, ["id", "name", "url"]),
        [
          "Access",
          row.unlocked === false ? "Locked" : row.unlocked === true ? "Unlocked" : undefined,
        ],
        ["Owner", object(row.owner).nickname],
        ["Source", path(row.source_uri)],
        ["Size", humanBytes(row.size)],
        ...properties(row, [
          "password_protected",
          "expired",
          "expires",
          "visited",
          "downloaded",
          "remain_downloads",
        ]),
      ]);
    case "link list":
      return table(
        ["ID", "URL", "DOWNLOADS"],
        list(data).map((item) => values(item, ["id", "url", "downloaded"])),
        "No direct links.",
      );
    case "link create":
      return table(
        ["FILE URL", "DIRECT LINK"],
        list(data).map((item) => values(item, ["file_url", "link"])),
        "No direct links created.",
      );
    case "webdav list":
      return (
        table(
          ["ID", "NAME", "PATH", "CREATED"],
          list(row.accounts).map((item) => [item.id, item.name, path(item.uri), item.created_at]),
          "No WebDAV accounts.",
        ) + pagination(row)
      );
    case "webdav create":
    case "webdav update":
    case "webdav view":
      return details("WebDAV account", [
        ...properties(row, ["id", "name"]),
        ["Path", path(row.uri)],
        ...properties(row, ["password", "readonly", "proxy", "disable_sys_files", "created_at"]),
      ]);
    case "job list":
    case "job create":
      return (
        table(
          ["ID", "TYPE", "STATUS", "CREATED"],
          list(command === "job list" ? row.tasks : data).map((item) =>
            values(item, ["id", "type", "status", "created_at"]),
          ),
          "No jobs.",
        ) + pagination(row)
      );
    case "job view":
    case "archive create":
    case "archive extract": {
      const summary = object(row.summary);
      const props = object(summary.props);
      const download = object(props.download);

      return (
        details("Job", [
          ...properties(row, ["id", "type", "status", "created_at", "updated_at", "error"]),
          ["Phase", summary.phase],
          ["Source", path(props.src)],
          ["Destination", path(props.dst)],
          ["Download", download.name],
          [
            "Downloaded",
            download.downloaded === undefined ? undefined : humanBytes(download.downloaded),
          ],
          ["Total", download.total === undefined ? undefined : humanBytes(download.total)],
        ]) +
        (Array.isArray(download.files)
          ? table(
              ["INDEX", "NAME", "SIZE", "SELECTED"],
              list(download.files).map((item) => [
                item.index,
                item.name,
                humanBytes(item.size),
                item.selected,
              ]),
              "No download files.",
            )
          : "")
      );
    }

    case "watch":
      return details("File event", [
        ["Event", row.type],
        ...Object.entries(object(row.data)).map(([key, value]): [string, unknown] => [
          label(key),
          value,
        ]),
      ]);
    default:
      return data === undefined
        ? ""
        : typeof data === "string"
          ? `${terminalText(data)}\n`
          : details(
              "Result",
              Object.entries(row).map(([key, value]) => [label(key), value]),
            );
  }
}

function pagination(row: Row): string {
  const cursor = object(row.pagination).next_token;

  return cursor ? `More results: --cursor ${terminalText(cursor)}\n` : "";
}
