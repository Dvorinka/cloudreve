import type { Context } from "../../src/composition.js";
import { parse } from "../../src/program.js";

async function transfer(c: Context) {
  const inv = parse([...c.inv.command.split(" "), ...c.inv.args]);

  return inv.execute!(c);
}

import { CrUri } from "@cloudreve/sdk/files";
import { errorResult } from "../../src/output/errors.js";
import { expect, it } from "vitest";
import { download, upload } from "../../src/commands/transfers.js";
import { context } from "./context.js";

it("persists acknowledged upload state, exposes safe listing, rejects reruns", async () => {
  const x = context();
  const result = (await upload(x.c, "/tmp/a", new CrUri("cloudreve://my/a"))) as { id: string };

  expect(result).toMatchObject({ status: "completed", direction: "upload" });
  expect(x.b.uploads.create).toHaveBeenCalled();
  x.c.inv.command = "transfer list";

  const listed = await transfer(x.c);

  expect(JSON.stringify(listed)).not.toContain("checkpoint");
  x.c.inv = { command: "transfer resume", args: [result.id], flags: {} };
  await expect(transfer(x.c)).rejects.toThrow("pending");
  x.c.inv.command = "transfer cancel";
  await expect(transfer(x.c)).rejects.toThrow("pending");
  expect(x.b.uploads.cancel).not.toHaveBeenCalled();
});

it("retains resumable partials and safely resumes/cancels by selected profile", async () => {
  const x = context();

  x.b.downloads.run.mockRejectedValueOnce(new Error("interrupted"));

  await expect(download(x.c, new CrUri("cloudreve://my/a"), "/tmp/out")).rejects.toThrow(
    "interrupted",
  );

  const pending = (x.data["transfers.json"] as { id: string }[])[0]!;

  x.c.inv = { command: "transfer resume", args: [pending.id], flags: {} };
  await transfer(x.c);
  expect(x.raw.bytes.destination).toHaveBeenLastCalledWith("/tmp/out", false, "/tmp/partial");

  const y = context();

  y.b.downloads.run.mockRejectedValueOnce(new Error("interrupted"));
  await expect(download(y.c, new CrUri("cloudreve://my/a"), "/tmp/out")).rejects.toThrow();

  const item = (y.data["transfers.json"] as { id: string }[])[0]!;

  y.c.inv = {
    command: "transfer cancel",
    args: [item.id],
    flags: { yes: true },
  };

  await transfer(y.c);
  expect(y.raw.bytes.removePartial).toHaveBeenCalledWith("/tmp/out", "/tmp/partial");
});

it("rejects corrupt state, missing/foreign transfer and changed local upload", async () => {
  for (const value of [{}, [null], [{ id: "x" }]]) {
    const x = context(["transfer", "list"]);

    x.data["transfers.json"] = value;
    await expect(transfer(x.c)).rejects.toThrow("Invalid");
  }

  await expect(transfer(context(["transfer", "resume", "missing"]).c)).rejects.toThrow("Unknown");

  const x = context();

  x.b.uploads.run.mockRejectedValueOnce(new Error("interrupted"));
  await expect(upload(x.c, "/tmp/a", new CrUri("cloudreve://my/a"))).rejects.toThrow();

  const t = (x.data["transfers.json"] as { id: string }[])[0]!;

  x.c.inv = { command: "transfer resume", args: [t.id], flags: {} };

  x.raw.bytes.source.mockResolvedValue({
    size: 1,
    path: "/tmp/a",
    fingerprint: "changed",
  });

  await expect(transfer(x.c)).rejects.toThrow("changed");
  x.c.inv.command = "transfer cancel";
  await transfer(x.c);
  expect(x.b.uploads.cancel).toHaveBeenCalled();
});

it("cancels newly created server sessions when state persistence fails", async () => {
  const x = context();

  x.raw.state.transaction.mockImplementation(() => {
    throw new Error("disk full");
  });

  await expect(upload(x.c, "/tmp/a", new CrUri("cloudreve://my/a"))).rejects.toThrow("disk full");
  expect(x.b.uploads.cancel).toHaveBeenCalled();

  const y = context();

  y.b.files.list.mockResolvedValue({
    files: [],
    pagination: { page: 0, page_size: 1 },
    props: {},
  } as never);

  await expect(upload(y.c, "/tmp/a", new CrUri("cloudreve://my/a"))).rejects.toThrow("policy");
});

