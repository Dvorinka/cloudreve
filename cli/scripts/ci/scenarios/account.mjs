import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { Authentication, tokensFromPassword } from "@cloudreve/sdk/session";
import { createClient } from "@cloudreve/sdk/client";
import { oauthFixture } from "@cloudreve/testkit/oauth-fixture";
import { chromium } from "playwright";

export function otp(secret, now = Date.now()) {
  assert.match(secret, /^[A-Z2-7]+=*$/i, "Fixture OTP secret must be base32");

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");

  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((value) => parseInt(value, 2)));

  assert(key.length, "Empty OTP key");

  const step = Buffer.alloc(8);

  step.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));

  const hash = createHmac("sha1", key).update(step).digest();

  return String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

async function callbackUri() {
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;

  await new Promise((resolve) => server.close(resolve));

  return `http://127.0.0.1:${port}/callback`;
}

async function loginSdk(endpoint, email, password) {
  const login = await new Authentication(endpoint, fetch).password(email, password);

  assert.equal(login.kind, "authenticated");

  let tokens = tokensFromPassword(login.session.token);

  return createClient({
    endpoint,
    accountId: login.session.user.id,
    transport: fetch,
    tokens: () => tokens,
    saveTokens: (next) => {
      tokens = next;
    },
  });
}

// Fixture browser launcher: SDK consent + real Chromium callback, not frontend form proof.
async function browserDriver(c, credentials) {
  const config = join(c.temp, "oauth-driver-private.json");
  const script = join(c.temp, "oauth-browser.mjs");

  await writeFile(config, JSON.stringify(credentials), {
    mode: 0o600,
    flag: "wx",
  });

  await writeFile(
    script,
    `#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Authentication,tokensFromPassword,parseOAuthAuthorizationLink} from ${JSON.stringify(import.meta.resolve("@cloudreve/sdk/session"))};
import {createClient} from ${JSON.stringify(import.meta.resolve("@cloudreve/sdk/client"))};
import {chromium} from ${JSON.stringify(import.meta.resolve("playwright"))};
const config=JSON.parse(await readFile(${JSON.stringify(config)},'utf8'));
const input=parseOAuthAuthorizationLink(process.argv[2],config.endpoint);
assert.equal(input.client_id,config.clientId);assert.equal(input.redirect_uri,config.redirectUri);
assert(input.state&&input.code_challenge&&input.code_challenge_method==='S256');
assert(input.scope.split(' ').every(s=>config.scope.split(' ').includes(s)));
const login=await new Authentication(config.endpoint,fetch).password(config.email,config.password);assert.equal(login.kind,'authenticated');
let tokens=tokensFromPassword(login.session.token);
const sdk=await createClient({endpoint:config.endpoint,accountId:login.session.user.id,transport:fetch,tokens:()=>tokens,saveTokens:next=>{tokens=next;}});
let browser,failure;
try {const result=await sdk.account.consentOAuth(input);assert.equal(result.state,input.state);assert(result.code);
const callback=new URL(config.redirectUri);callback.searchParams.set('code',result.code);callback.searchParams.set('state',result.state);
browser=await chromium.launch({headless:true});const page=await browser.newPage();
await page.route('**/*',route=>route.request().url()===callback.href?route.continue():route.abort());
const response=await page.goto(callback.href,{waitUntil:'domcontentloaded',timeout:15000});assert(response?.ok());
}catch(error){failure=error;}
const cleanup=await Promise.allSettled([browser?.close(),Promise.resolve().then(()=>sdk.session.invalidate())]);
const errors=cleanup.filter(result=>result.status==='rejected').map(result=>result.reason);
if(failure){if(errors.length)throw new AggregateError([failure,...errors],String(failure)+'; browser cleanup also failed',{cause:failure});throw failure;}
if(errors.length)throw new AggregateError(errors,'Browser cleanup failed');
`,
    { mode: 0o700, flag: "wx" },
  );

  return script;
}

