<#
.SYNOPSIS
    Register a sparse package identity for an installed (setup.exe/MSI) Cloudreve Desktop.

.DESCRIPTION
    The Explorer context menu (Share link, View online, Sync now, ...) and other
    shell integration require MSIX package identity, which a plain NSIS/MSI
    install does not provide. This script renders the sparse manifest, stages it
    under %LOCALAPPDATA%\Cloudreve\package and registers it with the install
    directory as the package's external location.

    Unsigned loose registration is a developer scenario: if Add-AppxPackage
    fails with a policy error, enable Developer Mode (Settings -> System ->
    For developers) or sign a proper sparse .msix.

    Restart Cloudreve Desktop after registering - package identity is assigned
    at process launch.

.PARAMETER InstallDir
    Directory containing cloudreve-desktop.exe. Auto-detected if omitted.

.PARAMETER ImagesDir
    Optional directory containing the package Images folder (repo:
    desktop/package/Images). When given, the icons are copied into the install
    dir so context menu items get icons. Menu items work without them, just
    iconless.

.PARAMETER Unregister
    Remove the sparse package registration instead of adding it.

.EXAMPLE
    .\register-identity.ps1
    # Register the auto-detected install

.EXAMPLE
    .\register-identity.ps1 -InstallDir "C:\Tools\Cloudreve" -ImagesDir ".\package\Images"