it("validates foreign/corrupt checkpoints before opening or cancelling local sinks", async () => {
  const x = context();

  x.b.downloads.run.mockRejectedValueOnce(new Error("pause"));
  await expect(download(x.c, new CrUri("cloudreve://my/a"), "/tmp/out")).rejects.toThrow("pause");

  const original = structuredClone(x.data["transfers.json"]) as {
    id: string;
    checkpoint: { accountId: string };
    partial?: string;
    overwrite: boolean;
  }[];

  const id = original[0]!.id;

  for (const command of ["transfer resume", "transfer cancel"]) {
    x.data["transfers.json"] = structuredClone(original);
    (x.data["transfers.json"] as typeof original)[0]!.checkpoint.accountId = "other";
    x.c.inv = { command, args: [id], flags: { yes: true } };
    x.raw.bytes.destination.mockClear();
    await expect(transfer(x.c)).rejects.toThrow("account lifetime");
    expect(x.raw.bytes.destination).not.toHaveBeenCalled();
    expect(x.raw.bytes.removePartial).not.toHaveBeenCalled();
  }

  x.c.inv = { command: "transfer list", args: [], flags: {} };
  x.data["transfers.json"] = [original[0], original[0]];
  await expect(transfer(x.c)).rejects.toThrow("Duplicate");
  x.data["transfers.json"] = [{ ...original[0], overwrite: "yes" }];
  await expect(transfer(x.c)).rejects.toThrow("Invalid");
});

it("rejects concurrent writers for one job and recovers a dead owner without blocking another job", async () => {
  const x = context();

  x.b.downloads.run.mockRejectedValueOnce(Error("pause"));
  await expect(download(x.c, new CrUri("cloudreve://my/a"), "/tmp/out")).rejects.toThrow("pause");

  const rows = x.data["transfers.json"] as any[];

  rows[0].owner = { id: "other-run", pid: 456 };
  x.c.inv = { command: "transfer resume", args: [rows[0].id], flags: {} };
  x.raw.isRunning.mockReturnValue(true);
  x.raw.bytes.destination.mockClear();
  await expect(transfer(x.c)).rejects.toThrow("active writer");
  expect(x.raw.bytes.destination).not.toHaveBeenCalled();
  x.raw.isRunning.mockReturnValue(false);
  await transfer(x.c);
  expect((x.data["transfers.json"] as any[])[0].owner).toBeUndefined();
});

it("does not resurrect a cancelled job when a delayed upload acknowledgement arrives", async () => {
  const x = context();

  x.b.uploads.run.mockImplementation(async (job, _source, save) => {
    (x.data["transfers.json"] as any[])[0].status = "cancelled";
    await save(job);

    return job;
  });

  await expect(upload(x.c, "/tmp/a", new CrUri("cloudreve://my/a"))).rejects.toThrow("cancelled");
  expect((x.data["transfers.json"] as any[])[0].status).toBe("cancelled");
  expect((x.data["transfers.json"] as any[])[0].owner).toBeUndefined();
});

it("blocks a same-account-ID checkpoint from another backend before touching a partial", async () => {
  const x = context();

  x.b.downloads.run.mockRejectedValueOnce(Error("pause"));
  await expect(download(x.c, new CrUri("cloudreve://my/a"), "/tmp/out")).rejects.toThrow();

  const row = (x.data["transfers.json"] as any[])[0];

  row.checkpoint.endpoint = "https://other.test";
  x.c.inv = { command: "transfer resume", args: [row.id], flags: {} };
  x.raw.bytes.destination.mockClear();
  await expect(transfer(x.c)).rejects.toThrow("account lifetime");
  expect(x.raw.bytes.destination).not.toHaveBeenCalled();
});

it("forgets only completed/cancelled records in the current account without deleting bytes", async () => {
  const x = context();

  await upload(x.c, "/tmp/a", new CrUri("cloudreve://my/a"));

  const t = (x.data["transfers.json"] as any[])[0];

  x.c.inv = { command: "transfer forget", args: [t.id], flags: {} };
  t.owner = { id: "other", pid: 55 };
  x.raw.isRunning.mockReturnValue(true);
  await expect(transfer(x.c)).rejects.toThrow("active");
  x.raw.isRunning.mockReturnValue(false);
  t.status = "pending";
  await expect(transfer(x.c)).rejects.toThrow("active");
  t.status = "completed";
  t.checkpoint.accountId = "other";
  await expect(transfer(x.c)).rejects.toThrow("account");
  t.checkpoint.accountId = "a";
  expect(await transfer(x.c)).toEqual({ id: t.id, forgotten: true });
  expect(x.data["transfers.json"]).toEqual([]);
  expect(x.b.uploads.cancel).not.toHaveBeenCalled();
  expect(x.raw.bytes.removePartial).not.toHaveBeenCalled();
  await expect(transfer(x.c)).rejects.toThrow("Unknown");
});

