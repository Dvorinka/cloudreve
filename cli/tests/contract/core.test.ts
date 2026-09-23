import { expect, it } from "vitest";
import { validate } from "../../src/main.js";
import { CliError, errorResult } from "../../src/output/errors.js";
import { entry, format, safe } from "../../src/output/format.js";
import { arg, commandPaths, flag, help, numberFlag, parse } from "../../src/program.js";
import { displayPath, remote, resolveOperand } from "../../src/paths.js";

it("discovers every command and rejects unknown parser inputs", () => {
  expect(commandPaths()).toHaveLength(75);

  for (const command of commandPaths()) {
    expect(help(command)).toContain("Usage: cr");
    expect(parse(["help", ...command.split(" ")]).flags.help).toBe(true);
  }

  expect(help("")).toContain("Cloudreve");
  expect(help("auth")).toContain("login [options]");
  expect(() => help("nothing")).toThrow();
  expect(parse([]).command).toBe("");
  expect(() => parse(["ls", "--wrong"])).toThrow(CliError);
  expect(parse(["ls", "--", "-name"]).args).toEqual(["-name"]);
});

it("validates required operands and flags", () => {
  const p = parse(["tag", "add", "名 space", "--name", "x", "--color", "#112233"]);

  expect(arg(p, 0)).toBe("名 space");
  expect(() => arg(p, 1)).toThrow();
  expect(flag(p, "name")).toBe("x");
  expect(() => flag(p, "key")).toThrow();
  expect(numberFlag(parse(["ls", "--limit", "3"]), "limit")).toBe(3);
  expect(numberFlag(p, "expire")).toBeUndefined();

  for (const value of ["-1", "1.5", "NaN"]) {
    expect(() => numberFlag(parse(["ls", "--limit", value]), "limit")).toThrow();
  }
});

it("guards input stream and command modes before composition", () => {
  for (const args of [
    ["wat"],
    ["cat", "x", "--json"],
    ["write", "x", "--input", "-", "--password-stdin"],
    ["ls", "--cwd", "relative"],
    ["ls", "--cwd", "//my"],
  ]) {
    expect(() => validate(parse(args))).toThrow();
  }

  validate(parse(["ls", "--cwd", "/my"]));
  validate(parse(["cat", "x"]));
});

it("maps literal paths and explicit local operands without losing bytes", () => {
  for (const path of ["/my/你好 a%?#", "/trash/id", "/shared_with_me/a", "/share/abc/你好"]) {
    const o = resolveOperand(path);

    expect(o.kind).toBe("remote");

    if (o.kind === "remote") {
      expect(displayPath(o.uri.toString())).toBe(path);
    }
  }

  expect(resolveOperand("/")).toEqual({ kind: "root", path: "/" });
  expect(resolveOperand("/share/")).toEqual({ kind: "root", path: "/share/" });

  expect(resolveOperand("local:C:\\Files\\%20")).toEqual({
    kind: "local",
    path: "C:\\Files\\%20",
  });

  expect(remote("a/./b/../c", "/my/work").path()).toBe("/work/a/c");
  expect(remote("/my//a///b/").path()).toBe("/a/b");
  expect(remote("cloudreve://my/a%20b").path()).toBe("/a b");
  expect(remote("/my/abc", undefined, true).fs()).toBe("my");
});

it("rejects ambiguous, credential-bearing and escaping paths", () => {
  for (const path of [
    "/my/../x",
    "/share/id/../x",
    "/other/x",
    "local:",
    "x\0",
    "/share/../x",
    "cloudreve://id:secret@share/a",
    "cloudreve://id@my/a",
    "cloudreve://share/a",
    "cloudreve://my/a%2Fb",
    "cloudreve://my/%ZZ",
    "cloudreve://my/%00",
    "cloudreve://my/a#x",
    "cloudreve://bad/a",
  ]) {
    expect(() => resolveOperand(path)).toThrow();
  }

  expect(() => resolveOperand("a", "relative")).toThrow();
  expect(() => remote("/")).toThrow();
  expect(() => remote("local:x")).toThrow();

  for (const path of ["/my/", "cloudreve://my/?name=x", "cloudreve://my/?category=image"]) {
    expect(() => remote(path, undefined, true)).toThrow();
  }

  expect(displayPath("invalid")).toBeUndefined();
});

it("serializes stable envelopes and strips sensitive fields recursively", () => {
  expect(JSON.parse(format(undefined, true))).toEqual({
    schemaVersion: 1,
    data: null,
  });

  expect(format(undefined, false)).toBe("");
  expect(format("ok", false)).toBe("ok\n");
  expect(format({ a: 1 }, false)).toContain("1");
  expect(format({ a: 1 }, false)).not.toMatch(/[{}]|"a"/);

  expect(safe({ token: "x", nested: [{ password: "x", ok: true }] })).toEqual({
    nested: [{ ok: true }],
  });

  expect(safe("cloudreve://x:secret@share/a")).toBe("cloudreve://x@share/a");
  expect(safe("cloudreve://[")).toBe("[invalid URI]");

  expect(entry({ id: "a", name: "a", path: "cloudreve://my/a", type: 0, size: 1 })).toMatchObject({
    displayPath: "/my/a",
  });
});

