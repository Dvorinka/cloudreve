<#
.SYNOPSIS
    Register package identity for an installed (setup.exe/MSI) Cloudreve Desktop.

.DESCRIPTION
    The Explorer context menu (Share link, View online, Sync now, ...) and other
    shell integration require MSIX package identity, which a plain NSIS/MSI
    install does not provide. This script renders the shipped AppxManifest.xml
    template (version + architecture) inside the install directory and
    loose-registers it - the same mechanism dev-install.ps1 uses, which makes
    the install dir itself the package location.

    Unsigned loose registration requires Developer Mode
    (Settings -> System -> For developers -> Developer Mode = On).

    Restart Cloudreve Desktop after registering - package identity is assigned
    at process launch. Explorer may also need a restart to pick up the verb.

.PARAMETER InstallDir
    Directory containing cloudreve-desktop.exe. Auto-detected if omitted.

.PARAMETER Version
    Override the package identity version. Defaults to the exe's FileVersion,
    normalized to four parts (X.Y.Z.W) as appx requires.

.PARAMETER Unregister
    Remove the package registration instead of adding it.

.EXAMPLE
    .\register-identity.ps1
    # Register the auto-detected install

.EXAMPLE
    .\register-identity.ps1 -InstallDir "C:\Tools\Cloudreve" -Unregister
#>
param(
    [string]$InstallDir,
    [string]$Version,
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"

$PackageName = "2106abslant.Cloudreve"

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
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") { "arm64" } else { "x64" }

# Identity version tracks the exe's FileVersion so the package is
# re-registered automatically after every update.
if (-not $Version) {
    $Version = [Diagnostics.FileVersionInfo]::GetVersionInfo($ExePath).FileVersion
}
if (-not $Version) { $Version = "0.3.1.0" }
# Appx requires a four-part X.Y.Z.W version; FileVersion may return fewer.
while ($Version.Split('.').Count -lt 4) { $Version += ".0" }

Write-Host "Install dir: $InstallDir" -ForegroundColor Cyan
Write-Host "Identity version: $Version" -ForegroundColor Cyan

# --- Render the manifest in place --------------------------------------------
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

# --- Register ----------------------------------------------------------------

$existing = Get-AppxPackage -Name $PackageName
if ($existing -and $existing.InstallLocation -eq $InstallDir) {
    Write-Host "Package already registered for this install." -ForegroundColor Green
} else {
    try {
        Add-AppxPackage -Register $ManifestPath -ErrorAction Stop
        Write-Host "`nPackage registered." -ForegroundColor Green
    } catch {
        Write-Host "`nRegistration failed: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Unsigned loose registration needs Developer Mode:" -ForegroundColor Yellow
        Write-Host "  Settings -> System -> For developers -> Developer Mode = On" -ForegroundColor Yellow
        Write-Host "Then re-run this script." -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "`nRestart Cloudreve Desktop, then restart Explorer" -ForegroundColor Cyan
Write-Host "(taskkill /f /im explorer.exe; start explorer.exe) - the" -ForegroundColor Cyan
Write-Host "'Cloudreve' submenu should appear in the right-click menu." -ForegroundColor Cyan
