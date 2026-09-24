//! Package identity registration for unpackaged Windows installs.
//!
//! The Explorer context menu (windows.cloudFiles / IExplorerCommand), toast
//! activation, custom state and thumbnail handlers all require MSIX package
//! identity, which a plain setup.exe/MSI install does not provide.
//!
//! Two paths, in preference order, both done natively through
//! `PackageManager` (the same API `Add-AppxPackage` wraps) - no PowerShell:
//!
//! 1. Signed sparse package: if the installer shipped Cloudreve-Identity.msix
//!    and its signing cert is already in LocalMachine\TrustedPeople, install
//!    it bound to the install dir via AddPackageOptions.ExternalLocationUri.
//!    No Developer Mode needed, and the exe's embedded <msix> element binds
//!    identity on every normal launch. The cert import is the only step that
//!    needs elevation; `--install-identity` self-elevates a hidden child for
//!    it (one UAC prompt, no console window).
//!
//! 2. Loose dev registration: render the shipped AppxManifest.xml template in
//!    the install dir and `RegisterPackageByUriAsync` it with
//!    DeveloperMode+AllowUnsigned - the mechanism dev-install.ps1 uses.
//!    Requires Developer Mode.
//!
//! Headless CLI (used by the NSIS hook, or manually):
//!   cloudreve-desktop.exe --install-identity        full install
//!   cloudreve-desktop.exe --install-identity-cert   cert import only
//!                                                   (internal, elevated)
//!
//! Identity is bound at process creation, so registration takes effect from
//! the next app launch.

/// File name of the signed sparse package and its public cert, shipped by the
/// installer beside the exe.
#[cfg(windows)]
const SPARSE_MSIX: &str = "Cloudreve-Identity.msix";
#[cfg(windows)]
const IDENTITY_CERT: &str = "cloudreve-identity.cer";

/// Package family name + application id, used to build the AUMID
/// (`PFN!AppId`) for package-activated relaunch. The family name derives from
/// the identity name and publisher hash, stable for this certificate.
#[cfg(windows)]
const PACKAGE_FAMILY: &str = "2106abslant.Cloudreve_sb8s8nw07jjsw";
#[cfg(windows)]
const PACKAGE_APP_ID: &str = "Cloudreve.Sync";

/// Arg carried by the package-activated relaunch so a child that somehow still
/// lacks identity does not relaunch in a loop.
#[cfg(windows)]
const NO_RELAUNCH_ARG: &str = "--no-packaged-relaunch";

/// Handle `--install-identity` / `--install-identity-cert` before the GUI
/// starts. Returns the process exit code when an identity flag was present.
#[cfg(windows)]
pub fn run_identity_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--install-identity-cert") {
        return Some(match import_signing_cert() {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("cert import failed: {e:#}");
                1
            }
        });
    }
    if args.iter().any(|a| a == "--install-identity") {
        return Some(match headless_install() {
            Ok(()) => 0,
            Err(e) => {
                eprintln!("identity install failed: {e:#}");
                1
            }
        });
    }
    None
}

/// If the identity package is installed but this process launched without
/// identity, relaunch through IApplicationActivationManager and exit. The
/// embedded <msix> element binds direct launches, but the binding only
/// propagates some time after package registration - launches right after an
/// install/update can still come up unpackaged, and an unpackaged process
/// registers sync roots with no package association (no Explorer menu). The
/// activation path binds identity immediately, so routing through it is
/// always correct. Runs before GUI setup and before single-instance takes
/// the instance lock; returns the exit code when a relaunch happened.
#[cfg(windows)]
pub fn relaunch_packaged_if_needed() -> Option<i32> {
    use windows::ApplicationModel::Package;

    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == NO_RELAUNCH_ARG) {
        return None;
    }
    // COM out-of-process activation (-Embedding) already comes through the
    // package; relaunching would break the local-server handshake.
    if args.iter().any(|a| a.starts_with("-Embedding")) {
        return None;
    }
    if Package::Current().is_ok() {
        return None;
    }
    match activate_package_self() {
        Ok(()) => Some(0),
        Err(e) => {
            eprintln!("packaged relaunch skipped: {e:#}");
            None
        }
    }
}

