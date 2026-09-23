import { expect, it } from "vitest";
import { dispatch as control } from "../../src/main.js";
import { context } from "./context.js";

it("maps every portable control group to the public SDK", async () => {
  const cases: [string[], string, string, unknown[]?][] = [
    [["share", "list"], "shares", "list"],
    [["share", "view", "s"], "shares", "info"],
    [["share", "create", "/my/a"], "shares", "save"],
    [["share", "update", "s", "/my/a", "--expire", "0", "--downloads", "0"], "shares", "save"],
    [["share", "revoke", "s", "--yes"], "shares", "revoke"],
    [["link", "create", "/my/a"], "shares", "direct"],
    [["link", "revoke", "s", "--yes"], "shares", "revokeDirect"],
    [["account", "view"], "account", "me"],
    [["account", "settings"], "account", "settings"],
    [["account", "password"], "account", "password"],
    [["webdav", "list"], "webdav", "list"],
    [["webdav", "view", "d"], "webdav", "get"],
    [["webdav", "create", "/my/", "--name", "dav"], "webdav", "save"],
    [["webdav", "update", "d", "/my/", "--name", "dav"], "webdav", "save"],
    [["webdav", "revoke", "d", "--yes"], "webdav", "revoke"],
    [["job", "list"], "jobs", "list"],
    [["job", "view", "j"], "jobs", "get"],
    [["job", "cancel", "j", "--yes"], "jobs", "cancel"],
    [["job", "select", "j", "--indices", "1,2"], "jobs", "selectFiles"],
    [["archive", "list", "/my/a.zip"], "jobs", "archiveFiles"],
    [["archive", "create", "/my/a", "/my/a.zip"], "jobs", "archive"],
    [["archive", "extract", "/my/a.zip", "/my/"], "jobs", "archive"],
  ];

  for (const [argv, group, method] of cases) {
    const { c, b } = context(argv);

    await control(c);

    expect(
      (b as never as Record<string, Record<string, unknown>>)[group]?.[method],
      argv.join(" "),
    ).toHaveBeenCalled();
  }
});

it("rejects invalid host inputs before SDK mutation", async () => {
  for (const args of [
    ["job", "list", "--category", "bad"],
    ["job", "select", "j", "--indices=-1"],
    ["unknown"],
  ]) {
    await expect(async () => control(context(args).c)).rejects.toThrow();
  }

  const { c, b } = context(["link", "create", "/my/a"]);

  b.shares.directAllowed.mockResolvedValue(false);
  await expect(control(c)).rejects.toThrow("permit");
  expect(b.shares.direct).not.toHaveBeenCalled();
});

it("passes sensitive settings through input without argv or default output", async () => {
  const { c, b, raw } = context([
    "share",
    "create",
    "/my/a",
    "--downloads",
    "2",
    "--expire",
    "60",
    "--private",
    "--share-view",
    "--show-readme",
    "--secrets-stdin",
  ]);

  raw.io.input.mockResolvedValue(Buffer.from('{"password":"secret"}'));
  await control(c);

  expect(b.shares.save).toHaveBeenCalledWith(
    {
      uri: "cloudreve://my/a",
      downloads: 2,
      expire: 60,
      is_private: true,
      share_view: true,
      show_readme: true,
      password: "secret",
    },
    undefined,
  );

  const password = context(["account", "password", "--secrets-stdin"]);

  password.raw.io.input.mockResolvedValue(Buffer.from('{"current":"old","next":"new"}'));
  await control(password.c);
  expect(password.b.account.password).toHaveBeenCalledWith("old", "new");
});

it("exposes quota, public profile, link inspection and property definitions through SDK", async () => {
  for (const [argv, group, method] of [
    [["account", "capacity"], "account", "capacity"],
    [["link", "list", "/my/a"], "files", "info"],
    [["metadata", "schema"], "files", "customProperties"],
  ] as const) {
    const { c, b } = context([...argv]);

    await control(c);
    expect((b[group] as any)[method]).toHaveBeenCalled();
  }

  const linked = context(["link", "list", "/my/a", "--json"]);

  Object.assign(linked.file, {
    extended_info: {
      direct_links: [{ id: "l", url: "https://example.test/f/l" }],
    },
  });

  await control(linked.c);
  expect(JSON.parse(linked.stdout()).data).toEqual([{ id: "l", url: "https://example.test/f/l" }]);
});

