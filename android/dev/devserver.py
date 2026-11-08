#!/usr/bin/env python3
"""Local Cloudreve backend for Android UI work.

Builds the server from this checkout, runs it on 127.0.0.1:5212 (reachable
from the emulator as http://10.0.2.2:5212), registers a dev user and fills
the drive with realistic sample data: photos, PDFs, videos, audio, archives,
source files and one big blob for transfer-progress testing.

    ./devserver.py all        build + start + seed + push
    ./devserver.py build      compile ./cloudreve into .data/
    ./devserver.py start      run the server in the background
    ./devserver.py stop
    ./devserver.py status
    ./devserver.py seed       register DEV_USER and upload the sample tree
    ./devserver.py push       copy the sample files to the emulator's Downloads
    ./devserver.py login      install the debug APK and sign in on the emulator via adb
    ./devserver.py reset      stop and wipe the database + uploaded blobs

Everything lives under android/dev/.data/ (gitignored). Stdlib only.
"""

from __future__ import annotations

import io
import json
import math
import os
import random
import shutil
import signal
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
import zipfile
from pathlib import Path

DEV_DIR = Path(__file__).resolve().parent
REPO = DEV_DIR.parent.parent
DATA = DEV_DIR / ".data"
BIN = DATA / "cloudreve"
SEED = DATA / "seed"
PID_FILE = DATA / "server.pid"
LOG_FILE = DATA / "server.log"

LISTEN = "127.0.0.1:5212"
BASE = f"http://{LISTEN}"
EMULATOR_URL = "http://10.0.2.2:5212"
DEV_USER = "dev@example.com"
DEV_PASSWORD = "cloudreve-dev"
DEVICE_DIR = "/sdcard/Download/cloudreve-seed"

PICSUM = "https://picsum.photos/seed/{seed}/{w}/{h}.jpg"
VIDEOS = {
    "Big_Buck_Bunny_360_10s_1MB.mp4":
        "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
    "Big_Buck_Bunny_720_10s_5MB.mp4":
        "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_5MB.mp4",
    "Jellyfish_360_10s_2MB.mp4":
        "https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_2MB.mp4",
}


# --------------------------------------------------------------------------- #
# server lifecycle
# --------------------------------------------------------------------------- #

def go_binary() -> str:
    """Prefer the mise-managed Go the repo pins; fall back to PATH."""
    try:
        out = subprocess.run(
            ["mise", "which", "go"], cwd=REPO, capture_output=True, text=True, check=True
        ).stdout.strip()
        if out:
            return out
    except (OSError, subprocess.CalledProcessError):
        pass
    return shutil.which("go") or sys.exit("go not found (install via mise or brew)")


def ensure_assets_zip() -> None:
    """statics.go embeds assets.zip; the API works fine with a stub."""
    target = REPO / "application" / "statics" / "assets.zip"
    if target.exists():
        return
    print("assets.zip missing; writing a stub (API-only, no web UI)")
    with zipfile.ZipFile(target, "w") as z:
        z.writestr("version.json", json.dumps({"name": "cloudreve-frontend", "version": "dev"}))
        z.writestr("index.html", "<!doctype html><title>Cloudreve dev</title>API only.")


def cmd_build() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    ensure_assets_zip()
    print("building server...")
    subprocess.run([go_binary(), "build", "-o", str(BIN), "."], cwd=REPO, check=True)
    print(f"built {BIN}")


def server_pid() -> int | None:
    if not PID_FILE.exists():
        return None
    pid = int(PID_FILE.read_text().strip() or 0)
    try:
        os.kill(pid, 0)
    except (OSError, ProcessLookupError):
        PID_FILE.unlink(missing_ok=True)
        return None
    return pid


def api_up() -> bool:
    try:
        urllib.request.urlopen(f"{BASE}/api/v4/site/config/basic", timeout=2).read()
        return True
    except (urllib.error.URLError, OSError):
        return False


