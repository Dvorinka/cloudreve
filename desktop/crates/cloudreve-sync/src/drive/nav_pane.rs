//! Repairs the File Explorer navigation-pane entry for a registered sync root.
//!
//! Explorer builds its navigation pane once per session and watches the
//! `Desktop\NameSpace` registry key for live additions. Two situations leave
//! the entry invisible even though `StorageProviderSyncRootManager` state is
//! fully correct:
//!
//! * The root was unregistered and re-registered while Explorer was running
//!   (package reinstall, identity migration). The re-created `NameSpace`
//!   subkey collides with the shell's cached tombstone.
//! * The package was serviced while the app was not running; the registration
//!   comes back but the running Explorer never re-processes it.
//!
//! There is no API to detect a tombstoned entry, so the heal is unconditional:
//! verify every registration value (rewriting what is missing), then delete +
//! recreate the `NameSpace` subkey — the same mechanism Explorer uses to add
//! and remove entries live. Leftover `NameSpace`/`CLSID` entries from older
//! sync root ids are swept at the same time.

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::thread::sleep;
use std::time::Duration;

use anyhow::{Context, Result};
use widestring::{U16CStr, U16CString};
use windows::Win32::Foundation::{ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_WRITE, REG_DWORD,
    REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ, RegCloseKey, RegCreateKeyExW,
    RegDeleteTreeW, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, RegSetValueExW,
};
use windows::Win32::UI::Shell::{SHCNE_ASSOCCHANGED, SHCNF_FLUSH, SHCNF_IDLIST, SHChangeNotify};
use windows::core::{PCWSTR, PWSTR};

const NAMESPACE_ROOT: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace";
const CLSID_ROOT: &str = r"Software\Classes\CLSID";
const SYNC_ROOT_MANAGER: &str =
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\SyncRootManager";
const HIDE_DESKTOP_ICONS: &str =
    r"Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\NewStartPanel";
const INSTANCE_CLSID: &str = "{0E5AAE11-A475-4c5b-AB00-C66DE400274E}";
const SORT_ORDER_INDEX: u32 = 0x42;
const SHELL_FOLDER_FLAGS: u32 = 0x228;
const SHELL_FOLDER_ATTRIBUTES: u32 = 0xF080004D;
const PROPERTY_BAG_ATTRIBUTES: u32 = 0x11;
const RECREATE_SETTLE_MS: u64 = 250;

fn wide(s: impl AsRef<OsStr>) -> U16CString {
    U16CString::from_os_str(s.as_ref()).expect("string contains nul")
}

fn wide_to_bytes(s: &U16CStr) -> Vec<u8> {
    s.as_slice_with_nul()
        .iter()
        .flat_map(|c| c.to_le_bytes())
        .collect()
}

struct RegKey(HKEY);

impl RegKey {
    fn create(subkey: &U16CStr) -> Result<Self> {
        let mut key = HKEY::default();
        unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                0,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_READ | KEY_WRITE,
                None,
                &mut key,
                None,
            )
            .ok()?;
        }
        Ok(Self(key))
    }

    fn open(subkey: &U16CStr) -> Option<Self> {
        let mut key = HKEY::default();
        unsafe {
            if RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(subkey.as_ptr()),
                0,
                KEY_READ,
                &mut key,
            ) != ERROR_SUCCESS
            {
                return None;
            }
        }
        Some(Self(key))
    }
}

impl Drop for RegKey {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}

fn read_sz(root: HKEY, subkey: &str, value: Option<&str>) -> Option<String> {
    unsafe {
        let sub = wide(subkey);
        let val = value.map(wide);
        let val_ptr = val.as_ref().map_or(PCWSTR::null(), |v| PCWSTR(v.as_ptr()));
        let mut size = 0u32;
        if RegGetValueW(
            root,
            PCWSTR(sub.as_ptr()),
            val_ptr,
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut size),
        ) != ERROR_SUCCESS
            || size == 0
        {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        if RegGetValueW(
            root,
            PCWSTR(sub.as_ptr()),
            val_ptr,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut size),
        ) != ERROR_SUCCESS
        {
            return None;
        }
        let u16s: Vec<u16> = buf
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        Some(
            String::from_utf16_lossy(&u16s)
                .trim_end_matches('\0')
                .to_string(),
        )
    }
}

