import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { createProgram } from "../../src/program.js";
import { compose } from "../../src/composition.js";
import { dispatch } from "../../src/main.js";
import { State } from "../../src/platform/state.js";
import type { Terminal } from "../../src/platform/terminal.js";

it("runs Commander login and file commands through real SDK HTTP with separate terminal streams", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cr-http-"));
  const state = new State(dir);

  await state.write("config.json", {
    version: 1,
    selected: "test",
    profiles: {
      test: { endpoint: "https://cloudreve.test", credentialStore: "file" },
    },
  });

  let output = "";

  const io: Terminal = {
    write: async (value) => {
      output += String(value);
    },
    diagnostic: async () => {
      throw Error("unexpected diagnostic");
    },
    input: async () => Buffer.from("not-a-real-password"),
    secret: async () => {
      throw Error("unexpected prompt");
    },
    confirm: async () => false,
  };

  const server = setupServer(
    http.get("https://cloudreve.test/api/v4/site/config/:section", () =>
      HttpResponse.json({ code: 0, data: { login_captcha: false } }),
    ),
    http.get("https://cloudreve.test/api/v4/site/ping", () =>
      HttpResponse.json({ code: 0, data: "4.19.0-alpha.1-pro" }),
    ),
    http.get("https://cloudreve.test/api/v4/session/prepare", () =>
      HttpResponse.json({ code: 0, data: { password_enabled: true } }),
    ),
    http.post("https://cloudreve.test/api/v4/session/token", async ({ request }) => {
      expect(await request.json()).toMatchObject({
        email: "me@example.test",
        password: "not-a-real-password",
      });

      return HttpResponse.json({
        code: 0,
        data: {
          user: { id: "account", nickname: "Name" },
          token: {
            access_token: "test-access",
            refresh_token: "test-refresh",
            access_expires: "2030-01-01",
            refresh_expires: "2031-01-01",
          },
        },
      });
    }),
    http.get("https://cloudreve.test/api/v4/file/info", ({ request }) => {
      expect(request.headers.get("Authorization")).toBe("Bearer test-access");
      expect(new URL(request.url).searchParams.get("uri")).toBe("cloudreve://my/a");

      return HttpResponse.json({
        code: 0,
        data: {
          id: "file",
          name: "a",
          path: "cloudreve://my/a",
          type: 0,
          size: 4,
          created_at: "",
          updated_at: "",
        },
      });
    }),
  );

  server.listen({ onUnhandledRequest: "error" });

  try {
    const invoke = async (args: string[]) => {
      output = "";

      await createProgram(async (inv) => {
        const c = await compose(inv, io, new AbortController().signal);

        try {
          await dispatch(c);
        } finally {
          await c.dispose();
        }
      }).parseAsync([...args, "--config-dir", dir, "--json", "--no-prompt"], {
        from: "user",
      });

      return JSON.parse(output);
    };

    const login = await invoke(["auth", "login", "--email", "me@example.test", "--password-stdin"]);

    expect(login.data.account.id).toBe("account");
    expect(output).not.toContain("test-access");

    const file = await invoke(["stat", "/my/a"]);

    expect(file.data.displayPath).toBe("/my/a");
    expect(file.data.size).toBe(4);
  } finally {
    server.close();
    rmSync(dir, { recursive: true });
  }
});

it("uses the real anonymous SDK without consulting account credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cr-public-"));
  const state = new State(dir);

  await state.write("config.json", {
    version: 1,
    selected: "public",
    profiles: {
      public: {
        id: "public",
        endpoint: "https://cloudreve.test",
        credentialStore: "native",
      },
    },
  });

  let calls = 0;
  let output = "";

  const server = setupServer(
    http.get("https://cloudreve.test/api/v4/site/ping", () =>
      HttpResponse.json({ code: 0, data: "4.18.0" }),
    ),
    http.get("https://cloudreve.test/api/v4/file/info", ({ request }) => {
      calls++;
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("cookie")).toBeNull();
      expect(new URL(request.url).searchParams.get("uri")).toBe("cloudreve://id:private@share/a");

      return HttpResponse.json({
        code: 0,
        data: {
          id: "f",
          name: "a",
          path: "cloudreve://id:private@share/a",
          type: 0,
          size: 1,
        },
      });
    }),
  );

  server.listen({ onUnhandledRequest: "error" });

  try {
    const { parse } = await import("../../src/program.js");

    const io: Terminal = {
      write: async (data) => {
        output += String(data);
      },
      diagnostic: async () => {},
      input: async () => Buffer.from("private\n"),
      secret: async () => {
        throw Error("unexpected prompt");
      },
      confirm: async () => false,
    };

    const c = await compose(
      parse([
        "stat",
        "/share/id/a",
        "--guest",
        "--share-password-stdin",
        "--config-dir",
        dir,
        "--json",
      ]),
      io,
      new AbortController().signal,
    );

    await dispatch(c);
    expect(calls).toBe(1);
    expect(output).not.toContain("private");
    await c.dispose();

    await expect(
      compose(
        parse(["stat", "/share/id/a", "--guest", "--share-password-stdin", "--config-dir", dir]),
        { ...io, input: async () => Buffer.from("") },
        new AbortController().signal,
      ),
    ).rejects.toThrow("must not be empty");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("blocks incompatible authenticated, guest, login and direct-link operations before backend work", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cr-version-"));
  const state = new State(dir);

  await state.write("config.json", {
    version: 1,
    selected: "p",
    profiles: {
      p: {
        id: "p",
        endpoint: "https://version.test",
        accountId: "a",
        credentialStore: "file",
      },
    },
  });

  let version = "4.16.1";
  let probes = 0;
  let unexpected = 0;
  let inputReads = 0;

  const server = setupServer(
    http.get("https://version.test/api/v4/site/ping", ({ request }) => {
      probes++;
      expect(request.headers.get("authorization")).toBeNull();

      return HttpResponse.json({ code: 0, data: version });
    }),
    http.all("https://version.test/*", () => {
      unexpected++;

      return new HttpResponse(null, { status: 500 });
    }),
  );

  server.listen({ onUnhandledRequest: "error" });

  const io: Terminal = {
    write: async () => {},
    diagnostic: async () => {},
    input: async () => {
      inputReads++;

      return Buffer.from("secret");
    },
    secret: async () => {
      throw Error("unexpected prompt");
    },
    confirm: async () => {
      throw Error("unexpected confirmation");
    },
  };

  const invoke = async (args: string[]) => {
    const { parse } = await import("../../src/program.js");

    const c = await compose(
      parse([...args, "--config-dir", dir]),
      io,
      new AbortController().signal,
    );

    try {
      return await dispatch(c);
    } finally {
      await c.dispose();
    }
  };

  try {
    for (const args of [
      ["stat", "/my/file"],
      ["stat", "/share/id/file", "--guest"],
      ["auth", "login", "--email", "a@example.test", "--password-stdin"],
      ["cp", "https://version.test/f/id/name", "local:/unused"],
    ]) {
      await expect(invoke(args)).rejects.toThrow("Cloudreve API compatibility");
    }

    expect(probes).toBe(4);
    expect(inputReads).toBe(0);
    expect(unexpected).toBe(0);
    version = "4.17.0";
    await expect(invoke(["trash", "empty", "--yes"])).rejects.toThrow("no deletion was attempted");
    expect(unexpected).toBe(0);
    version = "5.0.0";
    await expect(invoke(["server", "info"])).resolves.toBeUndefined();
  } finally {
    server.close();
    rmSync(dir, { recursive: true });
  }
});
