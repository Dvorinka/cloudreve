import { expect, it } from "vitest";
import { dispatch } from "../../src/main.js";
import { context } from "./context.js";

it("patches only chosen non-security preferences including clearing extension lists", async () => {
  const x = context([
    "account",
    "configure",
    "--retain-versions",
    "on",
    "--version-extensions-json",
    '["txt","md"]',
    "--version-limit",
    "3",
    "--public-shares",
    "all",
  ]);

  await dispatch(x.c);

  expect(x.b.account.patchSettings).toHaveBeenCalledWith(
    {
      version_retention_enabled: true,
      version_retention_ext: ["txt", "md"],
      version_retention_max: 3,
      share_links_in_profile: "all_share",
    },
    x.c.signal,
  );

  for (const visibility of ["public", "none"]) {
    const z = context([
      "account",
      "configure",
      "--public-shares",
      visibility,
      "--retain-versions",
      "off",
      "--version-extensions-json",
      "[]",
    ]);

    await dispatch(z.c);

    expect(z.b.account.patchSettings).toHaveBeenCalledWith(
      {
        version_retention_enabled: false,
        version_retention_ext: [],
        share_links_in_profile: visibility === "public" ? "" : "hide_share",
      },
      z.c.signal,
    );
  }

  const none = context(["account", "configure"]);

  await expect(dispatch(none.c)).rejects.toThrow("at least one");
  expect(none.b.account.patchSettings).not.toHaveBeenCalled();
});

it("requires explicit sensitive output and protects security mutations", async () => {
  const setup = context([
    "account",
    "two-factor",
    "enable",
    "--enroll",
    "--show-secret",
    "--secrets-stdin",
  ]);

  setup.raw.io.input.mockResolvedValue(Buffer.from('{"code":"123456"}'));
  await dispatch(setup.c);
  expect(setup.stderr()).toContain("fixture-secret");
  expect(setup.stdout()).not.toContain("fixture-secret");

  for (const action of ["enable", "disable"]) {
    const x = context(["account", "two-factor", action, "--secrets-stdin"]);

    x.raw.io.input.mockResolvedValue(Buffer.from('{"code":"123456"}'));
    await dispatch(x.c);

    expect(x.b.account.setTwoFactor).toHaveBeenCalledWith(
      action === "enable",
      "123456",
      x.c.signal,
    );
  }

  const prompted = context(["account", "two-factor", "enable"]);

  await dispatch(prompted.c);
  expect(prompted.raw.io.secret).toHaveBeenCalled();

  for (const [command, method] of [
    ["passkey", "deletePasskey"],
    ["grant", "revokeGrant"],
  ] as const) {
    const x = context([
      "account",
      command,
      command === "passkey" ? "delete" : "revoke",
      "id",
      "--yes",
    ]);

    await dispatch(x.c);
    expect(x.raw.confirm).toHaveBeenCalled();
    expect(x.b.account[method]).toHaveBeenCalledWith("id", x.c.signal);
  }
});

it("lists authenticators and grants without enrollment or consent commands", async () => {
  for (const args of [
    ["account", "passkey", "list"],
    ["account", "grant", "list"],
  ]) {
    await dispatch(context(args).c);
  }
});

it("omits GUI/security preferences from account settings and rejects retired write flags", async () => {
  const x = context(["account", "settings", "--json"]);

  x.b.account.settings.mockResolvedValue({
    version_retention_enabled: true,
    version_retention_ext: ["txt"],
    version_retention_max: 4,
    share_links_in_profile: "hide_share",
    language: "en",
    preferred_theme: "dark",
    disable_view_sync: true,
    passkeys: [{ id: "private" }],
    oauth_grants: [],
    two_fa_enabled: true,
  });

  await dispatch(x.c);

  expect(JSON.parse(x.stdout()).data).toEqual({
    version_retention_enabled: true,
    version_retention_ext: ["txt"],
    version_retention_max: 4,
    share_links_in_profile: "hide_share",
  });

  for (const args of [
    ["--language", "en"],
    ["--accent", "blue"],
    ["--view-sync", "on"],
  ]) {
    await expect(async () =>
      dispatch(context(["account", "configure", ...args]).c),
    ).rejects.toThrow();
  }
});

it("requires both explicit enrollment flags and displays the secret before accepting its code", async () => {
  for (const args of [
    ["enable", "--enroll"],
    ["enable", "--show-secret"],
    ["disable", "--enroll", "--show-secret"],
  ]) {
    const x = context(["account", "two-factor", ...args]);

    await expect(dispatch(x.c)).rejects.toThrow("Enrollment requires");
    expect(x.raw.backend).not.toHaveBeenCalled();
    expect(x.raw.io.input).not.toHaveBeenCalled();
  }

  const x = context([
    "account",
    "two-factor",
    "enable",
    "--enroll",
    "--show-secret",
    "--secrets-stdin",
  ]);

  x.raw.io.input.mockImplementation(async () => {
    expect(x.stderr()).toContain("fixture-secret");
    expect(x.b.account.setTwoFactor).not.toHaveBeenCalled();

    return Buffer.from('{"code":"654321"}');
  });

  await dispatch(x.c);
  expect(x.b.account.setTwoFactor).toHaveBeenCalledWith(true, "654321", x.c.signal);
});