fn read_dword(root: HKEY, subkey: &str, value: Option<&str>) -> Option<u32> {
    unsafe {
        let sub = wide(subkey);
        let val = value.map(wide);
        let val_ptr = val.as_ref().map_or(PCWSTR::null(), |v| PCWSTR(v.as_ptr()));
        let mut data = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        if RegGetValueW(
            root,
            PCWSTR(sub.as_ptr()),
            val_ptr,
            RRF_RT_REG_DWORD,
            None,
            Some(&mut data as *mut u32 as *mut _),
            Some(&mut size),
        ) != ERROR_SUCCESS
        {
            return None;
        }
        Some(data)
    }
}

fn ensure_sz(subkey: &str, name: Option<&str>, data: &str) -> Result<bool> {
    if read_sz(HKEY_CURRENT_USER, subkey, name).as_deref() == Some(data) {
        return Ok(false);
    }
    let key = RegKey::create(&wide(subkey))?;
    let name_w = name.map(wide);
    let name_ptr = name_w
        .as_ref()
        .map_or(PCWSTR::null(), |n| PCWSTR(n.as_ptr()));
    let w = wide(data);
    unsafe {
        RegSetValueExW(key.0, name_ptr, 0, REG_SZ, Some(&wide_to_bytes(&w))).ok()?;
    }
    Ok(true)
}

fn ensure_dword(subkey: &str, name: Option<&str>, data: u32) -> Result<bool> {
    if read_dword(HKEY_CURRENT_USER, subkey, name) == Some(data) {
        return Ok(false);
    }
    let key = RegKey::create(&wide(subkey))?;
    let name_w = name.map(wide);
    let name_ptr = name_w
        .as_ref()
        .map_or(PCWSTR::null(), |n| PCWSTR(n.as_ptr()));
    unsafe {
        RegSetValueExW(key.0, name_ptr, 0, REG_DWORD, Some(&data.to_le_bytes())).ok()?;
    }
    Ok(true)
}

/// Deleting the `NameSpace` subkey makes Explorer drop its cached entry;
/// recreating it right after makes it add the entry back, within the same
/// Explorer session. This is the only reliable way to clear a tombstoned pin
/// without restarting `explorer.exe`.
fn recreate_namespace_entry(clsid: &str, sync_root_id: &str) -> Result<()> {
    let subkey = format!(r"{}\{}", NAMESPACE_ROOT, clsid);
    let sub_w = wide(&subkey);
    unsafe {
        let _ = RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(sub_w.as_ptr()));
    }
    sleep(Duration::from_millis(RECREATE_SETTLE_MS));
    let key = RegKey::create(&sub_w)?;
    let id_w = wide(sync_root_id);
    unsafe {
        RegSetValueExW(
            key.0,
            PCWSTR::null(),
            0,
            REG_SZ,
            Some(&wide_to_bytes(&id_w)),
        )
        .ok()?;
    }
    Ok(())
}

/// Removes `NameSpace` (and matching `CLSID`) entries left behind by older
/// sync root ids. `StorageProviderSyncRootManager::Unregister` does not clean
/// them, and each one would show up as a dead navigation-pane item.
fn sweep_orphans(current_clsid: &str, provider_id: &str) -> Result<u32> {
    let Some(root) = RegKey::open(&wide(NAMESPACE_ROOT)) else {
        return Ok(0);
    };
    let prefix = format!("{}!", provider_id);
    let mut orphans = Vec::new();
    let mut index = 0u32;
    loop {
        let mut name_buf = [0u16; 260];
        let mut len = name_buf.len() as u32;
        let err = unsafe {
            RegEnumKeyExW(
                root.0,
                index,
                PWSTR(name_buf.as_mut_ptr()),
                &mut len,
                None,
                PWSTR::null(),
                None,
                None,
            )
        };
        if err == ERROR_NO_MORE_ITEMS {
            break;
        }
        if err != ERROR_SUCCESS {
            break;
        }
        index += 1;
        let name = String::from_utf16_lossy(&name_buf[..len as usize]);
        if name.eq_ignore_ascii_case(current_clsid) {
            continue;
        }
        let subkey = format!(r"{}\{}", NAMESPACE_ROOT, name);
        let Some(default) = read_sz(HKEY_CURRENT_USER, &subkey, None) else {
            continue;
        };
        if default.starts_with(&prefix) {
            orphans.push(name);
        }
    }
    drop(root);
    let mut removed = 0u32;
    for name in orphans {
        unsafe {
            let _ = RegDeleteTreeW(
                HKEY_CURRENT_USER,
                PCWSTR(wide(format!(r"{}\{}", NAMESPACE_ROOT, name)).as_ptr()),
            );
            let _ = RegDeleteTreeW(
                HKEY_CURRENT_USER,
                PCWSTR(wide(format!(r"{}\{}", CLSID_ROOT, name)).as_ptr()),
            );
        }
        removed += 1;
    }
    Ok(removed)
}

