import { expect, it } from "vitest";

// @ts-expect-error Test-only JavaScript fixture module has no production type surface.
import { otp, account } from "../../scripts/ci/scenarios/account.mjs";

it("generates six-digit RFC 6238 fixture codes rather than bypassing OTP", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  expect(otp(secret, 59000)).toBe("287082");
  expect(otp(secret, 1111111109000)).toBe("081804");
  expect(otp(secret.toLowerCase(), 1111111111000)).toBe("050471");
  expect(() => otp("invalid!", 59000)).toThrow("base32");
  expect(() => otp("A", 59000)).toThrow("Empty OTP key");
});

it("preserves the account failure while exercising real SDK session cleanup", async () => {
  const { vi } = await import("vitest");
  const { Authentication } = await import("@cloudreve/sdk/session");
  const { Profile } = await import("@cloudreve/sdk/profile");
  const user = { id: "isolated", nickname: "Fixture" };

  vi.spyOn(Authentication.prototype, "register").mockResolvedValue({
    status: "active",
    user,
  });

  vi.spyOn(Authentication.prototype, "password").mockResolvedValue({
    kind: "authenticated",
    session: {
      user,
      token: {
        access_token: "fixture-access",
        refresh_token: "fixture-refresh",
        access_expires: "2099-01-01T00:00:00Z",
        refresh_expires: "2099-02-01T00:00:00Z",
      },
    },
  });

  vi.spyOn(Profile.prototype, "me").mockResolvedValue(user);

  try {
    for (const failCleanup of [false, true]) {
      const original = new Error("original profile assertion");
      const cleanup = new Error("restore failed");

      const run = vi.fn(async (path: string) => {
        if (path === "server info") {
          return {
            data: {
              version: "4.18.0",
              isPro: false,
              auth: { register_enabled: true },
            },
          };
        }

        if (path === "profile list") {
          return { data: { selected: "primary", profiles: { primary: {} } } };
        }

        if (path === "profile add") {
          throw original;
        }

        if (path === "profile use") {
          if (failCleanup) {
            throw cleanup;
          }

          return { data: {} };
        }

        throw new Error("Unexpected fixture call");
      });

      const result = account({
        run,
        prove: vi.fn(),
        secret: vi.fn(),
        version: "4.18.0",
        fixture: { endpoint: "http://localhost:43111" },
        sdk: { account: { me: async () => ({ id: "primary" }) } },
      });

      if (failCleanup) {
        await expect(result).rejects.toMatchObject({
          cause: original,
          errors: [original, cleanup],
        });
      } else {
        await expect(result).rejects.toBe(original);
      }

      expect(run).toHaveBeenLastCalledWith("profile use", ["primary"], undefined);
    }
  } finally {
    vi.restoreAllMocks();
  }
});
