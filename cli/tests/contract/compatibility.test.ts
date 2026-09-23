import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { serverCompatibility, requireServerVersion } from "../../src/compatibility.js";

it("accepts in-range SemVer releases, prereleases and metadata on either edition", () => {
  for (const version of [
    "4.17.0",
    "4.17.12",
    "4.18.0",
    "4.18.123",
    "4.19.0",
    "4.42.7",
    "4.999.0",
    "4.17.0+build.001",
    "4.17.1-0",
    "4.18.0-alpha.1",
    "4.19.0-alpha.1",
    "4.19.0-alpha.2",
    "4.19.0-alpha.10",
    "4.19.0-rc.1+sha.abcd",
    "4.19.0-alpha-beta.1",
  ]) {
    for (const isPro of [false, true]) {
      expect(requireServerVersion({ version, isPro })).toEqual({
        version,
        isPro,
      });
    }
  }
});

it("rejects versions below the floor, every 5.x release, and malformed SemVer", () => {
  for (const version of [
    "4.10.0-alpha.1",
    "4.16.1",
    "4.17.0-0",
    "4.17.0-rc.1",
    "3.99.0",
    "4.0.0",
    "5.0.0-0",
    "5.0.0-alpha.1",
    "5.0.0",
    "5.1.0",
    "6.0.0",
    "4.017.0",
    "4.9007199254740992.0",
    "4.18",
    "v4.18.0",
    "4.18.00",
    "4.18.-1",
    "4.18.1.0",
    "4.19.0-alpha.01",
    "4.19.0-alpha..1",
    "4.19.0-",
    "4.19.0+",
    "4.19.0+build..1",
    "4.19.0-a_1",
    " 4.18.0",
    "4.18.0\n",
    "4.18.9007199254740992",
    "",
    "unknown",
  ]) {
    expect(() => requireServerVersion({ version, isPro: false }), version).toThrow(
      "Cloudreve API compatibility",
    );
  }
});

it("refuses empty-trash on 4.17 without emulating deletion", () => {
  for (const version of ["4.17.9", "4.18.0-alpha.1"]) {
    expect(() => requireServerVersion({ version, isPro: false }, "trash-empty")).toThrow(
      "no deletion was attempted",
    );
  }

  for (const version of ["4.18.0", "4.19.0-alpha.1", "4.19.0", "4.42.7"]) {
    expect(requireServerVersion({ version, isPro: false }, "trash-empty").version).toBe(version);
  }
});

it("keeps the documented matrix policy aligned with the runtime guard", () => {
  const matrix = JSON.parse(readFileSync("docs/compatibility-matrix.json", "utf8"));

  expect(matrix.policy.minimumInclusive).toBe(serverCompatibility.minimum);
  expect(matrix.policy.maximumExclusive).toBe(serverCompatibility.exclusiveMaximum);
});
