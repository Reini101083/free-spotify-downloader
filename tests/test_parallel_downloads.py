import contextlib
from concurrent.futures import ThreadPoolExecutor
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
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


class ParallelDownloadTests(unittest.TestCase):
    def setup_session(self, root, count, parallel=3):
        folder = root / 'Downloads'
        folder.mkdir()
        manifest = root / 'app-data' / 'job.json'
        tracks = [{'id': str(index).zfill(22), 'url': str(index), 'title': f'Track {index}'}
                  for index in range(1, count + 1)]
        session.atomic_save(manifest, {'url': 'playlist', 'tracks': tracks})
        argv = ['--session', str(manifest), '--url', 'playlist', '--folder', str(folder),
                '--format', 'wav', '--bitrate', 'auto', '--ffmpeg', 'unused',
                '--parallel-songs', str(parallel)]
        return folder, manifest, tracks, argv

    def test_three_workers_overlap_without_duplicates_or_overwriting_and_resume(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder, manifest, tracks, argv = self.setup_session(Path(temporary).resolve(), 7)
            tracks.insert(2, dict(tracks[0]))
            session.atomic_save(manifest, {'url': 'playlist', 'tracks': tracks})
            occupied = folder / 'Artist - Same Title.wav'
            occupied.write_bytes(b'untouched user file')
            first_three = threading.Barrier(3, timeout=5)
            third_settled = threading.Event()
            lock = threading.Lock()
            active = maximum = 0
            calls, events = [], []

            def event(kind, **values):
                events.append(dict(type=kind, **values))
                if kind == 'track' and values['id'] == tracks[3]['id'] and values['status'] == 'saved':
                    third_settled.set()

            def worker(args, _timeout):
                nonlocal active, maximum
                number = int(args[1])
                with lock:
                    calls.append(number)
                    active += 1
                    maximum = max(maximum, active)
                try:
                    if number <= 3:
                        first_three.wait()
                    if number <= 2:
                        self.assertTrue(third_settled.wait(5))
                    wav(Path(args[args.index('--output') + 1]).parent / 'Artist - Same Title.wav')
                    return 0, ''
                finally:
                    with lock:
                        active -= 1

            with patch.object(session, 'run_worker', side_effect=worker), patch.object(session, 'emit', side_effect=event), patch.object(session, 'PARALLEL_START_INTERVAL', 0):
                session.run_session(argv)
            self.assertEqual(maximum, 3)
            self.assertEqual(sorted(calls), list(range(1, 8)))
            self.assertEqual(occupied.read_bytes(), b'untouched user file')
            results = json.loads(manifest.read_text())['tracks']
            self.assertEqual(results[0]['file'], results[2]['file'])
            self.assertEqual(len({track['file'] for track in results}), 7)
            self.assertEqual(len(list(folder.iterdir())), 8)
            for track in results:
                self.assertEqual(session.read_track_identity(Path(track['file'])), track['id'])
                self.assertEqual(session.fingerprint(Path(track['file'])), track['sha256'])
            settled = [e for e in events if e['type'] == 'track' and e['status'] in ('saved', 'existing')]
            self.assertEqual(settled[0]['index'], 4)  # Original position, not completion count.
            self.assertEqual([e['completed'] for e in settled], list(range(1, 9)))
            self.assertEqual(events[-1]['saved'], 7)
            self.assertEqual(events[-1]['existing'], 1)
            with patch.object(session, 'run_worker', side_effect=AssertionError('must reuse every file')), contextlib.redirect_stdout(io.StringIO()):
                session.run_session(argv)
            self.assertEqual(len(list(folder.iterdir())), 8)

    def test_parallel_starts_are_spaced_centrally(self):
        with tempfile.TemporaryDirectory() as temporary:
            _folder, _manifest, _tracks, argv = self.setup_session(Path(temporary), 3)
            ready = threading.Barrier(3, timeout=5)
            starts = []
            def worker(args, _timeout):
                starts.append(time.monotonic())
                ready.wait()
                wav(Path(args[args.index('--output') + 1]).parent / 'Song.wav')
                return 0, ''
            with patch.object(session, 'run_worker', side_effect=worker), patch.object(session, 'PARALLEL_START_INTERVAL', 0.04), contextlib.redirect_stdout(io.StringIO()):
                session.run_session(argv)
            self.assertEqual(len(starts), 3)
            self.assertTrue(all(second - first >= 0.035 for first, second in zip(starts, starts[1:])))

    def test_parallel_workers_use_private_cookie_jars_without_mutating_shared_session(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            _folder, _manifest, _tracks, argv = self.setup_session(root, 2, parallel=2)
            cookie_file = root / 'manual-session.txt'
            cookie_file.write_text('# Netscape HTTP Cookie File\n')
            original = cookie_file.read_bytes()
            ready = threading.Barrier(2, timeout=5)
            copies = []
            def worker(args, _timeout):
                private = Path(args[args.index('--cookie-file') + 1])
                self.assertNotEqual(private, cookie_file)
                self.assertEqual(private.read_bytes(), original)
                if os.name != 'nt':
                    self.assertEqual(private.stat().st_mode & 0o777, 0o600)
                copies.append(private)
                ready.wait()
                private.write_text('worker updated only its own jar')
                wav(Path(args[args.index('--output') + 1]).parent / 'Song.wav')
                return 0, ''
            with patch.object(session, 'run_worker', side_effect=worker), patch.object(session, 'PARALLEL_START_INTERVAL', 0), contextlib.redirect_stdout(io.StringIO()):
                session.run_session([*argv, '--cookie-file', str(cookie_file)])
            self.assertEqual(len(set(copies)), 2)
            self.assertTrue(all(not file.exists() for file in copies))
            self.assertEqual(cookie_file.read_bytes(), original)

    def test_access_denial_cancels_other_workers_and_checkpoints_before_auth(self):
        reasons = [("Sign in to confirm you're not a bot", 'confirmation'),
                   ('HTTP Error 429: Too many requests', 'rate_limit'),
                   ("This content isn't available, try again later", 'rate_limit')]
        for reason, expected in reasons:
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as temporary:
                folder, manifest, _tracks, argv = self.setup_session(Path(temporary), 6)
                ready = threading.Barrier(3, timeout=5)
                cancelled = threading.Event()
                calls, events = [], []
                original_cancel = session.WorkerGroup.cancel
                def cancel(group):
                    original_cancel(group)
                    cancelled.set()
                def worker(args, _timeout):
                    calls.append(args[1])
                    ready.wait()
                    if args[1] == '1':
                        return 1, '[youtube] abcdefghijk: ' + reason
                    self.assertTrue(cancelled.wait(5))
                    return 1, 'cancelled'
                def event(kind, **values):
                    events.append(dict(type=kind, **values))
                    if kind == 'auth':
                        # Resume state must already be durable when the UI receives auth.
                        states = [t.get('status', 'pending') for t in json.loads(manifest.read_text())['tracks']]
                        self.assertEqual(states, ['blocked', 'pending', 'pending', 'pending', 'pending', 'pending'])
                with patch.object(session.WorkerGroup, 'cancel', cancel), patch.object(session, 'run_worker', side_effect=worker), patch.object(session, 'emit', side_effect=event), patch.object(session, 'PARALLEL_START_INTERVAL', 0):
                    session.run_session(argv)
                self.assertEqual(sorted(calls), ['1', '2', '3'])
                auth = [e for e in events if e['type'] == 'auth']
                self.assertEqual(len(auth), 1)
                self.assertEqual(auth[0]['reason'], expected)
                self.assertFalse(any(e['type'] == 'summary' for e in events))
                self.assertEqual(list(folder.iterdir()), [])
                self.assertFalse((manifest.parent / 'staging' / manifest.stem).exists())

    def test_ready_auth_at_launch_deadline_is_processed_before_starting_another_song(self):
        with tempfile.TemporaryDirectory() as temporary:
            _folder, manifest, _tracks, argv = self.setup_session(Path(temporary), 4)
            clock = [0.0]
            original_wait = session.wait
            waits = 0
            def boundary_wait(futures, **options):
                nonlocal waits
                waits += 1
                if waits == 1:
                    # Model the narrow boundary where the pacing wait reports a
                    # timeout just as the current provider returns an auth result.
                    for future in futures:
                        future.result(timeout=5)
                    clock[0] = 6.0
                    return set(), set(futures)
                return original_wait(futures, **options)
            with patch.object(session.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(session, 'wait', side_effect=boundary_wait), patch.object(session, 'run_worker', return_value=(1, 'HTTP Error 429: Too many requests')) as worker, contextlib.redirect_stdout(io.StringIO()) as output:
                session.run_session(argv)
            self.assertEqual(worker.call_count, 1)
            self.assertEqual(output.getvalue().count('"type": "auth"'), 1)
            self.assertEqual([track.get('status', 'pending') for track in json.loads(manifest.read_text())['tracks']], ['blocked', 'pending', 'pending', 'pending'])

    def test_pause_cancels_workers_and_leaves_unfinished_tracks_retryable(self):
        with tempfile.TemporaryDirectory() as temporary:
            _folder, manifest, _tracks, argv = self.setup_session(Path(temporary), 5)
            ready = threading.Barrier(4, timeout=5)
            cancelled = threading.Event()
            original_cancel = session.WorkerGroup.cancel
            def cancel(group):
                original_cancel(group)
                cancelled.set()
            def worker(_args, _timeout):
                ready.wait()
                self.assertTrue(cancelled.wait(5))
                return 1, 'cancelled'
            def interrupt(*_args, **_kwargs):
                ready.wait()
                raise KeyboardInterrupt
            with patch.object(session.WorkerGroup, 'cancel', cancel), patch.object(session, 'run_worker', side_effect=worker), patch.object(session, 'wait', side_effect=interrupt), patch.object(session, 'PARALLEL_START_INTERVAL', 0), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(KeyboardInterrupt):
                    session.run_session(argv)
            self.assertTrue(cancelled.is_set())
            self.assertTrue(all(t.get('status', 'pending') == 'pending' for t in json.loads(manifest.read_text())['tracks']))
            self.assertFalse((manifest.parent / 'staging' / manifest.stem).exists())

    def test_cancellation_stops_all_real_provider_processes_and_their_children(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            group = session.WorkerGroup()
            child_code = "import pathlib,sys,time\np=pathlib.Path(sys.argv[1])\nwhile True:\n p.write_text(str(time.monotonic()))\n time.sleep(0.02)"
            parent_code = "import subprocess,sys\np=subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]])\np.wait()"
            heartbeats = [root / str(index) for index in range(3)]
            def command(path):
                return [sys.executable, '-c', parent_code, child_code, path]
            def worker(path):
                session._worker_context.group = group
                try:
                    return session.run_worker([str(path)], 20)
                finally:
                    session._worker_context.group = None
            with patch.object(session, 'command', side_effect=command), ThreadPoolExecutor(max_workers=3) as executor:
                futures = [executor.submit(worker, path) for path in heartbeats]
                try:
                    deadline = time.monotonic() + 10
                    while not all(path.exists() and path.stat().st_size for path in heartbeats):
                        self.assertLess(time.monotonic(), deadline, 'provider child did not start')
                        time.sleep(0.02)
                    self.assertEqual(len(group.processes), 3)
                    group.cancel()
                    for future in futures:
                        self.assertNotEqual(future.result(timeout=10)[0], 0)
                    self.assertFalse(group.processes)
                    stopped = [path.read_text() for path in heartbeats]
                    time.sleep(0.12)
                    self.assertEqual([path.read_text() for path in heartbeats], stopped)
                    with self.assertRaises(session.WorkerCancelled):
                        group.start([sys.executable, '-c', 'raise SystemExit(0)'])
                finally:
                    group.cancel()

    def test_invalid_parallel_limit_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            _folder, _manifest, _tracks, argv = self.setup_session(Path(temporary), 1, parallel=4)
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                session.run_session(argv)

    def test_parent_pipe_close_stops_live_session_and_checkpoints_pending_tracks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            _folder, manifest, _tracks, argv = self.setup_session(root, 3)
            worker = "import os,pathlib,sys,time\np=pathlib.Path(sys.argv[1])\np.with_suffix('.pid').write_text(str(os.getpid()))\nwhile True:\n p.write_text(str(time.monotonic()))\n time.sleep(0.02)"
            script = (f"import sys\nsys.path.insert(0, {str(Path(session.__file__).parent)!r})\nimport session\n"
                      "session.PARALLEL_START_INTERVAL=0\n"
                      f"session.command=lambda *args: [sys.executable,'-c',{worker!r},{str(root)!r}+'/'+args[1]+'.heartbeat']\n"
                      "try:\n session.main(sys.argv[1:])\nexcept KeyboardInterrupt:\n sys.exit(130)\n")
            process = subprocess.Popen([sys.executable, '-c', script, *argv], stdin=subprocess.PIPE,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            heartbeats = [root / f'{index}.heartbeat' for index in range(1, 4)]
            try:
                deadline = time.monotonic() + 10
                while not all(path.exists() and path.stat().st_size for path in heartbeats):
                    self.assertIsNone(process.poll(), 'session exited before all workers started')
                    self.assertLess(time.monotonic(), deadline, 'session workers did not start')
                    time.sleep(0.02)
                process.stdin.close()
                self.assertEqual(process.wait(timeout=10), 130, process.stderr.read().decode())
                self.assertTrue(all(t['status'] == 'pending' for t in json.loads(manifest.read_text())['tracks']))
                stopped = [path.read_text() for path in heartbeats]
                time.sleep(0.12)
                self.assertEqual([path.read_text() for path in heartbeats], stopped)
            finally:
                if not process.stdin.closed:
                    process.stdin.close()
                if process.poll() is None:
                    process.kill()
                    process.wait()
                process.stderr.close()
                # Cleanup also protects a failing test from leaving a fixture running.
                for pid_file in root.glob('*.pid'):
                    pid = int(pid_file.read_text())
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                    else:
                        try:
                            os.killpg(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass


if __name__ == '__main__':
    unittest.main()