/// First registered package of our identity family for this user, if any.
///
/// `FindPackagesByPackageFamilyName` also returns packages whose deployment
/// is broken (Status != Ok) - e.g. after an update moved the install dir the
/// sparse package's ExternalLocation points at, leaving a registration whose
/// activation shows the "repair this app" dialog instead of launching.
#[cfg(windows)]
fn find_family_package() -> Option<windows::ApplicationModel::Package> {
    use windows::core::HSTRING;
    use windows::Management::Deployment::PackageManager;

    let mgr = PackageManager::new().ok()?;
    mgr.FindPackagesByPackageFamilyName(&HSTRING::from(PACKAGE_FAMILY))
        .ok()?
        .into_iter()
        .next()
}

/// A package registration is only usable when its status verifies Ok; a
/// damaged one must be repaired (re-add) or removed before activation.
#[cfg(windows)]
fn package_is_healthy(package: &windows::ApplicationModel::Package) -> bool {
    package
        .Status()
        .map(|status| status.VerifyIsOK().is_ok())
        .unwrap_or(false)
}

/// Remove a broken family registration so the sparse package can be re-added
/// cleanly bound to the current install dir.
#[cfg(windows)]
fn remove_family_package(package: &windows::ApplicationModel::Package) -> anyhow::Result<()> {
    use anyhow::Context;
    use windows::Management::Deployment::PackageManager;

    let full_name = package
        .Id()
        .and_then(|id| id.FullName())
        .context("package has no full name")?;
    let mgr = PackageManager::new().context("PackageManager::new failed")?;
    let result = mgr
        .RemovePackageAsync(&full_name)
        .and_then(|op| op.get())
        .context("RemovePackageAsync failed")?;
    result.ExtendedErrorCode()?.ok()?;
    Ok(())
}

/// Repair a damaged identity registration: drop it and re-add the shipped
/// sparse package (cert trust included when it can elevate). Returns true
/// when the family package is healthy afterwards.
#[cfg(windows)]
fn repair_family_package() -> bool {
    if let Err(e) = headless_install() {
        tracing::warn!(target: "main", "identity repair failed: {e:#}");
    }
    find_family_package()
        .map(|p| package_is_healthy(&p))
        .unwrap_or(false)
}

/// Activate `PFN!AppId` when the identity package is registered for this user.
#[cfg(windows)]
fn activate_package_self() -> anyhow::Result<()> {
    use anyhow::{bail, Context};
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    use windows::Win32::UI::Shell::{
        ApplicationActivationManager, IApplicationActivationManager, AO_NOSPLASHSCREEN,
    };

    let package = find_family_package();
    match package {
        None => bail!("identity package not installed"),
        Some(ref p) if !package_is_healthy(p) => {
            if !repair_family_package() {
                bail!("identity package damaged and repair failed");
            }
        }
        _ => {}
    }

    let aumid = HSTRING::from(format!("{PACKAGE_FAMILY}!{PACKAGE_APP_ID}"));
    unsafe {
        let activator: IApplicationActivationManager =
            CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_ALL)
                .context("ApplicationActivationManager failed")?;
        activator
            .ActivateApplication(&aumid, &HSTRING::from(NO_RELAUNCH_ARG), AO_NOSPLASHSCREEN)
            .context("ActivateApplication failed")?;
    }
    Ok(())
}

/// Register the package when the app runs without package identity.
/// Best-effort, silent: never elevates, never fails startup. Install-time
/// registration (with UAC for the cert) is done by `--install-identity`.
#[cfg(windows)]
pub fn ensure_package_identity() {
    if let Err(e) = try_ensure_package_identity() {
        tracing::warn!(target: "main", "Package registration failed: {e:#}. \
            Explorer context menu items require package identity; re-run the \
            installer, or run cloudreve-desktop.exe --install-identity");
    }
}