it("resolves protected shares without a password in argv and scopes force unlock", async () => {
  const shared = context(["share", "open", "s", "--secrets-stdin"]);

  shared.raw.io.input.mockResolvedValue(Buffer.from('{"password":"private"}'));
  await control(shared.c);
  expect(shared.b.shares.resolve).toHaveBeenCalledWith("s", "private", shared.c.signal);

  const unlock = context(["unlock", "--secrets-stdin", "--yes"]);

  await expect(control(unlock.c)).rejects.toThrow("lock token");
  expect(unlock.b.files.unlock).not.toHaveBeenCalled();
  unlock.raw.io.input.mockResolvedValue(Buffer.from('{"token":"lock"}'));
  await control(unlock.c);
  expect(unlock.raw.confirm).toHaveBeenCalled();
  expect(unlock.b.files.unlock).toHaveBeenCalledWith(["lock"], unlock.c.signal);
});

it("preserves tag rename atomicity and exact archive member names", async () => {
  const renamed = context([
    "tag",
    "rename",
    "/my/a",
    "--original",
    "old",
    "--name",
    "new",
    "--color",
    "#ff0000",
  ]);

  await control(renamed.c);

  expect(renamed.b.files.metadata.mock.calls[0]?.[1]).toEqual(
    expect.arrayContaining([
      { key: "tag:old", remove: true },
      { key: "tag:new", value: "#ff0000" },
    ]),
  );

  const extracted = context([
    "archive",
    "extract",
    "/my/a.zip",
    "/my/out",
    "--members-json",
    '["/a,b.txt","/中文.txt"]',
  ]);

  await control(extracted.c);

  expect(extracted.b.jobs.archive).toHaveBeenCalledWith(
    expect.objectContaining({ file_mask: ["/a,b.txt", "/中文.txt"] }),
    true,
  );

  for (const value of ["[]", "{}", "[1]", '[""]', '["\\u0000"]', "invalid"]) {
    const invalid = context([
      "archive",
      "extract",
      "/my/a.zip",
      "/my/out",
      "--members-json",
      value,
    ]);

    await expect(control(invalid.c)).rejects.toThrow("JSON array");
    expect(invalid.b.jobs.archive).not.toHaveBeenCalled();
  }

  await expect(
    control(context(["archive", "create", "/my/a", "/my/a.zip", "--members-json", '["a"]']).c),
  ).rejects.toThrow("only");
});

it("clears local login after a password change while reporting remote revocation separately", async () => {
  const x = context(["account", "password", "--json"]);

  x.b.account.password.mockRejectedValueOnce(new Error("denied"));
  await expect(control(x.c)).rejects.toThrow("denied");
  expect(x.raw.logout).not.toHaveBeenCalled();

  x.raw.logout.mockRejectedValueOnce(
    Object.assign(new Error("remote failure"), { phase: "revocation" }),
  );

  await control(x.c);

  expect(JSON.parse(x.stdout()).data).toMatchObject({
    changed: true,
    signedOut: true,
    warnings: expect.any(Array),
  });

  x.raw.logout.mockRejectedValueOnce(
    Object.assign(new Error("storage failure"), { phase: "persistence" }),
  );

  await expect(control(x.c)).rejects.toThrow("storage failure");
});

