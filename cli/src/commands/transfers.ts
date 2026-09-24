import { CrUri } from "@cloudreve/sdk/files";
import {
  type DownloadCheckpoint,
  type GuestDownloadCheckpoint,
  parseGuestDownloadCheckpoint,
  parseDownloadJobs,
  parseUploadJobs,
  selectUploadPolicy,
  type UploadCheckpoint,
} from "@cloudreve/sdk/transfers";
import type { Context } from "../composition.js";
import { CliError, errorResult } from "../output/errors.js";
import { arg } from "../input.js";

interface Transfer {
  id: string;
  owner?: { id: string; pid: number };
  profile: string;
  direction: "upload" | "download";
  local: string;
  fingerprint?: string;
  partial?: string;
  overwrite: boolean;
  needsPassword?: boolean;
  authContext?: string;
  profileId?: string;
  credentialStore?: string;
  checkpoint: UploadCheckpoint | DownloadCheckpoint | GuestDownloadCheckpoint;
  status: "pending" | "failed" | "completed" | "cancelled";
  failure?: { message: string; at: string };
}

async function records(c: Context): Promise<Transfer[]> {
  const list = await c.state.read<Transfer[]>("transfers.json", []);

  return validateRecords(c, list);
}

function validateRecords(c: Context, list: unknown): Transfer[] {
  if (
    !Array.isArray(list) ||
    list.some(
      (t) =>
        !t ||
        typeof t.id !== "string" ||
        (t.owner !== undefined &&
          (!t.owner ||
            typeof t.owner.id !== "string" ||
            !t.owner.id ||
            !Number.isSafeInteger(t.owner.pid) ||
            t.owner.pid <= 0)) ||
        !["upload", "download"].includes(t.direction) ||
        !["pending", "failed", "completed", "cancelled"].includes(t.status) ||
        (t.status === "failed") !== (t.failure !== undefined) ||
        (t.failure !== undefined &&
          (!t.failure ||
            typeof t.failure.message !== "string" ||
            t.failure.message.length > 4096 ||
            typeof t.failure.at !== "string" ||
            !Number.isFinite(Date.parse(t.failure.at)))) ||
        (t.authContext !== undefined && (typeof t.authContext !== "string" || !t.authContext)) ||
        (t.profileId !== undefined && (typeof t.profileId !== "string" || !t.profileId)) ||
        (t.credentialStore !== undefined &&
          !["file", "keychain", "native"].includes(t.credentialStore)) ||
        typeof t.profile !== "string" ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(t.profile) ||
        typeof t.overwrite !== "boolean" ||
        (t.needsPassword !== undefined && typeof t.needsPassword !== "boolean") ||
        (t.direction === "upload" &&
          (typeof t.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(t.fingerprint))) ||
        (t.partial !== undefined && typeof t.partial !== "string") ||
        typeof t.local !== "string" ||
        !t.local ||
        !t.checkpoint,
    )
  ) {
    throw new CliError("state", "Invalid transfer state", 1);
  }

  const ids = new Set<string>();

  for (const t of list) {
    if (ids.has(t.id)) {
      throw new CliError("state", "Duplicate transfer ID");
    }

    ids.add(t.id);

    const job = {
      id: t.id,
      name: t.id,
      source: t.local,
      checkpoint: t.checkpoint,
      status: "paused",
      loaded: 0,
    };

    if (t.direction === "upload") {
      if ("scope" in t.checkpoint) {
        throw new CliError("state", "Upload checkpoint cannot have guest scope");
      }

      parseUploadJobs([job]);
    } else {
      if ("scope" in t.checkpoint) {
        parseGuestDownloadCheckpoint(t.checkpoint);
      } else {
        parseDownloadJobs([job]);
      }

      if (new CrUri(t.checkpoint.uri).password()) {
        throw new CliError("state", "Saved checkpoint must not contain a share password");
      }
    }

    if (t.partial) {
      c.bytes.assertPartialName(t.local, t.partial);
    }
  }

  return list as Transfer[];
}

