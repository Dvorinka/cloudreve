import { afterEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { commands } from "../../scripts/ci/commands.mjs";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("requires actual invocations and explicit command and variant oracles", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ci-recorder-"));

  dirs.push(temp);

  const bin = join(temp, "cli.mjs");

  await writeFile(bin, "console.log(JSON.stringify({schemaVersion:1,data:{ok:true}}))");

  const recorder = commands({
    bin,
    temp,
    config: join(temp, "config"),
    requiredCommands: ["share open"],
    requiredVariants: [{ path: "share open", variant: "link" }],
  });

  expect(() => recorder.prove("share open", "default", "not run")).toThrow("No invocation");

  const result = await recorder.run("share open");

  expect(result.data).toEqual({ ok: true });
  expect(() => recorder.complete()).toThrow("Missing real command");
  recorder.prove("share open", "default", "Observed expected output");
  expect(() => recorder.complete()).toThrow("Missing simplified");
  await recorder.run("share open", [], { variant: "link" });
  recorder.prove("share open", "link", "Observed link outcome");
  expect(() => recorder.complete()).not.toThrow();
  recorder.secret("private-password");

  expect(recorder.safe("private-password https://example.test/signed?key=secret")).toBe(
    "[redacted] [URL]",
  );
});

it("retains a nonzero process result without granting operation proof", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ci-recorder-"));

  dirs.push(temp);

  const bin = join(temp, "cli.mjs");

  await writeFile(bin, 'process.stderr.write("controlled failure");process.exitCode=2');

  const recorder = commands({
    bin,
    temp,
    config: join(temp, "config"),
    requiredCommands: ["ls"],
    requiredVariants: [],
  });

  expect((await recorder.run("ls", [], { expect: 2 })).status).toBe(2);
  expect(() => recorder.complete()).toThrow();
});

it("captures human argv and output, redacts secrets, and labels binary bytes", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ci-human-recorder-"));

  dirs.push(temp);

  const bin = join(temp, "cli.mjs");

  await writeFile(
    bin,
    `if(process.argv.includes('binary'))process.stdout.write(Buffer.from([0,255]));else {process.stdout.write('Saved private-value\\n');process.stderr.write('https://example.test/private\\n');}`,
  );

  const recorder = commands({
    bin,
    temp,
    config: join(temp, "config"),
    requiredCommands: [],
    requiredVariants: [],
  });

  recorder.secret("private-value");

  await recorder.run("write", ["private-value"], {
    json: false,
    input: "private-input",
  });

  await recorder.run("cat", ["binary"], { json: false });

  expect(recorder.transcripts).toMatchObject([
    {
      path: "write",
      stdout: "Saved [redacted]\n",
      stderr: "[URL]\n",
      binary: false,
      input: "[stdin supplied; contents omitted]",
    },
    { path: "cat", stdout: null, binary: true, stdoutBytes: 2 },
  ]);

  expect(JSON.stringify(recorder.transcripts)).not.toContain("private-input");
  expect(JSON.stringify(recorder.transcripts)).not.toContain("private-value");
  expect(JSON.stringify(recorder.transcripts)).not.toContain("--json");
});

it.skipIf(process.platform === "win32")(
  "captures real TTY width and ANSI with stdin and stderr kept off the terminal",
  async () => {
    const temp = await mkdtemp(join(tmpdir(), "ci-pty-recorder-"));

    dirs.push(temp);

    const bin = join(temp, "cli.mjs");

    await writeFile(
      bin,
      `import assert from 'node:assert/strict';assert.equal(process.stdout.isTTY,true);assert.equal(process.stdout.columns,100);assert(!process.stdin.isTTY);assert(!process.stderr.isTTY);process.stdout.write(process.env.NO_COLOR ? 'Plain\\n' : '\\x1b[1mStyled\\x1b[0m\\n');`,
    );

    const recorder = commands({
      bin,
      temp,
      config: join(temp, "config"),
      requiredCommands: [],
      requiredVariants: [],
    });

    const colored = await recorder.run("ls", [], {
      json: false,
      tty: true,
      columns: 100,
    });

    expect(colored.stdout.toString()).toBe("\x1b[1mStyled\x1b[0m\n");

    const plain = await recorder.run("ls", [], {
      json: false,
      tty: true,
      noColor: true,
      columns: 100,
    });

    expect(plain.stdout.toString()).toBe("Plain\n");

    expect(recorder.transcripts).toMatchObject([
      { terminal: { columns: 100, color: true } },
      { terminal: { columns: 100, color: false } },
    ]);
  },
);

it("preserves only fixture browser navigation while redacting capability URLs", () => {
  const recorder = commands({
    bin: "unused",
    temp: "/tmp",
    config: "/tmp",
    requiredCommands: [],
    requiredVariants: [],
  });

  recorder.navigation("http://localhost:43210");

  const link = new URL("http://localhost:43210/home");

  link.searchParams.set("path", "cloudreve://user@my/?name=note.txt");
  link.searchParams.set("open", "file-id");
  expect(recorder.safe(link.href)).toBe("https://cloud.example.test" + link.pathname + link.search);

  for (const unsafe of [
    link.href.replace("localhost", "elsewhere.test"),
    link.href + "&token=secret",
    "http://localhost:43210/file/download?sign=secret",
    "http://localhost:43210/home?path=cloudreve%3A%2F%2Fid%3Apassword%40share%2F",
    "http://localhost:43210/home?path=cloudreve%3A%2F%2Fmy%2F%3Ftoken%3Dsecret",
    "http://localhost:43210/home?path=invalid",
  ]) {
    expect(recorder.safe(unsafe)).toBe("[URL]");
  }
});

it("executes a binary directly without a JavaScript runtime prefix", async () => {
  const temp = await mkdtemp(join(tmpdir(), "ci-binary-recorder-"));

  dirs.push(temp);

  const recorder = commands({
    bin: process.execPath,
    binary: true,
    temp,
    config: join(temp, "config"),
    requiredCommands: ["-e"],
    requiredVariants: [],
  });

  const result = await recorder.run("-e", [
    "console.log(JSON.stringify({schemaVersion:1,data:{direct:true}}))",
    "--",
  ]);

  expect(result.data).toEqual({ direct: true });
});
