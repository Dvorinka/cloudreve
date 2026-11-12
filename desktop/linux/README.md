# Linux file-manager integration

The `.deb` and AppImage bundles ship a copy of this `linux/` directory inside
the app's resource directory, so the helpers below are also available after a
packaged install — no need to clone the repo.

## Application menu entry

The `.deb` package ships its own desktop entry. For AppImage or manual
installs, install the bundled one yourself so the app appears in the
application menu and `cloudreve://` links open it:

```sh
mkdir -p ~/.local/share/applications
cp cloudreve.desktop ~/.local/share/applications/
update-desktop-database ~/.local/share/applications 2>/dev/null || true
xdg-mime default cloudreve.desktop x-scheme-handler/cloudreve
```

The app also registers the `cloudreve://` scheme itself at startup, so this
is only needed once per install. Adjust `Exec=` if the binary is not on
`PATH` (e.g. point it at the AppImage path).

## `cloudreve-share`

`cloudreve-share` opens the share dialog for a local path via the
`cloudreve://share/<path>` deep link — the same dialog the Windows Explorer
context menu opens. Works whether the app is running or not.

## `cloudreve-preview`

`cloudreve-preview` opens the preview window for a local file via the
`cloudreve://preview/<path>` deep link — images, video, audio, PDF, and text
render in-app; other types show an "open externally" card. Works whether the
app is running or not.

## Helper

```sh
cp cloudreve-share cloudreve-preview ~/.local/bin/
chmod +x ~/.local/bin/cloudreve-share ~/.local/bin/cloudreve-preview
cloudreve-share ~/Cloudreve/report.pdf
cloudreve-preview ~/Cloudreve/report.pdf
```

## GNOME / Nautilus

```sh
mkdir -p ~/.local/share/nautilus/scripts
cp "nautilus/scripts/Cloudreve Share" "nautilus/scripts/Cloudreve Preview" ~/.local/share/nautilus/scripts/
chmod +x ~/.local/share/nautilus/scripts/"Cloudreve Share" ~/.local/share/nautilus/scripts/"Cloudreve Preview"
```

Right-click a file → **Scripts** → **Cloudreve Share** or **Cloudreve Preview**.

## KDE / Dolphin

```sh
mkdir -p ~/.local/share/kio/servicemenus   # Dolphin ≥ 22
cp kde/cloudreve-share.desktop kde/cloudreve-preview.desktop ~/.local/share/kio/servicemenus/
```

Right-click a file → **Cloudreve** → **Share link…** or **Preview**. Restart
Dolphin if the entries do not appear.

Requires `python3` and `xdg-open` (both standard on desktop Linux).
