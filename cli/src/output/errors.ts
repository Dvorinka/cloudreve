import { lockConflicts } from "@cloudreve/sdk/files";
import { safe } from "./safe.js";

export class CliError extends Error {
  constructor(
    public kind: string,
    message: string,
    public status = 2,
    public outcomes?: unknown,
  ) {
    super(message);
  }
}

export function errorResult(
  error: unknown,
  revealLocks = false,
): {
  status: number;
  error: {
    kind: string;
    message: string;
    correlationId?: string;
    outcomes?: unknown;
    locks?: unknown;
    phase?: "persistence" | "revocation";
  };
} {
  if (error instanceof CliError) {
    return {
      status: error.status,
      error: {
        kind: error.kind,
        message: String(safe(error.message)),
        ...(error.outcomes !== undefined ? { outcomes: safe(error.outcomes) } : {}),
      },
    };
  }

  const value = error as {
    code?: number | string;
    correlationId?: string;
    name?: string;
    aggregatedError?: unknown;
    phase?: "persistence" | "revocation";
  };

  const conflicts = lockConflicts(error);
  const auth = value?.phase !== "revocation" && [401, 40020].includes(Number(value?.code));

  return {
    status: auth ? 4 : 1,
    error: {
      kind: auth ? "authentication" : "operation",
      message:
        value?.phase === "revocation"
          ? String(
              safe(
                `Signed out locally; server revocation failed: ${error instanceof Error ? error.message : "operation failed"}`,
              ),
            )
          : error instanceof Error
            ? String(safe(error.message))
            : "Operation failed",
      ...(conflicts.length
        ? {
            locks: conflicts.map((conflict) =>
              revealLocks
                ? {
                    ...(safe(conflict) as object),
                    ...(conflict.token ? { token: conflict.token } : {}),
                  }
                : safe(conflict),
            ),
          }
        : {}),
      ...(value?.phase ? { phase: value.phase } : {}),
      ...(value?.aggregatedError !== undefined ? { outcomes: safe(value.aggregatedError) } : {}),
      ...(value?.correlationId ? { correlationId: value.correlationId } : {}),
    },
  };
}
