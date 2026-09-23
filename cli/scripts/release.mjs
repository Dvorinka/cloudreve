import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { verifyBinary } from "./binary-probe.mjs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const output = resolve(".artifacts/release");
const temp = mkdtempSync(join(tmpdir(), "cloudreve-release-"));
const extension = process.platform === "win32" ? ".exe" : "";
const platform = { linux: "linux", darwin: "macos", win32: "windows" }[process.platform];

const tar =
  process.platform === "win32"
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";

const run = (command, args) => execFileSync(command, args, { stdio: "inherit", timeout: 180000 });

try {
  mkdirSync(output, { recursive: true });

  const bundle = join(temp, "bundle");
  const executable = join(bundle, "cloudreve-cli" + extension);

  mkdirSync(bundle);
  run("bun", ["scripts/build-binary.mjs", executable]);

  if (process.platform === "darwin") {
    run("codesign", ["--force", "--sign", "-", executable]);
  }

  copyFileSync(executable, join(bundle, "cr" + extension));
  copyFileSync("LICENSE", join(bundle, "LICENSE"));
  copyFileSync("README.md", join(bundle, "README.md"));

  const name = `cloudreve-cli-${manifest.version}-${platform}-${process.arch}.tar.gz`;
  const archive = join(output, name);

  run(tar, ["-czf", archive, "-C", bundle, "."]);

  const extracted = join(temp, "extracted with spaces");

  mkdirSync(extracted);
  run(tar, ["-xzf", archive, "-C", extracted]);

  assert.deepEqual(
    readdirSync(extracted).sort(),
    ["LICENSE", "README.md", "cloudreve-cli" + extension, "cr" + extension].sort(),
  );

  for (const command of ["cloudreve-cli", "cr"]) {
    await verifyBinary(join(extracted, command + extension), manifest.version);
  }

  writeFileSync(
    archive + ".sha256",
    `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  ${name}\n`,
  );

  console.log(`Built and verified ${archive}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
