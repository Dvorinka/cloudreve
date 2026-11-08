#!/usr/bin/env python3
"""Fill or empty the emulator's photo gallery, for exercising camera backup.

    dev/gallery.py seed 230      put 230 small PNGs in /sdcard/Pictures/Bulk and index them
    dev/gallery.py count         how many of them MediaStore knows about
    dev/gallery.py replace 7     give BULK_0007.png different content (same-name collision)
    dev/gallery.py clear         remove them again

Standard library only; needs adb on PATH or ANDROID_HOME set.
"""

from __future__ import annotations

import os
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

REMOTE_DIR = "/sdcard/Pictures/Bulk"
PREFIX = "BULK_"


def adb(*args: str, capture: bool = False) -> str:
    sdk = os.environ.get("ANDROID_HOME") or str(Path.home() / "Library/Android/sdk")
    exe = Path(sdk) / "platform-tools" / "adb"
    cmd = [str(exe) if exe.exists() else "adb", *args]
    result = subprocess.run(cmd, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (struct.pack(">I", len(body)) + kind + body
                + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF))

    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


def rescan() -> None:
    adb("shell", "content", "call", "--uri", "content://media/external/file",
        "--method", "scan_volume", "--arg", "external_primary", capture=True)


def count() -> int:
    # adb joins the arguments and the device shell re-parses them, so the WHERE clause
    # needs its own quoting to arrive as one argument.
    where = f"\"_display_name LIKE '{PREFIX}%'\""
    out = adb("shell", "content", "query", "--uri", "content://media/external/images/media",
              "--projection", "_id", "--where", where, capture=True)
    return sum(1 for line in out.splitlines() if line.startswith("Row:"))


def seed(n: int) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n):
            colour = (i % 256, (i * 7) % 256, (i * 13) % 256)
            Path(tmp, f"{PREFIX}{i:04d}.png").write_bytes(png(64, 64, colour))
        adb("shell", "mkdir", "-p", REMOTE_DIR)
        adb("push", "--sync", f"{tmp}/.", f"{REMOTE_DIR}/", capture=True)
    rescan()
    print(f"pushed {n}; MediaStore indexes {count()}")


def replace(i: int) -> None:
    """Overwrite BULK_i with different bytes under the same name: a same-name,
    different-content collision for the backup worker to resolve."""
    name = f"{PREFIX}{i:04d}.png"
    with tempfile.TemporaryDirectory() as tmp:
        Path(tmp, name).write_bytes(png(96, 96, (255 - i % 256, 1, 2)))
        adb("push", f"{tmp}/{name}", f"{REMOTE_DIR}/{name}", capture=True)
    adb("shell", "content", "call", "--uri", "content://media/external/file",
        "--method", "scan_file", "--arg", f"/storage/emulated/0/Pictures/Bulk/{name}", capture=True)
    print(f"replaced {name}")


def clear() -> None:
    adb("shell", "rm", "-rf", REMOTE_DIR)
    rescan()
    print(f"removed; MediaStore indexes {count()}")


def main(argv: list[str]) -> None:
    if not argv or argv[0] not in ("seed", "count", "clear", "replace"):
        sys.exit(__doc__)
    if argv[0] == "seed":
        seed(int(argv[1]) if len(argv) > 1 else 230)
    elif argv[0] == "count":
        print(count())
    elif argv[0] == "replace":
        replace(int(argv[1]))
    else:
        clear()


if __name__ == "__main__":
    main(sys.argv[1:])
