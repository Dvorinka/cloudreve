import type * as ExternalTool from "../../src/platform/external-tool.js";
import { it, expect, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { editText } from "../../src/platform/editor.js";

vi.mock("../../src/platform/external-tool.js", async (original) => {
  const actual = await original<typeof ExternalTool>();

  return {
    executeTool: (executable: string, args: string[], options: { signal: AbortSignal }) =>
      actual.executeTool(process.execPath, [executable, ...args], options),
  };
});

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function tool(body: string) {
  const root = await mkdtemp(join(tmpdir(), "cr-editor-test-"));

  roots.push(root);

  const path = join(root, "editor.mjs");

  await writeFile(path, `#!${process.execPath}\nimport * as fs from 'node:fs';\n${body}`, {
    mode: 0o700,
  });

  return { path, root };
}

it("edits private temporary text and removes it after success or failed validation", async () => {
  const t = await tool(`fs.writeFileSync(${JSON.stringify("RECEIPT")},process.argv[2]);`);
  const receipt = join(t.root, "receipt");

  await writeFile(
    t.path,
    `#!${process.execPath}\nimport * as fs from 'node:fs';fs.writeFileSync(${JSON.stringify(receipt)},process.argv[2]);if(process.platform!=='win32'&&(fs.statSync(process.argv[2]).mode&63)!==0)process.exit(9);fs.writeFileSync(process.argv[2],'changed 雪');`,
    { mode: 0o700 },
  );

  expect(await editText("before", t.path, new AbortController().signal)).toBe("changed 雪");

  const temporary = await readFile(receipt, "utf8");

  await expect(stat(temporary)).rejects.toThrow();

  for (const action of [
    "fs.writeFileSync(process.argv[2],Buffer.from([255]));",
    "fs.unlinkSync(process.argv[2]);fs.symlinkSync(process.execPath,process.argv[2],'file');",
    "process.exit(1);",
  ]) {
    const bad = await tool(action);

    await expect(editText("before", bad.path, new AbortController().signal)).rejects.toThrow();
  }

  const controller = new AbortController();

  controller.abort();
  await expect(editText("before", t.path, controller.signal)).rejects.toThrow();
});
