# macOS file-manager integration

`cloudreve-share` opens the share dialog for a local path via the
`cloudreve://share/<path>` deep link — the same dialog the Windows Explorer
context menu opens. `cloudreve-preview` does the same for the preview window
via `cloudreve://preview/<path>`.

## Terminal

```sh
cp cloudreve-share cloudreve-preview ~/.local/bin/   # or anywhere on PATH
chmod +x ~/.local/bin/cloudreve-share ~/.local/bin/cloudreve-preview
cloudreve-share ~/Cloudreve/report.pdf
cloudreve-preview ~/Cloudreve/report.pdf
```

## Finder Quick Action

1. Open **Shortcuts** → new shortcut.
2. Add action **"Run Shell Script"**:
   - Shell: `zsh` (or `sh`), Input: **Shortcut Input**
   - Script: `cloudreve-share "$1"` (or `cloudreve-preview "$1"`)
3. Enable **"Use as Quick Action"** → **Finder**, name it `Cloudreve Share`
   (or `Cloudreve Preview`).
4. In Finder: right-click a file → **Quick Actions** → your action.

(Requires the helpers on PATH and `python3`, which ships with macOS
Command Line Tools.)
