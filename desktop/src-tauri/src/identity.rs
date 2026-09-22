//! Sparse package registration for unpackaged Windows installs.
//!
//! The Explorer context menu (windows.cloudFiles / IExplorerCommand), toast
//! activation, custom state and thumbnail handlers all require MSIX package
//! identity, which a plain setup.exe/MSI install does not provide. A sparse
//! package (`AllowExternalContent`) grants identity while the payload stays
//! outside the package container: we register the sparse manifest template
//! shipped next to the exe and bind the install dir as its external location.
//!
//! Unsigned loose registration (`Add-AppxPackage -Register`) is a developer
//! scenario and may require Developer Mode to be enabled; shipping a signed
//! sparse .msix remains the production path.

/// Package identity name, must match AppxManifest(.sparse).xml Identity.
#[cfg(windows)]
const PACKAGE_NAME: &str = "2106abslant.Cloudreve";

/// Register the sparse package when the app runs without package identity.
/// Best-effort: failures are logged, never fatal.
#[cfg(windows)]
pub fn ensure_package_identity() {
    if let Err(e) = try_ensure_package_identity() {
        tracing::warn!(target: "main", "Sparse package registration failed: {e:#}. \
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
    let template = install_dir.join("AppxManifest.sparse.xml");
    if !template.exists() {
        bail!("{} was not shipped with this install", template.display());
    }

    // Render placeholders: __VERSION__ -> X.Y.Z.0, __ARCH__ -> x64/arm64.
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
    let manifest = std::fs::read_to_string(&template)
        .context("failed to read sparse manifest template")?
        .replace("__VERSION__", &version)
        .replace("__ARCH__", arch);

    // Per-machine installs are not writable, so stage the manifest under
    // %LOCALAPPDATA%; the payload is bound via -ExternalLocation.
    let stage_dir = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Cloudreve")
        .join("package");
    std::fs::create_dir_all(&stage_dir).context("failed to create staging dir")?;
    let manifest_path = stage_dir.join("AppxManifest.sparse.xml");
    std::fs::write(&manifest_path, manifest).context("failed to write rendered manifest")?;

    // Re-register only when missing, or when version/location changed.
    // Single quotes inside paths are doubled for PowerShell literal safety.
    let ps_loc = install_dir.display().to_string().replace('\'', "''");
    let ps_manifest = manifest_path.display().to_string().replace('\'', "''");
    let script = format!(
        "$pkg = Get-AppxPackage -Name '{name}'; \
         if ($pkg -and $pkg.Version -eq '{ver}' -and $pkg.InstallLocation -eq '{loc}') {{ exit 0 }}; \
         Add-AppxPackage -Path '{manifest}' -Register -ExternalLocation '{loc}' -ForceUpdateFromAnyVersion",
        name = PACKAGE_NAME,
        ver = version,
        loc = ps_loc,
        manifest = ps_manifest,
    );

    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .context("failed to spawn powershell.exe")?;

    if !output.status.success() {
        bail!(
            "Add-AppxPackage failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    // Identity is assigned at process creation; this instance stays unpackaged.
    tracing::info!(target: "main",
        "Sparse package registered (external location: {}). Restart the app for package identity to take effect.",
        install_dir.display()
    );
    Ok(())
}

#[cfg(not(windows))]
pub fn ensure_package_identity() {}
