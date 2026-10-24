"""The street pads' glow maps → lossless WebP that keeps every channel
(tools/native-pads.mjs calls this: python native-pads-glow.py <png> <webp> ...).

A pad's glow map is FOUR data channels (ff2meta Arena/Pads~/make_pad_textures.py,
FF2/PadLit): R static glow, G animated glow, B the pulse's phase, A a second
static glow. Most texels have A = 0 while R / G / B still carry data (the phase
runs under the whole deck), and a lossless WebP encoder by default throws the
colour under clear alpha away to compress better — Pillow's exact=True keeps it.
Each file is read back and compared, so a lossy round trip fails loudly.
"""
import sys
from PIL import Image

args = sys.argv[1:]
if len(args) % 2:
    sys.exit('usage: native-pads-glow.py <src.png> <out.webp> [...]')
for src, out in zip(args[0::2], args[1::2]):
    im = Image.open(src).convert('RGBA')
    im.save(out, 'WEBP', lossless=True, exact=True, quality=100, method=6)
    back = Image.open(out).convert('RGBA')
    if back.tobytes() != im.tobytes():
        sys.exit(f'[native-pads-glow] {out}: the round trip changed texels')
    print(f'[native-pads-glow] {out}: lossless, all four channels kept')