it("claims cancellation after confirmation and cannot overwrite newer completion or another writer", async () => {
  const x = context();

  x.b.downloads.run.mockRejectedValueOnce(Error("interrupted"));
  await expect(download(x.c, new CrUri("cloudreve://my/a"), "/tmp/out")).rejects.toThrow();

  const record = () => (x.data["transfers.json"] as any[])[0];

  x.c.inv = parse(["transfer", "cancel", record().id, "--yes"]);

  x.raw.confirm.mockImplementation(async () => {
    record().status = "completed";
    delete record().failure;
  });

  await expect(transfer(x.c)).rejects.toThrow("pending");
  expect(record().status).toBe("completed");
  expect(x.raw.bytes.removePartial).not.toHaveBeenCalled();
  x.raw.confirm.mockResolvedValue(undefined);
  record().status = "pending";
  record().owner = { id: "active", pid: 44 };
  x.raw.isRunning.mockReturnValue(true);
  await expect(transfer(x.c)).rejects.toThrow("active writer");
  expect(record().owner.id).toBe("active");
  x.raw.isRunning.mockReturnValue(false);
  x.raw.bytes.removePartial.mockRejectedValueOnce(Error("disk busy"));
  await expect(transfer(x.c)).rejects.toThrow("disk busy");
  expect(record().status).toBe("pending");
  expect(record().owner).toBeUndefined();
  await transfer(x.c);
  expect(record().status).toBe("cancelled");
});

it("refuses transfer resume after profile identity, store or authorization context changes", async () => {
  for (const patch of [
    { id: "replacement" },
    { credentialStore: "keychain" as const },
    { authContext: "oauth:client:Files.Read" },
  ]) {
    const x = context();

    x.c.connection().id = "original";
    x.b.downloads.run.mockRejectedValueOnce(new Error("pause"));
    await expect(download(x.c, new CrUri("cloudreve://my/a"), "/tmp/out")).rejects.toThrow("pause");

    const t = (x.data["transfers.json"] as { id: string }[])[0]!;

    Object.assign(x.c.connection(), patch);
    x.raw.bytes.destination.mockClear();
    x.c.inv = { command: "transfer resume", args: [t.id], flags: {} };
    await expect(transfer(x.c)).rejects.toThrow(/another/);
    expect(x.raw.bytes.destination).not.toHaveBeenCalled();
  }
});

it("retries selected/all failed jobs while preserving paused and foreign jobs", async () => {
  const x = context();
  let counter = 0;

  x.raw.bytes.uniqueId = () => `job-${counter++}`;
  x.b.uploads.run.mockRejectedValueOnce(new Error("upload unavailable"));
  await expect(upload(x.c, "/tmp/a", new CrUri("cloudreve://my/a"))).rejects.toThrow();
  x.b.downloads.run.mockRejectedValueOnce(new Error("download unavailable"));
  await expect(download(x.c, new CrUri("cloudreve://my/a"), "/tmp/out")).rejects.toThrow();

  const all = x.data["transfers.json"] as any[];

  const paused = {
    ...structuredClone(all[0]),
    id: "paused",
    status: "pending",
  };

  delete paused.failure;

  const foreign = {
    ...structuredClone(all[0]),
    id: "foreign",
    profile: "other",
  };

  all.push(paused, foreign);
  x.c.inv = parse(["transfer", "retry", "--all-failed"]);
  expect(await transfer(x.c)).toMatchObject({ retried: 2 });
  expect((x.data["transfers.json"] as any[]).find((t) => t.id === "paused").status).toBe("pending");
  expect((x.data["transfers.json"] as any[]).find((t) => t.id === "foreign").status).toBe("failed");
  expect(await transfer(x.c)).toEqual({ retried: 0, outcomes: [] });
  x.c.inv = parse(["transfer", "retry", "paused"]);
  await expect(transfer(x.c)).rejects.toThrow("Unknown failed");

  for (const args of [[], ["job-0", "--all-failed"]]) {
    x.c.inv = parse(["transfer", "retry", ...args]);
    await expect(transfer(x.c)).rejects.toThrow("Choose");
  }
});

