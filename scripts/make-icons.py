"""Transmission Helm icons. macOS/Windows get a full-bleed square (the OS masks it);
Linux keeps a rounded tile with padding since nothing masks it there."""
import math, os, subprocess, sys, shutil
from PIL import Image, ImageDraw

OUT = sys.argv[1]
S = 1024

def wheel(draw, cx, cy, r, color, width, spokes=8, hub=0.22):
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], outline=color, width=width)
    inner = r*0.80
    draw.ellipse([cx-inner, cy-inner, cx+inner, cy+inner], outline=color, width=int(width*0.6))
    h = r*hub
    draw.ellipse([cx-h, cy-h, cx+h, cy+h], fill=color)
    for i in range(spokes):
        a = i*2*math.pi/spokes
        x1, y1 = cx+math.cos(a)*h*0.8, cy+math.sin(a)*h*0.8
        x2, y2 = cx+math.cos(a)*r*1.22, cy+math.sin(a)*r*1.22
        draw.line([x1, y1, x2, y2], fill=color, width=int(width*0.75))
        hx, hy = x2, y2
        hr = width*0.8
        draw.ellipse([hx-hr, hy-hr, hx+hr, hy+hr], fill=color)

def tile(pad_frac, radius_frac):
    scale = 4
    big = S*scale
    pad = int(big*pad_frac)
    img = Image.new('RGBA', (big, big), (0,0,0,0))
    grad = Image.new('RGBA', (big, big), (0,0,0,0))
    gd = ImageDraw.Draw(grad)
    top, bottom = (56, 122, 255), (22, 62, 160)
    for y in range(pad, big-pad):
        t = (y-pad)/(big-2*pad)
        c = tuple(int(top[i]*(1-t)+bottom[i]*t) for i in range(3))+(255,)
        gd.line([pad, y, big-pad, y], fill=c)
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, big-pad, big-pad], radius=int(big*radius_frac), fill=255)
    img.paste(grad, (0,0), mask)
    d = ImageDraw.Draw(img)
    # wheel scaled to the visible tile
    visible = big - 2*pad
    wheel(d, big/2, big/2 + visible*0.01, visible*0.32, (255,255,255,235), int(visible*0.042))
    return img.resize((S, S), Image.LANCZOS)

full = tile(0.0, 0.0)          # macOS (system squircle mask) and Windows
linux = tile(0.09, 0.19)       # unmasked desktops

os.makedirs(f'{OUT}/build', exist_ok=True); os.makedirs(f'{OUT}/resources', exist_ok=True)
full.save(f'{OUT}/build/icon.png')
full.save(f'{OUT}/build/icon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
linux.resize((512,512), Image.LANCZOS).save(f'{OUT}/resources/icon.png')
iconset = f'{OUT}/build/icon.iconset'
os.makedirs(iconset, exist_ok=True)
for s in (16,32,128,256,512):
    full.resize((s,s), Image.LANCZOS).save(f'{iconset}/icon_{s}x{s}.png')
    full.resize((s*2,s*2), Image.LANCZOS).save(f'{iconset}/icon_{s}x{s}@2x.png')
subprocess.run(['iconutil','-c','icns',iconset,'-o',f'{OUT}/build/icon.icns'], check=True)
shutil.rmtree(iconset)
print('icons regenerated')
