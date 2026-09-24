import { dispatch as files } from "../../src/main.js";
import { ApiError } from "@cloudreve/sdk/protocol";
import { expect, it } from "vitest";
import { destination, infoOrMissing, listing } from "../../src/commands/files.js";
import { context } from "./context.js";

it("dispatches filesystem mutations with explicit safe semantics", async () => {
  const cases: [string[], string][] = [
    [["stat", "/my/a"], "info"],
    [["mkdir", "/my/new"], "create"],
    [["touch", "/my/a"], "infoIfExists"],
    [["rm", "/my/a"], "delete"],
    [["rm", "/my/a", "--permanent", "--yes"], "delete"],
    [["restore", "/trash/id"], "restore"],
    [["trash", "empty", "--yes"], "emptyTrash"],
    [["write", "/my/a", "--input", "-"], "saveText"],
    [["metadata", "view", "/my/a"], "info"],
    [["metadata", "set", "/my/a", "--key", "k", "--value", "v"], "metadata"],
    [["metadata", "remove", "/my/a", "--key", "k"], "metadata"],
    [["tag", "add", "/my/a", "--name", "t", "--color", "#112233"], "metadata"],
    [["tag", "remove", "/my/a", "--name", "t"], "metadata"],
  ];

  for (const [args, method] of cases) {
    const x = context(args);

    await files(x.c);
    expect(x.b.files[method as keyof typeof x.b.files]).toHaveBeenCalled();
  }

  const create = context(["touch", "/my/new"]);

  create.b.files.infoIfExists.mockResolvedValue(undefined as never);
  await files(create.c);
  expect(create.b.files.create).toHaveBeenCalledWith("cloudreve://my/", "new", "file");
});

it("streams cat bytes only and guards destructive cases", async () => {
  const x = context(["cat", "/my/a"]);

  await files(x.c);
  expect(x.stdout()).toBe("\u0001");
  expect(() => context(["cat", "/my/a", "--json"])).toThrow("raw");

  for (const args of [
    ["rm", "/trash/id"],
    ["restore", "/my/a"],
  ]) {
    const y = context(args);

    await expect(files(y.c)).rejects.toThrow();
    expect(y.b.files.delete).not.toHaveBeenCalled();
  }

  const folder = context(["rm", "/my/dir"]);

  folder.b.files.info.mockResolvedValue({ ...folder.file, type: 1 });
  await expect(files(folder.c)).rejects.toThrow("recursive");
});

it("delegates remote destination and relocation policy to SDK without transfer fallback", async () => {
  const x = context(["mv", "/my/a", "/my/b"]);

  await files(x.c);

  expect(x.b.files.copyTo).toHaveBeenCalledWith("cloudreve://my/a", "cloudreve://my/b", {
    copy: false,
    requireDirectory: false,
    recursive: false,
  });

  expect(x.b.uploads.run).not.toHaveBeenCalled();

  const y = context(["cp", "/my/a", "/my/dir/", "--recursive"]);

  await files(y.c);

  expect(y.b.files.copyTo).toHaveBeenCalledWith("cloudreve://my/a", "cloudreve://my/dir", {
    copy: true,
    requireDirectory: true,
    recursive: true,
  });

  expect((await destination(y.c, "/my/dir/", "a")).toString()).toBe("cloudreve://my/destination/a");
  expect(y.b.files.resolveDestination).toHaveBeenCalledWith("a", "cloudreve://my/dir", true);
  await expect(destination(y.c, "local:x", "a")).rejects.toThrow();
  y.b.files.infoIfExists.mockRejectedValue(new ApiError(500, "bad"));
  await expect(infoOrMissing(y.c, "x")).rejects.toThrow("bad");

  for (const args of [
    ["cp", "/", "/my/a"],
    ["cp", "local:a", "local:b"],
    ["mv", "local:a", "/my/a"],
    ["mv", "/my/a", "local:b"],
    ["cp", "/my/", "/my/a"],
  ]) {
    const z = context(args);

    await expect(files(z.c)).rejects.toThrow();
    expect(z.b.files.copyTo).not.toHaveBeenCalled();
  }
});