it("rechecks failed-only retry intent inside the claim after another invocation pauses the job", async () => {
  const x = context();

  x.b.uploads.run.mockRejectedValueOnce(new Error("unavailable"));
  await expect(upload(x.c, "/tmp/a", new CrUri("cloudreve://my/a"))).rejects.toThrow();
  x.b.uploads.run.mockClear();

  const transaction = x.raw.state.transaction.getMockImplementation()!;

  x.raw.state.transaction.mockImplementationOnce(async (name, fallback, update) => {
    const current = (x.data["transfers.json"] as any[])[0];

    current.status = "pending";
    delete current.failure;

    return transaction(name, fallback, update);
  });

  x.c.inv = parse(["transfer", "retry", "--all-failed"]);
  await expect(transfer(x.c)).rejects.toThrow();
  expect(x.b.uploads.run).not.toHaveBeenCalled();
  expect((x.data["transfers.json"] as any[])[0].status).toBe("pending");
  expect((x.data["transfers.json"] as any[])[0].owner).toBeUndefined();
});

it("preserves successful selected retries and exposes sanitized partial failures", async () => {
  const x = context();
  let counter = 0;

  x.raw.bytes.uniqueId = () => `job-${counter++}`;

  for (const kind of ["upload", "download"]) {
    if (kind === "upload") {
      x.b.uploads.run.mockRejectedValueOnce(new Error("first"));
      await expect(upload(x.c, "/tmp/a", new CrUri("cloudreve://my/a"))).rejects.toThrow();
    } else {
      x.b.downloads.run.mockRejectedValueOnce(new Error("second"));
      await expect(download(x.c, new CrUri("cloudreve://my/a"), "/tmp/out")).rejects.toThrow();
    }
  }

  x.b.downloads.run.mockRejectedValueOnce(new Error("still unavailable"));
  x.c.inv = parse(["transfer", "retry", "job-0", "job-1"]);

  try {
    await transfer(x.c);

    throw new Error("expected partial failure");
  } catch (error) {
    expect(errorResult(error)).toMatchObject({
      status: 1,
      error: {
        outcomes: [
          { id: "job-0", status: "completed" },
          { id: "job-1", status: "failed" },
        ],
      },
    });
  }

  expect((x.data["transfers.json"] as any[]).map((t) => t.status)).toEqual(["completed", "failed"]);
  x.c.inv = parse(["transfer", "retry", "job-1"]);
  expect(await transfer(x.c)).toMatchObject({ retried: 1 });
});

it("keeps explicit interruption paused, validates failure state and never persists a share password in errors", async () => {
  const x = context();

  x.c.inv.flags.guest = true;
  x.c.sharePassword = "PrivatePass42";
  x.publicClient.downloads.run.mockRejectedValueOnce(new Error("Denied PrivatePass42"));

  await expect(
    download(x.c, new CrUri("cloudreve://id:PrivatePass42@share/a"), "/tmp/out"),
  ).rejects.toThrow();

  expect(JSON.stringify(x.data)).not.toContain("PrivatePass42");
  x.c.inv = parse(["transfer", "list", "--guest"]);

  expect(await transfer(x.c)).toMatchObject([
    { status: "failed", failure: { message: "Denied [redacted]" } },
  ]);

  x.c.sharePassword = undefined;
  x.c.inv = parse(["transfer", "retry", "--all-failed", "--guest"]);
  await expect(transfer(x.c)).rejects.toThrow("password");
  x.c.sharePassword = "PrivatePass42";

  const controller = new AbortController();

  x.c.signal = controller.signal;

  x.publicClient.downloads.run.mockImplementationOnce(async () => {
    controller.abort();

    throw new Error("stop");
  });

  await expect(transfer(x.c)).rejects.toThrow("stop");

  const job = (x.data["transfers.json"] as any[])[0];

  expect(job.status).toBe("pending");
  expect(job.failure).toBeUndefined();

  const y = context(["transfer", "list"]);

  for (const failure of [
    null,
    { message: 1, at: "now" },
    { message: "x", at: "invalid" },
    { message: "x".repeat(4097), at: new Date().toISOString() },
  ]) {
    y.data["transfers.json"] = [{ ...job, status: "failed", failure }];
    await expect(transfer(y.c)).rejects.toThrow("Invalid");
  }
});
