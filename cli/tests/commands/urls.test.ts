import { expect, it, vi } from "vitest";
import { temporaryUrl } from "../../src/commands/urls.js";
import { context } from "./context.js";

function setup(path = "book.pdf", flags: Record<string, string | boolean | undefined> = {}) {
  const value = context(["ls"]);

  value.c.inv.command = "url";
  value.c.inv.args = [path];
  value.c.inv.flags = flags;

  const viewerUrl = vi.fn(async () => "https://primary.test/preview?sign=opaque");

  Object.assign(value.b.files, { viewerUrl });

  return { ...value, viewerUrl };
}

it("issues a counted download URL with exact entity/cache options and preserves its signature", async () => {
  const x = setup("book.pdf", {
    cwd: "/my/Documents",
    entity: "old-version",
    fresh: true,
    download: true,
  });

  x.b.files.urls.mockResolvedValue(["https://storage.test/book?sign=opaque"]);

  expect(await temporaryUrl(x.c)).toEqual({
    url: "https://storage.test/book?sign=opaque",
  });

  expect(x.b.files.urls).toHaveBeenCalledWith(
    ["cloudreve://my/Documents/book.pdf"],
    true,
    "old-version",
    true,
    x.c.signal,
  );

  expect(x.viewerUrl).not.toHaveBeenCalled();
});

it("supports preview without download counting and explicit primary-site URLs", async () => {
  const preview = setup("/my/book.pdf", { preview: true });

  await temporaryUrl(preview.c);

  expect(preview.b.files.urls).toHaveBeenCalledWith(
    ["cloudreve://my/book.pdf"],
    false,
    undefined,
    false,
    preview.c.signal,
  );

  const primary = setup("/my/book.pdf", {
    "primary-site": true,
    entity: "retained",
  });

  expect(await temporaryUrl(primary.c)).toEqual({
    url: "https://primary.test/preview?sign=opaque",
  });

  expect(primary.viewerUrl).toHaveBeenCalledWith(
    "cloudreve://my/book.pdf",
    "retained",
    primary.c.signal,
  );

  expect(primary.b.files.urls).not.toHaveBeenCalled();
});

it("uses the guest reader and keeps share passwords out of persistence and result metadata", async () => {
  const x = setup("/share/id/book.pdf", { guest: true, preview: true });

  x.c.sharePassword = "private-password";

  const guest = {
    ...(await x.c.publicBackend()).files,
    urls: vi.fn(async () => ["https://storage.test/signed"]),
    viewerUrl: x.viewerUrl,
  };

  x.c.reader = vi.fn(async () => guest);

  expect(await temporaryUrl(x.c)).toEqual({
    url: "https://storage.test/signed",
  });

  expect(guest.urls).toHaveBeenCalledWith(
    ["cloudreve://id:private-password@share/book.pdf"],
    false,
    undefined,
    false,
    x.c.signal,
  );

  expect(x.c.backend).not.toHaveBeenCalled();
  expect(x.c.state.write).not.toHaveBeenCalled();
  expect(x.c.state.transaction).not.toHaveBeenCalled();
  expect(x.c.io.input).not.toHaveBeenCalled();
});

it("rejects incompatible modes, local paths, credential argv and malformed URL cardinality", async () => {
  for (const flags of [
    { preview: true, download: true },
    { preview: true, "primary-site": true },
    { "primary-site": true, fresh: true },
  ]) {
    const x = setup("/my/a", flags);

    await expect(temporaryUrl(x.c)).rejects.toThrow("Choose one");
    expect(x.b.files.urls).not.toHaveBeenCalled();
  }

  for (const path of ["local:/tmp/book", "cloudreve://id:password@share/book"]) {
    await expect(temporaryUrl(setup(path).c)).rejects.toThrow();
  }

  for (const urls of [[], [""], ["https://one.test", "https://two.test"]]) {
    const x = setup("/my/a");

    x.b.files.urls.mockResolvedValue(urls);
    await expect(temporaryUrl(x.c)).rejects.toThrow("exactly one");
  }
});

it("honors cancellation before asking the SDK for any URL", async () => {
  const x = setup();
  const controller = new AbortController();

  controller.abort(new Error("cancel URL"));
  x.c.signal = controller.signal;
  await expect(temporaryUrl(x.c)).rejects.toThrow("cancel URL");
  expect(x.b.files.urls).not.toHaveBeenCalled();
});

it("issues explicit archive URLs and refuses incompatible entity/cache modes", async () => {
  const x = setup("/share/id", { guest: true, archive: true });

  x.c.sharePassword = "secret";

  expect(await temporaryUrl(x.c)).toEqual({
    url: "https://example.test/archive",
  });

  expect(x.b.files.archiveUrl).toHaveBeenCalledWith(["cloudreve://id:secret@share"], x.c.signal);
  expect(x.raw.backend).not.toHaveBeenCalled();

  for (const flags of [
    { archive: true, entity: "v" },
    { archive: true, fresh: true },
    { archive: true, download: true },
  ]) {
    await expect(temporaryUrl(setup("/my/a", flags).c)).rejects.toThrow("Choose one");
  }
});

it("consolidates selected archive URLs and refuses multi-source ordinary URLs", async () => {
  const x = setup("/my/a", { archive: true });

  x.c.inv.args.push("/my/b");
  await temporaryUrl(x.c);

  expect(x.b.files.archiveUrl).toHaveBeenCalledWith(
    ["cloudreve://my/a", "cloudreve://my/b"],
    x.c.signal,
  );

  x.c.inv.flags = {};
  await expect(temporaryUrl(x.c)).rejects.toThrow("require --archive");

  for (const flags of [
    { archive: true, entity: "v" },
    { archive: true, fresh: true },
  ]) {
    x.c.inv.flags = flags;
    await expect(temporaryUrl(x.c)).rejects.toThrow("Choose one");
  }
});