def cmd_start() -> None:
    if server_pid():
        print(f"already running (pid {server_pid()})")
        return
    if api_up():
        sys.exit(f"something already answers on {BASE} but is not tracked by {PID_FILE}; "
                 "stop it first (pgrep -fl 'cloudreve server')")
    if not BIN.exists():
        cmd_build()
    env = dict(os.environ)
    # Bind to loopback only: the emulator reaches it through 10.0.2.2.
    env["CR_CONF_System__Listen"] = LISTEN
    # Download/thumbnail URLs are built from siteURL; the emulator must be able
    # to reach them, so point it at the host alias. Only applied on first init.
    env["CR_SETTING_DEFAULT_siteURL"] = EMULATOR_URL
    # Optional generators picked up on first database init.
    if shutil.which("ffmpeg"):
        env["CR_SETTING_DEFAULT_thumb_ffmpeg_enabled"] = "1"
    if shutil.which("vips"):
        env["CR_SETTING_DEFAULT_thumb_vips_enabled"] = "1"
    if shutil.which("soffice"):
        env["CR_SETTING_DEFAULT_thumb_libreoffice_enabled"] = "1"
    log = open(LOG_FILE, "ab")
    proc = subprocess.Popen(
        [str(BIN), "server", "-w"],
        cwd=DATA, env=env, stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    PID_FILE.write_text(str(proc.pid))
    for _ in range(60):
        if api_up():
            print(f"server up at {BASE} (pid {proc.pid}); emulator: {EMULATOR_URL}")
            return
        if proc.poll() is not None:
            sys.exit(f"server exited early, see {LOG_FILE}")
        time.sleep(0.5)
    sys.exit(f"server did not answer in time, see {LOG_FILE}")


def cmd_stop() -> None:
    pid = server_pid()
    if not pid:
        print("not running")
        return
    os.kill(pid, signal.SIGTERM)
    for _ in range(40):
        if not server_pid():
            break
        time.sleep(0.25)
    else:
        os.kill(pid, signal.SIGKILL)
    PID_FILE.unlink(missing_ok=True)
    print("stopped")


def cmd_status() -> None:
    pid = server_pid()
    print(f"pid: {pid or '-'}   api: {'up' if api_up() else 'down'}   url: {BASE}")
    print(f"emulator url: {EMULATOR_URL}   user: {DEV_USER}   password: {DEV_PASSWORD}")


def cmd_reset() -> None:
    cmd_stop()
    for name in ("data", "conf.ini"):
        p = DATA / name
        if p.is_dir():
            shutil.rmtree(p)
        elif p.exists():
            p.unlink()
    print("database and uploads wiped (binary and seed cache kept)")


# --------------------------------------------------------------------------- #
# API client
# --------------------------------------------------------------------------- #

class Api:
    def __init__(self) -> None:
        self.token: str | None = None

    def call(self, method: str, path: str, body=None, raw: bytes | None = None,
             content_type: str = "application/json"):
        url = path if path.startswith("http") else BASE + path
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", content_type)
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                text = resp.read()
        except urllib.error.HTTPError as e:
            text = e.read()
            raise RuntimeError(f"{method} {path} -> HTTP {e.code}: {text[:300]!r}") from None
        if not text:
            return None
        payload = json.loads(text)
        if payload.get("code", 0) != 0:
            raise RuntimeError(f"{method} {path} -> {payload.get('code')}: {payload.get('msg')}")
        return payload.get("data")

    def register_or_login(self) -> None:
        try:
            self.call("POST", "/api/v4/user", {"email": DEV_USER, "password": DEV_PASSWORD})
            print(f"registered {DEV_USER}")
        except RuntimeError as e:
            if "40032" not in str(e):  # 40032: email already in use
                raise
        data = self.call("POST", "/api/v4/session/token", {"email": DEV_USER, "password": DEV_PASSWORD})
        self.token = data["token"]["access_token"]

    def mkdir(self, uri: str) -> None:
        try:
            self.call("POST", "/api/v4/file/create", {"uri": uri, "type": "folder"})
        except RuntimeError as e:
            if "exist" not in str(e).lower() and "40004" not in str(e):
                raise

    def list(self, uri: str) -> list[dict]:
        q = urllib.parse.urlencode({"uri": uri, "page_size": 500})
        return self.call("GET", f"/api/v4/file?{q}")["files"]

    def upload(self, local: Path, parent_uri: str, mime: str) -> None:
        size = local.stat().st_size
        session = self.call("PUT", "/api/v4/file/upload", {
            "uri": f"{parent_uri}/{urllib.parse.quote(local.name)}",
            "size": size,
            "last_modified": int(local.stat().st_mtime * 1000),
            "mime_type": mime,
        })
        if session.get("rapid_uploaded"):
            return
        chunk = session.get("chunk_size") or max(size, 1)
        urls = session.get("upload_urls") or []
        with local.open("rb") as f:
            index = 0
            while True:
                buf = f.read(chunk)
                if not buf and index > 0:
                    break
                target = urls[index] if index < len(urls) else \
                    f"{BASE}/api/v4/file/upload/{session['session_id']}/{index}"
                method = "POST" if "/file/upload/" in target else "PUT"
                self.call(method, target, raw=buf, content_type=mime)
                index += 1
                if len(buf) < chunk:
                    break
        if session.get("completeURL"):
            self.call("POST", session["completeURL"])


# --------------------------------------------------------------------------- #
# sample data generation
# --------------------------------------------------------------------------- #

def fetch(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    print(f"  download {dest.name}")
    req = urllib.request.Request(url, headers={"User-Agent": "cloudreve-devserver"})
    with urllib.request.urlopen(req, timeout=60) as resp, dest.open("wb") as out:
        shutil.copyfileobj(resp, out)


def write_pdf(dest: Path, title: str, pages: list[list[str]]) -> None:
    """Minimal valid multi-page PDF with Helvetica text, no dependencies."""
    if dest.exists():
        return
    objects: list[bytes] = []

    def add(obj: bytes) -> int:
        objects.append(obj)
        return len(objects)

    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_ids: list[int] = []
    pages_id = len(objects) + 1 + 2 * len(pages)  # reserved after content+page objs
    for i, lines in enumerate(pages):
        body = [b"BT /F1 20 Tf 60 760 Td (" + title.encode("latin-1", "replace") + b") Tj ET"]
        y = 720
        for line in lines:
            esc = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            body.append(f"BT /F1 11 Tf 60 {y} Td ({esc}) Tj ET".encode("latin-1", "replace"))
            y -= 16
        body.append(f"BT /F1 9 Tf 60 40 Td (Page {i + 1} of {len(pages)}) Tj ET".encode())
        stream = b"\n".join(body)
        content = add(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
        page = add(
            f"<< /Type /Page /Parent {pages_id} 0 R /MediaBox [0 0 595 842] "
            f"/Contents {content} 0 R /Resources << /Font << /F1 {font} 0 R >> >> >>".encode()
        )
        page_ids.append(page)
    kids = " ".join(f"{p} 0 R" for p in page_ids)
    assert add(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode()) == pages_id
    catalog = add(f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode())

    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for n, obj in enumerate(objects, 1):
        offsets.append(out.tell())
        out.write(f"{n} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    dest.write_bytes(out.getvalue())


def write_wav(dest: Path, freqs: list[float], seconds: float = 20.0) -> None:
    if dest.exists():
        return
    rate = 44100
    n = int(rate * seconds)
    frames = bytearray()
    for i in range(n):
        t = i / rate
        env = min(1.0, t * 4) * min(1.0, (seconds - t) * 4)
        sample = sum(math.sin(2 * math.pi * f * t) for f in freqs) / len(freqs)
        frames += struct.pack("<h", int(sample * env * 12000))
    with wave.open(str(dest), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))


def write_blob(dest: Path, size_mb: int) -> None:
    if dest.exists() and dest.stat().st_size == size_mb * 1024 * 1024:
        return
    rng = random.Random(size_mb)
    with dest.open("wb") as f:
        for _ in range(size_mb):
            f.write(rng.randbytes(1024 * 1024))


def write_text(dest: Path, text: str) -> None:
    if not dest.exists():
        dest.write_text(text)


LOREM = ("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor "
         "incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud "
         "exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.").split(" ")


def paragraph(rng: random.Random, words: int = 70) -> list[str]:
    text, line, lines = [], [], []
    for _ in range(words):
        line.append(rng.choice(LOREM))
        if len(" ".join(line)) > 80:
            lines.append(" ".join(line))
            line = []
    if line:
        lines.append(" ".join(line))
    return lines


def build_seed_tree() -> Path:
    """Returns the root of the local sample tree; mirrors the remote layout."""
    rng = random.Random(7)
    root = SEED
    print("preparing sample files...")

    trip = root / "Photos" / "2025 Summer Trip"
    trip.mkdir(parents=True, exist_ok=True)
    for i in range(10):
        fetch(PICSUM.format(seed=f"trip{i}", w=1600, h=1067), trip / f"IMG_202507{10 + i:02d}_{rng.randint(80000, 195959):06d}.jpg")
    shots = root / "Photos" / "Screenshots"
    shots.mkdir(exist_ok=True)
    for i in range(4):
        fetch(PICSUM.format(seed=f"shot{i}", w=1080, h=2400), shots / f"Screenshot_2025110{i + 1}-{rng.randint(10, 23)}{rng.randint(10, 59)}{rng.randint(10, 59)}.jpg")
    wall = root / "Photos" / "Wallpapers"
    wall.mkdir(exist_ok=True)
    for i, name in enumerate(["mountains", "ocean", "forest", "city-night", "desert"]):
        fetch(PICSUM.format(seed=f"wall{i}", w=2560, h=1440), wall / f"{name}.jpg")

    pay = root / "Documents" / "Payslips"
    pay.mkdir(parents=True, exist_ok=True)
    for m in range(1, 11):
        write_pdf(pay / f"Payslip_2025-{m:02d}.pdf", f"Payslip 2025-{m:02d}", [
            ["Employee: Dev User", "Period: 2025-%02d" % m, "",
             "Gross salary ............ 8,250.00", "Pension ................... -412.50",
             "Income tax .............. -1,980.00", "Net paid ................ 5,857.50"],
        ])
    docs = root / "Documents"
    write_pdf(docs / "Resume.pdf", "Dev User - Resume", [paragraph(rng, 160), paragraph(rng, 140)])
    write_pdf(docs / "Lease Agreement 2025.pdf", "Lease Agreement", [paragraph(rng, 200) for _ in range(6)])
    write_pdf(docs / "Boarding pass - ZRH to DEL.pdf", "Boarding pass", [["Passenger: Dev User", "Flight LX 146", "Seat 23A", "Gate B41", "Boarding 09:40"]])
    write_text(docs / "Notes.md", "# Notes\n\n" + "\n\n".join(" ".join(paragraph(rng, 60)) for _ in range(5)) + "\n")
    write_text(docs / "Budget 2025.csv", "month,rent,groceries,transport,savings\n" + "\n".join(
        f"2025-{m:02d},1850,{rng.randint(380, 560)},{rng.randint(60, 140)},{rng.randint(900, 2200)}" for m in range(1, 13)) + "\n")
    write_text(docs / "config.json", json.dumps({"theme": "dark", "language": "en", "sync": {"wifiOnly": True, "folders": ["Photos", "Documents"]}}, indent=2) + "\n")
    write_text(docs / "shopping-list.txt", "milk\noats\ncoffee beans\ntoothpaste\nbatteries (AA)\n")

    vids = root / "Videos"
    vids.mkdir(exist_ok=True)
    for name, url in VIDEOS.items():
        try:
            fetch(url, vids / name)
        except (urllib.error.URLError, OSError) as e:
            print(f"  skip {name}: {e}")

    music = root / "Music"
    music.mkdir(exist_ok=True)
    write_wav(music / "A440 reference tone.wav", [440.0], 8)
    write_wav(music / "C major chord.wav", [261.63, 329.63, 392.0], 12)
    write_wav(music / "Ambient drone.wav", [110.0, 165.0, 220.5], 20)

    code = root / "Code" / "basement"
    code.mkdir(parents=True, exist_ok=True)
    write_text(code / "main.rs", 'fn main() {\n    println!("hello from basement");\n}\n')
    write_text(code / "Cargo.toml", '[package]\nname = "basement"\nversion = "0.1.0"\nedition = "2024"\n')
    write_text(code / "README.md", "# basement\n\nPersonal data management server.\n")
    write_text(root / "Code" / "deploy.py", "#!/usr/bin/env python3\nprint('deploy')\n")

    arch = root / "Archives"
    arch.mkdir(exist_ok=True)
    zpath = arch / "documents-backup-2025-10.zip"
    if not zpath.exists():
        with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
            for p in docs.rglob("*"):
                if p.is_file():
                    z.write(p, p.relative_to(docs))

    dl = root / "Downloads"
    dl.mkdir(exist_ok=True)
    write_blob(dl / "dataset-2025.bin", 60)
    write_blob(dl / "firmware-update.img", 25)

    (root / "Empty folder").mkdir(exist_ok=True)
    deep = root / "Projects" / "2025" / "Q4" / "Android UX"
    deep.mkdir(parents=True, exist_ok=True)
    write_text(deep / "plan.md", "# Android UX\n\n- thumbnails\n- upload progress\n- previews\n")

    # A long name and a unicode name, both common in real drives.
    write_text(root / "Documents" / "Very long file name that will certainly need truncation in a list row because it keeps going.txt", "long\n")
    write_text(root / "Documents" / "Rechnung Ökostrom März 2025 – Übersicht.txt", "umlauts\n")
    return root


MIME = {
    ".jpg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf", ".md": "text/markdown",
    ".txt": "text/plain", ".csv": "text/csv", ".json": "application/json", ".mp4": "video/mp4",
    ".wav": "audio/wav", ".zip": "application/zip", ".rs": "text/x-rust", ".toml": "text/plain",
    ".py": "text/x-python", ".bin": "application/octet-stream", ".img": "application/octet-stream",
}


def cmd_seed() -> None:
    if not api_up():
        cmd_start()
    root = build_seed_tree()
    api = Api()
    api.register_or_login()

    print("uploading to the dev drive...")
    existing: dict[str, set[str]] = {}

    def names_in(uri: str) -> set[str]:
        if uri not in existing:
            existing[uri] = {f["name"] for f in api.list(uri)}
        return existing[uri]

    uploaded = skipped = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        rel = Path(dirpath).relative_to(root)
        parent = "cloudreve://my" + ("" if rel == Path(".") else "/" + "/".join(urllib.parse.quote(p) for p in rel.parts))
        if rel != Path("."):
            api.mkdir(parent)
        have = names_in(parent)
        for name in sorted(filenames):
            if name in have:
                skipped += 1
                continue
            local = Path(dirpath) / name
            print(f"  {rel / name}  ({local.stat().st_size // 1024} kB)")
            api.upload(local, parent, MIME.get(local.suffix.lower(), "application/octet-stream"))
            uploaded += 1
    print(f"done: {uploaded} uploaded, {skipped} already present")
    print(f"sign in on the emulator with  {EMULATOR_URL}  {DEV_USER}  {DEV_PASSWORD}")


def cmd_push() -> None:
    """Copy the sample files to the emulator so uploads can be tested from the app."""
    adb = shutil.which("adb") or str(Path.home() / "Library/Android/sdk/platform-tools/adb")
    root = build_seed_tree()
    subprocess.run([adb, "shell", "mkdir", "-p", DEVICE_DIR], check=True)
    for sub in ("Photos/2025 Summer Trip", "Documents", "Videos", "Downloads"):
        subprocess.run([adb, "push", str(root / sub), DEVICE_DIR + "/"], check=True)
    # Make the pushed media visible to the picker's gallery view.
    subprocess.run([adb, "shell", "cmd", "media", "scan", DEVICE_DIR], check=False)
    print(f"pushed to {DEVICE_DIR}")


def cmd_login() -> None:
    """Install the debug APK, wipe its data and sign in to the dev backend via adb."""
    import re
    adb = shutil.which("adb") or str(Path.home() / "Library/Android/sdk/platform-tools/adb")
    apk = DEV_DIR.parent / "app/build/outputs/apk/debug/app-debug.apk"
    pkg = "com.tdvorak.cloudreve"

    def sh(*args, **kw):
        return subprocess.run([adb, *args], check=True, capture_output=True, text=True, **kw)

    if apk.exists():
        sh("install", "-r", str(apk))
    sh("shell", "pm", "clear", pkg)
    sh("shell", "am", "start", "-n", f"{pkg}/org.cloudreve.android.MainActivity")
    node = re.compile(r'<node[^>]*?text="([^"]*)"[^>]*?class="([^"]+)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
    fields: list[tuple[int, int]] = []
    button: tuple[int, int] | None = None
    for _ in range(20):  # the form takes a moment to appear after a cold start
        time.sleep(1)
        dump = sh("exec-out", "uiautomator", "dump", "/dev/tty").stdout
        fields, button = [], None
        for text, cls, l, t, r, b in node.findall(dump):
            centre = ((int(l) + int(r)) // 2, (int(t) + int(b)) // 2)
            if cls.endswith("EditText"):
                fields.append(centre)
            # Match the label, not "first button": the password-eye toggle is a Button too.
            elif cls.endswith("Button") and text.strip().lower() == "sign in":
                button = centre
        if len(fields) >= 3 and button:
            break
    else:
        sys.exit("login form not found on screen; is the app showing the login screen?")
    for (x, y), text in zip(fields, (EMULATOR_URL, DEV_USER, DEV_PASSWORD)):
        sh("shell", "input", "tap", str(x), str(y))
        time.sleep(0.4)
        sh("shell", "input", "keyevent", "KEYCODE_MOVE_END")
        sh("shell", "input", "keyevent", *(["KEYCODE_DEL"] * 40))
        sh("shell", "input", "text", text)
    # Only dismiss a soft keyboard when one is actually up: with the emulator's
    # hardware keyboard enabled none appears, and BACK would leave the app.
    if "mInputShown=true" in sh("shell", "dumpsys", "input_method").stdout:
        sh("shell", "input", "keyevent", "KEYCODE_BACK")
        time.sleep(0.4)
    sh("shell", "input", "tap", str(button[0]), str(button[1]))
    print("signed in on the emulator")


COMMANDS = {
    "build": cmd_build, "start": cmd_start, "stop": cmd_stop, "status": cmd_status,
    "seed": cmd_seed, "push": cmd_push, "reset": cmd_reset, "login": cmd_login,
}


def main(argv: list[str]) -> None:
    if len(argv) != 2 or argv[1] not in COMMANDS | {"all": None}:
        sys.exit(__doc__)
    if argv[1] == "all":
        cmd_build()
        cmd_start()
        cmd_seed()
        cmd_push()
        return
    COMMANDS[argv[1]]()


if __name__ == "__main__":
    main(sys.argv)
