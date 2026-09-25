import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
sys.path.insert(0, str(Path(__file__).parents[1] / 'engine'))
import session
import library
import provider

class DownloadIntegrityTests(unittest.TestCase):
    def test_provider_logger_preserves_the_hidden_captcha_reason(self):
        from spotdl.providers.audio.base import YTDLLogger
        old_error, old_warning = YTDLLogger.error, YTDLLogger.warning
        try:
            provider.install_diagnostics()
            with contextlib.redirect_stdout(io.StringIO()) as output:
                try:
                    YTDLLogger().error("[youtube] abcdefghijk: Sign in to confirm you're not a bot")
                except Exception:
                    pass
            self.assertIn("not a bot", session.provider_failure(output.getvalue()))
        finally:
            YTDLLogger.error, YTDLLogger.warning = old_error, old_warning

    def test_individual_retry_stages_in_app_data_and_leaves_flat_valid_audio(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary); downloads=root/'Downloads';downloads.mkdir(); manifest=root/'app-data'/'sessions'/'job.json'
            tracks=[{'id':str(i)*22,'url':'https://open.spotify.com/track/'+str(i)*22,'title':str(i)} for i in (1,2)]
            session.atomic_save(manifest,{'url':'playlist','tracks':tracks})
            def worker(args, timeout):
                self.assertEqual(args[1],tracks[1]['url'])
                stage=Path(args[args.index('--output')+1]).parent
                self.assertTrue(stage.is_relative_to(manifest.parent))
                self.assertFalse(stage.is_relative_to(downloads))
                with wave.open(str(stage/'Song.wav'),'wb') as stream:
                    stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(8000);stream.writeframes(b'\0\0'*8000)
                return 0,''
            argv=['--session',str(manifest),'--url','playlist','--folder',str(downloads),'--format','wav','--bitrate','auto','--ffmpeg','ffmpeg','--only-track',tracks[1]['id']]
            with patch.object(session,'run_worker',worker) as mocked, contextlib.redirect_stdout(io.StringIO()): session.run_session(argv)
            files=list(downloads.iterdir());self.assertEqual(len(files),1);self.assertTrue(session.valid_audio(files[0]))
            (downloads/'broken.mp3').write_bytes(b'incomplete')
            (downloads/'.fsd-stage-old').mkdir()
            found=library.scan(downloads);self.assertEqual(len(found),1);self.assertEqual(found[0]['title'],'Song')

    def test_empty_provider_failure_still_has_a_reason_and_continues(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);manifest=root/'job.json';tracks=[{'id':str(i)*22,'url':str(i),'title':str(i)} for i in (1,2)]
            session.atomic_save(manifest,{'url':'playlist','tracks':tracks})
            argv=['--session',str(manifest),'--url','playlist','--folder',str(root),'--format','mp3','--bitrate','192k','--ffmpeg','ffmpeg']
            with patch.object(session,'run_worker',side_effect=RuntimeError()) as worker,contextlib.redirect_stdout(io.StringIO()):session.run_session(argv)
            self.assertEqual(worker.call_count,2)
            for track in json.loads(manifest.read_text())['tracks']:
                self.assertEqual(track['status'],'skipped');self.assertTrue(track['error'].strip())

    def test_windows_runtime_path_with_spaces_round_trips(self):
        from spotdl.utils.formatter import args_to_ytdlp_options
        import shlex
        runtime=r'C:\Program Files\Free Spotify Downloader\deno\deno.exe'
        values=shlex.split(provider.runtime_options(runtime))
        self.assertEqual(args_to_ytdlp_options(values)['js_runtimes']['deno']['path'],runtime)
