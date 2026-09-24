import { CliError } from "./output/errors.js";

export interface Invocation {
  command: string;
  args: string[];
  flags: Record<string, string | boolean | undefined>;
}

export function arg(inv: Invocation, index: number): string {
  const v = inv.args[index];

  if (v === undefined) {
    throw new CliError("usage", `Missing operand; ${inv.command}`);
  }

  return v;
}

export function flag(inv: Invocation, key: string): string {
  const v = inv.flags[key];

  if (typeof v !== "string" || !v) {
    throw new CliError("usage", `Missing --${key}`);
  }

  return v;
}

export function numberFlag(inv: Invocation, key: string): number | undefined {
  const v = inv.flags[key];

  if (v === undefined) {
    return undefined;
  }

  const n = Number(v);

  if (!Number.isSafeInteger(n) || n < 0) {
    throw new CliError("usage", `--${key} must be a nonnegative integer`);
  }

  return n;
}

export function stringArrayFlag(
  inv: Invocation,
  key: string,
  allowEmpty = false,
): string[] | undefined {
  if (inv.flags[key] === undefined) {
    return undefined;
  }

  try {
    const value: unknown = JSON.parse(flag(inv, key));

    if (
      !Array.isArray(value) ||
      (!allowEmpty && !value.length) ||
      value.some((item) => typeof item !== "string" || !item || item.includes("\0"))
    ) {
      throw new Error();
    }

    return value;
  } catch {
    throw new CliError("usage", `--${key} expects a nonempty JSON array of nonempty strings`);
  }
}
