import assert from "node:assert/strict";
import { writeFile, readFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { CrUri, customPropertyPatch, tagPatches } from "@cloudreve/sdk/files";
import { parseShareLink } from "@cloudreve/sdk/shares";
import { davOptions } from "@cloudreve/sdk/webdav";
import { TaskStatus } from "@cloudreve/sdk/jobs";
import { createClient } from "@cloudreve/sdk";
import { Authentication, tokensFromPassword } from "@cloudreve/sdk/session";
import { randomUUID } from "node:crypto";

/** Real CLI mutations, followed by exact SDK/backend or local-byte oracles. Linux only. */
export async function files(c) {
  const call = async (path, args = [], options) => (await c.run(path, args, options)).data;

  const prove = (path, detail, variant = "default") => c.prove(path, variant, detail);

  const path = (name = "") => c.path("files" + (name ? "/" + name : ""));

  const uri = (name = "") => c.uri("files" + (name ? "/" + name : ""));

  const bytes = (name) => c.bytes("files/" + name);

  const info = (name) => c.sdk.files.info(uri(name));

  const absent = async (name) => assert.equal(await c.sdk.files.infoIfExists(uri(name)), undefined);

  const text = "Cloudreve Linux contract 雪\n";
  const binary = Buffer.from(Array.from({ length: 131089 }, (_, i) => (i * 31) % 256));

  async function completed(job) {
    assert(job?.id && job?.type, "Archive creation must return a real task identity");

    for (let attempt = 0; attempt < 240; attempt++) {
      const state = await c.sdk.jobs.get(job.id, job.type);

      if (state.status === TaskStatus.completed) {
        return state;
      }

      assert(
        ![TaskStatus.error, TaskStatus.canceled].includes(state.status),
        "Archive worker failed",
      );

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error("Archive worker did not complete within 60 seconds");
  }

  function zipContains(file, name, expected) {
    execFileSync(
      "python3",
      [
        "-c",
        "import sys,zipfile,base64; z=zipfile.ZipFile(sys.argv[1]); n=[n for n in z.namelist() if n.lstrip('/')==sys.argv[2]]; assert len(n)==1, z.namelist(); assert z.read(n[0])==base64.b64decode(sys.argv[3])",
        file,
        name,
        Buffer.from(expected).toString("base64"),
      ],
      { stdio: "pipe" },
    );
  }

  await call("mkdir", [path()]);
  assert.equal((await info()).type, 1);
  prove("mkdir", "SDK confirms the newly created remote directory");
  await call("touch", [path("note.txt")]);
  assert.equal((await info("note.txt")).size, 0);
  prove("touch", "New remote file has zero bytes");
  await call("write", [path("note.txt"), "--input", "-"], { input: text });
  assert.deepEqual(await bytes("note.txt"), Buffer.from(text));
  prove("write", "UTF-8 stdin persisted as exact backend bytes");

  const printed = await c.run("cat", [path("note.txt")], { json: false });

  assert.deepEqual(printed.stdout, Buffer.from(text));
  prove("cat", "Raw stdout equals UTF-8 backend content");

  const details = await call("stat", [path("note.txt")]);

  assert.equal(details.id, (await info("note.txt")).id);
  assert.equal(details.size, Buffer.byteLength(text));
  prove("stat", "Identity and byte size match SDK file info");

  const listing = await call("ls", [path()]);

  assert.deepEqual(
    listing.map((item) => item.name),
    ["note.txt"],
  );

  prove("ls", "Exact directory membership, not merely a nonempty response");

  const temporary = await call("url", [path("note.txt"), "--preview"]);

  c.secret(temporary.url);
  assert.match(temporary.url, /^https?:/);

  const response = await fetch(temporary.url);

  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(text));
  prove("url", "Returned preview URL serves exact expected bytes");

  const editor = join(c.temp, "edit-fixture.mjs");

  await writeFile(
    editor,
    '#!/usr/bin/env node\nimport{writeFileSync}from"node:fs";writeFileSync(process.argv[2],"Edited by explicit Linux editor\\n");\n',
    { mode: 0o700 },
  );

  await chmod(editor, 0o700);
  await c.run("edit", [path("note.txt"), "--editor", editor], { json: false });
  assert.equal((await bytes("note.txt")).toString(), "Edited by explicit Linux editor\n");
  prove("edit", "Explicit editor changes are saved as exact backend text");

  const local = join(c.temp, "payload.bin");
  const downloaded = join(c.temp, "downloaded.bin");

  await writeFile(local, binary);
  await call("cp", ["local:" + local, path("payload.bin")]);
  assert.deepEqual(await bytes("payload.bin"), binary);
  await call("cp", [path("payload.bin"), "local:" + downloaded]);
  assert.deepEqual(await readFile(downloaded), binary);
  await call("mkdir", [path("copies")]);
  await call("cp", [path("payload.bin"), path("copies") + "/"]);
  assert.deepEqual(await bytes("copies/payload.bin"), binary);

  await c.run("cp", [path("payload.bin"), "local:" + downloaded], {
    expect: "nonzero",
  });

  assert.deepEqual(await readFile(downloaded), binary);

  const tree = join(c.temp, "tree");

  await mkdir(join(tree, "empty"), { recursive: true });
  await writeFile(join(tree, "unicode 雪.txt"), text);
  await call("cp", ["local:" + tree, path("tree"), "--recursive"]);
  assert.equal((await info("tree/empty")).type, 1);
  assert.deepEqual(await bytes("tree/unicode 雪.txt"), Buffer.from(text));

  prove(
    "cp",
    "Upload/download/remote copy and recursive empty-directory/Unicode tree preserve exact bytes; local overwrite refused",
  );

  await call("mv", [path("copies/payload.bin"), path("copies/renamed.bin")]);
  await absent("copies/payload.bin");
  assert.deepEqual(await bytes("copies/renamed.bin"), binary);
  prove("mv", "Rename changes only destination identity and preserves original copy bytes");

  const schema = await call("metadata schema");

  const property =
    schema.find((item) => item.id === c.customProperty?.id) ??
    schema.find((item) => item.type === "text");

  assert(property, "Fixture must configure a text custom property");
  prove("metadata schema", "Configured text field is actually returned with its type");
  await call("metadata set", [path("note.txt"), "--key", "customize:ci", "--value", "Blue Ocean"]);
  assert.equal((await info("note.txt")).metadata["customize:ci"], "Blue Ocean");
  prove("metadata set", "Arbitrary metadata value persisted");

  const typed = customPropertyPatch(property, "Linux typed value");

  await call("metadata set", [path("note.txt"), "--key", typed.key, "--value", typed.value], {
    variant: "typed",
  });

  assert.equal((await info("note.txt")).metadata[typed.key], typed.value);

  assert(
    Number.isSafeInteger(property.max) && property.max > 0,
    "The text fixture needs a bounded maximum",
  );

  const invalidTyped = await c.run(
    "metadata set",
    [path("note.txt"), "--key", typed.key, "--value", "x".repeat(property.max + 1)],
    { variant: "typed", expect: "nonzero" },
  );

  assert.match(
    invalidTyped.stderr + invalidTyped.stdout.toString(),
    /Invalid custom property value or configuration/,
  );

  assert.equal((await info("note.txt")).metadata[typed.key], typed.value);

  prove(
    "metadata set",
    "Valid configured text persists; over-limit text is rejected without changing the stored value",
    "typed",
  );

  const metadata = await call("metadata view", [path("note.txt")]);

  assert.equal(metadata[typed.key], typed.value);
  assert.equal(metadata["customize:ci"], "Blue Ocean");
  prove("metadata view", "Both configured and arbitrary metadata are read back");

  await call("metadata remove", [path("note.txt"), "--key", typed.key], {
    variant: "typed",
  });

  assert.equal((await info("note.txt")).metadata?.[typed.key], undefined);

  const unknownProperty = "props:ci_unregistered_field";

  assert(!schema.some((item) => customPropertyPatch(item, "", true).key === unknownProperty));

  const beforeUnknownRemoval = (await info("note.txt")).metadata;
  const bytesBeforeUnknownRemoval = await bytes("note.txt");

  const invalidRemoval = await c.run(
    "metadata remove",
    [path("note.txt"), "--key", unknownProperty],
    { variant: "typed", expect: "nonzero" },
  );

  assert.match(
    invalidRemoval.stderr + invalidRemoval.stdout.toString(),
    /Unknown server custom property/,
  );

  assert.deepEqual((await info("note.txt")).metadata, beforeUnknownRemoval);
  assert.deepEqual(await bytes("note.txt"), bytesBeforeUnknownRemoval);

  prove(
    "metadata remove",
    "Configured property is removed; unknown-property removal is refused with existing metadata and file bytes unchanged",
    "typed",
  );

  await call("metadata remove", [path("note.txt"), "--key", "customize:ci"]);
  assert.equal((await info("note.txt")).metadata?.["customize:ci"], undefined);
  prove("metadata remove", "Arbitrary metadata removed without changing file bytes");

  const tagKey = tagPatches("Linux", "#123456")[0].key;
  const nextTag = tagPatches("Renamed", "#654321")[0].key;

  await call("tag add", [path("note.txt"), "--name", "Linux", "--color", "#123456"]);
  assert.equal((await info("note.txt")).metadata[tagKey], "#123456");
  prove("tag add", "Tag/color pair persisted");

  await call("tag rename", [
    path("note.txt"),
    "--original",
    "Linux",
    "--name",
    "Renamed",
    "--color",
    "#654321",
  ]);

  const tagged = (await info("note.txt")).metadata;

  assert.equal(tagged[tagKey], undefined);
  assert.equal(tagged[nextTag], "#654321");
  prove("tag rename", "Old tag disappears and new tag/color appears");
  await call("tag remove", [path("note.txt"), "--name", "Renamed"]);
  assert.equal((await info("note.txt")).metadata?.[nextTag], undefined);
  prove("tag remove", "Named tag is absent afterward");

  await c.sdk.account.patchSettings({
    version_retention_enabled: true,
    version_retention_ext: ["txt"],
    version_retention_max: 10,
    share_links_in_profile: "all_share",
  });

  await call("touch", [path("versions.txt")]);

  await call("write", [path("versions.txt"), "--input", "-"], {
    input: "version one",
  });

  const old = (await info("versions.txt")).primary_entity;

  await call("write", [path("versions.txt"), "--input", "-"], {
    input: "version two",
  });

  const newer = (await info("versions.txt")).primary_entity;

  assert.notEqual(old, newer);

  const versions = await call("version list", [path("versions.txt")]);

  assert(versions.some((v) => v.id === old) && versions.some((v) => v.id === newer));
  prove("version list", "Both independently captured version IDs are listed");
  await call("version promote", [path("versions.txt"), old]);
  assert.equal((await info("versions.txt")).primary_entity, old);
  assert.equal((await bytes("versions.txt")).toString(), "version one");
  prove("version promote", "Captured old entity is current and serves its original bytes");
  await call("version delete", [path("versions.txt"), newer, "--yes"]);
  assert(!(await info("versions.txt")).extended_info.entities.some((v) => v.id === newer));
  assert.equal((await bytes("versions.txt")).toString(), "version one");
  prove("version delete", "Deleted entity disappears; current bytes are retained");

  const sharePassword = "LinuxFixture123";

  c.secret(sharePassword);

  const created = await call(
    "share create",
    [path("note.txt"), "--private", "--downloads", "20", "--expire", "0", "--secrets-stdin"],
    { input: JSON.stringify({ password: sharePassword }) },
  );

  c.secret(created.url);

  const id = parseShareLink(created.url, c.fixture.endpoint).id;

  assert.equal((await c.sdk.shares.info(id)).is_private, true);
  prove("share create", "New protected share exists with expected privacy");

  const shares = await call("share list");

  assert(shares.shares.some((item) => item.id === id));
  prove("share list", "Created share appears in owner list");

  const share = await call("share view", [id]);

  assert.equal(share.id, id);
  assert.equal(share.is_private, true);
  prove("share view", "Specific share identity/privacy read back");
  await call("share update", [id, "--downloads", "25", "--expire", "0", "--show-readme"]);

  const updated = await c.sdk.shares.info(id);

  assert.equal(updated.remain_downloads, 25);
  assert.equal(updated.is_private, true);
  assert.equal(updated.show_readme, true);
  prove("share update", "Supported limits/view update persists without changing protection");

  // The info endpoint returns a locked summary with code0; only file access is denied.
  const locked = await call("share open", [id, "--guest", "--secrets-stdin"], {
    input: JSON.stringify({ password: "wrong" }),
  });

  assert.equal(locked.id, id);
  assert.equal(locked.unlocked, false);

  const sharedFile = CrUri.share(id).join("note.txt").toString();

  c.secret("wrong");

  await c.run("cat", [sharedFile, "--guest", "--share-password-stdin"], {
    input: "wrong",
    expect: "nonzero",
    json: false,
  });

  const unlocked = await call("share open", [id, "--guest", "--secrets-stdin"], {
    input: JSON.stringify({ password: sharePassword }),
  });

  assert.equal(unlocked.id, id);
  assert.equal(unlocked.unlocked, true);

  const sharedBytes = await c.run("cat", [sharedFile, "--guest", "--share-password-stdin"], {
    input: sharePassword,
    json: false,
  });

  assert.deepEqual(sharedBytes.stdout, await bytes("note.txt"));
  prove("share open", "Wrong password denied; correct password unlocks exact share");

  // Public CLI output strips embedded passwords. It must remain locked when reused alone.
  assert.equal(parseShareLink(created.url, c.fixture.endpoint).password, undefined);

  const stripped = await call("share open", ["--guest", "--link-stdin"], {
    input: created.url,
    variant: "link",
  });

  assert.equal(stripped.id, id);
  assert.equal(stripped.unlocked, false);

  // Owner SDK info supplies the actual private link; keep it only in secret stdin.
  const privateLink = (await c.sdk.shares.info(id)).url;

  c.secret(privateLink);

  assert.deepEqual(parseShareLink(privateLink, c.fixture.endpoint), {
    id,
    password: sharePassword,
  });

  const opened = await call("share open", ["--guest", "--link-stdin"], {
    input: privateLink,
    variant: "link",
  });

  assert.equal(opened.id, id);
  assert.equal(opened.unlocked, true);

  prove(
    "share open",
    "Redacted output link remains locked; an explicitly supplied full private link unlocks the exact share",
    "link",
  );

  const public1 = await call("share create", [path("payload.bin")]);
  const public2 = await call("share create", [path("versions.txt")]);
  const ids = [public1, public2].map((x) => parseShareLink(x.url, c.fixture.endpoint).id);

  // A distinct owner makes ignoring --owner observable, even with a signed-in primary profile.
  const ownerEmail = `owner-${randomUUID()}@example.test`;
  const ownerPassword = `Owner-${randomUUID()}!`;

  c.secret(ownerEmail, ownerPassword);

  const ownerAuth = new Authentication(c.fixture.endpoint, fetch);

  assert.equal(
    (await ownerAuth.register({ email: ownerEmail, password: ownerPassword })).status,
    "active",
  );

  const ownerLogin = await ownerAuth.password(ownerEmail, ownerPassword);

  assert.equal(ownerLogin.kind, "authenticated");

  let ownerTokens = tokensFromPassword(ownerLogin.session.token);

  c.secret(ownerTokens.accessToken, ownerTokens.refreshToken);

  const owner = await createClient({
    accountId: ownerLogin.session.user.id,
    endpoint: c.fixture.endpoint,
    transport: fetch,
    tokens: () => ownerTokens,
    saveTokens: (next) => {
      ownerTokens = next;
    },
  });

  try {
    await owner.account.patchSettings({ share_links_in_profile: "all_share" });

    const ownedFile = await owner.files.create(CrUri.my.toString(), "owner-public.txt", "file");
    const ownerUrl = await owner.shares.save({ uri: ownedFile.path });
    const ownerShare = parseShareLink(ownerUrl, c.fixture.endpoint).id;

    const publicList = await call(
      "share list",
      ["--owner", ownerLogin.session.user.id, "--guest"],
      { variant: "owner" },
    );

    assert.deepEqual(
      publicList.shares.map((item) => item.id),
      [ownerShare],
    );

    assert(!publicList.shares.some((item) => ids.includes(item.id) || item.id === id));

    prove(
      "share list",
      "Unified owner option selects a different account's exact public share and excludes the signed-in account's shares",
      "owner",
    );
  } finally {
    owner.session.invalidate();
  }

  await call("share revoke", [id, "--yes"]);
  assert(!(await c.sdk.shares.list()).shares.some((s) => s.id === id));
  prove("share revoke", "Single revoked share disappears without deleting its source");
  await call("share revoke", [...ids, "--yes"], { variant: "multiple" });

  const left = (await c.sdk.shares.list()).shares;

  assert(ids.every((id) => !left.some((s) => s.id === id)));
  assert.deepEqual(await bytes("payload.bin"), binary);
  prove("share revoke", "Multiple shares revoked together while source bytes remain", "multiple");

  const links = await call("link create", [path("payload.bin")]);

  assert(Array.isArray(links) && links.length);

  const directUrl = links[0].link;

  assert(directUrl);
  c.secret(directUrl);
  prove("link create", "Direct link URL returned for the requested file");

  const listedLinks = await call("link list", [path("payload.bin")]);
  const direct = listedLinks.find((x) => x.url === directUrl);

  assert(direct?.id);
  prove("link list", "Created direct link appears in file metadata with its revocation ID");

  const directFile = join(c.temp, "direct.bin");

  await call("cp", [directUrl, "local:" + directFile], {
    variant: "direct-link",
  });

  assert.deepEqual(await readFile(directFile), binary);
  prove("cp", "Unified direct-link input downloads exact original bytes", "direct-link");
  await call("link revoke", [direct.id, "--yes"]);

  assert(
    !((await info("payload.bin")).extended_info?.direct_links ?? []).some(
      (x) => x.id === direct.id,
    ),
  );

  const revokedResponse = await fetch(directUrl);

  assert.equal(revokedResponse.ok, false);
  await revokedResponse.body?.cancel();
  assert.deepEqual(await bytes("payload.bin"), binary);

  prove(
    "link revoke",
    "Link disappears, public access is refused, and original file bytes remain unchanged",
  );

  const dav = await call("webdav create", [path(), "--name", "Linux CI", "--readonly"]);

  assert(dav.id);

  let davState = await c.sdk.webdav.get(dav.id);

  c.secret(davState.password);
  assert.equal(new CrUri(davState.uri).fs(), "my");
  assert.equal(new CrUri(davState.uri).path(), new CrUri(uri()).path());
  assert.equal(davOptions(davState).readonly, true);
  prove("webdav create", "New DAV account is bound to the intended directory and readonly policy");

  const davs = await call("webdav list");

  assert(davs.accounts.some((x) => x.id === dav.id));
  prove("webdav list", "Created credential is listed");

  const shown = await call("webdav view", [dav.id]);

  assert.equal(shown.id, dav.id);
  assert.equal(shown.readonly, true);
  prove("webdav view", "Correct DAV identity/options are returned");

  await call("webdav update", [
    dav.id,
    path(),
    "--name",
    "Linux CI updated",
    "--no-readonly",
    "--proxy",
  ]);

  davState = await c.sdk.webdav.get(dav.id);
  assert.equal(davState.name, "Linux CI updated");
  assert.equal(davOptions(davState).readonly, false);
  assert.equal(davOptions(davState).proxy, true);
  prove("webdav update", "Name and access options actually changed at server");
  await call("webdav revoke", [dav.id, "--yes"]);
  assert(!(await c.sdk.webdav.list()).accounts.some((x) => x.id === dav.id));
  prove("webdav revoke", "Credential is absent afterward");

  await call("mkdir", [path("archive-input")]);
  await call("touch", [path("archive-input/member.txt")]);

  await call("write", [path("archive-input/member.txt"), "--input", "-"], {
    input: text,
  });

  await completed(
    await call("archive create", [path("archive-input/member.txt"), path("bundle.zip")]),
  );

  assert((await info("bundle.zip")).size > 0);
  prove("archive create", "Real server archive job completes and produces a nonempty ZIP");

  const members = await call("archive list", [path("bundle.zip")]);
  const member = members.find((x) => x.name.replace(/^\//, "") === "member.txt");

  assert(member && member.size === Buffer.byteLength(text));
  prove("archive list", "ZIP contains exact named member with expected byte size");
  await call("mkdir", [path("extracted")]);

  await completed(
    await call("archive extract", [
      path("bundle.zip"),
      path("extracted") + "/",
      "--members-json",
      JSON.stringify([member.name]),
    ]),
  );

  assert.deepEqual(await bytes("extracted/member.txt"), Buffer.from(text));
  prove("archive extract", "Selected member extracted to exact expected bytes");

  const zipPath = join(c.temp, "selection.zip");

  await call("archive download", [path("archive-input/member.txt"), "local:" + zipPath]);
  zipContains(zipPath, "member.txt", text);
  prove("archive download", "Downloaded temporary ZIP has exact member content");

  const zipUrl = await call("url", ["--archive", path("archive-input/member.txt")], {
    variant: "archive",
  });

  c.secret(zipUrl.url);

  const zipped = await fetch(zipUrl.url);

  assert.equal(zipped.status, 200);

  const zipUrlPath = join(c.temp, "url-archive.zip");

  await writeFile(zipUrlPath, Buffer.from(await zipped.arrayBuffer()));
  zipContains(zipUrlPath, "member.txt", text);
  prove("url", "Unified archive URL produces a ZIP with exact selected bytes", "archive");

  await call("rm", [path("copies/renamed.bin")]);
  await absent("copies/renamed.bin");

  const trashed = (await c.sdk.files.list(CrUri.trash.toString())).files.find(
    (x) => x.name === "renamed.bin",
  );

  assert(trashed);
  prove("rm", "File moved to trash rather than silently deleted");
  await call("restore", [trashed.path]);
  assert.deepEqual(await bytes("copies/renamed.bin"), binary);
  prove("restore", "Trashed file restored to original path with exact bytes");
  await call("rm", [path("copies/renamed.bin")]);

  const beforeTrash = (await c.sdk.files.list(CrUri.trash.toString())).files
    .map((x) => x.id)
    .sort();

  assert(beforeTrash.length > 0);

  if (c.capabilities.trashEmpty) {
    await call("trash empty", ["--yes"]);
    assert.equal((await c.sdk.files.list(CrUri.trash.toString())).files.length, 0);
    prove("trash empty", "Community4.18 empties the actual populated trash");
  } else {
    const refusal = await c.run("trash empty", ["--yes"], {
      expect: "nonzero",
    });

    assert.match(
      refusal.stdout.toString() + refusal.stderr,
      /trash empty requires Cloudreve >=4\.18\.0/,
    );

    assert.deepEqual(
      (await c.sdk.files.list(CrUri.trash.toString())).files.map((x) => x.id).sort(),
      beforeTrash,
    );

    prove(
      "trash empty",
      "Community4.17 explicitly refuses unsupported operation and leaves trash unchanged",
    );
  }

  assert.deepEqual(await bytes("payload.bin"), binary);
}