// ponytail: short ledger transactions serialize metadata; use per-job files if history size or contention grows.
async function remember(c: Context, value: Transfer) {
  await c.state.transaction<Transfer[]>(
    "transfers.json",
    [],
    (stored) => {
      const all = validateRecords(c, stored);
      const previous = all.find((t) => t.id === value.id);

      if (previous?.status === "cancelled" && value.status !== "cancelled") {
        throw new CliError("cancelled", "Transfer was cancelled", 1);
      }

      return [...all.filter((t) => t.id !== value.id), value];
    },
    c.signal,
  );
}

async function withTransfer(
  c: Context,
  input: Transfer,
  operation: (claimed: Transfer) => Promise<unknown>,
  failedOnly = false,
): Promise<unknown> {
  let claimed: Transfer | undefined;

  await c.state.transaction<Transfer[]>(
    "transfers.json",
    [],
    (stored) => {
      const all = validateRecords(c, stored);
      const current = all.find((t) => t.id === input.id);

      if (
        !current ||
        current.profile !== c.name ||
        (failedOnly ? current.status !== "failed" : !["pending", "failed"].includes(current.status))
      ) {
        throw new CliError("transfer", "Transfer is not pending");
      }

      assertAccount(c, current);

      if (current.owner && c.isRunning(current.owner.pid)) {
        throw new CliError("busy", "Transfer already has an active writer", 1);
      }

      claimed = { ...current, owner: c.runOwner };

      return all.map((t) => (t.id === input.id ? claimed! : t));
    },
    c.signal,
  );

  try {
    return await operation(claimed!);
  } finally {
    await c.state.transaction<Transfer[]>("transfers.json", [], (stored) =>
      validateRecords(c, stored).map((t) => {
        if (t.id === input.id && t.owner?.id === c.runOwner.id) {
          delete t.owner;
        }

        return t;
      }),
    );
  }
}

function failureMessage(c: Context, error: unknown) {
  const message = errorResult(error).error.message;

  return (c.sharePassword ? message.split(c.sharePassword).join("[redacted]") : message).slice(
    0,
    4096,
  );
}

async function execute(c: Context, input: Transfer, failedOnly = false) {
  return withTransfer(
    c,
    input,
    async (claimed) => {
      claimed.status = "pending";
      delete claimed.failure;
      await remember(c, claimed);

      try {
        return await runTransfer(c, claimed);
      } catch (error) {
        if (!c.signal.aborted) {
          claimed.status = "failed";

          claimed.failure = {
            message: failureMessage(c, error),
            at: new Date().toISOString(),
          };

          await remember(c, claimed);
        }

        throw error;
      }
    },
    failedOnly,
  );
}

function cleanDownload<T extends DownloadCheckpoint | GuestDownloadCheckpoint>(checkpoint: T): T {
  const uri = new CrUri(checkpoint.uri);

  return uri.password() ? { ...checkpoint, uri: uri.withPassword("").toString() } : checkpoint;
}

async function runTransfer(c: Context, t: Transfer): Promise<unknown> {
  if (t.profile !== c.name) {
    throw new CliError("transfer", "Transfer belongs to another profile");
  }

  assertAccount(c, t);

  if (t.status !== "pending") {
    throw new CliError("transfer", "Transfer is not pending");
  }

  if (t.direction === "upload") {
    const b = await c.backend();
    const source = await c.bytes.source(t.local, c.signal);

    if (source.fingerprint !== t.fingerprint) {
      throw new CliError("transfer", "Local source changed; cancel and upload again");
    }

    await b.uploads.run(
      t.checkpoint as UploadCheckpoint,
      source,
      async (next) => {
        t.checkpoint = next;
        await remember(c, t);
      },
      () => {},
      c.signal,
    );
  } else {
    if (t.needsPassword && !c.sharePassword) {
      throw new CliError("input", "Resume this share with --share-password-stdin");
    }

    const checkpoint = t.checkpoint as DownloadCheckpoint | GuestDownloadCheckpoint;

    const bound =
      "scope" in checkpoint
        ? checkpoint
        : c.sharePassword && new CrUri(checkpoint.uri).fs() === "share"
          ? {
              ...checkpoint,
              uri: new CrUri(checkpoint.uri).withPassword(c.sharePassword).toString(),
            }
          : checkpoint;

    const sink = await c.bytes.destination(t.local, t.overwrite, t.partial);

    try {
      t.partial = sink.partial;
      await remember(c, t);

      const save = async (next: DownloadCheckpoint | GuestDownloadCheckpoint) => {
        t.checkpoint = cleanDownload(next);
        await remember(c, t);
      };

      if ("scope" in bound) {
        await (
          await c.publicBackend()
        ).downloads.run(bound, sink, save, () => {}, c.signal, {
          password: c.sharePassword,
        });
      } else {
        await (await c.backend()).downloads.run(bound, sink, save, () => {}, c.signal);
      }

      await sink.finish();
    } finally {
      await sink.close();
    }
  }

  t.status = "completed";
  await remember(c, t);

  return { id: t.id, status: t.status, direction: t.direction, local: t.local };
}

