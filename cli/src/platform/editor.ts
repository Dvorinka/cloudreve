import { mkdtemp, rm, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MAX_TEXT_BYTES } from "@cloudreve/sdk/files";
import { executeTool } from "./external-tool.js";
import { textInput } from "./files.js";
import { CliError } from "../output/errors.js";
import { windowsPrivacy } from "./private-permissions.js";

export async function editText(
  text: string,
  executable: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();

  const directory = await mkdtemp(join(tmpdir(), "cloudreve-tool-"));
  const path = join(directory, "document.txt");

  try {
    await windowsPrivacy(directory, true, true);
    await writeFile(path, text, { mode: 0o600, flag: "wx" });
    await executeTool(executable, [path], { signal });
    signal.throwIfAborted();

    const info = await lstat(path);

    if (!info.isFile() || info.isSymbolicLink()) {
      throw new CliError("input", "Editor result must be a regular file");
    }

    return await textInput(path, MAX_TEXT_BYTES, async () => Buffer.alloc(0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