it("streams complete listings and resumes a mid-page limit without losing entries", async () => {
  const x = context(["ls", "/my/", "--json", "--limit", "1"]);

  x.b.files.list.mockResolvedValue({
    files: [x.file, { ...x.file, id: "b", name: "b", path: "cloudreve://my/b" }],
    pagination: { page: 0, page_size: 100, total_items: 2 },
    props: {},
  } as never);

  await listing(x.c);

  const first = JSON.parse(x.stdout());

  expect(first.data).toHaveLength(1);
  expect(first.pagination.complete).toBe(false);

  const y = context(["ls", "/my/", "--json", "--cursor", first.pagination.cursor]);

  y.b.files.list.mockResolvedValue(x.b.files.list.mock.results[0]?.value as never);
  await listing(y.c);
  expect(JSON.parse(y.stdout()).data.map((v: { name: string }) => v.name)).toEqual(["b"]);

  const complete = context(["ls", "/my/", "--json"]);

  complete.b.files.list
    .mockResolvedValueOnce({
      files: [complete.file],
      pagination: { page: 0, page_size: 1, total_items: 2 },
      props: {},
    } as never)
    .mockResolvedValueOnce({
      files: [],
      pagination: { page: 1, page_size: 1, total_items: 2 },
      props: {},
    } as never);

  await listing(complete.c);
  expect(complete.b.files.list).toHaveBeenCalledTimes(2);
  expect(JSON.parse(complete.stdout()).pagination.complete).toBe(true);
});

it("reports limited text continuation, namespaces, query and invalid cursors", async () => {
  for (const root of ["/", "/share/"]) {
    for (const json of [false, true]) {
      const x = context(["ls", root, ...(json ? ["--json"] : [])]);

      await listing(x.c);
      expect(x.b.files.list).not.toHaveBeenCalled();
    }
  }

  const text = context(["ls", "--limit", "1", "--search", "a"]);

  text.b.files.list.mockResolvedValue({
    files: [text.file],
    pagination: { page: 0, page_size: 1, total_items: 2 },
    props: {},
  } as never);

  await listing(text.c);
  expect(text.stderr()).toContain("--cursor");
  expect(text.b.files.list.mock.calls[0]?.[0]).toContain("name=a");

  for (const args of [
    ["ls", "local:a"],
    ["ls", "--limit", "0"],
    ["ls", "--cursor", "bad"],
  ]) {
    await expect(listing(context(args).c)).rejects.toThrow();
  }
});

it("keeps stdout nonrewindable and explicitly delegates stdin content", async () => {
  const x = context(["cat", "/my/a"]);

  x.b.downloads.run.mockImplementation(async (_job, sink) => {
    await sink.reset();
  });

  await expect(files(x.c)).rejects.toThrow("rewind");

  const y = context(["write", "/my/a", "--input", "-"]);

  y.raw.bytes.textInput.mockImplementation(async (_p, _max, input) => {
    expect(await input()).toEqual(Buffer.from("{}"));

    return "text";
  });

  await files(y.c);
  expect(y.raw.io.input).toHaveBeenCalled();
});

it("routes local upload and download through the selected SDK transfer services", async () => {
  const up = context(["cp", "local:/tmp/a", "/my/destination/"]);

  await files(up.c);
  expect(up.b.uploads.run).toHaveBeenCalled();
  expect(up.b.downloads.run).not.toHaveBeenCalled();

  const down = context(["cp", "/my/a", "local:/tmp/out"]);

  await files(down.c);
  expect(down.b.downloads.run).toHaveBeenCalled();
  expect(down.b.uploads.run).not.toHaveBeenCalled();
});

it("binds continuation to immutable account identity and rejects a changed page remainder", async () => {
  const first = context(["ls", "/my/", "--json", "--limit", "1"]);

  first.b.files.list.mockResolvedValue({
    files: [first.file, { ...first.file, id: "b", name: "b" }],
    pagination: { page: 0, page_size: 100, total_items: 2 },
    props: {},
  } as never);

  await listing(first.c);

  const cursor = JSON.parse(first.stdout()).pagination.cursor;
  const wrong = context(["ls", "/my/", "--json", "--cursor", cursor]);

  wrong.raw.connection().accountId = "other";
  await expect(listing(wrong.c)).rejects.toThrow("different listing context");
  expect(wrong.b.files.list).not.toHaveBeenCalled();

  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());

  parsed.offset = 100;

  const changed = context([
    "ls",
    "/my/",
    "--cursor",
    Buffer.from(JSON.stringify(parsed)).toString("base64url"),
  ]);

  await expect(listing(changed.c)).rejects.toThrow("Directory changed");
});

