"""Preserve installed Python and frontend component notices in the distribution."""
from importlib.metadata import distributions
from pathlib import Path
import json
import shutil
import sys

root = Path(__file__).resolve().parent.parent
output = root / 'licenses'
output.mkdir(exist_ok=True)
inventory = []
for dist in sorted(distributions(), key=lambda d: d.metadata['Name'].lower()):
    name = dist.metadata['Name']
    target = output / 'python' / name
    target.mkdir(parents=True, exist_ok=True)
    for file in dist.files or []:
        if any(word in Path(str(file)).name.lower() for word in ['license', 'copying', 'notice', 'authors']):
            source = Path(dist.locate_file(file))
            if source.is_file():
                safe_name = str(file).replace('..', '_').replace('/', '__').replace('\\', '__')
                shutil.copyfile(source, target / safe_name)
    inventory.append({'name': name, 'version': dist.version, 'license': dist.metadata.get('License-Expression') or dist.metadata.get('License', ''), 'urls': dist.metadata.get_all('Project-URL') or [dist.metadata.get('Home-page', '')]})
for package in ['lucide', 'electron', 'ffmpeg-static', 'deno']:
    directory = root / 'node_modules' / package
    target = output / package
    target.mkdir(exist_ok=True)
    for file in directory.iterdir():
        if file.is_file() and ('license' in file.name.lower() or file.name == 'ffmpeg.README'):
            shutil.copyfile(file, target / file.name)
(output / 'inventory.json').write_text(json.dumps({'python': sys.version, 'packages': inventory}, indent=2), encoding='utf8')
print(f'Collected notices for {len(inventory)} Python distributions and runtime components.')
