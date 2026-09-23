import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { selectSearchImage } from "../../scripts/ci/services.mjs";

it("selects the pinned native search helper from daemon architecture while retaining one release", () => {
  const definition = JSON.parse(readFileSync("docs/compatibility-matrix.json", "utf8")).services
    .search;

  expect(definition.version).toBe("1.37.0");
  expect(definition.revision).toBe("d6c0f4b4c57ad331133f45a4f17c855e5bba2611");

  for (const architecture of ["aarch64", "arm64"]) {
    expect(selectSearchImage(definition, architecture)).toEqual({
      image: definition.platforms["linux/arm64"],
      platform: "linux/arm64",
    });
  }

  for (const architecture of ["x86_64", "amd64"]) {
    expect(selectSearchImage(definition, architecture)).toEqual({
      image: definition.platforms["linux/amd64"],
      platform: "linux/amd64",
    });
  }

  expect(() => selectSearchImage(definition, "unknown")).toThrow("Unsupported Docker daemon");

  expect(() =>
    selectSearchImage({ platforms: { "linux/arm64": "getmeili/meilisearch:latest" } }, "arm64"),
  ).toThrow();
});