#[cfg(windows)]
fn try_ensure_package_identity() -> anyhow::Result<()> {
    use anyhow::{bail, Context};
    use windows::ApplicationModel::Package;

    // Already running with identity (MSIX install, sparse package, or
    // dev-install.ps1).
    if Package::Current().is_ok() {
        return Ok(());
    }

    let install_dir = std::env::current_exe()
        .context("current_exe failed")?
        .parent()
        .context("executable has no parent directory")?
        .to_path_buf();
    let msix_path = install_dir.join(SPARSE_MSIX);
    let manifest_path = install_dir.join("AppxManifest.xml");

    // When a signed package shipped it owns registration: a failed add means
    // the cert is not trusted yet (the installer handles elevation) or a real
    // deployment error - retrying a loose register would just be noise.
    if msix_path.exists() {
        // Same damaged-registration repair as headless_install, minus the
        // elevation attempt (startup never elevates).
        if let Some(pkg) = find_family_package() {
            if !package_is_healthy(&pkg) {
                tracing::warn!(target: "main",
                    "identity package damaged; removing before re-registering");
                remove_family_package(&pkg).context("failed to remove damaged identity package")?;
            }
        }
        add_sparse_package(&msix_path, &install_dir)?;
        tracing::info!(target: "main",
            "Signed identity package installed; restart for package identity.");
        return Ok(());
    }

    if !manifest_path.exists() {
        bail!("neither {SPARSE_MSIX} nor AppxManifest.xml shipped with this install");
    }
    render_manifest(&manifest_path)?;
    register_loose_manifest(&manifest_path)
}

/// Full headless install for `--install-identity` / the NSIS hook: trust the
/// signing cert (elevating once if needed), then install the sparse package.
#[cfg(windows)]
fn headless_install() -> anyhow::Result<()> {
    use anyhow::Context;
    let install_dir = std::env::current_exe()
        .context("current_exe failed")?
        .parent()
        .context("executable has no parent directory")?
        .to_path_buf();
    let msix_path = install_dir.join(SPARSE_MSIX);

    if msix_path.exists() {
        // Signature validation fails before deployment even starts, and the
        // reported error code is unreliable (0x800B0109 may surface as
        // 0x87E80034), so check the store up front instead of matching codes.
        let cer = install_dir.join(IDENTITY_CERT);
        if cer.exists() && !cert_is_trusted(&cer)? {
            ensure_cert_trusted(&install_dir)?;
        }
        // A leftover registration can be damaged (its ExternalLocation points
        // at a deleted/moved install dir after an update). Re-adding over a
        // broken package is unreliable - remove it first so the fresh add
        // binds the current directory.
        if let Some(pkg) = find_family_package() {
            if !package_is_healthy(&pkg) {
                tracing::warn!(target: "main",
                    "identity package damaged; removing before re-registering");
                remove_family_package(&pkg).context("failed to remove damaged identity package")?;
            }
        }
        return add_sparse_package(&msix_path, &install_dir)
            .context("sparse package install failed");
    }

    // No signed package shipped - loose registration (Developer Mode).
    let manifest_path = install_dir.join("AppxManifest.xml");
    render_manifest(&manifest_path)?;
    register_loose_manifest(&manifest_path)
}

/// True when the shipping .cer is already in LocalMachine\TrustedPeople -
/// the machine store package signature validation checks.
#[cfg(windows)]
fn cert_is_trusted(cer_path: &std::path::Path) -> anyhow::Result<bool> {
    use anyhow::Context;
    use windows::core::HSTRING;
    use windows::Win32::Security::Cryptography::*;

    let path_w = HSTRING::from(cer_path.to_string_lossy().as_ref());
    unsafe {
        let mut ctx: *mut CERT_CONTEXT = std::ptr::null_mut();
        CryptQueryObject(
            CERT_QUERY_OBJECT_FILE,
            path_w.as_ptr() as *const core::ffi::c_void,
            CERT_QUERY_CONTENT_FLAG_CERT,
            CERT_QUERY_FORMAT_FLAG_ALL,
            0,
            None,
            None,
            None,
            None,
            None,
            Some(&mut ctx as *mut *mut CERT_CONTEXT as *mut *mut core::ffi::c_void),
        )
        .context("failed to read certificate file")?;
        let name = HSTRING::from("TrustedPeople");
        let store = CertOpenStore(
            CERT_STORE_PROV_SYSTEM_W,
            CERT_QUERY_ENCODING_TYPE(X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0),
            None,
            CERT_OPEN_STORE_FLAGS(
                CERT_SYSTEM_STORE_LOCAL_MACHINE
                    | CERT_STORE_OPEN_EXISTING_FLAG.0
                    | CERT_STORE_READONLY_FLAG.0,
            ),
            Some(name.as_ptr() as *const core::ffi::c_void),
        )
        .context("failed to open LocalMachine\\TrustedPeople")?;
        let found = CertFindCertificateInStore(
            store,
            CERT_QUERY_ENCODING_TYPE(X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0),
            0,
            CERT_FIND_EXISTING,
            Some(ctx as *const core::ffi::c_void),
            None,
        );
        let trusted = !found.is_null();
        if !found.is_null() {
            let _ = CertFreeCertificateContext(Some(found));
        }
        let _ = CertFreeCertificateContext(Some(ctx));
        let _ = CertCloseStore(store, 0);
        Ok(trusted)
    }
}

