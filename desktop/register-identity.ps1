<#
.SYNOPSIS
    Register package identity for an installed (setup.exe/MSI) Cloudreve Desktop.

.DESCRIPTION
    The Explorer context menu (Share link, View online, Sync now, ...) and other
    shell integration require MSIX package identity, which a plain NSIS/MSI
    install does not provide. Note: the app itself does this natively via
    `cloudreve-desktop.exe --install-identity` (PackageManager API, no
    PowerShell) - this script is the manual/diagnostic equivalent.

    Two registration paths, in order of preference:

    1. Signed sparse package (production): if Cloudreve-Identity.msix and
       cloudreve-identity.cer ship with the install, the cert is trusted into
       LocalMachine\TrustedPeople (one-time, needs elevation) and the sparse
       package is installed with -ExternalLocation bound to the install dir.
       No Developer Mode required. The exe's embedded <msix> element then binds
       identity on every normal launch.

    2. Loose dev registration (fallback): render the shipped AppxManifest.xml
       template in place and `Add-AppxPackage -Register` it. Works unsigned but
       requires Developer Mode, and identity only applies when the app is
       launched through the package (Start menu entry / activation).

    Restart Cloudreve Desktop after registering - package identity is assigned
    at process launch. Explorer may also need a restart to pick up the verb.

.PARAMETER InstallDir
    Directory containing cloudreve-desktop.exe. Auto-detected if omitted.

.PARAMETER Version
    Override the package identity version (dev-registration path only).
    Defaults to the exe's FileVersion, normalized to four parts (X.Y.Z.W).

.PARAMETER Unregister
    Remove the package registration instead of adding it.

.EXAMPLE
    .\register-identity.ps1
    # Register the auto-detected install
