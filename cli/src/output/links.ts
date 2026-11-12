import { CrUri } from "@cloudreve/sdk/files";
import { displayPath } from "../paths.js";

export interface WebContext {
  endpoint?: string;
  accountId?: string;
}

/** Match the Community web client's /home path and open query contract. */
export function browserLink(
  value: string,
  context: WebContext,
  file?: { type?: number; id?: string },
): string | undefined {
  if (!context.endpoint || !value.startsWith("cloudreve://")) {
    return;
  }

  try {
    const origin = new URL(context.endpoint);

    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    ) {
      return;
    }

    const parsed = new URL(value);

    if (
      parsed.port ||
      parsed.hash ||
      /%2f|%5c|\\/i.test(parsed.pathname) ||
      !["my", "trash", "shared_with_me", "share"].includes(parsed.hostname)
    ) {
      return;
    }

    const uri = new CrUri(value);
    const parts = uri.elements();

    if (parts.some((part) => /\p{Cc}/u.test(part))) {
      return;
    }

    if (parsed.hostname === "share" && !parsed.username) {
      return;
    }

    // Generated links are navigation, never bearer capabilities.
    parsed.password = "";
    parsed.search = "";

    if (parsed.hostname === "my" && context.accountId) {
      parsed.username = context.accountId;
    } else if (parsed.hostname !== "share") {
      parsed.username = "";
    }

    const link = new URL("/home", origin);

    if (["trash", "shared_with_me"].includes(parsed.hostname)) {
      // These are flat collections; item identifiers are not directory names.
      parsed.pathname = "/";
    } else if (file?.type !== 1 && parts.length) {
      const name = parts.at(-1)!;

      parts.pop();
      parsed.pathname = "/" + parts.map(encodeURIComponent).join("/");

      // Narrow the listing; the web client opens only targets present on its loaded page.
      parsed.searchParams.set("name", name);

      if (file?.id) {
        link.searchParams.set("open", file.id);
      }
    }

    link.searchParams.set("path", parsed.toString());

    return link.toString();
  } catch {
    return;
  }
}

/** Human output only: machine JSON and raw file contents retain their contracts. */
export function webLocations(value: unknown, context: WebContext): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => webLocations(item, context));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, webLocations(item, context)]),
    );
  }

  if (typeof value !== "string") {
    return value;
  }

  const location = (uri: string) =>
    browserLink(uri, context) ?? displayPath(uri) ?? "[internal location unavailable]";

  return /^cloudreve:\/\/\S+$/i.test(value)
    ? location(value)
    : value.replace(/cloudreve:\/\/[^\s<>"']+/gi, location);
}