export async function prepareUpload(
  c: Context,
  size: number,
  target: CrUri,
  previous?: string,
): Promise<UploadCheckpoint> {
  const b = await c.backend();
  const parent = await b.files.list(target.parent().toString(), { page_size: 1 }, c.signal);

  if (!parent.storage_policy) {
    throw new CliError("capability", "Destination has no upload policy", 1);
  }

  const policy = selectUploadPolicy(parent.storage_policy);

  return b.uploads.create(
    {
      uri: target.toString(),
      size,
      policy_id: policy.id,
      encryption_supported: ["aes-256-ctr"],
      ...(previous ? { entity_type: "version" as const, previous } : {}),
    },
    policy.type,
    c.signal,
  );
}

export async function upload(
  c: Context,
  local: string,
  target: CrUri,
  previous?: string,
): Promise<unknown> {
  const source = await c.bytes.source(local, c.signal);
  const b = await c.backend();
  const checkpoint = await prepareUpload(c, source.size, target, previous);

  const t: Transfer = {
    id: c.bytes.uniqueId(),
    profile: c.name,
    profileId: c.connection().id,
    credentialStore: c.inv.flags.guest ? undefined : c.connection().credentialStore,
    authContext: c.inv.flags.guest ? undefined : c.connection().authContext,
    direction: "upload",
    local: source.path,
    fingerprint: source.fingerprint,
    overwrite: false,
    checkpoint,
    status: "pending",
  };

  try {
    await remember(c, t);
  } catch (e) {
    await b.uploads.cancel(checkpoint);

    throw e;
  }

  return execute(c, t);
}

export async function download(c: Context, uri: CrUri, local: string): Promise<unknown> {
  const checkpoint = c.inv.flags.guest
    ? await (await c.publicBackend()).downloads.prepare(uri.toString())
    : await (await c.backend()).downloads.prepare(uri.toString());

  const t: Transfer = {
    id: c.bytes.uniqueId(),
    profile: c.name,
    profileId: c.connection().id,
    credentialStore: c.inv.flags.guest ? undefined : c.connection().credentialStore,
    authContext: c.inv.flags.guest ? undefined : c.connection().authContext,
    direction: "download",
    local: await c.bytes.downloadPath(local, checkpoint.name),
    overwrite: !!c.inv.flags.overwrite,
    needsPassword: !!uri.password(),
    checkpoint: cleanDownload(checkpoint),
    status: "pending",
  };

  await remember(c, t);

  return execute(c, t);
}

function scoped(c: Context, values: Transfer[]) {
  return values.filter((t) => {
    if (t.profile !== c.name) {
      return false;
    }

    const p = c.connection();

    return (
      t.checkpoint.endpoint === p.endpoint &&
      (!t.profileId || t.profileId === p.id) &&
      ("scope" in t.checkpoint
        ? !!c.inv.flags.guest
        : !c.inv.flags.guest &&
          t.checkpoint.accountId === p.accountId &&
          t.authContext === p.authContext &&
          (!t.credentialStore || t.credentialStore === p.credentialStore))
    );
  });
}

export async function transferList(c: Context) {
  return scoped(c, await records(c)).map((t) => ({
    id: t.id,
    direction: t.direction,
    local: t.local,
    status: t.status,
    ...(t.failure ? { failure: t.failure } : {}),
  }));
}

