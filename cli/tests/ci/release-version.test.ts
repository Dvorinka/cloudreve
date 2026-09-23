import { expect, it } from "vitest";

// @ts-expect-error The release helper runs directly in Node without a build step.
import { releaseVersion } from "../../scripts/release-version.mjs";

it("resolves stable release versions and semantic increments", () => {
  expect(releaseVersion("1.2.3", "1.2.3")).toBe("1.2.3");
  expect(releaseVersion("1.2.3", "2.0.0")).toBe("2.0.0");
  expect(releaseVersion("1.2.3", "", "patch")).toBe("1.2.4");
  expect(releaseVersion("1.2.3", "", "minor")).toBe("1.3.0");
  expect(releaseVersion("1.2.3", "", "major")).toBe("2.0.0");
});

it("rejects ambiguous, invalid, decreasing and overflowing release requests", () => {
  for (const [version, bump] of [
    ["", "none"],
    ["2.0.0", "patch"],
    ["2.0.0", "other"],
    ["01.0.0", "none"],
    ["1.2.3\n", "none"],
    ["1.0.0-beta", "none"],
    ["0.9.0", "none"],
    ["99999999999999999.0.0", "none"],
  ]) {
    expect(() => releaseVersion("1.2.3", version, bump)).toThrow();
  }

  expect(() => releaseVersion("9007199254740991.0.0", "", "major")).toThrow();
});
