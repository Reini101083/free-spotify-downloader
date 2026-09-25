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


def diagnostics(ffmpeg, deno, download_check=False):
    import yt_dlp.version
    import yt_dlp_ejs.yt.solver
    from spotdl.providers.audio.base import AudioProvider
    from spotdl.utils.ffmpeg import convert
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
        if download_check:
            from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
            import threading
            payload = source.read_bytes()
            invalid = b'<html><body>Site Unavailable</body></html>'
            class FixtureHandler(BaseHTTPRequestHandler):
                def do_GET(self):
                    content = payload if self.path == '/fixture.wav' else invalid
                    self.send_response(200)
                    self.send_header('Content-Type', 'audio/wav')
                    self.send_header('Content-Length', str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
                def log_message(self, *_args):
                    pass
            server = ThreadingHTTPServer(('127.0.0.1', 0), FixtureHandler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                provider = AudioProvider(yt_dlp_args=runtime_options(deno))
                # This loopback fixture never uses an external proxy or service.
                provider.audio_handler.params.update(proxy='', cachedir=False, outtmpl={'default': str(root / 'received-%(id)s.%(ext)s')})
                for name in ('fixture', 'invalid'):
                    info = provider.get_download_metadata(f'http://127.0.0.1:{server.server_port}/{name}.wav', download=True)
                    received = Path(provider.audio_handler.prepare_filename(info))
                    if name == 'fixture':
                        if received.read_bytes() != payload:
                            raise RuntimeError('Audio provider returned incorrect bytes')
                        source = received
                    elif valid_audio(received):
                        raise RuntimeError('An HTML error page was accepted as audio')
                result['http_audio_download'] = True
                result['html_error_rejected'] = True
            finally:
                server.shutdown(); server.server_close(); thread.join(timeout=5)
        encoded = root / 'encoded.mp3'
        success, detail = convert(source, encoded, ffmpeg=ffmpeg, output_format='mp3', bitrate='192k')
        if not success or not valid_audio(encoded):
            raise RuntimeError('MP3 conversion failed: ' + str(detail)[-500:])
        destination = root / 'Downloads'
        destination.mkdir()
        promote(encoded, destination / 'fixture.mp3', 'selftest')
        if len(scan(destination)) != 1:
            raise RuntimeError('Saved MP3 could not be verified')
        result['mp3_conversion'] = True
        result['saved_file_verified'] = True
    print(json.dumps(result), flush=True)