export async function transferRetry(c: Context) {
  const allFailed = !!c.inv.flags["all-failed"];
  const ids = [...new Set(c.inv.args)];

  if (allFailed === !!ids.length) {
    throw new CliError("usage", "Choose explicit failed transfer IDs or --all-failed");
  }

  const failed = scoped(c, await records(c)).filter((t) => t.status === "failed");

  const targets = allFailed
    ? failed
    : ids.map((id) => {
        const target = failed.find((t) => t.id === id);

        if (!target) {
          throw new CliError("transfer", "Unknown failed transfer in the selected profile");
        }

        return target;
      });

  if (targets.some((t) => t.needsPassword) && !c.sharePassword) {
    throw new CliError("input", "Retry protected shares with --share-password-stdin");
  }

  const outcomes: { id: string; status: string; error?: unknown }[] = [];

  for (const target of targets) {
    c.signal.throwIfAborted();

    try {
      await execute(c, target, true);
      outcomes.push({ id: target.id, status: "completed" });
    } catch (error) {
      if (c.signal.aborted) {
        throw error;
      }

      outcomes.push({
        id: target.id,
        status: "failed",
        error: {
          ...errorResult(error).error,
          message: failureMessage(c, error),
        },
      });
    }
  }

  if (outcomes.some((item) => item.status === "failed")) {
    throw new CliError(
      "partial",
      "Some transfers failed; successful retries are preserved",
      1,
      outcomes,
    );
  }

  return { retried: outcomes.length, outcomes };
}

async function selected(c: Context) {
  const t = (await records(c)).find((t) => t.profile === c.name && t.id === arg(c.inv, 0));

  if (!t) {
    throw new CliError("transfer", "Unknown transfer");
  }

  return t;
}

export async function transferForget(c: Context) {
  const id = arg(c.inv, 0);

  await c.state.transaction<Transfer[]>(
    "transfers.json",
    [],
    (stored) => {
      const all = validateRecords(c, stored);
      const target = all.find((t) => t.profile === c.name && t.id === id);

      if (!target) {
        throw new CliError("transfer", "Unknown transfer");
      }

      assertAccount(c, target);

      if (
        ["pending", "failed"].includes(target.status) ||
        (target.owner && c.isRunning(target.owner.pid))
      ) {
        throw new CliError(
          "transfer",
          "Cancel or finish the active transfer before forgetting its record",
        );
      }

      return all.filter((t) => t.id !== id);
    },
    c.signal,
  );

  return { id, forgotten: true };
}

export async function transferResume(c: Context) {
  const target = await selected(c);

  if (target.needsPassword && !c.sharePassword) {
    throw new CliError("input", "Resume this share with --share-password-stdin");
  }

  return execute(c, target);
}

export async function transferCancel(c: Context) {
  const selectedTransfer = await selected(c);

  assertAccount(c, selectedTransfer);
  await c.confirm(`Cancel transfer ${selectedTransfer.id}`);

  return withTransfer(c, selectedTransfer, async (current) => {
    if (current.direction === "upload") {
      await (await c.backend()).uploads.cancel(current.checkpoint as UploadCheckpoint, c.signal);
    } else if (current.partial) {
      await c.bytes.removePartial(current.local, current.partial);
    }

    current.status = "cancelled";
    delete current.failure;
    await remember(c, current);

    return { id: current.id, status: current.status };
  });
}

function assertAccount(c: Context, t: Transfer): void {
  const p = c.connection();

  if (t.profileId && t.profileId !== p.id) {
    throw new CliError("transfer", "Transfer belongs to another profile identity");
  }

  if ("scope" in t.checkpoint) {
    if (!c.inv.flags.guest || t.checkpoint.endpoint !== p.endpoint) {
      throw new CliError("transfer", "Transfer belongs to another endpoint or guest scope");
    }

    return;
  }

  if (
    c.inv.flags.guest ||
    t.authContext !== p.authContext ||
    (t.credentialStore !== undefined && t.credentialStore !== p.credentialStore) ||
    t.checkpoint.accountId !== p.accountId ||
    t.checkpoint.endpoint !== p.endpoint
  ) {
    throw new CliError("transfer", "Transfer belongs to another account lifetime");
  }
}
