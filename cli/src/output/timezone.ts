import { CliError } from "./errors.js";

const timestampKeys = new Set([
  "created_at",
  "updated_at",
  "used_at",
  "last_used_at",
  "expires_at",
  "access_expires",
  "refresh_expires",
  "at",
]);

export function validateTimezone(input: string): string {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: input }).resolvedOptions().timeZone;
  } catch {
    throw new CliError("usage", "Unknown timezone; use an IANA name such as Europe/London");
  }
}

function isoTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  ) {
    return false;
  }

  const date = Date.parse(value.slice(0, 10) + "T00:00:00Z");

  return (
    Number.isFinite(date) &&
    new Date(date).toISOString().slice(0, 10) === value.slice(0, 10) &&
    Number.isFinite(Date.parse(value))
  );
}

/** Human metadata only; callers must leave machine JSON timestamps untouched. */
export function formatTimestamps(value: unknown, zone: string): unknown {
  return timestampFormatter(zone)(value);
}

/** Reuse one formatter while rendering a streamed directory. */
export function timestampFormatter(zone: string): (value: unknown) => unknown {
  const timeZone = validateTimezone(zone);

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  });

  function walk(input: unknown, metadata = false): unknown {
    if (Array.isArray(input)) {
      return input.map((item) => walk(item, metadata));
    }

    if (
      !input ||
      typeof input !== "object" ||
      (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    ) {
      return input;
    }

    return Object.fromEntries(
      Object.entries(input).map(([key, item]) => {
        if (!metadata && timestampKeys.has(key) && isoTimestamp(item)) {
          const parts = Object.fromEntries(
            formatter.formatToParts(new Date(item)).map((part) => [part.type, part.value]),
          );

          return [
            key,
            `${parts.year!.padStart(4, "0")}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName} [${timeZone}]`,
          ];
        }

        return [key, walk(item, metadata || key === "metadata")];
      }),
    );
  }

  return walk;
}
