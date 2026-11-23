# Builds public/tex-lo/*.webp: 1024px WebP copies of the colour/emissive textures, used by the LOW quality tier (phones).
# Normal / roughness / ORM maps are skipped: the low tier never samples them. Re-run after adding textures:
#   python3 scripts/make-lo-textures.py
import glob, os
from PIL import Image
SKIP = ('_Normal', '_ORM', '_Roughness', '_Metallic')
out = 'public/tex-lo'; os.makedirs(out, exist_ok=True)
for f in sorted(glob.glob('public/kit/*.png') + glob.glob('public/chars/*.png')):
    name = os.path.basename(f)
    if any(s in name for s in SKIP): continue
    im = Image.open(f); im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
    if im.mode == 'RGBA' and im.getchannel('A').getextrema()[0] == 255: im = im.convert('RGB')
    n = min(1024, max(im.size)); im = im.resize((n, n), Image.LANCZOS)
    im.save(f'{out}/{name[:-4]}.webp', 'WEBP', quality=82, method=6)
