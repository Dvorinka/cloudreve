fn main() {
    // Embed the Windows app manifest that carries the <msix> identity element,
    // binding the exe to the signed sparse identity package when present.
    let attrs = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("windows-app-manifest.xml")),
    );
    tauri_build::try_build(attrs).expect("tauri build failed");
}
