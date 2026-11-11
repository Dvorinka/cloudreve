import { displayPath } from "../paths.js";
import { renderHuman, terminalText as text } from "./human.js";

export function watchLine(event: unknown): string {
  const record = event as { type: string; data?: unknown };

  if (record.type === "subscribed") {
    return "Subscribed · watching for changes…\n";
  }

  if (record.type === "resumed") {
    return "Resumed · watching for changes…\n";
  }

  if (record.type === "keep-alive") {
    return "Connected · waiting for changes…\n";
  }

  const data = record.data as Record<string, unknown> | undefined;

  if (Object.values(data ?? {}).some((value) => value !== null && typeof value === "object")) {
    return renderHuman("watch", event);
  }

  const fields = Object.entries(data ?? {}).map(([key, value]) => {
    const shown = typeof value === "string" ? (displayPath(value) ?? value) : value;

    return `${text(key.replaceAll("_", " "))}: ${text(shown)}`;
  });

  return `${text(record.type)}${fields.length ? `  ${fields.join(" · ")}` : ""}\n`;
}
