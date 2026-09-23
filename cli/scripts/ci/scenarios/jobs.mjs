import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { activeTask, canSelectTaskFiles, TaskStatus } from "@cloudreve/sdk/jobs";

// Encode only the fixture's integer/string/list/dictionary torrent metadata.
function bencode(value) {
  if (typeof value === "number") {
    return Buffer.from(`i${value}e`);
  }

  if (typeof value === "string" || Buffer.isBuffer(value)) {
    const bytes = Buffer.from(value);

    return Buffer.concat([Buffer.from(`${bytes.length}:`), bytes]);
  }

  return Buffer.concat([
    Buffer.from(Array.isArray(value) ? "l" : "d"),
    ...(Array.isArray(value)
      ? value.map(bencode)
      : Object.keys(value)
          .sort()
          .flatMap((key) => [bencode(key), bencode(value[key])])),
    Buffer.from("e"),
  ]);
}

/** Real worker downloads from a private, bounded Linux HTTP source. */
export async function jobs(c) {
  const body = Buffer.from("Cloudreve worker completion 雪\n");

  const timers = new Set();
  const owned = [];

  const server = createServer((request, response) => {
    const slow = ["/jobset/pending-a.bin", "/jobset/pending-b.bin"].includes(request.url);

    if (!slow && request.url !== "/complete.txt") {
      response.writeHead(404).end();

      return;
    }

    const size = slow ? 64 * 1024 * 1024 : body.length;
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Number(range[2]) : size - 1;

    if (start > end || end >= size) {
      response.writeHead(416).end();

      return;
    }

    response.writeHead(range ? 206 : 200, {
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });

    if (request.method === "HEAD" || !slow) {
      response.end(request.method === "HEAD" ? undefined : body.subarray(start, end + 1));

      return;
    }

    let remaining = end - start + 1;

    const timer = setInterval(() => {
      const chunk = Buffer.alloc(Math.min(4096, remaining), 65);

      remaining -= chunk.length;
      response.write(chunk);

      if (!remaining) {
        response.end();
      }
    }, 200);

    timers.add(timer);

    response.once("close", () => {
      clearInterval(timer);
      timers.delete(timer);
    });
  });

  const request = c.sdk.session.request.bind(c.sdk.session);
  const original = await request("/api/v4/admin/node/1");

  const savedSite = await request("/api/v4/admin/settings", {
    method: "POST",
    body: JSON.stringify({ keys: ["siteURL"] }),
  });

  const waitFor = async (task, predicate) => {
    let last;

    for (let attempt = 0; attempt < 360; attempt++) {
      const state = await c.sdk.jobs.get(task.id, task.type);

      last = state;

      if (predicate(state)) {
        return state;
      }

      assert(activeTask(state), `Worker ended unexpectedly: ${state.status}: ${state.error ?? ""}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(
      `Remote worker timed out: ${last.status}/${last.summary?.phase}/${last.summary?.props.download?.state}`,
    );
  };

  let failure;

  try {
    const address = await c.io.runnerAddress(c.fixture);

    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, address, resolve);
    });

    const source = `http://${address}:${server.address().port}`;
    const workerSite = new URL(c.fixture.endpoint);

    workerSite.hostname = address;
    c.secret(source);
    await c.support.set({ siteURL: `${workerSite},${savedSite.siteURL}` });

    await request("/api/v4/admin/node/1", {
      method: "PUT",
      body: JSON.stringify({
        node: {
          ...original,
          settings: {
            ...original.settings,
            interval: 1,
            wait_for_seeding: false,
            url_validation: { allowed_hosts: [address] },
            aria2: {
              ...original.settings.aria2,
              options: {
                ...original.settings.aria2?.options,
                "max-download-limit": "16K",
                "enable-peer-exchange": "false",
                "bt-enable-lpd": "false",
              },
            },
          },
        },
      }),
    });

    await c.sdk.files.create(c.sdkRoot, "jobs", "folder");

    const create = async (args, options) => {
      const result = await c.run("job create", [c.path("jobs"), ...args], options);

      assert.equal(result.data.length, 1);

      const task = result.data[0];

      assert.equal(task.type, "remote_download");
      assert(task.id);
      owned.push(task);

      return task;
    };

    const torrent = join(c.temp, "members.torrent");
    const piece = createHash("sha1").update(Buffer.alloc(16384, 65)).digest();

    await writeFile(
      torrent,
      bencode({
        info: {
          files: ["pending-a.bin", "pending-b.bin"].map((name) => ({
            length: 64 * 1024 * 1024,
            path: [name],
          })),
          name: "jobset",
          "piece length": 16384,
          pieces: Buffer.concat(Array.from({ length: 8192 }, () => piece)),
          private: 1,
        },
        "url-list": [source + "/"],
      }),
    );

    await c.run("cp", ["local:" + torrent, c.path("members.torrent")]);

    const pending = await create(["--torrent", c.path("members.torrent")]);

    // aria2 first reports the .torrent download itself, then follows its payload.
    const selectable = await waitFor(
      pending,
      (task) => canSelectTaskFiles(task) && task.summary.props.download.files.length === 2,
    );

    const listing = (await c.run("job list", ["--category", "downloading"])).data;

    assert(listing.tasks.some((task) => task.id === pending.id));
    c.prove("job list", "default", "Active worker ID appears in the downloading category");

    const viewed = (await c.run("job view", [pending.id, "--type", pending.type])).data;

    assert.equal(viewed.id, pending.id);
    assert(activeTask(viewed), `Job ended before view: ${viewed.status}: ${viewed.error ?? ""}`);
    assert.equal(viewed.summary.props.download.total, 128 * 1024 * 1024);
    c.prove("job view", "default", "Worker identity, active state and source byte size match");

    const index = selectable.summary.props.download.files[0].index;

    assert.equal(selectable.summary.props.download.files.length, 2);
    assert(selectable.summary.props.download.files.every((file) => file.selected));
    await c.run("job select", [pending.id, "--indices", String(index)]);

    const selected = await waitFor(pending, (task) => {
      const files = task.summary?.props.download?.files;

      return files?.length === 2 && files.every((file) => file.selected === (file.index === index));
    });

    await c.run("job select", [pending.id, "--indices", "2147483647"], {
      expect: "nonzero",
    });

    assert.deepEqual(
      (await c.sdk.jobs.get(pending.id, pending.type)).summary.props.download.files.map((file) => [
        file.index,
        file.selected,
      ]),
      selected.summary.props.download.files.map((file) => [file.index, file.selected]),
    );

    c.prove(
      "job select",
      "default",
      "Two real torrent members become one selected and one deselected; invalid index preserves that selection",
    );

    await c.run("job cancel", [pending.id, "--yes"]);
    await waitFor(pending, (task) => task.status === TaskStatus.canceled);

    for (const name of ["pending-a.bin", "pending-b.bin"]) {
      assert.equal(await c.sdk.files.infoIfExists(c.uri("jobs/jobset/" + name)), undefined);
    }

    c.prove(
      "job cancel",
      "default",
      "Worker reaches canceled state without publishing the partial file",
    );

    const finished = await create(["--sources-stdin"], {
      input: JSON.stringify([`${source}/complete.txt`]),
    });

    await waitFor(finished, (task) => task.status === TaskStatus.completed);
    assert.deepEqual(await c.bytes("jobs/complete.txt"), body);

    c.prove(
      "job create",
      "default",
      "Remote torrent starts a real selectable worker; URL input completes with exact owned source bytes",
    );
  } catch (error) {
    failure = error;
  }

  const errors = [];

  for (const task of owned) {
    try {
      const current = await c.sdk.jobs.get(task.id, task.type);

      if (activeTask(current)) {
        try {
          await c.sdk.jobs.cancel(current);
        } catch (error) {
          if (error.code !== 50005) {
            throw error;
          }
        }

        await waitFor(task, (state) => !activeTask(state));
      }
    } catch (error) {
      errors.push(error);
    }
  }

  for (const restore of [
    () =>
      request("/api/v4/admin/node/1", {
        method: "PUT",
        body: JSON.stringify({ node: original }),
      }),
    () => c.support.set({ siteURL: savedSite.siteURL }),
  ]) {
    try {
      await restore();
    } catch (error) {
      errors.push(error);
    }
  }

  for (const timer of timers) {
    clearInterval(timer);
  }

  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));

  if (errors.length) {
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...errors],
      "Remote job scenario or cleanup failed",
    );
  }

  if (failure) {
    throw failure;
  }
}
