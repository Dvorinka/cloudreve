import { it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { compose } from "../../src/composition.js";
import { dispatch } from "../../src/main.js";
import { parse } from "../../src/program.js";
import { State } from "../../src/platform/state.js";
import { credentialGenerationKey } from "../../src/platform/session-store.js";
import { Credentials, accountKey } from "../../src/platform/credentials.js";
import type { Terminal } from "../../src/platform/terminal.js";

it.each([
  ["4.16.1", false],
  ["4.16.1", true],
  ["5.0.0", false],
  ["5.0.0", true],
  ["offline", false],
  ["offline", true],
] as const)("keeps local sign-out available for server %s (remove=%s)", async (version, remove) => {
  let probes = 0;
  let mutations = 0;

  const server = setupServer(
    http.get("https://cleanup.test/api/v4/site/ping", () => {
      probes++;

      return version === "offline"
        ? HttpResponse.error()
        : HttpResponse.json({ code: 0, data: version });
    }),
    http.all("https://cleanup.test/*", () => {
      mutations++;

      return new HttpResponse(null, { status: 500 });
    }),
  );

  server.listen({ onUnhandledRequest: "error" });

  try {
    const directory = await mkdtemp(join(tmpdir(), "cr-local-session-"));
    const state = new State(directory);

    await state.write("config.json", {
      version: 1,
      selected: "p",
      profiles: {
        p: {
          id: "stable",
          endpoint: "https://cleanup.test",
          accountId: "a",
          credentialStore: "file",
        },
      },
    });

    await new Credentials(state).save("p", "file", {
      accessToken: "private-access",
      refreshToken: "private-refresh",
      accessExpiresAt: Date.now() + 60000,
      refreshExpiresAt: Date.now() + 600000,
    });

    let output = "";

    const io: Terminal = {
      write: async (value) => {
        output += String(value);
      },
      diagnostic: async () => {},
      input: async () => {
        throw Error("unexpected stdin");
      },
      secret: async () => {
        throw Error("unexpected prompt");
      },
      confirm: async () => true,
    };

    const create = (args: string[]) =>
      compose(
        parse([...args, "--config-dir", directory, "--json"]),
        io,
        new AbortController().signal,
      );

    const status = await create(["auth", "status"]);
    const before = probes;

    try {
      await dispatch(status);
      expect(JSON.parse(output).data.authenticated).toBe(true);
      expect(probes).toBe(before);
      expect(output).not.toContain("private-");
    } finally {
      await status.dispose();
    }

    const action = await create(remove ? ["profile", "remove", "p", "--yes"] : ["auth", "logout"]);

    try {
      await expect(dispatch(action)).rejects.toMatchObject(
        remove
          ? {
              kind: "revocation",
              outcomes: { removed: true, revoked: false },
            }
          : { phase: "revocation" },
      );

      expect(probes).toBe(before + 1);
      expect(mutations).toBe(0);

      const key = accountKey("https://cleanup.test", "a");

      const head = await state.read<{ generation: string }>(key + ".identity.json", {
        generation: "missing",
      });

      expect(
        await new Credentials(state).record(credentialGenerationKey(key, head.generation), "file"),
      ).toMatchObject({ tokens: null });

      if (remove) {
        expect((await state.config()).profiles.p).toBeUndefined();
      } else {
        const restored = await create(["auth", "status"]);

        try {
          expect((await restored.session()).getSnapshot().status).toBe("signedOut");
        } finally {
          await restored.dispose();
        }
      }

      expect(await new Credentials(state).get("p", "file")).toBeNull();
    } finally {
      await action.dispose();
      await rm(directory, { recursive: true });
    }
  } finally {
    server.close();
  }
});