it("maps all search ranges through SDK URI semantics and rejects reversed ranges", async () => {
  const x = context([
    "ls",
    "/my/",
    "--search",
    "a",
    "--ignore-case",
    "--type",
    "file",
    "--size-min",
    "0",
    "--size-max",
    "100",
    "--created-after",
    "1",
    "--created-before",
    "2",
    "--updated-after",
    "3",
    "--updated-before",
    "4",
  ]);

  await listing(x.c);

  const { CrUri } = await import("@cloudreve/sdk/files");

  expect(new CrUri(String(x.b.files.list.mock.calls[0]?.[0])).searchParams()).toEqual({
    name: ["a"],
    caseFolding: true,
    type: "file",
    sizeGte: 0,
    sizeLte: 100,
    createdGte: 1,
    createdLte: 2,
    updatedGte: 3,
    updatedLte: 4,
  });

  for (const flags of [
    ["--size-min", "2", "--size-max", "1"],
    ["--created-after", "2", "--created-before", "1"],
    ["--updated-after", "2", "--updated-before", "1"],
  ]) {
    const invalid = context(["ls", "/my/", ...flags]);

    await expect(listing(invalid.c)).rejects.toThrow("range");
    expect(invalid.b.files.list).not.toHaveBeenCalled();
  }
});

it("streams search batches with backpressure, stops at limit and resumes without credential leakage", async () => {
  const x = context(["ls", "/my/", "--json", "--limit", "1"]);
  let closed = false;

  x.b.files.listStream.mockImplementation(async function* () {
    try {
      yield {
        type: "file",
        files: [x.file, { ...x.file, id: "b", name: "b" }],
      };

      yield {
        type: "list",
        directory: {
          files: [],
          pagination: { page: 0, page_size: 100, total_items: 2 },
          props: {},
        },
      };
    } finally {
      closed = true;
    }
  });

  await listing(x.c);
  expect(closed).toBe(true);

  const result = JSON.parse(x.stdout());

  expect(result.data).toHaveLength(1);
  expect(result.pagination.complete).toBe(false);

  const y = context(["ls", "/my/", "--json", "--cursor", result.pagination.cursor]);

  y.b.files.listStream.mockImplementation(x.b.files.listStream.getMockImplementation()!);
  await listing(y.c);
  expect(JSON.parse(y.stdout()).data.map((f: any) => f.name)).toEqual(["b"]);

  const malformed = context(["ls", "/my/"]);

  malformed.b.files.listStream.mockImplementation(async function* () {
    yield { type: "file", files: [] };
  });

  await expect(listing(malformed.c)).rejects.toThrow("metadata");
});

it("passes names and typed metadata query structure to the SDK", async () => {
  const x = context([
    "ls",
    "/my/",
    "--names-json",
    '["one","two"]',
    "--name-any",
    "--match-any",
    "--metadata-json",
    '[{"key":"tag:Project","value":"","exact":true}]',
  ]);

  await listing(x.c);
  expect(String(x.b.files.list.mock.calls[0]?.[0])).toContain("exact_meta_");

  for (const value of [
    "bad",
    "null",
    "[null]",
    '[{"key":1,"value":"v"}]',
    '[{"key":"","value":"v"}]',
    '[{"key":"key","value":1}]',
    '[{"key":"key","value":"v","exact":1}]',
  ]) {
    const z = context(["ls", "/my/", "--metadata-json", value]);

    await expect(listing(z.c)).rejects.toThrow("metadata-json");
    expect(z.b.files.list).not.toHaveBeenCalled();
  }
});

it("escapes terminal controls in human listings without changing JSON filenames", async () => {
  const x = context(["ls", "/my/"]);

  x.file.name = "\u001b[31munsafe\nname";
  await listing(x.c);
  expect(x.stdout()).toContain("TYPE");
  expect(x.stdout()).toContain("\\u001b[31munsafe\\nname");
  expect(x.stdout()).not.toContain("\u001b");

  const y = context(["ls", "/my/", "--json"]);

  y.file.name = x.file.name;
  await listing(y.c);
  expect(JSON.parse(y.stdout()).data[0].name).toBe(x.file.name);
});

it("keeps category presets exclusive so the server cannot silently discard other filters", async () => {
  const category = context(["ls", "/my/", "--category", "document"]);

  await listing(category.c);
  expect(String(category.b.files.list.mock.calls[0]?.[0])).toContain("category=document");

  const combined = context(["ls", "/my/", "--category", "document", "--search", "ignored"]);

  await expect(listing(combined.c)).rejects.toThrow("replace");
  expect(combined.b.files.list).not.toHaveBeenCalled();
  expect(combined.stdout()).toBe("");
});