/** Every product outcome invokes the packed CLI; SDK calls seed and verify isolated data. */
export async function account(c) {
  const call = async (path, args = [], options) => (await c.run(path, args, options)).data;

  const prove = (path, detail, variant = "default") => c.prove(path, variant, detail);

  const server = await call("server info", [c.fixture.endpoint, "--auth"], {
    variant: "auth",
  });

  assert.equal(server.version, c.version);
  assert.equal(server.isPro, false);
  assert.equal(server.auth.register_enabled, true);

  prove(
    "server info",
    "Exact backend version and its enabled registration capability are inspected through the consolidated auth option",
    "auth",
  );

  const initial = await call("profile list");
  const primary = initial.selected;

  assert(primary && initial.profiles[primary]);

  const suffix = randomUUID().slice(0, 8);
  const profile = "account-" + suffix;
  const browserProfile = "browser-" + suffix;

  const email = `cli-${randomUUID()}@example.test`;
  const password = `Fixture-${randomUUID()}!`;
  const changed = `Changed-${randomUUID()}!`;

  c.secret(email, password, changed);

  const auth = new Authentication(c.fixture.endpoint, fetch);
  const registration = await auth.register({ email, password });

  assert.equal(
    registration.status,
    "active",
    "Account fixture needs registration enabled and activation disabled",
  );

  let oracle = await loginSdk(c.fixture.endpoint, email, password);
  const user = await oracle.account.me();

  assert.notEqual(
    user.id,
    (await c.sdk.account.me()).id,
    "Account scenario must not mutate the primary account",
  );

  let browser;
  let oauth;
  let failure;

  try {
    const disposable = "empty-" + suffix;

    await call("profile add", [
      disposable,
      "--server",
      c.fixture.endpoint,
      "--credential-store",
      "file",
    ]);

    const added = await call("profile list");

    assert.equal(
      new URL(added.profiles[disposable].endpoint).origin,
      new URL(c.fixture.endpoint).origin,
    );

    const saved = JSON.parse(await readFile(join(c.config, "config.json"), "utf8"));

    assert.equal(saved.profiles[disposable].credentialStore, "file");
    prove("profile add", "Fresh file-store connection persists with exact owned endpoint");
    prove("profile list", "New profile is present with its expected connection settings");
    await call("profile use", [disposable]);
    assert.equal((await call("profile list")).selected, disposable);
    prove("profile use", "A later process reads the selected profile change");
    await call("profile remove", [disposable, "--yes"]);
    assert.equal((await call("profile list")).profiles[disposable], undefined);
    prove("profile remove", "Explicit local profile removal persists across processes");
    await call("profile use", [primary]);

    await call("profile add", [
      profile,
      "--server",
      c.fixture.endpoint,
      "--credential-store",
      "file",
    ]);

    const options = { profile };

    const login = await call("auth login", ["--email", email, "--password-stdin"], {
      ...options,
      input: password,
    });

    assert.equal(login.account.id, user.id);
    prove("auth login", "Password stdin authenticates the separately seeded account");

    const status = await call("auth status", [], options);

    assert.equal(status.authenticated, true);
    assert.equal(status.accountId, user.id);
    assert.equal(status.profile, profile);
    prove("auth status", "A new process reads the durable account binding without exposing tokens");

    const identity = await call("account view", [], options);

    assert.equal(identity.id, user.id);
    prove("account view", "Selected profile resolves to the exact separately seeded account");
    assert.deepEqual(await call("account capacity", [], options), await oracle.account.capacity());

    prove(
      "account capacity",
      "Quota output exactly matches the selected account's server capacity",
    );

    await call(
      "account configure",
      [
        "--retain-versions",
        "on",
        "--version-extensions-json",
        '["txt","md"]',
        "--version-limit",
        "3",
        "--public-shares",
        "none",
      ],
      { ...options, variant: "retention-privacy" },
    );

    const expected = {
      version_retention_enabled: true,
      version_retention_ext: ["txt", "md"],
      version_retention_max: 3,
      share_links_in_profile: "hide_share",
    };

    const settings = await oracle.account.settings();

    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(settings[key], value);
    }

    prove(
      "account configure",
      "Retention and public-share privacy values persist at the backend",
      "retention-privacy",
    );

    assert.deepEqual(
      await call("account settings", [], { ...options, variant: "filtered" }),
      expected,
    );

    prove(
      "account settings",
      "Only the four retained settings fields are exposed, with exact configured values",
      "filtered",
    );

    await call("account password", ["--secrets-stdin"], {
      ...options,
      input: JSON.stringify({ current: password, next: changed }),
    });

    assert.equal((await call("auth status", [], options)).authenticated, false);
    await assert.rejects(auth.password(email, password));

    assert.equal(
      (
        await call("auth login", ["--email", email, "--password-stdin"], {
          ...options,
          input: changed,
        })
      ).account.id,
      user.id,
    );

    await call("account password", ["--secrets-stdin"], {
      ...options,
      input: JSON.stringify({ current: changed, next: password }),
    });

    assert.equal((await call("auth status", [], options)).authenticated, false);
    await assert.rejects(auth.password(email, changed));

    await call("auth login", ["--email", email, "--password-stdin"], {
      ...options,
      input: password,
    });

    prove(
      "account password",
      "Old password is denied, replacement authenticates, local sessions clear, and original password is restored",
    );

    oracle.session.invalidate();
    oracle = await loginSdk(c.fixture.endpoint, email, password);

    let secret;
    let buffered = "";

    await c.run("account two-factor enable", ["--enroll", "--show-secret", "--secrets-stdin"], {
      ...options,
      variant: "enrollment",
      dynamicInput(chunk, stdin) {
        buffered += String(chunk);

        if (secret) {
          return;
        }

        const lines = buffered.split("\n").slice(0, -1);

        const line = lines.find(
          (line) => line.startsWith('{"enrollmentSecret":') && line.endsWith("}"),
        );

        const human = lines.find((line) => line.startsWith("Authenticator setup key: "));

        if (!line && !human) {
          return;
        }

        secret = line
          ? JSON.parse(line).enrollmentSecret
          : human.slice("Authenticator setup key: ".length).trim();

        assert.equal(typeof secret, "string");
        c.secret(secret);
        stdin.end(JSON.stringify({ code: otp(secret) }));
      },
    });

    assert(secret);
    assert.equal((await oracle.account.settings()).two_fa_enabled, true);

    prove(
      "account two-factor enable",
      "The CLI emits its freshly created secret, consumes a generated code on stdin, and server state becomes enabled",
      "enrollment",
    );

    await call("auth logout", [], options);
    assert.equal((await call("auth status", [], options)).authenticated, false);

    prove(
      "auth logout",
      "Durable local authentication is cleared and the compatible server confirms revocation",
    );

    const challenge = await auth.password(email, password);

    assert.equal(challenge.kind, "otp");
    c.secret(challenge.sessionId);

    await call("auth login", ["--email", email, "--secrets-stdin"], {
      ...options,
      input: JSON.stringify({ password, otp: otp(secret) }),
      variant: "otp",
    });

    assert.equal((await call("auth status", [], options)).accountId, user.id);

    prove(
      "auth login",
      "Actual OTP-protected account authenticates using explicit secret stdin",
      "otp",
    );

    await call("account two-factor disable", ["--secrets-stdin"], {
      ...options,
      input: JSON.stringify({ code: otp(secret) }),
    });

    assert.equal((await oracle.account.settings()).two_fa_enabled, false);

    prove(
      "account two-factor disable",
      "Server confirms the second factor is disabled after a valid code",
    );

    assert.equal(
      new URL(c.fixture.endpoint).hostname,
      "localhost",
      "Virtual authenticator requires the owned localhost RP origin",
    );

    browser = await chromium.launch({ headless: true });

    const page = await browser.newPage();

    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === new URL(c.fixture.endpoint).origin
        ? route.continue()
        : route.abort(),
    );

    await page.goto(c.fixture.endpoint, { waitUntil: "domcontentloaded" });

    const cdp = await page.context().newCDPSession(page);

    await cdp.send("WebAuthn.enable");

    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });

    const creation = await oracle.account.beginPasskeyRegistration();

    const response = await page.evaluate(
      async (options) =>
        (
          await globalThis.navigator.credentials.create({
            publicKey: globalThis.PublicKeyCredential.parseCreationOptionsFromJSON(
              options.publicKey,
            ),
          })
        ).toJSON(),
      creation,
    );

    const passkey = await oracle.account.finishPasskeyRegistration({
      name: "Linux fixture passkey",
      ua: "Chromium virtual fixture",
      response,
    });

    const passkeys = await call("account passkey list", [], options);

    assert(passkeys.some((key) => key.id === passkey.id && key.name === "Linux fixture passkey"));

    prove(
      "account passkey list",
      "A real browser-enrolled authenticator appears with its expected identity and name",
    );

    await call("account passkey delete", [passkey.id, "--yes"], options);
    assert(!(await oracle.account.settings()).passkeys.some((key) => key.id === passkey.id));
    prove("account passkey delete", "The selected authenticator is removed from server settings");
    await browser.close();
    browser = undefined;

    oauth = await oauthFixture((path, init) => c.sdk.session.request(path, init), {
      redirectUri: await callbackUri(),
      scopes: ["openid", "profile", "email", "offline_access", "UserInfo.Read", "Files.Read"],
    });

    c.secret(oauth.credentials.clientSecret);

    const driver = await browserDriver(c, {
      ...oauth.credentials,
      endpoint: c.fixture.endpoint,
      email,
      password,
    });

    const authorization = new URL("/session/authorize", c.fixture.endpoint);

    for (const [key, value] of Object.entries({
      client_id: oauth.credentials.clientId,
      response_type: "code",
      redirect_uri: oauth.credentials.redirectUri,
      scope: oauth.credentials.scope,
    })) {
      authorization.searchParams.set(key, value);
    }

    await call("profile add", [
      browserProfile,
      "--server",
      c.fixture.endpoint,
      "--credential-store",
      "file",
    ]);

    const browserLogin = await call(
      "auth login",
      [
        "--browser",
        "--authorize-url",
        authorization.href,
        "--browser-command",
        driver,
        "--secrets-stdin",
        "--timeout",
        "60000",
      ],
      {
        profile: browserProfile,
        input: JSON.stringify({ clientSecret: oauth.credentials.clientSecret }),
        variant: "browser",
      },
    );

    assert.equal(browserLogin.account.id, user.id);

    const browserFile = await oracle.files.create("cloudreve://my/", "browser-proof.txt", "file");

    const browserFiles = await call("ls", ["/my/"], {
      profile: browserProfile,
    });

    assert(browserFiles.some((file) => file.id === browserFile.id));

    assert.deepEqual(
      browserFiles.map((file) => file.id).sort(),
      (await oracle.files.list("cloudreve://my/")).files.map((file) => file.id).sort(),
    );

    await c.run("touch", ["/my/scope-denied.txt"], {
      profile: browserProfile,
      expect: "nonzero",
    });

    assert.equal(await oracle.files.infoIfExists("cloudreve://my/scope-denied.txt"), undefined);

    prove(
      "auth login",
      "Real SDK consent and Chromium loopback callback complete state/PKCE login; read scope works and write is denied. This does not claim frontend form rendering.",
      "browser",
    );

    const grants = await call("account grant list", [], options);

    assert(grants.some((grant) => grant.client_id === oauth.credentials.clientId));
    prove("account grant list", "The actual browser authorization appears as an application grant");
    await call("account grant revoke", [oauth.credentials.clientId, "--yes"], options);

    assert(
      !(await oracle.account.settings()).oauth_grants.some(
        (grant) => grant.client_id === oauth.credentials.clientId,
      ),
    );

    prove(
      "account grant revoke",
      "The server grant is removed; this does not promise immediate invalidation of an already-issued access JWT",
    );

    await call("auth logout", [], options);
    await call("profile remove", [profile, "--yes"]);
    assert.equal((await call("profile list")).profiles[profile], undefined);

    prove(
      "profile remove",
      "The authenticated fixture profile is removed after durable sign-out, without changing the primary profile",
    );
  } catch (error) {
    failure = error;
  }

  const cleanup = await Promise.allSettled([
    browser?.close(),
    oauth?.close(),
    Promise.resolve().then(() => oracle.session.invalidate()),
    call("profile use", [primary]),
  ]);

  const cleanupErrors = cleanup
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);

  if (failure) {
    if (cleanupErrors.length) {
      throw new AggregateError(
        [failure, ...cleanupErrors],
        `${String(failure)}; account cleanup also failed`,
        { cause: failure },
      );
    }

    throw failure;
  }

  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, "Account cleanup failed");
  }
}
