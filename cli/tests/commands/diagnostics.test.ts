import { it, expect } from "vitest";
import { context } from "./context.js";
import { diagnostics } from "../../src/commands/diagnostics.js";

it("reports local connection metadata without network or retired cache state", async () => {
  const x = context();

  expect(await diagnostics(x.c)).toMatchObject({
    configuredProfiles: 1,
    online: false,
  });

  expect(await diagnostics(x.c)).not.toHaveProperty("offline");
  expect(x.raw.backend).not.toHaveBeenCalled();
  x.c.inv.flags.online = true;
  expect(await diagnostics(x.c)).toMatchObject({ online: true });
  expect(x.b.account.me).toHaveBeenCalled();
  x.c.config.profiles = {};
  x.c.inv.flags = {};

  expect(await diagnostics(x.c)).toMatchObject({
    configuredProfiles: 0,
    profile: null,
  });
});
