import assert from "node:assert/strict";
import { readFile, copyFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { startCommunity, communityIO } from "@cloudreve/testkit/community";
import { metadataFixture } from "@cloudreve/testkit/metadata-fixture";
import { guestArchiveFixture } from "@cloudreve/testkit/guest-archive-fixture";
import { Authentication, tokensFromPassword, validateServerVersion } from "@cloudreve/sdk/session";
import { createClient } from "@cloudreve/sdk";
import { docker, linuxDockerDriver } from "./docker-fixture.mjs";
import { requireLinux } from "./require-linux.mjs";
import { commands } from "./commands.mjs";
import { services } from "./services.mjs";

requireLinux();
assert.equal(process.arch, "x64", "The pinned matrix certifies Linux amd64 only");

const matrix = JSON.parse(
  await readFile(new URL("../../docs/compatibility-matrix.json", import.meta.url), "utf8"),
);

const coverage = JSON.parse(await readFile(new URL("./coverage.json", import.meta.url), "utf8"));
const version = process.env.CR_CI_VERSION ?? matrix.targets[0].version;
const target = matrix.targets.find((item) => item.version === version);

assert(target, "CR_CI_VERSION must select a pinned matrix target");

const runId = process.env.CR_CI_RUN_ID ?? `cli-ci-${randomUUID()}`;
const directory = resolve(".runtime/ci", runId);

await mkdir(directory, { recursive: true, mode: 0o700 });

const humanMode = process.env.CR_CI_HUMAN === "1";

assert(target.expectation === "supported", "E2E requires a supported Community target");

const artifacts = resolve(".artifacts/ci", version, ...(humanMode ? ["human"] : []));

await mkdir(artifacts, { recursive: true });

const temp = await mkdtemp(join(tmpdir(), "cloudreve-cli-e2e-"));
const io = linuxDockerDriver(runId);
let lease;
let sdk;
let runner;

const receipt = {
  passed: false,
  version,
  platform: "linux/amd64",
  runnerMode: io.runnerMode,
  runId,
  parentRunId: process.env.CR_CI_PARENT_RUN_ID ?? runId,
  cleanupPassed: false,
};

try {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));

  receipt.dependencies = {};

  for (const name of ["@cloudreve/sdk", "@cloudreve/testkit"]) {
    const reference = manifest.dependencies?.[name] ?? manifest.devDependencies[name];

    const installed = JSON.parse(
      await readFile(resolve("node_modules", name, "package.json"), "utf8"),
    );

    assert(
      reference.startsWith("https://github.com/cloudreve/"),
      "Dependencies must use published releases",
    );

    assert.equal(installed.name, name);

    assert(
      reference.includes(`/v${installed.version}/`),
      "Installed dependency must match its release",
    );

    receipt.dependencies[name] = { reference, version: installed.version };
  }

  const binary = process.env.CR_CI_BINARY ? resolve(process.env.CR_CI_BINARY) : undefined;
  let installed = resolve("dist");

  if (binary) {
    receipt.binarySha256 = createHash("sha256")
      .update(await readFile(binary))
      .digest("hex");

    receipt.binaryFile = binary.split(/[\\/]/).at(-1);
  } else {
    execFileSync("npm", ["pack", "--pack-destination", temp, "--ignore-scripts"], {
      stdio: "pipe",
      timeout: 120000,
    });

    const tar = join(temp, `cloudreve-cli-${manifest.version}.tgz`);

    receipt.packageSha256 = createHash("sha256")
      .update(await readFile(tar))
      .digest("hex");

    receipt.packageFile = `cloudreve-cli-${receipt.packageSha256.slice(0, 12)}.tgz`;
    await copyFile(tar, join(artifacts, receipt.packageFile));
    await writeFile(join(temp, "package.json"), '{"private":true}');

    execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tar], {
      cwd: temp,
      stdio: "pipe",
      timeout: 120000,
    });

    installed = join(temp, "node_modules/cloudreve-cli/dist");
  }

  const { commandPaths } = await import(pathToFileURL(join(installed, "program.js")).href);

  assert.deepEqual(
    commandPaths().sort(),
    [...coverage.requiredCommands].sort(),
    "Command surface differs from declared command paths",
  );

  receipt.commandPaths = commandPaths();

  runner = commands({
    bin: binary ?? join(installed, "bin.js"),
    binary: Boolean(binary),
    temp,
    config: join(temp, "config"),
    ...coverage,
  });

  for (const path of coverage.removedCommands) {
    const result = await runner.run(path, [], { expect: 2 });

    assert.equal(JSON.parse(result.stderr).error.kind, "usage");
  }

  receipt.removedCommandRejections = coverage.removedCommands.length;

  lease = await startCommunity(
    {
      output: join(directory, "fixture.json"),
      owner: process.cwd(),
      role: "test",
      image: target.image,
    },
    { driver: io.driver, seed: communityIO.seed },
  );

  const fixture = lease.manifest;

  runner.navigation(fixture.endpoint);

  receipt.navigationOrigin =
    "Fixture-origin browser links normalize the ephemeral origin to https://cloud.example.test; navigation paths are retained, capability URLs remain redacted.";

  const credentials = JSON.parse(await readFile(fixture.credentialsFile, "utf8"));

  runner.secret(credentials.email, credentials.password);

  const discovered = await validateServerVersion(fixture.endpoint, fetch);

  assert.equal(discovered.version, version);

  const info = io.inspectBackend(fixture);

  Object.assign(receipt, {
    requestedImage: target.image,
    actualImageReference: info.Config.Image,
    actualImageId: info.Image,
    serverVersion: discovered.version,
  });

  await runner.run("profile add", [
    "primary",
    "--server",
    fixture.endpoint,
    "--credential-store",
    "file",
  ]);

  const primaryConfig = JSON.parse(await readFile(join(temp, "config", "config.json"), "utf8"))
    .profiles.primary;

  assert.equal(new URL(primaryConfig.endpoint).origin, new URL(fixture.endpoint).origin);
  assert.equal(primaryConfig.credentialStore, "file");
  runner.prove("profile add", "default", "Created an isolated profile for this owned server");

  const auth = new Authentication(fixture.endpoint, fetch);

  await runner.run("auth login", ["--email", credentials.email, "--password-stdin"], {
    input: credentials.password,
  });

  runner.prove(
    "auth login",
    "default",
    "Actual password session accepted by the pinned Community backend",
  );

  const login = await auth.password(credentials.email, credentials.password);

  assert.equal(login.kind, "authenticated");

  let tokens = tokensFromPassword(login.session.token);

  runner.secret(tokens.accessToken, tokens.refreshToken);

  sdk = await createClient({
    endpoint: fixture.endpoint,
    accountId: login.session.user.id,
    transport: fetch,
    storageTransport: fetch,
    tokens: () => tokens,
    saveTokens: (next) => {
      tokens = next;
    },
  });

  const diagnostics = await runner.run("diagnostics", ["--online"]);

  assert.equal(diagnostics.data.runtime.platform, "linux");
  assert.equal(diagnostics.data.runtime.arch, "x64");
  assert.match(diagnostics.data.runtime.node, /^v\d+\.\d+\.\d+/);

  assert.equal(diagnostics.data.online, true);

  assert.equal(
    diagnostics.data.configuredProfiles,
    Object.keys((await runner.run("profile list", [])).data.profiles).length,
  );

  assert.equal(diagnostics.data.profile.name, "primary");
  assert.equal(diagnostics.data.profile.accountId, login.session.user.id);
  assert.equal(diagnostics.data.profile.authentication, "password");

  assert.equal(new URL(diagnostics.data.profile.endpoint).origin, new URL(fixture.endpoint).origin);

  for (const secret of [credentials.password, tokens.accessToken, tokens.refreshToken]) {
    assert(!diagnostics.stdout.includes(secret), "Diagnostics disclosed credentials");
  }

  runner.prove(
    "diagnostics",
    "default",
    "Online diagnostic confirms runtime metadata and primary account binding without credentials",
  );

  const request = sdk.session.request.bind(sdk.session);

  await request("/api/v4/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({ settings: { siteURL: fixture.endpoint } }),
  });

  const configured = await metadataFixture(request);

  await guestArchiveFixture(request);

  const support = await services(io, fixture, sdk, matrix.services);

  receipt.auxiliaries = support.auxiliaries;

  const root = await sdk.files.create("cloudreve://my/", `ci-${randomUUID()}`, "folder");
  const remoteRoot = "/my/" + root.name;

  const context = {
    ...runner,
    requiredCommands: coverage.requiredCommands,
    sdk,
    fixture,
    credentials,
    temp,
    config: join(temp, "config"),
    version,
    io,
    support,
    authentication: auth,
    capabilities: { trashEmpty: target.capabilities.trashEmpty },
    remoteRoot,
    sdkRoot: root.path,
    customProperty: configured.properties?.find((item) => item.id === "parity_text"),
    path: (relative = "") => remoteRoot + (relative ? "/" + relative : ""),
    uri: (relative = "") => root.path.replace(/\/$/, "") + (relative ? "/" + relative : ""),
    bytes: async (relative) => {
      const [url] = await sdk.files.urls([root.path.replace(/\/$/, "") + "/" + relative]);
      const response = await fetch(url);

      assert(response.ok);

      return Buffer.from(await response.arrayBuffer());
    },
  };

  const selected = humanMode ? "human" : process.env.CR_CI_SCENARIO;

  assert(
    !selected || ["files", "account", "accounts", "operations", "jobs", "human"].includes(selected),
    "Unknown partial scenario",
  );

  for (const name of selected ? [selected] : ["files", "account", "operations", "accounts"]) {
    console.log(`Running ${name} against Community ${version}`);

    const packet = await import(`./scenarios/${name}.mjs`);

    await packet[name](context);
  }

  if (humanMode) {
    receipt.humanMode = true;
    runner.complete();
  } else if (selected) {
    receipt.partialScenario = selected;
  } else {
    runner.complete();
  }

  receipt.passed = true;
} catch (error) {
  const errors = error instanceof AggregateError ? [error, ...error.errors] : [error];

  receipt.error = errors
    .map((item) => runner?.safe(item.stack ?? item.message) ?? String(item))
    .join("\nCaused by: ");

  if (lease) {
    try {
      await writeFile(
        join(directory, "backend-failure.log"),
        docker(["logs", "--tail", "160", lease.manifest.containerId]) ?? "",
        { mode: 0o600 },
      );
    } catch {
      receipt.diagnosticCaptureFailed = true;
    }
  }

  process.exitCode = 1;
} finally {
  runner?.stop();
  sdk?.session.invalidate();

  try {
    if (lease) {
      await lease.close();
      assert(await io.driver.absent(lease.manifest), "Owned fixture cleanup left resources");
    }

    receipt.cleanupPassed = true;
  } catch (error) {
    receipt.passed = false;
    receipt.cleanupError = runner?.safe(error.message) ?? String(error);
    process.exitCode = 1;
  } finally {
    receipt.invocations = runner?.invocations ?? [];
    receipt.proofs = runner?.proofs ?? [];
    receipt.transcripts = runner?.transcripts ?? [];
    await writeFile(join(artifacts, "acceptance.json"), JSON.stringify(receipt, null, 2));
    await rm(temp, { recursive: true, force: true });
  }
}

console.log(
  JSON.stringify({
    passed: receipt.passed,
    version,
    commandCount: receipt.commandPaths?.length ?? 0,
    proofCount: receipt.proofs.length,
    packageSha256: receipt.packageSha256,
    binarySha256: receipt.binarySha256,
    cleanupPassed: receipt.cleanupPassed,
  }),
);

if (!receipt.passed) {
  console.error(receipt.error ?? receipt.cleanupError);
}
