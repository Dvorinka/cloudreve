import { expect, it } from "vitest";
import { requireLinux } from "../../scripts/ci/require-linux.mjs";

it("accepts native Linux runners and rejects other E2E platforms", () => {
  expect(() => requireLinux("linux")).not.toThrow();
  expect(() => requireLinux("darwin")).toThrow("requires a Linux runner");
  expect(() => requireLinux("win32")).toThrow("requires a Linux runner");
});
