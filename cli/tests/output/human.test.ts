import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import stringWidth from "string-width";
import {
  renderHuman,
  terminalText,
  humanBytes,
  fitText,
  humanTable,
  humanDetails,
  fileHeader,
  fileRow,
} from "../../src/output/human.js";

const file = {
  id: "f1",
  name: "旅行.txt",
  path: "cloudreve://my/旅行.txt",
  size: 1536,
  type: 0,
  created_at: "2026-09-15 08:00",
  updated_at: "2026-09-15 09:00",
  metadata: { author: "Alex" },
};

const share = {
  id: "s1",
  name: "Review",
  url: "https://files.example/s/s1",
  owner: { nickname: "Alex" },
  source_uri: file.path,
  size: 1536,
  visited: 2,
  downloaded: 1,
  remain_downloads: 9,
  password_protected: true,
  expires: "2026-10-01",
  expired: false,
};

const job = {
  id: "j1",
  type: "remote_download",
  status: "processing",
  created_at: "2026-09-15",
  summary: {
    phase: "downloading",
    props: {
      src: file.path,
      dst: "cloudreve://my/Inbox",
      download: {
        name: "Manual",
        downloaded: 1024,
        total: 4096,
        files: [{ index: 2, name: "manual.pdf", size: 4096, selected: true }],
      },
    },
  },
};

const settings = {
  version_retention_enabled: true,
  version_retention_ext: ["txt", "md"],
  version_retention_max: 10,
  share_links_in_profile: "hide_share",
};

const fixtures: Record<string, unknown> = {
  "account capacity": { total: 4096, used: 1024, storage_pack_total: 0 },
  "account configure": { updated: ["version_retention_enabled"] },
  "account grant list": [
    {
      client_id: "app1",
      client_name: "Desktop",
      scopes: ["Files.Read"],
      last_used_at: null,
    },
  ],
  "account passkey list": [
    {
      id: "p1",
      name: "Laptop",
      created_at: "2026-09-15",
      used_at: "2026-09-16",
    },
  ],
  "account password": { changed: true, signedOut: true },
  "account settings": settings,
  "account two-factor disable": { enabled: false },
  "account two-factor enable": { enabled: true },
  "account view": { id: "u1", nickname: "Alex", email: "a@example.test" },
  "archive create": job,
  "archive download": { path: "/tmp/archive.zip", bytes: 2048 },
  "archive extract": job,
  "archive list": [
    { name: "docs", is_directory: true, size: 0 },
    { ...file, is_directory: false },
  ],
  "auth login": { profile: "work", account: { id: "u1", nickname: "Alex" } },
  "auth status": {
    profile: "work",
    authenticated: true,
    endpoint: "https://files.example",
    accountId: "u1",
    authentication: "password",
  },
  cat: "literal file bytes\n",
  cp: { id: "t1", status: "completed", local: "/tmp/manual.pdf" },
  diagnostics: {
    runtime: { platform: "linux", node: "v24" },
    configuredProfiles: 1,
    profile: { name: "work", endpoint: "https://files.example" },
    online: true,
  },
  edit: file,
  "job create": [job],
  "job list": { tasks: [job], pagination: { next_token: "next" } },
  "job view": job,
  "link create": [{ file_url: "https://files.example/a", link: "https://files.example/f/a" }],
  "link list": [{ id: "d1", url: "https://files.example/f/a", downloaded: 2 }],
  ls: [file, { ...file, name: "Projects", type: 1 }],
  "metadata schema": [
    {
      id: "author",
      name: "Author",
      type: "text",
      options: ["Alex"],
      min: 1,
      max: 30,
    },
  ],
  "metadata view": { "props:author": "Alex" },
  mkdir: { ...file, type: 1 },
  mv: { uri: file.path },
  "profile add": { profile: "work" },
  "profile use": { profile: "work" },
  "profile remove": { profile: "work" },
  "profile list": {
    selected: "work",
    profiles: {
      work: { endpoint: "https://files.example", credentialStore: "file" },
      home: { endpoint: "https://home.example", credentialStore: "native" },
    },
  },
  search: {
    hits: [{ file, content: "A matching paragraph" }],
    total: 3,
    nextOffset: 1,
  },
  "server info": {
    version: "4.18.0",
    isPro: false,
    auth: { password_enabled: true },
  },
  "share create": { url: share.url },
  "share update": { url: share.url },
  "share list": { shares: [share], pagination: { next_token: "next" } },
  "share open": share,
  "share view": share,
  stat: {
    ...file,
    displayPath: "/my/旅行.txt",
    folder_summary: { files: 2, folders: 1 },
  },
  touch: file,
  "transfer cancel": { id: "t1", status: "canceled" },
  "transfer list": [
    {
      id: "t1",
      direction: "download",
      status: "failed",
      local: "/tmp/file",
      failure: "Connection lost",
    },
  ],
  "transfer resume": { id: "t1", status: "completed", local: "/tmp/file" },
  "transfer retry": {
    retried: 1,
    outcomes: [{ id: "t1", status: "completed" }],
  },
  url: { url: "https://files.example/public/download" },
  "version list": [{ id: "v1", size: 1024, created_at: "2026-09-15" }],
  watch: { type: "event", data: { action: "created", name: "notes.txt" } },
  "webdav create": {
    id: "dav1",
    name: "Work",
    uri: "cloudreve://my/",
    password: "[REDACTED]",
  },
  "webdav view": {
    id: "dav1",
    name: "Work",
    uri: "cloudreve://my/",
    password: "[REDACTED]",
    readonly: true,
  },
  "webdav update": { id: "dav1", name: "Work", uri: "cloudreve://my/" },
  "webdav list": {
    accounts: [
      {
        id: "dav1",
        name: "Work",
        uri: "cloudreve://my/",
        created_at: "2026-09-15",
      },
    ],
  },
  write: file,
};