it("preserves omitted access flags and requires explicit replacement of share limits", async () => {
  expect(() => context(["share", "update", "id", "/my/a", "--downloads", "5"])).toThrow("expire");

  const share = context(["share", "update", "id", "/my/a", "--downloads", "5", "--expire", "60"]);

  share.b.shares.info.mockResolvedValue({
    source_uri: "cloudreve://my/",
    source_type: 0,
    name: "a",
    is_private: true,
    share_view: true,
    show_readme: true,
  });

  await control(share.c);

  expect(share.b.shares.save).toHaveBeenCalledWith(
    expect.objectContaining({
      is_private: true,
      share_view: true,
      show_readme: true,
    }),
    "id",
  );

  const explicit = context([
    "share",
    "update",
    "id",
    "/my/a",
    "--downloads",
    "0",
    "--expire",
    "0",
    "--no-private",
    "--no-share-view",
    "--no-show-readme",
  ]);

  explicit.b.shares.info.mockResolvedValue({
    source_uri: "cloudreve://my/",
    source_type: 0,
    name: "a",
    is_private: true,
    share_view: true,
    show_readme: true,
  });

  await control(explicit.c);

  expect(explicit.b.shares.save).toHaveBeenCalledWith(
    expect.objectContaining({
      is_private: false,
      share_view: false,
      show_readme: false,
    }),
    "id",
  );

  for (const flags of [[], ["--no-readonly", "--no-proxy", "--no-disable-sys-files"]]) {
    const dav = context(["webdav", "update", "id", "/my/", "--name", "Renamed", ...flags]);

    dav.b.webdav.get.mockResolvedValue({
      options: "Bw==",
      name: "Old",
      uri: "cloudreve://my/",
    });

    await control(dav.c);

    expect(dav.b.webdav.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Renamed",
        readonly: !flags.length,
        proxy: !flags.length,
        disable_sys_files: !flags.length,
      }),
      "id",
    );
  }
});

it("validates a direct link through the SDK before public byte download", async () => {
  const x = context(["cp", "-", "local:/tmp/file", "--link-stdin"]);

  x.raw.io.input.mockResolvedValue(Buffer.from("https://example.test/f/id/name"));
  await control(x.c);

  expect(x.raw.bytes.downloadUrl).toHaveBeenCalledWith(
    "https://example.test/f/id/name",
    "/tmp/file",
    false,
    x.c.transport,
    x.c.signal,
    true,
  );

  expect(x.raw.backend).not.toHaveBeenCalled();

  await expect(control(context(["cp", "-", "/my/file", "--link-stdin"]).c)).rejects.toThrow(
    "local:",
  );
});

it("updates a share by ID after source rename and refuses legacy target rebinding", async () => {
  const x = context(["share", "update", "id", "--expire", "0", "--downloads", "0"]);

  x.b.shares.info.mockResolvedValue({
    source_uri: "cloudreve://a@my/parent",
    source_type: 0,
    name: "renamed.txt",
  });

  await control(x.c);

  expect(x.b.shares.save).toHaveBeenCalledWith(
    expect.objectContaining({ uri: "cloudreve://my/parent/renamed.txt" }),
    "id",
  );

  x.c.inv.args.push("/my/old.txt");
  await expect(control(x.c)).rejects.toThrow("rebound");
  x.c.inv.args[1] = "/trash/renamed.txt";
  await expect(control(x.c)).rejects.toThrow("rebound");
  x.c.inv.args[1] = "cloudreve://my/parent/renamed.txt?name=other";
  await expect(control(x.c)).rejects.toThrow("query views");
  x.c.inv.args.pop();

  x.b.shares.info.mockResolvedValue({
    source_uri: "cloudreve://other@my/parent",
    source_type: 0,
    name: "renamed.txt",
  });

  await expect(control(x.c)).rejects.toThrow("another account");

  x.b.shares.info.mockResolvedValue({
    source_uri: "cloudreve://share/parent",
    source_type: 1,
  });

  await expect(control(x.c)).rejects.toThrow("another account");
});

it("accepts direct-link operands and rejects incompatible copy modes before downloading", async () => {
  const x = context(["cp", "https://example.test/f/id/name", "local:/tmp/file"]);

  await control(x.c);
  expect(x.raw.ensureSupported).toHaveBeenCalled();
  expect(x.raw.io.input).not.toHaveBeenCalled();

  expect(x.raw.bytes.downloadUrl).toHaveBeenCalledWith(
    "https://example.test/f/id/name",
    "/tmp/file",
    false,
    x.c.transport,
    x.c.signal,
    true,
  );

  for (const args of [
    ["cp", "https://example.test/f/id/name", "local:/tmp/file", "--recursive"],
    ["mv", "https://example.test/f/id/name", "local:/tmp/file"],
    ["cp", "other", "local:/tmp/file", "--link-stdin"],
    ["cp", "https://other.test/f/id/name", "local:/tmp/file"],
  ]) {
    const y = context(args);

    await expect(control(y.c)).rejects.toThrow();
    expect(y.raw.bytes.downloadUrl).not.toHaveBeenCalled();
  }
});
