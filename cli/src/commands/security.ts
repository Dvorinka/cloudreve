import type { SettingsPatch } from "@cloudreve/sdk/profile";
import type { Context } from "../composition.js";
import { arg, numberFlag, stringArrayFlag } from "../input.js";
import { CliError } from "../output/errors.js";
import { terminalText as text } from "../output/human.js";
import { secrets } from "./auth.js";

export async function configure(c: Context) {
  const toggle = (key: string) =>
    c.inv.flags[key] === undefined ? undefined : c.inv.flags[key] === "on";

  const visibility = c.inv.flags["public-shares"];

  const patch: SettingsPatch = {
    version_retention_enabled: toggle("retain-versions"),
    version_retention_ext: stringArrayFlag(c.inv, "version-extensions-json", true),
    version_retention_max: numberFlag(c.inv, "version-limit"),
    share_links_in_profile:
      visibility === undefined
        ? undefined
        : visibility === "public"
          ? ""
          : visibility === "all"
            ? "all_share"
            : "hide_share",
  };

  const provided = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );

  if (!Object.keys(provided).length) {
    throw new CliError("usage", "Choose at least one account preference");
  }

  await (await c.backend()).account.patchSettings(provided, c.signal);

  return { updated: Object.keys(provided) };
}

export async function twoFactorSet(c: Context, enabled: boolean) {
  if (
    (!enabled && (c.inv.flags.enroll || c.inv.flags["show-secret"])) ||
    !!c.inv.flags.enroll !== !!c.inv.flags["show-secret"]
  ) {
    throw new CliError("usage", "Enrollment requires enable --enroll --show-secret");
  }

  const account = (await c.backend()).account;

  if (enabled && c.inv.flags.enroll) {
    const secret = await account.initTwoFactor(c.signal);

    await c.io.diagnostic(
      c.inv.flags.json
        ? JSON.stringify({ enrollmentSecret: secret }) + "\n"
        : `Authenticator setup key: ${text(secret)}\n`,
    );
  }

  const supplied = await secrets(c);

  await account.setTwoFactor(
    enabled,
    supplied.code ?? (await c.io.secret("One-time code")),
    c.signal,
  );

  return { enabled };
}

export async function passkeyList(c: Context) {
  return (await (await c.backend()).account.settings(c.signal)).passkeys;
}

export async function passkeyDelete(c: Context) {
  await c.confirm(`Delete passkey ${arg(c.inv, 0)}`);

  return (await c.backend()).account.deletePasskey(arg(c.inv, 0), c.signal);
}

export async function grantList(c: Context) {
  return (await (await c.backend()).account.settings(c.signal)).oauth_grants;
}

export async function grantRevoke(c: Context) {
  await c.confirm(`Revoke application grant ${arg(c.inv, 0)}`);

  return (await c.backend()).account.revokeGrant(arg(c.inv, 0), c.signal);
}