#>
param(
    [string]$InstallDir,
    [string]$ImagesDir,
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"

$PackageName = "2106abslant.Cloudreve"

if ($Unregister) {
    Get-AppxPackage -Name $PackageName | Remove-AppxPackage
    Write-Host "Sparse package '$PackageName' removed." -ForegroundColor Green
    return
}

# --- Locate the installed exe ------------------------------------------------

if (-not $InstallDir) {
    $Candidates = @(
        "$env:LOCALAPPDATA\Programs\Cloudreve",
        "$env:LOCALAPPDATA\Cloudreve",
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
$Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
$Version = "0.3.0.0"  # identity version; independent of the app version

Write-Host "Install dir: $InstallDir" -ForegroundColor Cyan

# --- Optional: copy menu icons ----------------------------------------------

if ($ImagesDir -and (Test-Path $ImagesDir)) {
    Copy-Item $ImagesDir -Destination (Join-Path $InstallDir "Images") -Recurse -Force
    Write-Host "Images copied into install dir." -ForegroundColor Green
} else {
    Write-Host "No -ImagesDir given (or not found); menu items will have no icons." -ForegroundColor Yellow
}

# --- Render and stage the sparse manifest ------------------------------------

$StageDir = Join-Path $env:LOCALAPPDATA "Cloudreve\package"
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
$ManifestPath = Join-Path $StageDir "AppxManifest.sparse.xml"

$Manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:mp="http://schemas.microsoft.com/appx/2014/phone/manifest"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:desktop="http://schemas.microsoft.com/appx/manifest/desktop/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  xmlns:desktop3="http://schemas.microsoft.com/appx/manifest/desktop/windows10/3"
  xmlns:desktop4="http://schemas.microsoft.com/appx/manifest/desktop/windows10/4"
  xmlns:com="http://schemas.microsoft.com/appx/manifest/com/windows10"
  xmlns:cloudfiles2="http://schemas.microsoft.com/appx/manifest/cloudfiles/windows10/2"
  xmlns:uap7="http://schemas.microsoft.com/appx/manifest/uap/windows10/7"
  xmlns:uap8="http://schemas.microsoft.com/appx/manifest/uap/windows10/8"
  IgnorableNamespaces="uap mp rescap desktop desktop3 desktop4 cloudfiles2 uap7 uap8 uap10">

  <Identity
    Name="$PackageName"
    Publisher="CN=F536B6E6-7669-4531-8549-562FBE156594"
    ProcessorArchitecture="$Arch"
    Version="$Version" />

  <Properties>
    <DisplayName>Cloudreve</DisplayName>
    <PublisherDisplayName>abslant</PublisherDisplayName>
    <Logo>Images\StoreLogo.png</Logo>
    <uap10:AllowExternalContent>true</uap10:AllowExternalContent>
  </Properties>

  <Resources>
    <Resource Language="en-us" />
  </Resources>

  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.18362.0"
      MaxVersionTested="10.0.22598.0" />
  </Dependencies>

  <Applications>
    <Application Id="Cloudreve.Sync"
      Executable="cloudreve-desktop.exe"
      EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Cloudreve"
        Description="Cloudreve"
        BackgroundColor="transparent"
        Square150x150Logo="Images\Square150x150Logo.png"
        Square44x44Logo="Images\Square44x44Logo.png">
      </uap:VisualElements>
      <uap7:Properties>
        <uap8:ActiveCodePage>UTF-8</uap8:ActiveCodePage>
      </uap7:Properties>
      <Extensions>
        <desktop:Extension Category="windows.startupTask" Executable="cloudreve-desktop.exe" EntryPoint="Windows.FullTrustApplication">
          <desktop:StartupTask TaskId="cloudreve" Enabled="true" DisplayName="Cloudreve"/>
        </desktop:Extension>
        <uap:Extension Category="windows.protocol">
          <uap:Protocol Name="cloudreve" />
        </uap:Extension>
        <desktop:Extension Category="windows.toastNotificationActivation">
          <desktop:ToastNotificationActivation
            ToastActivatorCLSID="effe04d9-151d-49da-9eb5-34e01442edfe" />
        </desktop:Extension>
        <desktop3:Extension Category="windows.cloudFiles">
          <desktop3:CloudFiles>
            <desktop3:CustomStateHandler Clsid="f0c9de6c-6c76-44d7-a58e-579cdf7af263" />
            <desktop3:ThumbnailProviderHandler Clsid="3d781652-78c5-4038-87a4-ec5940ab560a" />
            <desktop3:ExtendedPropertyHandler Clsid="20000000-0000-0000-0000-000000000001" />
            <desktop3:BannersHandler Clsid="20000000-0000-0000-0000-000000000001" />
            <cloudfiles2:StorageProviderStatusUISourceFactory
              Clsid="b1d8ef74-822d-401a-a14a-25f45b1f70b7" />
            <desktop3:CloudFilesContextMenus>
              <desktop3:Verb Id="Command1" Clsid="165cd069-d9c8-42b4-8e37-b6971afa4494" />
            </desktop3:CloudFilesContextMenus>
            <desktop4:ContentUriSource Clsid="97961bcb-601c-4950-927c-43b9319c7217" />
          </desktop3:CloudFiles>
        </desktop3:Extension>
        <com:Extension Category="windows.comServer">
          <com:ComServer>
            <com:ExeServer Executable="cloudreve-desktop.exe"
              DisplayName="Cloudreve Toast activator">
              <com:Class Id="effe04d9-151d-49da-9eb5-34e01442edfe"
                DisplayName="Cloudreve Toast activator" />
            </com:ExeServer>
            <com:ExeServer DisplayName="Cloudreve Command Handler"
              Executable="cloudreve-desktop.exe">
              <com:Class Id="165cd069-d9c8-42b4-8e37-b6971afa4494" />
            </com:ExeServer>
            <com:ExeServer DisplayName="Cloudreve Custom State Handler"
              Executable="cloudreve-desktop.exe">
              <com:Class Id="f0c9de6c-6c76-44d7-a58e-579cdf7af263" />
            </com:ExeServer>
            <com:ExeServer DisplayName="Cloudreve Status UI Source Factory"
              Executable="cloudreve-desktop.exe">
              <com:Class Id="b1d8ef74-822d-401a-a14a-25f45b1f70b7" />
            </com:ExeServer>
            <com:ExeServer DisplayName="Cloudreve Thumbnail Handler"
              Executable="cloudreve-desktop.exe">
              <com:Class Id="3d781652-78c5-4038-87a4-ec5940ab560a" />
            </com:ExeServer>
          </com:ComServer>
        </com:Extension>
      </Extensions>
    </Application>
  </Applications>

  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="broadFileSystemAccess" />
  </Capabilities>
</Package>
"@

$Utf8Bom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($ManifestPath, $Manifest, $Utf8Bom)
Write-Host "Manifest staged at $ManifestPath" -ForegroundColor Cyan

# --- Register ----------------------------------------------------------------

try {
    Add-AppxPackage -Path $ManifestPath -Register -ExternalLocation $InstallDir -ForceUpdateFromAnyVersion
    Write-Host "`nSparse package registered." -ForegroundColor Green
    Write-Host "Restart Cloudreve Desktop, then right-click a synced file -" -ForegroundColor Cyan
    Write-Host "the 'Cloudreve' submenu should appear in the Windows 11 menu." -ForegroundColor Cyan
} catch {
    Write-Host "`nRegistration failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Unsigned loose registration needs Developer Mode:" -ForegroundColor Yellow
    Write-Host "  Settings -> System -> For developers -> Developer Mode = On" -ForegroundColor Yellow
    Write-Host "Then re-run this script." -ForegroundColor Yellow
    exit 1
}
