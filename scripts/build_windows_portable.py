"""Cross-package a Windows x64 portable app using official embedded CPython.

No Wine or cross-compiled PyInstaller executable is used. Run the resulting app
on Windows before publishing a production release. The normal CI build remains
native PyInstaller and can also produce an NSIS installer.
"""
import argparse
import gzip
import hashlib
import json
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYTHON = '3.13.15'


def fetch(url, destination):
    print(f'Downloading {destination.name}', flush=True)
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
        if response.headers.get('Content-Encoding') == 'gzip' and data[:2] == b'\x1f\x8b':
            data = gzip.decompress(data)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)


def require_pe(file):
    with file.open('rb') as stream:
        if stream.read(2) != b'MZ':
            raise RuntimeError(f'Not a Windows executable: {file}')
        stream.seek(0x3c)
        stream.seek(struct.unpack('<I', stream.read(4))[0])
        if stream.read(4) != b'PE\0\0' or struct.unpack('<H', stream.read(2))[0] != 0x8664:
            raise RuntimeError(f'Not Windows x64: {file}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir', type=Path)
    parser.add_argument('--wheel-dir', type=Path, help='Optional existing wheel cache')
    args = parser.parse_args()
    work = (args.work_dir or Path(tempfile.mkdtemp(prefix='fsd-windows-'))).resolve()
    work.mkdir(parents=True, exist_ok=True)
    engine, ffmpeg, deno = (work / name for name in ('engine', 'ffmpeg', 'deno'))
    for directory in (engine, ffmpeg, deno):
        directory.mkdir(exist_ok=True)
    archive = work / f'python-{PYTHON}-embed-amd64.zip'
    fetch(f'https://www.python.org/ftp/python/{PYTHON}/{archive.name}', archive)
    with zipfile.ZipFile(archive) as source:
        source.extractall(engine)
    # The isolated runtime searches only bundled code, never the user's Python.
    (engine / 'python313._pth').write_text('python313.zip\n.\nLib/site-packages\nimport site\n')
    command = [sys.executable, '-m', 'pip', 'install', '--upgrade', '--no-compile',
               '--target', str(engine / 'Lib/site-packages'), '--platform', 'win_amd64',
               '--python-version', '313', '--implementation', 'cp', '--abi', 'cp313',
               '--only-binary=:all:', '--require-hashes', '--no-deps',
               '-r', str(ROOT / 'engine/requirements-windows.lock')]
    if args.wheel_dir:
        command.extend(['--no-index', '--find-links', str(args.wheel_dir.resolve())])
    subprocess.run(command, check=True)
    for name in ('entry.py', 'session.py'):
        shutil.copy2(ROOT / 'engine' / name, engine / name)
    release = json.loads((ROOT / 'node_modules/ffmpeg-static/package.json').read_text())['ffmpeg-static']['binary-release-tag']
    base = f'https://github.com/eugeneware/ffmpeg-static/releases/download/{release}'
    compressed = work / 'ffmpeg-win32-x64.gz'
    fetch(base + '/ffmpeg-win32-x64.gz', compressed)
    with gzip.open(compressed, 'rb') as source, (ffmpeg / 'ffmpeg.exe').open('wb') as target:
        shutil.copyfileobj(source, target)
    fetch(base + '/win32-x64.LICENSE', ffmpeg / 'ffmpeg.LICENSE')
    fetch(base + '/win32-x64.README', ffmpeg / 'ffmpeg.README')
    for name in ('LICENSE', 'README.md'):
        shutil.copy2(ROOT / 'node_modules/ffmpeg-static' / name, ffmpeg / name)
    version = json.loads((ROOT / 'package.json').read_text())['devDependencies']['deno']
    deno_archive = work / 'deno.tgz'
    fetch(f'https://registry.npmjs.org/@deno/win32-x64/-/win32-x64-{version}.tgz', deno_archive)
    with tarfile.open(deno_archive) as source:
        for member in source.getmembers():
            if member.isfile() and Path(member.name).name in ('deno.exe', 'LICENSE'):
                (deno / Path(member.name).name).write_bytes(source.extractfile(member).read())
    if not (deno / 'LICENSE').exists():
        shutil.copy2(ROOT / 'node_modules/deno/LICENSE', deno / 'LICENSE')
    for file in [engine / 'python.exe', ffmpeg / 'ffmpeg.exe', deno / 'deno.exe', *engine.rglob('*.pyd')]:
        require_pe(file)
    if list(engine.rglob('*.so')):
        raise RuntimeError('Linux extension found in Windows runtime')
    manifest = {str(file.relative_to(work)): hashlib.sha256(file.read_bytes()).hexdigest()
                for directory in (engine, ffmpeg, deno) for file in sorted(directory.rglob('*')) if file.is_file()}
    (engine / 'bundle-sha256.json').write_text(json.dumps(manifest, indent=2) + '\n')
    # Array replacement keeps host-platform FFmpeg/Deno out of the Windows app.
    config = {
        **json.loads((ROOT / 'package.json').read_text())['build'],
        'directories': {'output': str(work / 'release')},
        'win': {'target': ['portable'], 'icon': 'build/icon.ico', 'signExecutable': False},
        'extraResources': [{'from': str(folder), 'to': name} for name, folder in
                           [('engine', engine), ('ffmpeg', ffmpeg), ('deno', deno), ('licenses', ROOT / 'licenses')]],
    }
    configuration = work / 'electron-builder.json'
    configuration.write_text(json.dumps(config, indent=2))
    subprocess.run(['npm', 'run', 'build:web'], cwd=ROOT, check=True)
    subprocess.run(['node', str(ROOT / 'node_modules/electron-builder/cli.js'), '--win', 'portable',
                    '--x64', '--publish', 'never', '--config', str(configuration)], cwd=ROOT, check=True)
    artifacts = list((work / 'release').glob('*-portable.exe'))
    if len(artifacts) != 1:
        raise RuntimeError('Expected exactly one portable executable')
    # The self-extractor is x86 by design; its embedded app is checked as x64.
    require_pe(work / 'release/win-unpacked/Free Spotify Downloader.exe')
    destination = ROOT / 'release'
    destination.mkdir(exist_ok=True)
    shutil.copy2(artifacts[0], destination / artifacts[0].name)
    print(f'Windows portable package: {destination / artifacts[0].name}', flush=True)


if __name__ == '__main__':
    main()
