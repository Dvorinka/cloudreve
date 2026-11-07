#!/usr/bin/env python3
"""Tap an on-screen element on the emulator by its text or content description.

    ./tap.py "Upload files"          tap the first node whose text/desc contains it
    ./tap.py --dump                  print every node with text/desc and its centre
    ./tap.py --wait "Downloads"      poll up to 10 s for the node to appear, then tap

Uses `uiautomator dump`, so it works for Compose and system UI alike. Stdlib only.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

ADB = shutil.which("adb") or str(Path.home() / "Library/Android/sdk/platform-tools/adb")
NODE = re.compile(
    r'<node[^>]*?text="([^"]*)"[^>]*?content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"'
)


def nodes() -> list[tuple[str, int, int]]:
    out = subprocess.run([ADB, "exec-out", "uiautomator", "dump", "/dev/tty"],
                         capture_output=True, text=True, timeout=30).stdout
    found = []
    for text, desc, l, t, r, b in NODE.findall(out):
        label = text or desc
        if label:
            found.append((label, (int(l) + int(r)) // 2, (int(t) + int(b)) // 2))
    return found


def tap(label: str, wait: bool) -> None:
    deadline = time.time() + (10 if wait else 0)
    while True:
        # Shortest matching label wins, so "dataset" picks the file row over
        # its "Preview the file dataset-2025.bin" button.
        hits = sorted((n for n in nodes() if label.lower() in n[0].lower()), key=lambda n: len(n[0]))
        if hits:
            text, x, y = hits[0]
            subprocess.run([ADB, "shell", "input", "tap", str(x), str(y)], check=True)
            print(f"tapped {text!r} at {x},{y}")
            return
        if time.time() >= deadline:
            sys.exit(f"no element matching {label!r} on screen")
        time.sleep(1)


def main(argv: list[str]) -> None:
    if len(argv) == 2 and argv[1] == "--dump":
        for text, x, y in nodes():
            print(f"{x:5d},{y:5d}  {text}")
    elif len(argv) == 3 and argv[1] == "--wait":
        tap(argv[2], wait=True)
    elif len(argv) == 2:
        tap(argv[1], wait=False)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
