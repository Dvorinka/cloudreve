import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { windowsPrivacy } from "../../src/platform/private-permissions.js";
import { State } from "../../src/platform/state.js";

it.runIf(process.platform === "win32")(
  "rejects credentials after a real Windows ACL grants access to Everyone",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "cr-acl-凭据'-"));
    const file = join(directory, "credentials.json");

    try {
      await windowsPrivacy(directory, true, true);
      await writeFile(file, '{"private":true}');
      await windowsPrivacy(file);

      const shell = join(
        process.env.SystemRoot!,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );

      execFileSync(
        shell,
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `
      $ErrorActionPreference='Stop'
      [Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)
      $path=[Console]::In.ReadToEnd()
      $acl=Get-Acl -LiteralPath $path
      $sid=New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
      $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow')
      $acl.AddAccessRule($rule)
      Set-Acl -LiteralPath $path -AclObject $acl
    `,
        ],
        { input: file },
      );

      await expect(windowsPrivacy(file)).rejects.toThrow("private data");

      await expect(new State(directory).read("credentials.json", null)).rejects.toThrow(
        "private data",
      );

      await windowsPrivacy(file, true);
      expect(await new State(directory).read("credentials.json", null)).toEqual({ private: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
