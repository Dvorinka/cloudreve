import { CliError } from "./output/errors.js";

export function validateProfileName(name: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    throw new CliError(
      "usage",
      "Profile name must contain 1–64 letters, digits, underscores or hyphens",
    );
  }
}

export function endpoint(input: string): string {
  try {
    const u = new URL(input);

    if (
      !["https:", "http:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    ) {
      throw new Error();
    }

    return u.origin;
  } catch {
    throw new CliError(
      "usage",
      "Server must be an HTTP(S) origin without credentials, path, query or fragment",
    );
  }
}
