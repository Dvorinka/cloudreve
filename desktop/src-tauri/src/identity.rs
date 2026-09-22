//! Package identity registration for unpackaged Windows installs.
//!
//! The Explorer context menu (windows.cloudFiles / IExplorerCommand), toast
//! activation, custom state and thumbnail handlers all require MSIX package
//! identity, which a plain setup.exe/MSI install does not provide. We render
//! the shipped AppxManifest.xml template and loose-register it in place, so
//! the package's install location is the app's own install dir - the same
//! mechanism dev-install.ps1 uses. Unsigned loose registration requires
//! Developer Mode; a signed sparse .msix (package/AppxManifest.sparse.xml)
//! remains the production path.
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
            Explorer context menu items require package identity; enable Developer \
            Mode or run register-identity.ps1, then restart the app.");
    }
}

#[cfg(windows)]
fn try_ensure_package_identity() -> anyhow::Result<()> {
    use anyhow::{bail, Context};
    use std::process::Command;
    use windows::ApplicationModel::Package;

    // Already running with identity (MSIX install or dev-install.ps1).
    if Package::Current().is_ok() {
        return Ok(());
    }

    let exe_path = std::env::current_exe().context("current_exe failed")?;
    let install_dir = exe_path
        .parent()
        .context("executable has no parent directory")?;
    let manifest_path = install_dir.join("AppxManifest.xml");
    if !manifest_path.exists() {
        bail!("{} was not shipped with this install", manifest_path.display());
    }

    // Render placeholders only when the shipped template is still unrendered.
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

    // Re-register only when missing or when version/location changed.
    let ps_loc = install_dir.display().to_string().replace('\'', "''");
    let ps_manifest = manifest_path.display().to_string().replace('\'', "''");
    let script = format!(
        "$pkg = Get-AppxPackage -Name '{name}'; \
         if ($pkg -and $pkg.InstallLocation -eq '{loc}') {{ exit 0 }}; \
         Add-AppxPackage -Register '{manifest}'",
        name = PACKAGE_NAME,
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