const commands = (
  JSON.parse(readFileSync(new URL("../../scripts/ci/coverage.json", import.meta.url), "utf8")) as {
    requiredCommands: string[];
  }
).requiredCommands;

describe("human command presentation", () => {
  it.each(commands)("%s has human output without a JSON envelope", (command) => {
    const result = renderHuman(command, fixtures[command], {
      args: ["target"],
      width: 160,
    });

    expect(result.trim().length).toBeGreaterThan(0);
    expect(result).not.toContain("[object Object]");
    expect(result).not.toMatch(/^\s*[[{]/);
    expect(result).not.toContain('"schemaVersion"');
  });

  it("keeps output complete in narrow terminals and uses columns when they fit", () => {
    const id = "job-identifier-that-must-remain-copyable";

    expect(humanTable(["ID", "NAME"], [[id, "旅行"]], "Empty", { width: 15 })).toContain(id);

    const table = humanTable(
      ["NAME", "SIZE"],
      [
        ["旅行", "2 B"],
        ["a", "4 B"],
      ],
      "Empty",
    ).split("\n");

    expect(stringWidth(table[1]!.split("2 B")[0]!)).toBe(stringWidth(table[2]!.split("4 B")[0]!));
  });

  it("shows filename metadata and honors font-safe color policy", () => {
    expect(fileRow(file)).toContain("1.5 KiB");
    expect(fileRow({ ...file, type: 1 }, { color: true })).toContain("\x1b[34m旅行.txt/\x1b[0m");
    expect(fileHeader({ width: 40 })).not.toContain("MODIFIED");
    expect(fileRow(file, { width: 40 })).toContain("Modified: 2026-");
    expect(fileHeader({ color: true })).toContain("\x1b[1m");
    expect(fileRow({ name: "empty", type: 0, size: 0 })).toContain("0 B");
  });

  it("escapes controls and bidi spoofing without breaking graphemes", () => {
    expect(terminalText("a\n\r\t\x1b[31m\x00\x85\u202e\u2028")).toBe(
      "a\\n\\r\\t\\u001b[31m\\u0000\\u0085\\u202e\\u2028",
    );

    expect(terminalText("👩‍💻")).toBe("👩‍💻");
    expect(fitText("旅行abc", 4)).toBe("旅…");
    expect(fitText("e\u0301abcd", 3)).toBe("e\u0301a…");
    expect(fitText("hello", 0)).toBe("");
    expect(fitText("a", 2)).toBe("a");
    expect(terminalText(null)).toBe("—");
  });

  it("formats bytes with defined units and rejects invalid values", () => {
    for (const value of [undefined, -1, NaN, Infinity]) {
      expect(humanBytes(value)).toBe("—");
    }

    expect(humanBytes(1024)).toBe("1.0 KiB");
    expect(humanBytes(1024 ** 8)).toContain("EiB");
  });

  it("renders empty data and optional fields without inventing facts", () => {
    for (const command of [
      "ls",
      "archive list",
      "metadata view",
      "metadata schema",
      "version list",
      "share list",
      "link list",
      "link create",
      "webdav list",
      "job list",
      "job create",
      "transfer list",
      "account passkey list",
      "account grant list",
      "profile list",
    ]) {
      expect(renderHuman(command, {})).toMatch(/No |empty/);
    }

    expect(renderHuman("search", { hits: [], total: 0, nextOffset: null })).toContain(
      "No matches.",
    );

    expect(renderHuman("transfer retry", { retried: 0, outcomes: [] })).toContain(
      "No failed transfers",
    );

    expect(
      renderHuman("job view", {
        summary: { props: { download: { files: [] } } },
      }),
    ).toContain("No download files.");

    expect(renderHuman("job view", {})).toContain("Job");
    expect(renderHuman("unknown", undefined)).toBe("");
    expect(renderHuman("cat", undefined)).toBe("");
    expect(renderHuman("edit", { changed: false })).toBe("No changes saved.\n");
    expect(renderHuman("auth status", {})).toContain("Signed out");
    expect(renderHuman("diagnostics", {})).toContain("Not checked");
    expect(renderHuman("server info", { isPro: true })).toContain("Pro");
  });

  it("renders mutation receipts, privacy options and warnings", () => {
    expect(renderHuman("rm", null)).toBe("Removed.\n");
    expect(renderHuman("rm", null, { args: ["evil\x1b"] })).toContain("evil\\u001b");

    expect(
      renderHuman("account password", {
        warnings: ["Revocation failed\nretry"],
      }),
    ).toContain("Warning: Revocation failed\\nretry");

    expect(
      renderHuman("account settings", {
        ...settings,
        share_links_in_profile: "all_share",
      }),
    ).toContain("All shares");

    expect(
      renderHuman("account settings", {
        ...settings,
        share_links_in_profile: "",
      }),
    ).toContain("Public shares");

    expect(renderHuman("account configure", {})).toContain("Preferences saved");

    expect(
      renderHuman("share list", {
        shares: [
          { ...share, expired: true },
          { ...share, password_protected: false },
        ],
      }),
    ).toContain("Expired");

    expect(
      renderHuman("share list", {
        shares: [{ ...share, password_protected: false }],
      }),
    ).toContain("Public");
  });

  it("sanitizes dynamic labels and headings and rejects non-emoji joiners", () => {
    for (const text of [
      humanDetails("bad\x1b", [["key\x1b", "value"]]),
      humanTable(["head\x1b"], [["value"]], "empty"),
      renderHuman("unknown", { nested: { ["key\x1b"]: "value" } }),
    ]) {
      expect(text).not.toContain("\x1b");
      expect(text).toContain("\\u001b");
    }

    expect(terminalText("ab\u200dcd")).toBe("ab\\u200dcd");
    expect(terminalText("👩🏽‍💻")).toBe("👩🏽‍💻");
    expect(humanTable([], [], "bad\n")).toBe("bad\\n\n");
  });

  it("keeps streaming columns stable and renders honest missing-result states", () => {
    const lines = [fileRow(file), fileRow({ ...file, updated_at: "" })];

    expect(lines[0]!.indexOf("旅行.txt")).toBe(lines[1]!.indexOf("旅行.txt"));
    expect(renderHuman("stat", null)).toContain("no file details");
    expect(renderHuman("cp", null)).toContain("no transfer details");
    expect(renderHuman("stat", { name: "unknown" })).toContain("Unknown");
    expect(fileRow({ name: "unknown" })).toMatch(/^—/);

    expect(
      renderHuman("mv", {
        uri: "cloudreve://my/destination",
        operation: "rename",
      }),
    ).toContain("rename");

    expect(
      renderHuman("mv", {
        uri: "cloudreve://my/destination",
        operation: "rename",
      }),
    ).toContain("/my/destination");

    expect(
      renderHuman("archive download", {
        local: "/tmp/a.zip",
        bytes: 20,
        sha256: "abcdef",
      }),
    ).toContain("abcdef");
  });

  it("renders compact wide rows with one explicit timezone heading", () => {
    const timezone = "America/Argentina/Buenos_Aires";
    const options = { width: 80, timezone };
    const timestamp = `2026-09-15 12:34:56 GMT-3 [${timezone}]`;

    expect(fileHeader(options)).toContain(`Modified times: ${timezone}`);

    const full = fileRow({ ...file, updated_at: timestamp }, options);
    const missing = fileRow({ ...file, updated_at: "" }, options);

    expect(full.trimEnd().split("\n")).toHaveLength(1);
    expect(full).toContain("2026-09-15 12:34");
    expect(full.indexOf("旅行.txt")).toBe(missing.indexOf("旅行.txt"));
    expect(fileRow({ ...file, updated_at: "unknown" }, options)).toContain("Modified: unknown");

    expect(fileRow({ ...file, updated_at: "2026-09-15T12:34:56Z" }, { timezone: "UTC" })).toContain(
      "2026-09-15 12:34",
    );
  });

  it("keeps profile, archive, and share displays focused on available facts", () => {
    expect(renderHuman("profile list", fixtures["profile list"])).not.toContain("CREDENTIALS");

    const archive = renderHuman("archive list", fixtures["archive list"]);

    expect(archive).not.toContain("MODIFIED");
    expect(archive).toContain("docs/");
    expect(renderHuman("share open", { ...share, unlocked: false })).toContain("Locked");
    expect(renderHuman("share open", { ...share, unlocked: true })).toContain("Unlocked");
  });

  it("uses a small semantic palette only when requested, preserving plain output", () => {
    const color = { color: true };

    expect(renderHuman("error", { message: "Failure" }, color)).toContain("\x1b[1;31mError");
    expect(renderHuman("rm", null, color)).toContain("\x1b[32mRemoved.");

    expect(renderHuman("auth login", fixtures["auth login"], color)).toContain(
      "\x1b[1;32mSigned in",
    );

    const statuses = humanTable(
      ["STATUS"],
      [["completed"], ["failed"], ["processing"]],
      "empty",
      color,
    );

    expect(statuses).toContain("\x1b[32mcompleted");
    expect(statuses).toContain("\x1b[31mfailed");
    expect(statuses).toContain("\x1b[33mprocessing");

    for (const command of ["ls", "stat", "share list", "profile list", "job list", "error", "rm"]) {
      const output = renderHuman(command, fixtures[command], color);

      expect(output.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "")).toBe(
        renderHuman(command, fixtures[command]),
      );
    }

    expect(humanDetails("Share", [["Access", "Locked"]], color)).toContain("\x1b[33mLocked");
  });

  it("preserves error recovery context and explicit timestamp zones", () => {
    const zone = "2026-07-01 08:00:00 GMT-4 [America/New_York]";

    expect(fileRow({ ...file, updated_at: zone })).toContain(zone);

    const output = renderHuman("error", {
      message: "Retry sign-in",
      kind: "authentication",
      correlationId: "req1",
      outcomes: [{ id: "t1", status: "completed" }],
      locks: [{ token: "[REDACTED]" }],
    });

    expect(output).toContain("Retry sign-in");
    expect(output).toContain("req1");
    expect(output).toContain("t1");
  });

  it("renders namespace discovery, complete URLs and labelled nested diagnostic values", () => {
    expect(renderHuman("ls", [{ path: "/my/", context: "personal" }])).toContain("CONTENTS");

    const url = `https://files.example/${"a".repeat(200)}`;

    expect(renderHuman("url", { url }, { width: 20 })).toBe(`${url}\n`);
    expect(renderHuman("unknown", "a\n")).toBe("a\\n\n");

    expect(
      renderHuman("unknown", {
        nested: { value: true },
        list: [],
        empty: "",
        none: {},
      }),
    ).toContain("Value: Yes");

    expect(
      humanDetails("Record", [
        ["Flags", [false]],
        ["Missing", undefined],
      ]),
    ).toContain("No");
  });
});

it("aligns streaming names for bytes and three-digit binary units", () => {
  const options = { width: 120, timezone: "UTC" };

  const rows = [32, 131089, 1024 ** 3 * 999].map((size) =>
    fileRow({ ...file, size, name: "same.txt" }, options),
  );

  expect(new Set(rows.map((row) => row.indexOf("same.txt"))).size).toBe(1);
  expect(fileHeader(options).split("\n")[1]!.indexOf("NAME")).toBe(rows[0]!.indexOf("same.txt"));
});
