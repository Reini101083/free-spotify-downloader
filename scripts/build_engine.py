"""Build the sidecar natively, then atomically promote the complete executable."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='fsd-engine-build-') as temporary:
    build = Path(temporary)
    subprocess.run([
        sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile',
        '--name', 'spotdl-engine', '--distpath', str(build / 'dist'),
        '--workpath', str(build / 'work'), '--specpath', str(build),
        '--collect-all', 'spotdl', '--collect-all', 'yt_dlp', '--collect-all', 'yt_dlp_ejs',
        '--collect-all', 'pykakasi', '--collect-all', 'ytmusicapi',
        '--collect-all', 'SpotipyFree', '--collect-all', 'curl_cffi',
        '--copy-metadata', 'spotdl', '--copy-metadata', 'yt-dlp',
        str(root / 'engine' / 'entry.py'),
    ], check=True, cwd=root)
    name = 'spotdl-engine.exe' if sys.platform == 'win32' else 'spotdl-engine'
    executable = build / 'dist' / name
    subprocess.run([str(executable), '--version'], check=True, timeout=45)
    destination = root / 'engine-dist'
    destination.mkdir(exist_ok=True)
    shutil.copy2(executable, destination / (name + '.tmp'))
    os.replace(destination / (name + '.tmp'), destination / name)
