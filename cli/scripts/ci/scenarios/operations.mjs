import assert from "node:assert/strict";
import { writeFile, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check) {
  for (let i = 0; i < 160; i++) {
    const value = await check();

    if (value) {
      return value;
    }

    await wait(250);
  }

  throw new Error("Owned operation did not reach required state");
}

export async function operations(c) {
  const file = await c.sdk.files.create(c.sdkRoot, "indexed.txt", "file");
  const phrase = "cloudreveunique" + randomUUID().replaceAll("-", "");

  await c.sdk.files.saveText(await c.sdk.files.readText(file.path, fetch), phrase);

  await until(async () => {
    const result = await c.run("search", [phrase]);

    return result.data.hits?.some((hit) => hit.file.id === file.id);
  });

  c.prove("search", "default", "Indexed unique text resolves the exact owned file ID");

  const eventFolder = await c.sdk.files.create(c.sdkRoot, "events", "folder");

  let observed = "";
  let mutation;

  const watched = await c.run("watch", [c.path("events"), "--count", "2", "--timeout", "20000"], {
    json: !c.human,
    parseJson: false,
    onStdout: (chunk) => {
      observed += chunk.toString();

      if (observed.toLowerCase().includes("subscribed") && !mutation) {
        mutation = c.sdk.files.create(eventFolder.path, "event.txt", "file");
      }
    },
  });

  const createdEventFile = await mutation;

  assert(createdEventFile);

  if (c.human) {
    assert.match(watched.stdout.toString(), /Subscribed/);
    assert(watched.stdout.includes(createdEventFile.id));
    assert(watched.stdout.includes("/event.txt"));
  } else {
    const events = watched.stdout
      .toString()
      .trim()
      .split("\n")
      .map((line) => {
        const record = JSON.parse(line);

        assert.equal(record.schemaVersion, 1);

        return record.data;
      });

    assert(
      events.some(
        (event) =>
          event.type === "event" &&
          event.data.type === "create" &&
          event.data.file_id === createdEventFile.id &&
          event.data.from === "/event.txt",
      ),
    );
  }

  c.prove("watch", "default", "Actual subscription followed by owned file mutation event");

  const locked = await c.sdk.files.create(c.sdkRoot, "locked.txt", "file");
  const dav = await c.sdk.webdav.save({ name: "CI lock", uri: c.sdkRoot });

  c.secret(dav.password);

  const authorization =
    "Basic " + Buffer.from(`${c.credentials.email}:${dav.password}`).toString("base64");

  const response = await fetch(c.fixture.endpoint + "/dav/locked.txt", {
    method: "LOCK",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/xml",
      Depth: "0",
      Timeout: "Second-600",
    },
    body: '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>CLI acceptance</D:owner></D:lockinfo>',
    signal: AbortSignal.timeout(10000),
  });

  await response.body?.cancel();
  assert([200, 201].includes(response.status));

  const token = response.headers.get("lock-token")?.replace(/^<|>$/g, "");

  assert(token);
  c.secret(token);

  try {
    await assert.rejects(
      c.sdk.files.saveText(await c.sdk.files.readText(locked.path, fetch), "blocked"),
    );

    await c.run("unlock", ["--secrets-stdin", "--yes"], {
      input: JSON.stringify({ token }),
    });

    await c.sdk.files.saveText(await c.sdk.files.readText(locked.path, fetch), "unlocked");
    assert.equal((await c.bytes("locked.txt")).toString(), "unlocked");

    c.prove(
      "unlock",
      "default",
      "Real DAV lock blocked write; explicit token unlock permits exact bytes",
    );
  } finally {
    await c.sdk.webdav.revoke(dav.id);
  }

  const bytes = Buffer.alloc(4 * 1024 * 1024, 0x71);
  const source = join(c.temp, "transfer-source.bin");

  await writeFile(source, bytes);
  await c.run("cp", ["local:" + source, c.path("transfer-source.bin")]);

  const request = c.sdk.session.request.bind(c.sdk.session);
  const group = await request("/api/v4/admin/group/1");

  const speed = (limit) =>
    request("/api/v4/admin/group/1", {
      method: "PUT",
      body: JSON.stringify({ group: { ...group, speed_limit: limit } }),
    });

  async function paused(name) {
    let child;
    const destination = join(c.temp, name);

    const task = c.run("cp", [c.path("transfer-source.bin"), "local:" + destination], {
      expect: "nonzero",
      onStart: (value) => {
        child = value;
      },
    });

    task.catch(() => {});

    const record = await until(async () => {
      const list = (await c.run("transfer list", [])).data;

      return list.find((item) => item.local === destination && item.status === "pending");
    });

    await until(async () => {
      const names = (await readdir(c.temp)).filter(
        (value) => value.startsWith(name + ".cloudreve-") && value.endsWith(".part"),
      );

      return names.length === 1 && (await stat(join(c.temp, names[0]))).size > 0;
    });

    child.kill("SIGINT");
    await task;

    assert.equal(
      (await c.run("transfer list", [])).data.find((item) => item.id === record.id).status,
      "pending",
    );

    return { record, destination };
  }

  try {
    await speed(128 * 1024);

    const first = await paused("resume.bin");

    c.prove("transfer list", "default", "Actual interrupted byte transfer is retained pending");
    await speed(0);
    await c.run("transfer resume", [first.record.id]);
    assert.deepEqual(await readFile(first.destination), bytes);
    c.prove("transfer resume", "default", "Interrupted download resumes to exact source bytes");
    await c.run("transfer forget", [first.record.id]);
    assert(!(await c.run("transfer list", [])).data.some((item) => item.id === first.record.id));
    assert.deepEqual(await readFile(first.destination), bytes);
    c.prove("transfer forget", "default", "Finished record removed while exact local bytes remain");
    await speed(128 * 1024);

    const cancel = await paused("cancel.bin");

    await c.run("transfer cancel", [cancel.record.id, "--yes"]);

    assert.equal(
      (await c.run("transfer list", [])).data.find((item) => item.id === cancel.record.id).status,
      "cancelled",
    );

    await assert.rejects(stat(cancel.destination));

    c.prove(
      "transfer cancel",
      "default",
      "Pending download cancelled without publishing incomplete destination",
    );

    const failedDestination = join(c.temp, "retry.bin");

    const failed = c.run("cp", [c.path("transfer-source.bin"), "local:" + failedDestination], {
      expect: "nonzero",
    });

    failed.catch(() => {});

    const record = await until(async () =>
      (await c.run("transfer list", [])).data.find(
        (item) => item.local === failedDestination && item.status === "pending",
      ),
    );

    await c.io.driver.control(c.fixture, "stop");
    await failed;
    await c.io.driver.control(c.fixture, "start");

    assert.equal(
      (await c.run("transfer list", [])).data.find((item) => item.id === record.id).status,
      "failed",
    );

    await speed(0);
    await c.run("transfer retry", [record.id]);
    assert.deepEqual(await readFile(failedDestination), bytes);

    c.prove(
      "transfer retry",
      "default",
      "Stopped backend plus reset bridge connections produces a failed transfer that retries to exact bytes",
    );
  } finally {
    await c.io.driver.control(c.fixture, "start");
    await speed(group.speed_limit);
  }

  const { jobs } = await import("./jobs.mjs");

  await jobs(c);
}
