import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("offline child-process commands do not create config or consume piped input", () => {
  const temp = mkdtempSync(join(tmpdir(), "cr-process-"));

  try {
    for (const args of [["--help"], ["--version"], ["help", "share"], ["ls", "--help"]]) {
      const r = spawnSync(process.execPath, [resolve("dist/bin.js"), ...args], {
        env: {
          ...process.env,
          CLOUDREVE_CONFIG_DIR: join(temp, "unused"),
          NO_COLOR: "1",
          TERM: "dumb",
        },
        input: "unrequested input",
        encoding: "utf8",
        timeout: 5000,
      });

      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
      expect(r.stdout).not.toContain("\u001b");
      expect(existsSync(join(temp, "unused"))).toBe(false);
    }

    const bad = spawnSync(
      process.execPath,
      [resolve("dist/bin.js"), "rm", "/trash/x", "--json", "--password-stdin"],
      { input: "ignored", encoding: "utf8", timeout: 5000 },
    );

    expect(bad.status).toBe(2);
    expect(bad.stdout).toBe("");
    expect(JSON.parse(bad.stderr).error.kind).toBe("usage");
  } finally {
    rmSync(temp, { recursive: true });
  }
});

it("real PTY confirmation accepts explicit yes and redirected invocation cannot prompt", () => {
  const temp = mkdtempSync(join(tmpdir(), "cr-pty-"));
  const bin = resolve("dist/bin.js");

  try {
    const flags = ["--config-dir", temp];

    const create = spawnSync(
      process.execPath,
      [
        bin,
        "profile",
        "add",
        "p",
        "--server",
        "https://example.test",
        "--credential-store",
        "file",
        ...flags,
      ],
      { encoding: "utf8" },
    );

    expect(create.status).toBe(0);

    const no = spawnSync(process.execPath, [bin, "profile", "remove", "p", ...flags], {
      input: "y\n",
      encoding: "utf8",
      timeout: 5000,
    });

    expect(no.status).toBe(2);
    expect(no.stderr).toContain("Interactive input unavailable");

    if (process.platform === "win32") {
      return;
    }

    const yes = spawnSync(
      "python3",
      [
        "-c",
        `
import os, pty, sys
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
output = b''
sent = False
try:
    while True:
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        output += data
        if b'(y/N)' in output and not sent:
            os.write(fd, b'y\\n')
            sent = True
finally:
    os.close(fd)
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(output)
sys.exit(os.waitstatus_to_exitcode(status))
`,
        process.execPath,
        bin,
        "profile",
        "remove",
        "p",
        ...flags,
      ],
      { encoding: "utf8", timeout: 5000 },
    );

    expect(yes.status, yes.stderr).toBe(0);
    expect(yes.stdout).toContain("(y/N)");
    expect(yes.stdout).not.toContain("Interactive input unavailable");
  } finally {
    rmSync(temp, { recursive: true });
  }
});
