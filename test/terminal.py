"""PTY smoke test. HUNK_SOURCE may name an API 33 Hunk source checkout."""
import fcntl
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import tempfile
import termios
import time

extension = Path(__file__).resolve().parent.parent
source = os.environ.get('HUNK_SOURCE')
command = ([shutil.which('bun'), str(Path(source) / 'packages/hunk/src/main.tsx')]
           if source else [shutil.which('hunk')])
command += ['diff', '--files', str(extension / 'test/fixtures/before.png'),
            str(extension / 'test/fixtures/after.png'), '--extension', str(extension)]

with tempfile.TemporaryDirectory(prefix='hunk-images-test-') as folder:
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update(XDG_CONFIG_HOME=folder, XDG_STATE_HOME=folder,
                          XDG_CACHE_HOME=folder, XDG_RUNTIME_DIR=folder,
                          TERM='xterm-kitty', TERM_PROGRAM='kitty')
        os.chdir(source or extension)
        os.execv(command[0], command)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 1200, 800))

    def read_for(seconds):
        data = b''
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if select.select([fd], [], [], 0.05)[0]:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                data += chunk
                # Simulate terminal capability replies; no image display is claimed.
                if b'\x1b[c' in chunk or b'\x1b[0c' in chunk:
                    os.write(fd, b'\x1b[?62;4;22c')
                if b'\x1b[16t' in chunk:
                    os.write(fd, b'\x1b[6;20;10t')
                if b'\x1b[14t' in chunk:
                    os.write(fd, b'\x1b[4;800;1200t')
                for query in re.findall(rb'\x1b_G([^;]*);[^\x1b]*\x1b\\', chunk):
                    if b'a=q' in query:
                        ident = re.search(rb'(?:^|,)i=(\d+)', query)
                        if ident:
                            os.write(fd, b'\x1b_Gi=' + ident[1] + b';OK\x1b\\')
        return data

    try:
        startup = read_for(4)
        os.write(fd, b'\x1b[19~')  # F8
        preview = read_for(3)
        plain = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', preview)
        assert b'Before' in plain and b'After' in plain, (startup + preview)[-6000:]
        graphics = re.findall(rb'\x1b_G([^;\x1b]*)(?:;[^\x1b]*)?\x1b\\', preview)
        assert any(b'a=t' in g or b'a=T' in g for g in graphics), graphics
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 55, 550, 800))
        os.kill(pid, signal.SIGWINCH)
        resized = read_for(2)
        os.write(fd, b'\x1b[19~')
        cleared = read_for(2)
        assert b'a=d' in resized + cleared, 'No graphics cleanup after resize/toggle'
        print('PASS: API 33 host loaded extension; F8 rendered captions and Kitty data; resize/toggle removed image placements.')
    finally:
        os.kill(pid, signal.SIGTERM)
        read_for(0.3)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        os.close(fd)
