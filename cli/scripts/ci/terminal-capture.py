"""Give only stdout a real terminal; secret stdin and stderr remain separate pipes."""

import errno
import fcntl
import os
import pty
import struct
import subprocess
import sys
import termios

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, int(sys.argv[1]), 0, 0))
# Avoid transforming application LF into CRLF in the evidence bytes.
attributes = termios.tcgetattr(slave)
attributes[1] &= ~termios.OPOST
termios.tcsetattr(slave, termios.TCSANOW, attributes)
child = subprocess.Popen(sys.argv[2:], stdin=sys.stdin, stdout=slave, stderr=sys.stderr)
os.close(slave)
try:
    while True:
        try:
            chunk = os.read(master, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
finally:
    os.close(master)
    if child.poll() is None:
        child.wait(timeout=60)
sys.exit(child.returncode)