it("uses a captured entity precondition for explicit remote upload overwrite", async () => {
  const x = context(["cp", "local:/tmp/a", "/my/a", "--overwrite"]);

  await files(x.c);

  expect(x.b.uploads.create).toHaveBeenCalledWith(
    expect.objectContaining({
      entity_type: "version",
      previous: "v",
      encryption_supported: ["aes-256-ctr"],
    }),
    "local",
    x.c.signal,
  );

  const dir = context(["cp", "local:/tmp/a", "/my/folder/", "--overwrite"]);

  dir.b.files.infoIfExists.mockResolvedValueOnce({ ...dir.file, type: 1 });
  await files(dir.c);

  expect(dir.b.uploads.create).toHaveBeenCalledWith(
    expect.objectContaining({ uri: "cloudreve://my/folder/a", previous: "v" }),
    "local",
    dir.c.signal,
  );

  const missing = context(["cp", "local:/tmp/a", "/my/new", "--overwrite"]);

  missing.b.files.infoIfExists.mockResolvedValue(undefined as never);
  await files(missing.c);
  expect(missing.b.uploads.create.mock.calls[0]?.[0]).not.toHaveProperty("previous");

  for (const [args, entry] of [
    [["cp", "local:/tmp/a", "/trash/a", "--overwrite"], x.file],
    [["cp", "local:/tmp/a", "/my/a/", "--overwrite"], x.file],
    [["cp", "local:/tmp/a", "/my/a", "--overwrite"], { ...x.file, primary_entity: undefined }],
    [["cp", "local:/tmp/a", "/my/a", "--overwrite"], { ...x.file, type: 1 }],
  ] as const) {
    const bad = context([...args]);

    bad.b.files.infoIfExists.mockResolvedValue(entry as never);
    await expect(files(bad.c)).rejects.toThrow();
    expect(bad.b.uploads.create).not.toHaveBeenCalled();
  }
});

it("uploads an explicitly recursive local tree in parent-first order and stops on changed sources", async () => {
  const x = context(["cp", "local:/tree", "/my/target", "--recursive"]);

  const entries = [
    { relative: "nested", path: "/tree/nested", kind: "directory" },
    { relative: "nested/one.txt", path: "/tree/nested/one.txt", kind: "file" },
    { relative: "empty", path: "/tree/empty", kind: "directory" },
  ];

  x.raw.localTree.scanLocalTree.mockResolvedValue({ root: "/tree", entries });
  await files(x.c);

  expect((x.b.files.create.mock.calls as unknown[][]).map((call) => call[1])).toEqual([
    "a",
    "nested",
    "empty",
  ]);

  expect(x.b.uploads.create).toHaveBeenCalledWith(
    expect.objectContaining({
      uri: "cloudreve://my/destination/a/nested/one.txt",
    }),
    "local",
    x.c.signal,
  );

  expect(x.raw.localTree.assertLocalEntry).toHaveBeenCalledTimes(3);

  const y = context(["cp", "local:/tree", "/my/target", "--recursive", "--overwrite"]);

  await expect(files(y.c)).rejects.toThrow("absent destination");
  expect(y.raw.localTree.scanLocalTree).not.toHaveBeenCalled();

  const padded = context(["cp", "local:/tree", "/my/target", "--recursive"]);

  padded.raw.localTree.scanLocalTree.mockResolvedValue({
    root: "/padded ",
    entries: [],
  });

  await expect(files(padded.c)).rejects.toThrow("name would change");
  expect(padded.b.files.create).not.toHaveBeenCalled();

  const z = context(["cp", "local:/tree", "/my/target", "--recursive"]);

  z.raw.localTree.scanLocalTree.mockResolvedValue({ root: "/tree", entries });
  z.raw.localTree.assertLocalEntry.mockRejectedValue(new Error("changed source"));
  await expect(files(z.c)).rejects.toThrow("changed source");
  expect(z.b.uploads.create).not.toHaveBeenCalled();
});

it("saves editor changes against the original SDK text entity and preserves conflicts", async () => {
  const x = context(["edit", "/my/a", "--editor", "fixture-editor"]);

  const document = {
    uri: "cloudreve://my/a",
    name: "a",
    entity: "original",
    text: "before",
    bom: false,
    lineEnding: "\n" as const,
  };

  x.b.files.readText.mockResolvedValue(document as never);
  await files(x.c);
  expect(x.b.files.saveText).not.toHaveBeenCalled();
  x.raw.editText.mockResolvedValue("changed");
  await files(x.c);
  expect(x.b.files.saveText).toHaveBeenCalledWith(document, "changed", x.c.signal);
  x.b.files.saveText.mockRejectedValue(new Error("version conflict"));
  await expect(files(x.c)).rejects.toThrow("version conflict");
});
