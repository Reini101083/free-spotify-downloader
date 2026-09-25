import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

spec = importlib.util.spec_from_file_location('session', Path(__file__).parents[1] / 'engine/session.py')
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)

def wav(file):
    with wave.open(str(file), 'wb') as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(8000); stream.writeframes(b'\0\0' * 8000)

class ResumeTests(unittest.TestCase):
    def test_first_playlist_resolution_retries_connection_and_persists_before_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            manifest = folder / 'session.json'
            track = {'url': 'https://open.spotify.com/track/' + '1' * 22, 'id': '1' * 22, 'title': 'Fixture'}
            resolves = 0
            def worker(args, _timeout):
                nonlocal resolves
                if args[0] == '--resolve':
                    resolves += 1
                    if resolves == 1:
                        return 1, 'Connection timed out'
                    session.atomic_save(args[2], [track])
                    return 0, ''
                self.assertEqual(json.loads(manifest.read_text())['tracks'], [track])
                self.assertIn('--max-filename-length', args)
                wav(Path(args[args.index('--output') + 1]).parent / ('Very long title ' * 8 + '.wav'))
                return 0, ''
            argv = ['--session', str(manifest), '--url', 'playlist', '--folder', str(folder), '--format', 'wav', '--bitrate', 'auto', '--ffmpeg', 'ffmpeg']
            with patch.object(session, 'run_worker', worker), patch.object(session.time, 'sleep'), contextlib.redirect_stdout(io.StringIO()) as output:
                session.run_session(argv)
            self.assertEqual(resolves, 2)
            self.assertIn('"saved": 1', output.getvalue())
            audio = Path(json.loads(manifest.read_text())['tracks'][0]['file'])
            self.assertLessEqual(len(audio.name), 104)
            self.assertTrue(audio.name.endswith('[' + track['id'] + '].wav'))

    def test_playlist_denial_is_not_retried_and_emits_structured_failure(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(session, 'run_worker', return_value=(1, 'HTTP 429 Too many requests')) as worker:
            with self.assertRaises(session.SessionError) as failure:
                session.resolve_tracks('playlist', Path(folder) / 'tracks.json')
            self.assertEqual(worker.call_count, 1)
            with contextlib.redirect_stdout(io.StringIO()) as output:
                session.report_error(failure.exception)
            event = json.loads(output.getvalue().removeprefix(session.PREFIX))
            self.assertEqual(event['code'], 'SPOTIFY_METADATA')
            self.assertIn('429', event['detail'])
            self.assertIn('limiting', event['message'])

    def test_resume_skips_completed_and_continues_after_missing_source(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            tracks = [{'url': f'https://open.spotify.com/track/{str(i) * 22}', 'id': str(i) * 22, 'title': f'Track {i}'} for i in (1, 2, 3)]
            manifest = folder / 'session.json'
            session.atomic_save(manifest, {'url': 'playlist', 'tracks': tracks})
            wav(folder / f"existing [{tracks[0]['id']}].wav")
            calls = []
            def worker(args, _timeout):
                calls.append(args[1])
                if args[1] == tracks[1]['url']:
                    return 1, 'No matching source'
                destination = Path(args[args.index('--output') + 1]).parent / f"saved [{tracks[2]['id']}].wav"
                wav(destination)
                return 0, ''
            argv = ['--session', str(manifest), '--url', 'playlist', '--folder', str(folder), '--format', 'wav', '--bitrate', 'auto', '--ffmpeg', 'ffmpeg']
            with patch.object(session, 'run_worker', worker), contextlib.redirect_stdout(io.StringIO()) as output:
                session.run_session(argv)
            self.assertEqual(calls, [tracks[1]['url'], tracks[2]['url']])
            self.assertIn('"saved": 1, "existing": 1, "skipped": 1', output.getvalue())
            calls.clear()
            with patch.object(session, 'run_worker', worker), contextlib.redirect_stdout(io.StringIO()):
                session.run_session(argv)
            self.assertEqual(calls, [tracks[1]['url']])
            self.assertEqual(json.loads(manifest.read_text())['tracks'][1]['status'], 'skipped')

    def test_captcha_stops_the_session_without_skipping_the_playlist(self):
        with tempfile.TemporaryDirectory() as folder:
            folder = Path(folder)
            tracks = [{'url': 'https://open.spotify.com/track/' + str(i) * 22, 'id': str(i) * 22, 'title': str(i)} for i in (1, 2)]
            file = folder / 'session.json'
            session.atomic_save(file, {'url': 'playlist', 'tracks': tracks})
            argv = ['--session', str(file), '--url', 'playlist', '--folder', str(folder), '--format', 'wav', '--bitrate', 'auto', '--ffmpeg', 'ffmpeg']
            with patch.object(session, 'run_worker', return_value=(1, "[youtube] abcdefghijk: Sign in to confirm you're not a bot")) as worker, contextlib.redirect_stdout(io.StringIO()) as output:
                session.run_session(argv)
            self.assertEqual(worker.call_count, 1)
            self.assertIn('"type": "auth"', output.getvalue())
            self.assertNotIn('"type": "summary"', output.getvalue())
            self.assertEqual(json.loads(file.read_text())['tracks'][0]['status'], 'blocked')

    def test_invalid_audio_and_deleted_files_are_not_treated_as_completed(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'broken.wav'
            file.write_bytes(b'incomplete file')
            self.assertFalse(session.valid_audio(file))
            file.unlink()
            self.assertFalse(session.valid_audio(file))

    def test_atomic_checkpoint_does_not_leave_partial_json(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'state.json'
            session.atomic_save(file, {'tracks': [1, 2, 3]})
            session.atomic_save(file, {'tracks': [4]})
            self.assertEqual(json.loads(file.read_text()), {'tracks': [4]})
            self.assertFalse(Path(str(file) + '.tmp').exists())

if __name__ == '__main__':
    unittest.main()
