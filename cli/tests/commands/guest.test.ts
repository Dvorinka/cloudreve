import { it, expect } from "vitest";
import { CrUri } from "@cloudreve/sdk/files";
import { dispatch } from "../../src/main.js";
import { parse } from "../../src/program.js";
import { download } from "../../src/commands/transfers.js";
import { context } from "./context.js";

it("uses explicit public read ports and refuses guest mutations", async () => {
  for (const argv of [
    ["ls", "/share/id/", "--guest"],
    ["stat", "/share/id/a", "--guest"],
    ["cat", "/share/id/a", "--guest"],
    ["share", "open", "id", "--guest"],
    ["share", "list", "--owner", "user", "--guest"],
  ]) {
    const x = context(argv);

    await dispatch(x.c);
    expect(x.raw.backend).not.toHaveBeenCalled();
  }

  for (const argv of [
    ["cp", "local:/tmp/a", "/my/a", "--guest"],
    ["cp", "/share/id/a", "/my/a", "--guest"],
  ]) {
    const x = context(argv);

    await expect(dispatch(x.c)).rejects.toThrow("remote-to-local");
    expect(x.b.uploads.create).not.toHaveBeenCalled();
    expect(x.b.files.copyTo).not.toHaveBeenCalled();
  }

  expect(() => parse(["cat", "/share/id/a", "--json", "--share-password-stdin"])).toThrow();

  const link = context(["share", "open", "--link-stdin", "--guest"]);

  link.raw.io.input.mockResolvedValue(Buffer.from("https://example.test/s/id/secret"));
  await dispatch(link.c);
  expect(link.publicClient.shares.resolve).toHaveBeenCalledWith("id", "secret", link.c.signal);
});

it("rebinds share passwords only in memory and never serializes them in cursors", async () => {
  const x = context(["ls", "/share/id/", "--guest", "--json", "--limit", "1"]);

  x.raw.sharePassword = "private";

  x.b.files.list.mockResolvedValue({
    files: [x.file, { ...x.file, id: "b" }],
    pagination: { page: 0, page_size: 100, total_items: 2 },
    props: {},
  } as never);

  await dispatch(x.c);
  expect(String(x.b.files.list.mock.calls[0]?.[0])).toContain("private");

  const result = JSON.parse(x.stdout());

  expect(Buffer.from(result.pagination.cursor, "base64url").toString()).not.toContain("private");

  const stat = context(["stat", "/share/id/a", "--guest"]);

  stat.raw.sharePassword = "private";
  await dispatch(stat.c);
  expect(stat.b.files.info).toHaveBeenCalledWith("cloudreve://id:private@share/a");
});

it("retains credential-free guest checkpoints and requires credentials again after interruption", async () => {
  const x = context(["cp", "/share/id/a", "local:/tmp/out", "--guest"]);

  x.raw.sharePassword = "private";
  x.publicClient.downloads.run.mockRejectedValueOnce(Error("interrupted"));
  await expect(dispatch(x.c)).rejects.toThrow("interrupted");
  expect(JSON.stringify(x.data)).not.toContain("private");
  expect(x.raw.backend).not.toHaveBeenCalled();

  const stored = (x.data["transfers.json"] as any[])[0];

  expect(stored.checkpoint.scope).toBe("guest");
  expect(stored.needsPassword).toBe(true);
  x.c.inv = parse(["transfer", "resume", stored.id, "--guest"]);
  x.raw.sharePassword = undefined;
  await expect(dispatch(x.c)).rejects.toThrow("share-password-stdin");
  x.raw.sharePassword = "private";
  await dispatch(x.c);
  expect(JSON.stringify(x.data)).not.toContain("private");
  x.c.inv = parse(["transfer", "list", "--guest"]);
  await dispatch(x.c);
  expect(x.raw.io.write).toHaveBeenLastCalledWith(expect.stringContaining(stored.id));
  x.c.inv = parse(["transfer", "forget", stored.id]);
  await expect(dispatch(x.c)).rejects.toThrow("guest scope");
  x.c.inv = parse(["transfer", "forget", stored.id, "--guest"]);
  await dispatch(x.c);
  expect(x.data["transfers.json"]).toEqual([]);
});

it("cleans authenticated share checkpoint URIs and rejects corrupted persisted credentials", async () => {
  const x = context();

  x.raw.sharePassword = "private";

  x.b.downloads.prepare.mockResolvedValue({
    accountId: "a",
    endpoint: "https://example.test",
    uri: "cloudreve://id:private@share/a",
    entity: "v",
    name: "a",
    size: 1,
    completed: false,
  });

  await download(x.c, new CrUri("cloudreve://id:private@share/a"), "/tmp/out");
  expect(JSON.stringify(x.data)).not.toContain("private");

  const t = (x.data["transfers.json"] as any[])[0];

  t.checkpoint.uri = "cloudreve://id:private@share/a";
  x.c.inv = parse(["transfer", "list"]);
  await expect(dispatch(x.c)).rejects.toThrow("must not contain");
});
