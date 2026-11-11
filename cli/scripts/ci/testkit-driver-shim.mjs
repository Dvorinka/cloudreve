// Some CI runners (KERN) launch job containers with an explicit --hostname,
// so os.hostname() cannot resolve the job's own docker container and
// @cloudreve/testkit's linuxDockerDriver() asserts before the suite starts.
// e2e.mjs statically imports the driver via require-linux.mjs, so the patch
// must land on disk before that process runs. The resolved job container id
// is baked into the installed driver file here; job containers that share a
// network namespace (--network host or --network container:*) cannot join
// the fixture bridge, so the driver's runner transport is disabled for them
// and fixtures fall back to published loopback ports, which a host-networked
// job reaches directly. On non-container hosts nothing is resolved and the
// file is left untouched. Written via rename so a hardlinked install cache
// is never mutated.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const driverFile = fileURLToPath(
  new URL("../../node_modules/@cloudreve/testkit/dist/linux-docker.js", import.meta.url),
);

// KERN names job containers kern-job-<workspace-uuid>-N; the workspace
// basename identifies our own container on the shared daemon.
function resolveJobContainer() {
  if (process.env.CR_JOB_CONTAINER) {
    return process.env.CR_JOB_CONTAINER;
  }

  if (!existsSync("/.dockerenv") && !existsSync("/run/.containerenv")) {
    return undefined;
  }

  const workspace = basename(process.env.GITHUB_WORKSPACE ?? "");

  if (!workspace || workspace === "/" || workspace === ".") {
    return undefined;
  }

  try {
    return (
      execFileSync("docker", ["ps", "-q", "--filter", `name=kern-job-${workspace}`], {
        encoding: "utf8",
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

const jobContainer = resolveJobContainer();

console.log("e2e job container:", jobContainer ?? "unresolved (host run)");

if (jobContainer) {
  const id = JSON.stringify(jobContainer);
  const source = readFileSync(driverFile, "utf8");

  if (!source.includes("runnerInfo")) {
    const declaration = 'const runner = container ? inspect("container", hostname()) : null;';

    const check =
      'assert(runner?.Id.startsWith(hostname()) && runner.State.Running, "Cannot identify current Linux job container");';

    assert(
      source.includes(declaration) && source.includes(check),
      "Testkit driver layout changed; update this shim",
    );

    const tmp = `${driverFile}.${process.pid}.tmp`;

    writeFileSync(
      tmp,
      source
        .replace(
          declaration,
          `const runnerInfo = container ? inspect("container", ${id}) : null;\n` +
            '    const runner = /^(host|container:.*)$/.test(runnerInfo?.HostConfig?.NetworkMode ?? "") ? null : runnerInfo;',
        )
        .replace(
          check,
          `assert(runnerInfo?.Id.startsWith(${id}) && runnerInfo.State.Running, "Cannot identify current Linux job container");`,
        ),
    );

    renameSync(tmp, driverFile);
    console.log("patched testkit driver with job container id");
  }
}
