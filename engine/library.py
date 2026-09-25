"""Read only complete, decodable audio files from the selected music folder."""
import hashlib
import json
from pathlib import Path
import re

EXTENSIONS = {'.mp3', '.m4a', '.flac', '.opus', '.wav'}


def scan(folder):
    from mutagen import File
    result = []
    for file in Path(folder).resolve().iterdir():
        if file.is_symlink() or not file.is_file() or file.suffix.lower() not in EXTENSIONS:
            continue
        try:
            audio = File(file)
            if audio is None or audio.info.length <= 0 or file.stat().st_size <= 0:
                continue
            result.append({'key': hashlib.sha256(str(file).encode()).hexdigest(), 'path': str(file), 'name': file.name,
                           'title': re.sub(r'\s*\[[a-zA-Z0-9]{22}\]$', '', file.stem), 'format': file.suffix[1:].upper(),
                           'duration': round(audio.info.length), 'size': file.stat().st_size, 'modified': file.stat().st_mtime})
        except Exception:
            # One malformed audio file does not hide the other verified songs.
            continue
    return sorted(result, key=lambda item: item['modified'], reverse=True)


def main(folder):
    print(json.dumps(scan(folder)), flush=True)
