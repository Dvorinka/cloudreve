import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(".");
const tmp = mkdtempSync(join(tmpdir(), "cloudreve-cli-package-"));
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const windows = process.platform === "win32";

const npm = (args, cwd) =>
  execFileSync(
    windows ? process.execPath : "npm",
    windows ? [join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"), ...args] : args,
    { cwd, stdio: "pipe" },
  );

const invoke = (bin, args, options) =>
  windows
    ? spawnSync(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", `""${bin}.cmd" ${args.map((arg) => `"${arg}"`).join(" ")}"`],
        { ...options, windowsVerbatimArguments: true },
      )
    : spawnSync(bin, args, options);

try {
  npm(["pack", "--pack-destination", tmp, "--ignore-scripts"], root);

  const tar = join(tmp, `cloudreve-cli-${version}.tgz`);

  writeFileSync(join(tmp, "package.json"), '{"private":true}');

  npm(["install", "--ignore-scripts", "--no-audit", "--no-fund", tar], tmp);

  const require = createRequire(join(tmp, "package.json"));

  for (const name of ["@cloudreve/quality", "@cloudreve/testkit"]) {
    assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });
  }

  const outputs = [];

  for (const name of ["cr", "cloudreve-cli"]) {
    const bin = join(tmp, "node_modules", ".bin", name);

    for (const args of [["--help"], ["--version"], ["help", "auth"], ["ls", "--help"]]) {
      const r = invoke(bin, args, {
        cwd: tmp,
        encoding: "utf8",
        env: { ...process.env, CLOUDREVE_CONFIG_DIR: join(tmp, "unused") },
      });

      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, "");

      if (args[0] === "--help") {
        outputs.push(r.stdout);
      }
    }

    const bad = invoke(bin, ["unknown", "--json"], {
      cwd: tmp,
      encoding: "utf8",
    });

    assert.equal(bad.status, 2);
    assert.equal(JSON.parse(bad.stderr).error.kind, "usage");
  }

  assert.equal(outputs[0], outputs[1]);

  if (process.argv.includes("--native")) {
    const module = (name) =>
      JSON.stringify(
        pathToFileURL(join(tmp, "node_modules", "cloudreve-cli", "dist", "platform", name + ".js"))
          .href,
      );

    const proof = join(tmp, "native-proof.mjs");

    writeFileSync(
      proof,
      `import assert from 'node:assert/strict';import{Credentials}from ${module("credentials")};import{State}from ${module("state")};const c=new Credentials(new State(${JSON.stringify(join(tmp, "vault"))}));const value={proof:'disposable-not-a-real-secret'};for(const store of ${JSON.stringify(process.platform === "darwin" ? ["keychain", "native"] : ["native"])}){try{await c.put('package-proof',store,value);assert.deepEqual(await c.record('package-proof',store),value);}finally{await c.put('package-proof',store,null);}assert.equal(await c.record('package-proof',store),null);}console.log('Packed async Keychain and isolated native helpers passed');`,
    );

    process.stdout.write(
      execFileSync(process.execPath, [proof], {
        cwd: tmp,
        encoding: "utf8",
        timeout: 45000,
      }),
    );
  }

  console.log("Packed aliases and offline help/usage passed from clean consumer");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
