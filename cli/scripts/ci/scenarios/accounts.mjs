import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Authentication } from "@cloudreve/sdk/session";

/** Two real users share one endpoint; every account selection is a fresh CLI process. */
export async function accounts(c) {
  const options = { profile: false };

  const call = async (path, args = [], extra = {}) => c.run(path, args, { ...options, ...extra });

  const config = async () => JSON.parse(await readFile(join(c.config, "config.json"), "utf8"));

  const initial = await config();
  const primary = initial.selected;

  assert(primary && initial.profiles[primary]?.accountId);

  const second = `personal-${randomUUID().slice(0, 8)}`;
  const failed = `failed-${randomUUID().slice(0, 8)}`;
  const email = `cli-${randomUUID()}@example.test`;
  const password = `Fixture-${randomUUID()}!`;

  c.secret(email, password);

  const auth = new Authentication(c.fixture.endpoint, fetch);

  assert.equal((await auth.register({ email, password })).status, "active");

  const before = await config();

  await call(
    "auth login",
    [
      "--name",
      failed,
      "--server",
      c.fixture.endpoint,
      "--credential-store",
      "file",
      "--email",
      email,
      "--password-stdin",
    ],
    { input: "deliberately-wrong-password", expect: "nonzero" },
  );

  assert.deepEqual(
    await config(),
    before,
    "Failed login must preserve selection and every saved account",
  );

  await call(
    "auth login",
    [
      "--name",
      second,
      "--server",
      c.fixture.endpoint,
      "--credential-store",
      "file",
      "--email",
      email,
      "--password-stdin",
    ],
    { input: password, variant: "add-account" },
  );

  assert.equal((await config()).selected, second);

  const status = (await call("auth status", [], { variant: "multiple-accounts" })).data;

  assert.equal(status.profile, second);
  assert(status.authenticated);
  assert.notEqual(status.accountId, initial.profiles[primary].accountId);
  assert.equal(status.accounts.filter((account) => account.active).length, 1);

  assert(
    status.accounts.some(
      (account) => account.name === primary && account.authenticated && !account.active,
    ),
  );

  c.prove(
    "auth login",
    "add-account",
    "Named login adds a distinct real user on the same server and activates that account only after successful authentication.",
  );

  c.prove(
    "auth status",
    "multiple-accounts",
    "A fresh CLI process reports both authenticated users and exactly one active saved account.",
  );

  const own = `Alex's #account-${randomUUID()}.txt`;
  const local = join(c.temp, "account-note.txt");
  const content = "Private account note\n";

  await writeFile(local, content);

  await call("cp", [`local:${local}`, `/my/${own}`], {
    variant: "account-owned-upload",
  });

  assert.equal((await call("cat", [`/my/${own}`], { json: false })).stdout.toString(), content);

  const navigation = await call("stat", [`/my/${own}`], {
    json: false,
    variant: "browser-link",
  });

  const output = navigation.stdout.toString();

  assert(!output.includes("cloudreve://"), "Human output must not expose a bare internal URI");

  const links = output.match(/https?:\/\/[^\s]+/g) ?? [];

  assert(links.length, "File details must provide a browser navigation link");

  for (const value of links) {
    const link = new URL(value);

    assert.equal(link.origin, new URL(c.fixture.endpoint).origin);
    assert.equal(link.pathname, "/home");

    const location = new URL(link.searchParams.get("path"));

    assert.equal(location.protocol, "cloudreve:");
    assert.equal(location.username, status.accountId);
    assert.equal(location.password, "");
    assert.equal(location.searchParams.get("name"), own);
    assert.equal(location.hash, "");
    assert(link.searchParams.get("open"), "File navigation must identify its opening target");
    assert((await fetch(link)).ok, "Generated browser route must be served by the real fixture");
  }

  const savedSecrets = (await readdir(c.config)).filter((name) =>
    name.endsWith(".credentials.json"),
  );

  for (const name of savedSecrets) {
    const saved = JSON.parse(await readFile(join(c.config, name), "utf8"));
    const tokens = saved?.tokens ?? saved;

    for (const token of [tokens?.accessToken, tokens?.refreshToken]) {
      if (token) {
        assert(!output.includes(token), "Browser navigation must not disclose session tokens");
      }
    }
  }

  c.prove(
    "stat",
    "browser-link",
    "Real file details link to the fixture-served /home route with the correct account binding and file opening target, without saved session tokens.",
  );

  const transfers = (await call("transfer list")).data;

  assert.equal(transfers.length, 1);

  const ownTransfer = transfers[0].id;
  const override = await call("account view", [], { profile: primary });

  assert.equal(override.data.id, initial.profiles[primary].accountId);

  assert.equal(
    (await config()).selected,
    second,
    "One invocation override must not switch the active account",
  );

  await call("auth switch", [primary]);
  assert.equal((await config()).selected, primary);
  assert.equal((await call("account view")).data.id, initial.profiles[primary].accountId);
  assert(!(await call("ls", ["/my/"])).data.some((file) => file.name === own));

  const ledger = await readFile(join(c.config, "transfers.json"), "utf8");

  for (const command of ["transfer resume", "transfer forget", "transfer cancel"]) {
    await call(command, [ownTransfer, ...(command === "transfer cancel" ? ["--yes"] : [])], {
      expect: "nonzero",
    });
  }

  assert.equal(
    await readFile(join(c.config, "transfers.json"), "utf8"),
    ledger,
    "Wrong-account commands must leave transfer state untouched",
  );

  await call("auth switch", [second], { variant: "switch-back" });
  assert.equal((await call("cat", [`/my/${own}`], { json: false })).stdout.toString(), content);
  await call("auth switch", [primary]);
  await call("auth logout", [second], { variant: "inactive-account" });
  assert.equal((await config()).selected, primary);

  const after = (await call("auth status", [], { variant: "inactive-account-logged-out" })).data;

  assert(after.accounts.some((account) => account.name === second && !account.authenticated));
  assert.equal(after.accounts.filter((account) => account.active).length, 1);
  assert.equal((await call("account view")).data.id, initial.profiles[primary].accountId);

  c.prove(
    "auth logout",
    "inactive-account",
    "Signing out the inactive user leaves the selected account and its authenticated backend access intact.",
  );

  c.prove(
    "auth status",
    "inactive-account-logged-out",
    "The logged-out account is visibly signed out while the original account remains the single active account.",
  );

  await call("auth switch", [second], { expect: "nonzero" });
  assert.equal((await config()).selected, primary);

  c.prove(
    "auth switch",
    "default",
    "Two distinct users on one server switch durably across CLI processes; private files and transfer records stay account-bound. Failed login, invocation override, and inactive logout preserve the active account.",
  );
}
