import { execFile } from "node:child_process";
import { join } from "node:path";
import { CliError } from "../output/errors.js";

const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
$path = $inputData.path
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$allowed = @($user.Value, 'S-1-5-18', 'S-1-5-32-544')
if ($inputData.protect) {
  $acl = if ($inputData.directory) { New-Object System.Security.AccessControl.DirectorySecurity } else { New-Object System.Security.AccessControl.FileSecurity }
  $acl.SetOwner($user)
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = if ($inputData.directory) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
  foreach ($sid in $allowed) {
    $identity = New-Object System.Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', $inherit, 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}
$acl = Get-Acl -LiteralPath $path
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
if ($owner -notin $allowed -or $rules.Count -eq 0) { throw 'Unsafe owner or empty access policy' }
foreach ($rule in $rules) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) { throw 'Access granted to another identity' }
}
`;

/** Verify Windows ACLs, or restrict a newly created empty path before writing private data. */
export async function windowsPrivacy(
  path: string,
  protect = false,
  directory = false,
): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }

  const executable = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );

  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      executable,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      {
        timeout: 15000,
        maxBuffer: 65536,
        windowsHide: true,
      },
      (error) => {
        if (error) {
          reject(
            new CliError(
              "permissions",
              "Windows access policy must keep private data restricted to its owner",
              1,
            ),
          );
        } else {
          resolve();
        }
      },
    );

    child.stdin?.end(JSON.stringify({ path, protect, directory }));
  });
}