/// Install the sparse msix bound to `external_dir` as its external content.
#[cfg(windows)]
fn add_sparse_package(
    msix_path: &std::path::Path,
    external_dir: &std::path::Path,
) -> anyhow::Result<()> {
    use anyhow::Context;
    use windows::Foundation::Uri;
    use windows::Management::Deployment::{AddPackageOptions, PackageManager};

    let mgr = PackageManager::new().context("PackageManager::new failed")?;
    let package_uri = Uri::CreateUri(&windows::core::HSTRING::from(file_uri(msix_path)))
        .context("invalid package URI")?;
    let options = AddPackageOptions::new()?;
    options
        .SetExternalLocationUri(&Uri::CreateUri(&windows::core::HSTRING::from(file_uri(
            external_dir,
        )))?)
        .context("SetExternalLocationUri failed")?;
    let result = mgr
        .AddPackageByUriAsync(&package_uri, &options)
        .and_then(|op| op.get())
        .context("AddPackageByUriAsync failed")?;
    // The async op completes even when deployment fails - the failure lives
    // in the result's extended error code (e.g. CERT_E_UNTRUSTEDROOT).
    result.ExtendedErrorCode()?.ok()?;
    Ok(())
}

/// Loose dev-mode registration of the rendered full manifest.
#[cfg(windows)]
fn register_loose_manifest(manifest_path: &std::path::Path) -> anyhow::Result<()> {
    use anyhow::{bail, Context};
    use windows::Foundation::Uri;
    use windows::Management::Deployment::{PackageManager, RegisterPackageOptions};

    let mgr = PackageManager::new().context("PackageManager::new failed")?;
    let options = RegisterPackageOptions::new()?;
    options.SetDeveloperMode(true)?;
    options.SetAllowUnsigned(true)?;
    let manifest_uri = Uri::CreateUri(&windows::core::HSTRING::from(file_uri(manifest_path)))?;
    let result = match mgr
        .RegisterPackageByUriAsync(&manifest_uri, &options)
        .and_then(|op| op.get())
    {
        Ok(r) => r,
        Err(e) => {
            bail!(
                "registration failed: {e}. Unsigned loose registration needs \
                 Developer Mode (Settings -> System -> For developers)."
            );
        }
    };
    if let Err(e) = result.ExtendedErrorCode()?.ok() {
        bail!(
            "registration failed: {e}. Unsigned loose registration needs \
             Developer Mode (Settings -> System -> For developers)."
        );
    }
    Ok(())
}

/// Make sure LocalMachine\TrustedPeople contains the signing cert, elevating a
/// hidden `--install-identity-cert` child (one UAC prompt) when needed.
#[cfg(windows)]
fn ensure_cert_trusted(install_dir: &std::path::Path) -> anyhow::Result<()> {
    use anyhow::bail;
    let cer = install_dir.join(IDENTITY_CERT);
    if !cer.exists() {
        bail!("{IDENTITY_CERT} not shipped with this install");
    }
    if is_elevated() {
        return import_cert(&cer);
    }
    let code = elevate_cert_child()?;
    if code != 0 {
        bail!("certificate trust was declined or failed (exit {code})");
    }
    Ok(())
}

/// Cert-only role for the elevated child process.
#[cfg(windows)]
fn import_signing_cert() -> anyhow::Result<()> {
    use anyhow::{bail, Context};
    let install_dir = std::env::current_exe()
        .context("current_exe failed")?
        .parent()
        .context("executable has no parent directory")?
        .to_path_buf();
    let cer = install_dir.join(IDENTITY_CERT);
    if !cer.exists() {
        bail!("{IDENTITY_CERT} not found in {}", install_dir.display());
    }
    import_cert(&cer)
}

