import { compareSemver } from "@cloudreve/sdk/session";
import { CliError } from "./output/errors.js";

export const serverCompatibility = {
  minimum: "4.17.0",
  exclusiveMaximum: "5.0.0-0",
  trashEmptyMinimum: "4.18.0",
} as const;

export function requireServerVersion(
  server: { version: string; isPro: boolean },
  feature?: "trash-empty",
) {
  let supported = false;

  try {
    supported =
      compareSemver(server.version, serverCompatibility.minimum) >= 0 &&
      compareSemver(server.version, serverCompatibility.exclusiveMaximum) < 0;
  } catch {
    // Invalid SemVer receives the same compatibility diagnostic as an out-of-range version.
  }

  if (!supported) {
    throw new CliError(
      "compatibility",
      `Cloudreve API compatibility requires >=${serverCompatibility.minimum} <5 (including 4.x prereleases); server reported ${server.isPro ? "Pro " : ""}${server.version}. Use server info for inspection.`,
      1,
    );
  }

  if (
    feature === "trash-empty" &&
    compareSemver(server.version, serverCompatibility.trashEmptyMinimum) < 0
  ) {
    throw new CliError(
      "capability",
      "trash empty requires Cloudreve >=4.18.0; no deletion was attempted",
      1,
    );
  }

  return server;
}
