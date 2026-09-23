import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

/** Exercise an extracted executable without Node, Bun, or package files on its PATH. */
export async function verifyBinary(executable, version) {
  const directory = await mkdtemp(join(tmpdir(), "cloudreve-binary-"));
  const path = join(directory, "empty-path");
  const config = join(directory, "config");

  await mkdir(path);

  const env = { ...process.env, PATH: path, CLOUDREVE_CONFIG_DIR: config, NO_COLOR: "1" };
  const user = { id: "binary-probe", nickname: "Binary probe", email: "probe@example.test" };
  const requests = [];

  const server = createServer(async (request, response) => {
    const chunks = [];

    for await (const chunk of request) {
      chunks.push(chunk);
    }

    const url = new URL(request.url, "http://localhost");

    requests.push([request.method, url.pathname]);
    response.setHeader("content-type", "application/json");

    let data;

    if (url.pathname === "/api/v4/site/ping") {
      data = "4.18.0";
    } else if (["/api/v4/site/config/basic", "/api/v4/site/config/login"].includes(url.pathname)) {
      data = { login_captcha: false };
    } else if (url.pathname === "/api/v4/session/prepare") {
      data = { password_enabled: true };
    } else if (url.pathname === "/api/v4/session/token" && request.method === "POST") {
      assert.equal(JSON.parse(Buffer.concat(chunks)).password, "disposable-probe-password");

      data = {
        user,
        token: {
          access_token: "disposable-access",
          refresh_token: "disposable-refresh",
          access_expires: "2099-01-01",
          refresh_expires: "2099-01-02",
        },
      };
    } else if (url.pathname === "/api/v4/user/me") {
      assert.equal(request.headers.authorization, "Bearer disposable-access");
      data = user;
    } else if (url.pathname === "/api/v4/session/token" && request.method === "DELETE") {
      data = null;
    } else {
      response.statusCode = 404;
      data = null;
    }

    response.end(JSON.stringify({ code: 0, data }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const command = async (args, input = "", expectedStatus = 0) => {
    const child = spawn(executable, args, { cwd: directory, env, timeout: 20000 });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.stdin.end(input);

    const [code] = await once(child, "close");
    const errors = Buffer.concat(stderr).toString();

    assert.equal(code, expectedStatus, errors);

    if (expectedStatus !== 0) {
      return errors;
    }

    assert.equal(errors, "");

    return Buffer.concat(stdout).toString();
  };

  try {
    assert.equal((await command(["--version"])).trim(), `cr ${version}`);
    assert.match(await command(["--help"]), /Usage:/);

    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const flags = ["--json", "--no-prompt"];

    await command(
      [
        "auth",
        "login",
        "--server",
        endpoint,
        "--name",
        "probe",
        "--email",
        user.email,
        "--credential-store",
        "file",
        "--password-stdin",
        ...flags,
      ],
      "disposable-probe-password\n",
    );

    assert.equal(JSON.parse(await command(["account", "view", ...flags])).data.id, user.id);
    assert.equal(JSON.parse(await command(["profile", "list", ...flags])).data.selected, "probe");

    const files = (await readdir(config)).filter((name) => name.endsWith(".credentials.json"));

    assert.equal(files.length, 1);
    assert.match(await readFile(join(config, files[0]), "utf8"), /disposable-access/);

    if (process.platform !== "win32") {
      assert.equal((await stat(join(config, files[0]))).mode & 0o777, 0o600);
    }

    await command(["auth", "logout", ...flags]);
    assert(requests.some(([method]) => method === "DELETE"));

    // Missing entries exercise the embedded native addon and private self-dispatch without writing a vault.
    const worker = spawn(executable, ["--cloudreve-native-vault"], {
      cwd: directory,
      env,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      timeout: 20000,
    });

    const reply = once(worker, "message");

    const exit = once(worker, "exit").then(([code, signal]) => {
      throw new Error(`Native helper exited before replying: ${code ?? signal}`);
    });

    worker.send({ service: "org.cloudreve.cli:" + randomUUID(), key: "missing-binary-probe" });

    let vaultAvailable;

    try {
      const result = (await Promise.race([reply, exit]))[0];

      vaultAvailable = result.ok;

      if (process.platform === "linux" && !vaultAvailable) {
        assert.deepEqual(result, { ok: false, bindingLoaded: true });
      } else {
        assert.deepEqual(result, { ok: true, value: null });
      }
    } finally {
      worker.kill("SIGKILL");
    }

    const nativeLogin = [
      "auth",
      "login",
      "--server",
      endpoint,
      "--name",
      "vault-probe",
      "--email",
      user.email,
      "--credential-store",
      "native",
      "--password-stdin",
      ...flags,
    ];

    const nativeResult = await command(
      nativeLogin,
      "disposable-probe-password\n",
      vaultAvailable ? 0 : 1,
    );

    if (vaultAvailable) {
      try {
        assert.equal(JSON.parse(await command(["account", "view", ...flags])).data.id, user.id);
      } finally {
        await command(["auth", "logout", ...flags]);
      }
    } else {
      assert.equal(JSON.parse(nativeResult).error.kind, "credentials");

      assert.deepEqual(
        (await readdir(config)).filter((name) => name.endsWith(".credentials.json")),
        files,
      );
    }

    console.log(
      `Standalone authentication, profiles, logout and embedded native worker passed; vault ${vaultAvailable ? "read/write/delete verified" : "unavailable, explicit error verified"}`,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}
