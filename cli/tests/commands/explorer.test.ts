import { expect, it } from "vitest";
import { dispatch } from "../../src/main.js";
import { context } from "./context.js";

it("routes file controls to SDK and scopes destructive mutations", async () => {
  const cases: [string[], string, string][] = [
    [["version", "promote", "/my/a", "v"], "files", "promoteVersion"],
    [["version", "delete", "/my/a", "v", "--yes"], "files", "deleteVersion"],
    [["url", "/my/", "--archive"], "files", "archiveUrl"],
    [
      ["share", "list", "--owner", "user", "--page-size", "5", "--cursor", "c"],
      "shares",
      "publicList",
    ],
    [["share", "revoke", "a", "b", "--yes"], "shares", "revokeMany"],
  ];

  for (const [args, group, method] of cases) {
    const x = context(args);

    await dispatch(x.c);
    expect((x.b as any)[group][method]).toHaveBeenCalled();
  }

  const remove = context(["version", "delete", "/my/a", "v"]);

  remove.raw.confirm.mockRejectedValue(new Error("declined"));
  await expect(dispatch(remove.c)).rejects.toThrow("declined");
  expect(remove.b.files.deleteVersion).not.toHaveBeenCalled();
});

it("reports explicit search continuation and accepts only unambiguous remote task sources", async () => {
  const x = context(["search", "phrase", "--offset", "2", "--json"]);

  x.b.files.fullTextSearch.mockResolvedValue({
    hits: [{ file: { name: "a" }, content: "hit" }],
    total: 4,
  } as never);

  await dispatch(x.c);
  expect(JSON.parse(x.stdout()).data.nextOffset).toBe(3);

  const done = context(["search", "phrase", "--json"]);

  await dispatch(done.c);
  expect(JSON.parse(done.stdout()).data.nextOffset).toBeNull();

  done.b.files.fullTextSearch.mockResolvedValue({
    hits: [{}],
    total: 1,
  } as never);

  await dispatch(done.c);

  const invalid = context(["job", "create", "/my/"]);

  await expect(dispatch(invalid.c)).rejects.toThrow("Choose");
  expect(invalid.b.jobs.createDownload).not.toHaveBeenCalled();

  const urls = context(["job", "create", "/my/", "--sources-stdin"]);

  urls.raw.io.input.mockResolvedValue(Buffer.from('["https://source.test/file?key=private"]'));
  await dispatch(urls.c);

  expect(urls.b.jobs.createDownload).toHaveBeenCalledWith(
    {
      src: ["https://source.test/file?key=private"],
      src_file: undefined,
      dst: "cloudreve://my/",
    },
    urls.c.signal,
  );

  const torrent = context(["job", "create", "/my/", "--torrent", "/my/a.torrent"]);

  await dispatch(torrent.c);

  expect(torrent.b.jobs.createDownload).toHaveBeenCalledWith(
    {
      src: undefined,
      src_file: "cloudreve://my/a.torrent",
      dst: "cloudreve://my/",
    },
    torrent.c.signal,
  );
});

it("streams bounded watch records with caller-owned reconnect identity and closes the SDK iterator", async () => {
  const x = context([
    "watch",
    "/my/",
    "--count",
    "1",
    "--client-id",
    "id",
    "--timeout",
    "1000",
    "--json",
  ]);

  let closed = false;

  x.b.files.events.mockImplementation(async function* () {
    try {
      yield { type: "subscribed" };

      throw Error("unconsumed");
    } finally {
      closed = true;
    }
  });

  await dispatch(x.c);
  expect(closed).toBe(true);

  expect(JSON.parse(x.stdout())).toMatchObject({
    schemaVersion: 1,
    data: { type: "subscribed", clientId: "id" },
  });

  expect(x.b.files.events).toHaveBeenCalledWith("cloudreve://my/", "id", {
    signal: x.c.signal,
    timeoutMs: 1000,
  });

  const all = context(["watch", "/my/"]);

  await dispatch(all.c);
  expect(all.stdout().trim().split("\n")).toHaveLength(2);
  await expect(dispatch(context(["watch", "/my/", "--count", "0"]).c)).rejects.toThrow("positive");
});

