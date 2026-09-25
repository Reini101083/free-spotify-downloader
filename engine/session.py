"""Own resumable coordinator. Only complete, validated tracks enter the music folder."""
import argparse
import hashlib
import shutil
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time

PREFIX = 'FSD_EVENT '


class SessionError(RuntimeError):
    def __init__(self, code, message, detail=''):
        super().__init__(message)
        self.code, self.detail = code, detail


def report_error(error):
    if isinstance(error, SessionError):
        code, message, detail = error.code, str(error), error.detail
    elif isinstance(error, OSError):
        code, message, detail = 'FILESYSTEM', 'File access failed. Check your download folder and free space.', str(error)
    else:
        code, message, detail = 'ENGINE', 'The download engine stopped. See the download log for details.', f'{type(error).__name__}: {error}'
    emit('error', code=code, message=message, detail=detail[-6000:])


def emit(kind, **values):
    print(PREFIX + json.dumps(dict(type=kind, **values)), flush=True)


def atomic_save(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    with open(str(file) + '.tmp', 'w', encoding='utf8') as stream:
        json.dump(value, stream, ensure_ascii=False)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(str(file) + '.tmp', file)


def valid_audio(file):
    from mutagen import File
    try:
        audio = File(file)
        return file.is_file() and file.stat().st_size > 0 and audio is not None and audio.info.length > 0
    except Exception:
        return False


def fingerprint(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def command(*args):
    return [sys.executable, *([] if getattr(sys, 'frozen', False) else [str(Path(__file__).with_name('entry.py'))]), *args]


def kill_tree(process):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def run_worker(args, timeout):
    # Redirect into a temporary file so a noisy provider cannot fill RAM or block a pipe.
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(command(*args), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=os.name != 'nt', creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0, env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})
        try:
            code = process.wait(timeout=timeout)
        finally:
            kill_tree(process)
        log.seek(0, 2)
        log.seek(max(0, log.tell() - 48000))
        return code, log.read().decode('utf8', errors='replace')


def provider_failure(log):
    messages = []
    for line in log.splitlines():
        if line.startswith('FSD_PROVIDER '):
            try:
                entry = json.loads(line[len('FSD_PROVIDER '):])
                if entry.get('level') in ('error', 'warning'):
                    messages.append(str(entry.get('message', '')))
            except ValueError:
                pass
    return '\n'.join(messages)[-6000:] or log[-3000:]


def promote(source, destination, job_id):
    # Stage away from Music. A temporary destination file makes cross-drive promotion atomic.
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='.fsd-' + job_id + '-', suffix='.partial', dir=destination.parent, delete=False) as target:
            temporary = Path(target.name)
            with source.open('rb') as stream:
                shutil.copyfileobj(stream, target)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def resolve(url, destination):
    from spotdl.utils.spotify import SpotifyClient
    from spotdl.utils.search import get_simple_songs
    SpotifyClient.init('', '', no_cache=True, headless=True)
    songs = get_simple_songs([url])
    unique = {}
    for song in songs:
        match = re.fullmatch(r'https://open.spotify.com/track/([a-zA-Z0-9]{22})', song.url or '')
        if match:
            unique[song.url] = {'url': song.url, 'id': match[1], 'title': song.name or match[1]}
    atomic_save(destination, list(unique.values()))


def resolve_tracks(url, result_file):
    # Retry a temporary connection failure once, never retry access denial or rate limiting.
    for attempt in range(2):
        emit('status', message='Loading the Spotify track list…' if not attempt else 'Retrying the Spotify connection…')
        try:
            code, log = run_worker(['--resolve', url, str(result_file)], 120)
        except subprocess.TimeoutExpired:
            code, log = 1, 'Spotify metadata request timed out after 120 seconds'
        if not code and result_file.exists():
            tracks = json.loads(result_file.read_text(encoding='utf8'))
            if not tracks:
                raise SessionError('SPOTIFY_EMPTY', 'Spotify returned no available tracks. Check the link and playlist visibility.')
            return tracks
        denied = re.search(r'\b(?:401|403|404|429)\b|too many requests|rate.?limit|private playlist|invalid playlist', log, re.I)
        temporary = re.search(r'timed?\s*out|timeout|connection|resolve host|general hashes|\b50[234]\b', log, re.I)
        if not attempt and temporary and not denied:
            time.sleep(1)
            continue
        if re.search(r'\b429\b|too many requests|rate.?limit', log, re.I):
            message = 'Spotify is limiting requests. Wait before resuming.'
        elif denied:
            message = 'Spotify is not providing this track list. Check that the playlist is public and the link is valid.'
        elif temporary:
            message = 'The Spotify connection failed. Check your connection and try again later.'
        else:
            message = 'The Spotify track list could not be loaded. See the download log for details.'
        raise SessionError('SPOTIFY_METADATA', message, log)