/// Verifies and re-pins the Explorer navigation-pane entry for `sync_root_id`.
///
/// Returns `true` when any registry value had to be written or an orphan was
/// removed; the `NameSpace` pin itself is recreated on every call.
pub fn ensure_nav_pane_entry(
    sync_root_id: impl AsRef<OsStr>,
    display_name: impl AsRef<OsStr>,
    icon_resource: Option<impl AsRef<OsStr>>,
    sync_path: &Path,
) -> Result<bool> {
    let id_str = sync_root_id.as_ref().to_string_lossy();
    let sync_root_key = format!(r"{}\{}", SYNC_ROOT_MANAGER, id_str);
    let clsid = read_sz(HKEY_LOCAL_MACHINE, &sync_root_key, Some("NamespaceCLSID"))
        .or_else(|| read_sz(HKEY_CURRENT_USER, &sync_root_key, Some("NamespaceCLSID")))
        .context("sync root registration exposes no NamespaceCLSID")?;
    let clsid_path = format!(r"{}\{}", CLSID_ROOT, clsid);
    let mut changed = false;

    // The values below mirror what StorageProviderSyncRootManager::Register
    // wrote (and what the documented cloud-storage-provider recipe requires).
    // They are rewritten only when missing or different.
    changed |= ensure_sz(&clsid_path, None, &display_name.as_ref().to_string_lossy())?;
    changed |= ensure_dword(&clsid_path, Some("System.IsPinnedToNameSpaceTree"), 1)?;
    changed |= ensure_dword(&clsid_path, Some("SortOrderIndex"), SORT_ORDER_INDEX)?;
    if let Some(icon) = icon_resource {
        changed |= ensure_sz(
            &format!(r"{}\DefaultIcon", clsid_path),
            None,
            &icon.as_ref().to_string_lossy(),
        )?;
    }
    let shell32 = std::env::var_os("SystemRoot")
        .unwrap_or_else(|| OsString::from(r"C:\Windows"))
        .to_string_lossy()
        .into_owned()
        + r"\system32\shell32.dll";
    changed |= ensure_sz(&format!(r"{}\InProcServer32", clsid_path), None, &shell32)?;
    changed |= ensure_sz(
        &format!(r"{}\Instance", clsid_path),
        Some("CLSID"),
        INSTANCE_CLSID,
    )?;
    let prop_bag = format!(r"{}\Instance\InitPropertyBag", clsid_path);
    changed |= ensure_dword(&prop_bag, Some("Attributes"), PROPERTY_BAG_ATTRIBUTES)?;
    changed |= ensure_sz(
        &prop_bag,
        Some("TargetFolderPath"),
        &sync_path.as_os_str().to_string_lossy(),
    )?;
    let shell_folder = format!(r"{}\ShellFolder", clsid_path);
    changed |= ensure_dword(&shell_folder, Some("FolderValueFlags"), SHELL_FOLDER_FLAGS)?;
    changed |= ensure_dword(&shell_folder, Some("Attributes"), SHELL_FOLDER_ATTRIBUTES)?;
    changed |= ensure_dword(HIDE_DESKTOP_ICONS, Some(&clsid), 1)?;

    recreate_namespace_entry(&clsid, &id_str)?;

    if let Some(provider_id) = id_str.split('!').next() {
        changed |= sweep_orphans(&clsid, provider_id)? > 0;
    }

    if changed {
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST | SHCNF_FLUSH, None, None);
        }
    }
    Ok(changed)
}
