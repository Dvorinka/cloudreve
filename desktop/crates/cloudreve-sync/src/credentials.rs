//! Refresh-token protection via the OS credential store.
//!
//! `drives.json` is plain JSON on disk; the long-lived refresh token is the
//! durable secret worth moving out of it. When the OS keyring accepts the
//! token, the file stores the [`MARKER`] sentinel instead and the real secret
//! lives in Windows Credential Manager / macOS Keychain / Secret Service.
//! When the keyring is unavailable (headless Linux without a Secret Service
//! daemon) the token falls back to file storage unchanged — best-effort, the
//! mount must never fail over it.

use std::io;

/// Sentinel written to `drives.json` in place of the real refresh token.
const MARKER: &str = "keyring-managed";
const SERVICE: &str = "cloudreve";

fn entry(drive_id: &str) -> io::Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, &format!("drive:{drive_id}:refresh_token"))
        .map_err(|e| io::Error::other(e.to_string()))
}

/// True when `stored` is the keyring sentinel rather than a real token.
pub fn is_protected(stored: &str) -> bool {
    stored == MARKER
}

/// Resolves a possibly-protected value to the real token. A marker that the
/// keyring cannot resolve yields an empty string, which leaves the drive
/// credential-expired and prompts re-authorization.
pub fn resolve_refresh_token(drive_id: &str, stored: &str) -> String {
    if !is_protected(stored) {
        return stored.to_string();
    }
    match entry(drive_id).and_then(|e| {
        e.get_password()
            .map_err(|e| io::Error::other(e.to_string()))
    }) {
        Ok(token) => token,
        Err(e) => {
            tracing::warn!(target: "credentials", drive_id = %drive_id, error = %e,
                "Failed to read refresh token from OS credential store");
            String::new()
        }
    }
}

/// Stores `token` in the OS credential store and returns the value to keep in
/// `DriveConfig` (marker on success, the raw token as fallback on failure).
pub fn protect_refresh_token(drive_id: &str, token: &str) -> String {
    if is_protected(token) || token.is_empty() {
        return token.to_string();
    }
    match entry(drive_id).and_then(|e| {
        e.set_password(token)
            .map_err(|e| io::Error::other(e.to_string()))
    }) {
        Ok(()) => MARKER.to_string(),
        Err(e) => {
            tracing::warn!(target: "credentials", drive_id = %drive_id, error = %e,
                "OS credential store unavailable, keeping refresh token in drives.json");
            token.to_string()
        }
    }
}

/// Removes the keyring entry for a deleted drive. Best-effort.
pub fn delete_refresh_token(drive_id: &str) {
    match entry(drive_id).and_then(|e| {
        e.delete_credential()
            .map_err(|e| io::Error::other(e.to_string()))
    }) {
        Ok(()) => {}
        Err(e) => {
            tracing::debug!(target: "credentials", drive_id = %drive_id, error = %e,
                "No keyring refresh-token entry to delete");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_roundtrip_semantics() {
        assert!(!is_protected("eyJhbGciOiJIUzI1NiJ9.x.y"));
        assert!(is_protected(MARKER));
        // A raw token resolves to itself; an already-marked value is not
        // double-protected.
        assert_eq!(resolve_refresh_token("d1", "raw-token"), "raw-token");
        assert_eq!(protect_refresh_token("d1", MARKER), MARKER);
        assert_eq!(protect_refresh_token("d1", ""), "");
    }
}