/// Re-launch this exe elevated for the cert import, wait for it, and return
/// its exit code. The runas verb produces a single UAC prompt and no console.
#[cfg(windows)]
fn elevate_cert_child() -> anyhow::Result<u32> {
    use anyhow::Context;
    use windows::core::HSTRING;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let exe = std::env::current_exe()?;
    let exe_w = HSTRING::from(exe.to_string_lossy().as_ref());
    let verb = HSTRING::from("runas");
    let args = HSTRING::from("--install-identity-cert");
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: windows::core::PCWSTR(verb.as_ptr()),
        lpFile: windows::core::PCWSTR(exe_w.as_ptr()),
        lpParameters: windows::core::PCWSTR(args.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut info).context("elevation declined or failed")?;
        let _ = WaitForSingleObject(info.hProcess, 120_000);
        let mut code = 0u32;
        GetExitCodeProcess(info.hProcess, &mut code).ok();
        let _ = CloseHandle(info.hProcess);
        Ok(code)
    }
}

/// Import the shipping .cer into LocalMachine\TrustedPeople. Caller must be
/// elevated; the machine store is what package signature validation checks.
#[cfg(windows)]
fn import_cert(cer_path: &std::path::Path) -> anyhow::Result<()> {
    use anyhow::Context;
    use windows::core::HSTRING;
    use windows::Win32::Security::Cryptography::*;

    let path_w = HSTRING::from(cer_path.to_string_lossy().as_ref());
    unsafe {
        let mut ctx: *mut CERT_CONTEXT = std::ptr::null_mut();
        CryptQueryObject(
            CERT_QUERY_OBJECT_FILE,
            path_w.as_ptr() as *const core::ffi::c_void,
            CERT_QUERY_CONTENT_FLAG_CERT,
            CERT_QUERY_FORMAT_FLAG_ALL,
            0,
            None,
            None,
            None,
            None,
            None,
            Some(&mut ctx as *mut *mut CERT_CONTEXT as *mut *mut core::ffi::c_void),
        )
        .context("failed to read certificate file")?;
        let name = HSTRING::from("TrustedPeople");
        let store = CertOpenStore(
            CERT_STORE_PROV_SYSTEM_W,
            CERT_QUERY_ENCODING_TYPE(X509_ASN_ENCODING.0 | PKCS_7_ASN_ENCODING.0),
            None,
            CERT_OPEN_STORE_FLAGS(
                CERT_SYSTEM_STORE_LOCAL_MACHINE | CERT_STORE_OPEN_EXISTING_FLAG.0,
            ),
            Some(name.as_ptr() as *const core::ffi::c_void),
        )
        .context("failed to open LocalMachine\\TrustedPeople")?;
        CertAddCertificateContextToStore(store, ctx, CERT_STORE_ADD_REPLACE_EXISTING, None)
            .context("failed to add certificate")?;
        let _ = CertFreeCertificateContext(Some(ctx));
        let _ = CertCloseStore(store, 0);
    }
    Ok(())
}

#[cfg(windows)]
fn is_elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elev = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elev as *mut _ as *mut core::ffi::c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        );
        let _ = CloseHandle(token);
        ok.is_ok() && elev.TokenIsElevated != 0
    }
}

/// Render __VERSION__/__ARCH__ placeholders in the shipped loose manifest
/// when still unrendered.
#[cfg(windows)]
fn render_manifest(manifest_path: &std::path::Path) -> anyhow::Result<()> {
    use anyhow::Context;
    let manifest =
        std::fs::read_to_string(manifest_path).context("failed to read AppxManifest.xml")?;
    if !manifest.contains("__VERSION__") {
        return Ok(());
    }
    let v = env!("CARGO_PKG_VERSION");
    let version = if v.split('.').count() == 3 {
        format!("{v}.0")
    } else {
        v.to_string()
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    let rendered = manifest
        .replace("__VERSION__", &version)
        .replace("__ARCH__", arch);
    std::fs::write(manifest_path, rendered).context("failed to write rendered AppxManifest.xml")
}

/// Convert a filesystem path to a `file:///`-style URI for the deployment API.
#[cfg(windows)]
fn file_uri(path: &std::path::Path) -> String {
    let mut s = String::from("file:///");
    for ch in path.to_string_lossy().chars() {
        match ch {
            '\\' => s.push('/'),
            'a'..='z' | 'A'..='Z' | '0'..='9' | '/' | ':' | '-' | '_' | '.' | '~' => s.push(ch),
            _ => s.push_str(&format!("%{:02X}", ch as u32)),
        }
    }
    s
}

#[cfg(not(windows))]
pub fn ensure_package_identity() {}
