import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0, str(Path(__file__).parents[1] / 'engine'))
import session


def wav(file):
    with wave.open(str(file), 'wb') as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(8000)
        stream.writeframes(b'\0\0' * 8000)


class AudioNameTests(unittest.TestCase):
    def test_repeated_same_track_is_downloaded_only_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary).resolve() / 'Downloads'
            manifest = Path(temporary).resolve() / 'app-data' / 'job.json'
            track = {'id': '1' * 22, 'url': 'track', 'title': 'Song'}
            session.atomic_save(manifest, {'url': 'playlist', 'tracks': [dict(track), dict(track)]})
            def worker(args, _timeout):
                wav(Path(args[args.index('--output') + 1]).parent / 'Artist - Song.wav')
                return 0, ''
            with patch.object(session, 'run_worker', side_effect=worker) as download, contextlib.redirect_stdout(io.StringIO()):
                session.run_session(['--session', str(manifest), '--url', 'playlist', '--folder', str(folder), '--format', 'wav', '--bitrate', 'auto', '--ffmpeg', 'unused'])
            self.assertEqual(download.call_count, 1)
            self.assertEqual([p.name for p in folder.iterdir()], ['Artist - Song.wav'])
            tracks = json.loads(manifest.read_text(encoding='utf8'))['tracks']
            self.assertEqual(tracks[0]['file'], tracks[1]['file'])

    def test_all_output_formats_store_identity_in_metadata(self):
        ffmpeg = Path(__file__).parents[1] / 'node_modules' / 'ffmpeg-static' / ('ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            wav(root / 'source.wav')
            for extension in ('mp3', 'm4a', 'flac', 'opus', 'wav'):
                with self.subTest(extension=extension):
                    file = root / ('Artist - Title.' + extension)
                    subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(root / 'source.wav'), '-metadata', 'title=Original title', '-metadata', 'artist=Original artist', str(file)], check=True, capture_output=True)
                    from mutagen import File
                    original_tags = {key: str(value) for key, value in (File(file).tags or {}).items()}
                    session.write_track_identity(file, '1' * 22)
                    self.assertEqual(session.read_track_identity(file), '1' * 22)
                    self.assertTrue(session.valid_audio(file))
                    self.assertNotIn('1' * 22, file.name)
                    updated_tags = File(file).tags
                    for key, value in original_tags.items():
                        self.assertEqual(str(updated_tags[key]), value)

    def test_clean_names_collision_resume_cross_playlist_and_renaming(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            folder = root / 'Downloads'
            folder.mkdir()
            manifests = root / 'app-data'
            tracks = [{'id': str(i) * 22, 'url': str(i), 'title': 'Sve Će To'} for i in (1, 2)]
            manifest = manifests / 'one.json'
            session.atomic_save(manifest, {'url': 'playlist', 'tracks': tracks})
            def worker(args, _timeout):
                self.assertNotIn('{track-id}', args[args.index('--output') + 1])
                wav(Path(args[args.index('--output') + 1]).parent / 'Bijelo Dugme - Sve Će To.wav')
                return 0, ''
            def run(file):
                with contextlib.redirect_stdout(io.StringIO()):
                    session.run_session(['--session', str(file), '--url', 'playlist', '--folder', str(folder), '--format', 'wav', '--bitrate', 'auto', '--ffmpeg', 'unused'])
            with patch.object(session, 'run_worker', side_effect=worker) as download:
                run(manifest)
                self.assertEqual(download.call_count, 2)
            self.assertEqual(sorted(p.name for p in folder.iterdir()), ['Bijelo Dugme - Sve Će To (2).wav', 'Bijelo Dugme - Sve Će To.wav'])
            for track in json.loads(manifest.read_text(encoding='utf8'))['tracks']:
                self.assertEqual(session.read_track_identity(Path(track['file'])), track['id'])
            another = manifests / 'two.json'
            session.atomic_save(another, {'url': 'playlist', 'tracks': tracks})
            with patch.object(session, 'run_worker', side_effect=AssertionError('must reuse audio')):
                run(manifest)
                run(another)
                original = folder / 'Bijelo Dugme - Sve Će To.wav'
                original.rename(folder / 'My renamed song.wav')
                run(manifest)
            self.assertEqual(len(list(folder.iterdir())), 2)
            self.assertEqual(json.loads(manifest.read_text(encoding='utf8'))['tracks'][0]['file'], str(folder / 'My renamed song.wav'))
            modified = folder / 'My renamed song.wav'
            session.write_track_identity(modified, '1' * 22)
            with modified.open('ab') as stream:
                stream.write(b'modified')
            record = json.loads(manifest.read_text(encoding='utf8'))['tracks'][0]
            self.assertTrue(session.valid_audio(modified))
            self.assertIsNone(session.verified_download(folder, {'id': '1' * 22}, record, 'wav'))

    def test_legacy_names_migrate_without_overwriting_existing_song(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary).resolve()
            legacy = folder / ('Artist - Song [' + '1' * 22 + '].wav')
            wav(legacy)
            occupied = folder / 'Artist - Song.wav'
            occupied.write_bytes(b'user file: keep unchanged')
            manifest = folder / 'app-data' / 'job.json'
            session.atomic_save(manifest, {'url': 'playlist', 'tracks': [{'id': '1' * 22, 'url': 'track', 'title': 'Song'}]})
            with patch.object(session, 'run_worker', side_effect=AssertionError('must reuse audio')), contextlib.redirect_stdout(io.StringIO()):
                session.run_session(['--session', str(manifest), '--url', 'playlist', '--folder', str(folder), '--format', 'wav', '--bitrate', 'auto', '--ffmpeg', 'unused'])
            self.assertFalse(legacy.exists())
            self.assertEqual(occupied.read_bytes(), b'user file: keep unchanged')
            renamed = folder / 'Artist - Song (2).wav'
            self.assertTrue(session.valid_audio(renamed))
            self.assertEqual(session.read_track_identity(renamed), '1' * 22)
            self.assertEqual(json.loads(manifest.read_text(encoding='utf8'))['tracks'][0]['file'], str(renamed))

    def test_portable_names_keep_unicode_and_remove_invalid_windows_characters(self):
        self.assertEqual(session.clean_audio_name('CON', '1' * 22), '_CON')
        self.assertEqual(session.clean_audio_name('Bajaga: Kiše? / Live. ', '1' * 22), 'Bajaga_ Kiše_ _ Live')
        self.assertLessEqual(len(session.clean_audio_name('界' * 200, '1' * 22).encode('utf8')), 180)
