import { CrUri } from "@cloudreve/sdk/files";
import { CliError } from "./output/errors.js";

export type Operand =
  | { kind: "local"; path: string }
  | { kind: "root"; path: "/" | "/share/" }
  | { kind: "remote"; uri: CrUri; trailingSlash: boolean };

export const roots = [
  { path: "/my/", context: "personal" },
  { path: "/trash/", context: "trash" },
  { path: "/shared_with_me/", context: "received shares" },
  { path: "/share/", context: "requires share ID" },
];

function invalid(): never {
  throw new CliError("path", "Invalid remote path or traversal above namespace root");
}

export function resolveOperand(input: string, cwd = "/my/"): Operand {
  if (input.includes("\0")) {
    invalid();
  }

  if (input.startsWith("local:")) {
    const path = input.slice(6);

    if (!path) {
      invalid();
    }

    return { kind: "local", path };
  }

  if (input.startsWith("cloudreve://")) {
    try {
      const rawPath =
        input
          .slice("cloudreve://".length)
          .replace(/^[^/]*/, "")
          .split(/[?#]/)[0] ?? "";

      let depth = 0;

      for (const raw of rawPath.split("/")) {
        const segment = decodeURIComponent(raw);

        if (segment === "..") {
          if (depth === 0) {
            invalid();
          }

          depth--;
        } else if (segment && segment !== ".") {
          depth++;
        }
      }

      if (/^[^/]*:[^/]*@/.test(input.slice("cloudreve://".length))) {
        invalid();
      }

      const url = new URL(input);
      const uri = new CrUri(input);

      if (
        url.password ||
        url.port ||
        url.hash ||
        !["my", "trash", "shared_with_me", "share"].includes(uri.fs()) ||
        (uri.fs() !== "share" && uri.id()) ||
        (uri.fs() === "share" && !uri.id()) ||
        /%2f|%5c/i.test(url.pathname)
      ) {
        invalid();
      }

      uri.elements();

      if (uri.elements().some((p) => p.includes("\0"))) {
        invalid();
      }

      return { kind: "remote", uri, trailingSlash: input.endsWith("/") };
    } catch {
      return invalid();
    }
  }

  if (!cwd.startsWith("/") || cwd.startsWith("//")) {
    invalid();
  }

  const base = input.startsWith("/") ? input : `${cwd.replace(/\/$/, "")}/${input}`;
  const raw = base.split("/").filter((p) => p !== "" && p !== ".");
  const namespace = raw.shift();

  if (namespace === undefined) {
    return { kind: "root", path: "/" };
  }

  if (!["my", "trash", "shared_with_me", "share"].includes(namespace)) {
    invalid();
  }

  const id = namespace === "share" ? raw.shift() : undefined;

  if (namespace === "share" && !id) {
    return { kind: "root", path: "/share/" };
  }

  if (id === "..") {
    invalid();
  }

  const parts: string[] = [];

  for (const part of raw) {
    if (part === "..") {
      if (!parts.length) {
        invalid();
      }

      parts.pop();
    } else {
      parts.push(part);
    }
  }

  const uri = new CrUri(`cloudreve://${id ? `${encodeURIComponent(id)}@` : ""}${namespace}/`).join(
    ...parts,
  );

  return { kind: "remote", uri, trailingSlash: input.endsWith("/") };
}

export function remote(input: string, cwd = "/my/", mutation = false): CrUri {
  const operand = resolveOperand(input, cwd);

  if (operand.kind !== "remote") {
    throw new CliError("path", "This command requires a remote path inside a namespace");
  }

  if (mutation && (operand.uri.isRoot() || operand.uri.isSearch() || operand.uri.category())) {
    throw new CliError("path", "Namespace roots and query views cannot be mutation targets");
  }

  return operand.uri;
}

export function displayPath(input: string): string | undefined {
  try {
    if (!input.startsWith("cloudreve://")) {
      return undefined;
    }

    const operand = resolveOperand(input);

    if (operand.kind !== "remote") {
      return undefined;
    }

    const u = operand.uri;

    return `/${u.fs()}${u.fs() === "share" ? `/${u.id()}` : ""}${u.path()}`;
  } catch {
    return undefined;
  }
}