it("maps usage, auth, operation, correlation and unknown errors", () => {
  expect(errorResult(new CliError("usage", "bad")).status).toBe(2);
  expect(errorResult(Object.assign(new Error("expired"), { code: 401 })).status).toBe(4);

  expect(errorResult(Object.assign(new Error("failed"), { correlationId: "trace" }))).toMatchObject(
    { status: 1, error: { correlationId: "trace" } },
  );

  expect(errorResult(null).error.message).toBe("Operation failed");
});

it("rejects advanced URI traversal before URL normalization and synthetic cwd", () => {
  for (const input of [
    "cloudreve://my/../escape",
    "cloudreve://my/%2e%2e/escape",
    "cloudreve://my/a/../../escape",
    "cloudreve://id:@share/a",
  ]) {
    expect(() => resolveOperand(input)).toThrow();
  }

  expect(remote("cloudreve://my/a/../b").path()).toBe("/b");

  for (const cwd of ["/", "/share/", "/my/../trash"]) {
    expect(() => validate(parse(["ls", "--cwd", cwd]))).toThrow();
  }
});

it("preserves nonsecret pagination and structured item outcomes, reveals only explicit WebDAV password", () => {
  expect(
    safe({
      next_token: "cursor",
      password_protected: true,
      password: "secret",
    }),
  ).toEqual({ next_token: "cursor", password_protected: true });

  expect(
    errorResult(
      Object.assign(new Error("partial"), {
        aggregatedError: { a: "denied", password: "hidden" },
      }),
    ),
  ).toMatchObject({ status: 1, error: { outcomes: { a: "denied" } } });

  expect(JSON.parse(format({ id: "dav", password: "secret" }, true, true)).data.password).toBe(
    "secret",
  );

  expect(format({ password: "secret" }, false, true)).toContain("secret");
  expect(format("name", true, true)).not.toContain("password");
});

it("reports durable local logout separately from a remote revocation failure", () => {
  const result = errorResult(
    Object.assign(new Error("network unavailable"), {
      phase: "revocation",
      code: 401,
    }),
  );

  expect(result.status).toBe(1);
  expect(result.error.phase).toBe("revocation");
  expect(result.error.message).toContain("Signed out locally");

  expect(
    errorResult(Object.assign(new Error("disk denied"), { phase: "persistence" })).error.phase,
  ).toBe("persistence");
});

it("keeps protocol credentials redacted without retired token-disclosure commands", () => {
  expect(
    format(
      {
        access_token: "private",
        refresh_token: "refresh",
        session: { access_token: "nested" },
      },
      true,
    ),
  ).not.toContain("private");
});

it("rejects network ports in virtual Cloudreve namespace operands", async () => {
  const { resolveOperand } = await import("../../src/paths.js");

  expect(() => resolveOperand("cloudreve://my:123/a")).toThrow("Invalid remote path");
});

it("retains boolean sign-in capability metadata while hiding secret-shaped values", () => {
  expect(
    safe({
      passwordEnabled: true,
      passwordless: false,
      password_enabled: true,
      password: "hidden",
    }),
  ).toEqual({
    passwordEnabled: true,
    passwordless: false,
    password_enabled: true,
  });

  expect(safe({ passwordEnabled: "hidden", password_protected: "hidden" })).toEqual({});
});

it("redacts credential URLs in ordinary results and embedded diagnostics", () => {
  const input = "https://user:secret@example.test/path?token=private&other=hidden#token";
  const result = String(safe(input));

  expect(result).not.toContain("secret");
  expect(result).not.toContain("private");
  expect(result).not.toContain("hidden");
  expect(String(safe("failed at " + input))).not.toContain("private");
  expect(String(safe("https://example.test/s/id/password"))).toBe("https://example.test/s/id");
  expect(String(safe("ftp://user:secret@example.test/path?token=private"))).not.toContain("secret");
  expect(String(safe("magnet:?xt=private"))).not.toContain("private");

  expect(
    JSON.parse(format({ url: "https://example.test/archive?sign=signature" }, true, false, true))
      .data.url,
  ).toContain("signature");
});

it("preserves literal filename values when formatting entries", () => {
  expect(
    entry({
      id: "x",
      name: "magnet:?xt=name",
      path: "cloudreve://my/x",
      type: 0,
      size: 1,
    }),
  ).toMatchObject({ name: "magnet:?xt=name" });

  expect(safe("http:filename")).toBe("http:filename");
});

it("exposes validated lock capabilities only on explicit diagnostic request", () => {
  const error = Object.assign(new Error("Locked"), {
    code: 40073,
    data: [{ path: "cloudreve://my/a", token: "bearer-capability", type: 0 }, { type: 1 }],
  });

  expect(JSON.stringify(errorResult(error))).not.toContain("bearer-capability");
  expect(JSON.stringify(errorResult(error, true))).toContain("bearer-capability");
});

it("formats only human timestamps under an explicit timezone", () => {
  const data = { created_at: "2026-07-01T12:00:00Z" };

  expect(format(data, false, false, false, "America/New_York")).toContain("America/New_York");
  expect(JSON.parse(format(data, true, false, false, "America/New_York")).data).toEqual(data);
  expect(() => parse(["stat", "/my/a", "--timezone", "Not/A_Zone"])).toThrow("timezone");
});