def run_session(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--session', required=True)
    parser.add_argument('--url', required=True)
    parser.add_argument('--folder', required=True)
    parser.add_argument('--format', choices=['mp3', 'm4a', 'flac', 'opus', 'wav'], required=True)
    parser.add_argument('--bitrate', required=True)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--deno')
    parser.add_argument('--only-track')
    parser.add_argument('--cookie-file')
    args = parser.parse_args(argv)
    manifest = Path(args.session)
    folder = Path(args.folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    stage_prefix = '.fsd-stage-' + manifest.stem + '-'
    for abandoned in folder.glob(stage_prefix + '*'):
        if abandoned.is_dir():
            shutil.rmtree(abandoned)
    for abandoned in folder.glob('.fsd-' + manifest.stem + '-*.partial'):
        if abandoned.is_file() and not abandoned.is_symlink():
            abandoned.unlink()
    staging = manifest.parent / 'staging' / manifest.stem
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)
    try:
        data = json.loads(manifest.read_text(encoding='utf8'))
    except FileNotFoundError:
        data = {'url': args.url, 'tracks': []}
    if data.get('url') != args.url:
        raise ValueError('Session URL mismatch')
    if not data['tracks']:
        result_file = manifest.with_suffix('.tracks.json')
        result_file.parent.mkdir(parents=True, exist_ok=True)
        data['tracks'] = resolve_tracks(args.url, result_file)
        atomic_save(manifest, data)
    tracks = data['tracks']
    for offset in range(0, len(tracks), 20):
        emit('plan', reset=offset == 0, tracks=[{'id': track['id'], 'title': track['title'][:300], 'status': track.get('status', 'pending'), 'error': track.get('error', '')[-1000:], 'file': track.get('file')} for track in tracks[offset:offset + 20]])
    saved = existing = skipped = 0
    for index, track in enumerate(tracks):
        if args.only_track and track['id'] != args.only_track:
            continue
        track.pop('error', None)
        # A filename alone is never proof of a completed download. Check its audio header.
        candidates = [file for file in folder.iterdir() if file.name.endswith(f"[{track['id']}].{args.format}")]
        verified = next((file for file in candidates if valid_audio(file) and (not track.get('sha256') or fingerprint(file) == track['sha256'])), None)
        if verified:
            existing += 1
            track.update(status='existing', file=str(verified), sha256=fingerprint(verified))
        else:
            emit('track', id=track['id'], index=index + 1, total=len(tracks), title=track['title'], status='running')
            try:
                with tempfile.TemporaryDirectory(prefix='track-', dir=staging) as stage:
                    arguments = ['download', track['url'], '--format', args.format, '--output', str(Path(stage) / '{artists} - {title} [{track-id}].{output-ext}'), '--max-filename-length', '100', '--overwrite', 'force', '--threads', '1', '--no-cache', '--ffmpeg', args.ffmpeg, '--log-level', 'ERROR']
                    if args.format not in ['flac', 'wav']:
                        arguments += ['--bitrate', args.bitrate]
                    if args.cookie_file:
                        arguments += ['--cookie-file', args.cookie_file]
                    if args.deno:
                        from provider import runtime_options
                        arguments += ['--yt-dlp-args', runtime_options(args.deno)]
                    code, log = run_worker(arguments, 600)
                    detail = provider_failure(log)
                    if re.search(r'captcha|confirm.{0,20}(not a bot|you.re not)|sign in to confirm|HTTP Error 429|too many requests', detail, re.I):
                        rate_limit = bool(re.search(r'HTTP Error 429|too many requests', detail, re.I))
                        track.update(status='blocked', error=detail)
                        atomic_save(manifest, data)
                        video = re.search(r'(?:\[youtube\]\s+|watch\?v=)([A-Za-z0-9_-]{11})', detail + log)
                        url = 'https://www.youtube.com/watch?v=' + video[1] if video else 'https://www.youtube.com/'
                        emit('track', id=track['id'], index=index + 1, total=len(tracks), title=track['title'], status='blocked', error=detail, saved=saved, existing=existing, skipped=skipped)
                        emit('auth', title=track['title'], url=url, reason='rate_limit' if rate_limit else 'confirmation', detail=detail)
                        return
                    files = [file for file in Path(stage).iterdir() if file.suffix == '.' + args.format and valid_audio(file)]
                    if code or len(files) != 1:
                        raise RuntimeError(detail or 'No matching audio source')
                    source = files[0]
                    # Ensure the stable Spotify ID is present even if a provider omitted it.
                    name = source.stem.removesuffix(f"[{track['id']}]").rstrip()[:75] + f" [{track['id']}]"
                    destination = folder / (name + source.suffix)
                    promote(source, destination, manifest.stem)
                    saved += 1
                    track.update(status='saved', file=str(destination), sha256=fingerprint(destination))
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                skipped += 1
                track.update(status='skipped', error=(str(error).strip() or f'{type(error).__name__}: No details were returned by the audio provider.')[-1000:])
        atomic_save(manifest, data)
        emit('track', id=track['id'], file=track.get('file'), index=index + 1, total=len(tracks), title=track['title'], status=track['status'], error=track.get('error', ''), saved=saved, existing=existing, skipped=skipped)
    shutil.rmtree(staging, ignore_errors=True)
    emit('summary', saved=saved, existing=existing, skipped=skipped, total=len(tracks))


def interrupted(_signum, _frame):
    raise KeyboardInterrupt


def main(argv):
    signal.signal(signal.SIGTERM, interrupted)
    if argv[0] == '--resolve':
        resolve(argv[1], argv[2])
    else:
        def parent_watchdog():
            os.read(sys.stdin.fileno(), 1)
            os.kill(os.getpid(), signal.SIGTERM)
        threading.Thread(target=parent_watchdog, daemon=True).start()
        run_session(argv)
