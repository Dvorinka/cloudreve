import assert from "node:assert/strict";

/** Resolve an explicit release version or one semantic-version increment. */
export function releaseVersion(current, explicit = "", bump = "none") {
  const parse = (value) => {
    assert.match(
      value,
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
      "Expected a stable semantic version",
    );

    const parts = value.split(".").map(Number);

    assert(parts.every(Number.isSafeInteger), "Version component exceeds integer range");
    assert.equal(value, parts.join("."), "Expected a canonical stable version");

    return parts;
  };

  const previous = parse(current);

  assert(["none", "patch", "minor", "major"].includes(bump), "Invalid version bump");
  assert(Boolean(explicit) !== (bump !== "none"), "Choose an explicit version or a bump");

  if (explicit) {
    const next = parse(explicit);
    const difference = next.findIndex((part, index) => part !== previous[index]);

    assert(
      difference === -1 || next[difference] > previous[difference],
      "Release version cannot decrease",
    );

    return explicit;
  }

  const index = { major: 0, minor: 1, patch: 2 }[bump];

  const next = previous.map((part, position) =>
    position < index ? part : position === index ? part + 1 : 0,
  );

  const result = next.join(".");

  parse(result);

  return result;
}
