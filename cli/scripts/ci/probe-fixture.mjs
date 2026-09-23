import { startCommunity, communityIO } from "@cloudreve/testkit/community";
import { Authentication, tokensFromPassword, validateServerVersion } from "@cloudreve/sdk/session";
import { createClient } from "@cloudreve/sdk";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { linuxDockerDriver } from "./docker-fixture.mjs";

const version = process.env.CR_CI_VERSION ?? "4.19.1";

const matrix = JSON.parse(
  await readFile(new URL("../../docs/compatibility-matrix.json", import.meta.url), "utf8"),
);

const target = matrix.targets.find((target) => target.version === version);

assert(target, "Unknown fixture version");

const runId = process.env.CR_CI_RUN_ID ?? `cli-ci-${randomUUID()}`;
const directory = resolve(".runtime/ci", runId);

await mkdir(directory, { recursive: true, mode: 0o700 });

const io = linuxDockerDriver(runId);
let lease;
let sdk;
let receipt;

try {
  lease = await startCommunity(
    {
      output: join(directory, "fixture.json"),
      owner: process.cwd(),
      role: "test",
      image: target.image,
    },
    { driver: io.driver, seed: communityIO.seed },
  );

  const credentials = JSON.parse(await readFile(lease.manifest.credentialsFile, "utf8"));
  const auth = new Authentication(lease.manifest.endpoint, fetch);
  const server = await validateServerVersion(lease.manifest.endpoint, fetch);

  assert.equal(server.version, version);

  const login = await auth.password(credentials.email, credentials.password);

  assert.equal(login.kind, "authenticated");

  let tokens = tokensFromPassword(login.session.token);

  sdk = await createClient({
    endpoint: lease.manifest.endpoint,
    accountId: login.session.user.id,
    transport: fetch,
    storageTransport: fetch,
    tokens: () => tokens,
    saveTokens: (next) => {
      tokens = next;
    },
  });

  const bytes = Buffer.from("Real Linux shared-daemon fixture bytes\n");
  const file = await sdk.files.create("cloudreve://my/", "probe.txt", "file");

  await sdk.files.saveText(await sdk.files.readText(file.path, fetch), bytes.toString());

  const [url] = await sdk.files.urls([file.path]);
  const response = await fetch(url);

  assert(response.ok);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);

  const publishedBefore = io.inspectBackend(lease.manifest).NetworkSettings.Ports;

  await io.driver.control(lease.manifest, "stop");
  await io.driver.control(lease.manifest, "start");

  const publishedAfter = io.inspectBackend(lease.manifest).NetworkSettings.Ports;
  const [restartedUrl] = await sdk.files.urls([file.path]);
  const restartedResponse = await fetch(restartedUrl);

  assert(restartedResponse.ok);
  assert.deepEqual(Buffer.from(await restartedResponse.arrayBuffer()), bytes);

  const callbackUrl = `http://${io.runnerAddress(lease.manifest)}:${new URL(lease.manifest.endpoint).port}/api/v4/site/config/login`;

  const callback = JSON.parse(
    (
      await promisify(execFile)(
        "docker",
        ["exec", lease.manifest.containerId, "wget", "-qO-", "-T", "5", callbackUrl],
        { timeout: 10000 },
      )
    ).stdout,
  );

  assert.equal(callback.code, 0, "Backend cannot reach its owned runner callback route");

  const info = io.inspectBackend(lease.manifest);

  receipt = {
    passed: true,
    runnerMode: io.runnerMode,
    workerCallbackPassed: true,
    restartBytesPassed: true,
    publishedBefore,
    publishedAfter,
    version: server.version,
    platform: "linux/amd64",
    requestedImage: target.image,
    actualImageReference: info.Config.Image,
    actualImageId: info.Image,
    bytesSha256: createHash("sha256").update(bytes).digest("hex"),
    cleanupPassed: false,
    fallbackCleanupPassed: false,
  };

  sdk.session.invalidate();

  execFileSync("bash", ["scripts/ci/cleanup.sh"], {
    env: { ...process.env, CR_CI_RUN_ID: runId, CR_CI_CLEANUP_PARENT: "0" },
    stdio: "pipe",
    timeout: 120000,
  });

  assert(await io.driver.absent(lease.manifest), "Fallback cleanup left owned resources");
  receipt.fallbackCleanupPassed = true;
} finally {
  sdk?.session.invalidate();

  if (lease) {
    await lease.close();
    assert(await io.driver.absent(lease.manifest), "Owned fixture resources remain");

    if (receipt) {
      receipt.cleanupPassed = true;
    }
  }
}

assert(receipt);
await mkdir(".artifacts/ci", { recursive: true });
await writeFile(`.artifacts/ci/fixture-probe-${version}.json`, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
