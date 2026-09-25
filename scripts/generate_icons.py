"""Package the blue master artwork as native Windows and macOS icons."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
folder = root / 'build'
image = Image.open(folder / 'icon.png').convert('RGBA').resize((1024, 1024), Image.Resampling.LANCZOS)
image.save(folder / 'icon.png', optimize=True)
image.save(folder / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
image.save(folder / 'icon.icns')
