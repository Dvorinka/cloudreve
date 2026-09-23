import { expect, it } from "vitest";
import { listing } from "../../src/commands/files.js";
import { twoFactorSet } from "../../src/commands/security.js";
import { watchLine } from "../../src/output/streaming.js";
import { context } from "./context.js";

it("prints one listing header across streamed batches and gives empty folders a clear result", async () => {
  const c = context(["ls", "/my/"]);

  c.b.files.listStream.mockImplementation(async function* () {
    yield { type: "file", files: [c.file] };
    expect(c.stdout()).toContain("1 B");
    yield { type: "file", files: [{ ...c.file, name: "folder", type: 1 }] };
    yield { type: "list", directory: { files: [], pagination: {}, props: {} } };
  });

  await listing(c.c);
  expect(c.stdout().match(/TYPE/g)).toHaveLength(1);
  expect(c.stdout()).toContain("folder/");

  const empty = context(["ls", "/my/"]);

  empty.b.files.list.mockResolvedValue({
    files: [],
    pagination: {},
    props: {},
  } as never);

  await listing(empty.c);
  expect(empty.stdout()).toBe("No entries.\n");
});

it("renders event lifecycle and mutation fields without JSON or terminal injection", () => {
  expect(watchLine({ type: "subscribed" })).toContain("Subscribed");
  expect(watchLine({ type: "resumed" })).toContain("Resumed");
  expect(watchLine({ type: "keep-alive" })).toContain("Connected");
  expect(watchLine({ type: "event" })).toBe("event\n");

  expect(
    watchLine({
      type: "event",
      data: {
        type: "create",
        file_id: "1",
        from: "/a",
        uri: "cloudreve://my/a",
        count: 2,
      },
    }),
  ).toBe("event  type: create · file id: 1 · from: /a · uri: /my/a · count: 2\n");
});

it("labels enrollment secrets only on stderr and preserves explicit JSON mode", async () => {
  for (const json of [false, true]) {
    const c = context([
      "account",
      "two-factor",
      "enable",
      "--enroll",
      "--show-secret",
      ...(json ? ["--json"] : []),
    ]);

    c.b.account.initTwoFactor.mockResolvedValue("secret\u001b");
    await twoFactorSet(c.c, true);
    expect(c.stdout()).toBe("");

    if (json) {
      expect(JSON.parse(c.stderr())).toEqual({
        enrollmentSecret: "secret\u001b",
      });
    } else {
      expect(c.stderr()).toBe("Authenticator setup key: secret\\u001b\n");
    }
  }
});

it("uses terminal width and selected timezone without buffering listing rows", async () => {
  const wide = context(["ls", "/my/", "--timezone", "America/Los_Angeles"]);

  wide.file.updated_at = "2026-01-01T00:30:00Z";
  wide.c.io.presentation = { width: 100, color: false };
  await listing(wide.c);
  expect(wide.stdout()).toContain("2025-12-31 16:30");

  const narrow = context(["ls", "/my/"]);

  narrow.c.io.presentation = { width: 30, color: false };
  await listing(narrow.c);
  expect(narrow.stdout()).not.toContain("MODIFIED");
  expect(narrow.stdout()).toContain("1 B");
});

it("keeps structured event extensions readable without object coercion", () => {
  const output = watchLine({
    type: "event",
    data: { extra: { names: ["one", "two"], enabled: true }, removed: null },
  });

  expect(output).toContain("Names: one, two");
  expect(output).toContain("Enabled: Yes");
  expect(output).not.toContain("[object Object]");
});
