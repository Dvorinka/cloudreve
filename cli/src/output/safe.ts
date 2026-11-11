import { parseShareLink } from "@cloudreve/sdk/shares";

function safeUrl(value: string, discloseUrls: boolean): string {
  try {
    const url = new URL(value);

    url.password = "";

    if (url.protocol === "cloudreve:") {
      return url.toString();
    }

    url.username = "";

    if (["http:", "https:"].includes(url.protocol)) {
      try {
        if (parseShareLink(url.toString(), url.origin).password) {
          url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/"));
        }
      } catch {
        /* Not a Cloudreve short share URL. */
      }
    }

    if (!discloseUrls) {
      for (const key of url.searchParams.keys()) {
        url.searchParams.set(key, "[redacted]");
      }

      url.hash = "";
    }

    return url.toString();
  } catch {
    return "[invalid URI]";
  }
}

export function safe(value: unknown, discloseUrls = false): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => safe(item, discloseUrls));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([k, v]) =>
            k === "next_token" ||
            (["password_protected", "passwordless", "password_enabled", "passwordEnabled"].includes(
              k,
            ) &&
              typeof v === "boolean") ||
            !/(password|token|secret|credential|encrypt_metadata|upload_urls|completeURL)/i.test(k),
        )
        .map(([k, v]) => [k, safe(v, discloseUrls)]),
    );
  }

  if (typeof value === "string") {
    if (/^(?:(?:cloudreve|https?|ftp):\/\/|magnet:\?)/i.test(value) && !/\s/.test(value)) {
      return safeUrl(value, discloseUrls);
    }

    return value.replace(/(?:cloudreve|https?|ftp):\/\/[^\s<>"']+/gi, (url) =>
      safeUrl(url, discloseUrls),
    );
  }

  return value;
}
