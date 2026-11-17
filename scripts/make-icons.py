"""Generate PWA icons (run: python3 scripts/make-icons.py). Simple scale glyph on navy."""
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)
def icon(size, pad_ratio=0.0, rounded=False):
    s = size * 4
    im = Image.new('RGB', (s, s), (15, 27, 45))
    d = ImageDraw.Draw(im)
    p = int(s * pad_ratio)
    inner = s - 2 * p
    def X(f): return p + f * inner
    # platform
    d.rounded_rectangle([X(.18), X(.62), X(.82), X(.80)], radius=int(inner*.05), fill=(235, 240, 247))
    # dial
    d.ellipse([X(.30), X(.20), X(.70), X(.60)], fill=(235, 240, 247))
    d.ellipse([X(.35), X(.25), X(.65), X(.55)], fill=(15, 27, 45))
    # needle
    d.line([X(.50), X(.40), X(.60), X(.30)], fill=(46, 204, 113), width=int(inner*.035))
    # status dots
    for i, c in enumerate([(46, 204, 113), (242, 169, 0), (220, 53, 53)]):
        cx = X(.36 + i * .14); cy = X(.71); r = inner * .035
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
    return im.resize((size, size), Image.LANCZOS)
icon(192).save(f'{OUT}/icon-192.png')
icon(512).save(f'{OUT}/icon-512.png')
icon(512, pad_ratio=0.12).save(f'{OUT}/icon-maskable-512.png')
icon(180).save(f'{OUT}/apple-touch-icon.png')
print('ok')
