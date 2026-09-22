//! Package identity registration for unpackaged Windows installs.
//!
//! The Explorer context menu (windows.cloudFiles / IExplorerCommand), toast
//! activation, custom state and thumbnail handlers all require MSIX package
//! identity, which a plain setup.exe/MSI install does not provide.
//!
//! Two paths, in preference order:
//!
//! 1. Signed sparse package: if the installer shipped Cloudreve-Identity.msix
//!    and its signing cert is already in LocalMachine\TrustedPeople (the NSIS
//!    hook handles the one-time elevated import), install it bound to the
//!    install dir via -ExternalLocation. No Developer Mode needed, and the
//!    exe's embedded <msix> element binds identity on every normal launch.
//!
//! 2. Loose dev registration: render the shipped AppxManifest.xml template in
//!    the install dir and `Add-AppxPackage -Register` it - the mechanism
//!    dev-install.ps1 uses. Unsigned, so it needs Developer Mode, and identity
//!    only applies to launches through the package (Start menu / activation).
//!
//! Identity is bound at process creation, so registration takes effect from
//! the next app launch.

/// Package identity name, must match AppxManifest.xml Identity.
#[cfg(windows)]
const PACKAGE_NAME: &str = "2106abslant.Cloudreve";

/// Register the package when the app runs without package identity.
/// Best-effort: failures are logged, never fatal.
#[cfg(windows)]
pub fn ensure_package_identity() {
    if let Err(e) = try_ensure_package_identity() {
        tracing::warn!(target: "main", "Package registration failed: {e:#}. \
            Explorer context menu items require package identity; run \
            register-identity.ps1 from the install folder to see the full error.");
    }
}

#[cfg(windows)]
fn try_ensure_package_identity() -> anyhow::Result<()> {
    use anyhow::{bail, Context};
    use std::process::Command;
    use windows::ApplicationModel::Package;

    // Already running with identity (MSIX install, sparse package, or
    // dev-install.ps1).
    if Package::Current().is_ok() {
        return Ok(());
    }

    let exe_path = std::env::current_exe().context("current_exe failed")?;
    let install_dir = exe_path
        .parent()
        .context("executable has no parent directory")?;
    let msix_path = install_dir.join("Cloudreve-Identity.msix");
    let manifest_path = install_dir.join("AppxManifest.xml");

    if !msix_path.exists() && !manifest_path.exists() {
        bail!("neither Cloudreve-Identity.msix nor AppxManifest.xml shipped with this install");
    }

    // Render the loose manifest's placeholders only when the shipped template
    // is still unrendered; the loose path is used below only if the signed
    // sparse package is unavailable or its cert is not trusted yet.
    if manifest_path.exists() {
        let manifest = std::fs::read_to_string(&manifest_path)
            .context("failed to read AppxManifest.xml")?;
        if manifest.contains("__VERSION__") {
            let version = {
                let v = env!("CARGO_PKG_VERSION");
                if v.split('.').count() == 3 {
                    format!("{v}.0")
                } else {
                    v.to_string()
                }
            };
            let arch = if cfg!(target_arch = "aarch64") {
                "arm64"
            } else {
                "x64"
            };
            let rendered = manifest
                .replace("__VERSION__", &version)
                .replace("__ARCH__", arch);
            std::fs::write(&manifest_path, rendered)
                .context("failed to write rendered AppxManifest.xml")?;
        }
    }

    let ps_loc = install_dir.display().to_string().replace('\'', "''");
    let ps_msix = msix_path.display().to_string().replace('\'', "''");
    let ps_manifest = manifest_path.display().to_string().replace('\'', "''");

    // Skip when already registered; prefer the signed sparse package when its
    // cert is machine-trusted (the app cannot elevate silently), else loose
    // dev registration.
    let script = format!(
        "$pkg = Get-AppxPackage -Name '{name}'; \
         if ($pkg -and $pkg.Status -eq 'Ok') {{ exit 0 }}; \
         $trusted = Get-ChildItem Cert:\\LocalMachine\\TrustedPeople -ErrorAction SilentlyContinue | Where-Object {{ $_.Subject -eq 'CN=F536B6E6-7669-4531-8549-562FBE156594' }}; \
         if ((Test-Path '{msix}') -and $trusted) {{ \
             Add-AppxPackage -Path '{msix}' -ExternalLocation '{loc}' -ForceUpdateFromAnyVersion -ErrorAction Stop; exit 0 }}; \
         if (Test-Path '{manifest}') {{ Add-AppxPackage -Register '{manifest}' -ErrorAction Stop }}",
        name = PACKAGE_NAME,
        msix = ps_msix,
        loc = ps_loc,
        manifest = ps_manifest,
    );

    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .context("failed to spawn powershell.exe")?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        bail!(
            "Add-AppxPackage failed: {detail}. If the error mentions signing or \
             developer mode, enable Developer Mode (Settings -> System -> For \
             developers) and restart the app, or run register-identity.ps1 from \
             the install folder to see the full error."
        );
    }

    // Identity is assigned at process creation; this instance stays unpackaged.
    tracing::info!(target: "main",
        "Package registered (location: {}). Restart the app for package identity to take effect.",
        install_dir.display()
    );
    Ok(())
}

#[cfg(not(windows))]
pub fn ensure_package_identity() {}
