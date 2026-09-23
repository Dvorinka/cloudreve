import type { Context } from "../composition.js";

export async function diagnostics(c: Context) {
  const profile = c.config.profiles[c.name];

  const result = {
    runtime: c.runtime(),
    configuredProfiles: Object.keys(c.config.profiles).length,
    profile: profile
      ? {
          name: c.name,
          endpoint: profile.endpoint,
          accountId: profile.accountId,
          authentication: profile.authContext ?? "password",
        }
      : null,
    online: false,
  };

  if (c.inv.flags.online) {
    await (await c.backend()).account.me(c.signal);
    result.online = true;
  }

  return result;
}
