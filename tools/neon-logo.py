"""
FIRE FIGHT 2 — the NEON DISTRICT sign (public/signs/fire-fight.png).

Hollow cyan tube lettering in a condensed grotesk with a white-hot core, a
hot-magenta "2", the katakana reading on a pink tube beneath, hairline rails,
and the NEON DISTRICT ARENA II tag above.
(The landing page glitches it live in CSS; the art itself stays clean so
the lobby banner reads crisp at 20 m.) Rendered as pure emission and then
un-premultiplied into RGBA, so the glow carries its own alpha and the sign
sits on ANY dark ground (the 2D landing, the lobby banner, the boot card).

    python tools/neon-logo.py            # writes public/signs/fire-fight.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as nd

W, H = 1536, 1024
FONTS = Path('C:/Windows/Fonts')
OUT = Path(__file__).resolve().parent.parent / 'public' / 'signs' / 'fire-fight.png'

CYAN = np.array([0.25, 0.95, 1.0])
MAGENTA = np.array([1.0, 0.24, 0.65])
WHITE = np.array([1.0, 1.0, 1.0])


def font(size, var='Bold Condensed'):
    f = ImageFont.truetype(str(FONTS / 'bahnschrift.ttf'), size)
    f.set_variation_by_name(var)
    return f


def mask_text(text, f, cx, cy, tracking=0, skew=0.0):
    """Centred text mask (float 0..1), with optional letter tracking + italic skew."""
    im = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(im)
    widths = [d.textlength(ch, font=f) for ch in text]
    total = sum(widths) + tracking * (len(text) - 1)
    x = cx - total / 2
    asc, desc = f.getmetrics()
    for ch, w in zip(text, widths):
        d.text((x, cy - (asc + desc) / 2), ch, font=f, fill=255)
        x += w + tracking
    if skew:
        im = im.transform((W, H), Image.AFFINE, (1, skew, -skew * cy, 0, 1, 0), Image.BICUBIC)
    return np.asarray(im, np.float32) / 255


def tube(mask, width):
    """The letter OUTLINE as a tube of the given width (a hollow neon sign)."""
    m = mask > 0.5
    r = max(1, width // 2)
    ring = nd.binary_dilation(m, iterations=r) & ~nd.binary_erosion(m, iterations=r)
    return nd.gaussian_filter(ring.astype(np.float32), 0.9)


def glow(t, colour, core=0.85, spread=(4, 14, 42), gains=(0.9, 0.55, 0.35)):
    """Emission for one tube: white-hot core, coloured skin, three-stage bloom."""
    e = np.zeros((H, W, 3), np.float32)
    hot = nd.gaussian_filter(t, 1.2) ** 2
    e += hot[..., None] * (WHITE * core + colour * (1 - core))
    e += t[..., None] * colour * 0.9
    for s, g in zip(spread, gains):
        e += nd.gaussian_filter(t, s)[..., None] * colour * g * 2.2
    return e


def rail(y, x0, x1, thick=3):
    m = np.zeros((H, W), np.float32)
    m[y - thick // 2 : y + (thick + 1) // 2, x0:x1] = 1
    return nd.gaussian_filter(m, 0.8)


def main():
    emit = np.zeros((H, W, 3), np.float32)
    fill = np.zeros((H, W), np.float32)  # faint lit-glass inside the letters

    # FIRE / FIGHT stacked, hard italic, tracked wide.
    big = font(300)
    fire = mask_text('FIRE', big, W * 0.43, H * 0.30, tracking=18, skew=-0.16)
    fight = mask_text('FIGHT', big, W * 0.43, H * 0.58, tracking=18, skew=-0.16)
    for m in (fire, fight):
        emit += glow(tube(m, 11), CYAN)
        fill += m * 0.12
    # The "2": magenta, taller, filled tube, hung off FIGHT's shoulder.
    two = mask_text('2', font(470), W * 0.775, H * 0.47, skew=-0.16)
    emit += glow(tube(two, 13), MAGENTA, core=0.75)
    fill += two * 0.2

    # Katakana reading on its own pink tube + rails either side.
    kat_f = ImageFont.truetype(str(FONTS / 'YuGothB.ttc'), 66)
    kat = mask_text('ファイア・ファイト', kat_f, W * 0.5, H * 0.825, tracking=22)
    kt = nd.gaussian_filter((kat > 0.5).astype(np.float32), 0.6)
    emit += glow(kt, MAGENTA, core=0.6, spread=(3, 10, 30), gains=(0.8, 0.45, 0.25))
    for x0, x1 in ((190, 380), (1150, 1346)):
        emit += glow(rail(int(H * 0.825), x0, x1), CYAN, core=0.5, spread=(3, 9, 24), gains=(0.6, 0.3, 0.15))
    # Small mono tag on top.
    tag = mask_text('// NEON DISTRICT ARENA II', font(34, 'SemiBold SemiCondensed'), W * 0.5, H * 0.085, tracking=6)
    emit += glow(nd.gaussian_filter((tag > 0.5).astype(np.float32), 0.5), CYAN, core=0.4, spread=(2, 6, 18), gains=(0.5, 0.25, 0.1))

    # Glass fill under the tubes, lit by them.
    emit += nd.gaussian_filter(fill, 1.0)[..., None] * np.array([0.3, 0.55, 0.75])

    # Soft-clip emission, then un-premultiply against black into RGBA.
    emit = 1 - np.exp(-emit * 1.25)
    a = np.clip(emit.max(axis=2), 0, 1)
    rgb = np.where(a[..., None] > 1e-4, emit / np.maximum(a[..., None], 1e-4), 0)
    out = np.dstack([np.clip(rgb, 0, 1), a])
    Image.fromarray((out * 255 + 0.5).astype(np.uint8)).save(sys.argv[1] if len(sys.argv) > 1 else OUT, optimize=True)


if __name__ == '__main__':
    main()
