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

PREFIX = 'FSD_EVENT '


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
        process = subprocess.Popen(command(*args), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=os.name != 'nt')
        try:
            code = process.wait(timeout=timeout)
        finally:
            kill_tree(process)
        log.seek(0, 2)
        log.seek(max(0, log.tell() - 6000))
        return code, log.read().decode('utf8', errors='replace')


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


def run_session(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument('--session', required=True)
    parser.add_argument('--url', required=True)
    parser.add_argument('--folder', required=True)
    parser.add_argument('--format', choices=['mp3', 'm4a', 'flac', 'opus', 'wav'], required=True)
    parser.add_argument('--bitrate', required=True)
    parser.add_argument('--ffmpeg', required=True)
    parser.add_argument('--cookie-file')
    args = parser.parse_args(argv)
    manifest = Path(args.session)
    folder = Path(args.folder).resolve()
    folder.mkdir(parents=True, exist_ok=True)
    stage_prefix = '.fsd-stage-' + manifest.stem + '-'
    for abandoned in folder.glob(stage_prefix + '*'):
        if abandoned.is_dir():
            shutil.rmtree(abandoned)
    try:
        data = json.loads(manifest.read_text(encoding='utf8'))
    except FileNotFoundError:
        data = {'url': args.url, 'tracks': []}
    if data.get('url') != args.url:
        raise ValueError('Session URL mismatch')
    if not data['tracks']:
        result_file = manifest.with_suffix('.tracks.json')
        result_file.parent.mkdir(parents=True, exist_ok=True)
        code, log = run_worker(['--resolve', args.url, str(result_file)], 120)
        if code or not result_file.exists():
            raise RuntimeError('Track list unavailable: ' + log[-1000:])
        data['tracks'] = json.loads(result_file.read_text(encoding='utf8'))
        if not data['tracks']:
            raise RuntimeError('No available tracks in this link')
        atomic_save(manifest, data)
    tracks = data['tracks']
    saved = existing = skipped = 0
    for index, track in enumerate(tracks):
        # A filename alone is never proof of a completed download. Check its audio header.
        candidates = [file for file in folder.iterdir() if file.name.endswith(f"[{track['id']}].{args.format}")]
        verified = next((file for file in candidates if valid_audio(file) and (not track.get('sha256') or fingerprint(file) == track['sha256'])), None)
        if verified:
            existing += 1
            track.update(status='existing', file=str(verified), sha256=fingerprint(verified))
        else:
            emit('track', index=index + 1, total=len(tracks), title=track['title'], status='running')
            try:
                # Staging is on the destination filesystem: final promotion is an atomic rename.
                with tempfile.TemporaryDirectory(prefix=stage_prefix, dir=folder) as stage:
                    arguments = ['download', track['url'], '--format', args.format, '--output', str(Path(stage) / '{artists} - {title} [{track-id}].{output-ext}'), '--overwrite', 'force', '--threads', '1', '--no-cache', '--ffmpeg', args.ffmpeg, '--log-level', 'ERROR']
                    if args.format not in ['flac', 'wav']:
                        arguments += ['--bitrate', args.bitrate]
                    if args.cookie_file:
                        arguments += ['--cookie-file', args.cookie_file]
                    code, log = run_worker(arguments, 600)
                    if re.search(r'captcha|confirm.{0,15}(not a bot|you.re not)|sign in to confirm|HTTP Error 429|too many requests', log, re.I):
                        track.update(status='blocked', error='Manual YouTube confirmation required')
                        atomic_save(manifest, data)
                        video = re.search(r'\[youtube\]\s+([A-Za-z0-9_-]{11})', log)
                        url = 'https://www.youtube.com/watch?v=' + video[1] if video else 'https://www.youtube.com/'
                        emit('auth', title=track['title'], url=url)
                        return
                    files = [file for file in Path(stage).iterdir() if file.suffix == '.' + args.format and valid_audio(file)]
                    if code or len(files) != 1:
                        raise RuntimeError(log[-1000:] or 'No matching audio source')
                    source = files[0]
                    # Ensure the stable Spotify ID is present even if a provider omitted it.
                    name = source.stem
                    if not name.endswith(f"[{track['id']}]"):
                        name = name[:130] + f" [{track['id']}]"
                    destination = folder / (name + source.suffix)
                    os.replace(source, destination)
                    saved += 1
                    track.update(status='saved', file=str(destination), sha256=fingerprint(destination))
            except (RuntimeError, subprocess.TimeoutExpired) as error:
                skipped += 1
                track.update(status='skipped', error=str(error)[-1000:])
        atomic_save(manifest, data)
        emit('track', index=index + 1, total=len(tracks), title=track['title'], status=track['status'], error=track.get('error', ''), saved=saved, existing=existing, skipped=skipped)
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
