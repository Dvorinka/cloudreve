import { expect, it } from "vitest";
import { browserLink, webLocations } from "../../src/output/links.js";
import { format } from "../../src/output/format.js";
import { dispatch } from "../../src/main.js";
import { context } from "../commands/context.js";

const account = { endpoint: "https://files.example", accountId: "alice" };

it("uses Community directory navigation and file IDs on the selected endpoint", () => {
  const directory = new URL(browserLink("cloudreve://my/Reports", account, { type: 1 })!);

  expect(directory.origin + directory.pathname).toBe("https://files.example/home");
  expect(directory.searchParams.get("path")).toBe("cloudreve://alice@my/Reports");
  expect(directory.searchParams.has("open")).toBe(false);

  const file = new URL(
    browserLink("cloudreve://my/Reports/旅行%20%23.txt", account, {
      type: 0,
      id: "file-id",
    })!,
  );

  const path = new URL(file.searchParams.get("path")!);

  expect(path.pathname).toBe("/Reports");
  expect(path.searchParams.get("name")).toBe("旅行 #.txt");
  expect(file.searchParams.get("open")).toBe("file-id");

  const changed = new URL(
    browserLink("cloudreve://my/", {
      endpoint: "http://localhost:5212",
      accountId: "bob",
    })!,
  );

  expect(changed.origin).toBe("http://localhost:5212");
  expect(changed.searchParams.get("path")).toBe("cloudreve://bob@my/");
});

it("locates untyped paths without pretending they are files and strips capabilities", () => {
  const located = new URL(browserLink("cloudreve://my/folder", account)!);

  expect(located.searchParams.has("open")).toBe(false);
  expect(new URL(located.searchParams.get("path")!).searchParams.get("name")).toBe("folder");

  const share = new URL(
    browserLink("cloudreve://share-id:secret@share/folder/file?token=secret", account, {
      type: 0,
      id: "f",
    })!,
  );

  expect(share.toString()).not.toContain("secret");
  expect(new URL(share.searchParams.get("path")!).username).toBe("share-id");

  for (const namespace of ["trash", "shared_with_me"]) {
    const link = new URL(browserLink(`cloudreve://someone@${namespace}/`, account)!);

    expect(link.searchParams.get("path")).toBe(`cloudreve://${namespace}/`);
  }

  expect(
    new URL(browserLink("cloudreve://my/", { endpoint: account.endpoint })!).searchParams.get(
      "path",
    ),
  ).toBe("cloudreve://my/");
});

it("rejects unsafe or unsupported links and hides internal locations without a server", () => {
  for (const endpoint of [
    undefined,
    "invalid",
    "file:///tmp",
    "https://u:p@example.test",
    "https://example.test/base",
    "https://example.test/?token=x",
    "https://example.test/#x",
  ]) {
    expect(browserLink("cloudreve://my/", { endpoint })).toBeUndefined();
  }

  for (const uri of [
    "https://example.test",
    "cloudreve://",
    "cloudreve://share/",
    "cloudreve://unsupported/a",
    "cloudreve://my:42/a",
    "cloudreve://my/a#fragment",
    "cloudreve://my/%00",
    "cloudreve://my/%zz",
    "cloudreve://my/a%2fb",
    "cloudreve://my/a%5cb",
  ]) {
    expect(browserLink(uri, account)).toBeUndefined();
  }

  expect(
    webLocations({ items: ["cloudreve://my/a", null, 3, "cloudreve://unknown/a"] }, {}),
  ).toEqual({ items: ["/my/a", null, 3, "[internal location unavailable]"] });
});

it("adds useful browser links only to human output while preserving JSON", () => {
  const file = {
    name: "a",
    path: "cloudreve://my/a",
    displayPath: "/my/a",
    id: "f",
    type: 0,
    size: 1,
  };

  const human = format(file, false, false, false, "UTC", {
    ...account,
    command: "stat",
  });

  expect(human).toContain("/my/a");
  expect(human).toContain("https://files.example/home?");
  expect(human).toContain("open=f");
  expect(human).not.toContain("cloudreve://");

  const json = JSON.parse(format(file, true, false, false, "UTC", account));

  expect(json.data.path).toBe(file.path);
  expect(json.data.browser).toBeUndefined();
  expect(format(undefined, false)).toBe("");

  const status = format(
    {
      accounts: [
        {
          name: "work",
          endpoint: account.endpoint,
          email: "a@example.test",
          authenticated: true,
          active: true,
        },
        { name: "home", accountId: "b", authenticated: false, active: false },
      ],
    },
    false,
    false,
    false,
    "UTC",
    { command: "auth status" },
  );

  expect(status).toContain("ACCOUNT");
  expect(status).toContain("work");
  expect(status).toContain("a@example.test");
  expect(status).toContain("Signed out");

  expect(
    format({ accounts: [] }, false, false, false, "UTC", {
      command: "auth status",
    }),
  ).toContain("No saved accounts");

  expect(
    format({ profile: "work", endpoint: account.endpoint }, false, false, false, "UTC", {
      command: "auth switch",
    }),
  ).toContain("Active account switched");
});

it("keeps listings focused on entries and leaves file content bytes intact", async () => {
  const listing = context(["ls", "/my/"]);

  listing.c.config.profiles[listing.c.name] = {
    ...listing.c.config.profiles[listing.c.name]!,
    ...account,
  };

  await dispatch(listing.c);
  expect(listing.stdout()).not.toContain("Browser:");
  expect(listing.stdout()).not.toContain("https://");
  expect(listing.stdout()).toContain("NAME");
  expect(listing.stdout()).toContain("a");
  expect(listing.stdout()).not.toContain("cloudreve://");

  const raw = context(["cat", "/my/a"]);

  await dispatch(raw.c);
  expect(raw.stdout()).toBe("\u0001");
});

it("opens flat collections at their root instead of inventing directory or name routes", () => {
  for (const namespace of ["trash", "shared_with_me"]) {
    for (const type of [undefined, 0, 1]) {
      const link = new URL(
        browserLink(`cloudreve://${namespace}/opaque-id`, account, {
          type,
          id: "file",
        })!,
      );

      expect(link.searchParams.get("path")).toBe(`cloudreve://${namespace}/`);
      expect(link.searchParams.has("open")).toBe(false);
    }
  }
});

it("follows shared-folder destinations without putting their password in browser links", () => {
  const output = format(
    {
      name: "Shared",
      path: "cloudreve://my/Shared",
      displayPath: "/my/Shared",
      type: 1,
      metadata: {
        "sys:shared_redirect": "cloudreve://share-id:secret@share/Folder",
      },
    },
    false,
    false,
    false,
    "UTC",
    { ...account, command: "stat" },
  );

  expect(output).toContain("/my/Shared");

  const browser = output.split("\n").find((line) => line.includes("Browser"))!;
  const link = new URL(browser.match(/https?:\/\/\S+/)![0]);

  expect(link.searchParams.get("path")).toBe("cloudreve://share-id@share/Folder");
  expect(output).not.toContain("secret");
  expect(output).not.toContain("cloudreve://");
});

it("preserves apostrophes and encoded delimiters in complete URI fields", () => {
  const uri = "cloudreve://my/Alex's%23notes%20%26%20rate%25.txt";
  const link = new URL(webLocations(uri, account) as string);
  const path = new URL(link.searchParams.get("path")!);

  expect(path.searchParams.get("name")).toBe("Alex's#notes & rate%.txt");
  expect(path.hash).toBe("");

  expect(webLocations("Location: cloudreve://my/a", account)).toContain(
    "Location: https://files.example/home?",
  );
});