#>
param(
    [string]$InstallDir,
    [string]$Version,
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"

$PackageName = "2106abslant.Cloudreve"
$Publisher   = "CN=F536B6E6-7669-4531-8549-562FBE156594"

if ($Unregister) {
    Get-AppxPackage -Name $PackageName | Remove-AppxPackage
    Write-Host "Package '$PackageName' removed." -ForegroundColor Green
    return
}

# --- Locate the installed exe ------------------------------------------------

if (-not $InstallDir) {
    $Candidates = @(
        "$env:LOCALAPPDATA\Cloudreve",
        "$env:LOCALAPPDATA\Programs\Cloudreve",
        "$env:ProgramFiles\Cloudreve",
        "${env:ProgramFiles(x86)}\Cloudreve"
    )
    foreach ($dir in $Candidates) {
        if (Test-Path (Join-Path $dir "cloudreve-desktop.exe")) {
            $InstallDir = $dir
            break
        }
    }
}

if (-not $InstallDir -or -not (Test-Path (Join-Path $InstallDir "cloudreve-desktop.exe"))) {
    Write-Error "cloudreve-desktop.exe not found. Pass -InstallDir <path to the install folder>."
}

$InstallDir = (Resolve-Path $InstallDir).Path
$ExePath = Join-Path $InstallDir "cloudreve-desktop.exe"

Write-Host "Install dir: $InstallDir" -ForegroundColor Cyan

# --- Drop a damaged leftover registration -------------------------------------
# A registration whose Status is not "Ok" (e.g. an update moved the install dir
# its ExternalLocation pointed at) not only breaks package activation - the
# exe's embedded <msix> element can block process creation outright, so the app
# cannot self-heal. Remove it first; a clean re-add below rebinds this dir.

$damaged = Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue |
    Where-Object { $_.Status -ne "Ok" }
if ($damaged) {
    Write-Host "Existing package registration is damaged ($($damaged.Status)) - removing it." -ForegroundColor Yellow
    $damaged | Remove-AppxPackage
}

# --- Path 1: signed sparse package --------------------------------------------

$MsixPath = Join-Path $InstallDir "Cloudreve-Identity.msix"
$CerPath  = Join-Path $InstallDir "cloudreve-identity.cer"

if ((Test-Path $MsixPath) -and (Test-Path $CerPath)) {
    # Package signature validates against MACHINE trust stores, so the signing
    # cert must live in LocalMachine\TrustedPeople - a one-time elevated import.
    $elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
        ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    $trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
        Where-Object { $_.Subject -eq $Publisher } | Select-Object -First 1

    if (-not $trusted) {
        if ($elevated) {
            Write-Host "Trusting the signing certificate..." -ForegroundColor Cyan
            Import-Certificate -FilePath $CerPath -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null
        } else {
            Write-Host "Trusting the signing certificate (one-time, needs admin)..." -ForegroundColor Cyan
            $importArgs = "-NoProfile -Command `"Import-Certificate -FilePath '$CerPath' -CertStoreLocation Cert:\LocalMachine\TrustedPeople | Out-Null`""
            $proc = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList $importArgs -ErrorAction SilentlyContinue
            if ($proc.ExitCode -ne 0) {
                Write-Host "Certificate import was declined - falling back to Developer Mode registration." -ForegroundColor Yellow
            }
        }
        $trusted = Get-ChildItem Cert:\LocalMachine\TrustedPeople -ErrorAction SilentlyContinue |
            Where-Object { $_.Subject -eq $Publisher } | Select-Object -First 1
    }

    if ($trusted) {
        if ($elevated) {
            # Per-user package deployment fails with 0x80070005 when elevated;
            # finish the install as the normal user.
            Write-Host "Certificate trusted. Re-run this script WITHOUT admin to finish package install." -ForegroundColor Yellow
            return
        }
        try {
            # -ForceTargetApplicationShutdown: a running instance otherwise
            # fails the add with 0x80073D02 (packages in use) - the exact
            # failure that left a broken registration after a passive update.
            Add-AppxPackage -Path $MsixPath -ExternalLocation $InstallDir -ForceUpdateFromAnyVersion -ForceTargetApplicationShutdown -ErrorAction Stop
            Write-Host "`nSigned package registered." -ForegroundColor Green
            Write-Host "Restart Cloudreve Desktop, then restart Explorer" -ForegroundColor Cyan
            Write-Host "(taskkill /f /im explorer.exe; start explorer.exe) - the" -ForegroundColor Cyan
            Write-Host "'Cloudreve' submenu should appear in the right-click menu." -ForegroundColor Cyan
            return
        } catch {
            Write-Host "`nSigned install failed: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "Falling back to loose registration." -ForegroundColor Yellow
        }
    }
}

# --- Path 2: loose dev registration --------------------------------------------

$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") { "arm64" } else { "x64" }

if (-not $Version) {
    $Version = [Diagnostics.FileVersionInfo]::GetVersionInfo($ExePath).FileVersion
}
if (-not $Version) { $Version = "0.3.1.0" }
while ($Version.Split('.').Count -lt 4) { $Version += ".0" }

Write-Host "Identity version: $Version" -ForegroundColor Cyan

# Loose registration binds the package to the manifest's own directory, so the
# rendered manifest must live next to cloudreve-desktop.exe.
$ManifestPath = Join-Path $InstallDir "AppxManifest.xml"
if (-not (Test-Path $ManifestPath)) {
    Write-Error "AppxManifest.xml not found in $InstallDir. Reinstall or download it from the repo (desktop/package/AppxManifest.xml)."
}

$Manifest = Get-Content $ManifestPath -Raw
if ($Manifest.Contains("__VERSION__")) {
    $Manifest = $Manifest -replace '__VERSION__', $Version -replace '__ARCH__', $Arch
    $Utf8Bom = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($ManifestPath, $Manifest, $Utf8Bom)
    Write-Host "Manifest rendered at $ManifestPath" -ForegroundColor Cyan
}

$existing = Get-AppxPackage -Name $PackageName
if ($existing -and $existing.Status -eq "Ok") {
    Write-Host "Package already registered for this install." -ForegroundColor Green
} else {
    try {
        Add-AppxPackage -Register $ManifestPath -ErrorAction Stop
        Write-Host "`nPackage registered (Developer Mode)." -ForegroundColor Green
    } catch {
        Write-Host "`nRegistration failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Unsigned loose registration needs Developer Mode:" -ForegroundColor Yellow
        Write-Host "  Settings -> System -> For developers -> Developer Mode = On" -ForegroundColor Yellow
        Write-Host "Then re-run this script." -ForegroundColor Yellow
        # Last resort: a damaged leftover registration can block the exe from
        # even starting (embedded <msix> binding). No identity beats a broken
        # one - the app then launches without the Explorer integration.
        Get-AppxPackage -Name $PackageName -ErrorAction SilentlyContinue |
            Where-Object { $_.Status -ne "Ok" } | Remove-AppxPackage
        exit 1
    }
}

Write-Host "`nRestart Cloudreve Desktop, then restart Explorer" -ForegroundColor Cyan
Write-Host "(taskkill /f /im explorer.exe; start explorer.exe) - the" -ForegroundColor Cyan
Write-Host "'Cloudreve' submenu should appear in the right-click menu." -ForegroundColor Cyan