it("downloads a temporary archive through the byte adapter with explicit local destination", async () => {
  const x = context(["archive", "download", "/my/folder", "local:/tmp/a.zip", "--overwrite"]);

  await dispatch(x.c);

  expect(x.raw.bytes.downloadUrl).toHaveBeenCalledWith(
    "https://example.test/archive",
    "/tmp/a.zip",
    true,
    x.c.transport,
    x.c.signal,
  );

  const no = context(["archive", "download", "/my/folder", "/my/archive.zip"]);

  await expect(dispatch(no.c)).rejects.toThrow("local:");
  expect(no.b.files.archiveUrl).not.toHaveBeenCalled();
});

it("lists only content versions and validates typed properties using SDK definitions", async () => {
  const x = context(["version", "list", "/my/a", "--json"]);

  await dispatch(x.c);
  expect(JSON.parse(x.stdout()).data).toEqual([]);

  Object.assign(x.file, {
    extended_info: {
      entities: [
        { id: "v", type: 0 },
        { id: "thumbnail", type: 1 },
      ],
    },
  });

  x.raw.io.write.mockClear();
  await dispatch(x.c);
  expect(x.raw.io.write).toHaveBeenLastCalledWith(expect.stringContaining('"id":"v"'));

  const typed = context(["metadata", "set", "/my/a", "--key", "props:rating", "--value", "9"]);

  await expect(dispatch(typed.c)).rejects.toThrow("Unknown");

  typed.b.files.customProperties.mockResolvedValue([
    { id: "rating", name: "Rating", type: "rating", max: 5 },
  ] as never);

  await expect(dispatch(typed.c)).rejects.toThrow("Invalid");
  expect(typed.b.files.metadata).not.toHaveBeenCalled();
  typed.c.inv.flags.value = "4";
  await dispatch(typed.c);

  expect(typed.b.files.metadata).toHaveBeenCalledWith(
    ["cloudreve://my/a"],
    [{ key: "props:rating", value: "4" }],
    typed.c.signal,
  );

  const remove = context(["metadata", "remove", "/my/a", "--key", "props:rating"]);

  remove.b.files.customProperties.mockImplementation(
    typed.b.files.customProperties.getMockImplementation()!,
  );

  await dispatch(remove.c);

  expect(remove.b.files.metadata).toHaveBeenCalledWith(
    ["cloudreve://my/a"],
    [{ key: "props:rating", remove: true }],
    remove.c.signal,
  );
});

it("archives exact selections and protected guest roots without authenticated account behavior", async () => {
  const x = context([
    "archive",
    "download",
    "/share/id/a",
    "/share/id/b",
    "local:/tmp/selected.zip",
    "--guest",
  ]);

  x.c.sharePassword = "secret";
  await dispatch(x.c);

  expect(x.b.files.archiveUrl).toHaveBeenCalledWith(
    ["cloudreve://id:secret@share/a", "cloudreve://id:secret@share/b"],
    x.c.signal,
  );

  expect(x.raw.backend).not.toHaveBeenCalled();

  const y = context(["url", "/share/id", "--archive", "--guest"]);

  y.c.sharePassword = "secret";
  await dispatch(y.c);
  expect(y.b.files.archiveUrl).toHaveBeenCalledWith(["cloudreve://id:secret@share"], y.c.signal);

  const missing = context(["archive", "download", "/my/a"]);

  await expect(dispatch(missing.c)).rejects.toThrow("followed by");

  const empty = context(["url", "/my/a", "--archive"]);

  empty.c.inv.args = [];
  await expect(dispatch(empty.c)).rejects.toThrow();
});
