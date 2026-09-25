"""Generate the original Jedi Meister waveform app icon."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
folder = root / 'build'
folder.mkdir(exist_ok=True)
image = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((36, 36, 988, 988), radius=225, fill='#C6F56C')
for x, height in [(272,170),(368,330),(464,470),(560,250),(656,390),(752,130)]:
    draw.rounded_rectangle((x-22,512-height/2,x+22,512+height/2), radius=22, fill='#202D18')
image.save(folder / 'icon.png')
image.save(folder / 'icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
image.save(folder / 'icon.icns')
