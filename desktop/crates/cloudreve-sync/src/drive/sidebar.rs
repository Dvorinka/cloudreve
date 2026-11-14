//! File-manager sidebar pinning — the non-Windows analogue of the Explorer
//! navigation-pane pin handled by `nav_pane`.
//!
//! Linux pins `sync_path` into `~/.config/gtk-3.0/bookmarks` (Nautilus, Nemo,
//! Caja, GTK file chooser). macOS adds it to Finder Favorites through
//! `sfltool`. Both are best-effort: callers must treat failures as
//! non-fatal.

use std::io;
use std::path::Path;

/// Percent-encodes a path into a `file://` URI — shared by the GTK bookmark
/// format and `sfltool`'s URL argument.
fn file_uri(path: &Path) -> String {
    const SAFE: &[u8] = b"-._~/";
    let mut uri = String::from("file://");
    for &b in path.as_os_str().as_encoded_bytes() {
        if b.is_ascii_alphanumeric() || SAFE.contains(&b) {
            uri.push(b as char);
        } else {
            uri.push_str(&format!("%{b:02X}"));
        }
    }
    uri
}

/// Pins `mountpoint` in the file-manager sidebar. Idempotent — rewrites the
/// entry when the drive name changes.
pub fn pin(mountpoint: &Path, name: &str) -> io::Result<()> {
    pin_impl(mountpoint, name)
}

/// Removes `mountpoint` from the sidebar. No-op when absent.
pub fn unpin(mountpoint: &Path) -> io::Result<()> {
    unpin_impl(mountpoint)
}

#[cfg(target_os = "linux")]
fn pin_impl(mountpoint: &Path, name: &str) -> io::Result<()> {
    rewrite_bookmarks(&file_uri(mountpoint), Some(name))
}

#[cfg(target_os = "linux")]
fn unpin_impl(mountpoint: &Path) -> io::Result<()> {
    rewrite_bookmarks(&file_uri(mountpoint), None)
}

/// Pure core of [`rewrite_bookmarks`]: drop entries for `uri`, then append
/// `uri name` when `name` is given.
#[cfg(target_os = "linux")]
fn rewrite_bookmark_lines(existing: &str, uri: &str, name: Option<&str>) -> String {
    let mut lines: Vec<String> = existing
        .lines()
        .filter(|l| l.split_whitespace().next() != Some(uri))
        .map(str::to_owned)
        .collect();
    if let Some(name) = name {
        lines.push(format!("{uri} {name}"));
    }
    if lines.is_empty() {
        return String::new();
    }
    lines.join("\n") + "\n"
}

#[cfg(target_os = "linux")]
fn rewrite_bookmarks(uri: &str, name: Option<&str>) -> io::Result<()> {
    let Some(dir) = dirs::config_dir() else {
        return Ok(());
    };
    let path = dir.join("gtk-3.0").join("bookmarks");
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let rewritten = rewrite_bookmark_lines(&existing, uri, name);
    if name.is_some() {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(&path, rewritten)
}

#[cfg(target_os = "macos")]
fn sfltool(verb: &str, mountpoint: &Path) -> io::Result<()> {
    let status = std::process::Command::new("sfltool")
        .args([
            verb,
            "com.apple.LSSharedFileList.FavoriteItems",
            &file_uri(mountpoint),
        ])
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "sfltool {verb} exited with {status}"
        )))
    }
}

#[cfg(target_os = "macos")]
fn pin_impl(mountpoint: &Path, _name: &str) -> io::Result<()> {
    sfltool("add-item", mountpoint)
}

#[cfg(target_os = "macos")]
fn unpin_impl(mountpoint: &Path) -> io::Result<()> {
    sfltool("remove-item", mountpoint)
}

#[cfg(all(not(windows), not(target_os = "linux"), not(target_os = "macos")))]
fn pin_impl(_mountpoint: &Path, _name: &str) -> io::Result<()> {
    Ok(())
}

#[cfg(all(not(windows), not(target_os = "linux"), not(target_os = "macos")))]
fn unpin_impl(_mountpoint: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_uri_percent_encodes_unsafe_bytes() {
        assert_eq!(
            file_uri(Path::new("/home/user/My Files")),
            "file:///home/user/My%20Files"
        );
        assert_eq!(
            file_uri(Path::new("/home/u/Clöud#x")),
            "file:///home/u/Cl%C3%B6ud%23x"
        );
        assert_eq!(
            file_uri(Path::new("/plain/path.txt")),
            "file:///plain/path.txt"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rewrite_bookmark_lines_adds_dedupes_and_removes() {
        let uri = "file:///mnt/cloudreve";

        // Add to a file that has other entries.
        let out = rewrite_bookmark_lines("file:///a A\nfile:///b B\n", uri, Some("My Files"));
        assert_eq!(
            out,
            "file:///a A\nfile:///b B\nfile:///mnt/cloudreve My Files\n"
        );

        // Same URI with a new label replaces the old entry, never duplicates.
        let out = rewrite_bookmark_lines(&out, uri, Some("Renamed"));
        assert_eq!(
            out,
            "file:///a A\nfile:///b B\nfile:///mnt/cloudreve Renamed\n"
        );

        // A URI appearing with and without a label both count as ours.
        let out = rewrite_bookmark_lines("file:///mnt/cloudreve\nfile:///a A\n", uri, Some("N"));
        assert_eq!(out, "file:///a A\nfile:///mnt/cloudreve N\n");

        // Removing the only entry yields an empty file.
        assert_eq!(rewrite_bookmark_lines(&out, uri, None), "file:///a A\n");
        assert_eq!(
            rewrite_bookmark_lines("file:///mnt/cloudreve M\n", uri, None),
            ""
        );

        // Removing a URI that was never present leaves content untouched.
        assert_eq!(
            rewrite_bookmark_lines("file:///a A\n", uri, None),
            "file:///a A\n"
        );
    }
}
