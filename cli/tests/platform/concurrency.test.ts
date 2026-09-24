import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { it, expect } from "vitest";
import { State } from "../../src/platform/state.js";
import { Credentials, accountKey } from "../../src/platform/credentials.js";

async function command(config: string, args: string[]) {
  const child = spawn(
    process.execPath,
    [resolve("dist/bin.js"), ...args, "--config-dir", config, "--json", "--no-prompt"],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 15000 },
  );

  let out = "";
  let err = "";

  child.stdout.on("data", (v) => (out += v));
  child.stderr.on("data", (v) => (err += v));

  const [status] = await once(child, "exit");

  expect(status, err).toBe(0);
  expect(err).toBe("");

  return JSON.parse(out);
}

it("two CLI processes preserve independent profile writes and share one token refresh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-process-store-"));
  let refreshes = 0;

  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");

    if (req.url === "/api/v4/site/ping") {
      expect(req.headers.authorization).toBeUndefined();
      res.end(JSON.stringify({ code: 0, data: "4.18.0" }));
    } else if (req.url?.includes("/token/refresh")) {
      refreshes++;

      res.end(
        JSON.stringify({
          code: 0,
          data: {
            access_token: "fresh",
            refresh_token: "fresh-r",
            access_expires: "2030-01-01",
            refresh_expires: "2031-01-01",
          },
        }),
      );
    } else {
      expect(req.headers.authorization).toBe("Bearer fresh");
      res.end(JSON.stringify({ code: 0, data: { id: "a", nickname: "Name" } }));
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const endpoint = "http://127.0.0.1:" + (server.address() as { port: number }).port;

  try {
    await Promise.all([
      command(dir, ["profile", "add", "one", "--server", endpoint, "--credential-store", "file"]),
      command(dir, ["profile", "add", "two", "--server", endpoint, "--credential-store", "file"]),
    ]);

    const s = new State(dir);
    const config = await s.config();

    expect(Object.keys(config.profiles).sort()).toEqual(["one", "two"]);
    config.profiles.one!.accountId = "a";
    await s.write("config.json", config);

    await new Credentials(s).put(accountKey(endpoint, "a"), "file", {
      generation: "login",
      tokens: {
        accessToken: "expired",
        refreshToken: "old-r",
        accessExpiresAt: 0,
        refreshExpiresAt: Date.now() + 100000,
      },
    });

    const outputs = await Promise.all([
      command(dir, ["account", "view", "--profile", "one"]),
      command(dir, ["account", "view", "--profile", "one"]),
    ]);

    expect(outputs.map((x) => x.data.id)).toEqual(["a", "a"]);
    expect(refreshes).toBe(1);
  } finally {
    server.close();
    server.closeAllConnections();
    await rm(dir, { recursive: true });
  }
}, 20000);

it("recovers a lease after an owning process is killed without deleting unrelated state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cr-killed-"));
  const stateModule = new URL("../../dist/platform/state.js", import.meta.url).href;

  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import{State}from ${JSON.stringify(stateModule)};await new State(${JSON.stringify(dir)}).exclusive('test',async()=>{setInterval(()=>{},1000);process.stdout.write('ready');await new Promise(()=>{});});`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  try {
    await once(child.stdout, "data");
    child.kill("SIGKILL");
    await once(child, "exit");

    const s = new State(dir);

    await s.write("unrelated.json", { keep: true });

    await s.exclusive("test", async () => {
      expect(await s.read("unrelated.json", null)).toEqual({ keep: true });
    });
  } finally {
    child.kill("SIGKILL");
    await rm(dir, { recursive: true });
  }
}, 20000);
