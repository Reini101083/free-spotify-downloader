"""Exercise the packaged executable with a local audio fixture, without network access."""
import json
from pathlib import Path
import subprocess
import tempfile
import sys
import wave

root = Path(__file__).resolve().parent.parent
engine = root / 'engine-dist' / ('spotdl-engine.exe' if sys.platform == 'win32' else 'spotdl-engine')
extension = '.exe' if sys.platform == 'win32' else ''
check = subprocess.run([str(engine), '--diagnostics', str(root / 'node_modules' / 'ffmpeg-static' / ('ffmpeg' + extension)), str(root / 'node_modules' / 'deno' / ('deno' + extension))], capture_output=True, text=True, timeout=90, check=True)
health = json.loads(check.stdout.strip().splitlines()[-1])
assert health['ejs'] and health['mp3_conversion'] and health['saved_file_verified'], health
print('Packaged engine: Deno/EJS loaded, FFmpeg encoded a real MP3 and library verified it.')
with tempfile.TemporaryDirectory() as directory:
    folder = Path(directory)
    track_id = '1234567890123456789012'
    audio = folder / f'Fixture [{track_id}].wav'
    with wave.open(str(audio), 'wb') as stream:
        stream.setnchannels(1); stream.setsampwidth(2); stream.setframerate(8000); stream.writeframes(b'\0\0' * 8000)
    manifest = folder / 'job.json'
    manifest.write_text(json.dumps({'url':'fixture','tracks':[{'id':track_id,'url':'https://open.spotify.com/track/'+track_id,'title':'Local fixture'}]}))
    process = subprocess.Popen([str(engine), '--session', str(manifest), '--url', 'fixture', '--folder', str(folder), '--format', 'wav', '--bitrate', 'auto', '--ffmpeg', 'unused'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        process.wait(timeout=45)
        stdout, stderr = process.communicate()
    except BaseException:
        process.kill(); process.wait(); raise
    assert process.returncode == 0, stderr.decode(errors='replace')
    events = [json.loads(line[len('FSD_EVENT '):]) for line in stdout.decode().splitlines() if line.startswith('FSD_EVENT ')]
    assert events[-1]['type'] == 'summary' and events[-1]['existing'] == 1 and events[-1]['saved'] == 0, events
    assert json.loads(manifest.read_text())['tracks'][0]['sha256']
print('Packaged engine: valid existing file verified and reused; checkpoint written.')
