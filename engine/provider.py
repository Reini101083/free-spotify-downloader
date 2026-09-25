"""Preserve provider errors that spotDL otherwise reduces to a video URL."""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile
import wave


def diagnostic(level, message):
    text = str(message)
    text = re.sub(r'(?i)(authorization|cookie|set-cookie):[^\r\n]+', r'\1: [redacted]', text)
    print('FSD_PROVIDER ' + json.dumps({'level': level, 'message': text[-6000:]}), flush=True)


def install_diagnostics():
    from spotdl.providers.audio.base import YTDLLogger
    original_error = YTDLLogger.error
    def error(self, message):
        diagnostic('error', message)
        return original_error(self, message)
    def warning(self, message):
        diagnostic('warning', message)
    YTDLLogger.error = error
    YTDLLogger.warning = warning


def prepare_external_tools():
    # PyInstaller's private libraries must not override Deno/FFmpeg system libraries.
    if not getattr(sys, 'frozen', False):
        return
    if sys.platform == 'win32':
        import ctypes
        ctypes.windll.kernel32.SetDllDirectoryW(None)
    elif sys.platform.startswith('linux'):
        if 'LD_LIBRARY_PATH_ORIG' in os.environ:
            os.environ['LD_LIBRARY_PATH'] = os.environ['LD_LIBRARY_PATH_ORIG']
        else:
            os.environ.pop('LD_LIBRARY_PATH', None)


def runtime_options(deno):
    # spotDL parses this with shlex; no shell is involved.
    return shlex.join(['--js-runtimes', 'deno:' + str(deno), '--no-remote-components', '--retries', '2', '--fragment-retries', '2', '--socket-timeout', '30'])


def diagnostics(ffmpeg, deno):
    import yt_dlp.version
    import yt_dlp_ejs.yt.solver
    prepare_external_tools()
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    result = {'yt_dlp': yt_dlp.version.__version__, 'ejs': False}
    result['ejs'] = bool(yt_dlp_ejs.yt.solver.core() and yt_dlp_ejs.yt.solver.lib())
    if not result['ejs']:
        raise RuntimeError('Bundled YouTube JavaScript components are missing')
    for name, executable, args in [('ffmpeg', ffmpeg, ['-version']), ('deno', deno, ['--version'])]:
        completed = subprocess.run([executable, *args], capture_output=True, text=True, timeout=20, creationflags=flags)
        if completed.returncode:
            raise RuntimeError(f'{name} could not start: {completed.stderr[-500:]}')
        result[name] = completed.stdout.splitlines()[0]
    # Exercise the real encoder and cross-directory promotion, not just --version.
    from session import promote, valid_audio
    from library import scan
    with tempfile.TemporaryDirectory(prefix='fsd-selftest-') as directory:
        root = Path(directory)
        source = root / 'fixture.wav'
        with wave.open(str(source), 'wb') as stream:
            stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(8000)
            stream.writeframes(b'\0\0' * 8000)
        encoded = root / 'encoded.mp3'
        conversion = subprocess.run([ffmpeg, '-v', 'error', '-i', str(source), '-codec:a', 'libmp3lame', str(encoded)], capture_output=True, text=True, timeout=20, creationflags=flags)
        if conversion.returncode or not valid_audio(encoded):
            raise RuntimeError('MP3 conversion failed: ' + conversion.stderr[-500:])
        destination = root / 'Downloads'
        destination.mkdir()
        promote(encoded, destination / 'fixture.mp3', 'selftest')
        if len(scan(destination)) != 1:
            raise RuntimeError('Saved MP3 could not be verified')
        result['mp3_conversion'] = True
        result['saved_file_verified'] = True
    print(json.dumps(result), flush=True)
