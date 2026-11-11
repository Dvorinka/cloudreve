import { expect, it } from "vitest";
import { formatTimestamps, validateTimezone } from "../../src/output/timezone.js";

it("validates a canonical timezone and rejects invalid zones without echoing input", () => {
  expect(validateTimezone("UTC")).toBe("UTC");
  expect(validateTimezone("America/New_York")).toBe("America/New_York");

  for (const zone of ["", "invalid/zone", "secret timezone"]) {
    expect(() => validateTimezone(zone)).toThrow("Unknown timezone");
  }
});

it("renders explicit zones including DST boundaries without changing inputs", () => {
  const data = [
    { created_at: "2026-03-08T06:59:59Z", updated_at: "2026-03-08T07:00:00Z" },
    { at: "2026-11-01T06:00:00Z" },
  ];

  expect(formatTimestamps(data, "America/New_York")).toEqual([
    {
      created_at: "2026-03-08 01:59:59 GMT-5 [America/New_York]",
      updated_at: "2026-03-08 03:00:00 GMT-4 [America/New_York]",
    },
    { at: "2026-11-01 01:00:00 GMT-5 [America/New_York]" },
  ]);

  expect(data[0]!.created_at).toBe("2026-03-08T06:59:59Z");

  expect(formatTimestamps({ used_at: "2026-09-12T08:00:00.123+08:00" }, "UTC")).toEqual({
    used_at: expect.stringMatching(/^2026-09-12 00:00:00 GMT(?:\+0)? \[UTC\]$/),
  });
});

it("preserves metadata, arbitrary strings, numeric timestamps and invalid dates", () => {
  const source = {
    metadata: {
      at: "2026-01-01T00:00:00Z",
      nested: [{ created_at: "2026-01-01T00:00:00Z" }],
    },
    message: "2026-01-01T00:00:00Z",
    count: 1,
    created_at: 0,
    entries: [null, false, "unchanged"],
  };

  expect(formatTimestamps(source, "UTC")).toEqual(source);
  expect(formatTimestamps(source, "UTC")).not.toBe(source);

  for (const at of [
    "bad",
    "2026-02-30T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:00:00+99:99",
  ]) {
    expect(formatTimestamps({ at }, "UTC")).toEqual({ at });
  }

  const date = new Date();

  expect(formatTimestamps(date, "UTC")).toBe(date);

  const plain = Object.assign(Object.create(null), {
    at: "2026-01-01T00:00:00Z",
  });

  expect(formatTimestamps(plain, "UTC")).toEqual({
    at: expect.stringMatching(/^2026-01-01 00:00:00 GMT(?:\+0)? \[UTC\]$/),
  });
});
