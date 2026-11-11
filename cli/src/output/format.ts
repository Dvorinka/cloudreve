import { formatTimestamps } from "./timezone.js";
import { displayPath } from "../paths.js";
import { renderHuman } from "./human.js";
import { browserLink, webLocations, type WebContext } from "./links.js";

export { safe } from "./safe.js";

import { safe } from "./safe.js";

export function entry(value: {
  id: string;
  name: string;
  path: string;
  type: number;
  size: number;
}): unknown {
  return {
    ...(safe(value) as object),
    name: value.name,
    displayPath: displayPath(value.path),
  };
}

export function format(
  data: unknown,
  json: boolean,
  revealPassword = false,
  discloseUrls = false,
  timezone?: string,
  options: WebContext & {
    command?: string;
    args?: string[];
    width?: number;
    color?: boolean;
  } = {},
): string {
  let output = safe(data ?? null, discloseUrls);

  if (
    revealPassword &&
    data &&
    typeof data === "object" &&
    "password" in data &&
    typeof data.password === "string"
  ) {
    output = { ...(output as object), password: data.password };
  }

  if (!json) {
    const file = output as {
      path?: unknown;
      type?: number;
      id?: string;
      metadata?: Record<string, unknown>;
    } | null;

    const target = file?.metadata?.["sys:shared_redirect"] ?? file?.path;

    const browser =
      file && typeof target === "string" ? browserLink(target, options, file) : undefined;

    output = webLocations(formatTimestamps(output, timezone ?? "UTC"), options);

    if (browser) {
      output = { ...(output as object), browser };
    }
  }

  return json
    ? `${JSON.stringify({ schemaVersion: 1, data: output })}\n`
    : data === undefined && !options.command
      ? ""
      : renderHuman(options.command ?? "", output, {
          ...options,
          timezone: timezone ?? "UTC",
          args: webLocations(safe(options.args ?? []), options) as string[],
        });
}
