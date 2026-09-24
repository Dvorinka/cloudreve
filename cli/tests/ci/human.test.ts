import { expect, it, vi } from "vitest";
import { humanRunner, type CommandCall } from "../../scripts/ci/scenarios/human.mjs";

it("runs each human mutation once, obtains created IDs through read-only queries", async () => {
  let created = false;

  const run = vi.fn<CommandCall>(async (path, _args, options = {}) => {
    if (path === "share create") {
      expect(options.json).toBe(false);
      expect(created).toBe(false);
      created = true;

      return { status: 0, stdout: Buffer.from("Share created\n"), stderr: "" };
    }

    expect(options.json).toBe(true);

    return {
      data:
        path === "share list"
          ? { shares: created ? [{ id: "new" }] : [] }
          : { id: "new", url: "https://fixture.test/s/new" },
    };
  });

  const result = await humanRunner({ run })("share create", ["/my/note.txt"]);

  expect(result.data).toMatchObject({ id: "new" });
  expect(run.mock.calls.filter(([path]) => path === "share create")).toHaveLength(1);
});

it("keeps read-only structured assertions separate from recorded human stdout", async () => {
  const run = vi.fn<CommandCall>(async (_path, _args, options = {}) =>
    options.json
      ? { data: [{ name: "note.txt" }] }
      : { stdout: Buffer.from("file  note.txt\n"), status: 0 },
  );

  const result = await humanRunner({ run })("ls", ["/my/"]);

  expect(result.stdout?.toString()).toBe("file  note.txt\n");
  expect(result.data).toEqual([{ name: "note.txt" }]);
  expect(run).toHaveBeenCalledTimes(2);
});

it("rejects a raw JSON fallback in human mode", async () => {
  const run = vi.fn<CommandCall>(async () => ({
    stdout: Buffer.from('{"files":[]}\n'),
    stderr: "",
    status: 0,
  }));

  await expect(humanRunner({ run })("ls", ["/my/"])).rejects.toThrow("raw JSON");
});

it("resolves a named human login from its newly activated account", async () => {
  const run = vi.fn<CommandCall>(async (path, _args, options = {}) => {
    if (path === "auth login") {
      return {
        stdout: Buffer.from("Signed in as work\n"),
        stderr: "",
        status: 0,
      };
    }

    expect(path).toBe("auth status");
    expect(options.profile).toBe("work");

    return { data: { accountId: "second-user" } };
  });

  const result = await humanRunner({ run })(
    "auth login",
    ["--name", "work", "--server", "https://cloud.example.test"],
    { profile: "primary" },
  );

  expect(result.data).toEqual({ account: { id: "second-user" } });
  expect(run).toHaveBeenCalledTimes(2);
});
