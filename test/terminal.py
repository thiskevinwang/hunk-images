"""PTY smoke test against installed Hunk; HUNK_SOURCE optionally selects source."""
import fcntl
import base64
import argparse
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time
import zlib

extension = Path(__file__).resolve().parent.parent
source = os.environ.get('HUNK_SOURCE')
parser = argparse.ArgumentParser()
parser.add_argument('--mode', choices=['staged', 'worktree', 'untracked', 'commits'], default='staged')
mode = parser.parse_args().mode
command = ([shutil.which('bun'), str(Path(source) / 'packages/hunk/src/main.tsx')]
           if source else [os.environ.get('HUNK_BIN') or shutil.which('hunk')])
if not command[0]:
    raise SystemExit('Hunk not found. Run with bun run test:terminal or set HUNK_BIN.')
command += ['diff'] + (['--staged'] if mode == 'staged' else ['HEAD~1', 'HEAD'] if mode == 'commits' else [])
command += ['--extension', str(extension)]

with tempfile.TemporaryDirectory(prefix='hunk-images-test-') as folder:
    repo = Path(folder) / 'repo'
    repo.mkdir()
    def git(*args):
        subprocess.run(['git', *args], cwd=repo, check=True, capture_output=True,
                       env={**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'})
    git('init', '-q')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.invalid')
    shutil.copyfile(extension / 'test/fixtures/before.png', repo / 'image.png')
    git('add', '.')
    git('commit', '-qm', 'Before')
    shutil.copyfile(extension / 'test/fixtures/after.png', repo / 'image.png')
    git('add', '.')
    # The staged blue image must appear even when disk contains the red image.
    shutil.copyfile(extension / 'test/fixtures/before.png', repo / 'image.png')
    if mode == 'commits':
        git('commit', '-qm', 'After')
    elif mode in ('worktree', 'untracked'):
        git('restore', '--staged', 'image.png')
        shutil.copyfile(extension / 'test/fixtures/after.png', repo / ('new.png' if mode == 'untracked' else 'image.png'))
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update(XDG_CONFIG_HOME=folder, XDG_STATE_HOME=folder,
                          XDG_CACHE_HOME=folder, XDG_RUNTIME_DIR=folder,
                          TERM='xterm-kitty', TERM_PROGRAM='kitty')
        os.chdir(repo)
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
        try:
            os.write(fd, b'\x1b[19~')  # F8
        except OSError:
            raise AssertionError(re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', startup).decode(errors='replace'))
        preview = read_for(3)
        plain = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', preview)
        assert b'Before' in plain and b'After' in plain, (startup + preview)[-6000:]
        graphics = re.findall(rb'\x1b_G([^;\x1b]*)(?:;[^\x1b]*)?\x1b\\', preview)
        assert any(b'a=t' in g or b'a=T' in g for g in graphics), graphics
        # Decode complete Kitty transfers to prove the staged blue image reached output.
        images = []
        metadata = None
        payload = b''
        for header, data in re.findall(rb'\x1b_G([^;\x1b]*);([^\x1b]*)\x1b\\', preview):
            fields = dict(item.split(b'=', 1) for item in header.split(b',') if b'=' in item)
            if fields.get(b'a') in (b't', b'T'):
                metadata, payload = fields, b''
            if metadata is None:
                continue
            payload += data
            if fields.get(b'm', b'0') == b'0':
                pixels = base64.b64decode(payload)
                if metadata.get(b'o') == b'z':
                    pixels = zlib.decompress(pixels)
                if metadata.get(b'f') == b'100':
                    png = Path(folder) / 'transfer.png'
                    png.write_bytes(pixels)
                    decode = ('import { NativeImage } from "@opentui/core"; '
                              'const image = NativeImage.decode(await Bun.file(process.argv[1]).bytes()); '
                              'process.stdout.write(image.raw().data); image.dispose();')
                    pixels = subprocess.check_output([shutil.which('bun'), '-e', decode, str(png)], cwd=extension)
                stride = 3 if metadata.get(b'f') == b'24' else 4
                images.append({pixels[offset:offset + 3] for offset in range(0, len(pixels), stride)})
                metadata = None
        if mode != 'untracked':
            assert any(b'\xff\x00\x00' in colors for colors in images), 'Before red image missing'
        assert any(b'\x00\x00\xff' in colors for colors in images), 'After blue image missing'
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 55, 550, 800))
        os.kill(pid, signal.SIGWINCH)
        resized = read_for(2)
        os.write(fd, b'\x1b[19~')
        cleared = read_for(2)
        assert b'a=d' in resized + cleared, 'No graphics cleanup after resize/toggle'
        print(f'PASS ({mode}): host loaded extension; F8 emitted expected image pixels; resize/toggle removed image placements.')
    finally:
        os.kill(pid, signal.SIGTERM)
        read_for(0.3)
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)
        os.close(fd)
