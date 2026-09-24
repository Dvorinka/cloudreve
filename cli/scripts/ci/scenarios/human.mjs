import assert from "node:assert/strict";
import { files } from "./files.mjs";
import { account } from "./account.mjs";
import { operations } from "./operations.mjs";
import { accounts } from "./accounts.mjs";

// Repeat only read operations for structured assertions. Every mutation executes once,
// through the installed CLI in human mode; created IDs come from independent reads.
const reads = new Set([
  "server info",
  "diagnostics",
  "profile list",
  "auth status",
  "account view",
  "account capacity",
  "account settings",
  "account grant list",
  "account passkey list",
  "ls",
  "stat",
  "search",
  "metadata schema",
  "metadata view",
  "version list",
  "share list",
  "share view",
  "share open",
  "link list",
  "webdav list",
  "webdav view",
  "archive list",
  "job list",
  "job view",
  "transfer list",
]);

export function humanRunner(c) {
  const read = async (path, args = [], options = {}) =>
    (await c.run(path, args, { ...options, json: true, capture: false })).data;

  const taskList = async () => {
    const pages = await Promise.all(
      ["general", "downloading", "downloaded"].map((category) =>
        read("job list", ["--category", category]),
      ),
    );

    return pages.flatMap((page) => page.tasks);
  };

  return async (path, args = [], options = {}) => {
    // Existing negative assertions inspect structured errors; these are not gallery samples.
    if (options.expect && options.expect !== 0) {
      return c.run(path, args, options);
    }

    let before;

    if (path === "share create") {
      before = (await read("share list")).shares;
    }

    if (path === "webdav create") {
      before = (await read("webdav list")).accounts;
    }

    if (["job create", "archive create", "archive extract"].includes(path)) {
      before = await taskList();
    }

    const result = await c.run(path, args, { ...options, json: false });

    if (path !== "cat") {
      assert(result.stdout.length || result.stderr.length, `${path} must explain its result`);

      assert(
        !/^\s*[[{]/.test(result.stdout.toString()),
        `${path} leaked a raw JSON envelope into human output`,
      );
    }

    if (reads.has(path)) {
      result.data = await read(path, args, options);
    } else if (path === "auth login") {
      const named = args.indexOf("--name");

      const status = await read(
        "auth status",
        [],
        named < 0 ? options : { ...options, profile: args[named + 1] },
      );

      result.data = { account: { id: status.accountId } };
    } else if (path === "url") {
      const urls = result.stdout.toString().match(/https?:\/\/[^\s]+/g);

      assert.equal(urls?.length, 1, "Human URL output must expose one usable URL");
      result.data = { url: urls[0] };
    } else if (path === "share create") {
      const created = (await read("share list")).shares.filter(
        (item) => !before.some((old) => old.id === item.id),
      );

      assert.equal(created.length, 1);
      result.data = await read("share view", [created[0].id]);
    } else if (path === "webdav create") {
      const created = (await read("webdav list")).accounts.filter(
        (item) => !before.some((old) => old.id === item.id),
      );

      assert.equal(created.length, 1);
      result.data = created[0];
    } else if (path === "link create") {
      result.data = (await read("link list", [args[0]])).map((item) => ({
        link: item.url,
      }));
    } else if (before) {
      const expectedType = {
        "job create": "remote_download",
        "archive create": "create_archive",
        "archive extract": "extract_archive",
      }[path];

      let created = [];

      for (let attempt = 0; attempt < 40 && created.length === 0; attempt++) {
        created = (await taskList()).filter(
          (item) => item.type === expectedType && !before.some((old) => old.id === item.id),
        );

        if (!created.length) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }

      const unique = [...new Map(created.map((item) => [item.id, item])).values()];

      assert.equal(unique.length, 1, "CLI mutation must create exactly one owned job");
      result.data = path === "job create" ? unique : unique[0];
    }

    return result;
  };
}

/** Same behavioral oracles, fresh fixture, public human-mode executable. */
export async function human(c) {
  const context = { ...c, human: true, run: humanRunner(c) };

  await context.run("diagnostics", ["--online"]);
  await files(context);

  for (const [name, content] of [
    ["README.md", "# Team workspace\nProject notes and shared documents.\n"],
    ["budget.csv", "category,amount\nStorage,120\nHosting,45\n"],
    ["release-notes.txt", "Community release checklist\n"],
    ["设计说明.md", "# 设计说明\n共享文件说明。\n"],
  ]) {
    const file = await c.sdk.files.create(c.uri("files"), name, "file");

    await c.sdk.files.saveText(await c.sdk.files.readText(file.path, fetch), content);
  }

  await context.run("ls", [c.path("files")]);
  await account(context);
  await operations(context);
  await accounts(context);

  for (const [path, args] of [
    ["ls", [c.path("files")]],
    ["stat", [c.path("files/README.md")]],
    ["account capacity", []],
    ["profile list", []],
    ["job list", []],
  ]) {
    const result = await c.run(path, args, {
      json: false,
      tty: true,
      columns: 120,
      variant: "terminal",
    });

    assert(
      result.stdout.includes(String.fromCharCode(27) + "["),
      "TTY sample must contain actual renderer ANSI styling",
    );
  }

  const plain = await c.run("ls", [c.path("files")], {
    json: false,
    tty: true,
    noColor: true,
    columns: 120,
    variant: "terminal-no-color",
  });

  assert(
    !plain.stdout.includes(String.fromCharCode(27)),
    "NO_COLOR disables styling on a real terminal",
  );

  const successful = new Set(
    c.transcripts.filter((item) => item.status === 0).map((item) => item.path),
  );

  assert.deepEqual(
    c.requiredCommands.filter((path) => !successful.has(path)),
    [],
    "Every retained command must have a successful actual human transcript",
  );
}
